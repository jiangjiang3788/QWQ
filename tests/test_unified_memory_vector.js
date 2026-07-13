/* Run with: node tests/test_unified_memory_vector.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');
const context = { console, Date, Math, JSON, Promise, setTimeout, clearTimeout, confirm: () => true };
context.window = context;
context.document = { readyState: 'loading', addEventListener: () => {}, querySelectorAll: () => [], getElementById: () => null };
context.currentChatId = 'test-character';
context.currentChatType = 'private';
context.db = {
  characters: [],
  vectorApiSettings: { url: 'https://example.invalid', key: 'test', model: 'fake-embed', provider: 'newapi', dimensions: 3 },
  summaryApiSettings: {},
  apiSettings: {}
};
context.saveData = async () => {};
context.showToast = () => {};
context.VectorMemoryTools = {
  fetchEmbeddings: async texts => texts.map(text => {
    if (/睡眠|失眠|夜醒|睡不着/.test(text)) return [1, 0, 0];
    if (/辞职|工作/.test(text)) return [0, 1, 0];
    return [0, 0, 1];
  }),
  cosineSimilarity: (a, b) => {
    let dot = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
    return dot / (Math.sqrt(aa) * Math.sqrt(bb));
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/unified_memory.js'), 'utf8'), context);
const character = { id: 'test-character', history: [] };
context.db.characters.push(character);
const state = context.UnifiedMemory.ensureState(character);
state.vector.enabled = true;
state.events.push(
  { id: 'sleep-a', title: '昨晚失眠', factualSummary: '用户昨晚睡不着并夜醒。', keywords: ['睡眠'], status: 'active', importance: 7 },
  { id: 'sleep-b', title: '再次夜醒', factualSummary: '用户因疼痛再次夜醒。', keywords: ['夜醒'], status: 'active', importance: 6 },
  { id: 'work-a', title: '准备辞职', factualSummary: '用户准备从当前工作离职。', keywords: ['工作'], status: 'active', importance: 6 }
);
context.UnifiedMemory.ensureState(character);
(async () => {
  const generated = await context.UnifiedMemory.generateEventEmbeddings(character, state.events.map(event => event.id));
  if (generated.count !== 3) throw new Error('Embedding count mismatch');
  const selected = await context.UnifiedMemory.selectMemoriesWithVector(character, '昨晚又睡不着', { touch: false });
  if (!selected.vectorUsed || !selected.events.some(entry => entry.item.id === 'sleep-a')) throw new Error('Hybrid retrieval failed');
  const duplicates = context.UnifiedMemory.getDuplicateEventSuggestions(character);
  if (!duplicates.some(item => new Set([item.a.id, item.b.id]).has('sleep-a') && new Set([item.a.id, item.b.id]).has('sleep-b'))) throw new Error('Duplicate suggestion failed');
  state.eventBoxes.push({ id: 'sleep-box', name: '睡眠问题', status: 'ongoing' });
  state.events.find(event => event.id === 'sleep-a').eventBoxId = 'sleep-box';
  const boxSuggestions = context.UnifiedMemory.getVectorEventBoxSuggestions(character);
  if (!boxSuggestions.some(item => item.event.id === 'sleep-b' && item.box.id === 'sleep-box')) throw new Error('EventBox suggestion failed');
  console.log('UNIFIED MEMORY VECTOR TESTS: PASS');
})().catch(error => { console.error(error); process.exit(1); });
