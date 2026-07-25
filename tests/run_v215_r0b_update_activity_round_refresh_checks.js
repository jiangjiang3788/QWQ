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
global.currentChatId = 'chat-round-refresh';
global.currentChatType = 'private';
global.confirm = () => true;

const direct = { subject: 'user', evidence: 'explicit', commitMode: 'direct', minConfidence: 0 };
const systemDirect = { subject: 'system', evidence: 'inferred', commitMode: 'direct', minConfidence: 0 };
const stateTable = {
  id: 'state', name: '当前状态', mode: 'keyValue', memoryLayer: 'short', systemRole: 'current_state',
  capturePolicy: { mode: 'sidecar', frequencySource: 'table', apiMode: 'none' },
  commitPolicy: { mode: 'direct', requireUserConfirmation: false },
  updatePolicy: { enabled: false, triggerMode: 'manual', allowAdd: true, allowUpdate: true, allowDelete: false },
  injectionPolicy: { mode: 'never', topK: 0, threshold: 0, budget: 0, maxAgeDays: 0, includePinned: true, includeCompleted: false },
  columns: [
    { id: 'scene', key: '当前场景', summaryLabel: '当前场景', semanticRole: 'user_scene', type: 'text', important: true, aiEditable: true, writePolicy: direct },
    { id: 'recorded', key: '状态记录时间', summaryLabel: '状态记录时间', semanticRole: 'state_recorded_at', type: 'text', important: true, aiEditable: true, writePolicy: systemDirect },
    { id: 'expires', key: '状态有效期', summaryLabel: '状态有效期', semanticRole: 'state_expires_at', type: 'date', important: true, aiEditable: true, writePolicy: systemDirect }
  ]
};
const template = { id: 'tpl', name: '轮次刷新测试', tables: [stateTable] };
const chat = {
  id: 'chat-round-refresh', history: [], memoryMode: 'table',
  memoryTables: {
    enabled: true,
    boundTemplateIds: ['tpl'],
    data: { tpl: { state: { scene: '', recorded: '', expires: '' } } },
    lockedFields: { tpl: { state: [] } },
    history: [{
      id: 'old-entry', timestamp: 1, source: 'manual', roundId: 'old-round',
      changedFields: [{ templateId: 'tpl', tableId: 'state', fieldId: 'scene', label: '旧更新', oldValue: '', newValue: '旧场景' }]
    }],
    updateActivityScope: { type: 'round', roundId: 'old-round', startedAt: 1 }
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
  const Activity = OvoMemoryKernel.require('updateActivity');

  assert.strictEqual(Activity.tableRecordCount(chat, 'state'), 1, 'old scope should initially point at old update');

  const round1 = Policy.beginRound(chat, {});
  assert(round1?.id, 'round should start');
  assert.strictEqual(Activity.currentEntries(chat).length, 0, 'new round must clear old update display before any write');
  assert.strictEqual(Activity.badge(chat, 'state'), '', 'new round without write must show no badge');

  const report = await Sidecar.applySidecar(chat, {
    version: 2,
    status: { fields: { scene: { value: '办公室', evidence: 'user_explicit', confidence: 100 } }, validDays: 3 },
    taskOps: [], candidates: []
  }, { roundId: round1.id });

  assert(report.changedFields.some(change => change.fieldId === 'scene'), 'sidecar formal update must expose structured changedFields');
  const roundEntries = Activity.currentEntries(chat);
  assert.strictEqual(roundEntries.length, 1, 'sidecar update must create one current-round history entry');
  assert.strictEqual(roundEntries[0].roundId, round1.id, 'history entry must be bound to the active round');
  assert.strictEqual(Activity.tableRecordCount(chat, 'state'), 1, 'updated single-record table must show one updated record');
  assert.strictEqual(Activity.isCellUpdated(chat, 'tpl', 'state', 'scene'), true, 'updated cell must be highlighted');
  assert(Activity.badge(chat, 'state').includes('本次更新 1 条'), 'updated round must show badge');

  const round2 = Policy.beginRound(chat, {});
  assert(round2?.id && round2.id !== round1.id, 'next round should have a new id');
  assert.strictEqual(Activity.currentEntries(chat).length, 0, 'next round must not inherit previous round history');
  assert.strictEqual(Activity.isCellUpdated(chat, 'tpl', 'state', 'scene'), false, 'previous cell highlight must clear in next round');
  assert.strictEqual(Activity.badge(chat, 'state'), '', 'next round without update must show no badge');

  await Sidecar.applySidecar(chat, { version: 2, status: { fields: {} }, taskOps: [], candidates: [] }, { roundId: round2.id });
  assert.strictEqual(Activity.currentEntries(chat).length, 0, 'no-op sidecar must not create a fake current-round update');

  console.log('V2.15-R0B UPDATE ACTIVITY ROUND REFRESH CHECKS: PASS');
})().catch(error => { console.error(error); process.exit(1); });
