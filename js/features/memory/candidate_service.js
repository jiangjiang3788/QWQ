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
        const nextValue = Domain.normalizeFieldValue(field, status);
        if (Domain.isSameMemoryValue(oldValue, nextValue)) return { changed: false, reason: '状态未变化' };
        row.cells ||= {};
        row.cells[field.id] = nextValue;
        row.meta ||= {};
        row.meta.updatedAt = Date.now();
        Domain.pushMemoryHistory(chat, [{
            templateId: template.id,
            tableId: table.id,
            rowId: row.id,
            fieldId: field.id,
            label: `${table.name} / 审核状态`,
            oldValue,
            newValue: nextValue
        }], { source: options.source || 'candidate_review_v2_11_r4' });
        Policy?.clearRetrievalCache?.(chat);
        return { changed: true, oldValue, newValue: nextValue };
    }

    function findLongTarget(template) {
        return (template?.tables || []).find(table => {
            const layer = Policy?.normalizeTablePolicy?.(table)?.memoryLayer || table.memoryLayer || '';
            return layer === 'long' && Domain.isRowsTable(table);
        }) || null;
    }

    function approve(chat, descriptor, row, options = {}) {
        const { template, table: sourceTable } = descriptor || {};
        if (!chat || !template || !sourceTable || !row) return { changed: false, reason: '候选不存在' };
        const targetTable = findLongTarget(template);
        if (!targetTable) return { changed: false, reason: '当前模板没有可接收候选的长期表' };
        const content = rowValueByKey(sourceTable, row, '候选内容');
        const category = rowValueByKey(sourceTable, row, '候选类别');
        if (!String(content || '').trim()) return { changed: false, reason: '候选内容为空' };

        const originalIdField = fieldByKey(targetTable, '原始记录ID');
        const contentField = fieldByKey(targetTable, '内容');
        const duplicate = Domain.getRows(chat, template.id, targetTable).find(item => {
            if (originalIdField && item.cells?.[originalIdField.id] === row.id) return true;
            return contentField && String(item.cells?.[contentField.id] || '').trim() === String(content).trim();
        });
        if (duplicate) {
            const status = setStatus(chat, descriptor, row, '已批准', { source: 'candidate_approve_v2_11_r4' });
            return { changed: status.changed, duplicate: true, targetRow: duplicate, status };
        }

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

        const beforeSnapshot = Core.clone(chat.memoryTables?.data || {});
        const added = Domain.addRow(chat, template.id, targetTable, values, {
            source: 'candidate_approve_v2_11_r4',
            skipHistory: true,
            userConfirmed: true
        });
        const statusField = fieldByKey(sourceTable, '审核状态');
        const oldStatus = statusField ? row.cells?.[statusField.id] : undefined;
        if (statusField) row.cells[statusField.id] = Domain.normalizeFieldValue(statusField, '已批准');
        if (Lifecycle) {
            Lifecycle.recordSource(added, 'manual', {
                type: 'manual', id: row.id, at: Date.now(), excerpt: String(content).slice(0, 300)
            }, { userConfirmed: true, verified: true });
            Lifecycle.setStatus(added, 'active', '由用户批准长期候选后生效');
        }
        const changedFields = [];
        (targetTable.columns || []).forEach(field => {
            if (values[field.id] === undefined) return;
            changedFields.push({
                templateId: template.id,
                tableId: targetTable.id,
                rowId: added.id,
                fieldId: field.id,
                label: `${targetTable.name} / ${field.key}（候选晋升）`,
                oldValue: '',
                newValue: added.cells[field.id]
            });
        });
        if (statusField) changedFields.push({
            templateId: template.id,
            tableId: sourceTable.id,
            rowId: row.id,
            fieldId: statusField.id,
            label: `${sourceTable.name} / 审核状态`,
            oldValue: oldStatus,
            newValue: row.cells[statusField.id]
        });
        Domain.pushMemoryHistory(chat, changedFields, {
            source: options.source || 'candidate_approve_v2_11_r4',
            snapshot: beforeSnapshot
        });
        Policy?.clearRetrievalCache?.(chat);
        return { changed: true, duplicate: false, targetRow: added, targetTable, changedFields };
    }

    Kernel.register('candidateService', Object.freeze({
        VERSION: '2.11-R4',
        fieldByKey,
        rowValueByKey,
        statusText,
        isPending,
        setStatus,
        approve
    }));
})(window);
