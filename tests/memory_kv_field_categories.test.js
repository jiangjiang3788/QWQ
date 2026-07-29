const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const sandbox = { window: {}, console, Date, setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('js/features/memory_v3/memory_core_v3.js','utf8'), sandbox);
const M = sandbox.MemoryV5;

const kv = M.model.normalizeTable({
  id:'kv_categories', name:'核心档案', viewMode:'kv', group:'core',
  fields:[
    {id:'f1',scope:'custom',name:'人格底色',category:'用户档案',type:'longtext'},
    {id:'f2',scope:'custom',name:'身份本质',category:'角色档案',type:'longtext'}
  ], behavior:{writePolicy:'manual',contextPolicy:'always'}
},0);
assert.equal(kv.fields[0].category,'用户档案');
assert.equal(kv.fields[1].category,'角色档案');
assert.equal(kv.fields.some(f=>f.scope==='common'),false);

const plan = M.model.importPlan({
  type:'memory-store', version:3, settings:{}, tables:[kv],
  records:{kv_categories:[{id:'one',tableId:'kv_categories',values:{f1:'A',f2:'B'}}]}
});
assert.equal(plan.tables[0].viewMode,'kv');
assert.equal(plan.tables[0].fields[0].category,'用户档案');
assert.equal(plan.records.kv_categories.length,1);

const rows = M.model.normalizeTable({
  id:'rows_test',name:'行表',viewMode:'rows',fields:[],behavior:{}
},0);
assert(rows.fields.some(f=>f.scope==='common'&&f.commonKey==='category'));
console.log('KV field categories test passed.');
