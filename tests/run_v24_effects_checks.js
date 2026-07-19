const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');

global.window = global;
global.db = { vectorApiSettings: {}, characters: [] };
global.fetch = async () => { throw new Error('network should not be called'); };

function load(rel) {
  vm.runInThisContext(fs.readFileSync(path.join(root, rel), 'utf8'), { filename: rel });
}
load('js/features/memory/kernel.js');
load('js/modules/memory_table_policy.js');
load('js/modules/memory_table_effects.js');
load('js/modules/memory_table_retrieval.js');

function row(id, text, meta) {
  return {
    id,
    searchText: text,
    text,
    table: { id: 'table_long', name: '稳定长期特征库', memoryLayer: 'long' },
    row: { id, cells: {}, meta: meta || {} },
    updatedAt: Date.now(), importance: 70, active: true
  };
}

(async () => {
  const chat = { memoryTables: { rounds: [{}, {}, {}, {}, {}] }, history: [] };
  const allowed = row('sleep-ok', '用户最近讨论睡眠不足，希望健康复盘时参考', {
    tagBundle: { topic: ['睡眠'], scene: ['健康追踪'], entity: [], effect: 'historical_context' },
    usePolicy: { injectionEnabled: true, paused: false, cooldownRounds: 0 }, usage: {}
  });
  const paused = row('sleep-paused', '睡眠记录但已暂停', {
    tagBundle: { topic: ['睡眠'], scene: ['健康追踪'], entity: [], effect: 'historical_context' },
    usePolicy: { injectionEnabled: true, paused: true }, usage: {}
  });
  const candidate = row('sleep-candidate', '未经审核的睡眠推测', {
    tagBundle: { topic: ['睡眠'], scene: ['健康追踪'], entity: [], effect: 'candidate' },
    usePolicy: {}, usage: {}
  });
  const cooldown = row('sleep-cooldown', '刚刚使用过的睡眠偏好', {
    tagBundle: { topic: ['睡眠'], scene: ['健康追踪'], entity: [], effect: 'soft_preference' },
    usePolicy: { cooldownRounds: 3 }, usage: { lastInjectedRoundIndex: 4 }
  });
  const work = row('work', '用户喜欢先看代码整体结构', {
    tagBundle: { topic: ['工作'], scene: ['任务执行'], entity: ['记忆系统'], effect: 'soft_preference' },
    usePolicy: {}, usage: {}
  });

  const result = await MemoryTableRetrieval.prepareGroups(chat, [{
    key: 'tpl::long', templateName: '测试', tableName: '稳定长期特征库',
    policy: { mode: 'relevant', topK: 5, threshold: 0.05 },
    items: [allowed, paused, candidate, cooldown, work]
  }], '最近睡眠不太好，想复盘一下健康状态', {
    retrievalMode: 'keyword', semanticWeight: 0.55, tagWeight: 0.35,
    embeddingCandidateLimit: 16, sceneRoutingEnabled: true, sideEffectGuardEnabled: true
  });

  const selected = result.selectedByTable['tpl::long'].map(item => item.id);
  if (!selected.includes('sleep-ok')) throw new Error('tag-routed sleep memory was not selected');
  if (selected.includes('sleep-paused')) throw new Error('paused memory was selected');
  if (selected.includes('sleep-candidate')) throw new Error('candidate memory was selected');
  if (selected.includes('sleep-cooldown')) throw new Error('cooldown memory was selected');
  if (!(result.diagnostic.queryContext.scene || []).includes('健康追踪')) throw new Error('health scene not classified');
  if (!result.diagnostic.tables[0].blocked.length) throw new Error('blocked diagnostics missing');
  const directive = MemoryTableEffects.getPromptDirective('temporary_state', { maxInfluence: 'low', allowProactiveMention: false });
  if (!directive.includes('不得推断为长期人格')) throw new Error('temporary state directive missing');

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'memory_templates/当前默认记忆模板_V2.8.json'), 'utf8'));
  if (parseFloat(pkg.schemaVersion) < 2.4) throw new Error('schema version is below 2.4');
  const rows = [];
  const tpl = pkg.templates[0];
  tpl.tables.forEach(table => rows.push(...(pkg.binding.data[tpl.id][table.id].__rows || [])));
  if (rows.length !== 209) throw new Error(`row count changed: ${rows.length}`);
  if (rows.some(item => !item.meta?.tagBundle || !item.meta?.usePolicy || !item.meta?.usage)) throw new Error('row effect metadata migration incomplete');
  console.log('V2.4 EFFECT ROUTING CHECKS: PASS');
})().catch(error => { console.error(error); process.exit(1); });
