(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const VERSION = '2.14-R4';
    const STATE_VERSION = '2.14-R4';

    function makeKey(templateId, tableId, rowId) {
        return `${String(templateId || '')}::${String(tableId || '')}::${String(rowId || '')}`;
    }

    function splitGroupKey(groupKey) {
        const [templateId = '', tableId = ''] = String(groupKey || '').split('::');
        return { templateId, tableId };
    }

    function normalizeUsage(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            retrievalCount: Math.max(0, Number(source.retrievalCount) || 0),
            injectionCount: Math.max(0, Number(source.injectionCount) || 0),
            lastRetrievedAt: Number(source.lastRetrievedAt) || 0,
            lastInjectedAt: Number(source.lastInjectedAt) || 0,
            lastInjectedRoundIndex: Number.isFinite(Number(source.lastInjectedRoundIndex)) ? Number(source.lastInjectedRoundIndex) : -999999
        };
    }

    function normalizeIndexEntry(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            fingerprint: String(source.fingerprint || ''),
            vector: Array.isArray(source.vector) ? source.vector.map(value => Number(value) || 0) : [],
            indexedAt: Number(source.indexedAt) || 0,
            source: String(source.source || 'runtime_index')
        };
    }

    function getStateSnapshot(chat) {
        const source = chat?.memoryTables?.retrievalRuntime;
        const state = source && typeof source === 'object' ? source : {};
        const index = {};
        const usage = {};
        Object.entries(state.index || {}).forEach(([key, entry]) => { index[key] = normalizeIndexEntry(entry); });
        Object.entries(state.usage || {}).forEach(([key, entry]) => { usage[key] = normalizeUsage(entry); });
        return {
            schemaVersion: STATE_VERSION,
            index,
            usage,
            lastUsageEventKey: String(state.lastUsageEventKey || ''),
            lastMaintenance: Core.clone(state.lastMaintenance || null)
        };
    }

    function ensureState(chat) {
        if (!chat) return null;
        chat.memoryTables ||= {};
        const snapshot = getStateSnapshot(chat);
        chat.memoryTables.retrievalRuntime = snapshot;
        return snapshot;
    }

    function getIndexSnapshot(chat) {
        return getStateSnapshot(chat).index;
    }

    function getUsageSnapshot(chat) {
        return getStateSnapshot(chat).usage;
    }

    function fingerprintFor(item) {
        return Core.hashFingerprint(item?.searchText || item?.text || '');
    }

    function flattenItems(groups) {
        const records = [];
        (groups || []).forEach(group => {
            const { templateId, tableId } = splitGroupKey(group.key);
            (group.items || []).forEach(item => records.push({
                key: makeKey(templateId, tableId, item.id),
                templateId,
                tableId,
                rowId: item.id,
                text: String(item.searchText || item.text || ''),
                fingerprint: fingerprintFor(item),
                row: item.row || null
            }));
        });
        return records;
    }

    function validVector(value) {
        return Array.isArray(value) && value.length > 0 && value.every(item => Number.isFinite(Number(item)));
    }

    async function fetchEmbeddings(texts) {
        const registry = global.OVOApiServiceRegistry;
        if (!registry?.isReady?.('vector')) throw new Error('未配置向量 API');
        return registry.embed(texts, {
            task: 'memory-table-index-maintenance',
            operationType: 'memory.embedding.maintenance',
            operationStage: '正在维护档案检索索引',
            source: 'memory-retrieval-maintenance'
        });
    }

    async function buildIndexPlan(groups, options = {}) {
        const records = flattenItems(groups);
        const current = options.indexSnapshot && typeof options.indexSnapshot === 'object' ? options.indexSnapshot : {};
        const entries = {};
        const pending = [];
        let reused = 0;
        let migrated = 0;

        records.forEach(record => {
            const existing = normalizeIndexEntry(current[record.key]);
            if (existing.fingerprint === record.fingerprint && validVector(existing.vector)) {
                entries[record.key] = existing;
                reused += 1;
                return;
            }
            const legacyVector = record.row?.meta?.retrievalVector;
            const legacyFingerprint = String(record.row?.meta?.retrievalVectorFingerprint || '');
            if (legacyFingerprint === record.fingerprint && validVector(legacyVector)) {
                entries[record.key] = {
                    fingerprint: record.fingerprint,
                    vector: legacyVector.map(value => Number(value) || 0),
                    indexedAt: Number(record.row?.meta?.retrievalIndexedAt) || Date.now(),
                    source: 'legacy_row_meta'
                };
                migrated += 1;
                return;
            }
            pending.push(record);
        });

        let error = '';
        let created = 0;
        if (pending.length) {
            try {
                const vectors = await fetchEmbeddings(pending.map(record => record.text));
                pending.forEach((record, index) => {
                    const vector = Array.isArray(vectors?.[index]) ? vectors[index].map(value => Number(value) || 0) : [];
                    if (!validVector(vector)) return;
                    entries[record.key] = {
                        fingerprint: record.fingerprint,
                        vector,
                        indexedAt: Date.now(),
                        source: 'maintenance_api'
                    };
                    created += 1;
                });
            } catch (cause) {
                error = cause?.message || String(cause);
            }
        }

        return {
            ok: !error,
            error,
            total: records.length,
            indexed: Object.keys(entries).length,
            reused,
            migrated,
            created,
            missing: Math.max(0, records.length - Object.keys(entries).length),
            entries,
            builtAt: Date.now()
        };
    }

    function applyIndexPlan(chat, plan) {
        const state = ensureState(chat);
        if (!state || !plan) return { changed: false, count: 0 };
        const next = {};
        Object.entries(plan.entries || {}).forEach(([key, entry]) => {
            const normalized = normalizeIndexEntry(entry);
            if (normalized.fingerprint && validVector(normalized.vector)) next[key] = normalized;
        });
        const before = JSON.stringify(state.index || {});
        state.index = next;
        state.lastMaintenance = {
            at: Date.now(),
            ok: !!plan.ok,
            error: String(plan.error || ''),
            total: Number(plan.total) || 0,
            indexed: Object.keys(next).length,
            reused: Number(plan.reused) || 0,
            migrated: Number(plan.migrated) || 0,
            created: Number(plan.created) || 0,
            missing: Number(plan.missing) || 0
        };
        chat.memoryTables.retrievalRuntime = state;
        return { changed: before !== JSON.stringify(next), count: Object.keys(next).length, report: Core.clone(state.lastMaintenance) };
    }

    async function rebuildIndex(chat, groups) {
        const plan = await buildIndexPlan(groups, { indexSnapshot: getIndexSnapshot(chat) });
        const applied = applyIndexPlan(chat, plan);
        return { ...plan, changed: applied.changed, report: applied.report };
    }

    function itemAppearsInBlock(item, finalBlock) {
        const block = String(finalBlock || '');
        if (!block.trim()) return false;
        const values = String(item?.text || '').split(/\n+/)
            .map(line => line.includes(':') ? line.split(':').slice(1).join(':').trim() : line.trim())
            .filter(value => value.length >= 3)
            .sort((a, b) => b.length - a.length);
        return values.some(value => block.includes(value.slice(0, Math.min(48, value.length))));
    }

    function recordUsage(chat, diagnostic, finalBlock, options = {}) {
        if (!chat || !diagnostic) return { changed: false, retrieved: 0, injected: 0 };
        const state = ensureState(chat);
        const eventKey = String(options.eventKey || `${options.roundId || ''}:${diagnostic.preparedAt || 0}:${diagnostic.queryText || ''}`);
        if (eventKey && state.lastUsageEventKey === eventKey) return { changed: false, retrieved: 0, injected: 0 };
        const now = Date.now();
        const roundIndex = Number.isFinite(Number(options.roundIndex)) ? Number(options.roundIndex) : -1;
        let retrieved = 0;
        let injected = 0;
        (diagnostic.tables || []).forEach(group => {
            const { templateId, tableId } = splitGroupKey(group.key);
            (group.selected || []).forEach(item => {
                const key = makeKey(templateId, tableId, item.id);
                const usage = normalizeUsage(state.usage[key]);
                usage.retrievalCount += 1;
                usage.lastRetrievedAt = now;
                retrieved += 1;
                if (itemAppearsInBlock(item, finalBlock)) {
                    usage.injectionCount += 1;
                    usage.lastInjectedAt = now;
                    usage.lastInjectedRoundIndex = roundIndex;
                    injected += 1;
                }
                state.usage[key] = usage;
            });
        });
        state.lastUsageEventKey = eventKey;
        chat.memoryTables.retrievalRuntime = state;
        return { changed: retrieved > 0 || injected > 0, retrieved, injected };
    }

    function clearIndex(chat) {
        const state = ensureState(chat);
        if (!state) return 0;
        const count = Object.keys(state.index || {}).length;
        state.index = {};
        state.lastMaintenance = { at: Date.now(), ok: true, action: 'clear', total: count, indexed: 0, missing: 0 };
        chat.memoryTables.retrievalRuntime = state;
        return count;
    }

    Kernel.register('retrievalMaintenance', Object.freeze({
        VERSION,
        makeKey,
        getStateSnapshot,
        getIndexSnapshot,
        getUsageSnapshot,
        buildIndexPlan,
        applyIndexPlan,
        rebuildIndex,
        recordUsage,
        clearIndex
    }));
})(window);
