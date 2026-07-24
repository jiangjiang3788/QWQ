const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
assert(['2.15-R0A', '2.15-R0B'].includes(read('VERSION.txt').trim()));

// One app registry owns desktop and dock placement.
{
  const box = { window: null, console, db: { customIcons: {}, customAppNames: {}, characters: [] }, defaultIcons: {},
    OvoFeatureFlags: { get: key => key === 'advancedApps' }, switchScreen() {}, setupMagicRoomApp() {},
    sessionStorage: { getItem() { return null; }, setItem() {} } };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('js/app_registry.js'), box, { filename: 'app_registry.js' });
  const home = box.OvoAppRegistry.list('home').map(app => app.id);
  const dock = box.OvoAppRegistry.list('dock').map(app => app.id);
  assert.deepStrictEqual([...home], ['worldbook','theater','favorites','reminder','search','proment','appearance','data']);
  assert.deepStrictEqual([...dock], ['chat','api','memory','settings']);
  assert.strictEqual((box.OvoAppRegistry.renderLauncher().match(/data-app-id="proment"/g) || []).length, 1);
  assert(!read('js/app_registry.js').includes('homeAppIds'));
  assert(!read('js/app_registry.js').includes('dockAppIds'));
}

function memoryBox() {
  const modules = new Map();
  const Kernel = {
    core: { escapeHtml: v => String(v ?? ''), escapeAttribute: v => String(v ?? '') },
    register(name, api) { modules.set(name, api); },
    require(name) { if (!modules.has(name)) throw new Error('missing '+name); return modules.get(name); },
    get(name) { return modules.get(name); }
  };
  const policy = { normalizeTablePolicy(table) { return { ...table, systemRole: table.systemRole || 'general', commitPolicy: { mode: table.commitPolicy?.mode || 'review' } }; } };
  modules.set('schemaModel', { summarize: () => ({tableCount:0,fieldCount:0,groupCount:0}), roleConflicts:()=>new Map(), mutate(){}, applyRawJson(){}, prepare:x=>x, normalize:x=>x, updatePath(){return false;} });
  modules.set('domain', { parseOptionText:()=>[], normalizeFieldType:x=>x, parseConditionalRulesText:()=>[] });
  modules.set('fieldWidth', { visualUnits:()=>1, schemaFieldNames:()=>({desktop:100,mobile:100,longestUnits:1}) });
  modules.set('policy', policy);
  modules.set('fieldPolicy', { normalizeFieldPolicy:f=>f.writePolicy||{}, summarizeRoutes:()=>({}) });
  const box = { window:null, console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object, Error, Promise, OvoMemoryKernel:Kernel };
  box.window=box; vm.createContext(box); return {box, modules};
}

// Table UI exposes one pending choice; promotion is role-specific while internal modes remain distinct.
{
  const {box,modules}=memoryBox();
  vm.runInContext(read('js/features/memory/schema_editor.js'), box, {filename:'schema_editor.js'});
  const editor=modules.get('schemaEditor');
  const normal={systemRole:'recent_events',commitPolicy:{mode:'candidate'}};
  const review={systemRole:'medium_summary',commitPolicy:{mode:'review'}};
  const long={systemRole:'long_candidate',commitPolicy:{mode:'promotion'}};
  assert.strictEqual(editor.displayCommitMode('review'),'pending');
  assert.strictEqual(editor.displayCommitMode('candidate'),'pending');
  assert.strictEqual(editor.resolveUiCommitMode(normal,'pending'),'candidate');
  assert.strictEqual(editor.resolveUiCommitMode(review,'pending'),'review');
  assert.strictEqual(editor.resolveUiCommitMode(review,'pending','candidate'),'candidate');
  assert(!editor.commitModeChoices(normal).some(item=>item[0]==='promotion'));
  assert(editor.commitModeChoices(long).some(item=>item[0]==='promotion'&&item[1]==='长期晋升'));
  assert.strictEqual(editor.displayFieldCommitMode('candidate'),'pending');
  assert.strictEqual(editor.resolveFieldUiCommitMode({writePolicy:{commitMode:'candidate'}},review,'pending'),'candidate');
  const source=read('js/features/memory/schema_editor.js');
  assert(source.includes('字段实际分流：'));
  assert(!source.includes("['review', '先确认再生效']"));
  assert(!source.includes("['candidate', '进入候选']"));
}

// Management has one diagnostics entrance and task wording is product-facing.
{
  const modules=new Map();
  const Kernel={ core:{escapeHtml:v=>String(v??'')}, register:(n,a)=>modules.set(n,a), get:n=>modules.get(n) };
  modules.set('quality',{ensureState:()=>({runs:[]})});
  const box={window:null,console,OvoMemoryKernel:Kernel}; box.window=box; vm.createContext(box);
  vm.runInContext(read('js/features/memory/workspace.js'),box,{filename:'workspace.js'});
  const workspace=modules.get('workspace');
  const home=workspace.renderManageHome({memoryTables:{data:{}}},[]);
  assert(home.includes('记忆诊断中心'));
  assert(!home.includes('记忆完整性医生'));
  const hub=workspace.renderDiagnosticsHome({memoryTables:{data:{}}},[]);
  for (const label of ['结构完整性','来源与时效','召回与索引','质量测试','历史与回滚']) assert(hub.includes(label));
  assert.strictEqual(workspace.viewTitle('tasks'),'维护作业');
  const tasks=read('js/modules/memory_table_tasks.js');
  assert(tasks.includes('维护作业与成本'));
  assert(!tasks.includes('任务队列与成本'));
}

console.log('V2.15-R0A LOSSLESS UI CONVERGENCE CHECKS: PASS');
