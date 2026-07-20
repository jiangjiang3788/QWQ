const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const html = read('index.html');
const search = read('js/modules/search.js');
const main = read('js/main.js');
const registry = read('js/app_registry.js');
const memory = read('js/modules/memory_table.js');
const searchCss = read('css/modules/search.css');
const launcherCss = read('css/modules/app_launcher.css');

assert(html.includes('class="back-btn search-screen-back-btn" data-target="home-screen"'), 'search screen lacks explicit back button');
assert(search.includes("window.OvoNavigation.back('home-screen')"), 'search close does not use navigation back');
assert(!search.includes("switchScreen('more-screen')"), 'search still routes to retired More screen');
assert(search.includes('initialized: false') && search.includes('if (this.initialized) return;'), 'search setup is not idempotent');
assert(search.includes('window.setupSearchSystem'), 'search has no explicit startup initializer');
assert(main.includes("'setupSearchSystem'"), 'search initializer is not part of startup contract');
assert(searchCss.includes('.search-screen-back-btn'), 'search back button has no layout style');

assert(registry.includes('closePickerDialog(dialog)'), 'character picker lacks safe close adapter');
assert(registry.includes("dialog.removeAttribute('open')"), 'character picker lacks old WebView close fallback');
assert(registry.includes('showPickerDialog(dialog)'), 'character picker lacks safe show adapter');
assert(registry.includes("navigate('memory-table-screen')"), 'memory app does not open a visible screen before character selection');
assert(registry.includes('getRememberedCharacter()'), 'memory app does not preserve last selected character');
assert(registry.includes('global.SearchSystem'), 'search app still depends on an implicit lexical global');
assert(launcherCss.includes('.app-picker-dialog.app-picker-dialog-open'), 'dialog fallback has no visible CSS state');

assert(memory.includes('function selectMemoryWorkspace(workspace, view)'), 'memory workspace transition is not centralized');
assert(memory.includes("event.target.closest('.memory-workspace-tab-btn[data-workspace]')"), 'pending workspace does not use delegated click routing');
assert(memory.includes('data-memory-pick-character'), 'memory screen has no recovery action when character context is missing');
assert(memory.includes("return selectMemoryWorkspace(workspace, view)"), 'public memory workspace API bypasses centralized transition');
assert(!html.includes('id="memory-table-screen"\n<header class="app-header">\n<button class="back-btn" data-target="more-screen"'), 'memory back fallback still points to retired More screen');

// Old WebView regression: dialog has neither showModal nor close. Selecting a character must still invoke callback.
let createdDialog = null;
const sessionStore = new Map();
const fakeClassList = { add() {}, remove() {} };
const context = {
    window: null,
    console,
    Object,
    TypeError,
    Error,
    encodeURIComponent,
    sessionStorage: {
        setItem(key, value) { sessionStore.set(key, value); },
        getItem(key) { return sessionStore.get(key) || null; }
    },
    db: {
        characters: [
            { id: 'c1', remarkName: '角色一', avatar: 'a1' },
            { id: 'c2', remarkName: '角色二', avatar: 'a2' }
        ],
        groups: [], customIcons: {}, customAppNames: {}
    },
    document: {
        body: { appendChild(node) { createdDialog = node; } },
        getElementById(id) { return id === 'app-character-picker-dialog' ? createdDialog : null; },
        createElement(tag) {
            return {
                tagName: tag.toUpperCase(), id: '', className: '', classList: fakeClassList,
                dataset: {}, attributes: new Map(), innerHTML: '', onclick: null,
                setAttribute(name, value) { this.attributes.set(name, value); if (name === 'open') this.open = true; },
                removeAttribute(name) { this.attributes.delete(name); if (name === 'open') this.open = false; }
            };
        }
    }
};
context.window = context;
vm.createContext(context);
vm.runInContext(registry, context);
let selected = null;
context.OvoAppRegistry.pickCharacter('选择角色记忆', character => { selected = character; });
assert(createdDialog && createdDialog.open === true, 'dialog fallback did not open');
const fakeButton = { dataset: { characterId: 'c2' } };
createdDialog.onclick({
    target: {
        closest(selector) {
            if (selector === '[data-picker-close]') return null;
            if (selector === '[data-character-id]') return fakeButton;
            return null;
        }
    }
});
assert(selected && selected.id === 'c2', 'old WebView picker selection did not reach callback');
assert(createdDialog.open === false, 'old WebView picker did not close through fallback');
assert(context.currentChatId === 'c2' && context.currentChatType === 'private', 'picker did not establish character context');

console.log('V2.9-R10 MEMORY ENTRY + SEARCH NAVIGATION CHECKS: PASS');
