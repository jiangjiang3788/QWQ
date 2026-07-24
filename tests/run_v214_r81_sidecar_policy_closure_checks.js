const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
assert(['2.14-R8.1', '2.14-R9', '2.15-R0A', '2.15-R0B'].includes(read('VERSION.txt').trim()));

global.window = global;
global.document = { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] };
global.addEventListener = () => {};
global.renderMemoryTableScreen = () => {};
global.saveCharacter = async () => {};
global.currentChatId = 'chat-r81';
global.currentChatType = 'private';
global.MemoryTablePolicy = { clearRetrievalCache() {} };
global.confirm = () => true;

const explicit = (commitMode = 'inherit', minConfidence = 60) => ({ subject: 'user', evidence: 'explicit', commitMode, minConfidence });
const inferred = (commitMode = 'candidate', minConfidence = 75) => ({ subject: 'user', evidence: 'inferred', commitMode, minConfidence });
const runtime = () => ({ subject: 'assistant', evidence: 'inferred', commitMode: 'runtime_only', minConfidence: 0 });
const field = (id, key, type = 'text', writePolicy = explicit()) => ({ id, key, summaryLabel: key, type, important: true, aiEditable: true, writePolicy });
const basePolicy = role => ({
  memoryLayer: role === 'long_store' ? 'long' : 'short', systemRole: role,
  capturePolicy: { mode: 'sidecar', frequencySource: 'table', apiMode: 'none' },
  commitPolicy: { mode: role === 'current_state' || role === 'tasks' ? 'direct' : 'candidate', requireUserConfirmation: false },
  updatePolicy: { enabled: false, triggerMode: 'manual', allowAdd: true, allowUpdate: true, allowDelete: false },
  injectionPolicy: { mode: 'relevant', topK: 5, threshold: 0, budget: 3000, maxAgeDays: 0, includePinned: true, includeCompleted: true }
});

const stateTable = {
  id: 'state', name: '当前状态', mode: 'keyValue', ...basePolicy('current_state'), columns: [
    field('scene', 'user_当前场景', 'text', explicit('direct', 65)),
    field('mental', 'user_精神状态', 'text', inferred('candidate', 75)),
    field('role', 'char_回应策略', 'longtext', runtime()),
    field('recorded', '状态记录时间', 'text', { subject: 'system', evidence: 'inferred', commitMode: 'direct', minConfidence: 0 }),
    field('valid', '状态有效期', 'date', { subject: 'system', evidence: 'inferred', commitMode: 'direct', minConfidence: 0 })
  ]
};
const recentTable = {
  id: 'recent', name: '近期经历', mode: 'rows', ...basePolicy('recent_events'), columns: [
    field('eventId', '事件ID', 'text', { subject: 'system', evidence: 'inferred', commitMode: 'direct', minConfidence: 0 }),
    field('created', '创建时间'), field('updated', '最后更新时间'), field('type', '类型'),
    field('title', '标题'), field('content', '内容', 'longtext'), field('status', '当前状态'), field('origin', '原始记录ID')
  ]
};
const dailyTable = {
  id: 'daily', name: '日常观察', mode: 'rows', ...basePolicy('daily_observation'), columns: [
    field('date', '日期', 'date'),
    field('body', '身体状态', 'longtext', explicit('inherit', 65)),
    field('energy', '精力与情绪', 'longtext', inferred('candidate', 75)),
    field('source', '来源说明', 'longtext', { subject: 'system', evidence: 'inferred', commitMode: 'direct', minConfidence: 0 })
  ]
};
const targetTable = {
  id: 'medium', name: '中期总结', mode: 'rows', ...basePolicy('medium_summary'), columns: [field('summary', '内容', 'longtext')]
};
const template = { id: 'tpl', name: '测试模板', tables: [stateTable, recentTable, dailyTable, targetTable] };
const chat = {
  id: 'chat-r81', memoryMode: 'table', history: [],
  memoryTables: {
    boundTemplateIds: ['tpl'], data: { tpl: {
      state: { scene: '', mental: '', role: '旧正式角色策略', recorded: '', valid: '' },
      recent: { __rows: [] }, daily: { __rows: [] }, medium: { __rows: [] }
    } }, lockedFields: { tpl: { state: [], recent: [], daily: [], medium: [] } },
    policyOverrides: { tpl: {
      recent: { commitPolicy: { mode: 'direct' } },
      daily: { commitPolicy: { mode: 'direct' } }
    } },
    reviewState: { pendingBatches: [{
      id: 'old-review-1', source: 'sidecar_field_policy', tableId: 'state', templateId: 'tpl', createdAt: 10, status: 'pending',
      proposals: [{ id: 'old-p1', fieldId: 'mental', newValue: '旧推断', evidence: 'assistant_inferred', confidence: 80, createdAt: 10 }]
    }, {
      id: 'old-review-2', source: 'sidecar_field_policy', tableId: 'state', templateId: 'tpl', createdAt: 20, status: 'pending',
      proposals: [{ id: 'old-p2', fieldId: 'mental', newValue: '最新推断', evidence: 'assistant_inferred', confidence: 92, createdAt: 20 }]
    }], completedBatches: [], activeBatchId: 'old-review-2' }
  }
};
global.db = { memoryTableTemplates: [template], characters: [chat] };

