(function (global) {
    'use strict';

    const registry = new Map();
    let setupComplete = false;

    function register(name, controller) {
        if (!name || !controller || typeof controller !== 'object') {
            throw new TypeError('角色设置控制器注册参数无效');
        }
        registry.set(name, Object.freeze({
            name,
            setupOrder: Number(controller.setupOrder) || 100,
            loadOrder: Number(controller.loadOrder) || 100,
            saveOrder: Number(controller.saveOrder) || 100,
            setup: typeof controller.setup === 'function' ? controller.setup : null,
            load: typeof controller.load === 'function' ? controller.load : null,
            save: typeof controller.save === 'function' ? controller.save : null
        }));
    }

    function ordered(phase) {
        const key = `${phase}Order`;
        return Array.from(registry.values()).sort((a, b) => a[key] - b[key]);
    }

    function getCurrentCharacter() {
        if (!global.db || !Array.isArray(global.db.characters)) return null;
        return global.db.characters.find(character => character.id === global.currentChatId) || null;
    }

    function setupAll() {
        if (setupComplete) return;
        ordered('setup').forEach(controller => controller.setup?.());
        setupComplete = true;
    }

    function loadAll(character) {
        if (!character) return;
        ordered('load').forEach(controller => controller.load?.(character));
    }

    async function saveAll(character) {
        if (!character) return;
        for (const controller of ordered('save')) {
            if (controller.save) await controller.save(character);
        }
    }

    function health() {
        const detail = {};
        ['profile', 'chat', 'behavior', 'media', 'extensions'].forEach(name => {
            const controller = registry.get(name);
            detail[name] = {
                ok: !!controller && !!controller.setup && !!controller.load && !!controller.save
            };
        });
        return {
            ok: Object.values(detail).every(item => item.ok),
            setupComplete,
            controllers: detail
        };
    }

    global.OvoCharacterSettings = Object.freeze({
        VERSION: '2.9-R5',
        register,
        setupAll,
        loadAll,
        saveAll,
        getCurrentCharacter,
        health
    });
})(window);
