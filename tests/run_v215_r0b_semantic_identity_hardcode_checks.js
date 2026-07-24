const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
assert.strictEqual(read('VERSION.txt').trim(), '2.15-R0B');

function createBox(extra = {}) {
  const box = {
    window: null, console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object,
    Error, Promise, RegExp, parseInt, parseFloat, isNaN, setTimeout, clearTimeout, ...extra
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('js/features/memory/kernel.js'), box, { filename: 'kernel.js' });
  return box;
}

// Production load order and explicit default-template semantics.
{
  const html = read('index.html');
  assert(html.indexOf('memory_defaults.js') < html.indexOf('memory_table_policy.js'));
  assert(html.indexOf('memory_table_policy.js') < html.indexOf('field_semantics.js'));
  assert(html.indexOf('field_semantics.js') < html.indexOf('field_policy.js'));
  const pkg = JSON.parse(read('memory_templates/当前默认记忆模板_V2.8.json'));
  assert.strictEqual(pkg.schemaVersion, '3.2');
  assert.strictEqual(pkg.producerVersion, '2.15-R0B');
  const template = pkg.templates[0];
  assert.strictEqual(template.tables.length, 8);
  const fields = template.tables.flatMap(table => table.columns || []);
  assert.strictEqual(fields.length, 94);
  fields.forEach(field => {
    assert(/^[a-z][a-z0-9_]*$/.test(field.semanticRole), `${field.key} missing semanticRole`);
    assert(['none','primary_key','source_key','title','date','content','volatile'].includes(field.identityRole), `${field.key} missing identityRole`);
  });
  const longCandidate = template.tables.find(table => table.systemRole === 'long_candidate');
  assert(longCandidate?.promotionPolicy?.fieldMap?.candidate_content === 'content');
}

// Record identity survives display-name changes because identity is metadata-driven.
{
  const box = createBox();
  for (const rel of ['js/features/memory/memory_defaults.js','js/modules/memory_table_policy.js','js/features/memory/field_semantics.js','js/features/memory/record_identity.js']) {
    vm.runInContext(read(rel), box, { filename: rel });
  }
  const Identity = box.OvoMemoryKernel.require('recordIdentity');
  const table = { systemRole: 'recent_events', columns: [
    { id: 'a', key: '随便改名甲', semanticRole: 'event_id', identityRole: 'primary_key' },
    { id: 'b', key: '随便改名乙', semanticRole: 'event_date', identityRole: 'date' },
    { id: 'c', key: '随便改名丙', semanticRole: 'title', identityRole: 'title' },
    { id: 'd', key: '随便改名丁', semanticRole: 'content', identityRole: 'content' }
  ] };
  assert.strictEqual(Identity.strongKey(table, { a: 'EV-1', b: '2026-07-24', c: '标题', d: '正文' }), 'event_id=ev1');
  assert.strictEqual(Identity.titleDateKey(table, { b: '2026-07-24', c: '标题' }), '20260724|标题');
  assert(!read('js/features/memory/record_identity.js').includes('事件ID'));
  assert(!read('js/features/memory/record_identity.js').includes('原始记录ID'));
}

