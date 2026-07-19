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


    function navigate(targetId, options) {
        if (global.OvoNavigation && typeof global.OvoNavigation.go === 'function') return global.OvoNavigation.go(targetId, options || {});
        if (typeof switchScreen === 'function') return switchScreen(targetId, options || {});
        return false;
    }

    function svgIcon(mark, background, foreground) {
        const safeMark = String(mark || '').slice(0, 2);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="24" fill="${background}"/><text x="50" y="59" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="38" font-weight="700" fill="${foreground}">${safeMark}</text></svg>`;
        return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    }

    const apps = Object.freeze([
        { id: 'characters', label: '角色', group: 'dock', section: 'people', opener: 'characters', customizable: false, iconKey: 'chat-list-screen', fallbackIcon: svgIcon('角', '#eff3ff', '#5570d8') },
        { id: 'memory', label: '记忆', group: 'dock', section: 'people', opener: 'memory', customizable: false, iconKey: 'memory-table-screen', fallbackIcon: svgIcon('忆', '#f4efff', '#7b57c7') },
        { id: 'worldbook', label: '世界书', group: 'main', section: 'creative', target: 'world-book-screen', opener: 'worldbook', iconKey: 'world-book-screen', fallbackIcon: svgIcon('界', '#eef8f2', '#438663') },
        { id: 'theater', label: '剧场', group: 'main', section: 'creative', target: 'theater-screen', iconKey: 'theater-screen', fallbackIcon: svgIcon('剧', '#fff2eb', '#bd6d3f') },
        { id: 'favorites', label: '收藏', group: 'main', section: 'organize', opener: 'favorites', iconKey: 'favorites-screen', fallbackIcon: svgIcon('藏', '#fff1f4', '#d55d78') },
        { id: 'reminder', label: '提醒', group: 'main', section: 'organize', opener: 'reminder', iconKey: 'reminder-screen', fallbackIcon: svgIcon('醒', '#fff8e8', '#b98224') },
        { id: 'search', label: '搜索', group: 'main', section: 'organize', opener: 'search', iconKey: 'search-history-screen', fallbackIcon: svgIcon('搜', '#edf7fa', '#3f8191') },
        { id: 'contacts', label: '联系人', group: 'context', section: 'people', target: 'contacts-screen', iconKey: 'contacts-screen', fallbackIcon: svgIcon('友', '#eef7ff', '#3e7ab4') },

        { id: 'chat', label: '聊天', group: 'dock', target: 'chat-list-screen', customizable: false, iconKey: 'chat-list-screen', fallbackIcon: svgIcon('聊', '#eff3ff', '#5570d8') },
        { id: 'api', label: 'API', group: 'settings', opener: 'api', iconKey: 'api-settings-screen', fallbackIcon: svgIcon('API', '#f2f2f5', '#555764') },
        { id: 'data', label: '数据', group: 'settings', target: 'storage-analysis-screen', iconKey: 'storage-analysis-screen', fallbackIcon: svgIcon('数', '#eff8f5', '#4b8975') },
        { id: 'appearance', label: '外观', group: 'settings', target: 'appearance-settings-screen', iconKey: 'appearance-settings-screen', fallbackIcon: svgIcon('美', '#fff0f4', '#b55e7b') },
        { id: 'settings', label: '设置', group: 'dock', opener: 'settings', customizable: false, fallbackIcon: svgIcon('设', '#f1f2f6', '#596170') },

        { id: 'proment', label: 'Proment', group: 'advanced', opener: 'proment', iconKey: 'magic-room-screen', fallbackIcon: svgIcon('P', '#f2efff', '#6c55b4'), enabled: () => !flags || flags.get('advancedApps') },
        { id: 'regex', label: '正则', group: 'advanced', target: 'regex-filter-manager-screen', fallbackIcon: svgIcon('.*', '#f0f2f5', '#565d69'), enabled: () => !flags || flags.get('advancedApps') },
        { id: 'cot', label: '思维链', group: 'advanced', target: 'cot-settings-screen', fallbackIcon: svgIcon('思', '#f4f0ff', '#7658aa'), enabled: () => !flags || flags.get('advancedApps') },
        { id: 'status', label: '状态栏', group: 'advanced', target: 'status-bar-manager-screen', fallbackIcon: svgIcon('态', '#eef7ff', '#4a789c'), enabled: () => !flags || flags.get('advancedApps') }
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

    const launcherPages = Object.freeze([
        { id: 'daily', label: '常用', appIds: ['worldbook', 'theater', 'favorites', 'reminder', 'search'] }
    ]);

    function appsByIds(ids) {
        return ids.map(id => apps.find(app => app.id === id && isEnabled(app))).filter(Boolean);
    }

    function renderLauncherPage(page, index) {
        const pageApps = appsByIds(page.appIds);
        return `<section class="home-launcher-page" data-launcher-page="${index}" aria-label="${escapeMarkup(page.label)}">
            <div class="app-grid home-launcher-grid">${pageApps.map(app => renderApp(app, 'launcher-app')).join('')}</div>
        </section>`;
    }

    function renderLauncher() {
        const dock = appsByIds(['chat', 'characters', 'memory', 'settings']);
        const visiblePages = launcherPages.filter(page => appsByIds(page.appIds).length);
        return `
            <div class="home-launcher-viewport" data-launcher-viewport>
                <div class="home-launcher-track">${visiblePages.map(renderLauncherPage).join('')}</div>
            </div>
            ${visiblePages.length > 1 ? `<div class="page-indicator home-launcher-indicator">${visiblePages.map((_, index) => `<button type="button" class="dot ${index === 0 ? 'active' : ''}" data-launcher-dot="${index}" aria-label="第 ${index + 1} 页"></button>`).join('')}</div>` : ''}
            <div class="dock primary-dock app-launcher-dock" aria-label="常用应用">
                ${dock.map(app => renderApp(app, 'dock-app')).join('')}
            </div>`;
    }

    function bindPager(root) {
        const viewport = root.querySelector('[data-launcher-viewport]');
        if (!viewport || viewport.dataset.launcherPagerBound === '1') return;
        viewport.dataset.launcherPagerBound = '1';
        let frame = 0;
        const updateDots = () => {
            frame = 0;
            const pageWidth = Math.max(1, viewport.clientWidth);
            const index = Math.round(viewport.scrollLeft / pageWidth);
            root.querySelectorAll('[data-launcher-dot]').forEach(dot => dot.classList.toggle('active', Number(dot.dataset.launcherDot) === index));
        };
        viewport.addEventListener('scroll', () => {
            if (!frame) frame = requestAnimationFrame(updateDots);
        }, { passive: true });
    }

    function setCurrentCharacter(characterId) {
        const character = global.db && Array.isArray(global.db.characters)
            ? global.db.characters.find(item => item.id === characterId)
            : null;
        if (!character) return null;
        global.currentChatId = character.id;
        global.currentChatType = 'private';
        return character;
    }

    function openCharacterPicker(title, onSelect) {
        const characters = global.db && Array.isArray(global.db.characters) ? global.db.characters : [];
        if (!characters.length) {
            if (typeof global.showToast === 'function') global.showToast('还没有角色，先创建一个吧');
            navigate('chat-list-screen');
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
                dialog.close();
                return;
            }
            const button = event.target.closest('[data-character-id]');
            if (!button) return;
            const character = setCurrentCharacter(button.dataset.characterId);
            dialog.close();
            if (character) onSelect(character);
        };

        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
    }

    function ensureCharacterAppScreen() {
        let screen = document.getElementById('character-app-screen');
        if (screen) return screen;
        screen = document.createElement('div');
        screen.className = 'screen';
        screen.id = 'character-app-screen';
        const shell = document.querySelector('.phone-screen');
        (shell || document.body).appendChild(screen);
        screen.addEventListener('click', event => {
            const add = event.target.closest('[data-character-app-add]');
            if (add) {
                document.getElementById('add-chat-btn-kkt')?.click();
                return;
            }
            const action = event.target.closest('[data-character-action]');
            if (!action) return;
            const character = setCurrentCharacter(action.dataset.characterId);
            if (!character) return;
            if (action.dataset.characterAction === 'chat') {
                if (typeof global.openChatRoom === 'function') global.openChatRoom(character.id, 'private');
            } else if (action.dataset.characterAction === 'memory') {
                if (typeof global.renderMemoryTableScreen === 'function') global.renderMemoryTableScreen();
                navigate('memory-table-screen');
            } else if (action.dataset.characterAction === 'settings') {
                if (typeof global.loadSettingsToSidebar === 'function') global.loadSettingsToSidebar();
                navigate('chat-settings-screen');
            }
        });
        return screen;
    }

    function renderCharacterApp() {
        const screen = ensureCharacterAppScreen();
        const characters = global.db && Array.isArray(global.db.characters) ? global.db.characters : [];
        screen.innerHTML = `
            <header class="app-header">
                <button type="button" class="back-btn" data-target="home-screen">‹</button>
                <div class="title-container"><h1 class="title">角色</h1></div>
                <div class="action-btn-group"><button type="button" class="action-btn" data-character-app-add aria-label="新建角色">+</button></div>
            </header>
            <main class="content character-app-content">
                ${characters.length ? `<div class="character-app-list">${characters.map(character => `
                    <article class="character-app-card">
                        <img src="${escapeMarkup(character.avatar || '')}" alt="">
                        <div class="character-app-info"><strong>${escapeMarkup(character.remarkName || character.realName || '未命名角色')}</strong><span>${escapeMarkup(character.signature || character.persona || '角色档案')}</span></div>
                        <div class="character-app-actions">
                            <button type="button" data-character-action="chat" data-character-id="${character.id}">聊天</button>
                            <button type="button" data-character-action="memory" data-character-id="${character.id}">记忆</button>
                            <button type="button" data-character-action="settings" data-character-id="${character.id}">设置</button>
                        </div>
                    </article>`).join('')}</div>` : '<div class="character-app-empty"><strong>还没有角色</strong><button type="button" data-character-app-add>新建角色</button></div>'}
            </main>`;
        return screen;
    }

    const openers = {
        characters() {
            renderCharacterApp();
            navigate('character-app-screen');
        },
        memory() {
            const open = character => {
                if (typeof global.renderMemoryTableScreen === 'function') global.renderMemoryTableScreen();
                navigate('memory-table-screen');
            };
            const current = global.currentChatType === 'private' ? setCurrentCharacter(global.currentChatId) : null;
            if (current) open(current);
            else openCharacterPicker('选择角色记忆', open);
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
            if (typeof SearchSystem !== 'undefined' && typeof SearchSystem.open === 'function') SearchSystem.open();
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
        if (!root) return;
        bindPager(root);
        if (root.dataset.appRegistryBound === '1') return;
        root.dataset.appRegistryBound = '1';
        root.addEventListener('click', event => {
            const dot = event.target.closest('[data-launcher-dot]');
            if (dot) {
                const viewport = root.querySelector('[data-launcher-viewport]');
                if (viewport) viewport.scrollTo({ left: Number(dot.dataset.launcherDot) * viewport.clientWidth, behavior: 'smooth' });
                return;
            }
            const appLink = event.target.closest('[data-app-id]');
            if (!appLink || !root.contains(appLink)) return;
            event.preventDefault();
            openApp(appLink.dataset.appId);
        });
    }

    global.OvoAppRegistry = Object.freeze({
        list(group) {
            return apps.filter(app => (!group || app.group === group) && isEnabled(app)).map(app => ({ ...app }));
        },
        renderLauncher,
        bindLauncher,
        openApp,
        pickCharacter: openCharacterPicker,
        sections() { return launcherPages.map(page => ({ ...page, appIds: [...page.appIds] })); }
    });
})(window);
