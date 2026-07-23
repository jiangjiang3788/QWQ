(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Domain = Kernel.require('domain');
    const Policy = Kernel.get('policy');
    const TableGrid = Kernel.require('tableGrid');
    const TableEditor = Kernel.require('tableEditor');
    const UpdateActivity = Kernel.require('updateActivity');

    function descriptors(chat, templates) {
        const result = [];
        (templates || []).forEach(template => {
            Domain.ensureTemplateDataForChat(chat, template);
            (template.tables || []).forEach(table => result.push({ template, table }));
        });
        return result;
    }

    function resolveActive(chat, templates, state) {
        const items = descriptors(chat, templates);
        if (!items.length) return { descriptors: items, active: null };
        const runtime = Policy ? Policy.ensureRuntimeState(chat) : null;
        const requestedId = state.activeTableId || runtime?.activeTableId;
        const active = items.find(item => item.table.id === requestedId) || items[0];
        state.activeTableId = active.table.id;
        if (runtime) runtime.activeTableId = active.table.id;
        return { descriptors: items, active };
    }

    function visibleColumns(table, state) {
        const jsonMode = state.viewMode === 'json' && (!Policy || Policy.isDesktopJsonAvailable());
        return (table.columns || []).filter(field => jsonMode || field.important !== false);
    }

    function matchesSearch(state, parts) {
        const keyword = String(state.search || '').trim().toLowerCase();
        if (!keyword) return true;
        return (parts || []).join(' ').toLowerCase().includes(keyword);
    }

    function runtimePolicy(table) {
        return Policy ? Policy.normalizeTablePolicy(table) : {
            memoryLayer: table.memoryLayer || 'long',
            updatePolicy: table.updatePolicy || {},
            injectionPolicy: table.injectionPolicy || { mode: 'always', budget: 1200 }
        };
    }

    function policySummary(table) {
        const policy = runtimePolicy(table);
        const update = policy.updatePolicy;
        const inject = policy.injectionPolicy;
        return `<div class="memory-v2-policy-summary memory-v2-json-only">
            <span>layer: ${Core.escapeHtml(policy.memoryLayer)}</span>
            <span>update: ${Core.escapeHtml(update.enabled ? update.triggerMode : 'manual/off')}</span>
            <span>rounds: ${Core.escapeHtml(String(update.roundInterval || 0))}</span>
            <span>messages: ${Core.escapeHtml(String(update.messageInterval || 0))}</span>
            <span>api: ${Core.escapeHtml(update.useSummaryApi === false ? 'main' : 'summary')}</span>
            <span>inject: ${Core.escapeHtml(inject.mode)}</span>
            <span>topK: ${Core.escapeHtml(String(inject.topK || 0))}</span>
            <span>budget: ${Core.escapeHtml(String(inject.budget || 0))}</span>
        </div>`;
    }

    function gridConfig(config, active) {
        if (!active) return null;
        const { chat, state, renderFieldEditor } = config;
        return {
            chat,
            template: active.template,
            table: active.table,
            state,
            interactionContext: config.interactionContext || null,
            helpers: {
                getVisibleColumnsForMode: table => visibleColumns(table, state),
                matchesSearch: parts => matchesSearch(state, parts),
                renderFieldEditor,
                getTableRuntimePolicy: runtimePolicy
            }
        };
    }

    function render(config) {
        const { chat, templates, state, renderInspector } = config;
        const resolved = resolveActive(chat, templates, state);
        if (!resolved.active) return '';
        const runtime = Policy ? Policy.ensureRuntimeState(chat) : null;
        if (state.viewMode === 'json' && Policy && !Policy.isDesktopJsonAvailable()) {
            state.viewMode = 'normal';
            if (runtime) runtime.viewMode = 'normal';
        }
        const latestActivity = UpdateActivity.latest(chat);
        const sidebar = resolved.descriptors.map(({ template, table }) => {
            const policy = runtimePolicy(table);
            const count = Domain.isRowsTable(table) ? `${Domain.getRows(chat, template.id, table).length} 行` : `${(table.columns || []).length} 字段`;
            const changedCount = latestActivity.counts.get(String(table.id)) || 0;
            return `<button type="button" class="memory-v2-table-item ${table.id === resolved.active.table.id ? 'active' : ''} ${changedCount ? 'recently-updated' : ''}" data-action="select-memory-table" data-table-id="${Core.escapeAttribute(table.id)}">
                <span class="name">${Core.escapeHtml(table.name)}${changedCount ? `<em class="memory-table-update-dot" aria-label="本次更新"></em>` : ''}</span>
                <span class="meta">${Core.escapeHtml(template.name)} · ${Core.escapeHtml(policy.memoryLayer)} · ${count}</span>
                ${changedCount ? `<span class="memory-table-updated-badge">本次更新 ${changedCount}</span>` : ''}
            </button>`;
        }).join('');
        const active = resolved.active;
        const policy = runtimePolicy(active.table);
        const currentGrid = gridConfig(config, active);
        const content = TableGrid.render(currentGrid);
        return `<div class="memory-v2-workspace">
            <aside class="memory-v2-sidebar">${sidebar}</aside>
            <section class="memory-v2-main">
                <div class="memory-v2-sheet">
                    <div class="memory-v2-sheet-head">
                        <div>
                            <h2>${Core.escapeHtml(active.table.name)}</h2>
                            <div class="sub">${Core.escapeHtml(active.template.name)} · ${Domain.isRowsTable(active.table) ? '多行记录' : '键值档案'}${state.viewMode === 'json' ? ' · 完整字段/结构模式' : ' · 重要字段模式'}</div>
                            <div class="memory-table-interaction-hint" aria-label="表格编辑方式"><span>双击编辑</span><span>手机双点</span><span>Esc 退出</span></div>
                            ${policySummary(active.table)}
                            ${active.table.extractPrompt ? `<div class="memory-v2-json-meta memory-v2-json-only">extractPrompt: ${Core.escapeHtml(active.table.extractPrompt)}</div>` : ''}
                        </div>
                        <div class="memory-v2-sheet-actions">
                            <span class="memory-table-save-status" data-memory-table-save-status>已保存</span>
                            <button type="button" class="btn btn-small btn-neutral memory-table-undo-btn" data-action="undo-table-edit" ${TableEditor.canUndo(chat) ? '' : 'disabled'} title="${Core.escapeAttribute(TableEditor.undoLabel(chat))}">撤销编辑</button>
                            <button type="button" class="btn btn-small btn-secondary" data-action="open-schema-editor" data-template-id="${Core.escapeAttribute(active.template.id)}">表结构</button>
                            <span class="memory-v2-layer-badge">${Core.escapeHtml(policy.memoryLayer)}</span>
                            ${Domain.isRowsTable(active.table) ? `<button type="button" class="btn btn-small btn-primary" data-action="add-row" data-template-id="${Core.escapeAttribute(active.template.id)}" data-table-id="${Core.escapeAttribute(active.table.id)}">新增行</button>` : ''}
                        </div>
                    </div>
                    ${UpdateActivity.banner(chat, active.table, templates)}
                    <div class="memory-table-grid-host" data-memory-table-grid>${content}</div>
                </div>
            </section>
        </div>${renderInspector ? renderInspector(chat) : ''}`;
    }

    function getGridConfig(config) {
        const resolved = resolveActive(config.chat, config.templates, config.state);
        return gridConfig(config, resolved.active);
    }

    Kernel.register('tableWorkspace', Object.freeze({
        VERSION: '2.12-R3',
        descriptors,
        resolveActive,
        visibleColumns,
        matchesSearch,
        runtimePolicy,
        policySummary,
        gridConfig,
        getGridConfig,
        render
    }));
})(window);
