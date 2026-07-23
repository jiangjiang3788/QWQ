const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3'].includes(read('VERSION.txt').trim()));
const html = read('index.html');
const gridSource = read('js/features/memory/table_grid.js');
const gestureSource = read('js/features/memory/table_gesture.js');
const menuSource = read('js/features/memory/row_command_menu.js');
const workspaceSource = read('js/features/memory/table_workspace.js');
const css = read('css/modules/memory_table_flat.css');
const controller = read('js/modules/memory_table.js');

for (const file of ['table_grouping.js', 'table_gesture.js']) {
  assert(html.includes(`js/features/memory/${file}`), `missing ${file}`);
}
assert(html.indexOf('table_session.js') < html.indexOf('table_grouping.js'));
assert(html.indexOf('table_grouping.js') < html.indexOf('table_gesture.js'));
assert(html.indexOf('table_gesture.js') < html.indexOf('table_grid.js'));
assert(gridSource.includes('memory-field-group-heading'));
assert(gridSource.includes('memory-table-column-group'));
assert(gridSource.includes('memory-table-tags-head'));
assert(gridSource.includes('TableView.renderTagField(row)'));
assert(gridSource.includes('data-memory-edit-target'));
assert(gridSource.includes('TableReconciler.replace(root, render(config), bindVirtual, options)'));
assert(!gridSource.includes('target => bind(target, config.interactionContext)'));
assert(!gridSource.includes('memory-flat-field-action memory-v2-normal-only'));
assert(!menuSource.includes("['edit-row', '编辑此行']"));
assert(workspaceSource.includes('双击编辑'));
assert(workspaceSource.includes('手机双点'));
assert(!workspaceSource.includes('单击选中'));
assert(!workspaceSource.includes('Enter 编辑'));
assert(gestureSource.includes("root.addEventListener('dblclick'"));
assert(gestureSource.includes('DOUBLE_TAP_MS = 360'));
assert(!gestureSource.includes('LONG_PRESS_MS'));
assert(!gestureSource.includes("event.key !== 'Enter'"));
assert(gestureSource.includes("event.key === 'Escape'"));
assert(css.includes('.memory-field-group-heading'));
assert(css.includes('.memory-table-tags-head'));
assert(css.includes('--memory-kv-label-width'));
assert(css.includes('.memory-kv-label-col'));
assert(controller.split(/\r?\n/).length < 4310, 'main controller exceeded V2.12-R0 budget');

function context() {
  const c = { window: {}, console, Date, JSON, Math, Set, Map, Promise, setTimeout, clearTimeout };
  c.window.window = c.window;
  c.window.setTimeout = setTimeout;
  c.window.clearTimeout = clearTimeout;
  c.window.navigator = {};
  vm.createContext(c);
  vm.runInContext(read('js/features/memory/kernel.js'), c);
  return c;
}

const c = context();
const K = c.window.OvoMemoryKernel;
vm.runInContext(read('js/features/memory/table_session.js'), c);
vm.runInContext(read('js/features/memory/table_grouping.js'), c);
vm.runInContext(read('js/features/memory/table_gesture.js'), c);
vm.runInContext(read('js/features/memory/table_view.js'), c);

const grouping = K.get('tableGrouping');
const groups = grouping.groupColumns([
  { id: 'a', key: 'A', group: '核心' },
  { id: 'b', key: 'B', group: '补充' },
  { id: 'c', key: 'C', group: '核心' }
]);
assert.strictEqual(groups.length, 2);
assert.deepStrictEqual(Array.from(groups[0].fields, item => item.id), ['a', 'c']);
assert.strictEqual(grouping.fieldPath('tpl', 'tb', 'f'), 'tpl::tb::f');

const session = K.get('tableSession');
const state = {};
session.ensure(state);
session.focusRow(state, 'r1');
assert.strictEqual(state.focusedRowId, 'r1');
session.focusField(state, 'tpl::tb::f');
assert.strictEqual(state.focusedRowId, null);
assert.strictEqual(state.focusedFieldPath, 'tpl::tb::f');

