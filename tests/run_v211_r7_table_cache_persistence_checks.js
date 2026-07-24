const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2', '2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6'].includes(read('VERSION.txt').trim()));
const html = read('index.html');
const controller = read('js/modules/memory_table.js');
const presenterSource = read('js/features/memory/table_presenter.js');
const persistenceSource = read('js/features/memory/table_persistence.js');
const editorSource = read('js/features/memory/table_editor.js');
const editControllerSource = read('js/features/memory/table_edit_controller.js');
const workspaceSource = read('js/features/memory/table_workspace.js');
const css = read('css/modules/memory_table_flat.css');

const ordered = [
  'table_viewport.js', 'table_session.js', 'table_cache.js', 'table_persistence.js',
  'row_command_menu.js', 'table_interaction.js', 'table_view.js', 'table_presenter.js',
  'table_reconciler.js', 'table_grid.js', 'table_editor.js', 'table_edit_controller.js', 'table_workspace.js'
];
ordered.forEach(file => assert(html.includes(`js/features/memory/${file}`), `missing ${file}`));
for (let i = 1; i < ordered.length; i++) {
  assert(html.indexOf(ordered[i - 1]) < html.indexOf(ordered[i]), `wrong load order: ${ordered[i - 1]} -> ${ordered[i]}`);
}
assert(controller.includes("Kernel.require('memoryTablesDomain')"));
assert(!controller.includes("Kernel.require('tableCache')"));
assert(!controller.includes("Kernel.require('tableEditController')"));
assert(controller.includes("MemoryTableCache.touchChat(chat.id, 'full-screen-render')"));
assert(controller.includes('MemoryTableEditController.handleFieldInput'));
assert(controller.includes('MemoryTableEditController.handleAction'));
assert(!controller.includes('MemoryTableEditor.addRow'), 'row editing should leave main controller');
assert(!controller.includes('MemoryTableEditor.deleteRow'), 'row editing should leave main controller');
assert(controller.split(/\r?\n/).length < 4310, 'main controller grew beyond R7 budget');
assert(presenterSource.includes('TableCache.memo'));
assert(presenterSource.includes('TableCache.rowsStamp'));
assert(persistenceSource.includes('metrics.coalesced'));
assert(persistenceSource.includes("visibilitychange"));
assert(persistenceSource.includes("beforeunload"));
assert(persistenceSource.includes('flushAll'));
assert(persistenceSource.includes('hasPending'));
assert(editorSource.includes('undoLast'));
assert(editControllerSource.includes("'undo-table-edit'"));
assert(workspaceSource.includes('memory-table-undo-btn'));
assert(css.includes('.memory-table-undo-btn'));
assert(css.includes('.memory-table-save-status.is-saving'));

function createContext() {
  const listeners = {};
  const addListener = (type, callback) => {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(callback);
  };
  const context = {
    window: {}, console, Date, JSON, Math, Set, Map, Promise,
    setTimeout, clearTimeout,
    queueMicrotask,
    listeners
  };
  context.window.window = context.window;
  context.window.setTimeout = setTimeout;
  context.window.clearTimeout = clearTimeout;
  context.window.queueMicrotask = queueMicrotask;
  context.window.addEventListener = addListener;
  context.window.document = { querySelectorAll: () => [], visibilityState: 'visible', addEventListener: addListener };
  vm.createContext(context);
  vm.runInContext(read('js/features/memory/kernel.js'), context);
  return context;
}

