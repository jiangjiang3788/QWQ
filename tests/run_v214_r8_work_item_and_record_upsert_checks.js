const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
assert(['2.14-R8', '2.14-R8.1', '2.14-R9', '2.15-R0A', '2.15-R0B'].includes(read('VERSION.txt').trim()));

function createBox(extra = {}) {
  const box = {
    window: null, console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object,
    Error, Promise, setTimeout, clearTimeout, ...extra
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('js/features/memory/kernel.js'), box, { filename: 'kernel.js' });
  return box;
}

// Stable identity + deterministic upsert.
{
  const table = {
    id: 'events', name: '近期经历', systemRole: 'recent_events', mode: 'rows', memoryLayer: 'short', columns: [
      { id: 'event_id', key: '事件ID', type: 'text' },
      { id: 'date', key: '日期', type: 'date' },
      { id: 'title', key: '标题', type: 'text' },
      { id: 'content', key: '内容', type: 'longtext' }
    ]
  };
  const template = { id: 'tpl', name: '记忆', tables: [table] };
  const chat = { id: 'chat', memoryTables: { boundTemplateIds: ['tpl'], data: {}, lockedFields: {}, history: [] } };
  const box = createBox({ db: { memoryTableTemplates: [template], characters: [chat] } });
  vm.runInContext(read('js/features/memory/memory_defaults.js'), box, { filename: 'memory_defaults.js' });
  vm.runInContext(read('js/modules/memory_table_policy.js'), box, { filename: 'memory_table_policy.js' });
  vm.runInContext(read('js/features/memory/field_semantics.js'), box, { filename: 'field_semantics.js' });
  vm.runInContext(read('js/features/memory/record_identity.js'), box, { filename: 'record_identity.js' });
  vm.runInContext(read('js/features/memory/domain.js'), box, { filename: 'domain.js' });
  const Domain = box.OvoMemoryKernel.require('domain');
  const Identity = box.OvoMemoryKernel.require('recordIdentity');
  assert(['2.14-R8', '2.14-R8.1', '2.14-R9', '2.15-R0A', '2.15-R0B'].includes(Identity.VERSION));

  let result = Domain.upsertRow(chat, template.id, table, {
    event_id: 'E-001', date: '2026-07-24', title: '边界约定', content: '第一次明确约定。'
  }, { source: 'test', sourceMessageId: 'm1' });
  assert(result.created && !result.matched);
  const firstRowId = result.row.id;
  const firstSeenAt = result.row.meta.identity.firstSeenAt;

  result = Domain.upsertRow(chat, template.id, table, {
    event_id: 'E-001', date: '2026-07-24', title: '边界约定', content: '约定已经在真实对话中执行。'
  }, { source: 'test', sourceMessageId: 'm2', mergeStrategy: 'replace_non_empty' });
  assert(!result.created && result.matched);
  assert.strictEqual(result.matchedBy, 'strong_key');
  assert.strictEqual(result.row.id, firstRowId);
  assert.strictEqual(result.row.cells.content, '约定已经在真实对话中执行。');
  assert.strictEqual(Domain.getRows(chat, template.id, table).length, 1);
  assert.strictEqual(result.row.meta.identity.firstSeenAt, firstSeenAt);
  assert(result.row.meta.identity.lastSeenAt >= firstSeenAt);
  assert(result.row.meta.identity.matchCount >= 2);
  assert(result.row.meta.identity.sourceRefs.includes('m1'));
  assert(result.row.meta.identity.sourceRefs.includes('m2'));

  result = Domain.upsertRow(chat, template.id, table, {
    date: '2026-07-25', title: '低耗能收尾', content: '先休息。'
  }, { source: 'test' });
  assert(result.created);
  result = Domain.upsertRow(chat, template.id, table, {
    date: '2026-07-25', title: '低耗能收尾', content: '先休息，再处理剩余事项。'
  }, { source: 'test' });
  assert(!result.created && result.matched && result.matchedBy === 'title_date');
  assert.strictEqual(Domain.getRows(chat, template.id, table).length, 2);

  const rows = Domain.getRows(chat, template.id, table);
  rows.push({ id: 'legacy-a', cells: { event_id: '', date: '2026-07-26', title: '重复标题', content: 'A' }, meta: {} });
  rows.push({ id: 'legacy-b', cells: { event_id: '', date: '2026-07-26', title: '重复标题', content: 'B' }, meta: {} });
  Domain.ensureTemplateDataForChat(chat, template);
  const keys = Domain.getRows(chat, template.id, table).map(row => row.meta.identity.recordKey);
  assert.strictEqual(new Set(keys).size, keys.length, 'pre-existing rows must receive unique stable record keys');
}

