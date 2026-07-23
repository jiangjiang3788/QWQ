(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Domain = Kernel.require('domain');
    const Policy = Kernel.get('policy');
    const Lifecycle = Kernel.get('lifecycle');

    function fieldByKey(table, key) {
        return (table?.columns || []).find(field => String(field.key || '').trim() === String(key || '').trim()) || null;
    }

    function rowValueByKey(table, row, key) {
        const field = fieldByKey(table, key);
        return field ? row?.cells?.[field.id] : undefined;
    }

    function statusText(table, row) {
        const field = fieldByKey(table, '审核状态');
        return field ? String(Domain.getFieldDisplayValue(field, row?.cells?.[field.id]) || '').trim() : '';
    }

    function isPending(table, row) {
        const status = statusText(table, row);
        return !/已批准|已拒绝|已完成|已关闭/.test(status);
    }

    function setStatus(chat, descriptor, row, status, options = {}) {
        const { template, table } = descriptor || {};
        const field = fieldByKey(table, '审核状态');
        if (!chat || !template || !table || !row || !field) return { changed: false, reason: '缺少审核状态字段' };
        const oldValue = row.cells?.[field.id];
        const changed = Domain.updateRowFieldValue(chat, template.id, table, row.id, field, status, {
            source: options.source || 'candidate_review_v2_13_r5',
            skipHistory: options.skipHistory === true
        });
        const currentRow = Domain.findRowById(chat, template.id, table, row.id) || row;
        return changed
            ? { changed: true, oldValue, newValue: currentRow.cells?.[field.id] }
            : { changed: false, reason: '状态未变化', oldValue, newValue: currentRow.cells?.[field.id] };
    }

    function normalizedLayer(table) {
        return Policy?.normalizeTablePolicy?.(table)?.memoryLayer || table?.memoryLayer || '';
    }

    function resolvePromotionTarget(template, sourceTable, options = {}) {
        if (!template || !sourceTable) throw new Error('长期候选上下文不完整');
        let targetId = String(sourceTable.promotionPolicy?.targetTableId || '').trim();
        if (!targetId) {
            const legacyTargets = (template.tables || []).filter(table => table.id !== sourceTable.id && normalizedLayer(table) === 'long' && Domain.isRowsTable(table));
            if (legacyTargets.length !== 1) {
                throw new Error(legacyTargets.length ? '长期候选未配置唯一晋升目标' : '当前模板没有可接收候选的长期表');
            }
            targetId = legacyTargets[0].id;
            if (options.migrate !== false) {
                sourceTable.promotionPolicy = {
                    ...(sourceTable.promotionPolicy || {}),
                    enabled: true,
                    targetTableId: targetId,
                    migratedFromLegacy: true
                };
            }
        }
        const target = (template.tables || []).find(table => table.id === targetId) || null;
        if (!target) throw new Error('配置的长期晋升目标不存在');
        if (target.id === sourceTable.id) throw new Error('长期候选不能晋升到自身');
        if (normalizedLayer(target) !== 'long' || !Domain.isRowsTable(target)) throw new Error('配置的晋升目标不是正式长期行表');
        return target;
    }

    function findDuplicate(chat, template, targetTable, sourceRow, content) {
        const originalIdField = fieldByKey(targetTable, '原始记录ID');
        const contentField = fieldByKey(targetTable, '内容');
        const workflowTargetId = sourceRow?.meta?.workflow?.promotedToRowId;
        return Domain.getRows(chat, template.id, targetTable).find(item => {
            if (workflowTargetId && item.id === workflowTargetId) return true;
            if (originalIdField && item.cells?.[originalIdField.id] === sourceRow.id) return true;
            return contentField && String(item.cells?.[contentField.id] || '').trim() === String(content || '').trim();
        }) || null;
    }

    function buildTargetValues(sourceTable, targetTable, row) {
        const content = rowValueByKey(sourceTable, row, '候选内容');
        const category = rowValueByKey(sourceTable, row, '候选类别');
        const values = {};
        const assign = (key, value) => {
            const field = fieldByKey(targetTable, key);
            if (field && value !== undefined && value !== null && value !== '') values[field.id] = value;
        };
        const sourceDomainField = fieldByKey(targetTable, '来源域');
        if (sourceDomainField) {
            const preferred = (sourceDomainField.options || []).includes('长期候选审核') ? '长期候选审核'
                : ((sourceDomainField.options || []).includes('成长沉淀') ? '成长沉淀' : sourceDomainField.options?.[0]);
            assign('来源域', preferred);
        }
        assign('维度或类型', category);
        assign('分类', category);
        assign('内容', content);
        assign('原置信度', rowValueByKey(sourceTable, row, '置信度'));
        assign('确认状态', '用户确认');
        const evidence = rowValueByKey(sourceTable, row, '支持证据');
        const exception = rowValueByKey(sourceTable, row, '反例或例外');
        assign('例外或适用场景', [exception ? `例外：${exception}` : '', evidence ? `支持证据：${evidence}` : ''].filter(Boolean).join('\n'));
        assign('原始记录ID', row.id);
        return { values, content, category };
    }

    function ensureWorkflow(row) {
        row.meta ||= {};
        row.meta.workflow ||= {};
        return row.meta.workflow;
    }

    function applyApproval(chat, descriptor, row, options = {}) {
        const { template, table: sourceTable } = descriptor || {};
        if (!chat || !template || !sourceTable || !row) return { changed: false, reason: '候选不存在' };
        const targetTable = resolvePromotionTarget(template, sourceTable, options);
        const { values, content } = buildTargetValues(sourceTable, targetTable, row);
        if (!String(content || '').trim()) return { changed: false, reason: '候选内容为空' };

        const operationId = options.operationId || Core.createId('memory_candidate_promotion');
        const beforeSnapshot = options.beforeSnapshot || Core.clone(chat.memoryTables?.data || {});
        const duplicate = findDuplicate(chat, template, targetTable, row, content);
        const statusField = fieldByKey(sourceTable, '审核状态');
        const oldStatus = statusField ? Core.clone(row.cells?.[statusField.id]) : undefined;
        const oldWorkflow = Core.clone(row.meta?.workflow || null);
        let targetRow = duplicate;
        if (targetRow && oldWorkflow?.status === 'approved' && oldWorkflow.promotedToTableId === targetTable.id
            && oldWorkflow.promotedToRowId === targetRow.id && /已批准/.test(String(oldStatus || ''))) {
            return {
                changed: false,
                duplicate: true,
                idempotent: true,
                targetRow,
                targetTable,
                changedFields: [],
                operationId: oldWorkflow.operationId || operationId,
                workflow: oldWorkflow
            };
        }

        if (!targetRow) {
            targetRow = Domain.addRow(chat, template.id, targetTable, values, {
                source: 'candidate_approve_v2_13_r5',
                skipHistory: true,
                userConfirmed: true,
                meta: { workflow: { sourceCandidateRowId: row.id, operationId } }
            });
            if (Lifecycle) {
                Lifecycle.recordSource(targetRow, 'manual', {
                    type: 'manual', id: row.id, at: Date.now(), excerpt: String(content).slice(0, 300)
                }, { userConfirmed: true, verified: true });
                Lifecycle.setStatus(targetRow, 'active', '由用户批准长期候选后生效');
            }
        }

        if (statusField) {
            row.cells ||= {};
            row.cells[statusField.id] = Domain.normalizeFieldValue(statusField, '已批准');
        }
        const now = Date.now();
        const workflow = ensureWorkflow(row);
        Object.assign(workflow, {
            status: 'approved',
            operationId,
            promotedToTableId: targetTable.id,
            promotedToRowId: targetRow.id,
            approvedAt: now,
            approvedBy: options.approvedBy || 'user'
        });
        row.meta.updatedAt = now;

        const changedFields = [];
        if (!duplicate) {
            (targetTable.columns || []).forEach(field => {
                if (values[field.id] === undefined) return;
                changedFields.push({
                    templateId: template.id,
                    tableId: targetTable.id,
                    rowId: targetRow.id,
                    fieldId: field.id,
                    label: `${targetTable.name} / ${field.key}（候选晋升）`,
                    oldValue: '',
                    newValue: targetRow.cells[field.id]
                });
            });
        }
        if (statusField && !Domain.isSameMemoryValue(oldStatus, row.cells[statusField.id])) changedFields.push({
            templateId: template.id,
            tableId: sourceTable.id,
            rowId: row.id,
            fieldId: statusField.id,
            label: `${sourceTable.name} / 审核状态`,
            oldValue: oldStatus,
            newValue: row.cells[statusField.id]
        });
        if (!Domain.isSameMemoryValue(oldWorkflow, workflow)) changedFields.push({
            templateId: template.id,
            tableId: sourceTable.id,
            rowId: row.id,
            fieldId: '__workflow__',
            label: `${sourceTable.name} / 晋升追踪`,
            oldValue: oldWorkflow,
            newValue: Core.clone(workflow)
        });
        if (changedFields.length) Domain.pushMemoryHistory(chat, changedFields, {
            source: options.source || 'candidate_approve_v2_13_r5',
            snapshot: beforeSnapshot
        });
        Policy?.clearRetrievalCache?.(chat);
        return {
            changed: changedFields.length > 0,
            duplicate: !!duplicate,
            idempotent: !!duplicate && oldWorkflow?.promotedToRowId === targetRow.id && /已批准/.test(String(oldStatus || '')),
            targetRow,
            targetTable,
            changedFields,
            operationId,
            workflow: Core.clone(workflow)
        };
    }

    function snapshotState(chat, sourceTable) {
        return {
            data: Core.clone(chat.memoryTables?.data || {}),
            history: Core.clone(chat.memoryTables?.history || []),
            lastChangedFieldPaths: Core.clone(chat.memoryTables?.lastChangedFieldPaths || []),
            promotionPolicy: Core.clone(sourceTable?.promotionPolicy || null)
        };
    }

    function restoreState(chat, sourceTable, snapshot) {
        chat.memoryTables.data = Core.clone(snapshot.data || {});
        chat.memoryTables.history = Core.clone(snapshot.history || []);
        chat.memoryTables.lastChangedFieldPaths = Core.clone(snapshot.lastChangedFieldPaths || []);
        if (snapshot.promotionPolicy) sourceTable.promotionPolicy = Core.clone(snapshot.promotionPolicy);
        else delete sourceTable.promotionPolicy;
        Policy?.clearRetrievalCache?.(chat);
    }

    async function approveAtomic(chat, descriptor, row, options = {}) {
        const sourceTable = descriptor?.table;
        if (!chat || !sourceTable) return { changed: false, reason: '候选不存在' };
        const snapshot = snapshotState(chat, sourceTable);
        const runtime = global.OVOOperationRuntime;
        const operation = runtime?.start?.('memory.candidate.promote', {
            title: '批准长期候选',
            source: options.source || 'candidate_approve_v2_13_r5',
            scope: { chatId: chat.id, templateId: descriptor?.template?.id || '', tableId: sourceTable.id, rowId: row?.id || '' },
            stage: '校验晋升目标'
        });
        try {
            const result = applyApproval(chat, descriptor, row, {
                ...options,
                operationId: operation?.id || Core.createId('memory_candidate_promotion'),
                beforeSnapshot: snapshot.data
            });
            if (!result.changed) {
                runtime?.skip?.(operation?.id, result.reason || (result.idempotent ? '候选已经完成晋升' : '候选未变化'), { result });
                return result;
            }
            runtime?.stage?.(operation?.id, '保存长期记忆');
            if (typeof options.persist === 'function') await options.persist(chat);
            result.changedFields?.forEach(item => runtime?.recordMutation?.(operation?.id, {
                action: item.oldValue === '' ? 'create' : 'update',
                entityType: 'memory',
                entityId: item.rowId,
                title: item.label,
                summary: `${item.tableId} / ${item.fieldId}`,
                before: item.oldValue,
                after: item.newValue
            }));
            runtime?.complete?.(operation?.id, {
                summary: result.duplicate ? '长期库已有对应记录，候选已关联并批准' : '候选已原子晋升到长期记忆',
                result: { targetTableId: result.targetTable?.id, targetRowId: result.targetRow?.id, duplicate: result.duplicate }
            });
            return result;
        } catch (error) {
            restoreState(chat, sourceTable, snapshot);
            runtime?.fail?.(operation?.id, error, { stage: '晋升失败，已回滚' });
            error.memoryRollbackApplied = true;
            throw error;
        }
    }

    function approve(chat, descriptor, row, options = {}) {
        return applyApproval(chat, descriptor, row, options);
    }

    Kernel.register('candidateService', Object.freeze({
        VERSION: '2.13-R5',
        fieldByKey,
        rowValueByKey,
        statusText,
        isPending,
        setStatus,
        resolvePromotionTarget,
        approve,
        approveAtomic
    }));
})(window);
