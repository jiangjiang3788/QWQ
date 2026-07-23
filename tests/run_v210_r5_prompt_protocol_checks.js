const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const storage = new Map();
const listeners = new Map();
class CustomEventMock { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
const windowMock = {
  sessionStorage: { getItem:k=>storage.has(k)?storage.get(k):null, setItem:(k,v)=>storage.set(k,String(v)), removeItem:k=>storage.delete(k) },
  addEventListener(type, listener){ if(!listeners.has(type)) listeners.set(type,[]); listeners.get(type).push(listener); },
  dispatchEvent(event){ (listeners.get(event.type)||[]).forEach(fn=>fn(event)); },
  CustomEvent: CustomEventMock, console, location:{href:'https://app.local/'}
};
const context=vm.createContext({window:windowMock,sessionStorage:windowMock.sessionStorage,CustomEvent:CustomEventMock,console,Date,Math,JSON,Map,Set,Array,String,Number,Boolean,Error,Promise,URL,AbortController,DOMException,Response,ReadableStream,performance,setTimeout,clearTimeout});
vm.runInContext(fs.readFileSync(path.join(root,'js/modules/prompt_trace.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(root,'js/modules/operation_runtime.js'),'utf8'),context);
const trace=windowMock.OVOPromptTrace;
const runtime=windowMock.OVOOperationRuntime;
assert.strictEqual(trace.VERSION,'2.10-R5');
assert(['2.10-R5', '2.10-R6', '2.11-R0', '2.11-R1', '2.11-R2', '2.11-R3.1', '2.11-R4', '2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3'].includes(runtime.VERSION));
const built=trace.build({model:'m',messages:[{role:'system',content:'system final'},{role:'user',content:'hello'}]},[
 {type:'worldbook',title:'世界书 A',content:'lore',traceMode:'source_exact',sourceId:'wb1'},
 {type:'structured_memory',content:'memory row',traceMode:'source_verified',sourceId:'char1'},
 {type:'journal_memory',content:'journal',sent:false,reason:'budget'}
],{operationId:'op1',operationType:'chat.reply',scope:{characterId:'char1'},provider:'newapi'});
assert.strictEqual(built.protocol,'ovo.prompt-trace.v2');
assert.strictEqual(built.version,'prompt-trace.v2');
const world=built.sections.find(x=>x.type==='worldbook');
const memory=built.sections.find(x=>x.type==='structured_memory');
const journal=built.sections.find(x=>x.type==='journal_memory');
assert.strictEqual(world.protocol,'ovo.prompt-source.v2');
assert.strictEqual(world.state,'sent');
assert.strictEqual(world.navigation.kind,'worldbook');
assert(world.navigation.sourceIds.includes('wb1'));
assert(/^fnv1a-[0-9a-f]{8}$/.test(world.fingerprint));
assert.strictEqual(memory.state,'verified');
assert.strictEqual(memory.navigation.characterId,'char1');
assert.strictEqual(journal.state,'excluded');
assert(built.summary.linkedSectionCount >= 3);
const operation=runtime.start('chat.reply',{scope:{characterId:'char1'}});
const request=runtime.attachRequest(operation.id,{id:'req1',task:'private-chat',provider:'newapi',model:'m',body:{messages:[{role:'user',content:'hello'}]},promptSources:[{type:'structured_memory',content:'row',traceMode:'source_exact'}]});
assert.strictEqual(request.promptTrace.scope.characterId,'char1');
assert.strictEqual(request.promptTrace.operationId,operation.id);
assert.strictEqual(request.promptTrace.sections.find(x=>x.type==='structured_memory').navigation.kind,'structured-memory');
const dock=fs.readFileSync(path.join(root,'js/modules/floating_ball.js'),'utf8');
const magic=fs.readFileSync(path.join(root,'js/features/settings/magic_room.js'),'utf8');
assert(dock.includes('open-prompt-source'));
assert(dock.includes('open-source-management'));
assert(dock.includes('统一来源协议 v2'));
assert(magic.includes('ovo_proment_focus_v1'));
assert(magic.includes('renderFocusedPromptSource'));
assert(['2.10-R5', '2.10-R6', '2.11-R0', '2.11-R1', '2.11-R2', '2.11-R3.1', '2.11-R4', '2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3'].includes(fs.readFileSync(path.join(root,'VERSION.txt'),'utf8').trim()));
console.log('V2.10-R5 PROMPT PROTOCOL + WORKBENCH CHECKS: PASS');
