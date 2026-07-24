const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
assert(['2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1', '2.14-R9', '2.15-R0A', '2.15-R0B'].includes(read('VERSION.txt').trim()));

function createSandbox() {
  const sandbox = {
    console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object, Error, Promise,
    setTimeout, clearTimeout, queueMicrotask,
    document: { addEventListener() {}, querySelectorAll: () => [] },
    window: null
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.dispatchEvent = () => true;
  vm.createContext(sandbox);
  vm.runInContext(read('js/features/memory/kernel.js'), sandbox, { filename: 'kernel.js' });
  vm.runInContext(read('js/features/memory/write_coordinator.js'), sandbox, { filename: 'write_coordinator.js' });
  vm.runInContext(read('js/features/memory/write_gateway.js'), sandbox, { filename: 'write_gateway.js' });
  return sandbox;
}

(async () => {
  const sandbox = createSandbox();
  const Kernel = sandbox.OvoMemoryKernel;
  const Coordinator = Kernel.require('writeCoordinator');
  assert(['2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1', '2.14-R9', '2.15-R0A', '2.15-R0B'].includes(Coordinator.VERSION));

  const chat = { id: 'chat-serial', memoryTables: { data: { value: 0 }, history: [] } };
  const order = [];
  const writer = async (_id, currentChat) => {
    order.push(`save:${currentChat.memoryTables.data.value}`);
    await new Promise(resolve => setTimeout(resolve, 6));
  };
  const first = Coordinator.run(chat, { reason: 'first', writer }, async () => {
    order.push('mutate:1');
    chat.memoryTables.data.value = 1;
    await new Promise(resolve => setTimeout(resolve, 3));
    return { changed: true, value: 1 };
  });
  const second = Coordinator.run(chat, { reason: 'second', writer }, () => {
    order.push(`mutate:2:seen-${chat.memoryTables.data.value}`);
    assert.strictEqual(chat.memoryTables.data.value, 1, 'same-character writes must be serialized');
    chat.memoryTables.data.value = 2;
    return { changed: true, value: 2 };
  });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.strictEqual(firstResult.persisted, true);
  assert.strictEqual(secondResult.persisted, true);
  assert.deepStrictEqual(order, ['mutate:1', 'save:1', 'mutate:2:seen-1', 'save:2']);
  assert.strictEqual(chat.memoryTables.data.value, 2);
  assert.strictEqual(Coordinator.getStatus(chat).pending, 0);

  let noopWrites = 0;
  const noop = await Coordinator.run(chat, { writer: async () => { noopWrites += 1; } }, () => ({ changed: false, status: 'noop' }));
  assert.strictEqual(noop.persisted, false);
  assert.strictEqual(noopWrites, 0, 'no-op transactions must not write storage');

  const rollbackChat = {
    id: 'chat-rollback',
    memoryTables: { data: { before: true }, reviewState: { pendingBatches: [{ id: 'batch' }] }, history: [{ id: 'history' }] }
  };
  const rollbackBefore = JSON.stringify(rollbackChat.memoryTables);
  await assert.rejects(() => Coordinator.run(rollbackChat, {
    reason: 'rollback-test',
    writer: async () => { throw new Error('模拟持久化失败'); },
    persistRollback: false
  }, () => {
    rollbackChat.memoryTables.data = { after: true };
    rollbackChat.memoryTables.reviewState.pendingBatches = [];
    rollbackChat.memoryTables.history = [];
    return { changed: true };
  }), error => {
    assert.strictEqual(error.message, '模拟持久化失败');
    assert.strictEqual(error.memoryRollbackApplied, true);
    return true;
  });
  assert.strictEqual(JSON.stringify(rollbackChat.memoryTables), rollbackBefore, 'full memoryTables state must roll back');

  // Real Domain + table editor: a failed field save restores the formal row and does not create undo state.
  const editorSandbox = createSandbox();
  const EK = editorSandbox.OvoMemoryKernel;
  editorSandbox.db = { memoryTableTemplates: [], characters: [] };
  editorSandbox.window.db = editorSandbox.db;
  vm.runInContext(read('js/features/memory/domain.js'), editorSandbox, { filename: 'domain.js' });
  vm.runInContext(read('js/features/memory/table_cache.js'), editorSandbox, { filename: 'table_cache.js' });
  vm.runInContext(read('js/features/memory/table_persistence.js'), editorSandbox, { filename: 'table_persistence.js' });
  EK.register('tableGrid', { commitInput() {} });
  EK.register('tableReconciler', { markSaving() {}, markSaved() {} });
  vm.runInContext(read('js/features/memory/table_editor.js'), editorSandbox, { filename: 'table_editor.js' });
  const Domain = EK.require('domain');
  const Editor = EK.require('tableEditor');
  assert(['2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1', '2.14-R9', '2.15-R0A', '2.15-R0B'].includes(Editor.VERSION));
  const table = { id: 'table', name: '近期经历', mode: 'rows', columns: [{ id: 'content', key: '内容', type: 'longtext', default: '' }] };
  const template = { id: 'tpl', name: '记忆', tables: [table] };
  editorSandbox.db.memoryTableTemplates = [template];
  const editChat = { id: 'edit-chat', memoryTables: { boundTemplateIds: ['tpl'], data: {}, history: [], lockedFields: {} } };
  Domain.ensureMemoryTableState(editChat);
  Domain.ensureTemplateDataForChat(editChat, template);
  const row = Domain.addRow(editChat, 'tpl', table, { content: '原内容' }, { source: 'manual' });
  editChat.memoryTables.history = [];
  await assert.rejects(() => Editor.commitField({
    chat: editChat, template, table, field: table.columns[0], rowId: row.id, rawValue: '不应保留',
    writer: async () => { throw new Error('字段保存失败'); }
  }), /字段保存失败/);
  const restored = Domain.findRowById(editChat, 'tpl', table, row.id);
  assert.strictEqual(restored.cells.content, '原内容');
  assert.strictEqual(Editor.canUndo(editChat), false, 'failed writes must not enter the undo stack');

  const html = read('index.html');
  const architecture = JSON.parse(read('architecture/memory_domains.json'));
  const controller = read('js/modules/memory_table.js');
  const candidate = read('js/features/memory/candidate_service.js');
  const sidecarController = read('js/features/memory/sidecar_candidate_controller.js');
  const tableEditor = read('js/features/memory/table_editor.js');
  assert(html.includes('js/features/memory/write_coordinator.js'));
  assert(html.indexOf('write_coordinator.js') < html.indexOf('candidate_service.js'));
  assert(architecture.publicFacades.memoryFoundationDomain.owns.includes('writeCoordinator'));
  assert(controller.includes('MemoryWriteGateway.run(chat'));
  assert(architecture.publicFacades.memoryFoundationDomain.owns.includes('writeGateway'));
  assert(controller.includes('MemoryCandidateService.approveAtomic'));
  assert(candidate.includes("Kernel.get('writeGateway')"));
  assert(sidecarController.includes("Kernel.get('writeGateway')"));
  assert(tableEditor.includes("Kernel.get('writeGateway')"));
  assert(!controller.includes('targetRow.cells[field.id] = newValue'), 'API row updates must use Domain');
  assert(!controller.includes('chat.memoryTables.data[templateId][tableId][fieldId] = newValue'), 'API KV updates must use Domain');

  const metrics = Coordinator.getMetrics();
  assert(metrics.committed >= 2 && metrics.rolledBack >= 1 && metrics.skipped >= 1);
  console.log('V2.14-R1 MEMORY WRITE COORDINATOR CHECKS: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
