const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const chat = fs.readFileSync(path.join(root, 'js/modules/chat_ai.js'), 'utf8');
const memoryTable = fs.readFileSync(path.join(root, 'js/modules/memory_table.js'), 'utf8');
const memoryUi = fs.readFileSync(path.join(root, 'js/modules/memory_mode_ui.js'), 'utf8');
const sidecar = fs.readFileSync(path.join(root, 'js/modules/memory_table_sidecar.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFunction(name) {
  let start = chat.indexOf(`async function ${name}(`);
  if (start < 0) start = chat.indexOf(`function ${name}(`);
  assert(start >= 0, `${name} missing`);
  const brace = chat.indexOf('{', start);
  let depth = 0, quote = null, escaped = false;
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
    if (ch === '}' && --depth === 0) return chat.slice(start, i + 1);
  }
  throw new Error(`cannot extract ${name}`);
}

let tablePrepareOptions = null;
let vectorPrepared = false;
const archiveGet = (character, options) => {
  assert.strictEqual(options.allowInactiveMode, true);
  return '【结构化记忆·按需检索】\n核心档案：必须进入上下文';
};
const archivePrepare = async (character, options) => { tablePrepareOptions = options; };
const sandbox = {
  Array, String,
  window: {
    OvoMemory: {
      context: { get: archiveGet, prepare: archivePrepare }
    }
  },
  getMemoryTableContextBlock: archiveGet,
  prepareMemoryTableContext: archivePrepare,
  getVectorMemoryContextBlock() { return '向量补充：相关经历'; },
  async prepareVectorMemoryContext() { vectorPrepared = true; }
};
vm.createContext(sandbox);
vm.runInContext([
  extractFunction('getStructuredArchiveContextApi'),
  extractFunction('hasStructuredArchiveMemory'),
  extractFunction('getStructuredArchiveMemoryContext'),
  extractFunction('ensureStructuredArchivePromptInjection'),
  extractFunction('getJournalMemoryContext'),
  extractFunction('getSupplementalLongTermMemoryContext'),
  extractFunction('buildCombinedLongTermMemoryContext'),
  extractFunction('prepareCombinedLongTermMemoryContext'),
  'this.api={buildCombinedLongTermMemoryContext,prepareCombinedLongTermMemoryContext,ensureStructuredArchivePromptInjection};'
].join('\n'), sandbox);

const character = {
  memoryMode: 'vector',
  memoryTables: { enabled: true, boundTemplateIds: ['tpl_1'] },
  memoryJournals: []
};
const combined = sandbox.api.buildCombinedLongTermMemoryContext(character);
assert(combined.includes('<structured_archive_memory>'), 'structured archive tag missing');
assert(combined.includes('核心档案：必须进入上下文'), 'structured archive was dropped in vector mode');
assert(combined.includes('<vector_memory_context>'), 'vector supplemental memory missing');
const guarded = sandbox.api.ensureStructuredArchivePromptInjection(character, '自定义系统提示词，没有共同回忆占位符');
assert(guarded.includes('<structured_archive_memory>'), 'final payload guard did not append the archive');
assert.strictEqual((guarded.match(/<structured_archive_memory>/g) || []).length, 1, 'archive guard duplicated the archive');
const alreadyInjected = sandbox.api.ensureStructuredArchivePromptInjection(character, guarded);
assert.strictEqual((alreadyInjected.match(/<structured_archive_memory>/g) || []).length, 1, 'archive guard duplicated an existing archive');

sandbox.api.prepareCombinedLongTermMemoryContext(character).then(() => {
  assert(tablePrepareOptions && tablePrepareOptions.allowInactiveMode === true, 'table retrieval not prepared outside table mode');
  assert(vectorPrepared, 'vector supplemental retrieval not prepared');
  assert(memoryTable.includes('const allowInactiveMode = !!options.allowInactiveMode;'), 'memory table inactive-mode bypass missing');
  assert(chat.includes("title: '角色档案记忆（结构化档案）'"), 'operation center archive source missing');
  assert(chat.includes("extractPromptTagContent(systemPrompt, 'structured_archive_memory')"), 'archive source is not read from final prompt');
  assert(chat.includes('window.OvoMemory?.context'), 'chat does not use the converged memory facade');
  assert(chat.includes('await prepareCombinedLongTermMemoryContext(chat);'), 'main chat does not prepare layered memory');
  assert(chat.includes('systemPrompt = ensureStructuredArchivePromptInjection(chat, systemPrompt);'), 'final payload archive guard missing');
  assert(memoryUi.includes('结构化档案 + 向量记忆'), 'settings UI still describes exclusive memory modes');
  assert(!sidecar.includes("chat.memoryMode !== 'table'"), 'live archive sidecar is still disabled outside table mode');
  assert(!html.includes('“三选一”读取模式'), 'stale exclusive-mode UI copy remains');
  console.log('V2.10-R3.2 ARCHIVE INJECTION CHECKS: PASS');
}).catch(error => { console.error(error); process.exit(1); });
