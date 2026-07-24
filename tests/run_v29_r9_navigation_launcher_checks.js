const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const screenIds = ['home-screen', 'chat-list-screen', 'chat-room-screen', 'settings-hub-screen'];
const screenMap = new Map(screenIds.map(id => [id, { id }]));
let active = 'home-screen';
const context = {
    window: null,
    document: {
        getElementById(id) { return screenMap.get(id) || null; },
        querySelector(selector) { return selector === '.screen.active' ? screenMap.get(active) : null; }
    },
    Object,
    TypeError,
    Error
};
context.window = context;
vm.createContext(context);
vm.runInContext(read('js/core/navigation_runtime.js'), context);
const nav = context.OvoNavigation;
nav.attach(id => { active = id; }, { initial: 'home-screen' });
assert(nav.open('chat-list-screen') && active === 'chat-list-screen', 'open chat list failed');
assert(nav.open('chat-room-screen') && active === 'chat-room-screen', 'open chat room failed');
assert(nav.back('home-screen') && active === 'chat-list-screen', 'back should return one level');
assert(nav.back('home-screen') && active === 'home-screen', 'second back should return home');
assert(nav.open('missing-screen', { fallback: 'settings-hub-screen' }) && active === 'settings-hub-screen', 'missing target fallback failed');

const html = read('index.html');
const registry = read('js/app_registry.js');
const ui = read('js/ui.js');
const main = read('js/main.js');
const settings = read('js/features/apps/settings_hub.js');
const launcherCss = read('css/modules/app_launcher.css');

assert(html.includes('js/core/navigation_runtime.js'), 'navigation runtime not loaded');
assert(!html.includes('id="contacts-screen"'), 'contacts screen still exists');
assert(!html.includes('id="global-bottom-nav"'), 'legacy global bottom nav still exists');
assert(html.includes('class="back-btn" data-target="home-screen" aria-label="返回桌面"'), 'chat list back button is not visible');
assert(!registry.includes("id: 'characters'") && !registry.includes("id: 'contacts'"), 'duplicate character/contact apps remain');
assert(registry.includes("function appsByPlacement(placement)"), 'placement-driven launcher missing');
assert(registry.includes("placement: { home: 60 }"), 'Proment home placement missing');
assert(!registry.includes('launcherSections'), 'grouped launcher layout remains');
assert(ui.includes('window.switchScreen = switchScreen'), 'screen navigation is not explicitly exported');
assert(main.includes("window.OvoNavigation.back(fallback)"), 'back buttons do not use navigation stack');
assert(!main.includes("'setupContactsScreen'") && !main.includes("'setupBottomNavigation'"), 'retired screen initializers remain');
assert(!settings.includes("id: 'characters'"), 'settings still exposes duplicate role management entry');
assert(launcherCss.includes('grid-template-columns: repeat(4') && launcherCss.includes('width: min(100%, 520px)'), 'desktop is not constrained to phone launcher geometry');

console.log('V2.9-R9 NAVIGATION + PHONE LAUNCHER CHECKS: PASS');
