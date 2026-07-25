const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const memory = new Map();
const storage = {
  getItem(key) { return memory.has(key) ? memory.get(key) : null; },
  setItem(key, value) { memory.set(key, String(value)); },
  removeItem(key) { memory.delete(key); }
};
const listeners = new Map();
const windowObject = {
  sessionStorage: storage,
  localStorage: storage,
  addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
  removeEventListener() {},
  dispatchEvent(event) { (listeners.get(event.type) || []).forEach(fn => fn(event)); },
  OVOAICapabilityCatalog: { list: () => [] },
  OVOPromptTrace: { build() { throw new Error('Manifest request must not fall back to PromptTrace'); } }
};
windowObject.window = windowObject;
const context = vm.createContext({
  window: windowObject,
  sessionStorage: storage,
  localStorage: storage,
  CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  console,
  Date,
  JSON,
  Map,
  Set,
  Math,
  String,
  Number,
  Boolean,
  Array,
  Object,
  Error,
  RegExp
});
vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/operation_runtime.js'), 'utf8'), context, { filename: 'operation_runtime.js' });
const runtime = windowObject.OVOOperationRuntime;
assert(runtime, 'Operation runtime missing');
assert.strictEqual(runtime.VERSION, '2.15');

const op = runtime.start('chat.reply', { title: '测试请求', scope: { characterId: 'char_1' } });
const manifest = {
  task: 'chat.reply', provider: 'openai', model: 'gpt-test',
  sources: [
    { sourceId: 'character.profile', title: '角色档案', included: true, chars: 120, reason: '实际发送' },
    { sourceId: 'worldbook.active', title: '世界书', included: false, chars: 0, reason: '用户关闭' }
  ],
  coverage: { complete: true, retiredSourceLeak: false }
};
const request = runtime.attachRequest(op.id, {
  task: 'chat.reply', source: 'test', provider: 'openai', model: 'gpt-test',
  body: { model: 'gpt-test', messages: [{ role: 'user', content: 'hi' }] },
  contextManifest: manifest
});
assert(request, 'Request was not attached');
assert.strictEqual(request.promptTrace, null, 'Manifest request should not build PromptTrace');
assert.strictEqual(request.sourceSummary.included, 1);
assert.strictEqual(request.sourceSummary.excluded, 1);
assert.strictEqual(request.sourceSummary.chars, 120);
assert.strictEqual(request.sourceSummary.complete, true);

for (let index = 0; index < 25; index += 1) {
  const item = runtime.start('ai.request', { title: `操作${index}` });
  runtime.complete(item.id, { summary: '完成' });
}
assert(runtime.list({ limit: 100 }).length <= 20, 'Single-user history should be limited to 20 records');
assert(runtime.getStorageStats().budget === 260000, 'Storage budget not converged');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(html.includes('proment-source-registry-list'));
assert(html.includes('proment-real-request-content'));
assert(html.includes('proment_governance.js?v=544'));
assert(!html.includes('id="proment-preview-context"'), 'Old simulation preview should not remain visible');
assert(!html.includes('id="proment-compare-runtime"'), 'Old design/runtime comparison should not remain visible');
assert(!html.includes('id="proment-preview-worldbook"'), 'Old worldbook diagnostic should not remain visible');
assert(!html.includes('id="proment-preview-ai-request"'), 'Old AI diagnostic should not remain visible');

const dock = fs.readFileSync(path.join(root, 'js/modules/floating_ball.js'), 'utf8');
assert(dock.includes('request?.contextManifest'));
assert(dock.includes('完整 Prompt 与真实清单请在 Proment 查看'));
assert(!dock.includes('downloadText(filename'));
assert(!dock.includes('reportFilename(prefix'));

console.log('V5.4.3 governance and compact operation tests passed.');
