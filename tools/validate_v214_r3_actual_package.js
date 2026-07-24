const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const inputPath = path.resolve(process.argv[2] || '/mnt/data/阿沉_memory_package_逻辑收敛修正版.json');
const outputPath = path.resolve(process.argv[3] || path.join(root, 'docs/V2.14-R3_实际记忆包字段级策略验证.json'));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const originalBytes = fs.readFileSync(inputPath);
const originalHash = crypto.createHash('sha256').update(originalBytes).digest('hex');
const pkg = JSON.parse(originalBytes.toString('utf8'));

const box = {
  console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object, Error, Promise,
  setTimeout, clearTimeout, queueMicrotask,
  window: null,
  document: { addEventListener() {}, querySelectorAll: () => [] },
  db: { memoryTableTemplates: [], characters: [] }
};
box.window = box;
vm.createContext(box);
for (const rel of [
  'js/features/memory/kernel.js',
  'js/modules/memory_table_policy.js',
  'js/features/memory/field_policy.js',
  'js/features/memory/domain.js'
]) vm.runInContext(read(rel), box, { filename: rel });

const Kernel = box.OvoMemoryKernel;
const FieldPolicy = Kernel.require('fieldPolicy');
const Domain = Kernel.require('domain');
const normalizedTemplates = (pkg.templates || []).map(template => Domain.normalizeTemplate(template, template.id));

const counts = { direct: 0, review: 0, candidate: 0, runtime_only: 0, manual_only: 0, other: 0 };
const subjects = { user: 0, assistant: 0, relationship: 0, system: 0 };
const fieldDetails = [];
let idsPreserved = true;
(pkg.templates || []).forEach((sourceTemplate, ti) => {
  const normalized = normalizedTemplates[ti];
  if (sourceTemplate.id !== normalized.id) idsPreserved = false;
  (sourceTemplate.tables || []).forEach((sourceTable, tableIndex) => {
    const table = normalized.tables[tableIndex];
    if (sourceTable.id !== table.id) idsPreserved = false;
    (sourceTable.columns || []).forEach((sourceField, fieldIndex) => {
      const field = table.columns[fieldIndex];
      if (sourceField.id !== field.id) idsPreserved = false;
      const policy = FieldPolicy.normalizeFieldPolicy(field, table);
      const route = FieldPolicy.effectiveCommitMode(field, table);
      if (counts[route] === undefined) counts.other += 1; else counts[route] += 1;
      subjects[policy.subject] += 1;
      fieldDetails.push({ table: table.name, field: field.key, group: field.group || '', route, ...policy });
    });
  });
});

const currentState = normalizedTemplates.flatMap(t => t.tables.map(table => ({ template: t, table })))
  .find(item => item.table.systemRole === 'current_state' || /当前状态/.test(item.table.name));
const findField = regex => currentState?.table?.columns?.find(field => regex.test(`${field.group || ''} ${field.key || ''}`));
const sceneField = findField(/user_当前场景/);
const mentalField = findField(/user_精神状态/);
const roleField = findField(/char_回应策略|char_对user的判断|角色.*判断/);
const nextSuggestionField = findField(/user_下一步建议/);

const assessments = {
  explicitScene: sceneField ? FieldPolicy.assess(sceneField, currentState.table, { source: 'user_explicit', confidence: 90 }) : null,
  inferredScene: sceneField ? FieldPolicy.assess(sceneField, currentState.table, { source: 'assistant_inferred', confidence: 90 }) : null,
  inferredMental: mentalField ? FieldPolicy.assess(mentalField, currentState.table, { source: 'assistant_inferred', confidence: 88 }) : null,
  roleRuntime: roleField ? FieldPolicy.assess(roleField, currentState.table, { source: 'assistant_inferred', confidence: 70 }) : null,
  suggestionRuntime: nextSuggestionField ? FieldPolicy.assess(nextSuggestionField, currentState.table, { source: 'assistant_inferred', confidence: 70 }) : null
};

const chat = { id: 'validation-chat', memoryTables: JSON.parse(JSON.stringify(pkg.binding || {})) };
const formalBefore = JSON.stringify(chat.memoryTables.data || {});
if (roleField && currentState) {
  FieldPolicy.setRuntimeValue(chat, currentState.template.id, currentState.table.id, roleField.id, '验证：仅运行态保存', { source: 'assistant_inferred', confidence: 88 });
}
const formalAfter = JSON.stringify(chat.memoryTables.data || {});
const runtimeEntry = roleField && currentState ? FieldPolicy.getRuntimeEntry(chat, currentState.template.id, currentState.table.id, roleField.id) : null;

const result = {
  version: '2.14-R3',
  input: path.basename(inputPath),
  templateCount: normalizedTemplates.length,
  tableCount: normalizedTemplates.reduce((sum, template) => sum + template.tables.length, 0),
  fieldCount: fieldDetails.length,
  routeCounts: counts,
  subjectCounts: subjects,
  idsPreserved,
  currentStateExamples: {
    scene: sceneField ? { field: sceneField.key, policy: FieldPolicy.normalizeFieldPolicy(sceneField, currentState.table), route: FieldPolicy.effectiveCommitMode(sceneField, currentState.table) } : null,
    mental: mentalField ? { field: mentalField.key, policy: FieldPolicy.normalizeFieldPolicy(mentalField, currentState.table), route: FieldPolicy.effectiveCommitMode(mentalField, currentState.table) } : null,
    role: roleField ? { field: roleField.key, policy: FieldPolicy.normalizeFieldPolicy(roleField, currentState.table), route: FieldPolicy.effectiveCommitMode(roleField, currentState.table) } : null,
    suggestion: nextSuggestionField ? { field: nextSuggestionField.key, policy: FieldPolicy.normalizeFieldPolicy(nextSuggestionField, currentState.table), route: FieldPolicy.effectiveCommitMode(nextSuggestionField, currentState.table) } : null
  },
  assessmentRoutes: Object.fromEntries(Object.entries(assessments).map(([key, value]) => [key, value ? { route: value.route, allowed: value.allowed, reasons: value.reasons, confidence: value.confidence } : null])),
  runtimeIsolation: {
    formalDataUnchanged: formalBefore === formalAfter,
    runtimeValueStored: runtimeEntry?.value === '验证：仅运行态保存'
  },
  sourcePackageUnchanged: crypto.createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex') === originalHash,
  sampleFields: fieldDetails.filter(item => item.table.includes('当前状态'))
};

if (!result.idsPreserved) throw new Error('模板、表格或字段 ID 被字段策略规范化改变');
if (!result.runtimeIsolation.formalDataUnchanged || !result.runtimeIsolation.runtimeValueStored) throw new Error('运行态隔离验证失败');
if (assessments.explicitScene?.route !== 'direct') throw new Error('用户明确场景未直接写入');
if (assessments.inferredScene?.route !== 'review') throw new Error('推断场景未降级为审核');
if (assessments.inferredMental?.route !== 'candidate') throw new Error('推断精神状态未进入候选');
if (assessments.roleRuntime?.route !== 'runtime_only') throw new Error('角色判断未隔离到运行态');
if (assessments.suggestionRuntime?.route !== 'runtime_only') throw new Error('下一步建议未隔离到运行态');

fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
