const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');

global.window = global;
global.db = {
  apiSettings: { url: 'https://main.example', key: 'main-key', model: 'main-model', provider: 'newapi' },
  summaryApiSettings: {},
  vectorApiSettings: {},
  memoryTableTemplates: [],
  characters: []
};
global.document = { getElementById: () => null, addEventListener: () => {} };
global.CustomEvent = function CustomEvent(type, init) { this.type = type; this.detail = init?.detail; };
global.dispatchEvent = () => true;
global.addEventListener = () => {};
global.saveCharacter = async () => true;
global.fetchAiResponse = async () => ({ choices: [{ message: { content: 'ok' } }] });

function load(rel) {
  vm.runInThisContext(fs.readFileSync(path.join(root, rel), 'utf8'), { filename: rel });
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

load('js/features/memory/kernel.js');
assert(/^2\.9-R[12]$/.test(OvoMemoryKernel.VERSION), 'kernel version mismatch');
assert(OvoMemoryKernel.core.escapeHtml('<a>') === '&lt;a&gt;', 'shared HTML escape failed');
assert(OvoMemoryKernel.core.clamp('8', 0, 1, 5) === 5, 'shared clamp failed');
assert(OvoMemoryKernel.core.unique(['a', 'a', 'b']).join(',') === 'a,b', 'shared unique failed');
assert(OvoMemoryKernel.core.hashFingerprint('abc').startsWith('3:'), 'fingerprint format failed');

[
  'js/modules/memory_table_policy.js',
  'js/modules/memory_table_schedule.js',
  'js/modules/memory_table_lifecycle.js',
  'js/modules/memory_table_effects.js',
  'js/modules/memory_table_feedback.js',
  'js/modules/memory_table_review.js',
  'js/modules/memory_table_retrieval.js',
  'js/features/memory/retrieval_audit.js',
  'js/modules/memory_table_sidecar.js',
  'js/modules/memory_table_tasks.js',
  'js/modules/memory_table_quality.js',
  'js/features/memory/api_adapter.js',
  'js/features/memory/domain.js',
  'js/features/memory/field_width.js',
  'js/features/memory/schema_model.js',
  'js/features/memory/schema_editor.js',
  'js/features/memory/workspace.js',
  'js/features/memory/tag_vocabulary.js',
  'js/features/memory/tag_service.js',
  'js/features/memory/relation_service.js',
  'js/features/memory/merge_review_service.js',
  'js/features/memory/candidate_service.js',
  'js/features/memory/table_filter.js',
  'js/features/memory/governance_queue.js',
  'js/features/memory/governance_controller.js',
  'js/features/memory/row_inspector.js',
  'js/features/memory/row_inspector_controller.js',
  'js/features/memory/context_assembler.js',
  'js/features/memory/update_service.js',
  'js/features/memory/table_viewport.js',
  'js/features/memory/table_session.js',
  'js/features/memory/table_grouping.js',
  'js/features/memory/table_gesture.js',
  'js/features/memory/table_cache.js',
  'js/features/memory/table_persistence.js',
  'js/features/memory/row_command_menu.js',
  'js/features/memory/table_interaction.js',
  'js/features/memory/table_view.js',
  'js/features/memory/table_sort.js',
  'js/features/memory/table_presenter.js',
  'js/features/memory/table_reconciler.js',
  'js/features/memory/table_grid.js',
  'js/features/memory/table_editor.js',
  'js/features/memory/table_edit_controller.js',
  'js/features/memory/update_activity.js',
  'js/features/memory/table_workspace.js'
].forEach(load);

[
  'js/features/memory/domains/platform.js',
  'js/features/memory/domains/foundation.js',
  'js/features/memory/domains/schema.js',
  'js/features/memory/domains/governance.js',
  'js/features/memory/domains/retrieval.js',
  'js/features/memory/domains/update.js',
  'js/features/memory/domains/tables.js',
  'js/features/memory/architecture.js',
  'js/features/memory/maintenance.js'
].forEach(load);

const expected = ['policy', 'lifecycle', 'effects', 'feedback', 'review', 'retrieval', 'retrievalAudit', 'sidecar', 'tasks', 'quality', 'api', 'domain', 'fieldWidth', 'workspace', 'tagVocabulary', 'tagService', 'relationService', 'mergeReviewService', 'candidateService', 'tableFilter', 'tableSort', 'governanceQueue', 'governanceController', 'rowInspector', 'rowInspectorController', 'contextAssembler', 'updateService', 'tableViewport', 'tableSession', 'tableGrouping', 'tableGesture', 'tableCache', 'tablePersistence', 'rowCommandMenu', 'tableInteraction', 'tableView', 'tablePresenter', 'tableReconciler', 'tableGrid', 'tableEditor', 'tableEditController', 'updateActivity', 'tableWorkspace'];
expected.forEach(name => assert(OvoMemoryKernel.has(name), `module not registered: ${name}`));
['memoryPlatformDomain', 'memoryFoundationDomain', 'memorySchemaDomain', 'memoryGovernanceDomain', 'memoryRetrievalDomain', 'memoryUpdateDomain', 'memoryTablesDomain', 'memoryArchitecture', 'memoryMaintenance']
  .forEach(name => assert(OvoMemoryKernel.has(name), `domain facade not registered: ${name}`));
assert(MemoryTablePolicy === OvoMemoryKernel.get('policy'), 'legacy policy bridge mismatch');
assert(MemoryTableTasks === OvoMemoryKernel.get('tasks'), 'legacy task bridge mismatch');

const routeFallback = OvoMemoryKernel.get('api').resolveConfig(true);
assert(routeFallback.actualMode === 'main' && routeFallback.fallback === true, 'summary fallback route failed');
db.summaryApiSettings = { url: 'https://summary.example', key: 'sum-key', model: 'sum-model', provider: 'newapi' };
const summaryRoute = OvoMemoryKernel.get('api').resolveConfig(true);
assert(summaryRoute.actualMode === 'summary' && summaryRoute.fallback === false, 'summary route failed');

const Domain = OvoMemoryKernel.get('domain');
const starter = Domain.normalizeTemplate(Domain.createStarterTemplate());
db.memoryTableTemplates = [starter];
const chat = { id: 'chat1', history: [], memoryTables: { boundTemplateIds: [starter.id] } };
Domain.ensureMemoryTableState(chat);
Domain.ensureTemplateDataForChat(chat, starter);
assert(chat.memoryTables.data[starter.id], 'domain did not initialize template data');
assert(Domain.getBoundTemplates(chat).length === 1, 'domain bound template query failed');

const dummy = () => true;
OvoMemoryKernel.register('controller', {
  ensureState: dummy, getCurrentChat: () => chat, setupScreen: dummy, renderScreen: dummy,
  openFeedback: dummy, openWorkspace: dummy, getContext: () => 'context', prepareContext: async () => 'context',
  exportContext: () => ({}), getBoundTemplateIds: () => [starter.id], convertText: dummy, checkAutoUpdate: dummy
});
load('js/features/memory/facade.js');
assert(OvoMemory && OvoMemory.health().ok, 'public memory facade health failed');
assert(typeof prepareMemoryTableContext === 'function', 'compatibility bridge missing');
assert(OvoMemory.context.get() === 'context', 'facade context route failed');

const moduleFiles = fs.readdirSync(path.join(root, 'js/modules')).filter(name => /^memory_table.*\.js$/.test(name));
const duplicatePattern = /^\s*function\s+(clone|deepClone|escapeHtml|escapeAttribute|clamp|clampNumber|unique|createId|createMemoryId|hashText|moveArrayItem)\b/gm;
const duplicates = [];
for (const name of moduleFiles) {
  const source = fs.readFileSync(path.join(root, 'js/modules', name), 'utf8');
  const matches = [...source.matchAll(duplicatePattern)];
  if (matches.length) duplicates.push(`${name}:${matches.map(item => item[1]).join(',')}`);
}
assert(duplicates.length === 0, `shared helper duplicates remain: ${duplicates.join('; ')}`);

const mainLines = fs.readFileSync(path.join(root, 'js/modules/memory_table.js'), 'utf8').split(/\r?\n/).length;
assert(mainLines < 4750, `memory_table.js exceeded V2.10-R3 integration budget: ${mainLines}`);
console.log('V2.9-R1 MEMORY KERNEL CHECKS: PASS');
