const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3'].includes(read('VERSION.txt').trim()));
const html = read('index.html');
const fieldWidth = read('js/features/memory/field_width.js');
const schema = read('js/features/memory/schema_editor.js');
const schemaCss = read('css/modules/memory_schema_editor.css');
const tableView = read('js/features/memory/table_view.js');
const tableGrid = read('js/features/memory/table_grid.js');
const tableEditor = read('js/features/memory/table_editor.js');
const tableEditController = read('js/features/memory/table_edit_controller.js');
const workspace = read('js/features/memory/table_workspace.js');
const feedbackSource = read('js/modules/memory_table_feedback.js');
const retrievalAudit = read('js/features/memory/retrieval_audit.js');
const governanceQueue = read('js/features/memory/governance_queue.js');
const chatOps = read('js/modules/chat_ops.js');
const chatJs = read('js/chat.js');
const controller = read('js/modules/memory_table.js');

// Script dependency order: sort depends on tableView.
assert(html.indexOf('table_view.js') < html.indexOf('table_sort.js'));
assert(html.indexOf('table_sort.js') < html.indexOf('table_presenter.js'));
assert(html.indexOf('update_activity.js') < html.indexOf('table_workspace.js'));

// Schema field-name column is content-sized with compact desktop/mobile caps.
assert(schema.includes('schema-col-name'));
assert(schema.includes('<colgroup>'));
assert(schemaCss.includes('.schema-col-name'));
assert(schemaCss.includes('var(--schema-field-name-width,88px)'));
assert(schemaCss.includes('var(--schema-field-name-width-mobile,64px)'));
assert(schema.includes('fieldNameColumnWidth(table)'));
assert(fieldWidth.includes('max: 112'));
assert(fieldWidth.includes('max: 74'));
assert(schemaCss.includes('table-layout:fixed'));

// Tags are editable in the same row editing flow.
assert(tableView.includes('function renderTagEditor(row)'));
assert(tableView.includes('data-tag-dimension="${dimension}"'));
assert(tableView.includes("input('topic', '主题'"));
assert(tableView.includes('data-tag-dimension="effect"'));
assert(tableGrid.includes('TableView.renderTagEditor(row)'));
assert(tableEditor.includes('async function commitTagDimension'));
assert(tableEditor.includes("fieldId: '__tags__'"));
assert(tableEditController.includes('handleTagInput'));

// Multi-level sorting and special tag dimensions exist.
assert(html.includes('js/features/memory/table_sort.js'));
assert(read('js/features/memory/table_sort.js').includes('const MAX_LEVELS = 3'));
assert(read('js/features/memory/table_sort.js').includes("['__topic__', '主题标签']"));
assert(read('js/features/memory/table_sort.js').includes('data-memory-sort-field'));

// Chat range helpers are visible and bound.
assert(html.includes('id="select-first-message-btn"'));
assert(html.includes('id="select-to-message-btn"'));
assert(chatOps.includes('function selectFirstMessageForRange()'));
assert(chatOps.includes('function selectMessagesToHere()'));
assert(chatOps.includes('order.slice(from, to + 1)'));
assert(chatJs.includes("getElementById('select-first-message-btn')"));
assert(chatJs.includes("getElementById('select-to-message-btn')"));

// All pending feedback can be cleared from both audit and governance surfaces.
assert(feedbackSource.includes('function clearPendingTasks(chat)'));
assert(retrievalAudit.includes('清空全部待反馈'));
assert(governanceQueue.includes('清空待反馈'));
assert(controller.includes("feedbackAction === 'clear-pending-tasks'"));

// Latest updated tables and history are directly visible.
assert(html.includes('js/features/memory/update_activity.js'));
assert(workspace.includes('recently-updated'));
assert(workspace.includes('本次更新'));
assert(workspace.includes('UpdateActivity.banner'));
assert(controller.includes("action === 'open-memory-update-history'"));
assert(controller.includes('memory-history-table'));

function makeContext() {
  const c = { window: {}, console, Date, JSON, Math, Set, Map, Promise, setTimeout, clearTimeout };
  c.window.window = c.window;
  c.window.setTimeout = setTimeout;
  c.window.clearTimeout = clearTimeout;
  c.window.document = { querySelectorAll: () => [] };
  vm.createContext(c);
  vm.runInContext(read('js/features/memory/kernel.js'), c, { filename: 'kernel.js' });
  return c;
}

