const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const notices = [];
const stateElement = {
  textContent: '',
  style: { display: 'none' },
  classList: {
    values: new Set(['hidden']),
    add(value) { this.values.add(value); },
    remove(value) { this.values.delete(value); },
    contains(value) { return this.values.has(value); },
    toggle(value, force) {
      if (force === true) this.values.add(value);
      else if (force === false) this.values.delete(value);
      else if (this.values.has(value)) this.values.delete(value);
      else this.values.add(value);
    }
  }
};
const sandbox = {
  console,
  setTimeout: fn => { fn(); return 1; },
  clearTimeout() {},
  confirm: () => true,
  alert() {},
  showToast: message => notices.push(message),
  saveCharacter: async () => {},
  db: { characters: [] },
  document: {
    getElementById(id) {
      if (id === 'memory-live-state-bar') return stateElement;
      return null;
    }
  }
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
assert.equal(M.VERSION, '5.2.0');
assert.equal(M.STORE_VERSION, 3, '升级必须继续使用原STORE_VERSION，避免清空已有表格');
const chat = { id: 'char_1', history: [
  { id: 'a0', role: 'assistant', content: '上一轮回复' },
  { id: 'u1', role: 'user', content: '昨晚没睡好。' },
  { id: 'u2', role: 'user', content: '今天要完成报告，还想买一条充电线。' }
]};
sandbox.db.characters.push(chat);
const store = M.model.ensureStore(chat);
assert.equal(store.tables.length, 9);
assert.equal(store.settings.roundNoticeEnabled, true);
assert.equal(store.tables.filter(t => t.behavior.writePolicy === 'auto' && t.behavior.allowAiWrite).length, 5);
assert.equal(store.tables.find(t => t.id === 'v5_current_state').behavior.retentionDays, 0);

const token = M.rounds.beginRound(chat);
assert.equal(M.rounds.roundPayload(chat).length, 2);
assert(M.rounds.roundText(chat).includes('昨晚没睡好'));
assert(M.rounds.roundText(chat).includes('充电线'));
const prompt = M.engine.buildSystemPrompt(chat);
assert(prompt.includes('<memory_v5_protocol version="5.2.0">'));
assert(prompt.includes('昨晚没睡好'));
assert(prompt.includes('v5_current_state'));
assert(prompt.includes('v5_recent_events'));
assert(prompt.includes('<memory_ops>'));
assert(!prompt.includes('v5_core_profile" name="核心档案">'));

// 核心、中期、长期权限在执行器中硬限制，即便配置被改为可写也不能绕过。
let report = M.engine.applyOperations(chat, [{
  tableId: 'v5_core_profile', action: 'add', source: 'AI判断',
  values: { 分类: '用户', 标题: '测试', 内容: '不能写入' }
}], { origin: 'ai', roundId: token.id });
assert.equal(report.changed.length, 0);
assert.equal(report.rejected.length, 1);
const summaryTable = store.tables.find(t => t.id === 'v5_event_summary');
summaryTable.behavior.writePolicy = 'auto';
summaryTable.behavior.allowAiWrite = true;
report = M.engine.applyOperations(chat, [{
  tableId: summaryTable.id, action: 'add', source: 'AI判断',
  values: { 分类: '阶段总结', 标题: '绕过测试', 内容: '不能由聊天AI写入' }
}], { origin: 'ai', roundId: token.id });
assert.equal(report.changed.length, 0);
assert(report.rejected[0].reason.includes('聊天AI没有写入权限'));

// 同一回复可写入多张短期表。
report = M.engine.applyOperations(chat, [
  { tableId: 'v5_current_state', action: 'add', source: '用户明确', values: { 分类: '用户状态', 标签: ['疲惫', '需关注'], 标题: '精神状态', 内容: '睡眠不足，精力偏低' } },
  { tableId: 'v5_recent_events', action: 'add', source: '用户明确', values: { 分类: '工作', 标签: ['待办'], 标题: '完成报告', 内容: '今天需要完成报告', 事项状态: '待办', 相关主体: ['报告'] } },
  { tableId: 'v5_items', action: 'add', source: '用户明确', values: { 分类: '设备', 标签: ['待购买'], 标题: '充电线', 内容: '想购买一条充电线', 物品状态: '待购买', 所属人: '用户' } },
  { tableId: 'v5_daily_observation', action: 'add', source: '用户明确', values: { 分类: '睡眠', 标签: ['不足'], 标题: '昨夜睡眠', 内容: '昨晚睡眠不好', 状况: '不足' } }
], { origin: 'ai', roundId: token.id });
assert.equal(report.changed.length, 4);
assert.equal(store.records.v5_current_state.length, 1);
assert.equal(store.records.v5_recent_events.length, 1);
assert.equal(store.records.v5_items.length, 1);
assert.equal(store.records.v5_daily_observation.length, 1);
assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(store.records.v5_current_state[0].time));

