const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.11-R3.1', '2.11-R4', '2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2', '2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6'].includes(read('VERSION.txt').trim()));
const html = read('index.html');
const controller = read('js/modules/memory_table.js');
const css = read('css/modules/memory_table_flat.css');
assert(html.includes('js/features/memory/tag_vocabulary.js'));
assert(html.includes('js/features/memory/relation_service.js'));
assert(html.includes('js/features/memory/merge_review_service.js'));
assert(html.includes('js/features/memory/row_inspector.js'));
assert(html.includes('js/features/memory/row_inspector_controller.js'));
assert(html.indexOf('tag_vocabulary.js') < html.indexOf('tag_service.js'));
assert(html.indexOf('relation_service.js') < html.indexOf('merge_review_service.js'));
assert(html.indexOf('merge_review_service.js') < html.indexOf('row_inspector.js'));
assert(html.indexOf('row_inspector.js') < html.indexOf('row_inspector_controller.js'));
assert(html.indexOf('row_inspector_controller.js') < html.indexOf('memory_table.js'));
assert(controller.includes("Kernel.require('memoryGovernanceDomain')"));
assert(!controller.includes("Kernel.require('relationService')"));
assert(!controller.includes("Kernel.require('rowInspector')"));
assert(!controller.includes("Kernel.require('rowInspectorController')"));
assert(controller.includes('MemoryRowInspectorController.handleAction'));
assert(controller.includes('MemoryRowInspectorController.handleSubmit'));
assert(controller.split(/\r?\n/).length < 4520, 'R2 inspector logic should remain outside memory_table.js');
assert(css.includes('.memory-row-inspector{position:fixed'));
assert(css.includes('.memory-row-relation-item'));
assert(css.includes('.memory-row-tag-merge-grid'));

const context = { window: {}, console, Date, JSON, Math, Set, Map, FormData: class FormDataMock {}, DOMParser: undefined };
context.window.window = context.window;
context.window.confirm = () => true;
vm.createContext(context);
vm.runInContext(read('js/features/memory/kernel.js'), context);
const Kernel = context.window.OvoMemoryKernel;

const template = { id: 'tpl', name: '真实记忆模板', tables: [] };
const fields = [
  { id: 'title', key: '标题', type: 'text', important: true },
  { id: 'content', key: '内容', type: 'longtext', important: true }
];
const medium = { id: 'medium', name: '中期总结与成长经验', mode: 'rows', columns: fields };
const long = { id: 'long', name: '稳定长期特征库', mode: 'rows', columns: fields };
template.tables = [medium, long];
const rowsByTable = new Map();
const target = { id: 'row_target', cells: { title: '主动表达身体需求', content: '用户身体不适时主动请求帮助，并选择安全的处理方式。' }, meta: { tagBundle: { topic: ['主动求助', '身体边界'], scene: ['健康追踪'], entity: ['用户'], effect: 'historical_context' }, sourceMessageIds: ['m1'] } };
const duplicate = { id: 'row_dup', cells: { title: '身体不适时主动求助', content: '用户在身体不舒服时会主动表达需求，优先选择安全方案。' }, meta: { tagBundle: { topic: ['主动求助', '身体边界'], scene: ['健康追踪'], entity: ['用户'], effect: 'historical_context' }, sourceMessageIds: ['m1'] } };
const unrelated = { id: 'row_other', cells: { title: '喜欢草莓蛋糕', content: '用户偏好草莓口味甜点。' }, meta: { tagBundle: { topic: ['饮食偏好'], scene: ['日常聊天'], entity: ['用户'], effect: 'soft_preference' } } };
rowsByTable.set('medium', [target]);
rowsByTable.set('long', [duplicate, unrelated]);
const chat = { id: 'chat_1', memoryTables: { boundTemplateIds: ['tpl'], data: {} } };

Kernel.register('policy', {
  clearRetrievalCache() {},
  ensureRuntimeState() { return {}; }
});
Kernel.register('domain', {
  getBoundTemplates() { return [template]; },
  isRowsTable(table) { return table.mode === 'rows'; },
  getRows(chatArg, templateId, table) { return rowsByTable.get(table.id) || []; },
  getRowSearchText(table, row) { return table.columns.map(field => `${field.key}: ${row.cells[field.id] || ''}`).join('\n'); }
});
Kernel.register('effects', {
  ensureRowMeta(row) { row.meta ||= {}; row.meta.tagBundle ||= { topic: [], scene: [], entity: [], effect: 'historical_context' }; return row.meta; }
});
Kernel.register('lifecycle', {
  ensureRowMeta(row) { row.meta ||= {}; row.meta.relations ||= { supersedes: [], supersededBy: [], conflictsWith: [], relatedTo: [] }; return row.meta; },
  linkRows(a, b, mode) {
    this.ensureRowMeta(a); this.ensureRowMeta(b);
    if (mode === 'related') { a.meta.relations.relatedTo.push(b.id); b.meta.relations.relatedTo.push(a.id); }
    if (mode === 'conflict') { a.meta.relations.conflictsWith.push(b.id); b.meta.relations.conflictsWith.push(a.id); }
    if (mode === 'supersedes') { a.meta.relations.supersedes.push(b.id); b.meta.relations.supersededBy.push(a.id); }
    return true;
  },
  clearRelations(row, rows) {
    row.meta.relations = { supersedes: [], supersededBy: [], conflictsWith: [], relatedTo: [] };
    rows.forEach(other => { if (other !== row && other.meta?.relations) Object.keys(other.meta.relations).forEach(key => { other.meta.relations[key] = other.meta.relations[key].filter(id => id !== row.id); }); });
    return true;
  }
});
Kernel.register('api', { requestContent: async () => '<tags topic="身体,求助" scene="健康追踪" entity="用户" effect="historical_context"/>' });

