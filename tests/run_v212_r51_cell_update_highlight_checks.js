const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.12-R5.1', '2.12-R5.2', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2'].includes(read('VERSION.txt').trim()));
const html = read('index.html');
const activitySource = read('js/features/memory/update_activity.js');
const gridSource = read('js/features/memory/table_grid.js');
const css = read('css/modules/memory_table_flat.css');

assert(html.indexOf('update_activity.js') < html.indexOf('table_grid.js'), 'update activity must load before table grid');
assert(activitySource.includes('function latestCellPaths(chat)'));
assert(activitySource.includes('function isCellUpdated'));
assert(activitySource.includes('function cellAttributes'));
assert(activitySource.includes('本次更新了 ${records} 条记忆，已标出具体单元格'));
assert(gridSource.includes("updated ? 'memory-cell-updated' : ''"));
assert(gridSource.includes("'__tags__'"));
assert(gridSource.includes('UpdateActivity.cellAttributes'));
assert(css.includes('td.memory-cell-updated'));
assert(css.includes('box-shadow:inset 0 0 0 2px #25a55f'));

const context = { window: {}, console, Date, JSON, Math, Set, Map, WeakMap, Promise, setTimeout, clearTimeout };
context.window.window = context.window;
context.window.setTimeout = setTimeout;
context.window.clearTimeout = clearTimeout;
vm.createContext(context);
vm.runInContext(read('js/features/memory/kernel.js'), context, { filename: 'kernel.js' });
vm.runInContext(activitySource, context, { filename: 'update_activity.js' });
const activity = context.window.OvoMemoryKernel.get('updateActivity');
const chat = { memoryTables: { history: [{
  id: 'latest', timestamp: 100, source: 'review', changedFields: [
    { templateId: 'tpl', tableId: 'kv', fieldId: 'name' },
    { templateId: 'tpl', tableId: 'rows', rowId: 'r1', fieldId: 'title' },
    { templateId: 'tpl', tableId: 'rows', rowId: 'r1', fieldId: '__tags__' },
    { templateId: 'tpl', tableId: 'rows', rowId: 'r1', fieldId: 'title' }
  ]
}] } };
assert.strictEqual(activity.isCellUpdated(chat, 'tpl', 'kv', 'name'), true);
assert.strictEqual(activity.isCellUpdated(chat, 'tpl', 'rows', 'title', 'r1'), true);
assert.strictEqual(activity.isCellUpdated(chat, 'tpl', 'rows', '__tags__', 'r1'), true);
assert.strictEqual(activity.isCellUpdated(chat, 'tpl', 'rows', 'body', 'r1'), false);
assert(activity.cellAttributes(chat, 'tpl', 'rows', 'title', 'r1').includes('data-memory-cell-updated="true"'));
assert.strictEqual(activity.tableCellCount(chat, 'rows'), 2, 'duplicate changes should count as one highlighted cell');
assert(activity.banner(chat, { id: 'rows' }, []).includes('2 个单元格'));

console.log('V2.12-R5.1 CELL UPDATE HIGHLIGHT CHECKS: PASS');
