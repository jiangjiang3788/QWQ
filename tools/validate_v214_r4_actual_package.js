const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const inputPath = path.resolve(process.argv[2] || '/mnt/data/阿沉_memory_package_逻辑收敛修正版.json');
const outputPath = path.resolve(process.argv[3] || path.join(root, 'docs/V2.14-R4_实际记忆包检索隔离验证.json'));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');

const originalBytes = fs.readFileSync(inputPath);
const originalHash = hash(originalBytes);
const pkg = JSON.parse(originalBytes.toString('utf8'));

const box = {
  console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object, Error, Promise,
  setTimeout, clearTimeout, queueMicrotask,
  window: null,
  document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
  CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init?.detail; },
  dispatchEvent() { return true; },
  addEventListener() {},
  db: { memoryTableTemplates: clone(pkg.templates || []), characters: [], vectorApiSettings: {} }
};
box.window = box;
vm.createContext(box);
for (const rel of [
  'js/features/memory/kernel.js',
  'js/modules/memory_table_policy.js',
  'js/modules/memory_table_lifecycle.js',
  'js/modules/memory_table_effects.js',
  'js/modules/memory_table_feedback.js',
  'js/features/memory/retrieval_maintenance.js',
  'js/modules/memory_table_retrieval.js'
]) vm.runInContext(read(rel), box, { filename: rel });

const Kernel = box.OvoMemoryKernel;
const Maintenance = Kernel.require('retrievalMaintenance');
const Retrieval = Kernel.require('retrieval');
const chat = { id: 'actual-package-validation', memoryMode: 'table', history: [], memoryTables: clone(pkg.binding || {}) };
chat.memoryTables.rounds ||= [];

function rowText(table, row) {
  return (table.columns || []).map(field => {
    const value = row?.cells?.[field.id];
    if (value === undefined || value === null || value === '') return '';
    return `${field.key}: ${Array.isArray(value) ? value.join('、') : String(value)}`;
  }).filter(Boolean).join('\n');
}

const groups = [];
let rowCount = 0;
(pkg.templates || []).forEach(template => {
  (template.tables || []).forEach(table => {
    const rows = pkg.binding?.data?.[template.id]?.[table.id]?.__rows || [];
    if (!rows.length) return;
    rowCount += rows.length;
    groups.push({
      key: `${template.id}::${table.id}`,
      templateName: template.name,
      tableName: table.name,
      policy: { ...(table.injectionPolicy || {}), mode: table.injectionPolicy?.mode || 'relevant', topK: Math.max(1, Number(table.injectionPolicy?.topK) || 5), threshold: 0 },
      items: rows.map(row => ({
        id: row.id,
        row,
        table,
        text: rowText(table, row),
        searchText: rowText(table, row),
        updatedAt: Number(row.meta?.updatedAt || row.meta?.createdAt) || 0,
        importance: Number(row.meta?.importance) || 50,
        confidence: Number(row.meta?.confidence) || 70,
        pinned: !!row.meta?.pinned,
        active: !['expired', 'archived', 'superseded'].includes(row.meta?.lifecycle?.status || row.meta?.status)
      }))
    });
  });
});

