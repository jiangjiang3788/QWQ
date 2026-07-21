const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.resolve(__dirname, '..');
const kernelCode = fs.readFileSync(path.join(root, 'js/features/memory/kernel.js'), 'utf8');
const code = fs.readFileSync(path.join(root, 'js/modules/memory_table_tasks.js'), 'utf8');
let diagnosticSeq = 0;
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  Intl,
  Date,
  Math,
  JSON,
  saveCharacter: async () => true,
  window: {
    OVOAIRequestRuntime: {
      getLastDiagnostic: () => diagnosticSeq ? ({ id: `diag${diagnosticSeq}`, task: 'memory-table-summary-update', source: 'memory-table', model: 'test', status: 200, requestChars: 2100, responseBytes: 600, durationMs: 50, queueWaitMs: 0, completedAt: new Date().toISOString() }) : null,
      getRecentDiagnostics: () => []
    }
  }
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(kernelCode, sandbox);
vm.runInContext(code, sandbox);
const Tasks = sandbox.window.MemoryTableTasks;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const chat = { id: 'chat1', memoryTables: { rounds: [{ id: 'round1' }] } };
  const state = Tasks.ensureState(chat);
  assert(state.schemaVersion === '2.6', 'schema version');

  let calls = 0;
  Tasks.registerExecutor('table_update', async (_chat, payload) => {
    calls += 1;
    diagnosticSeq += 1;
    if (payload.failOnce && calls === 1) {
      const error = new Error('temporary network error');
      error.ovoType = 'network';
      throw error;
    }
    if (payload.review) return { status: 'pending_review', batchId: 'batch1' };
    if (payload.huge) return { status: 'success', changedFields: ['x'], range: { start: 1, end: 2, info: { runtime: { taskQueue: 'x'.repeat(200000) }, history: ['y'.repeat(200000)] } } };
    return { status: 'success', changedFields: ['x'] };
  });
  Tasks.registerExecutor('local_test', async () => ({ status: 'success' }));

  const first = Tasks.enqueueTableUpdate(chat, { templateId: 'tpl', tableId: 'table', range: { start: 1, end: 20 }, source: 'auto', apiMode: 'summary', estimatedInputChars: 3000, title: 'test' });
  const duplicate = Tasks.enqueueTableUpdate(chat, { templateId: 'tpl', tableId: 'table', range: { start: 1, end: 20 }, source: 'auto', apiMode: 'summary', estimatedInputChars: 3000, title: 'test' });
  assert(!first.deduped && duplicate.deduped, 'idempotent duplicate');
  assert(first.task.id === duplicate.task.id, 'same task returned');

  await Tasks.process(chat, { maxTasks: 1, force: true, ignoreRoundLimit: true });
  assert(first.task.status === 'succeeded', 'task succeeded');
  assert(first.task.actual && first.task.actual.requestChars === 2100, 'diagnostic captured');

  const hugeTask = Tasks.enqueue(chat, 'table_update', { chatId: chat.id, templateId: 'tpl', tableId: 'huge', range: { start: 1, end: 2 }, source: 'manual', apiMode: 'main', huge: true }, { apiMode: 'main', force: true }).task;
  await Tasks.process(chat, { taskId: hugeTask.id, maxTasks: 1, force: true, ignoreRoundLimit: true });
  assert(JSON.stringify(hugeTask.result).length < 10000, 'persisted result compact');
  assert(!hugeTask.result.range.info, 'runtime/history removed from persisted range');

  const retryTask = Tasks.enqueue(chat, 'table_update', { chatId: chat.id, templateId: 'tpl', tableId: 'retry', range: { start: 21, end: 30 }, source: 'auto', apiMode: 'main', failOnce: true }, { apiMode: 'main', force: true }).task;
  calls = 0;
  await Tasks.process(chat, { taskId: retryTask.id, maxTasks: 1, force: true, ignoreRoundLimit: true });
  assert(retryTask.status === 'queued' && retryTask.attempts === 1, 'transient retry queued');
  retryTask.nextRetryAt = 0;
  await Tasks.process(chat, { taskId: retryTask.id, maxTasks: 1, force: true, ignoreRoundLimit: true });
  assert(retryTask.status === 'succeeded' && retryTask.attempts === 2, 'retry succeeds');

  const reviewTask = Tasks.enqueue(chat, 'table_update', { chatId: chat.id, templateId: 'tpl', tableId: 'review', range: { start: 31, end: 40 }, source: 'auto', apiMode: 'summary', review: true }, { apiMode: 'summary', force: true }).task;
  await Tasks.process(chat, { taskId: reviewTask.id, maxTasks: 1, force: true, ignoreRoundLimit: true });
  assert(reviewTask.status === 'waiting_review' && reviewTask.reviewBatchId === 'batch1', 'waiting review');
  Tasks.resolveReviewBatch(chat, 'batch1', 'applied');
  assert(reviewTask.status === 'succeeded', 'review resolution');

  const interruptedChat = { id: 'chat2', memoryTables: { taskQueue: { settings: { autoResume: true }, tasks: [{ id: 'old', type: 'local_test', status: 'running', attempts: 1, createdAt: Date.now(), payload: {}, apiTask: false }] } } };
  const recovered = Tasks.ensureState(interruptedChat);
  assert(recovered.tasks[0].status === 'queued', 'interrupted recovered');
  assert(recovered.stats.recovered === 1, 'recovery counted');

  const limitChat = { id: 'chat3', memoryTables: { rounds: [{ id: 'r1' }] } };
  Tasks.updateSettings(limitChat, { perRoundApiLimit: 1, maxTasksPerCycle: 2 });
  const a = Tasks.enqueue(limitChat, 'table_update', { chatId: 'chat3', templateId: 't', tableId: 'a', range: { start: 1, end: 2 }, source: 'auto', apiMode: 'main' }, { apiMode: 'main', force: true }).task;
  const b = Tasks.enqueue(limitChat, 'table_update', { chatId: 'chat3', templateId: 't', tableId: 'b', range: { start: 3, end: 4 }, source: 'auto', apiMode: 'main' }, { apiMode: 'main', force: true }).task;
  await Tasks.process(limitChat, { maxTasks: 2 });
  assert(a.status === 'succeeded', 'first within round limit');
  assert(b.status === 'queued' && b.lastErrorType === 'round_limit', 'second deferred by round limit');

  Tasks.setPaused(limitChat, true);
  assert(Tasks.ensureState(limitChat).settings.paused === true, 'queue paused');
  Tasks.setPaused(limitChat, false);
  assert(Tasks.ensureState(limitChat).settings.paused === false, 'queue resumed');

  console.log('V2.6 TASK QUEUE CHECKS: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