// Sidecar writes renamed fields by semantic role, not by Chinese label or fixed table id.
{
  const box = createBox();
  const Kernel = box.OvoMemoryKernel;
  Kernel.register('domain', {
    isRowsTable: table => table.mode === 'rows', getBoundTemplates: () => [], getRows: () => [],
    getRowSearchText: () => '', getFieldDisplayValue: (_f, value) => value, isSameMemoryValue: (a,b) => JSON.stringify(a) === JSON.stringify(b)
  });
  Kernel.register('lifecycle', {});
  Kernel.register('writeCoordinator', { run: async (_chat, _options, mutate) => mutate({}) });
  Kernel.register('sidecar', { ensureState: chat => (chat.memoryTables.sidecar ||= { candidates: [] }) });
  for (const rel of ['js/features/memory/memory_defaults.js','js/modules/memory_table_policy.js','js/features/memory/field_semantics.js','js/features/memory/sidecar_candidate_service.js']) {
    vm.runInContext(read(rel), box, { filename: rel });
  }
  const Service = Kernel.require('sidecarCandidateService');
  const table = { id: 'renamed', systemRole: 'recent_events', mode: 'rows', columns: [
    { id: 'id1', key: '甲', semanticRole: 'event_id', identityRole: 'primary_key', type: 'text' },
    { id: 'id2', key: '乙', semanticRole: 'created_at', identityRole: 'date', type: 'text' },
    { id: 'id3', key: '丙', semanticRole: 'title', identityRole: 'title', type: 'text' },
    { id: 'id4', key: '丁', semanticRole: 'content', identityRole: 'content', type: 'longtext' },
    { id: 'id5', key: '戊', semanticRole: 'source_record_id', identityRole: 'source_key', type: 'text' }
  ] };
  const values = Service.buildValues({ id: 'cand-1', type: 'experience', summary: '用户完成测试', tags: {}, source: 'user_explicit', confidence: 100 }, table);
  assert.strictEqual(values.id1, 'cand-1');
  assert.strictEqual(values.id3, '用户完成测试');
  assert.strictEqual(values.id4, '用户完成测试');
  assert.strictEqual(values.id5, 'cand-1');
  for (const token of ['table_recent_events','table_daily_observation','table_current_state','table_tasks']) {
    assert(!read('js/features/memory/sidecar_candidate_service.js').includes(token));
    assert(!read('js/modules/memory_table_sidecar.js').includes(token));
  }
}

// Promotion fieldMap works after both source and target display names change.
{
  const box = createBox();
  const Kernel = box.OvoMemoryKernel;
  const rows = { source: [], target: [] };
  const Domain = {
    isRowsTable: table => table.mode === 'rows',
    getRows: (_chat, _templateId, table) => rows[table.id],
    findRowById: (_chat, _templateId, table, id) => rows[table.id].find(row => row.id === id),
    getFieldDisplayValue: (_field, value) => value,
    updateRowFieldValue: (_chat, _templateId, table, rowId, field, value) => { const row = rows[table.id].find(item => item.id === rowId); const changed = row.cells[field.id] !== value; row.cells[field.id] = value; return changed; },
    addRow: (_chat, _templateId, table, values, options = {}) => { const row = { id: `new-${rows[table.id].length + 1}`, cells: { ...values }, meta: options.meta || {} }; rows[table.id].push(row); return row; },
    isSameMemoryValue: (a,b) => JSON.stringify(a) === JSON.stringify(b), pushMemoryHistory() {}
  };
  Kernel.register('domain', Domain);
  Kernel.register('lifecycle', { recordSource() {}, setStatus() {} });
  Kernel.register('writeCoordinator', { run: async (_chat, _options, mutate) => mutate({}) });
  for (const rel of ['js/features/memory/memory_defaults.js','js/modules/memory_table_policy.js','js/features/memory/field_semantics.js','js/features/memory/candidate_service.js']) {
    vm.runInContext(read(rel), box, { filename: rel });
  }
  const source = { id: 'source', systemRole: 'long_candidate', memoryLayer: 'review', mode: 'rows', promotionPolicy: {
    targetTableId: 'target', fieldMap: { candidate_category: 'category', candidate_content: 'content', confidence: 'confidence', exception: 'applicability_exception' }
  }, columns: [
    { id: 's1', key: '名字已改1', semanticRole: 'candidate_category', identityRole: 'title' },
    { id: 's2', key: '名字已改2', semanticRole: 'candidate_content', identityRole: 'content' },
    { id: 's3', key: '名字已改3', semanticRole: 'confidence', identityRole: 'volatile' },
    { id: 's4', key: '名字已改4', semanticRole: 'exception', identityRole: 'content' },
    { id: 's5', key: '名字已改5', semanticRole: 'review_status', identityRole: 'volatile' }
  ] };
  const target = { id: 'target', systemRole: 'long_store', memoryLayer: 'long', mode: 'rows', columns: [
    { id: 't1', key: '目标甲', semanticRole: 'category', identityRole: 'title' },
    { id: 't2', key: '目标乙', semanticRole: 'content', identityRole: 'content' },
    { id: 't3', key: '目标丙', semanticRole: 'confidence', identityRole: 'volatile' },
    { id: 't4', key: '目标丁', semanticRole: 'applicability_exception', identityRole: 'content' },
    { id: 't5', key: '目标戊', semanticRole: 'source_record_id', identityRole: 'source_key' }
  ] };
  const row = { id: 'candidate-row', cells: { s1: '偏好', s2: '保持低刺激沟通', s3: 92, s4: '紧急情况例外', s5: '待审核' }, meta: {} };
  rows.source.push(row);
  const result = Kernel.require('candidateService').approve({ memoryTables: { data: {} } }, { template: { id: 'tpl', tables: [source,target] }, table: source }, row, {});
  assert(result.changed && result.targetRow);
  assert.strictEqual(result.targetRow.cells.t1, '偏好');
  assert.strictEqual(result.targetRow.cells.t2, '保持低刺激沟通');
  assert.strictEqual(result.targetRow.cells.t3, 92);
  assert(result.targetRow.cells.t4.includes('紧急情况例外'));
  assert.strictEqual(result.targetRow.cells.t5, 'candidate-row');
}

