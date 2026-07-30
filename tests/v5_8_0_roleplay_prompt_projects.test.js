const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const sandbox = {
  console, Date, Math, JSON, Set, Map, WeakSet, Promise, RegExp, Object, Array, String, Number, Boolean, Error, TypeError,
  setTimeout, clearTimeout, AbortController, TextEncoder, TextDecoder,
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, body: { classList: { contains() { return false; } } }
  },
  currentChatId: null, currentChatType: 'private', isGenerating: false, currentReplyAbortController: null,
  getReplyBtn: null, regenerateBtn: null, typingIndicator: null,
  pad(value) { return String(value).padStart(2, '0'); },
  getLocalTimeInTimezone() { return ''; },
  filterHistoryForAI(chat, history) { return history; },
  buildBlockMemoryContext() { return ''; }, buildCharBlockMemoryContext() { return ''; },
  showToast() {}, saveCharacter: async () => {}, saveData: async () => {},
  OVORetiredFeaturePolicy: { sanitizeSystemPrompt(value) { return String(value || ''); }, auditRequest() { return { ok: true, findings: [] }; } }
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const load = relative => vm.runInContext(fs.readFileSync(path.join(root, relative), 'utf8'), sandbox, { filename: relative });

load('js/features/memory_v3/memory_core_v3.js');
load('js/features/memory_v3/memory_rounds_v3.js');
load('js/features/memory_v3/memory_engine_v3.js');
sandbox.MemoryV5.ui = { setup() {}, render() {}, openForCharacter() {} };
load('js/features/memory_v3/memory_compat_v3.js');

