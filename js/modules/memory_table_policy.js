// 结构化记忆 V2：策略、轮次、游标与相关性检索
(function () {
    'use strict';

    const Kernel = window.OvoMemoryKernel || null;
    const Core = Kernel?.core;
    if (!Core) throw new Error('记忆内核未加载');
    const clone = Core.clone;
    const clampNumber = Core.clamp;
    const SharedDefaults = Kernel?.get?.('memoryDefaults')?.DEFAULTS || {};
    const RetrievalDefaults = SharedDefaults.retrieval || {};

    const ENGINE_DEFAULTS = Object.freeze({
        enabled: true,
        triggerMode: 'either',
        roundInterval: 2,
        messageInterval: 140,
        maxSourceMessages: 180,
        overlapMessages: 8,
        retrievalQueryMessages: 10,
        globalInjectionBudget: 3600,
        maxAutoTablesPerRun: 2,
        reviewMode: 'summary_only',
        retrievalMode: 'auto',
        semanticWeight: Number(RetrievalDefaults.semanticWeight) || 0.55,
        tagWeight: Number(RetrievalDefaults.tagWeight) || 0.35,
        embeddingCandidateLimit: Number(RetrievalDefaults.embeddingCandidateLimit) || 32,
        sceneRoutingEnabled: true,
        sideEffectGuardEnabled: true
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

    const AUTOMATION_MODES = Object.freeze(['sidecar', 'engine', 'table', 'manual']);
    const SYSTEM_ROLES = Object.freeze([
        'general', 'core_profile', 'current_state', 'tasks', 'recent_events',
        'daily_observation', 'medium_summary', 'long_candidate', 'long_store'
    ]);
    const CAPTURE_MODES = Object.freeze(['sidecar', 'scheduled', 'manual', 'disabled']);
    const FREQUENCY_SOURCES = Object.freeze(['global', 'table']);
    const API_MODES = Object.freeze(['none', 'main', 'summary']);
    const COMMIT_MODES = Object.freeze(['direct', 'review', 'candidate', 'manual_only', 'promotion']);

    function normalizeAutomationMode(mode) {
        return AUTOMATION_MODES.includes(mode) ? mode : '';
    }

    function normalizeLayer(layer, tableName) {
        const raw = String(layer || '').trim().toLowerCase();
        if (LAYER_DEFAULTS[raw]) return raw;
        return Kernel.get('fieldSemantics')?.inferLegacyLayer?.({ name: tableName }) || 'long';
    }

    function inferSystemRole(table) {
        const descriptor = table && typeof table === 'object' ? table : {};
        const explicit = String(descriptor.systemRole || '').trim();
        if (SYSTEM_ROLES.includes(explicit)) return explicit;
        return Kernel.get('fieldSemantics')?.inferLegacyTableRole?.(descriptor) || 'general';
    }

    function normalizeSystemRole(role, table) {
        const raw = String(role || '').trim();
        return SYSTEM_ROLES.includes(raw) ? raw : inferSystemRole(table);
    }

    function defaultCommitMode(systemRole, layer) {
        if (systemRole === 'current_state' || systemRole === 'tasks') return 'direct';
        if (systemRole === 'recent_events' || systemRole === 'daily_observation') return 'candidate';
        if (systemRole === 'medium_summary') return 'review';
        if (systemRole === 'long_candidate') return 'promotion';
        if (systemRole === 'core_profile' || systemRole === 'long_store') return 'manual_only';
        if (layer === 'review' || layer === 'medium') return 'review';
        return layer === 'core' || layer === 'long' ? 'manual_only' : 'direct';
    }

    function normalizeCommitPolicy(raw, systemRole, layer) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const mode = COMMIT_MODES.includes(source.mode) ? source.mode : defaultCommitMode(systemRole, layer);
        return {
            mode,
            requireUserConfirmation: source.requireUserConfirmation !== undefined
                ? !!source.requireUserConfirmation
                : mode === 'review' || mode === 'promotion'
        };
    }

    function inferCapturePolicy(table, updatePolicy) {
        const descriptor = table && typeof table === 'object' ? table : {};
        const role = inferSystemRole(descriptor);
        if (role === 'current_state' || role === 'tasks' || role === 'recent_events' || role === 'daily_observation') {
            return { mode: 'sidecar', frequencySource: 'table', apiMode: 'none' };
        }
        const legacyMode = normalizeAutomationMode(descriptor.automationMode);
        if (legacyMode === 'sidecar') return { mode: 'sidecar', frequencySource: 'table', apiMode: 'none' };
        if (legacyMode === 'engine') return { mode: 'scheduled', frequencySource: 'global', apiMode: updatePolicy.useSummaryApi === false ? 'main' : 'summary' };
        if (legacyMode === 'table') return { mode: 'scheduled', frequencySource: 'table', apiMode: updatePolicy.useSummaryApi === false ? 'main' : 'summary' };
        if (updatePolicy.enabled && updatePolicy.triggerMode !== 'manual') {
            return { mode: 'scheduled', frequencySource: 'table', apiMode: updatePolicy.useSummaryApi === false ? 'main' : 'summary' };
        }
        if (role === 'long_store') return { mode: 'disabled', frequencySource: 'table', apiMode: 'none' };
        return { mode: 'manual', frequencySource: 'table', apiMode: updatePolicy.useSummaryApi === false ? 'main' : 'summary' };
    }

    function normalizeCapturePolicy(raw, table, updatePolicy) {
        const inferred = inferCapturePolicy(table, updatePolicy);
        const source = raw && typeof raw === 'object' ? raw : {};
        const mode = CAPTURE_MODES.includes(source.mode) ? source.mode : inferred.mode;
        const frequencySource = FREQUENCY_SOURCES.includes(source.frequencySource) ? source.frequencySource : inferred.frequencySource;
        let apiMode = API_MODES.includes(source.apiMode) ? source.apiMode : inferred.apiMode;
        if (mode === 'sidecar' || mode === 'disabled') apiMode = 'none';
        return { mode, frequencySource, apiMode };
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
        const descriptor = table && typeof table === 'object' ? table : {};
        const layer = normalizeLayer(descriptor.memoryLayer, descriptor.name);
        const updatePolicy = normalizeUpdatePolicy(descriptor.updatePolicy, layer);
        const systemRole = normalizeSystemRole(descriptor.systemRole, descriptor);
        const capturePolicy = normalizeCapturePolicy(descriptor.capturePolicy, descriptor, updatePolicy);
        const commitPolicy = normalizeCommitPolicy(descriptor.commitPolicy, systemRole, layer);
        if (capturePolicy.apiMode === 'main') updatePolicy.useSummaryApi = false;
        if (capturePolicy.apiMode === 'summary') updatePolicy.useSummaryApi = true;
        return {
            memoryLayer: layer,
            systemRole,
            capturePolicy,
            commitPolicy,
            updatePolicy,
            injectionPolicy: normalizeInjectionPolicy(descriptor.injectionPolicy, layer)
        };
    }

    function inferAutomationMode(table) {
        const policy = normalizeTablePolicy(table);
        if (policy.capturePolicy.mode === 'sidecar') return 'sidecar';
        if (policy.capturePolicy.mode === 'scheduled') return policy.capturePolicy.frequencySource === 'global' ? 'engine' : 'table';
        return 'manual';
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
            maxAutoTablesPerRun: clampNumber(source.maxAutoTablesPerRun, ENGINE_DEFAULTS.maxAutoTablesPerRun, 1, 20),
            reviewMode: ['summary_only', 'manual_and_summary', 'all'].includes(source.reviewMode) ? source.reviewMode : ENGINE_DEFAULTS.reviewMode,
            retrievalMode: ['auto', 'keyword', 'hybrid'].includes(source.retrievalMode) ? source.retrievalMode : ENGINE_DEFAULTS.retrievalMode,
            semanticWeight: clampNumber(source.semanticWeight, ENGINE_DEFAULTS.semanticWeight, 0, 1),
            tagWeight: clampNumber(source.tagWeight, ENGINE_DEFAULTS.tagWeight, 0, 0.8),
            embeddingCandidateLimit: clampNumber(source.embeddingCandidateLimit, ENGINE_DEFAULTS.embeddingCandidateLimit, 4, 200),
            sceneRoutingEnabled: source.sceneRoutingEnabled !== false,
            sideEffectGuardEnabled: source.sideEffectGuardEnabled !== false
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
                customCursorPosition: null,
                pendingReviewBatchId: null
            };
            runtime.tableStates[templateId][tableId] = state;
        }
        if (state.enabled === undefined) state.enabled = true;
        if (!state.lastRunStatus) state.lastRunStatus = 'idle';
        if (state.pendingReviewBatchId === undefined) state.pendingReviewBatchId = null;
        if (!normalizeAutomationMode(state.automationMode) && options?.table) {
            state.automationMode = inferAutomationMode(options.table);
        }
        return state;
    }

    function getHistoryIndexById(history, id) {
        if (!id) return -1;
        return history.findIndex(item => item && item.id === id);
    }

    function beginRound(chat, options) {
        if (!chat || options?.isBackground || options?.isSummary) return null;
        const runtime = ensureRuntimeState(chat);
        // “本次更新”是轮次级瞬时状态。每轮开始即刷新；本轮没有写入时不显示旧轮次标记。
        if (chat.memoryTables && typeof chat.memoryTables === 'object') {
            chat.memoryTables.currentUpdateEntryId = null;
            chat.memoryTables.lastChangedFieldPaths = [];
        }
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
        if (window.MemoryTableFeedback) window.MemoryTableFeedback.discardRound(chat, token.id);
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
        if (window.MemoryTableFeedback) window.MemoryTableFeedback.finalizeRound(chat, round.id);
        return round;
    }

    function getUnprocessedInfo(chat, templateId, tableOrId) {
        const runtime = ensureRuntimeState(chat);
        const table = tableOrId && typeof tableOrId === 'object' ? tableOrId : null;
        const tableId = table ? table.id : tableOrId;
        const tableState = ensureTableState(chat, templateId, tableId, table ? { table } : undefined);
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

    function materializeEffectiveTable(chat, templateId, table) {
        const resolver = Kernel?.get?.('policyResolver');
        return resolver?.materializeTable ? resolver.materializeTable(chat, templateId, table) : table;
    }

    function resolveEffectiveUpdatePolicy(table, engineSettings, automationMode) {
        const normalizedTable = normalizeTablePolicy(table);
        const normalized = normalizedTable.updatePolicy;
        const engine = normalizeEngineSettings(engineSettings);
        const hasExplicitCapturePolicy = !!(table && table.capturePolicy && typeof table.capturePolicy === 'object');
        const legacyMode = normalizeAutomationMode(automationMode);
        const mode = hasExplicitCapturePolicy
            ? inferAutomationMode(table)
            : (legacyMode || inferAutomationMode(table));
        if (mode === 'manual' || mode === 'sidecar') {
            return { ...normalized, enabled: false, triggerMode: 'manual', automationMode: mode, captureMode: normalizedTable.capturePolicy.mode };
        }
        if (mode === 'engine') {
            return {
                ...normalized,
                enabled: true,
                triggerMode: engine.triggerMode,
                roundInterval: engine.roundInterval,
                messageInterval: engine.messageInterval,
                maxSourceMessages: engine.maxSourceMessages,
                overlapMessages: engine.overlapMessages,
                automationMode: mode,
                captureMode: normalizedTable.capturePolicy.mode
            };
        }
        return {
            ...normalized,
            enabled: true,
            triggerMode: normalized.triggerMode === 'manual' ? engine.triggerMode : normalized.triggerMode,
            roundInterval: normalized.roundInterval || engine.roundInterval,
            messageInterval: normalized.messageInterval || engine.messageInterval,
            maxSourceMessages: normalized.maxSourceMessages || engine.maxSourceMessages,
            overlapMessages: normalized.overlapMessages ?? engine.overlapMessages,
            automationMode: mode,
            captureMode: normalizedTable.capturePolicy.mode
        };
    }

    function getAutomationMode(chat, templateId, table) {
        const effectiveTable = materializeEffectiveTable(chat, templateId, table);
        const state = ensureTableState(chat, templateId, table.id, { table: effectiveTable });
        if (effectiveTable?.capturePolicy && typeof effectiveTable.capturePolicy === 'object') return inferAutomationMode(effectiveTable);
        return normalizeAutomationMode(state.automationMode) || inferAutomationMode(effectiveTable);
    }

    function setAutomationMode(chat, templateId, table, mode) {
        const normalizedMode = normalizeAutomationMode(mode);
        if (!normalizedMode) throw new Error('无效的自动整理模式');
        const state = ensureTableState(chat, templateId, table.id, { table });
        state.automationMode = normalizedMode;
        if (table && typeof table === 'object') {
            const updatePolicy = normalizeUpdatePolicy(table.updatePolicy || {}, normalizeLayer(table.memoryLayer, table.name));
            table.capturePolicy = normalizedMode === 'sidecar'
                ? { mode: 'sidecar', frequencySource: 'table', apiMode: 'none' }
                : normalizedMode === 'engine'
                    ? { mode: 'scheduled', frequencySource: 'global', apiMode: updatePolicy.useSummaryApi === false ? 'main' : 'summary' }
                    : normalizedMode === 'table'
                        ? { mode: 'scheduled', frequencySource: 'table', apiMode: updatePolicy.useSummaryApi === false ? 'main' : 'summary' }
                        : { mode: 'manual', frequencySource: 'table', apiMode: updatePolicy.useSummaryApi === false ? 'main' : 'summary' };
        }
        state.lastRunStatus = state.lastRunStatus === 'failed' ? 'idle' : state.lastRunStatus;
        state.lastError = '';
        return state;
    }

    function isTableDue(chat, templateId, table) {
        const effectiveTable = materializeEffectiveTable(chat, templateId, table);
        const info = getUnprocessedInfo(chat, templateId, effectiveTable);
        const policy = resolveEffectiveUpdatePolicy(effectiveTable, info.runtime.engineSettings, info.tableState.automationMode);
        if (!info.runtime.engineSettings.enabled || !policy.enabled || !info.tableState.enabled || policy.triggerMode === 'manual') return false;
        if (info.tableState.pendingReviewBatchId) return false;
        const roundDue = policy.roundInterval > 0 && info.unsyncedRounds >= policy.roundInterval;
        const messageDue = policy.messageInterval > 0 && info.unsyncedMessages >= policy.messageInterval;
        if (policy.triggerMode === 'rounds') return roundDue;
        if (policy.triggerMode === 'messages') return messageDue;
        return roundDue || messageDue;
    }

    function getTableUpdateRange(chat, templateId, table, options) {
        const effectiveTable = materializeEffectiveTable(chat, templateId, table);
        const info = getUnprocessedInfo(chat, templateId, effectiveTable);
        const policy = resolveEffectiveUpdatePolicy(effectiveTable, info.runtime.engineSettings, info.tableState.automationMode);
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
        tableState.pendingReviewBatchId = null;
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
        state.pendingReviewBatchId = null;
        return state;
    }

    function clearRetrievalCache(chat) {
        const runtime = ensureRuntimeState(chat);
        runtime.retrievalCache = {};
        runtime.preparedSelections = {};
        runtime.preparedSelectionQuery = '';
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

    const api = {
        ENGINE_DEFAULTS,
        LAYER_DEFAULTS,
        normalizeLayer,
        inferSystemRole,
        normalizeSystemRole,
        normalizeCapturePolicy,
        normalizeCommitPolicy,
        normalizeUpdatePolicy,
        normalizeInjectionPolicy,
        normalizeTablePolicy,
        normalizeEngineSettings,
        normalizeAutomationMode,
        inferAutomationMode,
        ensureRuntimeState,
        ensureTableState,
        getAutomationMode,
        setAutomationMode,
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

    if (Kernel) Kernel.register('policy', api, { legacyGlobal: 'MemoryTablePolicy' });
    else window.MemoryTablePolicy = api;
})();