[
  'js/features/memory/kernel.js',
  'js/features/memory/memory_defaults.js',
  'js/modules/memory_table_policy.js',
  'js/features/memory/field_semantics.js',
  'js/features/memory/policy_resolver.js',
  'js/features/memory/field_policy.js',
  'js/features/memory/record_identity.js',
  'js/features/memory/domain.js',
  'js/modules/memory_table_review.js',
  'js/features/memory/write_coordinator.js',
  'js/features/memory/write_gateway.js',
  'js/features/memory/sidecar_candidate_service.js',
  'js/modules/memory_table_sidecar.js',
  'js/features/memory/context_assembler.js'
].forEach(rel => vm.runInThisContext(read(rel), { filename: rel }));

(async () => {
  const Kernel = OvoMemoryKernel;
  const FieldPolicy = Kernel.require('fieldPolicy');
  const Identity = Kernel.require('recordIdentity');
  const Review = Kernel.require('review');
  const Sidecar = Kernel.require('sidecar');
  const Context = Kernel.require('contextAssembler');

  let decision = FieldPolicy.assess(stateTable.columns[1], stateTable, {
    source: 'assistant_inferred', confidence: 90, inferredRuntimeOnly: true
  });
  assert.strictEqual(decision.route, 'runtime_only');
  decision = FieldPolicy.assess(dailyTable.columns[2], { ...dailyTable, commitPolicy: { mode: 'direct' } }, {
    source: 'user_explicit', confidence: 95, preferTableDirect: true
  });
  assert.strictEqual(decision.route, 'direct');

  const prompt = Sidecar.buildSystemPrompt(chat);
  assert(prompt.includes('每个字段必须单独给出 evidence 和 confidence'));
  assert(prompt.includes('"value":"值","evidence":"user_explicit|assistant_inferred"'));

  // Empty run migrates duplicate current-state reviews to latest runtime value.
  let report = await Sidecar.applySidecar(chat, { version: 2, status: { fields: {} }, taskOps: [], candidates: [] }, { roundId: 'migrate' });
  assert.strictEqual(Review.getPendingBatches(chat).filter(batch => batch.source === 'sidecar_field_policy' && batch.tableId === 'state').length, 0);
  assert.strictEqual(FieldPolicy.getRuntimeEntry(chat, 'tpl', 'state', 'mental').value, '最新推断');
  assert.strictEqual(chat.memoryTables.data.tpl.state.mental, '');
  assert.strictEqual(report.reviewCompacted.removedBatches, 2);

  // Per-field evidence: explicit goes formal, inferred goes runtime, assistant field stays runtime.
  report = await Sidecar.applySidecar(chat, {
    version: 2,
    status: { fields: {
      scene: { value: '工作中', evidence: 'user_explicit', confidence: 100 },
      mental: { value: '略有压力', evidence: 'assistant_inferred', confidence: 88 },
      role: { value: '简短回应', evidence: 'assistant_inferred', confidence: 90 }
    }, validDays: 3 }, taskOps: [], candidates: []
  }, { roundId: 'status' });
  assert.strictEqual(chat.memoryTables.data.tpl.state.scene, '工作中');
  assert.strictEqual(chat.memoryTables.data.tpl.state.mental, '');
  assert.strictEqual(chat.memoryTables.data.tpl.state.role, '旧正式角色策略');
  assert.strictEqual(FieldPolicy.getRuntimeEntry(chat, 'tpl', 'state', 'mental').value, '略有压力');
  assert.strictEqual(FieldPolicy.getRuntimeEntry(chat, 'tpl', 'state', 'role').value, '简短回应');
  assert.strictEqual(Review.getPendingBatches(chat).length, 0);

  // Role-level direct makes explicit recent/daily candidates auto-promote.
  report = await Sidecar.applySidecar(chat, { version: 2, status: { fields: {} }, taskOps: [], candidates: [
    { type: 'experience', summary: '用户明确完成了一次系统测试', tags: { topic: ['测试'] }, confidence: 100, source: 'user_explicit' },
    { type: 'daily_observation', summary: '用户明确说今天感到精力充足', tags: { topic: ['精力'] }, confidence: 100, source: 'user_explicit' }
  ] }, { roundId: 'candidate-1' });
  assert.strictEqual(chat.memoryTables.data.tpl.recent.__rows.length, 1);
  assert.strictEqual(chat.memoryTables.data.tpl.daily.__rows.length, 1);
  assert.strictEqual(chat.memoryTables.sidecar.candidates.filter(item => item.status === 'promoted').length, 2);

  // Same-day daily observation updates the existing row instead of adding another one.
  await Sidecar.applySidecar(chat, { version: 2, status: { fields: {} }, taskOps: [], candidates: [
    { type: 'daily_observation', summary: '用户明确说今天傍晚略感疲劳', tags: { topic: ['精力'] }, confidence: 100, source: 'user_explicit' }
  ] }, { roundId: 'candidate-2' });
  assert.strictEqual(chat.memoryTables.data.tpl.daily.__rows.length, 1);
  assert.strictEqual(Identity.dailyDateKey(dailyTable, chat.memoryTables.data.tpl.daily.__rows[0].cells), new Date().toISOString().slice(0, 10));

  // Inferred candidate remains pending even when the table is direct.
  await Sidecar.applySidecar(chat, { version: 2, status: { fields: {} }, taskOps: [], candidates: [
    { type: 'experience', summary: '模型推断用户可能喜欢新的工作节奏', tags: {}, confidence: 95, source: 'assistant_inferred' }
  ] }, { roundId: 'candidate-3' });
  assert(chat.memoryTables.sidecar.candidates.some(item => item.status === 'pending' && item.source === 'assistant_inferred'));

  // Runtime-only legacy formal value must not leak into related-memory context.
  const context = Context.assemble({ chat, template, table: targetTable, queryText: '当前状态', topK: 3, maxTables: 5, budget: 5000 }).text;
  assert(!context.includes('旧正式角色策略'));
  assert(context.includes('简短回应'));

  const schemaSource = read('js/features/memory/schema_editor.js');
  assert(schemaSource.includes('memory-schema-field-route-summary'));
  assert(schemaSource.includes('字段实际分流：'));
  assert(read('js/features/memory/retrieval_orchestrator.js').includes('readEffectiveValue'));
  assert(read('js/features/memory/update_service.js').includes("?.value\n                            : formalValue"));

  console.log('V2.14-R8.1 SIDECAR POLICY CLOSURE CHECKS: PASS');
})().catch(error => { console.error(error); process.exit(1); });
