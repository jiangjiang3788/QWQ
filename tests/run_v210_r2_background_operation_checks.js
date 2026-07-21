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
  addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
  removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener)); },
  dispatchEvent(event) { (listeners.get(event.type) || []).forEach(listener => listener(event)); },
  CustomEvent: CustomEventMock,
  console
};
const context = vm.createContext({ window: windowMock, sessionStorage: windowMock.sessionStorage, CustomEvent: CustomEventMock, console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Error, Promise });
vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/operation_runtime.js'), 'utf8'), context);
const runtime = windowMock.OVOOperationRuntime;
assert(runtime, 'operation runtime missing');
assert(/^2\.10-R(?:[23](?:\.[123])?)$/.test(runtime.VERSION));

const parent = runtime.start('chat.reply', { title: '生成阿墨的回复' });
runtime.complete(parent.id, { summary: '回复已完成' });
const journal = runtime.startChild(parent.id, 'journal.auto', { stage: '检查消息间隔' });
runtime.skip(journal.id, '尚未达到 100 条消息的总结间隔', { result: { unsummarizedCount: 23, interval: 100 } });
const table = runtime.startChild(parent.id, 'memory.table.auto', { stage: '检查到期档案表' });
runtime.complete(table.id, { summary: '已处理 1 个档案任务', result: { updatedCount: 1 } });
const vector = runtime.startChild(parent.id, 'memory.vector.auto', { stage: '生成向量记忆摘要' });
runtime.fail(vector.id, new Error('测试失败'));

const finalParent = runtime.get(parent.id);
assert.deepStrictEqual(finalParent.childIds.length, 3);
assert.strictEqual(finalParent.background.total, 3);
assert.strictEqual(finalParent.background.success, 1);
assert.strictEqual(finalParent.background.skipped, 1);
assert.strictEqual(finalParent.background.failed, 1);
assert.strictEqual(runtime.getChildren(parent.id).length, 3);
assert.strictEqual(runtime.list({ rootsOnly: true }).length, 1);
assert.strictEqual(runtime.getCurrent().id, parent.id);

const chat = fs.readFileSync(path.join(root, 'js/modules/chat_ai.js'), 'utf8');
const journalJs = fs.readFileSync(path.join(root, 'js/modules/journal.js'), 'utf8');
const memory = fs.readFileSync(path.join(root, 'js/modules/memory_table.js'), 'utf8');
const vectorJs = fs.readFileSync(path.join(root, 'js/modules/vector_memory.js'), 'utf8');
const theater = fs.readFileSync(path.join(root, 'js/modules/theater.js'), 'utf8');
const dock = fs.readFileSync(path.join(root, 'js/modules/floating_ball.js'), 'utf8');
assert(chat.includes('backgroundOperationOptions'));
assert(chat.includes("startChild?.(parentOperationId, 'memory.sidecar'"));
assert(journalJs.includes("startChild(options.parentOperationId || null, 'journal.auto'"));
assert(memory.includes("startChild(options.parentOperationId || null, 'memory.table.auto'"));
assert(vectorJs.includes("startChild(options.parentOperationId || null, 'memory.vector.auto'"));
assert(theater.includes('本次未命中'));
assert(theater.includes('operationId: operation?.id'));
assert(dock.includes('后台工作'));
assert(dock.includes('renderChildOperationList'));
assert(dock.includes('V2.10-R2') || dock.includes('V2.10-R3'));
console.log('V2.10-R2 BACKGROUND OPERATION CHECKS: PASS');
