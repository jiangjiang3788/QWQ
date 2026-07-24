const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
assert(['2.14-R4', '2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1'].includes(read('VERSION.txt').trim()));

function createBox() {
  const box = {
    console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object, Error, Promise,
    setTimeout, clearTimeout, queueMicrotask,
    window: null,
    document: { addEventListener() {}, querySelectorAll: () => [] }
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('js/features/memory/kernel.js'), box, { filename: 'kernel.js' });
  box.MemoryTablePolicy = {
    selectRelevantItems(items, query, policy) {
      return items.map(item => ({ ...item, _score: query.includes('边界') ? 0.8 : 0.4 })).slice(0, policy.topK || 5);
    },
    computeLexicalScore() { return 0.8; }
  };
  box.MemoryTableEffects = {
    classifyQuery(text) { return { text, topic: ['关系'], scene: ['关系讨论'], entity: [] }; },
    evaluateItem(chat, item) {
      chat.memoryTables ||= {};
      chat.memoryTables.mutatedDuringEvaluation = true;
      item.row.meta ||= {};
      item.row.meta.mutatedDuringEvaluation = true;
      return {
        allowed: true, tagScore: 0.4, tagReasons: ['主题：关系'], effectMode: 'historical_context',
        tags: { topic: ['关系'], scene: ['关系讨论'], entity: [], effect: 'historical_context' },
        usePolicy: {}, lifecycleEval: { effectiveConfidence: 80, reasons: [], changed: true }
      };
    },
    getPromptDirective(mode, policy, row) {
      row.meta.directiveTouched = true;
      return '仅作背景参考。';
    }
  };
  box.MemoryTableFeedback = {
    evaluateItem(chat, item) {
      item.row.meta.feedbackTouched = true;
      return { allowed: true, adjustment: 0, reasons: [], blockedReasons: [] };
    }
  };
  vm.runInContext(read('js/features/memory/retrieval_maintenance.js'), box, { filename: 'retrieval_maintenance.js' });
  vm.runInContext(read('js/modules/memory_table_retrieval.js'), box, { filename: 'memory_table_retrieval.js' });
  return box;
}

