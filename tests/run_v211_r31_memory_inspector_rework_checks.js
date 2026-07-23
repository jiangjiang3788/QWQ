const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.11-R3.1', '2.11-R4', '2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3'].includes(read('VERSION.txt').trim()));
const css = read('css/modules/memory_table_flat.css');
const controllerText = read('js/features/memory/row_inspector_controller.js');
const tableText = read('js/modules/memory_table.js');
assert(css.includes('.memory-row-inspector-tabs'));
assert(css.includes('.memory-row-inspector.is-review'));
assert(css.includes('.memory-row-review-diffs'));
assert(css.includes('@media(max-width:760px){.memory-row-inspector,.memory-row-inspector.is-review{left:0;right:0;width:auto'));
assert(css.includes('.memory-row-review-actions{position:absolute'));
assert(!css.includes('.memory-row-review-table-wrap'), 'legacy horizontal review table must be removed');
assert(controllerText.includes("'switch-row-inspector-tab'"));
assert(tableText.includes("inspectorTab: 'relations'"));
assert(tableText.includes('tab: uiState.inspectorTab'));

const context = { window: {}, console, Date, JSON, Math, Set, Map, FormData: class FormDataMock {} };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(read('js/features/memory/kernel.js'), context);
const Kernel = context.window.OvoMemoryKernel;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
Kernel.core.escapeHtml = escapeHtml;
Kernel.core.escapeAttribute = escapeHtml;
Kernel.register('tagService', {
  normalize(bundle) { return bundle || { topic: [], scene: [], entity: [], effect: 'historical_context' }; },
  isLocked() { return false; }
});
Kernel.register('relationService', {
  RELATION_LABELS: { review: '需要核对', related: '相关记忆' },
  tagInventory() { return { topic: [], scene: [], entity: [] }; }
});
Kernel.register('tagVocabulary', {
  count() { return { total: 2 }; },
  list() { return [{ dimension: 'topic', aliasKey: '坦白表达', canonical: '表达' }]; }
});
vm.runInContext(read('js/features/memory/row_inspector.js'), context);
const inspector = Kernel.get('rowInspector');
assert.strictEqual(inspector.VERSION, '2.11-R3.1');
const target = {
  template: { name: '档案模板' }, table: { name: '稳定长期特征库' }, rowIndex: 2,
  row: { id: 'r1', meta: { tagBundle: { topic: ['表达'], scene: ['关系讨论'], entity: ['用户'], effect: 'historical_context' }, relations: {} } },
  text: '当前真实记忆内容'
};
const items = Array.from({ length: 12 }, (_, index) => ({
  kind: index < 2 ? 'review' : 'related', score: .7 - index * .02, explicit: false,
  table: { name: '稳定长期特征库' }, row: { id: `r${index + 2}` }, text: `候选记忆 ${index + 1}`, reasons: ['主题重合']
}));
const analysis = { counts: { review: 2, related: 10 }, items };
const relationHtml = inspector.render({ chat: {}, target, analysis, tab: 'relations' });
assert(relationHtml.includes('memory-row-inspector-tabs'));
assert(relationHtml.includes('data-inspector-panel="relations"'));
assert(!relationHtml.includes('data-row-tag-form'));
assert.strictEqual((relationHtml.match(/memory-row-relation-item/g) || []).length, 8, 'relation tab should cap visible candidates at eight');
const tagHtml = inspector.render({ chat: {}, target, analysis, tab: 'tags' });
assert(tagHtml.includes('data-row-tag-form'));
assert(!tagHtml.includes('memory-row-tag-vocabulary-list'));
const vocabularyHtml = inspector.render({ chat: {}, target, analysis, tab: 'vocabulary' });
assert(vocabularyHtml.includes('统一标签词表'));
assert(!vocabularyHtml.includes('data-row-tag-form'));
const review = {
  current: { text: '当前内容', table: target.table, row: target.row },
  candidate: { text: '候选内容', table: { name: '近期经历' }, row: { id: 'r2' } },
  fields: [{ key: '内容', currentText: '当前内容', candidateText: '候选内容', same: false, conflict: true }],
  fillCurrentCount: 0, fillCandidateCount: 0, conflictCount: 1, sourceIds: []
};
const reviewHtml = inspector.render({ chat: {}, target, analysis, tab: 'tags', review });
assert(reviewHtml.includes('is-review'));
assert(reviewHtml.includes('memory-row-review-diffs'));
assert(!reviewHtml.includes('memory-row-inspector-tabs'), 'review must be a focused mode');
assert(!reviewHtml.includes('data-row-tag-form'), 'review must not stack the tag form below comparison');
assert(!reviewHtml.includes('统一标签词表'), 'review must not stack vocabulary below comparison');

console.log('V2.11-R3.1 MEMORY INSPECTOR REWORK CHECKS: PASS');
