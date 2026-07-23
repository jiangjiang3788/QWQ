(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');

    function visualUnits(value) {
        return Array.from(String(value || '').trim()).reduce((sum, char) => {
            if (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF01-\uFF60]/u.test(char)) return sum + 1;
            if (/[A-Z0-9]/.test(char)) return sum + 0.66;
            if (/[a-z]/.test(char)) return sum + 0.56;
            if (/[_\-./]/.test(char)) return sum + 0.42;
            if (/\s/.test(char)) return sum + 0.34;
            return sum + 0.72;
        }, 0);
    }

    function calculate(values, profile = {}) {
        const units = Math.max(Number(profile.minimumUnits) || 4, ...(values || []).map(visualUnits));
        const desktop = profile.desktop || {};
        const mobile = profile.mobile || {};
        const width = (settings, fallback) => Math.round(Math.min(
            Number(settings.max) || fallback.max,
            Math.max(Number(settings.min) || fallback.min, (Number(settings.padding) || fallback.padding) + units * (Number(settings.unit) || fallback.unit))
        ));
        return Object.freeze({
            longestUnits: Number(units.toFixed(2)),
            desktop: width(desktop, { min: 68, max: 112, padding: 18, unit: 10 }),
            mobile: width(mobile, { min: 54, max: 74, padding: 10, unit: 6.6 })
        });
    }

    function schemaFieldNames(table) {
        return calculate((table?.columns || []).map(field => field?.key || '').filter(Boolean));
    }

    function keyValueLabels(table, visibleColumns) {
        const columns = Array.isArray(visibleColumns) ? visibleColumns : (table?.columns || []);
        return calculate(columns.map(field => field?.key || '').filter(Boolean), {
            minimumUnits: 3.5,
            desktop: { min: 64, max: 116, padding: 16, unit: 8.6 },
            mobile: { min: 48, max: 76, padding: 8, unit: 5.25 }
        });
    }

    Kernel.register('fieldWidth', Object.freeze({
        VERSION: '2.12-R5.3',
        visualUnits,
        calculate,
        schemaFieldNames,
        keyValueLabels
    }));
})(window);
