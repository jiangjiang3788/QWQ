const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'memory_templates/当前默认记忆模板_V2.8.json'), 'utf8'));

global.window = global;
global.db = { memoryTableTemplates: pkg.templates, characters: [] };
global.document = { getElementById: () => null, addEventListener: () => {} };
global.currentChatId = 'chat1';
global.currentChatType = 'private';
global.saveCharacter = async () => {};
global.renderMemoryTableScreen = () => {};
global.MemoryTablePolicy = { clearRetrievalCache: () => {} };
global.confirm = () => true;
global.addEventListener = () => {};

vm.runInThisContext(fs.readFileSync(path.join(root, 'js/features/memory/kernel.js'), 'utf8'), { filename: 'kernel.js' });
vm.runInThisContext(fs.readFileSync(path.join(root, 'js/features/memory/write_coordinator.js'), 'utf8'), { filename: 'write_coordinator.js' });
vm.runInThisContext(fs.readFileSync(path.join(root, 'js/modules/memory_table_sidecar.js'), 'utf8'), { filename: 'memory_table_sidecar.js' });

(async () => {
  const chat = {
    id: 'chat1', memoryMode: 'table', history: [],
    memoryTables: {
      boundTemplateIds: [pkg.templates[0].id],
      data: JSON.parse(JSON.stringify(pkg.binding.data)),
      lockedFields: JSON.parse(JSON.stringify(pkg.binding.lockedFields))
    }
  };
  db.characters.push(chat);
  const extracted = MemoryTableSidecar.extractSidecar('可见消息\n<memory_sidecar>{"version":1,"status":{"fields":{"user_精神状态":"专注中","user_精力":72},"validDays":4,"confidence":90,"source":"user_explicit"},"taskOps":[{"op":"add","fields":{"标题":"完成V2.3测试","内容":"验证聊天同请求更新","当前状态":"待办"},"confidence":100,"source":"user_explicit"}],"candidates":[{"type":"experience","summary":"用户正在测试V2.3记忆系统","tags":{"topic":["记忆系统"],"scene":["任务执行"],"entity":["V2.3"],"effect":"historical_context"},"confidence":95,"source":"user_explicit"}]}</memory_sidecar>');
  if (extracted.cleaned !== '可见消息') throw new Error('visible content not preserved');
  if (!extracted.payload) throw new Error('sidecar not parsed');
  const report = await MemoryTableSidecar.applySidecar(chat, extracted.payload, { roundId: 'round_1' });
  if (!report.changed.length) throw new Error('sidecar produced no changes');
  const tplId = pkg.templates[0].id;
  const state = chat.memoryTables.data[tplId].table_current_state;
  if (state.memory_field_state_user_f3a9a8be80 !== '专注中') throw new Error('status enum not applied');
  if (state.memory_field_state_user_ba99dec5a9 !== 72) throw new Error('status progress not applied');
  const tasks = chat.memoryTables.data[tplId].table_tasks.__rows;
  const added = tasks.find(row => row.cells.memory_field_task_748d7dc7e3 === '完成V2.3测试');
  if (!added) throw new Error('task add not applied');
  if (chat.memoryTables.sidecar.candidates.length !== 1) throw new Error('candidate not saved');
  await MemoryTableSidecar.applySidecar(chat, { version:1, status:{fields:{}}, taskOps:[{op:'complete', rowId:added.id, result:'通过'}], candidates:[] }, { roundId:'round_2' });
  if (added.cells.memory_field_task_045859e792 !== '已完成') throw new Error('task complete not applied');
  MemoryTableSidecar.migratePolicies(chat);
  const stateTable = pkg.templates[0].tables.find(t => t.id === 'table_current_state');
  if (stateTable.updatePolicy.enabled !== false || stateTable.injectionPolicy.mode !== 'never') throw new Error('live table policy migration failed');
  const prompt = MemoryTableSidecar.buildSystemPrompt(chat);
  if (!prompt.includes('<memory_sidecar>') || !prompt.includes('活跃待办')) throw new Error('sidecar prompt missing');
  chat.memoryMode = 'vector';
  const layeredPrompt = MemoryTableSidecar.buildSystemPrompt(chat);
  if (!layeredPrompt.includes('<memory_sidecar>')) throw new Error('sidecar was incorrectly disabled by vector supplemental mode');
  console.log('V2.3 SIDECAR CHECKS: PASS');
})().catch(error => { console.error(error); process.exit(1); });
