const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const storage = new Map();
const context = {
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
  sessionStorage: {
    setItem(key, value) { storage.set(key, String(value)); },
    getItem(key) { return storage.get(key) || null; }
  },
  db: {
    magicRoom: {
      contextPolicy: {
        structuredEnabled: true,
        structuredBudget: 4,
        historyEnabled: true,
        historyCount: 2,
        statusEnabled: false
      }
    }
  },
  OVORetiredFeaturePolicy: {
    sanitizeSystemPrompt(value) { return String(value || ''); },
    sanitizeRequestBody() {},
    auditRequest() { return { ok: true, findings: [] }; }
  }
};
context.window = context;
vm.createContext(context);
for (const file of ['js/core/context_source_registry.js', 'js/core/context_compiler.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

const body = {
  model: 'test-model',
  stream: true,
  temperature: 0.8,
  messages: [
    { role: 'system', content: 'CORE\n你的当前状态是：在线。\n<memory_live_context>活跃待办</memory_live_context>\n<structured_archive_memory>abcdefgh</structured_archive_memory>\nOUTPUT' },
    { role: 'user', content: '旧用户消息' },
    { role: 'assistant', content: '旧角色消息' },
    { role: 'user', content: '本轮用户输入' },
    { role: 'user', content: '[incipere]' },
    { role: 'assistant', content: '<thinking>' }
  ],
  tools: [{ type: 'web_search' }]
};

const compiled = context.OVOContextCompiler.compilePrivateChatRequest({
  task: 'chat.reply', provider: 'openai', model: 'test-model', requestBody: body
});
assert.strictEqual(compiled.mode, 'compiled');
assert(compiled.systemPrompt.includes('<structured_archive_memory>\nabcd\n</structured_archive_memory>'), 'structured memory should obey real budget');
assert(!compiled.systemPrompt.includes('活跃待办'), 'status/live context should be removed when disabled');
assert(!compiled.systemPrompt.includes('你的当前状态是'), 'character status should be removed when disabled');
assert.strictEqual(body.messages.some(item => item.content === '旧用户消息'), false, 'history should be trimmed');
assert.strictEqual(body.messages.some(item => item.content === '旧角色消息'), true, 'last two conversational messages should remain');
assert.strictEqual(body.messages.some(item => item.content === '本轮用户输入'), true, 'current input must remain');
assert.strictEqual(body.messages.some(item => item.content === '[incipere]'), true, 'control message must remain');

const manifest = context.OVOContextSourceRegistry.buildCompiledManifest({
  task: 'chat.reply', provider: 'openai', model: 'test-model', requestBody: body,
  policy: compiled.policy, compileChanges: compiled.changes,
  promptSources: [
    { type: 'structured_memory', registryId: 'memory.structured', content: 'abcd', sent: true },
    { type: 'output_rules', registryId: 'output.chat_protocol', content: 'OUTPUT', sent: true }
  ]
});
assert.strictEqual(manifest.mode, 'compiled');
assert.strictEqual(manifest.coverage.unregisteredMessageChars, 0);
assert.deepStrictEqual(manifest.coverage.unregisteredTools, []);
assert.deepStrictEqual(manifest.coverage.unregisteredParams, []);
assert.strictEqual(manifest.coverage.complete, true);
assert(manifest.sources.some(item => item.sourceId === 'chat.current_input' && item.chars > 0));
assert(manifest.sources.some(item => item.sourceId === 'request.tools' && item.chars > 0));

context.db.magicRoom.contextPolicy = {
  structuredEnabled: false,
  structuredBudget: 1800,
  historyEnabled: false,
  historyCount: 30,
  statusEnabled: true
};
const disabledBody = {
  model: 'test-model',
  messages: [
    { role: 'system', content: 'CORE\n<structured_archive_memory>memory</structured_archive_memory>' },
    { role: 'user', content: '历史问题' },
    { role: 'assistant', content: '历史回答' },
    { role: 'user', content: '当前问题' },
    { role: 'assistant', content: '<thinking>' }
  ]
};
context.OVOContextCompiler.compilePrivateChatRequest({ provider: 'openai', requestBody: disabledBody });
assert(!disabledBody.messages[0].content.includes('structured_archive_memory'), 'disabled structured memory must not enter real request');
assert.strictEqual(disabledBody.messages.some(item => item.content === '历史问题'), false);
assert.strictEqual(disabledBody.messages.some(item => item.content === '历史回答'), false);
assert.strictEqual(disabledBody.messages.some(item => item.content === '当前问题'), true);
assert.strictEqual(disabledBody.messages.some(item => item.content === '<thinking>'), true);

const indexText = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(indexText.includes('js/core/context_compiler.js?v=543'), 'compiler must load before chat requests');
const chatText = fs.readFileSync(path.join(root, 'js/modules/chat_ai.js'), 'utf8');
assert(chatText.includes('buildCompiledManifest'), 'private chat should use compiled manifest');
assert(chatText.includes('WorldBookContextProvider'), 'chat module should call the worldbook domain provider');
const uiText = fs.readFileSync(path.join(root, 'js/features/memory_v3/memory_ui_v3.js'), 'utf8');
assert(uiText.includes('mv5-kv-groups'));
assert(!uiText.includes("field.aiHint ? `<small>${esc(field.aiHint)}</small>` : ''}</div><span class=\"mv5-col-resizer\""), 'row headers should not show aiHint');
const cssText = fs.readFileSync(path.join(root, 'css/modules/memory_v3.css'), 'utf8');
assert(cssText.includes('.mv5-kv-group-head { padding: 0 2px; color: #2f3d43; font-size: 16px;'));
assert(cssText.includes('.mv5-kv-list { display: flex; flex-direction: column; }'));
assert(cssText.includes('.mv5-kv-record:not(:last-child) { border-bottom: 1px solid #dce5e7; }'));

console.log('V5.4.1 context compiler tests passed.');
