const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const chatAi = read('js/modules/chat_ai.js');
assert(!chatAi.includes('function buildFavoriteAwarenessPrompt(character)'));
assert(!chatAi.includes('<favorite_inventory>'));
assert(chatAi.includes('<favorite_ops>'));
assert(chatAi.includes("registryId: 'memory.structured'"));
assert(chatAi.includes("metadata: { groupedBy: 'tableName' }"));

const dock = read('js/modules/floating_ball.js');
assert(dock.includes("const PACKAGE_VERSION = '5.8.0'"));
assert(dock.includes('function requestSourceSections(request, operation)'));
assert(dock.includes('<details class="quick-dock-source-card'));
assert(dock.includes('<details class="quick-dock-source-item'));
assert(dock.includes('function parseHistoryDisplayItem(item)'));
assert(dock.includes(".replace(/^\\s*\\[id:[^\\]\\r\\n]+\\]\\s*/i, '')"));
assert(dock.includes('quick-dock-history-message-list'));
assert(dock.includes('function renderGroupedSourceItems(groups)'));
assert(!dock.includes('function renderFavoriteSource(section)'));
assert(dock.includes('function renderStructuredMemorySource(section)'));

const css = read('css/modules/quick_dock.css');
assert(css.includes('QWQ 5.8.0'));
assert(css.includes('.quick-dock-source-card>summary>em:after'));
assert(css.includes('.quick-dock-source-item>summary'));
assert(css.includes('.quick-dock-history-message>header'));

const store = {};
global.window = global;
global.sessionStorage = {
  setItem(key, value) { store[key] = String(value); },
  getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
  removeItem(key) { delete store[key]; }
};
global.localStorage = global.sessionStorage;
delete require.cache[require.resolve(path.join(root, 'js/core/context_source_registry.js'))];
require(path.join(root, 'js/core/context_source_registry.js'));
const manifest = global.OVOContextSourceRegistry.buildCompiledManifest({
  provider: 'newapi', model: 'test-model',
  requestBody: { model: 'test-model', messages: [
    { role: 'system', content: '核心规则' },
    { role: 'assistant', content: '[阿沉的消息：爱你。]' },
    { role: 'user', content: '[id:msg_1]\n<message_meta sent_at="2026-07-29 14:30:32 UTC+08:00" />\n[小海葵的消息：爸爸]' },
    { role: 'user', content: '本轮输入' }
  ] }, promptSources: []
});
const history = manifest.sources.find(item => item.sourceId === 'chat.history');
assert(history);
assert.strictEqual(history.items.length, 2);
assert.strictEqual(history.items[0].title, '角色');
assert.strictEqual(history.items[0].metadata.role, 'assistant');
assert.strictEqual(history.items[1].title, '用户');
assert.strictEqual(history.items[1].metadata.sentAt, '2026-07-29 14:30:32 UTC+08:00');
console.log('V5.6.5/V5.7.0 request panel test passed.');
