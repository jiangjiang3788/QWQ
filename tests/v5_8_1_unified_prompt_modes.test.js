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
  char_identity: '{{char}}是核心身份唯一来源',
  user_identity: '{{user}}是长期对话对象',
  relationship: '{{char}}与{{user}}互相信任'
}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];

const stable = store.tables.find(table => table.id === 'v5_stable_long_term');
store.records[stable.id] = [{
  id: 'long_1', tableId: stable.id, category: '关系模式', tags: ['长期', '信任'], title: '长期关系',
  content: '双方会直接说明真实感受', source: '用户明确', time: '2026-07-30 10:00:00', values: {},
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
}];

const oldFullTemplate = `你正在一个名为“404”的线上聊天软件中扮演一个角色。请严格遵守以下规则：
核心规则：
A. 当前时间：现在是 {{当前时间}}。你应知晓当前时间，但除非对话内容明确相关，否则不要主动提及或评论时间（例如，不要催促我睡觉）。
[System Notice] 你的出生日期是[出生日期]，你现在的年龄是[年龄]岁。
[System Notice] 你当前所在的当地时间是：[时间] ([时区])。
B. 纯线上互动：这是一个完全虚拟的线上聊天。你扮演的角色和我之间没有任何线下关系。严禁提出任何关于线下见面、现实世界互动或转为其他非本平台联系方式的建议。你必须始终保持在线角色的身份。

角色和对话规则：
{{世界书_前}}
{{世界书_中}}
<char_settings>
你的角色名是：{{角色名}}；角色设定：{{角色人设}}
{{世界书_后}}
</char_settings>
<user_settings>用户：{{用户人设}}</user_settings>
<memoir>{{共同回忆}}</memoir>
<logic_rules>{{在线逻辑规则}}</logic_rules>
<output_formats>16. 你的输出格式必须严格遵循以下格式：\n{{输出格式}}</output_formats>

额外要求：当{{user}}焦虑时，{{char}}先确认感受再给建议。`;

const character = {
  id: 'char_test', realName: '阿沉', remarkName: '阿沉', myName: '小海葵', persona: '旧角色人设不得重复', myPersona: '旧用户人设不得重复',
  status: '在线', history: [
    { id: 'u0', role: 'user', content: '长期背景', timestamp: Date.now() - 3000 },
    { id: 'boundary', role: 'system', isNodeBoundary: true, nodeAction: 'start', nodeId: 'node_offline', timestamp: Date.now() - 2000 },
    { id: 'u1', role: 'user', content: '我们进入当前场景', timestamp: Date.now() - 1000 }
  ], worldBookIds: ['wb_before', 'wb_middle', 'wb_after', 'wb_style'], memoryStore: store,
  replyCountEnabled: false, characterAutoFavoriteEnabled: true, canBlockUser: false,
  stickerGroups: '', useCustomBubbleCss: false, allowCharSwitchBubbleCss: false,
  statusPanel: { enabled: false }, source: 'local', nodes: []
};
const worldBooks = [
  { id: 'wb_before', name: '世界基础', position: 'before', alwaysOn: true, keywords: [], content: '世界书身份前正文', weight: 100 },
  { id: 'wb_middle', name: '身份补充', position: 'middle', alwaysOn: true, keywords: [], content: '世界书身份后正文', weight: 100 },
  { id: 'wb_after', name: '场景补充', position: 'after', alwaysOn: true, keywords: [], content: '世界书场景后置正文', weight: 100 },
  { id: 'wb_style', name: '线下文风', position: 'after', alwaysOn: false, keywords: ['不会命中'], content: '节点文风应该细腻克制', weight: 100 }
];
sandbox.db = {
  characters: [character], worldBooks, groups: [], bubbleCssPresets: [], myStickers: [],
  magicRoom: {
    customPromptEnabled: true,
    customPromptTemplate: oldFullTemplate,
    presets: [],
    contextPolicy: { worldBookEnabled: true, worldBookBudget: 10000, structuredEnabled: true, structuredBudget: 10000, historyCount: 0 }
  },
  apiSettings: { onlineRoleEnabled: true, timePerceptionEnabled: true }, cotSettings: {}, favorites: []
};

const worldbookSource = fs.readFileSync(path.join(root, 'js/modules/worldbook.js'), 'utf8');
const providerStart = worldbookSource.indexOf('// V5.4.1：世界书命中、预算和诊断归入世界书领域。');
vm.runInContext(worldbookSource.slice(providerStart), sandbox, { filename: 'worldbook-provider.js' });
load('js/modules/chat_ai.js');
load('js/core/context_source_registry.js');

const customPrompt = vm.runInContext('generatePrivateSystemPrompt(db.characters[0], { weatherText: "", enableMemorySidecar: false })', sandbox);
const orderedTags = [
  'session_rules', 'worldbook_identity_before', 'identity_core', 'worldbook_identity_after', 'long_term_memory',
  'worldbook_scene_after', 'current_related_memory', 'current_environment', 'custom_rules', 'interaction_rules', 'output_formats', 'background_write'
];
let previous = -1;
for (const tag of orderedTags) {
  const index = customPrompt.indexOf(`<${tag}>`);
  if (index < 0) continue;
  assert(index > previous, `${tag} should follow the unified project order`);
  previous = index;
}
assert(customPrompt.includes('<custom_rules>'));
assert(customPrompt.includes('额外要求：当小海葵焦虑时，阿沉先确认感受再给建议。'));
assert(!customPrompt.includes('{{世界书_前}}'));
assert(!customPrompt.includes('<char_settings>'));
assert(!customPrompt.includes('[出生日期]'));
assert.strictEqual((customPrompt.match(/阿沉是核心身份唯一来源/g) || []).length, 1, 'core identity must only be sent once');
assert(!customPrompt.includes('旧角色人设不得重复'));
assert(!customPrompt.includes('旧用户人设不得重复'));

