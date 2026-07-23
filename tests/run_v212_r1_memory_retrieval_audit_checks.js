const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2'].includes(read('VERSION.txt').trim()));
const html = read('index.html');
const auditSource = read('js/features/memory/retrieval_audit.js');
const auditCss = read('css/modules/memory_retrieval_audit.css');
const workspaceSource = read('js/features/memory/workspace.js');
const controllerSource = read('js/modules/memory_table.js');
const queueSource = read('js/features/memory/governance_queue.js');

assert(html.includes('css/modules/memory_retrieval_audit.css'));
assert(html.includes('js/features/memory/retrieval_audit.js'));
assert(html.includes('data-tab="usage_audit"'));
assert(!html.includes('data-tab="retrieval"'));
assert(!html.includes('data-tab="feedback"'));
assert(html.includes('memory-usage-audit-tab-count'));
assert(workspaceSource.includes("['retrieval', 'feedback'].includes(view) ? 'usage_audit'"));
assert(workspaceSource.includes("['usage_audit', '记忆引用与作用'"));
assert(queueSource.includes("targetView: 'usage_audit'"));
assert(controllerSource.includes("['usage_audit', 'retrieval', 'feedback'].includes(view)"));
assert(!controllerSource.includes('MemoryFeedback.renderView(chat)'));
assert(!controllerSource.includes('MemoryRetrieval.renderDiagnostics(chat)'));
assert(controllerSource.split(/\r?\n/).length < 4310, 'main controller exceeded V2.12-R1 budget');
assert(auditCss.includes('.memory-audit-table-summary'));
assert(auditCss.includes('.memory-audit-table-detail'));
assert(auditCss.includes('@media(max-width:760px)'));
assert(auditCss.includes('content:attr(data-label)'));

const context = {
  window: null,
  console,
  Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object,
  setTimeout, clearTimeout,
  db: { memoryTableTemplates: [] }
};
context.window = context;
vm.createContext(context);
vm.runInContext(read('js/features/memory/kernel.js'), context);
const Kernel = context.OvoMemoryKernel;
Kernel.register('feedback', {
  ensureState(chat) { return chat.memoryTables.feedback; }
});
Kernel.register('policy', {
  ensureRuntimeState(chat) { return chat.memoryTables; }
});
vm.runInContext(auditSource, context);
const audit = Kernel.get('retrievalAudit');
assert(audit);
assert.strictEqual(audit.VERSION, '2.12-R1');

const chat = {
  id: 'chat-r1',
  memoryTables: {
    feedback: {
      settings: {
        irrelevantCooldownRounds: 8,
        helpfulBoost: 0.06,
        irrelevantPenalty: 0.15,
        pendingFeedbackTtlDays: 7,
        maxPendingFeedbackRounds: 3,
        maxRoundSnapshots: 60
      },
      rounds: [{
        id: 'round-1',
        createdAt: 1000,
        completedAt: 1100,
        requestStatus: 'completed',
        status: 'open',
        actualMode: 'keyword',
        finalChars: 420,
        queryText: '最近很累，晚上不想睡',
        queryContext: { topic: ['健康', '睡眠'], scene: ['健康追踪'], entity: ['用户'] },
        items: [
          {
            id: 'tpl::daily::r1', templateId: 'tpl', tableId: 'daily', rowId: 'r1', templateName: '档案模板', tableName: '日常观察',
            text: '日期: 2026-07-19\n身体状态: 身体紧张，无法放松。', score: 0.71, effectMode: 'temporary_state',
            directive: '仅作近期背景，不得推断为长期人格。', reasons: ['关键词命中', '主题：健康、睡眠', '场景：健康追踪', '近期记录'], feedback: 'pending'
          },
          {
            id: 'tpl::growth::r2', templateId: 'tpl', tableId: 'growth', rowId: 'r2', templateName: '档案模板', tableName: '中期总结与成长经验',
            text: '主题: 主动表达睡眠需要\n内容或摘要: 不再要求被哄到舒服才睡。', score: 0.82, effectMode: 'historical_context',
            directive: '仅在相关回顾中作为历史背景。', reasons: ['语义相似', '主题：睡眠、成长', '作用：历史背景'], feedback: 'helpful'
          },
          {
            id: 'tpl::growth::r3', templateId: 'tpl', tableId: 'growth', rowId: 'r3', templateName: '档案模板', tableName: '中期总结与成长经验',
            text: '主题: 在疲惫时先照顾身体', score: 0.66, effectMode: 'hard_boundary',
            directive: '相关场景下优先遵守。', reasons: ['标签命中', '场景：健康追踪', '用户标记有用 1 次'], feedback: 'pending'
          }
        ]
      }],
      events: [], stats: {}
    },
    lastRetrievalDiagnostic: { finalBlock: '<structured_memory>...</structured_memory>', finalChars: 420 }
  }
};

const model = audit.getViewModel(chat);
assert.strictEqual(model.items.length, 3);
assert.strictEqual(model.tables.length, 2);
assert.strictEqual(model.tables.find(item => item.tableName === '中期总结与成长经验').count, 2);
assert.strictEqual(model.pending, 2);
assert.strictEqual(model.helpful, 1);
assert(model.items[0].reason.labels.includes('关键词匹配'));
assert(model.items[1].reason.labels.includes('语义相似'));
assert.strictEqual(model.items[0].use.role, '当前状态');
assert.strictEqual(model.items[2].use.role, '关系边界');

const rendered = audit.render(chat);
assert(rendered.includes('引用表总览'));
assert(rendered.includes('引用记录明细'));
assert(rendered.includes('日常观察'));
assert(rendered.includes('中期总结与成长经验'));
assert(rendered.includes('为什么引用'));
assert(rendered.includes('本轮作用'));
assert(rendered.includes('data-feedback-action="helpful"'));
assert(rendered.includes('data-memory-audit-round'));
assert(rendered.includes('<table'));
assert(!rendered.includes('memory-feedback-item'));
assert(!rendered.includes('memory-retrieval-hit'));

console.log('V2.12-R1 MEMORY RETRIEVAL AUDIT CHECKS: PASS');
