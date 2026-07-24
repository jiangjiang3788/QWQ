const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
assert(['2.13-R5.2', '2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1'].includes(read('VERSION.txt').trim()));

const schema = read('js/features/memory/schema_editor.js');
const schemaCss = read('css/modules/memory_schema_editor.css');
assert(schema.includes('统一结构工作台'));
assert(schema.includes('memory-schema-unified-table-grid'));
assert(schema.includes('memory-schema-unified-field-grid'));
assert(!schema.includes('data-schema-tab='));
for (const role of ['table-overlap-messages', 'table-allow-add', 'table-allow-update', 'table-injection-threshold', 'table-include-pinned', 'table-include-completed', 'table-injection-instructions', 'field-options', 'field-min', 'field-max', 'field-display-format', 'field-ai-hint', 'field-conditional-rules']) {
  assert(schema.includes(role), `unified schema column missing: ${role}`);
}
assert(schema.includes('选项、最小值和最大值都允许留空'));
assert(schemaCss.includes('width:100vw'));
assert(schemaCss.includes('height:100dvh'));
assert(/min-width:(?:4850|5300)px/.test(schemaCss));
assert(schemaCss.includes('min-width:2500px'));

const effectsSource = read('js/modules/memory_table_effects.js');
const rowEdit = read('js/features/memory/row_edit_modal.js');
const tableView = read('js/features/memory/table_view.js');
const inspector = read('js/features/memory/row_inspector.js');
for (const label of ['已确认事实', '临时状态', '柔性偏好', '明确边界', '提醒事项', '历史背景', '未审核候选']) {
  assert(effectsSource.includes(label), `Chinese effect label missing: ${label}`);
}
for (const source of [rowEdit, tableView, inspector]) {
  assert(source.includes('effectOptions'));
  assert(source.includes('option.label'));
}

const registry = new Map();
const Kernel = {
  core: {
    escapeHtml: value => String(value ?? ''),
    unique: values => [...new Set(Array.isArray(values) ? values.map(String).filter(Boolean) : [])]
  },
  register(name, value) { registry.set(name, value); return value; },
  get(name) { return registry.get(name); }
};
const context = { window: { OvoMemoryKernel: Kernel }, console, Date, Math, JSON, String, Number, Boolean, Object, Array, Set, Map };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(effectsSource, context, { filename: 'memory_table_effects.js' });
const effects = registry.get('effects');
assert(effects);
assert.strictEqual(effects.effectOptions().find(item => item.value === 'historical_context').label, '历史背景');
assert.strictEqual(effects.normalizeTagBundle({ effect: '历史背景' }, { text: '', table: {} }).effect, 'historical_context');
assert.strictEqual(effects.normalizeTagBundle({ effect: '明确边界' }, { text: '', table: {} }).effect, 'hard_boundary');

console.log('V2.13-R5.2 UNIFIED SCHEMA + CHINESE EFFECT CHECKS: PASS');
