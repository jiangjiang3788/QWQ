(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Domain = Kernel.require('domain');
    const Policy = Kernel.get('policy');
    const Lifecycle = Kernel.get('lifecycle');
    const WriteGateway = Kernel.get('writeGateway') || Kernel.require('writeCoordinator');
    const FieldSemantics = Kernel.get('fieldSemantics');

    const DEFAULT_PROMOTION_FIELD_MAP = Object.freeze({
        candidate_category: Object.freeze(['dimension', 'category']),
        candidate_content: 'content',
        confidence: 'confidence',
        exception: 'applicability_exception'
    });

    function fieldByKey(table, key) {
        return (table?.columns || []).find(field => String(field.key || '').trim() === String(key || '').trim()) || null;
    }

    function rowValueByKey(table, row, key) {
        const field = fieldByKey(table, key);
        return field ? row?.cells?.[field.id] : undefined;
    }

    function fieldBySemantic(table, role) {
        return FieldSemantics?.findField?.(table, role)
            || (table?.columns || []).find(field => String(field.semanticRole || '') === String(role || ''))
            || null;
    }

    function rowValueBySemantic(table, row, role) {
        const field = fieldBySemantic(table, role);
        return field ? row?.cells?.[field.id] : undefined;
    }

    function promotionFieldMap(sourceTable) {
        const raw = sourceTable?.promotionPolicy?.fieldMap;
        if (raw && typeof raw === 'object' && Object.keys(raw).length) return raw;
        return DEFAULT_PROMOTION_FIELD_MAP;
    }

    function targetRoles(fieldMap, sourceRole) {
        const value = fieldMap?.[sourceRole];
        return (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);
    }

    function findFormalRow(chat, templateId, table, rowId) {
        if (typeof Domain.findRowById === 'function') return Domain.findRowById(chat, templateId, table, rowId);
        const rows = typeof Domain.getRows === 'function' ? Domain.getRows(chat, templateId, table) : [];
        return (rows || []).find(item => item?.id === rowId) || null;
    }

    function statusText(table, row) {
        const field = fieldBySemantic(table, 'review_status');
        return field ? String(Domain.getFieldDisplayValue(field, row?.cells?.[field.id]) || '').trim() : '';
    }

    function isPending(table, row) {
        const status = statusText(table, row);
        return !/已批准|已拒绝|已完成|已关闭/.test(status);
    }

    function setStatus(chat, descriptor, row, status, options = {}) {
        const { template, table } = descriptor || {};
        const field = fieldBySemantic(table, 'review_status');
        if (!chat || !template || !table || !row || !field) return { changed: false, reason: '缺少审核状态字段' };
        const oldValue = row.cells?.[field.id];
        const changed = Domain.updateRowFieldValue(chat, template.id, table, row.id, field, status, {
            source: options.source || 'candidate_review_v2_13_r5',
            skipHistory: options.skipHistory === true
        });
        const currentRow = findFormalRow(chat, template.id, table, row.id) || row;
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
            const roleTargets = (template.tables || []).filter(table => {
                const role = Policy?.normalizeSystemRole?.(table.systemRole, table) || table.systemRole;
                return table.id !== sourceTable.id && role === 'long_store' && normalizedLayer(table) === 'long' && Domain.isRowsTable(table);
            });
            const legacyTargets = roleTargets.length
                ? roleTargets
                : (template.tables || []).filter(table => table.id !== sourceTable.id && normalizedLayer(table) === 'long' && Domain.isRowsTable(table));
            if (legacyTargets.length !== 1) {
                throw new Error(legacyTargets.length ? '长期候选未配置唯一晋升目标' : '当前模板没有可接收候选的长期表');
            }
            targetId = legacyTargets[0].id;
            if (options.migrate !== false) {
                sourceTable.promotionPolicy = {
                    ...(sourceTable.promotionPolicy || {}),
                    enabled: true,
                    targetTableId: targetId,
                    fieldMap: sourceTable.promotionPolicy?.fieldMap || Core.clone(DEFAULT_PROMOTION_FIELD_MAP),
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
        const originalIdField = fieldBySemantic(targetTable, 'source_record_id');
        const contentField = fieldBySemantic(targetTable, 'content');
        const workflowTargetId = sourceRow?.meta?.workflow?.promotedToRowId;
        return Domain.getRows(chat, template.id, targetTable).find(item => {
            if (workflowTargetId && item.id === workflowTargetId) return true;
            if (originalIdField && item.cells?.[originalIdField.id] === sourceRow.id) return true;
            return contentField && String(item.cells?.[contentField.id] || '').trim() === String(content || '').trim();
        }) || null;
    }

    function buildTargetValues(sourceTable, targetTable, row) {
        const map = promotionFieldMap(sourceTable);
        const values = {};
        const assignRole = (targetRole, value) => {
            if (value === undefined || value === null || value === '') return;
            const field = fieldBySemantic(targetTable, targetRole);
            if (field) values[field.id] = value;
        };
        Object.keys(map).forEach(sourceRole => {
            if (sourceRole === 'exception' || sourceRole === 'evidence') return;
            const value = rowValueBySemantic(sourceTable, row, sourceRole);
            targetRoles(map, sourceRole).forEach(targetRole => assignRole(targetRole, value));
        });
        const content = rowValueBySemantic(sourceTable, row, 'candidate_content');
        const category = rowValueBySemantic(sourceTable, row, 'candidate_category');
        const evidence = rowValueBySemantic(sourceTable, row, 'evidence');
        const exception = rowValueBySemantic(sourceTable, row, 'exception');
        assignRole('source_domain', (() => {
            const field = fieldBySemantic(targetTable, 'source_domain');
            if (!field) return '';
            if ((field.options || []).includes('长期候选审核')) return '长期候选审核';
            if ((field.options || []).includes('成长沉淀')) return '成长沉淀';
            return field.options?.[0] || '长期候选审核';
        })());
        assignRole('confirmation_status', '用户确认');
        assignRole('applicability_exception', [exception ? `例外：${exception}` : '', evidence ? `支持证据：${evidence}` : ''].filter(Boolean).join('\n'));
        assignRole('source_record_id', row.id);
        return { values, content, category, fieldMap: Core.clone(map) };
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
        const statusField = fieldBySemantic(sourceTable, 'review_status');
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

        let sourceRow = row;
        if (statusField) {
            Domain.updateRowFieldValue(chat, template.id, sourceTable, row.id, statusField, '已批准', {
                source: 'candidate_approve_v2_14_r2',
                skipHistory: true
            });
            sourceRow = findFormalRow(chat, template.id, sourceTable, row.id) || row;
        }
        const now = Date.now();
        const workflow = ensureWorkflow(sourceRow);
        Object.assign(workflow, {
            status: 'approved',
            operationId,
            promotedToTableId: targetTable.id,
            promotedToRowId: targetRow.id,
            approvedAt: now,
            approvedBy: options.approvedBy || 'user'
        });
        sourceRow.meta.updatedAt = now;
        if (sourceRow !== row) {
            row.cells = sourceRow.cells;
            row.meta = sourceRow.meta;
        }

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
        if (statusField && !Domain.isSameMemoryValue(oldStatus, sourceRow.cells[statusField.id])) changedFields.push({
            templateId: template.id,
            tableId: sourceTable.id,
            rowId: row.id,
            fieldId: statusField.id,
            label: `${sourceTable.name} / 审核状态`,
            oldValue: oldStatus,
            newValue: sourceRow.cells[statusField.id]
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

    function captureApprovalState(chat, sourceTable) {
        return {
            memoryTables: Core.clone(chat.memoryTables || {}),
            promotionPolicy: Core.clone(sourceTable?.promotionPolicy || null)
        };
    }

    function restoreApprovalState(chat, sourceTable, snapshot) {
        chat.memoryTables = Core.clone(snapshot?.memoryTables || {});
        if (snapshot?.promotionPolicy) sourceTable.promotionPolicy = Core.clone(snapshot.promotionPolicy);
        else delete sourceTable.promotionPolicy;
        Policy?.clearRetrievalCache?.(chat);
    }

    async function approveAtomic(chat, descriptor, row, options = {}) {
        const sourceTable = descriptor?.table;
        if (!chat || !sourceTable) return { changed: false, reason: '候选不存在' };
        const runtime = global.OVOOperationRuntime;
        const operation = runtime?.start?.('memory.candidate.promote', {
            title: '批准长期候选',
            source: options.source || 'candidate_approve_v2_14_r2',
            scope: { chatId: chat.id, templateId: descriptor?.template?.id || '', tableId: sourceTable.id, rowId: row?.id || '' },
            stage: '校验晋升目标'
        });
        try {
            const writer = typeof options.persist === 'function'
                ? (_characterId, currentChat) => options.persist(currentChat)
                : options.writer;
            const result = await WriteGateway.run(chat, {
                reason: 'candidate-promotion',
                writer,
                capture: currentChat => captureApprovalState(currentChat, sourceTable),
                restore: (currentChat, snapshot) => restoreApprovalState(currentChat, sourceTable, snapshot),
                persistRollback: true
            }, ({ transactionId, snapshot }) => applyApproval(chat, descriptor, row, {
                ...options,
                operationId: operation?.id || transactionId,
                beforeSnapshot: Core.clone(snapshot?.memoryTables?.data || {})
            }));
            if (!result.changed) {
                runtime?.skip?.(operation?.id, result.reason || (result.idempotent ? '候选已经完成晋升' : '候选未变化'), { result });
                return result;
            }
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
                summary: result.duplicate ? '长期库已有对应记录，候选已关联并批准' : '候选已通过统一事务晋升到长期记忆',
                result: { targetTableId: result.targetTable?.id, targetRowId: result.targetRow?.id, duplicate: result.duplicate }
            });
            return result;
        } catch (error) {
            runtime?.fail?.(operation?.id, error, { stage: '晋升失败，已统一回滚' });
            throw error;
        }
    }

    function approve(chat, descriptor, row, options = {}) {
        return applyApproval(chat, descriptor, row, options);
    }

    Kernel.register('candidateService', Object.freeze({
        VERSION: '2.15-R0B',
        fieldByKey,
        rowValueByKey,
        fieldBySemantic,
        rowValueBySemantic,
        promotionFieldMap,
        statusText,
        isPending,
        setStatus,
        resolvePromotionTarget,
        approve,
        approveAtomic
    }));
})(window);
