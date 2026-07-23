(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');

    const MAX_ENTRIES = 32;
    const revisions = new Map();
    const entries = new Map();
    const metrics = { hits: 0, misses: 0, invalidations: 0, evictions: 0, stamps: 0 };

    function normalizePart(value, fallback) {
        const text = String(value || fallback || '').trim();
        return text.replace(/[^a-zA-Z0-9_:\-.]/g, '_').slice(0, 220);
    }

    function scopeKey(chatOrId, templateId, tableId) {
        const chatId = typeof chatOrId === 'object' ? chatOrId?.id : chatOrId;
        return [normalizePart(chatId, 'chat'), normalizePart(templateId, 'template'), normalizePart(tableId, 'table')].join('::');
    }

    function getRevision(chatOrId, templateId, tableId) {
        return revisions.get(scopeKey(chatOrId, templateId, tableId)) || 0;
    }

    function deleteScope(scope) {
        const prefix = `${scope}::`;
        Array.from(entries.keys()).forEach(key => {
            if (key.startsWith(prefix)) entries.delete(key);
        });
    }

    function touch(chatOrId, templateId, tableId, reason = 'mutation') {
        const scope = scopeKey(chatOrId, templateId, tableId);
        const next = (revisions.get(scope) || 0) + 1;
        revisions.set(scope, next);
        deleteScope(scope);
        metrics.invalidations += 1;
        return { scope, revision: next, reason: String(reason || 'mutation') };
    }

    function touchChat(chatOrId, reason = 'chat-mutation') {
        const chatId = normalizePart(typeof chatOrId === 'object' ? chatOrId?.id : chatOrId, 'chat');
        const prefix = `${chatId}::`;
        Array.from(revisions.keys()).forEach(scope => {
            if (scope.startsWith(prefix)) revisions.set(scope, (revisions.get(scope) || 0) + 1);
        });
        Array.from(entries.keys()).forEach(key => {
            if (key.startsWith(prefix)) entries.delete(key);
        });
        metrics.invalidations += 1;
        return { chatId, reason: String(reason || 'chat-mutation') };
    }

    function fnvMix(hash, value) {
        const text = String(value == null ? '' : value);
        let next = hash >>> 0;
        for (let index = 0; index < text.length; index += 1) {
            next ^= text.charCodeAt(index);
            next = Math.imul(next, 16777619) >>> 0;
        }
        return next >>> 0;
    }

    function rowsStamp(chat, templateId, table, rows) {
        const list = Array.isArray(rows) ? rows : [];
        let hash = 2166136261;
        list.forEach((row, index) => {
            const meta = row?.meta || {};
            hash = fnvMix(hash, index);
            hash = fnvMix(hash, row?.id || '');
            hash = fnvMix(hash, meta.updatedAt || meta.lastMentionedAt || 0);
            hash = fnvMix(hash, meta.lifecycle?.status || meta.status || '');
            hash = fnvMix(hash, meta.pinned === true ? 1 : 0);
            hash = fnvMix(hash, meta.tagLocked === true ? 1 : 0);
            const bundle = meta.tagBundle || {};
            hash = fnvMix(hash, (bundle.topic || []).join('|'));
            hash = fnvMix(hash, (bundle.scene || []).join('|'));
            hash = fnvMix(hash, (bundle.entity || []).join('|'));
        });
        const historyHead = chat?.memoryTables?.history?.[0];
        metrics.stamps += 1;
        return [
            getRevision(chat, templateId, table?.id),
            list.length,
            hash.toString(16),
            historyHead?.id || historyHead?.timestamp || ''
        ].join(':');
    }

    function keyValueStamp(chat, templateId, tableId) {
        const historyHead = chat?.memoryTables?.history?.[0];
        const locks = chat?.memoryTables?.lockedFields?.[templateId]?.[tableId] || [];
        metrics.stamps += 1;
        return [getRevision(chat, templateId, tableId), historyHead?.id || historyHead?.timestamp || '', locks.length].join(':');
    }

    function memo(scope, signature, factory) {
        const key = `${scope}::${String(signature || '')}`;
        if (entries.has(key)) {
            const value = entries.get(key);
            entries.delete(key);
            entries.set(key, value);
            metrics.hits += 1;
            return value;
        }
        const value = factory();
        entries.set(key, value);
        metrics.misses += 1;
        while (entries.size > MAX_ENTRIES) {
            entries.delete(entries.keys().next().value);
            metrics.evictions += 1;
        }
        return value;
    }

    function clear() {
        revisions.clear();
        entries.clear();
    }

    function getMetrics() {
        return { ...metrics, entries: entries.size, scopes: revisions.size };
    }

    function resetMetrics() {
        Object.keys(metrics).forEach(key => { metrics[key] = 0; });
    }

    Kernel.register('tableCache', Object.freeze({
        VERSION: '2.11-R7',
        MAX_ENTRIES,
        scopeKey,
        getRevision,
        touch,
        touchChat,
        rowsStamp,
        keyValueStamp,
        memo,
        clear,
        getMetrics,
        resetMetrics
    }));
})(window);
