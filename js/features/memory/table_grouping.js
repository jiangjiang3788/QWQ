(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;

    const DEFAULT_GROUP = '其他字段';

    function normalizeName(value, fallback = DEFAULT_GROUP) {
        const text = String(value || '').trim();
        return text || fallback;
    }

    function groupColumns(columns, options = {}) {
        const fallback = normalizeName(options.fallback, DEFAULT_GROUP);
        const groups = [];
        const byName = new Map();
        (columns || []).forEach((field, sourceIndex) => {
            const name = normalizeName(field?.group, fallback);
            let group = byName.get(name);
            if (!group) {
                group = {
                    id: `memory-field-group-${Core.hashText(name)}`,
                    name,
                    fields: [],
                    sourceIndex
                };
                byName.set(name, group);
                groups.push(group);
            }
            group.fields.push(field);
        });
        return groups;
    }

    function flatten(groups) {
        return (groups || []).flatMap(group => group.fields || []);
    }

    function fieldPath(templateId, tableId, fieldId) {
        return `${templateId || ''}::${tableId || ''}::${fieldId || ''}`;
    }

    Kernel.register('tableGrouping', Object.freeze({
        VERSION: '2.12-R0',
        DEFAULT_GROUP,
        normalizeName,
        groupColumns,
        flatten,
        fieldPath
    }));
})(window);
