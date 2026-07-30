const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const chatAi = read('js/modules/chat_ai.js');
const favorites = read('js/modules/favorites.js');

assert(chatAi.includes('收藏不是记忆整理、信息提取、重要性打分'));
assert(chatAi.includes('私人情感动作'));
assert(chatAi.includes('不按字数、信息量、长期价值或实用性判断'));
assert(chatAi.includes('它可以是重要事实，也可以只是一句很短的日常话'));
assert(chatAi.includes('一次真实情境中若自然想收藏不止一条'));
assert(!chatAi.includes('每轮最多1条'));
assert(!chatAi.includes('items.slice(0, 1)'));
assert(!chatAi.includes('同一信息不要在同一轮同时写入两处'));
assert(chatAi.includes('message_meta sent_at="..." id="..."'));
assert(!chatAi.includes("parts[0].text = '[id:'"));
assert(!favorites.includes('isObviouslyLowSignalFavorite'));
assert(!favorites.includes('isNearDuplicateFavorite'));
assert(!favorites.includes('收藏寄语没有说明'));
assert(favorites.includes('两句相同文字出现在不同时间，也可能对角色具有完全不同的意义'));
assert(favorites.includes('这条具体消息已经由角色收藏过'));

// 当前实际请求中所有真实用户消息都可被角色收藏，不局限于“本轮尚未回复”。
const helperStart = chatAi.indexOf('function getAutonomousFavoriteCandidateIds(history)');
const helperEnd = chatAi.indexOf('\n\nwindow.OVOAutonomousFavoritePolicy', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart);
const helperCode = chatAi.slice(helperStart, helperEnd);
const helperSandbox = { Set, Array, String, RegExp };
vm.createContext(helperSandbox);
vm.runInContext(`${helperCode}\nthis.getIds = getAutonomousFavoriteCandidateIds;`, helperSandbox);
let ids = helperSandbox.getIds([
  { id: 'msg_old', role: 'user' },
  { id: 'msg_reply', role: 'assistant' },
  { id: 'msg_short', role: 'user' },
  { id: 'msg_control', role: 'user', sentByCharControl: true },
  { id: 'msg_new', role: 'user' },
  { role: 'system', systemGenerated: true }
]);
assert.deepStrictEqual(Array.from(ids), ['msg_old', 'msg_short', 'msg_new']);

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
  Intl,
  setTimeout(fn) { fn(); return 1; },
  clearTimeout() {},
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
  const chat = {
    id: 'char-a',
    name: '阿沉',
    myName: '小海葵',
    history: [
      { id: 'msg_short', role: 'user', content: '[小海葵的消息：嗯]', timestamp: Date.now() },
      { id: 'msg_same_a', role: 'user', content: '[小海葵的消息：晚安]', timestamp: Date.now() + 1 },
      { id: 'msg_same_b', role: 'user', content: '[小海葵的消息：晚安]', timestamp: Date.now() + 2 }
    ]
  };
  sandbox.db.characters.push(chat);

  // 很短的原话也可能因语境而有情感意义，存储层不得拒绝。
  let result = await sandbox.addCharacterFavorite('msg_short', chat.id, '', [], {
    eligibleMessageIds: ['msg_short', 'msg_same_a', 'msg_same_b']
  });
  assert.strictEqual(result.status, 'added');

  // 相同文字发生在不同消息、不同时间，可以分别收藏。
  result = await sandbox.addCharacterFavorite('msg_same_a', chat.id, '那晚我不想忘', [], {
    eligibleMessageIds: ['msg_short', 'msg_same_a', 'msg_same_b']
  });
  assert.strictEqual(result.status, 'added');
  result = await sandbox.addCharacterFavorite('msg_same_b', chat.id, '这次的语气不一样', [], {
    eligibleMessageIds: ['msg_short', 'msg_same_a', 'msg_same_b']
  });
  assert.strictEqual(result.status, 'added');

  // 只拦截同一条具体消息被同一角色重复收藏。
  result = await sandbox.addCharacterFavorite('msg_same_a', chat.id, '再收藏一次', [], {
    eligibleMessageIds: ['msg_short', 'msg_same_a', 'msg_same_b']
  });
  assert.strictEqual(result.status, 'rejected');
  assert(result.reason.includes('已经由角色收藏过'));

  const store = sandbox.MemoryV5.model.ensureStore(chat);
  assert.strictEqual(store.records.v5_message_favorites.length, 3);
  console.log('V5.8.3 emotional favorite action semantics passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
