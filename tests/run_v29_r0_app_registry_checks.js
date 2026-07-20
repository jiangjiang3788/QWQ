const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');

global.window = global;
global.localStorage = { getItem(){ return null; } };
global.db = { customAppNames:{}, customIcons:{}, characters:[] };
global.defaultIcons = {};
let target = '';
global.switchScreen = id => { target = id; };

function load(rel){ vm.runInThisContext(fs.readFileSync(path.join(root,rel),'utf8'),{filename:rel}); }
load('js/core/feature_flags.js');
load('js/app_registry.js');

function assert(value,message){ if(!value) throw new Error(message); }
const main = OvoAppRegistry.list('main');
const dock = OvoAppRegistry.list('dock');
assert(main.length===6,`main app count ${main.length}`);
assert(dock.length===4,`dock app count ${dock.length}`);
assert(dock.map(app => app.id).join(',') === 'chat,api,memory,settings', `dock apps ${dock.map(app => app.id).join(',')}`);
for(const id of ['memory','worldbook','theater','favorites','reminder','search']){
  assert(main.some(app=>app.id===id),`missing app ${id}`);
}
const html = OvoAppRegistry.renderLauncher();
assert(!html.includes('data-app-id="characters"'),'retired character launcher still rendered');
assert(!html.includes('data-app-id="contacts"'),'retired contacts launcher still rendered');
assert((html.match(/data-app-id="chat"/g)||[]).length===1,'chat must exist only once in dock');
assert((html.match(/data-app-id="memory"/g)||[]).length===1,'memory must exist only once in dock');
assert(html.includes('phone-app-grid'),'flat phone launcher missing');
assert(OvoAppRegistry.openApp('api')===true && target==='api-settings-screen','target app navigation failed');
assert(OvoFeatureFlags.get('phoneApp')===false,'phone app flag should be off');
console.log('V2.9-R0 APP REGISTRY CHECKS: PASS');
