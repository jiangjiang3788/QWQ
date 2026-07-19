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
load('js/modules/memory_table_lifecycle.js');
load('js/modules/memory_table_effects.js');
load('js/modules/memory_table_retrieval.js');

function makeRow(id, text, meta = {}) {
  const table = { id: 'table_long', name: '稳定长期特征库', memoryLayer: 'long', columns: [] };
  const row = { id, cells: {}, meta };
  MemoryTableEffects.ensureRowMeta(row, table, text);
  return { id, searchText: text, text, table, row, updatedAt: Date.now(), importance: 70, active: true };
}

(async () => {
  const expired = makeRow('expired', '用户以前喜欢早起', {
    tagBundle: { topic: ['生活'], scene: ['日常聊天'], entity: [], effect: 'soft_preference' },
    usePolicy: {},
    lifecycle: { status: 'active', retentionMode: 'fixed', expiresAt: Date.now() - 1000 },
    evidence: { primarySource: 'user_explicit', userEvidenceCount: 1, userConfirmed: true }
  });
  const inferred = makeRow('inferred', '模型推测用户可能偏好短回复', {
    tagBundle: { topic: ['工作'], scene: ['任务执行'], entity: [], effect: 'soft_preference' },
    usePolicy: {},
    lifecycle: { status: 'uncertain', retentionMode: 'decay', decayHalfLifeDays: 10 },
    evidence: { primarySource: 'assistant_inferred', assistantEvidenceCount: 1, userConfirmed: false },
    createdAt: Date.now() - 20 * 86400000,
    updatedAt: Date.now() - 20 * 86400000,
    lastMentionedAt: Date.now() - 20 * 86400000,
    confidence: 80
  });
  const current = makeRow('current', '用户现在不喜欢早起', {
    tagBundle: { topic: ['生活'], scene: ['日常聊天'], entity: [], effect: 'soft_preference' },
    usePolicy: {},
    evidence: { primarySource: 'user_explicit', userEvidenceCount: 1, userConfirmed: true },
    lifecycle: { status: 'active', retentionMode: 'permanent' }
  });
  const old = makeRow('old', '用户喜欢早起', {
    tagBundle: { topic: ['生活'], scene: ['日常聊天'], entity: [], effect: 'soft_preference' },
    usePolicy: {},
    evidence: { primarySource: 'legacy_import' },
    lifecycle: { status: 'active', retentionMode: 'decay' }
  });

  if (!MemoryTableLifecycle.linkRows(current.row, old.row, 'supersedes')) throw new Error('supersede link failed');
  if (old.row.meta.lifecycle.status !== 'superseded') throw new Error('old row not superseded');
  if (!current.row.meta.relations.supersedes.includes('old')) throw new Error('supersede relation missing');

  const chat = { memoryTables: { rounds: [{}, {}, {}] }, history: [] };
  const result = await MemoryTableRetrieval.prepareGroups(chat, [{
    key: 'tpl::long', templateName: '测试', tableName: '长期',
    policy: { mode: 'relevant', topK: 10, threshold: 0 },
    items: [expired, inferred, current, old]
  }], '我最近不想早起，工作回复简短些', {
    retrievalMode: 'keyword', semanticWeight: 0.55, tagWeight: 0.35,
    embeddingCandidateLimit: 16, sceneRoutingEnabled: true, sideEffectGuardEnabled: true
  });
  const selected = result.selectedByTable['tpl::long'].map(item => item.id);
  if (selected.includes('expired')) throw new Error('expired row selected');
  if (selected.includes('old')) throw new Error('superseded row selected');
  if (!selected.includes('current')) throw new Error('current replacement row missing');
  const inferredEval = MemoryTableLifecycle.evaluateRow(inferred.row, inferred.table);
  if (inferredEval.effectiveConfidence >= 80) throw new Error('decay did not reduce confidence');
  const directive = MemoryTableLifecycle.getPromptDirective(inferred.row, inferred.table);
  if (!directive.includes('模型推测') || !directive.includes('弱化措辞')) throw new Error('uncertain inferred directive missing');

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'memory_templates/当前默认记忆模板_V2.8.json'), 'utf8'));
  if (parseFloat(pkg.schemaVersion) < 2.5) throw new Error('schema version is below 2.5');
  const tpl = pkg.templates[0];
  const rows = [];
  tpl.tables.forEach(table => rows.push(...(pkg.binding.data[tpl.id][table.id].__rows || [])));
  if (rows.length !== 209) throw new Error(`row count changed: ${rows.length}`);
  if (rows.some(row => !row.meta?.evidence || !row.meta?.lifecycle || !row.meta?.relations || !Array.isArray(row.meta?.versionLog))) {
    throw new Error('V2.5 reliability metadata migration incomplete');
  }
  if (pkg.migration?.preservedOriginalRowCount !== 206 || pkg.migration?.v25?.migratedReliabilityMetadataCount !== 209) {
    throw new Error('migration counters incorrect');
  }
  console.log('V2.5 LIFECYCLE CHECKS: PASS');
})().catch(error => { console.error(error); process.exit(1); });
