// 结构化记忆 V2.4：标签路由、副作用边界与行级使用策略
(function () {
    'use strict';

    const Kernel = window.OvoMemoryKernel || null;
    const Core = Kernel?.core;
    if (!Core) throw new Error('记忆内核未加载');
    const escapeHtml = Core.escapeHtml;
    const unique = (values, limit = 20) => Core.unique(values, limit);

    const VERSION = '2.5';
    const EFFECTS = Object.freeze({
        fact: { label: '已确认事实', influence: 'medium' },
        temporary_state: { label: '临时状态', influence: 'low' },
        soft_preference: { label: '柔性偏好', influence: 'low' },
        hard_boundary: { label: '明确边界', influence: 'high' },
        reminder: { label: '提醒事项', influence: 'medium' },
        historical_context: { label: '历史背景', influence: 'low' },
        candidate: { label: '未审核候选', influence: 'none' }
    });

    const TOPIC_RULES = [
        ['工作', /工作|项目|上班|职场|同事|老板|任务|代码|开发|需求|产品|设计|汇报|会议/i],
        ['学习', /学习|课程|考试|作业|论文|阅读|复习|知识|练习/i],
        ['健康', /健康|身体|不舒服|疼|痛|生病|医院|药|症状|疲劳|精力/i],
        ['睡眠', /睡眠|睡觉|入睡|起床|熬夜|失眠|困|梦/i],
        ['饮水', /喝水|饮水|口渴|水量/i],
        ['情绪', /情绪|难过|焦虑|压力|开心|生气|委屈|崩溃|低落|烦|害怕/i],
        ['关系', /关系|朋友|伴侣|恋爱|喜欢的人|相处|争吵|矛盾|社交/i],
        ['家庭', /家庭|家人|父母|妈妈|爸爸|兄弟|姐妹|亲戚/i],
        ['创作', /创作|写作|画画|绘画|小说|角色|设定|灵感|作品/i],
        ['娱乐', /游戏|电影|电视剧|动漫|音乐|娱乐|追剧|小说/i],
        ['财务', /钱|消费|预算|工资|收入|支出|购买|价格|财务/i],
        ['生活', /生活|吃饭|饮食|做饭|家务|出门|旅行|日常/i]
    ];

    const SCENE_RULES = [
        ['情绪支持', /安慰|陪我|难过|焦虑|崩溃|压力|委屈|害怕|情绪|倾诉/i],
        ['计划制定', /计划|安排|规划|怎么做|下一步|路线|步骤|日程/i],
        ['任务执行', /开始做|正在做|帮我完成|执行|提交|修改|处理|解决/i],
        ['复盘总结', /总结|复盘|回顾|整理|分析最近|这段时间/i],
        ['关系讨论', /关系|相处|朋友|伴侣|家人|恋爱|争吵|矛盾/i],
        ['健康追踪', /睡眠|喝水|身体|健康|精力|运动|饮食|症状/i],
        ['角色扮演', /剧情|扮演|角色扮演|小剧场|设定中|入戏/i],
        ['日常聊天', /./]
    ];

    function normalizeEffect(value, fallback) {
        const key = String(value || '').trim();
        return EFFECTS[key] ? key : (EFFECTS[fallback] ? fallback : 'historical_context');
    }

    function inferEffect(table, text) {
        const layer = String(table?.memoryLayer || '').toLowerCase();
        const source = `${table?.name || ''}\n${text || ''}`;
        if (layer === 'review' || /候选|待审核/.test(source)) return 'candidate';
        if (/边界|禁止|不希望|不要在|不能接受|底线/.test(source)) return 'hard_boundary';
        if (/偏好|喜欢|不喜欢|习惯|倾向|更希望|表达方式/.test(source)) return 'soft_preference';
        if (/提醒|待办|承诺|截止|未完成/.test(source)) return 'reminder';
        if (/当前|近期|最近|临时|状态|情绪|精力|身体/.test(source) && layer === 'short') return 'temporary_state';
        if (/确认档案|事实|身份|时区|称呼/.test(source) || layer === 'core') return 'fact';
        return 'historical_context';
    }

    function inferTopics(text) {
        const source = String(text || '');
        return unique(TOPIC_RULES.filter(([, regex]) => regex.test(source)).map(([label]) => label), 12);
    }

    function inferScenes(text, topics) {
        const source = String(text || '');
        const scenes = SCENE_RULES.filter(([label, regex]) => label !== '日常聊天' && regex.test(source)).map(([label]) => label);
        if (!scenes.length) scenes.push('日常聊天');
        if ((topics || []).includes('健康') || (topics || []).includes('睡眠') || (topics || []).includes('饮水')) scenes.push('健康追踪');
        return unique(scenes, 10);
    }

    function inferEntities(text) {
        const source = String(text || '');
        const entities = [];
        const quoted = source.match(/[《“「『](.{2,24}?)[》”」』]/g) || [];
        quoted.forEach(item => entities.push(item.slice(1, -1)));
        const projectMatches = source.match(/[\u3400-\u9fffA-Za-z0-9_-]{2,20}(?:项目|版本|系统|计划|模板|角色)/g) || [];
        projectMatches.forEach(item => entities.push(item));
        return unique(entities, 12);
    }

    function normalizeTagBundle(raw, context = {}) {
        let source = raw;
        if (Array.isArray(source)) source = { topic: source };
        if (!source || typeof source !== 'object') source = {};
        const text = String(context.text || '');
        const legacy = Array.isArray(context.legacyTags) ? context.legacyTags : [];
        const topic = unique([...(Array.isArray(source.topic) ? source.topic : []), ...legacy, ...inferTopics(text)], 16);
        const scene = unique([...(Array.isArray(source.scene) ? source.scene : []), ...inferScenes(text, topic)], 12);
        const entity = unique([...(Array.isArray(source.entity) ? source.entity : []), ...inferEntities(text)], 16);
        const effect = normalizeEffect(source.effect, inferEffect(context.table, text));
        return { topic, scene, entity, effect };
    }

    function normalizeUsePolicy(raw, effectMode) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const effect = normalizeEffect(effectMode, 'historical_context');
        const defaults = {
            injectionEnabled: effect !== 'candidate',
            paused: false,
            allowedScenes: [],
            blockedScenes: [],
            maxInfluence: EFFECTS[effect].influence,
            cooldownRounds: effect === 'soft_preference' ? 2 : (effect === 'reminder' ? 3 : 0),
            allowProactiveMention: effect === 'hard_boundary',
            mentionPolicy: effect === 'reminder' ? 'trigger_only' : 'relevant_only'
        };
        const mentionPolicy = ['never', 'trigger_only', 'relevant_only', 'always_until_done'].includes(source.mentionPolicy)
            ? source.mentionPolicy : defaults.mentionPolicy;
        return {
            injectionEnabled: source.injectionEnabled !== undefined ? !!source.injectionEnabled : defaults.injectionEnabled,
            paused: !!source.paused,
            allowedScenes: unique(source.allowedScenes, 12),
            blockedScenes: unique(source.blockedScenes, 12),
            maxInfluence: ['none', 'low', 'medium', 'high'].includes(source.maxInfluence) ? source.maxInfluence : defaults.maxInfluence,
            cooldownRounds: Math.max(0, Math.min(999, Number(source.cooldownRounds) || defaults.cooldownRounds)),
            allowProactiveMention: source.allowProactiveMention !== undefined ? !!source.allowProactiveMention : defaults.allowProactiveMention,
            mentionPolicy
        };
    }

    function normalizeUsage(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            retrievalCount: Math.max(0, Number(source.retrievalCount) || 0),
            injectionCount: Math.max(0, Number(source.injectionCount) || 0),
            lastRetrievedAt: Number(source.lastRetrievedAt) || 0,
            lastInjectedAt: Number(source.lastInjectedAt) || 0,
            lastInjectedRoundIndex: Number.isFinite(Number(source.lastInjectedRoundIndex)) ? Number(source.lastInjectedRoundIndex) : -999999,
            correctionCount: Math.max(0, Number(source.correctionCount) || 0),
            helpfulCount: Math.max(0, Number(source.helpfulCount) || 0)
        };
    }

    function ensureRowMeta(row, table, searchText) {
        if (!row || typeof row !== 'object') return null;
        row.meta ||= {};
        const text = String(searchText || '');
        row.meta.tagBundle = normalizeTagBundle(row.meta.tagBundle || row.meta.tags, {
            table,
            text,
            legacyTags: Array.isArray(row.meta.tags) ? row.meta.tags : []
        });
        row.meta.tags = unique(row.meta.tagBundle.topic, 20); // 保留 V2.2/V2.3 兼容字段
        row.meta.usePolicy = normalizeUsePolicy(row.meta.usePolicy || {
            paused: row.meta.paused,
            allowProactiveMention: row.meta.allowProactiveMention,
            mentionPolicy: row.meta.mentionPolicy
        }, row.meta.tagBundle.effect);
        row.meta.usage = normalizeUsage(row.meta.usage);
        if (window.MemoryTableLifecycle) window.MemoryTableLifecycle.ensureRowMeta(row, table, text);
        if (window.MemoryTableFeedback) window.MemoryTableFeedback.ensureRowMeta(row);
        return row.meta;
    }

    function classifyQuery(queryText) {
        const text = String(queryText || '');
        const topic = inferTopics(text);
        const scene = inferScenes(text, topic);
        const entity = inferEntities(text);
        return { text, topic, scene, entity };
    }

    function intersection(a, b) {
        const set = new Set((b || []).map(item => String(item).toLowerCase()));
        return unique((a || []).filter(item => set.has(String(item).toLowerCase())), 20);
    }

    function fuzzyMatches(tags, queryText) {
        const query = String(queryText || '').toLowerCase();
        return unique((tags || []).filter(tag => query.includes(String(tag).toLowerCase()) || String(tag).toLowerCase().includes(query.slice(0, 20))), 20);
    }

    function getRoundIndex(chat) {
        const rounds = chat?.memoryTables?.rounds;
        return Array.isArray(rounds) ? rounds.length : 0;
    }

    function evaluateItem(chat, item, queryContext) {
        const table = item.table || null;
        const row = item.row || null;
        const meta = ensureRowMeta(row, table, item.searchText || item.text || '');
        const tags = meta?.tagBundle || normalizeTagBundle({}, { table, text: item.searchText || '' });
        const usePolicy = meta?.usePolicy || normalizeUsePolicy({}, tags.effect);
        const status = String(meta?.status || 'active').toLowerCase();
        const now = Date.now();
        const blocked = [];
        if (!usePolicy.injectionEnabled) blocked.push('已关闭注入');
        if (usePolicy.paused) blocked.push('已暂停使用');
        if (['candidate', 'archived', 'expired', 'rejected'].includes(status)) blocked.push(`状态为 ${status}`);
        if (tags.effect === 'candidate') blocked.push('未审核候选');
        if (Number(meta?.expiresAt) > 0 && Number(meta.expiresAt) < now) blocked.push('已经过期');
        const lifecycleEval = window.MemoryTableLifecycle ? window.MemoryTableLifecycle.evaluateRow(row, table, now) : null;
        if (lifecycleEval && !lifecycleEval.allowed) blocked.push(...(lifecycleEval.blockedReasons || []));

        const context = queryContext || classifyQuery('');
        const sceneMatches = intersection(tags.scene, context.scene);
        const topicMatches = intersection(tags.topic, context.topic);
        const entityMatches = intersection(tags.entity, context.entity);
        const fuzzyTopic = fuzzyMatches(tags.topic, context.text);
        const fuzzyEntity = fuzzyMatches(tags.entity, context.text);
        const blockedScene = intersection(usePolicy.blockedScenes, context.scene);
        if (blockedScene.length) blocked.push(`禁止场景：${blockedScene.join('、')}`);
        if (usePolicy.allowedScenes.length && context.scene.length && !intersection(usePolicy.allowedScenes, context.scene).length) {
            blocked.push('当前场景不在允许范围');
        }
        const currentRound = getRoundIndex(chat);
        const lastInjectedRound = Number.isFinite(Number(meta?.usage?.lastInjectedRoundIndex)) ? Number(meta.usage.lastInjectedRoundIndex) : -999999;
        const cooldownLeft = usePolicy.cooldownRounds - (currentRound - lastInjectedRound);
        if (cooldownLeft > 0 && !item.pinned) blocked.push(`冷却中，还需 ${cooldownLeft} 轮`);
        if (usePolicy.mentionPolicy === 'never') blocked.push('设置为从不发送');
        if (tags.effect === 'reminder' && usePolicy.mentionPolicy === 'trigger_only' && !usePolicy.allowProactiveMention && !topicMatches.length && !entityMatches.length && !fuzzyTopic.length) {
            blocked.push('提醒触发条件未满足');
        }

        let tagScore = 0;
        tagScore += Math.min(1, (topicMatches.length + fuzzyTopic.length * 0.6) / Math.max(1, Math.min(3, tags.topic.length || 1))) * 0.36;
        tagScore += Math.min(1, sceneMatches.length / Math.max(1, Math.min(2, tags.scene.length || 1))) * 0.34;
        tagScore += Math.min(1, (entityMatches.length + fuzzyEntity.length * 0.7) / Math.max(1, Math.min(2, tags.entity.length || 1))) * 0.22;
        if (['fact', 'hard_boundary'].includes(tags.effect)) tagScore += 0.08;
        tagScore = Math.max(0, Math.min(1, tagScore));

        const tagReasons = [];
        if (topicMatches.length || fuzzyTopic.length) tagReasons.push(`主题：${unique([...topicMatches, ...fuzzyTopic]).join('、')}`);
        if (sceneMatches.length) tagReasons.push(`场景：${sceneMatches.join('、')}`);
        if (entityMatches.length || fuzzyEntity.length) tagReasons.push(`实体：${unique([...entityMatches, ...fuzzyEntity]).join('、')}`);
        tagReasons.push(`作用：${EFFECTS[tags.effect]?.label || tags.effect}`);
        (lifecycleEval?.reasons || []).forEach(reason => tagReasons.push(reason));

        return {
            allowed: blocked.length === 0,
            blockedReasons: blocked,
            tagScore,
            tagReasons,
            tags,
            usePolicy,
            effectMode: tags.effect,
            currentRound,
            lifecycleEval
        };
    }

    function getPromptDirective(effectMode, usePolicy, row = null, table = null) {
        const effect = normalizeEffect(effectMode, 'historical_context');
        const influence = usePolicy?.maxInfluence || EFFECTS[effect].influence;
        const lines = [];
        if (effect === 'fact') lines.push('可作为已确认事实，但只在相关问题中使用。');
        if (effect === 'temporary_state') lines.push('仅作近期背景，不得推断为长期人格或习惯。');
        if (effect === 'soft_preference') lines.push('只做柔性调整，不是强制行为指令。');
        if (effect === 'hard_boundary') lines.push('属于明确边界，相关场景下应优先遵守。');
        if (effect === 'reminder') lines.push('只在触发条件满足或当前话题相关时提及，禁止反复催促。');
        if (effect === 'historical_context') lines.push('仅在相关回顾、人物或事件讨论中作为历史背景。');
        if (effect === 'candidate') lines.push('未审核候选，不得作为事实使用。');
        if (influence === 'low') lines.push('影响强度：低。不要主动复述。');
        if (influence === 'medium') lines.push('影响强度：中。自然参考，不要喧宾夺主。');
        if (influence === 'high') lines.push('影响强度：高。仅限明确相关场景。');
        if (usePolicy?.allowProactiveMention === false) lines.push('不允许主动提及，除非用户当前话题直接相关。');
        if (row && window.MemoryTableLifecycle) {
            const lifecycleDirective = window.MemoryTableLifecycle.getPromptDirective(row, table);
            if (lifecycleDirective) lines.push(lifecycleDirective);
        }
        return lines.join('');
    }

    function markRetrieved(item) {
        const row = item?.row;
        if (!row) return;
        const meta = ensureRowMeta(row, item.table, item.searchText || item.text || '');
        meta.usage.retrievalCount += 1;
        meta.usage.lastRetrievedAt = Date.now();
    }

    function markInjected(chat, item) {
        const row = item?.row;
        if (!row) return;
        const meta = ensureRowMeta(row, item.table, item.searchText || item.text || '');
        const roundIndex = getRoundIndex(chat);
        if (meta.usage.lastInjectedRoundIndex === roundIndex && Date.now() - meta.usage.lastInjectedAt < 30000) return;
        meta.usage.injectionCount += 1;
        meta.usage.lastInjectedAt = Date.now();
        meta.usage.lastInjectedRoundIndex = roundIndex;
    }

    function renderRowMetaSummary(row, table) {
        const meta = ensureRowMeta(row, table, '');
        const tags = meta.tagBundle;
        const policy = meta.usePolicy;
        const effectLabel = EFFECTS[tags.effect]?.label || tags.effect;
        const chips = [effectLabel, ...tags.topic.slice(0, 2), ...tags.scene.slice(0, 1)];
        const life = window.MemoryTableLifecycle ? window.MemoryTableLifecycle.renderRowSummary(row, table) : '';
        const feedback = window.MemoryTableFeedback ? window.MemoryTableFeedback.ensureRowMeta(row) : row.meta?.feedback;
        const feedbackText = feedback && Math.abs(Number(feedback.weight) || 0) >= 0.005
            ? ` · 反馈权重 ${Number(feedback.weight) > 0 ? '+' : ''}${Number(feedback.weight).toFixed(2)}` : '';
        return `<div class="memory-effect-summary ${policy.paused ? 'paused' : ''}">
            <div class="memory-effect-chips">${chips.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>
            <div class="memory-effect-note">${policy.paused ? '已暂停' : `影响 ${escapeHtml(policy.maxInfluence)} · 冷却 ${policy.cooldownRounds} 轮${feedbackText}`}</div>
        </div>${life}`;
    }

    function editRowPolicy(row, table) {
        const meta = ensureRowMeta(row, table, '');
        if (typeof window.prompt !== 'function') return false;
        const topics = window.prompt('主题标签（逗号分隔）', meta.tagBundle.topic.join(', '));
        if (topics === null) return false;
        const scenes = window.prompt('允许召回的场景标签（逗号分隔；留空表示不限）', meta.tagBundle.scene.join(', '));
        if (scenes === null) return false;
        const entities = window.prompt('实体标签（人物/项目/地点，逗号分隔）', meta.tagBundle.entity.join(', '));
        if (entities === null) return false;
        const effect = window.prompt('作用类型：fact / temporary_state / soft_preference / hard_boundary / reminder / historical_context / candidate', meta.tagBundle.effect);
        if (effect === null) return false;
        const blocked = window.prompt('禁止场景（逗号分隔；留空表示无）', meta.usePolicy.blockedScenes.join(', '));
        if (blocked === null) return false;
        const cooldown = window.prompt('冷却轮数', String(meta.usePolicy.cooldownRounds));
        if (cooldown === null) return false;
        meta.tagBundle = normalizeTagBundle({
            topic: String(topics).split(/[,，]/),
            scene: String(scenes).split(/[,，]/),
            entity: String(entities).split(/[,，]/),
            effect
        }, { table, text: '' });
        meta.tags = unique(meta.tagBundle.topic);
        meta.usePolicy = normalizeUsePolicy({
            ...meta.usePolicy,
            blockedScenes: String(blocked).split(/[,，]/),
            cooldownRounds: Number(cooldown) || 0
        }, meta.tagBundle.effect);
        meta.updatedAt = Date.now();
        meta.retrievalVector = [];
        meta.retrievalVectorFingerprint = '';
        meta.retrievalIndexedAt = 0;
        return true;
    }

    function migrateRows(chat, templates) {
        if (!chat?.memoryTables?.data) return 0;
        let changed = 0;
        (templates || []).forEach(template => {
            (template.tables || []).forEach(table => {
                const rows = chat.memoryTables.data?.[template.id]?.[table.id]?.__rows;
                if (!Array.isArray(rows)) return;
                rows.forEach(row => {
                    const before = JSON.stringify({ tagBundle: row.meta?.tagBundle, usePolicy: row.meta?.usePolicy, usage: row.meta?.usage, feedback: row.meta?.feedback, evidence: row.meta?.evidence, lifecycle: row.meta?.lifecycle, relations: row.meta?.relations });
                    const text = (table.columns || []).map(field => `${field.key}: ${row.cells?.[field.id] ?? ''}`).join('\n');
                    ensureRowMeta(row, table, text);
                    const after = JSON.stringify({ tagBundle: row.meta?.tagBundle, usePolicy: row.meta?.usePolicy, usage: row.meta?.usage, feedback: row.meta?.feedback, evidence: row.meta?.evidence, lifecycle: row.meta?.lifecycle, relations: row.meta?.relations });
                    if (before !== after) changed += 1;
                });
            });
        });
        return changed;
    }

    const api = {
        VERSION,
        EFFECTS,
        normalizeTagBundle,
        normalizeUsePolicy,
        normalizeUsage,
        ensureRowMeta,
        classifyQuery,
        evaluateItem,
        getPromptDirective,
        markRetrieved,
        markInjected,
        renderRowMetaSummary,
        editRowPolicy,
        migrateRows
    };

    if (Kernel) Kernel.register('effects', api, { legacyGlobal: 'MemoryTableEffects' });
    else window.MemoryTableEffects = api;
})();
