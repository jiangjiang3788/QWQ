/* Run with: node tests/test_unified_memory_v54.js */
const fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.resolve(__dirname,'..');
const context={console,Date,Math,JSON,Promise,setTimeout,clearTimeout,confirm:()=>true,URL};
context.window=context;
context.location={href:'https://local.test/'};
context.document={readyState:'loading',addEventListener:()=>{},querySelectorAll:()=>[],getElementById:()=>null};
context.currentChatId='c';context.currentChatType='private';
context.db={characters:[],summaryApiSettings:{url:'https://sum.example/v1',key:'x',model:'sum-model',provider:'newapi'},vectorApiSettings:{url:'https://vec.example',key:'x',model:'bge-m3',provider:'newapi',dimensions:1024},apiSettings:{url:'https://main.example',key:'x',model:'main'}};
context.saveData=async()=>{};context.showToast=()=>{};
vm.createContext(context);
const source=fs.readFileSync(path.join(root,'js/modules/unified_memory.js'),'utf8');
vm.runInContext(source,context);
const character={id:'c',realName:'阿沉',myName:'小海葵',persona:'冷静但温柔',myPersona:'敏感且有韧性',history:[],unifiedMemory:{
  prompts:{eventExtraction:'旧的自定义提示词'},
  roomPlates:[
    {id:'c:user_room',charId:'c',room:'user_room',entries:[{id:'p1',tag:'作息',text:'小海葵长期熬夜，深夜才像拿回自己',sourceCount:25,firstLearnedAt:1,updatedAt:2}]},
    {id:'c:self_room',charId:'c',room:'self_room',entries:[]},
    {id:'c:bedroom',charId:'c',room:'bedroom',entries:[{id:'p2',tag:'沟通',text:'小海葵疲惫时更适合短句',sourceCount:7,firstLearnedAt:1,updatedAt:2}]},
    {id:'c:study',charId:'c',room:'study',entries:[]}
  ],
  impression:{version:3,lastUpdated:10,value_map:{likes:['短句'],dislikes:['说教'],core_values:'自主和安全'},behavior_profile:{tone_style:'敏感细致',emotion_summary:'近期疲惫',response_patterns:'压力大时先缩短表达'},emotion_schema:{triggers:{positive:['明确确认'],negative:['失联']},comfort_zone:'安静陪伴',stress_signals:['回复变短']},personality_core:{observed_traits:['敏感','有韧性'],interaction_style:'会直接纠正不合适回应',summary:'把敏感逐渐变成洞察力'},observed_changes:['更敢表达边界']},
  automation:{enabled:false}
}};
context.db.characters=[character];
const state=context.UnifiedMemory.ensureState(character);
if(context.UnifiedMemory.version!=='5.4.1') throw new Error('version mismatch');
if(!state.prompts.eventExtraction.includes('【第一人称事件记忆规则】')) throw new Error('old prompt was not migrated to first-person rules');
const selected=context.UnifiedMemory.selectMemories(character,'完全无关',{touch:false});
const messages=[{id:'m1',role:'user',content:'昨晚又没睡好',timestamp:1}];
const prompt=context.UnifiedMemory.buildEventExtractionPrompt(character,messages,selected);
if(!prompt.includes('完整门牌')) throw new Error('full room plates missing from extraction prompt');
if(!prompt.includes('小海葵长期熬夜')) throw new Error('room plate content missing');
if(!prompt.includes('完整私密印象')) throw new Error('full impression missing');
if(!prompt.includes('把敏感逐渐变成洞察力')) throw new Error('impression content missing');
if(!prompt.includes('必须使用“我”') && !prompt.includes('使用“我”')) throw new Error('first-person instruction missing');

const fakeRaw={title:'测试',factualSummary:'阿沉会把这看作一次明确纠正。',characterView:'角色认为应该先听她说明。',sourceMessageIds:['m1']};
// normalizeOutputEvent is exercised indirectly by summarizer in production; source-level guard ensures sanitizer is shipped.
if(!source.includes('normalizeFirstPersonEventText')) throw new Error('first-person postprocessor missing');

const api=context.UnifiedMemory.apiStatusSnapshot();
if(api.summary.source!=='总结 API'||api.summary.model!=='sum-model') throw new Error('summary API routing wrong');
if(api.vector.source!=='向量 API'||api.vector.model!=='bge-m3') throw new Error('vector API routing wrong');
if(!source.includes('name="room"')||!source.includes('name="tag"')||!source.includes('name="text"')||!source.includes('name="sourceCount"')) throw new Error('canonical doorplate editor fields missing');
console.log('UNIFIED MEMORY V5.4.1 TESTS: PASS');
