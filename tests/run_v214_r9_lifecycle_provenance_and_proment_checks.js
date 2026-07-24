const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
assert(['2.14-R9', '2.15-R0A', '2.15-R0B'].includes(read('VERSION.txt').trim()));

function createBox(extra = {}) {
  const box = {
    window: null, console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object,
    Error, Promise, RegExp, Intl, setTimeout, clearTimeout, structuredClone: global.structuredClone,
    ...extra
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('js/features/memory/kernel.js'), box, { filename: 'kernel.js' });
  return box;
}

// Desktop launcher: Proment is rendered once and opens the existing screen.
{
  const switched = [];
  let setupCount = 0;
  const box = {
    window: null,
    console,
    db: { customIcons: {}, customAppNames: {}, characters: [] },
    defaultIcons: {},
    OvoFeatureFlags: { get: key => key === 'advancedApps' },
    switchScreen: id => switched.push(id),
    setupMagicRoomApp: () => { setupCount += 1; },
    sessionStorage: { getItem() { return null; }, setItem() {} }
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('js/app_registry.js'), box, { filename: 'app_registry.js' });
  const html = box.OvoAppRegistry.renderLauncher();
  assert.strictEqual((html.match(/data-app-id="proment"/g) || []).length, 1, 'Proment should be visible exactly once on desktop');
  assert(html.includes('Proment'), 'Proment label missing from desktop launcher');
  assert(box.OvoAppRegistry.openApp('proment'), 'Proment app should open');
  assert.strictEqual(setupCount, 1);
  assert.deepStrictEqual(switched, ['magic-room-screen']);
}

// Provenance, lifecycle planning and stable-domain writes.
{
  const table = {
    id: 'events', name: '近期经历', systemRole: 'recent_events', mode: 'rows', memoryLayer: 'short',
    columns: [
      { id: 'event_id', key: '事件ID', type: 'text' },
      { id: 'content', key: '内容', type: 'longtext' }
    ]
  };
  const template = { id: 'tpl', name: '记忆', tables: [table] };
  const chat = {
    id: 'chat',
    memoryTables: { boundTemplateIds: ['tpl'], data: {}, lockedFields: {}, history: [], lifecycle: { schemaVersion: '3.1' } }
  };
  const box = createBox({ db: { memoryTableTemplates: [template], characters: [chat] } });
  vm.runInContext(read('js/features/memory/memory_defaults.js'), box, { filename: 'memory_defaults.js' });
  vm.runInContext(read('js/modules/memory_table_policy.js'), box, { filename: 'memory_table_policy.js' });
  vm.runInContext(read('js/features/memory/field_semantics.js'), box, { filename: 'field_semantics.js' });
  vm.runInContext(read('js/features/memory/provenance_service.js'), box, { filename: 'provenance_service.js' });
  vm.runInContext(read('js/features/memory/record_identity.js'), box, { filename: 'record_identity.js' });
  vm.runInContext(read('js/modules/memory_table_lifecycle.js'), box, { filename: 'memory_table_lifecycle.js' });
  vm.runInContext(read('js/features/memory/domain.js'), box, { filename: 'domain.js' });

  const Kernel = box.OvoMemoryKernel;
  const Provenance = Kernel.require('provenanceService');
  const Lifecycle = Kernel.require('lifecycle');
  const Domain = Kernel.require('domain');
  assert.strictEqual(Provenance.VERSION, '2.14-R9');
  assert(['2.14-R9', '2.15-R0B'].includes(Lifecycle.VERSION));

  const legacy = {
    id: 'legacy', cells: { content: '旧记录' },
    meta: {
      evidence: { primarySource: 'user_explicit', sourceRefs: [{ type: 'message', id: 'm1', at: 10, excerpt: '用户明确表达' }] },
      versionLog: [{ at: 20, action: 'update', details: '旧版更新' }]
    }
  };
  const beforeRead = JSON.stringify(legacy);
  const derived = Provenance.read(legacy);
  assert(derived.length >= 2, 'legacy source/change chain should be readable');
  assert.strictEqual(JSON.stringify(legacy), beforeRead, 'provenance read must not mutate formal memory');

  Provenance.record(legacy, 'confirm', { eventKey: 'confirm-once', actor: 'user', source: 'manual' });
  Provenance.record(legacy, 'confirm', { eventKey: 'confirm-once', actor: 'user', source: 'manual' });
  assert.strictEqual(legacy.meta.provenance.events.filter(event => event.eventKey === 'confirm-once').length, 1, 'eventKey idempotency should survive normalization');

  const created = Domain.upsertRow(chat, template.id, table, { event_id: 'E-1', content: '第一次记录' }, {
    source: 'user_explicit', sourceMessageId: 'm-create'
  });
  assert(created.created);
  let events = Provenance.read(created.row);
  assert(events.some(event => event.action === 'create'), 'create provenance missing');

  const updated = Domain.upsertRow(chat, template.id, table, { event_id: 'E-1', content: '更新后的记录' }, {
    source: 'user_explicit', sourceMessageId: 'm-update', mergeStrategy: 'replace_non_empty'
  });
  assert(updated.matched && !updated.created);
  events = Provenance.read(updated.row);
  assert(events.some(event => event.action === 'update_field'), 'field update provenance missing');
  assert(events.some(event => event.action === 'upsert_match'), 'upsert match provenance missing');

  const now = Date.now();
  const expiredRow = {
    id: 'expired-row', cells: { event_id: 'E-2', content: '已经到期的记录' },
    meta: {
      createdAt: now - 10 * 86400000,
      updatedAt: now - 10 * 86400000,
      evidence: { primarySource: 'user_explicit', userConfirmed: true },
      lifecycle: { status: 'active', retentionMode: 'fixed', expiresAt: now - 1000, autoArchiveAfterDays: 0 }
    }
  };
  const duplicateA = { id: 'dup-a', cells: { event_id: '', content: '完全相同的正文' }, meta: { evidence: { primarySource: 'manual' }, lifecycle: { status: 'active', retentionMode: 'permanent' } } };
  const duplicateB = { id: 'dup-b', cells: { event_id: '', content: '完全相同的正文' }, meta: { evidence: { primarySource: 'manual' }, lifecycle: { status: 'active', retentionMode: 'permanent' } } };
  Domain.getRows(chat, template.id, table).push(expiredRow, duplicateA, duplicateB);

  const beforePlan = JSON.stringify(chat.memoryTables.data);
  const plan = Lifecycle.planMaintenance(chat, [template], now);
  assert.strictEqual(JSON.stringify(chat.memoryTables.data), beforePlan, 'maintenance preview must be read-only');
  assert(plan.operations.some(operation => operation.rowId === 'expired-row' && operation.after === 'expired'));

  const healthBefore = Lifecycle.healthReport(chat, [template], now);
  assert(healthBefore.duplicateGroups.some(group => group.some(item => item.row.id === 'dup-a') && group.some(item => item.row.id === 'dup-b')), 'exact duplicate group should be reported');
  assert.strictEqual(JSON.stringify(chat.memoryTables.data), beforePlan, 'health report must be read-only');

  const report = Lifecycle.applyMaintenancePlan(chat, [template], plan, { operationId: 'op-maintenance', transactionId: 'tx-maintenance' });
  assert(report.changed >= 1);
  assert.strictEqual(expiredRow.meta.lifecycle.status, 'expired');
  assert(Provenance.read(expiredRow).some(event => event.action === 'expire' && event.operationId === 'op-maintenance'));
  assert.strictEqual(chat.memoryTables.lifecycle.schemaVersion, '3.1');
}

