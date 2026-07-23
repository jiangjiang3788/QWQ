const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const recent = {
  id: 'table_recent_events', name: '近期经历、想法与重要事件', mode: 'rows', memoryLayer: 'short', columns: [
    { id: 'event_id', key: '事件ID', type: 'text', default: '' },
    { id: 'created', key: '创建时间', type: 'text', default: '' },
    { id: 'updated', key: '最后更新时间', type: 'text', default: '' },
    { id: 'completed', key: '完成时间', type: 'text', default: '' },
    { id: 'type', key: '类型', type: 'text', default: '' },
    { id: 'title', key: '标题', type: 'text', default: '' },
    { id: 'content', key: '内容', type: 'longtext', default: '' },
    { id: 'entities', key: '相关主体', type: 'tags', default: [] },
    { id: 'impact', key: '影响', type: 'longtext', default: '' },
    { id: 'status', key: '当前状态', type: 'enum', default: '进行中', options: ['进行中', '已完成'] },
    { id: 'origin', key: '原始记录ID', type: 'text', default: '' }
  ]
};
const daily = {
  id: 'table_daily_observation', name: '日常观察（睡眠/饮水/身体）', mode: 'rows', memoryLayer: 'short', columns: [
    { id: 'date', key: '日期', type: 'date', default: '' },
    { id: 'sleep', key: '睡眠情况', type: 'longtext', default: '' },
    { id: 'water', key: '饮水情况', type: 'longtext', default: '' },
    { id: 'body', key: '身体状态', type: 'longtext', default: '' },
    { id: 'energy', key: '精力与情绪', type: 'longtext', default: '' },
    { id: 'complete', key: '数据完整度', type: 'progress', default: 50, min: 0, max: 100 },
    { id: 'source', key: '来源说明', type: 'longtext', default: '' }
  ]
};
const template = { id: 'tpl', name: '记忆', tables: [recent, daily] };
const db = { memoryTableTemplates: [template], characters: [] };
const sandbox = {
  console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object, Error, Promise,
  db,
  document: { getElementById: () => null, addEventListener: () => {} },
  window: { db, addEventListener: () => {}, dispatchEvent: () => true }
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(read('js/features/memory/kernel.js'), sandbox);
vm.runInContext(read('js/modules/memory_table_sidecar.js'), sandbox);
vm.runInContext(read('js/features/memory/domain.js'), sandbox);
vm.runInContext(read('js/features/memory/sidecar_candidate_service.js'), sandbox);
vm.runInContext(read('js/features/memory/sidecar_candidate_controller.js'), sandbox);

const Kernel = sandbox.window.OvoMemoryKernel;
const Sidecar = Kernel.require('sidecar');
const Domain = Kernel.require('domain');
const Service = Kernel.require('sidecarCandidateService');
const Controller = Kernel.require('sidecarCandidateController');

function candidate(id, summary, type = 'experience', status = 'pending') {
  return {
    id, type, summary, status, createdAt: Date.now(), confidence: 90, source: 'user_explicit', sourceRoundId: 'round-1',
    tags: { topic: type === 'daily_observation' ? ['睡眠'] : ['边界'], scene: ['工作中'], entity: ['用户'], effect: type === 'daily_observation' ? 'temporary_state' : 'historical_context' }
  };
}
function makeChat() {
  const chat = {
    id: 'chat-1', memoryTables: {
      enabled: true, boundTemplateIds: ['tpl'], data: { tpl: { table_recent_events: { __rows: [] }, table_daily_observation: { __rows: [] } } },
      lockedFields: {}, history: [], sidecar: { enabled: true, captureCandidates: true, candidates: [], history: [] }
    }
  };
  db.characters = [chat];
  return chat;
}

// Old "processed" candidates must not masquerade as saved records.
const legacyChat = makeChat();
legacyChat.memoryTables.sidecar.candidates.push(candidate('legacy-1', '旧候选', 'experience', 'processed'));
const legacyState = Sidecar.ensureState(legacyChat);
assert.strictEqual(legacyState.candidates[0].status, 'legacy_unverified');
assert(legacyState.candidates[0].migrationNote.includes('未记录正式档案目标'));

// Save creates exactly one formal row and stores traceability.
const saveChat = makeChat();
saveChat.memoryTables.sidecar.candidates.push(candidate('candidate-save', '用户明确提出工作场景下不要讨论私密身体话题。'));
const saved = Service.execute(saveChat, 'save', { candidateId: 'candidate-save', operationId: 'op-save' });
assert(saved.changed && !saved.duplicate);
const savedRows = Domain.getRows(saveChat, 'tpl', recent);
assert.strictEqual(savedRows.length, 1);
assert.strictEqual(savedRows[0].cells.origin, 'candidate-save');
assert.strictEqual(savedRows[0].meta.sourceCandidateId, 'candidate-save');
assert.strictEqual(saveChat.memoryTables.sidecar.candidates[0].status, 'promoted');
assert.strictEqual(saveChat.memoryTables.sidecar.candidates[0].targetRowId, savedRows[0].id);
const savedAgain = Service.execute(saveChat, 'save', { candidateId: 'candidate-save' });
assert.strictEqual(savedAgain.changed, false);
assert.strictEqual(Domain.getRows(saveChat, 'tpl', recent).length, 1, 'double save created a duplicate row');

// Merge appends to the selected row through Domain and is idempotent.
const mergeChat = makeChat();
const existing = Domain.addRow(mergeChat, 'tpl', recent, { title: '已有记录', content: '原内容', origin: 'old' }, { source: 'manual' });
mergeChat.memoryTables.sidecar.candidates.push(candidate('candidate-merge', '新增的边界说明。'));
const merged = Service.execute(mergeChat, 'merge', { candidateId: 'candidate-merge', targetRowId: existing.id });
assert(merged.changed && merged.fieldChanges > 0);
const mergedRow = Domain.findRowById(mergeChat, 'tpl', recent, existing.id);
assert(mergedRow.cells.content.includes('原内容') && mergedRow.cells.content.includes('新增的边界说明'));
const mergedAgain = Service.execute(mergeChat, 'merge', { candidateId: 'candidate-merge', targetRowId: existing.id });
assert.strictEqual(mergedAgain.changed, false);
const mergedRowAgain = Domain.findRowById(mergeChat, 'tpl', recent, existing.id);
assert.strictEqual((mergedRowAgain.cells.content.match(/新增的边界说明/g) || []).length, 1);
assert.strictEqual(mergeChat.memoryTables.sidecar.candidates[0].status, 'merged');

// Daily observations route to the daily table.
const dailyChat = makeChat();
dailyChat.memoryTables.sidecar.candidates.push(candidate('candidate-daily', '昨晚睡眠不足，今天精力偏低。', 'daily_observation'));
const dailySaved = Service.execute(dailyChat, 'save', { candidateId: 'candidate-daily' });
assert.strictEqual(dailySaved.descriptor.table.id, 'table_daily_observation');
assert(Domain.getRows(dailyChat, 'tpl', daily)[0].cells.sleep.includes('睡眠不足'));

// Dismiss and delete never write formal memory.
const closeChat = makeChat();
closeChat.memoryTables.sidecar.candidates.push(candidate('candidate-dismiss', '不需要保存'), candidate('candidate-delete', '需要删除'));
assert(Service.execute(closeChat, 'dismiss', { candidateId: 'candidate-dismiss' }).changed);
assert(Service.execute(closeChat, 'delete', { candidateId: 'candidate-delete' }).changed);
assert.strictEqual(closeChat.memoryTables.sidecar.candidates[0].status, 'dismissed');
assert.strictEqual(closeChat.memoryTables.sidecar.candidates[1].status, 'deleted');
assert.strictEqual(Domain.getRows(closeChat, 'tpl', recent).length, 0);

// Persistence failure restores both formal data and candidate state.
(async () => {
  const rollbackChat = makeChat();
  rollbackChat.memoryTables.sidecar.candidates.push(candidate('candidate-rollback', '保存失败时必须回滚。'));
  let rendered = 0;
  await Controller.handle('save', { dataset: { candidateId: 'candidate-rollback' }, closest: () => null }, {
    chat: rollbackChat,
    save: async () => { throw new Error('模拟持久化失败'); },
    render: () => { rendered += 1; },
    toast: () => {},
    showError: () => {}
  });
  assert.strictEqual(Domain.getRows(rollbackChat, 'tpl', recent).length, 0);
  assert.strictEqual(rollbackChat.memoryTables.sidecar.candidates[0].status, 'pending');
  assert(rendered > 0);

  const sidecarText = read('js/modules/memory_table_sidecar.js');
  assert(sidecarText.includes('保存到档案'));
  assert(sidecarText.includes('合并到已有记录'));
  assert(sidecarText.includes('暂时忽略'));
  assert(!sidecarText.includes('标记已整理'));
  assert(!sidecarText.includes('handleCandidateAction'));
  assert(read('index.html').includes('sidecar_candidate_service.js'));
  assert(read('index.html').includes('sidecar_candidate_controller.js'));
  console.log('V2.13-R4 SIDECAR CANDIDATE CLOSURE CHECKS: PASS');
})().catch(error => { console.error(error); process.exit(1); });
