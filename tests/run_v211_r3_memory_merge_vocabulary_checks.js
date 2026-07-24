const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.11-R3.1', '2.11-R4', '2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2', '2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1'].includes(read('VERSION.txt').trim()));
const html = read('index.html');
const css = read('css/modules/memory_table_flat.css');
const controllerText = read('js/modules/memory_table.js');
assert(html.includes('js/features/memory/tag_vocabulary.js'));
assert(html.includes('js/features/memory/merge_review_service.js'));
assert(html.indexOf('tag_vocabulary.js') < html.indexOf('tag_service.js'));
assert(html.indexOf('merge_review_service.js') < html.indexOf('row_inspector.js'));
assert(css.includes('.memory-row-review-panel'));
assert(css.includes('.memory-tag-vocabulary-list'));
assert(controllerText.includes('inspectorReview'));
assert(controllerText.split(/\r?\n/).length < 4550, 'R3 merge/review logic must stay outside memory_table.js');

const context = { window: {}, console, Date, JSON, Math, Set, Map, DOMParser: undefined, FormData: class FormDataMock {} };
context.window.window = context.window;
context.window.confirm = () => true;
vm.createContext(context);
vm.runInContext(read('js/features/memory/kernel.js'), context);
const Kernel = context.window.OvoMemoryKernel;

const fields = [
  { id: 'title', key: '标题', type: 'text' },
  { id: 'content', key: '内容', type: 'longtext' },
  { id: 'result', key: '可复用经验', type: 'longtext' }
];
const table = { id: 'long', name: '稳定长期特征库', mode: 'rows', columns: fields };
const template = { id: 'tpl', name: '档案模板', tables: [table] };
const current = {
  id: 'current',
  cells: { title: '身体不适时主动求助', content: '用户身体不适时会主动表达需求。', result: '' },
  meta: { tagBundle: { topic: ['主动求助'], scene: ['健康追踪'], entity: ['用户'], effect: 'historical_context' }, sourceMessageIds: ['m1'], evidence: { sourceRefs: [{ type: 'message', id: 'm1', at: 1 }] } }
};
const candidate = {
  id: 'candidate',
  cells: { title: '身体不舒服时主动表达', content: '用户身体不舒服时会主动表达需要帮助。', result: '先表达需求，再选择安全方案。' },
  meta: { tagBundle: { topic: ['主动表达', '身体边界'], scene: ['健康追踪'], entity: ['用户'], effect: 'historical_context' }, sourceMessageIds: ['m2'], evidence: { sourceRefs: [{ type: 'message', id: 'm2', at: 2 }] } }
};
const rows = [current, candidate];
const chat = { id: 'chat', memoryTables: { data: {}, history: [] } };

Kernel.register('policy', { clearRetrievalCache() {}, ensureRuntimeState() { return {}; } });
Kernel.register('domain', {
  getBoundTemplates() { return [template]; },
  isRowsTable(value) { return value.mode === 'rows'; },
  getRows() { return rows; },
  getFieldDisplayValue(field, value) { return value == null ? '' : value; },
  updateRowFieldValue(chatArg, templateId, tableArg, rowId, field, value) {
    const row = rows.find(item => item.id === rowId);
    if (!row) return false;
    const before = row.cells[field.id];
    row.cells[field.id] = value;
    return JSON.stringify(before) !== JSON.stringify(value);
  },
  isEmptyMemoryValue(field, value) { return value == null || String(value).trim() === ''; },
  getRowSearchText(tableArg, row) { return tableArg.columns.map(field => `${field.key}: ${row.cells[field.id] || ''}`).join(' '); }
});
Kernel.register('effects', {
  ensureRowMeta(row) { row.meta ||= {}; row.meta.tagBundle ||= { topic: [], scene: [], entity: [], effect: 'historical_context' }; return row.meta; }
});
Kernel.register('lifecycle', {
  ensureRowMeta(row) {
    row.meta ||= {};
    row.meta.relations ||= { supersedes: [], supersededBy: [], conflictsWith: [], relatedTo: [] };
    row.meta.lifecycle ||= { status: 'active' };
    return row.meta;
  },
  linkRows(a, b, mode) {
    this.ensureRowMeta(a); this.ensureRowMeta(b);
    if (mode === 'supersedes') {
      a.meta.relations.supersedes = [...new Set([...a.meta.relations.supersedes, b.id])];
      b.meta.relations.supersededBy = [...new Set([...b.meta.relations.supersededBy, a.id])];
      a.meta.lifecycle.status = 'active';
      b.meta.lifecycle.status = 'superseded';
    } else if (mode === 'conflict') {
      a.meta.relations.conflictsWith.push(b.id); b.meta.relations.conflictsWith.push(a.id);
      a.meta.lifecycle.status = 'conflicting'; b.meta.lifecycle.status = 'conflicting';
    } else if (mode === 'related') {
      a.meta.relations.relatedTo.push(b.id); b.meta.relations.relatedTo.push(a.id);
    }
    return true;
  },
  clearRelations() { return true; }
});
Kernel.register('api', { requestContent: async () => '' });