(async () => {
  const cacheContext = createContext();
  vm.runInContext(read('js/features/memory/table_cache.js'), cacheContext);
  const cache = cacheContext.window.OvoMemoryKernel.get('tableCache');
  assert.strictEqual(cache.VERSION, '2.11-R7');
  const chat = { id: 'chat-1', memoryTables: { history: [] } };
  const rows = [{ id: 'r1', meta: { updatedAt: 1, tagBundle: { topic: ['睡眠'] } } }];
  const scope = cache.scopeKey(chat, 'tpl', 'table');
  const stamp1 = cache.rowsStamp(chat, 'tpl', { id: 'table' }, rows);
  let builds = 0;
  const first = cache.memo(scope, stamp1, () => ({ build: ++builds }));
  const second = cache.memo(scope, stamp1, () => ({ build: ++builds }));
  assert.strictEqual(first, second);
  assert.strictEqual(builds, 1);
  cache.touch(chat, 'tpl', 'table', 'test');
  const stamp2 = cache.rowsStamp(chat, 'tpl', { id: 'table' }, rows);
  assert.notStrictEqual(stamp1, stamp2);
  cache.memo(scope, stamp2, () => ({ build: ++builds }));
  assert.strictEqual(builds, 2);
  assert(cache.getMetrics().hits >= 1);
  assert(cache.getMetrics().invalidations >= 1);

  const persistenceContext = createContext();
  vm.runInContext(read('js/features/memory/table_persistence.js'), persistenceContext);
  const persistence = persistenceContext.window.OvoMemoryKernel.get('tablePersistence');
  assert.strictEqual(persistence.VERSION, '2.11-R7');
  let writes = 0;
  const writer = async id => { assert.strictEqual(id, 'character-1'); writes += 1; };
  await Promise.all([
    persistence.schedule('character-1', writer, { delay: 15, reason: 'a' }),
    persistence.schedule('character-1', writer, { delay: 15, reason: 'b' }),
    persistence.schedule('character-1', writer, { delay: 15, reason: 'c' })
  ]);
  assert.strictEqual(writes, 1, 'rapid writes should coalesce');
  assert.strictEqual(persistence.getMetrics().requests, 3);
  assert.strictEqual(persistence.getMetrics().writes, 1);
  assert.strictEqual(persistence.getMetrics().coalesced, 2);
  assert.strictEqual(persistence.hasPending(), false);
  const flushed = await persistence.flushAll();
  assert.strictEqual(Array.isArray(flushed), true);

  let hiddenWrites = 0;
  const hiddenSave = persistence.schedule('character-hidden', async () => { hiddenWrites += 1; }, { delay: 1000, reason: 'hidden' });
  assert.strictEqual(persistence.hasPending(), true);
  persistenceContext.window.document.visibilityState = 'hidden';
  (persistenceContext.listeners.visibilitychange || []).forEach(callback => callback());
  await hiddenSave;
  assert.strictEqual(hiddenWrites, 1, 'hidden pages should flush pending memory saves');

  let closeWrites = 0;
  const closeSave = persistence.schedule('character-close', async () => { closeWrites += 1; }, { delay: 1000, reason: 'close' });
  const unloadEvent = { defaultPrevented: false, returnValue: '', preventDefault() { this.defaultPrevented = true; } };
  (persistenceContext.listeners.beforeunload || []).forEach(callback => callback(unloadEvent));
  assert.strictEqual(unloadEvent.defaultPrevented, true, 'pending saves should guard page close');
  assert(unloadEvent.returnValue.includes('保存'));
  await persistence.flushAll();
  await closeSave;
  assert.strictEqual(closeWrites, 1);

  const editorContext = createContext();
  const K = editorContext.window.OvoMemoryKernel;
  K.register('domain', {
    isRowsTable: () => true,
    findRowById: (_chat, _templateId, _table, rowId) => editorContext.row.id === rowId ? editorContext.row : null,
    getFieldValue: () => '',
    setFieldValue: () => {},
    isSameMemoryValue: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    updateRowFieldValue: (_chat, _templateId, _table, _rowId, field, value) => { editorContext.row.cells[field.id] = String(value); return true; },
    addRow: () => ({ id: 'new-row' }),
    deleteRow: () => true,
    moveRow: () => true
  });
  vm.runInContext(read('js/features/memory/table_cache.js'), editorContext);
  vm.runInContext(read('js/features/memory/table_persistence.js'), editorContext);
  vm.runInContext(read('js/features/memory/write_coordinator.js'), editorContext);
  K.register('tableGrid', { commitInput: (_root, target, _field, value) => { target.value = value; } });
  K.register('tableReconciler', { markSaving: () => true, markSaved: () => true });
  editorContext.row = { id: 'row-1', cells: { field: 'before' } };
  vm.runInContext(read('js/features/memory/table_editor.js'), editorContext);
  const editor = K.get('tableEditor');
  assert(['2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6'].includes(editor.VERSION));
  let editorWrites = 0;
  const editorWriter = async () => { editorWrites += 1; };
  const table = { id: 'table', name: '长期表', columns: [{ id: 'field', key: '内容' }] };
  const template = { id: 'tpl', tables: [table] };
  const target = { value: 'after', type: 'text', dataset: {} };
  await editor.commitField({
    chat: { id: 'chat-e' }, template, table, field: table.columns[0], rowId: 'row-1',
    rawValue: 'after', writer: editorWriter, target, root: null, delay: 0
  });
  assert.strictEqual(editorContext.row.cells.field, 'after');
  assert.strictEqual(editor.canUndo({ id: 'chat-e' }), true);
  const undo = await editor.undoLast({ chat: { id: 'chat-e' }, templates: [template], writer: editorWriter, root: null });
  assert.strictEqual(undo.changed, true);
  assert.strictEqual(editorContext.row.cells.field, 'before');
  assert.strictEqual(editor.canUndo({ id: 'chat-e' }), false);
  assert.strictEqual(editorWrites, 2);

  console.log('V2.11-R7 TABLE CACHE + PERSISTENCE + UNDO CHECKS: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
