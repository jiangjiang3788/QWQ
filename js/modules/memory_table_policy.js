// 结构化记忆 V2：策略、轮次、游标与相关性检索
(function () {
    'use strict';

    const ENGINE_DEFAULTS = Object.freeze({
        enabled: true,
        triggerMode: 'either',
        roundInterval: 2,
        messageInterval: 140,
        maxSourceMessages: 180,
        overlapMessages: 8,
        retrievalQueryMessages: 10,
        globalInjectionBudget: 3600,
        maxAutoTablesPerRun: 2
    });

    const LAYER_DEFAULTS = Object.freeze({
        core: {
            updatePolicy: { enabled: false, triggerMode: 'manual', roundInterval: 0, messageInterval: 0, maxSourceMessages: 80, overlapMessages: 0, useSummaryApi: true },
            injectionPolicy: { mode: 'always', topK: 0, threshold: 0, budget: 800, maxAgeDays: 0 }
        },
        short: {
            updatePolicy: { enabled: true, triggerMode: 'either', roundInterval: 2, messageInterval: 140, maxSourceMessages: 180, overlapMessages: 8, useSummaryApi: false },
            injectionPolicy: { mode: 'active', topK: 6, threshold: 0.12, budget: 1400, maxAgeDays: 7 }
        },
        medium: {
            updatePolicy: { enabled: false, triggerMode: 'manual', roundInterval: 8, messageInterval: 420, maxSourceMessages: 260, overlapMessages: 12, useSummaryApi: true },
            injectionPolicy: { mode: 'relevant', topK: 4, threshold: 0.16, budget: 1100, maxAgeDays: 120 }
        },
        long: {
            updatePolicy: { enabled: false, triggerMode: 'manual', roundInterval: 0, messageInterval: 0, maxSourceMessages: 320, overlapMessages: 16, useSummaryApi: true },
            injectionPolicy: { mode: 'relevant', topK: 5, threshold: 0.18, budget: 1300, maxAgeDays: 0 }
        },
        review: {
            updatePolicy: { enabled: false, triggerMode: 'manual', roundInterval: 0, messageInterval: 0, maxSourceMessages: 320, overlapMessages: 16, useSummaryApi: true },
            injectionPolicy: { mode: 'never', topK: 0, threshold: 1, budget: 0, maxAgeDays: 0 }
        }
    });

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function clampNumber(value, fallback, min, max) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    }

    function normalizeLayer(layer, tableName) {
        const raw = String(layer || '').trim().toLowerCase();
        if (LAYER_DEFAULTS[raw]) return raw;
        const name = String(tableName || '');
        if (/审核|候选/.test(name)) return 'review';
        if (/核心|确认档案/.test(name)) return 'core';
        if (/当前|近期|事件|待办|日常|状态/.test(name)) return 'short';
        if (/周期|总结|成长|趋势/.test(name)) return 'medium';
        return 'long';
    }

    function normalizeUpdatePolicy(raw, layer) {
        const base = clone((LAYER_DEFAULTS[layer] || LAYER_DEFAULTS.long).updatePolicy);
        const source = raw && typeof raw === 'object' ? raw : {};
        const triggerMode = ['rounds', 'messages', 'either', 'manual'].includes(source.triggerMode)
            ? source.triggerMode
            : base.triggerMode;
        return {
            enabled: source.enabled !== undefined ? !!source.enabled : base.enabled,
            triggerMode,
            roundInterval: clampNumber(source.roundInterval, base.roundInterval, 0, 9999),
            messageInterval: clampNumber(source.messageInterval, base.messageInterval, 0, 999999),
            maxSourceMessages: clampNumber(source.maxSourceMessages, base.maxSourceMessages, 10, 1000),
            overlapMessages: clampNumber(source.overlapMessages, base.overlapMessages, 0, 100),
            useSummaryApi: source.useSummaryApi !== undefined ? !!source.useSummaryApi : base.useSummaryApi,
            allowAdd: source.allowAdd !== false,
            allowUpdate: source.allowUpdate !== false,
            allowDelete: source.allowDelete === true,
            instructions: typeof source.instructions === 'string' ? source.instructions : ''
        };
    }

    function normalizeInjectionPolicy(raw, layer) {
        const base = clone((LAYER_DEFAULTS[layer] || LAYER_DEFAULTS.long).injectionPolicy);
        const source = raw && typeof raw === 'object' ? raw : {};
        const mode = ['always', 'active', 'relevant', 'never'].includes(source.mode) ? source.mode : base.mode;
        return {
            mode,
            topK: clampNumber(source.topK, base.topK, 0, 50),
            threshold: clampNumber(source.threshold, base.threshold, 0, 1),
            budget: clampNumber(source.budget, base.budget, 0, 20000),
            maxAgeDays: clampNumber(source.maxAgeDays, base.maxAgeDays, 0, 36500),
            includePinned: source.includePinned !== false,
            includeCompleted: source.includeCompleted === true,
            instructions: typeof source.instructions === 'string' ? source.instructions : ''
        };
    }

    function normalizeTablePolicy(table) {
        const layer = normalizeLayer(table && table.memoryLayer, table && table.name);
        return {
            memoryLayer: layer,
            updatePolicy: normalizeUpdatePolicy(table && table.updatePolicy, layer),
            injectionPolicy: normalizeInjectionPolicy(table && table.injectionPolicy, layer)
        };
    }

    function normalizeEngineSettings(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            enabled: source.enabled !== false,
            triggerMode: ['rounds', 'messages', 'either'].includes(source.triggerMode) ? source.triggerMode : ENGINE_DEFAULTS.triggerMode,
            roundInterval: clampNumber(source.roundInterval, ENGINE_DEFAULTS.roundInterval, 1, 9999),
            messageInterval: clampNumber(source.messageInterval, ENGINE_DEFAULTS.messageInterval, 10, 999999),
            maxSourceMessages: clampNumber(source.maxSourceMessages, ENGINE_DEFAULTS.maxSourceMessages, 10, 1000),
            overlapMessages: clampNumber(source.overlapMessages, ENGINE_DEFAULTS.overlapMessages, 0, 100),
            retrievalQueryMessages: clampNumber(source.retrievalQueryMessages, ENGINE_DEFAULTS.retrievalQueryMessages, 1, 50),
            globalInjectionBudget: clampNumber(source.globalInjectionBudget, ENGINE_DEFAULTS.globalInjectionBudget, 500, 30000),
            maxAutoTablesPerRun: clampNumber(source.maxAutoTablesPerRun, ENGINE_DEFAULTS.maxAutoTablesPerRun, 1, 20)
        };
    }

    function ensureRuntimeState(chat) {
        if (!chat) return null;
        if (!chat.memoryTables || typeof chat.memoryTables !== 'object') chat.memoryTables = {};
        const state = chat.memoryTables;
        state.engineSettings = normalizeEngineSettings(state.engineSettings);
        if (!Array.isArray(state.rounds)) state.rounds = [];
        if (!state.tableStates || typeof state.tableStates !== 'object') state.tableStates = {};
        if (!state.retrievalCache || typeof state.retrievalCache !== 'object') state.retrievalCache = {};
        if (!['normal', 'json'].includes(state.viewMode)) state.viewMode = 'normal';
        if (state.activeTableId === undefined) state.activeTableId = null;
        if (state.lastRoundId === undefined) state.lastRoundId = null;
        return state;
    }

    function ensureTableState(chat, templateId, tableId, options) {
        const runtime = ensureRuntimeState(chat);
        runtime.tableStates[templateId] ||= {};
        let state = runtime.tableStates[templateId][tableId];
        if (!state || typeof state !== 'object') {
            const history = Array.isArray(chat.history) ? chat.history : [];
            const latestMessage = history[history.length - 1] || null;
            const latestRound = runtime.rounds[runtime.rounds.length - 1] || null;
            const initializeAtLatest = !options || options.initializeAtLatest !== false;
            state = {
                enabled: true,
                lastProcessedMsgId: initializeAtLatest ? (chat.memoryTables.lastUpdateMsgId || latestMessage?.id || null) : null,
                lastProcessedMsgTimestamp: initializeAtLatest ? (chat.memoryTables.lastUpdateMsgTimestamp || latestMessage?.timestamp || null) : null,
                lastProcessedRoundId: initializeAtLatest ? (latestRound?.id || null) : null,
                lastRunAt: null,
                lastRunStatus: 'idle',
                lastError: '',
                customCursorPosition: null
            };
            runtime.tableStates[templateId][tableId] = state;
        }
        if (state.enabled === undefined) state.enabled = true;
        if (!state.lastRunStatus) state.lastRunStatus = 'idle';
        return state;
    }

    function getHistoryIndexById(history, id) {
        if (!id) return -1;
        return history.findIndex(item => item && item.id === id);
    }

    function beginRound(chat, options) {
        if (!chat || options?.isBackground || options?.isSummary) return null;
        const runtime = ensureRuntimeState(chat);
        const history = Array.isArray(chat.history) ? chat.history : [];
        let startIndex = history.length;
        for (let i = history.length - 1; i >= 0; i--) {
            const item = history[i];
            if (item && (item.role === 'assistant' || item.role === 'char') && !item.isThinking) {
                startIndex = i + 1;
                break;
            }
            startIndex = i;
        }
        const token = {
            id: `memory_round_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            startIndex,
            beforeCount: history.length,
            startedAt: Date.now()
        };
        runtime.activeRound = token;
        return token;
    }

    function cancelRound(chat, token) {
        if (!chat || !token) return;
        const runtime = ensureRuntimeState(chat);
        if (runtime.activeRound && runtime.activeRound.id === token.id) runtime.activeRound = null;
    }

    function finishRound(chat, token) {
        if (!chat || !token) return null;
        const runtime = ensureRuntimeState(chat);
        const history = Array.isArray(chat.history) ? chat.history : [];
        const endIndex = history.length - 1;
        if (endIndex < token.startIndex) {
            runtime.activeRound = null;
            return null;
        }
        const slice = history.slice(token.startIndex, endIndex + 1).filter(Boolean);
        slice.forEach(item => {
            if (!item.memoryRoundId) item.memoryRoundId = token.id;
        });
        const round = {
            id: token.id,
            startMessageId: slice[0]?.id || null,
            endMessageId: slice[slice.length - 1]?.id || null,
            startedAt: token.startedAt,
            completedAt: Date.now(),
            messageCount: slice.filter(item => !item.isThinking && !item.isContextDisabled).length,
            userMessageCount: slice.filter(item => item.role === 'user' && !item.isContextDisabled).length,
            assistantMessageCount: slice.filter(item => (item.role === 'assistant' || item.role === 'char') && !item.isContextDisabled).length
        };
        runtime.rounds.push(round);
        runtime.rounds = runtime.rounds.slice(-500);
        runtime.lastRoundId = round.id;
        runtime.activeRound = null;
        return round;
    }

    function getUnprocessedInfo(chat, templateId, tableId) {
        const runtime = ensureRuntimeState(chat);
        const tableState = ensureTableState(chat, templateId, tableId);
        const history = Array.isArray(chat.history) ? chat.history : [];
        let cursorIndex = getHistoryIndexById(history, tableState.lastProcessedMsgId);
        if (cursorIndex < 0 && tableState.lastProcessedMsgTimestamp) {
            for (let i = history.length - 1; i >= 0; i--) {
                if ((history[i]?.timestamp || 0) <= tableState.lastProcessedMsgTimestamp) {
                    cursorIndex = i;
                    break;
                }
            }
        }
        const nextStartIndex = cursorIndex + 1;
        const unsyncedMessages = Math.max(0, history.length - nextStartIndex);
        const roundCursorIndex = tableState.lastProcessedRoundId
            ? runtime.rounds.findIndex(item => item.id === tableState.lastProcessedRoundId)
            : -1;
        const unsyncedRounds = Math.max(0, runtime.rounds.length - (roundCursorIndex + 1));
        return { runtime, tableState, history, cursorIndex, nextStartIndex, unsyncedMessages, roundCursorIndex, unsyncedRounds };
    }

    function resolveEffectiveUpdatePolicy(table, engineSettings) {
        const normalized = normalizeTablePolicy(table).updatePolicy;
        const engine = normalizeEngineSettings(engineSettings);
        if (normalized.triggerMode === 'manual') return normalized;
        return {
            ...normalized,
            roundInterval: normalized.roundInterval || engine.roundInterval,
            messageInterval: normalized.messageInterval || engine.messageInterval,
            maxSourceMessages: normalized.maxSourceMessages || engine.maxSourceMessages,
            overlapMessages: normalized.overlapMessages ?? engine.overlapMessages
        };
    }

    function isTableDue(chat, templateId, table) {
        const info = getUnprocessedInfo(chat, templateId, table.id);
        const policy = resolveEffectiveUpdatePolicy(table, info.runtime.engineSettings);
        if (!info.runtime.engineSettings.enabled || !policy.enabled || !info.tableState.enabled || policy.triggerMode === 'manual') return false;
        const roundDue = policy.roundInterval > 0 && info.unsyncedRounds >= policy.roundInterval;
        const messageDue = policy.messageInterval > 0 && info.unsyncedMessages >= policy.messageInterval;
        if (policy.triggerMode === 'rounds') return roundDue;
        if (policy.triggerMode === 'messages') return messageDue;
        return roundDue || messageDue;
    }

    function getTableUpdateRange(chat, templateId, table, options) {
        const info = getUnprocessedInfo(chat, templateId, table.id);
        const policy = resolveEffectiveUpdatePolicy(table, info.runtime.engineSettings);
        const requestedStart = Number(options?.start);
        const requestedEnd = Number(options?.end);
        if (Number.isFinite(requestedStart) && Number.isFinite(requestedEnd)) {
            return {
                start: Math.max(1, requestedStart),
                end: Math.min(info.history.length, Math.max(requestedStart, requestedEnd)),
                info,
                policy
            };
        }
        if (info.unsyncedMessages <= 0) return null;
        const maxMessages = Math.max(10, policy.maxSourceMessages || info.runtime.engineSettings.maxSourceMessages);
        const overlap = Math.min(Math.max(0, policy.overlapMessages || 0), Math.max(0, maxMessages - 1));
        const cursorBase = Math.max(0, info.nextStartIndex - overlap);
        const endIndexExclusive = Math.min(info.history.length, cursorBase + maxMessages);
        return {
            start: cursorBase + 1,
            end: endIndexExclusive,
            info,
            policy
        };
    }

    function setTableCursorByPosition(chat, templateId, tableId, position) {
        const tableState = ensureTableState(chat, templateId, tableId, { initializeAtLatest: false });
        const runtime = ensureRuntimeState(chat);
        const history = Array.isArray(chat.history) ? chat.history : [];
        const numeric = Math.max(0, Math.min(history.length, parseInt(position, 10) || 0));
        const message = numeric > 0 ? history[numeric - 1] : null;
        tableState.lastProcessedMsgId = message?.id || null;
        tableState.lastProcessedMsgTimestamp = message?.timestamp || null;
        tableState.customCursorPosition = numeric;
        const messageRoundId = message?.memoryRoundId || null;
        if (messageRoundId && runtime.rounds.some(item => item.id === messageRoundId)) {
            tableState.lastProcessedRoundId = messageRoundId;
        } else if (numeric === 0) {
            tableState.lastProcessedRoundId = null;
        }
        tableState.lastRunStatus = 'idle';
        tableState.lastError = '';
        clearRetrievalCache(chat);
        return tableState;
    }

    function markTableProcessed(chat, templateId, tableId, endPosition, status) {
        const state = setTableCursorByPosition(chat, templateId, tableId, endPosition);
        const runtime = ensureRuntimeState(chat);
        state.lastProcessedRoundId = runtime.rounds[runtime.rounds.length - 1]?.id || state.lastProcessedRoundId || null;
        state.lastRunAt = Date.now();
        state.lastRunStatus = status || 'success';
        state.lastError = '';
        return state;
    }

    function clearRetrievalCache(chat) {
        const runtime = ensureRuntimeState(chat);
        runtime.retrievalCache = {};
        runtime.lastPreparedQuery = '';
        runtime.lastPreparedAt = null;
    }

    function getMessageText(message) {
        if (!message) return '';
        if (Array.isArray(message.parts) && message.parts.length) {
            return message.parts.map(part => part.text || '').join(' ');
        }
        return String(message.content || '');
    }

    function buildQueryText(chat, count) {
        const runtime = ensureRuntimeState(chat);
        const limit = Math.max(1, parseInt(count, 10) || runtime.engineSettings.retrievalQueryMessages);
        const history = (Array.isArray(chat.history) ? chat.history : [])
            .filter(item => item && !item.isContextDisabled && !item.isThinking)
            .slice(-limit);
        return history.map(item => getMessageText(item)).join('\n').trim();
    }

    function tokenize(text) {
        const source = String(text || '').toLowerCase();
        const tokens = new Set();
        (source.match(/[a-z0-9_]{2,}/g) || []).forEach(token => tokens.add(token));
        const chunks = source.match(/[\u3400-\u9fff]{2,}/g) || [];
        chunks.forEach(chunk => {
            if (chunk.length <= 8) tokens.add(chunk);
            for (let i = 0; i < chunk.length - 1; i++) tokens.add(chunk.slice(i, i + 2));
            for (let i = 0; i < chunk.length - 2; i++) tokens.add(chunk.slice(i, i + 3));
        });
        return Array.from(tokens).slice(0, 240);
    }

    function computeLexicalScore(text, queryText) {
        const haystack = String(text || '').toLowerCase();
        const tokens = tokenize(queryText);
        if (!tokens.length) return 0;
        let weightedHits = 0;
        let totalWeight = 0;
        tokens.forEach(token => {
            const weight = token.length >= 3 ? 1.4 : 1;
            totalWeight += weight;
            if (haystack.includes(token)) weightedHits += weight;
        });
        return totalWeight ? weightedHits / totalWeight : 0;
    }

    function parseDateLike(value) {
        if (!value) return 0;
        if (typeof value === 'number') return value;
        const normalized = String(value).replace(/[年/.]/g, '-').replace(/月/g, '-').replace(/日/g, '').trim();
        const ts = Date.parse(normalized);
        return Number.isFinite(ts) ? ts : 0;
    }

    function getRecencyScore(timestamp, maxAgeDays) {
        if (!timestamp || !maxAgeDays) return 0;
        const ageDays = Math.max(0, (Date.now() - timestamp) / 86400000);
        if (ageDays > maxAgeDays) return -1;
        return Math.max(0, 1 - ageDays / maxAgeDays);
    }

    function isCompletedText(text) {
        return /已完成|已取消|已过期|已解决|已结束|完成/.test(String(text || ''));
    }

    function selectRelevantItems(items, queryText, policy) {
        const normalizedPolicy = normalizeInjectionPolicy(policy, 'long');
        const scored = (items || []).map(item => {
            const text = String(item.searchText || item.text || '');
            const lexical = computeLexicalScore(text, queryText);
            const recency = getRecencyScore(item.updatedAt || item.createdAt || 0, normalizedPolicy.maxAgeDays);
            const importance = Math.max(0, Math.min(1, (Number(item.importance) || 0) / 100));
            const score = lexical * 0.72 + Math.max(0, recency) * 0.13 + importance * 0.08 + (item.pinned ? 0.25 : 0) + (item.active ? 0.08 : 0);
            return { ...item, _score: score, _expired: recency < 0 };
        }).filter(item => {
            if (item._expired && !item.pinned) return false;
            if (!normalizedPolicy.includeCompleted && item.completed && !item.pinned) return false;
            if (item.pinned && normalizedPolicy.includePinned) return true;
            return item._score >= normalizedPolicy.threshold;
        });
        scored.sort((a, b) => {
            if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
            if (b._score !== a._score) return b._score - a._score;
            return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
        });
        return normalizedPolicy.topK > 0 ? scored.slice(0, normalizedPolicy.topK) : scored;
    }

    function trimToBudget(text, budget, label) {
        const source = String(text || '');
        const max = Math.max(0, Number(budget) || 0);
        if (!max || source.length <= max) return source;
        return `${source.slice(0, Math.max(0, max - 48)).trim()}\n…[${label || '记忆'}按预算裁剪 ${source.length - max} 字符]`;
    }

    function isDesktopJsonAvailable() {
        return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(min-width: 821px)').matches;
    }

    window.MemoryTablePolicy = {
        ENGINE_DEFAULTS,
        LAYER_DEFAULTS,
        normalizeLayer,
        normalizeUpdatePolicy,
        normalizeInjectionPolicy,
        normalizeTablePolicy,
        normalizeEngineSettings,
        ensureRuntimeState,
        ensureTableState,
        beginRound,
        finishRound,
        cancelRound,
        getUnprocessedInfo,
        resolveEffectiveUpdatePolicy,
        isTableDue,
        getTableUpdateRange,
        setTableCursorByPosition,
        markTableProcessed,
        clearRetrievalCache,
        buildQueryText,
        computeLexicalScore,
        selectRelevantItems,
        parseDateLike,
        isCompletedText,
        trimToBudget,
        isDesktopJsonAvailable
    };
})();
