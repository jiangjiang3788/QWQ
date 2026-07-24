const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
assert(['2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6'].includes(read('VERSION.txt').trim()));

const context = {
  window: null, console, Date, JSON, Math, Number, String, Boolean, Object, Array, Map, Set,
  Promise, Error, RegExp, parseInt, parseFloat, isNaN, setTimeout, clearTimeout,
  db: { memoryTableTemplates: [] }
};
context.window = context;
vm.createContext(context);
for (const file of [
  'js/features/memory/kernel.js',
  'js/modules/memory_table_policy.js',
  'js/modules/memory_table_review.js',
  'js/features/memory/domain.js',
  'js/features/memory/package_adapter.js',
  'js/features/memory/integrity_doctor.js'
]) vm.runInContext(read(file), context, { filename: file });

const Kernel = context.OvoMemoryKernel;
const Adapter = Kernel.require('packageAdapter');
const Doctor = Kernel.require('integrityDoctor');
assert.strictEqual(Adapter.VERSION, '2.14-R0');
assert.strictEqual(Doctor.VERSION, '2.14-R0');

const template = {
  id: 'tpl-old', name: '迁移模板', description: '', tables: [
    {
      id: 'candidate-old', name: '长期候选审核队列', systemRole: 'long_candidate', mode: 'rows', memoryLayer: 'review',
      promotionPolicy: { enabled: true, targetTableId: 'store-old' },
      columns: [{ id: 'candidate-content', key: '候选内容', type: 'longtext', default: '' }]
    },
    {
      id: 'store-old', name: '稳定长期特征库', systemRole: 'long_store', mode: 'rows', memoryLayer: 'long',
      columns: [{ id: 'store-content', key: '内容', type: 'longtext', default: '' }]
    },
    {
      id: 'recent-old', name: '近期经历、想法与重要事件', systemRole: 'recent_events', mode: 'rows', memoryLayer: 'short',
      columns: [
        { id: 'recent-title', key: '标题', type: 'text', default: '' },
        { id: 'recent-event-id', key: '事件ID', type: 'text', default: '' },
        { id: 'recent-origin', key: '原始记录ID', type: 'text', default: '' }
      ]
    }
  ]
};
const binding = {
  boundTemplateIds: ['tpl-old'],
  data: {
    'tpl-old': {
      'candidate-old': { __rows: [{
        id: 'candidate-row', cells: { 'candidate-content': '稳定偏好候选' },
        meta: {
          sourceMessageIds: ['source-message'],
          workflow: { status: 'approved', promotedToTemplateId: 'tpl-old', promotedToTableId: 'store-old', promotedToRowId: 'store-row' }
        }
      }] },
      'store-old': { __rows: [{
        id: 'store-row', cells: { 'store-content': '稳定偏好' },
        meta: { relations: { relatedTo: ['recent-row'] }, sourceMessageIds: ['source-message'] }
      }] },
      'recent-old': { __rows: [{
        id: 'recent-row', cells: { 'recent-title': '近期事件', 'recent-event-id': 'recent-row', 'recent-origin': 'store-row' },
        meta: { relations: { relatedTo: ['store-row'] }, sourceMessageIds: ['source-message'] }
      }] }
    }
  },
  lockedFields: { 'tpl-old': { 'recent-old': ['recent-title'] } },
  sidecar: {
    enabled: true, captureCandidates: true, showStatusBar: false, history: [{ at: 1 }],
    candidates: [{
      id: 'sidecar-old', type: 'experience', summary: '候选', status: 'promoted',
      targetTemplateId: 'tpl-old', targetTableId: 'recent-old', targetRowId: 'recent-row',
      sourceRoundId: 'round-old', sourceMessageIds: ['source-message']
    }]
  },
  quality: {
    settings: { enabled: true }, runs: [{ id: 'old-run' }],
    testCases: [{ id: 'case-old', name: '测试', expectedTableIds: ['recent-old'], expectedRowIds: ['recent-row'] }]
  }
};

const sourceSnapshot = JSON.stringify({ template, binding });
const plan = Adapter.createImportPlan([template], binding);
assert.deepStrictEqual(JSON.parse(JSON.stringify(plan.summary)), { templateCount: 1, tableCount: 3, fieldCount: 5, rowCount: 3 });
const entry = plan.entries[0];
const newCandidateId = plan.mapping.tableIds['candidate-old'];
const newStoreId = plan.mapping.tableIds['store-old'];
const newRecentId = plan.mapping.tableIds['recent-old'];
assert(newCandidateId && newStoreId && newRecentId);
const importedCandidateTable = entry.template.tables.find(item => item.id === newCandidateId);
assert.strictEqual(importedCandidateTable.promotionPolicy.targetTableId, newStoreId, 'long promotion target must be remapped');

const imported = Adapter.remapTableDataForImport(entry, binding, plan);
const newCandidateRowId = plan.mapping.rowIds['tpl-old::candidate-old::candidate-row'];
const newStoreRowId = plan.mapping.rowIds['tpl-old::store-old::store-row'];
const newRecentRowId = plan.mapping.rowIds['tpl-old::recent-old::recent-row'];
const importedCandidateRow = imported.data[newCandidateId].__rows[0];
const importedStoreRow = imported.data[newStoreId].__rows[0];
const importedRecentRow = imported.data[newRecentId].__rows[0];
assert.strictEqual(importedCandidateRow.id, newCandidateRowId);
assert.strictEqual(importedCandidateRow.meta.workflow.promotedToTableId, newStoreId);
assert.strictEqual(importedCandidateRow.meta.workflow.promotedToRowId, newStoreRowId);
assert.deepStrictEqual(Array.from(importedStoreRow.meta.relations.relatedTo), [newRecentRowId], 'cross-table relation must be remapped');
assert.deepStrictEqual(Array.from(importedRecentRow.meta.relations.relatedTo), [newStoreRowId], 'reverse relation must be remapped');
assert.deepStrictEqual(Array.from(importedRecentRow.meta.sourceMessageIds), [], 'source chat message references must be cleared');
const newEventFieldId = plan.mapping.fieldIds['recent-old::recent-event-id'];
assert.strictEqual(importedRecentRow.cells[newEventFieldId], newRecentRowId, 'stable event id cells must follow the regenerated row id');
assert.strictEqual(imported.lockedFields[newRecentId][0], plan.mapping.fieldIds['recent-old::recent-title']);

