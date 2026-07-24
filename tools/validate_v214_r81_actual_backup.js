const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const extracted = process.argv[2];
const sourceArchive = process.argv[3];
const outputPath = process.argv[4] || path.join(root, 'docs', 'V2.14-R8.1_实际备份策略分流验证.json');
if (!extracted || !sourceArchive) throw new Error('usage: node validate_v214_r81_actual_backup.js <extracted-backup> <source.ee> [output.json]');
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

const countRows = () => templates.reduce((sum, template) => sum + (template.tables || []).reduce((subtotal, table) => {
  const rows = chat.memoryTables?.data?.[template.id]?.[table.id]?.__rows;
  return subtotal + (Array.isArray(rows) ? rows.length : 0);
}, 0), 0);
const findTable = role => {
  for (const template of templates) {
    const table = (template.tables || []).find(item => item.systemRole === role);
    if (table) return { template, table };
  }
  return null;
};
const rowsOf = descriptor => chat.memoryTables.data[descriptor.template.id][descriptor.table.id].__rows;
const currentDescriptor = findTable('current_state');
const recentDescriptor = findTable('recent_events');
const dailyDescriptor = findTable('daily_observation');
assert(currentDescriptor && recentDescriptor && dailyDescriptor, 'required memory roles missing');
const totalRowsBefore = countRows();
const formalBefore = hashObject(chat.memoryTables.data);
const sidecarReviewsBefore = (chat.memoryTables.reviewState?.pendingBatches || []).filter(batch => batch.source === 'sidecar_field_policy' && batch.tableId === currentDescriptor.table.id).length;
const recentBefore = rowsOf(recentDescriptor).length;
const dailyBefore = rowsOf(dailyDescriptor).length;

global.window = global;
global.document = { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] };
global.addEventListener = () => {};
global.renderMemoryTableScreen = () => {};
global.saveCharacter = async () => {};
global.currentChatId = chat.id;
global.currentChatType = 'private';
global.MemoryTablePolicy = { clearRetrievalCache() {} };
global.confirm = () => true;
global.db = { memoryTableTemplates: templates, characters: [chat] };
[
  'js/features/memory/kernel.js',
  'js/modules/memory_table_policy.js',
  'js/features/memory/policy_resolver.js',
  'js/features/memory/field_policy.js',
  'js/features/memory/record_identity.js',
  'js/features/memory/domain.js',
  'js/modules/memory_table_review.js',
  'js/features/memory/write_coordinator.js',
  'js/features/memory/write_gateway.js',
  'js/features/memory/sidecar_candidate_service.js',
  'js/modules/memory_table_sidecar.js'
].forEach(rel => vm.runInThisContext(readApp(rel), { filename: rel }));

(async () => {
  const Kernel = OvoMemoryKernel;
  const Sidecar = Kernel.require('sidecar');
  const Review = Kernel.require('review');
  const FieldPolicy = Kernel.require('fieldPolicy');

  const migrationReport = await Sidecar.applySidecar(chat, { version: 2, status: { fields: {} }, taskOps: [], candidates: [] }, { roundId: 'r81-backup-review-migration' });
  const formalAfterReviewMigration = hashObject(chat.memoryTables.data);
  const sidecarReviewsAfter = Review.getPendingBatches(chat).filter(batch => batch.source === 'sidecar_field_policy' && batch.tableId === currentDescriptor.table.id).length;
  const runtimeFieldCount = Object.keys(chat.memoryTables.runtimeState?.fieldValues?.[currentDescriptor.template.id]?.[currentDescriptor.table.id] || {}).length;
  assert.strictEqual(formalAfterReviewMigration, formalBefore, 'review migration changed formal memory');
  assert.strictEqual(sidecarReviewsAfter, 0, 'old current-state sidecar reviews were not cleared');
  assert(runtimeFieldCount > 0, 'latest inferred state was not migrated to runtime');

  await Sidecar.applySidecar(chat, { version: 2, status: { fields: {} }, taskOps: [], candidates: [
    { type: 'experience', summary: 'R8.1 实际备份验证事件', tags: { topic: ['验证'] }, confidence: 100, source: 'user_explicit' },
    { type: 'daily_observation', summary: 'R8.1 实际备份验证日常状态', tags: { topic: ['验证'] }, confidence: 100, source: 'user_explicit' }
  ] }, { roundId: 'r81-backup-direct-1' });
  const recentAfter = rowsOf(recentDescriptor).length;
  const dailyAfterFirst = rowsOf(dailyDescriptor).length;
  await Sidecar.applySidecar(chat, { version: 2, status: { fields: {} }, taskOps: [], candidates: [
    { type: 'daily_observation', summary: 'R8.1 同日第二次验证状态', tags: { topic: ['验证'] }, confidence: 100, source: 'user_explicit' }
  ] }, { roundId: 'r81-backup-direct-2' });
  const dailyAfterSecond = rowsOf(dailyDescriptor).length;
  const autoPromoted = (chat.memoryTables.sidecar?.candidates || []).filter(candidate => candidate.processedBy === 'sidecar_auto' && candidate.status === 'promoted').length;
  assert(recentAfter >= recentBefore, 'recent-event direct flow lost rows');
  assert(dailyAfterFirst >= dailyBefore, 'daily direct flow lost rows');
  assert.strictEqual(dailyAfterSecond, dailyAfterFirst, 'same-day daily observation created a duplicate row');
  assert(autoPromoted >= 3, 'explicit candidates did not auto-promote');
  assert.strictEqual(countRows() >= totalRowsBefore, true, 'formal row count unexpectedly decreased');

  const sourceHashAfter = digest(sourceArchive);
  assert.strictEqual(sourceHashAfter, sourceHashBefore, 'source backup archive was modified');
  const result = {
    version: '2.14-R8.1',
    sourceBackupType: 'single-user-compact',
    sourceSha256Unchanged: true,
    sourceSha256: sourceHashBefore,
    baseline: {
      templates: templates.length,
      tables: templates.reduce((sum, template) => sum + (template.tables || []).length, 0),
      fields: templates.reduce((sum, template) => sum + (template.tables || []).reduce((subtotal, table) => subtotal + (table.columns || []).length, 0), 0),
      formalRows: totalRowsBefore,
      currentStateSidecarReviewBatches: sidecarReviewsBefore,
      recentRows: recentBefore,
      dailyRows: dailyBefore
    },
    reviewMigration: {
      removedBatches: migrationReport.reviewCompacted?.removedBatches || 0,
      latestFields: migrationReport.reviewCompacted?.latestFields || 0,
      remainingCurrentStateSidecarBatches: sidecarReviewsAfter,
      runtimeFieldsAfterMigration: runtimeFieldCount,
      formalMemoryHashUnchanged: formalAfterReviewMigration === formalBefore
    },
    directCandidateFlow: {
      recentRowsAfter: recentAfter,
      dailyRowsAfterFirstWrite: dailyAfterFirst,
      dailyRowsAfterSecondSameDayWrite: dailyAfterSecond,
      sameDayUpsertNoDuplicate: dailyAfterFirst === dailyAfterSecond,
      autoPromotedCandidates: autoPromoted
    },
    fieldPolicyVersion: FieldPolicy.VERSION,
    sourceBackupModified: false
  };
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exit(1); });