// Schema migration is copy-only, ordered and idempotent.
{
  const box = createBox();
  for (const rel of ['js/features/memory/memory_defaults.js','js/modules/memory_table_policy.js','js/features/memory/field_semantics.js','js/features/memory/schema_migrator.js']) {
    vm.runInContext(read(rel), box, { filename: rel });
  }
  const Migrator = box.OvoMemoryKernel.require('schemaMigrator');
  const source = { type: 'memory_table_package', version: 3, schemaVersion: '3.1', packageProfile: 'template_bundle', templates: [{ id: 't', tables: [{ id: 'c', systemRole: 'long_candidate', columns: [{ id: 'f', key: '候选内容' }] }] }] };
  const before = JSON.stringify(source);
  const migrated = Migrator.migrate(source).payload;
  assert.strictEqual(migrated.schemaVersion, '3.2');
  assert.strictEqual(migrated.templates[0].tables[0].columns[0].semanticRole, 'candidate_content');
  assert.strictEqual(migrated.templates[0].tables[0].columns[0].identityRole, 'content');
  assert(migrated.templates[0].tables[0].promotionPolicy.fieldMap);
  assert.strictEqual(JSON.stringify(source), before);
  const second = Migrator.migrate(migrated);
  assert.strictEqual(second.report.migrated, false);
}

// Operational routing no longer guesses Chinese names outside the one legacy migration module.
{
  const policy = read('js/modules/memory_table_policy.js');
  const context = read('js/features/memory/context_assembler.js');
  const relation = read('js/features/memory/relation_service.js');
  const merge = read('js/features/memory/merge_review_service.js');
  const quality = read('js/modules/memory_table_quality.js');
  for (const token of ['table_current_state','table_tasks','table_recent_events','table_daily_observation']) {
    assert(!policy.includes(token));
    assert(!context.includes(token));
  }
  assert(!policy.includes('/当前|近期|事件|待办|日常|状态/'));
  assert(!context.includes('/当前状态|即时状态|现状/'));
  assert(!context.includes('/时间|日期|更新|发生|创建|完成/'));
  assert(!relation.includes('TECHNICAL_FIELD'));
  assert(!merge.includes('MERGE_EXCLUDED_FIELD'));
  assert(!quality.includes('/当前状态|待办、承诺|未完成事项/'));
  assert(read('js/features/memory/field_semantics.js').includes('inferLegacyTableRole'));
}

// Critical business thresholds are centralized and the schema UI exposes explicit roles.
{
  assert(read('js/modules/memory_table_policy.js').includes("Kernel?.get?.('memoryDefaults')"));
  assert(read('js/modules/memory_table_lifecycle.js').includes("Kernel?.get?.('memoryDefaults')"));
  assert(read('js/modules/memory_table_retrieval.js').includes("Kernel?.get?.('memoryDefaults')"));
  const schema = read('js/features/memory/schema_editor.js');
  assert(schema.includes('field-semantic-role'));
  assert(schema.includes('field-identity-role'));
  assert(schema.includes('字段语义'));
  assert(schema.includes('身份作用'));
}

console.log('V2.15-R0B SEMANTIC IDENTITY + HARDCODE REMOVAL CHECKS: PASS');
