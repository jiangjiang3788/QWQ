const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.11-R4', '2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2'].includes(read('VERSION.txt').trim()));
const html = read('index.html');
const controllerText = read('js/modules/memory_table.js');
const workspaceText = read('js/features/memory/workspace.js');
const css = read('css/modules/memory_table_flat.css');
for (const file of ['candidate_service.js', 'table_filter.js', 'governance_queue.js', 'governance_controller.js', 'table_grid.js']) {
  assert(html.includes(`js/features/memory/${file}`), `missing ${file}`);
  assert(html.indexOf(`js/features/memory/${file}`) < html.indexOf('js/modules/memory_table.js'), `${file} must load before controller`);
}
assert(workspaceText.includes('governance.renderHome(chat, templates)'), 'inbox did not converge on governance queue');
assert(css.includes('.memory-governance-list') && css.includes('.memory-table-filterbar'));
assert(!controllerText.includes('function approveLongCandidate'), 'candidate promotion must stay outside the main controller');
assert(!controllerText.includes('function renderV2RowsSheet'), 'table sheet rendering must stay outside the main controller');
assert(read('js/features/memory/table_workspace.js').includes('TableGrid.render'));
assert(read('js/features/memory/table_grid.js').includes('renderRowsSheet'));
assert(controllerText.split(/\r?\n/).length < 4450, 'memory_table.js did not shrink below the R4 budget');

const context = { window: {}, console, Date, JSON, Math, Set, Map };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(read('js/features/memory/kernel.js'), context);
const Kernel = context.window.OvoMemoryKernel;
Kernel.core.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
Kernel.core.escapeAttribute = Kernel.core.escapeHtml;

let seq = 0;
const reviewTable = {
  id: 'candidate_table', name: '长期候选审核队列', mode: 'rows', memoryLayer: 'review', columns: [
    { id: 'candidate_status', key: '审核状态', type: 'enum', options: ['待审核', '已批准', '已拒绝', '需要更多证据'] },
    { id: 'candidate_content', key: '候选内容', type: 'longtext' },
    { id: 'candidate_type', key: '候选类别', type: 'text' },
    { id: 'candidate_conf', key: '置信度', type: 'number' },
    { id: 'candidate_evidence', key: '支持证据', type: 'longtext' },
    { id: 'candidate_exception', key: '反例或例外', type: 'longtext' }
  ]
};
const longTable = {
  id: 'long_table', name: '稳定长期特征库', mode: 'rows', memoryLayer: 'long', columns: [
    { id: 'long_source', key: '来源域', type: 'enum', options: ['长期候选审核', '成长沉淀'] },
    { id: 'long_category', key: '分类', type: 'text' },
    { id: 'long_content', key: '内容', type: 'longtext' },
    { id: 'long_conf', key: '原置信度', type: 'number' },
    { id: 'long_confirmed', key: '确认状态', type: 'text' },
    { id: 'long_exception', key: '例外或适用场景', type: 'longtext' },
    { id: 'long_origin', key: '原始记录ID', type: 'text' }
  ]
};
const stateTable = { id: 'state_table', name: '近期状态与经历', mode: 'rows', memoryLayer: 'short', columns: [{ id: 'content', key: '内容', type: 'longtext' }] };
const template = { id: 'tpl', name: '分层记忆', tables: [reviewTable, stateTable, longTable] };
const candidate = { id: 'candidate-1', cells: { candidate_status: '待审核', candidate_content: '用户在身体不适时会主动表达需求。', candidate_type: '成长经验', candidate_conf: 88, candidate_evidence: '多次明确表达', candidate_exception: '' }, meta: { createdAt: 10 } };
const uncertain = { id: 'uncertain-1', cells: { content: '最近睡眠不足，需要降低工作强度。' }, meta: { tagBundle: { topic: ['睡眠'], scene: ['健康追踪'], entity: ['用户'], effect: 'temporary_state' }, lifecycle: { status: 'uncertain', reviewAt: Date.now() - 10, expiresAt: 0 }, evidence: {}, relations: { supersedes: [], supersededBy: [], conflictsWith: [], relatedTo: [] } } };
const conflict = { id: 'conflict-1', cells: { content: '偏好在争执后立刻沟通。' }, meta: { tagBundle: { topic: ['沟通'], scene: ['关系讨论'], entity: ['用户'], effect: 'soft_preference' }, lifecycle: { status: 'conflicting', reviewAt: 0, expiresAt: 0 }, evidence: {}, relations: { supersedes: [], supersededBy: [], conflictsWith: ['other'], relatedTo: [] } } };
const active = { id: 'active-1', cells: { content: '喜欢清晰直接的反馈。' }, meta: { pinned: true, tagBundle: { topic: ['表达'], scene: ['沟通'], entity: ['用户'], effect: 'fact' }, lifecycle: { status: 'active', reviewAt: 0, expiresAt: 0 }, evidence: {}, relations: { supersedes: [], supersededBy: [], conflictsWith: [], relatedTo: [] } } };
const archived = { id: 'archived-1', cells: { content: '旧的临时状态。' }, meta: { tagBundle: { topic: ['旧状态'], scene: [], entity: [], effect: 'temporary_state' }, lifecycle: { status: 'archived', reviewAt: 0, expiresAt: 0 }, evidence: {}, relations: { supersedes: [], supersededBy: [], conflictsWith: [], relatedTo: [] } } };
const chat = { id: 'chat', memoryTables: { data: { tpl: { candidate_table: { __rows: [candidate] }, state_table: { __rows: [uncertain, conflict, active, archived] }, long_table: { __rows: [] } } }, history: [] } };

