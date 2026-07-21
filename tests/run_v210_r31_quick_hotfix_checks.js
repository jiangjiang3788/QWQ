const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const chat = fs.readFileSync(path.join(root, 'js/modules/chat_ai.js'), 'utf8');

function extractFunction(name) {
  const start = chat.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} is missing`);
  const brace = chat.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = brace; i < chat.length; i++) {
    const ch = chat[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return chat.slice(start, i + 1);
    }
  }
  throw new Error(`Unable to extract ${name}`);
}

const sandbox = { Date, Number, String, Math, RegExp };
vm.createContext(sandbox);
vm.runInContext([
  extractFunction('formatPromptTimestamp'),
  extractFunction('buildPromptMessageTimePrefix'),
  extractFunction('appendMessageMetadataProtocol'),
  extractFunction('stripPromptMetadataEcho'),
  extractFunction('extractPromptTagContent'),
  'this.api = { buildPromptMessageTimePrefix, appendMessageMetadataProtocol, stripPromptMetadataEcho, extractPromptTagContent };'
].join('\n'), sandbox);

const { api } = sandbox;
const prefix = api.buildPromptMessageTimePrefix(1721568000000);
assert(prefix.startsWith('<message_meta sent_at="'), 'chat timestamp is not encoded as internal metadata');
assert(!prefix.includes('[消息时间：'), 'old bubble-like timestamp marker is still used');

const echoed = '<message_meta sent_at="2026-07-21 14:21:03 UTC+02:00" />\n[角色的消息：你好]\n[消息时间：2026-07-21 14:21:03 UTC+02:00]\n[角色的消息：再见]';
const cleaned = api.stripPromptMetadataEcho(echoed);
assert(!cleaned.includes('message_meta'), 'XML time metadata echo was not removed');
assert(!cleaned.includes('消息时间：'), 'legacy time metadata echo was not removed');
assert(cleaned.includes('[角色的消息：你好]') && cleaned.includes('[角色的消息：再见]'), 'visible reply content was damaged');

const protocol = api.appendMessageMetadataProtocol('base prompt');
assert(protocol.includes('<message_metadata_protocol>'), 'metadata non-echo protocol is missing');
assert.strictEqual((api.appendMessageMetadataProtocol(protocol).match(/<message_metadata_protocol>/g) || []).length, 1, 'metadata protocol is appended more than once');

const live = api.extractPromptTagContent('<memory_live_context>状态：紧张\n待办：赴约</memory_live_context>', 'memory_live_context');
assert.strictEqual(live, '状态：紧张\n待办：赴约', 'character archive memory tag extraction failed');

assert(chat.includes("type: 'character_memory'"), 'character archive memory is not exposed as an actual prompt source');
assert(chat.includes("traceMode: 'request_exact'"), 'archive memory source is not tied to the final request');
assert(chat.includes('const hadMemoryPlaceholder = /\\{\\{共同回忆\\}\\}/.test(template);'), 'custom prompt memory placeholder detection is missing');
assert(chat.includes("template += `\\n\\n<memoir>\\n${commonMemories}\\n</memoir>`"), 'memory fallback injection is missing when custom prompt omits the placeholder');
assert(chat.includes("const isTargetChatOpen = targetChatId === currentChatId"), 'active-chat render reconciliation is missing');
assert(chat.includes('currentPage = 1;\n            renderMessages(false, true);'), 'active chat is not reset to the latest page before refresh');
assert(chat.indexOf('fullResponse = stripPromptMetadataEcho(fullResponse);') < chat.indexOf('window.MemoryTableSidecar.extractSidecar(fullResponse)'), 'metadata echo must be stripped before reply parsing');

console.log('V2.10-R3.1 QUICK HOTFIX CHECKS: PASS');
