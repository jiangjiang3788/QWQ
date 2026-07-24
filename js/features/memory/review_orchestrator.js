(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const VERSION = '2.14-R6';

    function create(env = {}) {
        const {
            MemoryFieldPolicy, MemoryLifecycle, MemoryPolicy, MemoryRetrieval, MemoryReview, MemoryTagService,
            MemoryTasks, MemoryUpdateActivity, MemoryWriteCoordinator, MemoryWriteGateway, addRow, createMemoryId,
            db, deepClone, deleteRow, ensureMemoryTableState, ensureTemplateDataForChat, findRowById,
            getEffectiveTableDescriptor, getFieldDisplayValue, getFieldValue, getRows, getTableRuntimePolicy, isEmptyMemoryValue,
            isFieldLocked, isRowsTable, isSameMemoryValue, normalizeFieldValue, pushMemoryHistory, renderMemoryTableScreen,
            replaceFormalData, rowToRetrievalItem, saveCharacter, selectMemoryView, setFieldValue, setMemoryTableAutoUpdateCursorByEndIndex,
            showToast, updateRowFieldValue
        } = env;

        function getReviewRiskLevel(chat, template, table, operation) {
            const policy = getTableRuntimePolicy(table, chat, template?.id);
            if (operation === 'delete') return 'high';
            if (policy.memoryLayer === 'core') return 'high';
            if (policy.memoryLayer === 'long' || policy.memoryLayer === 'review') return operation === 'add' ? 'high' : 'medium';
            if (policy.memoryLayer === 'medium') return 'medium';
            return 'low';
        }
        function summarizeRowForReview(table, row) {
            if (!row) return '';
            return (table.columns || [])
                .map(field => `${field.key}: ${getFieldDisplayValue(field, row.cells?.[field.id]) || '空'}`)
                .filter(Boolean)
                .join('\n');
        }
        function findDuplicateSuggestionForReview(chat, template, table, proposedDisplay) {
            if (!MemoryRetrieval || !isRowsTable(table)) return null;
            const proposedText = Object.entries(proposedDisplay || {}).map(([key, value]) => `${key}: ${value}`).join('\n');
            const items = getRows(chat, template.id, table).map((row, index) => rowToRetrievalItem(table, row, index));
            const match = MemoryRetrieval.findMostSimilar(items, proposedText, 0.34);
            if (!match?.item?.row) return null;
            return {
                rowId: match.item.row.id,
                score: match.score,
                summary: summarizeRowForReview(table, match.item.row)
            };
        }
        function getFieldEvidenceContext(fieldNode, fallbackSource) {
            const evidence = String(fieldNode?.getAttribute?.('evidence') || fallbackSource || 'assistant_inferred');
            const confidenceRaw = Number(fieldNode?.getAttribute?.('confidence'));
            return {
                source: evidence === 'user_explicit' ? 'user_explicit' : 'assistant_inferred',
                evidence,
                confidence: Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(100, confidenceRaw)) : 0
            };
        }
        function assessMemoryField(field, table, fieldNode, options = {}) {
            return MemoryFieldPolicy.assess(field, table, {
                ...getFieldEvidenceContext(fieldNode, options.source),
                manual: options.manual === true
            });
        }
        function storeRuntimeField(chat, templateId, tableId, rowId, field, value, assessment) {
            const runtimeFieldId = rowId ? `${rowId}::${field.id}` : field.id;
            MemoryFieldPolicy.setRuntimeValue(chat, templateId, tableId, runtimeFieldId, value, {
                source: assessment?.sourceEvidence === 'explicit' ? 'user_explicit' : 'assistant_inferred',
                confidence: assessment?.confidence || 0
            });
        }
        function buildMemoryReviewBatches(chat, rawContent, options = {}) {
            if (!MemoryReview) return [];
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(`<root>${rawContent || ''}</root>`, 'text/xml');
            if (xmlDoc.querySelector('parsererror')) throw new Error('结构化记忆返回格式解析失败');
            const proposals = [];
            const targetTableKeys = new Set(Array.isArray(options.targetTableKeys) ? options.targetTableKeys : []);
            const allowedRoutes = new Set(Array.isArray(options.fieldPolicyRoutes) ? options.fieldPolicyRoutes : ['review', 'candidate', 'blocked']);
            const routeFor = (field, table, node) => {
                const assessed = assessMemoryField(field, table, node, { source: options.source });
                return { ...assessed, route: options.forceReview && assessed.route === 'direct' ? 'review' : assessed.route };
            };
            Array.from(xmlDoc.querySelectorAll('memory_update')).forEach(updateNode => {
                const templateId = updateNode.getAttribute('templateId');
                const tableId = updateNode.getAttribute('tableId');
                if (targetTableKeys.size && !targetTableKeys.has(`${templateId}::${tableId}`)) return;
                const template = db.memoryTableTemplates.find(item => item.id === templateId);
                const sourceTable = template?.tables?.find(item => item.id === tableId);
                if (!template || !sourceTable) return;
                const table = getEffectiveTableDescriptor(sourceTable, chat, template.id);
                const policy = getTableRuntimePolicy(sourceTable, chat, template.id);
                const tableMode = policy.commitPolicy?.mode || 'review';
                const tableNeedsReview = !!options.forceReview || ['review', 'candidate', 'promotion'].includes(tableMode);
                ensureTemplateDataForChat(chat, template);

                if (isRowsTable(table)) {
                    Array.from(updateNode.querySelectorAll('row')).forEach(rowNode => {
                        const op = (rowNode.getAttribute('op') || 'update').trim().toLowerCase();
                        const rowId = rowNode.getAttribute('rowId') || '';
                        if (op === 'delete') {
                            if (!tableNeedsReview) return;
                            const existingRow = rowId ? findRowById(chat, templateId, table, rowId) : null;
                            proposals.push({
                                id: createMemoryId('proposal'), kind: 'row_delete', actionLabel: '删除整行',
                                templateId, tableId, templateName: template.name, tableName: table.name, rowId,
                                label: `${table.name} / 删除记录`, oldValue: summarizeRowForReview(table, existingRow), newValue: '',
                                valid: !!existingRow && policy.updatePolicy.allowDelete === true,
                                error: !existingRow ? '目标行不存在' : (policy.updatePolicy.allowDelete === true ? '' : '该表禁止 AI 删除记录'),
                                risk: 'high', editable: false, fieldRoute: 'review'
                            });
                            return;
                        }

                        if (op === 'add') {
                            const entries = [];
                            let requiresReview = tableNeedsReview;
                            const blockedReasons = [];
                            Array.from(rowNode.querySelectorAll('field')).forEach(fieldNode => {
                                const fieldId = fieldNode.getAttribute('fieldId');
                                const field = (table.columns || []).find(item => item.id === fieldId);
                                if (!field || isFieldLocked(chat, templateId, tableId, fieldId)) return;
                                const assessment = routeFor(field, table, fieldNode);
                                if (assessment.route === 'runtime_only') return;
                                if (assessment.route === 'blocked') {
                                    blockedReasons.push(`${field.key}：${assessment.reasons.join('；') || '字段策略阻止写入'}`);
                                    requiresReview = true;
                                    return;
                                }
                                if (allowedRoutes.has(assessment.route)) requiresReview = true;
                                entries.push({ field, fieldNode, assessment, value: normalizeFieldValue(field, fieldNode.textContent || '') });
                            });
                            if (!requiresReview || !entries.length) return;
                            const values = {}, display = {}, fieldDecisions = {};
                            entries.forEach(entry => {
                                values[entry.field.id] = entry.value;
                                display[entry.field.key] = getFieldDisplayValue(entry.field, entry.value);
                                fieldDecisions[entry.field.id] = entry.assessment;
                            });
                            const duplicateSuggestion = findDuplicateSuggestionForReview(chat, template, table, display);
                            const tagBundle = MemoryTagService.parseRowNode(rowNode);
                            const policyError = policy.updatePolicy.allowAdd === false ? '该表禁止 AI 新增记录' : '';
                            proposals.push({
                                id: createMemoryId('proposal'), kind: 'row_add', actionLabel: tableMode === 'candidate' ? '候选记录' : '新增记录',
                                templateId, tableId, templateName: template.name, tableName: table.name,
                                label: `${table.name} / 新增记录`, oldValue: '', newValue: display, fieldValues: values, fieldDecisions, tagBundle,
                                valid: !policyError && entries.length > 0,
                                error: [policyError, ...blockedReasons].filter(Boolean).join('；'),
                                risk: getReviewRiskLevel(chat, template, table, 'add'), editable: false,
                                duplicateSuggestion, mergeTargetRowId: null,
                                fieldRoute: tableMode === 'candidate' ? 'candidate' : 'review'
                            });
                            return;
                        }

                        const targetRow = rowId ? findRowById(chat, templateId, table, rowId) : null;
                        const proposalStart = proposals.length;
                        Array.from(rowNode.querySelectorAll('field')).forEach(fieldNode => {
                            const fieldId = fieldNode.getAttribute('fieldId');
                            const field = (table.columns || []).find(item => item.id === fieldId);
                            if (!field) return;
                            const assessment = routeFor(field, table, fieldNode);
                            if (!allowedRoutes.has(assessment.route)) return;
                            const oldValue = targetRow?.cells?.[fieldId];
                            const newValue = normalizeFieldValue(field, fieldNode.textContent || '');
                            if (targetRow && isSameMemoryValue(oldValue, newValue)) return;
                            const blockedReason = !targetRow ? '目标行不存在'
                                : policy.updatePolicy.allowUpdate === false ? '该表禁止 AI 修改记录'
                                : field.aiEditable === false ? '字段禁止 AI 编辑'
                                : isFieldLocked(chat, templateId, tableId, fieldId) ? '字段已锁定'
                                : assessment.route === 'blocked' ? (assessment.reasons.join('；') || '字段策略阻止写入') : '';
                            proposals.push({
                                id: createMemoryId('proposal'), kind: 'row_update_field', actionLabel: assessment.route === 'candidate' ? '候选字段' : '修改字段',
                                templateId, tableId, templateName: template.name, tableName: table.name, rowId, fieldId,
                                label: `${table.name} / ${field.key}`, oldValue, newValue,
                                valid: !blockedReason, error: blockedReason,
                                risk: getReviewRiskLevel(chat, template, table, 'update'), editable: true, fieldType: field.type,
                                fieldPolicy: assessment.policy, fieldRoute: assessment.route,
                                evidence: assessment.sourceEvidence, confidence: assessment.confidence
                            });
                        });
                        const tagBundle = MemoryTagService.parseRowNode(rowNode);
                        if (tagBundle && (tableNeedsReview || proposals.length > proposalStart) && (!targetRow || !MemoryTagService.equals(targetRow.meta?.tagBundle, tagBundle))) {
                            proposals.push({
                                id: createMemoryId('proposal'), kind: 'row_tags', actionLabel: '更新标签',
                                templateId, tableId, templateName: template.name, tableName: table.name, rowId,
                                label: `${table.name} / 模型标签`, oldValue: targetRow?.meta?.tagBundle || {}, newValue: tagBundle, tagBundle,
                                valid: !!targetRow && policy.updatePolicy.allowUpdate !== false && !MemoryTagService.isLocked(targetRow),
                                error: !targetRow ? '目标行不存在' : (policy.updatePolicy.allowUpdate === false ? '该表禁止 AI 修改记录' : (MemoryTagService.isLocked(targetRow) ? '标签已锁定，不接受模型覆盖' : '')),
                                risk: 'low', editable: false, fieldRoute: 'review'
                            });
                        }
                    });
                    return;
                }

                Array.from(updateNode.children).filter(node => node.tagName === 'field').forEach(fieldNode => {
                    const fieldId = fieldNode.getAttribute('fieldId');
                    const field = (table.columns || []).find(item => item.id === fieldId);
                    if (!field) return;
                    const assessment = routeFor(field, table, fieldNode);
                    if (!allowedRoutes.has(assessment.route)) return;
                    const oldValue = getFieldValue(chat, templateId, tableId, field);
                    const newValue = normalizeFieldValue(field, fieldNode.textContent || '');
                    if (isSameMemoryValue(oldValue, newValue)) return;
                    const blockedReason = policy.updatePolicy.allowUpdate === false ? '该表禁止 AI 修改'
                        : field.aiEditable === false ? '字段禁止 AI 编辑'
                        : isFieldLocked(chat, templateId, tableId, fieldId) ? '字段已锁定'
                        : assessment.route === 'blocked' ? (assessment.reasons.join('；') || '字段策略阻止写入') : '';
                    proposals.push({
                        id: createMemoryId('proposal'), kind: 'field', actionLabel: assessment.route === 'candidate' ? '候选字段' : '更新字段',
                        templateId, tableId, templateName: template.name, tableName: table.name, fieldId,
                        label: `${table.name} / ${field.key}`, oldValue, newValue,
                        valid: !blockedReason, error: blockedReason,
                        risk: getReviewRiskLevel(chat, template, table, 'update'), editable: true, fieldType: field.type,
                        fieldPolicy: assessment.policy, fieldRoute: assessment.route,
                        evidence: assessment.sourceEvidence, confidence: assessment.confidence
                    });
                });
            });

            if (!proposals.length) return [];
            const grouped = new Map();
            proposals.forEach(proposal => {
                const key = `${proposal.templateId}::${proposal.tableId}`;
                if (!grouped.has(key)) grouped.set(key, []);
                grouped.get(key).push(proposal);
            });
            return Array.from(grouped.values()).map(tableProposals => {
                const first = tableProposals[0];
                const template = db.memoryTableTemplates.find(item => item.id === first.templateId);
                const table = template?.tables?.find(item => item.id === first.tableId);
                const tableState = MemoryPolicy ? MemoryPolicy.ensureTableState(chat, first.templateId, first.tableId) : null;
                return {
                    id: createMemoryId('memory_review'),
                    templateId: first.templateId,
                    tableId: first.tableId,
                    templateName: first.templateName,
                    tableName: first.tableName,
                    memoryLayer: table ? getTableRuntimePolicy(table, chat, template?.id || first.templateId).memoryLayer : (options.memoryLayer || ''),
                    range: { start: options.start || 1, end: options.end || (chat.history?.length || 0) },
                    source: options.source || 'api',
                    apiMode: options.apiMode || 'summary',
                    requestedApiMode: options.requestedApiMode || options.apiMode || 'summary',
                    apiFallback: !!options.apiFallback,
                    apiModel: options.apiModel || '',
                    sourceMessageCount: options.sourceMessageCount || 0,
                    historyPreview: options.historyPreview || '',
                    beforeTableState: tableState ? deepClone(tableState) : null,
                    rawContent: rawContent || '',
                    relatedContext: options.relatedContext || null,
                    fieldPolicyVersion: '2.14-R3',
                    proposals: tableProposals
                };
            });
        }
        function buildMemoryReviewBatch(chat, rawContent, options = {}) {
            return buildMemoryReviewBatches(chat, rawContent, options)[0] || null;
        }
        function applyAcceptedReviewProposals(chat, batch) {
            const accepted = (batch.proposals || []).filter(item => item.decision === 'accepted' && item.valid !== false);
            const changedFields = [];
            accepted.forEach(proposal => {
                const template = db.memoryTableTemplates.find(item => item.id === proposal.templateId);
                const sourceTable = template?.tables?.find(item => item.id === proposal.tableId);
                if (!template || !sourceTable) return;
                const table = getEffectiveTableDescriptor(sourceTable, chat, template.id);
                const policy = getTableRuntimePolicy(sourceTable, chat, template.id).updatePolicy;
                if (proposal.kind === 'row_add') {
                    if (proposal.mergeTargetRowId) {
                        if (policy.allowUpdate === false) return;
                        const target = findRowById(chat, template.id, table, proposal.mergeTargetRowId);
                        if (!target) return;
                        (table.columns || []).forEach(field => {
                            if (proposal.fieldValues?.[field.id] === undefined || field.aiEditable === false || isFieldLocked(chat, template.id, table.id, field.id)) return;
                            const nextValue = normalizeFieldValue(field, proposal.fieldValues[field.id]);
                            const oldValue = target.cells[field.id];
                            if (isSameMemoryValue(oldValue, nextValue)) return;
                            updateRowFieldValue(chat, template.id, table, target.id, field, nextValue, { source: 'review_merge_v2_14_r2', skipHistory: true });
                            changedFields.push({ templateId: template.id, tableId: table.id, rowId: target.id, fieldId: field.id, label: `${table.name} / ${field.key}（审核合并）`, oldValue, newValue: nextValue });
                        });
                        target.meta ||= {};
                        target.meta.updatedAt = Date.now();
                        target.meta.lastMentionedAt = Date.now();
                        target.meta.retrievalVector = [];
                        target.meta.retrievalVectorFingerprint = '';
                        if (proposal.tagBundle) {
                            const tagChange = MemoryTagService.applyToRow(target, proposal.tagBundle, { chat, source: 'review_v2_11_r1' });
                            if (tagChange.changed) changedFields.push({ templateId: template.id, tableId: table.id, rowId: target.id, fieldId: '__tags__', label: `${table.name} / 模型标签（审核合并）`, oldValue: tagChange.oldValue, newValue: tagChange.newValue });
                        }
                        if (MemoryLifecycle) MemoryLifecycle.recordSource(target, 'summary_api', { type: 'review_batch', id: batch.id, at: Date.now() });
                        return;
                    }
                    if (policy.allowAdd === false) return;
                    const added = addRow(chat, template.id, table, proposal.fieldValues || {}, { source: 'review_v2_2', skipHistory: true });
                    (table.columns || []).forEach(field => {
                        if (proposal.fieldValues?.[field.id] === undefined) return;
                        changedFields.push({ templateId: template.id, tableId: table.id, rowId: added.id, fieldId: field.id, label: `${table.name} / ${field.key}（审核新增）`, oldValue: '', newValue: added.cells[field.id] });
                    });
                    if (proposal.tagBundle) {
                        const tagChange = MemoryTagService.applyToRow(added, proposal.tagBundle, { chat, source: 'review_v2_11_r1' });
                        if (tagChange.changed) changedFields.push({ templateId: template.id, tableId: table.id, rowId: added.id, fieldId: '__tags__', label: `${table.name} / 模型标签（审核新增）`, oldValue: tagChange.oldValue, newValue: tagChange.newValue });
                    }
                    return;
                }
                if (proposal.kind === 'row_delete') {
                    if (policy.allowDelete !== true) return;
                    const row = findRowById(chat, template.id, table, proposal.rowId);
                    if (!row) return;
                    (table.columns || []).forEach(field => changedFields.push({ templateId: template.id, tableId: table.id, rowId: proposal.rowId, fieldId: field.id, label: `${table.name} / ${field.key}（审核删除）`, oldValue: row.cells[field.id], newValue: '' }));
                    deleteRow(chat, template.id, table, proposal.rowId, { source: 'review_v2_1', skipHistory: true });
                    return;
                }
                if (proposal.kind === 'row_tags') {
                    if (policy.allowUpdate === false) return;
                    const row = findRowById(chat, template.id, table, proposal.rowId);
                    if (!row) return;
                    const tagChange = MemoryTagService.applyToRow(row, proposal.tagBundle || proposal.newValue, { chat, source: 'review_v2_11_r1' });
                    if (tagChange.changed) changedFields.push({ templateId: template.id, tableId: table.id, rowId: row.id, fieldId: '__tags__', label: `${table.name} / 模型标签`, oldValue: tagChange.oldValue, newValue: tagChange.newValue });
                    return;
                }
                const field = (table.columns || []).find(item => item.id === proposal.fieldId);
                if (!field || field.aiEditable === false || isFieldLocked(chat, template.id, table.id, field.id) || policy.allowUpdate === false) return;
                const nextValue = normalizeFieldValue(field, proposal.editedValue !== undefined ? proposal.editedValue : proposal.newValue);
                if (proposal.kind === 'row_update_field') {
                    const row = findRowById(chat, template.id, table, proposal.rowId);
                    if (!row) return;
                    const oldValue = row.cells[field.id];
                    if (isSameMemoryValue(oldValue, nextValue)) return;
                    updateRowFieldValue(chat, template.id, table, row.id, field, nextValue, { source: 'review_update_v2_14_r2', skipHistory: true });
                    changedFields.push({ templateId: template.id, tableId: table.id, rowId: row.id, fieldId: field.id, label: `${table.name} / ${field.key}`, oldValue, newValue: nextValue });
                    return;
                }
                const oldValue = getFieldValue(chat, template.id, table.id, field);
                if (isSameMemoryValue(oldValue, nextValue)) return;
                setFieldValue(chat, template.id, table.id, field, nextValue, { source: 'review_update_v2_14_r2', skipHistory: true });
                changedFields.push({ templateId: template.id, tableId: table.id, fieldId: field.id, label: `${table.name} / ${field.key}`, oldValue, newValue: nextValue });
            });
            return changedFields;
        }
        function recordMemoryChangedFields(operationId, changedFields, options = {}) {
            const runtime = window.OVOOperationRuntime;
            if (!runtime?.recordMutations || !operationId) return [];
            return runtime.recordMutations(operationId, (Array.isArray(changedFields) ? changedFields : []).slice(0, 80).map(change => {
                const stringifyMutationValue = value => {
                    if (value == null) return '';
                    if (typeof value === 'object') { try { return JSON.stringify(value); } catch (_) {} }
                    return String(value);
                };
                const oldText = stringifyMutationValue(change?.oldValue);
                const newText = stringifyMutationValue(change?.newValue);
                const action = !oldText && newText ? 'create' : (oldText && !newText ? 'delete' : 'update');
                return {
                    action,
                    entityType: 'structured_memory',
                    entityId: change?.rowId || `${change?.templateId || ''}:${change?.tableId || ''}:${change?.fieldId || ''}`,
                    title: change?.label || options.title || '结构化档案变化',
                    summary: action === 'create' ? '新增档案内容' : action === 'delete' ? '删除档案内容' : '更新档案内容',
                    before: change?.oldValue,
                    after: change?.newValue,
                    fields: change?.fieldId ? [change.fieldId] : [],
                    meta: { characterId: options.characterId || null, templateId: change?.templateId || null, tableId: change?.tableId || null, rowId: change?.rowId || null, fieldId: change?.fieldId || null, batchId: options.batchId || null }
                };
            }));
        }
        function recordPendingReviewBatch(operationId, batch, characterId) {
            if (!window.OVOOperationRuntime?.recordMutation || !operationId || !batch) return null;
            const proposalCount = Array.isArray(batch.proposals) ? batch.proposals.length : 0;
            return window.OVOOperationRuntime.recordMutation(operationId, {
                action: 'pending',
                entityType: 'memory_review',
                entityId: batch.id,
                title: `${batch.tableName || '结构化档案'}待审核草案`,
                summary: `${proposalCount} 项建议等待用户确认`,
                status: 'pending',
                count: Math.max(1, proposalCount),
                meta: { characterId, templateId: batch.templateId || null, tableId: batch.tableId || null, range: batch.range || null, proposalCount }
            });
        }
        async function persistReviewMutationAtomically(chat, mutate, options = {}) {
            if (!chat) throw new Error('当前角色不存在');
            const persist = options.persist || (() => saveCharacter(chat.id));
            const rollbackPersist = options.rollbackPersist || persist;
            const writeLayer = typeof MemoryWriteGateway !== 'undefined' ? MemoryWriteGateway : MemoryWriteCoordinator;
            return writeLayer.run(chat, {
                reason: options.reason || 'review-transaction',
                writer: () => persist(),
                rollbackWriter: () => rollbackPersist(),
                persistRollback: options.persistRollback !== false
            }, async context => mutate(context));
        }
        function legacyCursorSnapshot(chat) {
            return {
                lastUpdateMsgId: chat?.memoryTables?.lastUpdateMsgId ?? null,
                lastUpdateMsgTimestamp: chat?.memoryTables?.lastUpdateMsgTimestamp ?? null,
                autoUpdateState: chat?.memoryTables?.autoUpdateState ?? 'idle',
                autoUpdatePending: !!chat?.memoryTables?.autoUpdatePending
            };
        }
        function restoreLegacyCursor(chat, snapshot) {
            if (!chat?.memoryTables || !snapshot) return;
            chat.memoryTables.lastUpdateMsgId = snapshot.lastUpdateMsgId ?? null;
            chat.memoryTables.lastUpdateMsgTimestamp = snapshot.lastUpdateMsgTimestamp ?? null;
            chat.memoryTables.autoUpdateState = snapshot.autoUpdateState || 'idle';
            chat.memoryTables.autoUpdatePending = !!snapshot.autoUpdatePending;
        }
        async function finalizeMemoryReviewBatch(chat, batchId, options = {}) {
            if (!chat || !MemoryReview) return { status: 'noop', changedFields: [] };
            const batch = MemoryReview.getPendingBatches(chat).find(item => item.id === batchId);
            if (!batch) throw new Error('找不到待审核草案');
            const result = await persistReviewMutationAtomically(chat, async () => {
                const beforeSnapshot = deepClone(chat.memoryTables.data || {});
                const beforeTableState = MemoryPolicy ? deepClone(MemoryPolicy.ensureTableState(chat, batch.templateId, batch.tableId)) : null;
                const beforeLegacyCursor = legacyCursorSnapshot(chat);
                if (options.rejectAll) MemoryReview.setAllDecisions(chat, batchId, 'rejected');
                const changedFields = options.rejectAll ? [] : applyAcceptedReviewProposals(chat, batch);
                if (changedFields.length) pushMemoryHistory(chat, changedFields, { source: 'review_v2_13_r54' });
                if (MemoryPolicy) {
                    MemoryPolicy.markTableProcessed(chat, batch.templateId, batch.tableId, batch.range?.end || 0, options.rejectAll ? 'review_rejected' : 'success');
                    MemoryPolicy.clearRetrievalCache(chat);
                }
                setMemoryTableAutoUpdateCursorByEndIndex(chat, batch.range?.end || 0);
                const tableState = MemoryPolicy ? MemoryPolicy.ensureTableState(chat, batch.templateId, batch.tableId) : null;
                const afterSnapshot = deepClone(chat.memoryTables.data || {});
                const appliedRecordCount = MemoryUpdateActivity.recordCount(changedFields);
                const completedStatus = options.rejectAll ? 'rejected_skipped' : 'applied';
                MemoryReview.completeBatch(chat, batchId, {
                    status: completedStatus,
                    appliedCount: changedFields.length,
                    appliedFieldCount: changedFields.length,
                    appliedRecordCount,
                    beforeSnapshot,
                    beforeTableState,
                    beforeLegacyCursor,
                    afterSignature: MemoryReview.dataSignature(afterSnapshot),
                    afterTableState: tableState ? deepClone(tableState) : null,
                    changedFields
                });
                if (MemoryTasks) MemoryTasks.resolveReviewBatch(chat, batchId, options.rejectAll ? 'rejected' : 'applied');
                return { status: completedStatus, changedFields, appliedRecordCount, appliedFieldCount: changedFields.length };
            }, options);
            selectMemoryView(chat, 'review');
            renderMemoryTableScreen();
            showToast(options.rejectAll
                ? '已拒绝并跳过这段消息；该范围不会再次自动整理'
                : `已保存 ${result.appliedRecordCount} 条记忆（${result.appliedFieldCount} 个字段）`);
            return result;
        }
        async function cancelMemoryReviewBatch(chat, batchId, options = {}) {
            if (!chat || !MemoryReview) return { status: 'noop' };
            const pending = MemoryReview.getPendingBatches(chat).find(item => item.id === batchId);
            if (!pending) return { status: 'noop' };
            const result = await persistReviewMutationAtomically(chat, async () => {
                const batch = MemoryReview.completeBatch(chat, batchId, {
                    status: 'cancelled_preserved',
                    appliedCount: 0,
                    appliedFieldCount: 0,
                    appliedRecordCount: 0
                });
                if (!batch) return { status: 'noop' };
                if (MemoryPolicy) {
                    const state = MemoryPolicy.ensureTableState(chat, batch.templateId, batch.tableId);
                    if (state.pendingReviewBatchId === batch.id) state.pendingReviewBatchId = null;
                    state.lastRunStatus = 'idle';
                    state.lastError = '';
                }
                if (MemoryTasks) MemoryTasks.resolveReviewBatch(chat, batchId, 'cancelled');
                return { status: 'cancelled_preserved' };
            }, options);
            renderMemoryTableScreen();
            showToast('已取消本次整理；消息范围仍保留，可稍后重新生成');
            return result;
        }
        async function rollbackMemoryReviewBatch(chat, batchId, options = {}) {
            if (!chat || !MemoryReview) return { status: 'noop' };
            const batch = MemoryReview.getCompletedBatches(chat).find(item => item.id === batchId);
            if (!batch || batch.status !== 'applied' || batch.rolledBack || !batch.beforeSnapshot) return { status: 'noop' };
            const currentSignature = MemoryReview.dataSignature(chat.memoryTables.data || {});
            const state = MemoryPolicy ? MemoryPolicy.ensureTableState(chat, batch.templateId, batch.tableId) : null;
            const cursorMatches = !state || !batch.afterTableState || state.lastProcessedMsgId === batch.afterTableState.lastProcessedMsgId;
            if (currentSignature !== batch.afterSignature || !cursorMatches) {
                showToast('之后已有新的档案变更或游标变化，无法安全整批回滚');
                return { status: 'blocked' };
            }
            const result = await persistReviewMutationAtomically(chat, async () => {
                replaceFormalData(chat, batch.beforeSnapshot, { source: 'review-batch-rollback', skipHistory: true });
                if (MemoryPolicy && batch.beforeTableState) {
                    const runtime = MemoryPolicy.ensureRuntimeState(chat);
                    runtime.tableStates[batch.templateId] ||= {};
                    runtime.tableStates[batch.templateId][batch.tableId] = deepClone(batch.beforeTableState);
                    MemoryPolicy.clearRetrievalCache(chat);
                }
                restoreLegacyCursor(chat, batch.beforeLegacyCursor);
                batch.rolledBack = true;
                batch.rolledBackAt = Date.now();
                return { status: 'rolled_back' };
            }, options);
            renderMemoryTableScreen();
            showToast('已安全回滚该审核批次');
            return result;
        }
        function applyMemoryUpdatesFromXml(chat, rawContent, options = {}) {
            ensureMemoryTableState(chat);
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(`<root>${rawContent || ''}</root>`, 'text/xml');
            if (xmlDoc.querySelector('parsererror')) throw new Error('结构化记忆返回格式解析失败');
            const updates = Array.from(xmlDoc.querySelectorAll('memory_update'));
            if (!updates.length) {
                chat.memoryTables.lastChangedFieldPaths = [];
                return [];
            }
            const allowedRoutes = new Set(Array.isArray(options.fieldPolicyRoutes) ? options.fieldPolicyRoutes : ['direct', 'runtime_only']);
            const changedFields = [];
            updates.forEach(updateNode => {
                const templateId = updateNode.getAttribute('templateId');
                const tableId = updateNode.getAttribute('tableId');
                if (Array.isArray(options.targetTemplateIds) && options.targetTemplateIds.length && !options.targetTemplateIds.includes(templateId)) return;
                const template = db.memoryTableTemplates.find(item => item.id === templateId);
                const sourceTable = template?.tables?.find(item => item.id === tableId);
                if (!template || !sourceTable) return;
                const table = getEffectiveTableDescriptor(sourceTable, chat, template.id);
                if (Array.isArray(options.targetTableKeys) && options.targetTableKeys.length && !options.targetTableKeys.includes(`${templateId}::${tableId}`)) return;
                const tablePolicy = getTableRuntimePolicy(sourceTable, chat, template.id);
                const updatePolicy = tablePolicy.updatePolicy;
                const tableDirect = (tablePolicy.commitPolicy?.mode || 'review') === 'direct';
                ensureTemplateDataForChat(chat, template);

                if (isRowsTable(table)) {
                    Array.from(updateNode.querySelectorAll('row')).forEach(rowNode => {
                        const op = (rowNode.getAttribute('op') || 'update').trim().toLowerCase();
                        const rowId = rowNode.getAttribute('rowId') || '';
                        if (op === 'delete') {
                            if (!tableDirect || updatePolicy.allowDelete !== true) return;
                            const existingRow = rowId ? findRowById(chat, templateId, table, rowId) : null;
                            if (!existingRow) return;
                            (table.columns || []).forEach(field => changedFields.push({
                                templateId, tableId, rowId, fieldId: field.id,
                                label: `${table.name} / ${field.key}（删除行）`, oldValue: existingRow.cells[field.id], newValue: ''
                            }));
                            deleteRow(chat, templateId, table, rowId, { source: options.source || 'api', skipHistory: true });
                            return;
                        }

                        if (op === 'add') {
                            if (updatePolicy.allowAdd === false) return;
                            const entries = [];
                            let deferred = !tableDirect;
                            Array.from(rowNode.querySelectorAll('field')).forEach(fieldNode => {
                                const fieldId = fieldNode.getAttribute('fieldId');
                                const field = (table.columns || []).find(item => item.id === fieldId);
                                if (!field || isFieldLocked(chat, templateId, tableId, fieldId)) return;
                                const assessment = assessMemoryField(field, table, fieldNode, { source: options.source });
                                if (!allowedRoutes.has(assessment.route)) {
                                    deferred = true;
                                    return;
                                }
                                entries.push({ field, assessment, value: normalizeFieldValue(field, fieldNode.textContent || '') });
                            });
                            if (deferred || !entries.length) return;
                            const initialValues = {};
                            entries.filter(entry => entry.assessment.route === 'direct').forEach(entry => { initialValues[entry.field.id] = entry.value; });
                            if (!Object.keys(initialValues).length) return;
                            const addedRow = addRow(chat, templateId, table, initialValues, { source: options.source || 'api_v2_14_r3', skipHistory: true });
                            entries.forEach(entry => {
                                if (entry.assessment.route === 'runtime_only') {
                                    storeRuntimeField(chat, templateId, tableId, addedRow.id, entry.field, entry.value, entry.assessment);
                                    return;
                                }
                                changedFields.push({
                                    templateId, tableId, rowId: addedRow.id, fieldId: entry.field.id,
                                    label: `${table.name} / ${entry.field.key}（新增行）`, oldValue: '', newValue: addedRow.cells[entry.field.id]
                                });
                            });
                            const tagBundle = MemoryTagService.parseRowNode(rowNode);
                            if (tagBundle) {
                                const tagChange = MemoryTagService.applyToRow(addedRow, tagBundle, { chat, source: options.source || 'api' });
                                if (tagChange.changed) changedFields.push({ templateId, tableId, rowId: addedRow.id, fieldId: '__tags__', label: `${table.name} / 模型标签（新增行）`, oldValue: tagChange.oldValue, newValue: tagChange.newValue });
                            }
                            return;
                        }

                        if (updatePolicy.allowUpdate === false) return;
                        const targetRow = rowId ? findRowById(chat, templateId, table, rowId) : null;
                        if (!targetRow) return;
                        let rowChanged = false;
                        let hasDeferred = false;
                        Array.from(rowNode.querySelectorAll('field')).forEach(fieldNode => {
                            const fieldId = fieldNode.getAttribute('fieldId');
                            const field = (table.columns || []).find(item => item.id === fieldId);
                            if (!field || isFieldLocked(chat, templateId, tableId, fieldId)) return;
                            const assessment = assessMemoryField(field, table, fieldNode, { source: options.source });
                            if (!allowedRoutes.has(assessment.route)) {
                                hasDeferred = true;
                                return;
                            }
                            const oldValue = targetRow.cells[field.id];
                            const newValue = normalizeFieldValue(field, fieldNode.textContent || '');
                            if (options.strategy === 'fill_empty' && !isEmptyMemoryValue(field, oldValue)) return;
                            if (assessment.route === 'runtime_only') {
                                storeRuntimeField(chat, templateId, tableId, targetRow.id, field, newValue, assessment);
                                return;
                            }
                            if (isSameMemoryValue(oldValue, newValue)) return;
                            updateRowFieldValue(chat, templateId, table, targetRow.id, field, newValue, { source: options.source || 'api_v2_14_r3', skipHistory: true });
                            targetRow.meta ||= {};
                            targetRow.meta.lastMentionedAt = Date.now();
                            rowChanged = true;
                            changedFields.push({ templateId, tableId, rowId, fieldId, label: `${table.name} / ${field.key}`, oldValue, newValue });
                        });
                        const tagBundle = MemoryTagService.parseRowNode(rowNode);
                        if (tagBundle && rowChanged && !hasDeferred) {
                            const tagChange = MemoryTagService.applyToRow(targetRow, tagBundle, { chat, source: options.source || 'api' });
                            if (tagChange.changed) changedFields.push({ templateId, tableId, rowId, fieldId: '__tags__', label: `${table.name} / 模型标签`, oldValue: tagChange.oldValue, newValue: tagChange.newValue });
                        }
                        if (rowChanged && MemoryLifecycle) MemoryLifecycle.recordSource(targetRow, options.source === 'manual' ? 'manual' : 'summary_api', { type: options.source === 'manual' ? 'manual' : 'review_batch', id: options.source || 'api', at: Date.now() }, { verified: options.source === 'manual' });
                    });
                    return;
                }

                if (updatePolicy.allowUpdate === false) return;
                Array.from(updateNode.children).filter(node => node.tagName === 'field').forEach(fieldNode => {
                    const fieldId = fieldNode.getAttribute('fieldId');
                    const field = (table.columns || []).find(item => item.id === fieldId);
                    if (!field || isFieldLocked(chat, templateId, tableId, fieldId)) return;
                    const assessment = assessMemoryField(field, table, fieldNode, { source: options.source });
                    if (!allowedRoutes.has(assessment.route)) return;
                    const oldValue = getFieldValue(chat, templateId, tableId, field);
                    const newValue = normalizeFieldValue(field, fieldNode.textContent || '');
                    if (options.strategy === 'fill_empty' && !isEmptyMemoryValue(field, oldValue)) return;
                    if (assessment.route === 'runtime_only') {
                        storeRuntimeField(chat, templateId, tableId, null, field, newValue, assessment);
                        return;
                    }
                    if (isSameMemoryValue(oldValue, newValue)) return;
                    setFieldValue(chat, templateId, tableId, field, newValue, { source: options.source || 'api_v2_14_r3', skipHistory: true });
                    changedFields.push({ templateId, tableId, fieldId, label: field.key, oldValue, newValue });
                });
            });
            pushMemoryHistory(chat, changedFields, { source: options.source || 'api' });
            if (changedFields.length && MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
            return changedFields;
        }

        return Object.freeze({
            VERSION,
            buildMemoryReviewBatches, buildMemoryReviewBatch, recordMemoryChangedFields, recordPendingReviewBatch, finalizeMemoryReviewBatch,
            cancelMemoryReviewBatch, rollbackMemoryReviewBatch, applyMemoryUpdatesFromXml
        });
    }

    Kernel.register('reviewOrchestrator', Object.freeze({ VERSION, create }));
})(window);
