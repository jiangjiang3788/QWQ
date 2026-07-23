const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3'].includes(read('VERSION.txt').trim()));
const html = read('index.html');
const controller = read('js/modules/memory_table.js');
const gridSource = read('js/features/memory/table_grid.js');
const viewSource = read('js/features/memory/table_view.js');
const css = read('css/modules/memory_table_flat.css');

for (const file of ['table_viewport.js', 'row_command_menu.js', 'table_interaction.js', 'table_view.js', 'table_grid.js']) {
  assert(html.includes(`js/features/memory/${file}`), `missing ${file}`);
  assert(html.indexOf(`js/features/memory/${file}`) < html.indexOf('js/modules/memory_table.js'), `${file} must load before controller`);
}
assert(html.indexOf('table_viewport.js') < html.indexOf('table_grid.js'));
assert(html.indexOf('row_command_menu.js') < html.indexOf('table_view.js'));
assert(controller.includes('MemoryTableGrid.bind(content,'));
assert(controller.includes("Kernel.require('memoryTablesDomain')"));
assert(!controller.includes("Kernel.require('tableInteraction')"));
assert(!controller.includes("target.matches('[data-row-command]')"), 'old per-row select handler remains');
assert(gridSource.includes('rows.slice(range.start, range.end)'), 'grid must render only a window');
assert(gridSource.includes('requestAnimationFrame'), 'scroll patch must be throttled');
assert(gridSource.includes('memory-virtual-spacer'));
assert(css.includes('.memory-v2-rows-virtualized'));
assert(css.includes('.memory-row-command-popover'));
assert(controller.split(/\r?\n/).length < 4400, 'main controller grew beyond R5 budget');

const context = { window: {}, console, Date, JSON, Math, Set, Map };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(read('js/features/memory/kernel.js'), context);
vm.runInContext(read('js/features/memory/table_viewport.js'), context);
const viewport = context.window.OvoMemoryKernel.get('tableViewport');
assert(['2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3'].includes(viewport.VERSION));
assert.strictEqual(viewport.enabled({ rowCount: 79 }), false);
assert.strictEqual(viewport.enabled({ rowCount: 80 }), true);
const first = viewport.computeRange({ rowCount: 179, rowHeight: 88, viewportHeight: 528, scrollTop: 0, overscan: 5 });
assert.strictEqual(first.start, 0);
assert(first.end < 25, `too many initial rows: ${first.end}`);
assert.strictEqual(first.topHeight, 0);
assert(first.bottomHeight > 10000);
const middle = viewport.computeRange({ rowCount: 179, rowHeight: 88, viewportHeight: 528, scrollTop: 88 * 100, overscan: 5 });
assert(middle.start >= 94 && middle.start <= 100);
assert(middle.end < 120);
assert.strictEqual(middle.topHeight, middle.start * 88);
assert.strictEqual(middle.bottomHeight, (179 - middle.end) * 88);
const pinned = viewport.computeRange({ rowCount: 179, rowHeight: 88, viewportHeight: 528, scrollTop: 0, overscan: 5, activeIndex: 120 });
assert(pinned.start <= 120 && pinned.end > 120, 'active edit row must stay in the window');

vm.runInContext(viewSource, context);
const view = context.window.OvoMemoryKernel.get('tableView');
const command = view.renderRowCommand({ templateId: 'tpl', tableId: 'table', rowId: 'row', editing: false });
assert(command.includes('<button'));
assert(command.includes('open-row-command-menu'));
assert.strictEqual((command.match(/<option/g) || []).length, 0, 'row command options must be lazy');
const editing = view.renderRowCommand({ templateId: 'tpl', tableId: 'table', rowId: 'row', editing: true });
assert(!editing.includes('完成'));
assert(editing.includes('⋯'));

const menuSource = read('js/features/memory/row_command_menu.js');
assert(menuSource.includes('memory-row-command-popover'));
assert(menuSource.includes("['delete-row', '删除']"));
console.log('V2.11-R5 MEMORY VIRTUALIZATION + LAZY ROW COMMAND CHECKS: PASS');
