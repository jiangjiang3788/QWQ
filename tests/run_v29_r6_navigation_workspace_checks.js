const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const version = read('VERSION.txt').trim();
const html = read('index.html');
const memory = read('js/modules/memory_table.js');
const registry = read('js/app_registry.js');
const navigation = read('js/ui.js');
const main = read('js/main.js');
const settingsHub = read('js/features/apps/settings_hub.js');
const diagnostics = read('js/core/diagnostics.js');
const workspaceCss = read('css/modules/app_workspace.css');

assert(/^V2\.9-R6(?:\.\d+)?$/.test(version), 'release version mismatch');

// “待处理”状态必须由单一写入口更新，渲染时不能再把刚点击的状态覆盖回 memory。
assert(memory.includes('chatId: null'), 'memory UI character scope is missing');
assert(memory.includes('function persistWorkspaceState(chat, workspace, view)'), 'workspace state writer missing');
assert(memory.includes('options.hydrateUi === true || uiState.chatId !== chat.id'), 'workspace hydration boundary missing');
assert(memory.includes('ensureMemoryTableState(chat, { hydrateUi: uiState.chatId !== chat.id })'), 'character-scoped workspace hydration missing');
assert(memory.includes('persistWorkspaceState(chat, button.dataset.workspace, \'\')'), 'primary workspace tabs do not use the state writer');
assert(!memory.includes("uiState.workspace = button.dataset.workspace || 'memory';\n                renderMemoryTableScreen();"), 'legacy click state overwrite remains');

// 返回必须走统一导航栈；角色和设置页不能再自带一套互相冲突的返回逻辑。
assert(navigation.includes('const navigationState ='), 'navigation stack missing');
assert(navigation.includes('function navigateBack('), 'navigation back resolver missing');
assert(navigation.includes('window.OvoNavigation = Object.freeze'), 'navigation facade missing');
assert(navigation.includes("const clearConversationScreens = ['chat-list-screen', 'contacts-screen', 'home-screen']"), 'role context preservation rule missing');
assert(main.includes('window.OvoNavigation.back(fallback)'), 'global back button does not use navigation stack');
assert(registry.includes('<button type="button" class="back-btn" data-target="home-screen">‹</button>'), 'character app does not use standard back button');

// 首页只保留一套主入口，设置项收敛到设置 App，桌面使用手机式横向分页。
for (const declaration of [
  "id: 'chat', label: '聊天', group: 'dock'",
  "id: 'characters', label: '角色', group: 'dock'",
  "id: 'memory', label: '记忆', group: 'dock'",
  "id: 'settings', label: '设置', group: 'dock'",
  "id: 'contacts', label: '联系人', group: 'context'",
  "id: 'api', label: 'API', group: 'settings'",
  "id: 'data', label: '数据', group: 'settings'",
  "id: 'appearance', label: '外观', group: 'settings'"
]) assert(registry.includes(declaration), `missing IA declaration: ${declaration}`);
assert(registry.includes("appIds: ['worldbook', 'theater', 'favorites', 'reminder', 'search']"), 'standalone launcher page mismatch');
assert(workspaceCss.includes('scroll-snap-type: x mandatory'), 'horizontal scroll snap missing');
assert(workspaceCss.includes('overflow-y: hidden'), 'launcher still allows long vertical scrolling');
assert(!settingsHub.includes("label: '角色管理'"), 'duplicate character-management settings entry remains');
assert(!settingsHub.includes("label: '角色记忆'"), 'duplicate character-memory settings entry remains');

// 诊断入口必须可检查导航、记忆、设置和运行时错误，且在 main 之前加载。
assert(html.includes('js/core/diagnostics.js'), 'diagnostics script missing');
assert(html.indexOf('js/core/diagnostics.js') < html.indexOf('js/main.js'), 'diagnostics must load before main');
for (const token of ['OvoDiagnostics', 'recentErrors', 'OvoNavigation?.snapshot', 'OvoMemory?.health', 'OvoSettings?.health', 'OvoCharacterSettings?.health']) {
  assert(diagnostics.includes(token), `diagnostics token missing: ${token}`);
}
assert(settingsHub.includes("item.action === 'health'"), 'settings health entry not wired');
assert(settingsHub.includes('global.OvoDiagnostics.open()'), 'settings health does not open diagnostics');