// 状态栏必须使用页面真实ID并正常显示。
M.engine.refreshStateBar(chat);
assert(stateElement.textContent.includes('睡眠不足'));
assert.equal(stateElement.style.display, '');
assert(!stateElement.classList.contains('hidden'));

// 标签/多选顺序改变不算真实更新。
const stateRecord = store.records.v5_current_state[0];
const oldTime = stateRecord.time;
report = M.engine.applyOperations(chat, [{
  tableId: 'v5_current_state', action: 'upsert', recordId: stateRecord.id, source: '用户明确',
  values: { 标签: ['需关注', '疲惫'], 内容: '睡眠不足，精力偏低' }
}], { origin: 'ai', roundId: 'round_same' });
assert.equal(report.changed.length, 0);
assert.equal(report.checked.length, 1);
assert.equal(stateRecord.time, oldTime);
assert.equal(stateRecord.roundId, token.id);

// 合法更新旧行，不产生重复。
const eventRecord = store.records.v5_recent_events[0];
report = M.engine.applyOperations(chat, [{
  tableId: 'v5_recent_events', action: 'upsert', recordId: eventRecord.id, source: '用户明确',
  values: { 事项状态: '已完结', 结果: '报告已经提交' }
}], { origin: 'ai', roundId: 'round_finish' });
assert.equal(report.changed.length, 1);
assert.equal(store.records.v5_recent_events.length, 1);
assert.equal(eventRecord.values[M.model.fieldId(store.tables.find(t => t.id === 'v5_recent_events'), '事项状态')], '已完结');

// 非法select必须整体拒绝，不能伪造更新时间或绿点。
const beforeInvalidTime = eventRecord.time;
const beforeInvalidUpdatedAt = eventRecord.updatedAt;
report = M.engine.applyOperations(chat, [{
  tableId: 'v5_recent_events', action: 'upsert', recordId: eventRecord.id, source: 'AI判断',
  values: { 事项状态: '已经差不多完成' }
}], { origin: 'ai', roundId: 'round_invalid_select' });
assert.equal(report.changed.length, 0);
assert.equal(report.rejected.length, 1);
assert.equal(eventRecord.time, beforeInvalidTime);
assert.equal(eventRecord.updatedAt, beforeInvalidUpdatedAt);

// upsert目标不存在时不能偷偷创建残缺记录。
const beforeMissingUpsertCount = store.records.v5_recent_events.length;
report = M.engine.applyOperations(chat, [{
  tableId: 'v5_recent_events', action: 'upsert', recordId: 'missing_record', source: 'AI判断',
  values: { 事项状态: '已完结' }
}], { origin: 'ai', roundId: 'round_missing' });
assert.equal(report.changed.length, 0);
assert.equal(report.rejected.length, 1);
assert.equal(store.records.v5_recent_events.length, beforeMissingUpsertCount);

// add缺少分类/标题/内容时拒绝，不能创建空白记录。
report = M.engine.applyOperations(chat, [{
  tableId: 'v5_recent_events', action: 'add', source: 'AI判断',
  values: { 事项状态: '待办' }
}], { origin: 'ai', roundId: 'round_incomplete_add' });
assert.equal(report.changed.length, 0);
assert(report.rejected[0].reason.includes('缺少必要内容'));
assert.equal(store.records.v5_recent_events.length, beforeMissingUpsertCount);

// 日常观察用本地日期+分类+标题识别同一天记录，不比较精确秒数。
const dailyRecord = store.records.v5_daily_observation[0];
report = M.engine.applyOperations(chat, [{
  tableId: 'v5_daily_observation', action: 'upsert', source: '用户明确',
  values: { 分类: '睡眠', 标题: '昨夜睡眠', 内容: '补充：夜里醒了两次' }
}], { origin: 'ai', roundId: 'round_daily_update' });
assert.equal(report.changed.length, 1);
assert.equal(store.records.v5_daily_observation.length, 1);
assert.equal(dailyRecord.content, '补充：夜里醒了两次');

