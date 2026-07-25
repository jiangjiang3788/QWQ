const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const room = { classList: { contains: value => value === 'active' } };
const rendered = [];
const session = new Map();
const sandbox = {
  console,
  Map,
  Set,
  Promise,
  AbortController,
  setTimeout: fn => { fn(); return 1; },
  clearTimeout() {},
  sessionStorage: {
    setItem(key, value) { session.set(key, value); },
    getItem(key) { return session.get(key) || null; }
  },
  document: {
    getElementById(id) {
      if (id === 'chat-room-screen') return room;
      return null;
    }
  },
  db: { characters: [], groups: [], globalReceiveSound: '', apiSettings: {}, piggyBank: {} },
  currentChatId: 'char_integration',
  currentChatType: 'private',
  currentPage: 1,
  isGenerating: false,
  currentReplyAbortController: null,
  saveCharacter: async () => {},
  saveGroup: async () => {},
  renderChatList() {},
  renderMessages() {},
  addMessageBubble(message) { rendered.push(message.content); },
  showToast() {},
  getMixedContent(value) { return value.trim() ? [{ type: 'text', content: value.trim() }] : []; },
  getEffectivePersona() { return ''; },
  getActiveWorldBooksContents() { return { before: '', middle: '', after: '' }; },
  getRandomValue(value) { return value; }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of [
  'js/features/memory_v3/memory_core_v3.js',
  'js/features/memory_v3/memory_rounds_v3.js',
  'js/features/memory_v3/memory_engine_v3.js'
]) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}
const M = sandbox.MemoryV5;
sandbox.getMemoryTableContextBlock = M.engine.getContextBlock;
sandbox.MemoryTableSidecar = {
  extractSidecar: M.engine.extractSidecar,
  applySidecar: M.engine.applySidecar,
  processReply: M.engine.processReply,
  completeRound: M.engine.completeRound,
  ensureState: M.engine.ensureSidecarState
};
sandbox.MemoryTablePolicy = {
  finishRound: M.rounds.finishRound
};

vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/chat_ai.js'), 'utf8'), sandbox, { filename: 'js/modules/chat_ai.js' });
assert.equal(typeof sandbox.handleAiReplyContent, 'function');
assert.equal(typeof sandbox.auditAndEnsurePrivateChatMemoryPayload, 'function');

const chat = {
  id: 'char_integration',
  realName: '测试角色',
  remarkName: '测试角色',
  myName: '用户',
  history: [],
  nodes: [],
  source: '',
  phoneControlEnabled: false,
  avatarSystemEnabled: false,
  familyCardEnabled: false,
  supplementPersonaAiEnabled: false
};
sandbox.db.characters.push(chat);
const store = M.model.ensureStore(chat);
assert.equal(Object.values(store.records).flat().length, 0);

// 空表已启用但没有任何可发送记录时，不得阻止聊天请求。
const emptyRequest = { messages: [{ role: 'system', content: '角色系统提示' }, { role: 'user', content: '你好' }] };
const emptyAudit = sandbox.auditAndEnsurePrivateChatMemoryPayload(chat, emptyRequest, 'openai', null);
assert.equal(emptyAudit.audit.structuredArchiveExpected, false);
assert.equal(emptyAudit.audit.structuredArchiveSent, false);
assert.equal(emptyRequest.messages[0].content, '角色系统提示');

// 有真实记录时仍必须注入结构化档案。
let write = M.engine.applyOperations(chat, [{
  tableId: 'v5_core_profile', action: 'add',
  values: { 分类: '用户', 标题: '称呼', 内容: '用户希望被称为小海' }
}], { origin: 'manual' });
assert.equal(write.changed.length, 1);
const filledRequest = { messages: [{ role: 'system', content: '角色系统提示' }, { role: 'user', content: '你好' }] };
const filledAudit = sandbox.auditAndEnsurePrivateChatMemoryPayload(chat, filledRequest, 'openai', null);
assert.equal(filledAudit.audit.structuredArchiveExpected, true);
assert.equal(filledAudit.audit.structuredArchiveSent, true);
assert(filledRequest.messages[0].content.includes('<structured_archive_memory>'));

(async () => {
  // 真实handleAiReplyContent调用链：转义闭合标签和内部JSON必须在消息拆分前清除。
  rendered.length = 0;
  chat.history.length = 0;
  await sandbox.handleAiReplyContent(
    '这是可见回复\n{"operations":[]}\n<\\/memory_ops>',
    chat,
    chat.id,
    'private',
    true,
    false,
    null,
    null
  );
  assert.equal(chat.history.filter(item => item.role === 'assistant').length, 1);
  assert.equal(chat.history.find(item => item.role === 'assistant').content, '这是可见回复');
  assert(rendered.every(content => !content.includes('operations') && !content.includes('memory_ops')));

  // 有效指令通过同一主流程写入，但不会成为聊天气泡。
  rendered.length = 0;
  chat.history.length = 0;
  await sandbox.handleAiReplyContent(
    '我记住了。\n<memory_ops>{"operations":[{"tableId":"v5_items","action":"add","source":"用户明确","values":{"分类":"设备","标题":"测试线材","内容":"用户准备购买测试线材","物品状态":"待购买"}}]}</memory_ops>',
    chat,
    chat.id,
    'private',
    true,
    false,
    null,
    null
  );
  assert.equal(chat.history.filter(item => item.role === 'assistant').length, 1);
  assert.equal(chat.history.find(item => item.role === 'assistant').content, '我记住了。');
  assert(store.records.v5_items.some(record => record.title === '测试线材'));
  assert(rendered.every(content => !content.includes('operations') && !content.includes('memory_ops')));

  console.log('Memory V5.2.0 chat integration tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
