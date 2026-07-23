const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const storage = new Map();
const listeners = new Map();
class CustomEventMock { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
const windowMock = {
  sessionStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  },
  addEventListener(type, listener) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(listener);
  },
  removeEventListener(type, listener) {
    listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener));
  },
  dispatchEvent(event) { (listeners.get(event.type) || []).forEach(listener => listener(event)); },
  location: { href: 'https://app.local/' },
  CustomEvent: CustomEventMock,
  console
};
const context = vm.createContext({
  window: windowMock, sessionStorage: windowMock.sessionStorage, CustomEvent: CustomEventMock,
  console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Error, Promise,
  URL, AbortController, DOMException, Response, ReadableStream, performance, setTimeout, clearTimeout,
  fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
});

vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/ai_capability_catalog.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/operation_runtime.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/ai_request_runtime.js'), 'utf8'), context);

const catalog = windowMock.OVOAICapabilityCatalog;
const runtime = windowMock.OVOOperationRuntime;
const aiRuntime = windowMock.OVOAIRequestRuntime;
assert(catalog && runtime && aiRuntime, 'R4 runtimes missing');
assert.strictEqual(catalog.VERSION, '2.10-R4');
assert(['2.10-R4', '2.10-R5', '2.10-R6', '2.11-R0', '2.11-R1', '2.11-R2', '2.11-R3.1', '2.11-R4', '2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3'].includes(runtime.VERSION));
assert.strictEqual(aiRuntime.VERSION, '2.10-R4');
assert(catalog.list().length >= 27, 'capability catalog should cover the current AI surface');

const expected = {
  'avatar-recognition': 'vision.avatar.recognize',
  'sticker-recognition': 'vision.sticker.recognize',
  'image-description': 'vision.image.describe',
  'gpt-image-generation': 'image.generate.gpt',
  'novelai-image-generation': 'image.generate.novelai',
  'legacy-video-call': 'call.reply',
  'legacy-call-summary': 'call.summary',
  'battery-interaction': 'interaction.battery',
  'block-system': 'safety.block.check',
  'vector-embedding': 'memory.vector.embedding',
  'vector-summary': 'memory.vector.summary',
  'memory-table-embedding': 'memory.embedding',
  'journal-generation': 'journal.generate',
  'journal-summary': 'journal.summary'
};
Object.entries(expected).forEach(([task, type]) => assert.strictEqual(catalog.resolve({ task }).type, type, task));
assert.strictEqual(catalog.resolve({ task: 'memory-table-summary-update' }).type, 'memory.table.update');

const literalTasks = new Set();
for (const file of walk(path.join(root, 'js'))) {
  if (!file.endsWith('.js')) continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const regex of [/\btask\s*:\s*['"]([^'"]+)['"]/g, /\bruntimeTask\s*:\s*['"]([^'"]+)['"]/g]) {
    let match;
    while ((match = regex.exec(source))) literalTasks.add(match[1]);
  }
}
const unresolved = [...literalTasks].filter(task => task !== 'generic-ai' && catalog.resolve({ task }).type === 'ai.request');
assert.deepStrictEqual(unresolved, [], `unregistered literal tasks: ${unresolved.join(', ')}`);

(async () => {
  const response = await aiRuntime.request({
    task: 'avatar-recognition', source: 'avatar-recognition', provider: 'newapi', model: 'vision-model',
    endpoint: 'https://example.com/v1/chat/completions', body: { model: 'vision-model', messages: [{ role: 'user', content: 'describe' }] }
  });
  assert.strictEqual(response.status, 200);
  const latest = runtime.list({ limit: 1 })[0];
  assert.strictEqual(latest.type, 'vision.avatar.recognize');
  assert.strictEqual(latest.title, '识别头像内容');
  assert.strictEqual(latest.status, 'success');
  assert.strictEqual(aiRuntime.getCapabilityCoverage()[0].type, 'vision.avatar.recognize');

  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert(index.indexOf('ai_capability_catalog.js') < index.indexOf('operation_runtime.js'));
  const dock = fs.readFileSync(path.join(root, 'js/modules/floating_ball.js'), 'utf8');
  const sticker = fs.readFileSync(path.join(root, 'js/modules/sticker.js'), 'utf8');
  const chatAi = fs.readFileSync(path.join(root, 'js/modules/chat_ai.js'), 'utf8');
  const battery = fs.readFileSync(path.join(root, 'js/modules/battery_interaction.js'), 'utf8');
  const block = fs.readFileSync(path.join(root, 'js/modules/block_system.js'), 'utf8');
  const journal = fs.readFileSync(path.join(root, 'js/modules/journal.js'), 'utf8');
  assert(dock.includes('AI 功能覆盖'));
  assert(dock.includes('open-coverage'));
  assert(sticker.includes("start?.('vision.sticker.batch'"));
  assert(sticker.includes("entityType: 'sticker'"));
  assert(chatAi.includes("startChild(parentOperationId, 'vision.image.describe'"));
  assert(chatAi.includes("title: '写入聊天图片描述'"));
  assert(battery.includes("start?.('interaction.battery'"));
  assert(block.includes("entityType: 'friend_request'"));
  assert(journal.includes("entityType: 'journal'"));
  console.log('V2.10-R4 AI CAPABILITY COVERAGE CHECKS: PASS');
})().catch(error => { console.error(error); process.exit(1); });

function walk(dir) {
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(full));
    else output.push(full);
  }
  return output;
}
