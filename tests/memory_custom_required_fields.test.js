const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const sandbox = {
  console, Map, Set, Promise, Date, JSON, Math, String, Number, Boolean, Array, Object, Error, RegExp,
  sessionStorage: { setItem() {}, getItem() { return null; } },
  db: { characters: [], groups: [] },
  saveCharacter: async () => {}, saveGroup: async () => {}, showToast() {}
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of [
  'js/features/memory_v3/memory_core_v3.js',
  'js/features/memory_v3/memory_rounds_v3.js',
  'js/features/memory_v3/memory_engine_v3.js'
]) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });

const M = sandbox.MemoryV5;
const chat = { id: 'required_test', history: [], nodes: [] };
sandbox.db.characters.push(chat);
const store = M.model.ensureStore(chat);
const table = store.tables.find(item => item.id === 'v5_items');
const statusField = table.fields.find(field => field.name === '物品状态');
statusField.required = true;

let result = M.engine.applyOperations(chat, [{
  tableId: 'v5_items', action: 'add', source: '用户明确',
  values: { 分类: '设备', 标题: '测试设备', 内容: '用于验证必填字段' }
}], { origin: 'ai' });
assert.strictEqual(result.changed.length, 0);
assert.strictEqual(result.rejected.length, 1);
assert(result.rejected[0].reason.includes('物品状态'));

result = M.engine.applyOperations(chat, [{
  tableId: 'v5_items', action: 'add', source: '用户明确',
  values: { 分类: '设备', 标题: '测试设备', 内容: '用于验证必填字段', 物品状态: '持有' }
}], { origin: 'ai' });
assert.strictEqual(result.changed.length, 1);
assert.strictEqual(result.rejected.length, 0);
console.log('Custom required field enforcement test passed.');
