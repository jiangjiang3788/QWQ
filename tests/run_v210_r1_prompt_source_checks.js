const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const storage = new Map();
const listeners = new Map();
class CustomEventMock { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
const windowMock = {
  sessionStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  },
  addEventListener(type, listener) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(listener);
  },
  removeEventListener(type, listener) {
    listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener));
  },
  dispatchEvent(event) { (listeners.get(event.type) || []).forEach(listener => listener(event)); },
  CustomEvent: CustomEventMock,
  console
};
const context = vm.createContext({
  window: windowMock,
  sessionStorage: windowMock.sessionStorage,
  CustomEvent: CustomEventMock,
  console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Error
});
vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/prompt_trace.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/operation_runtime.js'), 'utf8'), context);

assert(windowMock.OVOPromptTrace, 'prompt trace runtime missing');
assert(['2.10-R1', '2.10-R5'].includes(windowMock.OVOPromptTrace.VERSION));
assert(/^2\.(?:10-R(?:[123456](?:\.[123])?)|11-R(?:[0124567]|3(?:\.1)?)|12-R[0-5])$/.test(windowMock.OVOOperationRuntime.VERSION));

const runtime = windowMock.OVOOperationRuntime;
const operation = runtime.start('chat.reply', { scope: { characterId: 'char-1' } });
runtime.attachRequest(operation.id, {
  id: 'request-1',
  task: 'private-chat',
  source: 'chat-ai-reply',
  provider: 'newapi',
  model: 'model-a',
  body: {
    model: 'model-a',
    messages: [
      { role: 'system', content: '系统规则：保持角色口吻。角色人设：沉稳。' },
      { role: 'user', content: '昨天发生了什么？' },
      { role: 'assistant', content: '我们去了公园。' },
      { role: 'user', content: '那你开心吗？' }
    ],
    temperature: 0.8,
    apiKey: 'do-not-store'
  },
  promptSources: [
    { type: 'character_profile', content: '角色人设：沉稳。', reason: '当前角色档案' },
    { type: 'structured_memory', content: '共同记忆：昨天去了公园。', reason: '结构化记忆检索结果' },
    { type: 'worldbook', title: '本次世界书', reason: '关键词命中', items: [{ title: '公园规则', content: '公园夜间关闭。', sent: true }] }
  ]
});
const traced = runtime.get(operation.id).requests[0].promptTrace;
assert(traced, 'request prompt trace missing');
const types = traced.sections.map(section => section.type);
assert(types.includes('character_profile'));
assert(types.includes('structured_memory'));
assert(types.includes('system_rules'));
assert(types.includes('chat_history'));
assert(types.includes('user_input'));
assert(types.includes('tool_config'));
assert(traced.summary.byType.every(group => group.title && !String(group.title).includes('已省略')), 'summary labels must survive runtime clone');
const worldbookSection = traced.sections.find(section => section.type === 'worldbook');
assert(worldbookSection && worldbookSection.items[0].title === '公园规则', 'nested source items must survive runtime clone');
assert(traced.sections.find(section => section.type === 'user_input').content.includes('那你开心吗'));
assert(!runtime.get(operation.id).requests[0].bodyPreview.includes('do-not-store'));

const memoryPrompt = `你现在要帮一个聊天角色更新“结构化记忆表”。请只输出变化。\n\n角色信息：\n- 角色名：阿墨\n- 角色人设：冷静\n- 用户称呼：小章\n- 用户人设：喜欢旅行\n\n模板定义如下：\n模板ID=t1 名称=角色档案\n字段ID=f1 字段名=喜好 当前值=咖啡\n\n最近聊天记录如下：\n小章: 我最近喜欢红茶\n阿墨: 我记住了`;
const memoryTrace = windowMock.OVOPromptTrace.build({ messages: [{ role: 'user', content: memoryPrompt }] }, [], { task: 'memory-table-summary-update' });
const memoryTypes = memoryTrace.sections.map(section => section.type);
assert(memoryTypes.includes('output_rules'));
assert(memoryTypes.includes('character_profile'));
assert(memoryTypes.includes('user_profile'));
assert(memoryTypes.includes('structured_memory'));
assert(memoryTypes.includes('chat_history'));
assert(memoryTrace.sections.find(section => section.type === 'chat_history').content.includes('喜欢红茶'));

const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(indexHtml.indexOf('js/modules/prompt_trace.js') < indexHtml.indexOf('js/modules/operation_runtime.js'));
assert(indexHtml.indexOf('js/modules/operation_runtime.js') < indexHtml.indexOf('js/modules/ai_request_runtime.js'));
const dock = fs.readFileSync(path.join(root, 'js/modules/floating_ball.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'js/modules/chat_ai.js'), 'utf8');
const theater = fs.readFileSync(path.join(root, 'js/modules/theater.js'), 'utf8');
const magicRoom = fs.readFileSync(path.join(root, 'js/features/settings/magic_room.js'), 'utf8');
assert(dock.includes('quick-dock-source-list'));
assert(!dock.includes('查看最终原始请求'));
assert(dock.includes('open-source-management'));
assert(chat.includes('buildPrivateChatPromptSources'));
assert(chat.includes('promptSources,'));
assert(theater.includes('theaterPromptSources'));
assert(theater.includes('characterTheaterPromptSources'));
assert(magicRoom.includes('getLatestOperationPromptTrace'));

console.log('V2.10-R1 PROMPT SOURCE CHECKS: PASS');
