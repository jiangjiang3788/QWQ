const fs = require('fs');
const vm = require('vm');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const notices = [];
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
    getElementById() { return null; }
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
assert.equal(M.VERSION, '5.1.0');
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

const token = M.rounds.beginRound(chat);
assert.equal(M.rounds.roundPayload(chat).length, 2);
assert(M.rounds.roundText(chat).includes('昨晚没睡好'));
assert(M.rounds.roundText(chat).includes('充电线'));
const prompt = M.engine.buildSystemPrompt(chat);
assert(prompt.includes('<memory_v5_protocol version="5.1.0">'));
assert(prompt.includes('昨晚没睡好'));
assert(prompt.includes('v5_current_state'));
assert(prompt.includes('v5_recent_events'));
assert(prompt.includes('<memory_ops>'));
assert(!prompt.includes('v5_core_profile" name="核心档案">'));

// Core profile must reject AI writes.
let report = M.engine.applyOperations(chat, [{
  tableId: 'v5_core_profile', action: 'add', source: 'AI判断',
  values: { 分类: '用户', 标题: '测试', 内容: '不能写入' }
}], { origin: 'ai', roundId: token.id });
assert.equal(report.changed.length, 0);
assert.equal(report.rejected.length, 1);

// Same AI response can update multiple short-term tables.
report = M.engine.applyOperations(chat, [
  { tableId: 'v5_current_state', action: 'add', source: '用户明确', values: { 分类: '用户状态', 标签: ['疲惫'], 标题: '精神状态', 内容: '睡眠不足，精力偏低' } },
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

// Repeating unchanged state must not fake an update or rewrite time.
const stateRecord = store.records.v5_current_state[0];
const oldTime = stateRecord.time;
report = M.engine.applyOperations(chat, [{
  tableId: 'v5_current_state', action: 'upsert', recordId: stateRecord.id, source: '用户明确',
  values: { 内容: '睡眠不足，精力偏低' }
}], { origin: 'ai', roundId: 'round_same' });
assert.equal(report.changed.length, 0);
assert.equal(report.checked.length, 1);
assert.equal(stateRecord.time, oldTime);
assert.equal(stateRecord.roundId, token.id);

// Update old row by recordId, no duplicate.
const eventRecord = store.records.v5_recent_events[0];
report = M.engine.applyOperations(chat, [{
  tableId: 'v5_recent_events', action: 'upsert', recordId: eventRecord.id, source: '用户明确',
  values: { 事项状态: '已完结', 结果: '报告已经提交' }
}], { origin: 'ai', roundId: 'round_finish' });
assert.equal(report.changed.length, 1);
assert.equal(store.records.v5_recent_events.length, 1);
assert.equal(eventRecord.values[M.model.fieldId(store.tables.find(t => t.id === 'v5_recent_events'), '事项状态')], '已完结');

// AI deletion is forbidden.
report = M.engine.applyOperations(chat, [{ tableId: 'v5_recent_events', action: 'delete', recordId: eventRecord.id }], { origin: 'ai', roundId: 'round_delete' });
assert.equal(report.rejected.length, 1);
assert.equal(store.records.v5_recent_events.length, 1);

// Parser accepts standard and empty operations.
let parsed = M.engine.extractSidecar('正常回复\n<memory_ops>{"operations":[]}</memory_ops>');
assert.equal(parsed.cleaned, '正常回复');
assert.deepEqual(parsed.payload.operations, []);
parsed = M.engine.extractSidecar('<memory_ops>{"memoryOps":[]}</memory_ops>');
assert(Array.isArray(parsed.payload.operations));

// Complete round attaches assistant batch to the same round.
chat.history.push({ id: 'a1', role: 'assistant', content: '先休息一下。' }, { id: 'a2', role: 'assistant', content: '再做报告。' });
M.rounds.finishRound(chat, token);
assert(chat.history.filter(m => ['u1','u2','a1','a2'].includes(m.id)).every(m => m.memoryRoundId === token.id));
assert.equal(M.rounds.latestCompletedRoundMessages(chat).messages.length, 4);

// Relevant daily context never sends dozens: max 3.
for (let i = 0; i < 8; i++) {
  M.engine.applyOperations(chat, [{ tableId: 'v5_daily_observation', action: 'add', source: '用户明确', values: { 分类: '睡眠', 标题: `睡眠${i}`, 内容: `睡眠记录${i}` } }], { origin: 'manual', roundId: null });
}
chat.history.push({ id: 'u3', role: 'user', content: '最近睡眠怎么样' });
const daily = store.tables.find(t => t.id === 'v5_daily_observation');
const candidates = M.engine.candidateRecords(chat, daily, store);
assert(candidates.length <= 3);

// Empty operations produce visible no-update report when notice is enabled.
notices.length = 0;
M.engine.completeRound(chat, { changed: [], checked: [], rejected: [], reason: 'no_update', roundId: 'round_none' });
assert(notices.some(message => message.includes('没有需要更新')));

console.log('Memory V5.1 tests passed');
