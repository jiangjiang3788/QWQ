(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;

    const states = new Map();
    const metrics = {
        requested: 0,
        committed: 0,
        rolledBack: 0,
        skipped: 0,
        failed: 0,
        maxQueueDepth: 0
    };

    function clone(value) {
        return Core.clone ? Core.clone(value) : JSON.parse(JSON.stringify(value));
    }

    function characterKey(chat) {
        const id = String(chat?.id || '').trim();
        if (!id) throw new Error('记忆写入缺少角色 ID');
        return id;
    }

    function ensureState(chat) {
        const id = characterKey(chat);
        let state = states.get(id);
        if (!state) {
            state = { id, tail: Promise.resolve(), pending: 0, running: false, reason: '', lastError: '' };
            states.set(id, state);
        }
        return state;
    }

    function defaultCapture(chat) {
        return clone(chat.memoryTables || {});
    }

    function defaultRestore(chat, snapshot) {
        chat.memoryTables = clone(snapshot || {});
    }

    async function callWriter(writer, chat) {
        if (typeof writer !== 'function') return false;
        await writer(chat.id, chat);
        return true;
    }

    function shouldPersist(result, options) {
        if (options.persistNoop === true) return true;
        if (typeof options.shouldPersist === 'function') return options.shouldPersist(result) !== false;
        return result?.changed !== false && result?.status !== 'noop';
    }

    async function execute(chat, options, mutate) {
        const capture = typeof options.capture === 'function' ? options.capture : defaultCapture;
        const restore = typeof options.restore === 'function' ? options.restore : defaultRestore;
        const snapshot = options.snapshot === false ? null : capture(chat);
        const transactionId = options.transactionId || Core.createId('memory_write');
        let result;
        try {
            result = await mutate({ transactionId, chat, snapshot });
            const persist = shouldPersist(result, options);
            if (persist) {
                await callWriter(options.writer, chat);
                metrics.committed += 1;
            } else {
                metrics.skipped += 1;
            }
            if (typeof options.afterCommit === 'function') await options.afterCommit(result, { transactionId, chat });
            return {
                ...(result && typeof result === 'object' ? result : { value: result }),
                transactionId,
                persisted: persist && typeof options.writer === 'function',
                rollbackApplied: false
            };
        } catch (error) {
            metrics.failed += 1;
            if (snapshot !== null) {
                restore(chat, snapshot);
                metrics.rolledBack += 1;
                error.memoryRollbackApplied = true;
                if (options.persistRollback !== false) {
                    const rollbackWriter = options.rollbackWriter || options.writer;
                    try { await callWriter(rollbackWriter, chat); }
                    catch (rollbackError) {
                        error.memoryRollbackPersistError = rollbackError;
                        console.error('[MemoryWriteCoordinator] rollback persist failed:', rollbackError);
                    }
                }
            }
            if (typeof options.afterRollback === 'function') {
                try { await options.afterRollback(error, { transactionId, chat, snapshot }); }
                catch (hookError) { console.error('[MemoryWriteCoordinator] rollback hook failed:', hookError); }
            }
            throw error;
        }
    }

    function run(chat, options = {}, mutate) {
        if (!chat) return Promise.reject(new Error('记忆写入缺少角色上下文'));
        if (typeof mutate !== 'function') return Promise.reject(new Error('记忆写入缺少变更函数'));
        const state = ensureState(chat);
        metrics.requested += 1;
        state.pending += 1;
        state.reason = String(options.reason || 'memory-write');
        metrics.maxQueueDepth = Math.max(metrics.maxQueueDepth, state.pending);

        const task = state.tail.catch(() => {}).then(async () => {
            state.running = true;
            state.lastError = '';
            try {
                return await execute(chat, options, mutate);
            } catch (error) {
                state.lastError = String(error?.message || error || '未知错误');
                throw error;
            } finally {
                state.running = false;
                state.pending = Math.max(0, state.pending - 1);
                if (!state.pending) state.reason = '';
            }
        });
        state.tail = task.catch(() => {});
        return task;
    }

    async function flush(chatOrId) {
        const id = typeof chatOrId === 'object' ? characterKey(chatOrId) : String(chatOrId || '').trim();
        const state = states.get(id);
        if (!state) return { characterId: id, flushed: false };
        await state.tail.catch(() => {});
        return { characterId: id, flushed: true };
    }

    function getStatus(chatOrId) {
        const id = typeof chatOrId === 'object' ? String(chatOrId?.id || '') : String(chatOrId || '');
        const state = states.get(id);
        return state ? {
            characterId: id,
            running: state.running,
            pending: state.pending,
            reason: state.reason,
            lastError: state.lastError
        } : { characterId: id, running: false, pending: 0, reason: '', lastError: '' };
    }

    function getMetrics() {
        return { ...metrics, activeCharacters: states.size };
    }

    function resetMetrics() {
        Object.keys(metrics).forEach(key => { metrics[key] = 0; });
    }

    Kernel.register('writeCoordinator', Object.freeze({
        VERSION: '2.14-R2',
        run,
        flush,
        getStatus,
        getMetrics,
        resetMetrics,
        capture: defaultCapture,
        restore: defaultRestore
    }));
})(window);
