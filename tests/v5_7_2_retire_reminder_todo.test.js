const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const index = read('index.html');
const appRegistry = read('js/app_registry.js');
const chatAi = read('js/modules/chat_ai.js');
const chatRender = read('js/modules/chat_render.js');
const db = read('js/db.js');
const sourceRegistry = read('js/core/context_source_registry.js');
const memoryCore = read('js/features/memory_v3/memory_core_v3.js');
const memoryUi = read('js/features/memory_v3/memory_ui_v3.js');
const ui = read('js/ui.js');

// Standalone reminder/todo app and all user-facing controls are retired.
assert(!fs.existsSync(path.join(root, 'js/modules/reminder.js')));
assert(!fs.existsSync(path.join(root, 'css/modules/reminder.css')));
assert(!index.includes('id="reminder-btn"'));
assert(!index.includes('id="reminder-screen"'));
assert(!index.includes('id="reminder-form-modal"'));
assert(!index.includes('setting-char-reminder-enabled'));
assert(!index.includes('setting-show-reminder-msg'));
assert(!index.includes('js/modules/reminder.js'));
assert(!index.includes('css/modules/reminder.css'));
assert(!appRegistry.includes("id: 'reminder'"));
assert(!appRegistry.includes("opener: 'reminder'"));
assert(!ui.includes('setupReminderModule'));

// No reminder protocol, scheduler source, parser, prompt injection, or token category remains.
assert(!chatAi.includes('parseReminderTags'));
assert(!chatAi.includes('generateReminderPrompt'));
assert(!chatAi.includes('reminderTokens'));
assert(!chatAi.includes("key: 'reminder'"));
assert(!sourceRegistry.includes("id: 'reminder.active'"));
assert(!chatRender.includes('showReminderMsg'));
assert(!chatRender.includes('reminderMsgMatch'));

// Old reminder arrays/settings are deliberately removed instead of converted.
assert(db.includes("['reminders', 'charReminderEnabled', 'showReminderMsg']"));
assert(db.includes('await dexieDB.characters.bulkPut(db.characters)'));

// The existing role-memory table keeps its stable ID and becomes the sole todo surface.
assert(memoryCore.includes("id: 'v5_recent_events'"));
assert(memoryCore.includes("name: '待办与近期事项'"));
assert(memoryCore.includes('本表是唯一待办来源'));
assert(memoryCore.includes("options: ['待办', '已发生', '已完结']"));
const memoryEngine = read('js/features/memory_v3/memory_engine_v3.js');
assert(memoryEngine.includes("text(getFieldValue(record, statusField)).trim() === '待办'"));
assert(memoryUi.includes('独立提醒/待办已删除'));

// Runtime smoke test: the table is still created under the same ID, so existing memory rows remain compatible.
const sandbox = {
  console, Date, JSON, Math, Map, Set, Object, Array, String, Number, Boolean,
  RegExp, Error, TypeError, Promise,
  setTimeout(fn) { fn(); return 1; }, clearTimeout() {},
  db: { characters: [], magicRoom: { contextPolicy: { structuredEnabled: true, structuredBudget: 10000 } } }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(memoryCore, sandbox, { filename: 'memory_core_v3.js' });
vm.runInContext(read('js/features/memory_v3/memory_rounds_v3.js'), sandbox, { filename: 'memory_rounds_v3.js' });
vm.runInContext(memoryEngine, sandbox, { filename: 'memory_engine_v3.js' });
const character = { id: 'char-todo', name: '角色', memoryStore: { version: 0 } };
sandbox.db.characters.push(character);
const store = sandbox.MemoryV5.model.ensureStore(character);
const table = store.tables.find(item => item.id === 'v5_recent_events');
assert(table);
assert.strictEqual(table.name, '待办与近期事项');
const statusField = table.fields.find(field => field.name === '事项状态');
assert(statusField);
assert(statusField.options.includes('待办'));

const oldStamp = new Date(Date.now() - 40 * 86400000).toISOString();
const pending = sandbox.MemoryV5.model.normalizeRecord({
  id: 'pending-old', title: '交电费', content: '下周之前交电费', tags: ['待办', '电费'],
  '事项状态': '待办', createdAt: oldStamp, updatedAt: oldStamp
}, table);
const completed = sandbox.MemoryV5.model.normalizeRecord({
  id: 'completed-old', title: '旧体检', content: '旧体检已经完成', tags: ['已完结', '体检'],
  '事项状态': '已完结', createdAt: oldStamp, updatedAt: oldStamp
}, table);
store.records[table.id] = [pending, completed];
character.history = [{ id: 'turn', role: 'user', content: '电费和体检怎么样了？', timestamp: Date.now() }];
const context = sandbox.MemoryV5.engine.getContextBlock(character);
assert(context.includes('下周之前交电费'), 'old pending todo must remain available');
assert(!context.includes('旧体检已经完成'), 'old completed event may expire under the 15-day rule');

console.log('V5.8.0 standalone reminder/todo retirement and memory-table replacement tests passed.');
