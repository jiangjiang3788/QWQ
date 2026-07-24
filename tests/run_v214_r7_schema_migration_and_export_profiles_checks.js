(async () => {
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
assert(['2.14-R8', '2.14-R8.1'].includes(read('VERSION.txt').trim()));

const box = {
  window: null, console, Date, JSON, Math, Number, String, Boolean, Object, Array, Map, Set,
  Promise, Error, RegExp, parseInt, parseFloat, isNaN, setTimeout, clearTimeout,
  confirm: () => true
};
box.window = box;
vm.createContext(box);
for (const rel of [
  'js/features/memory/kernel.js',
  'js/features/memory/schema_migrator.js',
  'js/features/memory/package_orchestrator.js'
]) vm.runInContext(read(rel), box, { filename: rel });

const Kernel = box.OvoMemoryKernel;
const Migrator = Kernel.require('schemaMigrator');
const OrchestratorFactory = Kernel.require('packageOrchestrator');
assert.strictEqual(Migrator.VERSION, '2.14-R7');
assert.strictEqual(Migrator.CURRENT_SCHEMA_VERSION, '3.0');
assert.strictEqual(OrchestratorFactory.VERSION, '2.14-R7');

const legacy = {
  type: 'memory_table_package', version: 2, schemaVersion: '2.8', producerVersion: '2.13-R5.4',
  templates: [{ id: 'tpl-a', name: '旧模板', tables: [] }],
  binding: { data: {}, lockedFields: {} }
};
const legacySnapshot = JSON.stringify(legacy);
const preview = Migrator.preview(legacy);
assert.strictEqual(preview.ok, true);
assert.strictEqual(preview.fromVersion, '2.8');
assert.strictEqual(preview.toVersion, '3.0');
assert.deepStrictEqual(Array.from(preview.steps, item => item.id), [
  'memory-package-2.8-to-2.9',
  'memory-package-2.9-to-3.0'
]);
const migrated = Migrator.migrate(legacy);
assert.strictEqual(migrated.payload.schemaVersion, '3.0');
assert.strictEqual(migrated.payload.packageProfile, 'portable_snapshot');
assert.strictEqual(migrated.payload.version, 3);
assert.strictEqual(migrated.report.migrated, true);
assert.strictEqual(JSON.stringify(legacy), legacySnapshot, 'schema migration must not mutate source payload');
const future = Migrator.preview({ ...legacy, schemaVersion: '9.0' });
assert.strictEqual(future.ok, false);
assert(future.errors.join('').includes('高于当前支持版本'));

const template = {
  id: 'tpl-live', name: '当前模板', tables: [{
    id: 'table-live', name: '近期经历', mode: 'rows', columns: [{ id: 'field-live', key: '内容', type: 'text', default: '' }]
  }]
};
const chat = {
  id: 'character-one', remarkName: '阿沉', memoryMode: 'table',
  memoryTables: {
    boundTemplateIds: ['tpl-live'], autoUpdateEnabled: true, autoUpdateInterval: 140,
    data: { 'tpl-live': { 'table-live': { __rows: [{
      id: 'row-live', cells: { 'field-live': '保留内容' },
      meta: { retrievalVector: [0.1], retrievalVectorFingerprint: 'old', retrievalIndexedAt: 1 }
    }] } } },
    lockedFields: { 'tpl-live': { 'table-live': ['field-live'] } },
    sidecar: { enabled: true, candidates: [{ id: 'candidate-live', status: 'pending' }], history: [{ at: 1 }] },
    lifecycle: { lastMaintenanceAt: 1 },
    runtimeState: { fieldValues: { roleThought: '运行态内容' } },
    retrievalRuntime: { indexes: { 'row-live': [0.2] } },
    reviewState: { pendingBatches: [{ id: 'batch-live' }] },
    history: [{ id: 'history-live' }]
  }
};
const db = { memoryTableTemplates: [JSON.parse(JSON.stringify(template))] };
const runtime = {
  engineSettings: { messageInterval: 140 }, viewMode: 'normal',
  tableStates: { 'tpl-live': { 'table-live': {
    lastProcessedMsgId: 'message-old', lastProcessedRoundId: 'round-old', customCursorPosition: 99,
    pendingReviewBatchId: 'batch-live', lastRunStatus: 'pending_review'
  } } }
};
let saveCharacterCalls = 0;
let saveDataCalls = 0;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const writeGateway = {
  async run(targetChat, options, mutate) {
    const snapshot = options.capture(targetChat);
    try {
      const result = await mutate();
      await options.writer();
      return result;
    } catch (error) {
      options.restore(targetChat, snapshot);
      throw error;
    }
  }
};
const useCases = OrchestratorFactory.create({
  MemoryPackageAdapter: {
    createImportPlan: () => ({ entries: [], summary: { templateCount: 0, tableCount: 0, fieldCount: 0, rowCount: 0 } })
  },
  MemoryPolicy: {
    ensureRuntimeState: () => runtime,
    ensureTableState: () => ({}),
    inferAutomationMode: () => 'manual',
    normalizeEngineSettings: value => value
  },
  MemoryTasks: { ensureState: () => ({ settings: { enabled: true } }) },
  MemoryFeedback: { ensureState: () => ({ settings: { enabled: false } }) },
  MemoryQuality: { ensureState: () => ({ settings: { enabled: true }, testCases: [{ id: 'case-live' }] }) },
  MemoryWriteGateway: writeGateway,
  db,
  deepClone: clone,
  ensureMemoryTableState: target => { target.memoryTables ||= {}; return target; },
  ensureMemoryTemplateStore: () => {},
  ensureTemplateDataForChat: () => {},
  getBoundTemplates: () => db.memoryTableTemplates.filter(item => chat.memoryTables.boundTemplateIds.includes(item.id)),
  getCurrentMemoryTableChat: () => chat,
  renderMemoryTableScreen: () => {},
  replaceTemplateData: () => {},
  saveCharacter: async () => { saveCharacterCalls += 1; },
  saveData: async () => { saveDataCalls += 1; },
  showToast: () => {}
});

const templateBundle = useCases.buildTemplateBundlePayload();
assert.strictEqual(templateBundle.packageProfile, 'template_bundle');
assert.strictEqual(templateBundle.schemaVersion, '3.0');
assert.strictEqual(templateBundle.binding, null);
assert.strictEqual(templateBundle.templates[0].id, 'tpl-live');

const portable = useCases.buildPortableSnapshotPayload(['tpl-live']);
assert.strictEqual(portable.packageProfile, 'portable_snapshot');
assert.strictEqual(portable.schemaVersion, '3.0');
assert.strictEqual(portable.binding.data['tpl-live']['table-live'].__rows[0].meta.retrievalVector, undefined);
assert.strictEqual(portable.binding.tableStates['tpl-live']['table-live'].lastProcessedMsgId, null);
assert.strictEqual(portable.binding.tableStates['tpl-live']['table-live'].pendingReviewBatchId, null);
assert.strictEqual(portable.binding.tableStates['tpl-live']['table-live'].lastRunStatus, 'idle');
assert.strictEqual(portable.binding.reviewState, undefined, 'portable snapshot must not contain pending review runtime');

const full = useCases.buildFullBackupPayload();
assert.strictEqual(full.packageProfile, 'full_backup');
assert.strictEqual(full.subject.characterId, 'character-one');
assert.strictEqual(full.backup.memoryTables.data['tpl-live']['table-live'].__rows[0].id, 'row-live');
assert.strictEqual(full.backup.memoryTables.reviewState.pendingBatches[0].id, 'batch-live');
assert.deepStrictEqual(Array.from(full.backup.memoryTables.retrievalRuntime.indexes['row-live']), [0.2]);

chat.memoryTables.data['tpl-live']['table-live'].__rows[0].cells['field-live'] = '已被修改';
chat.memoryTables.reviewState.pendingBatches = [];
db.memoryTableTemplates[0].name = '已被修改的模板';
await useCases.restoreFullBackup(full);
assert.strictEqual(chat.memoryTables.data['tpl-live']['table-live'].__rows[0].cells['field-live'], '保留内容');
assert.strictEqual(chat.memoryTables.reviewState.pendingBatches[0].id, 'batch-live');
assert.strictEqual(db.memoryTableTemplates[0].name, '当前模板');
assert.strictEqual(saveCharacterCalls, 1);
assert.strictEqual(saveDataCalls, 1);

let wrongRoleError = null;
const wrong = clone(full);
wrong.subject.characterId = 'another-character';
try { await useCases.restoreFullBackup(wrong); } catch (error) { wrongRoleError = error; }
assert(wrongRoleError && wrongRoleError.message.includes('原角色'));

const html = read('index.html');
const controller = read('js/modules/memory_table.js');
const foundation = read('js/features/memory/domains/foundation.js');
const contract = JSON.parse(read('architecture/memory_domains.json'));
assert(html.includes('schema_migrator.js'));
assert(html.indexOf('schema_migrator.js') < html.indexOf('package_orchestrator.js'));
assert(html.includes('memory-table-export-full-backup-btn'));
assert(html.includes('>迁移快照</button>'));
assert(html.includes('>完整备份</button>'));
assert(controller.includes('exportFullBackup'));
assert(foundation.includes("schemaMigrator: Kernel.require('schemaMigrator')"));
assert(['2.14-R8', '2.14-R8.1'].includes(contract.version));
assert(contract.publicFacades.memoryFoundationDomain.owns.includes('schemaMigrator'));
assert(contract.budgets['js/features/memory/schema_migrator.js'] === 260);

console.log('V2.14-R7 SCHEMA MIGRATION AND EXPORT PROFILE CHECKS: PASS');

})().catch(error => { console.error(error); process.exit(1); });
