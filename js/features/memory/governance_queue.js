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

    const viewState = {
        filter: 'all',
        query: '',
        selected: new Set()
    };

    const FILTERS = Object.freeze([
        ['all', '全部'],
        ['review', '更新'],
        ['candidate', '候选'],
        ['reliability', '复核'],
        ['system', '队列']
    ]);

    function tablePolicy(table) {
        return Policy?.normalizeTablePolicy?.(table) || { memoryLayer: table?.memoryLayer || 'long' };
    }

    function rowText(table, row) {
        const text = Lifecycle?.textForRow?.(table, row) || Domain.getRowSearchText(table, row) || '';
        return String(text || '').replace(/\s+/g, ' ').trim();
    }


    function scan(chat, templates, options = {}) {
        const now = Number(options.now) || Date.now();
        const items = [];
        (Review?.getPendingBatches?.(chat) || []).forEach(batch => {
            const proposals = batch.proposals || [];
            const highRisk = proposals.filter(item => item.risk === 'high').length;
            items.push({
                id: `review:${batch.id}`,
                kind: 'review_batch',
                category: 'review',
                priority: highRisk ? 'high' : 'medium',
                title: batch.tableName || '结构化档案更新',
                detail: `${proposals.length} 项建议${highRisk ? ` · ${highRisk} 项高风险` : ''}`,
                meta: `${batch.sourceMessageCount || 0} 条消息 · ${batch.relatedContext?.rowCount || 0} 行相关记忆`,
                createdAt: batch.createdAt || now,
                batchId: batch.id,
                selectable: false
            });
        });

        (templates || []).forEach(template => {
            (template.tables || []).forEach(table => {
                if (!Domain.isRowsTable(table)) return;
                const policy = tablePolicy(table);
                Domain.getRows(chat, template.id, table).forEach((row, rowIndex) => {
                    if (policy.memoryLayer === 'review' && CandidateService.isPending(table, row)) {
                        items.push({
                            id: `candidate:${row.id}`,
                            kind: 'candidate',
                            category: 'candidate',
                            priority: 'medium',
                            title: table.name,
                            detail: rowText(table, row).slice(0, 220) || '长期记忆候选',
                            meta: `第 ${rowIndex + 1} 行 · ${CandidateService.statusText(table, row) || '待审核'}`,
                            createdAt: row.meta?.updatedAt || row.meta?.createdAt || now,
                            templateId: template.id,
                            tableId: table.id,
                            rowId: row.id,
                            template,
                            table,
                            row,
                            selectable: false
                        });
                        return;
                    }
                    const meta = Lifecycle?.ensureRowMeta?.(row, table, rowText(table, row)) || row.meta || {};
                    const life = meta.lifecycle || {};
                    const status = life.status || meta.status || 'active';
                    const due = !!((life.reviewAt && life.reviewAt <= now) || (life.expiresAt && life.expiresAt <= now));
                    if (!(['uncertain', 'conflicting', 'expired'].includes(status) || due)) return;
                    const reason = status === 'conflicting' ? '存在未解决冲突'
                        : status === 'expired' ? '记忆已过期'
                            : status === 'uncertain' ? '记忆可信度待确认'
                                : '到达复核日期';
                    items.push({
                        id: `reliability:${row.id}`,
                        kind: 'reliability',
                        category: 'reliability',
                        priority: ['conflicting', 'expired'].includes(status) ? 'high' : 'medium',
                        title: table.name,
                        detail: rowText(table, row).slice(0, 220) || reason,
                        meta: `${reason} · 第 ${rowIndex + 1} 行`,
                        createdAt: life.reviewAt || life.expiresAt || row.meta?.updatedAt || now,
                        templateId: template.id,
                        tableId: table.id,
                        rowId: row.id,
                        template,
                        table,
                        row,
                        status,
                        due,
                        selectable: status !== 'conflicting'
                    });
                });
            });
        });

        const taskCounts = Tasks?.getCounts?.(chat) || {};
        const taskAttention = (taskCounts.failed || 0) + (taskCounts.queued || 0) + (taskCounts.paused || 0);
        if (taskAttention) items.push({
            id: 'system:tasks', kind: 'system', category: 'system', priority: taskCounts.failed ? 'high' : 'low',
            title: '后台任务队列', detail: `失败 ${taskCounts.failed || 0} · 排队 ${taskCounts.queued || 0} · 暂停 ${taskCounts.paused || 0}`,
            meta: '集中处理失败、重试与暂停任务', createdAt: now, targetView: 'tasks', selectable: false
        });
        const sidecarState = Sidecar?.ensureState?.(chat);
        const sidecarCount = (sidecarState?.candidates || []).filter(item => item.status === 'pending').length;
        if (sidecarCount) items.push({
            id: 'system:sidecar', kind: 'system', category: 'system', priority: 'low', title: '短期记忆候选',
            detail: `${sidecarCount} 条聊天候选等待整理`, meta: '近期经历、观察与待办入口', createdAt: now, targetView: 'sidecar', selectable: false
        });
        const feedbackCount = Feedback?.getPendingCount?.(chat) || 0;
        if (feedbackCount) items.push({
            id: 'system:feedback', kind: 'system', category: 'system', priority: 'low', title: '记忆引用与作用',
            detail: `${feedbackCount} 项本轮引用等待反馈`, meta: '按来源表核对引用原因和使用效果', createdAt: now, targetView: 'usage_audit', selectable: false
        });

        const order = { high: 0, medium: 1, low: 2 };
        return items.sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9) || (b.createdAt || 0) - (a.createdAt || 0));
    }

    function filterItems(items) {
        const query = String(viewState.query || '').trim().toLowerCase();
        return (items || []).filter(item => {
            if (viewState.filter !== 'all' && item.category !== viewState.filter) return false;
            if (query && !`${item.title} ${item.detail} ${item.meta}`.toLowerCase().includes(query)) return false;
            return true;
        });
    }

    function setFilter(value) {
        viewState.filter = FILTERS.some(([id]) => id === value) ? value : 'all';
    }

    function setQuery(value) {
        viewState.query = String(value || '').slice(0, 120);
    }

    function toggleSelection(id, selected) {
        if (!id) return;
        if (selected === false || viewState.selected.has(id)) viewState.selected.delete(id);
        else viewState.selected.add(id);
    }

    function clearSelection() {
        viewState.selected.clear();
    }

    function selectedItems(items) {
        return (items || []).filter(item => item.selectable && viewState.selected.has(item.id));
    }

    function countByCategory(items) {
        const result = { all: items.length, review: 0, candidate: 0, reliability: 0, system: 0 };
        items.forEach(item => { result[item.category] = (result[item.category] || 0) + 1; });
        return result;
    }

    function renderActions(item) {
        if (item.kind === 'review_batch') return `<button type="button" class="btn btn-small btn-primary" data-governance-action="open-review" data-batch-id="${Core.escapeAttribute(item.batchId)}">进入审核</button>`;
        if (item.kind === 'candidate') return `<button type="button" class="btn btn-small btn-primary" data-governance-action="approve-candidate" data-item-id="${Core.escapeAttribute(item.id)}">批准</button><button type="button" class="btn btn-small btn-secondary" data-governance-action="open-row" data-item-id="${Core.escapeAttribute(item.id)}">查看</button><button type="button" class="memory-governance-text-danger" data-governance-action="reject-candidate" data-item-id="${Core.escapeAttribute(item.id)}">拒绝</button>`;
        if (item.kind === 'reliability') {
            const confirm = item.status === 'conflicting' ? '' : `<button type="button" class="btn btn-small btn-primary" data-governance-action="confirm-row" data-item-id="${Core.escapeAttribute(item.id)}">确认有效</button>`;
            return `${confirm}<button type="button" class="btn btn-small btn-secondary" data-governance-action="open-row" data-item-id="${Core.escapeAttribute(item.id)}">查看</button><button type="button" class="memory-governance-text" data-governance-action="snooze-row" data-item-id="${Core.escapeAttribute(item.id)}">30 天后</button><button type="button" class="memory-governance-text-danger" data-governance-action="archive-row" data-item-id="${Core.escapeAttribute(item.id)}">归档</button>`;
        }
        if (item.id === 'system:feedback') return `<button type="button" class="btn btn-small btn-secondary" data-governance-action="open-view" data-view="usage_audit">打开</button><button type="button" class="memory-governance-text-danger" data-governance-action="clear-feedback-tasks">清空待反馈</button>`;
        return `<button type="button" class="btn btn-small btn-secondary" data-governance-action="open-view" data-view="${Core.escapeAttribute(item.targetView || 'tasks')}">打开</button>`;
    }

    function renderItem(item) {
        const checked = viewState.selected.has(item.id);
        const checkbox = item.selectable ? `<label class="memory-governance-check"><input type="checkbox" data-governance-select="${Core.escapeAttribute(item.id)}" ${checked ? 'checked' : ''}><span></span></label>` : '<span class="memory-governance-check is-empty"></span>';
        return `<article class="memory-governance-item priority-${item.priority}" data-governance-item="${Core.escapeAttribute(item.id)}">
            ${checkbox}
            <div class="memory-governance-copy"><div class="memory-governance-title"><strong>${Core.escapeHtml(item.title)}</strong><span>${item.category === 'review' ? '更新' : item.category === 'candidate' ? '长期候选' : item.category === 'reliability' ? '需要复核' : '系统队列'}</span></div><p>${Core.escapeHtml(item.detail)}</p><small>${Core.escapeHtml(item.meta || '')}</small></div>
            <div class="memory-governance-actions">${renderActions(item)}</div>
        </article>`;
    }

    function renderHome(chat, templates) {
        const all = scan(chat, templates);
        const items = filterItems(all);
        const counts = countByCategory(all);
        const selected = selectedItems(all);
        return `<div class="memory-governance-page">
            <header class="memory-governance-head"><div><h2>待处理</h2><p>${all.length ? `${all.length} 项需要确认，按风险和时间统一排序` : '当前没有需要处理的内容'}</p></div><span>${counts.reliability || 0} 项记忆复核</span></header>
            <div class="memory-governance-toolbar">
                <div class="memory-governance-filters">${FILTERS.map(([id, label]) => `<button type="button" class="${viewState.filter === id ? 'active' : ''}" data-governance-filter="${id}">${label}<span>${counts[id] || 0}</span></button>`).join('')}</div>
                <label class="memory-governance-search"><span>搜索</span><input type="search" data-governance-search value="${Core.escapeAttribute(viewState.query)}" placeholder="表名、内容或原因"></label>
            </div>
            ${selected.length ? `<div class="memory-governance-bulk"><strong>已选 ${selected.length} 条</strong><button type="button" class="btn btn-small btn-primary" data-governance-action="bulk-confirm">确认有效</button><button type="button" class="btn btn-small btn-secondary" data-governance-action="bulk-snooze">30 天后复核</button><button type="button" class="btn btn-small btn-danger" data-governance-action="bulk-archive">归档</button><button type="button" class="memory-governance-text" data-governance-action="clear-selection">取消选择</button></div>` : ''}
            <div class="memory-governance-list">${items.length ? items.map(renderItem).join('') : '<div class="memory-governance-empty">当前筛选下没有待处理项目。</div>'}</div>
        </div>`;
    }

    Kernel.register('governanceQueue', Object.freeze({
        VERSION: '2.11-R4', FILTERS, viewState, scan, filterItems, setFilter, setQuery, toggleSelection, clearSelection, selectedItems, countByCategory, renderHome
    }));
})(window);
