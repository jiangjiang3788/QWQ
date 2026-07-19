const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');

global.window = global;
global.localStorage = { getItem(){ return null; } };
global.db = { customAppNames:{}, customIcons:{}, characters:[] };
global.defaultIcons = {};
let target = '';
global.switchScreen = id => { target = id; return true; };

function load(rel){ vm.runInThisContext(fs.readFileSync(path.join(root,rel),'utf8'),{filename:rel}); }
load('js/core/feature_flags.js');
load('js/app_registry.js');

function assert(value,message){ if(!value) throw new Error(message); }
const all = OvoAppRegistry.list();
const main = OvoAppRegistry.list('main');
const dock = OvoAppRegistry.list('dock');
for(const id of ['chat','characters','memory','worldbook','theater','favorites','reminder','search','contacts','api','data','appearance','settings']) {
  assert(all.some(app=>app.id===id),`missing app ${id}`);
}
assert(main.length >= 5,`main app count ${main.length}`);
assert(dock.length===4,`dock app count ${dock.length}`);
const html = OvoAppRegistry.renderLauncher();
assert(html.includes('data-app-id="characters"'),'character launcher missing');
assert(html.includes('data-app-id="memory"'),'memory launcher missing');
assert(html.includes('data-app-id="settings"'),'settings launcher missing');
assert(OvoAppRegistry.openApp('api')===true && target==='api-settings-screen','target app navigation failed');
assert(OvoFeatureFlags.get('phoneApp')===false,'phone app flag should be off');
console.log('V2.9-R0 APP REGISTRY CHECKS: PASS');
