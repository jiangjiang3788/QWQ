const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');

function assert(condition, message) { if (!condition) throw new Error(message); }
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/modules/memory_workspace.css'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'js/modules/memory_table.js'), 'utf8');

assert((html.match(/class="memory-workspace-tab-btn/g) || []).length === 3, 'workspace must expose exactly three primary tabs');
for (const id of ['memory', 'inbox', 'manage']) assert(html.includes(`data-workspace="${id}"`), `missing workspace ${id}`);
assert(html.includes('memory-workbench-legacy-tabs'), 'legacy view bridge is missing');
assert(html.includes('js/features/memory/workspace.js'), 'workspace script is not loaded');
assert(html.includes('css/modules/memory_workspace.css'), 'workspace stylesheet is not loaded');
assert(css.includes('.memory-workbench-card-grid') || fs.readFileSync(path.join(root, 'css/modules/memory_table_flat.css'), 'utf8').includes('.memory-governance-list'), 'workspace overview layout is missing');
assert(controller.includes("workspace: 'memory'"), 'controller workspace state is missing');
assert(controller.includes('MemoryWorkspace.renderInboxHome'), 'inbox overview is not wired');
assert(controller.includes('MemoryWorkspace.renderManageHome'), 'manage overview is not wired');
assert(controller.includes("VERSION: '2.9-R2'"), 'controller version mismatch');

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(item => item[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert(duplicates.length === 0, `duplicate DOM ids: ${[...new Set(duplicates)].join(', ')}`);

const context = {
  window: null,
  console,
  db: { memoryTableTemplates: [] }
};
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/features/memory/kernel.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/features/memory/workspace.js'), 'utf8'), context);
const workspace = context.OvoMemoryKernel.get('workspace');
assert(workspace && ['2.9-R2', '2.11-R4', '2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3'].includes(workspace.VERSION), 'workspace module did not register');
assert(workspace.normalizeState('memory', 'quality').view === 'tables', 'memory workspace should normalize to tables');
assert(workspace.normalizeState('inbox', '').view === 'inbox_home', 'inbox default view mismatch');
assert(workspace.getWorkspaceForView('quality') === 'manage', 'quality should be under manage');
assert(workspace.getWorkspaceForView('feedback') === 'manage', 'feedback alias should converge into usage audit under manage');
assert(workspace.normalizeState('manage', 'feedback').view === 'usage_audit', 'feedback alias should normalize to usage_audit');
console.log('V2.9-R2 MEMORY WORKSPACE CHECKS: PASS');
