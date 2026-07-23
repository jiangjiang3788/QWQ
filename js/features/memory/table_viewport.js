(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');

    const DEFAULTS = Object.freeze({
        threshold: 80,
        rowHeight: 88,
        overscan: 5,
        fallbackViewportHeight: 560
    });
    const states = new Map();

    function clamp(value, min, max) {
        const number = Number(value) || 0;
        return Math.max(min, Math.min(max, number));
    }

    function normalizeKey(value) {
        return String(value || 'memory-table').replace(/[^a-zA-Z0-9_:\-.]/g, '_').slice(0, 220);
    }

    function ensure(key, rowCount = 0) {
        const normalized = normalizeKey(key);
        let state = states.get(normalized);
        if (!state) {
            state = { key: normalized, scrollTop: 0, viewportHeight: DEFAULTS.fallbackViewportHeight, start: 0, end: 0, rowCount: 0 };
            states.set(normalized, state);
        }
        state.rowCount = Math.max(0, Number(rowCount) || 0);
        return state;
    }

    function enabled(options = {}) {
        const count = Math.max(0, Number(options.rowCount) || 0);
        const threshold = Math.max(20, Number(options.threshold) || DEFAULTS.threshold);
        return options.force !== false && count >= threshold && !options.jsonMode && !options.reviewMode;
    }

    function computeRange(options = {}) {
        const rowCount = Math.max(0, Number(options.rowCount) || 0);
        const rowHeight = Math.max(44, Number(options.rowHeight) || DEFAULTS.rowHeight);
        const overscan = Math.max(1, Number(options.overscan) || DEFAULTS.overscan);
        const viewportHeight = Math.max(rowHeight, Number(options.viewportHeight) || DEFAULTS.fallbackViewportHeight);
        const maxScroll = Math.max(0, (rowCount * rowHeight) - viewportHeight);
        const scrollTop = clamp(options.scrollTop, 0, maxScroll);
        const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
        let start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
        let end = Math.min(rowCount, start + visibleCount + (overscan * 2));
        if (end - start < visibleCount && start > 0) start = Math.max(0, end - visibleCount - overscan);
        const activeIndex = Number.isInteger(options.activeIndex) ? options.activeIndex : -1;
        if (activeIndex >= 0 && activeIndex < rowCount && (activeIndex < start || activeIndex >= end)) {
            start = Math.max(0, activeIndex - overscan);
            end = Math.min(rowCount, start + visibleCount + (overscan * 2));
        }
        return {
            start,
            end,
            scrollTop,
            viewportHeight,
            rowHeight,
            overscan,
            visibleCount,
            topHeight: start * rowHeight,
            bottomHeight: Math.max(0, (rowCount - end) * rowHeight),
            renderedCount: Math.max(0, end - start),
            totalHeight: rowCount * rowHeight
        };
    }

    function plan(key, options = {}) {
        const state = ensure(key, options.rowCount);
        const isEnabled = enabled(options);
        if (!isEnabled) {
            state.start = 0;
            state.end = state.rowCount;
            return {
                enabled: false,
                key: state.key,
                start: 0,
                end: state.rowCount,
                scrollTop: 0,
                viewportHeight: state.viewportHeight,
                rowHeight: Math.max(44, Number(options.rowHeight) || DEFAULTS.rowHeight),
                topHeight: 0,
                bottomHeight: 0,
                renderedCount: state.rowCount,
                rowCount: state.rowCount
            };
        }
        const activeIndex = Number.isInteger(options.activeIndex) ? options.activeIndex : -1;
        if (activeIndex >= 0 && activeIndex < state.rowCount) {
            const visibleStart = Math.floor(state.scrollTop / (Number(options.rowHeight) || DEFAULTS.rowHeight));
            const visibleEnd = visibleStart + Math.ceil(state.viewportHeight / (Number(options.rowHeight) || DEFAULTS.rowHeight));
            if (activeIndex < visibleStart || activeIndex >= visibleEnd) {
                state.scrollTop = Math.max(0, (activeIndex * (Number(options.rowHeight) || DEFAULTS.rowHeight)) - Math.floor(state.viewportHeight / 3));
            }
        }
        const range = computeRange({
            ...options,
            rowCount: state.rowCount,
            scrollTop: state.scrollTop,
            viewportHeight: state.viewportHeight
        });
        Object.assign(state, range);
        return { enabled: true, key: state.key, rowCount: state.rowCount, ...range };
    }

    function update(key, options = {}) {
        const state = ensure(key, options.rowCount);
        if (options.scrollTop !== undefined) state.scrollTop = Math.max(0, Number(options.scrollTop) || 0);
        if (options.viewportHeight !== undefined) state.viewportHeight = Math.max(DEFAULTS.rowHeight, Number(options.viewportHeight) || DEFAULTS.fallbackViewportHeight);
        const range = computeRange({
            ...options,
            rowCount: options.rowCount === undefined ? state.rowCount : options.rowCount,
            scrollTop: state.scrollTop,
            viewportHeight: state.viewportHeight
        });
        Object.assign(state, range);
        return { enabled: true, key: state.key, rowCount: state.rowCount, ...range };
    }

    function reset(key) {
        if (!key) {
            states.clear();
            return;
        }
        states.delete(normalizeKey(key));
    }

    function getState(key) {
        const state = states.get(normalizeKey(key));
        return state ? { ...state } : null;
    }

    Kernel.register('tableViewport', Object.freeze({
        VERSION: '2.11-R7',
        DEFAULTS,
        enabled,
        computeRange,
        plan,
        update,
        reset,
        getState
    }));
})(window);
