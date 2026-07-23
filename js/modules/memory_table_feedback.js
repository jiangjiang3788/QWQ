// 结构化记忆 V2.7：本轮使用快照、用户反馈闭环与召回权重学习
(function () {
    'use strict';

    const Kernel = window.OvoMemoryKernel || null;
    const Core = Kernel?.core;
    if (!Core) throw new Error('记忆内核未加载');
    const clone = Core.clone;
    const escapeHtml = Core.escapeHtml;
    const clamp = Core.clamp;
    const unique = (values, limit = 30) => Core.unique(values, limit);

    const VERSION = '2.7';
    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        maxRoundSnapshots: 60,
        maxEvents: 300,
        helpfulBoost: 0.06,
        irrelevantPenalty: 0.15,
        irrelevantCooldownRounds: 8,
        scenePenaltyStep: 0.05,
        maxPositiveWeight: 0.24,
        maxNegativeWeight: -0.45,
        archiveOnForget: true,
        pendingFeedbackTtlDays: 7,
        maxVisibleRounds: 12,
        maxPendingFeedbackRounds: 3
    });

    function normalizeSettings(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            enabled: source.enabled !== false,
            maxRoundSnapshots: Math.round(clamp(source.maxRoundSnapshots, DEFAULT_SETTINGS.maxRoundSnapshots, 5, 300)),
            maxEvents: Math.round(clamp(source.maxEvents, DEFAULT_SETTINGS.maxEvents, 20, 2000)),
            helpfulBoost: clamp(source.helpfulBoost, DEFAULT_SETTINGS.helpfulBoost, 0, 0.3),
            irrelevantPenalty: clamp(source.irrelevantPenalty, DEFAULT_SETTINGS.irrelevantPenalty, 0, 0.5),
            irrelevantCooldownRounds: Math.round(clamp(source.irrelevantCooldownRounds, DEFAULT_SETTINGS.irrelevantCooldownRounds, 0, 200)),
            scenePenaltyStep: clamp(source.scenePenaltyStep, DEFAULT_SETTINGS.scenePenaltyStep, 0, 0.25),
            maxPositiveWeight: clamp(source.maxPositiveWeight, DEFAULT_SETTINGS.maxPositiveWeight, 0, 0.6),
            maxNegativeWeight: clamp(source.maxNegativeWeight, DEFAULT_SETTINGS.maxNegativeWeight, -0.9, 0),
            archiveOnForget: source.archiveOnForget !== false,
            pendingFeedbackTtlDays: Math.round(clamp(source.pendingFeedbackTtlDays, DEFAULT_SETTINGS.pendingFeedbackTtlDays, 1, 90)),
            maxVisibleRounds: Math.round(clamp(source.maxVisibleRounds, DEFAULT_SETTINGS.maxVisibleRounds, 3, 60)),
            maxPendingFeedbackRounds: Math.round(clamp(source.maxPendingFeedbackRounds, DEFAULT_SETTINGS.maxPendingFeedbackRounds, 1, 10))
        };
    }

    function normalizeRowFeedback(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const sceneNegative = source.sceneNegative && typeof source.sceneNegative === 'object' ? source.sceneNegative : {};
        const cleanSceneNegative = {};
        Object.entries(sceneNegative).forEach(([scene, count]) => {
            const key = String(scene || '').trim();
            const number = Math.max(0, Number(count) || 0);
            if (key && number) cleanSceneNegative[key] = number;
        });
        return {
            helpfulCount: Math.max(0, Number(source.helpfulCount) || 0),
            irrelevantCount: Math.max(0, Number(source.irrelevantCount) || 0),
            outdatedCount: Math.max(0, Number(source.outdatedCount) || 0),
            inaccurateCount: Math.max(0, Number(source.inaccurateCount) || 0),
            sceneBlockedCount: Math.max(0, Number(source.sceneBlockedCount) || 0),
            pauseCount: Math.max(0, Number(source.pauseCount) || 0),
            forgetCount: Math.max(0, Number(source.forgetCount) || 0),
            weight: clamp(source.weight, 0, -0.9, 0.6),
            snoozedUntilRoundIndex: Number.isFinite(Number(source.snoozedUntilRoundIndex)) ? Number(source.snoozedUntilRoundIndex) : -1,
            sceneNegative: cleanSceneNegative,
            lastType: typeof source.lastType === 'string' ? source.lastType : '',
            lastAt: Number(source.lastAt) || 0,
            lastScene: typeof source.lastScene === 'string' ? source.lastScene : '',
            lastRoundId: typeof source.lastRoundId === 'string' ? source.lastRoundId : ''
        };
    }

    function ensureRowMeta(row) {
        if (!row || typeof row !== 'object') return null;
        row.meta ||= {};
        row.meta.feedback = normalizeRowFeedback(row.meta.feedback);
        row.meta.usage ||= {};
        if (!Number.isFinite(Number(row.meta.usage.helpfulCount))) row.meta.usage.helpfulCount = 0;
        if (!Number.isFinite(Number(row.meta.usage.correctionCount))) row.meta.usage.correctionCount = 0;
        return row.meta.feedback;
    }


    function expireStaleSnapshots(state, nowValue = Date.now()) {
        if (!state?.settings || !Array.isArray(state.rounds)) return 0;
        const ttlMs = Math.max(1, Number(state.settings.pendingFeedbackTtlDays) || DEFAULT_SETTINGS.pendingFeedbackTtlDays) * 86400000;
        const preparedTtlMs = 2 * 60 * 60 * 1000;
        const completedOpen = state.rounds
            .filter(snapshot => snapshot?.status === 'open' && snapshot.requestStatus === 'completed')
            .sort((a, b) => (Number(b.completedAt || b.createdAt) || 0) - (Number(a.completedAt || a.createdAt) || 0));
        const keepIds = new Set(completedOpen.slice(0, state.settings.maxPendingFeedbackRounds).map(snapshot => snapshot.id));
        let expired = 0;
        state.rounds.forEach(snapshot => {
            if (!snapshot || snapshot.status !== 'open') return;
            const createdAt = Number(snapshot.createdAt) || 0;
            let reason = '';
            if (snapshot.requestStatus === 'prepared' && createdAt && nowValue - createdAt >= preparedTtlMs) {
                reason = '请求未完成且已超过 2 小时';
                snapshot.requestStatus = 'abandoned';
            } else if (snapshot.requestStatus === 'completed' && !keepIds.has(snapshot.id)) {
                reason = `只保留最近 ${state.settings.maxPendingFeedbackRounds} 轮可反馈`;
            } else if (snapshot.requestStatus === 'completed' && createdAt && nowValue - createdAt >= ttlMs) {
                reason = `已超过 ${state.settings.pendingFeedbackTtlDays} 天有效期`;
            }
            if (!reason) return;
            snapshot.status = 'expired';
            snapshot.expiredAt = nowValue;
            snapshot.expiredReason = reason;
            (snapshot.items || []).forEach(item => {
                if (item.feedback === 'pending') {
                    item.feedback = 'expired';
                    item.feedbackAt = nowValue;
                }
            });
            expired += 1;
        });
        return expired;
    }

    function ensureState(chat) {
        if (!chat) return null;
        chat.memoryTables ||= {};
        let state = chat.memoryTables.feedback;
        if (!state || typeof state !== 'object') state = {};
        state.schemaVersion = VERSION;
        state.settings = normalizeSettings(state.settings);
        state.rounds = Array.isArray(state.rounds) ? state.rounds : [];
        state.events = Array.isArray(state.events) ? state.events : [];
        state.stats = state.stats && typeof state.stats === 'object' ? state.stats : {};
        expireStaleSnapshots(state);
        state.rounds = state.rounds.slice(-state.settings.maxRoundSnapshots);
        state.events = state.events.slice(-state.settings.maxEvents);
        state.stats.helpful = Math.max(0, Number(state.stats.helpful) || 0);
        state.stats.irrelevant = Math.max(0, Number(state.stats.irrelevant) || 0);
        state.stats.outdated = Math.max(0, Number(state.stats.outdated) || 0);
        state.stats.inaccurate = Math.max(0, Number(state.stats.inaccurate) || 0);
        state.stats.sceneBlocked = Math.max(0, Number(state.stats.sceneBlocked) || 0);
        state.stats.forgotten = Math.max(0, Number(state.stats.forgotten) || 0);
        chat.memoryTables.feedback = state;
        return state;
    }

    function getRuntime(chat) {
        return window.MemoryTablePolicy ? window.MemoryTablePolicy.ensureRuntimeState(chat) : (chat?.memoryTables || null);
    }

    function getRoundIndex(chat) {
        const rounds = getRuntime(chat)?.rounds;
        return Array.isArray(rounds) ? rounds.length : 0;
    }

    function getRoundRef(chat) {
        const runtime = getRuntime(chat);
        return runtime?.activeRound?.id || runtime?.lastRoundId || `memory_feedback_${Date.now()}`;
    }

    function getTemplateTable(templateId, tableId) {
        const template = window.db?.memoryTableTemplates?.find(item => item.id === templateId) || null;
        const table = template?.tables?.find(item => item.id === tableId) || null;
        return { template, table };
    }

    function findRow(chat, templateId, tableId, rowId) {
        const { template, table } = getTemplateTable(templateId, tableId);
        if (!chat || !template || !table) return { template, table, row: null };
        const rows = chat.memoryTables?.data?.[templateId]?.[tableId]?.__rows;
        const row = Array.isArray(rows) ? rows.find(item => item.id === rowId) : null;
        return { template, table, row };
    }

    function feedbackFingerprint(roundId, queryText, items) {
        const ids = (items || []).map(item => `${item.templateId}:${item.tableId}:${item.rowId}`).sort().join('|');
        return `${roundId}::${String(queryText || '').slice(0, 240)}::${ids}`;
    }

    function flattenDiagnostic(diagnostic) {
        const items = [];
        (diagnostic?.tables || []).forEach(group => {
            const keyParts = String(group.key || '').split('::');
            const templateId = keyParts[0] || '';
            const tableId = keyParts[1] || '';
            (group.selected || []).forEach(hit => {
                items.push({
                    id: `${templateId}::${tableId}::${hit.id}`,
                    templateId,
                    tableId,
                    rowId: hit.id,
                    templateName: group.templateName || '',
                    tableName: group.tableName || '',
                    text: String(hit.text || '').slice(0, 800),
                    score: Number(hit.score) || 0,
                    effectMode: hit.effectMode || '',
                    directive: hit.directive || '',
                    reasons: Array.isArray(hit.reasons) ? hit.reasons.slice(0, 12) : [],
                    tags: hit.tags || null,
                    feedback: 'pending',
                    feedbackAt: 0
                });
            });
        });
        return items;
    }

    function itemAppearsInFinalBlock(item, finalBlock) {
        const block = String(finalBlock || '');
        if (!block.trim()) return true;
        const values = String(item?.text || '')
            .split(/\n+/)
            .map(line => line.includes(':') ? line.split(':').slice(1).join(':').trim() : line.trim())
            .filter(value => value.length >= 3)
            .sort((a, b) => b.length - a.length);
        if (!values.length) return true;
        return values.some(value => {
            const probe = value.slice(0, Math.min(48, value.length));
            return probe.length >= 3 && block.includes(probe);
        });
    }

    function captureInjection(chat, diagnostic, options = {}) {
        const state = ensureState(chat);
        if (!state?.settings.enabled || !diagnostic) return null;
        const finalBlock = options.finalBlock ?? diagnostic.finalBlock ?? '';
        const items = flattenDiagnostic(diagnostic).filter(item => itemAppearsInFinalBlock(item, finalBlock));
        if (!items.length) return null;
        const roundId = options.roundId || getRoundRef(chat);
        const queryText = String(options.queryText || diagnostic.queryText || '');
        const fingerprint = feedbackFingerprint(roundId, queryText, items);
        const existing = state.rounds.find(item => item.fingerprint === fingerprint);
        if (existing) return existing;
        const snapshot = {
            id: `memory_feedback_round_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            roundId,
            fingerprint,
            createdAt: Date.now(),
            queryText: queryText.slice(0, 3000),
            queryContext: clone(diagnostic.queryContext || {}),
            actualMode: diagnostic.actualMode || 'keyword',
            finalChars: Number(diagnostic.finalChars) || 0,
            status: 'open',
            requestStatus: 'prepared',
            items
        };
        state.rounds.push(snapshot);
        state.rounds = state.rounds.slice(-state.settings.maxRoundSnapshots);
        try { window.dispatchEvent(new CustomEvent('memory-feedback-updated', { detail: { chatId: chat.id, snapshotId: snapshot.id } })); } catch (_) {}
        return snapshot;
    }


    function finalizeRound(chat, roundId) {
        const state = ensureState(chat);
        let changed = 0;
        (state?.rounds || []).forEach(snapshot => {
            if (snapshot.roundId === roundId && snapshot.requestStatus !== 'completed') {
                snapshot.requestStatus = 'completed';
                snapshot.completedAt = Date.now();
                changed += 1;
            }
        });
        return changed;
    }

    function discardRound(chat, roundId) {
        const state = ensureState(chat);
        const before = state?.rounds?.length || 0;
        state.rounds = (state?.rounds || []).filter(snapshot => snapshot.roundId !== roundId || snapshot.requestStatus === 'completed' || (snapshot.items || []).some(item => item.feedback !== 'pending'));
        return before - state.rounds.length;
    }

    function evaluateItem(chat, item, queryContext) {
        const feedback = ensureRowMeta(item?.row);
        if (!feedback) return { allowed: true, adjustment: 0, reasons: [], blockedReasons: [] };
        const settings = ensureState(chat)?.settings || DEFAULT_SETTINGS;
        const currentRound = getRoundIndex(chat);
        const blockedReasons = [];
        if (feedback.snoozedUntilRoundIndex > currentRound && !item?.pinned) {
            blockedReasons.push(`用户反馈冷却中，还需 ${feedback.snoozedUntilRoundIndex - currentRound} 轮`);
        }
        const currentScenes = unique(queryContext?.scene || []);
        let scenePenalty = 0;
        currentScenes.forEach(scene => {
            scenePenalty += Math.min(0.25, (Number(feedback.sceneNegative?.[scene]) || 0) * settings.scenePenaltyStep);
        });
        const adjustment = clamp(feedback.weight - scenePenalty, 0, -0.75, 0.45);
        const reasons = [];
        if (feedback.helpfulCount > 0) reasons.push(`用户标记有用 ${feedback.helpfulCount} 次`);
        if (feedback.irrelevantCount > 0) reasons.push(`用户标记无关 ${feedback.irrelevantCount} 次`);
        if (scenePenalty > 0) reasons.push(`当前场景负反馈 -${scenePenalty.toFixed(2)}`);
        if (adjustment > 0.005) reasons.push(`反馈加权 +${adjustment.toFixed(2)}`);
        if (adjustment < -0.005) reasons.push(`反馈降权 ${adjustment.toFixed(2)}`);
        return { allowed: blockedReasons.length === 0, adjustment, reasons, blockedReasons, feedback };
    }


    function adjustStatsForAction(state, action, delta) {
        const map = { helpful: 'helpful', irrelevant: 'irrelevant', outdated: 'outdated', inaccurate: 'inaccurate', block_scene: 'sceneBlocked', forget: 'forgotten' };
        const key = map[action];
        if (!key) return;
        state.stats[key] = Math.max(0, (Number(state.stats[key]) || 0) + delta);
    }

    function pushEvent(state, event) {
        state.events.push({
            id: `memory_feedback_event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            at: Date.now(),
            ...event
        });
        state.events = state.events.slice(-state.settings.maxEvents);
    }

    function markSnapshotItem(snapshot, itemId, action) {
        const item = snapshot?.items?.find(entry => entry.id === itemId);
        if (!item) return null;
        item.feedback = action;
        item.feedbackAt = Date.now();
        if ((snapshot.items || []).every(entry => entry.feedback !== 'pending')) snapshot.status = 'reviewed';
        return item;
    }

    function applyAction(chat, snapshotId, itemId, action) {
        const state = ensureState(chat);
        const snapshot = state?.rounds?.find(item => item.id === snapshotId);
        const snapshotItem = snapshot?.items?.find(item => item.id === itemId);
        if (!snapshot || !snapshotItem) return { changed: false, message: '找不到本轮记忆记录' };
        const found = findRow(chat, snapshotItem.templateId, snapshotItem.tableId, snapshotItem.rowId);
        if (!found.row) return { changed: false, message: '原记忆已不存在' };
        const row = found.row;
        if (snapshotItem.feedback !== 'pending' && action !== 'reset_item') {
            return { changed: false, message: '这条记忆已经反馈；先点击“重置此项”再重新选择' };
        }
        if (action === 'reset_item') {
            const eventIndex = [...state.events].map((event, index) => ({ event, index })).reverse().find(entry => entry.event.snapshotId === snapshotId && entry.event.itemId === itemId)?.index;
            if (!Number.isInteger(eventIndex)) return { changed: false, message: '找不到该项的反馈快照，无法重置' };
            const previousEvent = state.events[eventIndex];
            row.meta = clone(previousEvent.before?.rowMeta || {});
            Object.assign(snapshotItem, clone(previousEvent.before?.snapshotItem || {}));
            state.events.splice(eventIndex, 1);
            adjustStatsForAction(state, previousEvent.action, -1);
            snapshot.status = (snapshot.items || []).some(item => item.feedback === 'pending') ? 'open' : 'reviewed';
            if (window.MemoryTablePolicy) window.MemoryTablePolicy.clearRetrievalCache(chat);
            return { changed: true, message: '已重置该项反馈，可以重新选择', row, snapshot, snapshotItem };
        }
        const metaBefore = clone(row.meta || {});
        const itemBefore = clone(snapshotItem);
        const feedback = ensureRowMeta(row);
        const settings = state.settings;
        const scenes = unique(snapshot.queryContext?.scene || []);
        const primaryScene = scenes[0] || '日常聊天';
        const roundIndex = getRoundIndex(chat);
        const now = Date.now();
        let message = '';

        if (action === 'helpful') {
            feedback.helpfulCount += 1;
            feedback.weight = Math.min(settings.maxPositiveWeight, feedback.weight + settings.helpfulBoost);
            feedback.snoozedUntilRoundIndex = -1;
            row.meta.usage.helpfulCount = Math.max(0, Number(row.meta.usage.helpfulCount) || 0) + 1;
            state.stats.helpful += 1;
            message = '已提高这条记忆的召回权重';
        } else if (action === 'irrelevant') {
            feedback.irrelevantCount += 1;
            feedback.weight = Math.max(settings.maxNegativeWeight, feedback.weight - settings.irrelevantPenalty);
            feedback.snoozedUntilRoundIndex = Math.max(feedback.snoozedUntilRoundIndex, roundIndex + settings.irrelevantCooldownRounds);
            feedback.sceneNegative[primaryScene] = (Number(feedback.sceneNegative[primaryScene]) || 0) + 1;
            state.stats.irrelevant += 1;
            message = `已降权，并冷却 ${settings.irrelevantCooldownRounds} 轮`;
        } else if (action === 'outdated') {
            feedback.outdatedCount += 1;
            row.meta.lifecycle ||= {};
            row.meta.lifecycle.status = 'expired';
            row.meta.lifecycle.expiredAt = now;
            row.meta.lifecycle.statusReason = '用户反馈：内容已过时';
            row.meta.status = 'expired';
            row.meta.usePolicy ||= {};
            row.meta.usePolicy.injectionEnabled = false;
            state.stats.outdated += 1;
            message = '已标记过期并停止注入';
        } else if (action === 'inaccurate') {
            feedback.inaccurateCount += 1;
            row.meta.usage.correctionCount = Math.max(0, Number(row.meta.usage.correctionCount) || 0) + 1;
            row.meta.lifecycle ||= {};
            row.meta.lifecycle.status = 'uncertain';
            row.meta.lifecycle.statusReason = '用户反馈：内容不准确，等待修正';
            row.meta.status = 'uncertain';
            row.meta.confidence = Math.max(0, (Number(row.meta.confidence) || 70) - 25);
            row.meta.evidence ||= {};
            row.meta.evidence.userConfirmed = false;
            row.meta.usePolicy ||= {};
            row.meta.usePolicy.paused = true;
            state.stats.inaccurate += 1;
            message = '已暂停并标记为待修正';
        } else if (action === 'block_scene') {
            row.meta.usePolicy ||= {};
            row.meta.usePolicy.blockedScenes = unique([...(row.meta.usePolicy.blockedScenes || []), ...scenes], 20);
            feedback.sceneBlockedCount += 1;
            state.stats.sceneBlocked += 1;
            message = `已禁止在“${scenes.join('、') || '当前场景'}”使用`;
        } else if (action === 'no_proactive') {
            row.meta.usePolicy ||= {};
            row.meta.usePolicy.allowProactiveMention = false;
            if (row.meta.usePolicy.mentionPolicy === 'always_until_done') row.meta.usePolicy.mentionPolicy = 'relevant_only';
            message = '已禁止主动提及，只能在直接相关时参考';
        } else if (action === 'pause') {
            row.meta.usePolicy ||= {};
            row.meta.usePolicy.paused = true;
            feedback.pauseCount += 1;
            message = '已暂停这条记忆';
        } else if (action === 'forget') {
            feedback.forgetCount += 1;
            row.meta.usePolicy ||= {};
            row.meta.usePolicy.injectionEnabled = false;
            row.meta.usePolicy.paused = true;
            row.meta.lifecycle ||= {};
            row.meta.lifecycle.status = settings.archiveOnForget ? 'archived' : 'expired';
            row.meta.lifecycle.archivedAt = settings.archiveOnForget ? now : Number(row.meta.lifecycle.archivedAt) || 0;
            row.meta.lifecycle.expiredAt = settings.archiveOnForget ? Number(row.meta.lifecycle.expiredAt) || 0 : now;
            row.meta.lifecycle.statusReason = '用户要求忘记';
            row.meta.status = row.meta.lifecycle.status;
            state.stats.forgotten += 1;
            message = settings.archiveOnForget ? '已归档并停止使用' : '已标记过期并停止使用';
        } else if (action === 'reset_feedback') {
            row.meta.feedback = normalizeRowFeedback({});
            message = '已清除这条记忆的反馈权重';
        } else {
            return { changed: false, message: '不支持的反馈操作' };
        }

        const currentFeedback = ensureRowMeta(row);
        currentFeedback.lastType = action;
        currentFeedback.lastAt = now;
        currentFeedback.lastScene = primaryScene;
        currentFeedback.lastRoundId = snapshot.roundId || '';
        row.meta.updatedAt = now;
        row.meta.retrievalVector = [];
        row.meta.retrievalVectorFingerprint = '';
        row.meta.retrievalIndexedAt = 0;
        markSnapshotItem(snapshot, itemId, action);
        pushEvent(state, {
            snapshotId,
            itemId,
            action,
            templateId: snapshotItem.templateId,
            tableId: snapshotItem.tableId,
            rowId: snapshotItem.rowId,
            scene: primaryScene,
            before: { rowMeta: metaBefore, snapshotItem: itemBefore },
            after: { rowMeta: clone(row.meta), snapshotItem: clone(snapshotItem) }
        });
        if (window.MemoryTablePolicy) window.MemoryTablePolicy.clearRetrievalCache(chat);
        return { changed: true, message, row, snapshot, snapshotItem };
    }

    function undoLast(chat) {
        const state = ensureState(chat);
        const event = state?.events?.[state.events.length - 1];
        if (!event?.before) return { changed: false, message: '没有可撤销的反馈' };
        const found = findRow(chat, event.templateId, event.tableId, event.rowId);
        const snapshot = state.rounds.find(item => item.id === event.snapshotId);
        const snapshotItem = snapshot?.items?.find(item => item.id === event.itemId);
        if (!found.row || !snapshotItem) return { changed: false, message: '无法恢复：对应记录已变化或不存在' };
        found.row.meta = clone(event.before.rowMeta || {});
        Object.assign(snapshotItem, clone(event.before.snapshotItem || {}));
        state.events.pop();
        adjustStatsForAction(state, event.action, -1);
        if (snapshot && (snapshot.items || []).some(item => item.feedback === 'pending')) snapshot.status = 'open';
        if (window.MemoryTablePolicy) window.MemoryTablePolicy.clearRetrievalCache(chat);
        return { changed: true, message: '已撤销最近一次记忆反馈' };
    }

    function getPendingCount(chat) {
        const state = ensureState(chat);
        return (state?.rounds || []).reduce((total, round) => total + (round.items || []).filter(item => item.feedback === 'pending').length, 0);
    }

    function getStats(chat) {
        const state = ensureState(chat);
        const rows = state?.rounds || [];
        const allItems = rows.flatMap(item => item.items || []);
        return {
            rounds: rows.length,
            pending: allItems.filter(item => item.feedback === 'pending').length,
            reviewed: allItems.filter(item => item.feedback !== 'pending' && item.feedback !== 'expired').length,
            expired: allItems.filter(item => item.feedback === 'expired').length,
            expiredRounds: rows.filter(item => item.status === 'expired').length,
            ...state.stats
        };
    }

    function feedbackLabel(action) {
        return ({
            pending: '待反馈', expired: '反馈已过期', helpful: '有帮助', irrelevant: '无关', outdated: '已过时', inaccurate: '不准确',
            block_scene: '禁用当前场景', no_proactive: '不主动提及', pause: '已暂停', forget: '已忘记', reset_feedback: '已重置'
        })[action] || action;
    }

    function renderItem(snapshot, item) {
        const tags = [item.effectMode, ...(item.tags?.topic || []).slice(0, 2), ...(item.tags?.scene || []).slice(0, 1)].filter(Boolean);
        return `<article class="memory-feedback-item ${item.feedback !== 'pending' ? 'reviewed' : ''}">
            <div class="memory-feedback-item-head"><div><strong>${escapeHtml(item.tableName || '记忆条目')}</strong><span>${escapeHtml(item.templateName || '')}</span></div><b>${Number(item.score || 0).toFixed(2)}</b></div>
            <p>${escapeHtml(item.text || '')}</p>
            <div class="memory-feedback-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
            <div class="memory-feedback-reasons">${(item.reasons || []).slice(0, 5).map(reason => `<span>${escapeHtml(reason)}</span>`).join('')}</div>
            ${item.directive ? `<div class="memory-effect-directive">${escapeHtml(item.directive)}</div>` : ''}
            <div class="memory-feedback-actions">
                <span class="memory-feedback-result">${escapeHtml(feedbackLabel(item.feedback))}</span>
                ${item.feedback === 'pending' ? `
                <button class="btn btn-small btn-primary" data-feedback-action="helpful" data-snapshot-id="${escapeHtml(snapshot.id)}" data-feedback-item-id="${escapeHtml(item.id)}">有帮助</button>
                <button class="btn btn-small btn-secondary" data-feedback-action="irrelevant" data-snapshot-id="${escapeHtml(snapshot.id)}" data-feedback-item-id="${escapeHtml(item.id)}">无关</button>
                <button class="btn btn-small btn-secondary" data-feedback-action="outdated" data-snapshot-id="${escapeHtml(snapshot.id)}" data-feedback-item-id="${escapeHtml(item.id)}">已过时</button>
                <button class="btn btn-small btn-secondary" data-feedback-action="inaccurate" data-snapshot-id="${escapeHtml(snapshot.id)}" data-feedback-item-id="${escapeHtml(item.id)}">不准确</button>
                <button class="btn btn-small btn-neutral" data-feedback-action="block_scene" data-snapshot-id="${escapeHtml(snapshot.id)}" data-feedback-item-id="${escapeHtml(item.id)}">禁用当前场景</button>
                <button class="btn btn-small btn-neutral" data-feedback-action="no_proactive" data-snapshot-id="${escapeHtml(snapshot.id)}" data-feedback-item-id="${escapeHtml(item.id)}">不要主动提</button>
                <button class="btn btn-small btn-neutral" data-feedback-action="pause" data-snapshot-id="${escapeHtml(snapshot.id)}" data-feedback-item-id="${escapeHtml(item.id)}">暂停</button>
                <button class="btn btn-small btn-danger" data-feedback-action="forget" data-snapshot-id="${escapeHtml(snapshot.id)}" data-feedback-item-id="${escapeHtml(item.id)}">忘记</button>` : `<button class="btn btn-small btn-neutral" data-feedback-action="reset_item" data-snapshot-id="${escapeHtml(snapshot.id)}" data-feedback-item-id="${escapeHtml(item.id)}">重置此项</button>`}
            </div>
        </article>`;
    }

    function renderView(chat) {
        const state = ensureState(chat);
        const stats = getStats(chat);
        const completedRounds = [...(state?.rounds || [])].filter(item => item.requestStatus !== 'prepared').sort((a, b) => b.createdAt - a.createdAt);
        const expiredRounds = completedRounds.filter(item => item.status === 'expired');
        const rounds = completedRounds.filter(item => item.status !== 'expired').slice(0, state.settings.maxVisibleRounds);
        return `<div class="memory-feedback-page">
            <div class="memory-feedback-head">
                <div><h2>记忆使用反馈</h2><p>查看真正进入聊天 Prompt 的记忆，并把你的反馈直接用于后续召回、冷却、时效和场景策略。</p></div>
                <div class="memory-feedback-toolbar"><button class="btn btn-small btn-secondary" data-feedback-action="undo-last">撤销最近反馈</button><button class="btn btn-small btn-neutral" data-feedback-action="clear-reviewed-rounds">清理已反馈</button>${expiredRounds.length ? `<button class="btn btn-small btn-neutral" data-feedback-action="clear-expired-rounds">清理过期反馈（${expiredRounds.length}）</button>` : ''}</div>
            </div>
            <div class="memory-feedback-summary">
                <div><b>使用轮次</b><span>${stats.rounds}</span></div><div><b>待反馈</b><span>${stats.pending}</span></div><div><b>有帮助</b><span>${stats.helpful}</span></div><div><b>无关</b><span>${stats.irrelevant}</span></div><div><b>过时 / 不准确</b><span>${stats.outdated} / ${stats.inaccurate}</span></div><div><b>场景禁用</b><span>${stats.sceneBlocked}</span></div>
            </div>
            <div class="memory-feedback-settings">
                <label><span>无关后冷却轮数</span><input type="number" min="0" max="200" data-feedback-setting="irrelevantCooldownRounds" value="${state.settings.irrelevantCooldownRounds}"></label>
                <label><span>有用加权</span><input type="number" min="0" max="0.3" step="0.01" data-feedback-setting="helpfulBoost" value="${state.settings.helpfulBoost}"></label>
                <label><span>无关降权</span><input type="number" min="0" max="0.5" step="0.01" data-feedback-setting="irrelevantPenalty" value="${state.settings.irrelevantPenalty}"></label>
                <label><span>待反馈有效天数</span><input type="number" min="1" max="90" data-feedback-setting="pendingFeedbackTtlDays" value="${state.settings.pendingFeedbackTtlDays}"></label>
                <label><span>最多待反馈轮次</span><input type="number" min="1" max="10" data-feedback-setting="maxPendingFeedbackRounds" value="${state.settings.maxPendingFeedbackRounds}"></label>
                <label><span>页面显示轮次</span><input type="number" min="3" max="60" data-feedback-setting="maxVisibleRounds" value="${state.settings.maxVisibleRounds}"></label>
                <label><span>保留使用快照</span><input type="number" min="5" max="300" data-feedback-setting="maxRoundSnapshots" value="${state.settings.maxRoundSnapshots}"></label>
            </div>
            ${expiredRounds.length ? `<div class="memory-feedback-expired-note">已自动收起 ${expiredRounds.length} 个失效反馈请求（过旧、已有更新轮次或请求未完成）。它们不会再计入待处理，也不会影响原记忆内容。</div>` : ''}
            ${rounds.length ? rounds.map((snapshot, roundIndex) => `<section class="memory-feedback-round">
                <div class="memory-feedback-round-head"><div><h3>${roundIndex === 0 ? '最近一轮' : `历史轮次 ${roundIndex + 1}`}</h3><span>${new Date(snapshot.createdAt).toLocaleString()} · ${escapeHtml(snapshot.actualMode || '')} · ${(snapshot.items || []).length} 条</span></div><span>${snapshot.status === 'reviewed' ? '已反馈' : '待反馈'}</span></div>
                <details ${roundIndex === 0 ? 'open' : ''}><summary>检索上下文：${escapeHtml((snapshot.queryContext?.topic || []).join('、') || '未识别主题')} · ${escapeHtml((snapshot.queryContext?.scene || []).join('、') || '日常聊天')}</summary><pre>${escapeHtml(snapshot.queryText || '')}</pre></details>
                <div class="memory-feedback-items">${(snapshot.items || []).map(item => renderItem(snapshot, item)).join('')}</div>
            </section>`).join('') : '<div class="memory-review-empty"><p>还没有记忆使用快照。</p><p>完成一次使用结构化记忆的聊天后，这里会显示真正进入 Prompt 的条目。</p></div>'}
        </div>`;
    }

    function updateSettings(chat, patch) {
        const state = ensureState(chat);
        state.settings = normalizeSettings({ ...state.settings, ...(patch || {}) });
        state.rounds = state.rounds.slice(-state.settings.maxRoundSnapshots);
        state.events = state.events.slice(-state.settings.maxEvents);
        return state.settings;
    }

    function clearReviewedRounds(chat) {
        const state = ensureState(chat);
        const before = state.rounds.length;
        state.rounds = state.rounds.filter(item => item.status !== 'reviewed');
        return before - state.rounds.length;
    }

    function clearExpiredRounds(chat) {
        const state = ensureState(chat);
        const before = state.rounds.length;
        state.rounds = state.rounds.filter(item => item.status !== 'expired');
        return before - state.rounds.length;
    }


    function clearPendingTasks(chat) {
        const state = ensureState(chat);
        const removableIds = new Set();
        let pendingItems = 0;
        (state.rounds || []).forEach(round => {
            const pending = (round.items || []).filter(item => item.feedback === 'pending').length;
            if (pending || ['open', 'expired'].includes(round.status) || round.requestStatus === 'prepared') {
                removableIds.add(round.id);
                pendingItems += pending;
            }
        });
        if (!removableIds.size) return { rounds: 0, items: 0 };
        state.rounds = state.rounds.filter(round => !removableIds.has(round.id));
        state.events = state.events.filter(event => !removableIds.has(event.snapshotId));
        return { rounds: removableIds.size, items: pendingItems };
    }

    function getLastSnapshot(chat) {
        const state = ensureState(chat);
        return [...(state?.rounds || [])].reverse().find(item => item.requestStatus === 'completed') || null;
    }

    const api = {
        VERSION,
        ensureState,
        ensureRowMeta,
        normalizeRowFeedback,
        captureInjection,
        evaluateItem,
        applyAction,
        undoLast,
        getPendingCount,
        getStats,
        getLastSnapshot,
        finalizeRound,
        discardRound,
        renderView,
        updateSettings,
        clearReviewedRounds,
        clearExpiredRounds,
        clearPendingTasks,
        expireStaleSnapshots
    };

    if (Kernel) Kernel.register('feedback', api, { legacyGlobal: 'MemoryTableFeedback' });
    else window.MemoryTableFeedback = api;
})();