// Portable snapshots remap provenance row links and remove source-chat references.
{
  const table = { id: 'old-table', name: '经历', mode: 'rows', columns: [{ id: 'old-field', key: '内容', type: 'text' }] };
  const template = { id: 'old-template', name: '模板', tables: [table] };
  const binding = { data: { 'old-template': { 'old-table': { __rows: [
    { id: 'old-row-a', cells: { 'old-field': 'A' }, meta: { provenance: { events: [{ id: 'p1', action: 'related', relatedRowIds: ['old-row-b'], refs: [{ type: 'message', id: 'message-secret' }, { type: 'manual', id: 'manual-1' }], transactionId: 'old-tx', operationId: 'old-op' }] } } },
    { id: 'old-row-b', cells: { 'old-field': 'B' }, meta: {} }
  ] } } }, lockedFields: {} };
  const box = createBox({ db: { memoryTableTemplates: [] } });
  vm.runInContext(read('js/features/memory/domain.js'), box, { filename: 'domain.js' });
  vm.runInContext(read('js/features/memory/package_adapter.js'), box, { filename: 'package_adapter.js' });
  const Adapter = box.OvoMemoryKernel.require('packageAdapter');
  const plan = Adapter.createImportPlan([template], binding);
  const entry = plan.entries[0];
  const remapped = Adapter.remapTableDataForImport(entry, binding, plan);
  const rows = remapped.data[entry.template.tables[0].id].__rows;
  const a = rows.find(row => row.cells[entry.template.tables[0].columns[0].id] === 'A');
  const b = rows.find(row => row.cells[entry.template.tables[0].columns[0].id] === 'B');
  assert.deepStrictEqual([...a.meta.provenance.events[0].relatedRowIds], [b.id]);
  assert(!a.meta.provenance.events[0].refs.some(ref => ref.type === 'message'));
  assert(a.meta.provenance.events[0].refs.some(ref => ref.type === 'manual'));
  assert.strictEqual(a.meta.provenance.events[0].transactionId, '');
  assert.strictEqual(a.meta.provenance.events[0].operationId, '');
}

// UI and architecture ownership contracts.
{
  const html = read('index.html');
  const inspector = read('js/features/memory/row_inspector.js');
  const workspace = read('js/features/memory/workspace.js');
  const lifecycle = read('js/modules/memory_table_lifecycle.js');
  const controller = read('js/modules/memory_table.js');
  const tasks = read('js/modules/memory_table_tasks.js');
  const architecture = JSON.parse(read('architecture/memory_domains.json'));
  assert(html.includes('js/features/memory/provenance_service.js'));
  assert(inspector.includes('来源与变化'));
  assert(inspector.includes('Provenance?.renderPanel?.'));
  assert(workspace.includes('生命周期与变化链'));
  assert(lifecycle.includes('执行 ${health.plan.changed} 项维护'));
  assert(controller.includes('不会删除或自动合并正文'));
  assert(controller.includes("reason: 'lifecycle-maintenance-task'"));
  assert(tasks.includes("apiMode: 'local', force: true"));
  assert(architecture.publicFacades.memoryGovernanceDomain.owns.includes('provenanceService'));
}

console.log('V2.14-R9 LIFECYCLE + PROVENANCE + PROMENT CHECKS: PASS');
