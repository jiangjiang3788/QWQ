// OVO Operation Runtime - V2.10-R1
// 用户可见的 AI 操作追踪层：统一记录操作、阶段、模型请求与结果摘要。
(function (global) {
    'use strict';

    const STORAGE_KEY = 'ovo_operation_history_v1';
    const HISTORY_LIMIT = 100;
    const DETAIL_LIMIT = 12;
    const BODY_PREVIEW_LIMIT = 18000;
    const registry = new Map();
    const records = new Map();
    let orderedIds = [];

    const DEFAULT_OPERATIONS = [
        { type: 'chat.reply', title: '生成角色回复', category: '聊天', icon: '💬' },
        { type: 'chat.background', title: '生成后台回复', category: '聊天', icon: '🌙' },
        { type: 'chat.summary', title: '生成对话总结', category: '总结', icon: '📝' },
        { type: 'theater.generate', title: '生成小剧场', category: '小剧场', icon: '🎭' },
        { type: 'theater.character', title: '角色创作小剧场', category: '小剧场', icon: '🎭' },
        { type: 'memory.table.update', title: '更新结构化档案', category: '记忆', icon: '🗂️' },
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
        if (typeof value === 'string') return value.length > 12000 ? `${value.slice(0, 12000)}\n…（已截断）` : value;
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
                detail: { id: record?.id || '', reason: reason || 'update' }
            }));
        } catch (_) {}
    }

    function persist() {
        try {
            const list = orderedIds.slice(0, HISTORY_LIMIT).map((id, index) => {
                const item = safeClone(records.get(id));
                if (index >= DETAIL_LIMIT && Array.isArray(item?.requests)) {
                    item.requests = item.requests.map(request => ({
                        ...request,
                        bodyPreview: '',
                        promptTrace: request.promptTrace ? {
                            ...request.promptTrace,
                            sections: (request.promptTrace.sections || []).map(section => ({
                                ...section,
                                content: '',
                                items: (section.items || []).map(item => ({ ...item, content: '' }))
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
                records.set(item.id, item);
                orderedIds.push(item.id);
            });
        } catch (_) {}
    }

    function register(definition) {
        if (!definition || !definition.type) throw new Error('操作定义缺少 type');
        const current = registry.get(definition.type) || {};
        const next = { ...current, ...safeClone(definition) };
        registry.set(definition.type, next);
        return { ...next };
    }

    function start(type, options = {}) {
        const definition = registry.get(type) || registry.get('ai.request') || {};
        const now = new Date().toISOString();
        const record = {
            id: options.id || makeId('op'),
            schemaVersion: 2,
            type: type || 'ai.request',
            title: options.title || definition.title || '执行操作',
            category: options.category || definition.category || '其他',
            icon: options.icon || definition.icon || '✨',
            status: options.status || 'running',
            stage: options.stage || '正在准备',
            progress: Number.isFinite(options.progress) ? options.progress : null,
            source: options.source || '',
            parentId: options.parentId || null,
            scope: safeClone(options.scope || {}),
            summary: options.summary || '',
            result: safeClone(options.result || null),
            steps: [{ id: makeId('step'), title: options.stage || '开始操作', status: 'running', at: now }],
            requests: [],
            error: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            implicit: !!options.implicit
        };
        records.set(record.id, record);
        orderedIds = [record.id, ...orderedIds.filter(id => id !== record.id)].slice(0, HISTORY_LIMIT);
        persist();
        emit(record, 'start');
        return safeClone(record);
    }

    function getMutable(id) {
        return id ? records.get(id) || null : null;
    }

    function update(id, patch = {}, reason = 'update') {
        const record = getMutable(id);
        if (!record) return null;
        Object.keys(patch).forEach(key => {
            if (key === 'id' || key === 'createdAt') return;
            record[key] = safeClone(patch[key]);
        });
        record.updatedAt = new Date().toISOString();
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

    function complete(id, result = {}) {
        const record = getMutable(id);
        if (!record) return null;
        record.status = 'success';
        record.stage = result.stage || '操作完成';
        record.summary = result.summary || record.summary || '操作已完成';
        record.result = safeClone(result.result !== undefined ? result.result : result);
        record.error = null;
        record.progress = 100;
        finishSteps(record, 'success');
        persist();
        emit(record, 'complete');
        return safeClone(record);
    }

    function fail(id, error, result = {}) {
        const record = getMutable(id);
        if (!record) return null;
        const normalized = error instanceof Error
            ? { name: error.name, message: error.message, stack: String(error.stack || '').slice(0, 3000) }
            : { name: 'Error', message: String(error || '未知错误') };
        record.status = result.status || 'failed';
        record.stage = result.stage || '操作失败';
        record.summary = result.summary || normalized.message || '操作失败';
        record.error = normalized;
        finishSteps(record, record.status);
        persist();
        emit(record, 'fail');
        return safeClone(record);
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
        record.status = 'cancelled';
        record.stage = '操作已取消';
        record.summary = reason;
        finishSteps(record, 'cancelled');
        persist();
        emit(record, 'cancel');
        return cancelledRequests > 0 || true;
    }

    function get(id) {
        return safeClone(records.get(id) || null);
    }

    function list(options = {}) {
        const limit = Math.max(1, Math.min(Number(options.limit) || HISTORY_LIMIT, HISTORY_LIMIT));
        const status = options.status || '';
        return orderedIds.map(id => records.get(id)).filter(item => item && (!status || item.status === status)).slice(0, limit).map(item => safeClone(item));
    }

    function getActive() {
        return list({ limit: HISTORY_LIMIT }).filter(item => item.status === 'running' || item.status === 'queued');
    }

    function getCurrent() {
        return getActive()[0] || list({ limit: 1 })[0] || null;
    }

    function resolveOperationId(meta = {}) {
        const active = getActive();
        if (!active.length) return null;
        const source = String(meta.source || '').toLowerCase();
        const task = String(meta.task || '').toLowerCase();
        const match = active.find(item => {
            if (source.includes('memory') || task.includes('memory')) return item.type.startsWith('memory.');
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

    function clear(options = {}) {
        const keepActive = options.keepActive !== false;
        const activeIds = keepActive ? new Set(getActive().map(item => item.id)) : new Set();
        orderedIds.forEach(id => { if (!activeIds.has(id)) records.delete(id); });
        orderedIds = orderedIds.filter(id => activeIds.has(id));
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

    global.OVOOperationRegistry = { register, get: type => safeClone(registry.get(type) || null), list: () => Array.from(registry.values()).map(item => safeClone(item)) };
    global.OVOOperationRuntime = {
        VERSION: '2.10-R1',
        start, run, update, stage, attachRequest, updateRequest, complete, fail, cancel,
        get, list, getActive, getCurrent, resolveOperationId, clear, subscribe
    };
})(window);
