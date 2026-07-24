const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
assert.strictEqual(read('VERSION.txt').trim(), '2.14-R6');

const controller = read('js/modules/memory_table.js');
const retrieval = read('js/features/memory/retrieval_orchestrator.js');
const review = read('js/features/memory/review_orchestrator.js');
const pkg = read('js/features/memory/package_orchestrator.js');
const html = read('index.html');
const contract = JSON.parse(read('architecture/memory_domains.json'));

assert(controller.split(/\r?\n/).length <= 3300, 'main controller did not shrink below the R6 budget');
for (const name of [
  'prepareMemoryTableContext', 'getMemoryContextBlock', 'rebuildMemoryTableRetrievalPreview',
  'buildMemoryReviewBatches', 'finalizeMemoryReviewBatch', 'rollbackMemoryReviewBatch',
  'exportCurrentMemoryPackage', 'importTemplatesFromFile'
]) {
  assert(!new RegExp(`function\\s+${name}\\s*\\(`).test(controller), `${name} still owned by the main controller`);
}
assert(retrieval.includes("Kernel.register('retrievalOrchestrator'"));
assert(review.includes("Kernel.register('reviewOrchestrator'"));
assert(pkg.includes("Kernel.register('packageOrchestrator'"));
assert(retrieval.includes('function prepareMemoryTableContext'));
assert(review.includes('function finalizeMemoryReviewBatch'));
assert(pkg.includes('async function importTemplatesFromFile'));

assert(contract.version === '2.14-R6');
assert(contract.publicFacades.memoryRetrievalDomain.owns.includes('retrievalOrchestrator'));
assert(contract.publicFacades.memoryGovernanceDomain.owns.includes('reviewOrchestrator'));
assert(contract.publicFacades.memoryFoundationDomain.owns.includes('packageOrchestrator'));
assert(contract.budgets['js/modules/memory_table.js'] === 3300);

for (const rel of [
  'js/features/memory/retrieval_orchestrator.js',
  'js/features/memory/review_orchestrator.js',
  'js/features/memory/package_orchestrator.js'
]) assert(html.includes(rel), `script not loaded: ${rel}`);
assert(html.indexOf('retrieval_orchestrator.js') < html.indexOf('domains/retrieval.js'));
assert(html.indexOf('review_orchestrator.js') < html.indexOf('domains/governance.js'));
assert(html.indexOf('package_orchestrator.js') < html.indexOf('domains/foundation.js'));

const box = { window: null, console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object, Error, Promise };
box.window = box;
vm.createContext(box);
vm.runInContext(read('js/features/memory/kernel.js'), box, { filename: 'kernel.js' });
for (const rel of [
  'js/features/memory/retrieval_orchestrator.js',
  'js/features/memory/review_orchestrator.js',
  'js/features/memory/package_orchestrator.js'
]) vm.runInContext(read(rel), box, { filename: rel });

for (const name of ['retrievalOrchestrator', 'reviewOrchestrator', 'packageOrchestrator']) {
  const module = box.OvoMemoryKernel.require(name);
  assert.strictEqual(module.VERSION, '2.14-R6');
  assert.strictEqual(typeof module.create, 'function');
}
const retrievalApi = box.OvoMemoryKernel.require('retrievalOrchestrator').create({});
const reviewApi = box.OvoMemoryKernel.require('reviewOrchestrator').create({});
const packageApi = box.OvoMemoryKernel.require('packageOrchestrator').create({ MemoryPackageAdapter: { cloneTemplateWithFreshIds: value => ({ template: value, idMap: {} }) } });
assert.strictEqual(typeof retrievalApi.prepareMemoryTableContext, 'function');
assert.strictEqual(typeof reviewApi.finalizeMemoryReviewBatch, 'function');
assert.strictEqual(typeof packageApi.importTemplatesFromFile, 'function');

console.log('V2.14-R6 USE-CASE ORCHESTRATION CHECKS: PASS');
