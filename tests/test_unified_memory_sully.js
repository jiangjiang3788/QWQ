/* Run with: node tests/test_unified_memory_sully.js */
const fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.resolve(__dirname,'..');
const context={console,Date,Math,JSON,Promise,setTimeout,clearTimeout,confirm:()=>true};
context.window=context;
context.document={readyState:'loading',addEventListener:()=>{},querySelectorAll:()=>[],getElementById:()=>null};
context.currentChatId='c';context.currentChatType='private';
context.db={characters:[],vectorApiSettings:{},summaryApiSettings:{},apiSettings:{}};
context.saveData=async()=>{};context.showToast=()=>{};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'js/modules/unified_memory.js'),'utf8'),context);
const character={id:'c',history:[],unifiedMemory:{
  roomPlates:[
    {id:'c:user_room',charId:'c',room:'user_room',version:2,updatedAt:1,entries:[{id:'p1',tag:'作息',text:'用户长期熬夜硬撑',sourceCount:25,firstLearnedAt:1,updatedAt:2}]},
    {id:'c:self_room',charId:'c',room:'self_room',version:1,updatedAt:1,entries:[]},
    {id:'c:bedroom',charId:'c',room:'bedroom',version:1,updatedAt:1,entries:[{id:'p2',tag:'默契',text:'过载时更适合短句',sourceCount:7,firstLearnedAt:1,updatedAt:2}]},
    {id:'c:study',charId:'c',room:'study',version:1,updatedAt:1,entries:[]}
  ],
  impression:{version:3,lastUpdated:10,value_map:{likes:['短句'],dislikes:['说教'],core_values:'自主和安全'},behavior_profile:{tone_style:'敏感细致',emotion_summary:'近期疲惫',response_patterns:'压力大时先缩短表达'},emotion_schema:{triggers:{positive:['明确确认'],negative:['失联']},comfort_zone:'安静陪伴',stress_signals:['回复变短']},personality_core:{observed_traits:['敏感','有韧性'],interaction_style:'会直接纠正不合适回应',summary:'把敏感逐渐变成洞察力'},mbti_analysis:{type:'INFP',reasoning:'仅为互动侧写',dimensions:{e_i:30,s_n:65,t_f:75,j_p:40}},observed_changes:['更敢表达边界']},
  automation:{enabled:false}
}};
context.db.characters.push(character);
const state=context.UnifiedMemory.ensureState(character);
if(state.version!=='5.4.1') throw new Error('version mismatch');
if(!state.automation.impressionUpdateEnabled||state.automation.impressionEventThreshold!==20) throw new Error('impression auto defaults missing');
if(!Array.isArray(state.roomPlates)||state.roomPlates.length!==4) throw new Error('canonical roomPlates missing');
if(state.events.length!==0||state.eventBoxes.length!==0) throw new Error('events should remain OVO-owned');
const unrelated=context.UnifiedMemory.selectMemories(character,'完全无关的查询',{touch:false});
if(unrelated.doorplates.length!==0||unrelated.impression) throw new Error('keyword routing should not inject unrelated semantic archives');
const selected=context.UnifiedMemory.selectMemories(character,'昨晚熬夜，我想听短句，不要说教',{touch:false});
if(selected.doorplates.length!==2) throw new Error('room plate keyword routing failed');
if(!selected.impression||selected.impression.personality_core.summary!=='把敏感逐渐变成洞察力') throw new Error('structured impression keyword routing failed');
const block=context.UnifiedMemory.buildContextBlock(character,selected);
if(!block.includes('用户房间·作息')||!block.includes('卧室·默契')) throw new Error('room plate context failed');
if(!block.includes('角色私密印象档案')||!block.includes('核心印象：把敏感逐渐变成洞察力')) throw new Error('structured impression context failed');
console.log('UNIFIED MEMORY SULLY V5.4.1 TESTS: PASS');
