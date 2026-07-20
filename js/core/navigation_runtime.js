(function (global) {
    'use strict';

    let activateScreen = null;
    let currentScreenId = null;
    let screenStack = [];

    function activeScreenId() {
        const active = document.querySelector('.screen.active');
        return active && active.id ? active.id : null;
    }

    function validScreen(targetId, fallbackId) {
        const requested = typeof targetId === 'string' ? targetId.trim() : '';
        if (requested && document.getElementById(requested)) return requested;
        const fallback = typeof fallbackId === 'string' ? fallbackId.trim() : '';
        if (fallback && document.getElementById(fallback)) return fallback;
        return document.getElementById('home-screen') ? 'home-screen' : activeScreenId();
    }

    function attach(adapter, options = {}) {
        if (typeof adapter !== 'function') throw new TypeError('导航适配器必须是函数');
        activateScreen = adapter;
        const initial = validScreen(options.initial || activeScreenId(), 'home-screen');
        currentScreenId = initial;
        screenStack = initial ? [initial] : [];
        return snapshot();
    }

    function activate(targetId, meta) {
        if (typeof activateScreen !== 'function') throw new Error('导航运行时尚未连接屏幕适配器');
        activateScreen(targetId, meta || {});
        currentScreenId = targetId;
        return targetId;
    }

    function open(targetId, options = {}) {
        const target = validScreen(targetId, options.fallback || currentScreenId || 'home-screen');
        if (!target) return false;

        if (options.reset) {
            screenStack = [target];
        } else if (options.replace) {
            if (screenStack.length) screenStack[screenStack.length - 1] = target;
            else screenStack = [target];
        } else if (screenStack[screenStack.length - 1] !== target) {
            screenStack.push(target);
        }

        activate(target, { source: options.source || 'open', replace: !!options.replace, reset: !!options.reset });
        return true;
    }

    function back(fallbackId = 'home-screen') {
        while (screenStack.length > 1) {
            screenStack.pop();
            const previous = validScreen(screenStack[screenStack.length - 1], '');
            if (previous) {
                screenStack[screenStack.length - 1] = previous;
                activate(previous, { source: 'back' });
                return true;
            }
        }

        const fallback = validScreen(fallbackId, 'home-screen');
        if (!fallback) return false;
        screenStack = [fallback];
        activate(fallback, { source: 'back-fallback' });
        return true;
    }

    function reset(targetId = 'home-screen') {
        return open(targetId, { reset: true, source: 'reset' });
    }

    function snapshot() {
        return Object.freeze({
            current: currentScreenId,
            stack: [...screenStack]
        });
    }

    global.OvoNavigation = Object.freeze({ attach, open, back, reset, snapshot });
})(window);
