(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Domain = Kernel.require('domain');
    const Policy = Kernel.require('policy');

    const VERSION = '2.14-R0';
    const UNIQUE_ROLES = new Set(['core_profile', 'current_state', 'tasks', 'recent_events', 'daily_observation', 'medium_summary', 'long_candidate', 'long_store']);
    const RELATION_KEYS = Object.freeze(['supersedes', 'supersededBy', 'conflictsWith', 'relatedTo']);
    const SEVERITY_WEIGHT = Object.freeze({ critical: 25, high: 12, medium: 5, low: 2, info: 0 });
    const SEVERITY_LABEL = Object.freeze({ critical: '严重', high: '高风险', medium: '需处理', low: '提示', info: '信息' });

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function makeIssue(code, severity, title, detail, scope = {}, suggestion = '') {
        return Object.freeze({ id: `${code}_${Core.hashText(JSON.stringify(scope) + detail)}`, code, severity, title, detail, scope, suggestion });
    }

    function duplicateValues(items, getter) {
        const map = new Map();
        items.forEach(item => {
            const key = String(getter(item) || '').trim();
            if (!key) return;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(item);
        });
        return Array.from(map.entries()).filter(([, values]) => values.length > 1);
    }

    function scan(chat, templates) {
        const allTemplates = Array.isArray(templates) ? templates.filter(Boolean) : Domain.getBoundTemplates(chat);
        const issues = [];
        const add = (...args) => issues.push(makeIssue(...args));
        const boundIds = new Set(chat?.memoryTables?.boundTemplateIds || []);
        const history = Array.isArray(chat?.history) ? chat.history : [];
        const historyIds = new Set(history.map(item => String(item?.id || '')).filter(Boolean));
        const runtime = chat?.memoryTables || {};
        const roundIds = new Set((runtime.rounds || []).map(item => String(item?.id || '')).filter(Boolean));
        const pendingReviewIds = new Set((chat?.memoryTables?.reviewState?.pendingBatches || []).map(item => String(item?.id || '')).filter(Boolean));
        const templateById = new Map(allTemplates.map(template => [template.id, template]));
        const tableIndex = new Map();
        const fieldIndex = new Map();
        const rowIndex = new Map();
        let tableCount = 0;
        let fieldCount = 0;
        let rowCount = 0;

        duplicateValues(allTemplates, item => item.id).forEach(([id, values]) => add('duplicate_template_id', 'critical', '模板 ID 重复', `${values.length} 个模板共用了同一个内部标识。`, { templateId: id }, '为重复模板重新生成 ID，并重映射角色绑定。'));
        boundIds.forEach(id => {
            if (!templateById.has(id)) add('missing_bound_template', 'high', '角色绑定了不存在的模板', '当前角色仍保存着失效的模板绑定。', { templateId: id }, '解除失效绑定，或恢复对应模板。');
        });
        Object.keys(chat?.memoryTables?.data || {}).forEach(id => {
            if (!templateById.has(id)) add('orphan_template_data', 'high', '存在孤立的模板数据', '正式记忆数据找不到对应模板结构。', { templateId: id }, '导出备份后，恢复模板或清理孤立数据。');
        });

        const roleOwners = new Map();
        allTemplates.forEach(template => {
            const tables = Array.isArray(template.tables) ? template.tables : [];
            duplicateValues(tables, item => item.id).forEach(([id, values]) => add('duplicate_table_id', 'critical', '表格 ID 重复', `${template.name || '模板'}中有 ${values.length} 张表共用内部标识。`, { templateId: template.id, tableId: id }, '重新生成重复表格 ID，并重映射引用。'));
            tables.forEach(table => {
                tableCount += 1;
                tableIndex.set(`${template.id}::${table.id}`, { template, table });
                const role = Policy.normalizeSystemRole(table.systemRole, table);
                if (UNIQUE_ROLES.has(role)) {
                    if (!roleOwners.has(role)) roleOwners.set(role, []);
                    roleOwners.get(role).push({ template, table });
                }
                const fields = Array.isArray(table.columns) ? table.columns : [];
                fieldCount += fields.length;
                duplicateValues(fields, item => item.id).forEach(([id, values]) => add('duplicate_field_id', 'critical', '字段 ID 重复', `${table.name || '表格'}中有 ${values.length} 个字段共用内部标识。`, { templateId: template.id, tableId: table.id, fieldId: id }, '重新生成重复字段 ID，并重映射数据和锁定状态。'));
                fields.forEach(field => fieldIndex.set(`${template.id}::${table.id}::${field.id}`, { template, table, field }));

                if (role === 'long_candidate' || table.commitPolicy?.mode === 'promotion') {
                    const targetId = String(table.promotionPolicy?.targetTableId || '').trim();
                    const target = tables.find(item => item.id === targetId);
                    if (!targetId) add('promotion_target_missing', 'critical', '长期候选没有晋升目标', `${table.name || '长期候选表'}无法安全批准。`, { templateId: template.id, tableId: table.id }, '在表格策略中显式选择稳定长期库。');
                    else if (!target) add('promotion_target_orphan', 'critical', '长期晋升目标不存在', `${table.name || '长期候选表'}指向了当前模板中不存在的表。`, { templateId: template.id, tableId: table.id, targetTableId: targetId }, '重新选择有效的稳定长期库。');
                    else {
                        const targetRole = Policy.normalizeSystemRole(target.systemRole, target);
                        if (target.id === table.id) add('promotion_target_self', 'critical', '长期候选指向自身', '批准会形成自循环，不能产生正式长期记忆。', { templateId: template.id, tableId: table.id }, '将目标改为稳定长期库。');
                        else if (targetRole !== 'long_store' || !Domain.isRowsTable(target)) add('promotion_target_invalid', 'high', '长期晋升目标类型不正确', `目标“${target.name || '未命名表'}”不是稳定长期行表。`, { templateId: template.id, tableId: table.id, targetTableId: target.id }, '目标应为职责“稳定长期库”的多行表。');
                    }
                }

                const data = chat?.memoryTables?.data?.[template.id]?.[table.id];
                const fieldIds = new Set(fields.map(field => field.id));
                const locked = chat?.memoryTables?.lockedFields?.[template.id]?.[table.id] || [];
                locked.filter(id => !fieldIds.has(id)).forEach(id => add('orphan_locked_field', 'medium', '字段锁定指向不存在的字段', `${table.name || '表格'}保留了失效的锁定记录。`, { templateId: template.id, tableId: table.id, fieldId: id }, '移除孤立锁定项。'));
                if (Domain.isRowsTable(table)) {
                    const rows = Array.isArray(data?.__rows) ? data.__rows : [];
                    duplicateValues(rows, item => item?.id).forEach(([id, values]) => add('duplicate_row_id', 'critical', '记忆行 ID 重复', `${table.name || '表格'}中有 ${values.length} 条记忆共用标识。`, { templateId: template.id, tableId: table.id, rowId: id }, '为重复行生成新 ID，并重映射关系。'));
                    const exactTexts = new Map();
                    rows.forEach(row => {
                        rowCount += 1;
                        if (row?.id) rowIndex.set(String(row.id), { template, table, row });
                        Object.keys(row?.cells || {}).filter(id => !fieldIds.has(id)).forEach(id => add('orphan_row_cell', 'medium', '记忆行含有孤立字段值', `${table.name || '表格'}的一条记忆仍保存已删除字段的数据。`, { templateId: template.id, tableId: table.id, rowId: row?.id, fieldId: id }, '预览内容后删除孤立字段值，或恢复字段结构。'));
                        const text = normalizeText(Domain.getRowSearchText(table, row));
                        if (text) {
                            if (!exactTexts.has(text)) exactTexts.set(text, []);
                            exactTexts.get(text).push(row);
                        }
                    });
                    exactTexts.forEach(values => {
                        if (values.length > 1) add('exact_duplicate_rows', 'medium', '发现内容完全相同的记忆', `${table.name || '表格'}中有 ${values.length} 条内容完全一致的记录。`, { templateId: template.id, tableId: table.id, rowIds: values.map(item => item.id) }, '在关系检查中合并或归档重复记录。');
                    });
                } else if (data && typeof data === 'object') {
                    Object.keys(data).filter(id => !fieldIds.has(id)).forEach(id => add('orphan_kv_cell', 'medium', 'KV 表含有孤立字段值', `${table.name || '表格'}仍保存已删除字段的数据。`, { templateId: template.id, tableId: table.id, fieldId: id }, '预览后删除孤立值，或恢复对应字段。'));
                }
            });
        });

        roleOwners.forEach((owners, role) => {
            if (owners.length < 2) return;
            add('duplicate_bound_role', 'high', '当前角色存在重复表格职责', `职责“${role}”同时由 ${owners.length} 张表承担，自动路由可能选错目标。`, { role, tables: owners.map(item => item.table.id) }, '每个唯一职责只保留一张绑定表。');
        });

        rowIndex.forEach(({ template, table, row }) => {
            const relations = row?.meta?.relations || {};
            RELATION_KEYS.forEach(key => (Array.isArray(relations[key]) ? relations[key] : []).forEach(id => {
                if (!rowIndex.has(String(id))) add('orphan_relation', 'high', '记忆关系指向不存在的记录', `${table.name || '表格'}中的关系“${key}”已失效。`, { templateId: template.id, tableId: table.id, rowId: row.id, targetRowId: id }, '移除孤立关系，或恢复目标记忆。');
            }));
            const workflow = row?.meta?.workflow;
            if (workflow?.promotedToTableId || workflow?.promotedToRowId) {
                const targetTable = tableIndex.get(`${workflow.promotedToTemplateId || template.id}::${workflow.promotedToTableId}`);
                const targetRow = rowIndex.get(String(workflow.promotedToRowId || ''));
                if (!targetTable || !targetRow) add('orphan_promotion_trace', 'high', '晋升追踪已断开', `${table.name || '候选表'}中的批准记录找不到正式长期记忆。`, { templateId: template.id, tableId: table.id, rowId: row.id }, '将候选标记为待重新核验，或重新关联正式记录。');
            }
            const sourceIds = Array.isArray(row?.meta?.sourceMessageIds) ? row.meta.sourceMessageIds : [];
            if (sourceIds.length && sourceIds.every(id => !historyIds.has(String(id)))) add('stale_message_sources', 'low', '记忆来源消息不在当前聊天', `${table.name || '表格'}中的一条记忆保留了其他聊天或已删除消息的引用。`, { templateId: template.id, tableId: table.id, rowId: row.id }, '若为跨角色导入，保留内容但清空消息引用。');
        });

        const sidecar = chat?.memoryTables?.sidecar || {};
        (Array.isArray(sidecar.candidates) ? sidecar.candidates : []).forEach(candidate => {
            if (candidate?.status === 'processed' || candidate?.status === 'legacy_unverified') add('legacy_candidate', 'medium', '存在去向未验证的旧候选', '候选曾被标记为已整理，但无法证明保存到了哪条正式记忆。', { candidateId: candidate?.id }, '重新保存、忽略或删除该候选。');
            if (['promoted', 'merged'].includes(candidate?.status)) {
                const tableRef = tableIndex.get(`${candidate.targetTemplateId}::${candidate.targetTableId}`);
                const rowRef = rowIndex.get(String(candidate.targetRowId || ''));
                if (!tableRef || !rowRef) add('orphan_candidate_target', 'high', '短期候选的正式目标不存在', '已保存或已合并候选找不到对应正式记忆。', { candidateId: candidate?.id }, '将候选改为待重新核验，并重新选择目标。');
            }
            if (candidate?.sourceRoundId && !roundIds.has(String(candidate.sourceRoundId))) add('stale_candidate_round', 'low', '候选引用了不存在的聊天轮次', '候选可能来自其他角色或旧运行态。', { candidateId: candidate?.id }, '跨角色迁移时清空轮次引用。');
        });

        Object.entries(runtime.tableStates || {}).forEach(([templateId, states]) => {
            Object.entries(states || {}).forEach(([tableId, state]) => {
                if (!tableIndex.has(`${templateId}::${tableId}`)) add('orphan_runtime_state', 'medium', '存在孤立表格运行状态', '游标和运行结果找不到对应表格。', { templateId, tableId }, '移除孤立运行态。');
                if (state?.lastProcessedMsgId && !historyIds.has(String(state.lastProcessedMsgId)) && !state.lastProcessedMsgTimestamp) add('invalid_message_cursor', 'medium', '表格消息游标已失效', '游标指向不存在的消息且没有时间兜底。', { templateId, tableId }, '将游标重置到开头或最新。');
                if (state?.lastProcessedRoundId && !roundIds.has(String(state.lastProcessedRoundId))) add('invalid_round_cursor', 'low', '表格轮次游标已失效', '运行态引用了不存在的记忆轮次。', { templateId, tableId }, '重置轮次游标。');
                if (state?.pendingReviewBatchId && !pendingReviewIds.has(String(state.pendingReviewBatchId))) add('orphan_pending_review', 'high', '表格等待一个不存在的审核批次', '该表可能一直显示等待审核，却没有可打开的草案。', { templateId, tableId }, '清空等待状态，并根据游标重新生成草案。');
            });
        });

        (chat?.memoryTables?.reviewState?.pendingBatches || []).forEach(batch => {
            if (!tableIndex.has(`${batch.templateId}::${batch.tableId}`)) add('orphan_review_batch', 'high', '审核草案的目标表不存在', '该草案无法安全应用。', { batchId: batch.id, templateId: batch.templateId, tableId: batch.tableId }, '取消草案并保留范围，或恢复目标表。');
        });
        if (!chat?.memoryTables?.lifecycle?.lastMaintenanceAt) add('maintenance_never_run', 'info', '尚未运行记忆健康维护', '当前只完成结构完整性扫描，生命周期过期与冲突维护尚无运行记录。', {}, '确认结构完整后，再运行低频生命周期维护。');

        const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
        issues.forEach(issue => { counts[issue.severity] = (counts[issue.severity] || 0) + 1; });
        const score = Math.max(0, 100 - issues.reduce((sum, issue) => sum + (SEVERITY_WEIGHT[issue.severity] || 0), 0));
        return Object.freeze({
            type: 'memory_integrity_report', version: VERSION, generatedAt: Date.now(), characterId: chat?.id || '',
            summary: Object.freeze({ score, issueCount: issues.length, counts: Object.freeze(counts), templateCount: allTemplates.length, tableCount, fieldCount, rowCount }),
            issues: Object.freeze(issues)
        });
    }

    function renderView(chat, templates) {
        const report = scan(chat, templates);
        const summary = report.summary;
        const severityOrder = ['critical', 'high', 'medium', 'low', 'info'];
        const groups = severityOrder.map(severity => [severity, report.issues.filter(item => item.severity === severity)]).filter(([, items]) => items.length);
        const issueHtml = groups.length ? groups.map(([severity, items]) => `
            <section class="memory-integrity-group">
                <header><strong>${SEVERITY_LABEL[severity]}</strong><span>${items.length} 项</span></header>
                ${items.map(item => `<article class="memory-integrity-item memory-integrity-${severity}">
                    <div><strong>${Core.escapeHtml(item.title)}</strong><p>${Core.escapeHtml(item.detail)}</p>${item.suggestion ? `<small>建议：${Core.escapeHtml(item.suggestion)}</small>` : ''}</div>
                    <code>${Core.escapeHtml(item.code)}</code>
                </article>`).join('')}
            </section>`).join('') : '<div class="memory-integrity-empty"><strong>没有发现结构断点</strong><p>当前模板、正式数据、候选、审核和运行引用均可闭合。</p></div>';
        return `<div class="memory-integrity-view">
            <div class="memory-integrity-head"><div><h3>记忆完整性医生</h3><p>只读扫描，不会修改任何记忆。检查结构、引用、目标、游标和候选闭环。</p></div><div class="memory-integrity-actions"><button type="button" class="btn btn-small btn-secondary" data-action="integrity-rescan">重新扫描</button><button type="button" class="btn btn-small btn-primary" data-action="integrity-export">导出报告</button></div></div>
            <div class="memory-integrity-score"><strong>${summary.score}</strong><span>完整性分数</span><div>${summary.issueCount ? `发现 ${summary.issueCount} 项：严重 ${summary.counts.critical} · 高风险 ${summary.counts.high} · 需处理 ${summary.counts.medium}` : '结构引用完整'}</div></div>
            <div class="memory-integrity-metrics"><span>${summary.templateCount} 个模板</span><span>${summary.tableCount} 张表</span><span>${summary.fieldCount} 个字段</span><span>${summary.rowCount} 条行记忆</span></div>
            ${issueHtml}
        </div>`;
    }

    Kernel.register('integrityDoctor', Object.freeze({ VERSION, scan, renderView, SEVERITY_LABEL }));
})(window);
