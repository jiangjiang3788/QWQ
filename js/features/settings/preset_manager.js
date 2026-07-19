(function (global) {
    'use strict';

    const VERSION = '2.9-R4';

    function safeCall(fn) {
        if (typeof fn !== 'function') return undefined;
        try { return fn(); } catch (error) { console.error('[SettingsPresetManager]', error); return undefined; }
    }

    function showToastSafe(message) {
        if (typeof global.showToast === 'function') global.showToast(message);
    }

    function open(config) {
        const ui = global.OvoUI;
        const modal = document.getElementById(config.modalId);
        const list = document.getElementById(config.listId);
        if (!ui || !modal || !list) return false;
        const items = (config.getItems && config.getItems()) || [];

        ui.renderActionList(list, items, {
            emptyText: '暂无预设',
            describe: config.describe,
            actions(item, index) {
                const actions = [];
                if (typeof config.apply === 'function') {
                    actions.push({
                        label: '应用',
                        variant: 'primary',
                        onClick() {
                            config.apply(item, index);
                            ui.closeOverlay(modal);
                        }
                    });
                }
                actions.push({
                    label: '重命名',
                    onClick() {
                        const nextName = global.prompt('输入新名称：', item.name || '');
                        if (!nextName || nextName.trim() === item.name) return;
                        const next = (config.getItems() || []).slice();
                        if (!next[index]) return;
                        next[index] = { ...next[index], name: nextName.trim() };
                        config.saveItems(next);
                        safeCall(config.refresh);
                        open(config);
                    }
                });
                actions.push({
                    label: '删除',
                    variant: 'danger',
                    onClick() {
                        if (!global.confirm(`确定删除预设“${item.name || ''}”？`)) return;
                        const next = (config.getItems() || []).slice();
                        next.splice(index, 1);
                        config.saveItems(next);
                        safeCall(config.refresh);
                        open(config);
                    }
                });
                return actions;
            }
        });
        ui.openOverlay(modal);
        return true;
    }

    function saveDbArray(key, items) {
        if (!global.db) return;
        global.db[key] = items;
        safeCall(global.saveData);
    }

    function installOverrides() {
        const configs = {
            api: {
                modalId: 'api-presets-modal', listId: 'api-presets-list',
                getItems: () => safeCall(global._getApiPresets) || [],
                saveItems: items => global._saveApiPresets(items),
                apply: item => global.applyApiPreset(item.name),
                refresh: () => global.populateApiSelect(),
                describe: item => item.data && item.data.provider ? `提供者：${item.data.provider}` : ''
            },
            bubble: {
                modalId: 'bubble-presets-modal', listId: 'bubble-presets-list',
                getItems: () => safeCall(global._getBubblePresets) || [],
                saveItems: items => global._saveBubblePresets(items),
                apply: item => global.applyPresetToCurrentChat(item.name),
                refresh: () => { global.populateBubblePresetSelect('bubble-preset-select'); global.populateBubblePresetSelect('group-bubble-preset-select'); }
            },
            persona: {
                modalId: 'mypersona-presets-modal', listId: 'mypersona-presets-list',
                getItems: () => safeCall(global._getMyPersonaPresets) || [],
                saveItems: items => global._saveMyPersonaPresets(items),
                apply: item => global.applyMyPersonaPresetToCurrentChat(item.name),
                refresh: () => global.populateMyPersonaSelect()
            },
            font: {
                modalId: 'font-presets-modal', listId: 'font-presets-list',
                getItems: () => safeCall(global._getFontPresets) || [],
                saveItems: items => global._saveFontPresets(items),
                apply: item => global.applyFontPreset(item.name),
                refresh: () => global.populateFontPresetSelect(),
                describe: item => item.localFontName || item.fontFamily || ''
            },
            globalCss: {
                modalId: 'global-css-presets-modal', listId: 'global-css-presets-list',
                getItems: () => (global.db && global.db.globalCssPresets) || [],
                saveItems: items => saveDbArray('globalCssPresets', items),
                refresh: () => global.populateGlobalCssPresetSelect()
            },
            sound: {
                modalId: 'sound-presets-modal', listId: 'sound-presets-list',
                getItems: () => safeCall(global._getSoundPresets) || [],
                saveItems: items => global._saveSoundPresets(items),
                apply: item => global.applySoundPreset(item.name),
                refresh: () => global.populateSoundPresetSelect()
            },
            voice: {
                modalId: 'voice-presets-modal', listId: 'voice-presets-list',
                getItems: () => safeCall(global._getVoicePresets) || [],
                saveItems: items => global._saveVoicePresets(items),
                apply: item => global.applyVoicePreset(item.name),
                refresh: () => global.populateVoicePresetSelect(),
                describe: item => item.customVoiceId || item.voiceId || '未设置音色'
            },
            icons: {
                modalId: 'icon-presets-modal', listId: 'icon-presets-list',
                getItems: () => safeCall(global._getIconPresets) || [],
                saveItems: items => global._saveIconPresets(items),
                apply: item => global.applyIconPreset(item.name),
                refresh: () => global.populateIconPresetSelect()
            },
            names: {
                modalId: 'name-presets-modal', listId: 'name-presets-list',
                getItems: () => safeCall(global._getNamePresets) || [],
                saveItems: items => global._saveNamePresets(items),
                apply: item => global.applyNamePreset(item.name),
                refresh: () => global.populateNamePresetSelect()
            },
            tts: {
                modalId: 'tts-presets-modal', listId: 'tts-presets-list',
                getItems: () => (global.db && global.db.ttsPresets) || [],
                saveItems: items => saveDbArray('ttsPresets', items),
                refresh: () => global.populateTTSPresetSelect(),
                describe: item => item.model || ''
            }
        };

        global.openApiManageModal = () => open(configs.api);
        global.openManagePresetsModal = () => open(configs.bubble);
        global.openManageMyPersonaModal = () => open(configs.persona);
        global.openFontManageModal = () => open(configs.font);
        global.openGlobalCssManageModal = () => open(configs.globalCss);
        global.openSoundManageModal = () => open(configs.sound);
        global.openVoicePresetManageModal = () => open(configs.voice);
        global.openIconPresetManageModal = () => open(configs.icons);
        global.openNamePresetManageModal = () => open(configs.names);
        global.openTTSManageModal = () => open(configs.tts);

        return Object.keys(configs);
    }

    const installed = installOverrides();
    global.OvoSettingsPresetManager = Object.freeze({ VERSION, open, installed: () => installed.slice() });
})(window);
