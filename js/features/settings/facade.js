(function (global) {
    'use strict';

    const VERSION = '2.9-R5';
    const modules = Object.freeze({
        chat: ['setupChatSettings', 'loadSettingsToSidebar', 'saveSettingsFromSidebar'],
        character: ['profile', 'chat', 'behavior', 'media', 'extensions'],
        magicRoom: ['setupMagicRoomApp'],
        api: ['setupApiSettingsApp', 'setupSubApiSettings', 'setupGptImageSettings', 'setupNovelAiSettings'],
        presets: ['setupPresetFeatures', 'populateApiSelect', 'populateBubblePresetSelect'],
        customization: ['setupWallpaperApp', 'setupCustomizeApp', 'setupStatusBarBindings']
    });

    function checkFunction(name) {
        return typeof global[name] === 'function';
    }

    function health() {
        const detail = {};
        let ok = true;
        Object.entries(modules).forEach(([moduleName, names]) => {
            if (moduleName === 'character') return;
            const missing = names.filter(name => !checkFunction(name));
            detail[moduleName] = { ok: missing.length === 0, missing };
            if (missing.length) ok = false;
        });

        const characterHealth = global.OvoCharacterSettings?.health?.() || { ok: false, controllers: {} };
        detail.character = characterHealth;
        detail.ui = { ok: !!global.OvoUI };
        detail.presetManager = { ok: !!global.OvoSettingsPresetManager };
        if (!characterHealth.ok || !detail.ui.ok || !detail.presetManager.ok) ok = false;
        return { ok, version: VERSION, modules: detail };
    }

    global.OvoSettings = Object.freeze({
        VERSION,
        health,
        modules,
        character: global.OvoCharacterSettings
    });
})(window);
