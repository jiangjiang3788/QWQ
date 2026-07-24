const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.13-R5.1', '2.13-R5.2', '2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6'].includes(read('VERSION.txt').trim()));
const html = read('index.html');
const css = read('css/modules/memory_table_flat.css');
const modalSource = read('js/features/memory/row_edit_modal.js');
const controllerSource = read('js/features/memory/row_edit_controller.js');
const activitySource = read('js/features/memory/update_activity.js');
const workspaceSource = read('js/features/memory/table_workspace.js');
const memoryTableSource = read('js/modules/memory_table.js');

assert(html.includes('memory-row-edit-overlay'));
assert(html.includes('全屏 KV 编辑'));
assert(css.includes('width:100vw!important'));
assert(css.includes('height:100dvh!important'));
assert(css.includes('grid-template-columns:minmax(220px,28%) minmax(0,1fr)'));
assert(css.includes('.memory-row-edit-key'));
assert(css.includes('.memory-row-edit-value'));
assert(modalSource.includes('memory-row-edit-kv-head'));
assert(modalSource.includes('<strong>字段</strong><strong>值</strong>'));
assert(modalSource.includes('data-row-edit-autogrow="true"'));
assert(controllerSource.includes('function resizeTextarea'));
assert(controllerSource.includes("modal.addEventListener('input'"));
assert(workspaceSource.includes('本次更新 ${changedCount} 条'));
assert(memoryTableSource.includes('${changedRecordCount} 条记忆 · ${changes.length} 个字段'));

const context = { window: {}, console, Date, JSON, Math, Set, Map, WeakMap, Promise, setTimeout, clearTimeout };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(read('js/features/memory/kernel.js'), context, { filename: 'kernel.js' });
vm.runInContext(activitySource, context, { filename: 'update_activity.js' });
const activity = context.window.OvoMemoryKernel.get('updateActivity');
assert.strictEqual(activity.VERSION, '2.13-R5.1', '2.13-R5.2');

const fourteenFields = Array.from({ length: 14 }, (_, index) => ({
  templateId: 'tpl', tableId: 'rows', rowId: 'row-1', fieldId: `field-${index + 1}`
}));
const chat = { memoryTables: { history: [{ id: 'latest', timestamp: 100, source: 'review', changedFields: fourteenFields }] } };
assert.strictEqual(activity.recordCount(fourteenFields), 1, '14 cells in one row must count as one record');
assert.strictEqual(activity.tableRecordCount(chat, 'rows'), 1);
assert.strictEqual(activity.tableCellCount(chat, 'rows'), 14);
assert(activity.badge(chat, 'rows').includes('本次更新 1 条'));
assert(activity.banner(chat, { id: 'rows' }, []).includes('本次更新了 1 条记忆'));
assert(activity.banner(chat, { id: 'rows' }, []).includes('14 个单元格'));
const summary = activity.tableSummary(chat.memoryTables.history[0], [{ id: 'tpl', tables: [{ id: 'rows', name: '近期经历' }] }]);
assert.strictEqual(summary[0].count, 1);
assert.strictEqual(summary[0].fieldCount, 14);

const twoRows = [...fourteenFields, { templateId: 'tpl', tableId: 'rows', rowId: 'row-2', fieldId: 'title' }];
assert.strictEqual(activity.recordCount(twoRows), 2);
const kvChanges = Array.from({ length: 8 }, (_, index) => ({ templateId: 'tpl', tableId: 'kv', fieldId: `kv-${index}` }));
assert.strictEqual(activity.recordCount(kvChanges), 1, 'one KV table update is one record');

// Render full-screen KV-form content and verify long text is not truncated in markup.
const K = context.window.OvoMemoryKernel;
K.register('domain', {
  normalizeFieldType: type => type || 'text',
  isFieldLocked: () => false,
  getRows: () => [{ id: 'row-1', cells: {} }],
  getFieldValue: () => ''
});
vm.runInContext(modalSource, context, { filename: 'row_edit_modal.js' });
const modal = K.get('rowEditModal');
const longText = '完整文本'.repeat(220) + '\n第二段也必须完整显示。';
const table = { id: 'rows', name: '近期经历', columns: [
  { id: 'title', key: '标题', type: 'text', group: '主要信息' },
  { id: 'content', key: '内容', type: 'longtext', group: '主要信息', aiHint: '完整记录，不截断。' }
] };
const row = { id: 'row-1', cells: { title: '一条记忆', content: longText }, meta: { tagBundle: { topic: ['测试'], effect: 'fact' } } };
const rendered = modal.render({ chat: {}, template: { id: 'tpl', name: '记忆' }, table, row });
assert(rendered.html.includes('memory-row-edit-kv-table'));
assert(rendered.html.includes('memory-row-edit-key'));
assert(rendered.html.includes('memory-row-edit-value'));
assert(rendered.html.includes(longText));
assert(!rendered.html.includes('slice('));
assert(rendered.html.includes('data-row-edit-tag="topic"'));

console.log('V2.13-R5.1 FULLSCREEN KV EDITOR + RECORD COUNT CHECKS: PASS');
