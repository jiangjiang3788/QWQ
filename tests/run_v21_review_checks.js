const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

global.window = global;
global.document = {};
global.matchMedia = () => ({ matches: true });

const root = path.resolve(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(root, 'js/features/memory/kernel.js'), 'utf8'), { filename: 'kernel.js' });
vm.runInThisContext(fs.readFileSync(path.join(root, 'js/modules/memory_table_policy.js'), 'utf8'), { filename: 'memory_table_policy.js' });
vm.runInThisContext(fs.readFileSync(path.join(root, 'js/modules/memory_table_review.js'), 'utf8'), { filename: 'memory_table_review.js' });

const chat = {
  history: Array.from({ length: 20 }, (_, i) => ({ id: `m${i + 1}`, timestamp: i + 1, role: i % 2 ? 'assistant' : 'user', content: `消息${i + 1}` })),
  memoryTables: {
    autoUpdateEnabled: true,
    engineSettings: { enabled: true, triggerMode: 'messages', messageInterval: 5, reviewMode: 'summary_only' },
    tableStates: {},
    data: { tpl: { table: { field: '旧值' } } }
  }
};

const policyTable = {
  id: 'table',
  name: '中期总结',
  memoryLayer: 'medium',
  updatePolicy: { enabled: true, triggerMode: 'messages', messageInterval: 5, maxSourceMessages: 10, useSummaryApi: true },
  injectionPolicy: { mode: 'relevant' }
};

const state = MemoryTablePolicy.ensureTableState(chat, 'tpl', 'table', { initializeAtLatest: false });
assert(MemoryTablePolicy.isTableDue(chat, 'tpl', policyTable) === true, 'table should be due before pending review');
state.pendingReviewBatchId = 'pending_1';
assert(MemoryTablePolicy.isTableDue(chat, 'tpl', policyTable) === false, 'pending review must suppress duplicate auto update');
state.pendingReviewBatchId = null;

const batch = MemoryTableReview.enqueueBatch(chat, {
  id: 'batch_1',
  templateId: 'tpl',
  tableId: 'table',
  templateName: '模板',
  tableName: '中期总结',
  range: { start: 1, end: 10 },
  apiMode: 'summary',
  sourceMessageCount: 10,
  proposals: [
    { id: 'p1', kind: 'field', label: '字段A', oldValue: '旧', newValue: '新', valid: true, risk: 'medium' },
    { id: 'p2', kind: 'row_delete', label: '删除行', oldValue: '旧行', newValue: '', valid: false, error: '禁止删除', risk: 'high' }
  ]
});
assert(batch.proposals.length === 2, 'proposal count mismatch');
assert(batch.proposals[0].decision === 'pending', 'valid proposal should start pending');
assert(batch.proposals[1].decision === 'blocked', 'invalid proposal should be blocked');
MemoryTableReview.setProposalDecision(chat, 'batch_1', 'p1', 'accepted');
assert(MemoryTableReview.getBatch(chat, 'batch_1').proposals[0].decision === 'accepted', 'proposal decision not saved');
MemoryTableReview.setProposalEditedValue(chat, 'batch_1', 'p1', '人工修订');
assert(MemoryTableReview.getBatch(chat, 'batch_1').proposals[0].editedValue === '人工修订', 'edited value not saved');
assert(MemoryTableReview.getPendingCount(chat) === 1, 'pending count mismatch');
const rendered = MemoryTableReview.renderReviewView(chat);
assert(rendered.includes('人工修订'), 'review UI should render edited value');
assert(rendered.includes('已阻止'), 'review UI should render blocked state');

const beforeSig = MemoryTableReview.dataSignature(chat.memoryTables.data);
const completed = MemoryTableReview.completeBatch(chat, 'batch_1', { status: 'applied', appliedCount: 1, afterSignature: beforeSig });
assert(completed.status === 'applied', 'batch completion failed');
assert(MemoryTableReview.getPendingCount(chat) === 0, 'pending queue should be empty');
assert(MemoryTableReview.getCompletedBatches(chat).length === 1, 'completed history missing');

assert(MemoryTableReview.shouldRequireReview({ reviewMode: 'summary_only' }, { preferSummaryApi: true, isAutoUpdate: true }) === true, 'summary-only review rule failed');
assert(MemoryTableReview.shouldRequireReview({ reviewMode: 'summary_only' }, { preferSummaryApi: false, isAutoUpdate: false }) === false, 'summary-only should not review fast manual updates');
assert(MemoryTableReview.shouldRequireReview({ reviewMode: 'manual_and_summary' }, { preferSummaryApi: false, isAutoUpdate: false }) === true, 'manual review rule failed');
assert(MemoryTableReview.shouldRequireReview({ reviewMode: 'all' }, { preferSummaryApi: false, isAutoUpdate: true }) === true, 'all review rule failed');

console.log('V2.1 REVIEW CHECKS: PASS');
