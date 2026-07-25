(function (global) {
    'use strict';

    const M = global.MemoryV5;
    if (!M?.model || !M?.engine) throw new Error('MemoryV5 core and engine must load before UI');

    const { clone, text, esc, unique, id, localDateTimeSeconds } = M.util;
    const {
        ensureStore, getCurrentChat, persist, findTable, visibleFields, getFieldValue,
        setFieldValue, normalizeTable, normalizeRecord, importPlan, mergeImport,
        createDefaultStore, customField, migrateAllCharacters
    } = M.model;
    const { applyOperations, formatRecordText, refreshStateBar } = M.engine;

    const state = {
        activeTableId: '',
        search: '',
        category: '',
        tag: '',
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
        return ({ manual: '手动更新', auto: '随聊天自动新增/更新', summary: '短期压缩（V5.2启用）' })[policy] || policy;
    }

    function contextLabel(policy) {
        return ({ always: '每轮发送', relevant: '相关时发送', never: '不发送' })[policy] || policy;
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
        if (!rows.length) return '<div class="mv5-empty-page">暂无内容。核心档案和当前状态采用“标题在左、内容在右”的KV视图。</div>';
        return `<div class="mv5-kv-list">${rows.map(record => `<article class="mv5-kv-record">
<div class="mv5-kv-title">${updateDot(chat, record)}<strong>${esc(record.title || '未命名')}</strong><small>${esc(record.category || '未分类')}</small></div>
<div class="mv5-kv-content"><div class="mv5-kv-text">${esc(record.content || '—')}</div><div class="mv5-record-meta"><span>${esc(record.tags.join('、') || '无标签')}</span><span>${esc(record.source)}</span><span>${esc(record.time)}</span></div></div>
<div class="mv5-row-actions"><button data-mv5-edit-record="${esc(record.id)}">编辑</button><button data-mv5-delete-record="${esc(record.id)}">删除</button></div>
</article>`).join('')}</div>`;
    }

    function renderRows(chat, table, rows) {
        const fields = visibleFields(table);
        const width = fields.reduce((sum, field) => sum + field.width, 0) + 90;
        const body = rows.map(record => `<tr>${fields.map(field => `<td style="width:${field.width}px" data-field-id="${esc(field.id)}"><div class="mv5-cell-with-dot">${renderCell(field, getFieldValue(record, field), true)}${updateDot(chat, record, field.id)}</div></td>`).join('')}<td class="mv5-row-actions"><button data-mv5-edit-record="${esc(record.id)}">编辑</button><button data-mv5-delete-record="${esc(record.id)}">删除</button></td></tr>`).join('');
        return `<div class="mv5-grid-scroll"><table class="mv5-grid" style="width:${width}px;min-width:100%"><colgroup>${fields.map(field => `<col data-field-id="${esc(field.id)}" style="width:${field.width}px">`).join('')}<col style="width:90px"></colgroup><thead><tr>${fields.map(field => `<th data-field-id="${esc(field.id)}" style="width:${field.width}px"><div class="mv5-field-head"><strong>${esc(field.name)}</strong>${field.aiHint ? `<small>${esc(field.aiHint)}</small>` : ''}</div><span class="mv5-col-resizer" data-mv5-resize="${esc(field.id)}"></span></th>`).join('')}<th>操作</th></tr></thead><tbody>${body || `<tr><td colspan="${fields.length + 1}" class="mv5-empty-page">暂无记录</td></tr>`}</tbody></table></div>`;
    }

    function render() {
        const screen = document.getElementById('memory-table-screen');
        if (!screen) return;
        const chat = getCurrentChat();
        if (!chat) {
            screen.innerHTML = '<header class="app-header"><button class="back-btn" data-target="home-screen">‹</button><div class="title-container"><h1 class="title">记忆</h1></div></header><main class="content"><div class="placeholder-text"><p>请先进入一个角色聊天。</p></div></main>';
            return;
        }
        const store = ensureStore(chat);
        const table = activeTable(chat);
        const rows = table ? tableRows(store, table) : [];
        const categories = table ? unique((store.records[table.id] || []).map(record => record.category)) : [];
        const tags = table ? unique((store.records[table.id] || []).flatMap(record => record.tags)) : [];
        screen.innerHTML = `<header class="app-header mv5-header">
<button class="back-btn" data-target="chat-room-screen">‹</button>
<div class="title-container"><h1 class="title">记忆</h1><small>${esc(chat.remarkName || chat.realName || '当前角色')}</small></div>
<div class="action-btn-group"><button class="action-btn" data-mv5-action="new-table" title="新建表">＋</button><button class="action-btn" data-mv5-action="settings" title="设置">⚙</button></div>
</header>
<main class="content mv5-shell">
<section class="mv5-topbar"><div><strong>动态记忆 V5.1</strong><span>完整轮次 · 短期自动新增/更新 · 多表独立检查</span></div><div class="mv5-top-actions"><button class="btn btn-small btn-secondary" data-mv5-action="export-template">导出空模板</button><button class="btn btn-small btn-secondary" data-mv5-action="export">导出全部</button><button class="btn btn-small btn-secondary" data-mv5-action="import">导入</button><input id="mv5-import-input" type="file" accept="application/json,.json" hidden></div></section>
<section class="mv5-layout">
<aside class="mv5-sidebar"><div class="mv5-sidebar-head"><strong>表格</strong><span>${store.tables.length}</span></div><div class="mv5-table-list">${store.tables.map(item => `<button class="mv5-table-item ${item.id === table?.id ? 'active' : ''}" data-mv5-table="${esc(item.id)}"><span class="mv5-table-name">${tableUpdateDot(chat, item.id)}${esc(item.name)}</span><b class="mv5-group mv5-${item.group}">${groupLabel(item.group)}</b></button>`).join('')}</div><button class="mv5-reset-template" data-mv5-action="reset-template">重新载入V5.1空表</button></aside>
<section class="mv5-main">${table ? `<div class="mv5-table-head"><div><h2>${esc(table.name)}</h2><p>${esc(table.description || '未填写用途说明')}</p>${table.extractPrompt ? `<div class="mv5-extract"><b>AI提取说明：</b>${esc(table.extractPrompt)}</div>` : ''}</div><div class="mv5-table-actions"><button class="btn btn-small btn-primary" data-mv5-action="new-record">新增记录</button><button class="btn btn-small btn-secondary" data-mv5-action="sort">多维排序</button><button class="btn btn-small btn-secondary" data-mv5-action="edit-table">表设置</button><button class="btn btn-small btn-danger" data-mv5-action="delete-table">删除表</button></div></div>
<div class="mv5-rule-line"><span>${table.viewMode === 'kv' ? 'KV：标题/内容' : 'Rows：多行记录'}</span><span>${groupLabel(table.group)}</span><span>${writeLabel(table.behavior.writePolicy)}</span><span>${contextLabel(table.behavior.contextPolicy)}</span>${table.behavior.retentionDays ? `<span>保留/引用${table.behavior.retentionDays}天</span>` : '<span>时间不限</span>'}${table.behavior.chatStatus ? '<span>状态栏来源</span>' : ''}</div>
<div class="mv5-filters"><input id="mv5-search" type="search" placeholder="搜索当前表" value="${esc(state.search)}"><select id="mv5-category"><option value="">全部分类</option>${categories.map(value => `<option ${value === state.category ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select><select id="mv5-tag"><option value="">全部标签</option>${tags.map(value => `<option ${value === state.tag ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></div>
${table.viewMode === 'kv' ? renderKv(chat, table, rows) : renderRows(chat, table, rows)}` : '<div class="mv5-empty-page">当前没有表格。</div>'}</section>
</section></main>`;
        bindScreenEvents(screen, chat, store, table);
        refreshStateBar(chat);
    }

    function bindScreenEvents(screen, chat, store, table) {
        screen.querySelectorAll('[data-target]').forEach(button => button.addEventListener('click', () => global.showScreen?.(button.dataset.target)));
        screen.querySelectorAll('[data-mv5-table]').forEach(button => button.addEventListener('click', () => {
            state.activeTableId = button.dataset.mv5Table;
            state.search = state.category = state.tag = '';
            render();
        }));
        screen.querySelector('#mv5-search')?.addEventListener('input', event => { state.search = event.target.value; render(); });
        screen.querySelector('#mv5-category')?.addEventListener('change', event => { state.category = event.target.value; render(); });
        screen.querySelector('#mv5-tag')?.addEventListener('change', event => { state.tag = event.target.value; render(); });
        screen.querySelectorAll('[data-mv5-action]').forEach(button => button.addEventListener('click', async () => {
            const action = button.dataset.mv5Action;
            try {
                if (action === 'new-table') openTableEditor(chat, null);
                if (action === 'edit-table' && table) openTableEditor(chat, table);
                if (action === 'new-record' && table) openRecordEditor(chat, table, null);
                if (action === 'sort' && table) openSortEditor(chat, table);
                if (action === 'settings') openSettings(chat);
                if (action === 'export') exportStore(chat, false);
                if (action === 'export-template') exportStore(chat, true);
                if (action === 'import') screen.querySelector('#mv5-import-input')?.click();
                if (action === 'reset-template') await resetTemplate(chat);
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
            const move = moveEvent => {
                field.width = Math.max(80, Math.min(800, Math.round(startWidth + moveEvent.clientX - startX)));
                th.style.width = `${field.width}px`;
                screen.querySelectorAll(`[data-field-id="${field.id}"]`).forEach(cell => { cell.style.width = `${field.width}px`; });
            };
            const up = async () => {
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', up);
                handle.removeEventListener('pointercancel', up);
                await persist(chat);
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', up);
            handle.addEventListener('pointercancel', up);
        }));
    }

    function modal(title, body, onSave, options = {}) {
        const overlay = document.createElement('div');
        overlay.className = `mv5-modal-overlay ${options.className || ''}`;
        overlay.innerHTML = `<section class="mv5-modal" role="dialog" aria-modal="true"><header class="mv5-modal-header"><h2>${esc(title)}</h2><button type="button" class="mv5-modal-close">×</button></header><form class="mv5-modal-form"><div class="mv5-modal-body">${body}</div><footer class="mv5-modal-footer"><button type="button" class="btn btn-secondary mv5-cancel">${esc(options.cancelLabel || '取消')}</button><button type="submit" class="btn btn-primary">${esc(options.saveLabel || '保存')}</button></footer></form></section>`;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
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
        options.onOpen?.(overlay);
        return overlay;
    }

    function autoGrow(textarea) {
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.max(84, textarea.scrollHeight + 2)}px`;
    }

    function fieldRowHtml(field) {
        const common = field.scope === 'common';
        return `<tr class="mv5-field-row" data-field-id="${esc(field.id)}" data-common-key="${esc(field.commonKey || '')}">
<td><div class="mv5-order-buttons"><button type="button" data-move-field="up">↑</button><button type="button" data-move-field="down">↓</button></div></td>
<td><input class="mv5-field-name" value="${esc(field.name)}" ${common ? 'readonly' : ''}>${common ? '<small class="mv5-common-mark">公共字段</small>' : ''}</td>
<td><select class="mv5-field-type" ${common ? 'disabled' : ''}>${Array.from(M.constants.FIELD_TYPES).map(type => `<option value="${type}" ${type === field.type ? 'selected' : ''}>${type}</option>`).join('')}</select></td>
<td><input class="mv5-field-width" type="number" min="80" max="800" value="${field.width}"></td>
<td><input class="mv5-field-options" value="${esc(field.options.join('，'))}" placeholder="选项，逗号分隔" ${common ? 'readonly' : ''}></td>
<td><label><input class="mv5-field-hidden" type="checkbox" ${field.hidden ? 'checked' : ''}> 隐藏</label></td>
<td><textarea class="mv5-field-hint" rows="3" placeholder="告诉AI如何填写这个字段">${esc(field.aiHint)}</textarea></td>
<td>${common ? '<span class="mv5-no-delete">必需</span>' : '<button type="button" class="mv5-delete-field" data-remove-field>删除</button>'}</td>
</tr>`;
    }

    function readFields(wrap) {
        return Array.from(wrap.querySelectorAll('.mv5-field-row')).map((row, index) => ({
            id: text(row.dataset.fieldId) || id('memory_field'),
            scope: row.dataset.commonKey ? 'common' : 'custom',
            commonKey: text(row.dataset.commonKey),
            name: text(row.querySelector('.mv5-field-name').value),
            type: row.querySelector('.mv5-field-type').value,
            width: parseInt(row.querySelector('.mv5-field-width').value, 10) || 160,
            options: unique(row.querySelector('.mv5-field-options').value),
            hidden: row.querySelector('.mv5-field-hidden').checked,
            aiHint: text(row.querySelector('.mv5-field-hint').value),
            required: !!row.dataset.commonKey,
            order: index
        }));
    }

    function selectedFieldIds(value, fields) {
        const names = unique(value);
        return names.map(name => fields.find(field => field.name === name || field.id === name)?.id).filter(Boolean);
    }

    function openTableEditor(chat, existing) {
        const store = ensureStore(chat);
        const table = existing ? clone(existing) : normalizeTable({
            name: '新记忆表',
            group: 'short',
            viewMode: 'rows',
            fields: M.constants.COMMON_KEYS.map(key => M.model.commonField(key)),
            behavior: { writePolicy: 'manual', contextPolicy: 'relevant' }
        }, store.tables.length);
        const sourceTables = store.tables.filter(item => item.id !== table.id);
        const body = `<section class="mv5-form-card"><h3>基本信息</h3><div class="mv5-form-grid"><label><span>表名</span><input name="name" value="${esc(table.name)}" required></label><label><span>显示方式</span><select name="viewMode"><option value="rows">Rows：多行记录</option><option value="kv">KV：标题/内容</option></select></label><label><span>分组</span><select name="group"><option value="core">核心</option><option value="current">状态</option><option value="short">短期</option><option value="medium">中期</option><option value="long">长期</option></select></label></div><label class="mv5-block-field"><span>用途说明</span><textarea name="description" rows="4">${esc(table.description)}</textarea></label><label class="mv5-block-field"><span>extractPrompt（AI理解表格用途）</span><textarea name="extractPrompt" rows="5">${esc(table.extractPrompt)}</textarea></label></section>
<section class="mv5-form-card"><h3>写入与上下文</h3><div class="mv5-form-grid"><label><span>写入方式</span><select name="writePolicy"><option value="manual">手动更新</option><option value="auto">随聊天更新（V5.1）</option><option value="summary">短期压缩（V5.2）</option></select></label><label><span>上下文发送</span><select name="contextPolicy"><option value="always">每轮发送</option><option value="relevant">相关时发送</option><option value="never">不发送</option></select></label><label><span>有效/引用天数</span><input name="retentionDays" type="number" min="0" value="${table.behavior.retentionDays}"><small>0表示不限</small></label><label class="mv5-check"><input type="checkbox" name="chatStatus" ${table.behavior.chatStatus ? 'checked' : ''}>聊天状态栏来源</label></div><div class="mv5-form-grid"><label><span>识别同一记录的字段</span><input name="identityFields" value="${esc(table.behavior.identityFieldIds.map(fieldId => table.fields.find(field => field.id === fieldId)?.name).filter(Boolean).join('，'))}" placeholder="标题，相关主体"></label><label><span>上下文内容字段</span><input name="contextFields" value="${esc(table.behavior.contextFieldIds.map(fieldId => table.fields.find(field => field.id === fieldId)?.name).filter(Boolean).join('，'))}" placeholder="标题，内容，标签"></label></div>${sourceTables.length ? `<div class="mv5-source-list"><strong>压缩来源表</strong>${sourceTables.map(item => `<label><input type="checkbox" name="sourceTableIds" value="${esc(item.id)}" ${table.behavior.sourceTableIds.includes(item.id) ? 'checked' : ''}>${esc(item.name)}</label>`).join('')}</div>` : ''}</section>
<section class="mv5-form-card"><h3>分类与标签提示</h3><p class="mv5-help">分类和标签由用户提供常用提示，AI后续可按开关补充；它们只用于归类与检索，不阻止写入。</p><div class="mv5-form-grid"><label><span>分类提示</span><textarea name="categoryHints" rows="3">${esc(table.categoryHints.join('，'))}</textarea></label><label><span>标签提示</span><textarea name="tagHints" rows="3">${esc(table.tagHints.join('，'))}</textarea></label><label class="mv5-check"><input type="checkbox" name="supplementCategories" ${table.aiCanSupplementCategories ? 'checked' : ''}>AI可以补充新分类</label><label class="mv5-check"><input type="checkbox" name="supplementTags" ${table.aiCanSupplementTags ? 'checked' : ''}>AI可以补充新标签</label></div></section>
<section class="mv5-form-card mv5-fields-card"><div class="mv5-card-title"><div><h3>字段设置</h3><p>六个公共字段不能删除，但可以移动顺序、调整宽度和隐藏。内部recordId、createdAt、updatedAt不会作为表格字段出现。</p></div><button type="button" id="mv5-add-field" class="btn btn-small btn-secondary">添加字段</button></div><div class="mv5-fields-scroll"><table class="mv5-fields-table"><thead><tr><th>顺序</th><th>字段名</th><th>类型</th><th>宽度</th><th>选项</th><th>显示</th><th>aiHint</th><th>操作</th></tr></thead><tbody id="mv5-fields-list">${table.fields.map(fieldRowHtml).join('')}</tbody></table></div></section>`;

        modal(existing ? '编辑表格' : '新建表格', body, async (form, wrap) => {
            table.name = text(form.get('name'));
            if (!table.name) throw new Error('表名不能为空。');
            table.viewMode = form.get('viewMode') === 'kv' ? 'kv' : 'rows';
            table.group = M.constants.GROUPS.has(text(form.get('group'))) ? text(form.get('group')) : 'short';
            table.description = text(form.get('description'));
            table.extractPrompt = text(form.get('extractPrompt'));
            table.fields = readFields(wrap);
            table.categoryHints = unique(form.get('categoryHints'));
            table.tagHints = unique(form.get('tagHints'));
            table.aiCanSupplementCategories = form.get('supplementCategories') === 'on';
            table.aiCanSupplementTags = form.get('supplementTags') === 'on';
            table.behavior.writePolicy = M.constants.WRITE_POLICIES.has(text(form.get('writePolicy'))) ? text(form.get('writePolicy')) : 'manual';
            table.behavior.contextPolicy = M.constants.CONTEXT_POLICIES.has(text(form.get('contextPolicy'))) ? text(form.get('contextPolicy')) : 'relevant';
            table.behavior.retentionDays = Math.max(0, parseInt(form.get('retentionDays'), 10) || 0);
            table.behavior.chatStatus = form.get('chatStatus') === 'on';
            table.behavior.allowAiWrite = table.behavior.writePolicy === 'auto' && table.group !== 'core' && table.group !== 'long';
            table.behavior.identityFieldIds = selectedFieldIds(form.get('identityFields'), table.fields);
            table.behavior.contextFieldIds = selectedFieldIds(form.get('contextFields'), table.fields);
            table.behavior.sourceTableIds = form.getAll('sourceTableIds').map(text).filter(Boolean);
            if (table.group === 'core') {
                table.behavior.writePolicy = 'manual';
                table.behavior.allowAiWrite = false;
            }
            if (table.behavior.chatStatus) store.tables.forEach(item => { if (item.id !== table.id) item.behavior.chatStatus = false; });
            const normalized = normalizeTable(table, existing ? store.tables.findIndex(item => item.id === existing.id) : store.tables.length);
            if (existing) {
                const index = store.tables.findIndex(item => item.id === existing.id);
                store.tables[index] = normalized;
                const validCustom = new Set(normalized.fields.filter(field => field.scope === 'custom').map(field => field.id));
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
            wrap.querySelector('[name="viewMode"]').value = table.viewMode;
            wrap.querySelector('[name="group"]').value = table.group;
            wrap.querySelector('[name="writePolicy"]').value = table.behavior.writePolicy;
            wrap.querySelector('[name="contextPolicy"]').value = table.behavior.contextPolicy;
            wrap.querySelector('#mv5-add-field').addEventListener('click', () => {
                const field = customField('新字段', 'text');
                wrap.querySelector('#mv5-fields-list').insertAdjacentHTML('beforeend', fieldRowHtml(field));
                wrap.querySelectorAll('textarea').forEach(autoGrow);
            });
            wrap.addEventListener('click', event => {
                const row = event.target.closest('.mv5-field-row');
                if (event.target.matches('[data-remove-field]')) row?.remove();
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
        const body = `<div class="mv5-record-form">${visibleFields(table).map(field => `<div class="mv5-record-field"><label><span>${esc(field.name)}${field.required ? ' *' : ''}</span>${field.aiHint ? `<small>${esc(field.aiHint)}</small>` : ''}</label><div>${controlForField(field, getFieldValue(record, field))}</div></div>`).join('')}</div>`;
        modal(existing ? '编辑记录' : '新增记录', body, async form => {
            const values = {};
            visibleFields(table).forEach(field => {
                if (field.scope === 'common' && ['source', 'time'].includes(field.commonKey)) return;
                const name = `field_${field.id}`;
                let value = field.type === 'boolean' ? form.get(name) === 'on' : form.get(name);
                if (field.type === 'multiselect') value = unique(value);
                values[field.id] = value;
            });
            const titleField = table.fields.find(field => field.scope === 'common' && field.commonKey === 'title');
            if (titleField && !text(values[titleField.id])) throw new Error('标题不能为空。');
            const result = applyOperations(chat, [{ tableId: table.id, action: existing ? 'upsert' : 'add', recordId: existing?.id, values }], { origin: 'manual' });
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
        const body = `<section class="mv5-form-card"><h3>全局设置</h3><div class="mv5-form-grid"><label class="mv5-check"><input type="checkbox" name="enabled" ${settings.enabled ? 'checked' : ''}>启用记忆上下文与自动写入</label><label class="mv5-check"><input type="checkbox" name="roundNoticeEnabled" ${settings.roundNoticeEnabled ? 'checked' : ''}>每轮显示记忆处理结果</label><label><span>上下文最多记录数</span><input type="number" name="contextMaxRecords" min="1" value="${settings.contextMaxRecords}"></label><label><span>相关表每表最多记录</span><input type="number" name="relevantMaxPerTable" min="1" max="20" value="${settings.relevantMaxPerTable}"></label><label><span>始终注入标签</span><input name="alwaysInject" value="${esc(settings.tagBehaviors.alwaysInject.join('，'))}"></label><label><span>禁止注入标签</span><input name="neverInject" value="${esc(settings.tagBehaviors.neverInject.join('，'))}"></label></div><p class="mv5-help">V5.1会把用户连续发送的多条消息与本次AI一次性生成的多条回复视为同一轮，独立检查全部自动表。中期压缩仍在V5.2启用。</p></section>`;
        modal('记忆设置', body, async form => {
            settings.enabled = form.get('enabled') === 'on';
            settings.roundNoticeEnabled = form.get('roundNoticeEnabled') === 'on';
            settings.contextMaxRecords = Math.max(1, parseInt(form.get('contextMaxRecords'), 10) || 32);
            settings.relevantMaxPerTable = Math.max(1, Math.min(20, parseInt(form.get('relevantMaxPerTable'), 10) || 5));
            settings.tagBehaviors.alwaysInject = unique(form.get('alwaysInject'));
            settings.tagBehaviors.neverInject = unique(form.get('neverInject'));
            await persist(chat);
            render();
        });
    }

    async function deleteTable(chat, table) {
        if (!confirm(`确定删除“${table.name}”及其全部记录吗？`)) return;
        const store = ensureStore(chat);
        store.tables = store.tables.filter(item => item.id !== table.id);
        store.tables.forEach(item => { item.behavior.sourceTableIds = item.behavior.sourceTableIds.filter(sourceId => sourceId !== table.id); });
        delete store.records[table.id];
        state.activeTableId = '';
        await persist(chat);
        render();
    }

    async function resetTemplate(chat) {
        if (!confirm('这会用9张V5.1空表覆盖当前表格和记录。旧版本数据不会迁入。是否继续？')) return;
        chat.memoryStore = createDefaultStore();
        state.activeTableId = '';
        await persist(chat);
        render();
        toast('已载入V5.1空表模板');
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
        if (templateOnly) {
            downloadJson(`memoryTemplate_V5_1_${safe}.json`, { version: M.STORE_VERSION, type: 'memory-table-template', settings: store.settings, tables: store.tables, records: {} });
        } else {
            downloadJson(`memoryStore_V5_1_${safe}_${new Date().toISOString().slice(0, 10)}.json`, store);
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
        const body = `<section class="mv5-import-preview"><h3>导入预览</h3><dl><div><dt>文件</dt><dd>${esc(file.name)}</dd></div><div><dt>识别类型</dt><dd>${esc(plan.kind)}</dd></div><div><dt>表格数量</dt><dd>${plan.tableCount}</dd></div><div><dt>记录数量</dt><dd>${plan.recordCount}</dd></div><div><dt>冲突表格</dt><dd>${conflicts.length}</dd></div></dl><div class="mv5-form-grid"><label><span>导入方式</span><select name="mode"><option value="merge">合并到当前记忆库</option><option value="replace_all">覆盖全部表格</option></select></label><label><span>同名/同ID表格</span><select name="conflictMode"><option value="replace">覆盖原表</option><option value="duplicate">保留两张表</option></select></label><label class="mv5-check"><input type="checkbox" name="includeRecords" ${plan.recordCount ? 'checked' : ''}>导入文件中的记录</label></div><p class="mv5-help">当前V5.1不会把V4及更早记录自动转换到新表。只有文件本身已经是V5结构时，记录才会按预览数量导入。</p></section>`;
        modal('导入记忆表', body, async form => {
            const mode = form.get('mode');
            if (mode === 'replace_all') {
                chat.memoryStore = M.model.normalizeStore({ version: M.STORE_VERSION, settings: plan.settings, tables: plan.tables, records: form.get('includeRecords') === 'on' ? plan.records : {} });
            } else {
                mergeImport(store, plan, { includeRecords: form.get('includeRecords') === 'on', conflictMode: form.get('conflictMode') });
            }
            await persist(chat);
            state.activeTableId = '';
            render();
            toast(`导入完成：${plan.tableCount}张表`);
        }, { saveLabel: '开始导入' });
    }

    function showImportError(error) {
        const message = error.message || String(error);
        modal('导入失败', `<section class="mv5-import-error"><p>文件没有被修改或部分导入。</p><pre>${esc(message)}</pre></section>`, async () => {}, { saveLabel: '关闭', cancelLabel: '返回' });
    }

    function setup() {
        if (state.bound) return render();
        state.bound = true;
        migrateAllCharacters().finally(render);
    }

    function openForCharacter(characterId) {
        if (characterId) {
            global.currentChatId = characterId;
            global.currentChatType = 'private';
        }
        global.showScreen?.('memory-table-screen');
        render();
    }

    M.ui = Object.freeze({ setup, render, openForCharacter, modal, openTableEditor, openRecordEditor });
})(window);