const domain = {
  isRowsTable: table => table?.mode === 'rows',
  getRows: (chatArg, templateId, table) => chatArg.memoryTables.data[templateId][table.id].__rows,
  getFieldDisplayValue: (field, value) => value == null ? '' : Array.isArray(value) ? value.join('、') : String(value),
  getRowSearchText: (table, row) => table.columns.map(field => `${field.key}: ${row.cells?.[field.id] ?? ''}`).join(' '),
  normalizeFieldValue: (field, value) => field.type === 'number' ? Number(value) : value,
  isSameMemoryValue: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  addRow(chatArg, templateId, table, values, options = {}) {
    const row = { id: `added-${++seq}`, cells: {}, meta: { createdAt: Date.now(), evidence: { userConfirmed: !!options.userConfirmed }, relations: { supersedes: [], supersededBy: [], conflictsWith: [], relatedTo: [] }, lifecycle: { status: 'active', reviewAt: 0, expiresAt: 0 } } };
    table.columns.forEach(field => { row.cells[field.id] = values[field.id] ?? ''; });
    this.getRows(chatArg, templateId, table).push(row);
    return row;
  },
  pushMemoryHistory(chatArg, changedFields, options = {}) { chatArg.memoryTables.history.push({ changedFields, source: options.source, snapshot: options.snapshot }); }
};
const lifecycle = {
  ensureRowMeta(row) {
    row.meta ||= {};
    row.meta.evidence ||= {};
    row.meta.lifecycle ||= { status: 'active', reviewAt: 0, expiresAt: 0 };
    row.meta.relations ||= { supersedes: [], supersededBy: [], conflictsWith: [], relatedTo: [] };
    return row.meta;
  },
  textForRow(table, row) { return domain.getRowSearchText(table, row); },
  setStatus(row, status, reason) { const meta = this.ensureRowMeta(row); meta.lifecycle.status = status; meta.lifecycle.statusReason = reason; row.meta.status = status; if (status === 'archived') meta.lifecycle.archivedAt = Date.now(); return true; },
  recordSource(row, source, ref, options) { const meta = this.ensureRowMeta(row); meta.evidence.primarySource = source; meta.evidence.userConfirmed = !!options?.userConfirmed; meta.evidence.sourceRefs = [ref]; }
};
Kernel.register('domain', domain);
Kernel.register('policy', { normalizeTablePolicy: table => ({ memoryLayer: table.memoryLayer || 'long' }), clearRetrievalCache() {} });
Kernel.register('lifecycle', lifecycle);
Kernel.register('review', { getPendingBatches: () => [{ id: 'batch-1', tableName: '当前状态', proposals: [{ risk: 'high' }, { risk: 'low' }], sourceMessageCount: 12, relatedContext: { rowCount: 6 }, createdAt: 20 }], setActiveBatch() {} });
Kernel.register('tasks', { getCounts: () => ({ failed: 1, queued: 2, paused: 0 }) });
Kernel.register('sidecar', { ensureState: () => ({ candidates: [{ status: 'pending' }] }) });
Kernel.register('feedback', { getPendingCount: () => 1 });

