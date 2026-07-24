const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
assert(['2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1', '2.14-R9', '2.15-R0A', '2.15-R0B'].includes(read('VERSION.txt').trim()));

const box = {
  console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object, Error, Promise,
  setTimeout, clearTimeout, queueMicrotask,
  window: null,
  document: { addEventListener() {}, querySelectorAll: () => [] }
};
box.window = box;
vm.createContext(box);
for (const file of [
  'js/features/memory/kernel.js',
  'js/modules/memory_table_policy.js',
  'js/features/memory/policy_resolver.js'
]) vm.runInContext(read(file), box, { filename: file });

const Kernel = box.OvoMemoryKernel;
const Policy = Kernel.require('policy');
const Resolver = Kernel.require('policyResolver');
assert.strictEqual(Resolver.VERSION, '2.14-R5');

const template = {
  id: 'tpl', name: '个人记忆模板', tables: [{
    id: 'medium', name: '中期总结', mode: 'rows', memoryLayer: 'medium', systemRole: 'medium_summary', columns: [],
    capturePolicy: { mode: 'scheduled', frequencySource: 'table', apiMode: 'summary' },
    commitPolicy: { mode: 'review', requireUserConfirmation: true },
    updatePolicy: { enabled: true, triggerMode: 'rounds', roundInterval: 8, messageInterval: 240, maxSourceMessages: 180, overlapMessages: 6, useSummaryApi: true },
    injectionPolicy: { mode: 'relevant', topK: 4, threshold: 0.16, budget: 1100 }
  }]
};
const table = template.tables[0];
const chat = {
  id: 'chat',
  memoryTables: {
    engineSettings: { enabled: true, triggerMode: 'messages', roundInterval: 3, messageInterval: 50, maxSourceMessages: 120, overlapMessages: 4 },
    runtime: { rounds: [], tableStates: {} }
  }
};

let resolved = Resolver.resolve(chat, template.id, table);
assert.strictEqual(resolved.effective.capturePolicy.frequencySource, 'table');
assert.strictEqual(resolved.effective.updatePolicy.triggerMode, 'rounds');
assert.strictEqual(resolved.effective.updatePolicy.roundInterval, 8);
assert.strictEqual(resolved.sourceSummary.capture, 'template');
assert.strictEqual(resolved.sourceSummary.commit, 'template');
assert.strictEqual(resolved.sourceSummary.schedule, 'template');
assert.strictEqual(resolved.hasRoleOverride, false);

const draft = Resolver.cloneTemplateOverrides(chat, template.id);
Resolver.updateOverrideDraft(draft, template, table.id, 'capturePolicy.frequencySource', 'global');
Resolver.updateOverrideDraft(draft, template, table.id, 'commitPolicy.mode', 'direct');
Resolver.updateOverrideDraft(draft, template, table.id, 'commitPolicy.requireUserConfirmation', false);
Resolver.updateOverrideDraft(draft, template, table.id, 'injectionPolicy.mode', 'never');
Resolver.replaceTemplateOverrides(chat, template.id, draft, template);
resolved = Resolver.resolve(chat, template.id, table);
assert.strictEqual(resolved.effective.capturePolicy.frequencySource, 'global');
assert.strictEqual(resolved.effective.updatePolicy.triggerMode, 'messages');
assert.strictEqual(resolved.effective.updatePolicy.messageInterval, 50);
assert.strictEqual(resolved.effective.updatePolicy.maxSourceMessages, 120);
assert.strictEqual(resolved.effective.commitPolicy.mode, 'direct');
assert.strictEqual(resolved.effective.injectionPolicy.mode, 'never');
assert.strictEqual(resolved.sourceSummary.commit, 'role');
assert.strictEqual(resolved.sourceSummary.schedule, 'global');
assert.strictEqual(resolved.sourceSummary.injection, 'role');
assert.strictEqual(resolved.hasRoleOverride, true);
assert.strictEqual(table.commitPolicy.mode, 'review', 'role override mutated template policy');
assert.strictEqual(table.injectionPolicy.mode, 'relevant', 'role override mutated template injection');

const materialized = Resolver.materializeTable(chat, template.id, table);
assert.strictEqual(Policy.inferAutomationMode(materialized), 'engine');
assert.strictEqual(materialized.commitPolicy.mode, 'direct');
assert.strictEqual(materialized.injectionPolicy.mode, 'never');

const resetDraft = Resolver.cloneTemplateOverrides(chat, template.id);
assert.strictEqual(Resolver.resetTableOverrideDraft(resetDraft, table.id), true);
Resolver.replaceTemplateOverrides(chat, template.id, resetDraft, template);
resolved = Resolver.resolve(chat, template.id, table);
assert.strictEqual(resolved.hasRoleOverride, false);
assert.strictEqual(resolved.effective.commitPolicy.mode, 'review');
assert.strictEqual(resolved.effective.injectionPolicy.mode, 'relevant');

const html = read('index.html');
assert(html.indexOf('memory_table_policy.js') < html.indexOf('policy_resolver.js'));
assert(html.indexOf('policy_resolver.js') < html.indexOf('field_policy.js'));
assert(html.includes('模板默认、当前角色覆盖、最终生效值与来源'));
const schema = read('js/features/memory/schema_editor.js');
for (const text of ['模板默认', '当前角色覆盖', '当前生效', '来源', '恢复模板']) assert(schema.includes(text));
assert(schema.includes('data-policy-path'));
const css = read('css/modules/memory_schema_editor.css');
assert(css.includes('.memory-schema-source-badge.source-role'));
assert(css.includes('.memory-schema-fields-section.is-readonly'));
const controller = read('js/modules/memory_table.js');
assert(controller.includes('MemoryPolicyResolver.replaceTemplateOverrides'));
assert(controller.includes('getEffectiveTableDescriptor'));
assert(controller.includes("capturePolicy.frequencySource', frequencySource"));
const policySource = read('js/modules/memory_table_policy.js');
assert(policySource.includes('materializeEffectiveTable'));
const sidecar = read('js/modules/memory_table_sidecar.js');
assert(sidecar.includes('PolicyResolver.materializeTable'));
const updateService = read('js/features/memory/update_service.js');
assert(updateService.includes('PolicyResolver.materializeTable'));
const workspace = read('js/features/memory/table_workspace.js');
assert(workspace.includes("VERSION: '2.14-R5'"));
assert(workspace.includes('策略来源：'));

const contract = JSON.parse(read('architecture/memory_domains.json'));
assert(['2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1', '2.14-R9', '2.15-R0A', '2.15-R0B'].includes(contract.version));
assert(contract.publicFacades.memoryPlatformDomain.owns.includes('policyResolver'));

console.log('V2.14-R5 EFFECTIVE POLICY RESOLVER CHECKS: PASS');
