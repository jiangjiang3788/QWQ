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
    const list = listeners.get(type) || [];
    listeners.set(type, list.filter(item => item !== listener));
  },
  dispatchEvent(event) {
    (listeners.get(event.type) || []).forEach(listener => listener(event));
  },
  console,
  location: { href: 'https://app.local/' },
  CustomEvent: CustomEventMock
};
const context = vm.createContext({ window: windowMock, sessionStorage: windowMock.sessionStorage, CustomEvent: CustomEventMock, console, Error, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Promise, URL, AbortController, DOMException, Response, ReadableStream, performance, setTimeout, clearTimeout, fetch: async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }) });
vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/operation_runtime.js'), 'utf8'), context);
const runtime = windowMock.OVOOperationRuntime;
assert(runtime, 'operation runtime missing');
assert(/^2\.10-R(?:[123](?:\.[123])?)$/.test(runtime.VERSION));

const op = runtime.start('chat.reply', { title: '生成测试角色回复', scope: { characterId: 'c1' } });
runtime.stage(op.id, '发送模型请求');
runtime.attachRequest(op.id, { id: 'ai_test', provider: 'newapi', model: 'm1', endpoint: 'https://example.com/v1/chat', body: { messages: [{ role: 'user', content: 'hello' }], apiKey: 'secret' } });
runtime.updateRequest(op.id, 'ai_test', { phase: 'completed', ok: true, durationMs: 20 });
runtime.complete(op.id, { summary: '回复完成', result: { addedMessages: 1 } });
const finished = runtime.get(op.id);
assert.strictEqual(finished.status, 'success');
assert.strictEqual(finished.requests.length, 1);
assert(finished.requests[0].bodyPreview.includes('hello'));
assert(!finished.requests[0].bodyPreview.includes('secret'));

(async () => {
  vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/ai_request_runtime.js'), 'utf8'), context);
  const response = await windowMock.OVOAIRequestRuntime.request({ task: 'journal-summary', source: 'journal', provider: 'newapi', model: 'm2', endpoint: 'https://example.com/v1/chat/completions', body: { model: 'm2', messages: [{ role: 'user', content: 'summarize' }] } });
  assert.strictEqual(response.status, 200);
  const implicit = runtime.list({ limit: 1 })[0];
  assert.strictEqual(implicit.status, 'success');
  assert.strictEqual(implicit.requests[0].phase, 'completed');

  const result = await runtime.run('memory.table.update', { title: '更新档案', successSummary: '档案完成' }, async () => ({ status: 'waiting_review' }));
  assert.strictEqual(result.status, 'waiting_review');
  const latest = runtime.list({ limit: 1 })[0];
  assert.strictEqual(latest.status, 'success');
  assert.strictEqual(latest.summary, '档案完成');

  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert(indexHtml.indexOf('js/modules/operation_runtime.js') < indexHtml.indexOf('js/modules/ai_request_runtime.js'));
  const aiRuntime = fs.readFileSync(path.join(root, 'js/modules/ai_request_runtime.js'), 'utf8');
  const chatAi = fs.readFileSync(path.join(root, 'js/modules/chat_ai.js'), 'utf8');
  const theater = fs.readFileSync(path.join(root, 'js/modules/theater.js'), 'utf8');
  const memory = fs.readFileSync(path.join(root, 'js/modules/memory_table.js'), 'utf8');
  const dock = fs.readFileSync(path.join(root, 'js/modules/floating_ball.js'), 'utf8');
  assert(aiRuntime.includes('runtime.attachRequest(operationId'));
  assert(chatAi.includes("start(operationType"));
  assert(chatAi.includes('operationId: operationRecord?.id'));
  assert(theater.includes("start('theater.generate'"));
  assert(theater.includes("start('theater.character'"));
  assert(memory.includes("run('memory.table.update'"));
  assert(dock.includes('AI 操作中心'));
  assert(dock.includes('查看最终原始请求'));
  assert(dock.includes('取消本次操作'));
  console.log('V2.10-R0 OPERATION CENTER CHECKS: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
