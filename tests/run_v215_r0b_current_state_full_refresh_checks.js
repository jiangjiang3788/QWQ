const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

global.window = global;
global.document = { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] };
global.addEventListener = () => {};
global.renderMemoryTableScreen = () => {};
global.saveCharacter = async () => {};
global.currentChatId = 'chat-state-refresh';
global.currentChatType = 'private';
global.confirm = () => true;

const explicit = { subject: 'user', evidence: 'explicit', commitMode: 'direct', minConfidence: 65 };
const inferred = { subject: 'user', evidence: 'inferred', commitMode: 'candidate', minConfidence: 75 };
const runtime = { subject: 'assistant', evidence: 'inferred', commitMode: 'runtime_only', minConfidence: 0 };
const system = { subject: 'system', evidence: 'inferred', commitMode: 'direct', minConfidence: 0 };
const stateTable = {
  id: 'state', name: '当前状态', mode: 'keyValue', memoryLayer: 'short', systemRole: 'current_state',
  extractPrompt: '逐项检查整张当前状态表。',
  capturePolicy: { mode: 'sidecar', frequencySource: 'table', apiMode: 'none' },
  commitPolicy: { mode: 'direct', requireUserConfirmation: false },
  updatePolicy: { enabled: false, triggerMode: 'manual', allowAdd: false, allowUpdate: true, allowDelete: false },
  injectionPolicy: { mode: 'never', topK: 0, threshold: 0, budget: 0, maxAgeDays: 7, includePinned: true, includeCompleted: false },
  columns: [
    { id: 'scene', key: 'user_当前场景', semanticRole: 'user_scene', identityRole: 'content', type: 'text', important: true, aiEditable: true, aiHint: '根据本轮明确场景更新。', writePolicy: explicit },
    { id: 'mental', key: 'user_精神状态', semanticRole: 'user_mental_state', identityRole: 'content', type: 'text', important: true, aiEditable: true, aiHint: '根据本轮语气判断。', writePolicy: inferred },
    { id: 'role', key: 'char_运行状态', semanticRole: 'assistant_runtime_state', identityRole: 'content', type: 'text', important: false, aiEditable: true, aiHint: '每轮评估角色运行状态。', writePolicy: runtime },
    { id: 'recorded', key: '状态记录时间', semanticRole: 'state_recorded_at', identityRole: 'volatile', type: 'text', important: true, aiEditable: true, writePolicy: system },
    { id: 'expires', key: '状态有效期', semanticRole: 'state_expires_at', identityRole: 'volatile', type: 'date', important: true, aiEditable: true, writePolicy: system }
  ]
};
const template = { id: 'tpl', name: '状态刷新测试', tables: [stateTable] };
const chat = {
  id: 'chat-state-refresh', history: [], memoryMode: 'table',
  memoryTables: {
    enabled: true, boundTemplateIds: ['tpl'],
    data: { tpl: { state: { scene: '工作中', mental: '', role: '', recorded: '', expires: '' } } },
    lockedFields: { tpl: { state: [] } }, history: [], updateActivityScope: null
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
  'js/modules/memory_table_sidecar.js',
  'js/features/memory/update_activity.js'
].forEach(rel => vm.runInThisContext(read(rel), { filename: rel }));

(async () => {
  const Policy = OvoMemoryKernel.require('policy');
  const Sidecar = OvoMemoryKernel.require('sidecar');
  const FieldPolicy = OvoMemoryKernel.require('fieldPolicy');
  const Domain = OvoMemoryKernel.require('domain');
  const Activity = OvoMemoryKernel.require('updateActivity');

  const prompt = Sidecar.buildSystemPrompt(chat);
  assert(prompt.includes('逐项检查整张当前状态表。'), 'table extractPrompt must enter sidecar prompt');
  assert(prompt.includes('字段ID=role'), 'hidden role field must be included in prompt');
  assert(prompt.includes('每轮评估角色运行状态。'), 'field aiHint must enter sidecar prompt');
  assert(prompt.includes('"fresh":true'), 'fresh protocol must be present');

  const round1 = Policy.beginRound(chat, {});
  const report1 = await Sidecar.applySidecar(chat, {
    version: 2,
    status: { fields: {
      scene: { value: '休息中', evidence: 'assistant_inferred', confidence: 85, fresh: false },
      mental: { value: '有些疲惫', evidence: 'assistant_inferred', confidence: 88, fresh: true },
      role: { value: '降低压迫感', evidence: 'assistant_inferred', confidence: 90, fresh: true }
    }, validDays: 3 }, taskOps: [], candidates: []
  }, { roundId: round1.id });

  assert.strictEqual(chat.memoryTables.data.tpl.state.scene, '工作中', 'fresh:false must not overwrite formal data');
  assert.strictEqual(chat.memoryTables.data.tpl.state.mental, '', 'inferred mental state must not enter formal data');
  assert.strictEqual(FieldPolicy.getRuntimeEntry(chat, 'tpl', 'state', 'mental').value, '有些疲惫');
  assert.strictEqual(FieldPolicy.getRuntimeEntry(chat, 'tpl', 'state', 'role').value, '降低压迫感');
  assert(report1.changedFields.some(change => change.fieldId === 'mental' && change.runtime === true), 'runtime mental change must enter structured history');
  assert(report1.changedFields.some(change => change.fieldId === 'role' && change.runtime === true), 'runtime role change must enter structured history');
  assert(Activity.cellAttributes(chat, 'tpl', 'state', 'mental').includes('data-memory-cell-runtime="true"'), 'runtime cell must be marked separately');
  assert.strictEqual(Domain.getFieldPresentation(chat, 'tpl', 'state', stateTable, stateTable.columns[1]).displayValue, '有些疲惫');
  assert.strictEqual(Domain.getFieldPresentation(chat, 'tpl', 'state', stateTable, stateTable.columns[2]).isRuntime, true);

  const round2 = Policy.beginRound(chat, {});
  await Sidecar.applySidecar(chat, {
    version: 2,
    status: { fields: {
      scene: { value: '休息中', evidence: 'assistant_inferred', confidence: 82, fresh: true }
    }, validDays: 3 }, taskOps: [], candidates: []
  }, { roundId: round2.id });
  assert.strictEqual(FieldPolicy.getRuntimeEntry(chat, 'tpl', 'state', 'scene').value, '休息中');

  const round3 = Policy.beginRound(chat, {});
  const report3 = await Sidecar.applySidecar(chat, {
    version: 2,
    status: { fields: {
      scene: { value: '工作中', evidence: 'user_explicit', confidence: 100, fresh: true }
    }, validDays: 3 }, taskOps: [], candidates: []
  }, { roundId: round3.id });
  assert.strictEqual(FieldPolicy.getRuntimeEntry(chat, 'tpl', 'state', 'scene'), null, 'explicit confirmation must clear conflicting runtime inference');
  assert(report3.changedFields.some(change => change.fieldId === 'scene' && change.runtimeCleared === true), 'runtime clearing must be recorded as this-round activity');
  assert.strictEqual(Domain.getFieldPresentation(chat, 'tpl', 'state', stateTable, stateTable.columns[0]).displayValue, '工作中');

  const round4 = Policy.beginRound(chat, {});
  const report4 = await Sidecar.applySidecar(chat, {
    version: 2,
    status: { fields: {
      mental: { value: '有些疲惫', evidence: 'assistant_inferred', confidence: 88, fresh: true }
    }, validDays: 4 }, taskOps: [], candidates: []
  }, { roundId: round4.id });
  const mentalRefresh = report4.changedFields.find(change => change.fieldId === 'mental');
  assert(mentalRefresh?.refreshed === true, 'same runtime value with fresh evidence must refresh current-round activity');
  assert.strictEqual(FieldPolicy.getRuntimeEntry(chat, 'tpl', 'state', 'mental').roundId, round4.id, 'runtime refresh must bind to the new round');
  assert(FieldPolicy.getRuntimeEntry(chat, 'tpl', 'state', 'mental').expiresAt > Date.now(), 'runtime refresh must extend its validity');
  assert.strictEqual(Activity.isCellUpdated(chat, 'tpl', 'state', 'mental'), true, 'same-value runtime refresh must highlight the field this round');

  const round5 = Policy.beginRound(chat, {});
  const report5 = await Sidecar.applySidecar(chat, {
    version: 2,
    status: { fields: {
      scene: { value: '工作中', evidence: 'user_explicit', confidence: 100, fresh: true }
    }, validDays: 5 }, taskOps: [], candidates: []
  }, { roundId: round5.id });
  const sceneRefresh = report5.changedFields.find(change => change.fieldId === 'scene' && change.refreshed === true);
  assert(sceneRefresh, 'same formal value with explicit fresh evidence must be recorded as a round refresh');
  assert.strictEqual(Activity.isCellUpdated(chat, 'tpl', 'state', 'scene'), true, 'same-value formal refresh must highlight the field this round');
  const historyCountBeforeRetry = chat.memoryTables.history.length;
  const retryReport = await Sidecar.applySidecar(chat, {
    version: 2,
    status: { fields: {
      scene: { value: '工作中', evidence: 'user_explicit', confidence: 100, fresh: true }
    }, validDays: 5 }, taskOps: [], candidates: []
  }, { roundId: round5.id });
  assert.strictEqual(retryReport.changedFields.length, 0, 'same-round duplicate confirmation must be idempotent');
  assert.strictEqual(chat.memoryTables.history.length, historyCountBeforeRetry, 'same-round retry must not append duplicate history');

  FieldPolicy.setRuntimeValue(chat, 'tpl', 'state', 'role', '过期判断', {
    source: 'assistant_inferred', confidence: 90, roundId: 'expired-round', expiresAt: Date.now() - 1000
  });
  assert.strictEqual(FieldPolicy.getRuntimeEntry(chat, 'tpl', 'state', 'role'), null, 'expired runtime values must be ignored by normal reads');
  assert(FieldPolicy.getRuntimeEntry(chat, 'tpl', 'state', 'role', { includeExpired: true }), 'expired runtime values must remain inspectable before pruning');
  assert.strictEqual(Domain.getFieldPresentation(chat, 'tpl', 'state', stateTable, stateTable.columns[2]).isRuntime, false, 'expired runtime values must not override formal presentation');
  const round6 = Policy.beginRound(chat, {});
  assert(round6?.id, 'a new round must still start after pruning');
  assert.strictEqual(FieldPolicy.getRuntimeEntry(chat, 'tpl', 'state', 'role', { includeExpired: true }), null, 'new round must prune expired runtime values');

  OvoMemoryKernel.register('tableView', {
    renderValue: (_field, value) => `<span>${String(value ?? '')}</span>`,
    renderRowCommand: () => '', renderStatusMeta: () => '', renderTagEditor: () => '', renderTagField: () => ''
  });
  OvoMemoryKernel.register('tableFilter', { renderToolbar: () => '' });
  OvoMemoryKernel.register('tableSort', { renderControls: () => '' });
  OvoMemoryKernel.register('tableViewport', { DEFAULTS: { rowHeight: 48 }, update: () => ({ start: 0, end: 0, topHeight: 0, bottomHeight: 0, enabled: false, renderedCount: 0 }), getState: () => null });
  OvoMemoryKernel.register('tablePresenter', {
    keyValueModel: config => ({ ...config, groups: [{ name: '状态', fields: config.table.columns }], jsonMode: false }),
    rowsModel: config => ({ ...config, groups: [], columns: [], rows: [], searchedRows: [], rowIndexes: new Map(), range: { enabled: false, start: 0, end: 0, topHeight: 0, bottomHeight: 0, key: 'x' } })
  });
  OvoMemoryKernel.register('tableReconciler', { replace: () => false, markSaved() {}, getStats: () => ({}), resetStats() {} });
  OvoMemoryKernel.register('tableGrouping', { fieldPath: (templateId, tableId, fieldId) => `${templateId}::${tableId}::${fieldId}` });
  OvoMemoryKernel.register('fieldWidth', { keyValueLabels: () => ({ desktop: 90, mobile: 72, longestUnits: 8 }) });
  OvoMemoryKernel.register('tableGesture', { bind() {} });
  OvoMemoryKernel.register('tableEditor', { canUndo: () => false, undoLabel: () => '' });
  vm.runInThisContext(read('js/features/memory/table_grid.js'), { filename: 'js/features/memory/table_grid.js' });
  vm.runInThisContext(read('js/features/memory/table_workspace.js'), { filename: 'js/features/memory/table_workspace.js' });
  const Grid = OvoMemoryKernel.require('tableGrid');
  const Workspace = OvoMemoryKernel.require('tableWorkspace');
  FieldPolicy.setRuntimeValue(chat, 'tpl', 'state', 'role', '降低压迫感', {
    source: 'assistant_inferred', confidence: 90, roundId: round6.id, expiresAt: Date.now() + 86400000
  });
  const gridHtml = Grid.renderKeyValueSheet({
    chat, template, table: stateTable,
    state: { viewMode: 'normal', editingFieldPath: '', focusedFieldPath: '' },
    helpers: { renderFieldEditor: () => '' }
  });
  assert(gridHtml.includes('memory-runtime-badge'), 'runtime value must render with AI badge');
  assert(gridHtml.includes('正式档案尚未确认'), 'runtime value must retain formal-state explanation');
  const visible = Workspace.visibleColumns(stateTable, { viewMode: 'normal' }, chat, 'tpl');
  assert(visible.some(field => field.id === 'role'), 'hidden role field with runtime value must become visible in normal mode');

  const css = read('css/modules/memory_table_flat.css');
  assert(css.includes('data-memory-cell-runtime'));

  console.log('V2.15-R0B CURRENT STATE FULL REFRESH CHECKS: PASS');
})().catch(error => { console.error(error); process.exit(1); });
