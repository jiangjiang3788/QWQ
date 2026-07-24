const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const childProcess = require('child_process');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2', '2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1'].includes(read('VERSION.txt').trim()));
const contract = JSON.parse(read('architecture/memory_domains.json'));
const budgets = JSON.parse(read('architecture/ui_budgets.json'));
const html = read('index.html');
const controller = read('js/modules/memory_table.js');

assert(['2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2', '2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1'].includes(contract.version));
assert.strictEqual(Object.keys(contract.publicFacades).length, 7);
assert.strictEqual(budgets.memoryTable.maxPersistentRowEditButtons, 0);
assert.strictEqual(budgets.quickDock.requiredTopActions, 8);
assert.strictEqual(budgets.schemaEditor.requiredPeerViews, 1);
assert(controller.includes("Kernel.require('memoryPlatformDomain')"));
assert(controller.includes("Kernel.require('memoryTablesDomain')"));
assert(controller.includes("Kernel.require('memoryArchitecture').assertHealthy()"));
for (const leaf of ['tableGrid', 'schemaEditor', 'retrievalAudit', 'governanceQueue', 'updateService']) {
  assert(!controller.includes(`Kernel.require('${leaf}')`), `controller bypasses facade: ${leaf}`);
}
assert(html.indexOf('js/features/memory/domains/platform.js') < html.indexOf('js/modules/memory_table.js'));
assert(html.indexOf('js/features/memory/architecture.js') < html.indexOf('js/features/memory/maintenance.js'));
assert(html.indexOf('js/features/memory/maintenance.js') < html.indexOf('js/modules/memory_table.js'));

const registry = new Map();
const registrations = [];
const Kernel = {
  core: Object.freeze({}),
  register(name, api) { registry.set(name, api); registrations.push(name); return api; },
  get(name) { return registry.get(name) || null; },
  require(name) { const api = registry.get(name); if (!api) throw new Error(`missing ${name}`); return api; },
  has(name) { return registry.has(name); },
  list() { return [...registry.keys()]; },
  health(required = []) { const missing = required.filter(name => !registry.has(name)); return { ok: !missing.length, missing, loaded: [...registry.keys()], registrations: registrations.slice() }; }
};
const owned = [...new Set(Object.values(contract.publicFacades).flatMap(item => item.owns))];
owned.forEach(name => registry.set(name, Object.freeze({ VERSION: 'test' })));
const fakeDocument = {
  documentElement: { scrollWidth: 390 },
  querySelectorAll() { return []; }
};
const context = {
  window: { OvoMemoryKernel: Kernel, document: fakeDocument, innerWidth: 390 },
  console,
  Object,
  Array,
  Map,
  Set,
  Math,
  Date
};
vm.createContext(context);
for (const rel of Object.values(contract.publicFacades).map(item => item.file)) {
  vm.runInContext(read(rel), context, { filename: rel });
}
vm.runInContext(read('js/features/memory/architecture.js'), context, { filename: 'architecture.js' });
vm.runInContext(read('js/features/memory/maintenance.js'), context, { filename: 'maintenance.js' });
const architecture = registry.get('memoryArchitecture');
const maintenance = registry.get('memoryMaintenance');
assert(architecture.assertHealthy().healthy);
assert.strictEqual(Object.keys(architecture.snapshot().domains).length, 7);
assert(maintenance.measure(fakeDocument).ok);
assert.strictEqual(maintenance.measure(fakeDocument).metrics.persistentRowEditButtons, 0);

const result = childProcess.spawnSync('python3', ['tools/check_memory_architecture.py'], { cwd: root, encoding: 'utf8' });
assert.strictEqual(result.status, 0, result.stdout + result.stderr);
assert(result.stdout.includes('MEMORY ARCHITECTURE CHECK: PASS'));
console.log('V2.12-R4 ARCHITECTURE & MAINTENANCE CHECKS: PASS');
