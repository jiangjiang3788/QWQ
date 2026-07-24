const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const extracted = process.argv[2];
const sourceArchive = process.argv[3];
const outputPath = process.argv[4] || path.join(root, 'docs', 'V2.14-R9_实际备份生命周期与来源链验证.json');
if (!extracted || !sourceArchive) throw new Error('usage: node validate_v214_r9_actual_backup.js <extracted-backup> <source.ee> [output.json]');
const readApp = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const hashObject = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const sourceHashBefore = digest(sourceArchive);
const characters = JSON.parse(fs.readFileSync(path.join(extracted, 'database', 'characters.json'), 'utf8'));
const settings = JSON.parse(fs.readFileSync(path.join(extracted, 'database', 'globalSettings.json'), 'utf8'));
const templateEntry = settings.find(item => item && item.key === 'memoryTableTemplates');
assert(templateEntry && Array.isArray(templateEntry.value) && templateEntry.value.length, 'memory templates missing');
const templates = clone(templateEntry.value);
const chat = clone(characters[0]);
assert(chat && chat.memoryTables, 'character memory missing');

const iterateRows = callback => templates.forEach(template => (template.tables || []).forEach(table => {
  const rows = chat.memoryTables?.data?.[template.id]?.[table.id]?.__rows;
  if (Array.isArray(rows)) rows.forEach(row => callback(row, table, template));
}));
let rowCount = 0;
let fieldCount = 0;
templates.forEach(template => (template.tables || []).forEach(table => { fieldCount += (table.columns || []).length; }));
iterateRows(() => { rowCount += 1; });
const formalHashBefore = hashObject(chat.memoryTables.data);

const box = {
  window: null, console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object,
  Error, Promise, RegExp, Intl, structuredClone: global.structuredClone,
  db: { memoryTableTemplates: templates, characters: [chat] }
};
box.window = box;
vm.createContext(box);
for (const rel of [
  'js/features/memory/kernel.js',
  'js/features/memory/provenance_service.js',
  'js/features/memory/record_identity.js',
  'js/modules/memory_table_lifecycle.js'
]) vm.runInContext(readApp(rel), box, { filename: rel });
const Kernel = box.OvoMemoryKernel;
const Provenance = Kernel.require('provenanceService');
const Lifecycle = Kernel.require('lifecycle');

let readableRows = 0;
let derivedEventCount = 0;
iterateRows(row => {
  const before = JSON.stringify(row);
  const events = Provenance.read(row);
  if (events.length) readableRows += 1;
  derivedEventCount += events.length;
  assert.strictEqual(JSON.stringify(row), before, 'reading provenance mutated a formal row');
});
assert.strictEqual(hashObject(chat.memoryTables.data), formalHashBefore, 'provenance scan changed formal memory');

const now = Date.now();
const health = Lifecycle.healthReport(chat, templates, now);
assert.strictEqual(health.total, rowCount, 'health report row count mismatch');
assert.strictEqual(hashObject(chat.memoryTables.data), formalHashBefore, 'health report changed formal memory');
const previewHash = hashObject(health.plan);
const planAgain = Lifecycle.planMaintenance(chat, templates, now);
assert.strictEqual(hashObject(planAgain), previewHash, 'maintenance preview is not deterministic for the same timestamp');
assert.strictEqual(hashObject(chat.memoryTables.data), formalHashBefore, 'maintenance preview changed formal memory');

const maintenanceChat = clone(chat);
const maintenanceBeforeRows = rowCount;
const report = Lifecycle.applyMaintenancePlan(maintenanceChat, templates, clone(health.plan), {
  operationId: 'r9-actual-backup-maintenance', transactionId: 'r9-actual-backup-transaction'
});
let maintenanceAfterRows = 0;
let changedRowsWithProvenance = 0;
templates.forEach(template => (template.tables || []).forEach(table => {
  const rows = maintenanceChat.memoryTables?.data?.[template.id]?.[table.id]?.__rows;
  if (!Array.isArray(rows)) return;
  maintenanceAfterRows += rows.length;
  rows.forEach(row => {
    const events = Provenance.read(row);
    if (events.some(event => event.operationId === 'r9-actual-backup-maintenance')) changedRowsWithProvenance += 1;
  });
}));
assert.strictEqual(maintenanceAfterRows, maintenanceBeforeRows, 'lifecycle maintenance changed formal row count');
assert.strictEqual(changedRowsWithProvenance, report.changed, 'maintenance changes do not all have provenance events');
assert.strictEqual(maintenanceChat.memoryTables.lifecycle.schemaVersion, '3.1');

const registry = readApp('js/app_registry.js');
assert(registry.includes("'search', 'proment', 'appearance'"), 'Proment is still missing from desktop homeAppIds');
assert(registry.includes("navigate('magic-room-screen')"), 'Proment opener does not navigate to its existing screen');

const sourceHashAfter = digest(sourceArchive);
assert.strictEqual(sourceHashAfter, sourceHashBefore, 'source backup archive was modified');
const result = {
  version: '2.14-R9',
  sourceBackupType: 'single-user-compact',
  sourceSha256Unchanged: true,
  sourceSha256: sourceHashBefore,
  baseline: {
    characters: characters.length,
    templates: templates.length,
    tables: templates.reduce((sum, template) => sum + (template.tables || []).length, 0),
    fields: fieldCount,
    formalRows: rowCount
  },
  provenanceReadOnly: {
    rowsWithReadableSourceOrChangeEvents: readableRows,
    derivedEventCount,
    formalMemoryHashUnchanged: hashObject(chat.memoryTables.data) === formalHashBefore
  },
  lifecycleHealth: {
    score: health.score,
    statuses: health.stats,
    sources: health.sources,
    dueRows: health.due.length,
    conflictRows: health.conflicts.length,
    archivedRows: health.archived.length,
    missingSourceRows: health.missingSource.length,
    expiringSoonRows: health.expiringSoon.length,
    exactDuplicateGroups: health.duplicateGroups.length,
    previewChecked: health.plan.checked,
    previewChanged: health.plan.changed
  },
  maintenanceOnCopy: {
    checked: report.checked,
    changed: report.changed,
    expired: report.expired,
    archived: report.archived,
    uncertain: report.uncertain,
    skipped: report.skipped,
    formalRowCountBefore: maintenanceBeforeRows,
    formalRowCountAfter: maintenanceAfterRows,
    changedRowsWithProvenance
  },
  promentDesktop: {
    presentInHomeAppIds: true,
    targetScreen: 'magic-room-screen'
  },
  sourceBackupModified: false
};
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