(async () => {
  const box = createBox();
  const Maintenance = box.OvoMemoryKernel.require('retrievalMaintenance');
  const Retrieval = box.OvoMemoryKernel.require('retrieval');
  assert.strictEqual(Maintenance.VERSION, '2.14-R4');

  let embeddingCalls = 0;
  box.OVOApiServiceRegistry = {
    isReady(kind) { return kind === 'vector'; },
    async embed(texts) {
      embeddingCalls += 1;
      return texts.map((text, index) => [String(text).length, index + 1, 0.5]);
    }
  };

  const row = {
    id: 'row-1',
    cells: { content: '用户明确说过工作场景不要讨论身体话题' },
    meta: { confidence: 90, usage: { retrievalCount: 3 } }
  };
  const chat = {
    id: 'chat-1',
    memoryTables: { data: { tpl: { table: { __rows: [row] } } }, rounds: [] }
  };
  const groups = [{
    key: 'tpl::table', templateName: '模板', tableName: '近期经历', policy: { topK: 5, threshold: 0, mode: 'relevant' },
    items: [{ id: row.id, row, table: { id: 'table', name: '近期经历' }, searchText: '内容: 用户明确说过工作场景不要讨论身体话题', text: '内容: 用户明确说过工作场景不要讨论身体话题', active: true, importance: 80, confidence: 90 }]
  }];

  const beforeFormal = JSON.stringify(chat.memoryTables.data);
  const beforeChat = JSON.stringify(chat);
  const first = await Retrieval.prepareGroups(chat, groups, '工作边界', { retrievalMode: 'hybrid', semanticWeight: 0.55, tagWeight: 0.35, embeddingCandidateLimit: 32 });
  assert.strictEqual(first.diagnostic.pureRead, true);
  assert.strictEqual(first.diagnostic.actualMode, 'keyword');
  assert.strictEqual(first.diagnostic.indexCoverage.indexed, 0);
  assert.strictEqual(embeddingCalls, 0, 'normal retrieval should not build row vectors');
  assert.strictEqual(JSON.stringify(chat), beforeChat, 'retrieval mutated the chat or formal row');
  assert.strictEqual(JSON.stringify(chat.memoryTables.data), beforeFormal);
  assert.strictEqual(row.meta.mutatedDuringEvaluation, undefined);
  assert.strictEqual(row.meta.feedbackTouched, undefined);
  assert.strictEqual(row.meta.directiveTouched, undefined);

  const plan = await Maintenance.buildIndexPlan(groups, { indexSnapshot: {} });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.created, 1);
  assert.strictEqual(embeddingCalls, 1, 'index maintenance should own row embedding calls');
  const applied = Maintenance.applyIndexPlan(chat, plan);
  assert.strictEqual(applied.count, 1);
  assert.strictEqual(JSON.stringify(chat.memoryTables.data), beforeFormal, 'index maintenance changed formal data');
  assert.strictEqual(Object.keys(chat.memoryTables.retrievalRuntime.index).length, 1);

  const second = await Retrieval.prepareGroups(chat, groups, '工作边界', { retrievalMode: 'hybrid', semanticWeight: 0.55, tagWeight: 0.35, embeddingCandidateLimit: 32 }, {
    indexSnapshot: Maintenance.getIndexSnapshot(chat), usageSnapshot: Maintenance.getUsageSnapshot(chat)
  });
  assert.strictEqual(second.diagnostic.actualMode, 'hybrid');
  assert.strictEqual(second.diagnostic.indexCoverage.indexed, 1);
  assert.strictEqual(embeddingCalls, 2, 'hybrid retrieval should generate only the query vector');
  assert.strictEqual(JSON.stringify(chat.memoryTables.data), beforeFormal);

  second.diagnostic.finalBlock = '内容: 用户明确说过工作场景不要讨论身体话题';
  const usageResult = Maintenance.recordUsage(chat, second.diagnostic, second.diagnostic.finalBlock, { roundId: 'round-1', roundIndex: 4 });
  assert.strictEqual(usageResult.retrieved, 1);
  assert.strictEqual(usageResult.injected, 1);
  const usage = Maintenance.getUsageSnapshot(chat)['tpl::table::row-1'];
  assert.strictEqual(usage.retrievalCount, 1);
  assert.strictEqual(usage.injectionCount, 1);
  assert.strictEqual(row.meta.usage.retrievalCount, 3, 'runtime usage leaked into formal row metadata');
  const duplicate = Maintenance.recordUsage(chat, second.diagnostic, second.diagnostic.finalBlock, { roundId: 'round-1', roundIndex: 4 });
  assert.strictEqual(duplicate.changed, false, 'usage event is not idempotent');

  const cleared = Maintenance.clearIndex(chat);
  assert.strictEqual(cleared, 1);
  assert.strictEqual(Object.keys(Maintenance.getIndexSnapshot(chat)).length, 0);
  assert.strictEqual(JSON.stringify(chat.memoryTables.data), beforeFormal);

  box.OVOApiServiceRegistry.embed = async () => { throw new Error('vector offline'); };
  const failedPlan = await Maintenance.buildIndexPlan(groups, { indexSnapshot: {} });
  assert.strictEqual(failedPlan.ok, false);
  assert.strictEqual(failedPlan.missing, 1);
  const fallback = await Retrieval.prepareGroups(chat, groups, '工作边界', { retrievalMode: 'hybrid' }, { indexSnapshot: {} });
  assert.strictEqual(fallback.diagnostic.actualMode, 'keyword');
  assert.strictEqual(JSON.stringify(chat.memoryTables.data), beforeFormal);

  const retrievalSource = read('js/modules/memory_table_retrieval.js');
  const controller = read('js/modules/memory_table.js') + '\n' + read('js/features/memory/retrieval_orchestrator.js');
  assert(!retrievalSource.includes('item.row.meta.retrievalVector ='));
  assert(!retrievalSource.includes('markRetrieved('));
  assert(!controller.includes('MemoryEffects.markInjected('));
  assert(controller.includes('readRowsForRetrieval'));
  assert(controller.includes('MemoryRetrievalMaintenance?.recordUsage'));
  assert(controller.includes('Promise.resolve(saveCharacter(chat.id))'));
  const contract = JSON.parse(read('architecture/memory_domains.json'));
  assert(['2.14-R4', '2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1'].includes(contract.version));
  assert(contract.publicFacades.memoryRetrievalDomain.owns.includes('retrievalMaintenance'));
  const html = read('index.html');
  assert(html.indexOf('retrieval_maintenance.js') < html.indexOf('memory_table_retrieval.js'));

  console.log('V2.14-R4 PURE RETRIEVAL CHECKS: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
