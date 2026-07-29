const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const indexHtml = read('index.html');
assert(indexHtml.includes('id="proment-history-count" min="0"'));
assert(indexHtml.includes('0 = 全部；不设最大值'));
assert(!/id="proment-history-count"[^>]*max="200"/.test(indexHtml));

const chatAi = read('js/modules/chat_ai.js');
assert(chatAi.includes('function getRequestHistorySlice(chat, chatType, sourceHistory)'));
assert(chatAi.includes("Number(policy.historyCount) === 0"));
assert(chatAi.includes('getRequestHistorySlice(chat, chatType, chat.history)'));
assert(chatAi.includes('getRequestHistorySlice(chat, chatType, nodeMsgs)'));
assert(chatAi.includes('function dedupeFavoriteInventory(items)'));
assert(chatAi.includes('metadata: { favoriteType: block.kind }'));
assert(chatAi.includes('metadata: { groupedBy: \'tableName\' }'));

const dock = read('js/modules/floating_ball.js');
assert(dock.includes("const PACKAGE_VERSION = '5.6.6'"));
assert(dock.includes('function renderGroupedSourceItems(groups)'));
assert(dock.includes("title: '用户收藏'"));
assert(dock.includes("title: '角色收藏'"));
assert(dock.includes('function renderStructuredMemorySource(section)'));
assert(dock.includes('quick-dock-source-flat-list'));
assert(dock.includes('历史不设上限（发送全部可用消息）'));

const css = read('css/modules/quick_dock.css');
assert(css.includes('QWQ 5.6.6'));
assert(css.includes('overflow:hidden!important'));
assert(css.includes('.quick-dock-panel.quick-dock-panel--app-fullscreen .quick-dock-panel-content'));
assert(css.includes('overflow-y:auto'));
assert(css.includes('.quick-dock-source-groups'));
assert(css.includes('max-height:none!important'));

// Compiler: 0 means all; counts above 200 are not capped.
{
  const storage = { setItem() {}, getItem() { return null; } };
  const windowObject = { db: { magicRoom: { contextPolicy: { historyEnabled: true, historyCount: 0 } } }, sessionStorage: storage };
  windowObject.window = windowObject;
  const context = vm.createContext({ window: windowObject, sessionStorage: storage, console, Date, JSON, Math, Number, String, Array, Object, Set, Map, RegExp });
  vm.runInContext(read('js/core/context_compiler.js'), context, { filename: 'context_compiler.js' });
  const makeBody = n => ({ messages: [{ role: 'system', content: 'sys' }, ...Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }))] });
  let result = windowObject.OVOContextCompiler.compilePrivateChatRequest({ provider: 'newapi', requestBody: makeBody(650), systemPrompt: 'sys' });
  assert.strictEqual(result.requestBody.messages.filter(item => item.role !== 'system').length, 650);
  windowObject.db.magicRoom.contextPolicy.historyCount = 500;
  result = windowObject.OVOContextCompiler.compilePrivateChatRequest({ provider: 'newapi', requestBody: makeBody(650), systemPrompt: 'sys' });
  assert.strictEqual(result.requestBody.messages.filter(item => item.role !== 'system').length, 500);
  windowObject.db.magicRoom.contextPolicy.historyCount = 1000;
  result = windowObject.OVOContextCompiler.compilePrivateChatRequest({ provider: 'newapi', requestBody: makeBody(650), systemPrompt: 'sys' });
  assert.strictEqual(result.requestBody.messages.filter(item => item.role !== 'system').length, 650);
}

// Registry: count, metadata, and all 208 favorite items survive into the final manifest.
{
  const storage = { setItem() {}, getItem() { return null; } };
  const windowObject = { sessionStorage: storage };
  windowObject.window = windowObject;
  const context = vm.createContext({ window: windowObject, sessionStorage: storage, console, Date, JSON, Math, Number, String, Array, Object, Set, Map, RegExp });
  vm.runInContext(read('js/core/context_source_registry.js'), context, { filename: 'context_source_registry.js' });
  const items = Array.from({ length: 208 }, (_, i) => ({ id: `fav-${i}`, title: `收藏 ${i + 1}`, content: `内容 ${i + 1}`, sent: true, metadata: { favoriteType: i < 16 ? 'user' : 'character' } }));
  const manifest = windowObject.OVOContextSourceRegistry.buildCompiledManifest({
    provider: 'newapi', model: 'test',
    requestBody: { messages: [{ role: 'system', content: '收藏正文' }, { role: 'user', content: '你好' }] },
    promptSources: [{ registryId: 'collection.relevant', type: 'favorite_inventory', title: '收藏盘点', content: '收藏正文', count: 208, metadata: { favoriteCounts: { user: 16, character: 192, total: 208 } }, items, sent: true, traceMode: 'request_exact' }]
  });
  const source = manifest.sources.find(item => item.sourceId === 'collection.relevant');
  assert(source);
  assert.strictEqual(source.count, 208);
  assert.strictEqual(source.items.length, 208);
  assert.strictEqual(source.metadata.favoriteCounts.character, 192);
}

// Runtime: latest operation no longer truncates every array to 120 items.
{
  const memory = new Map();
  const storage = { getItem(k) { return memory.get(k) || null; }, setItem(k, v) { memory.set(k, String(v)); }, removeItem(k) { memory.delete(k); } };
  const listeners = new Map();
  const windowObject = {
    sessionStorage: storage,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    removeEventListener() {},
    dispatchEvent(event) { (listeners.get(event.type) || []).forEach(fn => fn(event)); },
    OVOAICapabilityCatalog: { list: () => [] }
  };
  windowObject.window = windowObject;
  const context = vm.createContext({ window: windowObject, sessionStorage: storage, CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, console, Date, JSON, Map, Set, Math, String, Number, Boolean, Array, Object, Error, RegExp });
  vm.runInContext(read('js/modules/operation_runtime.js'), context, { filename: 'operation_runtime.js' });
  const runtime = windowObject.OVOOperationRuntime;
  assert.strictEqual(runtime.VERSION, '2.17');
  const items = Array.from({ length: 208 }, (_, i) => ({ id: `fav-${i}`, title: `收藏 ${i + 1}`, content: `内容 ${i + 1}`, metadata: { favoriteType: i < 16 ? 'user' : 'character' } }));
  const op = runtime.start('chat.reply', { title: '收藏完整性测试' });
  runtime.attachRequest(op.id, {
    provider: 'newapi', model: 'test',
    body: { messages: Array.from({ length: 201 }, (_, i) => ({ role: 'user', content: `m${i}` })) },
    contextManifest: { sources: [{ sourceId: 'collection.relevant', count: 208, metadata: { favoriteCounts: { user: 16, character: 192, total: 208 } }, items }] }
  });
  const saved = runtime.get(op.id).requests[0];
  assert.strictEqual(saved.contextManifest.sources[0].items.length, 208);
  assert.strictEqual(JSON.parse(saved.bodyPreview).messages.length, 201);
}

console.log('V5.6.6 grouped inventory, unbounded history, and scroll regression tests passed.');
