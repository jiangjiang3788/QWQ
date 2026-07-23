(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Domain = Kernel.require('domain');
    const TableFilter = Kernel.require('tableFilter');
    const TableSort = Kernel.get('tableSort') || { normalize: sorts => Array.isArray(sorts) ? sorts : [], apply: rows => rows };
    const TableViewport = Kernel.require('tableViewport');
    const TableCache = Kernel.require('tableCache');
    const TableGrouping = Kernel.require('tableGrouping');
    const TableView = Kernel.require('tableView');

    function viewportKey(config) {
        const { chat, template, table, state } = config;
        return [
            chat?.id || 'chat', template?.id || 'template', table?.id || 'table',
            state?.viewMode || 'normal', state?.rowFilter || 'all',
            state?.rowTagFilter || '', JSON.stringify(state?.rowSorts || []), state?.search || ''
        ].join('::');
    }

    function groupedColumns(columns) {
        const groups = TableGrouping.groupColumns(columns);
        return { groups, columns: TableGrouping.flatten(groups) };
    }

    function keyValueModel(config) {
        const { chat, template, table, state, helpers } = config;
        const filtered = helpers.getVisibleColumnsForMode(table).filter(field => helpers.matchesSearch([
            template.name,
            table.name,
            field.key,
            field.group || '',
            field.aiHint || '',
            Domain.getFieldDisplayValue(field, Domain.getFieldValue(chat, template.id, table.id, field))
        ]));
        const grouped = groupedColumns(filtered);
        return {
            chat,
            template,
            table,
            state,
            helpers,
            columns: grouped.columns,
            groups: grouped.groups,
            jsonMode: state.viewMode === 'json',
            stamp: TableCache.keyValueStamp(chat, template.id, table.id)
        };
    }

    function buildDerived(config, columns, allRows, isReviewTable) {
        const { chat, template, table, state, helpers } = config;
        const scope = TableCache.scopeKey(chat, template.id, table.id);
        const dataStamp = TableCache.rowsStamp(chat, template.id, table, allRows);
        const signature = [
            dataStamp,
            columns.map(field => field.id).join(','),
            state.search || '', state.rowFilter || 'all', state.rowTagFilter || '', JSON.stringify(TableSort.normalize(state.rowSorts, table)),
            isReviewTable ? 'review' : 'normal'
        ].join('::');
        return TableCache.memo(scope, signature, () => {
            const rowIndexes = new Map(allRows.map((row, index) => [row.id, index]));
            const searchedRows = allRows.filter(row => helpers.matchesSearch([
                template.name,
                table.name,
                TableView.rowTags(row).join(' '),
                ...(columns || []).map(field => `${field.key} ${Domain.getFieldDisplayValue(field, row.cells?.[field.id])}`)
            ]));
            const filteredRows = TableFilter.apply(searchedRows, table, { filter: state.rowFilter, tagQuery: state.rowTagFilter });
            const rows = TableSort.apply(filteredRows, table, state.rowSorts);
            return { dataStamp, rowIndexes, searchedRows, rows };
        });
    }

    function rowsModel(config) {
        const { chat, template, table, state, helpers } = config;
        const grouped = groupedColumns(helpers.getVisibleColumnsForMode(table));
        const columns = grouped.columns;
        const policy = helpers.getTableRuntimePolicy(table);
        const isReviewTable = policy.memoryLayer === 'review';
        const reviewStatusField = isReviewTable ? (table.columns || []).find(field => field.key === '审核状态') : null;
        const allRows = Domain.getRows(chat, template.id, table);
        const derived = buildDerived(config, columns, allRows, isReviewTable);
        const key = viewportKey(config);
        const activeIndex = state.editingRowId ? derived.rows.findIndex(row => row.id === state.editingRowId) : -1;
        const range = TableViewport.plan(key, {
            rowCount: derived.rows.length,
            activeIndex,
            jsonMode: state.viewMode === 'json',
            reviewMode: isReviewTable
        });
        return {
            key,
            chat,
            template,
            table,
            state,
            helpers,
            columns,
            groups: grouped.groups,
            rows: derived.rows,
            allRows,
            searchedRows: derived.searchedRows,
            rowIndexes: derived.rowIndexes,
            dataStamp: derived.dataStamp,
            isReviewTable,
            reviewStatusField,
            range
        };
    }

    Kernel.register('tablePresenter', Object.freeze({
        VERSION: '2.12-R0',
        viewportKey,
        groupedColumns,
        keyValueModel,
        rowsModel
    }));
})(window);
