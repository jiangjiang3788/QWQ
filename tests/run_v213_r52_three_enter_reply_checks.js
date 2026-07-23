const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const chatCode = fs.readFileSync(path.join(root, 'js/chat.js'), 'utf8');
let replyCount = 0;
const toasts = [];
const sandbox = {
  console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object, Error, Promise,
  messageInput: { value: '' },
  isGenerating: false,
  currentChatId: 'chat-1',
  currentChatType: 'private',
  getAiReply: async () => { replyCount += 1; },
  showToast: message => toasts.push(message)
};
vm.createContext(sandbox);
vm.runInContext(chatCode, sandbox);

function event() {
  return { key: 'Enter', isComposing: false, keyCode: 13, repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, prevented: false, preventDefault() { this.prevented = true; } };
}

(async () => {
  for (let i = 0; i < 3; i += 1) assert.strictEqual(vm.runInContext('handleThreeEnterAiReply', sandbox)(event()), true);
  await Promise.resolve();
  assert.strictEqual(replyCount, 1, 'three enters should trigger one AI reply');

  for (let i = 0; i < 3; i += 1) vm.runInContext('handleThreeEnterAiReply', sandbox)(event());
  await Promise.resolve();
  assert.strictEqual(replyCount, 1, 'cooldown should block a second trigger');
  assert(toasts.some(text => text.includes('冷却中')));

  vm.runInContext('threeEnterReplyLastTriggeredAt = Date.now() - 31000', sandbox);
  for (let i = 0; i < 3; i += 1) vm.runInContext('handleThreeEnterAiReply', sandbox)(event());
  await Promise.resolve();
  assert.strictEqual(replyCount, 2, 'trigger should work again after 30 seconds');


  const repeated = event();
  repeated.repeat = true;
  for (let i = 0; i < 8; i += 1) vm.runInContext('handleThreeEnterAiReply', sandbox)(repeated);
  await Promise.resolve();
  assert.strictEqual(replyCount, 2, 'holding Enter must not count as three distinct keystrokes');

  const shifted = event();
  shifted.shiftKey = true;
  assert.strictEqual(vm.runInContext('handleThreeEnterAiReply', sandbox)(shifted), false, 'modified Enter must keep its normal behavior');

  sandbox.messageInput.value = '有文字';
  assert.strictEqual(vm.runInContext('handleThreeEnterAiReply', sandbox)(event()), false, 'normal text enter must not count as empty-enter gesture');

  assert(chatCode.includes('THREE_ENTER_REPLY_WINDOW_MS = 3000'));
  assert(chatCode.includes('THREE_ENTER_REPLY_COOLDOWN_MS = 30000'));
  assert(chatCode.includes("messageInput.addEventListener('keydown'"));
  console.log('V2.13-R5.2 THREE ENTER AI REPLY CHECKS: PASS');
})().catch(error => { console.error(error); process.exit(1); });