// Sort by a normal field, then topic tag, preserving stable order.
{
  const c = makeContext();
  vm.runInContext(tableView, c, { filename: 'table_view.js' });
  c.window.OvoMemoryKernel.register('domain', {});
  vm.runInContext(read('js/features/memory/table_sort.js'), c, { filename: 'table_sort.js' });
  const sort = c.window.OvoMemoryKernel.get('tableSort');
  const table = { columns: [{ id: 'priority', key: '优先级', type: 'number' }, { id: 'title', key: '标题', type: 'text' }] };
  const rows = [
    { id: 'r1', cells: { priority: 2, title: '乙' }, meta: { tagBundle: { topic: ['健康'] } } },
    { id: 'r2', cells: { priority: 1, title: '甲' }, meta: { tagBundle: { topic: ['工作'] } } },
    { id: 'r3', cells: { priority: 2, title: '甲' }, meta: { tagBundle: { topic: ['成长'] } } }
  ];
  assert.deepStrictEqual(Array.from(sort.apply(rows, table, [{ fieldId: 'priority', direction: 'desc' }, { fieldId: 'title', direction: 'asc' }]), row => row.id), ['r3', 'r1', 'r2']);
  assert.deepStrictEqual(Array.from(sort.apply(rows, table, [{ fieldId: '__topic__', direction: 'asc' }]), row => row.id), ['r3', 'r2', 'r1']);
  assert.strictEqual(sort.normalize([
    { fieldId: 'priority' }, { fieldId: 'title' }, { fieldId: '__topic__' }, { fieldId: '__scene__' }
  ], table).length, 3);
}

// Pending feedback removal preserves fully reviewed rounds and effects/events unrelated to removed rounds.
{
  const c = makeContext();
  vm.runInContext(feedbackSource, c, { filename: 'memory_table_feedback.js' });
  const feedback = c.window.OvoMemoryKernel.get('feedback');
  const now = Date.now();
  const chat = { memoryTables: { feedback: {
    settings: { pendingFeedbackTtlDays: 7 },
    stats: { helpful: 2 },
    rounds: [
      { id: 'pending-round', createdAt: now, status: 'open', requestStatus: 'completed', items: [{ id: 'p1', feedback: 'pending' }, { id: 'h1', feedback: 'helpful' }] },
      { id: 'reviewed-round', createdAt: now, status: 'reviewed', requestStatus: 'completed', items: [{ id: 'h2', feedback: 'helpful' }] }
    ],
    events: [{ snapshotId: 'pending-round' }, { snapshotId: 'reviewed-round' }]
  } } };
  assert.strictEqual(feedback.getPendingCount(chat), 1);
  const result = feedback.clearPendingTasks(chat);
  assert.deepStrictEqual({ rounds: result.rounds, items: result.items }, { rounds: 1, items: 1 });
  assert.deepStrictEqual(Array.from(chat.memoryTables.feedback.rounds, item => item.id), ['reviewed-round']);
  assert.deepStrictEqual(Array.from(chat.memoryTables.feedback.events, item => item.snapshotId), ['reviewed-round']);
  assert.strictEqual(chat.memoryTables.feedback.stats.helpful, 2);
}

// Update activity groups the latest changes by table and exposes table history.
{
  const c = makeContext();
  vm.runInContext(read('js/features/memory/update_activity.js'), c, { filename: 'update_activity.js' });
  const activity = c.window.OvoMemoryKernel.get('updateActivity');
  const chat = { memoryTables: { history: [
    { id: 'new', timestamp: 200, source: 'review', changedFields: [{ tableId: 't1' }, { tableId: 't1' }, { tableId: 't2' }] },
    { id: 'old', timestamp: 100, source: 'manual', changedFields: [{ tableId: 't2' }] }
  ] } };
  assert.strictEqual(activity.latest(chat).entry.id, 'new');
  assert.strictEqual(activity.latest(chat).counts.get('t1'), 2);
  assert.deepStrictEqual(Array.from(activity.forTable(chat, 't2'), item => item.id), ['new', 'old']);
  const summary = activity.tableSummary(chat.memoryTables.history[0], [{ tables: [{ id: 't1', name: '当前状态' }, { id: 't2', name: '待办' }] }]);
  assert.deepStrictEqual(Array.from(summary, item => `${item.tableName}:${item.count}`), ['当前状态:2', '待办:1']);
  assert(activity.banner(chat, { id: 't1' }, []).includes('本次更新了这张表'));
}

console.log('V2.12-R5 MEMORY USABILITY REVISION CHECKS: PASS');
