const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
assert(['2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6'].includes(read('VERSION.txt').trim()));
const reviewCode = read('js/modules/memory_table_review.js');
const memoryCode = (read('js/modules/memory_table.js') + '\n' + read('js/features/memory/review_orchestrator.js'));
const reviewCss = read('css/modules/memory_table_v2.css');

global.window = global;
global.document = {};
global.matchMedia = () => ({ matches: true });
vm.runInThisContext(read('js/features/memory/kernel.js'), { filename: 'kernel.js' });
vm.runInThisContext(read('js/features/memory/write_coordinator.js'), { filename: 'write_coordinator.js' });
vm.runInThisContext(reviewCode, { filename: 'memory_table_review.js' });

const chat = { memoryTables: {} };
const batch = MemoryTableReview.enqueueBatch(chat, {
  id: 'batch-r54', templateId: 'tpl', tableId: 'table-a', templateName: '模板', tableName: '近期经历',
  range: { start: 4, end: 20 }, proposals: [
    { id: 'p1', kind: 'row_update_field', templateId: 'tpl', tableId: 'table-a', tableName: '近期经历', rowId: 'row-a', fieldId: 'title', label: '标题', oldValue: '旧标题', newValue: '新标题', valid: true },
    { id: 'p2', kind: 'row_update_field', templateId: 'tpl', tableId: 'table-a', tableName: '近期经历', rowId: 'row-a', fieldId: 'content', label: '内容', oldValue: '旧内容', newValue: '新内容', valid: true },
    { id: 'p3', kind: 'row_add', templateId: 'tpl', tableId: 'table-a', tableName: '近期经历', label: '新增记录', fieldValues: { title: '新增', content: '正文' }, newValue: { 标题: '新增', 内容: '正文' }, valid: true }
  ]
});
const summary = MemoryTableReview.getBatchChangeSummary(batch);
assert.strictEqual(summary.recordCount, 2, 'same row fields must be grouped into one memory record');
assert.strictEqual(summary.fieldCount, 4, 'field count should remain visible inside record grouping');
const firstRecord = MemoryTableReview.groupProposalsByRecord(batch)[0];
assert(MemoryTableReview.setRecordDecision(chat, batch.id, firstRecord.key, 'accepted'));
assert(batch.proposals.slice(0, 2).every(item => item.decision === 'accepted'), 'record action must update all fields in the record');
assert.strictEqual(batch.proposals[2].decision, 'pending', 'record action must not spill into another record');
const html = MemoryTableReview.renderReviewView(chat);
assert(html.includes('2 条记忆 · 4 个字段'), 'batch header must count records and fields separately');
assert(html.includes('接受整条') && html.includes('拒绝整条') && html.includes('逐字段调整'), 'record-level review controls are missing');
assert(html.includes('拒绝并跳过这段消息'), 'skip semantics are not explicit');
assert(html.includes('取消本次整理，保留处理范围'), 'cancel semantics are not explicit');
assert(!html.includes('row=row-a'), 'internal row ids must not leak into review UI');

assert(memoryCode.includes('function buildMemoryReviewBatches'), 'multi-table output is not split into single-table batches');
assert(memoryCode.includes('const key = `${proposal.templateId}::${proposal.tableId}`'), 'review proposals are not grouped by target table');
assert(memoryCode.includes("['review', 'candidate', 'promotion'].includes(tableMode)"), 'per-table write policy is not controlling review');
assert(memoryCode.includes("!== 'manual_only'"), 'manual-only tables must reject model writes');
assert(memoryCode.includes('function persistReviewMutationAtomically'), 'atomic review persistence helper is missing');
assert(memoryCode.includes("status: 'cancelled_preserved'"), 'cancelled range preservation state is missing');
assert(memoryCode.includes("'rejected_skipped'"), 'reject-and-skip state is missing');
assert(reviewCode.includes("data-action=\"review-record-accept\"") && memoryCode.includes("action === 'review-record-accept'"), 'record-level controller action is missing');
assert(reviewCss.includes('.memory-review-record-head'), 'record-group review CSS is missing');

function extractFunction(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert(start >= 0, `${name} not found`);
  const signatureEnd = source.indexOf(') {', start);
  const brace = signatureEnd + 2;
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

const atomicSource = extractFunction(memoryCode, 'persistReviewMutationAtomically');
const sandbox = {
  console,
  deepClone: value => JSON.parse(JSON.stringify(value)),
  saveCharacter: async () => {},
  MemoryWriteCoordinator: OvoMemoryKernel.require('writeCoordinator'),
  Error
};
vm.createContext(sandbox);
vm.runInContext(`${atomicSource}; this.atomic = persistReviewMutationAtomically;`, sandbox);

(async () => {
  const rollbackChat = { id: 'c1', memoryTables: { data: { before: true }, reviewState: { pendingBatches: [{ id: 'b' }] } } };
  await assert.rejects(() => sandbox.atomic(rollbackChat, async () => {
    rollbackChat.memoryTables.data = { after: true };
    rollbackChat.memoryTables.reviewState.pendingBatches = [];
    return { changed: true };
  }, { persist: async () => { throw new Error('模拟保存失败'); }, persistRollback: false }), /模拟保存失败/);
  assert.deepStrictEqual(rollbackChat.memoryTables.data, { before: true }, 'failed persistence must restore archive data');
  assert.strictEqual(rollbackChat.memoryTables.reviewState.pendingBatches.length, 1, 'failed persistence must restore review queue');

  const successChat = { id: 'c2', memoryTables: { data: { before: true } } };
  const success = await sandbox.atomic(successChat, async () => {
    successChat.memoryTables.data = { after: true };
    return { changed: true };
  }, { persist: async () => {}, persistRollback: false });
  assert.strictEqual(success.changed, true);
  assert.deepStrictEqual(successChat.memoryTables.data, { after: true });

  console.log('V2.13-R5.4 REVIEW TRANSACTION CLOSURE CHECKS: PASS');
})().catch(error => { console.error(error); process.exit(1); });
