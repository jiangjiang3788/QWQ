(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Domain = Kernel.require('domain');
    const Review = Kernel.get('review');
    const Lifecycle = Kernel.get('lifecycle');
    const Tasks = Kernel.get('tasks');
    const Sidecar = Kernel.get('sidecar');
    const Feedback = Kernel.get('feedback');
    const Policy = Kernel.get('policy');
    const CandidateService = Kernel.require('candidateService');
    const SidecarCandidateService = Kernel.require('sidecarCandidateService');

    const VERSION = '2.14-R8';
    const PROTOCOL_VERSION = 1;
    const TYPES = Object.freeze({
        UPDATE_REVIEW: 'update_review',
        SHORT_CANDIDATE: 'short_candidate',
        LONG_CANDIDATE: 'long_candidate',
        RELIABILITY_REVIEW: 'reliability_review',
        CONFLICT_REVIEW: 'conflict_review',
        FAILED_TASK: 'failed_task',
        PAUSED_TASK: 'paused_task',
        RETRIEVAL_FEEDBACK: 'retrieval_feedback'
    });
    const CATEGORIES = Object.freeze({
        review: '更新',
        candidate: '候选',
        reliability: '复核',
        system: '队列'
    });
    const RISKS = new Set(['high', 'medium', 'low']);

    function normalizeAction(action) {
        if (!action) return null;
        if (typeof action === 'string') return Object.freeze({ id: action, label: action, tone: 'secondary', params: {} });
        const id = String(action.id || '').trim();
        if (!id) return null;
        return Object.freeze({
            id,
            label: String(action.label || id),
            tone: ['primary', 'secondary', 'neutral', 'danger', 'text', 'text-danger'].includes(action.tone) ? action.tone : 'secondary',
            params: action.params && typeof action.params === 'object' ? { ...action.params } : {}
        });
    }

    function normalize(input) {
        const source = input || {};
        const item = {
            protocolVersion: PROTOCOL_VERSION,
            id: String(source.id || Core.createId('memory_work_item')),
            type: String(source.type || 'unknown'),
            category: CATEGORIES[source.category] ? source.category : 'system',
            sourceRef: source.sourceRef && typeof source.sourceRef === 'object' ? Core.clone(source.sourceRef) : {},
            title: String(source.title || '待处理事项'),
            reason: String(source.reason || source.detail || ''),
            detail: String(source.detail || source.reason || ''),
            meta: String(source.meta || ''),
            risk: RISKS.has(source.risk) ? source.risk : 'low',
            status: String(source.status || 'pending'),
            createdAt: Number(source.createdAt) || Date.now(),
            availableActions: (source.availableActions || []).map(normalizeAction).filter(Boolean),
            selectable: source.selectable === true,
            payload: source.payload && typeof source.payload === 'object' ? source.payload : {}
        };
        return Object.freeze(item);
    }

    function tablePolicy(table) {
        return Policy?.normalizeTablePolicy?.(table) || { memoryLayer: table?.memoryLayer || 'long' };
    }

    function rowText(table, row) {
        const text = Lifecycle?.textForRow?.(table, row) || Domain.getRowSearchText(table, row) || '';
        return String(text || '').replace(/\s+/g, ' ').trim();
    }

    function reviewItems(chat, now) {
        return (Review?.getPendingBatches?.(chat) || []).map(batch => {
            const proposals = batch.proposals || [];
            const highRisk = proposals.filter(item => item.risk === 'high').length;
            const summary = Review?.getBatchChangeSummary?.(batch);
            const recordCount = Number(summary?.recordCount) || 0;
            const fieldCount = Number(summary?.fieldCount) || proposals.length;
            return normalize({
                id: `review:${batch.id}`,
                type: TYPES.UPDATE_REVIEW,
                category: 'review',
                risk: highRisk ? 'high' : 'medium',
                title: batch.tableName || '结构化档案更新',
                reason: `${recordCount || proposals.length} 条记忆等待确认`,
                detail: `${recordCount || proposals.length} 条记忆 · ${fieldCount} 个字段${highRisk ? ` · ${highRisk} 项高风险` : ''}`,
                meta: `${batch.sourceMessageCount || 0} 条消息 · ${batch.relatedContext?.rowCount || 0} 行相关记忆`,
                createdAt: batch.createdAt || now,
                sourceRef: { kind: 'review_batch', batchId: batch.id, templateId: batch.templateId || '', tableId: batch.tableId || '' },
                availableActions: [{ id: 'open-review', label: '进入审核', tone: 'primary', params: { batchId: batch.id } }]
            });
        });
    }

    function tableItems(chat, templates, now) {
        const items = [];
        (templates || []).forEach(template => {
            (template.tables || []).forEach(table => {
                if (!Domain.isRowsTable(table)) return;
                const policy = tablePolicy(table);
                Domain.getRows(chat, template.id, table).forEach((row, rowIndex) => {
                    if (policy.memoryLayer === 'review' && CandidateService.isPending(table, row)) {
                        items.push(normalize({
                            id: `candidate:${row.id}`,
                            type: TYPES.LONG_CANDIDATE,
                            category: 'candidate',
                            risk: 'medium',
                            title: table.name,
                            reason: '长期候选等待批准或拒绝',
                            detail: rowText(table, row).slice(0, 220) || '长期记忆候选',
                            meta: `第 ${rowIndex + 1} 行 · ${CandidateService.statusText(table, row) || '待审核'}`,
                            createdAt: row.meta?.updatedAt || row.meta?.createdAt || now,
                            sourceRef: { kind: 'long_candidate', templateId: template.id, tableId: table.id, rowId: row.id },
                            payload: { template, table, row, status: 'pending' },
                            availableActions: [
                                { id: 'approve-candidate', label: '批准', tone: 'primary' },
                                { id: 'open-row', label: '查看', tone: 'secondary' },
                                { id: 'reject-candidate', label: '拒绝', tone: 'text-danger' }
                            ]
                        }));
                        return;
                    }
                    const meta = Lifecycle?.ensureRowMeta?.(row, table, rowText(table, row)) || row.meta || {};
                    const life = meta.lifecycle || {};
                    const status = life.status || meta.status || 'active';
                    const due = !!((life.reviewAt && life.reviewAt <= now) || (life.expiresAt && life.expiresAt <= now));
                    if (!(['uncertain', 'conflicting', 'expired'].includes(status) || due)) return;
                    const conflict = status === 'conflicting';
                    const reason = conflict ? '存在未解决冲突'
                        : status === 'expired' ? '记忆已过期'
                            : status === 'uncertain' ? '记忆可信度待确认'
                                : '到达复核日期';
                    const actions = [];
                    if (!conflict) actions.push({ id: 'confirm-row', label: '确认有效', tone: 'primary' });
                    actions.push({ id: 'open-row', label: '查看', tone: 'secondary' });
                    actions.push({ id: 'snooze-row', label: '30 天后', tone: 'text' });
                    actions.push({ id: 'archive-row', label: '归档', tone: 'text-danger' });
                    items.push(normalize({
                        id: `reliability:${row.id}`,
                        type: conflict ? TYPES.CONFLICT_REVIEW : TYPES.RELIABILITY_REVIEW,
                        category: 'reliability',
                        risk: ['conflicting', 'expired'].includes(status) ? 'high' : 'medium',
                        title: table.name,
                        reason,
                        detail: rowText(table, row).slice(0, 220) || reason,
                        meta: `${reason} · 第 ${rowIndex + 1} 行`,
                        createdAt: life.reviewAt || life.expiresAt || row.meta?.updatedAt || now,
                        sourceRef: { kind: conflict ? 'conflict' : 'reliability', templateId: template.id, tableId: table.id, rowId: row.id },
                        payload: { template, table, row, status, due },
                        selectable: !conflict,
                        availableActions: actions
                    }));
                });
            });
        });
        return items;
    }

    function shortCandidateItems(chat, now) {
        SidecarCandidateService.migrateLegacyCandidates(chat);
        const state = Sidecar?.ensureState?.(chat);
        return (state?.candidates || [])
            .filter(candidate => SidecarCandidateService.ACTIONABLE.has(candidate.status))
            .map(candidate => normalize({
                id: `short-candidate:${candidate.id}`,
                type: TYPES.SHORT_CANDIDATE,
                category: 'candidate',
                risk: candidate.status === 'legacy_unverified' ? 'medium' : 'low',
                title: candidate.type === 'daily_observation' ? '日常观察候选' : '近期经历候选',
                reason: candidate.status === 'legacy_unverified' ? '旧版去向尚未验证' : '聊天候选等待整理',
                detail: String(candidate.summary || '').slice(0, 220) || '短期记忆候选',
                meta: `${SidecarCandidateService.statusLabel(candidate.status)} · 置信度 ${Number(candidate.confidence) || 0}`,
                createdAt: candidate.createdAt || now,
                sourceRef: { kind: 'short_candidate', candidateId: candidate.id },
                payload: { candidate },
                availableActions: [{ id: 'open-view', label: '打开候选', tone: 'secondary', params: { view: 'sidecar' } }]
            }));
    }

    function taskItems(chat, now) {
        const state = Tasks?.ensureState?.(chat);
        return (state?.tasks || [])
            .filter(task => ['failed', 'paused'].includes(task.status))
            .map(task => normalize({
                id: `task:${task.id}`,
                type: task.status === 'failed' ? TYPES.FAILED_TASK : TYPES.PAUSED_TASK,
                category: 'system',
                risk: task.status === 'failed' ? 'high' : 'low',
                title: task.title || '后台记忆任务',
                reason: task.status === 'failed' ? '任务执行失败，需要重试或取消' : '任务已暂停',
                detail: task.lastError || `${task.type || '记忆任务'} · 尝试 ${Number(task.attempts) || 0}/${Number(task.maxAttempts) || 0}`,
                meta: task.status === 'failed' ? '失败任务' : '暂停任务',
                createdAt: task.createdAt || now,
                sourceRef: { kind: 'task', taskId: task.id },
                payload: { task },
                availableActions: [{ id: 'open-view', label: '打开队列', tone: task.status === 'failed' ? 'primary' : 'secondary', params: { view: 'tasks' } }]
            }));
    }

    function feedbackItems(chat, now) {
        const count = Feedback?.getPendingCount?.(chat) || 0;
        if (!count) return [];
        return [normalize({
            id: 'feedback:pending',
            type: TYPES.RETRIEVAL_FEEDBACK,
            category: 'system',
            risk: 'low',
            title: '记忆引用与作用',
            reason: '本轮召回结果等待反馈',
            detail: `${count} 项引用等待反馈`,
            meta: '按来源表核对引用原因和使用效果',
            createdAt: now,
            sourceRef: { kind: 'retrieval_feedback' },
            availableActions: [
                { id: 'open-view', label: '打开', tone: 'secondary', params: { view: 'usage_audit' } },
                { id: 'clear-feedback-tasks', label: '清空待反馈', tone: 'text-danger' }
            ]
        })];
    }

    function collect(chat, templates, options = {}) {
        if (!chat) return [];
        const now = Number(options.now) || Date.now();
        const items = [
            ...reviewItems(chat, now),
            ...tableItems(chat, templates, now),
            ...shortCandidateItems(chat, now),
            ...taskItems(chat, now),
            ...feedbackItems(chat, now)
        ];
        const order = { high: 0, medium: 1, low: 2 };
        return items.sort((a, b) => (order[a.risk] ?? 9) - (order[b.risk] ?? 9) || (b.createdAt || 0) - (a.createdAt || 0));
    }

    function validate(item) {
        const errors = [];
        if (!item || typeof item !== 'object') errors.push('待处理项不是对象');
        if (item?.protocolVersion !== PROTOCOL_VERSION) errors.push('待处理协议版本不匹配');
        if (!item?.id) errors.push('缺少待处理项 ID');
        if (!item?.type) errors.push('缺少待处理项类型');
        if (!item?.sourceRef || typeof item.sourceRef !== 'object') errors.push('缺少来源引用');
        if (!Array.isArray(item?.availableActions)) errors.push('缺少可用操作');
        return { ok: errors.length === 0, errors };
    }

    Kernel.register('workItem', Object.freeze({
        VERSION,
        PROTOCOL_VERSION,
        TYPES,
        CATEGORIES,
        normalize,
        collect,
        validate
    }));
})(window);