vm.runInContext(read('js/features/memory/tag_vocabulary.js'), context);
vm.runInContext(read('js/features/memory/tag_service.js'), context);
vm.runInContext(read('js/features/memory/relation_service.js'), context);
vm.runInContext(read('js/features/memory/merge_review_service.js'), context);
vm.runInContext(read('js/features/memory/row_inspector.js'), context);
vm.runInContext(read('js/features/memory/row_inspector_controller.js'), context);

const tags = Kernel.get('tagService');
const relations = Kernel.get('relationService');
const inspector = Kernel.get('rowInspector');
const inspectorController = Kernel.get('rowInspectorController');
assert.strictEqual(Kernel.get('tagVocabulary').VERSION, '2.11-R3.1');
assert.strictEqual(tags.VERSION, '2.11-R3.1');
assert.strictEqual(relations.VERSION, '2.11-R3.1');
assert.strictEqual(inspector.VERSION, '2.11-R3.1');
assert.strictEqual(inspectorController.VERSION, '2.11-R3.1');

const analysis = relations.analyze(chat, 'row_target', { topK: 5, threshold: 0.1 });
assert.strictEqual(analysis.target.row.id, 'row_target');
assert(analysis.items.some(item => item.row.id === 'row_dup'));
const duplicateItem = analysis.items.find(item => item.row.id === 'row_dup');
assert(['duplicate', 'related'].includes(duplicateItem.kind));
assert(duplicateItem.score > 0.45);
assert(!analysis.items.some(item => item.row.id === 'row_other' && item.score > duplicateItem.score));

assert(relations.link(chat, 'row_target', 'row_dup', 'related'));
assert(target.meta.relations.relatedTo.includes('row_dup'));
const linkedAnalysis = relations.analyze(chat, 'row_target', { topK: 5, threshold: 0.1 });
assert(linkedAnalysis.items.find(item => item.row.id === 'row_dup').explicit);

const oldBundle = JSON.parse(JSON.stringify(target.meta.tagBundle));
tags.setLocked(target, true);
const lockedResult = tags.applyToRow(target, { topic: ['被模型覆盖'], scene: [], entity: [], effect: 'fact' }, { source: 'ai' });
assert.strictEqual(lockedResult.locked, true);
assert.deepStrictEqual(JSON.parse(JSON.stringify(target.meta.tagBundle)), oldBundle);
const manualResult = tags.applyToRow(target, { topic: ['主动求助', '身体照顾'], scene: ['健康追踪'], entity: ['用户'], effect: 'historical_context' }, { force: true, source: 'manual' });
assert(manualResult.changed);

const mergeSkipped = relations.mergeTag(chat, { dimension: 'topic', from: '主动求助', to: '主动表达' });
assert(mergeSkipped.skippedLocked >= 1);
tags.setLocked(target, false);
const merge = relations.mergeTag(chat, { dimension: 'topic', from: '主动求助', to: '主动表达' });
assert(merge.changedRows >= 1);
assert(target.meta.tagBundle.topic.includes('主动表达'));

const targetDescriptor = relations.findById(chat, 'row_target');
const analysisForInspector = relations.analyze(chat, targetDescriptor, { topK: 5 });
const htmlOut = inspector.render({ chat, target: targetDescriptor, analysis: analysisForInspector, busy: false, tab: 'relations' });
assert(htmlOut.includes('memory-row-inspector'));
assert(htmlOut.includes('相关记忆'));
assert(htmlOut.includes('memory-row-inspector-tabs'));
assert(!htmlOut.includes('data-row-tag-form'));
const tagsHtml = inspector.render({ chat, target: targetDescriptor, analysis: analysisForInspector, busy: false, tab: 'tags' });
assert(tagsHtml.includes('data-action="regenerate-row-tags"'));
const vocabularyHtml = inspector.render({ chat, target: targetDescriptor, analysis: analysisForInspector, busy: false, tab: 'vocabulary' });
assert(vocabularyHtml.includes('统一标签词表'));
assert(inspectorController.handles('open-row-inspector'));
assert(inspectorController.handles('merge-memory-tags'));
assert(!inspectorController.handles('unrelated-action'));

const jsonBundle = tags.parseGeneratedBundle(JSON.stringify({ topic: ['睡眠'], scene: ['睡前'], entity: ['用户'], effect: 'soft_preference' }));
assert.deepStrictEqual(JSON.parse(JSON.stringify(jsonBundle)), { topic: ['睡眠'], scene: ['睡前'], entity: ['用户'], effect: 'soft_preference' });
assert(tags.buildRegenerationPrompt(long, duplicate, []).includes('只为下面这条结构化记忆重新生成标签'));
assert.strictEqual(context.window.OVOAICapabilityCatalog, undefined);
assert(read('js/modules/ai_capability_catalog.js').includes("tasks: ['memory-table-tags']"));

console.log('V2.11-R2 MEMORY RELATION + TAG MANAGEMENT CHECKS: PASS');
