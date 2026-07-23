const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2'].includes(read('VERSION.txt').trim()));
const html = read('index.html');
const controller = read('js/modules/memory_table.js');
const gridSource = read('js/features/memory/table_grid.js');
const interactionSource = read('js/features/memory/table_interaction.js');
const workspaceSource = read('js/features/memory/table_workspace.js');
const css = read('css/modules/memory_table_flat.css');

const ordered = [
  'table_viewport.js', 'table_session.js', 'row_command_menu.js', 'table_interaction.js',
  'table_view.js', 'table_presenter.js', 'table_reconciler.js', 'table_grid.js', 'table_workspace.js'
];
ordered.forEach(file => assert(html.includes(`js/features/memory/${file}`), `missing ${file}`));
for (let i = 1; i < ordered.length; i++) {
  assert(html.indexOf(ordered[i - 1]) < html.indexOf(ordered[i]), `wrong load order: ${ordered[i - 1]} -> ${ordered[i]}`);
}
assert(html.indexOf('table_workspace.js') < html.indexOf('js/modules/memory_table.js'));
assert(controller.includes("Kernel.require('memoryTablesDomain')"));
assert(!controller.includes("Kernel.require('tableSession')"));
assert(!controller.includes("Kernel.require('tableWorkspace')"));
assert(controller.includes('function refreshActiveMemoryTable(options = {})'));
assert(controller.includes('MemoryTableGrid.refresh(root, config, options)'));
assert(controller.includes('MemoryTableEditController.handleFieldInput'));
assert(gridSource.includes('commitInput'));
assert(!controller.includes('function getActiveTableDescriptor('), 'active table resolution must leave the main controller');
assert(!controller.includes('function renderV2PolicySummary('), 'policy UI must leave the main controller');
assert(interactionSource.includes("typeof context.refreshGrid === 'function'"));
assert(interactionSource.includes('TableSession.setEditingRow'));
assert(gridSource.includes('TableReconciler.replace'));
assert(gridSource.includes('metrics.tableRefreshes'));
assert(workspaceSource.includes('data-memory-table-grid'));
assert(css.includes('.memory-table-save-status'));
assert(controller.split(/\r?\n/).length < 4350, 'main controller grew beyond R6 budget');

const inputStart = controller.indexOf('async function handleFieldInputChange');
const inputEnd = controller.indexOf('\n    function bindMemoryWorkspaceNavigation', inputStart);
const inputHandler = controller.slice(inputStart, inputEnd);
assert(inputHandler.includes('MemoryTableEditController.handleFieldInput'));
assert(!inputHandler.includes('saveCharacter(chat.id)')); // persistence moved into table editor
assert(!inputHandler.includes('renderMemoryTableScreen()'), 'field commit must not rebuild the entire memory screen');

const context = { window: {}, console, Date, JSON, Math, Set, Map };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(read('js/features/memory/kernel.js'), context);
vm.runInContext(read('js/features/memory/table_session.js'), context);
const session = context.window.OvoMemoryKernel.get('tableSession');
assert(['2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2'].includes(session.VERSION));
const state = {};
session.ensure(state);
session.setEditingRow(state, 'row-1');
assert.strictEqual(state.editingRowId, 'row-1');
assert.strictEqual(state.editingFieldPath, null);
session.setEditingField(state, 'tpl::table::field');
assert.strictEqual(state.editingRowId, null);
assert.strictEqual(state.editingFieldPath, 'tpl::table::field');
session.selectTable(state, 'table-2');
assert.strictEqual(state.activeTableId, 'table-2');
assert.strictEqual(state.editingFieldPath, null);

const K = context.window.OvoMemoryKernel;
K.register('domain', {
  getRows: chat => chat.rows,
  getFieldDisplayValue: (_field, value) => String(value ?? ''),
  getFieldValue: () => ''
});
K.register('tableFilter', {
  apply: rows => rows,
  normalizeTagQuery: value => String(value || '').trim()
});
vm.runInContext(read('js/features/memory/table_viewport.js'), context);
vm.runInContext(read('js/features/memory/table_cache.js'), context);
vm.runInContext(read('js/features/memory/table_grouping.js'), context);
vm.runInContext(read('js/features/memory/table_view.js'), context);
vm.runInContext(read('js/features/memory/table_presenter.js'), context);
const presenter = K.get('tablePresenter');
assert(['2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2'].includes(presenter.VERSION));
const rows = Array.from({ length: 179 }, (_, i) => ({ id: `row-${i}`, cells: { field: `value-${i}` } }));
const model = presenter.rowsModel({
  chat: { id: 'chat', rows },
  template: { id: 'tpl', name: '模板' },
  table: { id: 'table', name: '长期表', columns: [{ id: 'field', key: '内容' }] },
  state: { viewMode: 'normal', rowFilter: 'all', rowTagFilter: '', search: '', editingRowId: null },
  helpers: {
    getVisibleColumnsForMode: table => table.columns,
    matchesSearch: () => true,
    getTableRuntimePolicy: () => ({ memoryLayer: 'long' })
  }
});
assert.strictEqual(model.rows.length, 179);
assert.strictEqual(model.range.enabled, true);
assert(model.range.renderedCount < 25);

console.log('V2.11-R6 INCREMENTAL TABLE + STATE CONVERGENCE CHECKS: PASS');
