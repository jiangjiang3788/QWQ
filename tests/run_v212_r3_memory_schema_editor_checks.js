const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2', '2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6'].includes(read('VERSION.txt').trim()));
const html = read('index.html');
const controller = read('js/modules/memory_table.js');
const workspace = read('js/features/memory/table_workspace.js');
const css = read('css/modules/memory_schema_editor.css');

assert(html.includes('css/modules/memory_schema_editor.css'));
assert(html.includes('js/features/memory/schema_model.js'));
assert(html.includes('js/features/memory/schema_editor.js'));
assert(html.indexOf('schema_model.js') < html.indexOf('schema_editor.js'));
assert(html.indexOf('schema_editor.js') < html.indexOf('memory_table.js'));
assert(html.includes('id="memory-schema-editor-modal"'));
assert(html.includes('id="memory-table-open-schema-editor-btn"'));
assert(!html.includes('id="memory-template-editor-modal"'));
assert(!html.includes('id="memory-template-designer-modal"'));
assert(controller.includes("Kernel.require('memorySchemaDomain')"));
assert(!controller.includes("Kernel.require('schemaEditor')"));
assert(controller.includes("action === 'open-schema-editor'"));
assert(!controller.includes('openTemplateDesigner'));
assert(!controller.includes('openTemplateEditor'));
assert(!controller.includes('edit-template-visual'));
assert(!controller.includes('edit-template-json'));
assert(!controller.includes('data-designer-role'));
assert(workspace.includes('data-action="open-schema-editor"'));
assert(css.includes('.memory-schema-unified-note'));
assert(css.includes('.memory-schema-grid'));
assert(css.includes('.memory-schema-unified-table-grid'));
assert(css.includes('.memory-schema-unified-field-grid'));
assert(controller.split('\n').length < 4000, 'memory controller should shrink after schema extraction');

const clone = value => JSON.parse(JSON.stringify(value));
const registry = new Map();
let seq = 0;
const field = () => ({ id: `f${++seq}`, key: '字段', group: '', type: 'text', default: '', options: [], aiEditable: true, important: true, conditionalRules: [] });
const table = () => ({ id: `t${++seq}`, name: '表格', mode: 'keyValue', memoryLayer: 'short', updatePolicy: {}, injectionPolicy: {}, columns: [field()] });
const domain = {
  createStarterTemplate: () => ({ id: 'tpl1', name: '档案模板', description: '说明', tables: [{ ...table(), name: '核心档案', columns: [{ ...field(), key: '关系', group: '核心关系' }, { ...field(), key: '边界', group: '核心关系' }] }] }),
  createEmptyTableDraft: table,
  createEmptyFieldDraft: field,
  normalizeTemplate: (draft, fallbackId) => ({ ...clone(draft), id: draft.id || fallbackId || 'normalized' }),
  parseOptionText: text => String(text || '').split(/\r?\n|[,，]/).map(x => x.trim()).filter(Boolean),
  parseConditionalRulesText: text => String(text || '').split(/\r?\n/).filter(Boolean).map(line => { const [op, value, color] = line.split('|'); return { op, value: Number(value), color }; }),
  serializeConditionalRules: rules => (rules || []).map(rule => `${rule.op}|${rule.value}|${rule.color}`).join('\n'),
  normalizeFieldType: type => ['text','longtext','number','enum','tags','progress','date','boolean'].includes(type) ? type : 'text'
};
const policy = {
  normalizeLayer: value => value || 'short',
  normalizeUpdatePolicy: value => ({ enabled: false, triggerMode: 'manual', roundInterval: 0, messageInterval: 0, maxSourceMessages: 180, allowDelete: false, useSummaryApi: true, instructions: '', ...value }),
  normalizeInjectionPolicy: value => ({ mode: 'never', topK: 0, budget: 0, maxAgeDays: 0, ...value })
};
const core = {
  clone,
  moveArrayItem(list, from, to) { if (!Array.isArray(list) || from < 0 || from >= list.length || to < 0 || to >= list.length) return; const [item] = list.splice(from, 1); list.splice(to, 0, item); },
  escapeHtml: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  escapeAttribute: value => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
};
const Kernel = { core, get: name => name === 'policy' ? policy : registry.get(name), require: name => { if (name === 'domain') return domain; if (name === 'policy') return policy; const value = registry.get(name); if (!value) throw new Error(`missing ${name}`); return value; }, register: (name, value) => registry.set(name, value) };
const context = { window: { OvoMemoryKernel: Kernel }, console, JSON, Math, Number, String, Array, Object, Map, Set };
vm.createContext(context);
vm.runInContext(read('js/features/memory/field_width.js'), context);
vm.runInContext(read('js/features/memory/schema_model.js'), context);
vm.runInContext(read('js/features/memory/schema_editor.js'), context);
const model = registry.get('schemaModel');
const editor = registry.get('schemaEditor');
assert(model && editor);
assert(['2.12-R3', '2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6'].includes(model.VERSION));
assert(['2.12-R3', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2', '2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6'].includes(editor.VERSION));
const draft = model.prepare(domain.createStarterTemplate());
assert.strictEqual(JSON.stringify(model.summarize(draft)), JSON.stringify({ tableCount: 1, fieldCount: 2, groupCount: 1 }));
assert.strictEqual(model.fieldGroups(draft.tables[0])[0].name, '核心关系');
model.updatePath(draft, 'tables.0.columns.0.group', '关系定义', 'text');
assert.strictEqual(draft.tables[0].columns[0].group, '关系定义');
model.updatePath(draft, 'tables.0.updatePolicy.enabled', 'true', 'boolean');
assert.strictEqual(draft.tables[0].updatePolicy.enabled, true);
assert(model.scalarRows(draft).some(row => row.path === 'tables.0.columns.0.key'));
assert(model.mutate(draft, 'add-field', 0));
assert.strictEqual(draft.tables[0].columns.length, 3);
const state = { activeTableIndex: 0 };
const unifiedMarkup = editor.render(draft, state);
assert(unifiedMarkup.includes('统一结构工作台'));
assert(unifiedMarkup.includes('memory-schema-unified-table-grid'));
assert(unifiedMarkup.includes('memory-schema-unified-field-grid'));
assert(unifiedMarkup.includes('高级：导入或查看原始 JSON'));
assert(!unifiedMarkup.includes('data-schema-tab='));
assert(unifiedMarkup.includes('table-overlap-messages'));
assert(unifiedMarkup.includes('table-injection-threshold'));
assert(unifiedMarkup.includes('field-options'));
assert(unifiedMarkup.includes('field-min'));
assert(unifiedMarkup.includes('field-max'));
assert(unifiedMarkup.includes('placeholder="可空"'));
const normalized = editor.applyRawJson(JSON.stringify(draft), 'fallback');
assert.strictEqual(normalized.tables[0].columns.length, 3);
console.log('V2.12-R3 MEMORY SCHEMA EDITOR CHECKS: PASS');
