const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const index = read('index.html');
const appRegistry = read('js/app_registry.js');
const chatAi = read('js/modules/chat_ai.js');
const favoriteModule = read('js/modules/favorites.js');
const memoryCore = read('js/features/memory_v3/memory_core_v3.js');
const memoryEngine = read('js/features/memory_v3/memory_engine_v3.js');
const memoryUi = read('js/features/memory_v3/memory_ui_v3.js');
const sourceRegistry = read('js/core/context_source_registry.js');

// No standalone Favorites app, screen, scope switch, or full-inventory prompt remains.
assert(!index.includes('id="favorites-screen"'));
assert(!index.includes('id="favorites-detail-screen"'));
assert(!index.includes('css/modules/favorites.css'));
assert(!index.includes('setting-char-aware-user-favorites'));
assert(!appRegistry.includes("id: 'favorites'"));
assert(!chatAi.includes('<favorite_inventory>'));
assert(!chatAi.includes("registryId: 'collection.relevant'"));
assert(!sourceRegistry.includes("id: 'collection.relevant'"));
assert(chatAi.includes('<favorite_ops>'));
assert(chatAi.includes('不要填写正文或标题'));

// Fixed role-local memory table: no visible/required title and no AI memory_ops write.
assert(memoryCore.includes("const FAVORITE_TABLE_ID = 'v5_message_favorites'"));
assert(memoryCore.includes("name: '收藏记忆'"));
assert(memoryCore.includes("systemRole: 'message_favorites'"));
assert(memoryCore.includes('locked: true'));
assert(memoryCore.includes("commonField('title', { hidden: true })"));
assert(memoryCore.includes("customField('收藏方', 'multiselect'"));
assert(memoryCore.includes("behavior: { writePolicy: 'manual', contextPolicy: 'relevant', allowAiWrite: false"));
assert(memoryEngine.includes('includeAssistant: table.id !== M.constants.FAVORITE_TABLE_ID'));
assert(memoryEngine.includes('favoriteMaxPerRound'));
assert(memoryUi.includes("if (existing?.locked) return toast('收藏记忆是系统表，只能编辑其中的记录。')"));
assert(!favoriteModule.includes('db.favorites.push'));
assert(favoriteModule.includes('migrateLegacyFavoritesToMemory'));
assert(favoriteModule.includes('global.db.favorites = []'));

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
  prompt() { return '爸爸，健康，复查'; },
  showToast() {},
  triggerHapticFeedback() {},
  saveCharacter: async () => {},
  saveData: async () => {},
  saveGlobalSettings: async () => {},
  document: { getElementById() { return null; } },
  db: {
    characters: [],
    favorites: [],
    magicRoom: { contextPolicy: { structuredEnabled: true, structuredBudget: 5000 } }
  },
  currentChatId: null,
  currentChatType: null
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of [
  'js/features/memory_v3/memory_core_v3.js',
  'js/features/memory_v3/memory_rounds_v3.js',
  'js/features/memory_v3/memory_engine_v3.js',
  'js/modules/favorites.js'
]) {
  vm.runInContext(read(file), sandbox, { filename: file });
}