for (const rel of [
  'js/features/memory/candidate_service.js',
  'js/features/memory/table_filter.js',
  'js/features/memory/governance_queue.js',
  'js/features/memory/governance_controller.js'
]) vm.runInContext(read(rel), context);

const candidates = Kernel.get('candidateService');
const filters = Kernel.get('tableFilter');
const queue = Kernel.get('governanceQueue');
const governance = Kernel.get('governanceController');
assert.strictEqual(candidates.VERSION, '2.11-R4');
assert.strictEqual(filters.VERSION, '2.11-R4');
assert.strictEqual(queue.VERSION, '2.11-R4');
assert.strictEqual(governance.VERSION, '2.11-R4');

const items = queue.scan(chat, [template]);
const counts = queue.countByCategory(items);
assert.strictEqual(counts.review, 1);
assert.strictEqual(counts.candidate, 1);
assert.strictEqual(counts.reliability, 2);
assert.strictEqual(counts.system, 3);
assert.strictEqual(items[0].priority, 'high');
const home = queue.renderHome(chat, [template]);
assert(home.includes('memory-governance-list'));
assert(home.includes('统一排序'));
assert(!home.includes('memory-workbench-card-grid'));
assert(!items.find(item => item.rowId === 'conflict-1').selectable, 'conflicts must not be bulk-confirmed');

assert.deepStrictEqual(Array.from(filters.apply([uncertain, conflict, active, archived], stateTable, { filter: 'attention' })).map(row => row.id), ['uncertain-1', 'conflict-1']);
assert.deepStrictEqual(Array.from(filters.apply([uncertain, conflict, active, archived], stateTable, { filter: 'pinned' })).map(row => row.id), ['active-1']);
assert.deepStrictEqual(Array.from(filters.apply([uncertain, conflict, active, archived], stateTable, { filter: 'all', tagQuery: '睡眠' })).map(row => row.id), ['uncertain-1']);
const toolbar = filters.renderToolbar([uncertain, conflict, active, archived], stateTable, { filter: 'attention', tagQuery: '' });
assert(toolbar.includes('memory-table-filterbar') && toolbar.includes('待复核'));

const candidateItem = items.find(item => item.kind === 'candidate');
const approved = candidates.approve(chat, candidateItem, candidateItem.row);
assert(approved.changed && !approved.duplicate);
assert.strictEqual(domain.getRows(chat, 'tpl', longTable).length, 1);
assert.strictEqual(candidate.cells.candidate_status, '已批准');
assert.strictEqual(domain.getRows(chat, 'tpl', longTable)[0].cells.long_content, '用户在身体不适时会主动表达需求。');
assert(chat.memoryTables.history.length > 0);

const uncertainItem = queue.scan(chat, [template]).find(item => item.rowId === 'uncertain-1');
assert(governance.confirmItem(chat, uncertainItem));
assert.strictEqual(uncertain.meta.lifecycle.status, 'active');
assert.strictEqual(uncertain.meta.evidence.userConfirmed, true);
const conflictItem = queue.scan(chat, [template]).find(item => item.rowId === 'conflict-1');
assert(governance.snoozeItem(chat, conflictItem, 30));
assert(conflict.meta.lifecycle.reviewAt > Date.now());
assert(governance.archiveItem(chat, conflictItem));
assert.strictEqual(conflict.meta.lifecycle.status, 'archived');

console.log('V2.11-R4 MEMORY GOVERNANCE + TABLE FILTER CHECKS: PASS');
