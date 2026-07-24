const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
assert(['2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6'].includes(read('VERSION.txt').trim()));

function createBox() {
  const box = {
    console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object, Error, Promise,
    setTimeout, clearTimeout, queueMicrotask,
    window: null,
    document: { addEventListener() {}, querySelectorAll: () => [] },
    db: { memoryTableTemplates: [], characters: [] }
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('js/features/memory/kernel.js'), box, { filename: 'kernel.js' });
  vm.runInContext(read('js/modules/memory_table_policy.js'), box, { filename: 'memory_table_policy.js' });
  vm.runInContext(read('js/features/memory/field_policy.js'), box, { filename: 'field_policy.js' });
  return box;
}

const box = createBox();
const FieldPolicy = box.OvoMemoryKernel.require('fieldPolicy');
assert.strictEqual(FieldPolicy.VERSION, '2.14-R3');

const directTable = {
  id: 'state', name: '当前状态', mode: 'keyValue', memoryLayer: 'short', systemRole: 'current_state',
  commitPolicy: { mode: 'direct' }, updatePolicy: {}, injectionPolicy: {}
};
const scene = { id: 'scene', key: 'user_当前场景', type: 'text', aiEditable: true };
const mental = { id: 'mental', key: 'user_精神状态', type: 'text', aiEditable: true };
const roleJudgement = { id: 'role', key: 'role_即时判断', type: 'longtext', aiEditable: true };
const timestamp = { id: 'time', key: '状态记录时间', type: 'date', aiEditable: true };

assert.deepStrictEqual(JSON.parse(JSON.stringify(FieldPolicy.normalizeFieldPolicy(scene, directTable))), {
  subject: 'user', evidence: 'explicit', commitMode: 'direct', minConfidence: 65
});
assert.strictEqual(FieldPolicy.normalizeFieldPolicy(mental, directTable).commitMode, 'candidate');
assert.strictEqual(FieldPolicy.normalizeFieldPolicy(mental, directTable).evidence, 'inferred');
assert.strictEqual(FieldPolicy.normalizeFieldPolicy(roleJudgement, directTable).commitMode, 'runtime_only');
assert.strictEqual(FieldPolicy.normalizeFieldPolicy(timestamp, directTable).subject, 'system');
assert.strictEqual(FieldPolicy.normalizeFieldPolicy(timestamp, directTable).commitMode, 'direct');

let assessment = FieldPolicy.assess(scene, directTable, { source: 'user_explicit', confidence: 90 });
assert.strictEqual(assessment.route, 'direct');
assessment = FieldPolicy.assess(scene, directTable, { source: 'assistant_inferred', confidence: 90 });
assert.strictEqual(assessment.route, 'review');
assert(assessment.reasons.includes('缺少用户明确表达'));
assessment = FieldPolicy.assess(scene, directTable, { source: 'user_explicit', confidence: 40 });
assert.strictEqual(assessment.route, 'review');
assessment = FieldPolicy.assess(mental, directTable, { source: 'assistant_inferred', confidence: 88 });
assert.strictEqual(assessment.route, 'candidate');
assessment = FieldPolicy.assess(roleJudgement, directTable, { source: 'assistant_inferred', confidence: 30 });
assert.strictEqual(assessment.route, 'runtime_only');

const chat = { id: 'c', memoryTables: {} };
FieldPolicy.setRuntimeValue(chat, 'tpl', 'state', 'role', '保持安静陪伴', { source: 'assistant_inferred', confidence: 82 });
assert.strictEqual(FieldPolicy.getRuntimeEntry(chat, 'tpl', 'state', 'role').value, '保持安静陪伴');
assert.strictEqual(chat.memoryTables.runtimeState.schemaVersion, '2.14-R3');

// Domain normalization persists explicit field policies without changing IDs.
vm.runInContext(read('js/features/memory/domain.js'), box, { filename: 'domain.js' });
const Domain = box.OvoMemoryKernel.require('domain');
const normalized = Domain.normalizeTemplate({ id: 'tpl', name: '模板', tables: [{
  ...directTable,
  columns: [
    scene,
    { ...mental, writePolicy: { subject: 'user', evidence: 'inferred', commitMode: 'review', minConfidence: 86 } },
    roleJudgement
  ]
}] });
assert.strictEqual(normalized.tables[0].columns[0].id, 'scene');
assert.strictEqual(normalized.tables[0].columns[1].writePolicy.commitMode, 'review');
assert.strictEqual(normalized.tables[0].columns[1].writePolicy.minConfidence, 86);
assert.strictEqual(normalized.tables[0].columns[2].writePolicy.commitMode, 'runtime_only');

const html = read('index.html');
assert(html.indexOf('memory_table_policy.js') < html.indexOf('field_policy.js'));
assert(html.indexOf('field_policy.js') < html.indexOf('memory_table_review.js'));
const schema = read('js/features/memory/schema_editor.js');
['信息主体', '证据要求', '字段写入', '最低置信度'].forEach(text => assert(schema.includes(text)));
const prompt = read('js/features/memory/update_service.js');
assert(prompt.includes('evidence="user_explicit|assistant_inferred"'));
assert(prompt.includes('confidence="0-100"'));
assert(prompt.includes('字段策略='));
const controller = (read('js/modules/memory_table.js') + '\n' + read('js/features/memory/review_orchestrator.js'));
assert(controller.includes("fieldPolicyRoutes: ['direct', 'runtime_only']"));
assert(controller.includes("fieldPolicyRoutes: ['review', 'candidate', 'blocked']"));
assert(controller.includes('storeRuntimeField'));
const sidecar = read('js/modules/memory_table_sidecar.js');
assert(sidecar.includes("FieldPolicy.assess"));
assert(sidecar.includes('flushFieldReviewBatches'));

const contract = JSON.parse(read('architecture/memory_domains.json'));
assert(['2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6'].includes(contract.version));
assert(contract.publicFacades.memoryUpdateDomain.owns.includes('fieldPolicy'));

console.log('V2.14-R3 FIELD WRITE POLICY CHECKS: PASS');
