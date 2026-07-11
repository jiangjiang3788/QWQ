// OVO AI Request Runtime - Phase 3 (V15.9)
// 统一 AI 请求传输、并发/取消/超时控制与只读诊断；不修改 Prompt、响应解析或 API 页面。
(function () {
    'use strict';

    const activeRequests = new Map();
    const pendingQueue = [];
    const recentDedupe = new Map();
    const MAX_ACTIVE = 6;
    const HISTORY_LIMIT = 30;

    function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
    function safeSize(value) { try { return JSON.stringify(value).length; } catch (_) { return 0; } }
    function sanitizeEndpoint(endpoint) {
        try {
            const url = new URL(String(endpoint || ''), window.location.href);
            ['key', 'api_key', 'apikey', 'token', 'access_token', 'authorization'].forEach(name => {
                if (url.searchParams.has(name)) url.searchParams.set(name, '***');
            });
            return `${url.origin}${url.pathname}${url.search}`;
        } catch (_) {
            return String(endpoint || '').replace(/([?&](?:key|api_key|apikey|token|access_token|authorization)=)[^&]+/gi, '$1***');
        }
    }
    function defaultTimeoutMs(opts, body) {
        if (Number.isFinite(opts.timeoutMs)) return Math.max(0, opts.timeoutMs);
        const task = String(opts.task || '').toLowerCase();
        const stream = !!(body && body.stream);
        if (task.includes('embedding')) return 60000;
        if (task.includes('image')) return 180000;
        if (stream) return 300000;
        return 180000;
    }
    function classifyError(error, status, timedOut, cancelReason) {
        if (timedOut) return 'timeout';
        if (error && error.name === 'AbortError') return cancelReason === 'user' ? 'aborted' : 'aborted';
        if (status === 401 || status === 403) return 'auth';
        if (status === 404) return 'endpoint';
        if (status === 408 || status === 504) return 'timeout';
        if (status === 409) return 'conflict';
        if (status === 429) return 'rate_limit';
        if (status >= 500) return 'server';
        if (status >= 400) return 'request';
        return 'network';
    }
    function saveDiagnostic(record) {
        try {
            const snapshot = { ...record };
            window.__ovoLastAIRequestDiagnostic = snapshot;
            sessionStorage.setItem('ovo_last_ai_request_diagnostic', JSON.stringify(snapshot));
            const key = 'ovo_ai_request_diagnostic_history';
            let history = [];
            try { history = JSON.parse(sessionStorage.getItem(key) || '[]'); } catch (_) { history = []; }
            if (!Array.isArray(history)) history = [];
            const index = history.findIndex(item => item && item.id === snapshot.id);
            if (index >= 0) history.splice(index, 1);
            history.unshift(snapshot);
            sessionStorage.setItem(key, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
        } catch (_) {}
    }
    function finalize(record, started, patch) {
        Object.assign(record, patch || {});
        record.durationMs = Math.max(0, Math.round(nowMs() - started));
        record.completedAt = new Date().toISOString();
        saveDiagnostic(record);
    }
    function mergeSignals(externalSignal, timeoutMs, state) {
        const controller = new AbortController();
        let timer = null;
        const abortExternal = () => { state.cancelReason = 'external'; try { controller.abort(); } catch (_) {} };
        if (externalSignal) {
            if (externalSignal.aborted) abortExternal();
            else externalSignal.addEventListener('abort', abortExternal, { once: true });
        }
        if (timeoutMs > 0) timer = setTimeout(() => {
            state.timedOut = true;
            state.cancelReason = 'timeout';
            try { controller.abort(); } catch (_) {}
        }, timeoutMs);
        return {
            signal: controller.signal,
            controller,
            cleanup: () => {
                if (timer) clearTimeout(timer);
                if (externalSignal) { try { externalSignal.removeEventListener('abort', abortExternal); } catch (_) {} }
            }
        };
    }
    function releaseSlot(id) {
        activeRequests.delete(id);
        while (pendingQueue.length && activeRequests.size < MAX_ACTIVE) {
            const next = pendingQueue.shift();
            if (next.cancelled) continue;
            next.start();
        }
    }
    function acquireSlot(record) {
        if (activeRequests.size < MAX_ACTIVE) return Promise.resolve(0);
        const queuedAt = nowMs();
        return new Promise((resolve, reject) => {
            const item = {
                id: record.id,
                cancelled: false,
                start: () => resolve(Math.max(0, Math.round(nowMs() - queuedAt))),
                reject
            };
            pendingQueue.push(item);
            record.phase = 'queued';
            record.queuePosition = pendingQueue.length;
            saveDiagnostic(record);
        });
    }
    function createTrackedStream(response, record, started, bundle, state) {
        if (!response.body || typeof ReadableStream === 'undefined') {
            finalize(record, started, { phase: 'headers_received', ok: true });
            bundle.cleanup();
            releaseSlot(record.id);
            return response;
        }
        const reader = response.body.getReader();
        let responseBytes = 0;
        let firstChunkAt = 0;
        const stream = new ReadableStream({
            async pull(controller) {
                try {
                    const result = await reader.read();
                    if (result.done) {
                        finalize(record, started, {
                            phase: 'completed', ok: true, responseBytes,
                            firstByteMs: firstChunkAt ? Math.round(firstChunkAt - started) : 0
                        });
                        bundle.cleanup(); releaseSlot(record.id); controller.close(); return;
                    }
                    if (!firstChunkAt) firstChunkAt = nowMs();
                    responseBytes += result.value ? result.value.byteLength : 0;
                    controller.enqueue(result.value);
                } catch (error) {
                    finalize(record, started, {
                        phase: 'failed', ok: false,
                        errorType: classifyError(error, record.status, state.timedOut, state.cancelReason),
                        errorMessage: String(error && error.message ? error.message : error || '流读取失败').slice(0, 800),
                        cancelReason: state.cancelReason || ''
                    });
                    bundle.cleanup(); releaseSlot(record.id); controller.error(error);
                }
            },
            cancel(reason) {
                state.cancelReason = 'consumer';
                try { reader.cancel(reason); } catch (_) {}
                try { bundle.controller.abort(); } catch (_) {}
                finalize(record, started, { phase: 'cancelled', ok: false, errorType: 'aborted', errorMessage: '响应流被消费端取消', cancelReason: 'consumer' });
                bundle.cleanup(); releaseSlot(record.id);
            }
        });
        return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
    }

    async function request(options) {
        const opts = options || {};
        const body = opts.body || {};
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const startedAt = new Date();
        const started = nowMs();
        const timeoutMs = defaultTimeoutMs(opts, body);
        const dedupeKey = String(opts.dedupeKey || '');
        const dedupeWindowMs = Number.isFinite(opts.dedupeWindowMs) ? Math.max(0, opts.dedupeWindowMs) : 1200;

        if (dedupeKey) {
            const previous = recentDedupe.get(dedupeKey) || 0;
            if (Date.now() - previous < dedupeWindowMs) {
                const err = new Error('重复请求已阻止'); err.ovoType = 'duplicate'; throw err;
            }
            recentDedupe.set(dedupeKey, Date.now());
        }

        const record = {
            id: `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            task: opts.task || 'chat', source: opts.source || '',
            capturedAt: startedAt.toISOString(), provider: opts.provider || 'openai-compatible',
            model: opts.model || body.model || '', stream: !!body.stream,
            endpointType: opts.endpointType || (opts.provider === 'gemini' ? 'gemini' : 'openai-compatible'),
            endpoint: sanitizeEndpoint(opts.endpoint), method: opts.method || 'POST',
            messageCount: messages.length,
            systemMessageCount: messages.filter(item => item && item.role === 'system').length,
            userMessageCount: messages.filter(item => item && item.role === 'user').length,
            requestChars: safeSize(body), timeoutMs, attempt: Number.isFinite(opts.attempt) ? opts.attempt : 1,
            status: 0, ok: false, phase: 'created', queueWaitMs: 0, activeAtStart: activeRequests.size,
            durationMs: 0, firstByteMs: 0, responseBytes: 0, responseType: '',
            errorType: '', errorMessage: '', cancelReason: ''
        };
        saveDiagnostic(record);
        record.queueWaitMs = await acquireSlot(record);
        record.phase = 'sending';

        const state = { timedOut: false, cancelReason: '' };
        const bundle = mergeSignals(opts.signal, timeoutMs, state);
        activeRequests.set(record.id, { controller: bundle.controller, record, state });
        saveDiagnostic(record);
        try {
            const fetchOptions = {
                method: opts.method || 'POST', headers: opts.headers || {}, signal: bundle.signal
            };
            if (opts.body !== undefined && fetchOptions.method !== 'GET' && fetchOptions.method !== 'HEAD') {
                fetchOptions.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(body);
            }
            const response = await fetch(opts.endpoint, fetchOptions);
            record.status = response.status;
            record.responseType = response.headers.get('content-type') || '';
            record.phase = 'headers_received';
            if (!response.ok) {
                let detail = '';
                try { detail = await response.clone().text(); } catch (_) {}
                detail = String(detail || '').slice(0, 800);
                const type = classifyError(null, response.status, false, '');
                finalize(record, started, { ok: false, phase: 'failed', errorType: type, errorMessage: detail || `HTTP ${response.status}` });
                const error = new Error(`API Error: ${response.status} ${detail}`.trim());
                error.response = response; error.ovoType = type; throw error;
            }
            if (record.stream || record.responseType.includes('text/event-stream') || record.responseType.includes('application/x-ndjson')) {
                record.ok = true; saveDiagnostic(record);
                return createTrackedStream(response, record, started, bundle, state);
            }
            finalize(record, started, { ok: true, phase: 'headers_received' });
            bundle.cleanup(); releaseSlot(record.id);
            return response;
        } catch (error) {
            if (record.phase !== 'failed') {
                const type = classifyError(error, record.status, state.timedOut, state.cancelReason);
                finalize(record, started, {
                    ok: false, phase: type === 'aborted' ? 'cancelled' : 'failed', errorType: type,
                    errorMessage: String(error && error.message ? error.message : error || '未知错误').slice(0, 800),
                    cancelReason: state.cancelReason || ''
                });
            }
            bundle.cleanup(); releaseSlot(record.id); throw error;
        }
    }

    function getRecentDiagnostics() {
        try { const list = JSON.parse(sessionStorage.getItem('ovo_ai_request_diagnostic_history') || '[]'); return Array.isArray(list) ? list : []; }
        catch (_) { return []; }
    }
    function getLastDiagnostic() {
        if (window.__ovoLastAIRequestDiagnostic) return window.__ovoLastAIRequestDiagnostic;
        try { return JSON.parse(sessionStorage.getItem('ovo_last_ai_request_diagnostic') || 'null'); } catch (_) { return null; }
    }
    function clearDiagnostics() {
        try { delete window.__ovoLastAIRequestDiagnostic; sessionStorage.removeItem('ovo_last_ai_request_diagnostic'); sessionStorage.removeItem('ovo_ai_request_diagnostic_history'); } catch (_) {}
    }
    function getActiveRequests() { return Array.from(activeRequests.values()).map(item => ({ ...item.record })); }
    function getQueueState() { return { active: activeRequests.size, queued: pendingQueue.filter(item => !item.cancelled).length, maxActive: MAX_ACTIVE }; }
    function cancelRequest(id) {
        const item = activeRequests.get(id);
        if (item) { item.state.cancelReason = 'user'; try { item.controller.abort(); return true; } catch (_) { return false; } }
        const queued = pendingQueue.find(entry => entry.id === id && !entry.cancelled);
        if (queued) { queued.cancelled = true; queued.reject(new DOMException('Queued request cancelled', 'AbortError')); return true; }
        return false;
    }
    function cancelAll() {
        let count = 0;
        activeRequests.forEach(item => { item.state.cancelReason = 'user'; try { item.controller.abort(); count += 1; } catch (_) {} });
        pendingQueue.forEach(item => { if (!item.cancelled) { item.cancelled = true; try { item.reject(new DOMException('Queued request cancelled', 'AbortError')); } catch (_) {} count += 1; } });
        return count;
    }

    window.OVOAIRequestRuntime = {
        request, getLastDiagnostic, getRecentDiagnostics, clearDiagnostics,
        getActiveRequests, getQueueState, cancelRequest, cancelAll
    };
})();
