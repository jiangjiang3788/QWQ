(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Domain = Kernel.require('domain');
    const TableCache = Kernel.require('tableCache');
    const TablePersistence = Kernel.require('tablePersistence');
    const WriteGateway = Kernel.get('writeGateway') || Kernel.require('writeCoordinator');
    const TableGrid = Kernel.require('tableGrid');
    const TableReconciler = Kernel.require('tableReconciler');

    const undoStacks = new Map();
    const MAX_UNDO = 20;
    const metrics = { fieldCommits: 0, noops: 0, structuralMutations: 0, undos: 0 };

    function clone(value) {
        return Core.clone ? Core.clone(value) : JSON.parse(JSON.stringify(value));
    }

    function stackFor(chatId) {
        const id = String(chatId || '');
        if (!undoStacks.has(id)) undoStacks.set(id, []);
        return undoStacks.get(id);
    }

    function pushUndo(chat, entry) {
        const stack = stackFor(chat?.id);
        stack.push({ ...entry, at: Date.now() });
        if (stack.length > MAX_UNDO) stack.splice(0, stack.length - MAX_UNDO);
        syncUndoControls(chat);
    }

    function canUndo(chat) {
        return !!stackFor(chat?.id).length;
    }

    function undoLabel(chat) {
        const entry = stackFor(chat?.id).at(-1);
        return entry ? `撤销：${entry.label || '上次编辑'}` : '没有可撤销的编辑';
    }

    function syncUndoControls(chat, root = global.document) {
        const enabled = canUndo(chat);
        root?.querySelectorAll?.('[data-action="undo-table-edit"]').forEach(button => {
            button.disabled = !enabled;
            button.title = undoLabel(chat);
            button.setAttribute('aria-label', undoLabel(chat));
        });
    }


    function normalizeTagList(value) {
        return Core.unique(String(value || '').split(/[,，、\n]/).map(item => item.trim()).filter(Boolean), 30);
    }

    function normalizeTagBundle(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            topic: normalizeTagList(Array.isArray(source.topic) ? source.topic.join(',') : source.topic),
            scene: normalizeTagList(Array.isArray(source.scene) ? source.scene.join(',') : source.scene),
            entity: normalizeTagList(Array.isArray(source.entity) ? source.entity.join(',') : source.entity),
            effect: String(source.effect || 'historical_context').trim() || 'historical_context'
        };
    }

    function fieldValue(chat, templateId, table, field, rowId) {
        if (rowId && Domain.isRowsTable(table)) return Domain.findRowById(chat, templateId, table, rowId)?.cells?.[field.id];
        return Domain.getFieldValue(chat, templateId, table.id, field);
    }

    async function persist(chat, writer, options = {}) {
        if (!chat?.id || typeof writer !== 'function') return null;
        if (options.immediate) return TablePersistence.saveNow(chat.id, writer, { reason: options.reason || 'memory-table-structure' });
        return TablePersistence.schedule(chat.id, writer, { reason: options.reason || 'memory-table-field', delay: options.delay ?? 140 });
    }

    async function commitField(options = {}) {
        const { chat, template, table, field, rowId = '', rawValue, writer, root, target } = options;
        if (!chat || !template || !table || !field) throw new Error('字段编辑上下文不完整');
        TableReconciler.markSaving(root, '保存中…');
        let result;
        try {
            result = await WriteGateway.run(chat, {
                reason: 'field-edit', writer, persistRollback: true
            }, () => {
                const oldValue = clone(fieldValue(chat, template.id, table, field, rowId));
                if (rowId && Domain.isRowsTable(table)) {
                    Domain.updateRowFieldValue(chat, template.id, table, rowId, field, rawValue, { source: 'manual_v2_14_r2' });
                } else {
                    Domain.setFieldValue(chat, template.id, table.id, field, rawValue, { source: 'manual_v2_14_r2' });
                }
                const savedValue = clone(fieldValue(chat, template.id, table, field, rowId));
                if (Domain.isSameMemoryValue(oldValue, savedValue)) return { changed: false, savedValue };
                TableCache.touch(chat, template.id, table.id, 'field-commit');
                return {
                    changed: true,
                    savedValue,
                    undoEntry: {
                        type: 'field', templateId: template.id, tableId: table.id, rowId, fieldId: field.id,
                        oldValue, newValue: savedValue, label: `${table.name} / ${field.key}`
                    }
                };
            });
        } catch (error) {
            TableReconciler.markSaved(root, '保存失败，已恢复');
            throw error;
        }
        TableGrid.commitInput(root, target, field, result.savedValue);
        if (!result.changed) {
            metrics.noops += 1;
            return { changed: false, savedValue: result.savedValue };
        }
        pushUndo(chat, result.undoEntry);
        TableReconciler.markSaved(root, '已保存');
        syncUndoControls(chat);
        metrics.fieldCommits += 1;
        return { changed: true, savedValue: result.savedValue, transactionId: result.transactionId };
    }

    async function commitTagDimension(options = {}) {
        const { chat, template, table, rowId, dimension, rawValue, writer, root, target } = options;
        if (!chat || !template || !table || !rowId || !['topic', 'scene', 'entity', 'effect'].includes(dimension)) throw new Error('标签编辑上下文不完整');
        TableReconciler.markSaving(root, '保存标签中…');
        let result;
        try {
            result = await WriteGateway.run(chat, {
                reason: 'tag-edit', writer, persistRollback: true
            }, () => {
                const row = Domain.findRowById(chat, template.id, table, rowId);
                if (!row) throw new Error('目标记忆不存在');
                const oldBundle = normalizeTagBundle(clone(row.meta?.tagBundle || {}));
                const nextBundle = normalizeTagBundle(oldBundle);
                nextBundle[dimension] = dimension === 'effect' ? String(rawValue || 'historical_context') : normalizeTagList(rawValue);
                if (Domain.isSameMemoryValue(oldBundle, nextBundle)) return { changed: false, savedValue: nextBundle[dimension] };
                const tagChange = Domain.setRowTagBundle(chat, template.id, table, rowId, nextBundle, {
                    source: 'manual_table_edit_v2_14_r2',
                    label: `${table.name} / 标签·${dimension}`,
                    skipHistory: true
                });
                Domain.pushMemoryHistory(chat, [tagChange.change], { source: 'manual_tag_edit_v2_14_r2' });
                TableCache.touch(chat, template.id, table.id, 'tag-commit');
                return {
                    changed: true,
                    savedValue: nextBundle[dimension],
                    undoEntry: {
                        type: 'tags', templateId: template.id, tableId: table.id, rowId,
                        oldValue: oldBundle, newValue: clone(nextBundle), label: `${table.name} / 标签`
                    }
                };
            });
        } catch (error) {
            TableReconciler.markSaved(root, '保存失败，已恢复');
            throw error;
        }
        if (target) {
            target.dataset.memorySaved = 'true';
            const normalized = Array.isArray(result.savedValue) ? result.savedValue.join(', ') : String(result.savedValue || '');
            if (target.value !== normalized) target.value = normalized;
        }
        if (!result.changed) {
            metrics.noops += 1;
            return { changed: false, savedValue: result.savedValue };
        }
        pushUndo(chat, result.undoEntry);
        TableReconciler.markSaved(root, '标签已保存');
        syncUndoControls(chat);
        metrics.fieldCommits += 1;
        return { changed: true, savedValue: result.savedValue, transactionId: result.transactionId };
    }

    async function commitRecord(options = {}) {
        const { chat, template, table, rowId = '', values = {}, tagBundle = null, writer, root } = options;
        if (!chat || !template || !table) throw new Error('整行编辑上下文不完整');
        if (rowId && !Domain.findRowById(chat, template.id, table, rowId)) throw new Error('目标记忆行不存在');
        TableReconciler.markSaving(root, '保存整行中…');
        let result;
        try {
            result = await WriteGateway.run(chat, {
                reason: 'record-modal-edit', writer, persistRollback: true
            }, ({ snapshot }) => {
                let row = rowId && Domain.isRowsTable(table) ? Domain.findRowById(chat, template.id, table, rowId) : null;
                const oldValues = {};
                const newValues = {};
                const changes = [];
                (table.columns || []).forEach(field => {
                    if (!Object.prototype.hasOwnProperty.call(values, field.id)) return;
                    const oldValue = clone(fieldValue(chat, template.id, table, field, rowId));
                    const nextValue = Domain.normalizeFieldValue(field, values[field.id]);
                    if (Domain.isSameMemoryValue(oldValue, nextValue)) return;
                    oldValues[field.id] = oldValue;
                    if (row) Domain.updateRowFieldValue(chat, template.id, table, rowId, field, nextValue, { source: 'manual_row_modal_v2_14_r2', skipHistory: true });
                    else Domain.setFieldValue(chat, template.id, table.id, field, nextValue, { source: 'manual_row_modal_v2_14_r2', skipHistory: true });
                    const savedValue = clone(fieldValue(chat, template.id, table, field, rowId));
                    newValues[field.id] = savedValue;
                    changes.push({ templateId: template.id, tableId: table.id, rowId, fieldId: field.id, label: `${table.name} / ${field.key}（整行编辑）`, oldValue, newValue: savedValue });
                });
                let oldTags = null;
                let newTags = null;
                if (rowId && Domain.isRowsTable(table)) row = Domain.findRowById(chat, template.id, table, rowId);
                if (row && tagBundle) {
                    oldTags = normalizeTagBundle(clone(row.meta?.tagBundle || {}));
                    newTags = normalizeTagBundle(tagBundle);
                    if (!Domain.isSameMemoryValue(oldTags, newTags)) {
                        const tagChange = Domain.setRowTagBundle(chat, template.id, table, rowId, newTags, {
                            source: 'manual_row_modal_v2_14_r2',
                            label: `${table.name} / 整行标签`,
                            skipHistory: true
                        });
                        if (tagChange.changed) changes.push(tagChange.change);
                    }
                }
                if (!changes.length) return { changed: false, changes: [] };
                Domain.pushMemoryHistory(chat, changes, { source: 'manual_row_modal_v2_14_r2', snapshot: clone(snapshot?.data || {}) });
                TableCache.touch(chat, template.id, table.id, 'record-modal-commit');
                return {
                    changed: true,
                    changes,
                    undoEntry: { type: 'record', templateId: template.id, tableId: table.id, rowId, oldValues, newValues, oldTags, newTags, label: `${table.name} / ${row ? '整行' : '档案项'}编辑` }
                };
            });
        } catch (error) {
            TableCache.touch(chat, template.id, table.id, 'record-modal-rollback');
            TableReconciler.markSaved(root, '保存失败，已恢复');
            throw error;
        }
        if (!result.changed) {
            metrics.noops += 1;
            return { changed: false, changes: [] };
        }
        pushUndo(chat, result.undoEntry);
        TableReconciler.markSaved(root, '整行已保存');
        metrics.fieldCommits += result.changes.length;
        return { changed: true, changes: result.changes, transactionId: result.transactionId };
    }

    async function addRow(options = {}) {
        const { chat, template, table, writer } = options;
        const result = await WriteGateway.run(chat, { reason: 'row-add', writer, persistRollback: true }, () => {
            const row = Domain.addRow(chat, template.id, table, options.initialValues || {}, { source: options.source || 'manual_v2_14_r2' });
            TableCache.touch(chat, template.id, table.id, 'row-add');
            return { changed: true, row };
        });
        metrics.structuralMutations += 1;
        return result.row;
    }

    async function deleteRow(options = {}) {
        const { chat, template, table, rowId, writer } = options;
        const result = await WriteGateway.run(chat, { reason: 'row-delete', writer, persistRollback: true }, () => {
            const changed = Domain.deleteRow(chat, template.id, table, rowId, { source: options.source || 'manual_v2_14_r2' });
            if (!changed) return { changed: false };
            TableCache.touch(chat, template.id, table.id, 'row-delete');
            return { changed: true };
        });
        if (result.changed) metrics.structuralMutations += 1;
        return result.changed;
    }

    async function moveRow(options = {}) {
        const { chat, template, table, rowId, delta, writer } = options;
        const result = await WriteGateway.run(chat, { reason: 'row-move', writer, persistRollback: true }, () => {
            const changed = Domain.moveRow(chat, template.id, table, rowId, delta);
            if (!changed) return { changed: false };
            TableCache.touch(chat, template.id, table.id, 'row-move');
            return { changed: true };
        });
        if (result.changed) metrics.structuralMutations += 1;
        return result.changed;
    }

    function resolveEntry(chat, templates, entry) {
        const template = (templates || []).find(item => item.id === entry.templateId);
        const table = template?.tables?.find(item => item.id === entry.tableId);
        const needsField = !['tags', 'record'].includes(entry.type);
        const field = needsField ? table?.columns?.find(item => item.id === entry.fieldId) : null;
        if (!chat || !template || !table || (needsField && !field)) return null;
        return { template, table, field };
    }

    async function undoLast(options = {}) {
        const { chat, templates, writer, root } = options;
        const stack = stackFor(chat?.id);
        const entry = stack.at(-1);
        if (!entry) return { changed: false };
        const resolved = resolveEntry(chat, templates, entry);
        if (!resolved) {
            syncUndoControls(chat, root || global.document);
            return { changed: false, missing: true };
        }
        const { template, table, field } = resolved;
        TableReconciler.markSaving(root, '撤销并保存中…');
        let result;
        try {
            result = await WriteGateway.run(chat, { reason: 'field-undo', writer, persistRollback: true }, () => {
                if (entry.type === 'record') {
                    let row = entry.rowId ? Domain.findRowById(chat, template.id, table, entry.rowId) : null;
                    if (entry.rowId && !row) return { changed: false, missing: true };
                    const changes = [];
                    Object.entries(entry.oldValues || {}).forEach(([fieldId, oldValue]) => {
                        const recordField = (table.columns || []).find(item => item.id === fieldId);
                        if (!recordField) return;
                        const currentValue = clone(fieldValue(chat, template.id, table, recordField, entry.rowId));
                        if (entry.rowId) Domain.updateRowFieldValue(chat, template.id, table, entry.rowId, recordField, clone(oldValue), { source: 'manual_record_undo_v2_14_r2', skipHistory: true });
                        else Domain.setFieldValue(chat, template.id, table.id, recordField, clone(oldValue), { source: 'manual_record_undo_v2_14_r2', skipHistory: true });
                        changes.push({ templateId: template.id, tableId: table.id, rowId: entry.rowId, fieldId, label: `${table.name} / ${recordField.key}（整行撤销）`, oldValue: currentValue, newValue: clone(oldValue) });
                    });
                    if (entry.rowId) row = Domain.findRowById(chat, template.id, table, entry.rowId);
                    if (row && entry.oldTags) {
                        const currentTags = normalizeTagBundle(clone(row.meta?.tagBundle || {}));
                        const tagChange = Domain.setRowTagBundle(chat, template.id, table, entry.rowId, normalizeTagBundle(clone(entry.oldTags)), {
                            source: 'manual_record_undo_v2_14_r2',
                            label: `${table.name} / 整行标签（撤销）`,
                            skipHistory: true
                        });
                        if (tagChange.changed) changes.push(tagChange.change);
                    }
                    Domain.pushMemoryHistory(chat, changes, { source: 'manual_record_undo_v2_14_r2' });
                } else if (entry.type === 'tags') {
                    const row = Domain.findRowById(chat, template.id, table, entry.rowId);
                    if (!row) return { changed: false, missing: true };
                    const tagChange = Domain.setRowTagBundle(chat, template.id, table, entry.rowId, normalizeTagBundle(clone(entry.oldValue)), {
                        source: 'manual_tag_undo_v2_14_r2',
                        label: `${table.name} / 标签（撤销）`,
                        skipHistory: true
                    });
                    if (tagChange.changed) Domain.pushMemoryHistory(chat, [tagChange.change], { source: 'manual_tag_undo_v2_14_r2' });
                } else if (entry.rowId && Domain.isRowsTable(table)) {
                    Domain.updateRowFieldValue(chat, template.id, table, entry.rowId, field, clone(entry.oldValue), { source: 'manual_undo_v2_14_r2' });
                } else {
                    Domain.setFieldValue(chat, template.id, table.id, field, clone(entry.oldValue), { source: 'manual_undo_v2_14_r2' });
                }
                TableCache.touch(chat, template.id, table.id, 'field-undo');
                return { changed: true, entry };
            });
        } catch (error) {
            TableReconciler.markSaved(root, '撤销失败，已恢复');
            throw error;
        }
        if (!result.changed) return result;
        if (stack.at(-1) === entry) stack.pop();
        TableReconciler.markSaved(root, '已撤销');
        syncUndoControls(chat, root || global.document);
        metrics.undos += 1;
        return { changed: true, entry, transactionId: result.transactionId };
    }

    function clearUndo(chatId) {
        undoStacks.delete(String(chatId || ''));
    }

    function getMetrics() {
        return { ...metrics, undoCharacters: undoStacks.size, persistence: TablePersistence.getMetrics(), cache: TableCache.getMetrics() };
    }

    function resetMetrics() {
        Object.keys(metrics).forEach(key => { metrics[key] = 0; });
        TablePersistence.resetMetrics();
        TableCache.resetMetrics();
    }

    Kernel.register('tableEditor', Object.freeze({
        VERSION: '2.14-R2',
        MAX_UNDO,
        commitField,
        commitTagDimension,
        commitRecord,
        addRow,
        deleteRow,
        moveRow,
        undoLast,
        canUndo,
        undoLabel,
        syncUndoControls,
        clearUndo,
        getMetrics,
        resetMetrics
    }));
})(window);
