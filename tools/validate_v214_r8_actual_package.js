const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.join(root, 'docs', 'V2.14-R8_实际记忆包WorkItem与记录身份验证.json');
if (!inputPath) throw new Error('usage: node tools/validate_v214_r8_actual_package.js <memory-package.json> [report.json]');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const sourceBytes = fs.readFileSync(inputPath);
const sourceHashBefore = crypto.createHash('sha256').update(sourceBytes).digest('hex');
const source = JSON.parse(sourceBytes.toString('utf8'));
const sourceSnapshot = JSON.stringify(source);
const templates = clone(source.templates || []);
const binding = clone(source.binding || {});
const chat = {
  id: 'actual-memory-r8-validation',
  memoryMode: binding.memoryMode || 'table',
  memoryTables: {
    ...binding,
    boundTemplateIds: templates.map(template => template.id),
    data: clone(binding.data || {}),
    lockedFields: clone(binding.lockedFields || {}),
    history: []
  }
};
const db = { memoryTableTemplates: templates, characters: [chat] };

const box = {
  window: null, console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object,
  Error, Promise, RegExp, parseInt, parseFloat, isNaN, setTimeout, clearTimeout, db
};
box.window = box;
vm.createContext(box);
vm.runInContext(read('js/features/memory/kernel.js'), box, { filename: 'kernel.js' });
vm.runInContext(read('js/features/memory/record_identity.js'), box, { filename: 'record_identity.js' });
vm.runInContext(read('js/features/memory/domain.js'), box, { filename: 'domain.js' });
const Kernel = box.OvoMemoryKernel;
const Domain = Kernel.require('domain');
const Identity = Kernel.require('recordIdentity');

let rowCount = 0;
let identityCount = 0;
let duplicateRecordKeys = 0;
const tableReports = [];
templates.forEach(template => {
  Domain.ensureTemplateDataForChat(chat, template);
  (template.tables || []).forEach(table => {
    if (!Domain.isRowsTable(table)) return;
    const rows = Domain.getRows(chat, template.id, table);
    rowCount += rows.length;
    const keys = rows.map(row => {
      const identity = Identity.ensure(table, row);
      if (identity?.recordKey && identity?.firstSeenAt && identity?.lastSeenAt) identityCount += 1;
      return identity?.recordKey || '';
    }).filter(Boolean);
    const duplicates = keys.length - new Set(keys).size;
    duplicateRecordKeys += duplicates;
    tableReports.push({ templateId: template.id, tableId: table.id, tableName: table.name, rows: rows.length, identities: keys.length, duplicateRecordKeys: duplicates });
  });
});
assert.strictEqual(rowCount, 234);
assert.strictEqual(identityCount, rowCount);
assert.strictEqual(duplicateRecordKeys, 0);

// Use an actual recent-event row to verify same-event Upsert updates instead of appending.
const recentDescriptor = templates.flatMap(template => (template.tables || []).map(table => ({ template, table })))
  .find(item => Domain.isRowsTable(item.table) && (item.table.columns || []).some(field => /^事件ID$/.test(String(field.key || ''))) && Domain.getRows(chat, item.template.id, item.table).length);
assert(recentDescriptor, 'actual package has no event-id row table');
const actualRows = Domain.getRows(chat, recentDescriptor.template.id, recentDescriptor.table);
const sourceRow = actualRows[0];
const incoming = clone(sourceRow.cells);
const contentField = recentDescriptor.table.columns.find(field => /^内容$/.test(String(field.key || '')));
assert(contentField);
incoming[contentField.id] = `${String(incoming[contentField.id] || '')}\n[R8 Upsert 验证]`;
const beforeUpsertCount = actualRows.length;
const upsert = Domain.upsertRow(chat, recentDescriptor.template.id, recentDescriptor.table, incoming, { source: 'v214_r8_actual_validation', mergeStrategy: 'replace_non_empty' });
assert.strictEqual(upsert.created, false);
assert.strictEqual(upsert.matched, true);
assert(['record_key', 'strong_key', 'source_fingerprint', 'title_date', 'content_fingerprint'].includes(upsert.matchedBy));
assert.strictEqual(Domain.getRows(chat, recentDescriptor.template.id, recentDescriptor.table).length, beforeUpsertCount);
assert(String(upsert.row.cells[contentField.id]).includes('[R8 Upsert 验证]'));