(async () => {
  const charA = {
    id: 'char-a', name: '阿沉', myName: '小海葵', history: [
      { id: 'msg-a1', role: 'user', content: '[小海葵的消息：爸爸明天又要去医院复查。]', timestamp: Date.now() }
    ]
  };
  const charB = { id: 'char-b', name: '小周', myName: '小海葵', history: [] };
  sandbox.db.characters.push(charA, charB);
  sandbox.currentChatId = charA.id;
  sandbox.currentChatType = 'private';

  await sandbox.addMessageToFavorites('msg-a1');
  const storeA = sandbox.MemoryV5.model.ensureStore(charA);
  const storeB = sandbox.MemoryV5.model.ensureStore(charB);
  const favoriteTable = storeA.tables.find(table => table.id === 'v5_message_favorites');
  assert(favoriteTable, 'favorite table should exist in the current character memory store');
  assert.strictEqual(favoriteTable.fields.find(field => field.commonKey === 'title').hidden, true);
  assert.strictEqual(storeA.records.v5_message_favorites.length, 1);
  assert.strictEqual(storeB.records.v5_message_favorites.length, 0, 'favorite must not leak into another character');

  const record = storeA.records.v5_message_favorites[0];
  assert.strictEqual(record.title, '');
  assert(record.tags.includes('爸爸'));
  assert.strictEqual(record.content, '爸爸明天又要去医院复查。');

  const relevant = sandbox.MemoryV5.engine.getContextBlock(charA);
  assert(relevant.includes('【收藏记忆】'));
  assert(relevant.includes('标签:'));
  assert(relevant.includes('爸爸'));
  assert(relevant.includes('健康'));
  assert(relevant.includes('收藏方: 用户'));
  assert(relevant.includes('爸爸明天又要去医院复查。'));
  assert(!relevant.includes('标题:'));

  // Only the current user turn can trigger favorite recall; assistant text must not trigger it.
  charA.history.push({ id: 'assistant-1', role: 'assistant', content: '爸爸复查这件事我会记住。' });
  charA.history.push({ id: 'user-2', role: 'user', content: '今天只聊工作。', timestamp: Date.now() });
  const unrelated = sandbox.MemoryV5.engine.getContextBlock(charA);
  assert(!unrelated.includes('爸爸明天又要去医院复查。'));

  // Old user/character favorites of the same message merge into one role-local row.
  sandbox.db.favorites = [
    { id: 'legacy-user', messageId: 'msg-a1', chatId: 'char-a', chatType: 'private', content: '[小海葵的消息：爸爸明天又要去医院复查。]', sender: '小海葵', note: '关心复查' },
    { id: 'legacy-character', messageId: 'msg-a1', characterId: 'char-a', chatType: 'private', content: '[小海葵的消息：爸爸明天又要去医院复查。]', sender: '小海葵', note: '别忘了问结果', favoriteBy: 'character' }
  ];
  const migration = await sandbox.FavoriteMemory.migrate();
  assert.strictEqual(migration.total, 2);
  assert.strictEqual(migration.merged, 2);
  assert.strictEqual(storeA.records.v5_message_favorites.length, 1);
  assert.strictEqual(sandbox.db.favorites.length, 0);
  assert(sandbox.db.favoriteMigrationArchive);
  const collectorField = favoriteTable.fields.find(field => field.id === 'favorite_collectors');
  const collectors = sandbox.MemoryV5.model.getFieldValue(record, collectorField);
  assert(collectors.includes('用户') && collectors.includes('角色'));
  const noteField = favoriteTable.fields.find(field => field.id === 'favorite_note');
  const mergedNote = sandbox.MemoryV5.model.getFieldValue(record, noteField);
  assert(mergedNote.includes('关心复查') && mergedNote.includes('别忘了问结果'));

  // Final compiler keeps whole structured-memory rows and never slices through a record.
  const storage = { setItem() {}, getItem() { return null; } };
  const compilerWindow = {
    db: { magicRoom: { contextPolicy: { structuredEnabled: true, structuredBudget: 135, historyEnabled: true, historyCount: 0, statusEnabled: true } } },
    sessionStorage: storage
  };
  compilerWindow.window = compilerWindow;
  const compilerContext = vm.createContext({
    window: compilerWindow, sessionStorage: storage, console, Date, JSON, Math, Number, String,
    Array, Object, Set, Map, RegExp, Boolean, Error
  });
  vm.runInContext(read('js/core/context_compiler.js'), compilerContext, { filename: 'context_compiler.js' });
  const recordOne = '标签: 爸爸、健康\n发送方: 小海葵\n内容: 爸爸明天去复查。';
  const recordTwo = '标签: 工作、项目\n发送方: 小海葵\n内容: 这是一条很长很长并且不应该被从中间裁断的第二条记录。';
  const memory = `<structured_memory version="5.8.0">\n【收藏记忆】\n${recordOne}\n---\n${recordTwo}\n</structured_memory>`;
  const requestBody = { messages: [
    { role: 'system', content: `<structured_archive_memory>\n${memory}\n</structured_archive_memory>` },
    { role: 'user', content: '爸爸要复查' }
  ] };
  const compiled = compilerWindow.OVOContextCompiler.compilePrivateChatRequest({ provider: 'newapi', requestBody });
  assert(compiled.systemPrompt.includes(recordOne));
  assert(!compiled.systemPrompt.includes(recordTwo));
  assert(!compiled.systemPrompt.includes('这是一条很长很长并且不应该'));
  assert(compiled.changes.some(change => change.sourceId === 'memory.structured' && change.reason.includes('整条排除')));

  console.log('V5.7.0 favorite-to-role-memory migration and tag recall tests passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
