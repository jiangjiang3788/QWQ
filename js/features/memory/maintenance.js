(function (global) {
    'use strict';
    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');

    const BUDGETS = Object.freeze({
        maxVisibleDataRows: 30,
        maxActiveEditors: 1,
        maxOpenSharedMenus: 1,
        maxPersistentRowEditButtons: 0,
        maxPageOverflowPixels: 1
    });

    function count(root, selector) {
        return root?.querySelectorAll ? root.querySelectorAll(selector).length : 0;
    }

    function measure(root = global.document) {
        const documentElement = global.document?.documentElement;
        const overflowPixels = documentElement ? Math.max(0, documentElement.scrollWidth - global.innerWidth) : 0;
        const metrics = {
            visibleDataRows: count(root, '.memory-v2-data-row'),
            activeEditors: count(root, '.memory-table-input, .memory-table-textarea, .memory-table-select'),
            openSharedMenus: count(root, '.memory-row-command-popover'),
            persistentRowEditButtons: count(root, '[data-action="edit-field"], [data-action="edit-row"]'),
            overflowPixels
        };
        const checks = {
            visibleDataRows: metrics.visibleDataRows <= BUDGETS.maxVisibleDataRows,
            activeEditors: metrics.activeEditors <= BUDGETS.maxActiveEditors,
            openSharedMenus: metrics.openSharedMenus <= BUDGETS.maxOpenSharedMenus,
            persistentRowEditButtons: metrics.persistentRowEditButtons <= BUDGETS.maxPersistentRowEditButtons,
            overflowPixels: metrics.overflowPixels <= BUDGETS.maxPageOverflowPixels
        };
        return Object.freeze({
            version: '2.12-R4',
            ok: Object.values(checks).every(Boolean),
            metrics: Object.freeze(metrics),
            checks: Object.freeze(checks),
            budgets: BUDGETS
        });
    }

    Kernel.register('memoryMaintenance', Object.freeze({
        VERSION: '2.12-R4',
        budgets: BUDGETS,
        measure
    }));
})(window);