// Build WorkItems from the actual package copy without creating a second storage model.
Kernel.register('review', {
  getPendingBatches: currentChat => currentChat.memoryTables.reviewState?.pendingBatches || [],
  getBatchChangeSummary: batch => ({ recordCount: Number(batch?.recordCount) || 0, fieldCount: (batch?.proposals || []).length })
});
Kernel.register('lifecycle', {
  textForRow: (table, row) => Domain.getRowSearchText(table, row),
  ensureRowMeta: row => { row.meta ||= {}; row.meta.lifecycle ||= { status: row.meta.status || 'active', reviewAt: 0, expiresAt: 0 }; return row.meta; }
});
Kernel.register('tasks', { ensureState: currentChat => currentChat.memoryTables.taskQueue || { tasks: [] } });
Kernel.register('sidecar', { ensureState: currentChat => { currentChat.memoryTables.sidecar ||= { candidates: [] }; currentChat.memoryTables.sidecar.candidates ||= []; return currentChat.memoryTables.sidecar; } });
Kernel.register('feedback', {
  getPendingCount: currentChat => (currentChat.memoryTables.feedback?.rounds || []).reduce((sum, round) => sum + (round.items || []).filter(item => item.feedback === 'pending').length, 0)
});
Kernel.register('policy', { normalizeTablePolicy: table => ({ memoryLayer: table.memoryLayer || '' }) });
Kernel.register('candidateService', {
  VERSION: 'actual-validation',
  isPending(table, row) {
    const field = (table.columns || []).find(item => String(item.key || '') === '审核状态');
    const status = field ? String(row.cells?.[field.id] || '') : '';
    return !/已批准|已拒绝|已完成|已关闭/.test(status);
  },
  statusText(table, row) {
    const field = (table.columns || []).find(item => String(item.key || '') === '审核状态');
    return field ? String(row.cells?.[field.id] || '') : '';
  }
});
vm.runInContext(read('js/features/memory/sidecar_candidate_service.js'), box, { filename: 'sidecar_candidate_service.js' });
vm.runInContext(read('js/features/memory/work_item.js'), box, { filename: 'work_item.js' });
const WorkItem = Kernel.require('workItem');
const workItems = WorkItem.collect(chat, templates);
workItems.forEach(item => assert.strictEqual(WorkItem.validate(item).ok, true));
const byType = workItems.reduce((acc, item) => { acc[item.type] = (acc[item.type] || 0) + 1; return acc; }, {});
assert.strictEqual(byType.short_candidate || 0, 4, 'four legacy sidecar candidates should become explicit pending work items');
assert.strictEqual(chat.memoryTables.sidecar.candidates.filter(item => item.status === 'legacy_unverified').length, 4);

const sourceHashAfter = crypto.createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex');
assert.strictEqual(sourceHashAfter, sourceHashBefore);
assert.strictEqual(JSON.stringify(source), sourceSnapshot);
const report = {
  version: '2.14-R8',
  sourceFile: path.basename(inputPath),
  templates: templates.length,
  tables: templates.reduce((sum, template) => sum + (template.tables || []).length, 0),
  fields: templates.reduce((sum, template) => sum + (template.tables || []).reduce((n, table) => n + (table.columns || []).length, 0), 0),
  formalRows: rowCount,
  identityRows: identityCount,
  duplicateRecordKeys,
  upsert: {
    tableName: recentDescriptor.table.name,
    rowsBefore: beforeUpsertCount,
    rowsAfter: Domain.getRows(chat, recentDescriptor.template.id, recentDescriptor.table).length,
    matchedBy: upsert.matchedBy,
    created: upsert.created,
    changedFields: upsert.changedFields.length
  },
  workItems: { total: workItems.length, byType, legacyCandidatesExposed: byType.short_candidate || 0 },
  sourceSha256Before: sourceHashBefore,
  sourceSha256After: sourceHashAfter,
  sourceUnchanged: sourceHashBefore === sourceHashAfter,
  tablesDetail: tableReports,
  result: 'PASS'
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
