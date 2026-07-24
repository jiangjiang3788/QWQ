const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const storage = new Map();
const listeners = new Map();
class CustomEventMock { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
const windowMock = {
  sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
  addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
  removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener)); },
  dispatchEvent(event) { (listeners.get(event.type) || []).forEach(listener => listener(event)); },
  CustomEvent: CustomEventMock,
  console
};
const context = vm.createContext({ window: windowMock, sessionStorage: windowMock.sessionStorage, CustomEvent: CustomEventMock, console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Error, Promise });
vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/operation_runtime.js'), 'utf8'), context);
const runtime = windowMock.OVOOperationRuntime;
assert(['2.10-R3', '2.10-R3.1', '2.10-R3.2', '2.10-R3.3', '2.10-R4', '2.10-R5', '2.10-R6', '2.11-R0', '2.11-R1', '2.11-R2', '2.11-R3.1', '2.11-R4', '2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2', '2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1', '2.14-R9', '2.15-R0A', '2.15-R0B'].includes(runtime.VERSION));
assert.strictEqual(typeof runtime.recordMutation, 'function');
assert.strictEqual(typeof runtime.recordMutations, 'function');
const parent = runtime.start('chat.reply', { title: '生成角色回复' });
const sidecar = runtime.startChild(parent.id, 'memory.sidecar', { title: '档案更新' });
runtime.recordMutation(sidecar.id, { action: 'update', entityType: 'character_memory', entityId: 'char-1', title: '角色状态', before: '平静', after: '紧张' });
runtime.complete(sidecar.id, { summary: '档案更新完成' });
runtime.recordMutations(parent.id, [
  { action: 'create', entityType: 'chat_message', entityId: 'msg-1', title: '角色消息', after: '你好' },
  { action: 'create', entityType: 'chat_message', entityId: 'msg-2', title: '角色消息', after: '今天过得怎么样？' }
]);
const finalParent = runtime.get(parent.id);
assert.strictEqual(finalParent.mutations.length, 2);
assert.strictEqual(finalParent.mutationSummary.total, 3);
assert.strictEqual(finalParent.mutationSummary.created, 2);
assert.strictEqual(finalParent.mutationSummary.updated, 1);
assert.strictEqual(finalParent.mutationSummary.descendant, 1);
assert(!JSON.stringify(finalParent).includes('apiKey'));

const operationJs = fs.readFileSync(path.join(root, 'js/modules/operation_runtime.js'), 'utf8');
const dock = fs.readFileSync(path.join(root, 'js/modules/floating_ball.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'js/modules/chat_ai.js'), 'utf8');
const memory = fs.readFileSync(path.join(root, 'js/modules/memory_table.js'), 'utf8');
const memoryReviewUseCase = fs.readFileSync(path.join(root, 'js/features/memory/review_orchestrator.js'), 'utf8');
const journal = fs.readFileSync(path.join(root, 'js/modules/journal.js'), 'utf8');
const vector = fs.readFileSync(path.join(root, 'js/modules/vector_memory.js'), 'utf8');
const theater = fs.readFileSync(path.join(root, 'js/modules/theater.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/modules/quick_dock.css'), 'utf8');
assert(operationJs.includes('MUTATION_LIMIT'));
assert(operationJs.includes('mutationSummary'));
assert(dock.includes('数据变化'));
assert(dock.includes('renderOperationMutations'));
assert(css.includes('quick-dock-mutation-item'));
assert(chat.includes("entityType: 'chat_message'"));
assert(chat.includes("entityType: 'character_memory'"));
assert(memoryReviewUseCase.includes("entityType: 'structured_memory'"));
assert(memoryReviewUseCase.includes("entityType: 'memory_review'"));
assert(memory.includes("start?.('memory.review.apply'"));
assert(journal.includes("entityType: 'journal'"));
assert(vector.includes("entityType: 'vector_memory'"));
assert(theater.includes("entityType: 'theater'"));
console.log('V2.10-R3 MUTATION RECEIPT CHECKS: PASS');
