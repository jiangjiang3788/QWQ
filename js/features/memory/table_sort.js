(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Domain = Kernel.require('domain');
    const TableView = Kernel.require('tableView');

    const MAX_LEVELS = 3;
    const SPECIAL_FIELDS = Object.freeze([
        ['__tags__', '全部标签'],
        ['__topic__', '主题标签'],
        ['__scene__', '场景标签'],
        ['__entity__', '主体标签'],
        ['__effect__', '标签作用']
    ]);

    function normalizeDirection(value) {
        return value === 'desc' ? 'desc' : 'asc';
    }

    function normalize(sorts, table) {
        const allowed = new Set([
            ...SPECIAL_FIELDS.map(item => item[0]),
            ...(table?.columns || []).map(field => field.id)
        ]);
        const result = [];
        (Array.isArray(sorts) ? sorts : []).forEach(item => {
            const fieldId = String(item?.fieldId || '').trim();
            if (!fieldId || !allowed.has(fieldId) || result.some(sort => sort.fieldId === fieldId)) return;
            result.push({ fieldId, direction: normalizeDirection(item.direction) });
        });
        return result.slice(0, MAX_LEVELS);
    }

    function setLevel(sorts, index, patch, table) {
        const next = Array.from({ length: MAX_LEVELS }, (_, itemIndex) => ({
            fieldId: sorts?.[itemIndex]?.fieldId || '',
            direction: normalizeDirection(sorts?.[itemIndex]?.direction)
        }));
        next[Math.max(0, Math.min(MAX_LEVELS - 1, Number(index) || 0))] = {
            ...next[Math.max(0, Math.min(MAX_LEVELS - 1, Number(index) || 0))],
            ...(patch || {})
        };
        return normalize(next, table);
    }

    function tagValue(row, fieldId) {
        const bundle = row?.meta?.tagBundle || {};
        if (fieldId === '__topic__') return (bundle.topic || []).join(' ');
        if (fieldId === '__scene__') return (bundle.scene || []).join(' ');
        if (fieldId === '__entity__') return (bundle.entity || []).join(' ');
        if (fieldId === '__effect__') return bundle.effect || '';
        return TableView.rowTags(row).join(' ');
    }

    function rawValue(row, table, fieldId) {
        if (fieldId.startsWith('__')) return tagValue(row, fieldId);
        const field = (table?.columns || []).find(item => item.id === fieldId);
        if (!field) return '';
        return row?.cells?.[field.id];
    }

    function comparable(value, field) {
        if (value === null || value === undefined || value === '') return { empty: true, value: '' };
        const type = String(field?.type || '').toLowerCase();
        if (['number', 'progress'].includes(type)) return { empty: false, value: Number(value) || 0 };
        if (type === 'boolean') return { empty: false, value: value ? 1 : 0 };
        if (type === 'date') {
            const timestamp = Date.parse(String(value));
            return { empty: false, value: Number.isFinite(timestamp) ? timestamp : String(value) };
        }
        if (Array.isArray(value)) return { empty: false, value: value.join(' ').toLocaleLowerCase('zh-CN') };
        if (typeof value === 'object') {
            try { return { empty: false, value: JSON.stringify(value).toLocaleLowerCase('zh-CN') }; } catch (_) {}
        }
        return { empty: false, value: String(value).toLocaleLowerCase('zh-CN') };
    }

    function compareValues(a, b, direction) {
        if (a.empty !== b.empty) return a.empty ? 1 : -1;
        let result = 0;
        if (typeof a.value === 'number' && typeof b.value === 'number') result = a.value - b.value;
        else result = String(a.value).localeCompare(String(b.value), 'zh-CN', { numeric: true, sensitivity: 'base' });
        return direction === 'desc' ? -result : result;
    }

    function apply(rows, table, sorts) {
        const normalized = normalize(sorts, table);
        if (!normalized.length) return Array.isArray(rows) ? rows : [];
        const fields = new Map((table?.columns || []).map(field => [field.id, field]));
        return (Array.isArray(rows) ? rows : []).map((row, index) => ({ row, index })).sort((left, right) => {
            for (const sort of normalized) {
                const field = fields.get(sort.fieldId) || { type: 'text' };
                const result = compareValues(
                    comparable(rawValue(left.row, table, sort.fieldId), field),
                    comparable(rawValue(right.row, table, sort.fieldId), field),
                    sort.direction
                );
                if (result) return result;
            }
            return left.index - right.index;
        }).map(item => item.row);
    }

    function options(table) {
        return [
            ...SPECIAL_FIELDS,
            ...(table?.columns || []).map(field => [field.id, field.key || field.id])
        ];
    }

    function renderControls(table, sorts) {
        const normalized = normalize(sorts, table);
        const fieldOptions = options(table);
        return `<div class="memory-table-sortbar" aria-label="多维排序">
            <span class="memory-table-sort-title">排序</span>
            ${Array.from({ length: MAX_LEVELS }, (_, index) => {
                const current = normalized[index] || { fieldId: '', direction: 'asc' };
                return `<label class="memory-table-sort-level"><b>${index + 1}</b><select data-memory-sort-field data-sort-index="${index}" aria-label="第 ${index + 1} 排序字段"><option value="">不排序</option>${fieldOptions.map(([id, label]) => `<option value="${Core.escapeAttribute(id)}" ${current.fieldId === id ? 'selected' : ''}>${Core.escapeHtml(label)}</option>`).join('')}</select><select data-memory-sort-direction data-sort-index="${index}" aria-label="第 ${index + 1} 排序方向" ${current.fieldId ? '' : 'disabled'}><option value="asc" ${current.direction === 'asc' ? 'selected' : ''}>升序</option><option value="desc" ${current.direction === 'desc' ? 'selected' : ''}>降序</option></select></label>`;
            }).join('')}
            ${normalized.length ? '<button type="button" class="memory-table-sort-clear" data-memory-sort-clear>清除排序</button>' : ''}
        </div>`;
    }

    Kernel.register('tableSort', Object.freeze({
        VERSION: '2.12-R5',
        MAX_LEVELS,
        SPECIAL_FIELDS,
        normalize,
        setLevel,
        apply,
        rawValue,
        options,
        renderControls
    }));
})(window);
