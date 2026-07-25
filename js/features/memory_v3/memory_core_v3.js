(function (global) {
    'use strict';

    const M = global.MemoryV5 = global.MemoryV5 || {};
    const VERSION = '5.1.0';
    const STORE_VERSION = 3;

    const GROUPS = new Set(['core', 'current', 'short', 'medium', 'long']);
    const VIEW_MODES = new Set(['kv', 'rows']);
    const WRITE_POLICIES = new Set(['manual', 'auto', 'summary']);
    const CONTEXT_POLICIES = new Set(['always', 'relevant', 'never']);
    const SOURCES = new Set(['用户明确', 'AI判断']);
    const FIELD_TYPES = new Set(['text', 'longtext', 'number', 'date', 'datetime', 'select', 'multiselect', 'boolean']);
    const COMMON_KEYS = ['category', 'tags', 'title', 'content', 'source', 'time'];
    const COMMON_FIELD_DEFS = Object.freeze({
        category: { name: '分类', type: 'text', width: 120, aiHint: '优先参考用户提供的分类提示；没有完全合适的分类时，可以补充一个简短、稳定的新分类。' },
        tags: { name: '标签', type: 'multiselect', width: 180, aiHint: '优先复用用户提供的标签提示；可以补充2—8个汉字的简短标签，不要使用完整句子。' },
        title: { name: '标题', type: 'text', width: 150, aiHint: '用不超过10个汉字的稳定短语概括记录；更新同一记录时尽量保持标题不变。' },
        content: { name: '内容', type: 'longtext', width: 320, aiHint: '根据表格用途填写完整内容；避免照抄整段聊天，保留关键事实、结论或可执行信息。' },
        source: { name: '来源', type: 'select', width: 100, options: ['用户明确', 'AI判断'], aiHint: '由系统根据写入来源填写。' },
        time: { name: '时间', type: 'datetime', width: 170, aiHint: '由系统填写本次创建或更新的本地时间，精确到秒。' }
    });

    const normalizedStores = new WeakSet();
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const text = value => String(value == null ? '' : value).trim();
    const esc = value => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const unique = values => Array.from(new Set((Array.isArray(values) ? values : text(values).split(/[,，、\n]/u)).map(text).filter(Boolean)));
    const nowIso = () => new Date().toISOString();
    const pad2 = value => String(value).padStart(2, '0');
    const localDateTimeSeconds = (date = new Date()) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
    const id = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const graphemes = value => Array.from(text(value));
    const clampTitle = value => graphemes(value).slice(0, 10).join('');

    function commonField(commonKey, overrides = {}) {
        const def = COMMON_FIELD_DEFS[commonKey];
        if (!def) throw new Error(`未知公共字段：${commonKey}`);
        return normalizeField(Object.assign({
            id: `common_${commonKey}`,
            scope: 'common',
            commonKey,
            name: def.name,
            type: def.type,
            options: def.options || [],
            aiHint: def.aiHint,
            width: def.width,
            hidden: false,
            required: true
        }, overrides), 0);
    }

    function customField(name, type = 'text', options = {}) {
        return normalizeField(Object.assign({
            id: id('memory_field'),
            scope: 'custom',
            commonKey: '',
            name,
            type,
            options: [],
            aiHint: '',
            width: type === 'longtext' ? 260 : 150,
            hidden: false,
            required: false
        }, options), 0);
    }

    function normalizeField(field, index) {
        const scope = field?.scope === 'common' && COMMON_KEYS.includes(text(field.commonKey)) ? 'common' : 'custom';
        const commonKey = scope === 'common' ? text(field.commonKey) : '';
        const def = commonKey ? COMMON_FIELD_DEFS[commonKey] : null;
        const type = scope === 'common' ? def.type : (FIELD_TYPES.has(text(field?.type)) ? text(field.type) : 'text');
        return {
            id: scope === 'common' ? `common_${commonKey}` : (text(field?.id) || id('memory_field')),
            scope,
            commonKey,
            name: scope === 'common' ? def.name : (text(field?.name) || `字段${index + 1}`),
            type,
            options: scope === 'common' && def.options ? clone(def.options) : unique(field?.options || []),
            aiHint: Object.prototype.hasOwnProperty.call(field || {}, 'aiHint') ? text(field.aiHint) : text(def?.aiHint),
            required: scope === 'common' ? true : field?.required === true,
            hidden: field?.hidden === true,
            width: Math.max(80, Math.min(800, parseInt(field?.width, 10) || def?.width || (type === 'longtext' ? 260 : 150)))
        };
    }

    function normalizeFields(fields) {
        const incoming = Array.isArray(fields) ? fields.map(normalizeField) : [];
        const seenCommon = new Set();
        const result = [];
        incoming.forEach(field => {
            if (field.scope === 'common') {
                if (seenCommon.has(field.commonKey)) return;
                seenCommon.add(field.commonKey);
            }
            result.push(field);
        });
        COMMON_KEYS.forEach(key => {
            if (!seenCommon.has(key)) result.push(commonField(key));
        });
        return result;
    }

    function defaultSettings() {
        return {
            enabled: true,
            roundNoticeEnabled: true,
            contextMaxRecords: 32,
            relevantMaxPerTable: 5,
            tagBehaviors: {
                alwaysInject: ['始终注入'],
                neverInject: ['不进入上下文']
            },
            stage: 'V5.1：完整轮次与短期自动写入'
        };
    }

    function baseTable(definition = {}) {
        const fields = normalizeFields(definition.fields || COMMON_KEYS.map(key => commonField(key)));
        const fieldIds = new Set(fields.map(field => field.id));
        return {
            id: text(definition.id) || id('memory_table'),
            name: text(definition.name) || '新记忆表',
            group: GROUPS.has(text(definition.group)) ? text(definition.group) : 'short',
            viewMode: VIEW_MODES.has(text(definition.viewMode)) ? text(definition.viewMode) : 'rows',
            description: text(definition.description),
            extractPrompt: text(definition.extractPrompt || definition.description),
            fields,
            categoryHints: unique(definition.categoryHints || []),
            tagHints: unique(definition.tagHints || []),
            aiCanSupplementCategories: definition.aiCanSupplementCategories !== false,
            aiCanSupplementTags: definition.aiCanSupplementTags !== false,
            behavior: {
                writePolicy: WRITE_POLICIES.has(text(definition.behavior?.writePolicy)) ? text(definition.behavior.writePolicy) : 'manual',
                contextPolicy: CONTEXT_POLICIES.has(text(definition.behavior?.contextPolicy)) ? text(definition.behavior.contextPolicy) : 'relevant',
                retentionDays: Math.max(0, parseInt(definition.behavior?.retentionDays, 10) || 0),
                identityFieldIds: unique(definition.behavior?.identityFieldIds || []).filter(value => fieldIds.has(value)),
                contextFieldIds: unique(definition.behavior?.contextFieldIds || []).filter(value => fieldIds.has(value)),
                sourceTableIds: unique(definition.behavior?.sourceTableIds || []),
                allowAiWrite: definition.behavior?.allowAiWrite === true,
                chatStatus: definition.behavior?.chatStatus === true
            },
            display: {
                sortRules: Array.isArray(definition.display?.sortRules)
                    ? definition.display.sortRules.filter(rule => rule && fieldIds.has(text(rule.fieldId))).map(rule => ({ fieldId: text(rule.fieldId), direction: rule.direction === 'asc' ? 'asc' : 'desc' }))
                    : []
            }
        };
    }

    function fieldId(table, key) {
        const common = table.fields.find(field => field.scope === 'common' && field.commonKey === key);
        if (common) return common.id;
        const byName = table.fields.find(field => field.name === key);
        return byName?.id || '';
    }

    function createDefaultTables() {
        const tables = [];

        const core = baseTable({
            id: 'v5_core_profile',
            name: '核心档案',
            group: 'core',
            viewMode: 'kv',
            description: '保存已经确认、长期固定、每轮对话都需要知道的核心信息。AI只读取，不得新增、修改或删除。',
            extractPrompt: '本表仅供每轮上下文发送。所有更新必须由用户手动完成，AI不得输出本表写入操作。',
            categoryHints: ['用户', '角色', '双方关系', '称呼', '边界', '核心原则', '固定设定'],
            tagHints: ['始终注入', '长期稳定', '已确认'],
            behavior: { writePolicy: 'manual', contextPolicy: 'always', allowAiWrite: false, retentionDays: 0 }
        });
        core.behavior.identityFieldIds = [fieldId(core, 'category'), fieldId(core, 'title')];
        core.behavior.contextFieldIds = [fieldId(core, 'category'), fieldId(core, 'title'), fieldId(core, 'content'), fieldId(core, 'tags')];
        tables.push(core);

        const current = baseTable({
            id: 'v5_current_state',
            name: '当前状态',
            group: 'current',
            viewMode: 'kv',
            description: '保存当前仍然有效的用户状态、角色状态、关系状态、需求、风险和回应方向。',
            extractPrompt: '同一分类和标题更新原记录；只有真实变化才更新，未变化时不改时间。',
            categoryHints: ['用户状态', '角色状态', '关系状态', '当前需求', '当前风险', '当前策略'],
            tagHints: ['当前', '短期有效', '需关注'],
            behavior: { writePolicy: 'auto', contextPolicy: 'always', allowAiWrite: true, retentionDays: 7, chatStatus: true }
        });
        current.behavior.identityFieldIds = [fieldId(current, 'category'), fieldId(current, 'title')];
        current.behavior.contextFieldIds = [fieldId(current, 'title'), fieldId(current, 'content'), fieldId(current, 'tags')];
        tables.push(current);

        const events = baseTable({
            id: 'v5_recent_events',
            name: '近期事项',
            group: 'short',
            viewMode: 'rows',
            description: '保存最近7—15天真实发生、准备发生或已经完结的事情，一件事情一行。',
            extractPrompt: '注重事实。新事项新增；同一事项出现进展、结果或状态变化时更新原行。',
            categoryHints: ['生活', '工作', '健康', '关系', '家庭', '计划', '娱乐', '其他'],
            tagHints: ['待办', '已发生', '已完结', '近期'],
            fields: COMMON_KEYS.map(key => commonField(key)).concat([
                customField('事项状态', 'select', { options: ['待办', '已发生', '已完结'], aiHint: '按事实进展选择：尚未发生为待办，已经发生但仍有后续为已发生，完整结束为已完结。', width: 110 }),
                customField('相关主体', 'multiselect', { aiHint: '填写涉及的人、项目、地点或对象，使用简短名称。', width: 160 }),
                customField('完成时间', 'datetime', { aiHint: '事项完结时填写；未完结留空。', width: 170 }),
                customField('结果', 'longtext', { aiHint: '填写已经发生的客观结果；没有结果时留空。', width: 260 }),
                customField('后续', 'longtext', { aiHint: '填写仍需执行或等待的下一步；已完结且无后续时留空。', width: 260 })
            ]),
            behavior: { writePolicy: 'auto', contextPolicy: 'relevant', allowAiWrite: true, retentionDays: 15 }
        });
        events.behavior.identityFieldIds = [fieldId(events, 'title'), fieldId(events, '相关主体')];
        events.behavior.contextFieldIds = [fieldId(events, 'category'), fieldId(events, 'tags'), fieldId(events, 'title'), fieldId(events, 'content'), fieldId(events, '事项状态'), fieldId(events, '相关主体'), fieldId(events, '结果'), fieldId(events, '后续')];
        tables.push(events);

        const thoughts = baseTable({
            id: 'v5_thoughts',
            name: '想法与启示',
            group: 'short',
            viewMode: 'rows',
            description: '记录对事件的思考、双方理解、共同结论、想记住的内容，以及对未来操作有指导意义的认识。',
            extractPrompt: '不要重复保存纯事实；应说明背景、双方怎样理解、形成了什么结论，以及今后如何使用。',
            categoryHints: ['自我认知', '关系理解', '情绪处理', '生活方式', '工作学习', '身体健康', '价值观', '其他'],
            tagHints: ['事件复盘', '用户想法', '角色想法', '共同结论', '未来指导', '想记住'],
            fields: COMMON_KEYS.map(key => commonField(key)).concat([
                customField('想法类型', 'select', { options: ['事件复盘', '用户想法', '角色想法', '共同结论', '未来指导', '想记住'], aiHint: '选择最能代表本条记录用途的类型。', width: 130 }),
                customField('关联事项', 'text', { aiHint: '如本条想法来自某件事情，填写对应事项的稳定标题；没有则留空。', width: 160 }),
                customField('用户观点', 'longtext', { aiHint: '只记录用户明确表达或认可的观点，不替用户编造。', width: 240 }),
                customField('角色观点', 'longtext', { aiHint: '记录角色在本轮形成、并对未来有用的理解；普通安慰台词不记录。', width: 240 }),
                customField('未来指导', 'longtext', { aiHint: '写明今后遇到类似情况时可采取的具体原则或行动。', width: 260 })
            ]),
            behavior: { writePolicy: 'auto', contextPolicy: 'relevant', allowAiWrite: true, retentionDays: 30 }
        });
        thoughts.behavior.identityFieldIds = [fieldId(thoughts, 'title'), fieldId(thoughts, '关联事项')];
        thoughts.behavior.contextFieldIds = [fieldId(thoughts, 'category'), fieldId(thoughts, 'tags'), fieldId(thoughts, 'title'), fieldId(thoughts, 'content'), fieldId(thoughts, '用户观点'), fieldId(thoughts, '角色观点'), fieldId(thoughts, '未来指导')];
        tables.push(thoughts);

        const items = baseTable({
            id: 'v5_items',
            name: '物品',
            group: 'short',
            viewMode: 'rows',
            description: '记录重要物品、想购买的物品、物品位置和状态变化。',
            extractPrompt: '同一物品优先更新原记录；只有对后续互动有用的物品才记录。',
            categoryHints: ['日用品', '设备', '衣物', '药品', '礼物', '收藏', '文件', '其他'],
            tagHints: ['持有', '想要', '待购买', '借出', '遗失', '损坏', '已处理'],
            fields: COMMON_KEYS.map(key => commonField(key)).concat([
                customField('物品状态', 'select', { options: ['持有', '想要', '待购买', '借出', '遗失', '损坏', '已处理'], aiHint: '根据当前事实选择物品状态。', width: 120 }),
                customField('所属人', 'text', { aiHint: '填写物品的所有者或主要使用者。', width: 120 }),
                customField('数量', 'number', { aiHint: '有明确数量时填写；不确定时留空，不猜测。', width: 90 }),
                customField('位置', 'text', { aiHint: '填写最后明确的位置；不确定时留空。', width: 150 }),
                customField('关联人物', 'multiselect', { aiHint: '填写与该物品有关的人。', width: 150 }),
                customField('关联事项', 'text', { aiHint: '填写与该物品直接相关的近期事项标题。', width: 160 })
            ]),
            behavior: { writePolicy: 'auto', contextPolicy: 'relevant', allowAiWrite: true, retentionDays: 0 }
        });
        items.behavior.identityFieldIds = [fieldId(items, 'title'), fieldId(items, '所属人')];
        items.behavior.contextFieldIds = [fieldId(items, 'category'), fieldId(items, 'tags'), fieldId(items, 'title'), fieldId(items, 'content'), fieldId(items, '物品状态'), fieldId(items, '所属人'), fieldId(items, '位置')];
        tables.push(items);

        const daily = baseTable({
            id: 'v5_daily_observation',
            name: '日常观察',
            group: 'short',
            viewMode: 'rows',
            description: '按一条观察一行记录睡眠、饮水、运动、身体、三餐和其他健康情况。当前数据量不大，暂不启用复杂趋势压缩。',
            extractPrompt: '分类使用睡眠、饮水、运动、身体、三餐或其他健康；没有明确信息时不写，不补数字。',
            categoryHints: ['睡眠', '饮水', '运动', '身体', '三餐', '其他健康'],
            tagHints: ['正常', '不足', '过量', '异常', '未判断'],
            fields: COMMON_KEYS.map(key => commonField(key)).concat([
                customField('数值', 'number', { aiHint: '只填写用户明确给出的数值，例如小时、毫升、次数；没有明确数值时留空。', width: 90 }),
                customField('单位', 'text', { aiHint: '与数值配套填写，例如小时、毫升、次、份。', width: 90 }),
                customField('状况', 'select', { options: ['正常', '不足', '过量', '异常', '未判断'], aiHint: '仅在信息足够时判断；不确定时选择未判断。', width: 100 })
            ]),
            behavior: { writePolicy: 'auto', contextPolicy: 'relevant', allowAiWrite: true, retentionDays: 15 }
        });
        daily.behavior.identityFieldIds = [fieldId(daily, 'time'), fieldId(daily, 'category'), fieldId(daily, 'title')];
        daily.behavior.contextFieldIds = [fieldId(daily, 'category'), fieldId(daily, 'tags'), fieldId(daily, 'title'), fieldId(daily, 'content'), fieldId(daily, '数值'), fieldId(daily, '单位'), fieldId(daily, '状况')];
        tables.push(daily);

        const eventSummary = baseTable({
            id: 'v5_event_summary',
            name: '事项总结',
            group: 'medium',
            viewMode: 'rows',
            description: '把一批近期事项压缩为事实脉络、结果、遗留问题和可复用经验。',
            extractPrompt: '只总结选中的近期事项，不做无证据的心理推断。总结成功后，来源短期记录可标记为已压缩。',
            categoryHints: ['生活总结', '工作总结', '健康总结', '关系总结', '阶段总结', '其他'],
            tagHints: ['已压缩', '事项脉络', '结果', '未完结', '可复用经验'],
            fields: COMMON_KEYS.map(key => commonField(key)).concat([
                customField('时间范围', 'text', { aiHint: '填写本次总结覆盖的自然时间范围。', width: 160 }),
                customField('关联事项', 'multiselect', { aiHint: '填写被总结的短期事项标题。', width: 220 }),
                customField('最终结果', 'longtext', { aiHint: '概括已经确定的结果。', width: 260 }),
                customField('未完结部分', 'longtext', { aiHint: '列出仍需处理的事项；没有则留空。', width: 260 }),
                customField('可复用经验', 'longtext', { aiHint: '提炼今后处理类似事情时可直接使用的经验。', width: 280 })
            ]),
            behavior: { writePolicy: 'summary', contextPolicy: 'relevant', allowAiWrite: false, retentionDays: 0, sourceTableIds: ['v5_recent_events'] }
        });
        eventSummary.behavior.identityFieldIds = [fieldId(eventSummary, 'title'), fieldId(eventSummary, '时间范围')];
        eventSummary.behavior.contextFieldIds = [fieldId(eventSummary, 'category'), fieldId(eventSummary, 'tags'), fieldId(eventSummary, 'title'), fieldId(eventSummary, 'content'), fieldId(eventSummary, '最终结果'), fieldId(eventSummary, '未完结部分'), fieldId(eventSummary, '可复用经验')];
        tables.push(eventSummary);

        const thoughtSummary = baseTable({
            id: 'v5_thought_summary',
            name: '思想与成长总结',
            group: 'medium',
            viewMode: 'rows',
            description: '把一批短期想法压缩为人物成长、理解变化、共同结论和未来指导。',
            extractPrompt: '总结用户、角色或双方过去怎样理解、现在怎样理解、变化证据及未来影响。',
            categoryHints: ['用户成长', '角色成长', '双方成长', '关系理解', '思想变化', '其他'],
            tagHints: ['已压缩', '旧想法', '新想法', '变化证据', '未来指导'],
            fields: COMMON_KEYS.map(key => commonField(key)).concat([
                customField('成长主体', 'select', { options: ['用户', '角色', '双方'], aiHint: '选择本次变化的主要主体。', width: 100 }),
                customField('旧想法', 'longtext', { aiHint: '概括过去较稳定的理解或反应模式。', width: 250 }),
                customField('新想法', 'longtext', { aiHint: '概括当前形成的新理解或新反应。', width: 250 }),
                customField('变化证据', 'longtext', { aiHint: '列出支持变化判断的具体对话或事件证据。', width: 260 }),
                customField('未来指导', 'longtext', { aiHint: '说明这种变化将怎样指导未来互动。', width: 280 }),
                customField('关联想法', 'multiselect', { aiHint: '填写被压缩的短期想法标题。', width: 220 })
            ]),
            behavior: { writePolicy: 'summary', contextPolicy: 'relevant', allowAiWrite: false, retentionDays: 0, sourceTableIds: ['v5_thoughts'] }
        });
        thoughtSummary.behavior.identityFieldIds = [fieldId(thoughtSummary, 'title'), fieldId(thoughtSummary, '成长主体')];
        thoughtSummary.behavior.contextFieldIds = [fieldId(thoughtSummary, 'category'), fieldId(thoughtSummary, 'tags'), fieldId(thoughtSummary, 'title'), fieldId(thoughtSummary, 'content'), fieldId(thoughtSummary, '旧想法'), fieldId(thoughtSummary, '新想法'), fieldId(thoughtSummary, '未来指导')];
        tables.push(thoughtSummary);

        const longTerm = baseTable({
            id: 'v5_stable_long_term',
            name: '稳定长期记忆',
            group: 'long',
            viewMode: 'rows',
            description: '从中期总结中提炼已经稳定、长期有效的习惯、偏好、规律、关系模式、边界、价值观和能力。',
            extractPrompt: 'AI只能基于选中的中期总结生成草稿，最终必须由用户手动编辑并保存。',
            categoryHints: ['稳定习惯', '长期偏好', '身心规律', '有效安抚', '无效安抚', '关系模式', '关系仪式', '边界', '价值观', '世界观', '稳定能力'],
            tagHints: ['长期稳定', '已确认', '相关时注入'],
            fields: COMMON_KEYS.map(key => commonField(key)).concat([
                customField('长期类型', 'select', { options: ['稳定习惯', '长期偏好', '身心规律', '有效安抚', '无效安抚', '关系模式', '关系仪式', '边界', '价值观', '世界观', '稳定能力'], aiHint: '选择最准确的长期类型。', width: 130 }),
                customField('适用条件', 'longtext', { aiHint: '说明这条长期规律在什么情况下适用。', width: 260 }),
                customField('不适用条件', 'longtext', { aiHint: '说明例外、边界或不应套用的情境。', width: 260 }),
                customField('来源总结', 'multiselect', { aiHint: '填写支持本条长期记忆的中期总结标题。', width: 220 })
            ]),
            behavior: { writePolicy: 'manual', contextPolicy: 'relevant', allowAiWrite: false, retentionDays: 0, sourceTableIds: ['v5_event_summary', 'v5_thought_summary'] }
        });
        longTerm.behavior.identityFieldIds = [fieldId(longTerm, 'category'), fieldId(longTerm, 'title')];
        longTerm.behavior.contextFieldIds = [fieldId(longTerm, 'category'), fieldId(longTerm, 'tags'), fieldId(longTerm, 'title'), fieldId(longTerm, 'content'), fieldId(longTerm, '长期类型'), fieldId(longTerm, '适用条件'), fieldId(longTerm, '不适用条件')];
        tables.push(longTerm);

        return tables;
    }

    function createDefaultStore() {
        const tables = createDefaultTables();
        return {
            version: STORE_VERSION,
            settings: defaultSettings(),
            tables,
            records: Object.fromEntries(tables.map(table => [table.id, []]))
        };
    }

    function normalizeTable(table, index) {
        const normalized = baseTable(table || {});
        if (!text(normalized.name)) normalized.name = `记忆表${index + 1}`;
        return normalized;
    }

    function getFieldValue(record, field) {
        if (!record || !field) return undefined;
        if (field.scope === 'common') return record[field.commonKey];
        return record.values?.[field.id];
    }

    function setFieldValue(record, field, value) {
        if (field.scope === 'common') {
            if (field.commonKey === 'tags') record.tags = unique(value);
            else if (field.commonKey === 'title') record.title = clampTitle(value);
            else if (field.commonKey === 'source') record.source = SOURCES.has(text(value)) ? text(value) : '用户明确';
            else record[field.commonKey] = text(value);
            return;
        }
        record.values ||= {};
        if (field.type === 'number') {
            const number = Number(value);
            if (Number.isFinite(number)) record.values[field.id] = number;
            else delete record.values[field.id];
            return;
        }
        if (field.type === 'boolean') {
            record.values[field.id] = value === true || value === 'true' || value === '是' || value === 1;
            return;
        }
        if (field.type === 'multiselect') {
            record.values[field.id] = unique(value);
            return;
        }
        if (field.type === 'select' && field.options.length && text(value) && !field.options.includes(text(value))) return;
        record.values[field.id] = clone(value);
    }

    function normalizeRecord(record, table) {
        const createdAt = text(record?.createdAt) || nowIso();
        const updatedAt = text(record?.updatedAt) || createdAt;
        const out = {
            id: text(record?.id) || id('memory_record'),
            tableId: table.id,
            category: text(record?.category),
            tags: unique(record?.tags || []),
            title: clampTitle(record?.title),
            content: text(record?.content),
            source: SOURCES.has(text(record?.source)) ? text(record.source) : '用户明确',
            time: text(record?.time) || localDateTimeSeconds(new Date(updatedAt)),
            values: {},
            createdAt,
            updatedAt,
            roundId: record?.roundId || null,
            changedFieldIds: unique(record?.changedFieldIds || [])
        };
        table.fields.filter(field => field.scope === 'custom').forEach(field => {
            if (record?.values && Object.prototype.hasOwnProperty.call(record.values, field.id)) setFieldValue(out, field, record.values[field.id]);
            else if (record && Object.prototype.hasOwnProperty.call(record, field.name)) setFieldValue(out, field, record[field.name]);
        });
        return out;
    }

    function normalizeStore(store) {
        const settings = Object.assign(defaultSettings(), clone(store?.settings || {}));
        const previousStage = text(store?.settings?.stage);
        settings.tagBehaviors = Object.assign(defaultSettings().tagBehaviors, clone(store?.settings?.tagBehaviors || {}));
        if (!previousStage || previousStage.startsWith('V5.0')) settings.roundNoticeEnabled = true;
        settings.stage = defaultSettings().stage;
        const tables = (Array.isArray(store?.tables) ? store.tables : []).map(normalizeTable);
        const records = {};
        tables.forEach(table => {
            records[table.id] = (Array.isArray(store?.records?.[table.id]) ? store.records[table.id] : []).map(record => normalizeRecord(record, table));
        });
        return { version: STORE_VERSION, settings, tables, records };
    }

    function ensureStore(chat) {
        if (!chat || typeof chat !== 'object') return createDefaultStore();
        if (!chat.memoryStore || typeof chat.memoryStore !== 'object' || chat.memoryStore.version !== STORE_VERSION) {
            if (chat.memoryStore && typeof chat.memoryStore === 'object' && !chat.memoryStoreLegacyBackup) {
                chat.memoryStoreLegacyBackup = clone(chat.memoryStore);
            }
            chat.memoryStore = createDefaultStore();
        }
        if (!normalizedStores.has(chat.memoryStore)) {
            chat.memoryStore = normalizeStore(chat.memoryStore);
            normalizedStores.add(chat.memoryStore);
        }
        return chat.memoryStore;
    }

    async function migrateAllCharacters() {
        const chars = Array.isArray(global.db?.characters) ? global.db.characters : [];
        for (const chat of chars) ensureStore(chat);
    }

    function getCurrentChat() {
        return Array.isArray(global.db?.characters) ? global.db.characters.find(character => character.id === global.currentChatId) || null : null;
    }

    async function persist(chat) {
        if (chat?.id) await global.saveCharacter?.(chat.id);
    }

    function findTable(store, tableId) {
        return store.tables.find(table => table.id === tableId) || null;
    }

    function visibleFields(table) {
        return (table?.fields || []).filter(field => field.hidden !== true);
    }

    function resolveInputValues(table, input) {
        const source = input && typeof input === 'object' ? input : {};
        const out = {};
        table.fields.forEach(field => {
            let value;
            if (Object.prototype.hasOwnProperty.call(source, field.id)) value = source[field.id];
            else if (field.scope === 'common' && Object.prototype.hasOwnProperty.call(source, field.commonKey)) value = source[field.commonKey];
            else if (Object.prototype.hasOwnProperty.call(source, field.name)) value = source[field.name];
            else return;
            out[field.id] = clone(value);
        });
        return out;
    }

    function recordMatches(record, table, match) {
        const resolved = resolveInputValues(table, match);
        const entries = Object.entries(resolved);
        if (!entries.length) return false;
        return entries.every(([fieldId, value]) => {
            const field = table.fields.find(item => item.id === fieldId);
            return field && JSON.stringify(getFieldValue(record, field)) === JSON.stringify(value);
        });
    }

    function identityMatch(record, table, values) {
        const ids = table.behavior.identityFieldIds || [];
        if (!ids.length) return false;
        return ids.every(fieldId => {
            const field = table.fields.find(item => item.id === fieldId);
            return field && Object.prototype.hasOwnProperty.call(values, fieldId)
                && JSON.stringify(getFieldValue(record, field)) === JSON.stringify(values[fieldId]);
        });
    }

    function detectImportPayload(parsed) {
        if (parsed && typeof parsed === 'object' && parsed.memoryStore) return detectImportPayload(parsed.memoryStore);
        if (Array.isArray(parsed)) return { kind: 'tables', tables: parsed, records: {} };
        if (parsed && typeof parsed === 'object' && parsed.table) return { kind: 'single_table', tables: [parsed.table], records: parsed.records || {} };
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.tables)) {
            return {
                kind: parsed.records && typeof parsed.records === 'object' ? 'store' : 'tables',
                tables: parsed.tables,
                records: parsed.records || {},
                settings: parsed.settings || {},
                version: parsed.version
            };
        }
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.fields) && text(parsed.name)) {
            return { kind: 'single_table', tables: [parsed], records: {} };
        }
        throw new Error('无法识别文件格式：需要完整memoryStore、tables数组、table对象或单张表定义。');
    }

    function importPlan(parsed) {
        const detected = detectImportPayload(parsed);
        const isLegacy = (detected.version && Number(detected.version) < STORE_VERSION)
            || detected.tables.some(table => !Array.isArray(table?.fields) && Array.isArray(table?.columns));
        if (isLegacy) {
            throw new Error('检测到V4或更早的旧表结构。V5.1按约定不迁移旧记录；请导入V5.1空表模板，或先在旧版本中导出备份。');
        }
        const tables = detected.tables.map((table, index) => {
            try {
                return normalizeTable(table, index);
            } catch (error) {
                throw new Error(`表格“${text(table?.name) || index + 1}”标准化失败：${error.message || error}`);
            }
        });
        if (!tables.length) throw new Error('文件中没有可导入的表格。');
        const ids = new Set();
        tables.forEach(table => {
            if (ids.has(table.id)) throw new Error(`表ID重复：${table.id}`);
            ids.add(table.id);
            COMMON_KEYS.forEach(key => {
                if (!table.fields.some(field => field.scope === 'common' && field.commonKey === key)) throw new Error(`表格“${table.name}”缺少公共字段：${COMMON_FIELD_DEFS[key].name}`);
            });
        });
        const records = {};
        tables.forEach(table => {
            const raw = Array.isArray(detected.records?.[table.id]) ? detected.records[table.id] : [];
            records[table.id] = raw.map(record => normalizeRecord(record, table));
        });
        return {
            kind: detected.kind,
            tables,
            records,
            settings: Object.assign(defaultSettings(), clone(detected.settings || {})),
            tableCount: tables.length,
            recordCount: Object.values(records).reduce((sum, rows) => sum + rows.length, 0)
        };
    }

    function mergeImport(store, plan, options = {}) {
        const includeRecords = options.includeRecords !== false;
        const conflictMode = options.conflictMode === 'replace' ? 'replace' : 'duplicate';
        const result = { added: 0, replaced: 0, duplicated: 0, records: 0 };
        plan.tables.forEach(sourceTable => {
            const existingIndex = store.tables.findIndex(table => table.id === sourceTable.id || table.name === sourceTable.name);
            let table = clone(sourceTable);
            if (existingIndex >= 0 && conflictMode === 'replace') {
                const oldId = store.tables[existingIndex].id;
                table.id = oldId;
                store.tables[existingIndex] = table;
                store.records[oldId] = includeRecords ? (plan.records[sourceTable.id] || []).map(record => normalizeRecord(record, table)) : [];
                result.replaced += 1;
                result.records += store.records[oldId].length;
                return;
            }
            if (existingIndex >= 0) {
                const oldId = table.id;
                table.id = id('memory_table');
                table.name = `${table.name}（导入）`;
                table.behavior.sourceTableIds = table.behavior.sourceTableIds.map(sourceId => sourceId === oldId ? table.id : sourceId);
                store.tables.push(table);
                store.records[table.id] = includeRecords ? (plan.records[oldId] || []).map(record => normalizeRecord(record, table)) : [];
                result.duplicated += 1;
                result.records += store.records[table.id].length;
                return;
            }
            store.tables.push(table);
            store.records[table.id] = includeRecords ? (plan.records[sourceTable.id] || []).map(record => normalizeRecord(record, table)) : [];
            result.added += 1;
            result.records += store.records[table.id].length;
        });
        return result;
    }

    M.VERSION = VERSION;
    M.STORE_VERSION = STORE_VERSION;
    M.constants = Object.freeze({ GROUPS, VIEW_MODES, WRITE_POLICIES, CONTEXT_POLICIES, SOURCES, FIELD_TYPES, COMMON_KEYS, COMMON_FIELD_DEFS });
    M.util = Object.freeze({ clone, text, esc, unique, nowIso, localDateTimeSeconds, id, clampTitle });
    M.model = Object.freeze({
        defaultSettings,
        commonField,
        customField,
        baseTable,
        createDefaultTables,
        createDefaultStore,
        normalizeField,
        normalizeFields,
        normalizeTable,
        normalizeRecord,
        normalizeStore,
        ensureStore,
        migrateAllCharacters,
        getCurrentChat,
        persist,
        findTable,
        visibleFields,
        getFieldValue,
        setFieldValue,
        resolveInputValues,
        recordMatches,
        identityMatch,
        detectImportPayload,
        importPlan,
        mergeImport,
        fieldId
    });
})(window);
