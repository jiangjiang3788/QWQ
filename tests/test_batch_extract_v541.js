/* Run with: node tests/test_batch_extract_v541.js */
const fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.resolve(__dirname,'..');
const context={console,Date,Math,JSON,Promise,setTimeout,clearTimeout,confirm:()=>true,URL};
context.window=context;
context.location={href:'https://local.test/'};
context.document={readyState:'loading',addEventListener:()=>{},querySelectorAll:()=>[],getElementById:()=>null};
context.currentChatId='c';context.currentChatType='private';
context.db={characters:[],summaryApiSettings:{url:'https://sum.example/v1',key:'x',model:'sum-model',provider:'newapi'},apiSettings:{url:'https://main.example',key:'x',model:'main'}};
context.saveData=async()=>{};context.showToast=()=>{};
let apiCallCount=0;
context.fetchAiResponse=async(_config,body)=>{
  apiCallCount += 1;
  const prompt=body.messages?.[0]?.content || '';
  if(!prompt.includes('完整门牌')) throw new Error('full room plates missing in runtime prompt');
  if(!prompt.includes('完整私密印象')) throw new Error('full impression missing in runtime prompt');
  if(!prompt.includes('【本批新对话】')) throw new Error('conversation missing in runtime prompt');
  if(apiCallCount === 1) {
    return JSON.stringify([{title:'测试事件',factualSummary:'她告诉我昨晚没有睡好。',characterView:'我准备先确认身体状态。',viewConfidence:0.8,outcome:'',occurredAt:'2026-07-13',keywords:['睡眠'],aliases:['没睡好'],importance:6,mood:'anxious',valence:-0.2,arousal:0.3,sourceMessageIds:['m1','m2','m3','m4'],pinDays:0,eventBoxHint:'',eventBoxKeywords:[]}]);
  }
  return JSON.stringify([{title:'测试事件二',factualSummary:'她告诉我今天好一些，但仍有些困。',characterView:'我准备继续观察她的休息状态。',viewConfidence:0.7,outcome:'',occurredAt:'2026-07-13',keywords:['睡眠','恢复'],aliases:['有点困'],importance:5,mood:'neutral',valence:0.1,arousal:0.1,sourceMessageIds:['m5','m6','m7','m8'],pinDays:0,eventBoxHint:'',eventBoxKeywords:[]}]);
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'js/modules/unified_memory.js'),'utf8'),context);
const character={id:'c',realName:'阿沉',myName:'小海葵',persona:'冷静但温柔',myPersona:'敏感且有韧性',history:[
 {id:'m1',role:'user',content:'昨晚没睡好',timestamp:1},
 {id:'m2',role:'assistant',content:'哪里不舒服？',timestamp:2},
 {id:'m3',role:'user',content:'腰有点疼',timestamp:3},
 {id:'m4',role:'assistant',content:'我先陪你确认身体状态',timestamp:4}
],unifiedMemory:{
 roomPlates:[
  {id:'c:user_room',charId:'c',room:'user_room',entries:[{id:'p1',tag:'作息',text:'小海葵长期容易睡眠不足',sourceCount:3,firstLearnedAt:1,updatedAt:2}]},
  {id:'c:self_room',charId:'c',room:'self_room',entries:[]},
  {id:'c:bedroom',charId:'c',room:'bedroom',entries:[]},
  {id:'c:study',charId:'c',room:'study',entries:[]}
 ],
 impression:{version:3,lastUpdated:10,value_map:{likes:['短句'],dislikes:['说教'],core_values:'自主和安全'},behavior_profile:{tone_style:'敏感细致',emotion_summary:'近期疲惫',response_patterns:'压力大时先缩短表达'},emotion_schema:{triggers:{positive:['明确确认'],negative:['失联']},comfort_zone:'安静陪伴',stress_signals:['回复变短']},personality_core:{observed_traits:['敏感'],interaction_style:'会直接纠正',summary:'敏感且有韧性'},observed_changes:['更敢表达边界']},
 automation:{enabled:false,lastProcessedMessageId:null,lastProcessedMessageTimestamp:null},vector:{enabled:false}
}};
context.db.characters=[character];
(async()=>{
 if(context.UnifiedMemory.version!=='5.4.1') throw new Error('version mismatch');
 const safePrompt=context.UnifiedMemory.buildEventExtractionPrompt(character,character.history,undefined);
 if(!safePrompt.includes('完整门牌')) throw new Error('undefined selection fallback failed');
 const result=await context.UnifiedMemory.batchExtractMessages(character,{mode:'all',batchSize:4,maxBatches:1});
 if(result.status!=='completed') throw new Error('batch not completed');
 const state=context.UnifiedMemory.ensureState(character);
 if(state.events.length!==1) throw new Error('event not created');
 if(state.automation.lastProcessedMessageId!=='m4') throw new Error('cursor not advanced after success');
 character.history.push(
  {id:'m5',role:'user',content:'今天好多了',timestamp:5},
  {id:'m6',role:'assistant',content:'我记住了',timestamp:6},
  {id:'m7',role:'user',content:'还是有点困',timestamp:7},
  {id:'m8',role:'assistant',content:'先慢一点',timestamp:8}
 );
 const result2=await context.UnifiedMemory.batchExtractMessages(character,{mode:'unprocessed',batchSize:4,maxBatches:1});
 if(result2.status!=='completed') throw new Error('unprocessed batch not completed');
 if(state.events.length!==2) throw new Error('unprocessed event not created');
 if(state.automation.lastProcessedMessageId!=='m8') throw new Error('unprocessed cursor not advanced');
 console.log('BATCH EXTRACTION V5.4.1 REGRESSION: PASS');
})().catch(err=>{console.error(err);process.exit(1)});