// Unified pending WorkItem protocol.
{
  const box = createBox();
  const Kernel = box.OvoMemoryKernel;
  const reviewTable = { id: 'review', name: '长期候选', mode: 'rows', memoryLayer: 'review', columns: [{ id: 'status', key: '审核状态' }, { id: 'content', key: '候选内容' }] };
  const stateTable = { id: 'state', name: '近期状态', mode: 'rows', memoryLayer: 'short', columns: [{ id: 'content', key: '内容' }] };
  const candidateRow = { id: 'long-1', cells: { status: '待审核', content: '稳定偏好候选' }, meta: { createdAt: 10 } };
  const uncertainRow = { id: 'uncertain-1', cells: { content: '需要复核的状态' }, meta: { lifecycle: { status: 'uncertain', reviewAt: 1, expiresAt: 0 } } };
  const conflictRow = { id: 'conflict-1', cells: { content: '冲突记忆' }, meta: { lifecycle: { status: 'conflicting', reviewAt: 0, expiresAt: 0 } } };
  const template = { id: 'tpl', tables: [reviewTable, stateTable] };
  const rows = { review: [candidateRow], state: [uncertainRow, conflictRow] };
  const chat = { id: 'chat', memoryTables: { sidecar: { candidates: [{ id: 'short-1', type: 'experience', status: 'pending', summary: '短期候选', confidence: 88, createdAt: 20 }] } } };

  Kernel.register('domain', {
    isRowsTable: table => table.mode === 'rows',
    getRows: (_chat, _templateId, table) => rows[table.id] || [],
    getRowSearchText: (table, row) => table.columns.map(field => `${field.key}: ${row.cells[field.id] || ''}`).join(' ')
  });
  Kernel.register('review', {
    getPendingBatches: () => [{ id: 'batch-1', tableName: '当前状态', proposals: [{ risk: 'high' }, { risk: 'low' }], sourceMessageCount: 6, relatedContext: { rowCount: 2 }, createdAt: 30 }],
    getBatchChangeSummary: () => ({ recordCount: 1, fieldCount: 2 })
  });
  Kernel.register('lifecycle', {
    textForRow: (table, row) => table.columns.map(field => `${field.key}: ${row.cells[field.id] || ''}`).join(' '),
    ensureRowMeta: row => row.meta
  });
  Kernel.register('tasks', {
    ensureState: () => ({ tasks: [
      { id: 'task-failed', status: 'failed', title: '索引任务', createdAt: 5, lastError: '网络失败' },
      { id: 'task-paused', status: 'paused', title: '整理任务', createdAt: 4 }
    ] })
  });
  Kernel.register('sidecar', { ensureState: currentChat => currentChat.memoryTables.sidecar });
  Kernel.register('feedback', { getPendingCount: () => 2 });
  Kernel.register('policy', { normalizeTablePolicy: table => ({ memoryLayer: table.memoryLayer }) });
  Kernel.register('candidateService', {
    VERSION: 'test',
    isPending: (_table, row) => row.cells.status === '待审核',
    statusText: (_table, row) => row.cells.status
  });
  Kernel.register('sidecarCandidateService', {
    VERSION: 'test', ACTIONABLE: new Set(['pending', 'legacy_unverified']),
    migrateLegacyCandidates() {}, statusLabel: status => status === 'pending' ? '待处理' : '旧版去向未验证'
  });

  vm.runInContext(read('js/features/memory/work_item.js'), box, { filename: 'work_item.js' });
  vm.runInContext(read('js/features/memory/governance_queue.js'), box, { filename: 'governance_queue.js' });
  const WorkItem = Kernel.require('workItem');
  const Queue = Kernel.require('governanceQueue');
  const items = WorkItem.collect(chat, [template], { now: 100 });
  items.forEach(item => assert(WorkItem.validate(item).ok, WorkItem.validate(item).errors.join(',')));
  assert.strictEqual(items.length, 8);
  assert.deepStrictEqual(new Set(items.map(item => item.type)), new Set([
    'update_review', 'long_candidate', 'reliability_review', 'conflict_review',
    'short_candidate', 'failed_task', 'paused_task', 'retrieval_feedback'
  ]));
  assert.strictEqual(items.filter(item => item.type === 'short_candidate').length, 1, 'short candidates must remain individual actionable items');
  assert.strictEqual(items.find(item => item.type === 'conflict_review').selectable, false);
  const feedback = items.find(item => item.type === 'retrieval_feedback');
  assert(feedback.availableActions.some(action => action.id === 'open-view' && action.params.view === 'usage_audit'));
  assert(feedback.availableActions.some(action => action.id === 'clear-feedback-tasks'));
  const counts = Queue.countByCategory(items);
  assert.deepStrictEqual({ ...counts }, { all: 8, review: 1, candidate: 2, reliability: 2, system: 3 });
  const html = Queue.renderHome(chat, [template]);
  assert(html.includes('待处理') && html.includes('短期候选') && html.includes('失败任务'));
}

// Architecture and loading ownership.
{
  const contract = JSON.parse(read('architecture/memory_domains.json'));
  const html = read('index.html');
  assert(contract.publicFacades.memoryFoundationDomain.owns.includes('recordIdentity'));
  assert(contract.publicFacades.memoryGovernanceDomain.owns.includes('workItem'));
  assert(html.indexOf('record_identity.js') < html.indexOf('domain.js'));
  assert(html.indexOf('work_item.js') < html.indexOf('governance_queue.js'));
  assert(read('js/features/memory/review_orchestrator.js').includes('upsertRow'));
  assert(read('js/features/memory/sidecar_candidate_service.js').includes('Domain.upsertRow'));
}

console.log('V2.14-R8 WORK ITEM + RECORD IDENTITY UPSERT CHECKS: PASS');
