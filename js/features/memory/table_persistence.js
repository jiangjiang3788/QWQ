(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');

    const states = new Map();
    const metrics = { requests: 0, writes: 0, coalesced: 0, failures: 0, flushes: 0, maxWaiters: 0 };

    function ensure(characterId) {
        const id = String(characterId || '').trim();
        if (!id) throw new Error('缺少角色 ID');
        let state = states.get(id);
        if (!state) {
            state = { id, timer: 0, running: false, pending: false, writer: null, waiters: [], reasons: new Set(), status: 'idle' };
            states.set(id, state);
        }
        return state;
    }

    function settle(waiters, error, value) {
        waiters.forEach(waiter => error ? waiter.reject(error) : waiter.resolve(value));
    }

    async function run(state) {
        if (state.running) {
            state.pending = true;
            return;
        }
        if (!state.waiters.length || typeof state.writer !== 'function') return;
        if (state.timer) {
            global.clearTimeout(state.timer);
            state.timer = 0;
        }
        state.running = true;
        state.status = 'saving';
        const waiters = state.waiters.splice(0);
        const reasons = Array.from(state.reasons);
        state.reasons.clear();
        const writer = state.writer;
        try {
            await writer(state.id);
            metrics.writes += 1;
            metrics.coalesced += Math.max(0, waiters.length - 1);
            settle(waiters, null, { characterId: state.id, reasons, writes: 1 });
        } catch (error) {
            metrics.failures += 1;
            settle(waiters, error);
        } finally {
            state.running = false;
            state.status = state.waiters.length || state.pending ? 'pending' : 'idle';
            const rerun = state.pending || state.waiters.length > 0;
            state.pending = false;
            if (rerun) (global.queueMicrotask || (callback => Promise.resolve().then(callback)))(() => run(state));
        }
    }

    function schedule(characterId, writer, options = {}) {
        const state = ensure(characterId);
        if (typeof writer !== 'function') return Promise.reject(new Error('缺少保存函数'));
        state.writer = writer;
        state.reasons.add(String(options.reason || 'memory-table'));
        metrics.requests += 1;
        const promise = new Promise((resolve, reject) => state.waiters.push({ resolve, reject }));
        metrics.maxWaiters = Math.max(metrics.maxWaiters, state.waiters.length);
        if (state.running) {
            state.pending = true;
            state.status = 'pending';
            return promise;
        }
        const delay = Math.max(0, Number(options.delay) || 0);
        if (state.timer) global.clearTimeout(state.timer);
        state.status = delay > 0 ? 'pending' : 'saving';
        state.timer = global.setTimeout(() => {
            state.timer = 0;
            run(state);
        }, delay);
        return promise;
    }

    async function flush(characterId) {
        const state = states.get(String(characterId || '').trim());
        if (!state) return { characterId, flushed: false };
        metrics.flushes += 1;
        if (state.timer) {
            global.clearTimeout(state.timer);
            state.timer = 0;
        }
        if (state.running) {
            state.pending = true;
            await new Promise(resolve => {
                const poll = () => state.running || state.waiters.length ? global.setTimeout(poll, 5) : resolve();
                poll();
            });
            return { characterId: state.id, flushed: true };
        }
        await run(state);
        return { characterId: state.id, flushed: true };
    }

    function saveNow(characterId, writer, options = {}) {
        const promise = schedule(characterId, writer, { ...options, delay: 0 });
        flush(characterId).catch(() => {});
        return promise;
    }

    function getStatus(characterId) {
        const state = states.get(String(characterId || '').trim());
        return state ? { status: state.status, running: state.running, pending: state.waiters.length, reasons: Array.from(state.reasons) } : { status: 'idle', running: false, pending: 0, reasons: [] };
    }

    function hasPending() {
        return Array.from(states.values()).some(state => state.running || state.waiters.length > 0 || state.timer);
    }

    async function flushAll() {
        const ids = Array.from(states.keys());
        if (!ids.length) return [];
        return Promise.all(ids.map(id => flush(id)));
    }

    if (global.document?.addEventListener) {
        global.document.addEventListener('visibilitychange', () => {
            if (global.document.visibilityState !== 'hidden' || !hasPending()) return;
            flushAll().catch(() => {});
        });
    }
    if (global.addEventListener) {
        global.addEventListener('beforeunload', event => {
            if (!hasPending()) return;
            event.preventDefault();
            event.returnValue = '记忆表格数据正在保存，请稍候再关闭页面。';
        });
    }

    function getMetrics() {
        return { ...metrics, activeCharacters: states.size };
    }

    function resetMetrics() {
        Object.keys(metrics).forEach(key => { metrics[key] = 0; });
    }

    Kernel.register('tablePersistence', Object.freeze({
        VERSION: '2.11-R7',
        schedule,
        saveNow,
        flush,
        flushAll,
        hasPending,
        getStatus,
        getMetrics,
        resetMetrics
    }));
})(window);