// AI删除仍禁止。
report = M.engine.applyOperations(chat, [{ tableId: 'v5_recent_events', action: 'delete', recordId: eventRecord.id }], { origin: 'ai', roundId: 'round_delete' });
assert.equal(report.rejected.length, 1);
assert.equal(store.records.v5_recent_events.length, 1);

// 严格schema：未知顶层字段和未知操作字段均报错。
assert.throws(() => M.engine.validateSidecarPayload({ operations: [], extra: true }), /未知字段/);
assert.throws(() => M.engine.validateSidecarPayload({ operations: [{ tableId: 'x', action: 'add', values: {}, extra: true }] }), /未知字段/);

// 标准、转义闭合、缺失开始标签、残缺JSON都不能泄漏到聊天正文。
let parsed = M.engine.extractSidecar('正常回复\n<memory_ops>{"operations":[]}</memory_ops>');
assert.equal(parsed.cleaned, '正常回复');
assert.deepEqual(parsed.payload.operations, []);
parsed = M.engine.extractSidecar('正常回复\n<memory_ops>{"operations":[]}<\\/memory_ops>');
assert.equal(parsed.cleaned, '正常回复');
assert.deepEqual(parsed.payload.operations, []);
parsed = M.engine.extractSidecar('正常回复\n{"operations":[]}\n<\\/memory_ops>');
assert.equal(parsed.cleaned, '正常回复');
assert.deepEqual(parsed.payload.operations, []);
parsed = M.engine.extractSidecar('正常回复\n<memory_ops>{"operations":[');
assert.equal(parsed.cleaned, '正常回复');
assert(parsed.error);
assert(!parsed.cleaned.includes('operations'));

// 实际聊天回复处理函数：先清理内部协议，再执行写入。
(async () => {
  const integrated = await M.engine.processReply(chat,
    '可见回复\n<memory_ops>{"operations":[{"tableId":"v5_items","action":"add","source":"用户明确","values":{"分类":"设备","标题":"备用线","内容":"准备购买备用充电线","物品状态":"待购买"}}]}</memory_ops>',
    { roundId: 'round_integrated' });
  assert.equal(integrated.cleaned, '可见回复');
  assert.equal(integrated.report.changed.length, 1);
  assert(store.records.v5_items.some(record => record.title === '备用线'));

  // 完整轮次把用户批次与AI批次绑定到同一roundId。
  chat.history.push({ id: 'a1', role: 'assistant', content: '先休息一下。' }, { id: 'a2', role: 'assistant', content: '再做报告。' });
  M.rounds.finishRound(chat, token);
  assert(chat.history.filter(m => ['u1','u2','a1','a2'].includes(m.id)).every(m => m.memoryRoundId === token.id));
  assert.equal(M.rounds.latestCompletedRoundMessages(chat).messages.length, 4);

  // 日常观察候选最多3条。
  for (let i = 0; i < 8; i++) {
    M.engine.applyOperations(chat, [{ tableId: 'v5_daily_observation', action: 'add', source: '用户明确', values: { 分类: '睡眠', 标题: `睡眠${i}`, 内容: `睡眠记录${i}` } }], { origin: 'manual', roundId: null });
  }
  chat.history.push({ id: 'u3', role: 'user', content: '最近睡眠怎么样' });
  const daily = store.tables.find(t => t.id === 'v5_daily_observation');
  const candidates = M.engine.candidateRecords(chat, daily, store);
  assert(candidates.length <= 3);

  // 空操作有无更新提示。
  notices.length = 0;
  M.engine.completeRound(chat, { changed: [], checked: [], rejected: [], reason: 'no_update', roundId: 'round_none' });
  assert(notices.some(message => message.includes('没有需要更新')));

  // 现有数据经过V5.2.0标准化仍保留，不重建空表。
  const snapshot = JSON.parse(JSON.stringify(store));
  const eventCount = snapshot.records.v5_recent_events.length;
  const normalized = M.model.normalizeStore(snapshot);
  assert.equal(normalized.records.v5_recent_events.length, eventCount);
  assert.equal(normalized.records.v5_current_state[0].content, stateRecord.content);
  assert.equal(normalized.version, 3);

  console.log('Memory V5.2.0 tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
