(function (global) {
    'use strict';

    const M = global.MemoryV5;
    if (!M?.model || !M?.engine) throw new Error('MemoryV5 core and engine must load before UI');

    const { clone, text, esc, unique, id, localDateTimeSeconds } = M.util;
    const {
        ensureStore, getCurrentChat, persist, findTable, visibleFields, getFieldValue,
        setFieldValue, normalizeTable, normalizeRecord, importPlan, mergeImport,
        customField, migrateAllCharacters
    } = M.model;
    const { applyOperations, formatRecordText, refreshStateBar, buildSummaryDraft, runAggregation, deleteCompressed, buildLongTermDraft, saveLongTermDraft } = M.engine;

    const state = {
        activeTableId: '',
        search: '',
        category: '',
        tag: '',
        page: 1,
        scrollTop: 0,
        searchTimer: null,
        restoreSearchFocus: false,
        searchSelection: 0,
        resetScroll: false,
        viewportBound: false,
        bound: false
    };

    function toast(message) {
        if (typeof global.showToast === 'function') global.showToast(message);
        else global.alert(message);
    }

    function groupLabel(group) {
        return ({ core: '核心', current: '状态', short: '短期', medium: '中期', long: '长期' })[group] || group;
    }

    function writeLabel(policy) {
        return ({ manual: '手动更新', auto: '随聊天自动新增/更新', summary: '短期压缩' })[policy] || policy;
    }

    function contextLabel(policy) {
        return ({ always: '每轮发送', relevant: '相关时发送', never: '不发送' })[policy] || policy;
    }

    function installViewportFix() {
        if (state.viewportBound) return;
        state.viewportBound = true;
        const update = () => {
            const viewport = global.visualViewport;
            const height = Math.max(320, Math.round(viewport?.height || global.innerHeight || document.documentElement.clientHeight || 720));
            const offsetTop = Math.max(0, Math.round(viewport?.offsetTop || 0));
            document.documentElement.style.setProperty('--mv5-visual-height', `${height}px`);
            document.documentElement.style.setProperty('--mv5-visual-offset-top', `${offsetTop}px`);
        };
        update();
        global.visualViewport?.addEventListener?.('resize', update);
        global.visualViewport?.addEventListener?.('scroll', update);
        global.addEventListener?.('orientationchange', () => setTimeout(update, 80));
    }

    function pageSize(store) {
        return Math.max(20, Math.min(500, parseInt(store?.settings?.tablePageSize, 10) || 100));
    }

    function paginate(rows, store) {
        const size = pageSize(store);
        const total = rows.length;
        const pages = Math.max(1, Math.ceil(total / size));
        state.page = Math.max(1, Math.min(pages, parseInt(state.page, 10) || 1));
        const start = (state.page - 1) * size;
        return { rows: rows.slice(start, start + size), total, pages, size, start };
    }

    function renderPager(page) {
        if (page.total <= page.size) return '';
        return `<nav class="mv5-pager" aria-label="记忆记录分页"><span>共${page.total}条 · 第${state.page}/${page.pages}页</span><div><button class="btn btn-small btn-secondary" data-mv5-page="first" ${state.page <= 1 ? 'disabled' : ''}>首页</button><button class="btn btn-small btn-secondary" data-mv5-page="prev" ${state.page <= 1 ? 'disabled' : ''}>上一页</button><button class="btn btn-small btn-secondary" data-mv5-page="next" ${state.page >= page.pages ? 'disabled' : ''}>下一页</button><button class="btn btn-small btn-secondary" data-mv5-page="last" ${state.page >= page.pages ? 'disabled' : ''}>末页</button></div></nav>`;
    }

    function valueText(field, value) {
        if (value === undefined || value === null || value === '') return '';
        if (Array.isArray(value)) return value.join('、');
        if (field.type === 'boolean') return value ? '是' : '否';
        return String(value);
    }

    function renderCell(field, value, truncate = true) {
        const raw = valueText(field, value);
        if (!raw) return '<span class="mv5-empty">—</span>';
        const className = truncate ? 'mv5-cell-clamp' : 'mv5-cell-full';
        return `<span class="${className}" title="${esc(raw)}">${esc(raw)}</span>`;
    }

    function activeTable(chat) {
        const store = ensureStore(chat);
        if (!store.tables.length) return null;
        let table = store.tables.find(item => item.id === state.activeTableId);
        if (!table) table = store.tables[0];
        state.activeTableId = table.id;
        return table;
    }

    function compareField(field, a, b) {
        const left = getFieldValue(a, field);
        const right = getFieldValue(b, field);
        if (field.type === 'number') return (Number(left) || 0) - (Number(right) || 0);
        if (field.type === 'date' || field.type === 'datetime') return (new Date(left || 0).getTime() || 0) - (new Date(right || 0).getTime() || 0);
        if (field.type === 'boolean') return Number(!!left) - Number(!!right);
        return valueText(field, left).localeCompare(valueText(field, right), 'zh-CN', { numeric: true, sensitivity: 'base' });
    }

    function tableRows(store, table) {
        const query = text(state.search).toLowerCase();
        const rows = (store.records[table.id] || []).filter(record => {
            if (state.category && record.category !== state.category) return false;
            if (state.tag && !record.tags.includes(state.tag)) return false;
            if (!query) return true;
            return formatRecordText(table, record).toLowerCase().includes(query);
        });
        const rules = table.display.sortRules || [];
        return rows.sort((a, b) => {
            for (const rule of rules) {
                const field = table.fields.find(item => item.id === rule.fieldId);
                if (!field) continue;
                const diff = compareField(field, a, b);
                if (diff) return rule.direction === 'asc' ? diff : -diff;
            }
            return text(b.updatedAt).localeCompare(text(a.updatedAt));
        });
    }

    function currentRoundId(chat) {
        const report = M.engine.ensureSidecarState(chat).lastApplyReport;
        return report?.roundId || null;
    }

    function updateDot(chat, record, fieldId = '') {
        const roundId = currentRoundId(chat);
        if (!roundId || record.roundId !== roundId) return '';
        if (fieldId && !record.changedFieldIds.includes(fieldId)) return '';
        return '<span class="mv5-update-dot" title="本轮更新"></span>';
    }

    function tableUpdateDot(chat, tableId) {
        const report = M.engine.ensureSidecarState(chat).lastApplyReport;
        if (!report?.roundId || !Array.isArray(report.changed)) return '';
        return report.changed.some(change => change.tableId === tableId)
            ? '<span class="mv5-update-dot mv5-table-update-dot" title="本轮有更新"></span>'
            : '';
    }

    function renderKv(chat, table, rows) {
        const fields = visibleFields(table).filter(field => field.scope === 'custom');
        const record = rows[0] || null;
        if (!fields.length) return '<div class="mv5-empty-page">当前KV表还没有自定义字段。请点击“编辑表格”添加表单字段。</div>';
        const groups = [];
        const groupMap = new Map();
        fields.forEach(field => {
            const category = text(field.category) || '未分类';
            if (!groupMap.has(category)) {
                const group = { category, fields: [] };
                groupMap.set(category, group);
                groups.push(group);
            }
            groupMap.get(category).fields.push(field);
        });
        return `<div class="mv5-kv-groups">${groups.map(group => `<section class="mv5-kv-group" data-kv-category="${esc(group.category)}">
<div class="mv5-kv-group-head">${esc(group.category)}</div>
<div class="mv5-kv-form">${group.fields.map(field => `<article class="mv5-kv-record" data-field-id="${esc(field.id)}">
<div class="mv5-kv-title">${record ? updateDot(chat, record, field.id) : ''}<strong>${esc(field.name)}</strong>${field.required ? '<span class="mv5-required-mark">必填</span>' : ''}</div>
<div class="mv5-kv-body"><div class="mv5-kv-content"><div class="mv5-kv-text">${record ? renderCell(field, getFieldValue(record, field), false) : '<span class="mv5-empty">—</span>'}</div></div></div>
</article>`).join('')}</div></section>`).join('')}</div>`;
    }

    function renderRows(chat, table, rows) {
        const fields = visibleFields(table);
        const width = fields.reduce((sum, field) => sum + field.width, 0) + 90;
        const body = rows.map(record => `<tr>${fields.map(field => `<td style="width:${field.width}px" data-field-id="${esc(field.id)}"><div class="mv5-cell-with-dot">${renderCell(field, getFieldValue(record, field), true)}${updateDot(chat, record, field.id)}</div></td>`).join('')}<td class="mv5-row-actions mv5-sticky-actions"><button data-mv5-edit-record="${esc(record.id)}">编辑</button><button data-mv5-delete-record="${esc(record.id)}">删除</button></td></tr>`).join('');
        return `<div class="mv5-grid-scroll"><table class="mv5-grid" style="width:${width}px;min-width:100%"><colgroup>${fields.map(field => `<col data-field-id="${esc(field.id)}" style="width:${field.width}px">`).join('')}<col style="width:90px"></colgroup><thead><tr>${fields.map(field => `<th data-field-id="${esc(field.id)}" style="width:${field.width}px"><div class="mv5-field-head"><strong>${esc(field.name)}</strong></div><span class="mv5-col-resizer" data-mv5-resize="${esc(field.id)}"></span></th>`).join('')}<th class="mv5-sticky-actions">操作</th></tr></thead><tbody>${body || `<tr><td colspan="${fields.length + 1}" class="mv5-empty-page">暂无记录</td></tr>`}</tbody></table></div>`;
    }

    function render() {
        installViewportFix();
        const screen = document.getElementById('memory-table-screen');
        if (!screen) return;
        const previousShell = screen.querySelector('.mv5-shell');
        if (previousShell && !state.resetScroll) state.scrollTop = previousShell.scrollTop;
        if (state.resetScroll) { state.scrollTop = 0; state.resetScroll = false; }
        const chat = getCurrentChat();
        if (!chat) {
            screen.innerHTML = '<header class="app-header"><button class="back-btn" data-target="home-screen">‹</button><div class="title-container"><h1 class="title">记忆</h1></div></header><main class="content"><div class="placeholder-text"><p>请先进入一个角色聊天。</p></div></main>';
            return;
        }
        const store = ensureStore(chat);
        const table = activeTable(chat);
        const allRows = table ? tableRows(store, table) : [];
        const page = paginate(allRows, store);
        const rows = page.rows;
        const categories = table ? unique((store.records[table.id] || []).map(record => record.category)) : [];
        const tags = table ? unique((store.records[table.id] || []).flatMap(record => record.tags)) : [];
        screen.innerHTML = `<header class="app-header mv5-header">
<button class="back-btn" data-target="chat-room-screen">‹</button>
<div class="title-container"><h1 class="title">记忆</h1><small>${esc(chat.remarkName || chat.realName || '当前角色')}</small></div>
<div class="action-btn-group"><button class="action-btn" data-mv5-action="new-table" title="新建表">＋</button><button class="action-btn" data-mv5-action="settings" title="设置">⚙</button></div>
</header>
<main class="content mv5-shell">
<section class="mv5-topbar"><div><strong>动态记忆 V5.8.0</strong><span>上下文治理 · 真实来源清单 · 精简操作记录</span></div><div class="mv5-top-actions"><button class="btn btn-small btn-secondary" data-mv5-action="export-template">导出空模板</button><button class="btn btn-small btn-secondary" data-mv5-action="export">导出全部</button><button class="btn btn-small btn-secondary" data-mv5-action="import">导入</button><input id="mv5-import-input" type="file" accept="application/json,.json" hidden></div></section>
<section class="mv5-layout">
<aside class="mv5-sidebar"><div class="mv5-sidebar-head"><strong>表格</strong><span>${store.tables.length}</span></div><div class="mv5-table-list">${store.tables.map(item => `<button class="mv5-table-item ${item.id === table?.id ? 'active' : ''}" data-mv5-table="${esc(item.id)}"><span class="mv5-table-name">${tableUpdateDot(chat, item.id)}${esc(item.name)}</span><b class="mv5-group mv5-${item.group}">${groupLabel(item.group)}</b></button>`).join('')}</div></aside>
<section class="mv5-main">${table ? `<div class="mv5-table-head"><div><h2>${esc(table.name)}</h2><p>${esc(table.description || '未填写用途说明')}</p>${table.extractPrompt ? `<div class="mv5-extract"><b>AI提取说明：</b>${esc(table.extractPrompt)}</div>` : ''}</div><div class="mv5-table-actions"><button class="btn btn-small btn-primary" data-mv5-action="new-record">新增记录</button>${['v5_recent_events','v5_thoughts'].includes(table.id) ? '<button class="btn btn-small btn-primary" data-mv5-action="compress">压缩所选短期记录</button><button class="btn btn-small btn-secondary" data-mv5-action="delete-compressed">删除已压缩记录</button>' : ''}${['v5_event_summary','v5_thought_summary'].includes(table.id) ? '<button class="btn btn-small btn-primary" data-mv5-action="long-term-draft">生成长期草稿</button>' : ''}<button class="btn btn-small btn-secondary" data-mv5-action="sort">多维排序</button>${table.locked ? '' : '<button class="btn btn-small btn-secondary" data-mv5-action="edit-table">表设置</button><button class="btn btn-small btn-danger" data-mv5-action="delete-table">删除表</button>'}</div></div>
<div class="mv5-rule-line"><span>${table.viewMode === 'kv' ? 'KV：单例表单' : 'Rows：多行记录'}</span><span>${groupLabel(table.group)}</span><span>${writeLabel(table.behavior.writePolicy)}</span><span>${contextLabel(table.behavior.contextPolicy)}</span>${table.behavior.retentionDays ? `<span>保留/引用${table.behavior.retentionDays}天</span>` : '<span>时间不限</span>'}${table.behavior.chatStatus ? '<span>状态栏来源</span>' : ''}</div>
<div class="mv5-filters"><input id="mv5-search" type="search" placeholder="搜索当前表" value="${esc(state.search)}">${table.id === M.constants.FAVORITE_TABLE_ID ? '' : `<select id="mv5-category"><option value="">全部分类</option>${categories.map(value => `<option ${value === state.category ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select>`}<select id="mv5-tag"><option value="">全部标签</option>${tags.map(value => `<option ${value === state.tag ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></div>
${table.viewMode === 'kv' ? renderKv(chat, table, rows) : renderRows(chat, table, rows)}${renderPager(page)}` : '<div class="mv5-empty-page">当前没有表格。</div>'}</section>
</section></main>`;
        bindScreenEvents(screen, chat, store, table);
        const shell = screen.querySelector('.mv5-shell');
        if (shell) {
            shell.scrollTop = state.scrollTop;
            shell.addEventListener('scroll', () => { state.scrollTop = shell.scrollTop; }, { passive: true });
        }
        if (state.restoreSearchFocus) {
            const search = screen.querySelector('#mv5-search');
            search?.focus?.({ preventScroll: true });
            search?.setSelectionRange?.(state.searchSelection, state.searchSelection);
            state.restoreSearchFocus = false;
        }
        refreshStateBar(chat);
    }

    function bindScreenEvents(screen, chat, store, table) {
        screen.querySelectorAll('[data-target]').forEach(button => button.addEventListener('click', () => global.switchScreen?.(button.dataset.target)));
        screen.querySelectorAll('[data-mv5-table]').forEach(button => button.addEventListener('click', () => {
            state.activeTableId = button.dataset.mv5Table;
            state.search = state.category = state.tag = '';
            state.page = 1;
            state.resetScroll = true;
            render();
        }));
        screen.querySelector('#mv5-search')?.addEventListener('input', event => {
            state.search = event.target.value;
            state.page = 1;
            state.restoreSearchFocus = true;
            state.searchSelection = event.target.selectionStart ?? state.search.length;
            clearTimeout(state.searchTimer);
            state.searchTimer = setTimeout(render, 120);
        });
        screen.querySelector('#mv5-category')?.addEventListener('change', event => { state.category = event.target.value; state.page = 1; render(); });
        screen.querySelector('#mv5-tag')?.addEventListener('change', event => { state.tag = event.target.value; state.page = 1; render(); });
        screen.querySelectorAll('[data-mv5-page]').forEach(button => button.addEventListener('click', () => {
            const action = button.dataset.mv5Page;
            const info = paginate(tableRows(store, table), store);
            if (action === 'first') state.page = 1;
            if (action === 'prev') state.page = Math.max(1, state.page - 1);
            if (action === 'next') state.page = Math.min(info.pages, state.page + 1);
            if (action === 'last') state.page = info.pages;
            state.resetScroll = true;
            render();
        }));
        screen.querySelectorAll('[data-mv5-action]').forEach(button => button.addEventListener('click', async () => {
            const action = button.dataset.mv5Action;
            try {
                if (action === 'new-table') openTableEditor(chat, null);
                if (action === 'edit-table' && table) openTableEditor(chat, table);
                if (action === 'new-record' && table) openRecordEditor(chat, table, table.viewMode === 'kv' ? ((store.records[table.id] || [])[0] || null) : null);
                if (action === 'compress' && table) openCompression(chat, table);
                if (action === 'long-term-draft' && table) openLongTermDraft(chat, table);
                if (action === 'delete-compressed' && table) {
                    const count = (store.records[table.id] || []).filter(record => record.compressedAt).length;
                    if (!count) return toast('当前没有已压缩记录');
                    if (confirm(`确定删除${count}条已压缩记录吗？中期总结不会删除。`)) {
                        const result = await deleteCompressed(chat, table.id);
                        toast(`已删除${result.deleted}条短期记录`);
                        render();
                    }
                }
                if (action === 'sort' && table) openSortEditor(chat, table);
                if (action === 'settings') openSettings(chat);
                if (action === 'export') exportStore(chat, false);
                if (action === 'export-template') exportStore(chat, true);
                if (action === 'import') screen.querySelector('#mv5-import-input')?.click();
                if (action === 'delete-table' && table) await deleteTable(chat, table);
            } catch (error) {
                console.error('[MemoryV5 UI]', error);
                toast(error.message || String(error));
            }
        }));
        screen.querySelector('#mv5-import-input')?.addEventListener('change', async event => {
            try {
                await prepareImport(chat, event.target.files?.[0]);
            } catch (error) {
                console.error('[MemoryV5 Import]', error);
                showImportError(error);
            } finally {
                event.target.value = '';
            }
        });
        screen.querySelectorAll('[data-mv5-edit-record]').forEach(button => button.addEventListener('click', () => {
            const record = (store.records[table.id] || []).find(item => item.id === button.dataset.mv5EditRecord);
            openRecordEditor(chat, table, record || null);
        }));
        screen.querySelectorAll('[data-mv5-delete-record]').forEach(button => button.addEventListener('click', async () => {
            if (!confirm('确定删除这条记录吗？')) return;
            store.records[table.id] = (store.records[table.id] || []).filter(record => record.id !== button.dataset.mv5DeleteRecord);
            await persist(chat);
            render();
        }));
        bindColumnResize(screen, chat, table);
    }

    function bindColumnResize(screen, chat, table) {
        if (!table || table.viewMode !== 'rows') return;
        screen.querySelectorAll('[data-mv5-resize]').forEach(handle => handle.addEventListener('pointerdown', event => {
            event.preventDefault();
            const field = table.fields.find(item => item.id === handle.dataset.mv5Resize);
            const th = handle.closest('th');
            if (!field || !th) return;
            const startX = event.clientX;
            const startWidth = th.getBoundingClientRect().width;
            handle.setPointerCapture?.(event.pointerId);
            const syncGridWidth = () => {
                const grid = th.closest('table');
                if (!grid) return;
                const total = visibleFields(table).reduce((sum, item) => sum + item.width, 0) + 90;
                grid.style.width = `${total}px`;
            };
            const move = moveEvent => {
                field.width = Math.max(80, Math.min(800, Math.round(startWidth + moveEvent.clientX - startX)));
                th.style.width = `${field.width}px`;
                screen.querySelectorAll(`[data-field-id="${field.id}"]`).forEach(cell => { cell.style.width = `${field.width}px`; });
                syncGridWidth();
            };
            const up = async upEvent => {
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', up);
                handle.removeEventListener('pointercancel', up);
                try { handle.releasePointerCapture?.(upEvent?.pointerId); } catch (_) {}
                await persist(chat);
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', up);
            handle.addEventListener('pointercancel', up);
        }));
    }

    function modal(title, body, onSave, options = {}) {
        installViewportFix();
        const overlay = document.createElement('div');
        overlay.className = `mv5-modal-overlay ${options.className || ''}`;
        overlay.innerHTML = `<section class="mv5-modal" role="dialog" aria-modal="true"><header class="mv5-modal-header"><h2>${esc(title)}</h2><button type="button" class="mv5-modal-close">×</button></header><form class="mv5-modal-form"><div class="mv5-modal-body">${body}</div><footer class="mv5-modal-footer"><button type="button" class="btn btn-secondary mv5-cancel">${esc(options.cancelLabel || '取消')}</button><button type="submit" class="btn btn-primary">${esc(options.saveLabel || '保存')}</button></footer></form></section>`;
        document.body.appendChild(overlay);
        document.body.classList.add('mv5-modal-open');
        const close = () => {
            overlay.remove();
            if (!document.querySelector('.mv5-modal-overlay')) document.body.classList.remove('mv5-modal-open');
        };
        overlay.querySelector('.mv5-modal-close').addEventListener('click', close);
        overlay.querySelector('.mv5-cancel').addEventListener('click', close);
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        const formElement = overlay.querySelector('form');
        formElement.addEventListener('submit', async event => {
            event.preventDefault();
            const save = formElement.querySelector('[type="submit"]');
            save.disabled = true;
            try {
                await onSave(new FormData(formElement), overlay);
                close();
            } catch (error) {
                save.disabled = false;
                const box = overlay.querySelector('.mv5-form-error') || document.createElement('div');
                box.className = 'mv5-form-error';
                box.textContent = error.message || String(error);
                if (!box.parentNode) overlay.querySelector('.mv5-modal-body').prepend(box);
            }
        });
        overlay.querySelectorAll('textarea').forEach(autoGrow);
        overlay.addEventListener('input', event => { if (event.target.tagName === 'TEXTAREA') autoGrow(event.target); });
        overlay.addEventListener('focusin', event => {
            if (!event.target.matches?.('input, textarea, select')) return;
            setTimeout(() => event.target.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'smooth' }), 80);
        });
        options.onOpen?.(overlay);
        return overlay;
    }

    function autoGrow(textarea) {
        if (!textarea) return;
        const viewportHeight = global.visualViewport?.height || global.innerHeight || 720;
        const isFieldHint = textarea.classList.contains('mv5-field-hint');
        const minHeight = isFieldHint ? 120 : 84;
        const maxHeight = isFieldHint
            ? Math.max(220, Math.min(420, Math.round(viewportHeight * 0.52)))
            : Math.max(180, Math.min(520, Math.round(viewportHeight * 0.46)));
        textarea.style.height = 'auto';
        const wanted = Math.max(minHeight, textarea.scrollHeight + 4);
        textarea.style.height = `${Math.min(maxHeight, wanted)}px`;
        textarea.style.overflowY = wanted > maxHeight ? 'auto' : 'hidden';
    }

    function fieldRowHtml(field) {
        const common = field.scope === 'common';
        return `<tr class="mv5-field-row" data-field-id="${esc(field.id)}" data-common-key="${esc(field.commonKey || '')}">
<td><div class="mv5-order-buttons"><button type="button" data-move-field="up">↑</button><button type="button" data-move-field="down">↓</button></div></td>
<td><input class="mv5-field-name" value="${esc(field.name)}" ${common ? 'readonly' : ''}>${common ? '<small class="mv5-common-mark">公共字段</small>' : ''}</td>
<td><input class="mv5-field-category" value="${esc(field.category || '')}" placeholder="例如：用户档案" ${common ? 'readonly' : ''}></td>
<td><select class="mv5-field-type" ${common ? 'disabled' : ''}>${Array.from(M.constants.FIELD_TYPES).map(type => `<option value="${type}" ${type === field.type ? 'selected' : ''}>${type}</option>`).join('')}</select></td>
<td><input class="mv5-field-width" type="number" min="80" max="800" value="${field.width}"></td>
<td><input class="mv5-field-options" value="${esc(field.options.join('，'))}" placeholder="选项，逗号分隔" ${common ? 'readonly' : ''}></td>
<td class="mv5-check-cell"><input class="mv5-field-required" type="checkbox" aria-label="必填" title="必填" ${field.required ? 'checked' : ''}></td>
<td class="mv5-check-cell"><input class="mv5-field-visible" type="checkbox" aria-label="显示" title="显示" ${field.hidden ? '' : 'checked'}></td>
<td class="mv5-hint-cell"><textarea class="mv5-field-hint" rows="6" placeholder="告诉AI如何填写这个字段">${esc(field.aiHint)}</textarea></td>
<td>${common ? '<span class="mv5-no-delete">必需</span>' : '<button type="button" class="mv5-delete-field" data-remove-field>删除</button>'}</td>
</tr>`;
    }

    function readFields(wrap) {
        return Array.from(wrap.querySelectorAll('.mv5-field-row')).map((row, index) => ({
            id: text(row.dataset.fieldId) || id('memory_field'),
            scope: row.dataset.commonKey ? 'common' : 'custom',
            commonKey: text(row.dataset.commonKey),
            name: text(row.querySelector('.mv5-field-name').value),
            category: text(row.querySelector('.mv5-field-category')?.value),
            type: row.querySelector('.mv5-field-type').value,
            width: parseInt(row.querySelector('.mv5-field-width').value, 10) || 160,
            options: unique(row.querySelector('.mv5-field-options').value),
            hidden: !row.querySelector('.mv5-field-visible').checked,
            aiHint: text(row.querySelector('.mv5-field-hint').value),
            required: row.dataset.commonKey ? true : row.querySelector('.mv5-field-required').checked,
            order: index
        }));
    }

    function selectedFieldIds(value, fields) {
        const names = unique(value);
        return names.map(name => fields.find(field => field.name === name || field.id === name)?.id).filter(Boolean);
    }

    function openTableEditor(chat, existing) {
        if (existing?.locked) return toast('收藏记忆是系统表，只能编辑其中的记录。');
        const store = ensureStore(chat);
        const table = existing ? clone(existing) : normalizeTable({
            name: '新记忆表',
            group: 'short',
            viewMode: 'rows',
            fields: M.constants.COMMON_KEYS.map(key => M.model.commonField(key)),
            behavior: { writePolicy: 'manual', contextPolicy: 'relevant' }
        }, store.tables.length);
        const sourceTables = store.tables.filter(item => item.id !== table.id);
        const body = `<section class="mv5-form-card"><h3>基本信息</h3><div class="mv5-form-grid"><label><span>表名</span><input name="name" value="${esc(table.name)}" required></label><label><span>显示方式</span><select name="viewMode"><option value="rows">Rows：多行记录</option><option value="kv">KV：单例表单</option></select></label><label><span>分组</span><select name="group"><option value="core">核心</option><option value="current">状态</option><option value="short">短期</option><option value="medium">中期</option><option value="long">长期</option></select></label></div><label class="mv5-block-field"><span>用途说明</span><textarea name="description" rows="4">${esc(table.description)}</textarea></label><label class="mv5-block-field"><span>extractPrompt（AI理解表格用途）</span><textarea name="extractPrompt" rows="5">${esc(table.extractPrompt)}</textarea></label></section>
<section class="mv5-form-card"><h3>写入与上下文</h3><div class="mv5-form-grid"><label><span>写入方式</span><select name="writePolicy"><option value="manual">手动更新</option><option value="auto">随聊天更新（V5.1）</option><option value="summary">短期压缩（V5.2）</option></select></label><label><span>上下文发送</span><select name="contextPolicy"><option value="always">每轮发送</option><option value="relevant">相关时发送</option><option value="never">不发送</option></select></label><label><span>有效/引用天数</span><input name="retentionDays" type="number" min="0" value="${table.behavior.retentionDays}"><small>0表示不限</small></label><label class="mv5-check"><input type="checkbox" name="chatStatus" ${table.behavior.chatStatus ? 'checked' : ''}>聊天状态栏来源</label></div><div class="mv5-form-grid"><label><span>识别同一记录的字段</span><input name="identityFields" value="${esc(table.behavior.identityFieldIds.map(fieldId => table.fields.find(field => field.id === fieldId)?.name).filter(Boolean).join('，'))}" placeholder="标题，相关主体"></label><label><span>上下文内容字段</span><input name="contextFields" value="${esc(table.behavior.contextFieldIds.map(fieldId => table.fields.find(field => field.id === fieldId)?.name).filter(Boolean).join('，'))}" placeholder="标题，内容，标签"></label></div>${sourceTables.length ? `<div class="mv5-source-list"><strong>压缩来源表</strong>${sourceTables.map(item => `<label><input type="checkbox" name="sourceTableIds" value="${esc(item.id)}" ${table.behavior.sourceTableIds.includes(item.id) ? 'checked' : ''}>${esc(item.name)}</label>`).join('')}</div>` : ''}</section>
<section class="mv5-form-card"><h3>分类与标签提示</h3><p class="mv5-help">分类和标签由用户提供常用提示，AI后续可按开关补充；它们只用于归类与检索，不阻止写入。</p><div class="mv5-form-grid"><label><span>分类提示</span><textarea name="categoryHints" rows="3">${esc(table.categoryHints.join('，'))}</textarea></label><label><span>标签提示</span><textarea name="tagHints" rows="3">${esc(table.tagHints.join('，'))}</textarea></label><label class="mv5-check"><input type="checkbox" name="supplementCategories" ${table.aiCanSupplementCategories ? 'checked' : ''}>AI可以补充新分类</label><label class="mv5-check"><input type="checkbox" name="supplementTags" ${table.aiCanSupplementTags ? 'checked' : ''}>AI可以补充新标签</label></div></section>
<section class="mv5-form-card mv5-fields-card"><div class="mv5-card-title"><div><h3>字段设置</h3><p>KV模式是动态单例表单：每个自定义字段可设置所属分类，左侧会按分类分组显示；不存在固定业务字段。Rows模式才使用记录级分类、标签、标题、内容、来源和时间等公共字段。每个自定义字段都可以独立设置必填。</p></div><button type="button" id="mv5-add-field" class="btn btn-small btn-secondary">添加字段</button></div><div class="mv5-fields-scroll"><table class="mv5-fields-table"><thead><tr><th>顺序</th><th>字段名</th><th>分类</th><th>类型</th><th>宽度</th><th>选项</th><th>必填</th><th>显示</th><th>aiHint</th><th class="mv5-sticky-actions">操作</th></tr></thead><tbody id="mv5-fields-list">${table.fields.map(fieldRowHtml).join('')}</tbody></table></div></section>`;

        modal(existing ? '编辑表格' : '新建表格', body, async (form, wrap) => {
            table.name = text(form.get('name'));
            if (!table.name) throw new Error('表名不能为空。');
            table.viewMode = form.get('viewMode') === 'kv' ? 'kv' : 'rows';
            table.group = M.constants.GROUPS.has(text(form.get('group'))) ? text(form.get('group')) : 'short';
            table.description = text(form.get('description'));
            table.extractPrompt = text(form.get('extractPrompt'));
            table.fields = readFields(wrap);
            if (table.viewMode === 'kv') {
                // KV字段结构完全由用户定义；切换为KV时移除全部公共字段。
                table.fields = table.fields.filter(field => field.scope === 'custom');
            }
            table.categoryHints = unique(form.get('categoryHints'));
            table.tagHints = unique(form.get('tagHints'));
            table.aiCanSupplementCategories = form.get('supplementCategories') === 'on';
            table.aiCanSupplementTags = form.get('supplementTags') === 'on';
            table.behavior.writePolicy = M.constants.WRITE_POLICIES.has(text(form.get('writePolicy'))) ? text(form.get('writePolicy')) : 'manual';
            table.behavior.contextPolicy = M.constants.CONTEXT_POLICIES.has(text(form.get('contextPolicy'))) ? text(form.get('contextPolicy')) : 'relevant';
            table.behavior.retentionDays = table.id === 'v5_current_state' ? 0 : Math.max(0, parseInt(form.get('retentionDays'), 10) || 0);
            table.behavior.chatStatus = form.get('chatStatus') === 'on';
            table.behavior.allowAiWrite = table.behavior.writePolicy === 'auto' && (table.group === 'current' || table.group === 'short');
            table.behavior.identityFieldIds = table.viewMode === 'kv' ? [] : selectedFieldIds(form.get('identityFields'), table.fields);
            table.behavior.contextFieldIds = selectedFieldIds(form.get('contextFields'), table.fields);
            if (table.viewMode === 'kv' && !table.behavior.contextFieldIds.length) {
                table.behavior.contextFieldIds = table.fields.filter(field => field.scope === 'custom' && !field.hidden).map(field => field.id);
            }
            table.behavior.sourceTableIds = form.getAll('sourceTableIds').map(text).filter(Boolean);
            if (table.group === 'core' || table.group === 'long') {
                table.behavior.writePolicy = 'manual';
                table.behavior.allowAiWrite = false;
            }
            if (table.group === 'medium') {
                if (table.behavior.writePolicy === 'auto') table.behavior.writePolicy = 'summary';
                table.behavior.allowAiWrite = false;
            }
            if (table.behavior.chatStatus) store.tables.forEach(item => { if (item.id !== table.id) item.behavior.chatStatus = false; });
            const normalized = normalizeTable(table, existing ? store.tables.findIndex(item => item.id === existing.id) : store.tables.length);
            if (existing) {
                const index = store.tables.findIndex(item => item.id === existing.id);
                store.tables[index] = normalized;
                if (normalized.viewMode === 'kv') {
                    const migrated = M.model.migrateLegacyKvTable(normalized, store.records[normalized.id] || []);
                    store.tables[index] = migrated.table;
                    store.records[normalized.id] = migrated.records;
                }
                const validCustom = new Set(store.tables[index].fields.filter(field => field.scope === 'custom').map(field => field.id));
                (store.records[normalized.id] || []).forEach(record => {
                    Object.keys(record.values || {}).forEach(fieldId => { if (!validCustom.has(fieldId)) delete record.values[fieldId]; });
                });
            } else {
                store.tables.push(normalized);
                store.records[normalized.id] = [];
                state.activeTableId = normalized.id;
            }
            await persist(chat);
            render();
        }, { className: 'mv5-table-editor-overlay', onOpen(wrap) {
            const viewModeSelect = wrap.querySelector('[name="viewMode"]');
            viewModeSelect.value = table.viewMode;
            const syncModeUi = () => {
                const isKv = viewModeSelect.value === 'kv';
                wrap.querySelectorAll('.mv5-field-row').forEach(row => {
                    if (row.dataset.commonKey) row.hidden = isKv;
                });
                const identityInput = wrap.querySelector('[name="identityFields"]');
                if (identityInput) {
                    identityInput.disabled = isKv;
                    identityInput.placeholder = isKv ? 'KV单例无需身份字段' : '标题，相关主体';
                }
                const hintSection = wrap.querySelector('[name="categoryHints"]')?.closest('.mv5-form-card');
                if (hintSection) hintSection.hidden = isKv;
            };
            viewModeSelect.addEventListener('change', syncModeUi);
            syncModeUi();
            wrap.querySelector('[name="group"]').value = table.group;
            wrap.querySelector('[name="writePolicy"]').value = table.behavior.writePolicy;
            wrap.querySelector('[name="contextPolicy"]').value = table.behavior.contextPolicy;
            const protectedGroup = ['core', 'medium', 'long'].includes(table.group);
            const autoOption = wrap.querySelector('[name="writePolicy"] option[value="auto"]');
            if (autoOption) autoOption.disabled = protectedGroup;
            const retentionInput = wrap.querySelector('[name="retentionDays"]');
            if (retentionInput && table.id === 'v5_current_state') {
                retentionInput.value = '0';
                retentionInput.disabled = true;
                retentionInput.closest('label')?.querySelector('small')?.replaceChildren(document.createTextNode('当前状态不按天自动失效，由后续状态更新或手动删除结束'));
            }
            wrap.querySelector('#mv5-add-field').addEventListener('click', () => {
                const field = customField('新字段', 'text');
                wrap.querySelector('#mv5-fields-list').insertAdjacentHTML('beforeend', fieldRowHtml(field));
                wrap.querySelectorAll('textarea').forEach(autoGrow);
            });
            wrap.addEventListener('click', event => {
                const row = event.target.closest('.mv5-field-row');
                if (event.target.matches('[data-remove-field]') && row) {
                    const fieldId = row.dataset.fieldId;
                    const fieldName = row.querySelector('.mv5-field-name')?.value || '该字段';
                    const used = existing ? (store.records[existing.id] || []).filter(record => Object.prototype.hasOwnProperty.call(record.values || {}, fieldId) && record.values[fieldId] !== '' && record.values[fieldId] != null).length : 0;
                    if (used && !confirm(`字段“${fieldName}”在${used}条记录中有内容。删除并保存后，这些字段值会永久移除。是否继续？`)) return;
                    row.remove();
                }
                if (event.target.matches('[data-move-field="up"]') && row?.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
                if (event.target.matches('[data-move-field="down"]') && row?.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
            });
        }});
    }

    function controlForField(field, value) {
        const name = `field_${field.id}`;
        const automatic = field.scope === 'common' && ['source', 'time'].includes(field.commonKey);
        if (field.type === 'longtext') return `<textarea name="${esc(name)}" rows="5" ${automatic ? 'readonly' : ''}>${esc(value || '')}</textarea>`;
        if (field.type === 'select') return `<select name="${esc(name)}" ${automatic ? 'disabled' : ''}><option value=""></option>${field.options.map(option => `<option value="${esc(option)}" ${text(value) === option ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select>`;
        if (field.type === 'multiselect') return `<input name="${esc(name)}" value="${esc(Array.isArray(value) ? value.join('，') : value || '')}" placeholder="逗号分隔" ${automatic ? 'readonly' : ''}>`;
        if (field.type === 'boolean') return `<label class="mv5-check"><input type="checkbox" name="${esc(name)}" ${value ? 'checked' : ''} ${automatic ? 'disabled' : ''}>是</label>`;
        const type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'text' : 'text';
        const max = field.scope === 'common' && field.commonKey === 'title' ? 'maxlength="10"' : '';
        return `<input type="${type}" name="${esc(name)}" value="${esc(value || '')}" ${max} ${automatic ? 'readonly' : ''}>`;
    }

    function openRecordEditor(chat, table, existing) {
        const record = existing ? clone(existing) : normalizeRecord({ source: '用户明确', time: localDateTimeSeconds() }, table);
        if (!existing && table.id === M.constants.FAVORITE_TABLE_ID) {
            const collectorField = table.fields.find(field => field.id === 'favorite_collectors');
            const messageTimeField = table.fields.find(field => field.id === 'favorite_message_time');
            if (collectorField) setFieldValue(record, collectorField, ['用户'], { table });
            if (messageTimeField) setFieldValue(record, messageTimeField, localDateTimeSeconds(), { table });
        }
        const body = `<div class="mv5-record-form">${visibleFields(table).map(field => `<div class="mv5-record-field"><label><span>${esc(field.name)}${field.required ? ' *' : ''}</span>${field.aiHint ? `<small>${esc(field.aiHint)}</small>` : ''}</label><div>${controlForField(field, getFieldValue(record, field))}</div></div>`).join('')}</div>`;
        modal(table.viewMode === 'kv' ? '编辑表单' : (existing ? '编辑记录' : '新增记录'), body, async form => {
            const values = {};
            visibleFields(table).forEach(field => {
                if (field.scope === 'common' && ['source', 'time'].includes(field.commonKey)) return;
                const name = `field_${field.id}`;
                let value = field.type === 'boolean' ? form.get(name) === 'on' : form.get(name);
                if (field.type === 'multiselect') value = unique(value);
                values[field.id] = value;
            });
            const titleField = table.fields.find(field => field.scope === 'common' && field.commonKey === 'title');
            if (table.viewMode !== 'kv' && titleField && titleField.hidden !== true && !text(values[titleField.id])) throw new Error('标题不能为空。');
            const operation = { tableId: table.id, action: existing ? 'upsert' : 'add', recordId: existing?.id, values };
            const result = applyOperations(chat, [operation], { origin: 'manual' });
            if (!result.changed.length && !result.checked.length) throw new Error(result.rejected[0]?.reason || '保存失败。');
            await persist(chat);
            render();
            refreshStateBar(chat);
        }, { className: 'mv5-record-editor-overlay' });
    }

    function openSortEditor(chat, table) {
        const rowHtml = rule => `<div class="mv5-sort-row"><button type="button" data-move-sort="up">↑</button><button type="button" data-move-sort="down">↓</button><select class="mv5-sort-field">${visibleFields(table).map(field => `<option value="${esc(field.id)}" ${field.id === rule?.fieldId ? 'selected' : ''}>${esc(field.name)}</option>`).join('')}</select><select class="mv5-sort-direction"><option value="asc" ${rule?.direction === 'asc' ? 'selected' : ''}>升序</option><option value="desc" ${rule?.direction !== 'asc' ? 'selected' : ''}>降序</option></select><button type="button" data-remove-sort>删除</button></div>`;
        const body = `<p class="mv5-help">从上到下依次作为第一、第二、第三排序条件。</p><div id="mv5-sort-list">${(table.display.sortRules || []).map(rowHtml).join('')}</div><button type="button" id="mv5-add-sort" class="btn btn-small btn-secondary">添加排序条件</button>`;
        modal('多维排序', body, async (form, wrap) => {
            const seen = new Set();
            table.display.sortRules = Array.from(wrap.querySelectorAll('.mv5-sort-row')).map(row => ({ fieldId: row.querySelector('.mv5-sort-field').value, direction: row.querySelector('.mv5-sort-direction').value === 'asc' ? 'asc' : 'desc' })).filter(rule => {
                if (!rule.fieldId || seen.has(rule.fieldId)) return false;
                seen.add(rule.fieldId);
                return true;
            });
            await persist(chat);
            render();
        }, { onOpen(wrap) {
            wrap.querySelector('#mv5-add-sort').addEventListener('click', () => wrap.querySelector('#mv5-sort-list').insertAdjacentHTML('beforeend', rowHtml({})));
            wrap.addEventListener('click', event => {
                const row = event.target.closest('.mv5-sort-row');
                if (event.target.matches('[data-remove-sort]')) row?.remove();
                if (event.target.matches('[data-move-sort="up"]') && row?.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
                if (event.target.matches('[data-move-sort="down"]') && row?.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
            });
        }});
    }

    function openSettings(chat) {
        const store = ensureStore(chat);
        const settings = store.settings;
        const body = `<section class="mv5-form-card"><h3>全局设置</h3><div class="mv5-form-grid"><label class="mv5-check"><input type="checkbox" name="enabled" ${settings.enabled ? 'checked' : ''}>启用记忆上下文与自动写入</label><label class="mv5-check"><input type="checkbox" name="roundNoticeEnabled" ${settings.roundNoticeEnabled ? 'checked' : ''}>每轮显示记忆处理结果</label><label><span>上下文最多记录数</span><input type="number" name="contextMaxRecords" min="1" value="${settings.contextMaxRecords}"></label><label><span>相关表每表最多记录</span><input type="number" name="relevantMaxPerTable" min="1" max="20" value="${settings.relevantMaxPerTable}"></label><label><span>收藏每轮发送上限</span><input type="number" name="favoriteMaxPerRound" min="0" step="1" value="${Number.isFinite(Number(settings.favoriteMaxPerRound)) ? Number(settings.favoriteMaxPerRound) : 5}"><small>可填任意非负整数；0表示不设收藏独立条数上限，仍受上下文总记录数与字符预算限制</small></label><label><span>表格每页记录数</span><input type="number" name="tablePageSize" min="20" max="500" value="${settings.tablePageSize || 100}"><small>大量记录时分页显示，建议50—200</small></label><label><span>始终注入标签</span><input name="alwaysInject" value="${esc(settings.tagBehaviors.alwaysInject.join('，'))}"></label><label><span>禁止注入标签</span><input name="neverInject" value="${esc(settings.tagBehaviors.neverInject.join('，'))}"></label></div><p class="mv5-help">独立提醒/待办已删除。V5.8.0：核心档案按字段分类前置发送；世界书保留身份前、身份后、场景后置三个真实位置。</p></section>`;
        modal('记忆设置', body, async form => {
            settings.enabled = form.get('enabled') === 'on';
            settings.roundNoticeEnabled = form.get('roundNoticeEnabled') === 'on';
            settings.contextMaxRecords = Math.max(1, parseInt(form.get('contextMaxRecords'), 10) || 32);
            settings.relevantMaxPerTable = Math.max(1, Math.min(20, parseInt(form.get('relevantMaxPerTable'), 10) || 5));
            const favoriteMax = parseInt(form.get('favoriteMaxPerRound'), 10);
            settings.favoriteMaxPerRound = Number.isFinite(favoriteMax) ? Math.max(0, favoriteMax) : 5;
            settings.tablePageSize = Math.max(20, Math.min(500, parseInt(form.get('tablePageSize'), 10) || 100));
            settings.tagBehaviors.alwaysInject = unique(form.get('alwaysInject'));
            settings.tagBehaviors.neverInject = unique(form.get('neverInject'));
            await persist(chat);
            render();
        });
    }

    async function deleteTable(chat, table) {
        if (table?.locked) return toast('收藏记忆是系统表，不能删除整张表。');
        const store = ensureStore(chat);
        const recordCount = (store.records[table.id] || []).length;
        const dependents = store.tables.filter(item => item.id !== table.id && item.behavior.sourceTableIds.includes(table.id)).map(item => item.name);
        const dependencyText = dependents.length ? `\n它还是以下表格的压缩来源：${dependents.join('、')}。删除后会同时解除这些来源关系。` : '';
        if (!confirm(`确定删除“${table.name}”吗？\n将永久删除${recordCount}条记录，且无法在应用内撤销。${dependencyText}\n建议先导出全部记忆库备份。`)) return;
        store.tables = store.tables.filter(item => item.id !== table.id);
        store.tables.forEach(item => { item.behavior.sourceTableIds = item.behavior.sourceTableIds.filter(sourceId => sourceId !== table.id); });
        delete store.records[table.id];
        state.activeTableId = '';
        state.page = 1;
        state.resetScroll = true;
        await persist(chat);
        render();
    }

    function downloadJson(filename, data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportStore(chat, templateOnly) {
        const store = ensureStore(chat);
        const safe = (chat.remarkName || chat.realName || chat.id || '角色').replace(/[\\/:*?"<>|]/g, '_');
        const snapshot = M.model.normalizeStore(clone(store));
        if (templateOnly) {
            downloadJson(`memoryTemplate_V5_4_1b_${safe}.json`, { version: M.STORE_VERSION, type: 'memory-table-template', appVersion: M.VERSION, exportedAt: new Date().toISOString(), settings: snapshot.settings, tables: snapshot.tables, records: {} });
        } else {
            downloadJson(`memoryStore_V5_4_1b_${safe}_${new Date().toISOString().slice(0, 10)}.json`, Object.assign({ type: 'memory-store', appVersion: M.VERSION, exportedAt: new Date().toISOString() }, snapshot));
        }
    }

    async function prepareImport(chat, file) {
        if (!file) return;
        let parsed;
        try {
            parsed = JSON.parse(await file.text());
        } catch (error) {
            throw new Error(`阶段：JSON解析\n文件：${file.name}\n原因：${error.message || error}`);
        }
        let plan;
        try {
            plan = importPlan(parsed);
        } catch (error) {
            throw new Error(`阶段：表结构校验\n文件：${file.name}\n原因：${error.message || error}`);
        }
        const store = ensureStore(chat);
        const conflicts = plan.tables.filter(source => store.tables.some(target => target.id === source.id || target.name === source.name));
        const body = `<section class="mv5-import-preview"><h3>导入预览</h3><dl><div><dt>文件</dt><dd>${esc(file.name)}</dd></div><div><dt>识别类型</dt><dd>${esc(plan.kind)}</dd></div><div><dt>表格数量</dt><dd>${plan.tableCount}</dd></div><div><dt>记录数量</dt><dd>${plan.recordCount}</dd></div><div><dt>冲突表格</dt><dd>${conflicts.length}</dd></div></dl><div class="mv5-form-grid"><label><span>导入方式</span><select name="mode"><option value="merge">合并到当前记忆库</option><option value="replace_all">覆盖全部表格</option></select></label><label><span>同名/同ID表格</span><select name="conflictMode"><option value="replace">覆盖表结构；未勾选记录时保留原记录</option><option value="duplicate">保留两张表</option></select></label><label class="mv5-check"><input type="checkbox" name="includeRecords" ${plan.recordCount ? 'checked' : ''}>导入文件中的记录</label><label class="mv5-check"><input type="checkbox" name="confirmReplace">选择“覆盖全部”时，我确认当前表格将被替换</label></div><p class="mv5-help">V5.4.3会在覆盖全部前自动下载当前记忆库备份；保存失败会恢复导入前内存状态。不会把V4及更早记录自动转换到V5。</p></section>`;
        modal('导入记忆表', body, async form => {
            const mode = form.get('mode');
            const includeRecords = form.get('includeRecords') === 'on';
            if (mode === 'replace_all' && form.get('confirmReplace') !== 'on') throw new Error('选择“覆盖全部表格”时，必须勾选确认。');
            const before = clone(chat.memoryStore);
            if (mode === 'replace_all') {
                const safe = (chat.remarkName || chat.realName || chat.id || '角色').replace(/[\\/:*?"<>|]/g, '_');
                downloadJson(`memoryStore_V5_4_1b_导入前备份_${safe}_${new Date().toISOString().slice(0, 10)}.json`, before);
            }
            try {
                if (mode === 'replace_all') {
                    chat.memoryStore = M.model.normalizeStore({ version: M.STORE_VERSION, settings: plan.settings, tables: plan.tables, records: includeRecords ? plan.records : {} });
                } else {
                    mergeImport(store, plan, { includeRecords, conflictMode: form.get('conflictMode') });
                }
                await persist(chat);
            } catch (error) {
                chat.memoryStore = before;
                throw new Error(`阶段：保存导入结果\n处理：已恢复导入前状态\n原因：${error.message || error}`);
            }
            state.activeTableId = '';
            state.page = 1;
            state.resetScroll = true;
            render();
            toast(`导入完成：${plan.tableCount}张表，${includeRecords ? plan.recordCount : 0}条文件记录`);
        }, { saveLabel: '开始导入' });
    }

    function showImportError(error) {
        const message = error.message || String(error);
        modal('导入失败', `<section class="mv5-import-error"><p>本次导入已中止。解析失败不会修改数据；保存阶段失败会自动恢复导入前状态。</p><pre>${esc(message)}</pre></section>`, async () => {}, { saveLabel: '关闭', cancelLabel: '返回' });
    }

    function compressionFieldControl(field, value) {
        const raw = Array.isArray(value) ? value.join('，') : (value ?? '');
        if (field.type === 'longtext') return `<textarea name="summary_${esc(field.id)}" rows="5">${esc(raw)}</textarea>`;
        if (field.type === 'select') return `<select name="summary_${esc(field.id)}"><option value=""></option>${field.options.map(option => `<option value="${esc(option)}" ${option === raw ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select>`;
        return `<input name="summary_${esc(field.id)}" value="${esc(raw)}">`;
    }

    function openCompression(chat, sourceTable) {
        const store = ensureStore(chat);
        const rows = (store.records[sourceTable.id] || []).filter(record => !record.compressedAt);
        if (!rows.length) return toast('没有可压缩的短期记录');
        const body = `<section class="mv5-form-card"><h3>选择短期记录</h3><p class="mv5-help">压缩成功后，来源记录会标记为已压缩并停止进入聊天上下文；不会立即删除。</p><div class="mv5-compression-list">${rows.map(record => `<label><input type="checkbox" name="recordIds" value="${esc(record.id)}"><span><strong>${esc(record.title || '未命名')}</strong><small>${esc(record.time || '')}</small><em>${esc(record.content || '')}</em></span></label>`).join('')}</div></section>`;
        modal('生成中期总结', body, async form => {
            const ids = form.getAll('recordIds');
            if (!ids.length) throw new Error('至少选择一条记录');
            const draft = buildSummaryDraft(chat, sourceTable.id, ids);
            const fields = visibleFields(draft.targetTable);
            const preview = `<section class="mv5-form-card"><h3>检查并编辑总结草稿</h3><p class="mv5-help">保存成功后才会标记来源记录。可在这里修改内容，避免遗漏重要事实。</p><div class="mv5-record-form">${fields.map(field => `<div class="mv5-record-field"><label><span>${esc(field.name)}</span>${field.aiHint ? `<small>${esc(field.aiHint)}</small>` : ''}</label><div>${compressionFieldControl(field, draft.values[field.name])}</div></div>`).join('')}</div></section>`;
            modal('确认中期总结', preview, async previewForm => {
                const values = {};
                fields.forEach(field => {
                    let value = previewForm.get(`summary_${field.id}`);
                    if (field.type === 'multiselect') value = text(value).split(/[，,、\n]/).map(item => item.trim()).filter(Boolean);
                    values[field.name] = value;
                });
                const result = await runAggregation(chat, sourceTable.id, ids, values);
                if (result.rejected?.length) throw new Error(result.rejected.map(item => item.reason).join('；'));
                toast(`已生成中期总结，并标记${result.sourceCount}条来源记录`);
                render();
            }, { saveLabel: '保存总结并标记来源' });
        }, { saveLabel: '生成草稿' });
    }

    function openLongTermDraft(chat, sourceTable) {
        const store = ensureStore(chat);
        const rows = store.records[sourceTable.id] || [];
        if (!rows.length) return toast('当前没有可用于提炼的中期总结');
        const body = `<section class="mv5-form-card"><h3>选择中期总结</h3><p class="mv5-help">这里只生成可编辑草稿。聊天AI不能直接写入稳定长期记忆，必须由你检查并点击保存。</p><div class="mv5-compression-list">${rows.map(record => `<label><input type="checkbox" name="recordIds" value="${esc(record.id)}"><span><strong>${esc(record.title || '未命名')}</strong><small>${esc(record.time || '')}</small><em>${esc(record.content || '')}</em></span></label>`).join('')}</div></section>`;
        modal('生成长期记忆草稿', body, async form => {
            const ids = form.getAll('recordIds');
            if (!ids.length) throw new Error('至少选择一条中期总结');
            const draft = buildLongTermDraft(chat, sourceTable.id, ids);
            const fields = visibleFields(draft.targetTable);
            const preview = `<section class="mv5-form-card"><h3>检查并编辑长期草稿</h3><p class="mv5-help">请确认它确实是长期稳定规律，并填写适用条件和例外。点击保存代表用户手动确认。</p><div class="mv5-record-form">${fields.map(field => `<div class="mv5-record-field"><label><span>${esc(field.name)}</span>${field.aiHint ? `<small>${esc(field.aiHint)}</small>` : ''}</label><div>${compressionFieldControl(field, draft.values[field.name])}</div></div>`).join('')}</div></section>`;
            modal('确认长期记忆', preview, async previewForm => {
                const values = {};
                fields.forEach(field => {
                    let value = previewForm.get(`summary_${field.id}`);
                    if (field.type === 'multiselect') value = text(value).split(/[，,、\n]/).map(item => item.trim()).filter(Boolean);
                    values[field.name] = value;
                });
                const result = await saveLongTermDraft(chat, sourceTable.id, ids, values);
                if (result.rejected?.length) throw new Error(result.rejected.map(item => item.reason).join('；'));
                toast('长期记忆已由用户确认保存');
                state.activeTableId = 'v5_stable_long_term';
                render();
            }, { saveLabel: '确认并保存长期记忆' });
        }, { saveLabel: '生成草稿' });
    }

    function setup() {
        installViewportFix();
        if (state.bound) return render();
        state.bound = true;
        migrateAllCharacters().finally(render);
    }

    function openForCharacter(characterId, tableId = '') {
        if (characterId) {
            global.currentChatId = characterId;
            global.currentChatType = 'private';
        }
        if (tableId) {
            state.activeTableId = tableId;
            state.search = state.category = state.tag = '';
            state.page = 1;
            state.resetScroll = true;
        }
        global.switchScreen?.('memory-table-screen');
        render();
    }

    M.ui = Object.freeze({ setup, render, openForCharacter, modal, openTableEditor, openRecordEditor });
})(window);