const importedSidecar = Adapter.remapSidecarForImport(binding.sidecar, plan);
assert.strictEqual(importedSidecar.candidates[0].targetTemplateId, entry.template.id);
assert.strictEqual(importedSidecar.candidates[0].targetTableId, newRecentId);
assert.strictEqual(importedSidecar.candidates[0].targetRowId, newRecentRowId);
assert.strictEqual(importedSidecar.candidates[0].sourceRoundId, null);
assert.deepStrictEqual(Array.from(importedSidecar.candidates[0].sourceMessageIds), []);
assert.deepStrictEqual(Array.from(importedSidecar.history), []);

const importedQuality = Adapter.remapQualityForImport(binding.quality, plan);
assert.deepStrictEqual(Array.from(importedQuality.testCases[0].expectedTableIds), [newRecentId]);
assert.deepStrictEqual(Array.from(importedQuality.testCases[0].expectedRowIds), [newRecentRowId]);
assert.deepStrictEqual(Array.from(importedQuality.runs), []);
const fresh = Adapter.freshRuntimeState();
assert.strictEqual(fresh.lastProcessedMsgId, null);
assert.strictEqual(fresh.lastProcessedRoundId, null);
assert.strictEqual(fresh.pendingReviewBatchId, null);
assert.strictEqual(JSON.stringify({ template, binding }), sourceSnapshot, 'import planning and remapping must not mutate the source package');

const brokenTemplate = {
  id: 'broken-tpl', name: '问题模板', tables: [
    { id: 'state-a', name: '状态甲', systemRole: 'current_state', mode: 'keyValue', memoryLayer: 'short', columns: [{ id: 'state-field', key: '状态', type: 'text', default: '' }] },
    { id: 'state-b', name: '状态乙', systemRole: 'current_state', mode: 'keyValue', memoryLayer: 'short', columns: [{ id: 'state-field-b', key: '状态', type: 'text', default: '' }] },
    { id: 'long-candidate', name: '长期候选', systemRole: 'long_candidate', mode: 'rows', memoryLayer: 'review', promotionPolicy: { targetTableId: 'missing-long-store' }, columns: [{ id: 'content', key: '内容', type: 'longtext', default: '' }] },
    { id: 'recent', name: '近期经历', systemRole: 'recent_events', mode: 'rows', memoryLayer: 'short', columns: [{ id: 'title', key: '标题', type: 'text', default: '' }] }
  ]
};
const brokenChat = {
  id: 'broken-chat', history: [{ id: 'live-message' }],
  memoryTables: {
    boundTemplateIds: ['broken-tpl'],
    data: { 'broken-tpl': {
      'state-a': { 'state-field': '平稳' }, 'state-b': { 'state-field-b': '平稳' },
      'long-candidate': { __rows: [] },
      recent: { __rows: [{ id: 'recent-row', cells: { title: '事件' }, meta: { relations: { relatedTo: ['missing-row'] } } }] }
    } },
    lockedFields: {},
    sidecar: { candidates: [{ id: 'legacy', status: 'processed', summary: '旧候选' }] },
    tableStates: { 'broken-tpl': { recent: { lastProcessedMsgId: 'missing-message', lastProcessedMsgTimestamp: 0, pendingReviewBatchId: null } } },
    reviewState: { pendingBatches: [] },
    lifecycle: { lastMaintenanceAt: 0 }
  }
};
const beforeScan = JSON.stringify(brokenChat);
const report = Doctor.scan(brokenChat, [brokenTemplate]);
const codes = new Set(report.issues.map(item => item.code));
for (const code of ['duplicate_bound_role', 'promotion_target_orphan', 'orphan_relation', 'legacy_candidate', 'invalid_message_cursor', 'maintenance_never_run']) {
  assert(codes.has(code), `integrity doctor failed to report ${code}`);
}
assert.strictEqual(JSON.stringify(brokenChat), beforeScan, 'integrity scan must be read-only');
const doctorHtml = Doctor.renderView(brokenChat, [brokenTemplate]);
assert(doctorHtml.includes('只读扫描，不会修改任何记忆'));
assert(doctorHtml.includes('导出报告'));
assert(!doctorHtml.includes('自动修复'), 'R0 doctor must not mutate data');

const html = read('index.html');
const controller = read('js/modules/memory_table.js');
const architecture = JSON.parse(read('architecture/memory_domains.json'));
assert(html.includes('package_adapter.js') && html.includes('integrity_doctor.js'));
assert(controller.includes("view === 'integrity'"));
assert(controller.includes("action === 'integrity-export'"));
assert(architecture.publicFacades.memoryFoundationDomain.owns.includes('packageAdapter'));
assert(architecture.publicFacades.memoryGovernanceDomain.owns.includes('integrityDoctor'));
assert(read('css/modules/memory_table_v2.css').includes('.memory-integrity-view'));

console.log('V2.14-R0 MEMORY INTEGRITY AND IMPORT SAFETY CHECKS: PASS');
