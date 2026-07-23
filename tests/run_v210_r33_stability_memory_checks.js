const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const chat = read('js/modules/chat_ai.js');
const chatUi = read('js/chat.js');
const ui = read('js/ui.js');
const main = read('js/main.js');
const tasks = read('js/modules/memory_table_tasks.js');
const memoryTable = read('js/modules/memory_table.js');
const feedback = read('js/modules/memory_table_feedback.js');
const dock = read('js/modules/floating_ball.js');
const dockCss = read('css/modules/quick_dock.css');

// Static task/UI architecture checks.
assert(chat.includes('const activeChatReplyTasks'), 'per-chat reply task registry missing');
assert(chat.includes('function persistChatEntity'), 'explicit chat persistence helper missing');
assert(chat.includes("dedupeKey: isBackground ? '' : `chat-reply:${chatType}:${chatId}"), 'dedupe key is not bound to target chat');
assert(chat.includes('activeChatReplyTasks.delete(replyTaskKey)'), 'completed reply task is not removed by target key');
assert(chatUi.includes('OVOChatReplyTasks.syncUi(chatId, type)'), 'opening a chat does not recover its active UI state');
assert(ui.includes('OVOChatReplyTasks?.syncUi?.()'), 'leaving chat does not safely detach the UI controller');
assert(main.includes("StartupRuntime.defer('resume-memory-task-queues'"), 'memory queues are not resumed at application startup');
assert(memoryTable.includes('async function resumeQueuedMemoryTasks'), 'global memory queue resume function missing');
assert(tasks.includes('function getRuntimeState()'), 'memory task runtime state missing');
assert(main.includes("AI 或记忆任务仍在运行"), 'browser leave warning for active tasks missing');
assert(dock.includes("classList.toggle('quick-dock-panel--app-fullscreen', state.open)"), 'floating ball does not open as a full-screen app');
assert(dockCss.includes('.quick-dock-root.quick-dock--open .quick-dock-ball{visibility:hidden'), 'floating ball is not covered/hidden while open');
assert(dock.includes('aria-label="关闭操作中心"'), 'full-screen operation center close button missing');
assert(feedback.includes('pendingFeedbackTtlDays: 7'), 'feedback expiry default missing');
assert(feedback.includes("snapshot.status = 'expired'"), 'stale feedback is not expired');
assert(feedback.includes('clearExpiredRounds'), 'expired feedback cleanup missing');
assert(dock.includes('本次聊天记忆核验'), 'final payload memory audit UI missing');

