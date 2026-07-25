const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const store = new Map();
const window = {};
const context = {
  window,
  console,
  Date,
  JSON,
  Map,
  Set,
  Object,
  Array,
  String,
  Number,
  Math,
  RegExp,
  TypeError,
  sessionStorage: {
    setItem(k, v) { store.set(k, String(v)); },
    getItem(k) { return store.get(k) || null; },
    removeItem(k) { store.delete(k); }
  }
};
window.window = window;
window.sessionStorage = context.sessionStorage;
vm.createContext(context);

for (const file of [
  'js/core/deprecated_feature_policy.js',
  'js/core/context_source_registry.js'
]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

const policy = window.OVORetiredFeaturePolicy;
const registry = window.OVOContextSourceRegistry;
assert(policy && registry, 'V5.4 core globals should load');

const dirty = `核心内容\n<family_card_from_user>亲属卡与消费记录</family_card_from_user>\n<peek_awareness>偷看手机</peek_awareness>\n<alt_shared_memory>小号互通</alt_shared_memory>\n<phone_control>[phone-control:view-chat-list]</phone_control>\n<summary>节点摘要</summary>\n✨双语模式特别指令✨：输出外语「中文翻译」\n正常结尾`;
const clean = policy.sanitizeSystemPrompt(dirty);
assert(clean.includes('核心内容') && clean.includes('正常结尾'));
for (const marker of ['family_card', 'peek_awareness', 'alt_shared_memory', 'phone-control', '<summary>', '双语模式特别指令']) {
  assert(!clean.includes(marker), `retired marker should be removed: ${marker}`);
}

const character = {
  bilingualModeEnabled: true,
  familyCardEnabled: true,
  phoneControlEnabled: true,
  peekScreenSettings: { charAwarePeek: true, impersonateEnabled: true },
  nodes: [{ enableSummary: true }]
};
policy.applyToCharacter(character);
assert.strictEqual(character.bilingualModeEnabled, false);
assert.strictEqual(character.familyCardEnabled, false);
assert.strictEqual(character.phoneControlEnabled, false);
assert.strictEqual(character.peekScreenSettings.charAwarePeek, false);
assert.strictEqual(character.nodes[0].enableSummary, false);

const history = policy.sanitizeHistory([
  { id: 'a', content: '普通记录', nodeSummary: '旧摘要' },
  { id: 'b', content: '摘要记录', isNodeSummaryMsg: true },
  { id: 'c', content: '<summary>隐藏</summary>保留' }
]);
assert.deepStrictEqual(Array.from(history, x => x.id), ['a', 'c']);
assert(!('nodeSummary' in history[0]));
assert.strictEqual(history[1].content, '保留');

// User text may mention a retired feature; only system-side injection should count as leakage.
assert.strictEqual(policy.auditRequest({ messages: [{ role: 'user', content: '我不使用双语模式特别指令' }] }).ok, true);
assert.strictEqual(policy.auditRequest({ messages: [{ role: 'system', content: '<phone_control>bad</phone_control>' }] }).ok, false);

const required = ['system.core_rules', 'character.profile', 'user.profile', 'worldbook.active', 'memory.structured', 'chat.history', 'chat.current_input', 'output.chat_protocol', 'request.tools', 'request.parameters'];
required.forEach(id => assert(registry.has(id), `required source should be registered: ${id}`));
policy.RETIRED_SOURCE_IDS.forEach(id => assert(!registry.has(id), `retired source must not be registered: ${id}`));

const body = {
  model: 'test-model',
  stream: true,
  messages: [
    { role: 'system', content: '角色设定与输出规则' },
    { role: 'user', content: '你好' }
  ],
  tools: [{ type: 'web_search' }]
};
const manifest = registry.buildShadowManifest({
  task: 'private-chat',
  provider: 'openai-compatible',
  model: 'test-model',
  requestBody: body,
  promptSources: [
    { type: 'character_profile', registryId: 'character.profile', content: '角色设定', sent: true },
    { type: 'output_rules', registryId: 'output.chat_protocol', content: '输出规则', sent: true }
  ]
});
assert.strictEqual(manifest.mode, 'shadow');
assert.strictEqual(manifest.sources.length, 2);
assert.strictEqual(manifest.request.toolsChars > 0, true);
assert.strictEqual(manifest.coverage.retiredSourceLeak, false);
assert(store.has('ovo_last_context_manifest'));

// Static boundary checks for the first migration stage.
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const id of ['setting-bilingual-mode', 'setting-group-bilingual-mode', 'setting-phone-control-enabled', 'family-card-create-modal']) {
  assert(!html.includes(`id="${id}"`), `retired UI id should be absent: ${id}`);
}
const dock = fs.readFileSync(path.join(root, 'js/modules/floating_ball.js'), 'utf8');
for (const token of ['proment', 'open-coverage', 'renderMemoryPayloadAudit', 'renderCapabilityCoverage', 'export-history', 'download-operation-report']) {
  assert(!dock.includes(token), `floating ball should not contain ${token}`);
}
const chatAi = fs.readFileSync(path.join(root, 'js/modules/chat_ai.js'), 'utf8');
const promptStart = chatAi.indexOf('function generatePrivateSystemPrompt');
const promptEnd = chatAi.indexOf('function getChatTokenBreakdown', promptStart);
const promptCode = chatAi.slice(promptStart, promptEnd > promptStart ? promptEnd : undefined);
for (const token of ['<family_card_from_user>', '<family_card_to_user>', '<peek_awareness>', '<peek_impersonation_awareness>', '<alt_shared_memory>', '<main_shared_memory>', '双语模式特别指令', '【重要：剧情摘要】']) {
  assert(!promptCode.includes(token), `retired prompt token should be absent: ${token}`);
}
assert(chatAi.includes('buildShadowManifest'));
assert(chatAi.includes('contextManifest,'));

console.log('V5.4 context retirement tests passed.');
