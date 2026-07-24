const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.11-R1', '2.11-R2', '2.11-R3.1', '2.11-R4', '2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2', '2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6'].includes(read('VERSION.txt').trim()));
const html = read('index.html');
const controller = read('js/modules/memory_table.js');
const reviewUseCase = read('js/features/memory/review_orchestrator.js');
assert(html.includes('js/features/memory/tag_vocabulary.js'));
assert(html.includes('js/features/memory/tag_service.js'));
assert(html.includes('js/features/memory/context_assembler.js'));
assert(html.includes('js/features/memory/update_service.js'));
assert(html.indexOf('tag_vocabulary.js') < html.indexOf('tag_service.js'));
assert(html.indexOf('tag_service.js') < html.indexOf('context_assembler.js'));
assert(html.indexOf('context_assembler.js') < html.indexOf('update_service.js'));
assert(html.indexOf('update_service.js') < html.indexOf('memory_table.js'));
assert(controller.includes("Kernel.require('memoryUpdateDomain')"));
assert(!controller.includes("Kernel.require('tagService')"));
assert(!controller.includes("Kernel.require('contextAssembler')"));
assert(!controller.includes("Kernel.require('updateService')"));
assert(reviewUseCase.includes('MemoryTagService.parseRowNode'));
assert(controller.includes('relatedContextSummary'));
assert(controller.includes("type: 'structured_archive_memory'"));
assert(controller.includes('相关记忆表'));
assert(controller.split(/\r?\n/).length < 4520, 'memory_table.js did not shrink after extracting update services');

const context = { window: {}, console, Date, JSON, Math, Set, Map };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(read('js/features/memory/kernel.js'), context);
const Kernel = context.window.OvoMemoryKernel;

const data = {
    templates: [],
    rows: new Map(),
    values: new Map()
};
const key = (templateId, tableId) => `${templateId}::${tableId}`;
Kernel.register('policy', {
    normalizeTablePolicy(table) { return { memoryLayer: table.memoryLayer || 'long', updatePolicy: table.updatePolicy || {}, injectionPolicy: table.injectionPolicy || {} }; },
    parseDateLike(value) { const ts = Date.parse(String(value || '')); return Number.isFinite(ts) ? ts : 0; },
    isCompletedText(text) { return /完成|取消|过期/.test(String(text || '')); },
    selectRelevantItems(items, query, policy) { return items.map((item, index) => ({ ...item, _score: index === 0 ? 0.9 : 0.4 })).slice(0, policy.topK || 4); },
    buildQueryText() { return '睡眠 主动求助 身体恢复'; },
    ensureRuntimeState(chat) { chat.runtime ||= { engineSettings: { maxSourceMessages: 60 } }; return chat.runtime; }
});
Kernel.register('domain', {
    getBoundTemplates() { return data.templates; },
    isRowsTable(table) { return table.mode === 'rows'; },
    getRows(chat, templateId, table) { return data.rows.get(key(templateId, table.id)) || []; },
    getRowSearchText(table, row) { return Object.values(row.cells || {}).join(' '); },
    getFieldDisplayValue(field, value) { return Array.isArray(value) ? value.join('、') : String(value ?? ''); },
    isEmptyMemoryValue(field, value) { return value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length); },
    getFieldValue(chat, templateId, tableId, field) { return data.values.get(`${templateId}::${tableId}::${field.id}`); },
    isFieldLocked() { return false; }
});

vm.runInContext(read('js/features/memory/tag_vocabulary.js'), context);
vm.runInContext(read('js/features/memory/tag_service.js'), context);
vm.runInContext(read('js/features/memory/context_assembler.js'), context);
vm.runInContext(read('js/features/memory/update_service.js'), context);

