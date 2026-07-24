const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');

global.window = global;
global.CustomEvent = function CustomEvent(type, init){ this.type=type; this.detail=init?.detail; };
global.dispatchEvent = () => true;
global.db = { vectorApiSettings: {}, characters: [], memoryTableTemplates: [] };
global.fetch = async () => { throw new Error('network should not be called in keyword quality checks'); };
global.saveCharacter = async () => true;

function load(rel) {
  vm.runInThisContext(fs.readFileSync(path.join(root, rel), 'utf8'), { filename: rel });
}
load('js/features/memory/kernel.js');
load('js/modules/memory_table_policy.js');
load('js/modules/memory_table_lifecycle.js');
load('js/modules/memory_table_effects.js');
load('js/modules/memory_table_feedback.js');
load('js/modules/memory_table_retrieval.js');
load('js/modules/memory_table_tasks.js');
load('js/modules/memory_table_quality.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const table = {
    id: 'table_long', name: '稳定长期特征库', mode: 'rows', memoryLayer: 'long',
    injectionPolicy: { mode:'relevant', topK:4, threshold:0.05, budget:1200 },
    columns: [{id:'content',key:'内容',type:'longtext',important:true}]
  };
  const template = { id:'tpl', name:'质量测试模板', tables:[table] };
  const now = Date.now();
  const makeRow = (id, text, topic, scene, effect='historical_context', status='active') => ({
    id, cells:{content:text}, meta:{
      tagBundle:{topic:[topic],scene:[scene],entity:[],effect},
      usePolicy:{injectionEnabled:true,paused:false,allowedScenes:[],blockedScenes:[],maxInfluence:'low',cooldownRounds:0,allowProactiveMention:false,mentionPolicy:'relevant_only'},
      lifecycle:{status,retentionMode:'permanent'}, relations:{conflictsWith:[]},
      evidence:{primarySource:'user_explicit',userEvidenceCount:1,userConfirmed:true},
      createdAt:now,updatedAt:now,lastMentionedAt:now,importance:70,confidence:90,pinned:false,
      feedback:{helpfulCount:0,irrelevantCount:0,outdatedCount:0,inaccurateCount:0,sceneBlockedCount:0,pauseCount:0,forgetCount:0,weight:0,snoozedUntilRoundIndex:-1,sceneNegative:{},lastType:'',lastAt:0,lastScene:'',lastRoundId:''}
    }
  });
  const rows = [
    makeRow('work1','用户在复杂项目中偏好先看整体结构','工作','任务执行','soft_preference'),
    makeRow('sleep1','用户近期多次提到睡眠不足与精力下降','睡眠','健康追踪','historical_context'),
    makeRow('sleep2','用户近期多次提到睡眠不足与精力下降','睡眠','健康追踪','historical_context'),
    makeRow('expired1','过期的健康状态不应进入召回','健康','健康追踪','temporary_state','expired')
  ];
  db.memoryTableTemplates = [template];
  const chat = {
    id:'chat1', memoryMode:'table', history:[],
    memoryTables:{
      boundTemplateIds:['tpl'], data:{tpl:{table_long:{__rows:rows}}}, lockedFields:{tpl:{}},
      engineSettings:{retrievalMode:'keyword',semanticWeight:0.55,tagWeight:0.35,embeddingCandidateLimit:16,sceneRoutingEnabled:true,sideEffectGuardEnabled:true},
      feedback:{settings:{},rounds:[],events:[],stats:{helpful:5,irrelevant:1,outdated:0,inaccurate:0}},
      taskQueue:{settings:{},tasks:[],history:[],stats:{estimatedInputTokens:1000,estimatedOutputTokens:300,estimatedCost:0}}
    }
  };
  const autoChat = JSON.parse(JSON.stringify(chat));
  autoChat.id = 'auto_chat';
  delete autoChat.memoryTables.quality;
  const autoState = MemoryTableQuality.ensureState(autoChat);
  assert(autoState.pendingAutoRun === true, 'version-change auto regression was not scheduled');
  const autoQueued = MemoryTableQuality.enqueuePendingAutoRun(autoChat);
  assert(autoQueued && autoQueued.task.type === 'quality_regression' && autoQueued.task.apiTask === false, 'auto regression should be a local no-API task');

  const quality = MemoryTableQuality.ensureState(chat);
  quality.testCases = [
    {id:'work',name:'工作',enabled:true,query:'继续处理复杂项目和代码结构',expectedTopics:['工作'],expectedScenes:['任务执行'],expectedEffects:[],expectedTableIds:[],expectedRowIds:[],forbiddenTopics:['睡眠'],forbiddenEffects:['candidate'],minimumExpectedHits:1,expectNoRows:false},
    {id:'sleep',name:'睡眠',enabled:true,query:'最近睡眠不足导致没有精神',expectedTopics:['睡眠'],expectedScenes:['健康追踪'],expectedEffects:[],expectedTableIds:[],expectedRowIds:[],forbiddenTopics:['工作'],forbiddenEffects:['candidate'],minimumExpectedHits:1,expectNoRows:false}
  ].map((x,i)=>MemoryTableQuality.updateTestCase ? x : x);
  // Normalize via reset assignment path.
  chat.memoryTables.quality.testCases = quality.testCases;
  MemoryTableQuality.ensureState(chat);
  const run1 = await MemoryTableQuality.runSuite(chat);
  assert(run1.results.length === 2, 'quality cases did not run');
  assert(run1.summary.unsafeLeakRate === 0, 'expired row leaked into retrieval');
  assert(run1.duplicate.pairCount >= 1, 'duplicate candidate scan missing');
  assert(chat.memoryTables.quality.baselineRunId === run1.id, 'first run was not saved as baseline');
  const run2 = await MemoryTableQuality.runSuite(chat);
  assert(run2.comparison && run2.comparison.pass, 'same configuration should not regress');
  assert(MemoryTableQuality.setBaseline(chat, run2.id), 'set baseline failed');
  assert(MemoryTableQuality.updateSettings(chat,{maximumAveragePromptChars:9999}).maximumAveragePromptChars===9999,'settings update failed');
  const added = MemoryTableQuality.addTestCase(chat);
  assert(added && MemoryTableQuality.removeTestCase(chat,added.id),'test case add/remove failed');
  const md = MemoryTableQuality.buildMarkdown(chat,run2);
  assert(md.includes('结构化记忆质量报告') && md.includes('预期命中率'),'markdown report missing metrics');

  const pkg = JSON.parse(fs.readFileSync(path.join(root,'memory_templates','当前默认记忆模板_V2.8.json'),'utf8'));
  assert(['2.8','3.2'].includes(pkg.schemaVersion),'package schema version');
  assert(pkg.binding.quality?.testCases?.length === 4,'quality test cases not exported');
  const tpl = pkg.templates[0];
  const allRows=[];
  tpl.tables.forEach(t=>allRows.push(...(pkg.binding.data[tpl.id][t.id].__rows||[])));
  assert(allRows.length===209,`row count changed: ${allRows.length}`);
  assert(pkg.migration?.v28?.preservedTotalRowCount===209,'v28 migration metadata missing');

  const bundledPkg = JSON.parse(fs.readFileSync(path.join(root,'memory_templates','当前默认记忆模板_V2.8.json'),'utf8'));
  assert(JSON.stringify(bundledPkg.binding.data)===JSON.stringify(pkg.binding.data),'bundled V2.8 data changed');
  assert(JSON.stringify(bundledPkg.binding.lockedFields)===JSON.stringify(pkg.binding.lockedFields),'bundled locked fields changed');

  console.log('V2.8 QUALITY CHECKS: PASS');
})().catch(error=>{console.error(error);process.exit(1);});
