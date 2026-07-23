(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Domain = Kernel.require('domain');
    const TableView = Kernel.require('tableView');
    const TableFilter = Kernel.require('tableFilter');
    const TableSort = Kernel.get('tableSort') || { renderControls: () => '' };
    const TableViewport = Kernel.require('tableViewport');
    const TablePresenter = Kernel.require('tablePresenter');
    const TableReconciler = Kernel.require('tableReconciler');
    const TableGrouping = Kernel.require('tableGrouping');
    const TableGesture = Kernel.require('tableGesture');
    const UpdateActivity = Kernel.get('updateActivity') || Object.freeze({ isCellUpdated: () => false, cellAttributes: () => '' });

    const models = new Map();
    const MAX_MODELS = 12;
    const metrics = { tableRefreshes: 0, virtualPatches: 0, fieldCommits: 0 };

    function rememberModel(key, model) {
        if (models.has(key)) models.delete(key);
        models.set(key, model);
        while (models.size > MAX_MODELS) models.delete(models.keys().next().value);
    }

    function renderKeyValueField(model, field) {
        const { chat, template, table, state, helpers, jsonMode } = model;
        const value = Domain.getFieldValue(chat, template.id, table.id, field);
        const locked = Domain.isFieldLocked(chat, template.id, table.id, field.id);
        const fieldPath = TableGrouping.fieldPath(template.id, table.id, field.id);
        const editing = jsonMode || state.editingFieldPath === fieldPath;
        const focused = state.focusedFieldPath === fieldPath;
        const classes = [editing ? 'memory-flat-editing-row' : '', focused ? 'memory-flat-selected-row' : ''].filter(Boolean).join(' ');
        const updated = UpdateActivity.isCellUpdated(chat, template.id, table.id, field.id);
        const valueCellClass = [editing ? 'memory-flat-cell-editing' : '', updated ? 'memory-cell-updated' : ''].filter(Boolean).join(' ');
        return `<tr data-memory-important="${field.important !== false}" class="${classes}" data-memory-edit-target data-memory-edit-kind="field" data-template-id="${Core.escapeAttribute(template.id)}" data-table-id="${Core.escapeAttribute(table.id)}" data-field-id="${Core.escapeAttribute(field.id)}" tabindex="0" aria-label="${Core.escapeAttribute(`${field.key}，单击选中，长按编辑`)}">
            <th><div class="memory-flat-field-label"><span>${Core.escapeHtml(field.key)}</span></div>
            <div class="memory-v2-json-meta memory-v2-json-only">id=${Core.escapeHtml(field.id)} · type=${Core.escapeHtml(field.type)} · important=${field.important !== false}<br>${Core.escapeHtml(field.aiHint || '')}</div></th>
            <td class="${valueCellClass}"${UpdateActivity.cellAttributes(chat, template.id, table.id, field.id)}>${editing ? `<div class="memory-v2-inline-editor">${helpers.renderFieldEditor(template.id, table.id, field, value, locked)}</div>` : TableView.renderValue(field, value, { unclamped: true })}</td>
        </tr>`;
    }

    function renderKeyValueGroup(model, group) {
        const fields = (group.fields || []).map(field => renderKeyValueField(model, field)).join('');
        return `<tbody class="memory-field-group-section" data-memory-field-group="${Core.escapeAttribute(group.name)}">
            <tr class="memory-field-group-heading"><th colspan="2"><span>${Core.escapeHtml(group.name)}</span><small>${group.fields.length} 个字段</small></th></tr>
            ${fields}
        </tbody>`;
    }

    function renderKeyValueSheet(config) {
        const model = TablePresenter.keyValueModel(config);
        const groupsHtml = model.groups.map(group => renderKeyValueGroup(model, group)).join('');
        return `<table class="memory-v2-kv">${groupsHtml || '<tbody><tr><td class="memory-v2-empty">当前模式下没有匹配字段。</td></tr></tbody>'}</table>`;
    }

    function renderReviewActions(model, row) {
        if (!model.isReviewTable) return '';
        const status = model.reviewStatusField
            ? Domain.getFieldDisplayValue(model.reviewStatusField, row.cells?.[model.reviewStatusField.id])
            : '';
        return `<div class="memory-v2-candidate-actions"><button class="btn btn-small btn-primary" data-action="approve-long-candidate" data-template-id="${Core.escapeAttribute(model.template.id)}" data-table-id="${Core.escapeAttribute(model.table.id)}" data-row-id="${Core.escapeAttribute(row.id)}">批准</button><button class="btn btn-small btn-secondary" data-action="more-evidence-candidate" data-template-id="${Core.escapeAttribute(model.template.id)}" data-table-id="${Core.escapeAttribute(model.table.id)}" data-row-id="${Core.escapeAttribute(row.id)}">补证</button><button class="btn btn-small btn-danger" data-action="reject-long-candidate" data-template-id="${Core.escapeAttribute(model.template.id)}" data-table-id="${Core.escapeAttribute(model.table.id)}" data-row-id="${Core.escapeAttribute(row.id)}">拒绝</button>${status ? `<span>${Core.escapeHtml(status)}</span>` : ''}</div>`;
    }

    function renderDataRow(model, row) {
        const { chat, template, table, state, helpers, columns, rowIndexes } = model;
        const rowIndex = rowIndexes.get(row.id) ?? 0;
        const editing = state.viewMode === 'json' || state.editingRowId === row.id;
        const focused = state.focusedRowId === row.id;
        const cells = columns.map(field => {
            const locked = Domain.isFieldLocked(chat, template.id, table.id, field.id);
            const value = row.cells?.[field.id];
            const updated = UpdateActivity.isCellUpdated(chat, template.id, table.id, field.id, row.id);
            const cellClass = [editing ? 'memory-flat-cell-editing' : '', updated ? 'memory-cell-updated' : ''].filter(Boolean).join(' ');
            return `<td data-memory-important="${field.important !== false}" class="${cellClass}"${UpdateActivity.cellAttributes(chat, template.id, table.id, field.id, row.id)}>${editing ? `<div class="memory-v2-inline-editor">${helpers.renderFieldEditor(template.id, table.id, field, value, locked, row.id)}</div>` : TableView.renderValue(field, value)}</td>`;
        }).join('');
        const classes = ['memory-v2-data-row', editing ? 'memory-flat-editing-row' : '', focused ? 'memory-flat-selected-row' : ''].filter(Boolean).join(' ');
        const tagsUpdated = UpdateActivity.isCellUpdated(chat, template.id, table.id, '__tags__', row.id);
        const tagCellClass = ['memory-flat-tags-cell', tagsUpdated ? 'memory-cell-updated' : ''].filter(Boolean).join(' ');
        return `<tr class="${classes}" data-memory-row-id="${Core.escapeAttribute(row.id)}" data-memory-edit-target data-memory-edit-kind="row" data-template-id="${Core.escapeAttribute(template.id)}" data-table-id="${Core.escapeAttribute(table.id)}" data-row-id="${Core.escapeAttribute(row.id)}" tabindex="0" aria-label="${Core.escapeAttribute(`第 ${rowIndex + 1} 条记录，单击选中，长按编辑`)}"><td><div class="memory-flat-row-index"><span>${rowIndex + 1}</span>${TableView.renderRowCommand({ templateId: template.id, tableId: table.id, rowId: row.id })}</div>${TableView.renderStatusMeta(row)}${renderReviewActions(model, row)}<div class="memory-v2-json-meta memory-v2-json-only">${Core.escapeHtml(row.id)}</div></td><td class="${tagCellClass}"${UpdateActivity.cellAttributes(chat, template.id, table.id, '__tags__', row.id)}>${editing ? TableView.renderTagEditor(row) : TableView.renderTagField(row)}</td>${cells}</tr>`;
    }

    function renderSpacer(height, colspan, position) {
        if (!height) return '';
        return `<tr class="memory-virtual-spacer memory-virtual-spacer-${position}" aria-hidden="true"><td colspan="${colspan}" style="height:${Math.max(0, Math.round(height))}px"></td></tr>`;
    }

    function renderBody(model, range) {
        const slice = model.rows.slice(range.start, range.end);
        const rowsHtml = slice.map(row => renderDataRow(model, row)).join('');
        const colspan = model.columns.length + 2;
        if (!rowsHtml && !range.enabled) return `<tr><td colspan="${colspan}" class="memory-v2-empty">当前筛选下没有记录。</td></tr>`;
        if (!range.enabled) return rowsHtml;
        return `${renderSpacer(range.topHeight, colspan, 'top')}${rowsHtml}${renderSpacer(range.bottomHeight, colspan, 'bottom')}`;
    }

    function renderFieldHead(field) {
        return `<th class="memory-table-field-head" data-memory-important="${field.important !== false}">${Core.escapeHtml(field.key)}<div class="memory-v2-json-meta memory-v2-json-only">${Core.escapeHtml(field.id)}<br>${Core.escapeHtml(field.type)}${field.aiHint ? `<br>${Core.escapeHtml(field.aiHint)}` : ''}</div></th>`;
    }

    function renderRowsHead(model) {
        const groupHead = model.groups.map(group => `<th class="memory-table-column-group" colspan="${group.fields.length}">${Core.escapeHtml(group.name)}</th>`).join('');
        const fieldHead = model.columns.map(renderFieldHead).join('');
        return `<thead><tr class="memory-table-group-head"><th rowspan="2">记录</th><th rowspan="2" class="memory-table-tags-head">标签</th>${groupHead}</tr><tr class="memory-table-fields-head">${fieldHead}</tr></thead>`;
    }

    function renderRowsSheet(config) {
        const model = TablePresenter.rowsModel(config);
        const { table, state, searchedRows, rows, range } = model;
        rememberModel(range.key, model);
        const virtualAttrs = range.enabled
            ? ` data-memory-virtual-key="${Core.escapeAttribute(range.key)}" data-memory-row-count="${rows.length}" data-memory-row-height="${range.rowHeight}"`
            : '';
        const status = range.enabled
            ? `<span class="memory-table-viewport-status" data-memory-virtual-status>大表优化 · 当前渲染 ${range.renderedCount}/${rows.length}</span>`
            : `<span class="memory-table-viewport-status">${rows.length} 行</span>`;
        return `${TableFilter.renderToolbar(searchedRows, table, { filter: state.rowFilter, tagQuery: state.rowTagFilter })}${TableSort.renderControls(table, state.rowSorts)}<div class="memory-v2-rows-wrap ${range.enabled ? 'memory-v2-rows-virtualized' : ''}"${virtualAttrs}><div class="memory-table-viewport-head">${status}</div><table class="memory-v2-rows">${renderRowsHead(model)}<tbody data-memory-virtual-body>${renderBody(model, range)}</tbody></table></div>`;
    }

    function renderRawJson(chat, template, table) {
        const tableData = Core.clone(chat.memoryTables.data?.[template.id]?.[table.id] || {});
        const payload = { schema: table, data: tableData, lockedFields: chat.memoryTables.lockedFields?.[template.id]?.[table.id] || [] };
        return `<pre class="memory-v2-json-raw memory-v2-json-only">${Core.escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
    }

    function render(config) {
        if (!config) return '';
        const content = Domain.isRowsTable(config.table) ? renderRowsSheet(config) : renderKeyValueSheet(config);
        return `${content}${renderRawJson(config.chat, config.template, config.table)}`;
    }

    function patchVirtualWindow(wrapper, model, force = false) {
        if (!wrapper || !model) return;
        const body = wrapper.querySelector('[data-memory-virtual-body]');
        if (!body) return;
        const rowHeight = Number(wrapper.dataset.memoryRowHeight) || TableViewport.DEFAULTS.rowHeight;
        const range = TableViewport.update(model.key, {
            rowCount: model.rows.length,
            rowHeight,
            scrollTop: wrapper.scrollTop,
            viewportHeight: wrapper.clientHeight
        });
        const current = `${wrapper.dataset.memoryVirtualStart || ''}:${wrapper.dataset.memoryVirtualEnd || ''}`;
        const next = `${range.start}:${range.end}`;
        if (!force && current === next) return;
        wrapper.dataset.memoryVirtualStart = String(range.start);
        wrapper.dataset.memoryVirtualEnd = String(range.end);
        body.innerHTML = renderBody(model, range);
        metrics.virtualPatches += 1;
        const status = wrapper.querySelector('[data-memory-virtual-status]');
        if (status) status.textContent = `大表优化 · ${range.start + 1}-${range.end} / ${model.rows.length} · DOM ${range.renderedCount} 行`;
    }

    function bindVirtual(root) {
        root?.querySelectorAll?.('[data-memory-virtual-key]').forEach(wrapper => {
            const key = wrapper.dataset.memoryVirtualKey;
            const model = models.get(key);
            if (!model) return;
            const saved = TableViewport.getState(key);
            if (saved) wrapper.scrollTop = saved.scrollTop || 0;
            patchVirtualWindow(wrapper, model, true);
            if (wrapper.dataset.memoryVirtualBound === 'true') return;
            wrapper.dataset.memoryVirtualBound = 'true';
            let raf = 0;
            wrapper.addEventListener('scroll', () => {
                if (raf) return;
                raf = global.requestAnimationFrame(() => {
                    raf = 0;
                    patchVirtualWindow(wrapper, model, false);
                });
            }, { passive: true });
        });
    }

    function bind(root, interactionContext = null) {
        bindVirtual(root);
        if (interactionContext?.state) TableGesture.bind(root, interactionContext);
    }

    function refresh(root, config, options = {}) {
        if (!root || !config) return false;
        const changed = TableReconciler.replace(root, render(config), bindVirtual, options);
        if (changed) metrics.tableRefreshes += 1;
        return changed;
    }

    function normalizeEditorValue(field, value) {
        const type = String(field?.type || '').toLowerCase();
        if (type === 'boolean') return !!value;
        if (type === 'tags') return Array.isArray(value) ? value.join(', ') : String(value || '');
        return value == null ? '' : String(value);
    }

    function commitInput(root, target, field, savedValue) {
        if (!target) return;
        const normalized = normalizeEditorValue(field, savedValue);
        if (target.type === 'checkbox') target.checked = !!normalized;
        else if (target.value !== normalized) target.value = normalized;
        target.dataset.memorySaved = 'true';
        metrics.fieldCommits += 1;
        TableReconciler.markSaved(root, '已保存');
    }

    function getMetrics() {
        return { ...metrics, cachedModels: models.size, reconciler: TableReconciler.getStats() };
    }

    function resetMetrics() {
        Object.keys(metrics).forEach(key => { metrics[key] = 0; });
        TableReconciler.resetStats();
    }

    Kernel.register('tableGrid', Object.freeze({
        VERSION: '2.12-R0',
        renderKeyValueSheet,
        renderRowsSheet,
        renderRawJson,
        render,
        bind,
        refresh,
        patchVirtualWindow,
        commitInput,
        getMetrics,
        resetMetrics,
        getCachedModelCount: () => models.size
    }));
})(window);