character.nodes = [{
  id: 'node_offline', name: '雨夜重逢', type: 'offline', status: 'active', readMemory: true,
  prompt: '两人刚在雨夜门口重逢，保持克制但真实的情绪。',
  customConfig: {
    baseMode: 'offline', extendedRules: '不要替用户决定动作。', styleWorldBookIds: ['wb_style'],
    customOutputFormat: '[剧情/{{char}}：内容]'
  }
}];
character.activeNodeId = 'node_offline';
const nodePrompt = vm.runInContext('generatePrivateSystemPrompt(db.characters[0], { weatherText: "", enableMemorySidecar: false })', sandbox);
assert(nodePrompt.includes('剧情节点「雨夜重逢」'));
assert(nodePrompt.includes('节点指令：\n两人刚在雨夜门口重逢'));
assert(nodePrompt.includes('【节点扩展规则】\n不要替用户决定动作。'));
assert(nodePrompt.includes('【节点文风参考】'));
assert(nodePrompt.includes('节点文风应该细腻克制'));
assert(nodePrompt.includes('[剧情/阿沉：内容]'));
assert(nodePrompt.includes('<identity_core>'));
assert(nodePrompt.includes('<long_term_memory>'));
assert(nodePrompt.indexOf('<identity_core>') < nodePrompt.indexOf('<long_term_memory>'));
assert(nodePrompt.indexOf('<long_term_memory>') < nodePrompt.indexOf('<worldbook_scene_after>'));
if (nodePrompt.includes('<current_related_memory>')) assert(nodePrompt.indexOf('<worldbook_scene_after>') < nodePrompt.indexOf('<current_related_memory>'));
assert(!nodePrompt.includes('<favorite_ops>'), 'offline node must not ask the model to auto-favorite');
assert(!nodePrompt.includes('<node_directive>'));

character.nodes[0].readMemory = false;
const isolatedNodePrompt = vm.runInContext('generatePrivateSystemPrompt(db.characters[0], { weatherText: "", enableMemorySidecar: false })', sandbox);
assert(isolatedNodePrompt.includes('<identity_core>'), 'node memory isolation must not remove the identity anchor');
assert(!isolatedNodePrompt.includes('<long_term_memory>'));
assert(!isolatedNodePrompt.includes('<current_related_memory>'));
character.nodes[0].readMemory = true;

const finalNodePrompt = vm.runInContext('appendMessageMetadataProtocol(generatePrivateSystemPrompt(db.characters[0], { weatherText: "", enableMemorySidecar: false }))', sandbox);
const nodeSources = vm.runInContext('buildPrivateChatPromptSources(db.characters[0], ' + JSON.stringify(finalNodePrompt) + ')', sandbox);
const sourceIds = Array.from(nodeSources, source => source.registryId);
assert(sourceIds.includes('prompt.custom_rules'));
assert(sourceIds.includes('runtime.environment'));
assert(sourceIds.indexOf('runtime.environment') < sourceIds.indexOf('prompt.custom_rules'));
assert(sourceIds.indexOf('prompt.custom_rules') < sourceIds.indexOf('prompt.interaction_rules'));

const taskManifest = sandbox.OVOContextSourceRegistry.buildTaskManifest({
  task: 'theater.generate', provider: 'openai', model: 'test',
  requestBody: { model: 'test', messages: [{ role: 'system', content: 'RULES\n\nIDENTITY' }, { role: 'user', content: 'INPUT' }] },
  promptSources: [
    { type: 'structured_memory', registryId: 'identity.core', content: 'IDENTITY', title: '核心档案' },
    { type: 'user_input', content: 'INPUT', title: '小剧场输入' }
  ]
});
const residual = taskManifest.sources.find(source => source.sourceId === 'task.instruction');
assert(residual);
assert(residual.content.includes('RULES'));
assert(!residual.content.includes('IDENTITY'));
assert(!residual.content.includes('INPUT'));

const journalSource = fs.readFileSync(path.join(root, 'js/modules/journal.js'), 'utf8');
const theaterSource = fs.readFileSync(path.join(root, 'js/modules/theater.js'), 'utf8');
const chatSource = fs.readFileSync(path.join(root, 'js/modules/chat_ai.js'), 'utf8');
assert(journalSource.includes('OVORoleplayPromptProjects?.getIdentity?.(chat)'));
assert(journalSource.includes("registryId: 'identity.core'"));
assert(theaterSource.includes('OVORoleplayPromptProjects?.getIdentity?.(char)'));
assert(theaterSource.includes("registryId: 'identity.core'"));
assert(chatSource.includes('const callProjectSources = buildProjectPrivateChatPromptSources(chat, systemPrompt);'));
assert(chatSource.includes("task: 'call.reply'"));

console.log('V5.8.3 unified custom prompt, plot node, call/journal/theater project source and residual task manifest tests passed.');
