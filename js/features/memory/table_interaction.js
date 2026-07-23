(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const RowCommandMenu = Kernel.require('rowCommandMenu');
    const TableFilter = Kernel.require('tableFilter');
    const TableSession = Kernel.require('tableSession');
    const TableSort = Kernel.get('tableSort') || { setLevel: (sorts, index, patch) => { const next = Array.isArray(sorts) ? sorts.slice() : []; next[index] = { ...(next[index] || {}), ...patch }; return next.filter(item => item.fieldId); } };

    const ACTIONS = new Set(['open-row-command-menu', 'edit-row', 'finish-edit-row', 'edit-field', 'finish-field-edit']);

    function redraw(context, options = {}) {
        if (typeof context.refreshGrid === 'function') return context.refreshGrid(options);
        return context.render?.();
    }

    function handleAction(action, element, context = {}) {
        if (!ACTIONS.has(action)) return false;
        const state = TableSession.ensure(context.state);
        if (action === 'open-row-command-menu') {
            RowCommandMenu.open(element, {
                templateId: element.dataset.templateId,
                tableId: element.dataset.tableId,
                rowId: element.dataset.rowId,
                editing: element.dataset.rowEditing === 'true'
            });
            return true;
        }
        RowCommandMenu.close(context.root || document);
        if (typeof context.openEditor === 'function' && (action === 'edit-row' || action === 'edit-field')) {
            context.openEditor({
                kind: action === 'edit-row' ? 'row' : 'field',
                templateId: element.dataset.templateId || '',
                tableId: element.dataset.tableId || '',
                rowId: element.dataset.rowId || '',
                fieldId: element.dataset.fieldId || ''
            });
            return true;
        }
        if (action === 'edit-row') TableSession.setEditingRow(state, element.dataset.rowId || null);
        else if (action === 'finish-edit-row') TableSession.finishEditing(state);
        else if (action === 'edit-field') TableSession.setEditingField(state, `${element.dataset.templateId}::${element.dataset.tableId}::${element.dataset.fieldId}`);
        else TableSession.finishEditing(state);
        redraw(context, { focusFirstEdit: action === 'edit-row' || action === 'edit-field' });
        return true;
    }

    function handleFilterClick(element, context = {}) {
        if (!element?.matches?.('[data-memory-row-filter]')) return false;
        TableSession.setFilter(context.state, element.dataset.memoryRowFilter || 'all');
        redraw(context);
        return true;
    }


    function handleSortChange(element, context = {}) {
        if (!element?.matches?.('[data-memory-sort-field],[data-memory-sort-direction]')) return false;
        const state = TableSession.ensure(context.state);
        const index = Number(element.dataset.sortIndex) || 0;
        const patch = element.matches('[data-memory-sort-field]')
            ? { fieldId: element.value || '' }
            : { direction: element.value === 'desc' ? 'desc' : 'asc' };
        TableSession.setSorts(state, TableSort.setLevel(state.rowSorts, index, patch, context.table));
        redraw(context);
        return true;
    }

    function handleSortClear(element, context = {}) {
        if (!element?.matches?.('[data-memory-sort-clear]')) return false;
        TableSession.setSorts(context.state, []);
        redraw(context);
        return true;
    }

    function handleFilterChange(element, context = {}) {
        if (!element?.matches?.('[data-memory-row-tag-filter]')) return false;
        TableSession.setTagFilter(context.state, TableFilter.normalizeTagQuery(element.value));
        redraw(context);
        return true;
    }

    Kernel.register('tableInteraction', Object.freeze({
        VERSION: '2.13-R5',
        ACTIONS,
        handleAction,
        handleFilterClick,
        handleFilterChange,
        handleSortChange,
        handleSortClear
    }));
})(window);
