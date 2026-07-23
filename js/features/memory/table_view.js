(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;

    function normalizeList(value) {
        if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
        return String(value || '').split(/[,，、\n]/).map(item => item.trim()).filter(Boolean);
    }

    function plainText(field, value) {
        const type = String(field?.type || 'text').toLowerCase();
        if (value === null || value === undefined || value === '') return '';
        if (type === 'boolean') return value ? '已开启' : '已关闭';
        if (type === 'tags') return normalizeList(value).join('、');
        if (Array.isArray(value)) return value.join('、');
        if (typeof value === 'object') {
            try { return JSON.stringify(value); } catch (_) { return String(value); }
        }
        return String(value);
    }

    function renderValue(field, value, options = {}) {
        const text = plainText(field, value);
        if (!text) return '<span class="memory-flat-empty-value">未填写</span>';
        const type = String(field?.type || 'text').toLowerCase();
        if (type === 'tags') {
            return `<div class="memory-flat-tag-list">${normalizeList(value).slice(0, 8).map(tag => `<span>${Core.escapeHtml(tag)}</span>`).join('')}</div>`;
        }
        if (type === 'boolean') return `<span class="memory-flat-status ${value ? 'is-on' : ''}">${Core.escapeHtml(text)}</span>`;
        const clampClass = options.unclamped ? '' : ' memory-flat-value-clamp';
        return `<div class="memory-flat-value${clampClass}" title="${Core.escapeAttribute(text)}">${Core.escapeHtml(text)}</div>`;
    }

    function rowTags(row) {
        const meta = row?.meta || {};
        return Array.from(new Set([
            ...(meta.tagBundle?.topic || []),
            ...(meta.tagBundle?.scene || []),
            ...(meta.tagBundle?.entity || []),
            ...(meta.tags || [])
        ].map(item => String(item || '').trim()).filter(Boolean)));
    }

    function renderTagField(row, options = {}) {
        const limit = Math.max(1, Number(options.limit) || 6);
        const tags = rowTags(row);
        if (!tags.length) return '<span class="memory-flat-empty-value">未标注</span>';
        const visible = tags.slice(0, limit);
        const more = tags.length > visible.length ? `<span class="memory-flat-tag-more">+${tags.length - visible.length}</span>` : '';
        return `<div class="memory-flat-tag-list memory-flat-tag-field">${visible.map(tag => `<span>${Core.escapeHtml(tag)}</span>`).join('')}${more}</div>`;
    }


    function renderTagEditor(row) {
        const bundle = row?.meta?.tagBundle || {};
        const input = (dimension, label, value) => `<label class="memory-tag-edit-field"><span>${label}</span><input class="memory-table-tag-input" data-tag-dimension="${dimension}" value="${Core.escapeAttribute((value || []).join(', '))}" placeholder="逗号分隔"></label>`;
        const effect = String(bundle.effect || 'historical_context');
        return `<div class="memory-tag-inline-editor">
            ${input('topic', '主题', bundle.topic)}
            ${input('scene', '场景', bundle.scene)}
            ${input('entity', '主体', bundle.entity)}
            <label class="memory-tag-edit-field"><span>作用</span><select class="memory-table-tag-input" data-tag-dimension="effect">
                ${['fact','temporary_state','soft_preference','hard_boundary','reminder','historical_context','candidate'].map(value => `<option value="${value}" ${effect === value ? 'selected' : ''}>${value}</option>`).join('')}
            </select></label>
        </div>`;
    }

    function renderStatusMeta(row) {
        const meta = row?.meta || {};
        const status = meta.lifecycle?.status || meta.status || '';
        const chips = [];
        if (meta.pinned) chips.push('<span class="is-pinned">固定</span>');
        if (meta.tagLocked) chips.push('<span class="is-tag-locked">标签锁定</span>');
        if (meta.usePolicy?.paused) chips.push('<span class="is-paused">暂停</span>');
        if (status && status !== 'active') chips.push(`<span>${Core.escapeHtml(status)}</span>`);
        return chips.length ? `<div class="memory-flat-row-meta memory-flat-row-status">${chips.join('')}</div>` : '';
    }

    function renderMeta(row) {
        const status = renderStatusMeta(row);
        const tags = rowTags(row);
        const tagHtml = tags.length ? `<div class="memory-flat-row-meta">${tags.slice(0, 4).map(tag => `<span>${Core.escapeHtml(tag)}</span>`).join('')}</div>` : '';
        return `${status}${tagHtml}`;
    }

    function renderRowCommand(config) {
        const { templateId, tableId, rowId } = config;
        return `<button type="button" class="memory-flat-row-command" data-action="open-row-command-menu" data-template-id="${Core.escapeAttribute(templateId)}" data-table-id="${Core.escapeAttribute(tableId)}" data-row-id="${Core.escapeAttribute(rowId)}" aria-label="打开行操作" aria-haspopup="menu">⋯</button>`;
    }

    Kernel.register('tableView', Object.freeze({
        VERSION: '2.12-R0',
        plainText,
        rowTags,
        renderValue,
        renderTagField,
        renderTagEditor,
        renderStatusMeta,
        renderMeta,
        renderRowCommand
    }));
})(window);
