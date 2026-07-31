const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');

function loadMemorySandbox(extra = {}) {
  const sandbox = Object.assign({
    console,
    Map,
    Set,
    Promise,
    AbortController,
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
    sessionStorage: { setItem() {}, getItem() { return null; } },
    document: { getElementById() { return null; } },
    db: { characters: [], groups: [], globalReceiveSound: '', apiSettings: {}, piggyBank: {} },
    currentChatId: 'flow_chat',
    currentChatType: 'private',
    currentPage: 1,
    isGenerating: false,
    currentReplyAbortController: null,
    saveCharacter: async () => {},
    saveGroup: async () => {},
    saveData: async () => {},
    saveCurrentChat: async () => {},
    renderChatList() {},
    renderMessages() {},
    addMessageBubble() {},
    showToast() {},
    recalculateChatStatus() {},
    getMixedContent(value) { return value.trim() ? [{ type: 'text', content: value.trim() }] : []; },
    getEffectivePersona() { return ''; },
    getActiveWorldBooksContents() { return { before: '', middle: '', after: '' }; },
    getRandomValue(value) { return value; },
    generateUUID: (() => { let index = 0; return () => `restored_${++index}`; })()
  }, extra);
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
  sandbox.MemoryTableSidecar = {
    rollbackRounds: M.engine.rollbackRounds,
    restoreRounds: M.engine.restoreRounds,
    extractSidecar: M.engine.extractSidecar,
    processReply: M.engine.processReply,
    applySidecar: M.engine.applySidecar,
    completeRound: M.engine.completeRound,
    ensureState: M.engine.ensureSidecarState
  };
  sandbox.MemoryTablePolicy = {
    beginRound: M.rounds.beginRound,
    finishRound: M.rounds.finishRound,
    cancelRound: M.rounds.finishRound
  };
  return { sandbox, M };
}

(async () => {
  // “重回”主入口：删除AI回复前，先撤销同一轮写入的记忆。
  {
    const { sandbox, M } = loadMemorySandbox();
    vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/chat_ai.js'), 'utf8'), sandbox, { filename: 'js/modules/chat_ai.js' });
    const chat = {
      id: 'flow_chat',
      history: [{ id: 'user_1', role: 'user', content: '继续', memoryRoundId: 'round_regen' }]
    };
    sandbox.db.characters.push(chat);
    M.engine.applyOperations(chat, [{
      tableId: 'v5_recent_events',
      action: 'add',
      values: { 分类: '工作', 标题: '本轮新增', 内容: '只属于即将被重回的回复' }
    }], { origin: 'ai', roundId: 'round_regen' });
    chat.history.push({ id: 'assistant_1', role: 'assistant', content: '旧回复', memoryRoundId: 'round_regen' });
    let replyCalls = 0;
    sandbox.getAiReply = async () => { replyCalls += 1; };

    const result = await sandbox._doRegenerate(chat, 0);
    assert.equal(result, true);
    assert.equal(chat.history.length, 1);
    assert.equal(M.model.ensureStore(chat).records.v5_recent_events.length, 0);
    assert.equal(replyCalls, 1);
  }

  // “版本→恢复此版本”：撤销当前分支记忆，并重做目标分支记忆。
  {
    const { sandbox, M } = loadMemorySandbox();
    vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/msg_version.js'), 'utf8'), sandbox, { filename: 'js/modules/msg_version.js' });
    const chat = { id: 'flow_chat', history: [] };
    sandbox.db.characters.push(chat);
    const store = M.model.ensureStore(chat);
    const baselineWrite = M.engine.applyOperations(chat, [{
      tableId: 'v5_recent_events',
      action: 'add',
      values: { 分类: '工作', 标题: '分支状态', 内容: '基线' }
    }], { origin: 'manual' });
    const recordId = baselineWrite.changed[0].recordId;
    const user = {
      id: 'user_version',
      role: 'user',
      content: '选哪个方案',
      memoryRoundId: 'round_B',
      _regenVersions: []
    };
    chat.history.push(user);

    M.engine.applyOperations(chat, [{
      tableId: 'v5_recent_events', action: 'upsert', recordId, values: { 内容: '分支A记忆' }
    }], { origin: 'ai', roundId: 'round_A' });
    await M.engine.rollbackRound(chat, 'round_A', { persist: false });
    M.engine.applyOperations(chat, [{
      tableId: 'v5_recent_events', action: 'upsert', recordId, values: { 内容: '分支B记忆' }
    }], { origin: 'ai', roundId: 'round_B' });
    chat.history.push({ id: 'assistant_B', role: 'assistant', content: '回复B', memoryRoundId: 'round_B' });
    user._regenVersions.push({
      replies: [{ content: '回复A', role: 'assistant', timestamp: 1, memoryRoundId: 'round_A' }],
      memoryRoundIds: ['round_A'],
      savedAt: 1
    });

    const result = await sandbox.MsgVersion.restoreVersion('user_version', 0);
    assert.equal(result.ok, true);
    assert.equal(chat.history[1].content, '回复A');
    assert.equal(store.records.v5_recent_events[0].content, '分支A记忆');
  }

  console.log('V5.8.3 regenerate/version memory flow tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
