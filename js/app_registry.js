(function (global) {
    'use strict';

    const flags = global.OvoFeatureFlags;

    function escapeMarkup(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }


    function navigate(targetId) {
        if (typeof global.switchScreen === 'function') {
            global.switchScreen(targetId);
            return true;
        }
        return false;
    }

    function svgIcon(mark, background, foreground) {
        const safeMark = String(mark || '').slice(0, 2);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="24" fill="${background}"/><text x="50" y="59" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="38" font-weight="700" fill="${foreground}">${safeMark}</text></svg>`;
        return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    }

    const apps = Object.freeze([
        { id: 'memory', label: '记忆', group: 'main', section: 'people', placement: { dock: 30 }, opener: 'memory', customizable: false, iconKey: 'memory-table-screen', fallbackIcon: svgIcon('忆', '#f4efff', '#7b57c7') },
        { id: 'worldbook', label: '世界书', group: 'main', section: 'creative', placement: { home: 10 }, target: 'world-book-screen', opener: 'worldbook', iconKey: 'world-book-screen', fallbackIcon: svgIcon('界', '#eef8f2', '#438663') },
        { id: 'theater', label: '剧场', group: 'main', section: 'creative', placement: { home: 20 }, target: 'theater-screen', iconKey: 'theater-screen', fallbackIcon: svgIcon('剧', '#fff2eb', '#bd6d3f') },
        { id: 'favorites', label: '收藏', group: 'main', section: 'organize', placement: { home: 30 }, opener: 'favorites', iconKey: 'favorites-screen', fallbackIcon: svgIcon('藏', '#fff1f4', '#d55d78') },
        { id: 'reminder', label: '提醒', group: 'main', section: 'organize', placement: { home: 40 }, opener: 'reminder', iconKey: 'reminder-screen', fallbackIcon: svgIcon('醒', '#fff8e8', '#b98224') },
        { id: 'search', label: '搜索', group: 'main', section: 'organize', placement: { home: 50 }, opener: 'search', iconKey: 'search-history-screen', fallbackIcon: svgIcon('搜', '#edf7fa', '#3f8191') },

        { id: 'chat', label: '聊天', group: 'dock', placement: { dock: 10 }, target: 'chat-list-screen', customizable: false, iconKey: 'chat-list-screen', fallbackIcon: svgIcon('聊', '#eff3ff', '#5570d8') },
        { id: 'api', label: 'API', group: 'dock', placement: { dock: 20 }, opener: 'api', iconKey: 'api-settings-screen', fallbackIcon: svgIcon('API', '#f2f2f5', '#555764') },
        { id: 'data', label: '数据', group: 'system', placement: { home: 80 }, target: 'storage-analysis-screen', iconKey: 'storage-analysis-screen', fallbackIcon: svgIcon('数', '#eff8f5', '#4b8975') },
        { id: 'appearance', label: '外观', group: 'system', placement: { home: 70 }, target: 'appearance-settings-screen', iconKey: 'appearance-settings-screen', fallbackIcon: svgIcon('美', '#fff0f4', '#b55e7b') },
        { id: 'settings', label: '设置', group: 'system', placement: { dock: 40 }, opener: 'settings', customizable: false, fallbackIcon: svgIcon('设', '#f1f2f6', '#596170') },

        { id: 'proment', label: 'Proment', group: 'advanced', placement: { home: 60 }, opener: 'proment', iconKey: 'magic-room-screen', fallbackIcon: svgIcon('P', '#f2efff', '#6c55b4'), enabled: () => !flags || flags.get('advancedApps') },
        { id: 'regex', label: '正则', group: 'advanced', placement: {}, target: 'regex-filter-manager-screen', fallbackIcon: svgIcon('.*', '#f0f2f5', '#565d69'), enabled: () => !flags || flags.get('advancedApps') },
        { id: 'cot', label: '思维链', group: 'advanced', placement: {}, target: 'cot-settings-screen', fallbackIcon: svgIcon('思', '#f4f0ff', '#7658aa'), enabled: () => !flags || flags.get('advancedApps') },
        { id: 'status', label: '状态栏', group: 'advanced', placement: {}, target: 'status-bar-manager-screen', fallbackIcon: svgIcon('态', '#eef7ff', '#4a789c'), enabled: () => !flags || flags.get('advancedApps') }
    ]);

    function isEnabled(app) {
        return typeof app.enabled === 'function' ? !!app.enabled() : app.enabled !== false;
    }

    function customName(app) {
        if (app.customizable === false) return app.label;
        const names = global.db && global.db.customAppNames;
        return (names && app.iconKey && names[app.iconKey]) || app.label;
    }

    function iconUrl(app) {
        const custom = global.db && global.db.customIcons;
        if (custom && app.iconKey && custom[app.iconKey]) return custom[app.iconKey];
        if (typeof defaultIcons !== 'undefined' && app.iconKey && defaultIcons[app.iconKey] && defaultIcons[app.iconKey].url) {
            return defaultIcons[app.iconKey].url;
        }
        return app.fallbackIcon || '';
    }

    function renderApp(app, extraClass) {
        return `<a href="#" class="app-icon ${extraClass || ''}" data-app-id="${app.id}" aria-label="${customName(app)}"><img src="${iconUrl(app)}" alt="" class="icon-img"><span class="app-name">${customName(app)}</span></a>`;
    }

    function appsByPlacement(placement) {
        return apps
            .filter(app => isEnabled(app) && Number.isFinite(Number(app.placement?.[placement])))
            .slice()
            .sort((a, b) => Number(a.placement[placement]) - Number(b.placement[placement]) || a.id.localeCompare(b.id));
    }

    function renderLauncher() {
        const dock = appsByPlacement('dock');
        const homeApps = appsByPlacement('home');
        return `
            <div class="home-screen-swiper single-page-home phone-launcher">
                <div class="home-screen-page phone-home-page">
                    <div class="app-grid phone-app-grid app-launcher-grid" aria-label="应用">
                        ${homeApps.map(app => renderApp(app, 'launcher-app')).join('')}
                    </div>
                </div>
            </div>
            <div class="dock primary-dock app-launcher-dock" aria-label="常用应用">
                ${dock.map(app => renderApp(app, 'dock-app')).join('')}
            </div>`;
    }

    const LAST_CHARACTER_STORAGE_KEY = 'ovo:last-character-workspace';

    function rememberCharacter(characterId) {
        try {
            if (characterId) global.sessionStorage?.setItem(LAST_CHARACTER_STORAGE_KEY, String(characterId));
        } catch (_) {}
    }

    function getRememberedCharacter() {
        let rememberedId = '';
        try { rememberedId = global.sessionStorage?.getItem(LAST_CHARACTER_STORAGE_KEY) || ''; } catch (_) {}
        if (!rememberedId || !global.db || !Array.isArray(global.db.characters)) return null;
        return global.db.characters.find(item => item.id === rememberedId) || null;
    }

    function setCurrentCharacter(characterId) {
        const character = global.db && Array.isArray(global.db.characters)
            ? global.db.characters.find(item => item.id === characterId)
            : null;
        if (!character) return null;
        global.currentChatId = character.id;
        global.currentChatType = 'private';
        rememberCharacter(character.id);
        return character;
    }

    function closePickerDialog(dialog) {
        if (!dialog) return;
        try {
            if (typeof dialog.close === 'function' && dialog.open) dialog.close();
            else dialog.removeAttribute('open');
        } catch (_) {
            dialog.removeAttribute('open');
        }
        dialog.classList.remove('app-picker-dialog-open');
    }

    function showPickerDialog(dialog) {
        if (!dialog) return;
        try {
            if (typeof dialog.showModal === 'function') {
                if (!dialog.open) dialog.showModal();
            } else {
                dialog.setAttribute('open', '');
            }
        } catch (_) {
            dialog.setAttribute('open', '');
        }
        dialog.classList.add('app-picker-dialog-open');
    }

    function openCharacterPicker(title, onSelect) {
        const characters = global.db && Array.isArray(global.db.characters) ? global.db.characters : [];
        if (!characters.length) {
            if (typeof global.showToast === 'function') global.showToast('还没有角色，先创建一个吧');
            navigate('chat-list-screen');
            return;
        }
        if (characters.length === 1) {
            const onlyCharacter = setCurrentCharacter(characters[0].id);
            if (onlyCharacter) onSelect(onlyCharacter);
            return;
        }

        let dialog = document.getElementById('app-character-picker-dialog');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'app-character-picker-dialog';
            dialog.className = 'app-picker-dialog';
            document.body.appendChild(dialog);
        }

        dialog.innerHTML = `
            <div class="app-picker-head"><strong>${escapeMarkup(title)}</strong><button type="button" data-picker-close aria-label="关闭">×</button></div>
            <div class="app-picker-list">
                ${characters.map(character => `
                    <button type="button" class="app-picker-item" data-character-id="${character.id}">
                        <img src="${escapeMarkup(character.avatar || '')}" alt="">
                        <span>${escapeMarkup(character.remarkName || character.realName || '未命名角色')}</span>
                    </button>`).join('')}
            </div>`;

        dialog.onclick = event => {
            if (event.target === dialog || event.target.closest('[data-picker-close]')) {
                closePickerDialog(dialog);
                return;
            }
            const button = event.target.closest('[data-character-id]');
            if (!button) return;
            const character = setCurrentCharacter(button.dataset.characterId);
            closePickerDialog(dialog);
            if (character) onSelect(character);
        };

        showPickerDialog(dialog);
    }

    const openers = {
        memory() {
            const open = character => {
                if (!character) return;
                if (global.OvoMemory?.screen?.openWorkspace) global.OvoMemory.screen.openWorkspace('memory', 'tables');
                else if (typeof global.renderMemoryTableScreen === 'function') global.renderMemoryTableScreen();
                navigate('memory-table-screen');
            };
            const current = global.currentChatType === 'private' ? setCurrentCharacter(global.currentChatId) : null;
            const remembered = current || getRememberedCharacter();
            if (remembered) {
                open(setCurrentCharacter(remembered.id));
                return;
            }
            // 先打开记忆页，避免角色选择器在不支持原生 dialog 的 WebView 中失败时表现为“完全没反应”。
            navigate('memory-table-screen');
            if (typeof global.renderMemoryTableScreen === 'function') global.renderMemoryTableScreen();
            openCharacterPicker('选择角色记忆', open);
        },
        reminder() {
            const open = () => {
                if (typeof global.openReminderScreen === 'function') global.openReminderScreen();
                else navigate('reminder-screen');
            };
            const current = global.currentChatType === 'private' ? setCurrentCharacter(global.currentChatId) : null;
            if (current) open();
            else openCharacterPicker('选择角色提醒', open);
        },
        search() {
            if (global.SearchSystem && typeof global.SearchSystem.open === 'function') global.SearchSystem.open();
            else navigate('search-history-screen');
        },
        favorites() {
            if (typeof global.openFavoritesScreen === 'function') global.openFavoritesScreen();
            else navigate('favorites-screen');
        },
        worldbook() {
            if (typeof global.renderWorldBookList === 'function') global.renderWorldBookList();
            navigate('world-book-screen');
        },
        proment() {
            if (typeof global.setupMagicRoomApp === 'function') global.setupMagicRoomApp();
            navigate('magic-room-screen');
        },
        api() {
            if (global.OvoApiWorkspace && typeof global.OvoApiWorkspace.open === 'function') global.OvoApiWorkspace.open('chat');
            else navigate('api-settings-screen');
        },
        settings() {
            if (global.OvoSettingsHub && typeof global.OvoSettingsHub.open === 'function') global.OvoSettingsHub.open();
            else navigate('home-screen');
        }
    };

    function openApp(appId) {
        const app = apps.find(item => item.id === appId && isEnabled(item));
        if (!app) return false;
        if (app.opener && openers[app.opener]) {
            openers[app.opener]();
            return true;
        }
        if (app.target) return navigate(app.target);
        return false;
    }

    function bindLauncher(root) {
        if (!root || root.dataset.appRegistryBound === '1') return;
        root.dataset.appRegistryBound = '1';
        root.addEventListener('click', event => {
            const appLink = event.target.closest('[data-app-id]');
            if (!appLink || !root.contains(appLink)) return;
            event.preventDefault();
            openApp(appLink.dataset.appId);
        });
    }

    global.OvoAppRegistry = Object.freeze({
        list(group) {
            if (group === 'home' || group === 'dock') return appsByPlacement(group).map(app => ({ ...app, placement: { ...(app.placement || {}) } }));
            return apps.filter(app => (!group || app.group === group) && isEnabled(app)).map(app => ({ ...app, placement: { ...(app.placement || {}) } }));
        },
        renderLauncher,
        bindLauncher,
        openApp,
        pickCharacter: openCharacterPicker,
        sections() { return [{ id: 'desktop', label: '桌面', appIds: appsByPlacement('home').map(app => app.id) }]; }
    });
})(window);
