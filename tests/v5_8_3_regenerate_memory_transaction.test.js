const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const sandbox = {
  console,
  setTimeout(fn) { fn(); },
  clearTimeout() {},
  showToast() {},
  saveCharacter: async () => {},
  db: { characters: [] },
  document: { getElementById() { return null; } }
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

(async () => {
  const M = sandbox.MemoryV5;
  const chat = { id: 'transaction-chat', history: [] };
  sandbox.db.characters.push(chat);
  const store = M.model.ensureStore(chat);
  const tableId = 'v5_recent_events';

  // 基线记录由用户创建，不属于任何可撤销AI轮次。
  let report = M.engine.applyOperations(chat, [{
    tableId,
    action: 'add',
    values: { 分类: '工作', 标题: '项目状态', 内容: '尚未开始', 事项状态: '待办' }
  }], { origin: 'manual' });
  assert.equal(report.changed.length, 1);
  const recordId = report.changed[0].recordId;
  const baseline = JSON.parse(JSON.stringify(store.records[tableId][0]));

  // 分支A更新后会生成完整前后镜像事务。
  report = M.engine.applyOperations(chat, [{
    tableId,
    action: 'upsert',
    recordId,
    values: { 内容: '方案A已经完成', 事项状态: '已完结' }
  }], { origin: 'ai', roundId: 'round_A' });
  assert.equal(report.changed.length, 1);
  const branchA = JSON.parse(JSON.stringify(store.records[tableId][0]));
  const txA = M.engine.getRoundTransaction(chat, 'round_A');
  assert(txA && txA.mutations.length === 1);
  assert.equal(txA.mutations[0].before.content, baseline.content);
  assert.equal(txA.mutations[0].after.content, branchA.content);

  let transition = await M.engine.rollbackRound(chat, 'round_A', { persist: false });
  assert.equal(transition.ok, true);
  assert.equal(store.records[tableId][0].content, baseline.content);
  assert.equal(M.engine.getRoundTransaction(chat, 'round_A').status, 'rolled_back');

  // 分支B从同一基线生成；切回A时先撤B，再恢复A。
  report = M.engine.applyOperations(chat, [{
    tableId,
    action: 'upsert',
    recordId,
    values: { 内容: '方案B仍在进行', 事项状态: '已发生' }
  }], { origin: 'ai', roundId: 'round_B' });
  assert.equal(report.changed.length, 1);
  assert.equal(store.records[tableId][0].content, '方案B仍在进行');

  transition = await M.engine.rollbackRounds(chat, ['round_B'], { persist: false });
  assert.equal(transition.ok, true);
  transition = await M.engine.restoreRounds(chat, ['round_A'], { persist: false });
  assert.equal(transition.ok, true);
  assert.equal(store.records[tableId][0].content, branchA.content);
  assert.equal(store.records[tableId][0].values[M.model.fieldId(store.tables.find(t => t.id === tableId), '事项状态')], '已完结');

  // 新增记录同样可撤销和重做。
  report = M.engine.applyOperations(chat, [{
    tableId,
    action: 'add',
    values: { 分类: '生活', 标题: '临时记录', 内容: '只属于本轮回复' }
  }], { origin: 'ai', roundId: 'round_add' });
  const addedId = report.changed[0].recordId;
  assert(store.records[tableId].some(row => row.id === addedId));
  await M.engine.rollbackRound(chat, 'round_add', { persist: false });
  assert(!store.records[tableId].some(row => row.id === addedId));
  await M.engine.restoreRound(chat, 'round_add', { persist: false });
  assert(store.records[tableId].some(row => row.id === addedId));

  // 外部写入（角色自主收藏）可登记到同一轮次事务。
  const favoriteTable = store.tables.find(table => table.id === M.constants.FAVORITE_TABLE_ID);
  const favorite = M.model.normalizeRecord({
    id: 'favorite_round_record',
    content: '角色本轮收藏的消息',
    source: '用户明确',
    roundId: 'round_favorite'
  }, favoriteTable);
  store.records[favoriteTable.id].push(favorite);
  M.engine.recordRoundMutation(chat, 'round_favorite', {
    tableId: favoriteTable.id,
    recordId: favorite.id,
    before: null,
    after: favorite
  });
  await M.engine.rollbackRound(chat, 'round_favorite', { persist: false });
  assert(!store.records[favoriteTable.id].some(row => row.id === favorite.id));
  await M.engine.restoreRound(chat, 'round_favorite', { persist: false });
  assert(store.records[favoriteTable.id].some(row => row.id === favorite.id));

  // 后续手动编辑会触发冲突保护，不会被重回误覆盖。
  report = M.engine.applyOperations(chat, [{
    tableId,
    action: 'upsert',
    recordId,
    values: { 内容: '本轮AI更新' }
  }], { origin: 'ai', roundId: 'round_conflict' });
  assert.equal(report.changed.length, 1);
  store.records[tableId][0].content = '用户随后手动修正';
  transition = await M.engine.rollbackRound(chat, 'round_conflict', { persist: false });
  assert.equal(transition.ok, false);
  assert.equal(store.records[tableId][0].content, '用户随后手动修正');

  // 标准化和持久化往返必须保留事务日志。
  const normalized = M.model.normalizeStore(JSON.parse(JSON.stringify(store)));
  assert(normalized.roundTransactions.some(tx => tx.roundId === 'round_A'));

  // 聊天入口必须使用系统事务API，而不是局部字段删除补丁。
  const chatAi = fs.readFileSync(path.join(root, 'js/modules/chat_ai.js'), 'utf8');
  const versions = fs.readFileSync(path.join(root, 'js/modules/msg_version.js'), 'utf8');
  const favorites = fs.readFileSync(path.join(root, 'js/modules/favorites.js'), 'utf8');
  assert(chatAi.includes('rollbackRegeneratedMemory'));
  assert(chatAi.includes('MemoryTableSidecar.rollbackRounds'));
  assert(versions.includes('_switchMemoryRounds'));
  assert(versions.includes('restoreRounds'));
  assert(favorites.includes('recordRoundMutation'));
  assert(favorites.includes('roundId: options.roundId || null'));

  console.log('V5.8.3 regenerate memory transaction tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
