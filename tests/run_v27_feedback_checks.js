const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');

global.window = global;
global.CustomEvent = function CustomEvent(type, init){ this.type=type; this.detail=init?.detail; };
global.dispatchEvent = () => true;
global.db = { vectorApiSettings: {}, characters: [], memoryTableTemplates: [] };
global.fetch = async () => { throw new Error('network should not be called'); };

function load(rel) {
  vm.runInThisContext(fs.readFileSync(path.join(root, rel), 'utf8'), { filename: rel });
}
load('js/features/memory/kernel.js');
load('js/modules/memory_table_policy.js');
load('js/modules/memory_table_lifecycle.js');
load('js/modules/memory_table_effects.js');
load('js/modules/memory_table_feedback.js');
load('js/modules/memory_table_retrieval.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const table = { id: 'table_long', name: '稳定长期特征库', memoryLayer: 'long', columns: [{id:'f1',key:'内容',type:'longtext',important:true}] };
  const template = { id: 'tpl', name: '测试模板', tables: [table] };
  db.memoryTableTemplates = [template];
  const row = { id: 'row1', cells: { f1: '用户在复杂任务中偏好先看整体结构' }, meta: {
    tagBundle: { topic: ['工作'], scene: ['任务执行'], entity: ['记忆系统'], effect: 'soft_preference' },
    usePolicy: { injectionEnabled:true, paused:false, allowedScenes:[], blockedScenes:[], maxInfluence:'low', cooldownRounds:0, allowProactiveMention:false, mentionPolicy:'relevant_only' },
    lifecycle: { status:'active', retentionMode:'permanent' },
    evidence: { primarySource:'user_explicit', userEvidenceCount:1, userConfirmed:true },
    createdAt: Date.now(), updatedAt: Date.now(), lastMentionedAt: Date.now(), importance:70, confidence:90, pinned:false
  }};
  const chat = { id:'chat1', memoryMode:'table', memoryTables: { boundTemplateIds:['tpl'], data:{tpl:{table_long:{__rows:[row]}}}, rounds:[], activeRound:{id:'round_current'} }, history:[] };
  const item = { id:'row1', row, table, searchText:'内容: 用户在复杂任务中偏好先看整体结构', text:'内容: 用户在复杂任务中偏好先看整体结构', updatedAt:Date.now(), importance:70, active:true };

  const initial = await MemoryTableRetrieval.prepareGroups(chat, [{key:'tpl::table_long',templateName:'测试模板',tableName:'稳定长期特征库',policy:{mode:'relevant',topK:3,threshold:0},items:[item]}], '继续设计记忆系统的工作计划', {retrievalMode:'keyword',semanticWeight:0.55,tagWeight:0.35,embeddingCandidateLimit:16,sceneRoutingEnabled:true,sideEffectGuardEnabled:true});
  assert(initial.selectedByTable['tpl::table_long'].length === 1, 'initial row should be selected');
  initial.diagnostic.finalBlock = '【稳定长期特征库】\n- 内容: 用户在复杂任务中偏好先看整体结构';
  initial.diagnostic.finalChars = initial.diagnostic.finalBlock.length;
  const snapshot = MemoryTableFeedback.captureInjection(chat, initial.diagnostic, {queryText:'继续设计记忆系统的工作计划', roundId:'round_current', finalBlock:initial.diagnostic.finalBlock});
  assert(snapshot && snapshot.items.length === 1 && snapshot.requestStatus === 'prepared', 'snapshot capture failed');
  MemoryTableFeedback.finalizeRound(chat, 'round_current');
  assert(snapshot.requestStatus === 'completed', 'snapshot was not finalized');
  assert(MemoryTableFeedback.getPendingCount(chat) === 1, 'pending feedback count');

  const failedDiagnostic = JSON.parse(JSON.stringify(initial.diagnostic));
  const failedSnapshot = MemoryTableFeedback.captureInjection(chat, failedDiagnostic, {queryText:'失败请求测试', roundId:'round_failed', finalBlock:failedDiagnostic.finalBlock});
  assert(failedSnapshot && failedSnapshot.requestStatus === 'prepared', 'failed-round prepared snapshot missing');
  assert(MemoryTableFeedback.discardRound(chat, 'round_failed') === 1, 'failed-round snapshot was not discarded');
  assert(!MemoryTableFeedback.ensureState(chat).rounds.some(item => item.roundId === 'round_failed'), 'discarded failed round still exists');

  const omittedSnapshot = MemoryTableFeedback.captureInjection(chat, initial.diagnostic, {queryText:'裁剪测试', roundId:'round_omitted', finalBlock:'【稳定长期特征库】\n- 另一条内容'});
  assert(!omittedSnapshot, 'memory omitted by final prompt budget should not enter feedback snapshot');

  const helpful = MemoryTableFeedback.applyAction(chat, snapshot.id, snapshot.items[0].id, 'helpful');
  assert(helpful.changed, 'helpful action failed');
  assert(row.meta.feedback.helpfulCount === 1 && row.meta.feedback.weight > 0, 'helpful weight not increased');
  const boosted = MemoryTableFeedback.evaluateItem(chat, item, {scene:['任务执行'],topic:['工作'],entity:['记忆系统']});
  assert(boosted.adjustment > 0, 'helpful feedback not reflected in score');

  const resetHelpful = MemoryTableFeedback.applyAction(chat, snapshot.id, snapshot.items[0].id, 'reset_item');
  assert(resetHelpful.changed && row.meta.feedback.helpfulCount === 0, 'reset helpful failed');

  const irrelevant = MemoryTableFeedback.applyAction(chat, snapshot.id, snapshot.items[0].id, 'irrelevant');
  assert(irrelevant.changed, 'irrelevant action failed');
  assert(row.meta.feedback.irrelevantCount === 1, 'irrelevant count missing');
  const cooled = MemoryTableFeedback.evaluateItem(chat, item, {scene:['任务执行'],topic:['工作'],entity:['记忆系统']});
  assert(!cooled.allowed && cooled.blockedReasons.some(x => x.includes('冷却')), 'irrelevant cooldown not enforced');

  const undo = MemoryTableFeedback.undoLast(chat);
  assert(undo.changed, 'undo failed');
  assert(row.meta.feedback.irrelevantCount === 0, 'undo did not restore feedback metadata');

  const blocked = MemoryTableFeedback.applyAction(chat, snapshot.id, snapshot.items[0].id, 'block_scene');
  assert(blocked.changed && row.meta.usePolicy.blockedScenes.includes('计划制定') || row.meta.usePolicy.blockedScenes.includes('任务执行'), 'scene block failed');

  const resetBlocked = MemoryTableFeedback.applyAction(chat, snapshot.id, snapshot.items[0].id, 'reset_item');
  assert(resetBlocked.changed, 'reset scene block failed');

  const outdated = MemoryTableFeedback.applyAction(chat, snapshot.id, snapshot.items[0].id, 'outdated');
  assert(outdated.changed && row.meta.lifecycle.status === 'expired' && row.meta.usePolicy.injectionEnabled === false, 'outdated action failed');

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'memory_templates/当前默认记忆模板_V2.8.json'), 'utf8'));
  assert(parseFloat(pkg.schemaVersion) >= 2.7, 'schema version is below 2.7');
  const tpl = pkg.templates[0];
  const rows = [];
  tpl.tables.forEach(t => rows.push(...(pkg.binding.data[tpl.id][t.id].__rows || [])));
  assert(rows.length === 209, `row count changed: ${rows.length}`);
  assert(rows.every(r => r.meta && r.meta.feedback), 'feedback metadata migration incomplete');
  assert(pkg.binding.feedback?.settings?.irrelevantCooldownRounds === 8, 'feedback settings missing');
  assert(pkg.migration?.v27?.migratedFeedbackMetadataCount === 209, 'v27 migration count incorrect');

  console.log('V2.7 FEEDBACK CHECKS: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
