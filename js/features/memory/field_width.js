(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');

    let measureCanvas = null;

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

    function clamp(value, minimum, maximum) {
        return Math.round(Math.min(maximum, Math.max(minimum, value)));
    }

    function measureText(value, font, fallbackUnit) {
        const text = String(value || '').trim();
        if (!text) return 0;
        try {
            if (global.document?.createElement) {
                measureCanvas ||= global.document.createElement('canvas');
                const context = measureCanvas.getContext?.('2d');
                if (context) {
                    context.font = font;
                    const measured = context.measureText(text).width;
                    if (Number.isFinite(measured) && measured > 0) return measured;
                }
            }
        } catch (_) {}
        return visualUnits(text) * fallbackUnit;
    }

    function calculate(values, profile = {}) {
        const normalized = (values || []).map(value => String(value || '').trim()).filter(Boolean);
        const units = Math.max(Number(profile.minimumUnits) || 4, ...normalized.map(visualUnits));
        const desktop = profile.desktop || {};
        const mobile = profile.mobile || {};
        const width = (settings, fallback) => Math.round(Math.min(
            Number(settings.max) || fallback.max,
            Math.max(Number(settings.min) || fallback.min, (Number(settings.padding) || fallback.padding) + units * (Number(settings.unit) || fallback.unit))
        ));
        return Object.freeze({
            longestUnits: Number(units.toFixed(2)),
            longestLabel: normalized.sort((a, b) => visualUnits(b) - visualUnits(a))[0] || '',
            desktop: width(desktop, { min: 68, max: 112, padding: 18, unit: 10 }),
            mobile: width(mobile, { min: 54, max: 74, padding: 10, unit: 6.6 })
        });
    }

    function schemaFieldNames(table) {
        return calculate((table?.columns || []).map(field => field?.key || '').filter(Boolean));
    }

    function keyValueLabels(table, visibleColumns) {
        const columns = Array.isArray(visibleColumns) ? visibleColumns : (table?.columns || []);
        const labels = columns.map(field => String(field?.key || '').trim()).filter(Boolean);
        const longestLabel = labels.reduce((longest, label) => visualUnits(label) > visualUnits(longest) ? label : longest, '');
        const longestUnits = Math.max(3.5, ...labels.map(visualUnits));
        const desktopTextWidth = Math.max(0, ...labels.map(label => measureText(label, '700 14px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', 13.2)));
        const mobileTextWidth = Math.max(0, ...labels.map(label => measureText(label, '700 11px -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif', 10.4)));
        return Object.freeze({
            longestUnits: Number(longestUnits.toFixed(2)),
            longestLabel,
            desktop: clamp(desktopTextWidth + 34, 116, 260),
            mobile: clamp(mobileTextWidth + 20, 92, 172)
        });
    }

    Kernel.register('fieldWidth', Object.freeze({
        VERSION: '2.13-R0',
        visualUnits,
        measureText,
        calculate,
        schemaFieldNames,
        keyValueLabels
    }));
})(window);