// Runtime regression: a click to inbox must survive the next render lookup for the same character.
{
  const start = memory.indexOf('    const uiState = {');
  const end = memory.indexOf('    function getVisibleFieldItems', start);
  assert(start >= 0 && end > start, 'cannot isolate memory workspace state functions');
  let activeChat = {
    id: 'c1',
    memoryTables: {},
    runtime: { workspace: 'memory', workspaceView: 'tables', viewMode: 'normal', activeTableId: null }
  };
  const sandbox = {
    ensureMemoryTableStateBase(chat) { chat.memoryTables ||= {}; },
    getCurrentMemoryTableChatBase() { return activeChat; },
    MemoryPolicy: { ensureRuntimeState(chat) { return chat.runtime; } },
    MemoryWorkspace: {
      normalizeState(workspace, view) {
        if (workspace === 'inbox') return { workspace: 'inbox', view: ['review','sidecar','reliability','feedback','tasks','inbox_home'].includes(view) ? view : 'inbox_home' };
        if (workspace === 'manage') return { workspace: 'manage', view: ['templates','retrieval','quality','history','manage_home'].includes(view) ? view : 'manage_home' };
        return { workspace: 'memory', view: 'tables' };
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(memory.slice(start, end) + '\n;globalThis.__test = { uiState, ensureMemoryTableState, persistWorkspaceState, getCurrentMemoryTableChat };', sandbox);
  sandbox.__test.getCurrentMemoryTableChat();
  assert(sandbox.__test.uiState.workspace === 'memory', 'initial workspace hydration failed');
  sandbox.__test.persistWorkspaceState(activeChat, 'inbox', '');
  assert(sandbox.__test.uiState.workspace === 'inbox' && sandbox.__test.uiState.tab === 'inbox_home', 'inbox click state not written');
  sandbox.__test.getCurrentMemoryTableChat();
  assert(sandbox.__test.uiState.workspace === 'inbox', 'same-character render overwrote inbox state');
  activeChat = { id: 'c2', memoryTables: {}, runtime: { workspace: 'manage', workspaceView: 'quality', viewMode: 'normal', activeTableId: null } };
  sandbox.__test.getCurrentMemoryTableChat();
  assert(sandbox.__test.uiState.workspace === 'manage' && sandbox.__test.uiState.tab === 'quality', 'character switch did not hydrate workspace state');
}

// Runtime regression: nested Settings navigation must return API -> Settings -> Home.
{
  const start = navigation.indexOf('// 屏幕切换与返回栈');
  const end = navigation.indexOf('function renderMoreScreen()', start);
  assert(start >= 0 && end > start, 'cannot isolate navigation runtime');
  class ClassList {
    constructor(active = false) { this.values = new Set(active ? ['active'] : []); }
    add(...items) { items.forEach(item => this.values.add(item)); }
    remove(...items) { items.forEach(item => this.values.delete(item)); }
    contains(item) { return this.values.has(item); }
    toggle(item, force) { if (force === undefined ? !this.values.has(item) : force) this.values.add(item); else this.values.delete(item); }
  }
  const screens = ['home-screen','settings-hub-screen','api-settings-screen','character-app-screen','chat-list-screen','contacts-screen','chat-room-screen'].map((id, index) => ({ id, classList: new ClassList(index === 0) }));
  const byId = Object.fromEntries(screens.map(item => [item.id, item]));
  const document = {
    getElementById(id) { return byId[id] || null; },
    querySelector(selector) { return selector === '.screen.active' ? screens.find(item => item.classList.contains('active')) || null : null; },
    querySelectorAll(selector) { return selector === '.screen' ? screens : []; }
  };
  const window = { dispatchEvent() {}, OvoSettingsHub: null };
  const sandbox = { document, window, console, CustomEvent: function(type, init) { this.type = type; this.detail = init?.detail; }, db: { characters: [], groups: [] }, currentChatId: 'c1', currentChatType: 'private' };
  vm.createContext(sandbox);
  vm.runInContext(navigation.slice(start, end) + '\n;globalThis.__nav = { switchScreen, navigateBack, navigationState };', sandbox);
  assert(sandbox.__nav.switchScreen('settings-hub-screen') === true, 'cannot open settings');
  assert(sandbox.__nav.switchScreen('api-settings-screen') === true, 'cannot open API settings');
  assert(sandbox.__nav.navigateBack('home-screen') === true && document.querySelector('.screen.active').id === 'settings-hub-screen', 'API back did not return Settings');
  assert(sandbox.__nav.navigateBack('home-screen') === true && document.querySelector('.screen.active').id === 'home-screen', 'Settings back did not return Home');
  sandbox.currentChatId = 'c1';
  sandbox.currentChatType = 'private';
  assert(sandbox.__nav.switchScreen('character-app-screen') === true && sandbox.currentChatId === 'c1', 'character app incorrectly cleared role context');
  assert(sandbox.__nav.switchScreen('home-screen') === true && sandbox.currentChatId === null, 'home did not clear active conversation');
  assert(sandbox.__nav.switchScreen('missing-screen') === false && document.querySelector('.screen.active').id === 'home-screen', 'missing route blanked the UI');
}

console.log('V2.9-R6 NAVIGATION & WORKSPACE CHECKS: PASS');
