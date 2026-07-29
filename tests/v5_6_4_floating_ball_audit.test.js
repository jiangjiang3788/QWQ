const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const chatAi = read('js/modules/chat_ai.js');
assert(chatAi.includes("extractPromptHeadingBlock(systemPrompt, '用户收藏的内容')"));
assert(chatAi.includes("registryId: 'collection.relevant'"));
assert(chatAi.includes('const favoriteItems = parseFavoritePromptItems(favoriteContext)'));
assert(chatAi.includes('items: favoriteItems'));
assert(chatAi.includes('items: structuredItems'));
assert(chatAi.includes('window.MemoryV5?.engine?.formatRecordText'));
assert(chatAi.includes("entityType: 'structured_memory'"));
assert(chatAi.includes('after: actualText'));

const dock = read('js/modules/floating_ball.js');
assert(dock.includes("const PACKAGE_VERSION = '5.6.6'"));
assert(dock.includes('这里按最终请求里的消息条目计数，不按“对话轮次”计数'));
assert(dock.includes('消息数组'));
assert(dock.includes('system instruction'));
assert(dock.includes('其中历史'));
assert(dock.includes('记忆已检查'));
assert(!dock.includes('open-source-management'));
assert(!dock.includes('打开来源设置'));
assert(!dock.includes('openPromptSourceManagement'));
assert(dock.includes('<details class="quick-dock-source-item'));
assert(dock.includes('quick-dock-history-message'));
assert(dock.includes('requestSourceSections'));


const actionBar = read('js/modules/quick_dock_action_bar.js');
assert(actionBar.includes('quick-dock-compact-tools'));
assert(actionBar.includes('<summary>Git</summary>'));
assert(!actionBar.includes('quick-dock-top-actions'));

const css = read('css/modules/quick_dock.css');
assert(css.includes('QWQ 5.6.4'));
assert(css.includes('.quick-dock-history-facts'));
assert(css.includes('.quick-dock-memory-write-status'));
assert(css.includes('width:min(100%,1280px)'));


const store = {};
global.window = global;
global.sessionStorage = {
  setItem(key, value) { store[key] = String(value); },
  getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
  removeItem(key) { delete store[key]; }
};
global.localStorage = global.sessionStorage;
global.CustomEvent = function CustomEvent(type, init = {}) { this.type = type; this.detail = init.detail; };
global.dispatchEvent = () => {};

delete require.cache[require.resolve(path.join(root, 'js/core/context_source_registry.js'))];
require(path.join(root, 'js/core/context_source_registry.js'));
const favoriteBlock = '这是用户主动收藏的消息内容：\n- 内容：喜欢雨天散步\n- 内容：不喜欢被催促';
const memoryBlock = '【关系状态】\n称呼: 小海葵\n状态: 信任\n---\n称呼: 阿沉\n状态: 依赖';
const manifest = global.OVOContextSourceRegistry.buildCompiledManifest({
  provider: 'gemini',
  model: 'gemini-test',
  requestBody: {
    model: 'gemini-test',
    system_instruction: { parts: [{ text: `核心规则\n【用户收藏的内容】\n${favoriteBlock}\n<structured_archive_memory>\n${memoryBlock}\n</structured_archive_memory>` }] },
    contents: [{ role: 'user', parts: [{ text: '你好' }] }]
  },
  promptSources: [
    { registryId: 'collection.relevant', type: 'other', title: '相关收藏', content: favoriteBlock, sent: true, items: [
      { id: 'favorite-1', title: '收藏 1', content: '内容：喜欢雨天散步', sent: true }
    ] },
    { registryId: 'memory.structured', type: 'structured_memory', title: '结构化记忆', content: memoryBlock, sent: true, items: [
      { id: 'memory-1', title: '关系状态 · 第 1 条', content: '称呼: 小海葵\n状态: 信任', sent: true }
    ] }
  ]
});
const sourceById = Object.fromEntries(manifest.sources.map(item => [item.sourceId, item]));
assert.strictEqual(sourceById['collection.relevant'].content, favoriteBlock);
assert.strictEqual(sourceById['collection.relevant'].items[0].content, '内容：喜欢雨天散步');
assert.strictEqual(sourceById['memory.structured'].items[0].title, '关系状态 · 第 1 条');
assert(!sourceById['system.core_rules'].content.includes('喜欢雨天散步'));

delete require.cache[require.resolve(path.join(root, 'js/modules/operation_runtime.js'))];
require(path.join(root, 'js/modules/operation_runtime.js'));
assert.strictEqual(global.OVOOperationRuntime.VERSION, '2.17');
const op = global.OVOOperationRuntime.start('memory.table.update', { title: '记忆写入测试' });
const mutation = global.OVOOperationRuntime.recordMutation(op.id, {
  action: 'update',
  entityType: 'structured_memory',
  title: '关系状态',
  after: '甲'.repeat(4500)
});
assert(mutation.after.length > 4000);
assert(mutation.after.includes('超过 4000 字符'));
assert(!mutation.after.includes('超过 1200 字符'));

console.log('V5.6.4 floating ball audit test passed.');
