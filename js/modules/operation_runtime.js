// OVO Operation Runtime - V2.12-R2 productized operation history
// 用户可见的 AI 操作追踪层：统一记录主操作、后台子操作、模型请求与结果回执。
(function (global) {
    'use strict';

    const STORAGE_KEY = 'ovo_operation_history_v1';
    const HISTORY_LIMIT = 100;
    const DETAIL_LIMIT = 8;
    const BODY_PREVIEW_LIMIT = 120000;
    const MUTATION_LIMIT = 80;
    const MUTATION_TEXT_LIMIT = 4000;
    const STORAGE_BUDGET_CHARS = 900000;
    const REPORT_OPERATION_LIMIT = 100;
    let lastPersistStats = { chars: 0, budget: STORAGE_BUDGET_CHARS, records: 0, detailRecords: 0, compacted: false, dropped: 0 };
    const registry = new Map();
    const records = new Map();
    let orderedIds = [];

    const DEFAULT_OPERATIONS = [
        { type: 'chat.reply', title: '生成角色回复', category: '聊天', icon: '💬' },
        { type: 'chat.background', title: '生成后台回复', category: '聊天', icon: '🌙' },
        { type: 'chat.summary', title: '生成对话总结', category: '总结', icon: '📝' },
        { type: 'theater.generate', title: '生成小剧场', category: '小剧场', icon: '🎭' },
        { type: 'theater.character', title: '角色创作小剧场', category: '小剧场', icon: '🎭' },
        { type: 'memory.sidecar', title: '应用回复内档案更新', category: '记忆', icon: '🧩' },
        { type: 'memory.table.update', title: '更新结构化档案', category: '记忆', icon: '🗂️' },
        { type: 'memory.review.apply', title: '保存结构化档案审核结果', category: '记忆', icon: '✅' },
        { type: 'memory.merge.review', title: '审核并合并档案记忆', category: '记忆', icon: '🔀' },
        { type: 'memory.table.auto', title: '检查结构化档案更新', category: '后台工作', icon: '🗂️' },
        { type: 'journal.auto', title: '检查自动日记总结', category: '后台工作', icon: '📔' },
        { type: 'memory.vector.auto', title: '检查向量记忆总结', category: '后台工作', icon: '🧠' },
        { type: 'ai.request', title: '执行 AI 功能', category: '其他', icon: '✨' }
    ];

    function makeId(prefix) {
        return `${prefix || 'op'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function hideSensitiveKey(key) {
        return /(^|_)(api_?)?key$|token|authorization|secret|password/i.test(String(key || ''));
    }

    function redactSensitiveText(value) {
        return String(value == null ? '' : value)
            .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;\"']+/gi, '$1***')
            .replace(/([?&](?:api_?key|key|token|access_token|secret|password)=)[^&#\s]+/gi, '$1***')
            .replace(/(\b(?:api_?key|token|access_token|secret|password)\s*[:=]\s*)[^\s,;\"']+/gi, '$1***')
            .replace(/(\"(?:api_?key|key|token|access_token|authorization|secret|password)\"\s*:\s*\")[^\"]*(\")/gi, '$1***$2')
            .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-***')
            .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, 'AIza***');
    }

    function safeClone(value, depth = 0) {
        if (depth > 10) return '[已省略：层级过深]';
        if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const redacted = redactSensitiveText(value);
            return redacted.length > 80000 ? `${redacted.slice(0, 80000)}
…（内容超过 8 万字符，已截断）` : redacted;
        }
        if (typeof value === 'function') return '[函数]';
        if (value instanceof Error) return { name: value.name, message: redactSensitiveText(value.message), stack: redactSensitiveText(String(value.stack || '')).slice(0, 3000) };
        if (Array.isArray(value)) return value.slice(0, 120).map(item => safeClone(item, depth + 1));
        if (typeof value === 'object') {
            const output = {};
            Object.keys(value).slice(0, 160).forEach(key => {
                output[key] = hideSensitiveKey(key) ? '***' : safeClone(value[key], depth + 1);
            });
            return output;
        }
        return redactSensitiveText(String(value));
    }

    function mutationText(value) {
        if (value == null) return '';
        let text = typeof value === 'string' ? redactSensitiveText(value) : (() => { try { return JSON.stringify(safeClone(value), null, 2); } catch (_) { return redactSensitiveText(String(value)); } })();
        return text.length > MUTATION_TEXT_LIMIT ? `${text.slice(0, MUTATION_TEXT_LIMIT)}
…（变化内容超过 4000 字符，已截断）` : text;
    }

    function emptyMutationSummary() {
        return { total: 0, direct: 0, descendant: 0, created: 0, updated: 0, deleted: 0, pending: 0, other: 0, byEntity: {} };
    }

    function summarizeMutationList(items) {
        const summary = emptyMutationSummary();
        (Array.isArray(items) ? items : []).forEach(item => {
            summary.total += Math.max(1, Number(item.count) || 1);
            const action = String(item.action || '').toLowerCase();
            if (action === 'create') summary.created += Math.max(1, Number(item.count) || 1);
            else if (action === 'update' || action === 'accept') summary.updated += Math.max(1, Number(item.count) || 1);
            else if (action === 'delete') summary.deleted += Math.max(1, Number(item.count) || 1);
            else if (action === 'pending') summary.pending += Math.max(1, Number(item.count) || 1);
            else summary.other += Math.max(1, Number(item.count) || 1);
            const entityType = String(item.entityType || 'other');
            summary.byEntity[entityType] = (summary.byEntity[entityType] || 0) + Math.max(1, Number(item.count) || 1);
        });
        summary.direct = summary.total;
        return summary;
    }

    function createBodyPreview(body) {
        try {
            const safe = safeClone(body);
            const text = JSON.stringify(safe, null, 2);
            return {
                bodyPreview: text.length > BODY_PREVIEW_LIMIT ? `${text.slice(0, BODY_PREVIEW_LIMIT)}\n…（请求内容过长，已截断）` : text,
                bodyTruncated: text.length > BODY_PREVIEW_LIMIT,
                bodyChars: text.length
            };
        } catch (_) {
            return { bodyPreview: '[请求内容无法序列化]', bodyTruncated: true, bodyChars: 0 };
        }
    }

    function emit(record, reason) {
        try {
            global.dispatchEvent(new CustomEvent('ovo:operation-change', {
                detail: { id: record?.id || '', parentId: record?.parentId || '', reason: reason || 'update' }
            }));
        } catch (_) {}
    }

    function stripPromptTraceContent(trace, keepMetadata = true) {
        if (!trace || typeof trace !== 'object') return null;
        const copy = safeClone(trace);
        copy.sections = (copy.sections || []).map(section => ({
            ...(keepMetadata ? section : { id: section.id, type: section.type, title: section.title, state: section.state, sent: section.sent, chars: section.chars, count: section.count, fingerprint: section.fingerprint }),
            content: '',
            items: (section.items || []).map(entry => ({
                ...(keepMetadata ? entry : { id: entry.id, type: entry.type, title: entry.title, state: entry.state, sent: entry.sent, chars: entry.chars, fingerprint: entry.fingerprint }),
                content: ''
            }))
        }));
        return copy;
    }

    function compactRecordForStorage(record, index, level = 0) {
        const item = safeClone(record);
        const stripDetail = index >= DETAIL_LIMIT || level >= 1;
        if (stripDetail && Array.isArray(item?.mutations)) {
            item.mutations = item.mutations.map(mutation => ({ ...mutation, before: '', after: '', fields: [], meta: {} }));
        }
        if (stripDetail && Array.isArray(item?.requests)) {
            item.requests = item.requests.map(request => ({
                ...request,
                bodyPreview: '',
                promptTrace: stripPromptTraceContent(request.promptTrace, level < 2)
            }));
        }
        if (level >= 2) {
            item.result = null;
            item.steps = (item.steps || []).map(step => ({ ...step, detail: '' }));
            item.scope = {};
        }
        if (level >= 3) {
            item.requests = (item.requests || []).map(request => ({
                id: request.id, task: request.task, source: request.source, provider: request.provider, model: request.model,
                phase: request.phase, status: request.status, ok: request.ok, requestChars: request.requestChars,
                messageCount: request.messageCount, createdAt: request.createdAt, completedAt: request.completedAt,
                durationMs: request.durationMs, errorType: request.errorType, errorMessage: request.errorMessage
            }));
            item.mutations = [];
            item.steps = [];
        }
        return item;
    }

    function buildPersistPayload() {
        const ids = orderedIds.slice(0, HISTORY_LIMIT);
        let level = 0;
        let list = ids.map((id, index) => compactRecordForStorage(records.get(id), index, level)).filter(Boolean);
        let text = JSON.stringify(list);
        while (text.length > STORAGE_BUDGET_CHARS && level < 3) {
            level += 1;
            list = ids.map((id, index) => compactRecordForStorage(records.get(id), index, level)).filter(Boolean);
            text = JSON.stringify(list);
        }
        let dropped = 0;
        while (text.length > STORAGE_BUDGET_CHARS && list.length > 1) {
            const last = list[list.length - 1];
            if (last && ['running', 'queued'].includes(last.status)) break;
            list.pop();
            dropped += 1;
            text = JSON.stringify(list);
        }
        lastPersistStats = {
            chars: text.length,
            budget: STORAGE_BUDGET_CHARS,
            records: list.length,
            detailRecords: Math.min(DETAIL_LIMIT, list.length),
            compacted: ids.length > DETAIL_LIMIT || level > 0 || dropped > 0,
            compactLevel: level,
            dropped
        };
        return { list, text };
    }

    function persist() {
        try {
            const payload = buildPersistPayload();
            sessionStorage.setItem(STORAGE_KEY, payload.text);
        } catch (error) {
            console.warn('[OperationRuntime] 保存操作历史失败：', error);
        }
    }

    function load() {
        try {
            const list = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
            if (!Array.isArray(list)) return;
            list.slice(0, HISTORY_LIMIT).forEach(item => {
                if (!item || !item.id) return;
                if (item.status === 'running' || item.status === 'queued') {
                    item.status = 'interrupted';
                    item.stage = '页面刷新前尚未完成';
                    item.completedAt = item.completedAt || new Date().toISOString();
                }
                if (!Array.isArray(item.childIds)) item.childIds = [];
                if (!Array.isArray(item.mutations)) item.mutations = [];
                item.mutationSummary = item.mutationSummary || summarizeMutationList(item.mutations);
                records.set(item.id, item);
                orderedIds.push(item.id);
            });
            orderedIds.forEach(id => recalculateParent(id, false));
            const persistedText = sessionStorage.getItem(STORAGE_KEY) || '[]';
            lastPersistStats = { chars: persistedText.length, budget: STORAGE_BUDGET_CHARS, records: orderedIds.length, detailRecords: Math.min(DETAIL_LIMIT, orderedIds.length), compacted: orderedIds.length > DETAIL_LIMIT, compactLevel: 0, dropped: 0 };
        } catch (_) {}
    }

    function register(definition) {
        if (!definition || !definition.type) throw new Error('操作定义缺少 type');
        const current = registry.get(definition.type) || {};
        const next = { ...current, ...safeClone(definition) };
        registry.set(definition.type, next);
        return { ...next };
    }

    function getMutable(id) {
        return id ? records.get(id) || null : null;
    }

    function childRecords(parentId) {
        const parent = getMutable(parentId);
        const ids = Array.isArray(parent?.childIds) ? parent.childIds : [];
        return ids.map(id => getMutable(id)).filter(Boolean);
    }

    function buildBackgroundSummary(parentId) {
        const children = childRecords(parentId);
        const summary = {
            total: children.length,
            running: 0,
            queued: 0,
            success: 0,
            skipped: 0,
            failed: 0,
            cancelled: 0,
            interrupted: 0,
            settled: 0
        };
        children.forEach(child => {
            if (Object.prototype.hasOwnProperty.call(summary, child.status)) summary[child.status] += 1;
            if (!['running', 'queued'].includes(child.status)) summary.settled += 1;
        });
        summary.pending = summary.running + summary.queued;
        return summary;
    }

    function recalculateParent(parentId, shouldPersist = true) {
        const parent = getMutable(parentId);
        if (!parent) return null;
        parent.background = buildBackgroundSummary(parentId);
        const ownSummary = summarizeMutationList(parent.mutations || []);
        const descendantSummary = emptyMutationSummary();
        childRecords(parentId).forEach(child => {
            const childSummary = child.mutationSummary || summarizeMutationList(child.mutations || []);
            descendantSummary.total += Number(childSummary.total) || 0;
            descendantSummary.created += Number(childSummary.created) || 0;
            descendantSummary.updated += Number(childSummary.updated) || 0;
            descendantSummary.deleted += Number(childSummary.deleted) || 0;
            descendantSummary.pending += Number(childSummary.pending) || 0;
            descendantSummary.other += Number(childSummary.other) || 0;
            Object.entries(childSummary.byEntity || {}).forEach(([key, value]) => { descendantSummary.byEntity[key] = (descendantSummary.byEntity[key] || 0) + (Number(value) || 0); });
        });
        parent.mutationSummary = {
            total: ownSummary.total + descendantSummary.total,
            direct: ownSummary.total,
            descendant: descendantSummary.total,
            created: ownSummary.created + descendantSummary.created,
            updated: ownSummary.updated + descendantSummary.updated,
            deleted: ownSummary.deleted + descendantSummary.deleted,
            pending: ownSummary.pending + descendantSummary.pending,
            other: ownSummary.other + descendantSummary.other,
            byEntity: { ...ownSummary.byEntity }
        };
        Object.entries(descendantSummary.byEntity).forEach(([key, value]) => { parent.mutationSummary.byEntity[key] = (parent.mutationSummary.byEntity[key] || 0) + value; });
        parent.updatedAt = new Date().toISOString();
        if (parent.parentId) recalculateParent(parent.parentId, false);
        if (shouldPersist) persist();
        emit(parent, 'children-update');
        return parent.background;
    }

    function linkToParent(record) {
        if (!record?.parentId) return;
        const parent = getMutable(record.parentId);
        if (!parent) return;
        if (!Array.isArray(parent.childIds)) parent.childIds = [];
        if (!parent.childIds.includes(record.id)) parent.childIds.push(record.id);
        recalculateParent(parent.id, false);
    }

    function start(type, options = {}) {
        const definition = registry.get(type) || registry.get('ai.request') || {};
        const now = new Date().toISOString();
        const initialStatus = options.status || 'running';
        const record = {
            id: options.id || makeId('op'),
            schemaVersion: 4,
            type: type || 'ai.request',
            title: options.title || definition.title || '执行操作',
            category: options.category || definition.category || '其他',
            icon: options.icon || definition.icon || '✨',
            status: initialStatus,
            stage: options.stage || '正在准备',
            progress: Number.isFinite(options.progress) ? options.progress : null,
            source: options.source || '',
            parentId: options.parentId || null,
            childIds: [],
            background: { total: 0, running: 0, queued: 0, success: 0, skipped: 0, failed: 0, cancelled: 0, interrupted: 0, settled: 0, pending: 0 },
            scope: safeClone(options.scope || {}),
            summary: options.summary || '',
            result: safeClone(options.result || null),
            mutations: [],
            mutationSummary: emptyMutationSummary(),
            steps: [{ id: makeId('step'), title: options.stage || '开始操作', status: initialStatus, at: now }],
            requests: [],
            error: null,
            createdAt: now,
            updatedAt: now,
            completedAt: ['running', 'queued'].includes(initialStatus) ? null : now,
            implicit: !!options.implicit
        };
        records.set(record.id, record);
        orderedIds = [record.id, ...orderedIds.filter(id => id !== record.id)].slice(0, HISTORY_LIMIT);
        linkToParent(record);
        persist();
        emit(record, 'start');
        return safeClone(record);
    }

    function startChild(parentId, type, options = {}) {
        return start(type, { ...options, parentId: parentId || options.parentId || null });
    }

    function update(id, patch = {}, reason = 'update') {
        const record = getMutable(id);
        if (!record) return null;
        Object.keys(patch).forEach(key => {
            if (key === 'id' || key === 'createdAt' || key === 'childIds' || key === 'background') return;
            record[key] = safeClone(patch[key]);
        });
        record.updatedAt = new Date().toISOString();
        if (record.parentId) recalculateParent(record.parentId, false);
        persist();
        emit(record, reason);
        return safeClone(record);
    }

    function stage(id, title, details = {}) {
        const record = getMutable(id);
        if (!record) return null;
        const now = new Date().toISOString();
        const previous = record.steps[record.steps.length - 1];
        if (previous && previous.status === 'running') {
            previous.status = 'success';
            previous.completedAt = now;
        }
        record.stage = title || record.stage;
        if (Number.isFinite(details.progress)) record.progress = details.progress;
        record.steps.push({
            id: makeId('step'),
            title: title || '处理中',
            status: details.status || 'running',
            detail: details.detail || '',
            at: now
        });
        record.updatedAt = now;
        if (record.parentId) recalculateParent(record.parentId, false);
        persist();
        emit(record, 'stage');
        return safeClone(record);
    }

    function attachRequest(id, request = {}) {
        const record = getMutable(id);
        if (!record) return null;
        const preview = createBodyPreview(request.body);
        const promptTrace = global.OVOPromptTrace?.build
            ? global.OVOPromptTrace.build(request.body || {}, request.promptSources || [], {
                task: request.task || '',
                source: request.source || '',
                provider: request.provider || '',
                model: request.model || '',
                operationId: record.id,
                operationType: record.type || '',
                scope: record.scope || {}
            })
            : null;
        const entry = {
            id: request.id || makeId('req'),
            task: request.task || '',
            source: request.source || '',
            provider: request.provider || '',
            model: request.model || '',
            endpoint: redactSensitiveText(request.endpoint || ''),
            method: request.method || 'POST',
            phase: request.phase || 'created',
            status: request.status || 0,
            ok: false,
            requestChars: request.requestChars || preview.bodyChars,
            messageCount: request.messageCount || 0,
            systemMessageCount: request.systemMessageCount || 0,
            userMessageCount: request.userMessageCount || 0,
            bodyPreview: preview.bodyPreview,
            bodyTruncated: preview.bodyTruncated,
            bodyChars: preview.bodyChars,
            promptTrace: safeClone(promptTrace),
            createdAt: new Date().toISOString(),
            completedAt: null,
            durationMs: 0,
            errorType: '',
            errorMessage: ''
        };
        record.requests.push(entry);
        if (promptTrace?.summary) record.promptSummary = safeClone(promptTrace.summary);
        record.updatedAt = new Date().toISOString();
        persist();
        emit(record, 'request');
        return safeClone(entry);
    }

    function updateRequest(id, requestId, patch = {}) {
        const record = getMutable(id);
        if (!record) return null;
        const request = record.requests.find(item => item.id === requestId);
        if (!request) return null;
        Object.assign(request, safeClone(patch));
        record.updatedAt = new Date().toISOString();
        persist();
        emit(record, 'request-update');
        return safeClone(request);
    }

    function recordMutation(id, mutation = {}) {
        const record = getMutable(id);
        if (!record) return null;
        if (!Array.isArray(record.mutations)) record.mutations = [];
        const entry = {
            id: mutation.id || makeId('mut'),
            action: ['create', 'update', 'delete', 'accept', 'pending'].includes(String(mutation.action || '').toLowerCase()) ? String(mutation.action).toLowerCase() : 'other',
            entityType: mutation.entityType || 'other',
            entityId: mutation.entityId || '',
            title: mutation.title || '数据变化',
            summary: mutation.summary || '',
            status: mutation.status || 'committed',
            count: Math.max(1, Number(mutation.count) || 1),
            source: mutation.source || record.source || '',
            before: mutationText(mutation.before),
            after: mutationText(mutation.after),
            fields: safeClone(mutation.fields || []),
            meta: safeClone(mutation.meta || {}),
            at: mutation.at || new Date().toISOString()
        };
        record.mutations.unshift(entry);
        if (record.mutations.length > MUTATION_LIMIT) record.mutations = record.mutations.slice(0, MUTATION_LIMIT);
        record.mutationSummary = summarizeMutationList(record.mutations);
        record.updatedAt = new Date().toISOString();
        if (Array.isArray(record.childIds) && record.childIds.length) recalculateParent(record.id, false);
        else if (record.parentId) recalculateParent(record.parentId, false);
        persist();
        emit(record, 'mutation');
        return safeClone(entry);
    }

    function recordMutations(id, mutations = []) {
        const output = [];
        (Array.isArray(mutations) ? mutations : []).slice(0, MUTATION_LIMIT).forEach(item => {
            const saved = recordMutation(id, item);
            if (saved) output.push(saved);
        });
        return output;
    }

    function finishSteps(record, finalStatus) {
        const now = new Date().toISOString();
        const previous = record.steps[record.steps.length - 1];
        if (previous && previous.status === 'running') {
            previous.status = finalStatus === 'success' ? 'success' : finalStatus;
            previous.completedAt = now;
        }
        record.completedAt = now;
        record.updatedAt = now;
    }

    function finalizeRecord(record, status, result = {}) {
        record.status = status;
        record.stage = result.stage || (status === 'success' ? '操作完成' : status === 'skipped' ? '本次未执行' : '操作结束');
        record.summary = result.summary || record.summary || record.stage;
        record.result = safeClone(result.result !== undefined ? result.result : result);
        record.progress = ['success', 'skipped'].includes(status) ? 100 : record.progress;
        if (status !== 'failed') record.error = null;
        finishSteps(record, status);
        if (record.parentId) recalculateParent(record.parentId, false);
        persist();
        emit(record, status);
        return safeClone(record);
    }

    function complete(id, result = {}) {
        const record = getMutable(id);
        if (!record) return null;
        return finalizeRecord(record, 'success', result);
    }

    function skip(id, reason = '本次未达到执行条件', result = {}) {
        const record = getMutable(id);
        if (!record) return null;
        return finalizeRecord(record, 'skipped', {
            stage: result.stage || '本次未执行',
            summary: reason,
            result: result.result !== undefined ? result.result : result
        });
    }

    function fail(id, error, result = {}) {
        const record = getMutable(id);
        if (!record) return null;
        const normalized = error instanceof Error
            ? { name: error.name, message: error.message, stack: String(error.stack || '').slice(0, 3000) }
            : { name: 'Error', message: String(error || '未知错误') };
        record.error = normalized;
        return finalizeRecord(record, result.status || 'failed', {
            stage: result.stage || '操作失败',
            summary: result.summary || normalized.message || '操作失败',
            result: result.result !== undefined ? result.result : result
        });
    }

    function cancel(id, reason = '用户取消') {
        const record = getMutable(id);
        if (!record) return false;
        let cancelledRequests = 0;
        if (global.OVOAIRequestRuntime && Array.isArray(record.requests)) {
            record.requests.forEach(request => {
                if (global.OVOAIRequestRuntime.cancelRequest?.(request.id)) cancelledRequests += 1;
            });
        }
        finalizeRecord(record, 'cancelled', { stage: '操作已取消', summary: reason, result: { cancelledRequests } });
        return cancelledRequests > 0 || true;
    }

    function get(id) {
        return safeClone(records.get(id) || null);
    }

    function getChildren(parentId, options = {}) {
        const children = childRecords(parentId);
        const recursive = !!options.recursive;
        const output = [];
        children.forEach(child => {
            output.push(safeClone(child));
            if (recursive) output.push(...getChildren(child.id, { recursive: true }));
        });
        return output;
    }

    function normalizedFilterSet(value) {
        if (Array.isArray(value)) return new Set(value.map(item => String(item || '').trim()).filter(Boolean));
        const text = String(value || '').trim();
        return new Set(text ? text.split(',').map(item => item.trim()).filter(Boolean) : []);
    }

    function operationSearchText(item) {
        return [item?.title, item?.category, item?.type, item?.stage, item?.summary, item?.source,
            item?.scope?.characterName, item?.scope?.chatName,
            ...(item?.requests || []).flatMap(request => [request.task, request.source, request.provider, request.model, request.errorMessage])
        ].filter(Boolean).join(' ').toLowerCase();
    }

    function list(options = {}) {
        const limit = Math.max(1, Math.min(Number(options.limit) || HISTORY_LIMIT, HISTORY_LIMIT));
        const statuses = normalizedFilterSet(options.status || options.statuses);
        const types = normalizedFilterSet(options.type || options.types);
        const categories = normalizedFilterSet(options.category || options.categories);
        const rootsOnly = !!options.rootsOnly;
        const query = String(options.query || '').trim().toLowerCase();
        const from = options.from ? new Date(options.from).getTime() : 0;
        const to = options.to ? new Date(options.to).getTime() : 0;
        return orderedIds
            .map(id => records.get(id))
            .filter(item => {
                if (!item || (rootsOnly && item.parentId)) return false;
                if (statuses.size && !statuses.has(String(item.status || ''))) return false;
                if (types.size && !types.has(String(item.type || ''))) return false;
                if (categories.size && !categories.has(String(item.category || ''))) return false;
                const at = new Date(item.createdAt || 0).getTime();
                if (from && (!Number.isFinite(at) || at < from)) return false;
                if (to && (!Number.isFinite(at) || at > to)) return false;
                if (query && !operationSearchText(item).includes(query)) return false;
                return true;
            })
            .slice(0, limit)
            .map(item => safeClone(item));
    }

    function getFacets(options = {}) {
        const items = list({ ...options, limit: HISTORY_LIMIT });
        const countBy = key => items.reduce((map, item) => {
            const value = String(item?.[key] || '未分类');
            map[value] = (map[value] || 0) + 1;
            return map;
        }, {});
        return { total: items.length, statuses: countBy('status'), categories: countBy('category'), types: countBy('type') };
    }

    function getStorageStats() {
        let chars = lastPersistStats.chars || 0;
        try { chars = (sessionStorage.getItem(STORAGE_KEY) || '').length; } catch (_) {}
        return safeClone({ ...lastPersistStats, chars, usageRatio: STORAGE_BUDGET_CHARS ? chars / STORAGE_BUDGET_CHARS : 0, inMemoryRecords: orderedIds.length });
    }

    function getActive() {
        return list({ limit: HISTORY_LIMIT }).filter(item => item.status === 'running' || item.status === 'queued');
    }

    function getCurrent() {
        const activeRoots = getActive().filter(item => !item.parentId);
        return activeRoots[0] || list({ limit: HISTORY_LIMIT, rootsOnly: true })[0] || getActive()[0] || list({ limit: 1 })[0] || null;
    }

    function resolveOperationId(meta = {}) {
        if (meta.parentId && records.has(meta.parentId)) return meta.parentId;
        const active = getActive();
        if (!active.length) return null;
        const source = String(meta.source || '').toLowerCase();
        const task = String(meta.task || '').toLowerCase();
        const capability = global.OVOAICapabilityCatalog?.resolve?.(meta) || null;
        const exact = capability?.type && capability.type !== 'ai.request'
            ? active.find(item => item.type === capability.type)
            : null;
        if (exact) return exact.id;
        const match = active.find(item => {
            if (source.includes('memory') || task.includes('memory') || task.includes('embedding') || task.includes('vector')) return item.type.startsWith('memory.');
            if (source.includes('journal') || task.includes('journal')) return item.type.startsWith('journal.');
            if (source.includes('theater') || task.includes('theater')) return item.type.startsWith('theater.');
            if (source.includes('video-call') || source.includes('call-summary') || task.includes('call')) return item.type.startsWith('call.');
            if (source.includes('avatar') || source.includes('sticker') || task.includes('recognition') || task.includes('description')) return item.type.startsWith('vision.');
            if (task.includes('image-generation') || source.includes('generate') && source.includes('image')) return item.type.startsWith('image.generate.');
            if (source.includes('battery') || task.includes('battery')) return item.type.startsWith('interaction.');
            if (source.includes('block') || task.includes('block')) return item.type.startsWith('safety.');
            if (source.includes('chat') || task.includes('chat') || task === 'summary') return item.type.startsWith('chat.');
            return false;
        });
        return match?.id || null;
    }

    async function run(type, options = {}, executor) {
        if (typeof executor !== 'function') throw new Error('操作执行器必须是函数');
        const record = start(type, options);
        try {
            const result = await executor(record);
            const summary = typeof options.getSummary === 'function'
                ? options.getSummary(result)
                : (options.successSummary || `${record.title}已完成`);
            complete(record.id, { summary, result });
            return result;
        } catch (error) {
            fail(record.id, error);
            throw error;
        }
    }

    async function runChild(parentId, type, options = {}, executor) {
        return run(type, { ...options, parentId }, executor);
    }

    function reportSource(section, mode) {
        const base = {
            id: section?.id || '', type: section?.type || 'other', title: section?.title || '', state: section?.state || '',
            sent: section?.sent !== false, evidence: section?.evidence || '', chars: Number(section?.chars) || 0,
            count: Number(section?.count) || 0, reason: section?.reason || '', fingerprint: section?.fingerprint || ''
        };
        if (mode === 'detailed' || mode === 'advanced') {
            base.content = section?.content || '';
            base.items = (section?.items || []).map(item => reportSource(item, mode));
        }
        if (mode === 'advanced') base.metadata = safeClone(section?.metadata || {});
        return safeClone(base);
    }

    function reportRequest(request, mode) {
        const output = {
            id: request?.id || '', task: request?.task || '', source: request?.source || '', provider: request?.provider || '',
            model: request?.model || '', phase: request?.phase || '', ok: !!request?.ok, status: Number(request?.status) || 0,
            requestChars: Number(request?.requestChars || request?.bodyChars) || 0, messageCount: Number(request?.messageCount) || 0,
            durationMs: Number(request?.durationMs) || 0, errorType: request?.errorType || '', errorMessage: request?.errorMessage || '',
            promptSummary: safeClone(request?.promptTrace?.summary || null),
            sources: (request?.promptTrace?.sections || []).filter(section => !section?.metadata?.verificationView).map(section => reportSource(section, mode))
        };
        if (mode === 'advanced') {
            output.endpoint = request?.endpoint || '';
            output.method = request?.method || 'POST';
            output.bodyPreview = request?.bodyPreview || '';
            output.bodyTruncated = !!request?.bodyTruncated;
        }
        return safeClone(output);
    }

    function buildOperationReport(id, options = {}) {
        const mode = ['simple', 'detailed', 'advanced'].includes(options.mode) ? options.mode : 'simple';
        const record = records.get(id);
        if (!record) return null;
        const output = {
            reportProtocol: 'ovo.operation-report.v1', generatedAt: new Date().toISOString(), mode,
            operation: {
                id: record.id, type: record.type, title: record.title, category: record.category, status: record.status,
                stage: record.stage, summary: record.summary, source: record.source, parentId: record.parentId,
                createdAt: record.createdAt, updatedAt: record.updatedAt, completedAt: record.completedAt,
                scope: safeClone(record.scope || {}), background: safeClone(record.background || {}),
                mutationSummary: safeClone(record.mutationSummary || emptyMutationSummary()),
                steps: safeClone((record.steps || []).map(step => mode === 'simple' ? { title: step.title, status: step.status, at: step.at } : step)),
                mutations: safeClone((record.mutations || []).map(mutation => mode === 'simple'
                    ? { action: mutation.action, entityType: mutation.entityType, entityId: mutation.entityId, title: mutation.title, summary: mutation.summary, status: mutation.status, count: mutation.count, at: mutation.at }
                    : mutation)),
                requests: (record.requests || []).map(request => reportRequest(request, mode))
            }
        };
        if (mode === 'advanced') {
            output.operation.result = safeClone(record.result);
            output.operation.error = safeClone(record.error);
        } else if (record.error) {
            output.operation.error = { name: record.error.name || 'Error', message: redactSensitiveText(record.error.message || '') };
        }
        if (options.includeChildren !== false) {
            output.children = childRecords(id).map(child => buildOperationReport(child.id, { ...options, includeChildren: true })).filter(Boolean);
        }
        return safeClone(output);
    }

    function reportMarkdown(report, depth = 0) {
        if (!report?.operation) return '';
        const op = report.operation;
        const prefix = '#'.repeat(Math.min(6, depth + 1));
        const lines = [
            `${prefix} ${op.title || 'AI 操作报告'}`, '',
            `- 状态：${op.status || 'unknown'}`, `- 类型：${op.type || 'unknown'}`, `- 分类：${op.category || '其他'}`,
            `- 开始：${op.createdAt || ''}`, `- 完成：${op.completedAt || '未完成'}`, `- 摘要：${op.summary || op.stage || '无'}`,
            `- 模型请求：${(op.requests || []).length} 次`, `- 数据变化：${op.mutationSummary?.total || 0} 项`, ''
        ];
        if (op.steps?.length) lines.push(`${prefix}# 执行阶段`, '', ...op.steps.map(step => `- ${step.status || ''} · ${step.title || ''}`), '');
        if (op.mutations?.length) lines.push(`${prefix}# 数据变化`, '', ...op.mutations.map(item => `- ${item.title || item.entityType || '变化'}：${item.summary || item.action || ''}`), '');
        (op.requests || []).forEach((request, index) => {
            lines.push(`${prefix}# 请求 ${index + 1}：${request.model || request.task || 'AI 请求'}`, '',
                `- Provider：${request.provider || ''}`, `- 来源：${request.source || ''}`, `- 字符数：${request.requestChars || 0}`,
                `- 耗时：${request.durationMs || 0}ms`, `- 结果：${request.ok ? '成功' : (request.errorMessage || '未完成')}`, '');
            if (request.sources?.length) lines.push('来源：', ...request.sources.map(source => `- ${source.title || source.type} · ${source.state || ''} · ${source.chars || 0} 字符`), '');
            if (request.bodyPreview) lines.push('```json', request.bodyPreview, '```', '');
        });
        (report.children || []).forEach(child => lines.push(reportMarkdown(child, depth + 1)));
        return lines.join('\n');
    }

    function exportReport(id, options = {}) {
        const report = buildOperationReport(id, options);
        if (!report) return '';
        return options.format === 'json' ? JSON.stringify(report, null, 2) : reportMarkdown(report);
    }

    function exportHistory(options = {}) {
        const mode = ['simple', 'detailed', 'advanced'].includes(options.mode) ? options.mode : 'simple';
        const items = list({ ...options, limit: Math.min(Number(options.limit) || REPORT_OPERATION_LIMIT, REPORT_OPERATION_LIMIT) });
        const bundle = {
            reportProtocol: 'ovo.operation-history-report.v1', generatedAt: new Date().toISOString(), mode,
            filters: safeClone({ query: options.query || '', status: options.status || '', category: options.category || '', type: options.type || '', rootsOnly: !!options.rootsOnly }),
            storage: getStorageStats(),
            operations: items.map(item => buildOperationReport(item.id, { mode, includeChildren: options.includeChildren !== false })).filter(Boolean)
        };
        if (options.format === 'json') return JSON.stringify(bundle, null, 2);
        return [`# AI 操作历史报告`, '', `生成时间：${bundle.generatedAt}`, `操作数量：${bundle.operations.length}`, '', ...bundle.operations.map(report => reportMarkdown(report))].join('\n');
    }

    function clear(options = {}) {
        const keepActive = options.keepActive !== false;
        const keepIds = keepActive ? new Set(getActive().map(item => item.id)) : new Set();
        // 活跃后台任务仍需保留父操作，否则悬浮球会失去任务归属。
        Array.from(keepIds).forEach(id => {
            let current = getMutable(id);
            while (current?.parentId && records.has(current.parentId)) {
                keepIds.add(current.parentId);
                current = getMutable(current.parentId);
            }
        });
        orderedIds.forEach(id => { if (!keepIds.has(id)) records.delete(id); });
        orderedIds = orderedIds.filter(id => keepIds.has(id));
        keepIds.forEach(id => recalculateParent(id, false));
        persist();
        emit(null, 'clear');
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        const handler = event => listener(event.detail || {});
        global.addEventListener('ovo:operation-change', handler);
        return () => global.removeEventListener('ovo:operation-change', handler);
    }

    DEFAULT_OPERATIONS.forEach(register);
    global.OVOAICapabilityCatalog?.list?.().forEach(register);
    load();

    global.OVOOperationRegistry = {
        register,
        get: type => safeClone(registry.get(type) || null),
        list: () => Array.from(registry.values()).map(item => safeClone(item))
    };
    global.OVOOperationRuntime = {
        VERSION: '2.12-R2',
        start, startChild, run, runChild, update, stage, attachRequest, updateRequest, recordMutation, recordMutations,
        complete, skip, fail, cancel, get, getChildren, list, getFacets, getStorageStats, getActive, getCurrent,
        buildOperationReport, exportReport, exportHistory, redactSensitiveText,
        resolveOperationId, recalculateParent, clear, subscribe
    };
})(window);
