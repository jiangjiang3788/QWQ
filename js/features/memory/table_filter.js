(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Lifecycle = Kernel.get('lifecycle');

    const FILTERS = Object.freeze([
        { id: 'all', label: '全部' },
        { id: 'attention', label: '待复核' },
        { id: 'active', label: '有效' },
        { id: 'pinned', label: '固定' },
        { id: 'inactive', label: '归档/替代' }
    ]);

    function normalizeTagQuery(value) {
        return String(value || '').trim().toLowerCase().slice(0, 80);
    }

    function rowStatus(row, table) {
        const meta = Lifecycle?.ensureRowMeta?.(row, table, '') || row?.meta || {};
        return meta.lifecycle?.status || meta.status || 'active';
    }

    function isDue(row, table, now = Date.now()) {
        const meta = Lifecycle?.ensureRowMeta?.(row, table, '') || row?.meta || {};
        const life = meta.lifecycle || {};
        return !!((life.reviewAt && life.reviewAt <= now) || (life.expiresAt && life.expiresAt <= now));
    }

    function tagsFor(row) {
        const bundle = row?.meta?.tagBundle || {};
        return Core.unique([
            ...(bundle.topic || []),
            ...(bundle.scene || []),
            ...(bundle.entity || []),
            ...(row?.meta?.tags || [])
        ].map(item => String(item || '').trim()).filter(Boolean), 80);
    }

    function matches(row, table, options = {}) {
        const filter = FILTERS.some(item => item.id === options.filter) ? options.filter : 'all';
        const status = rowStatus(row, table);
        const due = isDue(row, table, options.now || Date.now());
        if (filter === 'attention' && !(['uncertain', 'conflicting', 'expired'].includes(status) || due)) return false;
        if (filter === 'active' && (status !== 'active' || due)) return false;
        if (filter === 'pinned' && !row?.meta?.pinned) return false;
        if (filter === 'inactive' && !['archived', 'superseded', 'expired'].includes(status)) return false;
        const query = normalizeTagQuery(options.tagQuery);
        if (query && !tagsFor(row).some(tag => tag.toLowerCase().includes(query))) return false;
        return true;
    }

    function apply(rows, table, options = {}) {
        const list = Array.isArray(rows) ? rows : [];
        return list.filter(row => matches(row, table, options));
    }

    function countByFilter(rows, table, options = {}) {
        const result = {};
        FILTERS.forEach(item => {
            result[item.id] = apply(rows, table, { ...options, filter: item.id }).length;
        });
        return result;
    }

    function renderToolbar(rows, table, state = {}) {
        const counts = countByFilter(rows, table, { tagQuery: state.tagQuery });
        const active = FILTERS.some(item => item.id === state.filter) ? state.filter : 'all';
        return `<div class="memory-table-filterbar" aria-label="记忆行筛选">
            <div class="memory-table-filterchips">${FILTERS.map(item => `<button type="button" class="${active === item.id ? 'active' : ''}" data-memory-row-filter="${item.id}">${item.label}<span>${counts[item.id] || 0}</span></button>`).join('')}</div>
            <label class="memory-table-tag-filter"><span>标签</span><input type="search" data-memory-row-tag-filter value="${Core.escapeAttribute(state.tagQuery || '')}" placeholder="筛选标签"></label>
        </div>`;
    }

    Kernel.register('tableFilter', Object.freeze({
        VERSION: '2.11-R4', FILTERS, normalizeTagQuery, rowStatus, isDue, tagsFor, matches, apply, countByFilter, renderToolbar
    }));
})(window);
