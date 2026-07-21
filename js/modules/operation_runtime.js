// OVO Operation Runtime - V2.10-R3.1 quick hotfix
// 用户可见的 AI 操作追踪层：统一记录主操作、后台子操作、模型请求与结果回执。
(function (global) {
    'use strict';

    const STORAGE_KEY = 'ovo_operation_history_v1';
    const HISTORY_LIMIT = 100;
    const DETAIL_LIMIT = 8;
    const BODY_PREVIEW_LIMIT = 120000;
    const MUTATION_LIMIT = 80;
    const MUTATION_TEXT_LIMIT = 4000;
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

    function safeClone(value, depth = 0) {
        if (depth > 10) return '[已省略：层级过深]';
        if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
        if (typeof value === 'string') return value.length > 80000 ? `${value.slice(0, 80000)}\n…（内容超过 8 万字符，已截断）` : value;
        if (typeof value === 'function') return '[函数]';
        if (value instanceof Error) return { name: value.name, message: value.message, stack: String(value.stack || '').slice(0, 3000) };
        if (Array.isArray(value)) return value.slice(0, 120).map(item => safeClone(item, depth + 1));
        if (typeof value === 'object') {
            const output = {};
            Object.keys(value).slice(0, 160).forEach(key => {
                output[key] = hideSensitiveKey(key) ? '***' : safeClone(value[key], depth + 1);
            });
            return output;
        }
        return String(value);
    }

    function mutationText(value) {
        if (value == null) return '';
        let text = typeof value === 'string' ? value : (() => { try { return JSON.stringify(safeClone(value), null, 2); } catch (_) { return String(value); } })();
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

    function persist() {
        try {
            const list = orderedIds.slice(0, HISTORY_LIMIT).map((id, index) => {
                const item = safeClone(records.get(id));
                if (index >= DETAIL_LIMIT && Array.isArray(item?.mutations)) {
                    item.mutations = item.mutations.map(mutation => ({ ...mutation, before: '', after: '', fields: [], meta: {} }));
                }
                if (index >= DETAIL_LIMIT && Array.isArray(item?.requests)) {
                    item.requests = item.requests.map(request => ({
                        ...request,
                        bodyPreview: '',
                        promptTrace: request.promptTrace ? {
                            ...request.promptTrace,
                            sections: (request.promptTrace.sections || []).map(section => ({
                                ...section,
                                content: '',
                                items: (section.items || []).map(entry => ({ ...entry, content: '' }))
                            }))
                        } : null
                    }));
                }
                return item;
            }).filter(Boolean);
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list));
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
            schemaVersion: 3,
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
                model: request.model || ''
            })
            : null;
        const entry = {
            id: request.id || makeId('req'),
            task: request.task || '',
            source: request.source || '',
            provider: request.provider || '',
            model: request.model || '',
            endpoint: request.endpoint || '',
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

    function list(options = {}) {
        const limit = Math.max(1, Math.min(Number(options.limit) || HISTORY_LIMIT, HISTORY_LIMIT));
        const status = options.status || '';
        const rootsOnly = !!options.rootsOnly;
        return orderedIds
            .map(id => records.get(id))
            .filter(item => item && (!status || item.status === status) && (!rootsOnly || !item.parentId))
            .slice(0, limit)
            .map(item => safeClone(item));
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
        const match = active.find(item => {
            if (source.includes('memory') || task.includes('memory')) return item.type.startsWith('memory.');
            if (source.includes('journal') || task.includes('journal')) return item.type.startsWith('journal.');
            if (source.includes('theater') || task.includes('theater')) return item.type.startsWith('theater.');
            if (source.includes('chat') || task.includes('chat') || task.includes('summary')) return item.type.startsWith('chat.');
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
    load();

    global.OVOOperationRegistry = {
        register,
        get: type => safeClone(registry.get(type) || null),
        list: () => Array.from(registry.values()).map(item => safeClone(item))
    };
    global.OVOOperationRuntime = {
        VERSION: '2.10-R3.1',
        start, startChild, run, runChild, update, stage, attachRequest, updateRequest, recordMutation, recordMutations,
        complete, skip, fail, cancel, get, getChildren, list, getActive, getCurrent,
        resolveOperationId, recalculateParent, clear, subscribe
    };
})(window);