const store = sandbox.MemoryV5.model.createDefaultStore();
const core = store.tables.find(table => table.id === 'v5_core_profile');
core.fields = [
  { id: 'char_identity', scope: 'custom', name: '角色身份', type: 'longtext', category: '角色档案', hidden: false, required: false },
  { id: 'user_identity', scope: 'custom', name: '用户身份', type: 'longtext', category: '用户档案', hidden: false, required: false },
  { id: 'relationship', scope: 'custom', name: '关系基础', type: 'longtext', category: '双方关系', hidden: false, required: false }
];
store.records[core.id] = [{ id: 'core_record', values: {
  char_identity: '{{char}}是长期陪伴型角色',
  user_identity: '{{user}}重视连续记忆',
  relationship: '{{char}}与{{user}}已经建立稳定关系'
}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];

const favoriteTable = store.tables.find(table => table.id === 'v5_message_favorites');
const favoriteCustomValues = {};
for (const field of favoriteTable.fields.filter(field => field.scope === 'custom')) {
  if (field.name === '收藏方') favoriteCustomValues[field.id] = ['用户'];
  else if (field.name === '发送方') favoriteCustomValues[field.id] = '小海葵';
  else if (field.name === '消息时间') favoriteCustomValues[field.id] = '2026-07-30 10:00:00';
}
store.records[favoriteTable.id] = [{
  id: 'favorite_record', tableId: favoriteTable.id,
  tags: ['聊别的'], content: '这是一条只在当前话题相关时召回的收藏', source: '用户明确', time: '2026-07-30 10:00:00',
  values: favoriteCustomValues, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
}];

const character = {
  id: 'char_test', realName: '阿沉', remarkName: '阿沉', myName: '小海葵', persona: '旧角色人设不应重复发送', myPersona: '旧用户人设不应重复发送',
  status: '在线', history: [
    { id: 'u1', role: 'user', content: '之前没有触发', timestamp: Date.now() - 1000 },
    { id: 'a1', role: 'assistant', content: '提到旧场景关键词', timestamp: Date.now() - 500 },
    { id: 'u2', role: 'user', content: '现在聊别的', timestamp: Date.now() }
  ], worldBookIds: ['wb_before_recent', 'wb_after_always'], memoryStore: store,
  replyCountEnabled: false, characterAutoFavoriteEnabled: false, canBlockUser: false,
  stickerGroups: '', useCustomBubbleCss: false, allowCharSwitchBubbleCss: false,
  statusPanel: { enabled: false }, source: 'local'
};
const worldBooks = [
  { id: 'wb_before_recent', name: '旧场景命中', position: 'before', alwaysOn: false, keywords: ['旧场景关键词'], content: '身份前的近期命中条目正文很长', weight: 100 },
  { id: 'wb_after_always', name: '场景常驻', position: 'after', alwaysOn: true, keywords: [], content: '场景后置常驻正文', weight: 100 }
];
sandbox.db = {
  characters: [character], worldBooks, groups: [], bubbleCssPresets: [], myStickers: [],
  magicRoom: { contextPolicy: { worldBookEnabled: true, worldBookBudget: '场景后置常驻正文'.length, structuredEnabled: true, structuredBudget: 10000 } },
  apiSettings: { onlineRoleEnabled: true, timePerceptionEnabled: true }, cotSettings: {}, favorites: []
};

const worldbookSource = fs.readFileSync(path.join(root, 'js/modules/worldbook.js'), 'utf8');
const providerStart = worldbookSource.indexOf('// V5.4.1：世界书命中、预算和诊断归入世界书领域。');
vm.runInContext(worldbookSource.slice(providerStart), sandbox, { filename: 'worldbook-provider.js' });
load('js/modules/chat_ai.js');
load('js/core/context_source_registry.js');

const memoryProjects = sandbox.MemoryV5.engine.getContextProjects(character);
assert.deepStrictEqual(Array.from(memoryProjects.coreGroups, group => group.category), ['角色档案', '用户档案', '双方关系']);
assert(memoryProjects.core.includes('{{char}}'));
assert(memoryProjects.core.includes('{{user}}'));
assert(memoryProjects.currentRelated.includes('【收藏记忆】'), '收藏记忆必须放在当前与相关记忆层');
assert(!memoryProjects.longTerm.includes('【收藏记忆】'), '收藏记忆不能混入长期关系记忆层');

const wbContext = sandbox.WorldBookContextProvider.provide(character);
assert.strictEqual(wbContext.before, '', '预算选择不能因为 before 位置先出现就优先消耗');
assert.strictEqual(wbContext.after, '场景后置常驻正文', '常驻条目应先被选择，再放回场景后置位置');
const wbDiagnostic = sandbox.WorldBookContextProvider.getLastDiagnostic();
assert.strictEqual(wbDiagnostic.items.find(item => item.id === 'wb_after_always').clipped, false);
assert.strictEqual(wbDiagnostic.items.find(item => item.id === 'wb_before_recent').included, false);

const prompt = vm.runInContext('generatePrivateSystemPrompt(db.characters[0], { weatherText: "", enableMemorySidecar: false })', sandbox);
assert(prompt.includes('<session_rules>'));
assert(prompt.includes('<identity_core>'));
assert(prompt.includes('<worldbook_scene_after>'));
assert(prompt.indexOf('<identity_core>') < prompt.indexOf('<worldbook_scene_after>'));
assert(prompt.includes('【角色档案】') && prompt.includes('【用户档案】') && prompt.includes('【双方关系】'));
assert(prompt.includes('阿沉是长期陪伴型角色'));
assert(prompt.includes('小海葵重视连续记忆'));
assert(!/\{\{\s*(user|char)\s*\}\}/i.test(prompt), 'aliases must be resolved only in final prompt');
assert(!prompt.includes('旧角色人设不应重复发送'));
assert(!prompt.includes('旧用户人设不应重复发送'));
assert(!prompt.includes('<char_settings>'));

const finalPrompt = vm.runInContext('appendMessageMetadataProtocol(generatePrivateSystemPrompt(db.characters[0], { weatherText: "", enableMemorySidecar: false }))', sandbox);
const sources = vm.runInContext('buildPrivateChatPromptSources(db.characters[0], ' + JSON.stringify(finalPrompt) + ')', sandbox);
assert.strictEqual(JSON.stringify(Array.from(sources, source => source.registryId)), JSON.stringify([
  'prompt.session', 'identity.core', 'worldbook.scene_after', 'memory.current_related', 'prompt.interaction_rules',
  'output.chat_protocol', 'prompt.message_metadata'
]));
const coreSource = sources.find(source => source.registryId === 'identity.core');
assert.strictEqual(new Set(coreSource.items.map(item => item.metadata.tableName)).size, 3);

const manifest = sandbox.OVOContextSourceRegistry.buildCompiledManifest({
  provider: 'openai', model: 'test', requestBody: { model: 'test', messages: [{ role: 'system', content: finalPrompt }, { role: 'user', content: '你好' }] }, promptSources: sources
});
assert.strictEqual(manifest.coverage.complete, true);
assert.strictEqual(manifest.sources.some(source => source.sourceId === 'system.core_rules'), false);
assert.strictEqual(manifest.sources.some(source => source.sourceId === 'system.unclassified'), false);
assert.strictEqual(JSON.stringify(manifest.sources.slice(0, sources.length).map(source => source.sourceId)), JSON.stringify(Array.from(sources, source => source.registryId)));

console.log('V5.8.0 roleplay prompt projects, core-field groups, alias replacement, worldbook placement and manifest tests passed.');
