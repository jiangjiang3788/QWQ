const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.join(root, 'docs', 'V2.14-R7_实际记忆包迁移与导出验证.json');
if (!inputPath) throw new Error('usage: node tools/validate_v214_r7_actual_package.js <memory-package.json> [report.json]');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const sourceBytes = fs.readFileSync(inputPath);
const sourceHashBefore = crypto.createHash('sha256').update(sourceBytes).digest('hex');
const source = JSON.parse(sourceBytes.toString('utf8'));
const sourceSnapshot = JSON.stringify(source);
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function countPackage(payload) {
  const templates = Array.isArray(payload.templates) ? payload.templates : [];
  let tables = 0;
  let fields = 0;
  let rows = 0;
  templates.forEach(template => {
    (template.tables || []).forEach(table => {
      tables += 1;
      fields += (table.columns || []).length;
      const tableData = payload.binding?.data?.[template.id]?.[table.id];
      if (Array.isArray(tableData?.__rows)) rows += tableData.__rows.length;
    });
  });
  return { templates: templates.length, tables, fields, rows };
}

const box = {
  window: null, console, Date, JSON, Math, Number, String, Boolean, Object, Array, Map, Set,
  Promise, Error, RegExp, parseInt, parseFloat, isNaN, confirm: () => true
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
const Factory = Kernel.require('packageOrchestrator');
const beforeCounts = countPackage(source);
const preview = Migrator.preview(source);
assert.strictEqual(preview.ok, true);
const migrated = Migrator.migrate(source);
assert.strictEqual(migrated.payload.schemaVersion, '3.0');
assert.strictEqual(migrated.payload.packageProfile, 'portable_snapshot');
const afterCounts = countPackage(migrated.payload);
assert.deepStrictEqual(afterCounts, beforeCounts);
assert.strictEqual(JSON.stringify(source), sourceSnapshot, 'migrator mutated source object');

const templates = clone(source.templates || []);
const binding = clone(source.binding || {});
const chat = {
  id: 'actual-memory-owner',
  remarkName: '实际记忆包验证角色',
  memoryMode: binding.memoryMode || 'table',
  memoryTables: {
    ...binding,
    boundTemplateIds: templates.map(item => item.id),
    history: [{ id: 'history-preserved-for-full-backup' }],
    reviewState: { pendingBatches: [{ id: 'review-preserved-for-full-backup' }], completedBatches: [], activeBatchId: 'review-preserved-for-full-backup' },
    retrievalRuntime: { indexes: { sample: { vector: [0.1, 0.2] } } },
    runtimeState: { fieldValues: { sample: 'runtime-only' } }
  }
};
const db = { memoryTableTemplates: templates };
const runtime = {
  engineSettings: clone(binding.engineSettings || {}),
  viewMode: 'normal',
  tableStates: clone(binding.tableStates || {})
};
const useCases = Factory.create({
  MemoryPackageAdapter: {},
  MemoryPolicy: { ensureRuntimeState: () => runtime },
  MemoryTasks: { ensureState: () => ({ settings: clone(binding.taskQueue?.settings || {}) }) },
  MemoryFeedback: { ensureState: () => ({ settings: clone(binding.feedback?.settings || {}) }) },
  MemoryQuality: { ensureState: () => ({ settings: clone(binding.quality?.settings || {}), testCases: clone(binding.quality?.testCases || []) }) },
  db,
  deepClone: clone,
  ensureMemoryTableState: target => target,
  ensureTemplateDataForChat: () => {},
  getBoundTemplates: () => templates,
  getCurrentMemoryTableChat: () => chat,
  showToast: () => {}
});
const templateBundle = useCases.buildTemplateBundlePayload();
const portable = useCases.buildPortableSnapshotPayload(templates.map(item => item.id));
const full = useCases.buildFullBackupPayload();
assert.strictEqual(templateBundle.packageProfile, 'template_bundle');
assert.strictEqual(templateBundle.binding, null);
assert.strictEqual(portable.packageProfile, 'portable_snapshot');
assert.strictEqual(countPackage(portable).rows, beforeCounts.rows);
assert.strictEqual(full.packageProfile, 'full_backup');
assert.strictEqual(full.subject.characterId, 'actual-memory-owner');
assert.strictEqual(useCases.countRowsInMemoryTables(full.backup.memoryTables), beforeCounts.rows);
assert.strictEqual(full.backup.memoryTables.reviewState.pendingBatches.length, 1);
assert.strictEqual(full.backup.memoryTables.history.length, 1);

const sourceHashAfter = crypto.createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex');
assert.strictEqual(sourceHashAfter, sourceHashBefore, 'source package file changed');
const report = {
  version: '2.14-R7',
  sourceFile: path.basename(inputPath),
  sourceSchemaVersion: source.schemaVersion || null,
  targetSchemaVersion: migrated.payload.schemaVersion,
  migrationSteps: migrated.report.applied,
  countsBefore: beforeCounts,
  countsAfterMigration: afterCounts,
  exportProfiles: {
    templateBundle: { schemaVersion: templateBundle.schemaVersion, templates: templateBundle.templates.length, includesBinding: !!templateBundle.binding },
    portableSnapshot: { schemaVersion: portable.schemaVersion, rows: countPackage(portable).rows, remapAllInternalIds: portable.transferPolicy.remapAllInternalIds },
    fullBackup: { schemaVersion: full.schemaVersion, rows: useCases.countRowsInMemoryTables(full.backup.memoryTables), preservesIds: full.transferPolicy.preserveAllIds, pendingReviewBatches: full.backup.memoryTables.reviewState.pendingBatches.length }
  },
  sourceSha256Before: sourceHashBefore,
  sourceSha256After: sourceHashAfter,
  sourceUnchanged: sourceHashBefore === sourceHashAfter,
  result: 'PASS'
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
