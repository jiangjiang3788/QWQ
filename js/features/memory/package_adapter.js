(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Domain = Kernel.require('domain');

    const VERSION = '2.14-R9';
    const TABLE_REFERENCE_KEYS = new Set([
        'targetTableId', 'suggestedTargetTableId', 'promotedToTableId', 'sourceTableId',
        'mergeTargetTableId', 'expectedTableId'
    ]);
    const TEMPLATE_REFERENCE_KEYS = new Set([
        'targetTemplateId', 'suggestedTargetTemplateId', 'promotedToTemplateId', 'sourceTemplateId'
    ]);
    const FIELD_REFERENCE_KEYS = new Set(['targetFieldId', 'sourceFieldId', 'fieldId']);
    const RELATION_KEYS = Object.freeze(['supersedes', 'supersededBy', 'conflictsWith', 'relatedTo']);

    function clone(value) {
        return Core.clone(value);
    }

    function createMapping() {
        return { templateIds: {}, tableIds: {}, fieldIds: {}, fieldIdCandidates: {}, rowIds: {}, rowIdCandidates: {} };
    }

    function addCandidate(map, key, value) {
        if (!key || !value) return;
        map[key] ||= [];
        if (!map[key].includes(value)) map[key].push(value);
    }

    function resolveUnique(map, key) {
        const values = map?.[key] || [];
        return values.length === 1 ? values[0] : null;
    }

    function remapTemplateReferences(value, mapping, oldTableId) {
        if (Array.isArray(value)) {
            value.forEach(item => remapTemplateReferences(item, mapping, oldTableId));
            return value;
        }
        if (!value || typeof value !== 'object') return value;
        Object.entries(value).forEach(([key, raw]) => {
            if (typeof raw === 'string' && TABLE_REFERENCE_KEYS.has(key)) {
                value[key] = mapping.tableIds[raw] || raw;
                return;
            }
            if (typeof raw === 'string' && TEMPLATE_REFERENCE_KEYS.has(key)) {
                value[key] = mapping.templateIds[raw] || raw;
                return;
            }
            if (typeof raw === 'string' && FIELD_REFERENCE_KEYS.has(key)) {
                value[key] = mapping.fieldIds[`${oldTableId}::${raw}`] || resolveUnique(mapping.fieldIdCandidates, raw) || raw;
                return;
            }
            remapTemplateReferences(raw, mapping, oldTableId);
        });
        return value;
    }

    function cloneTemplateWithFreshIds(template) {
        const working = clone(Domain.normalizeTemplate(template));
        const mapping = createMapping();
        const originalTemplateId = working.id;
        mapping.templateIds[originalTemplateId] = Core.createId('memory_tpl');
        working.id = mapping.templateIds[originalTemplateId];
        const oldTableIds = [];
        working.tables = (working.tables || []).map(table => {
            const oldTableId = String(table.id || Core.createId('legacy_table'));
            oldTableIds.push(oldTableId);
            const newTableId = Core.createId('memory_table');
            mapping.tableIds[oldTableId] = newTableId;
            table.id = newTableId;
            table.columns = (table.columns || []).map(field => {
                const oldFieldId = String(field.id || Core.createId('legacy_field'));
                const newFieldId = Core.createId('memory_field');
                mapping.fieldIds[`${oldTableId}::${oldFieldId}`] = newFieldId;
                addCandidate(mapping.fieldIdCandidates, oldFieldId, newFieldId);
                field.id = newFieldId;
                return field;
            });
            return table;
        });
        working.tables.forEach((table, index) => remapTemplateReferences(table, mapping, oldTableIds[index]));
        return { template: working, idMap: mapping, originalTemplateId, oldTableIds };
    }

    function buildRowMappings(entries, binding, aggregate) {
        entries.forEach(entry => {
            const sourceData = binding?.data?.[entry.originalTemplateId] || {};
            Object.entries(entry.idMap.tableIds).forEach(([oldTableId]) => {
                const rows = sourceData?.[oldTableId]?.__rows;
                if (!Array.isArray(rows)) return;
                rows.forEach(row => {
                    const oldRowId = String(row?.id || Core.createId('legacy_row'));
                    const newRowId = Core.createId('memory_row');
                    const exactKey = `${entry.originalTemplateId}::${oldTableId}::${oldRowId}`;
                    aggregate.rowIds[exactKey] = newRowId;
                    addCandidate(aggregate.rowIdCandidates, oldRowId, newRowId);
                });
            });
        });
    }

    function createImportPlan(items, binding = {}) {
        const entries = (Array.isArray(items) ? items : []).filter(Boolean).map(cloneTemplateWithFreshIds);
        const aggregate = createMapping();
        entries.forEach(entry => {
            Object.assign(aggregate.templateIds, entry.idMap.templateIds);
            Object.assign(aggregate.tableIds, entry.idMap.tableIds);
            Object.assign(aggregate.fieldIds, entry.idMap.fieldIds);
            Object.entries(entry.idMap.fieldIdCandidates).forEach(([key, values]) => values.forEach(value => addCandidate(aggregate.fieldIdCandidates, key, value)));
        });
        buildRowMappings(entries, binding, aggregate);
        const templateCount = entries.length;
        const tableCount = entries.reduce((sum, entry) => sum + (entry.template.tables || []).length, 0);
        const fieldCount = entries.reduce((sum, entry) => sum + (entry.template.tables || []).reduce((n, table) => n + (table.columns || []).length, 0), 0);
        const rowCount = Object.keys(aggregate.rowIds).length;
        return Object.freeze({
            version: VERSION,
            entries,
            mapping: aggregate,
            summary: Object.freeze({ templateCount, tableCount, fieldCount, rowCount })
        });
    }

    function oldTableIdFor(entry, newTableId) {
        return Object.keys(entry.idMap.tableIds).find(oldId => entry.idMap.tableIds[oldId] === newTableId) || null;
    }

    function oldFieldIdFor(entry, oldTableId, newFieldId) {
        const prefix = `${oldTableId}::`;
        const key = Object.keys(entry.idMap.fieldIds).find(item => item.startsWith(prefix) && entry.idMap.fieldIds[item] === newFieldId);
        return key ? key.slice(prefix.length) : null;
    }

    function resolveRowId(plan, oldRowId, oldTemplateId, oldTableId) {
        if (!oldRowId) return null;
        const exact = plan.mapping.rowIds[`${oldTemplateId}::${oldTableId}::${oldRowId}`];
        return exact || resolveUnique(plan.mapping.rowIdCandidates, String(oldRowId));
    }

    function resetMessageReferences(meta) {
        if (!meta || typeof meta !== 'object') return meta;
        if ('sourceMessageIds' in meta) meta.sourceMessageIds = [];
        if (meta.evidence && typeof meta.evidence === 'object') {
            if ('sourceMessageIds' in meta.evidence) meta.evidence.sourceMessageIds = [];
            if ('messageIds' in meta.evidence) meta.evidence.messageIds = [];
        }
        if (meta.feedback && typeof meta.feedback === 'object') meta.feedback.lastRoundId = '';
        delete meta.retrievalVector;
        delete meta.retrievalVectorFingerprint;
        delete meta.retrievalIndexedAt;
        return meta;
    }

    function remapWorkflow(workflow, plan, oldTemplateId, oldTableId) {
        if (!workflow || typeof workflow !== 'object') return workflow;
        const oldTargetTemplateId = workflow.promotedToTemplateId || oldTemplateId;
        const oldTargetTableId = workflow.promotedToTableId;
        const oldTargetRowId = workflow.promotedToRowId;
        const nextTemplateId = plan.mapping.templateIds[oldTargetTemplateId] || null;
        const nextTableId = plan.mapping.tableIds[oldTargetTableId] || null;
        const nextRowId = resolveRowId(plan, oldTargetRowId, oldTargetTemplateId, oldTargetTableId);
        if (oldTargetTemplateId) workflow.promotedToTemplateId = nextTemplateId;
        if (oldTargetTableId) workflow.promotedToTableId = nextTableId;
        if (oldTargetRowId) workflow.promotedToRowId = nextRowId;
        if ((oldTargetTableId && !nextTableId) || (oldTargetRowId && !nextRowId)) {
            workflow.status = 'legacy_unverified';
            workflow.importWarning = '原晋升目标未包含在本次可迁移快照中。';
        }
        return workflow;
    }

    function remapRowMeta(meta, plan, oldTemplateId, oldTableId) {
        const next = resetMessageReferences(clone(meta || {}));
        if (next.relations && typeof next.relations === 'object') {
            RELATION_KEYS.forEach(key => {
                next.relations[key] = (Array.isArray(next.relations[key]) ? next.relations[key] : [])
                    .map(id => resolveRowId(plan, id, oldTemplateId, oldTableId))
                    .filter(Boolean);
            });
        }
        if (next.workflow) remapWorkflow(next.workflow, plan, oldTemplateId, oldTableId);
        if (next.provenance && Array.isArray(next.provenance.events)) {
            next.provenance.events = next.provenance.events.map(event => {
                const remapped = clone(event || {});
                remapped.relatedRowIds = (Array.isArray(remapped.relatedRowIds) ? remapped.relatedRowIds : [])
                    .map(id => resolveRowId(plan, id, oldTemplateId, oldTableId))
                    .filter(Boolean);
                remapped.refs = (Array.isArray(remapped.refs) ? remapped.refs : []).filter(ref => {
                    const type = String(ref?.type || '').toLowerCase();
                    return !['message', 'chat_message', 'round', 'chat_round'].includes(type);
                });
                remapped.transactionId = '';
                remapped.operationId = '';
                return remapped;
            }).slice(-80);
        }
        next.importedAt = Date.now();
        next.importedFromPortableSnapshot = true;
        return next;
    }

    function remapTableDataForImport(entry, binding, plan) {
        const sourceData = binding?.data?.[entry.originalTemplateId] || {};
        const sourceLocks = binding?.lockedFields?.[entry.originalTemplateId] || {};
        const nextData = {};
        const nextLocks = {};
        (entry.template.tables || []).forEach(table => {
            const oldTableId = oldTableIdFor(entry, table.id);
            const oldTableData = sourceData?.[oldTableId];
            const oldLocked = sourceLocks?.[oldTableId] || [];
            if (Domain.isRowsTable(table)) {
                const rows = Array.isArray(oldTableData?.__rows) ? oldTableData.__rows : [];
                nextData[table.id] = { __rows: rows.map(oldRow => {
                    const oldRowId = String(oldRow?.id || '');
                    const row = {
                        id: resolveRowId(plan, oldRowId, entry.originalTemplateId, oldTableId) || Core.createId('memory_row'),
                        cells: {},
                        meta: remapRowMeta(oldRow?.meta, plan, entry.originalTemplateId, oldTableId)
                    };
                    (table.columns || []).forEach(field => {
                        const oldFieldId = oldFieldIdFor(entry, oldTableId, field.id);
                        let raw = oldRow?.cells?.[oldFieldId] !== undefined ? oldRow.cells[oldFieldId] : oldRow?.[oldFieldId];
                        const fieldKey = String(field.key || '').trim();
                        if (typeof raw === 'string' && /(?:事件|记录|记忆|原始记录|来源记录)ID$/i.test(fieldKey)) {
                            raw = resolveRowId(plan, raw, entry.originalTemplateId, oldTableId) || raw;
                        }
                        row.cells[field.id] = raw === undefined ? Domain.getFieldDefaultValue(field) : Domain.normalizeFieldValue(field, raw);
                    });
                    if (Array.isArray(row.meta?.versionLog)) row.meta.versionLog = row.meta.versionLog.slice(-40);
                    return row;
                }) };
            } else {
                nextData[table.id] = {};
                (table.columns || []).forEach(field => {
                    const oldFieldId = oldFieldIdFor(entry, oldTableId, field.id);
                    const raw = oldTableData?.[oldFieldId];
                    nextData[table.id][field.id] = raw === undefined ? Domain.getFieldDefaultValue(field) : Domain.normalizeFieldValue(field, raw);
                });
            }
            nextLocks[table.id] = oldLocked.map(fieldId => entry.idMap.fieldIds[`${oldTableId}::${fieldId}`]).filter(Boolean);
        });
        return { data: nextData, lockedFields: nextLocks };
    }

    function remapCandidate(candidate, plan) {
        const next = clone(candidate || {});
        next.id = Core.createId('memory_candidate');
        const oldTargetTemplateId = next.targetTemplateId || next.suggestedTargetTemplateId || '';
        const oldTargetTableId = next.targetTableId || next.suggestedTargetTableId || '';
        const oldTargetRowId = next.targetRowId || '';
        if (next.targetTemplateId) next.targetTemplateId = plan.mapping.templateIds[next.targetTemplateId] || null;
        if (next.suggestedTargetTemplateId) next.suggestedTargetTemplateId = plan.mapping.templateIds[next.suggestedTargetTemplateId] || null;
        if (next.targetTableId) next.targetTableId = plan.mapping.tableIds[next.targetTableId] || null;
        if (next.suggestedTargetTableId) next.suggestedTargetTableId = plan.mapping.tableIds[next.suggestedTargetTableId] || null;
        if (oldTargetRowId) next.targetRowId = resolveRowId(plan, oldTargetRowId, oldTargetTemplateId, oldTargetTableId);
        next.sourceRoundId = null;
        next.sourceMessageIds = [];
        next.operationId = null;
        next.transactionId = null;
        next.importedAt = Date.now();
        if (['promoted', 'merged', 'processed'].includes(String(next.status || '')) && (!next.targetTableId || !next.targetRowId)) {
            next.status = 'legacy_unverified';
            next.migrationNote = '导入时未找到可验证的正式档案目标，请重新确认。';
            next.targetTemplateId = null;
            next.targetTableId = null;
            next.targetRowId = null;
        }
        return next;
    }

    function remapSidecarForImport(sidecar, plan) {
        const source = sidecar && typeof sidecar === 'object' ? sidecar : {};
        return {
            schemaVersion: VERSION,
            enabled: source.enabled !== false,
            captureCandidates: source.captureCandidates !== false,
            showStatusBar: source.showStatusBar === true,
            statusMeta: {},
            history: [],
            candidates: (Array.isArray(source.candidates) ? source.candidates : []).slice(-200).map(item => remapCandidate(item, plan))
        };
    }


    function remapQualityForImport(quality, plan) {
        const source = quality && typeof quality === 'object' ? quality : {};
        const testCases = (Array.isArray(source.testCases) ? source.testCases : []).map(item => {
            const next = clone(item || {});
            next.id = Core.createId('memory_quality_case');
            next.expectedTableIds = (Array.isArray(next.expectedTableIds) ? next.expectedTableIds : []).map(id => plan.mapping.tableIds[id]).filter(Boolean);
            next.expectedRowIds = (Array.isArray(next.expectedRowIds) ? next.expectedRowIds : []).map(id => resolveUnique(plan.mapping.rowIdCandidates, String(id))).filter(Boolean);
            return next;
        });
        return { schemaVersion: VERSION, settings: clone(source.settings || undefined), testCases, runs: [], baselineRunId: '' };
    }
    function portableImportPreview(plan, binding = {}) {
        const sidecarCount = Array.isArray(binding?.sidecar?.candidates) ? binding.sidecar.candidates.length : 0;
        const summary = plan.summary;
        return [
            `检测到可迁移记忆快照：${summary.templateCount} 个模板、${summary.tableCount} 张表、${summary.fieldCount} 个字段、${summary.rowCount} 条行记录。`,
            sidecarCount ? `另含 ${sidecarCount} 条短期候选，将重新生成候选 ID 并校验目标。` : '不包含短期候选。',
            '',
            '导入到当前角色时将：',
            '• 为模板、表格、字段和行生成新 ID；',
            '• 重映射长期晋升目标、跨表关系、候选目标和来源记录引用；',
            '• 清空源角色的消息游标、轮次引用、审核任务与运行历史；',
            '• 保留正式记忆内容、字段锁定和可验证的记忆关系。',
            '',
            '选择“确定”会导入模板和已填写记忆；选择“取消”只导入模板结构。'
        ].join('\n');
    }

    function freshRuntimeState() {
        return {
            enabled: true,
            lastProcessedMsgId: null,
            lastProcessedMsgTimestamp: 0,
            lastProcessedRoundId: null,
            lastRunAt: null,
            lastRunStatus: 'idle',
            lastError: '',
            customCursorPosition: null,
            pendingReviewBatchId: null
        };
    }

    Kernel.register('packageAdapter', Object.freeze({
        VERSION,
        cloneTemplateWithFreshIds,
        createImportPlan,
        remapTableDataForImport,
        remapSidecarForImport,
        remapQualityForImport,
        portableImportPreview,
        freshRuntimeState,
        resolveRowId
    }));
})(window);
