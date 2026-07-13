(function () {
    'use strict';

    const VERSION = '5.4.1';
    const DEFAULT_EVENT_PROMPT = `你是角色本人的长期事件记忆整理器。你将收到角色设定、用户设定、完整门牌、完整印象、相关旧事件，以及一批新对话。

【第一人称事件记忆规则】
1. 所有事件必须站在角色本人视角书写，必须使用“我”。
2. 禁止用角色名字、“角色”“助手”“AI”称呼角色自己。
3. 用户使用用户设定中的实际称呼；没有称呼时才使用“用户”。

正确示例：
- 她告诉我昨晚因为腰疼醒了三次。
- 我注意到她今天很疲惫。
- 我当时认为应该先确认疼痛，而不是立刻分析情绪。

错误示例：
- 阿沉会把这看作依恋表现。
- 角色认为用户需要休息。
- 助手发现用户睡眠不好。

【事实和角色理解必须分开】
1. factualSummary：使用我的第一人称，记录对话中明确发生或明确说出的事实。
   可以写“她告诉我……”“她明确说……”“我问了她……她回答……”“我们最后约定……”。
   不得加入未经确认的心理解释、人格判断或因果推测。
2. characterView：使用我的第一人称，记录我当时的理解、感受或后续回应思路。
   使用“我当时认为……”“我有些担心……”“我暂时理解为……”“这可能意味着……但证据不足”。
   角色理解不是客观事实，必须允许被后续纠正。
3. 不得写“她就是……”“她一定是……”“她潜意识里……”“她只有我……”“她已经形成深度依赖……”，除非用户本人明确且持续表达相同含义。

【核心规则】
1. 一条事件只描述一个完整事件；不要生成同一事件的长版和短版。
2. 不要因为一次事件就总结成长期人格或长期模式。
3. 不要把我在对话中说过的浪漫化、占有式或夸张台词当作用户事实。
4. 用户对旧理解作出纠正时，必须记录纠正；当前用户明确表达高于已有记忆。
5. sourceMessageIds 只能使用输入中真实存在的消息 ID，并尽量精确到支持该事件的消息。
6. 关键词使用简短、稳定、可复用的中文词语。
7. 事件明显属于一件仍在发展的事情时，可以填写 eventBoxHint 和 eventBoxKeywords；这只是建议，系统不会自动合并。
8. 没有值得长期保存的内容时返回 []。
9. 普通事件建议 40～100 字；重要事件建议 80～180 字。不要为了表现感情而重复修辞。

只输出合法 JSON 数组，不要输出 Markdown。格式：
[
  {
    "title": "简短标题",
    "factualSummary": "使用角色第一人称记录的明确事实",
    "characterView": "使用角色第一人称记录的主观理解、感受或回应思路",
    "viewConfidence": 0.0,
    "outcome": "事件结果或当前状态；不确定则为空字符串",
    "occurredAt": "YYYY-MM-DD 或完整 ISO 时间；不确定则为空字符串",
    "keywords": ["关键词"],
    "aliases": ["同义表达"],
    "importance": 1,
    "mood": "neutral",
    "valence": 0.0,
    "arousal": 0.0,
    "sourceMessageIds": ["msg_xxx"],
    "pinDays": 0,
    "eventBoxHint": "可选：同一持续事件的建议名称",
    "eventBoxKeywords": ["可选关联词"]
  }
]`;


    const DEFAULT_ARCHIVE_PROMPT = `你是长期记忆门牌蒸馏器。请根据新增事件和现有门牌，谨慎更新 SullyOS RoomPlate 条目。

门牌只保存已经沉淀成常识的短句，不保存具体事件流水，也不负责生成人物印象。

规则：
1. text 必须是短而稳定的一句话，避免事件复述、浪漫化长文和绝对化判断。
2. 只有明确事实、稳定偏好、长期边界或多次独立事件支持的信息才能进入门牌。
3. 一次事件通常不能建立长期条目；证据不足时不要创建。
4. targetId 只能使用输入中的门牌 entry id；证据 ID 只能使用输入中的事件 ID。
5. action 只能是 create、update、archive。archive 仅用于明确过时或错误。
6. room 只能使用 user_room、self_room、bedroom、study。
7. sourceCount 表示支持条目的独立事件数量；更新时反映累积印证次数。
8. 不生成印象档案；印象由独立的低频任务维护。
9. 没有可靠建议时返回空数组。

只输出合法 JSON 对象，不要输出 Markdown：
{
  "summary": "本次门牌蒸馏说明",
  "doorplates": [
    {"action":"create|update|archive","targetId":"","room":"user_room","tag":"作息","text":"稳定的一句话","sourceCount":1,"sourceEventIds":[]}
  ]
}`;

    const DEFAULT_IMPRESSION_PROMPT = `你是角色的长期私密印象档案整理器。请生成或增量更新 SullyOS UserImpression v3.0 结构。

核心规则：
1. 这是一份角色第一人称的长期私人笔记，不是临床诊断。
2. 人设、完整门牌、主题档案和长期事件拥有高权重；最近聊天只用于 emotion_summary 与 observed_changes，避免近因偏差。
3. 不要把一次事件、助手自己的夸张表达、占有式台词或角色扮演偏好直接升级为用户本质。
4. 保留长期稳定判断；除非有重大转折，不因几句近期聊天彻底推翻人格核心。
5. observed_changes 每项必须是字符串。
6. 只输出合法 JSON，不要 Markdown。

严格输出：
{
  "version": 3.0,
  "lastUpdated": 0,
  "value_map": {"likes": [], "dislikes": [], "core_values": ""},
  "behavior_profile": {"tone_style": "", "emotion_summary": "", "response_patterns": ""},
  "emotion_schema": {"triggers": {"positive": [], "negative": []}, "comfort_zone": "", "stress_signals": []},
  "personality_core": {"observed_traits": [], "interaction_style": "", "summary": ""},
  "mbti_analysis": {"type": "", "reasoning": "", "dimensions": {"e_i": 50, "s_n": 50, "t_f": 50, "j_p": 50}},
  "observed_changes": []
}`;


    const DEFAULT_EVENT_BOX_PROMPT = `你是连续事件整理器。请根据一个 EventBox 的已有状态和新加入事件，更新这件事的连续时间线概括。

规则：
1. EventBox 只描述同一件事的发展，不总结跨事件人格或长期模式。
2. summary 概括已发生的发展；currentStage 描述现在进行到哪里。
3. 只有事件明确说明事情已经结束，status 才能设为 completed；否则保持 ongoing。
4. unresolvedQuestions 只保留仍未解决且有现实依据的问题。
5. keywords 使用简短稳定词语。
6. 不得制造对话中没有的结果、动机或诊断。

只输出合法 JSON 对象，不要输出 Markdown：
{"summary":"","currentStage":"","status":"ongoing|completed","unresolvedQuestions":[],"keywords":[]}`;

    const DEFAULT_TOPIC_SECTIONS = [
        '当前状态', '稳定模式', '暂定模式', '触发因素', '具体表现', '身体因素',
        '有效方式', '无效方式', '白天影响', '变化与进展', '矛盾证据', '待确认问题'
    ];

    const DEFAULT_TOPIC_PROMPT = `你是长期主题档案整理器。你将收到一个由用户确认的主题、已有结构化档案、新增证据、历史证据、相关门牌、相关印象和 EventBox。

你的任务不是复述事件，而是更新跨事件主题档案，并保持与已有记忆和角色理解的连续性。

核心规则：
1. 事实、角色印象和推测必须分开。助手过去说过的判断不能自动成为用户事实。
2. 一次事件不能建立稳定模式。稳定模式通常至少需要 3 个不同事件支持；若用户在证据中明确表示“经常、一直、每次”等长期性，可设置 directlyStatedRecurrent=true。
3. 证据不足的结论放入“暂定模式”，不要为了填满分区而制造结论。
4. 必须保留反例、矛盾、变化与进展，不能只累计问题。
5. 新证据与旧结论冲突时，应降低置信度、移入矛盾证据或删除已不成立的结论。
6. 当前用户表达高于历史档案；不要作医学、心理或人格诊断。
7. evidenceEventIds 只能使用输入中提供的事件 ID。
8. 输出的是完整更新后档案，不是补丁。没有内容的分区返回空数组。
9. statement 应简洁、可执行、避免浪漫化、绝对化和占有式语言。
10. 自定义主题要求必须遵守，但不能覆盖以上证据规则。

只输出合法 JSON 对象，不要输出 Markdown。格式：
{
  "summary": "对本次主题更新的简短说明",
  "sections": {
    "分区名称": [
      {
        "statement": "结论",
        "confidence": 0.0,
        "evidenceEventIds": ["event_xxx"],
        "status": "active",
        "directlyStatedRecurrent": false
      }
    ]
  }
}`;

    const ui = {
        tab: 'overview',
        editingType: null,
        editingId: null,
        editorDraft: null,
        debugQuery: '',
        extractionLogs: [],
        batchRunning: false,
        batchStopRequested: false,
        batchProgress: null
    };

    function safeDebugValue(value) {
        try {
            return JSON.parse(JSON.stringify(value, (key, item) => {
                if (/key|token|authorization/i.test(key)) return '[已隐藏]';
                if (typeof item === 'string' && item.length > 6000) return `${item.slice(0, 6000)}…[已截断]`;
                return item;
            }));
        } catch (_) {
            return String(value);
        }
    }

    function extractionDebug(stage, details, level) {
        const character = getCharacter();
        const state = character ? ensureState(character) : null;
        if (state && state.debugEnabled === false) return;
        const entry = {
            at: new Date().toISOString(),
            stage: String(stage || 'log'),
            level: level || 'info',
            details: safeDebugValue(details || {})
        };
        ui.extractionLogs.unshift(entry);
        if (ui.extractionLogs.length > 120) ui.extractionLogs.length = 120;
        window.__UnifiedMemoryLastExtractionDebug = entry;
        const method = entry.level === 'error' ? 'error' : (entry.level === 'warn' ? 'warn' : 'info');
        const label = `[UnifiedMemory:Extract] ${entry.stage}`;
        try {
            console.groupCollapsed(label);
            console[method](entry.details);
            console.groupEnd();
        } catch (_) {
            console[method](label, entry.details);
        }
        return entry;
    }

    function isUnifiedMemoryExclusiveMode(character) {
        const state = ensureState(character);
        return !!(state && state.enabled && state.exclusiveMode !== false);
    }

    function clearUnifiedMemoryScreenOverrides() {
        const screen = document.getElementById('unified-memory-screen');
        if (!screen) return;
        ['display','visibility','opacity','position','inset','width','height','zIndex','background'].forEach(key => {
            try { screen.style[key] = ''; } catch (_) {}
        });
    }

    function closeUnifiedMemoryCenter() {
        clearUnifiedMemoryScreenOverrides();
        const screen = document.getElementById('unified-memory-screen');
        if (screen) screen.classList.remove('active');
        if (typeof switchScreen === 'function') switchScreen('chat-settings-screen');
        const target = document.getElementById('chat-settings-screen');
        if (target) target.classList.add('active');
    }

    function disableLegacyMemoryUi() {
        const ids = [
            'setting-auto-journal-enabled', 'setting-memory-mode', 'setting-open-vector-memory-btn',
            'setting-open-memory-table-btn', 'setting-auto-journal-interval', 'setting-auto-journal-retry-btn'
        ];
        ids.forEach(id => {
            const element = document.getElementById(id);
            const row = element && element.closest('.kkt-item');
            if (row) row.style.display = 'none';
        });
        document.querySelectorAll('[data-memory-mode-switch],[data-vector-memory-mode-switch]').forEach(button => {
            button.disabled = true;
            button.style.display = 'none';
        });
        const openButton = document.getElementById('setting-open-unified-memory-btn');
        if (openButton) {
            const row = openButton.closest('.kkt-item');
            const label = row && row.querySelector('.kkt-item-label');
            if (label) label.innerHTML = '统一记忆中心 <span style="font-size:10px;color:#999;">V5.4 · 第一人称事件/完整记忆上下文</span>';
            if (row && !document.getElementById('unified-memory-exclusive-note')) {
                const note = document.createElement('div');
                note.id = 'unified-memory-exclusive-note';
                note.className = 'kkt-item';
                note.innerHTML = '<div class="kkt-item-label" style="color:#888;font-size:12px;line-height:1.5;">旧日记、结构化记忆和旧向量记忆已停止自动生成与 Prompt 注入。现由统一记忆独占长期记忆。</div>';
                row.insertAdjacentElement('afterend', note);
            }
        }
    }

    function uid(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function normalizeText(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[\s\u3000]+/g, '')
            .replace(/[，。！？、；：,.!?;:'"“”‘’（）()【】\[\]{}<>《》~`]/g, '');
    }

    function parseList(value) {
        if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
        return String(value || '')
            .split(/[，,、\n;；]+/)
            .map(item => item.trim())
            .filter(Boolean)
            .filter((item, index, arr) => arr.indexOf(item) === index);
    }

    const SULLY_ROOM_LABELS = {
        living_room: '客厅', bedroom: '卧室', study: '书房', user_room: '用户房间',
        self_room: '自我房间', attic: '阁楼', windowsill: '窗台', general: '通用'
    };

    function sullyRoomLabel(room) {
        return SULLY_ROOM_LABELS[room] || String(room || '未分类');
    }

    function plateText(item, type) {
        return String(item?.text || (type === 'doorplate' ? item?.content : item?.statement) || '');
    }

    function plateTag(item, type) {
        return String(item?.tag || (type === 'doorplate' ? item?.category : item?.dimension) || '未分类');
    }

    function groupPlateItems(items) {
        const map = new Map();
        (items || []).filter(item => item.status !== 'archived').forEach(item => {
            const room = item.room || 'general';
            if (!map.has(room)) map.set(room, []);
            map.get(room).push(item);
        });
        return [...map.entries()].sort((a, b) => {
            const order = ['user_room','study','living_room','bedroom','self_room','attic','windowsill','general'];
            return order.indexOf(a[0]) - order.indexOf(b[0]);
        });
    }


    const SULLY_PLATE_ORDER = ['user_room', 'self_room', 'bedroom', 'study'];
    const SULLY_PLATE_DESCRIPTIONS = { user_room: '关于 TA 的稳定事实', self_room: '关于我自己的稳定认知', bedroom: '我们之间的关系与默契', study: '能力、工作与共同研究领域' };
    const SULLY_PLATE_LABELS = {
        user_room: '关于TA', self_room: '关于我', bedroom: '我们之间', study: '我的领域'
    };
    const SULLY_PLATE_CAPACITY = { user_room: 12, self_room: 10, bedroom: 10, study: 8 };

    function normalizeRoomPlateEntry(entry) {
        if (!entry.id) entry.id = uid('pe');
        entry.text = String(entry.text || '').trim();
        entry.tag = String(entry.tag || '').trim();
        if (!entry.firstLearnedAt) entry.firstLearnedAt = entry.updatedAt || Date.now();
        if (!entry.updatedAt) entry.updatedAt = Date.now();
        entry.sourceCount = Math.max(1, Number(entry.sourceCount || 1));
        return entry;
    }

    function normalizeRoomPlate(plate, characterId) {
        if (!plate || typeof plate !== 'object') plate = {};
        const room = SULLY_PLATE_ORDER.includes(plate.room) ? plate.room : 'user_room';
        plate.room = room;
        plate.charId = characterId || plate.charId || '';
        plate.id = plate.id || `${plate.charId}:${room}`;
        if (!Array.isArray(plate.entries)) plate.entries = [];
        plate.entries = plate.entries.map(normalizeRoomPlateEntry).filter(entry => entry.text);
        if (!plate.updatedAt) plate.updatedAt = Date.now();
        plate.version = Math.max(1, Number(plate.version || 1));
        return plate;
    }

    function migrateLegacyDoorplates(state, character) {
        if (Array.isArray(state.roomPlates) && state.roomPlates.length) return;
        const legacy = Array.isArray(state.doorplates) ? state.doorplates.filter(item => item && item.status !== 'archived') : [];
        state.roomPlates = SULLY_PLATE_ORDER.map(room => ({
            id: `${character.id}:${room}`, charId: character.id, room, version: 1, updatedAt: Date.now(),
            entries: legacy.filter(item => (item.room || 'user_room') === room).map(item => ({
                id: item.id || uid('pe'), text: plateText(item, 'doorplate'), tag: plateTag(item, 'doorplate'),
                firstLearnedAt: item.firstLearnedAt || item.createdAt || Date.now(),
                updatedAt: item.updatedAt || Date.now(), sourceCount: Math.max(1, Number(item.sourceCount || item.evidenceCount || 1))
            })).filter(entry => entry.text)
        }));
    }

    function ensureRoomPlates(state, character) {
        migrateLegacyDoorplates(state, character);
        const byRoom = new Map((state.roomPlates || []).map(plate => [plate.room, normalizeRoomPlate(plate, character.id)]));
        state.roomPlates = SULLY_PLATE_ORDER.map(room => byRoom.get(room) || normalizeRoomPlate({ room, charId: character.id, entries: [] }, character.id));
        return state.roomPlates;
    }

    function getRoomPlateEntryRows(state) {
        return (state.roomPlates || []).flatMap(plate => (plate.entries || []).map(entry => ({
            id: entry.id, room: plate.room, tag: entry.tag, text: entry.text,
            firstLearnedAt: entry.firstLearnedAt, updatedAt: entry.updatedAt, sourceCount: entry.sourceCount,
            status: 'active', sendPolicy: state.retrieval?.roomPlateMode || 'keyword',
            priority: 70 + Math.min(30, Number(entry.sourceCount || 1)),
            keywords: entry.tag ? [entry.tag] : [], aliases: [], negativeKeywords: [], linkedTopicIds: [],
            searchText: entry.text || '', _plateId: plate.id
        })));
    }

    function findRoomPlateEntry(state, id) {
        for (const plate of state.roomPlates || []) {
            const entry = (plate.entries || []).find(item => item.id === id);
            if (entry) return { plate, entry };
        }
        return null;
    }

    function roomPlateEntryCount(state) {
        return (state.roomPlates || []).reduce((sum, plate) => sum + (plate.entries || []).length, 0);
    }

    function normalizeUserImpressionLocal(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const arr = value => Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : [];
        const text = value => typeof value === 'string' ? value : '';
        const num = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
        const has = raw.value_map || raw.behavior_profile || raw.emotion_schema || raw.personality_core || raw.mbti_analysis || raw.observed_changes;
        if (!has) return null;
        return {
            version: num(raw.version, 3), lastUpdated: num(raw.lastUpdated, Date.now()),
            value_map: { likes: arr(raw.value_map?.likes), dislikes: arr(raw.value_map?.dislikes), core_values: text(raw.value_map?.core_values) },
            behavior_profile: { tone_style: text(raw.behavior_profile?.tone_style), emotion_summary: text(raw.behavior_profile?.emotion_summary), response_patterns: text(raw.behavior_profile?.response_patterns) },
            emotion_schema: { triggers: { positive: arr(raw.emotion_schema?.triggers?.positive), negative: arr(raw.emotion_schema?.triggers?.negative) }, comfort_zone: text(raw.emotion_schema?.comfort_zone), stress_signals: arr(raw.emotion_schema?.stress_signals) },
            personality_core: { observed_traits: arr(raw.personality_core?.observed_traits), interaction_style: text(raw.personality_core?.interaction_style), summary: text(raw.personality_core?.summary) },
            mbti_analysis: raw.mbti_analysis && typeof raw.mbti_analysis === 'object' ? { type: text(raw.mbti_analysis.type), reasoning: text(raw.mbti_analysis.reasoning), dimensions: { e_i: num(raw.mbti_analysis.dimensions?.e_i, 50), s_n: num(raw.mbti_analysis.dimensions?.s_n, 50), t_f: num(raw.mbti_analysis.dimensions?.t_f, 50), j_p: num(raw.mbti_analysis.dimensions?.j_p, 50) } } : undefined,
            observed_changes: arr(raw.observed_changes)
        };
    }

    function formatStructuredImpression(impression) {
        const imp = normalizeUserImpressionLocal(impression);
        if (!imp) return '';
        const lines = [];
        if (imp.personality_core.summary) lines.push(`核心印象：${imp.personality_core.summary}`);
        if (imp.personality_core.interaction_style) lines.push(`互动模式：${imp.personality_core.interaction_style}`);
        if (imp.behavior_profile.tone_style) lines.push(`语气感知：${imp.behavior_profile.tone_style}`);
        if (imp.behavior_profile.emotion_summary) lines.push(`近期情绪：${imp.behavior_profile.emotion_summary}`);
        if (imp.behavior_profile.response_patterns) lines.push(`回应模式：${imp.behavior_profile.response_patterns}`);
        if (imp.personality_core.observed_traits.length) lines.push(`观察特质：${imp.personality_core.observed_traits.join('、')}`);
        if (imp.value_map.likes.length) lines.push(`喜欢：${imp.value_map.likes.join('、')}`);
        if (imp.value_map.dislikes.length) lines.push(`不喜欢：${imp.value_map.dislikes.join('、')}`);
        if (imp.value_map.core_values) lines.push(`核心价值观：${imp.value_map.core_values}`);
        if (imp.emotion_schema.triggers.positive.length) lines.push(`正向触发：${imp.emotion_schema.triggers.positive.join('、')}`);
        if (imp.emotion_schema.triggers.negative.length) lines.push(`压力/雷区：${imp.emotion_schema.triggers.negative.join('、')}`);
        if (imp.emotion_schema.comfort_zone) lines.push(`舒适区：${imp.emotion_schema.comfort_zone}`);
        if (imp.emotion_schema.stress_signals.length) lines.push(`压力信号：${imp.emotion_schema.stress_signals.join('、')}`);
        if (imp.mbti_analysis?.type) lines.push(`MBTI侧写：${imp.mbti_analysis.type}${imp.mbti_analysis.reasoning ? `（${imp.mbti_analysis.reasoning}）` : ''}`);
        if (imp.observed_changes.length) lines.push(`近期变化：${imp.observed_changes.join('；')}`);
        return lines.join('\n');
    }

    function meaningfulBigrams(value) {
        const clean = normalizeText(value);
        const stop = new Set(['用户','角色','自己','可以','时候','需要','一个','这个','没有','已经','不是','因为','如果','就是','什么','他们','我们','她的','他的','我的','User']);
        const grams = new Set();
        for (let index = 0; index < clean.length - 1; index += 1) {
            const gram = clean.slice(index, index + 2);
            if (/^[\u4e00-\u9fff]{2}$/.test(gram) && !stop.has(gram)) grams.add(gram);
        }
        return grams;
    }

    function impressionRoutingItem(state) {
        const impression = normalizeUserImpressionLocal(state.impression);
        if (!impression) return null;
        const keywords = [
            ...(impression.value_map.likes || []), ...(impression.value_map.dislikes || []),
            ...(impression.personality_core.observed_traits || []),
            ...(impression.emotion_schema.triggers.positive || []), ...(impression.emotion_schema.triggers.negative || []),
            ...(impression.emotion_schema.stress_signals || []), ...(impression.observed_changes || []),
            impression.mbti_analysis?.type || ''
        ].filter(Boolean);
        return {
            id: 'structured-impression', keywords, aliases: [], negativeKeywords: [],
            searchText: [impression.value_map.core_values, impression.emotion_schema.comfort_zone,
                impression.personality_core.interaction_style, impression.behavior_profile.response_patterns].filter(Boolean).join(' '),
            sendPolicy: state.retrieval?.impressionMode || 'keyword', priority: 80
        };
    }

    function clamp(value, min, max, fallback) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    }

    function createDefaultState() {
        return {
            version: VERSION,
            enabled: true,
            injectionEnabled: true,
            exclusiveMode: true,
            debugEnabled: true,
            roomPlates: [],
            impression: null,
            doorplates: [],
            impressions: [],
            workingMemories: [],
            events: [],
            eventBoxes: [],
            topics: [],
            topicDecisions: {},
            topicVersions: [],
            jobs: [],
            automation: {
                enabled: true,
                autoRunAfterReply: true,
                autoStartOnOpen: true,
                archiveAutoApply: true,
                eventExtractionEnabled: true,
                eventMessageThreshold: 8,
                eventBatchLimit: 60,
                archiveConsolidationEnabled: true,
                archiveEventThreshold: 4,
                impressionUpdateEnabled: true,
                impressionEventThreshold: 20,
                impressionAnalyzedEventIds: [],
                eventBoxUpdateEnabled: true,
                eventBoxNewEventThreshold: 1,
                topicUpdateEnabled: true,
                embeddingGenerateEnabled: true,
                embeddingBatchSize: 12,
                maintenanceEnabled: true,
                maintenanceIntervalHours: 24,
                maxJobsPerRun: 3,
                maxAttempts: 3,
                retryDelayMinutes: 15,
                runningTimeoutMinutes: 20,
                lastProcessedMessageId: null,
                lastProcessedMessageTimestamp: 0,
                archiveAnalyzedEventIds: [],
                lastMaintenanceAt: 0,
                lastSchedulerAt: 0
            },
            vector: {
                enabled: false,
                similarityThreshold: 0.55,
                duplicateThreshold: 0.93,
                eventBoxThreshold: 0.82,
                vectorScoreWeight: 45,
                maxVectorCandidates: 8,
                lastError: '',
                lastQueryEmbeddingAt: null,
                lastModelSignature: ''
            },
            topicSettings: {
                minEvents: 5,
                minDays: 3,
                recentDays: 30,
                deferDays: 14
            },
            prompts: {
                eventExtraction: DEFAULT_EVENT_PROMPT,
                topicUpdate: DEFAULT_TOPIC_PROMPT,
                archiveConsolidation: DEFAULT_ARCHIVE_PROMPT,
                impressionUpdate: DEFAULT_IMPRESSION_PROMPT,
                eventBoxUpdate: DEFAULT_EVENT_BOX_PROMPT
            },
            retrieval: {
                recentUserMessages: 3,
                roomPlateMode: 'keyword',
                impressionMode: 'keyword',
                maxDoorplates: 40,
                maxImpressions: 1,
                maxTopics: 3,
                maxEventBoxes: 3,
                maxEvents: 5,
                workingBudget: 900,
                doorplateBudget: 4200,
                impressionBudget: 3600,
                topicBudget: 1800,
                eventBoxBudget: 1000,
                eventBudget: 2200,
                totalBudget: 8000,
                lastQueryText: '',
                lastContextBlock: '',
                lastPreparedAt: null,
                lastDebug: null
            }
        };
    }

    function ensureState(character) {
        if (!character) return null;
        if (!character.unifiedMemory || typeof character.unifiedMemory !== 'object') {
            character.unifiedMemory = createDefaultState();
        }
        const state = character.unifiedMemory;
        if (!Array.isArray(state.doorplates)) state.doorplates = [];
        if (!Array.isArray(state.impressions)) state.impressions = [];
        if (!Array.isArray(state.roomPlates)) state.roomPlates = [];
        state.impression = normalizeUserImpressionLocal(state.impression || state.sullyImpression || null);
        if (!Array.isArray(state.workingMemories)) state.workingMemories = [];
        if (!Array.isArray(state.events)) state.events = [];
        if (!Array.isArray(state.eventBoxes)) state.eventBoxes = [];
        if (!Array.isArray(state.topics)) state.topics = [];
        if (!state.topicDecisions || typeof state.topicDecisions !== 'object') state.topicDecisions = {};
        if (!Array.isArray(state.topicVersions)) state.topicVersions = [];
        if (!Array.isArray(state.jobs)) state.jobs = [];
        if (!state.automation || typeof state.automation !== 'object') state.automation = {};
        const automationDefaults = createDefaultState().automation;
        Object.keys(automationDefaults).forEach(key => {
            if (state.automation[key] === undefined) state.automation[key] = clone(automationDefaults[key]);
        });
        if (!Array.isArray(state.automation.archiveAnalyzedEventIds)) state.automation.archiveAnalyzedEventIds = [];
        if (!Array.isArray(state.automation.impressionAnalyzedEventIds)) state.automation.impressionAnalyzedEventIds = [];
        if (!state.automation.v52AutoConfigured) {
            state.automation.enabled = true;
            state.automation.autoRunAfterReply = true;
            state.automation.autoStartOnOpen = true;
            state.automation.archiveAutoApply = true;
            state.automation.eventExtractionEnabled = true;
            state.automation.archiveConsolidationEnabled = true;
            state.automation.eventMessageThreshold = Math.min(Number(state.automation.eventMessageThreshold || 8), 8);
            state.automation.archiveEventThreshold = Math.min(Number(state.automation.archiveEventThreshold || 4), 4);
            state.automation.v52AutoConfigured = true;
        }
        if (!state.vector || typeof state.vector !== 'object') state.vector = {};
        const vectorDefaults = createDefaultState().vector;
        Object.keys(vectorDefaults).forEach(key => {
            if (state.vector[key] === undefined) state.vector[key] = clone(vectorDefaults[key]);
        });
        if (!state.topicSettings || typeof state.topicSettings !== 'object') state.topicSettings = {};
        const topicDefaults = createDefaultState().topicSettings;
        Object.keys(topicDefaults).forEach(key => {
            if (state.topicSettings[key] === undefined) state.topicSettings[key] = topicDefaults[key];
        });
        if (!state.prompts || typeof state.prompts !== 'object') state.prompts = {};
        if (!state.prompts.eventExtraction) state.prompts.eventExtraction = DEFAULT_EVENT_PROMPT;
        else {
            const currentEventPrompt = String(state.prompts.eventExtraction);
            if (!currentEventPrompt.includes('【第一人称事件记忆规则】')) {
                state.prompts.eventExtraction = `${currentEventPrompt.trim()}

【第一人称事件记忆规则】
所有 factualSummary 与 characterView 都必须站在角色本人视角，使用“我”。禁止用角色名字、“角色”“助手”或“AI”称呼角色自己。用户使用用户设定中的实际称呼。事实与我的理解必须分开，我的推测必须允许被后续纠正。`;
            }
            if (!String(state.prompts.eventExtraction).includes('eventBoxHint')) {
                state.prompts.eventExtraction += `

补充字段：如果事件明显属于一件仍在发展中的事情，请在每条 JSON 中增加 eventBoxHint（建议事件盒名称）和 eventBoxKeywords（关联词数组）。这只是建议，系统不会自动合并。`;
            }
        }
        if (!state.prompts.topicUpdate) state.prompts.topicUpdate = DEFAULT_TOPIC_PROMPT;
        if (!state.prompts.archiveConsolidation) state.prompts.archiveConsolidation = DEFAULT_ARCHIVE_PROMPT;
        if (!state.prompts.impressionUpdate) state.prompts.impressionUpdate = DEFAULT_IMPRESSION_PROMPT;
        if (!state.prompts.eventBoxUpdate) state.prompts.eventBoxUpdate = DEFAULT_EVENT_BOX_PROMPT;
        if (!state.retrieval || typeof state.retrieval !== 'object') state.retrieval = {};
        const defaults = createDefaultState().retrieval;
        Object.keys(defaults).forEach(key => {
            if (state.retrieval[key] === undefined) state.retrieval[key] = defaults[key];
        });
        state.version = VERSION;
        if (state.enabled === undefined) state.enabled = true;
        if (state.injectionEnabled === undefined) state.injectionEnabled = true;
        if (state.exclusiveMode === undefined) state.exclusiveMode = true;
        if (state.debugEnabled === undefined) state.debugEnabled = true;

        ensureRoomPlates(state, character);
        state.doorplates = getRoomPlateEntryRows(state);
        state.impressions = [];
        state.workingMemories.forEach(normalizeWorkingItem);
        state.events.forEach(normalizeEventItem);
        state.eventBoxes.forEach(normalizeEventBox);
        state.topics.forEach(normalizeTopic);
        state.jobs.forEach(normalizeJob);
        recoverStaleJobs(state);
        return state;
    }

    function normalizeArchiveItem(item, type) {
        if (!item.id) item.id = uid(type);
        item.archiveType = type;
        if (!item.room) item.room = type === 'doorplate' ? 'user_room' : 'bedroom';
        if (!item.text) item.text = String(type === 'doorplate' ? (item.content || '') : (item.statement || ''));
        if (!item.tag) item.tag = String(type === 'doorplate' ? (item.category || '') : (item.dimension || ''));
        if (type === 'doorplate') { item.content = item.text; item.category = item.tag; }
        else { item.statement = item.text; item.dimension = item.tag; }
        if (!Array.isArray(item.keywords)) item.keywords = parseList(item.keywords);
        if (!item.keywords.length && item.tag) item.keywords = [item.tag];
        if (!Array.isArray(item.aliases)) item.aliases = parseList(item.aliases);
        if (!Array.isArray(item.negativeKeywords)) item.negativeKeywords = parseList(item.negativeKeywords);
        if (!Array.isArray(item.sourceEventIds)) item.sourceEventIds = [];
        if (!Array.isArray(item.supportingEventIds)) item.supportingEventIds = [];
        if (!Array.isArray(item.counterEventIds)) item.counterEventIds = [];
        if (!Array.isArray(item.linkedTopicIds)) item.linkedTopicIds = parseList(item.linkedTopicIds);
        if (!item.sendPolicy) item.sendPolicy = 'keyword';
        if (!item.status) item.status = 'active';
        if (!Number.isFinite(Number(item.priority))) item.priority = type === 'doorplate' ? 70 : 65;
        if (!Number.isFinite(Number(item.confidence))) item.confidence = Math.min(0.98, 0.55 + Math.log10(Math.max(1, Number(item.sourceCount || item.evidenceCount || 1))) * 0.18);
        if (!item.firstLearnedAt) item.firstLearnedAt = item.createdAt || item.updatedAt || Date.now();
        if (!item.updatedAt) item.updatedAt = Date.now();
        if (!Number.isFinite(Number(item.sourceCount))) item.sourceCount = Number(item.evidenceCount || item.sourceEventIds.length || item.supportingEventIds.length || 1);
        item.evidenceCount = Number(item.sourceCount || 0);
        if (item.locked === undefined) item.locked = false;
        if (item.manualActive === undefined) item.manualActive = false;
    }

    function normalizeWorkingItem(item) {
        if (!item.id) item.id = uid('working');
        if (!Array.isArray(item.keywords)) item.keywords = parseList(item.keywords);
        if (!item.createdAt) item.createdAt = Date.now();
        if (!Number.isFinite(Number(item.priority))) item.priority = 90;
        if (!item.status) item.status = 'active';
    }

    function normalizeEventItem(item) {
        if (!item.id) item.id = uid('event');
        if (!Array.isArray(item.keywords)) item.keywords = parseList(item.keywords);
        if (!Array.isArray(item.aliases)) item.aliases = parseList(item.aliases);
        if (!Array.isArray(item.sourceMessageIds)) item.sourceMessageIds = [];
        if (!Array.isArray(item.topicIds)) item.topicIds = parseList(item.topicIds);
        if (!Array.isArray(item.eventBoxKeywords)) item.eventBoxKeywords = parseList(item.eventBoxKeywords);
        if (!item.eventBoxId) item.eventBoxId = null;
        if (!item.eventBoxHint) item.eventBoxHint = '';
        if (!item.createdAt) item.createdAt = Date.now();
        if (!item.occurredAt) item.occurredAt = item.createdAt;
        if (!item.status) item.status = 'active';
        if (!Number.isFinite(Number(item.importance))) item.importance = 5;
        if (!Number.isFinite(Number(item.viewConfidence))) item.viewConfidence = 0.5;
        if (!Number.isFinite(Number(item.accessCount))) item.accessCount = 0;
        if (!Array.isArray(item.embedding)) item.embedding = [];
        if (!item.embeddingModelSignature) item.embeddingModelSignature = '';
        if (!item.embeddingTextHash) item.embeddingTextHash = '';
        if (!item.embeddingUpdatedAt) item.embeddingUpdatedAt = null;
        if (!item.duplicateOfEventId) item.duplicateOfEventId = null;
    }

    function currentVectorModelSignature() {
        const config = (window.db && db.vectorApiSettings && db.vectorApiSettings.url && db.vectorApiSettings.model)
            ? db.vectorApiSettings
            : ((window.db && db.summaryApiSettings && db.summaryApiSettings.url && db.summaryApiSettings.model)
                ? db.summaryApiSettings : (window.db ? db.apiSettings : null));
        if (!config) return '';
        return [config.provider || 'newapi', String(config.url || '').replace(/\/$/, ''), config.model || '', config.dimensions || ''].join('|');
    }

    function simpleHash(text) {
        let hash = 2166136261;
        const value = String(text || '');
        for (let index = 0; index < value.length; index++) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16);
    }

    function eventEmbeddingText(event) {
        return [
            `标题：${event.title || ''}`,
            `事实：${event.factualSummary || ''}`,
            event.outcome ? `结果：${event.outcome}` : '',
            (event.keywords || []).length ? `关键词：${event.keywords.join('、')}` : '',
            (event.aliases || []).length ? `同义表达：${event.aliases.join('、')}` : ''
        ].filter(Boolean).join('\n').trim();
    }

    function eventNeedsEmbedding(event) {
        const signature = currentVectorModelSignature();
        const textHash = simpleHash(eventEmbeddingText(event));
        return !Array.isArray(event.embedding) || !event.embedding.length
            || event.embeddingModelSignature !== signature
            || event.embeddingTextHash !== textHash;
    }

    function hasValidEventEmbedding(event) {
        return Array.isArray(event.embedding) && event.embedding.length > 0
            && event.embeddingModelSignature === currentVectorModelSignature()
            && event.embeddingTextHash === simpleHash(eventEmbeddingText(event));
    }

    function vectorTools() {
        const tools = window.VectorMemoryTools;
        if (!tools || typeof tools.fetchEmbeddings !== 'function' || typeof tools.cosineSimilarity !== 'function') {
            throw new Error('向量工具尚未加载');
        }
        return tools;
    }

    async function generateEventEmbeddings(character, eventIds) {
        const state = ensureState(character);
        const wanted = eventIds ? new Set(eventIds) : null;
        const events = state.events.filter(event => event.status === 'active' && (!wanted || wanted.has(event.id)) && eventNeedsEmbedding(event));
        if (!events.length) return { count: 0, eventIds: [] };
        const texts = events.map(eventEmbeddingText);
        const vectors = await vectorTools().fetchEmbeddings(texts);
        if (vectors.length !== events.length) throw new Error('Embedding 返回数量与事件数量不一致');
        const signature = currentVectorModelSignature();
        events.forEach((event, index) => {
            const vector = vectors[index];
            if (!Array.isArray(vector) || !vector.length) throw new Error(`事件“${event.title || event.id}”未获得有效向量`);
            event.embedding = vector;
            event.embeddingModelSignature = signature;
            event.embeddingTextHash = simpleHash(texts[index]);
            event.embeddingUpdatedAt = Date.now();
        });
        state.vector.lastModelSignature = signature;
        state.vector.lastError = '';
        state.retrieval.lastPreparedAt = null;
        return { count: events.length, eventIds: events.map(event => event.id) };
    }

    function cosineSimilarity(a, b) {
        try { return vectorTools().cosineSimilarity(a, b); }
        catch (_) { return 0; }
    }

    function averageVectors(vectors) {
        const valid = vectors.filter(vector => Array.isArray(vector) && vector.length);
        if (!valid.length) return [];
        const size = valid[0].length;
        if (!valid.every(vector => vector.length === size)) return [];
        const output = Array(size).fill(0);
        valid.forEach(vector => vector.forEach((value, index) => { output[index] += Number(value) || 0; }));
        return output.map(value => value / valid.length);
    }

    function getDuplicateEventSuggestions(character) {
        const state = ensureState(character);
        const threshold = clamp(state.vector.duplicateThreshold, 0, 1, 0.93);
        const events = state.events.filter(event => event.status === 'active' && hasValidEventEmbedding(event));
        const suggestions = [];
        for (let left = 0; left < events.length; left++) {
            for (let right = left + 1; right < events.length; right++) {
                const a = events[left], b = events[right];
                const similarity = cosineSimilarity(a.embedding, b.embedding);
                if (similarity < threshold) continue;
                suggestions.push({ a, b, similarity });
            }
        }
        return suggestions.sort((a, b) => b.similarity - a.similarity).slice(0, 40);
    }

    function getVectorEventBoxSuggestions(character) {
        const state = ensureState(character);
        const threshold = clamp(state.vector.eventBoxThreshold, 0, 1, 0.82);
        const boxes = state.eventBoxes.filter(box => box.status !== 'archived').map(box => {
            const vectors = state.events.filter(event => event.status === 'active' && event.eventBoxId === box.id && hasValidEventEmbedding(event)).map(event => event.embedding);
            return { box, centroid: averageVectors(vectors), supportCount: vectors.length };
        }).filter(entry => entry.centroid.length);
        const suggestions = [];
        state.events.filter(event => event.status === 'active' && !event.eventBoxId && hasValidEventEmbedding(event)).forEach(event => {
            boxes.forEach(entry => {
                const similarity = cosineSimilarity(event.embedding, entry.centroid);
                if (similarity >= threshold) suggestions.push({ event, box: entry.box, similarity, supportCount: entry.supportCount });
            });
        });
        return suggestions.sort((a, b) => b.similarity - a.similarity).slice(0, 40);
    }

    function normalizeEventBox(item) {
        if (!item.id) item.id = uid('box');
        if (!Array.isArray(item.keywords)) item.keywords = parseList(item.keywords);
        if (!Array.isArray(item.unresolvedQuestions)) item.unresolvedQuestions = parseList(item.unresolvedQuestions);
        if (!Array.isArray(item.analyzedEventIds)) item.analyzedEventIds = parseList(item.analyzedEventIds);
        if (!item.name) item.name = '未命名事件盒';
        if (!item.status) item.status = 'ongoing';
        if (!item.createdAt) item.createdAt = Date.now();
        if (!item.updatedAt) item.updatedAt = Date.now();
        if (!Number.isFinite(Number(item.priority))) item.priority = 70;
    }


    function normalizeJob(job) {
        if (!job.id) job.id = uid('job');
        if (!job.type) job.type = 'maintenance';
        if (!job.status) job.status = 'pending';
        if (!job.createdAt) job.createdAt = Date.now();
        if (!job.payload || typeof job.payload !== 'object') job.payload = {};
        if (!Number.isFinite(Number(job.attempts))) job.attempts = 0;
        if (!Number.isFinite(Number(job.maxAttempts))) job.maxAttempts = 3;
        if (!job.dedupeKey) job.dedupeKey = `${job.type}:${job.id}`;
        if (!job.result || typeof job.result !== 'object') job.result = {};
    }

    function recoverStaleJobs(state) {
        const timeout = Math.max(5, Number(state.automation?.runningTimeoutMinutes || 20)) * 60000;
        const now = Date.now();
        (state.jobs || []).forEach(job => {
            if (job.status === 'running' && now - Number(job.startedAt || job.createdAt || now) > timeout) {
                job.status = 'failed';
                job.error = '页面中断或任务运行超时，可手动重试';
                job.finishedAt = now;
                job.nextRetryAt = now;
            }
        });
    }

    function normalizeProfileEntry(raw, sectionName) {
        if (typeof raw === 'string') raw = { statement: raw };
        if (!raw || typeof raw !== 'object') return null;
        const statement = String(raw.statement || raw.content || '').trim();
        if (!statement) return null;
        return {
            id: String(raw.id || uid('profile')),
            statement,
            confidence: clamp(raw.confidence, 0, 1, sectionName.includes('待确认') ? 0.4 : 0.65),
            evidenceEventIds: parseList(raw.evidenceEventIds),
            status: String(raw.status || 'active'),
            directlyStatedRecurrent: !!raw.directlyStatedRecurrent,
            authority: String(raw.authority || 'model'),
            updatedAt: Number(raw.updatedAt || Date.now())
        };
    }

    function normalizeTopicProfile(profile, sections) {
        const normalized = {};
        const names = Array.isArray(sections) && sections.length ? sections : DEFAULT_TOPIC_SECTIONS;
        names.forEach(name => {
            const values = profile && Object.prototype.hasOwnProperty.call(profile, name) ? profile[name] : [];
            normalized[name] = (Array.isArray(values) ? values : (values ? [values] : []))
                .map(value => normalizeProfileEntry(value, name))
                .filter(Boolean);
        });
        if (profile && typeof profile === 'object') {
            Object.keys(profile).forEach(name => {
                if (normalized[name]) return;
                normalized[name] = (Array.isArray(profile[name]) ? profile[name] : [profile[name]])
                    .map(value => normalizeProfileEntry(value, name))
                    .filter(Boolean);
            });
        }
        return normalized;
    }

    function profileEntryLine(entry, includeEvidence) {
        const confidence = Math.round(clamp(entry.confidence, 0, 1, 0.6) * 100);
        const evidence = includeEvidence && (entry.evidenceEventIds || []).length
            ? `；证据=${entry.evidenceEventIds.join(',')}` : '';
        return `- ${entry.statement}（置信度 ${confidence}%${evidence}）`;
    }

    function formatTopicProfile(topic, options) {
        options = options || {};
        const profile = normalizeTopicProfile(topic.profile || {}, topic.sections || DEFAULT_TOPIC_SECTIONS);
        const blocks = [];
        (topic.sections || DEFAULT_TOPIC_SECTIONS).forEach(section => {
            const entries = (profile[section] || []).filter(entry => entry.status !== 'archived');
            if (!entries.length) return;
            blocks.push(`【${section}】\n${entries.map(entry => profileEntryLine(entry, !!options.includeEvidence)).join('\n')}`);
        });
        if (String(topic.profileText || '').trim()) blocks.push(`【人工补充】\n${String(topic.profileText).trim()}`);
        return blocks.join('\n');
    }

    function profileHasContent(topic) {
        return !!formatTopicProfile(topic).trim();
    }

    function normalizeTopic(item) {
        if (!item.id) item.id = uid('topic');
        if (!Array.isArray(item.keywords)) item.keywords = parseList(item.keywords);
        if (!Array.isArray(item.aliases)) item.aliases = parseList(item.aliases);
        if (!Array.isArray(item.negativeKeywords)) item.negativeKeywords = parseList(item.negativeKeywords);
        if (!Array.isArray(item.evidenceEventIds)) item.evidenceEventIds = parseList(item.evidenceEventIds);
        if (!Array.isArray(item.analyzedEventIds)) item.analyzedEventIds = parseList(item.analyzedEventIds);
        if (!Array.isArray(item.sections) || !item.sections.length) item.sections = DEFAULT_TOPIC_SECTIONS.slice();
        item.sections = parseList(item.sections);
        if (!item.sections.length) item.sections = DEFAULT_TOPIC_SECTIONS.slice();
        item.profile = normalizeTopicProfile(item.profile || {}, item.sections);
        if (!item.name) item.name = '未命名主题';
        if (!item.status) item.status = 'confirmed';
        if (!item.sendPolicy) item.sendPolicy = 'keyword';
        if (!Number.isFinite(Number(item.priority))) item.priority = 80;
        if (!item.createdAt) item.createdAt = Date.now();
        if (!item.updatedAt) item.updatedAt = Date.now();
        if (item.manualActive === undefined) item.manualActive = false;
        if (!item.profileText) item.profileText = '';
        if (!item.profileSummary) item.profileSummary = '';
        if (!item.customPrompt) item.customPrompt = '';
        if (!item.updatePolicy || typeof item.updatePolicy !== 'object') item.updatePolicy = {};
        if (!Number.isFinite(Number(item.updatePolicy.minNewEvidence))) item.updatePolicy.minNewEvidence = 4;
        if (item.updatePolicy.autoPrepare === undefined) item.updatePolicy.autoPrepare = true;
        if (item.updatePolicy.requireUserReview === undefined) item.updatePolicy.requireUserReview = false;
        if (!Number.isFinite(Number(item.version))) item.version = 1;
    }

    function getCharacter() {
        if (typeof currentChatId === 'undefined' || !currentChatId) return null;
        if (typeof currentChatType !== 'undefined' && currentChatType !== 'private') return null;
        const character = (window.db && Array.isArray(db.characters))
            ? db.characters.find(item => item.id === currentChatId)
            : null;
        if (character) ensureState(character);
        return character || null;
    }

    async function persist() {
        if (typeof saveData === 'function') await saveData();
    }

    function itemText(item, type) {
        if (type === 'doorplate') return `
            <label>门牌分区<select name="room">${SULLY_PLATE_ORDER.map(room => `<option value="${room}" ${item.room === room ? 'selected' : ''}>${escapeHtml(SULLY_PLATE_LABELS[room] || room)}</option>`).join('')}</select></label>
            <label>标签<input name="tag" value="${escapeHtml(item.tag || '')}" placeholder="例如：睡眠、边界、重要人"></label>
            <label>门牌内容<textarea name="text" rows="5" required placeholder="一条短而稳定的常驻认知">${escapeHtml(item.text || '')}</textarea></label>
            <div class="um-form-grid"><label>印证次数<input name="sourceCount" type="number" min="1" max="9999" value="${Math.max(1, Number(item.sourceCount || 1))}"></label><label>首次得知<input value="${escapeHtml(formatDate(item.firstLearnedAt || Date.now()))}" disabled></label></div>
            <p class="um-muted">门牌沿用 Sully RoomPlate 原始字段：room、tag、text、sourceCount、firstLearnedAt、updatedAt。编辑不会改变首次得知时间。</p>`;
        if (type === 'impression') return `
            <label>房间<select name="room">${Object.entries(SULLY_ROOM_LABELS).map(([key,label])=>`<option value="${key}" ${item.room===key?'selected':''}>${label}</option>`).join('')}</select></label>
            <label>标签<input name="tag" value="${escapeHtml(item.tag || item.dimension || '')}" placeholder="例如：安抚"></label>
            <label>印象文本<textarea name="text" rows="4" required>${escapeHtml(item.text || item.statement || '')}</textarea></label>
            <label>关键词<input name="keywords" value="${escapeHtml((item.keywords || []).join('，'))}"></label>
            <label>同义表达<input name="aliases" value="${escapeHtml((item.aliases || []).join('，'))}"></label>
            <label>排除词<input name="negativeKeywords" value="${escapeHtml((item.negativeKeywords || []).join('，'))}"></label>
            <label>关联主题${linkedTopicCheckboxes(item.linkedTopicIds || [])}</label>
            <div class="um-form-grid"><label>发送策略<select name="sendPolicy">${policyOptions(item.sendPolicy || 'keyword')}</select></label><label>优先级<input name="priority" type="number" min="0" max="200" value="${item.priority ?? 65}"></label><label>来源计数<input name="sourceCount" type="number" min="0" max="9999" value="${item.sourceCount ?? 1}"></label></div>
            <label class="um-check"><input name="locked" type="checkbox" ${item.locked ? 'checked' : ''}> 用户锁定</label>`;
        if (type === 'working') return item.content || '';
        if (type === 'eventBox') return `${item.name || ''} ${item.summary || ''} ${item.currentStage || ''}`;
        if (type === 'topic') return `${item.name || ''} ${item.description || ''} ${formatTopicProfile(item)}`;
        return `${item.title || ''} ${item.factualSummary || ''} ${item.characterView || ''} ${item.outcome || ''}`;
    }

    function keywordScore(item, queryText) {
        const query = normalizeText(queryText);
        if (!query) return { score: 0, hits: [], negativeHits: [] };
        const positives = [...(item.keywords || []), ...(item.aliases || [])].filter(Boolean);
        const negatives = item.negativeKeywords || [];
        const negativeHits = negatives.filter(word => query.includes(normalizeText(word)));
        if (negativeHits.length > 0) return { score: -999, hits: [], negativeHits };
        const hits = positives.filter(word => {
            const normalized = normalizeText(word);
            return normalized && query.includes(normalized);
        });
        let score = hits.length * 24;
        if (hits.length > 0) score += Math.min(20, hits.reduce((sum, word) => sum + normalizeText(word).length, 0));
        if (!hits.length && item.searchText) {
            const queryGrams = meaningfulBigrams(query);
            const textGrams = meaningfulBigrams(item.searchText);
            const overlap = [...queryGrams].filter(gram => textGrams.has(gram));
            const required = 1;
            if (overlap.length >= required) {
                score += Math.min(36, overlap.length * 6);
                hits.push(...overlap.slice(0, 6).map(gram => `文本:${gram}`));
            }
        }
        return { score, hits, negativeHits: [] };
    }

    function isWorkingActive(item, now) {
        if (item.status !== 'active') return false;
        if (item.expiresAt && Number(item.expiresAt) <= now) return false;
        return true;
    }

    function topicMatchesQuery(topic, queryText) {
        const match = keywordScore(topic, queryText);
        let selected = false;
        let score = Number(topic.priority || 0) + match.score;
        if (topic.sendPolicy === 'always') {
            selected = true;
            score += 100;
        } else if (topic.sendPolicy === 'manual' && topic.manualActive) {
            selected = true;
            score += 90;
        } else if (topic.sendPolicy === 'keyword' && match.score > 0) {
            selected = true;
        }
        if (match.score < 0 || topic.status !== 'confirmed') selected = false;
        return { item: topic, selected, score, hits: match.hits };
    }

    function selectMemories(character, queryText, options) {
        options = options || {};
        const state = ensureState(character);
        const now = Date.now();
        const retrieval = state.retrieval;

        const working = state.workingMemories
            .filter(item => isWorkingActive(item, now))
            .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));

        const topics = state.topics
            .map(topic => topicMatchesQuery(topic, queryText))
            .filter(entry => entry.selected)
            .sort((a, b) => b.score - a.score)
            .slice(0, Number(retrieval.maxTopics || 3));
        const activeTopicIds = new Set(topics.map(entry => entry.item.id));

        function selectArchive(list, type, maxCount) {
            return list
                .filter(item => item.status === 'active' && item.sendPolicy !== 'off')
                .map(item => {
                    const match = keywordScore(item, queryText);
                    let selected = false;
                    let score = Number(item.priority || 0) + match.score;
                    if (item.sendPolicy === 'always') {
                        selected = true;
                        score += 100;
                    } else if (item.sendPolicy === 'manual' && item.manualActive) {
                        selected = true;
                        score += 90;
                    } else if (item.sendPolicy === 'keyword' && match.score > 0) {
                        selected = true;
                    } else if (item.sendPolicy === 'topic' && (item.linkedTopicIds || []).some(id => activeTopicIds.has(id))) {
                        selected = true;
                        score += 75;
                    }
                    if (match.score < 0) selected = false;
                    return { item, selected, score, hits: match.hits, viaTopic: item.sendPolicy === 'topic' && selected };
                })
                .filter(entry => entry.selected)
                .sort((a, b) => b.score - a.score)
                .slice(0, maxCount);
        }

        const doorplateRows = getRoomPlateEntryRows(state);
        const doorplates = retrieval.roomPlateMode === 'off' ? [] : (
            retrieval.roomPlateMode === 'always'
                ? doorplateRows.slice(0, Number(retrieval.maxDoorplates || 40)).map(item => ({ item, selected: true, score: 100 + Number(item.sourceCount || 0), hits: [], viaTopic: false }))
                : selectArchive(doorplateRows, 'doorplate', Number(retrieval.maxDoorplates || 40))
        );
        const impressions = [];
        const impressionData = normalizeUserImpressionLocal(state.impression);
        const impressionRoute = impressionRoutingItem(state);
        let impression = null;
        let impressionHits = [];
        if (impressionData && impressionRoute && retrieval.impressionMode !== 'off') {
            const match = keywordScore(impressionRoute, queryText);
            if (retrieval.impressionMode === 'always' || match.score > 0 || topics.length > 0) {
                impression = impressionData;
                impressionHits = match.hits;
            }
        }

        const events = state.events
            .filter(item => item.status === 'active')
            .map(item => {
                const match = keywordScore(item, queryText);
                const pinned = item.pinnedUntil && Number(item.pinnedUntil) > now;
                const viaTopic = (item.topicIds || []).some(id => activeTopicIds.has(id));
                const recencyDays = Math.max(0, (now - Number(item.occurredAt || item.createdAt || now)) / 86400000);
                const recency = Math.max(0, 30 - Math.min(30, recencyDays));
                const score = match.score + Number(item.importance || 0) * 5 + recency + (pinned ? 100 : 0) + (viaTopic ? 55 : 0);
                return { item, selected: pinned || match.score > 0 || viaTopic, score, hits: match.hits, pinned, viaTopic };
            })
            .filter(entry => entry.selected)
            .sort((a, b) => b.score - a.score)
            .slice(0, Number(retrieval.maxEvents || 5));

        const selectedEventBoxIds = new Set(events.map(entry => entry.item.eventBoxId).filter(Boolean));
        const eventBoxes = state.eventBoxes
            .filter(item => item.status !== 'archived')
            .map(item => {
                const match = keywordScore(item, queryText);
                const viaEvent = selectedEventBoxIds.has(item.id);
                const score = Number(item.priority || 0) + match.score + (viaEvent ? 80 : 0);
                return { item, selected: viaEvent || match.score > 0, score, hits: match.hits, viaEvent };
            })
            .filter(entry => entry.selected)
            .sort((a, b) => b.score - a.score)
            .slice(0, Number(retrieval.maxEventBoxes || 3));

        if (options.touch) {
            events.forEach(entry => {
                entry.item.accessCount = Number(entry.item.accessCount || 0) + 1;
                entry.item.lastAccessedAt = now;
            });
        }

        return {
            queryText,
            working,
            topics,
            doorplates,
            impressions,
            impression,
            impressionHits,
            eventBoxes,
            events,
            vectorUsed: false,
            generatedAt: now
        };
    }

    async function selectMemoriesWithVector(character, queryText, options) {
        options = options || {};
        const state = ensureState(character);
        const selected = selectMemories(character, queryText, { touch: false });
        if (!state.vector.enabled || !String(queryText || '').trim()) {
            if (options.touch) selected.events.forEach(entry => { entry.item.accessCount = Number(entry.item.accessCount || 0) + 1; entry.item.lastAccessedAt = Date.now(); });
            return selected;
        }
        const vectorEvents = state.events.filter(event => event.status === 'active' && hasValidEventEmbedding(event));
        if (!vectorEvents.length) {
            if (options.touch) selected.events.forEach(entry => { entry.item.accessCount = Number(entry.item.accessCount || 0) + 1; entry.item.lastAccessedAt = Date.now(); });
            return selected;
        }
        try {
            const vectors = await vectorTools().fetchEmbeddings([queryText]);
            const queryVector = vectors[0];
            if (!Array.isArray(queryVector) || !queryVector.length) return selected;
            const threshold = clamp(state.vector.similarityThreshold, 0, 1, 0.55);
            const vectorWeight = clamp(state.vector.vectorScoreWeight, 0, 200, 45);
            const now = Date.now();
            const byId = new Map(selected.events.map(entry => [entry.item.id, entry]));
            const vectorCandidates = vectorEvents
                .map(event => ({ event, similarity: cosineSimilarity(queryVector, event.embedding) }))
                .filter(entry => entry.similarity >= threshold)
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, Math.max(1, Number(state.vector.maxVectorCandidates || 8)));
            vectorCandidates.forEach(({ event, similarity }) => {
                const existing = byId.get(event.id);
                const recencyDays = Math.max(0, (now - Number(event.occurredAt || event.createdAt || now)) / 86400000);
                const baseScore = Number(event.importance || 0) * 5 + Math.max(0, 30 - Math.min(30, recencyDays));
                if (existing) {
                    existing.vectorSimilarity = similarity;
                    existing.score += similarity * vectorWeight;
                    existing.viaVector = true;
                } else {
                    byId.set(event.id, {
                        item: event, selected: true, score: baseScore + similarity * vectorWeight,
                        hits: [], pinned: !!(event.pinnedUntil && Number(event.pinnedUntil) > now),
                        viaTopic: false, viaVector: true, vectorSimilarity: similarity
                    });
                }
            });
            selected.events = [...byId.values()]
                .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.score - a.score)
                .slice(0, Number(state.retrieval.maxEvents || 5));
            const selectedEventBoxIds = new Set(selected.events.map(entry => entry.item.eventBoxId).filter(Boolean));
            const existingBoxes = new Map(selected.eventBoxes.map(entry => [entry.item.id, entry]));
            selectedEventBoxIds.forEach(boxId => {
                if (existingBoxes.has(boxId)) return;
                const box = state.eventBoxes.find(item => item.id === boxId && item.status !== 'archived');
                if (box) existingBoxes.set(boxId, { item: box, selected: true, score: Number(box.priority || 0) + 80, hits: [], viaEvent: true });
            });
            selected.eventBoxes = [...existingBoxes.values()].sort((a, b) => b.score - a.score).slice(0, Number(state.retrieval.maxEventBoxes || 3));
            selected.vectorUsed = selected.events.some(entry => entry.viaVector);
            selected.queryVectorDimensions = queryVector.length;
            state.vector.lastQueryEmbeddingAt = Date.now();
            state.vector.lastError = '';
        } catch (error) {
            state.vector.lastError = String(error?.message || error);
            console.warn('[UnifiedMemory] vector retrieval fallback:', error);
        }
        if (options.touch) selected.events.forEach(entry => { entry.item.accessCount = Number(entry.item.accessCount || 0) + 1; entry.item.lastAccessedAt = Date.now(); });
        return selected;
    }

    function createRetrievalDebugSnapshot(selected) {
        const snapshot = clone(selected);
        (snapshot.events || []).forEach(entry => {
            if (!entry.item) return;
            entry.item.embeddingDimensions = Array.isArray(entry.item.embedding) ? entry.item.embedding.length : 0;
            delete entry.item.embedding;
        });
        return snapshot;
    }

    function truncateBlock(text, maxChars) {
        const value = String(text || '');
        if (!maxChars || value.length <= maxChars) return value;
        return `${value.slice(0, Math.max(0, maxChars - 18))}\n…（已按预算截断）`;
    }

    function formatDate(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function buildContextBlock(character, selected) {
        const state = ensureState(character);
        if (!state.enabled || !state.injectionEnabled) return '';
        const retrieval = state.retrieval;
        const sections = [];

        if (selected.working.length > 0) {
            const text = selected.working.map(item => {
                const expiry = item.expiresAt ? `（有效至 ${formatDate(item.expiresAt)}）` : '';
                return `- ${item.content}${expiry}`;
            }).join('\n');
            sections.push(`【临时需要记住】\n${truncateBlock(text, retrieval.workingBudget)}`);
        }

        if (selected.topics.length > 0) {
            const text = selected.topics.map(entry => {
                const topic = entry.item;
                const profile = formatTopicProfile(topic);
                return `【主题：${topic.name}】${topic.description ? `\n说明：${topic.description}` : ''}${topic.profileSummary ? `\n最近整理：${topic.profileSummary}` : ''}${profile ? `\n${profile}` : '\n尚未形成结构化档案。'}`;
            }).join('\n\n');
            sections.push(`【当前命中的已确认主题】\n这些主题由用户确认；分区结论来自跨事件整理。暂定模式和低置信度内容不能当成事实。\n${truncateBlock(text, retrieval.topicBudget)}`);
        }

        if (selected.doorplates.length > 0) {
            const text = selected.doorplates.map(entry => {
                const item = entry.item;
                return `- [${sullyRoomLabel(item.room)}·${plateTag(item,'doorplate')}] ${plateText(item,'doorplate')}`;
            }).join('\n');
            sections.push(`【相关门牌档案】\n以下内容是相对客观、稳定的长期信息。\n${truncateBlock(text, retrieval.doorplateBudget)}`);
        }

        if (selected.impression) {
            const text = formatStructuredImpression(selected.impression);
            if (text) sections.push(`【角色私密印象档案】\n以下是角色基于长期互动形成的完整主观画像，不是绝对事实；当前表达优先。\n${truncateBlock(text, retrieval.impressionBudget)}`);
        }

        if (selected.eventBoxes.length > 0) {
            const text = selected.eventBoxes.map(entry => {
                const box = entry.item;
                let line = `- ${box.name}${box.status ? `（${box.status === 'completed' ? '已结束' : '进行中'}）` : ''}`;
                if (box.summary) line += `：${box.summary}`;
                if (box.currentStage) line += `\n  当前阶段：${box.currentStage}`;
                if ((box.unresolvedQuestions || []).length) line += `\n  尚未解决：${box.unresolvedQuestions.join('；')}`;
                return line;
            }).join('\n');
            sections.push(`【相关事件盒】\n以下内容用于理解同一件事的连续发展，不等同于跨事件长期模式。\n${truncateBlock(text, retrieval.eventBoxBudget)}`);
        }

        if (selected.events.length > 0) {
            const text = selected.events.map(entry => {
                const item = entry.item;
                let line = `- [${formatDate(item.occurredAt)}] ${item.title || '事件'}：${item.factualSummary || ''}`;
                if (item.characterView) line += `\n  角色当时的理解：${item.characterView}`;
                if (item.outcome) line += `\n  结果：${item.outcome}`;
                return line;
            }).join('\n');
            sections.push(`【相关事件记忆】\n${truncateBlock(text, retrieval.eventBudget)}`);
        }

        if (sections.length === 0) return '';
        const rules = `【记忆使用规则】\n- 当前用户表达高于历史记忆。\n- 客观事实高于角色主观印象。\n- 已确认主题只代表用户认可的整理方向，不自动证明某种模式成立。\n- EventBox 只表示同一件事的发展，不要把它误当成长期人格或长期规律。\n- 角色理解允许被修正，不得把推测当成确定事实。\n- 只在自然相关时使用记忆，不要机械复述档案。`;
        return truncateBlock(`【统一长期记忆】\n${sections.join('\n\n')}\n\n${rules}`, retrieval.totalBudget);
    }

    function buildQueryFromMessages(character, messages) {
        const state = ensureState(character);
        const count = Math.max(1, Number(state.retrieval.recentUserMessages || 3));
        const source = Array.isArray(messages) && messages.length ? messages : (character.history || []);
        return source
            .filter(message => message && message.role === 'user' && !message.isContextDisabled)
            .slice(-count)
            .map(message => {
                if (typeof message.content === 'string') return message.content;
                if (Array.isArray(message.parts)) return message.parts.map(part => part.text || '').join('');
                return '';
            })
            .filter(Boolean)
            .join('\n');
    }

    async function prepareUnifiedMemoryContext(character, messages, options) {
        const state = ensureState(character);
        if (!state || !state.enabled || !state.injectionEnabled) return '';
        const queryText = (options && options.queryText) || buildQueryFromMessages(character, messages);
        const selected = await selectMemoriesWithVector(character, queryText, { touch: true });
        const block = buildContextBlock(character, selected);
        state.retrieval.lastQueryText = queryText;
        state.retrieval.lastContextBlock = block;
        state.retrieval.lastPreparedAt = Date.now();
        state.retrieval.lastDebug = createRetrievalDebugSnapshot(selected);
        if (selected.events.length > 0) {
            Promise.resolve().then(() => persist()).catch(() => {});
        }
        return block;
    }

    function getUnifiedMemoryContextBlock(character) {
        const state = ensureState(character);
        if (!state || !state.enabled || !state.injectionEnabled) return '';
        const isFresh = state.retrieval.lastPreparedAt && Date.now() - state.retrieval.lastPreparedAt < 120000;
        if (isFresh && state.retrieval.lastContextBlock) return state.retrieval.lastContextBlock;
        const queryText = buildQueryFromMessages(character, character.history || []);
        const selected = selectMemories(character, queryText, { touch: false });
        const block = buildContextBlock(character, selected);
        state.retrieval.lastQueryText = queryText;
        state.retrieval.lastContextBlock = block;
        state.retrieval.lastPreparedAt = Date.now();
        state.retrieval.lastDebug = createRetrievalDebugSnapshot(selected);
        return block;
    }

    function isCompleteApiConfig(config) {
        return !!(config && config.url && config.key && config.model);
    }

    function sanitizeApiUrl(value) {
        const raw = String(value || '').trim();
        if (!raw) return '未配置';
        try {
            const parsed = new URL(raw, window.location?.href || 'https://local.invalid');
            return parsed.host || raw.replace(/^https?:\/\//, '').split('/')[0];
        } catch (_) {
            return raw.replace(/^https?:\/\//, '').split('/')[0] || raw;
        }
    }

    function resolveSummaryApi() {
        if (isCompleteApiConfig(window.db?.summaryApiSettings)) {
            return { source: '总结 API', config: db.summaryApiSettings, fallback: false };
        }
        if (isCompleteApiConfig(window.db?.apiSettings)) {
            return { source: '主 API（回退）', config: db.apiSettings, fallback: true };
        }
        return { source: '未配置', config: null, fallback: false };
    }

    function resolveVectorApi() {
        if (isCompleteApiConfig(window.db?.vectorApiSettings)) {
            return { source: '向量 API', config: db.vectorApiSettings, fallback: false };
        }
        if (isCompleteApiConfig(window.db?.summaryApiSettings)) {
            return { source: '总结 API（回退，模型必须支持 Embedding）', config: db.summaryApiSettings, fallback: true };
        }
        if (isCompleteApiConfig(window.db?.apiSettings)) {
            return { source: '主 API（回退，模型必须支持 Embedding）', config: db.apiSettings, fallback: true };
        }
        return { source: '未配置', config: null, fallback: false };
    }

    function apiStatusSnapshot() {
        const summary = resolveSummaryApi();
        const vector = resolveVectorApi();
        const describe = item => ({
            source: item.source,
            configured: !!item.config,
            provider: item.config?.provider || 'newapi',
            model: item.config?.model || '',
            host: sanitizeApiUrl(item.config?.url || ''),
            dimensions: item.config?.dimensions || '',
            fallback: !!item.fallback
        });
        return { summary: describe(summary), vector: describe(vector) };
    }

    function renderApiStatusCard() {
        const status = apiStatusSnapshot();
        const line = (title, item) => `<div class="um-api-line"><b>${escapeHtml(title)}</b><span>${escapeHtml(item.source)}</span><small>${item.configured ? `${escapeHtml(item.provider)} · ${escapeHtml(item.model || '未填模型')} · ${escapeHtml(item.host)}${item.dimensions ? ` · ${escapeHtml(String(item.dimensions))}维` : ''}` : '尚未配置'}</small></div>`;
        return `<section class="um-card um-api-status-card"><h3>当前记忆 API</h3>${line('事件/门牌/印象/主题总结', status.summary)}${line('事件向量 Embedding', status.vector)}${status.vector.fallback ? '<p class="um-warning">当前向量使用回退 API。聊天模型通常不能生成 Embedding，建议在 API 设置中单独配置“向量 API”。</p>' : ''}<p class="um-muted">总结任务优先使用“总结 API”，没有配置时才回退到主 API。向量优先使用“向量 API”。</p></section>`;
    }

    function getSummaryApiConfig() {
        const resolved = resolveSummaryApi();
        if (!resolved.config) throw new Error('请先配置总结 API 或主 API');
        return resolved.config;
    }

    async function requestSummary(prompt, taskName, temperature) {
        const config = getSummaryApiConfig();
        let url = String(config.url || '').replace(/\/$/, '');
        const provider = config.provider || 'newapi';
        const key = config.key;
        const model = config.model;
        const endpoint = provider === 'gemini'
            ? `${url}/v1beta/models/${model}:generateContent?key=${typeof getRandomValue === 'function' ? getRandomValue(key) : key}`
            : `${url}/v1/chat/completions`;
        const headers = provider === 'gemini'
            ? { 'Content-Type': 'application/json' }
            : { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
        const body = provider === 'gemini'
            ? { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2 } }
            : { model, temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.2, messages: [{ role: 'user', content: prompt }] };
        return fetchAiResponse({ ...config, runtimeTask: taskName || 'unified-memory-event-extract', runtimeSource: 'unified-memory' }, body, headers, endpoint);
    }

    function parseJsonArray(text) {
        let raw = String(text || '').trim();
        raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        } catch (_) {}
        const start = raw.indexOf('[');
        const end = raw.lastIndexOf(']');
        if (start !== -1 && end > start) {
            const parsed = JSON.parse(raw.slice(start, end + 1));
            if (Array.isArray(parsed)) return parsed;
        }
        throw new Error('总结模型没有返回合法 JSON 数组');
    }

    function formatConversation(character, messages) {
        return messages.map(message => {
            const name = message.role === 'user'
                ? (character.myName || '用户')
                : (character.realName || character.remarkName || '角色');
            const content = typeof message.content === 'string'
                ? message.content
                : (Array.isArray(message.parts) ? message.parts.map(part => part.text || '[图片]').join('') : '');
            return `[ID:${message.id || ''}][${formatDate(message.timestamp || Date.now())}] ${name}：${content}`;
        }).join('\n');
    }

    function formatAllRoomPlatesForSummary(state) {
        const blocks = (state.roomPlates || []).map(plate => {
            const entries = (plate.entries || []).map(entry => `- [${entry.id}][${entry.tag || '未分类'}] ${entry.text}（印证 ${Number(entry.sourceCount || 1)} 次）`).join('\n');
            return `【${SULLY_PLATE_LABELS[plate.room] || plate.room}】\n${entries || '无'}`;
        });
        return blocks.join('\n\n');
    }

    function formatSelectedForSummary(character, selected) {
        const state = ensureState(character);
        const safeSelected = selected && typeof selected === 'object' ? selected : {};
        const working = Array.isArray(safeSelected.working) ? safeSelected.working : [];
        const topics = Array.isArray(safeSelected.topics) ? safeSelected.topics : [];
        const eventBoxes = Array.isArray(safeSelected.eventBoxes) ? safeSelected.eventBoxes : [];
        const events = Array.isArray(safeSelected.events) ? safeSelected.events : [];
        const chunks = [];
        if (working.length) {
            chunks.push(`临时记忆：\n${working.map(item => `- ${item.content}`).join('\n')}`);
        }

        const allPlates = formatAllRoomPlatesForSummary(state);
        if (allPlates) {
            chunks.push(`完整门牌（每次事件提取固定发送，用于保持角色已有常识）：\n${allPlates}`);
        }

        const impressionText = formatStructuredImpression(state.impression);
        if (impressionText) {
            chunks.push(`完整私密印象（角色长期形成的主观画像，不是绝对事实；当前表达优先）：\n${impressionText}`);
        }

        if (topics.length) {
            chunks.push(`相关已确认主题：\n${topics.map(entry => {
                const topic = entry.item;
                const profile = formatTopicProfile(topic, { includeEvidence: true });
                return `- [${topic.id}] ${topic.name}${topic.description ? `：${topic.description}` : ''}${profile ? `\n${profile}` : ''}`;
            }).join('\n')}`);
        }
        if (eventBoxes.length) {
            chunks.push(`相关事件盒：\n${eventBoxes.map(entry => {
                const box = entry.item;
                return `- [${box.id}] ${box.name}：${box.summary || '暂无摘要'}；当前阶段=${box.currentStage || '未填写'}`;
            }).join('\n')}`);
        }
        if (events.length) {
            chunks.push(`相关旧事件：\n${events.map(entry => `- [${entry.item.id}] ${entry.item.title}：事实=${entry.item.factualSummary}；我的理解=${entry.item.characterView || '无'}${entry.item.eventBoxId ? `；事件盒=${entry.item.eventBoxId}` : ''}`).join('\n')}`);
        }
        return chunks.length ? chunks.join('\n\n') : '没有旧记忆。';
    }

    function buildEventExtractionPrompt(character, validMessages, selected) {
        const state = ensureState(character);
        return `${state.prompts.eventExtraction || DEFAULT_EVENT_PROMPT}

【角色设定】
角色名：${character.realName || character.remarkName || ''}
角色人设：${typeof getEffectivePersona === 'function' ? (getEffectivePersona(character) || '') : (character.persona || '')}

【用户设定】
用户称呼：${character.myName || '用户'}
用户人设：${character.myPersona || '无'}

【长期记忆上下文】
${formatSelectedForSummary(character, selected)}

【本批新对话】
${formatConversation(character, validMessages)}`;
    }

    function normalizeFirstPersonEventText(value, character) {
        let text = String(value || '').trim();
        const names = [...new Set([character?.realName, character?.remarkName].filter(Boolean).map(String))];
        const replacements = [
            ['会把这看作', '我会把这看作'], ['认为', '我认为'], ['觉得', '我觉得'], ['注意到', '我注意到'],
            ['意识到', '我意识到'], ['判断', '我判断'], ['担心', '我担心'], ['希望', '我希望'],
            ['决定', '我决定'], ['准备', '我准备']
        ];
        names.forEach(name => {
            replacements.forEach(([suffix, replacement]) => {
                text = text.split(`${name}${suffix}`).join(replacement);
            });
        });
        [['角色会把这看作','我会把这看作'],['角色认为','我认为'],['角色觉得','我觉得'],['角色注意到','我注意到'],['助手认为','我认为'],['助手觉得','我觉得'],['AI认为','我认为'],['AI 认为','我认为']].forEach(([from,to]) => {
            text = text.split(from).join(to);
        });
        return text;
    }

    function normalizeOutputEvent(raw, character, allowedIds) {
        if (!raw || typeof raw !== 'object') return null;
        const factualSummary = normalizeFirstPersonEventText(raw.factualSummary, character);
        if (!factualSummary) return null;
        const rawOccurredAt = String(raw.occurredAt || '').trim();
        let occurredAt = /^\d{4}-\d{2}-\d{2}$/.test(rawOccurredAt)
            ? new Date(`${rawOccurredAt}T12:00:00`).getTime()
            : (rawOccurredAt ? new Date(rawOccurredAt).getTime() : Date.now());
        if (!Number.isFinite(occurredAt)) occurredAt = Date.now();
        const sourceMessageIds = parseList(raw.sourceMessageIds).filter(id => allowedIds.has(id));
        return {
            id: uid('event'),
            characterId: character.id,
            title: String(raw.title || '未命名事件').trim().slice(0, 80),
            factualSummary,
            characterView: normalizeFirstPersonEventText(raw.characterView, character),
            viewConfidence: clamp(raw.viewConfidence, 0, 1, 0.5),
            outcome: String(raw.outcome || '').trim(),
            occurredAt,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            keywords: parseList(raw.keywords).slice(0, 20),
            aliases: parseList(raw.aliases).slice(0, 20),
            importance: Math.round(clamp(raw.importance, 1, 10, 5)),
            mood: String(raw.mood || 'neutral').trim().slice(0, 24),
            valence: clamp(raw.valence, -1, 1, 0),
            arousal: clamp(raw.arousal, -1, 1, 0),
            sourceMessageIds,
            eventBoxId: null,
            eventBoxHint: String(raw.eventBoxHint || '').trim().slice(0, 80),
            eventBoxKeywords: parseList(raw.eventBoxKeywords).slice(0, 12),
            topicIds: [],
            pinnedUntil: null,
            accessCount: 0,
            lastAccessedAt: null,
            status: 'active',
            pinDays: Math.round(clamp(raw.pinDays, 0, 30, 0))
        };
    }

    function eventFingerprint(event) {
        return normalizeText(`${event.title || ''}${event.factualSummary || ''}`).slice(0, 240);
    }

    async function extractEventsFromMessages(character, messages, taskName) {
        const state = ensureState(character);
        const validMessages = (messages || []).filter(message => message && ['user', 'assistant', 'char'].includes(message.role) && !message.isContextDisabled && !message.isThinking);
        if (validMessages.length === 0) throw new Error('没有可总结的聊天消息');
        const batchText = validMessages.map(message => String(message.content || '')).join('\n');
        const debugBase = {
            taskName: taskName || 'unified-memory-event-extract',
            characterId: character.id,
            messageCount: validMessages.length,
            firstMessageId: validMessages[0]?.id || '',
            lastMessageId: validMessages[validMessages.length - 1]?.id || '',
            messageIds: validMessages.map(message => message.id),
            batchChars: batchText.length
        };
        extractionDebug('开始提取', debugBase);
        try {
            const selected = await selectMemoriesWithVector(character, batchText, { touch: false });
            const selectedCounts = {
                working: selected?.working?.length || 0,
                roomPlateEntries: getRoomPlateEntryRows(state).length,
                impression: state.impression ? 1 : 0,
                topics: selected?.topics?.length || 0,
                eventBoxes: selected?.eventBoxes?.length || 0,
                events: selected?.events?.length || 0,
                vectorUsed: !!selected?.vectorUsed
            };
            const prompt = buildEventExtractionPrompt(character, validMessages, selected);
            const config = getSummaryApiConfig();
            extractionDebug('准备请求', {
                ...debugBase,
                selectedCounts,
                api: apiStatusSnapshot().summary,
                promptChars: prompt.length,
                api: { provider: config.provider || 'newapi', url: config.url || '', model: config.model || '' }
            });
            const text = await requestSummary(prompt, taskName || 'unified-memory-event-extract', 0.2);
            extractionDebug('收到模型响应', { ...debugBase, responseChars: String(text || '').length, rawResponse: String(text || '') });
            const parsed = parseJsonArray(text);
            extractionDebug('JSON 解析成功', { ...debugBase, parsedCount: parsed.length });
            const allowedIds = new Set(validMessages.map(message => message.id).filter(Boolean));
            const existingFingerprints = new Set(state.events.map(eventFingerprint));
            const created = [];
            let duplicateCount = 0;
            let invalidCount = 0;
            parsed.forEach(raw => {
                const event = normalizeOutputEvent(raw, character, allowedIds);
                if (!event) { invalidCount += 1; return; }
                const fingerprint = eventFingerprint(event);
                if (!fingerprint || existingFingerprints.has(fingerprint)) { duplicateCount += 1; return; }
                existingFingerprints.add(fingerprint);
                state.events.unshift(event);
                created.push(event);
                if (event.pinDays > 0) {
                    state.workingMemories.unshift({
                        id: uid('working'), content: event.factualSummary, keywords: event.keywords.slice(),
                        createdAt: Date.now(), expiresAt: Date.now() + event.pinDays * 86400000,
                        sourceEventId: event.id, priority: 90, status: 'active'
                    });
                    event.pinnedUntil = Date.now() + event.pinDays * 86400000;
                }
                delete event.pinDays;
            });
            state.retrieval.lastPreparedAt = null;
            extractionDebug('提取完成', {
                ...debugBase,
                parsedCount: parsed.length,
                createdCount: created.length,
                duplicateCount,
                invalidCount,
                createdEvents: created.map(event => ({ id: event.id, title: event.title, sourceMessageIds: event.sourceMessageIds }))
            });
            return created;
        } catch (error) {
            extractionDebug('提取失败', { ...debugBase, error: error?.message || String(error), stack: error?.stack || '' }, 'error');
            throw error;
        }
    }

    async function summarizeRecentMessages(character, count) {
        const messages = (character.history || [])
            .filter(message => message && ['user', 'assistant', 'char'].includes(message.role) && !message.isContextDisabled && !message.isThinking)
            .slice(-Math.max(4, Number(count || 30)));
        const created = await extractEventsFromMessages(character, messages, 'unified-memory-event-extract-manual');
        const state = ensureState(character);
        const last = messages[messages.length - 1];
        if (last) {
            state.automation.lastProcessedMessageId = last.id || state.automation.lastProcessedMessageId;
            state.automation.lastProcessedMessageTimestamp = Number(last.timestamp || Date.now());
        }
        await persist();
        return created;
    }


    async function batchExtractMessages(character, options) {
        if (ui.batchRunning) throw new Error('已有批量提取正在运行');
        const state = ensureState(character);
        const settings = options || {};
        const mode = settings.mode === 'all' ? 'all' : 'unprocessed';
        const batchSize = Math.max(4, Math.min(300, Number(settings.batchSize || 40)));
        const maxBatches = Math.max(1, Math.min(200, Number(settings.maxBatches || 20)));
        const all = eligibleHistoryMessages(character);
        let source;
        if (mode === 'all') {
            source = all.slice();
        } else {
            source = getUnprocessedMessages(character);
            if (!state.automation.lastProcessedMessageId && !state.automation.lastProcessedMessageTimestamp) {
                source = all.slice();
            }
        }
        if (!source.length) throw new Error(mode === 'all' ? '当前角色没有可提取的聊天消息' : '没有未处理的聊天消息');
        ui.batchRunning = true;
        ui.batchStopRequested = false;
        ui.batchProgress = { mode, totalMessages: source.length, processedMessages: 0, totalCreated: 0, currentBatch: 0, maxBatches, status: 'running' };
        extractionDebug('批量提取开始', { mode, totalMessages: source.length, batchSize, maxBatches });
        let processedMessages = 0;
        let totalCreated = 0;
        let completedBatches = 0;
        try {
            for (let offset = 0; offset < source.length && completedBatches < maxBatches; offset += batchSize) {
                if (ui.batchStopRequested) break;
                const batch = source.slice(offset, offset + batchSize);
                completedBatches += 1;
                ui.batchProgress = { ...ui.batchProgress, currentBatch: completedBatches, currentBatchMessages: batch.length };
                render();
                extractionDebug(`批次 ${completedBatches} 开始`, { offset, messageCount: batch.length, firstMessageId: batch[0]?.id, lastMessageId: batch[batch.length - 1]?.id });
                const created = await extractEventsFromMessages(character, batch, `unified-memory-batch-extract-${completedBatches}`);
                totalCreated += created.length;
                processedMessages += batch.length;
                const last = batch[batch.length - 1];
                if (last) {
                    state.automation.lastProcessedMessageId = last.id || state.automation.lastProcessedMessageId;
                    state.automation.lastProcessedMessageTimestamp = Number(last.timestamp || Date.now());
                }
                ui.batchProgress = { ...ui.batchProgress, processedMessages, totalCreated };
                await persist();
                render();
            }
            const stopped = ui.batchStopRequested;
            ui.batchProgress = { ...ui.batchProgress, status: stopped ? 'stopped' : 'completed', processedMessages, totalCreated, currentBatch: completedBatches };
            extractionDebug(stopped ? '批量提取已停止' : '批量提取完成', ui.batchProgress);
            await persist();
            return clone(ui.batchProgress);
        } catch (error) {
            ui.batchProgress = { ...ui.batchProgress, status: 'failed', error: error?.message || String(error), processedMessages, totalCreated, currentBatch: completedBatches };
            extractionDebug('批量提取失败', ui.batchProgress, 'error');
            throw error;
        } finally {
            ui.batchRunning = false;
            ui.batchStopRequested = false;
            render();
        }
    }

    function parseJsonObject(text) {
        let raw = String(text || '').trim();
        raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch (_) {}
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start !== -1 && end > start) {
            const parsed = JSON.parse(raw.slice(start, end + 1));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        }
        throw new Error('主题整理模型没有返回合法 JSON 对象');
    }

    function topicEvidenceEvents(state, topic) {
        const ids = new Set(topic.evidenceEventIds || []);
        state.events.forEach(event => {
            if ((event.topicIds || []).includes(topic.id)) ids.add(event.id);
        });
        topic.evidenceEventIds = [...ids];
        return [...ids].map(id => state.events.find(event => event.id === id)).filter(event => event && event.status === 'active')
            .sort((a, b) => Number(a.occurredAt || 0) - Number(b.occurredAt || 0));
    }

    function collectTopicContext(character, topic, mode) {
        const state = ensureState(character);
        const evidence = topicEvidenceEvents(state, topic);
        const analyzed = new Set(topic.analyzedEventIds || []);
        const newEvidence = mode === 'all' ? evidence : evidence.filter(event => !analyzed.has(event.id));
        const oldEvidence = evidence.filter(event => !newEvidence.some(item => item.id === event.id)).slice(-30);
        const topicWords = [topic.name, ...(topic.keywords || []), ...(topic.aliases || [])].join(' ');
        const selected = selectMemories(character, topicWords, { touch: false });
        const linkedDoorplates = getRoomPlateEntryRows(state);
        const doorplates = [...new Map([...linkedDoorplates, ...selected.doorplates.map(entry => entry.item)].map(item => [item.id, item])).values()].slice(0, 40);
        const impression = normalizeUserImpressionLocal(state.impression);
        const boxIds = new Set(evidence.map(event => event.eventBoxId).filter(Boolean));
        const eventBoxes = state.eventBoxes.filter(box => boxIds.has(box.id) || keywordScore(box, topicWords).score > 0).slice(0, 12);
        return { evidence, newEvidence, oldEvidence, doorplates, impression, eventBoxes };
    }

    function formatTopicEvent(event) {
        return `- [${event.id}] [${formatDate(event.occurredAt)}] ${event.title || '事件'}\n  事实：${event.factualSummary || ''}${event.characterView ? `\n  角色理解：${event.characterView}（置信度 ${Math.round(clamp(event.viewConfidence, 0, 1, 0.5) * 100)}%）` : ''}${event.outcome ? `\n  结果：${event.outcome}` : ''}`;
    }

    function buildTopicUpdatePrompt(character, topic, pack, mode) {
        const sectionNames = topic.sections || DEFAULT_TOPIC_SECTIONS;
        const basePrompt = ensureState(character).prompts.topicUpdate || DEFAULT_TOPIC_PROMPT;
        const custom = String(topic.customPrompt || '').trim();
        const previous = formatTopicProfile(topic, { includeEvidence: true }) || '尚无结构化主题档案。';
        const newText = pack.newEvidence.length ? pack.newEvidence.slice(-35).map(formatTopicEvent).join('\n') : '没有新增证据。';
        const oldText = pack.oldEvidence.length ? pack.oldEvidence.slice(-30).map(formatTopicEvent).join('\n') : '没有额外历史证据。';
        const doorplateText = pack.doorplates.length ? pack.doorplates.map(item => `- [${sullyRoomLabel(item.room)}·${plateTag(item,'doorplate')}] ${plateText(item,'doorplate')}`).join('\n') : '无';
        const impressionText = pack.impression ? formatStructuredImpression(pack.impression) : '无';
        const boxText = pack.eventBoxes.length ? pack.eventBoxes.map(box => `- [${box.id}] ${box.name}：${box.summary || '暂无摘要'}；阶段=${box.currentStage || '未填写'}；未解决=${(box.unresolvedQuestions || []).join('、') || '无'}`).join('\n') : '无';
        return `${basePrompt}\n\n【整理模式】\n${mode === 'all' ? '使用全部证据重新整理完整档案。' : '基于新增证据增量更新，但输出完整更新后档案。'}\n\n【主题】\nID：${topic.id}\n名称：${topic.name}\n说明：${topic.description || '无'}\n档案分区：${sectionNames.join('、')}\n\n【主题专用要求】\n${custom || '无额外要求。'}\n\n【角色设定】\n角色名：${character.realName || character.remarkName || ''}\n角色人设：${typeof getEffectivePersona === 'function' ? (getEffectivePersona(character) || '') : (character.persona || '')}\n\n【用户设定】\n用户称呼：${character.myName || '用户'}\n用户人设：${character.myPersona || '无'}\n\n【已有主题档案】\n${previous}\n\n【新增主题证据】\n${newText}\n\n【相关历史证据】\n${oldText}\n\n【相关门牌】\n${doorplateText}\n\n【相关印象】\n${impressionText}\n\n【相关 EventBox】\n${boxText}\n\n请只使用以上事件 ID 作为 evidenceEventIds，并严格按这些分区输出：${sectionNames.join('、')}。`;
    }

    function normalizeTopicUpdateOutput(topic, raw, allowedIds) {
        const oldProfile = normalizeTopicProfile(topic.profile || {}, topic.sections || DEFAULT_TOPIC_SECTIONS);
        const rawSections = raw && raw.sections && typeof raw.sections === 'object' ? raw.sections : {};
        const next = {};
        const tentativeSection = (topic.sections || []).find(name => name.includes('暂定')) || '暂定模式';
        if (!(topic.sections || []).includes(tentativeSection)) topic.sections.push(tentativeSection);
        (topic.sections || DEFAULT_TOPIC_SECTIONS).forEach(section => {
            const hasOutput = Object.prototype.hasOwnProperty.call(rawSections, section);
            const source = hasOutput ? rawSections[section] : (oldProfile[section] || []);
            next[section] = (Array.isArray(source) ? source : (source ? [source] : [])).map(value => normalizeProfileEntry(value, section)).filter(Boolean).map(entry => {
                entry.evidenceEventIds = [...new Set((entry.evidenceEventIds || []).filter(id => allowedIds.has(id)))];
                entry.updatedAt = Date.now();
                return entry;
            });
        });
        const stableSections = (topic.sections || []).filter(name => name.includes('稳定'));
        stableSections.forEach(section => {
            const keep = [];
            const downgrade = [];
            (next[section] || []).forEach(entry => {
                if (entry.evidenceEventIds.length >= 3 || (entry.directlyStatedRecurrent && entry.evidenceEventIds.length >= 1)) keep.push(entry);
                else downgrade.push({ ...entry, confidence: Math.min(entry.confidence, 0.65) });
            });
            next[section] = keep;
            if (downgrade.length) next[tentativeSection] = [...(next[tentativeSection] || []), ...downgrade];
        });
        Object.keys(next).forEach(section => {
            const seen = new Set();
            next[section] = next[section].filter(entry => {
                const key = normalizeText(entry.statement);
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        });
        return { summary: String(raw.summary || '').trim(), profile: next };
    }

    function snapshotTopic(topic) {
        const copy = clone(topic);
        delete copy.manualActive;
        return copy;
    }

    function recordTopicVersion(state, topicId, previousTopic, nextTopic, reason, sourceEventIds, appliedBy) {
        state.topicVersions.unshift({
            id: uid('topicVersion'), topicId,
            previousTopic: clone(previousTopic), nextTopic: clone(nextTopic),
            reason: String(reason || ''), sourceEventIds: [...new Set(sourceEventIds || [])],
            createdAt: Date.now(), appliedBy: appliedBy || 'model'
        });
        if (state.topicVersions.length > 120) state.topicVersions.length = 120;
    }

    async function updateTopicProfile(character, topicId, mode) {
        const state = ensureState(character);
        const topic = state.topics.find(item => item.id === topicId);
        if (!topic) throw new Error('主题不存在');
        normalizeTopic(topic);
        const pack = collectTopicContext(character, topic, mode || 'incremental');
        if (mode !== 'all' && pack.newEvidence.length === 0) throw new Error('这个主题没有尚未整理的新证据');
        if (pack.evidence.length === 0) throw new Error('这个主题还没有关联事件证据');
        const prompt = buildTopicUpdatePrompt(character, topic, pack, mode || 'incremental');
        const text = await requestSummary(prompt, 'unified-memory-topic-update', 0.2);
        const raw = parseJsonObject(text);
        const allowedIds = new Set(pack.evidence.map(event => event.id));
        const normalized = normalizeTopicUpdateOutput(topic, raw, allowedIds);
        const previous = snapshotTopic(topic);
        topic.profile = normalized.profile;
        topic.profileSummary = normalized.summary;
        topic.analyzedEventIds = [...new Set([...(topic.analyzedEventIds || []), ...pack.newEvidence.map(event => event.id)])];
        if (mode === 'all') topic.analyzedEventIds = pack.evidence.map(event => event.id);
        topic.version = Number(topic.version || 1) + 1;
        topic.updatedAt = Date.now();
        const next = snapshotTopic(topic);
        recordTopicVersion(state, topic.id, previous, next, mode === 'all' ? '使用全部证据重新整理主题档案' : `使用 ${pack.newEvidence.length} 条新增证据更新主题档案`, pack.newEvidence.map(event => event.id), 'model');
        state.retrieval.lastPreparedAt = null;
        await persist();
        return { topic, newEvidenceCount: pack.newEvidence.length, totalEvidenceCount: pack.evidence.length };
    }

    async function restoreTopicVersion(character, versionId) {
        const state = ensureState(character);
        const version = state.topicVersions.find(item => item.id === versionId);
        if (!version) throw new Error('版本不存在');
        const topic = state.topics.find(item => item.id === version.topicId);
        if (!topic) throw new Error('对应主题不存在');
        const current = snapshotTopic(topic);
        const restored = clone(version.previousTopic);
        Object.keys(topic).forEach(key => delete topic[key]);
        Object.assign(topic, restored, { id: version.topicId, updatedAt: Date.now() });
        normalizeTopic(topic);
        recordTopicVersion(state, topic.id, current, snapshotTopic(topic), `恢复到 ${formatDate(version.createdAt)} 之前的主题版本`, version.sourceEventIds || [], 'user');
        state.retrieval.lastPreparedAt = null;
        await persist();
        return topic;
    }



    const memoryJobRuntime = { processingCharacterId: null, promise: null };

    function jobLabel(type) {
        return ({
            event_extract: '事件提取', archive_consolidate: '门牌蒸馏', impression_update: '印象更新',
            event_box_update: '事件盒更新', topic_profile_update: '主题整理',
            embedding_generate: '事件向量生成', maintenance: '维护清理'
        })[type] || type;
    }

    function enqueueMemoryJob(character, type, payload, options) {
        const state = ensureState(character);
        options = options || {};
        const dedupeKey = options.dedupeKey || `${type}:${JSON.stringify(payload || {})}`;
        const existing = state.jobs.find(job => job.dedupeKey === dedupeKey && ['pending', 'running', 'awaiting_review', 'failed'].includes(job.status));
        if (existing) {
            if (existing.status === 'failed' && options.reviveFailed) {
                existing.status = 'pending'; existing.nextRetryAt = null; existing.error = '';
            }
            return existing;
        }
        const job = {
            id: uid('job'), type, status: options.status || 'pending', dedupeKey,
            payload: clone(payload || {}), attempts: 0,
            maxAttempts: Math.max(1, Number(state.automation.maxAttempts || 3)),
            createdAt: Date.now(), startedAt: null, finishedAt: null,
            nextRetryAt: null, error: '', result: {}, summary: options.summary || ''
        };
        state.jobs.unshift(job);
        if (state.jobs.length > 240) state.jobs.length = 240;
        return job;
    }

    function eligibleHistoryMessages(character) {
        return (character.history || []).filter(message => message && message.id && ['user', 'assistant', 'char'].includes(message.role) && !message.isContextDisabled && !message.isThinking);
    }

    function getUnprocessedMessages(character) {
        const state = ensureState(character); const auto = state.automation;
        const all = eligibleHistoryMessages(character);
        if (!all.length) return [];
        let start = 0;
        if (auto.lastProcessedMessageId) {
            const index = all.findIndex(message => message.id === auto.lastProcessedMessageId);
            if (index >= 0) start = index + 1;
            else if (auto.lastProcessedMessageTimestamp) start = all.findIndex(message => Number(message.timestamp || 0) > Number(auto.lastProcessedMessageTimestamp || 0));
        } else if (auto.lastProcessedMessageTimestamp) {
            start = all.findIndex(message => Number(message.timestamp || 0) > Number(auto.lastProcessedMessageTimestamp || 0));
        } else {
            start = Math.max(0, all.length - Math.max(Number(auto.eventBatchLimit || 60), Number(auto.eventMessageThreshold || 24)));
        }
        if (start < 0) return [];
        return all.slice(start);
    }

    function topicNewEvidenceCount(state, topic) {
        const analyzed = new Set(topic.analyzedEventIds || []);
        return topicEvidenceEvents(state, topic).filter(event => !analyzed.has(event.id)).length;
    }

    function scheduleUnifiedMemoryJobs(character, reason) {
        const state = ensureState(character); const auto = state.automation; const now = Date.now();
        if (!state.enabled || !auto.enabled) return [];
        const scheduled = [];
        const activeStatuses = new Set(['pending', 'running', 'awaiting_review', 'failed']);
        const activeJobs = state.jobs.filter(job => activeStatuses.has(job.status));
        if (auto.eventExtractionEnabled && !activeJobs.some(job => job.type === 'event_extract')) {
            const unprocessed = getUnprocessedMessages(character);
            if (unprocessed.length >= Math.max(2, Number(auto.eventMessageThreshold || 24))) {
                const batch = unprocessed.slice(0, Math.max(4, Number(auto.eventBatchLimit || 60)));
                const first = batch[0], last = batch[batch.length - 1];
                scheduled.push(enqueueMemoryJob(character, 'event_extract', {
                    messageIds: batch.map(message => message.id), firstMessageId: first.id, lastMessageId: last.id,
                    lastMessageTimestamp: Number(last.timestamp || 0), reason: reason || '消息达到自动提取阈值'
                }, { dedupeKey: `event_extract:${first.id}:${last.id}` }));
            }
        }
        if (auto.archiveConsolidationEnabled) {
            const analyzed = new Set(auto.archiveAnalyzedEventIds || []);
            const reserved = new Set(activeJobs.filter(job => job.type === 'archive_consolidate').flatMap(job => job.payload?.eventIds || []));
            const events = state.events.filter(event => event.status === 'active' && !analyzed.has(event.id) && !reserved.has(event.id)).sort((a,b)=>Number(a.occurredAt||0)-Number(b.occurredAt||0));
            if (events.length >= Math.max(2, Number(auto.archiveEventThreshold || 8))) {
                const selected = events.slice(0, 30);
                scheduled.push(enqueueMemoryJob(character, 'archive_consolidate', { eventIds: selected.map(event => event.id) }, { dedupeKey: `archive:${selected[0].id}:${selected[selected.length-1].id}` }));
            }
        }
        if (auto.impressionUpdateEnabled && !activeJobs.some(job => job.type === 'impression_update')) {
            const analyzed = new Set(auto.impressionAnalyzedEventIds || []);
            const reserved = new Set(activeJobs.filter(job => job.type === 'impression_update').flatMap(job => job.payload?.eventIds || []));
            const events = state.events.filter(event => event.status === 'active' && !analyzed.has(event.id) && !reserved.has(event.id)).sort((a,b)=>Number(a.occurredAt||0)-Number(b.occurredAt||0));
            if (events.length >= Math.max(4, Number(auto.impressionEventThreshold || 20))) {
                const selected = events.slice(0, 60);
                scheduled.push(enqueueMemoryJob(character, 'impression_update', { eventIds: selected.map(event => event.id), mode: state.impression ? 'update' : 'initial' }, { dedupeKey: `impression:${selected[0].id}:${selected[selected.length-1].id}` }));
            }
        }
        if (auto.eventBoxUpdateEnabled) {
            state.eventBoxes.forEach(box => {
                if (activeJobs.some(job => job.type === 'event_box_update' && job.payload?.boxId === box.id)) return;
                const linked = state.events.filter(event => event.status === 'active' && event.eventBoxId === box.id);
                const analyzed = new Set(box.analyzedEventIds || []);
                const fresh = linked.filter(event => !analyzed.has(event.id));
                if (fresh.length >= Math.max(1, Number(auto.eventBoxNewEventThreshold || 1))) {
                    scheduled.push(enqueueMemoryJob(character, 'event_box_update', { boxId: box.id, eventIds: fresh.map(event => event.id) }, { dedupeKey: `box:${box.id}:${fresh.map(event=>event.id).join(',')}` }));
                }
            });
        }
        if (auto.embeddingGenerateEnabled && state.vector.enabled && !activeJobs.some(job => job.type === 'embedding_generate')) {
            const reserved = new Set(activeJobs.filter(job => job.type === 'embedding_generate').flatMap(job => job.payload?.eventIds || []));
            const pending = state.events.filter(event => event.status === 'active' && !reserved.has(event.id) && eventNeedsEmbedding(event));
            if (pending.length) {
                const selected = pending.slice(0, Math.max(1, Number(auto.embeddingBatchSize || 12)));
                scheduled.push(enqueueMemoryJob(character, 'embedding_generate', { eventIds: selected.map(event => event.id) }, { dedupeKey: `embedding:${currentVectorModelSignature()}:${selected.map(event => event.id).join(',')}` }));
            }
        }
        if (auto.topicUpdateEnabled) {
            state.topics.forEach(topic => {
                normalizeTopic(topic);
                if (activeJobs.some(job => job.type === 'topic_profile_update' && job.payload?.topicId === topic.id)) return;
                const count = topicNewEvidenceCount(state, topic);
                if (topic.updatePolicy.autoPrepare && count >= Math.max(1, Number(topic.updatePolicy.minNewEvidence || 4))) {
                    scheduled.push(enqueueMemoryJob(character, 'topic_profile_update', { topicId: topic.id, mode: 'incremental' }, {
                        dedupeKey: `topic:${topic.id}:${(topic.evidenceEventIds || []).length}:${(topic.analyzedEventIds || []).length}`,
                        status: topic.updatePolicy.requireUserReview ? 'awaiting_review' : 'pending',
                        summary: topic.updatePolicy.requireUserReview ? '等待用户确认后执行主题整理' : ''
                    }));
                }
            });
        }
        if (auto.maintenanceEnabled && !activeJobs.some(job => job.type === 'maintenance') && now - Number(auto.lastMaintenanceAt || 0) >= Math.max(1, Number(auto.maintenanceIntervalHours || 24)) * 3600000) {
            scheduled.push(enqueueMemoryJob(character, 'maintenance', {}, { dedupeKey: `maintenance:${formatDate(now)}` }));
        }
        auto.lastSchedulerAt = now;
        return scheduled.filter(Boolean);
    }

    function getJobMessages(character, ids) {
        const wanted = new Set(ids || []);
        return eligibleHistoryMessages(character).filter(message => wanted.has(message.id));
    }

    function normalizeArchiveProposalOutput(state, raw, allowedEventIds) {
        const existingDoor = new Map(state.doorplates.map(item => [item.id, item]));
        const existingImp = new Map(state.impressions.map(item => [item.id, item]));
        const normalizeAction = (value, type) => {
            if (!value || typeof value !== 'object') return null;
            const action = ['create','update','archive'].includes(value.action) ? value.action : 'create';
            const targetId = String(value.targetId || '');
            const existing = type === 'doorplate' ? existingDoor.get(targetId) : existingImp.get(targetId);
            if ((action === 'update' || action === 'archive') && (!existing || existing.locked)) return null;
            const sourceIds = parseList(type === 'doorplate' ? value.sourceEventIds : value.supportingEventIds).filter(id => allowedEventIds.has(id));
            const counterIds = type === 'impression' ? parseList(value.counterEventIds).filter(id => allowedEventIds.has(id)) : [];
            const text = String(type === 'doorplate' ? value.content : value.statement || '').trim();
            if (action !== 'archive' && !text) return null;
            const tag = String(value.tag || (type === 'doorplate' ? value.category : value.dimension) || existing?.tag || (type === 'doorplate' ? existing?.category : existing?.dimension) || '').trim();
            const room = String(value.room || existing?.room || (type === 'doorplate' ? 'user_room' : 'bedroom')).trim();
            const finalText = String(value.text || text || existing?.text || '').trim();
            return { action, targetId, type, room, tag, text: finalText,
                category: tag, dimension: tag,
                content: type === 'doorplate' ? finalText : undefined,
                statement: type === 'impression' ? finalText : undefined,
                keywords: parseList(value.keywords).slice(0,20), aliases: parseList(value.aliases).slice(0,20),
                confidence: clamp(value.confidence,0,1,0.7), sourceCount: Math.max(1, Math.round(Number(value.sourceCount || sourceIds.length || existing?.sourceCount || 1))), sourceEventIds: sourceIds,
                supportingEventIds: sourceIds, counterEventIds: counterIds };
        };
        return {
            summary: String(raw.summary || '').trim(),
            eventIds: [...allowedEventIds],
            doorplates: (Array.isArray(raw.doorplates) ? raw.doorplates : []).map(v=>normalizeAction(v,'doorplate')).filter(Boolean),
            impressions: (Array.isArray(raw.impressions) ? raw.impressions : []).map(v=>normalizeAction(v,'impression')).filter(Boolean)
        };
    }

    function buildArchiveConsolidationPrompt(character, events) {
        const state = ensureState(character);
        const door = getRoomPlateEntryRows(state).map(item => `- [${item.id}] room=${item.room} tag=${item.tag || ''} sourceCount=${Number(item.sourceCount||0)}：${item.text || ''}`).join('\n') || '无';
        return `${state.prompts.archiveConsolidation || DEFAULT_ARCHIVE_PROMPT}\n\n【角色】${character.realName || character.remarkName || ''}\n【用户】${character.myName || '用户'}\n\n【现有完整门牌】\n${door}\n\n【新增事件】\n${events.map(formatTopicEvent).join('\n')}`;
    }

    function upsertRoomPlateEntry(state, proposal) {
        const now = Date.now();
        const room = SULLY_PLATE_ORDER.includes(proposal.room) ? proposal.room : 'user_room';
        const found = proposal.targetId ? findRoomPlateEntry(state, proposal.targetId) : null;
        if (proposal.action === 'archive') {
            if (found) found.plate.entries = found.plate.entries.filter(entry => entry.id !== found.entry.id);
            return;
        }
        if (found) {
            found.entry.text = String(proposal.text || found.entry.text || '').trim();
            found.entry.tag = String(proposal.tag || found.entry.tag || '').trim();
            found.entry.sourceCount = Math.max(Number(found.entry.sourceCount || 1), Number(proposal.sourceCount || 1));
            found.entry.updatedAt = now;
            if (found.plate.room !== room) {
                found.plate.entries = found.plate.entries.filter(entry => entry.id !== found.entry.id);
                const target = state.roomPlates.find(plate => plate.room === room);
                target.entries.unshift(found.entry);
            }
        } else if (proposal.action === 'create' && String(proposal.text || '').trim()) {
            const target = state.roomPlates.find(plate => plate.room === room);
            target.entries.unshift(normalizeRoomPlateEntry({ id: uid('pe'), text: proposal.text, tag: proposal.tag || '', firstLearnedAt: now, updatedAt: now, sourceCount: Number(proposal.sourceCount || 1) }));
        }
        state.roomPlates.forEach(plate => { plate.updatedAt = now; plate.version = Number(plate.version || 1) + 1; });
        state.doorplates = getRoomPlateEntryRows(state);
    }

    function applyArchiveProposals(character, job) {
        const state = ensureState(character); const result = job.result || {};
        (result.doorplates || []).forEach(proposal => upsertRoomPlateEntry(state, proposal));
        state.automation.archiveAnalyzedEventIds = [...new Set([...(state.automation.archiveAnalyzedEventIds||[]), ...(result.eventIds||[])])];
        job.status='completed'; job.finishedAt=Date.now(); job.summary=result.summary || `已应用 ${(result.doorplates||[]).length} 条门牌建议`;
        state.retrieval.lastPreparedAt=null;
    }

    function buildImpressionUpdatePrompt(character, events, mode) {
        const state = ensureState(character);
        const plates = state.roomPlates.map(plate => `【${SULLY_PLATE_LABELS[plate.room] || plate.room}】\n${(plate.entries||[]).map(entry => `- [${entry.tag || '未分类'}] ${entry.text}（印证${entry.sourceCount}次）`).join('\n') || '无'}`).join('\n\n');
        const topics = state.topics.filter(topic => topic.status === 'confirmed').map(topic => `【${topic.name}】\n${formatTopicProfile(topic) || topic.description || '尚无档案'}`).join('\n\n') || '无';
        const boxes = state.eventBoxes.filter(box => box.status !== 'archived').slice(0, 20).map(box => `- ${box.name}：${box.summary || box.currentStage || ''}`).join('\n') || '无';
        const old = mode === 'initial' ? 'null' : JSON.stringify(normalizeUserImpressionLocal(state.impression), null, 2);
        const recent = (character.history || []).filter(message => ['user','assistant','char'].includes(message.role)).slice(-50).map(message => `${message.role === 'user' ? character.myName || '用户' : character.realName || character.remarkName || '角色'}：${String(message.content || '')}`).join('\n');
        return `${state.prompts.impressionUpdate || DEFAULT_IMPRESSION_PROMPT}\n\n【更新模式】${mode}\n【角色人设】\n${character.persona || ''}\n【用户人设】\n${character.myPersona || ''}\n【旧印象】\n${old}\n【完整门牌】\n${plates}\n【已确认主题】\n${topics}\n【相关事件盒】\n${boxes}\n【长期事件证据】\n${events.map(formatTopicEvent).join('\n')}\n【近期聊天，仅用于近期状态和变化】\n${recent}`;
    }

    async function generateStructuredImpression(character, mode, events) {
        const state = ensureState(character);
        const evidence = Array.isArray(events) && events.length ? events : state.events.filter(event => event.status === 'active').slice(-80);
        const raw = parseJsonObject(await requestSummary(buildImpressionUpdatePrompt(character, evidence, mode || (state.impression ? 'update' : 'initial')), 'unified-memory-impression-update', 0.25));
        const normalized = normalizeUserImpressionLocal(raw);
        if (!normalized) throw new Error('印象返回结构不完整');
        normalized.lastUpdated = Date.now();
        state.impression = normalized;
        state.retrieval.lastPreparedAt = null;
        await persist();
        return normalized;
    }

    async function runMemoryJob(character, job) {
        const state = ensureState(character);
        if (job.type === 'event_extract') {
            const messages = getJobMessages(character, job.payload.messageIds);
            if (!messages.length) throw new Error('任务对应的聊天消息已不存在');
            const created = await extractEventsFromMessages(character, messages, 'unified-memory-event-extract-auto');
            const last = messages[messages.length-1];
            state.automation.lastProcessedMessageId = last.id;
            state.automation.lastProcessedMessageTimestamp = Number(last.timestamp || Date.now());
            return { summary:`处理 ${messages.length} 条消息，生成 ${created.length} 条事件`, createdEventIds:created.map(e=>e.id) };
        }
        if (job.type === 'archive_consolidate') {
            const ids = new Set(job.payload.eventIds || []); const events = state.events.filter(event=>ids.has(event.id)&&event.status==='active');
            if (!events.length) return { summary:'没有可巩固的新增事件', eventIds:[...ids] };
            const text = await requestSummary(buildArchiveConsolidationPrompt(character, events), 'unified-memory-archive-consolidate', 0.15);
            const raw = parseJsonObject(text); const result = normalizeArchiveProposalOutput(state, raw, new Set(events.map(e=>e.id)));
            if (!result.doorplates.length) {
                state.automation.archiveAnalyzedEventIds = [...new Set([...(state.automation.archiveAnalyzedEventIds||[]), ...events.map(e=>e.id)])];
                return { ...result, summary:result.summary || '没有形成可靠档案建议' };
            }
            if (state.automation.archiveAutoApply !== false) { const tempJob={result}; applyArchiveProposals(character,tempJob); return {...result, summary:tempJob.summary || result.summary || '已自动更新门牌'}; }
            return { ...result, awaitingReview:true };
        }
        if (job.type === 'impression_update') {
            const ids = new Set(job.payload.eventIds || []);
            const events = state.events.filter(event => ids.has(event.id) && event.status === 'active');
            const impression = await generateStructuredImpression(character, job.payload.mode || (state.impression ? 'update' : 'initial'), events);
            state.automation.impressionAnalyzedEventIds = [...new Set([...(state.automation.impressionAnalyzedEventIds || []), ...events.map(event => event.id)])];
            return { summary: `印象档案已更新到 v${Number(impression.version || 3).toFixed(1)}`, eventIds: events.map(event => event.id) };
        }
        if (job.type === 'event_box_update') {
            const box=state.eventBoxes.find(item=>item.id===job.payload.boxId); if(!box) throw new Error('事件盒不存在');
            const events=state.events.filter(event=>event.eventBoxId===box.id&&event.status==='active').sort((a,b)=>Number(a.occurredAt||0)-Number(b.occurredAt||0));
            if(!events.length) throw new Error('事件盒没有关联事件');
            const prompt=`${state.prompts.eventBoxUpdate || DEFAULT_EVENT_BOX_PROMPT}\n\n【事件盒当前状态】\n名称：${box.name}\n摘要：${box.summary||''}\n当前阶段：${box.currentStage||''}\n状态：${box.status||'ongoing'}\n未解决：${(box.unresolvedQuestions||[]).join('；')}\n\n【完整事件时间线】\n${events.map(formatTopicEvent).join('\n')}`;
            const raw=parseJsonObject(await requestSummary(prompt,'unified-memory-event-box-update',0.15));
            box.summary=String(raw.summary||box.summary||'').trim(); box.currentStage=String(raw.currentStage||box.currentStage||'').trim();
            box.status=raw.status==='completed'?'completed':'ongoing'; box.unresolvedQuestions=parseList(raw.unresolvedQuestions); box.keywords=[...new Set([...(box.keywords||[]),...parseList(raw.keywords)])].slice(0,30);
            box.analyzedEventIds=events.map(e=>e.id); box.updatedAt=Date.now(); state.retrieval.lastPreparedAt=null;
            return {summary:`已更新事件盒“${box.name}”`, boxId:box.id};
        }
        if (job.type === 'topic_profile_update') {
            const result=await updateTopicProfile(character,job.payload.topicId,job.payload.mode||'incremental');
            return {summary:`主题“${result.topic.name}”已使用 ${result.newEvidenceCount} 条新增证据更新`,topicId:result.topic.id};
        }
        if (job.type === 'embedding_generate') {
            const result = await generateEventEmbeddings(character, job.payload.eventIds || []);
            return { summary: `已为 ${result.count} 条事件生成向量`, eventIds: result.eventIds };
        }
        if (job.type === 'maintenance') {
            const now=Date.now(); let expired=0;
            state.workingMemories.forEach(item=>{if(item.status==='active'&&item.expiresAt&&Number(item.expiresAt)<=now){item.status='ended';expired++;}});
            state.topics.forEach(topic=>topicEvidenceEvents(state,topic));
            state.jobs = state.jobs.filter((item,index)=>index<160 || !['completed','cancelled'].includes(item.status));
            state.automation.lastMaintenanceAt=now; state.retrieval.lastPreparedAt=null;
            return {summary:`维护完成：结束 ${expired} 条过期临时记忆`};
        }
        throw new Error(`未知任务类型：${job.type}`);
    }

    async function processUnifiedMemoryQueue(character, options) {
        const state=ensureState(character); options=options||{};
        if (memoryJobRuntime.promise) return memoryJobRuntime.promise;
        const run=async()=>{
            memoryJobRuntime.processingCharacterId=character.id;
            let count=0; const limit=Math.max(1,Number(options.maxJobs||state.automation.maxJobsPerRun||3));
            while(count<limit){
                const now=Date.now();
                const job=state.jobs.slice().reverse().find(item=>item.status==='pending' || (item.status==='failed'&&item.attempts<item.maxAttempts&&Number(item.nextRetryAt||0)<=now));
                if(!job) break;
                job.status='running'; job.startedAt=Date.now(); job.attempts=Number(job.attempts||0)+1; job.error=''; await persist();
                try{
                    const result=await runMemoryJob(character,job); job.result=clone(result||{});
                    if(result&&result.awaitingReview){job.status='awaiting_review';job.summary=result.summary||'等待确认档案建议';}
                    else {job.status='completed';job.finishedAt=Date.now();job.summary=result?.summary||'任务完成';}
                }catch(error){
                    job.status='failed'; job.finishedAt=Date.now(); job.error=String(error?.message||error);
                    job.nextRetryAt=Date.now()+Math.max(1,Number(state.automation.retryDelayMinutes||15))*60000;
                    console.error('[UnifiedMemory] job failed',job,error);
                }
                await persist(); count++;
                scheduleUnifiedMemoryJobs(character,'任务完成后继续检查');
            }
            await persist(); return count;
        };
        memoryJobRuntime.promise=run().finally(()=>{memoryJobRuntime.promise=null;memoryJobRuntime.processingCharacterId=null;});
        return memoryJobRuntime.promise;
    }

    async function checkAndTriggerUnifiedMemoryJobs(character) {
        const state=ensureState(character);
        if(!state||!state.enabled||!state.automation.enabled||!state.automation.autoRunAfterReply)return 0;
        scheduleUnifiedMemoryJobs(character,'回复完成'); await persist();
        return processUnifiedMemoryQueue(character);
    }

    const TOPIC_STOP_WORDS = new Set([
        '用户', '角色', '聊天', '事情', '今天', '昨天', '最近', '感觉', '情绪', '关系', '日常',
        '表达', '回应', '状态', '问题', '一次', '继续', '当前', '对话', '时间', '内容', '想法'
    ]);

    function dateKey(value) {
        return formatDate(value || Date.now());
    }

    function validTopicKeyword(value) {
        const word = String(value || '').trim();
        const normalized = normalizeText(word);
        return normalized.length >= 2 && normalized.length <= 18 && !TOPIC_STOP_WORDS.has(word);
    }

    function getTopicCandidates(character) {
        const state = ensureState(character);
        const settings = state.topicSettings;
        const now = Date.now();
        const recentCutoff = now - Number(settings.recentDays || 30) * 86400000;
        const groups = new Map();
        state.events.filter(event => event.status === 'active').forEach(event => {
            const words = [...new Set([...(event.keywords || []), ...(event.aliases || [])].filter(validTopicKeyword))];
            words.forEach(word => {
                const key = normalizeText(word);
                if (!key) return;
                if (!groups.has(key)) groups.set(key, { key, label: word, eventIds: new Set(), dates: new Set(), recentEventIds: new Set(), coWords: new Map(), firstSeenAt: Infinity, lastSeenAt: 0 });
                const group = groups.get(key);
                group.eventIds.add(event.id);
                group.dates.add(dateKey(event.occurredAt));
                if (Number(event.occurredAt || 0) >= recentCutoff) group.recentEventIds.add(event.id);
                group.firstSeenAt = Math.min(group.firstSeenAt, Number(event.occurredAt || event.createdAt || now));
                group.lastSeenAt = Math.max(group.lastSeenAt, Number(event.occurredAt || event.createdAt || 0));
                words.forEach(other => {
                    const otherKey = normalizeText(other);
                    if (!otherKey || otherKey === key) return;
                    group.coWords.set(other, (group.coWords.get(other) || 0) + 1);
                });
            });
        });
        const confirmedWords = new Set();
        state.topics.forEach(topic => [...(topic.keywords || []), ...(topic.aliases || [])].forEach(word => confirmedWords.add(normalizeText(word))));
        return [...groups.values()].map(group => {
            const decision = state.topicDecisions[group.key] || null;
            const events = [...group.eventIds].map(id => state.events.find(event => event.id === id)).filter(Boolean).sort((a, b) => Number(b.occurredAt || 0) - Number(a.occurredAt || 0));
            return {
                keyword: group.label,
                key: group.key,
                independentEventCount: group.eventIds.size,
                distinctDayCount: group.dates.size,
                recentCount: group.recentEventIds.size,
                firstSeenAt: group.firstSeenAt === Infinity ? null : group.firstSeenAt,
                lastSeenAt: group.lastSeenAt || null,
                eventIds: [...group.eventIds],
                sampleEvents: events.slice(0, 3),
                relatedKeywords: [...group.coWords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word]) => word),
                decision
            };
        }).filter(candidate => {
            if (confirmedWords.has(candidate.key)) return false;
            const d = candidate.decision;
            if (d?.status === 'dismissed') return false;
            if (d?.status === 'deferred' && Number(d.until || 0) > now) return false;
            return candidate.independentEventCount >= Number(settings.minEvents || 5)
                && candidate.distinctDayCount >= Number(settings.minDays || 3)
                && candidate.recentCount > 0;
        }).sort((a, b) => b.independentEventCount - a.independentEventCount || b.distinctDayCount - a.distinctDayCount || Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0));
    }

    function getEventBoxSuggestions(character) {
        const state = ensureState(character);
        const suggestions = [];
        const unassigned = state.events.filter(event => event.status === 'active' && !event.eventBoxId);
        unassigned.forEach(event => {
            state.eventBoxes.filter(box => box.status !== 'archived').forEach(box => {
                const eventWords = new Set([...(event.keywords || []), ...(event.aliases || []), ...(event.eventBoxKeywords || [])].map(normalizeText).filter(Boolean));
                const boxWords = [...(box.keywords || []), box.name].map(normalizeText).filter(Boolean);
                const overlaps = boxWords.filter(word => [...eventWords].some(eventWord => eventWord.includes(word) || word.includes(eventWord)));
                const hintMatch = event.eventBoxHint && normalizeText(event.eventBoxHint) && (normalizeText(box.name).includes(normalizeText(event.eventBoxHint)) || normalizeText(event.eventBoxHint).includes(normalizeText(box.name)));
                const score = overlaps.length * 30 + (hintMatch ? 60 : 0);
                if (score >= 30) suggestions.push({ event, box, score, overlaps, hintMatch });
            });
        });
        return suggestions.sort((a, b) => b.score - a.score).slice(0, 30);
    }

    function getNewEventBoxSuggestions(character) {
        const state = ensureState(character);
        const groups = new Map();
        state.events.filter(event => event.status === 'active' && !event.eventBoxId && String(event.eventBoxHint || '').trim()).forEach(event => {
            const key = normalizeText(event.eventBoxHint);
            if (!key) return;
            if (!groups.has(key)) groups.set(key, { name: event.eventBoxHint, events: [], keywords: new Set() });
            const group = groups.get(key);
            group.events.push(event);
            [...(event.eventBoxKeywords || []), ...(event.keywords || [])].forEach(word => group.keywords.add(word));
        });
        const existing = state.eventBoxes.map(box => normalizeText(box.name));
        return [...groups.values()].filter(group => group.events.length >= 2 && !existing.some(name => name && (name.includes(normalizeText(group.name)) || normalizeText(group.name).includes(name)))).map(group => ({
            name: group.name,
            events: group.events.sort((a, b) => Number(a.occurredAt || 0) - Number(b.occurredAt || 0)),
            keywords: [...group.keywords].slice(0, 12)
        }));
    }

    function createTopicDraft(candidate) {
        return {
            name: candidate.keyword,
            description: `整理与“${candidate.keyword}”有关的跨事件信息。`,
            keywords: [candidate.keyword],
            aliases: [],
            negativeKeywords: [],
            evidenceEventIds: candidate.eventIds.slice(),
            analyzedEventIds: [],
            sections: DEFAULT_TOPIC_SECTIONS.slice(),
            profile: normalizeTopicProfile({}, DEFAULT_TOPIC_SECTIONS),
            profileText: '',
            profileSummary: '',
            customPrompt: '',
            updatePolicy: { minNewEvidence: 4, autoPrepare: true, requireUserReview: false },
            version: 1,
            sendPolicy: 'keyword',
            priority: 80,
            status: 'confirmed',
            sourceCandidateKey: candidate.key
        };
    }

    async function mergeCandidateIntoTopic(character, candidateKey, topicId) {
        const state = ensureState(character);
        const candidate = getTopicCandidates(character).find(item => item.key === candidateKey);
        const topic = state.topics.find(item => item.id === topicId);
        if (!candidate || !topic) throw new Error('候选主题或目标主题不存在');
        topic.keywords = [...new Set([...(topic.keywords || []), candidate.keyword])];
        topic.evidenceEventIds = [...new Set([...(topic.evidenceEventIds || []), ...candidate.eventIds])];
        candidate.eventIds.forEach(eventId => {
            const event = state.events.find(item => item.id === eventId);
            if (event && !(event.topicIds || []).includes(topic.id)) event.topicIds.push(topic.id);
        });
        topic.updatedAt = Date.now();
        state.topicDecisions[candidate.key] = { status: 'merged', topicId: topic.id, decidedAt: Date.now() };
        state.retrieval.lastPreparedAt = null;
        await persist();
    }

    async function createEventBoxFromHint(character, hintName) {
        const state = ensureState(character);
        const suggestion = getNewEventBoxSuggestions(character).find(item => item.name === hintName);
        if (!suggestion) throw new Error('事件盒建议已失效');
        const box = {
            id: uid('box'),
            characterId: character.id,
            name: suggestion.name,
            summary: '',
            currentStage: '',
            unresolvedQuestions: [],
            keywords: suggestion.keywords,
            status: 'ongoing',
            priority: 70,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        state.eventBoxes.unshift(box);
        suggestion.events.forEach(event => { event.eventBoxId = box.id; event.updatedAt = Date.now(); });
        state.retrieval.lastPreparedAt = null;
        await persist();
        return box;
    }

    function policyOptions(value) {
        return [
            ['always', '始终发送'],
            ['keyword', '关键词命中'],
            ['topic', '关联主题命中'],
            ['manual', '手动激活'],
            ['off', '不发送']
        ].map(([key, label]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${label}</option>`).join('');
    }

    function topicPolicyOptions(value) {
        return [
            ['always', '始终发送'],
            ['keyword', '关键词命中'],
            ['manual', '手动激活'],
            ['off', '不发送']
        ].map(([key, label]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${label}</option>`).join('');
    }

    function renderTagList(list) {
        return (list || []).map(item => `<span class="um-tag">${escapeHtml(item)}</span>`).join('');
    }

    function renderOverview(character) {
        const state = ensureState(character);
        const activeWorking = state.workingMemories.filter(item => isWorkingActive(item, Date.now())).length;
        const last = state.retrieval.lastDebug;
        return `
            <section class="um-card um-overview-head">
                <div>
                    <h2>${escapeHtml(character.remarkName || character.realName || '当前角色')} · 统一记忆</h2>
                    <p>版本 ${VERSION}。门牌使用 SullyOS RoomPlate 原生结构；印象使用 UserImpression v3.0 完整对象。事件仍由章鱼机自己提取。</p>
                </div>
                <label class="um-toggle-row"><input type="checkbox" data-um-setting="enabled" ${state.enabled ? 'checked' : ''}> 启用统一记忆</label>
                <label class="um-toggle-row"><input type="checkbox" data-um-setting="injectionEnabled" ${state.injectionEnabled ? 'checked' : ''}> 注入聊天提示词</label>
            </section>
            <div class="um-stat-grid">
                <div class="um-stat"><b>${roomPlateEntryCount(state)}</b><span>门牌条目</span></div>
                <div class="um-stat"><b>${state.impression ? 1 : 0}</b><span>完整印象档案</span></div>
                <div class="um-stat"><b>${activeWorking}</b><span>有效临时记忆</span></div>
                <div class="um-stat"><b>${state.events.length}</b><span>事件记忆</span></div>
                <div class="um-stat"><b>${state.eventBoxes.length}</b><span>事件盒</span></div>
                <div class="um-stat"><b>${state.topics.length}</b><span>已确认主题</span></div>
                <div class="um-stat"><b>${getTopicCandidates(character).length}</b><span>待确认推荐</span></div>
                <div class="um-stat"><b>${state.topicVersions.length}</b><span>主题版本</span></div>
                <div class="um-stat"><b>${state.events.filter(event => hasValidEventEmbedding(event)).length}</b><span>已有事件向量</span></div>
                <div class="um-stat"><b>${state.jobs.filter(job => ['pending','running','failed','awaiting_review'].includes(job.status)).length}</b><span>待处理任务</span></div>
            </div>
            <section class="um-card">
                <h3>当前注入状态</h3>
                <p class="um-muted">最近查询：${escapeHtml(state.retrieval.lastQueryText || '尚未生成')}</p>
                <pre class="um-preview">${escapeHtml(state.retrieval.lastContextBlock || '发送一条消息，或到“检索调试”中输入测试文本。')}</pre>
            </section>
            <section class="um-card">
                <h3>自动记忆使用顺序</h3>
                <ol class="um-steps">
                    <li>保持“自动任务”开启；每次回复后会检查新消息并提取事件。</li>
                    <li>累计新事件达到阈值后，系统自动蒸馏门牌；印象按更低频率独立更新。</li>
                    <li>门牌保留 SullyOS RoomPlate 原始格式；印象保留 UserImpression v3.0 完整结构。</li>
                </ol>
            </section>`;
    }

    function renderDoorplates(character) {
        const state = ensureState(character);
        const total = roomPlateEntryCount(state);
        return `
            <section class="um-card um-resident-hero"><div class="um-row-head"><div><small>RESIDENT KNOWLEDGE</small><h3>常驻门牌</h3></div><span>${total} 条</span></div><p class="um-muted">门牌是角色已经蒸馏成常识的稳定认知。事件提取时固定发送全部门牌；聊天回答仍按“设置”中的发送策略。</p><div class="um-actions"><button class="btn btn-primary btn-small" data-um-action="add-doorplate-room" data-room="user_room">新增门牌</button><button class="btn btn-secondary btn-small" data-um-action="export-roomplates">复制门牌 JSON</button></div></section>
            <div class="um-list um-plate-groups">${state.roomPlates.map(plate => {
                const capacity = SULLY_PLATE_CAPACITY[plate.room] || 12;
                const description = SULLY_PLATE_DESCRIPTIONS?.[plate.room] || '';
                return `<section class="um-card um-plate-room"><div class="um-row-head"><div><span class="um-kind">${escapeHtml(SULLY_PLATE_LABELS[plate.room] || plate.room)}</span><b>${escapeHtml(description)}</b></div><span>${plate.entries.length}/${capacity}</span></div><div class="um-plate-entry-list">${plate.entries.length ? plate.entries.map(entry => `<article class="um-plate-entry"><div class="um-row-head"><span class="um-tag">${escapeHtml(entry.tag || '未分类')}</span><span class="um-confidence">印证 ${Number(entry.sourceCount || 1)} 次</span></div><button class="um-plate-text-button" data-um-action="edit" data-type="doorplate" data-id="${entry.id}" title="点击编辑门牌">${escapeHtml(entry.text)}</button><div class="um-meta">${formatDate(entry.firstLearnedAt)} 得知 · ${formatDate(entry.updatedAt)} 更新</div><div class="um-actions um-plate-actions"><button class="btn btn-small btn-secondary" data-um-action="edit" data-type="doorplate" data-id="${entry.id}">编辑</button><button class="btn btn-small btn-danger" data-um-action="delete" data-type="doorplate" data-id="${entry.id}">删除</button></div></article>`).join('') : '<div class="um-empty">暂无条目</div>'}</div><div class="um-actions"><button class="btn btn-primary btn-small" data-um-action="add-doorplate-room" data-room="${plate.room}">在“${escapeHtml(SULLY_PLATE_LABELS[plate.room] || plate.room)}”新增</button></div></section>`;
            }).join('')}</div>`;
    }

    function renderImpressions(character) {
        const state = ensureState(character);
        const imp = normalizeUserImpressionLocal(state.impression);
        if (!imp) return `<section class="um-card"><h3>尚未导入印象档案</h3><p class="um-muted">当前 Sully 完整备份中没有 character.impression。可以粘贴 Sully 控制台导出的 UserImpression JSON，或让章鱼机基于门牌、主题和自己的事件重新生成。</p><div class="um-actions"><button class="btn btn-primary btn-small" data-um-action="generate-impression" data-mode="initial">AI 生成印象</button></div><label>粘贴 UserImpression JSON<textarea id="um-impression-json" rows="14" placeholder='{"version":3,"value_map":...}'></textarea></label><button class="btn btn-secondary btn-small" data-um-action="import-impression">导入 JSON</button></section>`;
        const tags = (title, list) => `<section class="um-card"><h3>${title}</h3><div class="um-tags">${(list||[]).length ? (list||[]).map(item=>`<span class="um-tag">${escapeHtml(item)}</span>`).join('') : '<span class="um-muted">暂无</span>'}</div></section>`;
        return `<section class="um-card"><div class="um-row-head"><div><b>VERSION ${Number(imp.version||3).toFixed(1)}</b><div class="um-muted">上次更新：${formatDate(imp.lastUpdated)}</div></div><div class="um-actions"><button class="btn btn-primary btn-small" data-um-action="generate-impression" data-mode="update">追加/更新</button><button class="btn btn-secondary btn-small" data-um-action="export-impression">复制 JSON</button><button class="btn btn-danger btn-small" data-um-action="delete-impression">删除</button></div></div></section>
        <section class="um-card um-impression-core"><h3>核心印象</h3><div class="um-main-text">“${escapeHtml(imp.personality_core.summary || '暂无')}”</div><div class="um-form-grid"><div><b>互动模式</b><p>${escapeHtml(imp.personality_core.interaction_style || '暂无')}</p></div><div><b>语气感知</b><p>${escapeHtml(imp.behavior_profile.tone_style || '暂无')}</p></div></div></section>
        ${imp.mbti_analysis ? `<section class="um-card"><div class="um-row-head"><h3>MBTI 侧写</h3><b>${escapeHtml(imp.mbti_analysis.type || '未知')}</b></div><p>${escapeHtml(imp.mbti_analysis.reasoning || '')}</p></section>` : ''}
        ${tags('观察特质', imp.personality_core.observed_traits)}${tags('喜欢', imp.value_map.likes)}${tags('不喜欢', imp.value_map.dislikes)}
        <section class="um-card"><h3>核心价值观推测</h3><p>${escapeHtml(imp.value_map.core_values || '暂无')}</p></section>
        ${tags('正向触发器', imp.emotion_schema.triggers.positive)}${tags('压力 / 雷区', imp.emotion_schema.triggers.negative)}${tags('压力信号', imp.emotion_schema.stress_signals)}
        <section class="um-card"><h3>舒适区</h3><p>${escapeHtml(imp.emotion_schema.comfort_zone || '暂无')}</p></section>
        <section class="um-card"><h3>近期情绪与回应模式</h3><p>${escapeHtml(imp.behavior_profile.emotion_summary || '暂无')}</p><p>${escapeHtml(imp.behavior_profile.response_patterns || '')}</p></section>
        ${tags('最近观察到的变化', imp.observed_changes)}`;
    }

    function renderWorking(character) {
        const state = ensureState(character);
        return `
            <div class="um-toolbar"><button class="btn btn-primary btn-small" data-um-action="add" data-type="working">新增临时记忆</button></div>
            <div class="um-list">
                ${state.workingMemories.length ? state.workingMemories.map(item => {
                    const active = isWorkingActive(item, Date.now());
                    return `<article class="um-card um-memory-row ${active ? '' : 'um-inactive'}">
                        <div class="um-row-head"><span class="um-kind">${active ? '有效' : '已结束'}</span><span>${item.expiresAt ? `至 ${formatDate(item.expiresAt)}` : '长期有效'}</span></div>
                        <div class="um-main-text">${escapeHtml(item.content || '')}</div>
                        <div class="um-tags">${renderTagList(item.keywords || [])}</div>
                        <div class="um-meta">优先级 ${item.priority}${item.sourceEventId ? ` · 来源事件 ${escapeHtml(item.sourceEventId)}` : ''}</div>
                        <div class="um-actions">
                            <button class="btn btn-small btn-secondary" data-um-action="edit" data-type="working" data-id="${item.id}">编辑</button>
                            <button class="btn btn-small btn-secondary" data-um-action="toggle-working" data-id="${item.id}">${active ? '提前结束' : '重新启用'}</button>
                            <button class="btn btn-small btn-danger" data-um-action="delete" data-type="working" data-id="${item.id}">删除</button>
                        </div>
                    </article>`;
                }).join('') : '<div class="um-empty">还没有临时记忆。临时记忆会在有效期内优先发送。</div>'}
            </div>`;
    }

    function sourcePreview(character, ids) {
        const set = new Set(ids || []);
        const messages = (character.history || []).filter(message => set.has(message.id));
        if (!messages.length) return '<span class="um-muted">没有可显示的来源消息。</span>';
        return messages.map(message => `<div class="um-source-msg"><b>${message.role === 'user' ? escapeHtml(character.myName || '用户') : escapeHtml(character.realName || '角色')}：</b>${escapeHtml(message.content || '')}</div>`).join('');
    }

    function renderEvents(character) {
        const state = ensureState(character);
        const progress = ui.batchProgress;
        const logs = ui.extractionLogs.slice(0, 30);
        return `
            ${renderApiStatusCard()}
            <section class="um-card um-generate-card">
                <h3>从最近聊天提取事件</h3>
                <p class="um-muted">每次事件提取固定发送完整门牌和完整 UserImpression；临时记忆、主题、事件盒和旧事件按当前批次相关性选择。事件正文强制使用角色第一人称。</p>
                <div class="um-inline-form">
                    <label>最近 <input id="um-summary-count" type="number" min="4" max="300" value="40"> 条消息</label>
                    <button class="btn btn-primary btn-small" data-um-action="summarize">AI 提取事件</button>
                    <button class="btn btn-secondary btn-small" data-um-action="add" data-type="event">手动新增</button>
                </div>
                <details><summary>事件提取提示词</summary><textarea id="um-event-prompt" rows="20">${escapeHtml(state.prompts.eventExtraction || DEFAULT_EVENT_PROMPT)}</textarea><div class="um-actions"><button class="btn btn-small btn-primary" data-um-action="save-prompt">保存提示词</button><button class="btn btn-small btn-secondary" data-um-action="reset-event-prompt">恢复第一人称默认</button></div></details>
            </section>
            <section class="um-card um-batch-card">
                <h3>批量提取聊天记录</h3>
                <p class="um-muted">按顺序分批调用总结 API。每批成功后才推进消息游标；失败时停在出错批次，可修复 API 后继续。</p>
                <div class="um-settings-grid">
                    <label>提取范围<select id="um-batch-mode"><option value="unprocessed">仅未处理消息</option><option value="all">全部聊天（自动去重）</option></select></label>
                    <label>每批消息数<input id="um-batch-size" type="number" min="4" max="300" value="40"></label>
                    <label>本次最多批数<input id="um-batch-max" type="number" min="1" max="200" value="20"></label>
                </div>
                <div class="um-actions">
                    <button class="btn btn-primary btn-small" data-um-action="batch-summarize" ${ui.batchRunning ? 'disabled' : ''}>${ui.batchRunning ? '批量提取中…' : '开始批量提取'}</button>
                    <button class="btn btn-danger btn-small" data-um-action="stop-batch" ${ui.batchRunning ? '' : 'disabled'}>停止</button>
                </div>
                ${progress ? `<div class="um-batch-progress"><b>${progress.status === 'running' ? '正在运行' : progress.status === 'completed' ? '已完成' : progress.status === 'stopped' ? '已停止' : '失败'}</b><span>批次 ${progress.currentBatch || 0}/${progress.maxBatches || 0}</span><span>消息 ${progress.processedMessages || 0}/${progress.totalMessages || 0}</span><span>新事件 ${progress.totalCreated || 0}</span>${progress.error ? `<small>${escapeHtml(progress.error)}</small>` : ''}</div>` : ''}
            </section>
            <section class="um-card um-extraction-debug-card">
                <div class="um-row-head"><div><h3 style="margin:0;">事件提取调试日志</h3></div><span>${state.debugEnabled === false ? '已关闭' : '浏览器控制台同步输出'}</span></div>
                <p class="um-muted">控制台筛选 <code>UnifiedMemory:Extract</code>。日志不显示 API Key；模型原始响应会写入控制台，便于定位 JSON 和提示词问题。</p>
                <div class="um-actions"><button class="btn btn-secondary btn-small" data-um-action="copy-extraction-debug">复制最近调试信息</button><button class="btn btn-secondary btn-small" data-um-action="clear-extraction-logs">清空页面日志</button></div>
                <div class="um-log-list">${logs.length ? logs.map(log => `<details class="um-log-entry um-log-${escapeHtml(log.level)}"><summary>${escapeHtml(new Date(log.at).toLocaleTimeString())} · ${escapeHtml(log.stage)}</summary><pre>${escapeHtml(JSON.stringify(log.details, null, 2))}</pre></details>`).join('') : '<div class="um-empty">尚无提取日志。运行单次或批量提取后，这里会显示各阶段信息。</div>'}</div>
            </section>
            <div class="um-list">
                ${state.events.length ? state.events.map(item => `
                    <article class="um-card um-memory-row">
                        <div class="um-row-head"><div><span class="um-kind">${escapeHtml(formatDate(item.occurredAt))}</span><b>${escapeHtml(item.title || '事件')}</b></div><span>重要度 ${item.importance}</span></div>
                        <div class="um-fact"><b>事实</b><p>${escapeHtml(item.factualSummary || '')}</p></div>
                        ${item.characterView ? `<div class="um-view"><b>角色理解</b><p>${escapeHtml(item.characterView)}</p><small>置信度 ${Math.round(Number(item.viewConfidence || 0) * 100)}%</small></div>` : ''}
                        ${item.outcome ? `<div class="um-outcome"><b>结果</b><p>${escapeHtml(item.outcome)}</p></div>` : ''}
                        ${!item.eventBoxId && item.eventBoxHint ? `<div class="um-meta"><b>事件盒建议：</b>${escapeHtml(item.eventBoxHint)}${(item.eventBoxKeywords || []).length ? ` · ${escapeHtml(item.eventBoxKeywords.join('、'))}` : ''}</div>` : ''}
                        <div class="um-tags">${renderTagList([...(item.keywords || []), ...(item.aliases || [])])}</div>
                        <div class="um-meta">来源消息 ${(item.sourceMessageIds || []).length} 条 · 被调用 ${item.accessCount || 0} 次${item.pinnedUntil && item.pinnedUntil > Date.now() ? ` · 置顶至 ${formatDate(item.pinnedUntil)}` : ''}${item.eventBoxId ? ` · 事件盒：${escapeHtml(state.eventBoxes.find(box => box.id === item.eventBoxId)?.name || '已关联')}` : ''}${(item.topicIds || []).length ? ` · 主题：${escapeHtml(item.topicIds.map(id => state.topics.find(topic => topic.id === id)?.name).filter(Boolean).join('、'))}` : ''}</div>
                        <details class="um-source"><summary>查看来源消息</summary>${sourcePreview(character, item.sourceMessageIds)}</details>
                        <div class="um-actions">
                            <button class="btn btn-small btn-secondary" data-um-action="edit" data-type="event" data-id="${item.id}">编辑</button>
                            <button class="btn btn-small btn-danger" data-um-action="delete" data-type="event" data-id="${item.id}">删除</button>
                        </div>
                    </article>`).join('') : '<div class="um-empty">还没有事件记忆。可以用总结 API 提取最近聊天，也可以手动新增。</div>'}
            </div>`;
    }


    function renderEventBoxes(character) {
        const state = ensureState(character);
        const linkSuggestions = getEventBoxSuggestions(character);
        const newBoxSuggestions = getNewEventBoxSuggestions(character);
        const unassignedCount = state.events.filter(event => event.status === 'active' && !event.eventBoxId).length;
        return `
            <section class="um-card">
                <div class="um-row-head"><div><h3>事件盒</h3><span class="um-muted">${state.eventBoxes.length} 个盒子 · ${unassignedCount} 条未归属事件</span></div><button class="btn btn-primary btn-small" data-um-action="add" data-type="eventBox">新建事件盒</button></div>
                <p class="um-muted">事件盒只表示“同一件事情的连续发展”。系统只给关联建议，必须由你确认。</p>
            </section>
            ${newBoxSuggestions.length ? `<section class="um-card"><h3>建议新建事件盒</h3><div class="um-list">${newBoxSuggestions.map(item => `
                <div class="um-suggestion">
                    <div><b>${escapeHtml(item.name)}</b><p>${item.events.length} 条事件具有相同的 AI 关联建议</p><div class="um-tags">${renderTagList(item.keywords)}</div></div>
                    <button class="btn btn-primary btn-small" data-um-action="create-box-hint" data-name="${escapeHtml(item.name)}">确认创建并归入</button>
                </div>`).join('')}</div></section>` : ''}
            ${linkSuggestions.length ? `<section class="um-card"><h3>待确认关联</h3><div class="um-list">${linkSuggestions.map(item => `
                <div class="um-suggestion">
                    <div><b>${escapeHtml(item.event.title)}</b><p>建议加入：${escapeHtml(item.box.name)}</p><small>${item.hintMatch ? 'AI 事件盒建议命中' : ''}${item.overlaps.length ? ` · 共同关键词：${escapeHtml(item.overlaps.join('、'))}` : ''}</small></div>
                    <button class="btn btn-primary btn-small" data-um-action="confirm-box-link" data-event-id="${item.event.id}" data-box-id="${item.box.id}">确认关联</button>
                </div>`).join('')}</div></section>` : ''}
            <div class="um-list">
                ${state.eventBoxes.length ? state.eventBoxes.map(box => {
                    const events = state.events.filter(event => event.eventBoxId === box.id).sort((a, b) => Number(a.occurredAt || 0) - Number(b.occurredAt || 0));
                    return `<article class="um-card um-memory-row">
                        <div class="um-row-head"><div><span class="um-kind">${box.status === 'completed' ? '已结束' : box.status === 'archived' ? '已归档' : '进行中'}</span><b>${escapeHtml(box.name)}</b></div><span>${events.length} 条事件</span></div>
                        ${box.summary ? `<div class="um-main-text">${escapeHtml(box.summary)}</div>` : '<p class="um-muted">暂无盒子摘要。</p>'}
                        ${box.currentStage ? `<div class="um-meta"><b>当前阶段：</b>${escapeHtml(box.currentStage)}</div>` : ''}
                        ${(box.unresolvedQuestions || []).length ? `<div class="um-meta"><b>尚未解决：</b>${escapeHtml(box.unresolvedQuestions.join('；'))}</div>` : ''}
                        <div class="um-tags">${renderTagList(box.keywords || [])}</div>
                        <div class="um-timeline">${events.length ? events.map(event => `<div class="um-timeline-item"><time>${escapeHtml(formatDate(event.occurredAt))}</time><div><b>${escapeHtml(event.title)}</b><p>${escapeHtml(event.factualSummary)}</p><button class="um-link-btn" data-um-action="unlink-box" data-event-id="${event.id}">移出事件盒</button></div></div>`).join('') : '<p class="um-muted">还没有事件。可以编辑事件并选择此事件盒，或确认上方关联建议。</p>'}</div>
                        <div class="um-actions"><button class="btn btn-small btn-secondary" data-um-action="edit" data-type="eventBox" data-id="${box.id}">编辑</button><button class="btn btn-small btn-danger" data-um-action="delete" data-type="eventBox" data-id="${box.id}">删除</button></div>
                    </article>`;
                }).join('') : '<div class="um-empty">还没有事件盒。它适合整理同一件事跨多天或多阶段的发展。</div>'}
            </div>`;
    }

    function renderProfileHtml(topic) {
        const profile = normalizeTopicProfile(topic.profile || {}, topic.sections || DEFAULT_TOPIC_SECTIONS);
        const sections = (topic.sections || DEFAULT_TOPIC_SECTIONS).map(section => {
            const entries = (profile[section] || []).filter(entry => entry.status !== 'archived');
            if (!entries.length) return '';
            return `<section class="um-profile-section"><h4>${escapeHtml(section)}</h4>${entries.map(entry => {
                const evidence = (entry.evidenceEventIds || []).length;
                return `<div class="um-profile-entry"><p>${escapeHtml(entry.statement)}</p><small>置信度 ${Math.round(clamp(entry.confidence, 0, 1, 0.6) * 100)}% · ${evidence} 条证据${entry.directlyStatedRecurrent ? ' · 用户明确表述为反复现象' : ''}</small></div>`;
            }).join('')}</section>`;
        }).filter(Boolean).join('');
        const manual = topic.profileText ? `<section class="um-profile-section um-profile-manual"><h4>人工补充</h4><div class="um-profile-entry"><p>${escapeHtml(topic.profileText)}</p></div></section>` : '';
        return sections || manual ? `<div class="um-topic-profile">${sections}${manual}</div>` : '<p class="um-muted">尚未整理结构化主题档案。</p>';
    }

    function renderTopics(character) {
        const state = ensureState(character);
        const candidates = getTopicCandidates(character);
        return `
            <section class="um-card">
                <div class="um-row-head"><div><h3>用户确认的主题</h3><span class="um-muted">主题仍由你建立；AI 只整理已确认主题</span></div><button class="btn btn-primary btn-small" data-um-action="add" data-type="topic">手动创建主题</button></div>
                <p class="um-muted">每个主题拥有自定义分区和专用提示词。增量整理会发送已有主题档案、新证据、相关旧事件、门牌、印象与 EventBox；更新前自动保存可恢复版本。</p>
            </section>
            ${candidates.length ? `<section class="um-card"><h3>高频主题推荐</h3><div class="um-list">${candidates.map(candidate => `
                <article class="um-suggestion um-topic-candidate">
                    <div class="um-candidate-main">
                        <div class="um-row-head"><div><span class="um-kind">候选</span><b>${escapeHtml(candidate.keyword)}</b></div><span>${candidate.independentEventCount} 事件 / ${candidate.distinctDayCount} 天</span></div>
                        <p>最近 ${state.topicSettings.recentDays} 天出现 ${candidate.recentCount} 条。首次 ${escapeHtml(formatDate(candidate.firstSeenAt))}，最近 ${escapeHtml(formatDate(candidate.lastSeenAt))}。</p>
                        <div class="um-tags">${renderTagList([candidate.keyword, ...candidate.relatedKeywords])}</div>
                        <details><summary>查看典型证据</summary>${candidate.sampleEvents.map(event => `<div class="um-source-msg"><b>${escapeHtml(formatDate(event.occurredAt))} ${escapeHtml(event.title)}</b><br>${escapeHtml(event.factualSummary)}</div>`).join('')}</details>
                    </div>
                    <div class="um-candidate-actions">
                        <button class="btn btn-primary btn-small" data-um-action="accept-topic" data-key="${escapeHtml(candidate.key)}">创建主题</button>
                        ${state.topics.length ? `<select class="um-merge-select" data-topic-merge-for="${escapeHtml(candidate.key)}"><option value="">并入现有主题…</option>${state.topics.map(topic => `<option value="${topic.id}">${escapeHtml(topic.name)}</option>`).join('')}</select><button class="btn btn-secondary btn-small" data-um-action="merge-topic" data-key="${escapeHtml(candidate.key)}">确认并入</button>` : ''}
                        <button class="btn btn-secondary btn-small" data-um-action="defer-topic" data-key="${escapeHtml(candidate.key)}">暂缓</button>
                        <button class="btn btn-danger btn-small" data-um-action="dismiss-topic" data-key="${escapeHtml(candidate.key)}">不再推荐</button>
                    </div>
                </article>`).join('')}</div></section>` : `<section class="um-card"><p class="um-muted">当前没有达到推荐阈值的候选主题。阈值可在设置中调整。</p></section>`}
            <div class="um-list">${state.topics.length ? state.topics.map(topic => {
                normalizeTopic(topic);
                const evidence = topicEvidenceEvents(state, topic).sort((a, b) => Number(b.occurredAt || 0) - Number(a.occurredAt || 0));
                const analyzed = new Set(topic.analyzedEventIds || []);
                const newEvidenceCount = evidence.filter(event => !analyzed.has(event.id)).length;
                const threshold = Number(topic.updatePolicy?.minNewEvidence || 4);
                const versions = state.topicVersions.filter(version => version.topicId === topic.id).slice(0, 3);
                return `<article class="um-card um-memory-row">
                    <div class="um-row-head"><div><span class="um-kind">已确认</span><b>${escapeHtml(topic.name)}</b><span class="um-version-badge">v${topic.version || 1}</span></div><span>${evidence.length} 条证据 · ${newEvidenceCount} 条待整理</span></div>
                    ${topic.description ? `<div class="um-main-text">${escapeHtml(topic.description)}</div>` : ''}
                    ${topic.profileSummary ? `<div class="um-topic-summary"><b>最近整理</b><p>${escapeHtml(topic.profileSummary)}</p></div>` : ''}
                    ${renderProfileHtml(topic)}
                    <div class="um-tags">${renderTagList([...(topic.keywords || []), ...(topic.aliases || [])])}</div>
                    <div class="um-meta">发送策略：${escapeHtml(topic.sendPolicy)} · 优先级 ${topic.priority} · 分区 ${(topic.sections || []).length} 个 · 更新阈值 ${threshold} 条 · 最近更新 ${escapeHtml(formatDate(topic.updatedAt))}</div>
                    <details><summary>查看主题证据</summary>${evidence.length ? evidence.slice(0, 30).map(event => `<div class="um-source-msg"><b>${escapeHtml(formatDate(event.occurredAt))} ${escapeHtml(event.title)}</b><br>${escapeHtml(event.factualSummary)}${analyzed.has(event.id) ? '<small>已参与整理</small>' : '<small>新增证据</small>'}</div>`).join('') : '<p class="um-muted">暂无证据。</p>'}</details>
                    ${versions.length ? `<details><summary>最近版本</summary>${versions.map(version => `<div class="um-version-row"><div><b>${escapeHtml(formatDate(version.createdAt))}</b><p>${escapeHtml(version.reason || '')}</p></div><button class="btn btn-secondary btn-small" data-um-action="restore-topic-version" data-version-id="${version.id}">恢复</button></div>`).join('')}</details>` : ''}
                    <div class="um-actions">
                        <button class="btn btn-primary btn-small" data-um-action="topic-update" data-id="${topic.id}" ${newEvidenceCount === 0 ? 'disabled' : ''}>增量整理${newEvidenceCount ? `（${newEvidenceCount}）` : ''}</button>
                        <button class="btn btn-secondary btn-small" data-um-action="topic-rebuild" data-id="${topic.id}">全部证据重整</button>
                        ${topic.sendPolicy === 'manual' ? `<button class="btn btn-small btn-secondary" data-um-action="toggle-manual" data-type="topic" data-id="${topic.id}">${topic.manualActive ? '取消激活' : '临时激活'}</button>` : ''}
                        <button class="btn btn-small btn-secondary" data-um-action="edit" data-type="topic" data-id="${topic.id}">编辑</button>
                        <button class="btn btn-small btn-danger" data-um-action="delete" data-type="topic" data-id="${topic.id}">删除</button>
                    </div>
                </article>`;
            }).join('') : '<div class="um-empty">还没有正式主题。可从高频推荐创建，也可手动新建。</div>'}</div>`;
    }

    function renderVersions(character) {
        const state = ensureState(character);
        const versions = state.topicVersions || [];
        return `<section class="um-card"><h3>主题版本历史</h3><p class="um-muted">AI 整理、人工修改结构化档案和版本恢复都会留下记录。恢复操作不会删除后续版本。</p></section>
        <div class="um-list">${versions.length ? versions.map(version => {
            const topic = state.topics.find(item => item.id === version.topicId);
            const name = topic?.name || version.previousTopic?.name || '已删除主题';
            return `<article class="um-card um-memory-row"><div class="um-row-head"><div><span class="um-kind">${escapeHtml(version.appliedBy === 'user' ? '人工' : 'AI')}</span><b>${escapeHtml(name)}</b></div><span>${escapeHtml(formatDate(version.createdAt))}</span></div><div class="um-main-text">${escapeHtml(version.reason || '主题档案更新')}</div><div class="um-meta">关联证据 ${(version.sourceEventIds || []).length} 条</div><div class="um-actions">${topic ? `<button class="btn btn-secondary btn-small" data-um-action="restore-topic-version" data-version-id="${version.id}">恢复到更新前</button>` : ''}<button class="btn btn-danger btn-small" data-um-action="delete-topic-version" data-version-id="${version.id}">删除记录</button></div></article>`;
        }).join('') : '<div class="um-empty">还没有主题版本记录。</div>'}</div>`;
    }


    function renderJobs(character) {
        const state=ensureState(character); const auto=state.automation;
        const statusLabel={pending:'等待',running:'运行中',failed:'失败',completed:'完成',awaiting_review:'待确认',cancelled:'已取消'};
        const jobs=state.jobs || [];
        return `<section class="um-card">
            <h3>统一自动任务</h3>
            <p class="um-muted">任务按顺序运行。同一批消息、同一主题和同一事件盒不会重复入队；失败时不会推进消息游标。</p>
            <div class="um-actions"><button class="btn btn-primary btn-small" data-um-action="schedule-jobs">立即检查并排队</button><button class="btn btn-secondary btn-small" data-um-action="run-jobs">运行队列</button><button class="btn btn-secondary btn-small" data-um-action="queue-event-extract">强制排队当前新消息</button><button class="btn btn-danger btn-small" data-um-action="clear-finished-jobs">清理已完成</button></div>
            <p class="um-muted">最后调度：${auto.lastSchedulerAt?new Date(auto.lastSchedulerAt).toLocaleString():'尚未'} · 消息游标：${escapeHtml(auto.lastProcessedMessageId||'尚未建立')}</p>
        </section>
        <div class="um-list">${jobs.length?jobs.map(job=>{
            const proposalCount=(job.result?.doorplates||[]).length;
            return `<article class="um-card um-memory-row um-job um-job-${escapeHtml(job.status)}"><div class="um-row-head"><div><span class="um-kind">${escapeHtml(jobLabel(job.type))}</span><b>${escapeHtml(statusLabel[job.status]||job.status)}</b></div><span>尝试 ${job.attempts}/${job.maxAttempts}</span></div><div class="um-main-text">${escapeHtml(job.summary||job.error||'等待执行')}</div>${job.error?`<div class="um-job-error">${escapeHtml(job.error)}</div>`:''}<div class="um-meta">创建 ${new Date(job.createdAt).toLocaleString()}${job.finishedAt?` · 结束 ${new Date(job.finishedAt).toLocaleString()}`:''}</div>${job.status==='awaiting_review'&&job.type==='archive_consolidate'?`<details class="um-job-proposals"><summary>查看 ${proposalCount} 条档案建议</summary>${(job.result.doorplates||[]).map(p=>`<p><b>门牌 ${escapeHtml(p.action)}</b> ${escapeHtml(p.category||'')}：${escapeHtml(p.content||p.targetId||'')}</p>`).join('')}</details>`:''}<div class="um-actions">${job.status==='awaiting_review'&&job.type==='archive_consolidate'?`<button class="btn btn-primary btn-small" data-um-action="apply-archive-job" data-id="${job.id}">应用全部建议</button><button class="btn btn-secondary btn-small" data-um-action="dismiss-archive-job" data-id="${job.id}">忽略本批建议</button>`:''}${['failed','cancelled','awaiting_review'].includes(job.status)&&!(job.status==='awaiting_review'&&job.type==='archive_consolidate')?`<button class="btn btn-primary btn-small" data-um-action="retry-job" data-id="${job.id}">${job.status==='awaiting_review'?'确认执行':'重试'}</button>`:''}${['pending','failed','awaiting_review'].includes(job.status)?`<button class="btn btn-secondary btn-small" data-um-action="cancel-job" data-id="${job.id}">取消</button>`:''}<button class="btn btn-danger btn-small" data-um-action="delete-job" data-id="${job.id}">删除</button></div></article>`;
        }).join(''):'<div class="um-empty">暂无任务。启用自动任务后，回复结束会根据阈值排队。</div>'}</div>`;
    }

    function renderVectorAssist(character) {
        const state = ensureState(character);
        const validCount = state.events.filter(event => hasValidEventEmbedding(event)).length;
        const pendingCount = state.events.filter(event => event.status === 'active' && eventNeedsEmbedding(event)).length;
        const duplicates = getDuplicateEventSuggestions(character);
        const boxSuggestions = getVectorEventBoxSuggestions(character);
        return `${renderApiStatusCard()}<section class="um-card">
            <div class="um-row-head"><div><h3>事件向量状态</h3><p class="um-muted">向量只负责语义补充与候选，不会自动改动主题、档案或事件关系。向量文本只使用事件标题、事实、结果和关键词，不使用角色主观理解。</p></div><span class="um-kind">${state.vector.enabled ? '已启用' : '未启用'}</span></div>
            <div class="um-stat-grid">
                <div class="um-stat"><b>${validCount}</b><span>当前模型有效向量</span></div>
                <div class="um-stat"><b>${pendingCount}</b><span>待生成/需重建</span></div>
                <div class="um-stat"><b>${duplicates.length}</b><span>重复候选</span></div>
                <div class="um-stat"><b>${boxSuggestions.length}</b><span>归盒候选</span></div>
            </div>
            <p class="um-muted">当前模型签名：${escapeHtml(currentVectorModelSignature() || '未配置')}</p>
            ${state.vector.lastError ? `<p class="um-error">最近向量错误：${escapeHtml(state.vector.lastError)}</p>` : ''}
            <div class="um-actions">
                <button class="btn btn-primary btn-small" data-um-action="queue-missing-embeddings">为缺失事件排队</button>
                <button class="btn btn-secondary btn-small" data-um-action="rebuild-all-embeddings">重建全部事件向量</button>
                <button class="btn btn-danger btn-small" data-um-action="clear-all-embeddings">清除全部事件向量</button>
            </div>
        </section>
        <section class="um-card"><h3>高相似重复事件候选</h3>
            ${duplicates.length ? duplicates.map(item => `<article class="um-memory-row">
                <div class="um-row-head"><span class="um-kind">相似度 ${(item.similarity * 100).toFixed(1)}%</span><span>${formatDate(item.a.occurredAt)} / ${formatDate(item.b.occurredAt)}</span></div>
                <p><b>A · ${escapeHtml(item.a.title || '事件')}</b><br>${escapeHtml(item.a.factualSummary || '')}</p>
                <p><b>B · ${escapeHtml(item.b.title || '事件')}</b><br>${escapeHtml(item.b.factualSummary || '')}</p>
                <div class="um-actions">
                    <button class="btn btn-secondary btn-small" data-um-action="merge-duplicate-event" data-keep-id="${item.a.id}" data-archive-id="${item.b.id}">保留 A，归档 B</button>
                    <button class="btn btn-secondary btn-small" data-um-action="merge-duplicate-event" data-keep-id="${item.b.id}" data-archive-id="${item.a.id}">保留 B，归档 A</button>
                </div>
            </article>`).join('') : '<div class="um-empty">当前没有达到阈值的重复候选。</div>'}
        </section>
        <section class="um-card"><h3>事件盒向量关联候选</h3>
            ${boxSuggestions.length ? boxSuggestions.map(item => `<article class="um-memory-row">
                <div class="um-row-head"><span class="um-kind">相似度 ${(item.similarity * 100).toFixed(1)}%</span><span>盒内向量事件 ${item.supportCount} 条</span></div>
                <p><b>${escapeHtml(item.event.title || '事件')}</b> → <b>${escapeHtml(item.box.name)}</b></p>
                <p>${escapeHtml(item.event.factualSummary || '')}</p>
                <div class="um-actions"><button class="btn btn-primary btn-small" data-um-action="accept-vector-box" data-event-id="${item.event.id}" data-box-id="${item.box.id}">确认归入事件盒</button></div>
            </article>`).join('') : '<div class="um-empty">当前没有达到阈值的事件盒关联候选。</div>'}
        </section>`;
    }

    function renderDebug(character) {
        const state = ensureState(character);
        const debug = state.retrieval.lastDebug;
        return `
            <section class="um-card">
                <h3>检索调试</h3>
                <textarea id="um-debug-query" rows="5" placeholder="输入一句测试消息，例如：昨晚疼得又醒了好几次">${escapeHtml(ui.debugQuery || state.retrieval.lastQueryText || '')}</textarea>
                <div class="um-actions"><button class="btn btn-primary btn-small" data-um-action="debug-run">运行检索</button></div>
            </section>
            ${debug ? `<section class="um-card">
                <h3>命中结果</h3>
                <p><b>查询：</b>${escapeHtml(debug.queryText || '')}</p>
                <div class="um-debug-grid">
                    <div><b>临时记忆</b>${debug.working.length ? debug.working.map(item => `<p>${escapeHtml(item.content)}</p>`).join('') : '<p class="um-muted">无</p>'}</div>
                    <div><b>主题</b>${(debug.topics || []).length ? (debug.topics || []).map(entry => `<p>${escapeHtml(entry.item.name)}<small>命中：${escapeHtml(entry.hits.join('、'))}</small></p>`).join('') : '<p class="um-muted">无</p>'}</div>
                    <div><b>门牌</b>${debug.doorplates.length ? debug.doorplates.map(entry => `<p>${escapeHtml(entry.item.content)}<small> 命中：${escapeHtml(entry.hits.join('、'))}${entry.viaTopic ? '（由主题激活）' : ''}</small></p>`).join('') : '<p class="um-muted">无</p>'}</div>
                    <div><b>印象</b>${debug.impression ? `<p>${escapeHtml(debug.impression.personality_core?.summary || '已加载完整印象')}</p>` : '<p class="um-muted">无</p>'}</div>
                    <div><b>事件盒</b>${(debug.eventBoxes || []).length ? (debug.eventBoxes || []).map(entry => `<p>${escapeHtml(entry.item.name)}<small>${entry.viaEvent ? '由相关事件带出' : `命中：${escapeHtml(entry.hits.join('、'))}`}</small></p>`).join('') : '<p class="um-muted">无</p>'}</div>
                    <div><b>事件</b>${debug.events.length ? debug.events.map(entry => `<p>${escapeHtml(entry.item.title)}<small>${entry.hits.length ? `关键词：${escapeHtml(entry.hits.join('、'))}` : '无关键词命中'}${entry.viaTopic ? '（由主题带出）' : ''}${entry.viaVector ? `（向量 ${(Number(entry.vectorSimilarity || 0) * 100).toFixed(1)}%）` : ''}</small></p>`).join('') : '<p class="um-muted">无</p>'}</div>
                </div>
                <h3>最终注入文本</h3>
                <pre class="um-preview">${escapeHtml(state.retrieval.lastContextBlock || '')}</pre>
            </section>` : ''}`;
    }

    function renderSettings(character) {
        const state = ensureState(character);
        const r = state.retrieval;
        const t = state.topicSettings;
        const a = state.automation;
        const v = state.vector;
        return `${renderApiStatusCard()}<section class="um-card">
            <h3>记忆运行模式</h3>
            <label class="um-toggle-row"><input type="checkbox" data-um-setting="exclusiveMode" ${state.exclusiveMode !== false ? 'checked' : ''}> 统一记忆独占模式（关闭旧日记、旧表格、旧向量的自动生成和 Prompt 注入）</label>
            <label class="um-toggle-row"><input type="checkbox" data-um-setting="debugEnabled" ${state.debugEnabled !== false ? 'checked' : ''}> 输出事件提取调试日志到浏览器控制台</label>
            <p class="um-muted">独占模式不会删除旧数据，只停止旧系统继续参与聊天和自动任务。</p>
        </section>
        <section class="um-card">
            <h3>自动任务设置</h3>
            <label class="um-toggle-row"><input type="checkbox" data-um-auto-check="enabled" ${a.enabled?'checked':''}> 启用统一自动任务</label>
            <label class="um-toggle-row"><input type="checkbox" data-um-auto-check="autoRunAfterReply" ${a.autoRunAfterReply?'checked':''}> 每次回复结束后检查并运行</label>
            <label class="um-toggle-row"><input type="checkbox" data-um-auto-check="autoStartOnOpen" ${a.autoStartOnOpen?'checked':''}> 打开记忆中心时也检查一次</label>
            <label class="um-toggle-row"><input type="checkbox" data-um-auto-check="archiveAutoApply" ${a.archiveAutoApply!==false?'checked':''}> 门牌与印象巩固后自动应用</label>
            <div class="um-settings-grid">
                <label>事件提取阈值（新消息）<input data-um-auto-number="eventMessageThreshold" type="number" min="4" max="500" value="${a.eventMessageThreshold}"></label>
                <label>单批最多消息<input data-um-auto-number="eventBatchLimit" type="number" min="4" max="500" value="${a.eventBatchLimit}"></label>
                <label>门牌蒸馏阈值（新事件）<input data-um-auto-number="archiveEventThreshold" type="number" min="2" max="100" value="${a.archiveEventThreshold}"></label><label>印象更新阈值（新事件）<input data-um-auto-number="impressionEventThreshold" type="number" min="4" max="300" value="${a.impressionEventThreshold}"></label>
                <label>事件盒更新阈值<input data-um-auto-number="eventBoxNewEventThreshold" type="number" min="1" max="30" value="${a.eventBoxNewEventThreshold}"></label>
                <label>单批向量事件数<input data-um-auto-number="embeddingBatchSize" type="number" min="1" max="100" value="${a.embeddingBatchSize}"></label>
                <label>单轮最多任务<input data-um-auto-number="maxJobsPerRun" type="number" min="1" max="20" value="${a.maxJobsPerRun}"></label>
                <label>最大重试次数<input data-um-auto-number="maxAttempts" type="number" min="1" max="10" value="${a.maxAttempts}"></label>
                <label>失败重试间隔（分钟）<input data-um-auto-number="retryDelayMinutes" type="number" min="1" max="1440" value="${a.retryDelayMinutes}"></label>
                <label>维护间隔（小时）<input data-um-auto-number="maintenanceIntervalHours" type="number" min="1" max="720" value="${a.maintenanceIntervalHours}"></label>
            </div>
            <div class="um-auto-task-grid">
                ${[['eventExtractionEnabled','事件提取'],['archiveConsolidationEnabled','门牌蒸馏（RoomPlate）'],['impressionUpdateEnabled','低频印象更新（UserImpression）'],['eventBoxUpdateEnabled','事件盒更新'],['topicUpdateEnabled','主题增量整理'],['embeddingGenerateEnabled','事件向量生成'],['maintenanceEnabled','维护清理']].map(([key,label])=>`<label class="um-toggle-row"><input type="checkbox" data-um-auto-check="${key}" ${a[key]?'checked':''}> ${label}</label>`).join('')}
            </div>
            <div class="um-actions"><button class="btn btn-primary btn-small" data-um-action="save-auto-settings">保存自动任务设置</button></div>
            <p class="um-muted">自动任务默认开启。每次回复后提取新事件；累计事件达到阈值后自动巩固门牌和印象。可关闭自动应用，改为任务页审核。</p>
        </section>
        <section class="um-card">
            <h3>事件向量辅助</h3>
            <label class="um-toggle-row"><input type="checkbox" data-um-vector-check="enabled" ${v.enabled?'checked':''}> 启用关键词 + 向量混合检索</label>
            <div class="um-settings-grid">
                <label>语义召回阈值<input data-um-vector-number="similarityThreshold" type="number" min="0" max="1" step="0.01" value="${v.similarityThreshold}"></label>
                <label>重复候选阈值<input data-um-vector-number="duplicateThreshold" type="number" min="0" max="1" step="0.01" value="${v.duplicateThreshold}"></label>
                <label>事件盒候选阈值<input data-um-vector-number="eventBoxThreshold" type="number" min="0" max="1" step="0.01" value="${v.eventBoxThreshold}"></label>
                <label>向量分数权重<input data-um-vector-number="vectorScoreWeight" type="number" min="0" max="200" value="${v.vectorScoreWeight}"></label>
                <label>参与排序的向量候选<input data-um-vector-number="maxVectorCandidates" type="number" min="1" max="50" value="${v.maxVectorCandidates}"></label>
            </div>
            <div class="um-actions"><button class="btn btn-primary btn-small" data-um-action="save-vector-settings">保存向量设置</button></div>
            <p class="um-muted">向量优先使用“向量 API”；未配置时会回退到总结 API 或主 API，但回退模型必须支持 Embedding。模型、地址或维度变化后，旧事件会自动视为需要重建。</p>
        </section>
        <section class="um-card">
            <h3>关键词检索与注入预算</h3>
            <div class="um-settings-grid">
                <label>门牌发送<select data-um-retrieval-mode="roomPlateMode"><option value="keyword" ${r.roomPlateMode !== 'always' && r.roomPlateMode !== 'off' ? 'selected' : ''}>关键词相关时发送</option><option value="always" ${r.roomPlateMode === 'always' ? 'selected' : ''}>每轮完整发送</option><option value="off" ${r.roomPlateMode === 'off' ? 'selected' : ''}>不发送</option></select></label>
                <label>印象发送<select data-um-retrieval-mode="impressionMode"><option value="keyword" ${r.impressionMode !== 'always' && r.impressionMode !== 'off' ? 'selected' : ''}>关键词/主题相关时发送</option><option value="always" ${r.impressionMode === 'always' ? 'selected' : ''}>每轮完整发送</option><option value="off" ${r.impressionMode === 'off' ? 'selected' : ''}>不发送</option></select></label>
                <label>读取最近用户消息数<input data-um-retrieval="recentUserMessages" type="number" min="1" max="10" value="${r.recentUserMessages}"></label>
                <label>最多门牌<input data-um-retrieval="maxDoorplates" type="number" min="0" max="50" value="${r.maxDoorplates}"></label>
                <label>最多印象<input data-um-retrieval="maxImpressions" type="number" min="0" max="50" value="${r.maxImpressions}"></label>
                <label>最多主题<input data-um-retrieval="maxTopics" type="number" min="0" max="20" value="${r.maxTopics}"></label>
                <label>最多事件盒<input data-um-retrieval="maxEventBoxes" type="number" min="0" max="20" value="${r.maxEventBoxes}"></label>
                <label>最多事件<input data-um-retrieval="maxEvents" type="number" min="0" max="50" value="${r.maxEvents}"></label>
                <label>临时记忆预算<input data-um-retrieval="workingBudget" type="number" min="100" max="10000" value="${r.workingBudget}"></label>
                <label>门牌预算<input data-um-retrieval="doorplateBudget" type="number" min="100" max="10000" value="${r.doorplateBudget}"></label>
                <label>印象预算<input data-um-retrieval="impressionBudget" type="number" min="100" max="10000" value="${r.impressionBudget}"></label>
                <label>主题预算<input data-um-retrieval="topicBudget" type="number" min="100" max="10000" value="${r.topicBudget}"></label>
                <label>事件盒预算<input data-um-retrieval="eventBoxBudget" type="number" min="100" max="10000" value="${r.eventBoxBudget}"></label>
                <label>事件预算<input data-um-retrieval="eventBudget" type="number" min="100" max="10000" value="${r.eventBudget}"></label>
                <label>总预算<input data-um-retrieval="totalBudget" type="number" min="500" max="30000" value="${r.totalBudget}"></label>
            </div>
        </section>
        <section class="um-card">
            <h3>高频主题推荐阈值</h3>
            <div class="um-settings-grid">
                <label>最少独立事件数<input data-um-topic-setting="minEvents" type="number" min="2" max="100" value="${t.minEvents}"></label>
                <label>最少跨越日期数<input data-um-topic-setting="minDays" type="number" min="1" max="100" value="${t.minDays}"></label>
                <label>最近活跃窗口（天）<input data-um-topic-setting="recentDays" type="number" min="1" max="3650" value="${t.recentDays}"></label>
                <label>暂缓后再次推荐（天）<input data-um-topic-setting="deferDays" type="number" min="1" max="365" value="${t.deferDays}"></label>
            </div>
            <div class="um-actions"><button class="btn btn-primary btn-small" data-um-action="save-settings">保存设置</button><button class="btn btn-secondary btn-small" data-um-action="reset-topic-decisions">重置暂缓/忽略记录</button></div>
            <p class="um-muted">主题是否成立仍由你决定。阈值只控制何时显示推荐卡片。</p>
        </section>
        <section class="um-card">
            <h3>通用主题整理提示词</h3>
            <p class="um-muted">每个主题还可以在编辑器中追加自己的专用要求。通用规则负责证据边界、增量更新和输出格式。</p>
            <textarea id="um-topic-base-prompt" rows="16">${escapeHtml(state.prompts.topicUpdate || DEFAULT_TOPIC_PROMPT)}</textarea>
            <div class="um-actions"><button class="btn btn-primary btn-small" data-um-action="save-topic-base-prompt">保存主题整理提示词</button><button class="btn btn-secondary btn-small" data-um-action="reset-topic-base-prompt">恢复默认</button></div>
        </section>
        <section class="um-card"><h3>门牌蒸馏提示词</h3><textarea id="um-archive-prompt" rows="14">${escapeHtml(state.prompts.archiveConsolidation || DEFAULT_ARCHIVE_PROMPT)}</textarea><div class="um-actions"><button class="btn btn-primary btn-small" data-um-action="save-archive-prompt">保存</button><button class="btn btn-secondary btn-small" data-um-action="reset-archive-prompt">恢复默认</button></div></section>
        <section class="um-card"><h3>事件盒更新提示词</h3><textarea id="um-box-prompt" rows="12">${escapeHtml(state.prompts.eventBoxUpdate || DEFAULT_EVENT_BOX_PROMPT)}</textarea><div class="um-actions"><button class="btn btn-primary btn-small" data-um-action="save-box-prompt">保存</button><button class="btn btn-secondary btn-small" data-um-action="reset-box-prompt">恢复默认</button></div></section>`;
    }

    function render() {
        const character = getCharacter();
        const content = document.getElementById('unified-memory-content');
        const title = document.getElementById('unified-memory-character');
        if (!content) return;
        if (!character) {
            content.innerHTML = '<div class="um-empty">请先进入一个私聊角色，再打开统一记忆。</div>';
            if (title) title.textContent = '未选择角色';
            return;
        }
        if (title) title.textContent = character.remarkName || character.realName || '当前角色';
        document.querySelectorAll('.um-tab').forEach(button => {
            button.classList.toggle('active', button.dataset.tab === ui.tab);
        });
        if (ui.tab === 'overview') content.innerHTML = renderOverview(character);
        else if (ui.tab === 'doorplates') content.innerHTML = renderDoorplates(character);
        else if (ui.tab === 'impressions') content.innerHTML = renderImpressions(character);
        else if (ui.tab === 'working') content.innerHTML = renderWorking(character);
        else if (ui.tab === 'events') content.innerHTML = renderEvents(character);
        else if (ui.tab === 'eventBoxes') content.innerHTML = renderEventBoxes(character);
        else if (ui.tab === 'topics') content.innerHTML = renderTopics(character);
        else if (ui.tab === 'versions') content.innerHTML = renderVersions(character);
        else if (ui.tab === 'jobs') content.innerHTML = renderJobs(character);
        else if (ui.tab === 'vector') content.innerHTML = renderVectorAssist(character);
        else if (ui.tab === 'debug') content.innerHTML = renderDebug(character);
        else content.innerHTML = renderSettings(character);
    }

    function findItem(state, type, id) {
        if (type === 'doorplate') { const found = findRoomPlateEntry(state, id); return found ? { ...found.entry, room: found.plate.room } : null; }
        const map = {
            impression: [],
            working: state.workingMemories,
            event: state.events,
            eventBox: state.eventBoxes,
            topic: state.topics
        };
        return (map[type] || []).find(item => item.id === id) || null;
    }

    function topicCheckboxes(selectedIds) {
        const character = getCharacter();
        const state = character ? ensureState(character) : null;
        const selected = new Set(selectedIds || []);
        if (!state || !state.topics.length) return '<p class="um-muted">还没有已确认主题。</p>';
        return `<div class="um-check-grid">${state.topics.map(topic => `<label class="um-check"><input type="checkbox" name="topicIds" value="${topic.id}" ${selected.has(topic.id) ? 'checked' : ''}> ${escapeHtml(topic.name)}</label>`).join('')}</div>`;
    }

    function linkedTopicCheckboxes(selectedIds) {
        const character = getCharacter();
        const state = character ? ensureState(character) : null;
        const selected = new Set(selectedIds || []);
        if (!state || !state.topics.length) return '<p class="um-muted">还没有已确认主题。</p>';
        return `<div class="um-check-grid">${state.topics.map(topic => `<label class="um-check"><input type="checkbox" name="linkedTopicIds" value="${topic.id}" ${selected.has(topic.id) ? 'checked' : ''}> ${escapeHtml(topic.name)}</label>`).join('')}</div>`;
    }

    function eventBoxOptions(selectedId) {
        const character = getCharacter();
        const state = character ? ensureState(character) : null;
        const options = state ? state.eventBoxes.filter(box => box.status !== 'archived').map(box => `<option value="${box.id}" ${selectedId === box.id ? 'selected' : ''}>${escapeHtml(box.name)}</option>`).join('') : '';
        return `<select name="eventBoxId"><option value="">不加入事件盒</option>${options}</select>`;
    }

    function editorFields(type, item) {
        if (type === 'doorplate') return `
            <label>分类<input name="category" value="${escapeHtml(item.category || '')}" placeholder="例如：睡眠习惯"></label>
            <label>内容<textarea name="content" rows="5" required>${escapeHtml(item.content || '')}</textarea></label>
            <label>关键词<input name="keywords" value="${escapeHtml((item.keywords || []).join('，'))}" placeholder="睡眠，熬夜，夜醒"></label>
            <label>同义表达<input name="aliases" value="${escapeHtml((item.aliases || []).join('，'))}"></label>
            <label>排除词<input name="negativeKeywords" value="${escapeHtml((item.negativeKeywords || []).join('，'))}"></label>
            <label>关联主题${linkedTopicCheckboxes(item.linkedTopicIds || [])}</label>
            <div class="um-form-grid"><label>发送策略<select name="sendPolicy">${policyOptions(item.sendPolicy || 'keyword')}</select></label><label>优先级<input name="priority" type="number" min="0" max="200" value="${item.priority ?? 70}"></label><label>置信度<input name="confidence" type="number" min="0" max="1" step="0.05" value="${item.confidence ?? 0.8}"></label></div>
            <label class="um-check"><input name="locked" type="checkbox" ${item.locked ? 'checked' : ''}> 用户锁定</label>`;
        if (type === 'impression') return `
            <label>维度<input name="dimension" value="${escapeHtml(item.dimension || '')}" placeholder="例如：寻求安慰的方式"></label>
            <label>主观印象<textarea name="statement" rows="5" required>${escapeHtml(item.statement || '')}</textarea></label>
            <label>关键词<input name="keywords" value="${escapeHtml((item.keywords || []).join('，'))}"></label>
            <label>同义表达<input name="aliases" value="${escapeHtml((item.aliases || []).join('，'))}"></label>
            <label>排除词<input name="negativeKeywords" value="${escapeHtml((item.negativeKeywords || []).join('，'))}"></label>
            <label>关联主题${linkedTopicCheckboxes(item.linkedTopicIds || [])}</label>
            <div class="um-form-grid"><label>发送策略<select name="sendPolicy">${policyOptions(item.sendPolicy || 'keyword')}</select></label><label>优先级<input name="priority" type="number" min="0" max="200" value="${item.priority ?? 65}"></label><label>置信度<input name="confidence" type="number" min="0" max="1" step="0.05" value="${item.confidence ?? 0.7}"></label></div>
            <label class="um-check"><input name="locked" type="checkbox" ${item.locked ? 'checked' : ''}> 用户锁定</label>`;
        if (type === 'working') {
            let expiry = '';
            if (item.expiresAt) {
                const d = new Date(item.expiresAt);
                expiry = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            }
            return `
                <label>内容<textarea name="content" rows="5" required>${escapeHtml(item.content || '')}</textarea></label>
                <label>关键词<input name="keywords" value="${escapeHtml((item.keywords || []).join('，'))}"></label>
                <div class="um-form-grid"><label>有效至<input name="expiresAt" type="date" value="${expiry}"></label><label>优先级<input name="priority" type="number" min="0" max="200" value="${item.priority ?? 90}"></label></div>`;
        }
        if (type === 'eventBox') return `
            <label>事件盒名称<input name="name" value="${escapeHtml(item.name || '')}" required placeholder="例如：换工作与离职"></label>
            <label>连续事件摘要<textarea name="summary" rows="5">${escapeHtml(item.summary || '')}</textarea></label>
            <label>当前阶段<textarea name="currentStage" rows="3">${escapeHtml(item.currentStage || '')}</textarea></label>
            <label>关键词<input name="keywords" value="${escapeHtml((item.keywords || []).join('，'))}"></label>
            <label>尚未解决的问题<input name="unresolvedQuestions" value="${escapeHtml((item.unresolvedQuestions || []).join('，'))}"></label>
            <div class="um-form-grid"><label>状态<select name="status"><option value="ongoing" ${item.status === 'ongoing' ? 'selected' : ''}>进行中</option><option value="completed" ${item.status === 'completed' ? 'selected' : ''}>已结束</option><option value="archived" ${item.status === 'archived' ? 'selected' : ''}>已归档</option></select></label><label>优先级<input name="priority" type="number" min="0" max="200" value="${item.priority ?? 70}"></label></div>`;
        if (type === 'topic') {
            normalizeTopic(item);
            const profileFields = (item.sections || DEFAULT_TOPIC_SECTIONS).map((section, index) => {
                const lines = (item.profile?.[section] || []).map(entry => entry.statement).join('\n');
                return `<label>${escapeHtml(section)}（人工编辑，每行一条）<textarea name="profileSection_${index}" rows="4">${escapeHtml(lines)}</textarea></label>`;
            }).join('');
            return `
            <label>主题名称<input name="name" value="${escapeHtml(item.name || '')}" required></label>
            <label>主题说明<textarea name="description" rows="4">${escapeHtml(item.description || '')}</textarea></label>
            <label>主题关键词<input name="keywords" value="${escapeHtml((item.keywords || []).join('，'))}"></label>
            <label>同义表达<input name="aliases" value="${escapeHtml((item.aliases || []).join('，'))}"></label>
            <label>排除词<input name="negativeKeywords" value="${escapeHtml((item.negativeKeywords || []).join('，'))}"></label>
            <label>档案分区（每行一个）<textarea name="sections" rows="7">${escapeHtml((item.sections || DEFAULT_TOPIC_SECTIONS).join('\n'))}</textarea></label>
            <label>主题专用整理提示词<textarea name="customPrompt" rows="8" placeholder="例如：睡眠主题重点区分疼痛、高警觉、作息拖延和连接担忧；不要作诊断。">${escapeHtml(item.customPrompt || '')}</textarea></label>
            <label>人工补充（不由 AI 覆盖）<textarea name="profileText" rows="5">${escapeHtml(item.profileText || '')}</textarea></label>
            <details class="um-profile-editor"><summary>人工编辑当前结构化档案</summary>${profileFields}</details>
            <div class="um-form-grid"><label>发送策略<select name="sendPolicy">${topicPolicyOptions(item.sendPolicy || 'keyword')}</select></label><label>优先级<input name="priority" type="number" min="0" max="200" value="${item.priority ?? 80}"></label><label>新增证据整理阈值<input name="minNewEvidence" type="number" min="1" max="100" value="${item.updatePolicy?.minNewEvidence ?? 4}"></label></div>`;
        }
        return `
            <label>标题<input name="title" value="${escapeHtml(item.title || '')}" required></label>
            <label>客观事实<textarea name="factualSummary" rows="5" required>${escapeHtml(item.factualSummary || '')}</textarea></label>
            <label>角色理解<textarea name="characterView" rows="4">${escapeHtml(item.characterView || '')}</textarea></label>
            <label>结果<textarea name="outcome" rows="3">${escapeHtml(item.outcome || '')}</textarea></label>
            <label>关键词<input name="keywords" value="${escapeHtml((item.keywords || []).join('，'))}"></label>
            <label>同义表达<input name="aliases" value="${escapeHtml((item.aliases || []).join('，'))}"></label>
            <label>事件盒关联建议<input name="eventBoxHint" value="${escapeHtml(item.eventBoxHint || '')}" placeholder="仅建议，不会自动创建或归入"></label>
            <label>事件盒关联词<input name="eventBoxKeywords" value="${escapeHtml((item.eventBoxKeywords || []).join('，'))}"></label>
            <label>归入事件盒${eventBoxOptions(item.eventBoxId || '')}</label>
            <label>关联主题${topicCheckboxes(item.topicIds || [])}</label>
            <div class="um-form-grid"><label>发生日期<input name="occurredAt" type="date" value="${formatDate(item.occurredAt || Date.now())}"></label><label>重要度<input name="importance" type="number" min="1" max="10" value="${item.importance ?? 5}"></label><label>理解置信度<input name="viewConfidence" type="number" min="0" max="1" step="0.05" value="${item.viewConfidence ?? 0.5}"></label></div>`;
    }

    function openEditor(type, id, draft) {
        const character = getCharacter();
        if (!character) return;
        const state = ensureState(character);
        const existing = id ? findItem(state, type, id) : null;
        const item = existing ? clone(existing) : clone(draft || {});
        ui.editingType = type;
        ui.editingId = id || null;
        ui.editorDraft = draft ? clone(draft) : null;
        const modal = document.getElementById('unified-memory-editor-modal');
        const title = document.getElementById('unified-memory-editor-title');
        const form = document.getElementById('unified-memory-editor-form');
        if (!modal || !form) return;
        const names = { doorplate: '门牌', impression: '印象', working: '临时记忆', event: '事件', eventBox: '事件盒', topic: '主题' };
        title.textContent = `${id ? '编辑' : '新增'}${names[type] || ''}`;
        form.innerHTML = `${editorFields(type, item)}<div class="um-editor-actions"><button type="button" class="btn btn-secondary" data-um-action="close-editor">取消</button><button type="submit" class="btn btn-primary">保存</button></div>`;
        modal.classList.add('visible');
    }

    function closeEditor() {
        const modal = document.getElementById('unified-memory-editor-modal');
        if (modal) modal.classList.remove('visible');
        ui.editingType = null;
        ui.editingId = null;
        ui.editorDraft = null;
    }

    async function saveEditor(form) {
        const character = getCharacter();
        if (!character || !ui.editingType) return;
        const state = ensureState(character);
        const type = ui.editingType;
        const existing = ui.editingId ? findItem(state, type, ui.editingId) : null;
        const data = Object.fromEntries(new FormData(form).entries());
        const draft = ui.editorDraft ? clone(ui.editorDraft) : {};
        let item = existing || Object.assign({ id: uid(type), createdAt: Date.now(), status: 'active' }, draft);
        if (type === 'doorplate') {
            Object.assign(item, {
                archiveType: 'doorplate', room: String(data.room || 'user_room'), tag: String(data.tag || '').trim(), text: String(data.text || '').trim(),
                category: String(data.tag || '').trim(), content: String(data.text || '').trim(), sourceCount: Math.round(clamp(data.sourceCount,0,9999,1)), firstLearnedAt: item.firstLearnedAt || Date.now(),
                keywords: parseList(data.keywords), aliases: parseList(data.aliases), negativeKeywords: parseList(data.negativeKeywords),
                linkedTopicIds: new FormData(form).getAll('linkedTopicIds').map(String),
                sendPolicy: data.sendPolicy || 'keyword', priority: clamp(data.priority, 0, 200, 70), confidence: clamp(data.confidence, 0, 1, 0.8),
                locked: !!form.elements.locked?.checked, authority: 'user', updatedAt: Date.now()
            });
            const found = ui.editingId ? findRoomPlateEntry(state, ui.editingId) : null;
            const room = SULLY_PLATE_ORDER.includes(item.room) ? item.room : 'user_room';
            if (found) {
                const oldPlate = found.plate;
                const targetPlate = state.roomPlates.find(plate => plate.room === room);
                found.entry.text = item.text;
                found.entry.tag = item.tag;
                found.entry.sourceCount = item.sourceCount;
                found.entry.updatedAt = Date.now();
                if (oldPlate.room !== room) {
                    oldPlate.entries = oldPlate.entries.filter(entry => entry.id !== found.entry.id);
                    targetPlate.entries.unshift(found.entry);
                    oldPlate.updatedAt = Date.now();
                    oldPlate.version = Number(oldPlate.version || 1) + 1;
                }
                targetPlate.updatedAt = Date.now();
                targetPlate.version = Number(targetPlate.version || 1) + 1;
            } else {
                const targetPlate = state.roomPlates.find(plate => plate.room === room);
                targetPlate.entries.unshift(normalizeRoomPlateEntry({ id:item.id, text:item.text, tag:item.tag, sourceCount:item.sourceCount, firstLearnedAt:item.firstLearnedAt, updatedAt:item.updatedAt }));
                targetPlate.updatedAt = Date.now();
                targetPlate.version = Number(targetPlate.version || 1) + 1;
            }
            state.doorplates = getRoomPlateEntryRows(state);
        } else if (type === 'impression') {
            Object.assign(item, {
                archiveType: 'impression', room: String(data.room || 'bedroom'), tag: String(data.tag || '').trim(), text: String(data.text || '').trim(),
                dimension: String(data.tag || '').trim(), statement: String(data.text || '').trim(), sourceCount: Math.round(clamp(data.sourceCount,0,9999,1)), firstLearnedAt: item.firstLearnedAt || Date.now(),
                keywords: parseList(data.keywords), aliases: parseList(data.aliases), negativeKeywords: parseList(data.negativeKeywords),
                linkedTopicIds: new FormData(form).getAll('linkedTopicIds').map(String),
                sendPolicy: data.sendPolicy || 'keyword', priority: clamp(data.priority, 0, 200, 65), confidence: clamp(data.confidence, 0, 1, 0.7),
                locked: !!form.elements.locked?.checked, authority: 'user', updatedAt: Date.now(), supportingEventIds: item.supportingEventIds || [], counterEventIds: item.counterEventIds || []
            });
            throw new Error('印象已改为 UserImpression 完整对象，请在印象页导入或生成');
        } else if (type === 'working') {
            const expiresAt = data.expiresAt ? new Date(`${data.expiresAt}T23:59:59`).getTime() : null;
            Object.assign(item, {
                content: String(data.content || '').trim(), keywords: parseList(data.keywords), expiresAt,
                priority: clamp(data.priority, 0, 200, 90), status: 'active', updatedAt: Date.now()
            });
            if (!existing) state.workingMemories.unshift(item);
        } else if (type === 'eventBox') {
            Object.assign(item, {
                characterId: character.id,
                name: String(data.name || '').trim(),
                summary: String(data.summary || '').trim(),
                currentStage: String(data.currentStage || '').trim(),
                keywords: parseList(data.keywords),
                unresolvedQuestions: parseList(data.unresolvedQuestions),
                status: data.status || 'ongoing',
                priority: clamp(data.priority, 0, 200, 70),
                updatedAt: Date.now()
            });
            if (!existing) state.eventBoxes.unshift(item);
        } else if (type === 'topic') {
            const previous = existing ? snapshotTopic(existing) : null;
            const oldSections = item.sections || DEFAULT_TOPIC_SECTIONS;
            const sections = parseList(data.sections);
            const finalSections = sections.length ? sections : DEFAULT_TOPIC_SECTIONS.slice();
            const nextProfile = {};
            finalSections.forEach((section, index) => {
                const values = String(form.elements[`profileSection_${index}`]?.value || '').split(/\n+/).map(value => value.trim()).filter(Boolean);
                const oldEntries = (item.profile?.[oldSections[index]] || []);
                nextProfile[section] = values.map(statement => {
                    const previousEntry = oldEntries.find(entry => normalizeText(entry.statement) === normalizeText(statement));
                    return previousEntry ? { ...previousEntry, statement, authority: 'user', updatedAt: Date.now() } : {
                        id: uid('profile'), statement, confidence: 1, evidenceEventIds: [], status: 'active', directlyStatedRecurrent: false, authority: 'user', updatedAt: Date.now()
                    };
                });
            });
            Object.assign(item, {
                characterId: character.id,
                name: String(data.name || '').trim(),
                description: String(data.description || '').trim(),
                keywords: parseList(data.keywords),
                aliases: parseList(data.aliases),
                negativeKeywords: parseList(data.negativeKeywords),
                sections: finalSections,
                profile: nextProfile,
                profileText: String(data.profileText || '').trim(),
                customPrompt: String(data.customPrompt || '').trim(),
                updatePolicy: { ...(item.updatePolicy || {}), minNewEvidence: Math.round(clamp(data.minNewEvidence, 1, 100, 4)) },
                sendPolicy: data.sendPolicy || 'keyword',
                priority: clamp(data.priority, 0, 200, 80),
                status: 'confirmed',
                evidenceEventIds: item.evidenceEventIds || [],
                analyzedEventIds: item.analyzedEventIds || [],
                version: Number(item.version || 1),
                updatedAt: Date.now()
            });
            normalizeTopic(item);
            if (!existing) state.topics.unshift(item);
            (item.evidenceEventIds || []).forEach(eventId => {
                const event = state.events.find(candidate => candidate.id === eventId);
                if (event && !(event.topicIds || []).includes(item.id)) event.topicIds.push(item.id);
            });
            if (item.sourceCandidateKey) {
                state.topicDecisions[item.sourceCandidateKey] = { status: 'accepted', topicId: item.id, decidedAt: Date.now() };
                delete item.sourceCandidateKey;
            }
            if (previous) {
                item.version = Number(item.version || 1) + 1;
                recordTopicVersion(state, item.id, previous, snapshotTopic(item), '人工编辑主题设置或结构化档案', [], 'user');
            }
        } else {
            const occurredAt = data.occurredAt ? new Date(`${data.occurredAt}T12:00:00`).getTime() : Date.now();
            const topicIds = new FormData(form).getAll('topicIds').map(String);
            Object.assign(item, {
                characterId: character.id, title: String(data.title || '').trim(), factualSummary: String(data.factualSummary || '').trim(),
                characterView: String(data.characterView || '').trim(), outcome: String(data.outcome || '').trim(),
                keywords: parseList(data.keywords), aliases: parseList(data.aliases), occurredAt,
                eventBoxHint: String(data.eventBoxHint || '').trim(), eventBoxKeywords: parseList(data.eventBoxKeywords),
                eventBoxId: String(data.eventBoxId || '').trim() || null, topicIds,
                importance: Math.round(clamp(data.importance, 1, 10, 5)), viewConfidence: clamp(data.viewConfidence, 0, 1, 0.5),
                sourceMessageIds: item.sourceMessageIds || [], updatedAt: Date.now(), accessCount: item.accessCount || 0
            });
            if (!existing) state.events.unshift(item);
            state.topics.forEach(topic => {
                const set = new Set(topic.evidenceEventIds || []);
                if (topicIds.includes(topic.id)) set.add(item.id); else set.delete(item.id);
                topic.evidenceEventIds = [...set];
            });
        }
        state.retrieval.lastPreparedAt = null;
        await persist();
        closeEditor();
        render();
        if (typeof showToast === 'function') showToast('已保存');
    }

    async function deleteItem(type, id) {
        const character = getCharacter();
        if (!character) return;
        const state = ensureState(character);
        const map = { doorplate: 'doorplates', impression: 'impressions', working: 'workingMemories', event: 'events', eventBox: 'eventBoxes', topic: 'topics' };
        const key = map[type];
        if (!key) return;
        if (type === 'doorplate') {
            const found = findRoomPlateEntry(state, id);
            if (!found) return;
            if (!window.confirm(`确定删除这条门牌吗？

${found.entry.text}`)) return;
            found.plate.entries = found.plate.entries.filter(entry => entry.id !== id);
            found.plate.updatedAt = Date.now();
            found.plate.version = Number(found.plate.version || 1) + 1;
            state.doorplates = getRoomPlateEntryRows(state);
            state.retrieval.lastPreparedAt = null;
            await persist();
            render();
            return;
        }
        if (!window.confirm('确定删除这条记忆吗？')) return;
        if (type === 'eventBox') state.events.forEach(event => { if (event.eventBoxId === id) event.eventBoxId = null; });
        if (type === 'topic') {
            state.events.forEach(event => { event.topicIds = (event.topicIds || []).filter(topicId => topicId !== id); });

        }
        if (type === 'event') {
            state.topics.forEach(topic => { topic.evidenceEventIds = (topic.evidenceEventIds || []).filter(eventId => eventId !== id); });
        }
        state[key] = state[key].filter(item => item.id !== id);
        state.retrieval.lastPreparedAt = null;
        await persist();
        render();
    }

    async function handleAction(action, element) {
        const character = getCharacter();
        if (!character) return;
        const state = ensureState(character);
        if (action === 'add') openEditor(element.dataset.type);
        else if (action === 'add-doorplate-room') openEditor('doorplate', null, { room: element.dataset.room || 'user_room', sourceCount: 1 });
        else if (action === 'export-roomplates') {
            const payload = JSON.stringify(state.roomPlates, null, 2);
            try { await navigator.clipboard.writeText(payload); if (typeof showToast === 'function') showToast('门牌 JSON 已复制'); }
            catch (_) { window.prompt('复制门牌 JSON', payload); }
        } else if (action === 'generate-impression') {
            element.disabled = true;
            try { await generateStructuredImpression(character, element.dataset.mode || (state.impression ? 'update' : 'initial')); render(); if(typeof showToast==='function')showToast('印象档案已更新'); }
            catch(error){ element.disabled=false; if(typeof showToast==='function')showToast(`印象生成失败：${error.message||error}`); throw error; }
        } else if (action === 'import-impression') {
            const input=document.getElementById('um-impression-json');
            try { const parsed=normalizeUserImpressionLocal(JSON.parse(String(input?.value||''))); if(!parsed) throw new Error('结构不完整'); state.impression=parsed; state.retrieval.lastPreparedAt=null; await persist(); render(); if(typeof showToast==='function')showToast('Sully 印象已导入'); }
            catch(error){ if(typeof showToast==='function')showToast(`导入失败：${error.message||error}`); }
        } else if (action === 'export-impression') {
            if(!state.impression)return; await navigator.clipboard.writeText(JSON.stringify(state.impression,null,2)); if(typeof showToast==='function')showToast('印象 JSON 已复制');
        } else if (action === 'delete-impression') {
            if(window.confirm('确定删除完整印象档案吗？')){state.impression=null;state.retrieval.lastPreparedAt=null;await persist();render();}
        } else if (action === 'edit') openEditor(element.dataset.type, element.dataset.id);
        else if (action === 'delete') await deleteItem(element.dataset.type, element.dataset.id);
        else if (action === 'close-editor') closeEditor();
        else if (action === 'accept-topic') {
            const candidate = getTopicCandidates(character).find(item => item.key === element.dataset.key);
            if (!candidate) throw new Error('候选主题已失效');
            openEditor('topic', null, createTopicDraft(candidate));
        } else if (action === 'merge-topic') {
            const key = element.dataset.key;
            const select = [...document.querySelectorAll('[data-topic-merge-for]')].find(node => node.dataset.topicMergeFor === key);
            const topicId = select?.value;
            if (!topicId) {
                if (typeof showToast === 'function') showToast('请先选择要并入的主题');
                return;
            }
            await mergeCandidateIntoTopic(character, key, topicId);
            render();
            if (typeof showToast === 'function') showToast('已并入主题');
        } else if (action === 'defer-topic') {
            const key = element.dataset.key;
            state.topicDecisions[key] = { status: 'deferred', until: Date.now() + Number(state.topicSettings.deferDays || 14) * 86400000, decidedAt: Date.now() };
            await persist(); render();
        } else if (action === 'dismiss-topic') {
            const key = element.dataset.key;
            if (!window.confirm('确定以后不再推荐这个关键词主题吗？')) return;
            state.topicDecisions[key] = { status: 'dismissed', decidedAt: Date.now() };
            await persist(); render();
        } else if (action === 'confirm-box-link') {
            const event = state.events.find(item => item.id === element.dataset.eventId);
            const box = state.eventBoxes.find(item => item.id === element.dataset.boxId);
            if (event && box) { event.eventBoxId = box.id; event.updatedAt = Date.now(); box.updatedAt = Date.now(); }
            state.retrieval.lastPreparedAt = null;
            await persist(); render();
        } else if (action === 'unlink-box') {
            const event = state.events.find(item => item.id === element.dataset.eventId);
            if (event) { event.eventBoxId = null; event.updatedAt = Date.now(); }
            state.retrieval.lastPreparedAt = null;
            await persist(); render();
        } else if (action === 'create-box-hint') {
            await createEventBoxFromHint(character, element.dataset.name);
            render();
            if (typeof showToast === 'function') showToast('事件盒已创建并归入建议事件');
        }
        else if (action === 'topic-update' || action === 'topic-rebuild') {
            const mode = action === 'topic-rebuild' ? 'all' : 'incremental';
            if (mode === 'all' && !window.confirm('确定使用全部主题证据重新整理吗？当前档案会先保存为可恢复版本。')) return;
            element.disabled = true;
            const oldText = element.textContent;
            element.textContent = mode === 'all' ? '正在重整…' : '正在整理…';
            try {
                const result = await updateTopicProfile(character, element.dataset.id, mode);
                render();
                if (typeof showToast === 'function') showToast(`主题档案已更新：${result.newEvidenceCount} 条新增 / ${result.totalEvidenceCount} 条总证据`);
            } catch (error) {
                console.error('[UnifiedMemory] topic update failed:', error);
                if (typeof showToast === 'function') showToast(`主题整理失败：${error.message || error}`, 5000);
                element.disabled = false;
                element.textContent = oldText;
            }
        } else if (action === 'restore-topic-version') {
            if (!window.confirm('确定恢复到这个更新之前的主题状态吗？当前状态也会保存为新版本。')) return;
            await restoreTopicVersion(character, element.dataset.versionId);
            render();
            if (typeof showToast === 'function') showToast('主题版本已恢复');
        } else if (action === 'delete-topic-version') {
            if (!window.confirm('确定删除这条版本记录吗？')) return;
            state.topicVersions = state.topicVersions.filter(version => version.id !== element.dataset.versionId);
            await persist();
            render();
        } else if (action === 'save-topic-base-prompt') {
            const textarea = document.getElementById('um-topic-base-prompt');
            state.prompts.topicUpdate = String(textarea?.value || '').trim() || DEFAULT_TOPIC_PROMPT;
            await persist();
            if (typeof showToast === 'function') showToast('主题整理提示词已保存');
        } else if (action === 'reset-topic-base-prompt') {
            state.prompts.topicUpdate = DEFAULT_TOPIC_PROMPT;
            await persist();
            render();
            if (typeof showToast === 'function') showToast('已恢复默认主题整理提示词');
        }
        else if (action === 'schedule-jobs') {
            scheduleUnifiedMemoryJobs(character, '用户手动检查'); await persist(); render();
            if (typeof showToast === 'function') showToast('已检查并加入符合条件的任务');
        } else if (action === 'run-jobs') {
            element.disabled=true; try { const count=await processUnifiedMemoryQueue(character,{maxJobs:state.automation.maxJobsPerRun}); render(); if(typeof showToast==='function')showToast(`本轮执行 ${count} 个任务`); } catch(error){ element.disabled=false; if(typeof showToast==='function')showToast(`队列执行失败：${error.message||error}`); }
        } else if (action === 'queue-event-extract') {
            const messages=getUnprocessedMessages(character); if(!messages.length){if(typeof showToast==='function')showToast('没有新消息');return;}
            const batch=messages.slice(0,Math.max(4,Number(state.automation.eventBatchLimit||60))); const first=batch[0],last=batch[batch.length-1];
            enqueueMemoryJob(character,'event_extract',{messageIds:batch.map(m=>m.id),firstMessageId:first.id,lastMessageId:last.id,lastMessageTimestamp:Number(last.timestamp||0),reason:'手动强制排队'},{dedupeKey:`event_extract:${first.id}:${last.id}`,reviveFailed:true}); await persist(); render();
        } else if (action === 'retry-job') {
            const job=state.jobs.find(item=>item.id===element.dataset.id); if(job){job.status='pending';job.error='';job.nextRetryAt=null;} await persist(); render();
        } else if (action === 'cancel-job') {
            const job=state.jobs.find(item=>item.id===element.dataset.id); if(job&&job.status!=='running'){job.status='cancelled';job.finishedAt=Date.now();} await persist(); render();
        } else if (action === 'delete-job') {
            state.jobs=state.jobs.filter(item=>item.id!==element.dataset.id); await persist(); render();
        } else if (action === 'clear-finished-jobs') {
            state.jobs=state.jobs.filter(item=>!['completed','cancelled'].includes(item.status)); await persist(); render();
        } else if (action === 'apply-archive-job') {
            const job=state.jobs.find(item=>item.id===element.dataset.id); if(job){applyArchiveProposals(character,job);await persist();render();if(typeof showToast==='function')showToast('档案建议已应用');}
        } else if (action === 'dismiss-archive-job') {
            const job=state.jobs.find(item=>item.id===element.dataset.id); if(job){state.automation.archiveAnalyzedEventIds=[...new Set([...(state.automation.archiveAnalyzedEventIds||[]),...(job.result?.eventIds||[])])];job.status='completed';job.finishedAt=Date.now();job.summary='用户忽略了本批档案建议';await persist();render();}
        } else if (action === 'save-auto-settings') {
            document.querySelectorAll('[data-um-auto-check]').forEach(input=>{state.automation[input.dataset.umAutoCheck]=!!input.checked;});
            document.querySelectorAll('[data-um-auto-number]').forEach(input=>{state.automation[input.dataset.umAutoNumber]=Number(input.value);}); await persist(); render(); if(typeof showToast==='function')showToast('自动任务设置已保存');
        } else if (action === 'save-archive-prompt') {
            state.prompts.archiveConsolidation=String(document.getElementById('um-archive-prompt')?.value||'').trim()||DEFAULT_ARCHIVE_PROMPT;await persist();if(typeof showToast==='function')showToast('门牌蒸馏提示词已保存');
        } else if (action === 'reset-archive-prompt') {
            state.prompts.archiveConsolidation=DEFAULT_ARCHIVE_PROMPT;await persist();render();
        } else if (action === 'save-box-prompt') {
            state.prompts.eventBoxUpdate=String(document.getElementById('um-box-prompt')?.value||'').trim()||DEFAULT_EVENT_BOX_PROMPT;await persist();if(typeof showToast==='function')showToast('事件盒提示词已保存');
        } else if (action === 'reset-box-prompt') {
            state.prompts.eventBoxUpdate=DEFAULT_EVENT_BOX_PROMPT;await persist();render();
        }
        else if (action === 'toggle-manual') {
            const item = findItem(state, element.dataset.type, element.dataset.id);
            if (item) item.manualActive = !item.manualActive;
            state.retrieval.lastPreparedAt = null;
            await persist(); render();
        } else if (action === 'toggle-working') {
            const item = findItem(state, 'working', element.dataset.id);
            if (item) {
                const active = isWorkingActive(item, Date.now());
                if (active) item.status = 'ended';
                else { item.status = 'active'; item.expiresAt = null; }
            }
            state.retrieval.lastPreparedAt = null;
            await persist(); render();
        } else if (action === 'summarize') {
            const count = Number(document.getElementById('um-summary-count')?.value || 40);
            element.disabled = true;
            element.textContent = '正在提取…';
            extractionDebug('手动提取按钮', { count });
            try {
                const created = await summarizeRecentMessages(character, count);
                if (typeof showToast === 'function') showToast(`已生成 ${created.length} 条事件`);
            } catch (error) {
                extractionDebug('手动提取失败', { count, error: error?.message || String(error), stack: error?.stack || '' }, 'error');
                if (typeof showToast === 'function') showToast(`提取失败：${error.message || error}`, 5000);
            } finally {
                element.disabled = false;
                element.textContent = 'AI 提取事件';
                render();
            }
        } else if (action === 'batch-summarize') {
            const mode = document.getElementById('um-batch-mode')?.value || 'unprocessed';
            const batchSize = Number(document.getElementById('um-batch-size')?.value || 40);
            const maxBatches = Number(document.getElementById('um-batch-max')?.value || 20);
            try {
                const result = await batchExtractMessages(character, { mode, batchSize, maxBatches });
                if (typeof showToast === 'function') showToast(`批量提取完成：处理 ${result.processedMessages || 0} 条消息，生成 ${result.totalCreated || 0} 条事件`, 5000);
            } catch (error) {
                extractionDebug('批量提取操作失败', { error: error?.message || String(error), stack: error?.stack || '' }, 'error');
                if (typeof showToast === 'function') showToast(`批量提取失败：${error.message || error}`, 6000);
            }
            render();
        } else if (action === 'stop-batch') {
            ui.batchStopRequested = true;
            extractionDebug('收到停止请求', { progress: ui.batchProgress || {} }, 'warn');
            render();
        } else if (action === 'clear-extraction-logs') {
            ui.extractionLogs = [];
            render();
        } else if (action === 'copy-extraction-debug') {
            const payload = JSON.stringify({ progress: ui.batchProgress, logs: ui.extractionLogs }, null, 2);
            try {
                await navigator.clipboard.writeText(payload);
                if (typeof showToast === 'function') showToast('调试信息已复制');
            } catch (_) {
                window.prompt('复制以下调试信息', payload);
            }
        } else if (action === 'save-prompt') {
            const textarea = document.getElementById('um-event-prompt');
            state.prompts.eventExtraction = String(textarea?.value || '').trim() || DEFAULT_EVENT_PROMPT;
            await persist();
            if (typeof showToast === 'function') showToast('提示词已保存');
        } else if (action === 'reset-event-prompt') {
            state.prompts.eventExtraction = DEFAULT_EVENT_PROMPT;
            await persist();
            render();
            if (typeof showToast === 'function') showToast('已恢复第一人称默认提示词');
        } else if (action === 'debug-run') {
            const textarea = document.getElementById('um-debug-query');
            ui.debugQuery = String(textarea?.value || '').trim();
            const selected = await selectMemoriesWithVector(character, ui.debugQuery, { touch: false });
            state.retrieval.lastQueryText = ui.debugQuery;
            state.retrieval.lastDebug = createRetrievalDebugSnapshot(selected);
            state.retrieval.lastContextBlock = buildContextBlock(character, selected);
            state.retrieval.lastPreparedAt = Date.now();
            render();
        } else if (action === 'reset-topic-decisions') {
            if (!window.confirm('确定清除所有主题推荐的暂缓和忽略记录吗？')) return;
            state.topicDecisions = {};
            await persist();
            render();
            if (typeof showToast === 'function') showToast('主题推荐记录已重置');
        } else if (action === 'queue-missing-embeddings') {
            const pending = state.events.filter(event => event.status === 'active' && eventNeedsEmbedding(event));
            if (!pending.length) { if (typeof showToast === 'function') showToast('没有需要生成的事件向量'); return; }
            const size = Math.max(1, Number(state.automation.embeddingBatchSize || 12));
            for (let index = 0; index < pending.length; index += size) {
                const batch = pending.slice(index, index + size);
                enqueueMemoryJob(character, 'embedding_generate', { eventIds: batch.map(event => event.id) }, { dedupeKey: `embedding:${currentVectorModelSignature()}:${batch.map(event => event.id).join(',')}` });
            }
            await persist(); render(); if (typeof showToast === 'function') showToast(`已排队 ${pending.length} 条事件向量`);
        } else if (action === 'rebuild-all-embeddings') {
            state.events.forEach(event => { event.embedding=[]; event.embeddingModelSignature=''; event.embeddingTextHash=''; event.embeddingUpdatedAt=null; });
            state.jobs = state.jobs.filter(job => job.type !== 'embedding_generate' || !['pending','failed'].includes(job.status));
            const active = state.events.filter(event => event.status === 'active'); const size = Math.max(1, Number(state.automation.embeddingBatchSize || 12));
            for (let index = 0; index < active.length; index += size) { const batch=active.slice(index,index+size); enqueueMemoryJob(character,'embedding_generate',{eventIds:batch.map(event=>event.id)},{dedupeKey:`embedding:${currentVectorModelSignature()}:${batch.map(event=>event.id).join(',')}`}); }
            state.retrieval.lastPreparedAt=null; await persist(); render(); if (typeof showToast === 'function') showToast(`已重建排队 ${active.length} 条事件`);
        } else if (action === 'clear-all-embeddings') {
            if (!confirm('确定清除当前角色全部事件向量吗？事件文字不会删除。')) return;
            state.events.forEach(event => { event.embedding=[]; event.embeddingModelSignature=''; event.embeddingTextHash=''; event.embeddingUpdatedAt=null; });
            state.jobs = state.jobs.filter(job => job.type !== 'embedding_generate' || job.status === 'completed'); state.retrieval.lastPreparedAt=null; await persist(); render();
        } else if (action === 'merge-duplicate-event') {
            const keep = state.events.find(event => event.id === element.dataset.keepId); const duplicate = state.events.find(event => event.id === element.dataset.archiveId);
            if (!keep || !duplicate || keep.id === duplicate.id) return;
            keep.sourceMessageIds=[...new Set([...(keep.sourceMessageIds||[]),...(duplicate.sourceMessageIds||[])])];
            keep.keywords=[...new Set([...(keep.keywords||[]),...(duplicate.keywords||[])])]; keep.aliases=[...new Set([...(keep.aliases||[]),...(duplicate.aliases||[])])]; keep.topicIds=[...new Set([...(keep.topicIds||[]),...(duplicate.topicIds||[])])];
            if(!keep.outcome&&duplicate.outcome)keep.outcome=duplicate.outcome; if(!keep.characterView&&duplicate.characterView)keep.characterView=duplicate.characterView; if(!keep.eventBoxId&&duplicate.eventBoxId)keep.eventBoxId=duplicate.eventBoxId;
            state.topics.forEach(topic=>{topic.evidenceEventIds=[...new Set((topic.evidenceEventIds||[]).map(id=>id===duplicate.id?keep.id:id))];topic.analyzedEventIds=[...new Set((topic.analyzedEventIds||[]).map(id=>id===duplicate.id?keep.id:id))];});
            state.eventBoxes.forEach(box=>{box.analyzedEventIds=[...new Set((box.analyzedEventIds||[]).map(id=>id===duplicate.id?keep.id:id))];});
            duplicate.status='archived'; duplicate.duplicateOfEventId=keep.id; duplicate.updatedAt=Date.now(); keep.updatedAt=Date.now(); state.retrieval.lastPreparedAt=null; await persist(); render();
        } else if (action === 'accept-vector-box') {
            const eventItem=state.events.find(item=>item.id===element.dataset.eventId); const box=state.eventBoxes.find(item=>item.id===element.dataset.boxId);
            if(!eventItem||!box)return; eventItem.eventBoxId=box.id; eventItem.updatedAt=Date.now(); state.retrieval.lastPreparedAt=null; await persist(); render();
        } else if (action === 'save-vector-settings') {
            document.querySelectorAll('[data-um-vector-check]').forEach(input => { state.vector[input.dataset.umVectorCheck] = !!input.checked; });
            document.querySelectorAll('[data-um-vector-number]').forEach(input => { state.vector[input.dataset.umVectorNumber] = Number(input.value); });
            state.retrieval.lastPreparedAt=null; await persist(); render(); if(typeof showToast==='function')showToast('向量设置已保存');
        } else if (action === 'save-settings') {
            document.querySelectorAll('[data-um-retrieval]').forEach(input => {
                state.retrieval[input.dataset.umRetrieval] = Number(input.value);
            });
            document.querySelectorAll('[data-um-retrieval-mode]').forEach(input => {
                state.retrieval[input.dataset.umRetrievalMode] = String(input.value || 'keyword');
            });
            document.querySelectorAll('[data-um-topic-setting]').forEach(input => {
                state.topicSettings[input.dataset.umTopicSetting] = Number(input.value);
            });
            state.retrieval.lastPreparedAt = null;
            await persist();
            render();
            if (typeof showToast === 'function') showToast('设置已保存');
        }
    }

    function bindEvents() {
        document.addEventListener('click', event => {
            const tab = event.target.closest('.um-tab');
            if (tab) {
                ui.tab = tab.dataset.tab;
                render();
                return;
            }
            const actionElement = event.target.closest('[data-um-action]');
            if (actionElement) {
                handleAction(actionElement.dataset.umAction, actionElement);
            }
        });
        document.addEventListener('change', async event => {
            const setting = event.target.dataset.umSetting;
            if (!setting) return;
            const character = getCharacter();
            if (!character) return;
            const state = ensureState(character);
            state[setting] = !!event.target.checked;
            state.retrieval.lastPreparedAt = null;
            await persist();
            render();
        });
        const editorForm = document.getElementById('unified-memory-editor-form');
        if (editorForm) {
            editorForm.addEventListener('submit', event => {
                event.preventDefault();
                saveEditor(editorForm).catch(error => {
                    console.error(error);
                    if (typeof showToast === 'function') showToast(`保存失败：${error.message || error}`);
                });
            });
        }
        const openButton = document.getElementById('setting-open-unified-memory-btn');
        if (openButton) openButton.addEventListener('click', openUnifiedMemoryCenter);
        const backButton = document.getElementById('unified-memory-back-btn');
        if (backButton) backButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            closeUnifiedMemoryCenter();
        });
        disableLegacyMemoryUi();
        const modal = document.getElementById('unified-memory-editor-modal');
        if (modal) modal.addEventListener('click', event => {
            if (event.target === modal) closeEditor();
        });
    }

    function openUnifiedMemoryCenter() {
        const character = getCharacter();
        if (!character) {
            if (typeof showToast === 'function') showToast('请先进入一个私聊角色');
            return;
        }
        ensureState(character);
        ui.tab = 'overview';
        clearUnifiedMemoryScreenOverrides();
        if (typeof switchScreen === 'function') switchScreen('unified-memory-screen');
        const screen = document.getElementById('unified-memory-screen');
        if (screen) screen.classList.add('active');
        render();
        const state = ensureState(character);
        if (state.automation.enabled && state.automation.autoStartOnOpen) {
            setTimeout(() => checkAndTriggerUnifiedMemoryJobs(character).then(() => render()).catch(error => console.error('[UnifiedMemory] open auto run failed', error)), 100);
        }
    }

    window.ensureUnifiedMemoryState = ensureState;
    window.prepareUnifiedMemoryContext = prepareUnifiedMemoryContext;
    window.getUnifiedMemoryContextBlock = getUnifiedMemoryContextBlock;
    window.checkAndTriggerUnifiedMemoryJobs = checkAndTriggerUnifiedMemoryJobs;
    window.openUnifiedMemoryCenter = openUnifiedMemoryCenter;
    window.closeUnifiedMemoryCenter = closeUnifiedMemoryCenter;
    window.isUnifiedMemoryExclusiveMode = isUnifiedMemoryExclusiveMode;
    window.UnifiedMemory = {
        version: VERSION,
        ensureState,
        selectMemories,
        selectMemoriesWithVector,
        buildContextBlock,
        generateEventEmbeddings,
        getDuplicateEventSuggestions,
        getVectorEventBoxSuggestions,
        summarizeRecentMessages,
        batchExtractMessages,
        extractionDebug,
        getTopicCandidates,
        getEventBoxSuggestions,
        getNewEventBoxSuggestions,
        updateTopicProfile,
        restoreTopicVersion,
        formatTopicProfile,
        enqueueMemoryJob,
        scheduleUnifiedMemoryJobs,
        processUnifiedMemoryQueue,
        checkAndTriggerUnifiedMemoryJobs,
        applyArchiveProposals,
        generateStructuredImpression,
        buildEventExtractionPrompt,
        apiStatusSnapshot,
        render
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindEvents);
    else bindEvents();
})();