const tagService = Kernel.get('tagService');
assert(['2.11-R1', '2.11-R2', '2.11-R3.1', '2.11-R4', '2.11-R5', '2.11-R6', '2.11-R7', '2.12-R0', '2.12-R1', '2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2', '2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6'].includes(tagService.VERSION));
const fakeTagNode = {
    getAttribute(name) { return { topic: '睡眠,主动求助', scene: '睡前交流', entity: '用户,阿沉', effect: 'soft_preference' }[name] || ''; }
};
const fakeRowNode = { children: [{ tagName: 'tags', ...fakeTagNode }] };
const parsed = tagService.parseRowNode(fakeRowNode);
assert.deepStrictEqual(JSON.parse(JSON.stringify(parsed)), {
    topic: ['睡眠', '主动求助'], scene: ['睡前交流'], entity: ['用户', '阿沉'], effect: 'soft_preference'
});
const row = { id: 'row_1', cells: {}, meta: {} };
const applied = tagService.applyToRow(row, parsed, { source: 'test' });
assert(applied.changed);
assert.strictEqual(row.meta.tagBundle.effect, 'soft_preference');
assert.strictEqual(row.meta.tagSource, 'test');
assert(tagService.buildPromptInstructions().includes('<tags'));

const fields = [{ id: 'title', key: '主题', type: 'text', important: true }, { id: 'content', key: '内容', type: 'longtext', important: true }];
const target = { id: 'medium', name: '中期总结与成长经验', mode: 'rows', memoryLayer: 'medium', columns: fields, updatePolicy: { enabled: true, allowAdd: true, allowUpdate: true } };
const event = { id: 'event', name: '近期经历、想法与重要事件', mode: 'rows', memoryLayer: 'short', columns: fields };
const current = { id: 'current', name: '当前状态（3—7天）', mode: 'keyValue', memoryLayer: 'short', columns: fields };
const long = { id: 'long', name: '稳定长期特征库', mode: 'rows', memoryLayer: 'long', columns: fields };
const tpl = { id: 'tpl', name: '真实模板', tables: [target, event, current, long] };
data.templates = [tpl];
data.rows.set(key('tpl', 'target'), []);
data.rows.set(key('tpl', 'event'), [{ id: 'event_1', cells: { title: '睡眠恢复', content: '用户主动表达需要休息' }, meta: { updatedAt: Date.now() } }]);
data.rows.set(key('tpl', 'long'), [{ id: 'long_1', cells: { title: '主动求助', content: '用户更愿意主动表达身体需求' }, meta: { updatedAt: Date.now(), tagBundle: parsed } }]);
data.values.set('tpl::current::title', '身体恢复期');
data.values.set('tpl::current::content', '最近需要保证睡眠');

const chat = { id: 'char', realName: '阿沉', myName: '用户', history: [{ role: 'user', content: '我今晚想早点睡', timestamp: Date.now() }] };
const assembler = Kernel.get('contextAssembler');
const assembled = assembler.assemble({ chat, template: tpl, table: target, queryText: '睡眠 主动求助', budget: 6000 });
assert.strictEqual(assembler.inferRole(target), 'medium');
assert(assembled.text.includes('<related_memory_tables'));
assert(assembled.text.includes('近期经历、想法与重要事件'));
assert(assembled.text.includes('当前状态（3—7天）'));
assert(assembled.text.includes('稳定长期特征库'));
assert(!assembled.text.includes('name="中期总结与成长经验"'));
assert(assembled.tables.length >= 3);
assert(assembled.rowCount >= 2);

const update = Kernel.get('updateService');
const history = update.collectMessages(chat, {});
const built = update.buildUpdatePrompt({ chat, templates: [{ ...tpl, tables: [target] }], history, relatedBudget: 6000 });
assert(built.prompt.includes('相关记忆表如下（只读）'));
assert(built.prompt.includes('优先 update 或补充证据'));
assert(built.prompt.includes('<tags topic='));
assert(built.related.tables.length >= 3);
assert(built.historyText.includes('用户: 我今晚想早点睡'));

console.log('V2.11-R1 MEMORY TAG + RELATED CONTEXT CHECKS: PASS');
