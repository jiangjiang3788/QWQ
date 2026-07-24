(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Coordinator = Kernel.require('writeCoordinator');

    const metrics = {
        requested: 0,
        committed: 0,
        skipped: 0,
        rolledBack: 0,
        recordedReceipts: 0
    };

    function clone(value) {
        return Core.clone ? Core.clone(value) : JSON.parse(JSON.stringify(value));
    }

    function text(value) {
        if (value == null) return '';
        if (typeof value === 'object') {
            try { return JSON.stringify(value); } catch (_) { return String(value); }
        }
        return String(value);
    }

    function normalizeChanges(result) {
        const source = Array.isArray(result?.changes)
            ? result.changes
            : (Array.isArray(result?.changedFields) ? result.changedFields : []);
        return source.filter(Boolean).map(change => ({
            templateId: String(change.templateId || ''),
            tableId: String(change.tableId || ''),
            rowId: String(change.rowId || ''),
            fieldId: String(change.fieldId || ''),
            label: String(change.label || ''),
            oldValue: clone(change.oldValue),
            newValue: clone(change.newValue)
        }));
    }

    function recordKey(change) {
        return change.rowId || `${change.templateId}:${change.tableId}:single`;
    }

    function summarize(changes, options = {}) {
        const records = new Set(changes.map(recordKey).filter(Boolean));
        const fields = new Set(changes.map(change => `${recordKey(change)}:${change.fieldId || 'unknown'}`));
        return {
            recordCount: Number(options.recordCount) || records.size || (options.changed === false ? 0 : 1),
            fieldCount: Number(options.fieldCount) || fields.size || 0
        };
    }

    function actionFor(change) {
        const before = text(change.oldValue);
        const after = text(change.newValue);
        if (!before && after) return 'create';
        if (before && !after) return 'delete';
        return 'update';
    }

    function buildReceipt(chat, result, options = {}) {
        const changes = normalizeChanges(result);
        const counts = summarize(changes, { ...options, changed: result?.changed });
        const changed = result?.changed !== false && result?.status !== 'noop';
        const operationId = String(options.operationId || result?.operationId || result?.transactionId || '');
        return Object.freeze({
            schemaVersion: 'memory-write-receipt.v1',
            producerVersion: '2.14-R2',
            transactionId: String(result?.transactionId || ''),
            operationId,
            characterId: String(chat?.id || ''),
            source: String(options.source || options.reason || result?.source || 'memory-write'),
            action: String(options.action || result?.action || 'update'),
            status: changed ? 'committed' : 'noop',
            changed,
            persisted: result?.persisted === true,
            rollbackApplied: result?.rollbackApplied === true,
            recordCount: counts.recordCount,
            fieldCount: counts.fieldCount,
            templateId: String(options.templateId || result?.templateId || changes[0]?.templateId || ''),
            tableId: String(options.tableId || result?.tableId || changes[0]?.tableId || ''),
            rowId: String(options.rowId || result?.rowId || changes[0]?.rowId || ''),
            summary: String(options.summary || result?.summary || (changed
                ? `更新 ${counts.recordCount} 条记忆${counts.fieldCount ? ` · ${counts.fieldCount} 个字段` : ''}`
                : '没有需要保存的变化')),
            changes,
            at: Date.now()
        });
    }

    function recordRuntime(receipt) {
        const runtime = global.OVOOperationRuntime;
        if (!runtime?.recordMutations || !receipt.operationId || !receipt.changes.length) return [];
        const recorded = runtime.recordMutations(receipt.operationId, receipt.changes.slice(0, 100).map(change => ({
            action: actionFor(change),
            entityType: 'structured_memory',
            entityId: change.rowId || `${change.templateId}:${change.tableId}:${change.fieldId}`,
            title: change.label || '结构化记忆变化',
            summary: receipt.summary,
            before: change.oldValue,
            after: change.newValue,
            fields: change.fieldId ? [change.fieldId] : [],
            source: receipt.source,
            meta: {
                transactionId: receipt.transactionId,
                characterId: receipt.characterId,
                templateId: change.templateId,
                tableId: change.tableId,
                rowId: change.rowId,
                fieldId: change.fieldId
            }
        })));
        metrics.recordedReceipts += 1;
        return recorded;
    }

    async function run(chat, options = {}, mutate) {
        metrics.requested += 1;
        try {
            const result = await Coordinator.run(chat, options, mutate);
            const receipt = buildReceipt(chat, result, options);
            if (receipt.changed) metrics.committed += 1;
            else metrics.skipped += 1;
            if (options.recordRuntime !== false) recordRuntime(receipt);
            return { ...result, operationId: receipt.operationId || result.operationId || '', receipt };
        } catch (error) {
            if (error?.memoryRollbackApplied) metrics.rolledBack += 1;
            throw error;
        }
    }

    function getMetrics() {
        return { ...metrics, coordinator: Coordinator.getMetrics() };
    }

    function resetMetrics() {
        Object.keys(metrics).forEach(key => { metrics[key] = 0; });
        Coordinator.resetMetrics();
    }

    Kernel.register('writeGateway', Object.freeze({
        VERSION: '2.14-R2',
        run,
        buildReceipt,
        recordRuntime,
        normalizeChanges,
        getMetrics,
        resetMetrics,
        flush: Coordinator.flush,
        getStatus: Coordinator.getStatus
    }));
})(window);