(async () => {
  if (rowCount !== 234) throw new Error(`实际包行数异常：${rowCount}`);
  const formalBefore = JSON.stringify(chat.memoryTables.data || {});
  const chatBefore = JSON.stringify(chat);

  box.OVOApiServiceRegistry = { isReady: () => false };
  const keyword = await Retrieval.prepareGroups(chat, groups, '记忆系统 工作边界 计划', {
    retrievalMode: 'keyword', semanticWeight: 0.55, tagWeight: 0.35,
    embeddingCandidateLimit: 32, sceneRoutingEnabled: true, sideEffectGuardEnabled: true
  });
  const afterKeyword = JSON.stringify(chat.memoryTables.data || {});
  const wholeChatUnchangedAfterKeyword = JSON.stringify(chat) === chatBefore;
  if (afterKeyword !== formalBefore) throw new Error('关键词召回修改了正式档案');
  if (!wholeChatUnchangedAfterKeyword) throw new Error('纯召回修改了聊天记忆状态');
  if (keyword.diagnostic?.pureRead !== true) throw new Error('召回未声明 pureRead');

  let embeddingCalls = 0;
  box.OVOApiServiceRegistry = {
    isReady(kind) { return kind === 'vector'; },
    async embed(texts) {
      embeddingCalls += 1;
      return texts.map(text => {
        const value = String(text || '');
        let a = 0, b = 0, c = 0;
        for (let i = 0; i < value.length; i += 1) {
          a = (a + value.charCodeAt(i)) % 997;
          b = (b + value.charCodeAt(i) * (i + 1)) % 991;
          c = (c + (value.charCodeAt(i) % 31)) % 983;
        }
        return [a / 997, b / 991, c / 983, Math.min(1, value.length / 1000)];
      });
    }
  };

  const plan = await Maintenance.buildIndexPlan(groups, { indexSnapshot: {} });
  if (!plan.ok || plan.indexed !== rowCount || plan.missing !== 0) throw new Error(`索引计划不完整：${plan.indexed}/${rowCount}`);
  const applied = Maintenance.applyIndexPlan(chat, plan);
  const afterIndex = JSON.stringify(chat.memoryTables.data || {});
  if (afterIndex !== formalBefore) throw new Error('索引维护修改了正式档案');
  if (applied.count !== rowCount) throw new Error(`运行态索引数量异常：${applied.count}`);

  const hybrid = await Retrieval.prepareGroups(chat, groups, '记忆系统 工作边界 计划', {
    retrievalMode: 'hybrid', semanticWeight: 0.55, tagWeight: 0.35,
    embeddingCandidateLimit: 32, sceneRoutingEnabled: true, sideEffectGuardEnabled: true
  }, {
    indexSnapshot: Maintenance.getIndexSnapshot(chat),
    usageSnapshot: Maintenance.getUsageSnapshot(chat)
  });
  if (hybrid.diagnostic?.actualMode !== 'hybrid') throw new Error(`混合召回未启用：${hybrid.diagnostic?.actualMode}`);
  if (JSON.stringify(chat.memoryTables.data || {}) !== formalBefore) throw new Error('混合召回修改了正式档案');

  const selected = Object.values(hybrid.selectedByTable || {}).flat();
  const diagnosticSelected = (hybrid.diagnostic?.tables || []).flatMap(group => group.selected || []);
  const finalBlock = diagnosticSelected.slice(0, 3).map(item => item.text || '').filter(Boolean).join('\n');
  hybrid.diagnostic.finalBlock = finalBlock;
  const usage = Maintenance.recordUsage(chat, hybrid.diagnostic, finalBlock, { roundId: 'validation-round', roundIndex: 1 });
  if (JSON.stringify(chat.memoryTables.data || {}) !== formalBefore) throw new Error('使用统计修改了正式档案');

  const result = {
    version: '2.14-R4',
    input: path.basename(inputPath),
    templateCount: (pkg.templates || []).length,
    tableCount: (pkg.templates || []).reduce((sum, template) => sum + (template.tables || []).length, 0),
    rowCount,
    retrievalGroupCount: groups.length,
    keywordRetrieval: {
      pureRead: keyword.diagnostic?.pureRead === true,
      selectedCount: Object.values(keyword.selectedByTable || {}).flat().length,
      formalDataUnchanged: afterKeyword === formalBefore,
      wholeChatUnchanged: wholeChatUnchangedAfterKeyword
    },
    indexMaintenance: {
      indexed: plan.indexed,
      reused: plan.reused,
      migratedFromLegacyMeta: plan.migrated,
      createdByMaintenanceApi: plan.created,
      missing: plan.missing,
      runtimeIndexCount: Object.keys(Maintenance.getIndexSnapshot(chat)).length,
      embeddingCalls,
      formalDataUnchanged: afterIndex === formalBefore
    },
    hybridRetrieval: {
      actualMode: hybrid.diagnostic?.actualMode,
      indexCoverage: hybrid.diagnostic?.indexCoverage,
      selectedCount: selected.length,
      formalDataUnchanged: JSON.stringify(chat.memoryTables.data || {}) === formalBefore
    },
    runtimeUsage: {
      changed: usage.changed,
      retrieved: usage.retrieved,
      injected: usage.injected,
      trackedRows: Object.keys(Maintenance.getUsageSnapshot(chat)).length,
      formalDataUnchanged: JSON.stringify(chat.memoryTables.data || {}) === formalBefore
    },
    formalDataHashBefore: hash(formalBefore),
    formalDataHashAfter: hash(JSON.stringify(chat.memoryTables.data || {})),
    sourcePackageUnchanged: hash(fs.readFileSync(inputPath)) === originalHash
  };

  if (result.formalDataHashBefore !== result.formalDataHashAfter) throw new Error('正式数据哈希发生变化');
  if (!result.sourcePackageUnchanged) throw new Error('源记忆包被修改');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch(error => {
  console.error(error);
  process.exit(1);
});
