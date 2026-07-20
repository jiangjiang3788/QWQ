const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const html = read('index.html');
const registry = read('js/app_registry.js');
const favorites = read('js/modules/favorites.js');
const memoryController = read('js/modules/memory_table.js');
const scheduleUi = read('js/modules/memory_table_schedule.js');
const workspace = read('js/features/memory/workspace.js');

assert(registry.includes("['chat', 'api', 'memory', 'settings']"), 'dock replacement missing');
assert(registry.includes("appIds: ['appearance', 'data', 'settings']"), 'API should be removed from launcher system section');
assert(html.includes('js/modules/message_content.js'), 'message content parser is not loaded');
assert(favorites.includes('FavoriteMessageContent.snapshot'), 'favorites do not use shared message parser');
assert(html.includes('memory-table-auto-schedule-list'), 'memory schedule list missing');
assert(html.includes('js/modules/memory_table_schedule.js'), 'memory schedule module is not loaded');
assert(scheduleUi.includes("Kernel.register('schedule'"), 'memory schedule module is not registered');
assert(html.includes('id="memory-workbench-advanced-settings" open'), 'memory update panel should be directly visible');
assert(memoryController.includes("settingsPanel.hidden = uiState.workspace !== 'memory'"), 'update settings were not moved to memory workspace');
assert(!workspace.includes("['manage_settings', '更新与整理'"), 'manage workspace still owns update settings');

const parserContext = { window: null };
parserContext.window = parserContext;
vm.createContext(parserContext);
vm.runInContext(read('js/modules/message_content.js'), parserContext);
const parser = parserContext.OvoMessageContent;
assert(parser.getPreview('[小章鱼的语音：今晚早点睡]') === '[语音] 今晚早点睡', 'voice transcript preview missing');
assert(parser.snapshot({ content: '[我 的语音：测试]' }).plainText === '测试', 'voice snapshot text missing');

const policyContext = { window: null, console };
policyContext.window = policyContext;
vm.createContext(policyContext);
vm.runInContext(read('js/features/memory/kernel.js'), policyContext);
vm.runInContext(read('js/modules/memory_table_policy.js'), policyContext);
const policy = policyContext.OvoMemoryKernel.get('policy');
const chat = {
  history: Array.from({ length: 12 }, (_, index) => ({ id: `m${index + 1}`, timestamp: index + 1 })),
  memoryTables: {
    autoUpdateEnabled: true,
    engineSettings: { enabled: true, triggerMode: 'messages', messageInterval: 10, roundInterval: 2, maxSourceMessages: 10 },
    rounds: []
  }
};
const medium = {
  id: 'table_medium_summary', name: '中期总结与成长经验', memoryLayer: 'medium',
  updatePolicy: { enabled: false, triggerMode: 'manual', messageInterval: 420, roundInterval: 8, maxSourceMessages: 300, useSummaryApi: true }
};
const live = {
  id: 'table_current_state', name: '当前状态（3-7天）', memoryLayer: 'short',
  updatePolicy: { enabled: false, triggerMode: 'manual', instructions: '由主聊天 memory_sidecar 维护' }
};
policy.ensureTableState(chat, 'tpl', medium.id, { table: medium, initializeAtLatest: false });
policy.setTableCursorByPosition(chat, 'tpl', medium.id, 0);
assert(policy.getAutomationMode(chat, 'tpl', medium) === 'engine', 'medium table should default to engine schedule');
assert(policy.isTableDue(chat, 'tpl', medium) === true, 'engine settings should make medium table due');
policy.ensureTableState(chat, 'tpl', live.id, { table: live, initializeAtLatest: false });
policy.setTableCursorByPosition(chat, 'tpl', live.id, 0);
assert(policy.getAutomationMode(chat, 'tpl', live) === 'sidecar', 'live table should use sidecar');
assert(policy.isTableDue(chat, 'tpl', live) === false, 'sidecar table must not create independent API requests');
policy.setAutomationMode(chat, 'tpl', medium, 'manual');
assert(policy.isTableDue(chat, 'tpl', medium) === false, 'manual override should disable scheduling');
policy.setAutomationMode(chat, 'tpl', medium, 'engine');
assert(policy.isTableDue(chat, 'tpl', medium) === true, 'engine override should restore scheduling');


const packageV28 = JSON.parse(read('memory_templates/当前默认记忆模板_V2.8.json'));
const defaultTemplate = packageV28.templates[0];
const defaultChat = {
  history: Array.from({ length: 500 }, (_, index) => ({ id: `h${index + 1}`, timestamp: index + 1 })),
  memoryTables: {
    autoUpdateEnabled: true,
    engineSettings: { enabled: true, triggerMode: 'either', messageInterval: 140, roundInterval: 2, maxSourceMessages: 180 },
    rounds: Array.from({ length: 10 }, (_, index) => ({ id: `r${index + 1}` }))
  }
};
const defaultModes = {};
defaultTemplate.tables.forEach(table => {
  policy.ensureTableState(defaultChat, defaultTemplate.id, table.id, { table, initializeAtLatest: false });
  policy.setTableCursorByPosition(defaultChat, defaultTemplate.id, table.id, 0);
  defaultModes[table.id] = policy.getAutomationMode(defaultChat, defaultTemplate.id, table);
});
assert(defaultModes.table_current_state === 'sidecar', 'default current state should stay in main chat sidecar');
assert(defaultModes.table_tasks === 'sidecar', 'default tasks should stay in main chat sidecar');
assert(defaultModes.table_medium_summary === 'engine', 'default medium summary should follow global schedule');
const defaultDue = defaultTemplate.tables.filter(table => policy.isTableDue(defaultChat, defaultTemplate.id, table));
assert(defaultDue.length === 1 && defaultDue[0].id === 'table_medium_summary', `unexpected default due tables: ${defaultDue.map(table => table.id).join(',')}`);

console.log('V2.9-R6 EXPERIENCE + MEMORY SCHEDULER CHECKS: PASS');
