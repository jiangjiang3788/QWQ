(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');

    const DEFAULTS = Object.freeze({
        viewMode: 'normal',
        activeTableId: null,
        editingRowId: null,
        editingFieldPath: null,
        focusedRowId: null,
        focusedFieldPath: null,
        rowFilter: 'all',
        rowTagFilter: '',
        rowSorts: [],
        search: ''
    });

    function ensure(state) {
        if (!state || typeof state !== 'object') throw new Error('表格会话状态无效');
        Object.keys(DEFAULTS).forEach(key => {
            if (state[key] === undefined) state[key] = DEFAULTS[key];
        });
        state.rowFilter = String(state.rowFilter || 'all');
        state.rowTagFilter = String(state.rowTagFilter || '').trim();
        state.rowSorts = Array.isArray(state.rowSorts) ? state.rowSorts.slice(0, 3).map(item => ({ fieldId: String(item?.fieldId || ''), direction: item?.direction === 'desc' ? 'desc' : 'asc' })).filter(item => item.fieldId) : [];
        state.search = String(state.search || '');
        state.viewMode = state.viewMode === 'json' ? 'json' : 'normal';
        return state;
    }

    function patch(state, next = {}) {
        ensure(state);
        Object.keys(DEFAULTS).forEach(key => {
            if (Object.prototype.hasOwnProperty.call(next, key)) state[key] = next[key];
        });
        if (next.editingRowId) state.editingFieldPath = null;
        if (next.editingFieldPath) state.editingRowId = null;
        return ensure(state);
    }

    function selectTable(state, tableId) {
        return patch(state, {
            activeTableId: tableId || null,
            editingRowId: null,
            editingFieldPath: null,
            focusedRowId: null,
            focusedFieldPath: null,
            rowSorts: []
        });
    }

    function setEditingRow(state, rowId) {
        return patch(state, { editingRowId: rowId || null, editingFieldPath: null, focusedRowId: rowId || null, focusedFieldPath: null });
    }

    function setEditingField(state, fieldPath) {
        return patch(state, { editingFieldPath: fieldPath || null, editingRowId: null, focusedFieldPath: fieldPath || null, focusedRowId: null });
    }

    function finishEditing(state) {
        return patch(state, { editingRowId: null, editingFieldPath: null });
    }

    function focusRow(state, rowId) {
        return patch(state, { focusedRowId: rowId || null, focusedFieldPath: null });
    }

    function focusField(state, fieldPath) {
        return patch(state, { focusedFieldPath: fieldPath || null, focusedRowId: null });
    }

    function clearFocus(state) {
        return patch(state, { focusedRowId: null, focusedFieldPath: null });
    }

    function setFilter(state, filter) {
        return patch(state, { rowFilter: filter || 'all' });
    }

    function setTagFilter(state, query) {
        return patch(state, { rowTagFilter: String(query || '').trim() });
    }

    function setSearch(state, query) {
        return patch(state, { search: String(query || '') });
    }

    function setSorts(state, sorts) {
        return patch(state, { rowSorts: Array.isArray(sorts) ? sorts.slice(0, 3) : [] });
    }

    function snapshot(state) {
        ensure(state);
        return Object.freeze(Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, state[key]])));
    }

    Kernel.register('tableSession', Object.freeze({
        VERSION: '2.12-R0',
        DEFAULTS,
        ensure,
        patch,
        selectTable,
        setEditingRow,
        setEditingField,
        finishEditing,
        focusRow,
        focusField,
        clearFocus,
        setFilter,
        setTagFilter,
        setSorts,
        setSearch,
        snapshot
    }));
})(window);
