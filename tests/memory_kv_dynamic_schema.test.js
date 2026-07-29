const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const sandbox = { window: {}, console, Date, setTimeout, clearTimeout };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('js/features/memory_v3/memory_core_v3.js','utf8'), sandbox);
vm.runInContext(fs.readFileSync('js/features/memory_v3/memory_rounds_v3.js','utf8'), sandbox);
vm.runInContext(fs.readFileSync('js/features/memory_v3/memory_engine_v3.js','utf8'), sandbox);
const M = sandbox.MemoryV5;
const kv = M.model.normalizeTable({
  id:'kv_test', name:'动态状态', viewMode:'kv', group:'current',
  fields:[
    M.model.commonField('title'),
    M.model.customField('当前场景','longtext',{required:true}),
    M.model.customField('当前体力','number')
  ],
  behavior:{writePolicy:'auto',contextPolicy:'always',allowAiWrite:true}
},0);
assert.deepEqual(Array.from(kv.fields, f => f.name), ['当前场景','当前体力']);
assert(kv.fields.every(f => f.scope === 'custom'));
const chat = { id:'c1', memoryStore:{version:3,settings:{},tables:[kv],records:{kv_test:[]}} };
const store = M.model.ensureStore(chat);
let result = M.engine.applyOperations(chat,[{tableId:'kv_test',action:'add',values:{当前场景:'在工位',当前体力:20}}],{origin:'ai'});
assert.equal(result.changed.length,1);
assert.equal(store.records.kv_test.length,1);
result = M.engine.applyOperations(chat,[{tableId:'kv_test',action:'add',values:{当前体力:30}}],{origin:'ai'});
assert.equal(result.changed.length,1);
assert.equal(store.records.kv_test.length,1);
assert.equal(store.records.kv_test[0].values[kv.fields[1].id],30);
console.log('KV dynamic schema test passed.');
