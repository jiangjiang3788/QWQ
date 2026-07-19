const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');

global.window = global;
global.db = { vectorApiSettings: {}, characters: [] };
global.fetch = async () => { throw new Error('network should not be called in keyword fallback test'); };

function load(rel) {
  vm.runInThisContext(fs.readFileSync(path.join(root, rel), 'utf8'), { filename: rel });
}
load('js/features/memory/kernel.js');
load('js/modules/memory_table_policy.js');
load('js/modules/memory_table_review.js');
load('js/modules/memory_table_retrieval.js');

(async () => {
  const chat = { memoryTables: {}, history: [] };
  const rows = [
    { id: 'r1', searchText: '最近睡眠不足，晚上两点才睡', text: '最近睡眠不足，晚上两点才睡', row: { id: 'r1', meta: {} }, updatedAt: Date.now(), importance: 80, active: true },
    { id: 'r2', searchText: '喜欢科幻电影和太空题材', text: '喜欢科幻电影和太空题材', row: { id: 'r2', meta: {} }, updatedAt: Date.now() - 100000, importance: 60, active: true }
  ];
  const result = await MemoryTableRetrieval.prepareGroups(chat, [{
    key: 't::sleep', templateName: '测试', tableName: '日常观察',
    policy: { mode: 'relevant', topK: 1, threshold: 0.05 }, items: rows
  }], '昨晚睡得太晚了', { retrievalMode: 'auto', semanticWeight: 0.62, embeddingCandidateLimit: 8 });
  if (result.diagnostic.actualMode !== 'keyword') throw new Error('auto mode should fallback to keyword without vector API');
  if (result.selectedByTable['t::sleep'][0].id !== 'r1') throw new Error('keyword retrieval selected wrong row');
  const reviewChat = { memoryTables: {} };
  const batch = MemoryTableReview.enqueueBatch(reviewChat, { proposals: [{ id: 'p1', kind: 'row_add', newValue: { topic: 'sleep' }, duplicateSuggestion: { rowId: 'r1' } }] });
  if (!MemoryTableReview.setProposalMergeTarget(reviewChat, batch.id, 'p1', 'r1')) throw new Error('merge target was not set');
  if (batch.proposals[0].mergeTargetRowId !== 'r1') throw new Error('merge target mismatch');
  console.log('V2.2 RETRIEVAL CHECKS: PASS');
})().catch(error => { console.error(error); process.exit(1); });
