const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const runtime = read('js/modules/operation_runtime.js');
const trace = read('js/modules/prompt_trace.js');
const chat = read('js/modules/chat_ai.js');
const memory = read('js/modules/memory_table.js');
const review = read('js/modules/memory_table_review.js');
const dock = read('js/modules/floating_ball.js');
const dockCss = read('css/modules/quick_dock.css');
const memoryCss = read('css/modules/memory_table_v2.css');

assert(runtime.includes('BODY_PREVIEW_LIMIT = 120000'), 'raw request preview limit not expanded');
assert(runtime.includes('value.length > 80000'), 'operation feedback clone limit not expanded');
assert(trace.includes('verificationView: true'), 'combined prompt verification view is missing');
assert(trace.includes('不代表再次发送') || dock.includes('不是第二次发送'), 'UI does not explain combined/itemized views are one request');
assert(dock.includes('模型请求（实际网络调用）'), 'actual network call count label is missing');
assert(dock.includes('quick-dock-source-item-flat'), 'prompt source items were not flattened');
assert(dock.includes('quick-dock-panel--app-fullscreen'), 'full-screen operation center class is missing');
assert(dockCss.includes('quick-dock-panel--app-fullscreen'), 'full-screen operation center CSS is missing');
assert(dockCss.includes('.quick-dock-source-content{margin:0 0 8px;padding:10px;max-height:none'), 'source content still uses a tiny nested scroll box');
assert(dockCss.includes('.quick-dock-raw-request pre,.quick-dock-result-pre{max-height:none'), 'raw request/result feedback still truncates visually');

assert(chat.includes('function buildPromptMessageTimePrefix'), 'chat prompt timestamp helper is missing');
assert((chat.match(/buildPromptMessageTimePrefix\(currentMsgTime\)/g) || []).length >= 2, 'timestamps are not injected in both provider paths');
const replyBlock = chat.slice(chat.indexOf("const promptSources = chatType === 'private'"), chat.indexOf('if (streamEnabled)', chat.indexOf("const promptSources = chatType === 'private'")));
assert.strictEqual((replyBlock.match(/OVOAIRequestRuntime\.request/g) || []).length, 1, 'main chat reply path appears to issue more than one runtime request');
assert(replyBlock.includes('dedupeKey:'), 'main chat request dedupe guard is missing');

assert(memory.includes('formatMemoryPromptTimestamp'), 'memory prompt timestamp helper is missing');
assert(memory.includes('`[${formatMemoryPromptTimestamp(item.timestamp)}]'), 'memory history does not include exact message times');
assert(memory.includes("memoryTableScreenBound === '1'"), 'memory review screen binding guard is missing');
assert(memory.includes('正在保存…'), 'memory review apply feedback is missing');
assert(memory.includes('审核结果保存失败'), 'memory review apply failure feedback is missing');
assert(review.includes('保存已接受项（${counts.accepted}）'), 'memory review final save action is unclear');
assert(review.includes("counts.accepted ? '' : 'disabled'"), 'save action should be disabled until at least one item is selected');
assert(memoryCss.includes('.memory-review-source pre,.memory-feedback-round pre{max-height:none'), 'memory feedback remains trapped in a small scroll box');

console.log('V2.10-R2.1 EMERGENCY HOTFIX CHECKS: PASS');
