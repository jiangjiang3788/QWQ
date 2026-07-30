const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const index = read('index.html');
const chat = read('js/chat.js');
const dock = read('js/modules/floating_ball.js');
const memoryCore = read('js/features/memory_v3/memory_core_v3.js');
const memoryEngine = read('js/features/memory_v3/memory_engine_v3.js');
const memoryUi = read('js/features/memory_v3/memory_ui_v3.js');

// User-facing pause/cancel controls are not exposed from chat or the floating-ball observer.
assert(!index.includes('id="abort-reply-btn"'));
assert(!index.includes('暂停调用'));
assert(!chat.includes("getElementById('abort-reply-btn')"));
assert(!dock.includes('data-qd-action="cancel-operation"'));
assert(!dock.includes("action === 'cancel-operation'"));
assert(!dock.includes('取消本次操作'));
assert(dock.includes('悬浮球是只读观察面板'));

// Favorite recall limit is editable without a hard max; zero is a documented unlimited sentinel.
assert(memoryUi.includes('name="favoriteMaxPerRound" min="0" step="1"'));
assert(!/name="favoriteMaxPerRound"[^>]*max="20"/.test(memoryUi));
assert(memoryUi.includes('0表示不设收藏独立条数上限'));
assert(memoryCore.includes('Math.max(0, favoriteMax)'));
assert(memoryEngine.includes('configuredFavoriteLimit === 0 ? rows.length'));

const sandbox = {
  console,
  Date,
  JSON,
  Math,
  Map,
  Set,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Error,
  TypeError,
  Promise,
  setTimeout(fn) { fn(); return 1; },
  clearTimeout() {},
  db: {
    characters: [],
    magicRoom: { contextPolicy: { structuredEnabled: true, structuredBudget: 100000 } }
  }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of [
  'js/features/memory_v3/memory_core_v3.js',
  'js/features/memory_v3/memory_rounds_v3.js',
  'js/features/memory_v3/memory_engine_v3.js'
]) {
  vm.runInContext(read(file), sandbox, { filename: file });
}

const chatEntity = {
  id: 'char-limit-test',
  name: '测试角色',
  history: [{ id: 'user-turn', role: 'user', content: '我们继续聊共同标签。', timestamp: Date.now() }]
};
sandbox.db.characters.push(chatEntity);
const store = sandbox.MemoryV5.model.ensureStore(chatEntity);
store.settings.contextMaxRecords = 50;
const table = store.tables.find(item => item.id === sandbox.MemoryV5.constants.FAVORITE_TABLE_ID);
assert(table);
store.records[table.id] = Array.from({ length: 8 }, (_, index) => sandbox.MemoryV5.model.normalizeRecord({
  id: `favorite-${index + 1}`,
  tags: ['共同标签'],
  content: `收藏内容-${index + 1}`,
  updatedAt: new Date(Date.now() + index * 1000).toISOString()
}, table));

const countIncluded = block => (block.match(/收藏内容-/g) || []).length;

store.settings.favoriteMaxPerRound = 5;
assert.strictEqual(countIncluded(sandbox.MemoryV5.engine.getContextBlock(chatEntity)), 5, 'default configured cap should be honored');

store.settings.favoriteMaxPerRound = 7;
assert.strictEqual(countIncluded(sandbox.MemoryV5.engine.getContextBlock(chatEntity)), 7, 'a value above five should be honored');

store.settings.favoriteMaxPerRound = 0;
assert.strictEqual(countIncluded(sandbox.MemoryV5.engine.getContextBlock(chatEntity)), 8, 'zero should remove the favorite-specific count cap');

console.log('V5.7.1 read-only request observer and editable favorite recall limit tests passed.');
