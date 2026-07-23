const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.12-R5.2', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2'].includes(read('VERSION.txt').trim()));
const widthSource = read('js/features/memory/field_width.js');
const schemaSource = read('js/features/memory/schema_editor.js');
const schemaCss = read('css/modules/memory_schema_editor.css');
const controller = read('js/modules/memory_table.js');

assert(widthSource.includes('function visualUnits'));
assert(widthSource.includes('function schemaFieldNames'));
assert(schemaSource.includes('function fieldNameColumnWidth'));
assert(schemaSource.includes('FieldWidth.schemaFieldNames'));
assert(schemaSource.includes('function applyFieldNameWidth'));
assert(widthSource.includes('max: 112'));
assert(widthSource.includes('max: 74'));
assert(schemaCss.includes('var(--schema-field-name-width,88px)'));
assert(schemaCss.includes('var(--schema-field-name-width-mobile,64px)'));
assert(!schemaCss.includes('width:142px'));
assert(!schemaCss.includes('.schema-col-name{width:112px}'));
assert(schemaCss.includes('.schema-col-summary{width:auto}'));
assert(controller.includes("event.target.dataset.schemaRole === 'field-key'"));
assert(controller.includes('MemorySchemaEditor.applyFieldNameWidth'));

const clone = value => JSON.parse(JSON.stringify(value));
const registry = new Map();
let seq = 0;
const field = (key = '字段') => ({ id: `f${++seq}`, key, group: '基础', type: 'text', default: '', options: [], aiEditable: true, important: true, conditionalRules: [] });
const table = () => ({ id: `t${++seq}`, name: '表格', mode: 'keyValue', memoryLayer: 'short', updatePolicy: {}, injectionPolicy: {}, columns: [field()] });
const domain = {
  createStarterTemplate: () => ({ id: 'tpl', name: '模板', description: '', tables: [table()] }),
  createEmptyTableDraft: table,
  createEmptyFieldDraft: field,
  normalizeTemplate: (draft, fallbackId) => ({ ...clone(draft), id: draft.id || fallbackId || 'normalized' }),
  parseOptionText: text => String(text || '').split(/\r?\n|[,，]/).map(x => x.trim()).filter(Boolean),
  parseConditionalRulesText: () => [],
  serializeConditionalRules: () => '',
  normalizeFieldType: type => type || 'text'
};
const policy = {
  normalizeLayer: value => value || 'short',
  normalizeUpdatePolicy: value => ({ enabled: false, triggerMode: 'manual', ...value }),
  normalizeInjectionPolicy: value => ({ mode: 'never', ...value })
};
const core = {
  clone,
  moveArrayItem(list, from, to) { const [item] = list.splice(from, 1); list.splice(to, 0, item); },
  escapeHtml: value => String(value ?? ''),
  escapeAttribute: value => String(value ?? '').replace(/"/g, '&quot;')
};
const Kernel = {
  core,
  get: name => name === 'policy' ? policy : registry.get(name),
  require: name => {
    if (name === 'domain') return domain;
    if (name === 'policy') return policy;
    const value = registry.get(name);
    if (!value) throw new Error(`missing ${name}`);
    return value;
  },
  register: (name, value) => registry.set(name, value)
};
const context = { window: { OvoMemoryKernel: Kernel }, console, JSON, Math, Number, String, Array, Object, Map, Set, RegExp };
vm.createContext(context);
vm.runInContext(widthSource, context);
vm.runInContext(read('js/features/memory/schema_model.js'), context);
vm.runInContext(schemaSource, context);
const editor = registry.get('schemaEditor');
assert(editor);

const shortWidth = editor.fieldNameColumnWidth({ columns: [field('姓名'), field('身份')] });
assert.strictEqual(shortWidth.desktop, 68);
assert.strictEqual(shortWidth.mobile, 54);

const actualWidth = editor.fieldNameColumnWidth({ columns: [field('双方_核心关系定义'), field('char_喜好与生活习惯')] });
assert(actualWidth.desktop <= 112 && actualWidth.desktop > 68);
assert(actualWidth.mobile <= 74 && actualWidth.mobile > 54);
assert(actualWidth.mobile < 112);

const markup = editor.render({ id: 'tpl', name: '模板', description: '', tables: [{ ...table(), columns: [field('双方_核心关系定义'), field('char_喜好与生活习惯')] }] }, { tab: 'fields', activeTableIndex: 0 });
assert(markup.includes('--schema-field-name-width:'));
assert(markup.includes('--schema-field-name-width-mobile:'));
assert(markup.includes('data-schema-name-max-units='));
assert(markup.includes('title="双方_核心关系定义"'));

const styles = new Map();
const dataset = {};
const fakeGrid = { style: { setProperty: (key, value) => styles.set(key, value) }, dataset };
const fakeRoot = { querySelector: selector => selector === '.memory-schema-fields-grid' ? fakeGrid : null };
const draft = { tables: [{ columns: [field('短名')] }] };
editor.applyFieldNameWidth(fakeRoot, draft, { activeTableIndex: 0 });
assert.strictEqual(styles.get('--schema-field-name-width'), '68px');
assert.strictEqual(styles.get('--schema-field-name-width-mobile'), '54px');
draft.tables[0].columns.push(field('char_喜好与生活习惯'));
editor.applyFieldNameWidth(fakeRoot, draft, { activeTableIndex: 0 });
assert(Number(dataset.schemaNameWidthDesktop) <= 112);
assert(Number(dataset.schemaNameWidthMobile) <= 74);
assert(Number(dataset.schemaNameWidthDesktop) > 68);
assert(Number(dataset.schemaNameWidthMobile) > 54);

console.log('V2.12-R5.2/R5.3 ADAPTIVE SCHEMA FIELD WIDTH CHECKS: PASS');