for (const rel of [
  'js/features/memory/tag_vocabulary.js',
  'js/features/memory/tag_service.js',
  'js/features/memory/relation_service.js',
  'js/features/memory/merge_review_service.js',
  'js/features/memory/row_inspector.js',
  'js/features/memory/row_inspector_controller.js'
]) vm.runInContext(read(rel), context);

const vocabulary = Kernel.get('tagVocabulary');
const tags = Kernel.get('tagService');
const relations = Kernel.get('relationService');
const merge = Kernel.get('mergeReviewService');
const inspector = Kernel.get('rowInspector');
const inspectorController = Kernel.get('rowInspectorController');
assert.strictEqual(vocabulary.VERSION, '2.11-R3.1');
assert.strictEqual(tags.VERSION, '2.11-R3.1');
assert.strictEqual(relations.VERSION, '2.11-R3.1');
assert.strictEqual(merge.VERSION, '2.11-R3.1');

const alias = vocabulary.registerAlias(chat, { dimension: 'topic', alias: '主动求助', canonical: '主动表达' });
assert(alias.changed);
assert.strictEqual(vocabulary.resolve(chat, 'topic', '主动求助'), '主动表达');
const future = { id: 'future', cells: {}, meta: { tagBundle: { topic: [], scene: [], entity: [], effect: 'fact' } } };
const applied = tags.applyToRow(future, { topic: ['主动求助', '身体边界'], scene: [], entity: ['用户'], effect: 'fact' }, { chat, source: 'test' });
assert(applied.changed);
assert.deepStrictEqual(JSON.parse(JSON.stringify(future.meta.tagBundle.topic)), ['主动表达', '身体边界']);
assert(vocabulary.promptText(chat).includes('主动求助→主动表达'));

const review = merge.preview(chat, 'current', 'candidate');
assert(review);
assert.strictEqual(review.fillCurrentCount, 1);
assert(review.conflictCount >= 2);
assert(review.mergedBundle.topic.includes('主动表达'));
assert.strictEqual(current.cells.content, '用户身体不适时会主动表达需求。');

const result = merge.applyMerge(chat, 'current', 'candidate');
assert(result.changed);
assert.strictEqual(current.cells.result, '先表达需求，再选择安全方案。');
assert.strictEqual(current.cells.content, '用户身体不适时会主动表达需求。', 'non-empty current content must not be overwritten');
assert(current.meta.sourceMessageIds.includes('m1') && current.meta.sourceMessageIds.includes('m2'));
assert.strictEqual(candidate.meta.lifecycle.status, 'superseded');
assert(current.meta.relations.supersedes.includes('candidate'));
assert(Array.isArray(chat.memoryTables.mergeAudit) && chat.memoryTables.mergeAudit.length === 1);
assert(!JSON.stringify(chat.memoryTables.mergeAudit[0]).includes('用户身体不适时'), 'compact audit must not persist full row text');

const analysis = relations.analyze(chat, 'current', { threshold: 0.1, topK: 5 });
const reviewHtml = inspector.render({ chat, target: relations.findById(chat, 'current'), analysis, review: merge.preview(chat, 'current', 'candidate') });
assert(reviewHtml.includes('去重与冲突审核'));
assert(reviewHtml.includes('合并到当前'));
assert(reviewHtml.includes('memory-row-review-diffs'));
assert(!reviewHtml.includes('统一标签词表'), 'focused review must not stack vocabulary below review');
const vocabularyHtml = inspector.render({ chat, target: relations.findById(chat, 'current'), analysis, tab: 'vocabulary' });
assert(vocabularyHtml.includes('统一标签词表'));
assert(vocabularyHtml.includes('主动求助'));
const relationHtml = inspector.render({ chat, target: relations.findById(chat, 'current'), analysis, tab: 'relations' });
assert(relationHtml.includes('memory-row-inspector-tabs'));
assert(relationHtml.includes('switch-row-inspector-tab'));
assert(!relationHtml.includes('data-row-tag-form'), 'inactive tag form must not be rendered');
assert(inspectorController.handles('review-row-relation'));
assert(inspectorController.handles('apply-row-review'));
assert(inspectorController.handles('remove-tag-alias'));
assert(inspectorController.handles('switch-row-inspector-tab'));

console.log('V2.11-R3.1 MEMORY MERGE REVIEW + TAG VOCABULARY CHECKS: PASS');
