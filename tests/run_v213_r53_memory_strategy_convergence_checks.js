const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1', '2.14-R9', '2.15-R0A', '2.15-R0B'].includes(read('VERSION.txt').trim()));
const html = read('index.html');
const schema = read('js/features/memory/schema_editor.js');
const schemaCss = read('css/modules/memory_schema_editor.css');
const controller = read('js/modules/memory_table.js');
const sidecar = read('js/modules/memory_table_sidecar.js');
const candidate = read('js/features/memory/sidecar_candidate_service.js');
const promotion = read('js/features/memory/candidate_service.js');

// The runtime drawer now contains only truly global controls.
for (const label of ['记忆运行设置', '聊天记忆采集', '周期整理默认值', '召回与安全']) assert(html.includes(label), `missing settings section: ${label}`);
for (const retiredId of ['memory-table-review-mode', 'memory-table-auto-schedule-list', 'memory-table-cursor-table-select', 'memory-table-save-cursor-btn', 'memory-table-update-selected-btn']) {
  assert(!html.includes(retiredId), `retired duplicate setting remains in HTML: ${retiredId}`);
}

// All per-table structure, capture, commit, retrieval and runtime settings live in one continuous table.
for (const role of ['table-system-role', 'table-capture-mode', 'table-commit-mode', 'table-api-mode', 'table-frequency-source', 'table-trigger-mode', 'table-injection-mode']) {
  assert(schema.includes(role), `schema strategy column missing: ${role}`);
}
for (const label of ['表格职责', '信息来源', '写入方式', '调用 API', '频率来源', '未处理', '待确认', '游标']) assert(schema.includes(label), `schema label missing: ${label}`);
assert(!schema.includes('memory-schema-id'), 'internal ids should not be rendered in the normal schema table');
assert(schemaCss.includes('border:1px solid transparent'));
assert(schemaCss.includes('background:transparent'));
assert(/\.memory-schema-unified-table-grid\{min-width:(?:4850|5300)px/.test(schemaCss));
assert(controller.includes('boundRoleConflictsForDraft'));
assert(controller.includes('当前角色绑定的模板之间存在重复职责'));

// Routing must prefer stable roles rather than editable display names.
assert(sidecar.includes('normalizeSystemRole'));
assert(candidate.includes('normalizeSystemRole'));
assert(promotion.includes("role === 'long_store'"));

const context = { window: null, console, Date, JSON, Math, Number, String, Boolean, Object, Array, Map, Set, Promise, setTimeout, clearTimeout };
context.window = context;
context.db = { memoryTableTemplates: [] };
vm.createContext(context);
vm.runInContext(read('js/features/memory/kernel.js'), context, { filename: 'kernel.js' });
vm.runInContext(read('js/modules/memory_table_policy.js'), context, { filename: 'memory_table_policy.js' });
vm.runInContext(read('js/features/memory/field_semantics.js'), context, { filename: 'field_semantics.js' });
vm.runInContext(read('js/modules/memory_table_review.js'), context, { filename: 'memory_table_review.js' });
vm.runInContext(read('js/features/memory/domain.js'), context, { filename: 'domain.js' });
vm.runInContext(read('js/features/memory/schema_model.js'), context, { filename: 'schema_model.js' });
const Kernel = context.OvoMemoryKernel;
const policy = Kernel.get('policy');
const review = Kernel.get('review');
const model = Kernel.get('schemaModel');
assert(policy && review && model);

const expected = [
  ['核心确认档案', 'core_profile', 'manual', 'manual_only'],
  ['当前状态（3-7天）', 'current_state', 'sidecar', 'direct'],
  ['待办、承诺与未完成事项', 'tasks', 'sidecar', 'direct'],
  ['近期经历、想法与重要事件', 'recent_events', 'sidecar', 'candidate'],
  ['日常观察（睡眠/饮水/身体）', 'daily_observation', 'sidecar', 'candidate'],
  ['中期总结与成长经验', 'medium_summary', 'manual', 'review'],
  ['长期候选审核队列', 'long_candidate', 'manual', 'promotion'],
  ['稳定长期特征库', 'long_store', 'disabled', 'manual_only']
];
for (const [name, role, capture, commit] of expected) {
  const normalized = policy.normalizeTablePolicy({ name, memoryLayer: role === 'long_candidate' ? 'review' : undefined, updatePolicy: { enabled: false, triggerMode: 'manual' } });
  assert.strictEqual(normalized.systemRole, role, `${name} role mismatch`);
  assert.strictEqual(normalized.capturePolicy.mode, capture, `${name} capture mismatch`);
  assert.strictEqual(normalized.commitPolicy.mode, commit, `${name} commit mismatch`);
}

// New per-table policy is authoritative over stale runtime automation state.
const explicitScheduled = {
  id: 'medium', name: '中期总结与成长经验', memoryLayer: 'medium',
  capturePolicy: { mode: 'scheduled', frequencySource: 'global', apiMode: 'summary' },
  commitPolicy: { mode: 'review' }, updatePolicy: { enabled: false, triggerMode: 'manual' }
};
const effective = policy.resolveEffectiveUpdatePolicy(explicitScheduled, { triggerMode: 'messages', messageInterval: 20, roundInterval: 3, maxSourceMessages: 100 }, 'manual');
assert.strictEqual(effective.enabled, true);
assert.strictEqual(effective.automationMode, 'engine');
assert.strictEqual(effective.messageInterval, 20);

// Review is decided by the target table's write mode, not by which API produced the draft.
assert.strictEqual(review.shouldRequireReview({ reviewMode: 'all' }, { commitMode: 'direct', preferSummaryApi: true }), false);
assert.strictEqual(review.shouldRequireReview({ reviewMode: 'summary_only' }, { commitMode: 'review', preferSummaryApi: false }), true);
assert.strictEqual(review.shouldRequireReview({ reviewMode: 'summary_only' }, { commitMode: 'promotion' }), true);
assert.strictEqual(review.shouldRequireReview({ reviewMode: 'summary_only' }, { preferSummaryApi: true }), true, 'legacy fallback should remain readable');

// Unique system responsibilities cannot silently point to two tables in one template.
const duplicateDraft = {
  id: 'tpl', name: '重复职责模板', description: '',
  tables: [
    { id: 'a', name: '状态 A', systemRole: 'current_state', mode: 'keyValue', memoryLayer: 'short', columns: [{}] },
    { id: 'b', name: '状态 B', systemRole: 'current_state', mode: 'keyValue', memoryLayer: 'short', columns: [{}] }
  ]
};
const conflicts = model.roleConflicts(duplicateDraft);
assert.strictEqual(conflicts.size, 2);
assert.strictEqual(conflicts.get(0).count, 2);

console.log('V2.13-R5.3 MEMORY STRATEGY CONVERGENCE CHECKS: PASS');
