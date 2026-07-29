const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const storage = new Map();
let captured = null;
const context = {
  console, Date, JSON, Math, Map, Set, Object, Array, String, Number, Boolean, RegExp, Error, TypeError,
  sessionStorage: {
    setItem(key, value) { storage.set(key, String(value)); },
    getItem(key) { return storage.get(key) || null; }
  },
  OVORetiredFeaturePolicy: {
    sanitizeRequestBody() {},
    auditRequest() { return { ok: true, findings: [] }; }
  },
  OVOAIRequestRuntime: {
    async request(options) { captured = options; return { ok: true, options }; }
  }
};
context.window = context;
vm.createContext(context);
for (const file of ['js/core/context_source_registry.js', 'js/core/ai_request_gateway.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

(async () => {
  const body = {
    model: 'vision-model',
    messages: [{ role: 'user', content: [{ type: 'text', text: '描述图片' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } }] }],
    temperature: 0.2
  };
  await context.OVOAIRequestGateway.send({
    task: 'avatar-recognition', source: 'avatar-recognition', provider: 'openai-compatible', model: 'vision-model',
    endpoint: 'https://example.invalid/v1/chat/completions', headers: {}, body,
    promptSources: [
      { type: 'task_instruction', content: '描述图片', title: '识别要求' },
      { type: 'user_input', registryId: 'media.image_input', content: '[图片内容]', title: '头像图片' }
    ]
  });
  assert(captured, 'gateway must call the runtime');
  assert.strictEqual(captured.canonicalTask, 'vision.avatar.recognize');
  assert.strictEqual(captured.contextManifest.mode, 'task-compiled');
  assert.strictEqual(captured.contextManifest.task, 'vision.avatar.recognize');
  assert.strictEqual(captured.contextManifest.coverage.complete, true);
  assert(captured.contextManifest.sources.some(item => item.sourceId === 'media.image_input'));
  assert(captured.contextManifest.sources.some(item => item.sourceId === 'request.parameters'));

  const precompiled = { mode: 'compiled', task: 'chat.reply', coverage: { complete: true } };
  await context.OVOAIRequestGateway.send({
    task: 'private-chat', provider: 'openai-compatible', model: 'chat-model', endpoint: 'x', headers: {},
    body: { model: 'chat-model', messages: [{ role: 'user', content: '你好' }] }, contextManifest: precompiled
  });
  assert.strictEqual(captured.contextManifest, precompiled, 'chat compiled manifest must be preserved');
  assert.strictEqual(captured.canonicalTask, 'chat.reply');

  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const compilerPos = index.indexOf('js/core/context_compiler.js?v=544');
  const runtimePos = index.indexOf('js/modules/ai_request_runtime.js');
  const gatewayPos = index.indexOf('js/core/ai_request_gateway.js?v=544');
  const chatPos = index.indexOf('js/modules/chat_ai.js?v=544');
  assert(compilerPos > 0 && runtimePos > compilerPos && gatewayPos > runtimePos && chatPos > gatewayPos, 'compiler/runtime/gateway/chat load order is invalid');

  const aiFiles = [
    'js/utils.js', 'js/modules/chat_ai.js', 'js/modules/avatar_recognition.js', 'js/modules/sticker.js',
    'js/modules/battery_interaction.js', 'js/modules/block_system.js', 'js/core/api_service_registry.js'
  ];
  aiFiles.forEach(file => {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert(!text.includes('OVOAIRequestRuntime.request('), `${file} must not bypass gateway`);
  });
  const utils = fs.readFileSync(path.join(root, 'js/utils.js'), 'utf8');
  assert(utils.includes('OVOAIRequestGateway.send'), 'generic AI utility must use gateway');

  const memoryEngine = fs.readFileSync(path.join(root, 'js/features/memory_v3/memory_engine_v3.js'), 'utf8');
  assert(memoryEngine.includes("global.openMemoryTableForCharacter(chat.id, table.id)"), 'state bar must open the current-state table');
  assert(memoryEngine.includes("element.onclick = openMemory"), 'state bar must support click navigation');
  assert(memoryEngine.includes("event.key !== 'Enter' && event.key !== ' '"), 'state bar must support keyboard navigation');

  const memoryCore = fs.readFileSync(path.join(root, 'js/features/memory_v3/memory_core_v3.js'), 'utf8');
  assert(memoryCore.includes("const VERSION = '5.5.0'"));
  assert(memoryCore.includes('const STORE_VERSION = 3'));

  console.log('V5.4.2 AI gateway tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
