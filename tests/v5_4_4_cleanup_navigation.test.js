const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const stateBar = {
  textContent: '', style: {}, dataset: {}, attrs: {}, onclick: null, onkeydown: null,
  classList: { values: new Set(), add(v){this.values.add(v);}, remove(v){this.values.delete(v);}, toggle(v,on){ if(on)this.values.add(v); else this.values.delete(v);} },
  setAttribute(k,v){ this.attrs[k]=String(v); }
};
const switched = [];
const opened = [];
const sandbox = {
  console, Map, Set, WeakSet, Promise, Date, JSON, Math, String, Number, Boolean, Array, Object, Error, RegExp,
  setTimeout(fn){ fn(); return 1; }, clearTimeout(){},
  sessionStorage: { setItem(){}, getItem(){return null;} },
  document: { getElementById(id){ if(id==='memory-live-state-bar') return stateBar; return null; }, documentElement:{style:{setProperty(){}}} },
  db: { characters: [] }, currentChatId: '', currentChatType: 'private',
  switchScreen(id){ switched.push(id); },
  openMemoryTableForCharacter(charId, tableId){ opened.push([charId, tableId]); }
};
sandbox.window=sandbox;
vm.createContext(sandbox);
for (const file of [
  'js/features/memory_v3/memory_core_v3.js',
  'js/features/memory_v3/memory_rounds_v3.js',
  'js/features/memory_v3/memory_engine_v3.js',
  'js/features/memory_v3/memory_ui_v3.js'
]) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'), sandbox, {filename:file});

const chat={id:'char_click',history:[]};
sandbox.db.characters.push(chat);
const M=sandbox.MemoryV5;
M.model.ensureStore(chat);
const result=M.engine.applyOperations(chat,[{
  tableId:'v5_current_state',action:'add',values:{分类:'用户状态',标题:'当前需求',内容:'希望继续整理代码'}
}],{origin:'manual'});
assert.strictEqual(result.changed.length,1);
M.engine.refreshStateBar(chat);
assert.strictEqual(typeof stateBar.onclick,'function');
let prevented=false, stopped=false;
stateBar.onclick({preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
assert.deepStrictEqual(opened,[['char_click','v5_current_state']]);
assert(prevented && stopped);

// UI-level navigation must use the real application router, not the nonexistent showScreen.
opened.length=0;
M.ui.openForCharacter('char_click','v5_current_state');
assert(switched.includes('memory-table-screen'));
const uiText=fs.readFileSync(path.join(root,'js/features/memory_v3/memory_ui_v3.js'),'utf8');
const engineText=fs.readFileSync(path.join(root,'js/features/memory_v3/memory_engine_v3.js'),'utf8');
assert(!uiText.includes("global.showScreen?.('memory-table-screen')"));
assert(!engineText.includes("global.showScreen?.('memory-table-screen')"));

const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert(html.includes('<button id="memory-live-state-bar"'));
assert(!html.includes('js/modules/prompt_trace.js'));
assert(html.includes('proment-source-registry-list'));
assert(!html.includes('id="proment-preview-context"'));
assert(!fs.existsSync(path.join(root,'js/modules/prompt_trace.js')));

const runtime=fs.readFileSync(path.join(root,'js/modules/operation_runtime.js'),'utf8');
assert(!runtime.includes('OVOPromptTrace?.build'));
const magic=fs.readFileSync(path.join(root,'js/features/settings/magic_room.js'),'utf8');
assert(!magic.includes('renderPromentInjectionPreview'));
assert(!magic.includes('renderPromentRuntimeComparison'));
console.log('V5.4.4 cleanup and memory status navigation tests passed.');
