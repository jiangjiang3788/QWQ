(function (global) {
    'use strict';

    const defaults = Object.freeze({
        phoneApp: false,
        groupChat: false,
        emptyStorageScreen: false,
        advancedApps: true,
        legacyJournal: true,
        floatingQuickDock: true
    });

    function readOverrides() {
        try {
            const raw = localStorage.getItem('ovo.featureFlags');
            const parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    const overrides = readOverrides();
    const flags = Object.freeze({ ...defaults, ...overrides });

    global.OvoFeatureFlags = Object.freeze({
        get(name) {
            return Object.prototype.hasOwnProperty.call(flags, name) ? flags[name] : false;
        },
        all() {
            return { ...flags };
        }
    });
})(window);
