const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function memorySandbox() {
  const db = { memoryTableTemplates: [], characters: [] };
  const operations = [];
  const runtime = {
    start(type, options) { const op = { id: `op-${operations.length + 1}`, type, options, status: 'running', mutations: [] }; operations.push(op); return op; },
    stage() {}, recordMutation(id, item) { operations.find(op => op.id === id)?.mutations.push(item); },
    complete(id, result) { const op = operations.find(item => item.id === id); if (op) Object.assign(op, { status: 'success', result }); },
    skip(id, reason) { const op = operations.find(item => item.id === id); if (op) Object.assign(op, { status: 'skipped', reason }); },
    fail(id, error) { const op = operations.find(item => item.id === id); if (op) Object.assign(op, { status: 'failed', error: String(error?.message || error) }); }
  };
  const sandbox = {
    console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object, Error, Promise,
    db,
    document: { getElementById: () => null, querySelectorAll: () => [] },
    window: { db, OVOOperationRuntime: runtime, addEventListener: () => {}, dispatchEvent: () => true }
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(read('js/features/memory/kernel.js'), sandbox);
  const Kernel = sandbox.window.OvoMemoryKernel;
  Kernel.register('policy', {
    normalizeTablePolicy: table => ({ memoryLayer: table.memoryLayer || 'long' }),
    ensureRuntimeState(chat) { chat.memoryTables.runtime ||= { tableStates: {}, engineSettings: {} }; return chat.memoryTables.runtime; },
    clearRetrievalCache() {}
  });
  Kernel.register('lifecycle', {
    ensureRowMeta(row) { row.meta ||= {}; row.meta.lifecycle ||= { status: 'active' }; return row.meta; },
    recordSource(row) { row.meta ||= {}; },
    setStatus(row, status, reason) { row.meta ||= {}; row.meta.lifecycle = { ...(row.meta.lifecycle || {}), status, statusReason: reason }; },
    removeReferences() {},
    migrateRows() { return 0; }
  });
  vm.runInContext(read('js/features/memory/domain.js'), sandbox);
  vm.runInContext(read('js/features/memory/candidate_service.js'), sandbox);
  return { sandbox, Kernel, db, operations };
}

function candidateFixture() {
  const candidate = {
    id: 'table_candidate', name: '长期候选审核队列', mode: 'rows', memoryLayer: 'review',
    promotionPolicy: { enabled: true, targetTableId: 'table_target' },
    columns: [
      { id: 'candidate_content', key: '候选内容', type: 'longtext', default: '' },
      { id: 'candidate_category', key: '候选类别', type: 'text', default: '' },
      { id: 'candidate_confidence', key: '置信度', type: 'number', default: 0 },
      { id: 'candidate_evidence', key: '支持证据', type: 'longtext', default: '' },
      { id: 'candidate_exception', key: '反例或例外', type: 'longtext', default: '' },
      { id: 'candidate_status', key: '审核状态', type: 'enum', default: '待审核', options: ['待审核', '已批准', '已拒绝'] }
    ]
  };
  const decoy = { id: 'table_decoy', name: '其他长期表', mode: 'rows', memoryLayer: 'long', columns: [{ id: 'decoy_content', key: '内容', type: 'longtext', default: '' }] };
  const target = {
    id: 'table_target', name: '稳定长期特征库', mode: 'rows', memoryLayer: 'long', columns: [
      { id: 'target_domain', key: '来源域', type: 'enum', default: '长期候选审核', options: ['长期候选审核', '成长沉淀'] },
      { id: 'target_category', key: '分类', type: 'text', default: '' },
      { id: 'target_content', key: '内容', type: 'longtext', default: '' },
      { id: 'target_confidence', key: '原置信度', type: 'number', default: 0 },
      { id: 'target_status', key: '确认状态', type: 'text', default: '' },
      { id: 'target_exception', key: '例外或适用场景', type: 'longtext', default: '' },
      { id: 'target_origin', key: '原始记录ID', type: 'text', default: '' }
    ]
  };
  return { candidate, decoy, target, template: { id: 'tpl', name: '记忆', tables: [candidate, decoy, target] } };
}

(async () => {
  const { sandbox, Kernel, db, operations } = memorySandbox();
  const Domain = Kernel.require('domain');
  const Service = Kernel.require('candidateService');
  const fixture = candidateFixture();
  db.memoryTableTemplates = [fixture.template];
  const chat = { id: 'chat-1', memoryTables: { boundTemplateIds: ['tpl'], data: {}, history: [], lockedFields: {} } };
  Domain.ensureMemoryTableState(chat);
  Domain.ensureTemplateDataForChat(chat, fixture.template);
  const sourceRow = Domain.addRow(chat, 'tpl', fixture.candidate, {
    candidate_content: '用户在压力过载时会明确请求低刺激陪伴。', candidate_category: '稳定需求', candidate_confidence: 92,
    candidate_evidence: '多轮明确表达', candidate_exception: '仅在压力过载时', candidate_status: '待审核'
  }, { source: 'manual' });
  chat.memoryTables.history = [];
  let saves = 0;
  const descriptor = { template: fixture.template, table: fixture.candidate };
  const first = await Service.approveAtomic(chat, descriptor, sourceRow, { persist: async () => { saves += 1; } });
  assert(first.changed && !first.duplicate);
  assert.strictEqual(Domain.getRows(chat, 'tpl', fixture.decoy).length, 0, 'must not promote to first long table');
  assert.strictEqual(Domain.getRows(chat, 'tpl', fixture.target).length, 1);
  assert.strictEqual(sourceRow.meta.workflow.promotedToTableId, 'table_target');
  assert.strictEqual(sourceRow.meta.workflow.promotedToRowId, first.targetRow.id);
  assert.strictEqual(sourceRow.cells.candidate_status, '已批准');
  assert.strictEqual(saves, 1);
  assert.strictEqual(operations.at(-1).status, 'success');

  const second = await Service.approveAtomic(chat, descriptor, sourceRow, { persist: async () => { saves += 1; } });
  assert(second.duplicate && second.idempotent && !second.changed);
  assert.strictEqual(Domain.getRows(chat, 'tpl', fixture.target).length, 1, 'double approval created duplicate long row');

  const rollbackChat = { id: 'chat-rollback', memoryTables: { boundTemplateIds: ['tpl'], data: {}, history: [], lockedFields: {} } };
  Domain.ensureMemoryTableState(rollbackChat);
  Domain.ensureTemplateDataForChat(rollbackChat, fixture.template);
  const rollbackRow = Domain.addRow(rollbackChat, 'tpl', fixture.candidate, { candidate_content: '必须回滚', candidate_status: '待审核' }, { source: 'manual' });
  rollbackChat.memoryTables.history = [];
  const before = JSON.stringify(rollbackChat.memoryTables.data);
  await assert.rejects(() => Service.approveAtomic(rollbackChat, descriptor, rollbackRow, { persist: async () => { throw new Error('模拟保存失败'); } }), /模拟保存失败/);
  assert.strictEqual(JSON.stringify(rollbackChat.memoryTables.data), before, 'promotion rollback did not restore data');
  const restoredSource = Domain.getRows(rollbackChat, 'tpl', fixture.candidate).find(row => row.id === rollbackRow.id);
  assert.strictEqual(restoredSource.cells.candidate_status, '待审核');
  assert.strictEqual(Domain.getRows(rollbackChat, 'tpl', fixture.target).length, 0);
  assert.strictEqual(operations.at(-1).status, 'failed');

  // Full-row modal editor and atomic save/rollback.
  Kernel.register('tableCache', { touch() {}, getMetrics: () => ({}), resetMetrics() {} });
  Kernel.register('tablePersistence', {
    saveNow: async (id, writer) => writer(id),
    schedule: async (id, writer) => writer(id),
    getMetrics: () => ({}), resetMetrics() {}
  });
  Kernel.register('tableGrid', { commitInput() {} });
  Kernel.register('tableReconciler', { markSaving() {}, markSaved() {} });
  vm.runInContext(read('js/features/memory/row_edit_modal.js'), sandbox);
  vm.runInContext(read('js/features/memory/table_editor.js'), sandbox);
  const Modal = Kernel.require('rowEditModal');
  const Editor = Kernel.require('tableEditor');
  const rendered = Modal.render({ chat, template: fixture.template, table: fixture.target, row: first.targetRow });
  assert(rendered.html.includes('data-row-edit-field="target_content"'));
  assert(rendered.html.includes('用户在压力过载时会明确请求低刺激陪伴。'));
  assert(rendered.html.includes('整行标签'));

  const editResult = await Editor.commitRecord({
    chat, template: fixture.template, table: fixture.target, rowId: first.targetRow.id,
    values: { target_content: '修改后的完整长期文本，弹窗中应全部可见。', target_status: '用户确认' },
    tagBundle: vm.runInContext("({ topic: '压力, 陪伴', scene: '高压时', entity: '用户', effect: 'hard_boundary' })", sandbox),
    writer: async () => true
  });
  assert(editResult.changed);
  const editedTarget = Domain.findRowById(chat, 'tpl', fixture.target, first.targetRow.id);
  assert.strictEqual(editedTarget.cells.target_content, '修改后的完整长期文本，弹窗中应全部可见。');
  assert.deepStrictEqual(Array.from(editedTarget.meta.tagBundle.topic), ['压力', '陪伴']);

  const beforeRollbackEdit = JSON.stringify(chat.memoryTables.data);
  await assert.rejects(() => Editor.commitRecord({
    chat, template: fixture.template, table: fixture.target, rowId: first.targetRow.id,
    values: { target_content: '这次不应保存' }, writer: async () => { throw new Error('整行保存失败'); }
  }), /整行保存失败/);
  assert.strictEqual(JSON.stringify(chat.memoryTables.data), beforeRollbackEdit);

  assert(!fs.existsSync(path.join(root, 'netlify.toml')));
  assert(!fs.existsSync(path.join(root, '_headers')));
  assert(!fs.existsSync(path.join(root, '_redirects')));
  assert(!fs.existsSync(path.join(root, 'NETLIFY_DEPLOY.txt')));
  assert(!read('tools/build_release.py').includes('netlify.toml'));
  console.log('V2.13-R5 ATOMIC PROMOTION + ROW EDITOR + DEPLOY CLEANUP CHECKS: PASS');
})().catch(error => { console.error(error); process.exit(1); });
