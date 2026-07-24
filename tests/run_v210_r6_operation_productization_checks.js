const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const storage = new Map();
const listeners = new Map();
class CustomEventMock { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }
const sessionStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};
const windowMock = {
  sessionStorage,
  addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); },
  removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener)); },
  dispatchEvent(event) { (listeners.get(event.type) || []).forEach(listener => listener(event)); },
  CustomEvent: CustomEventMock,
  OVOAICapabilityCatalog: { list: () => [] },
  console
};
const context = vm.createContext({
  window: windowMock, sessionStorage, CustomEvent: CustomEventMock, console,
  Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Error, Promise, URL,
  setTimeout, clearTimeout
});
vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/operation_runtime.js'), 'utf8'), context);
const runtime = windowMock.OVOOperationRuntime;
assert(runtime, 'operation runtime missing');
assert(['2.10-R6', '2.11-R0', '2.11-R1', '2.11-R2', '2.11-R3.1', '2.11-R4', '2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2', '2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1'].includes(runtime.VERSION));

const first = runtime.start('chat.reply', { title: '给小章鱼生成回复', category: '聊天', scope: { characterName: '小章鱼' } });
runtime.attachRequest(first.id, {
  id: 'req_secret', task: 'private-chat', provider: 'newapi', model: 'gpt-test',
  endpoint: 'https://api.example/v1/chat?api_key=TOPSECRET&token=ALSOSECRET',
  body: { apiKey: 'TOPSECRET', authorization: 'Bearer raw-secret', messages: [{ role: 'user', content: 'Authorization: Bearer abcdefghijklmnop sk-abcdefghijklmnop' }] }
});
runtime.recordMutation(first.id, { action: 'create', entityType: 'chat_message', title: '新增回复', summary: '写入 1 条角色回复' });
runtime.complete(first.id, { summary: '回复完成' });

const second = runtime.start('theater.generate', { title: '生成雨夜小剧场', category: '小剧场' });
runtime.fail(second.id, new Error('Provider token=SHOULD_HIDE 请求失败'));

assert.strictEqual(runtime.list({ query: '小章鱼' }).length, 1, 'query filter failed');
assert.strictEqual(runtime.list({ status: 'success' }).length, 1, 'status filter failed');
assert.strictEqual(runtime.list({ category: '小剧场' }).length, 1, 'category filter failed');
assert.strictEqual(runtime.getFacets().statuses.failed, 1, 'status facets missing');
const failedReport = runtime.exportReport(second.id, { mode: 'advanced', format: 'json' });
assert(!failedReport.includes('SHOULD_HIDE') && failedReport.includes('token=***'), 'plain token assignment was not redacted');

const simple = runtime.exportReport(first.id, { mode: 'simple', format: 'json' });
const advanced = runtime.exportReport(first.id, { mode: 'advanced', format: 'json' });
assert(!simple.includes('bodyPreview'), 'simple report must not expose raw body');
assert(advanced.includes('bodyPreview'), 'advanced report should include controlled raw body');
for (const secret of ['TOPSECRET', 'ALSOSECRET', 'raw-secret', 'abcdefghijklmnop']) {
  assert(!advanced.includes(secret), `secret leaked in advanced report: ${secret}`);
}
assert(advanced.includes('api_key=***') && advanced.includes('sk-***'), 'redaction markers missing');
const history = runtime.exportHistory({ mode: 'simple', format: 'markdown', rootsOnly: true, category: '聊天' });
assert(history.includes('AI 操作历史报告') && history.includes('给小章鱼生成回复'), 'history export failed');

const huge = 'x'.repeat(80000);
for (let i = 0; i < 14; i += 1) {
  const op = runtime.start('ai.request', { title: `容量测试 ${i}`, category: '测试' });
  runtime.attachRequest(op.id, { id: `huge_${i}`, body: { messages: [{ role: 'user', content: huge }] } });
  runtime.complete(op.id, { summary: '完成' });
}
const stats = runtime.getStorageStats();
assert(stats.chars <= stats.budget, `storage budget exceeded: ${stats.chars}/${stats.budget}`);
assert(stats.compacted, 'large history should trigger automatic compaction');

const dock = fs.readFileSync(path.join(root, 'js/modules/floating_ball.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/modules/quick_dock.css'), 'utf8');
assert(dock.includes('V2.10-R6') || dock.includes('V2.11-R0') || dock.includes('V2.11-R1') || dock.includes('V2.11-R2') || dock.includes('V2.11-R3.1') || dock.includes('V2.11-R4') || dock.includes('V2.11-R5') || dock.includes('V2.11-R6') || dock.includes('V2.11-R7') || dock.includes('V2.12-R0') || dock.includes('V2.12-R1') || dock.includes('V2.12-R2') || dock.includes('V2.13-R1') || dock.includes('V2.13-R2') || dock.includes('V2.13-R3'));
assert(dock.includes('quick-dock-history-query'));
assert(dock.includes('quick-dock-history-type'));
assert(dock.includes('quick-dock-history-from'));
assert(dock.includes('quick-dock-history-to'));
assert(!dock.includes('set-view-mode'));
assert(dock.includes("const REPORT_MODE = 'detailed'"));
assert(dock.includes('export-history'));
assert(dock.includes('download-operation-report'));
assert(!dock.includes('quick-dock-view-mode-bar'));
assert(css.includes('quick-dock-history-filters'));
assert(!css.includes('quick-dock-view-switch'));
assert(['2.10-R6', '2.11-R0', '2.11-R1', '2.11-R2', '2.11-R3.1', '2.11-R4', '2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2', '2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1'].includes(fs.readFileSync(path.join(root, 'VERSION.txt'), 'utf8').trim()));
console.log('V2.10-R6 OPERATION CENTER PRODUCTIZATION CHECKS: PASS');
