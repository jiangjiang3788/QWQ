(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');

    const stats = { replacements: 0, savedSignals: 0, restoredFocus: 0 };
    let savedTimer = 0;

    function inputIdentity(element) {
        if (!element?.matches?.('input,textarea,select,button')) return null;
        return {
            action: element.dataset.action || '',
            templateId: element.dataset.templateId || '',
            tableId: element.dataset.tableId || '',
            fieldId: element.dataset.fieldId || '',
            rowId: element.dataset.rowId || '',
            tagFilter: element.matches('[data-memory-row-tag-filter]'),
            selectionStart: Number.isInteger(element.selectionStart) ? element.selectionStart : null,
            selectionEnd: Number.isInteger(element.selectionEnd) ? element.selectionEnd : null
        };
    }

    function capture(root) {
        const active = root?.contains?.(document.activeElement) ? inputIdentity(document.activeElement) : null;
        const scroll = [];
        root?.querySelectorAll?.('[data-memory-virtual-key]').forEach(element => {
            scroll.push({ key: element.dataset.memoryVirtualKey, top: element.scrollTop, left: element.scrollLeft });
        });
        return { active, scroll };
    }

    function findIdentity(root, identity) {
        if (!identity) return null;
        const candidates = Array.from(root?.querySelectorAll?.('input,textarea,select,button') || []);
        return candidates.find(element => {
            if (identity.tagFilter && element.matches('[data-memory-row-tag-filter]')) return true;
            return (element.dataset.action || '') === identity.action
                && (element.dataset.templateId || '') === identity.templateId
                && (element.dataset.tableId || '') === identity.tableId
                && (element.dataset.fieldId || '') === identity.fieldId
                && (element.dataset.rowId || '') === identity.rowId;
        }) || null;
    }

    function restore(root, snapshot, options = {}) {
        (snapshot?.scroll || []).forEach(item => {
            const target = Array.from(root?.querySelectorAll?.('[data-memory-virtual-key]') || [])
                .find(element => element.dataset.memoryVirtualKey === item.key);
            if (target) {
                target.scrollTop = item.top || 0;
                target.scrollLeft = item.left || 0;
            }
        });
        let focusTarget = findIdentity(root, snapshot?.active);
        if (!focusTarget && options.focusFirstEdit) {
            focusTarget = root?.querySelector?.('.memory-flat-cell-editing input, .memory-flat-cell-editing textarea, .memory-flat-cell-editing select');
        }
        if (focusTarget) {
            focusTarget.focus?.({ preventScroll: true });
            if (snapshot?.active?.selectionStart !== null && typeof focusTarget.setSelectionRange === 'function') {
                try { focusTarget.setSelectionRange(snapshot.active.selectionStart, snapshot.active.selectionEnd); } catch (_) {}
            }
            stats.restoredFocus += 1;
        }
    }

    function replace(root, html, bind, options = {}) {
        if (!root) return false;
        const snapshot = capture(root);
        root.innerHTML = html;
        bind?.(root);
        restore(root, snapshot, options);
        stats.replacements += 1;
        root.dataset.memoryGridRevision = String(Number(root.dataset.memoryGridRevision || 0) + 1);
        return true;
    }

    function markStatus(root, text, className = 'is-visible') {
        const indicator = root?.closest?.('.memory-v2-sheet')?.querySelector?.('[data-memory-table-save-status]')
            || document.querySelector?.('[data-memory-table-save-status]');
        if (!indicator) return null;
        indicator.textContent = text;
        indicator.classList.add('is-visible');
        indicator.classList.toggle('is-saving', className === 'is-saving');
        indicator.setAttribute('aria-live', 'polite');
        return indicator;
    }

    function markSaving(root, text = '保存中…') {
        const indicator = markStatus(root, text, 'is-saving');
        if (savedTimer) { global.clearTimeout(savedTimer); savedTimer = 0; }
        return !!indicator;
    }

    function markSaved(root, text = '已保存') {
        const indicator = markStatus(root, text, 'is-visible');
        if (!indicator) return;
        indicator.classList.remove('is-saving');
        stats.savedSignals += 1;
        if (savedTimer) global.clearTimeout(savedTimer);
        savedTimer = global.setTimeout(() => indicator.classList.remove('is-visible'), 1600);
    }

    function getStats() {
        return { ...stats };
    }

    function resetStats() {
        Object.keys(stats).forEach(key => { stats[key] = 0; });
    }

    Kernel.register('tableReconciler', Object.freeze({
        VERSION: '2.11-R7',
        capture,
        restore,
        replace,
        markStatus,
        markSaving,
        markSaved,
        getStats,
        resetStats
    }));
})(window);