const gesture = K.get('tableGesture');
const fieldTarget = { dataset: { memoryEditKind: 'field', templateId: 'tpl', tableId: 'tb', fieldId: 'f' } };
const fieldDescriptor = gesture.describe(fieldTarget);
assert.strictEqual(fieldDescriptor.fieldPath, 'tpl::tb::f');
gesture.select(state, fieldDescriptor);
gesture.beginOrFinishEdit(state, fieldDescriptor);
assert.strictEqual(state.editingFieldPath, 'tpl::tb::f');
gesture.beginOrFinishEdit(state, fieldDescriptor);
assert.strictEqual(state.editingFieldPath, null);

const view = K.get('tableView');
const row = { meta: { tagBundle: { topic: ['健康'], scene: ['日常聊天'], entity: ['用户'] }, tags: ['健康'] } };
assert.deepStrictEqual(Array.from(view.rowTags(row)), ['健康', '日常聊天', '用户']);
const tagHtml = view.renderTagField(row);
assert(tagHtml.includes('健康'));
assert(tagHtml.includes('memory-flat-tag-field'));

K.register('domain', {
  isRowsTable: table => table.mode === 'rows',
  getRows: chat => chat.rows || [],
  getFieldValue: (chat, _templateId, _tableId, field) => chat.values?.[field.id] || '',
  isFieldLocked: () => false,
  getFieldDisplayValue: (_field, value) => String(value ?? '')
});
K.register('tableFilter', {
  apply: rows => rows,
  renderToolbar: () => ''
});
vm.runInContext(read('js/features/memory/field_width.js'), c);
vm.runInContext(read('js/features/memory/table_viewport.js'), c);
vm.runInContext(read('js/features/memory/table_cache.js'), c);
vm.runInContext(read('js/features/memory/table_presenter.js'), c);
K.register('tableReconciler', {
  replace: () => true,
  markSaved: () => true,
  getStats: () => ({}),
  resetStats: () => {}
});
vm.runInContext(read('js/features/memory/table_grid.js'), c);
const grid = K.get('tableGrid');
const state2 = { viewMode: 'normal', rowFilter: 'all', rowTagFilter: '', search: '', editingRowId: null, editingFieldPath: null, focusedRowId: null, focusedFieldPath: null };
const helpers = {
  getVisibleColumnsForMode: table => table.columns,
  matchesSearch: () => true,
  renderFieldEditor: () => '<input class="memory-table-input">',
  getTableRuntimePolicy: () => ({ memoryLayer: 'long' })
};
const keyHtml = grid.render({
  chat: { id: 'chat-kv', values: { a: '甲', b: '乙' }, memoryTables: { data: {}, lockedFields: {}, history: [] } },
  template: { id: 'tpl', name: '模板' },
  table: { id: 'kv', name: '档案', mode: 'kv', columns: [{ id: 'a', key: '字段A', group: '核心' }, { id: 'b', key: '字段B', group: '补充' }] },
  state: state2,
  helpers
});
assert.strictEqual((keyHtml.match(/memory-field-group-heading/g) || []).length, 2);
assert(keyHtml.includes('双击编辑'));
assert(keyHtml.includes('data-memory-kv-label-width-mobile'));
assert(!keyHtml.includes('data-action="edit-field"'));

const rowsHtml = grid.render({
  chat: { id: 'chat-rows', rows: [{ id: 'r1', cells: { title: '事项', body: '内容' }, meta: row.meta }], memoryTables: { data: {}, lockedFields: {}, history: [] } },
  template: { id: 'tpl', name: '模板' },
  table: { id: 'rows', name: '待办', mode: 'rows', columns: [{ id: 'title', key: '标题', group: '主要信息' }, { id: 'body', key: '内容', group: '主要信息' }] },
  state: state2,
  helpers
});
assert(rowsHtml.includes('>标签</th>'));
assert(rowsHtml.includes('memory-table-column-group'));
assert(rowsHtml.includes('健康'));
assert(!rowsHtml.includes('编辑此行'));

console.log('V2.12-R0 MEMORY INTERACTION UNIFICATION CHECKS: PASS');
