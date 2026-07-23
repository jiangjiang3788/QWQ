const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const html = read('index.html');
const controller = read('js/modules/memory_table.js');
const css = read('css/modules/memory_table_flat.css');
const viewSource = read('js/features/memory/table_view.js');

assert(['2.11-R0', '2.11-R1', '2.11-R2', '2.11-R3.1', '2.11-R4', '2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2'].includes(read('VERSION.txt').trim()));
assert(html.includes('css/modules/memory_table_flat.css'));
assert(html.includes('js/features/memory/table_view.js'));
assert(html.indexOf('js/features/memory/table_view.js') < html.indexOf('js/modules/memory_table.js'));
assert(html.includes('memory-flat-settings-backdrop'));
assert(html.includes('data-action="toggle-memory-settings"'));

assert(read('js/features/memory/table_grid.js').includes("Kernel.require('tableView')"));
assert(controller.includes('editingRowId'));
assert(controller.includes('editingFieldPath'));
assert(controller.includes('MemoryTableInteraction.handleAction'));
assert(read('js/features/memory/table_interaction.js').includes('TableSession.setEditingRow'));
assert(read('js/features/memory/table_interaction.js').includes('TableSession.finishEditing'));
assert(read('js/features/memory/table_workspace.js').includes('TableGrid.render') && read('js/features/memory/table_grid.js').includes('TableView.renderValue'));
assert(!controller.includes('function renderKeyValueFieldCard'));
assert(!controller.includes('function renderRowsTableCard'));
assert(!controller.includes('function drawAllCharts'));
assert(!controller.includes('memory-field-card'));
assert(controller.split(/\r?\n/).length < 4650, 'memory_table.js did not shrink below the first-stage budget');

assert(css.includes('.memory-v2-workspace{grid-template-columns:210px'));
assert(css.includes('.memory-workbench-settings{position:fixed'));
assert(css.includes('.memory-flat-row-command'));
assert(css.includes('max-height:calc(100vh - 270px)'));
assert(css.includes('@media(max-width:820px)'));

const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(read('js/features/memory/kernel.js'), context);
vm.runInContext(viewSource, context);
const view = context.window.OvoMemoryKernel.get('tableView');
assert(view);
assert(['2.11-R0', '2.11-R1', '2.11-R2', '2.11-R3.1', '2.11-R4', '2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2'].includes(view.VERSION));
assert(view.renderValue({ type: 'text' }, '<危险>').includes('&lt;危险&gt;'));
assert(view.renderValue({ type: 'tags' }, ['睡眠', '边界']).includes('memory-flat-tag-list'));
const command = view.renderRowCommand({ templateId: 't', tableId: 'tb', rowId: 'r', editing: false });
assert.strictEqual((command.match(/<select/g) || []).length, 0);
assert(command.includes('open-row-command-menu'));
assert(command.includes('aria-haspopup=\"menu\"'));

console.log('V2.11-R0 MEMORY FLAT TABLE CHECKS: PASS');