function extractFunction(source, name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} missing`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = null, escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`cannot extract ${name}`);
}

// Verify archive memory is checked in the final provider payload, not only in an intermediate prompt.
const updates = [];
const storage = new Map();
const sandbox = {
  Date, String, Array, Object, JSON, RegExp, Error,
  sessionStorage: { setItem: (k, v) => storage.set(k, String(v)), getItem: k => storage.get(k) || null },
  window: {
    OvoMemory: { context: { get: () => '核心档案：用户重视长期一致性。' } },
    OVOOperationRuntime: { update: (id, patch) => updates.push({ id, patch }) }
  }
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext([
  extractFunction(chat, 'extractPromptTagContent'),
  extractFunction(chat, 'getStructuredArchiveContextApi'),
  extractFunction(chat, 'hasStructuredArchiveMemory'),
  extractFunction(chat, 'getStructuredArchiveMemoryContext'),
  extractFunction(chat, 'ensureStructuredArchivePromptInjection'),
  extractFunction(chat, 'readSystemPromptFromRequestBody'),
  extractFunction(chat, 'writeSystemPromptToRequestBody'),
  extractFunction(chat, 'auditAndEnsurePrivateChatMemoryPayload'),
  'this.api={auditAndEnsurePrivateChatMemoryPayload,readSystemPromptFromRequestBody};'
].join('\n'), sandbox);
const character = { id: 'char-1', memoryMode: 'vector', memoryTables: { enabled: true, boundTemplateIds: ['tpl-1'] } };
const openaiBody = { messages: [{ role: 'system', content: '角色基础提示' }, { role: 'user', content: '你好' }] };
const openaiResult = sandbox.api.auditAndEnsurePrivateChatMemoryPayload(character, openaiBody, 'openai', 'op-1');
assert(openaiResult.audit.structuredArchiveSent, 'OpenAI final payload did not receive structured archive');
assert(openaiBody.messages[0].content.includes('<structured_archive_memory>'), 'OpenAI system message missing archive tag');
assert.strictEqual((openaiBody.messages[0].content.match(/<structured_archive_memory>/g) || []).length, 1, 'OpenAI archive duplicated');
assert(updates.some(item => item.id === 'op-1' && item.patch.memoryPayloadAudit.structuredArchiveSent), 'operation audit was not persisted');

const geminiBody = { contents: [{ role: 'user', parts: [{ text: '你好' }] }], system_instruction: { parts: [{ text: '角色基础提示' }] } };
const geminiResult = sandbox.api.auditAndEnsurePrivateChatMemoryPayload(character, geminiBody, 'gemini', 'op-2');
assert(geminiResult.audit.structuredArchiveSent, 'Gemini final payload did not receive structured archive');
assert(geminiBody.system_instruction.parts[0].text.includes('<structured_archive_memory>'), 'Gemini system instruction missing archive tag');
assert.strictEqual((geminiBody.system_instruction.parts[0].text.match(/<structured_archive_memory>/g) || []).length, 1, 'Gemini archive duplicated');

// Verify old pending usage-feedback requests expire without touching actual memories.
const feedbackSandbox = {
  console, Date, Math, JSON, Array, String, Number, Boolean, Object, Set, Map,
  CustomEvent: function(type, init){ this.type = type; this.detail = init?.detail; },
  window: { db: { memoryTableTemplates: [] }, dispatchEvent: () => true }
};
feedbackSandbox.window.window = feedbackSandbox.window;
vm.createContext(feedbackSandbox);
vm.runInContext(read('js/features/memory/kernel.js'), feedbackSandbox);
vm.runInContext(feedback, feedbackSandbox);
const Feedback = feedbackSandbox.window.MemoryTableFeedback;
const old = Date.now() - 9 * 86400000;
const chatWithOldFeedback = {
  id: 'char-old',
  memoryTables: {
    data: { keep: 'underlying memory remains' },
    feedback: {
      settings: { pendingFeedbackTtlDays: 7 },
      rounds: [{ id: 'old-round', createdAt: old, status: 'open', requestStatus: 'completed', items: [{ id: 'item-1', feedback: 'pending' }] }],
      events: []
    }
  }
};
const state = Feedback.ensureState(chatWithOldFeedback);
assert.strictEqual(state.rounds[0].status, 'expired', 'old pending feedback was not expired');
assert.strictEqual(state.rounds[0].items[0].feedback, 'expired', 'old feedback item was not marked expired');
assert.strictEqual(Feedback.getPendingCount(chatWithOldFeedback), 0, 'expired feedback still counts as pending');
assert.strictEqual(chatWithOldFeedback.memoryTables.data.keep, 'underlying memory remains', 'feedback expiry altered actual memory');
assert.strictEqual(Feedback.clearExpiredRounds(chatWithOldFeedback), 1, 'expired feedback cleanup failed');

const recentRounds = Array.from({ length: 6 }, (_, index) => ({
  id: `round-${index}`,
  createdAt: Date.now() - index * 60000,
  completedAt: Date.now() - index * 60000,
  status: 'open', requestStatus: 'completed', items: [{ id: `item-${index}`, feedback: 'pending' }]
}));
recentRounds.push({ id: 'prepared-old', createdAt: Date.now() - 3 * 3600000, status: 'open', requestStatus: 'prepared', items: [{ id: 'prepared-item', feedback: 'pending' }] });
const chatWithManyFeedback = { id: 'char-many', memoryTables: { feedback: { settings: { maxPendingFeedbackRounds: 3 }, rounds: recentRounds, events: [] } } };
const manyState = Feedback.ensureState(chatWithManyFeedback);
assert.strictEqual(manyState.rounds.filter(item => item.status === 'open' && item.requestStatus === 'completed').length, 3, 'more than three completed rounds remain actionable');
assert.strictEqual(manyState.rounds.filter(item => item.status === 'expired').length, 4, 'superseded/prepared feedback rounds were not expired');
assert.strictEqual(manyState.rounds.find(item => item.id === 'prepared-old').requestStatus, 'abandoned', 'stale prepared feedback was not abandoned');

console.log('V2.10-R3.3 STABILITY + MEMORY PAYLOAD CHECKS: PASS');
