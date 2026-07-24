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
    const WorkItem = Kernel.require('workItem');

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
        return WorkItem.collect(chat, templates, options);
    }

    function filterItems(items) {
        const query = String(viewState.query || '').trim().toLowerCase();
        return (items || []).filter(item => {
            if (viewState.filter !== 'all' && item.category !== viewState.filter) return false;
            if (query && !`${item.title} ${item.reason || ''} ${item.detail} ${item.meta}`.toLowerCase().includes(query)) return false;
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

    function actionAttributes(action, item) {
        const params = { ...(action.params || {}) };
        params.itemId ||= item.id;
        if (item.sourceRef?.batchId) params.batchId ||= item.sourceRef.batchId;
        return Object.entries(params).map(([key, value]) => {
            const attr = key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
            return `data-${attr}="${Core.escapeAttribute(value)}"`;
        }).join(' ');
    }

    function renderActions(item) {
        return (item.availableActions || []).map(action => {
            const attrs = `data-governance-action="${Core.escapeAttribute(action.id)}" ${actionAttributes(action, item)}`;
            if (action.tone === 'text-danger') return `<button type="button" class="memory-governance-text-danger" ${attrs}>${Core.escapeHtml(action.label)}</button>`;
            if (action.tone === 'text') return `<button type="button" class="memory-governance-text" ${attrs}>${Core.escapeHtml(action.label)}</button>`;
            const tone = action.tone === 'primary' ? 'btn-primary' : action.tone === 'danger' ? 'btn-danger' : action.tone === 'neutral' ? 'btn-neutral' : 'btn-secondary';
            return `<button type="button" class="btn btn-small ${tone}" ${attrs}>${Core.escapeHtml(action.label)}</button>`;
        }).join('');
    }

    function itemTypeLabel(item) {
        const labels = {
            update_review: '更新确认', short_candidate: '短期候选', long_candidate: '长期晋升',
            reliability_review: '可靠性复核', conflict_review: '冲突复核', failed_task: '失败任务',
            paused_task: '暂停任务', retrieval_feedback: '召回反馈'
        };
        return labels[item.type] || WorkItem.CATEGORIES[item.category] || '待处理';
    }

    function renderItem(item) {
        const checked = viewState.selected.has(item.id);
        const checkbox = item.selectable ? `<label class="memory-governance-check"><input type="checkbox" data-governance-select="${Core.escapeAttribute(item.id)}" ${checked ? 'checked' : ''}><span></span></label>` : '<span class="memory-governance-check is-empty"></span>';
        return `<article class="memory-governance-item priority-${item.risk}" data-governance-item="${Core.escapeAttribute(item.id)}">
            ${checkbox}
            <div class="memory-governance-copy"><div class="memory-governance-title"><strong>${Core.escapeHtml(item.title)}</strong><span>${itemTypeLabel(item)}</span></div><p>${Core.escapeHtml(item.detail)}</p><small>${Core.escapeHtml(item.meta || '')}</small></div>
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
        VERSION: '2.14-R8', FILTERS, viewState, scan, filterItems, setFilter, setQuery, toggleSelection, clearSelection, selectedItems, countByCategory, renderHome
    }));
})(window);
