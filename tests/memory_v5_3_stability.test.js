const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const sandbox = {
  console,
  setTimeout,
  clearTimeout() {},
  alert() {},
  confirm() { return true; },
  showToast() {},
  saveCharacter: async () => {},
  db: { characters: [] },
  document: { getElementById() { return null; } }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of [
  'js/features/memory_v3/memory_core_v3.js',
  'js/features/memory_v3/memory_rounds_v3.js',
  'js/features/memory_v3/memory_engine_v3.js'
]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}

const M = sandbox.MemoryV5;
assert.equal(M.VERSION, '5.4.1');
assert.equal(M.STORE_VERSION, 3, '原地升级不得改变STORE_VERSION');
assert.equal(M.model.defaultSettings().tablePageSize, 100);
assert.equal(M.model.normalizeStore({ settings: { tablePageSize: 9999 }, tables: [], records: {} }).settings.tablePageSize, 500);

const chat = { id: 'v53', history: [] };
sandbox.db.characters.push(chat);
const store = M.model.ensureStore(chat);
const write = M.engine.applyOperations(chat, [{
  tableId: 'v5_recent_events',
  action: 'add',
  values: { 分类: '工作', 标题: '保留记录', 内容: '导入空结构时不能被清空' }
}], { origin: 'manual' });
assert.equal(write.changed.length, 1);
assert.equal(store.records.v5_recent_events.length, 1);

// 导入同表结构但不勾选记录时，覆盖表结构必须保留原记录。
const sourceTable = JSON.parse(JSON.stringify(store.tables.find(table => table.id === 'v5_recent_events')));
sourceTable.description = '导入后的表结构说明';
const planWithoutRecords = M.model.importPlan({
  version: 3,
  tables: [sourceTable],
  records: { v5_recent_events: [] }
});
M.model.mergeImport(store, planWithoutRecords, { includeRecords: false, conflictMode: 'replace' });
assert.equal(store.records.v5_recent_events.length, 1);
assert.equal(store.records.v5_recent_events[0].title, '保留记录');
assert.equal(store.tables.find(table => table.id === 'v5_recent_events').description, '导入后的表结构说明');

// 完整导出结构应能被importPlan重新识别，记录数保持一致。
const exported = Object.assign({ type: 'memory-store', appVersion: M.VERSION }, M.model.normalizeStore(JSON.parse(JSON.stringify(store))));
const roundTrip = M.model.importPlan(exported);
assert.equal(roundTrip.tableCount, store.tables.length);
assert.equal(roundTrip.recordCount, Object.values(store.records).reduce((sum, rows) => sum + rows.length, 0));
assert.equal(roundTrip.records.v5_recent_events[0].content, '导入空结构时不能被清空');

const uiSource = fs.readFileSync(path.join(root, 'js/features/memory_v3/memory_ui_v3.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'css/modules/memory_v3.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(uiSource.includes('visualViewport'), '应包含软键盘可视视口处理');
assert(uiSource.includes('data-mv5-page="next"'), '应包含大量记录分页');
assert(uiSource.includes('已恢复导入前状态'), '应包含导入保存失败回滚');
assert(uiSource.includes('导入前备份'), '覆盖全部前应自动备份');
assert(cssSource.includes('.mv5-sticky-actions'), '横向表格应固定操作列');
assert(cssSource.includes('--mv5-visual-height'), '弹窗应使用可视视口高度');
assert(/memory_ui_v3\.js\?v=(?:530|540|541)/.test(htmlSource), '应保留V5.3或更高记忆模块缓存版本');

console.log('Memory V5.3 stability tests passed');
