(function (global) {
    'use strict';

    const VERSION = '2.10-R1';

    function escapeHtml(value) {
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

    function currentProfile() {
        const data = global.db || {};
        return {
            name: data.myName || data.userName || '我的设置',
            avatar: data.myAvatar || data.userAvatar || 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg'
        };
    }

    function currentCharacter() {
        if (!global.db || !Array.isArray(global.db.characters) || global.currentChatType !== 'private') return null;
        return global.db.characters.find(item => item.id === global.currentChatId) || null;
    }

    function ensureScreen() {
        let screen = document.getElementById('settings-hub-screen');
        if (screen) return screen;
        screen = document.createElement('div');
        screen.className = 'screen settings-hub-screen';
        screen.id = 'settings-hub-screen';
        const shell = document.querySelector('.phone-screen');
        (shell || document.body).appendChild(screen);
        screen.addEventListener('click', handleClick);
        return screen;
    }

    const sections = [
        {
            id: 'profile',
            title: '个人与角色',
            items: [
                { id: 'profile', label: '我的档案', detail: '名字、头像与绑定角色', action: 'profile', mark: '我' },
                { id: 'character-settings', label: '角色设置', detail: '当前角色的设定与功能', action: 'character-settings', mark: '设' },
                { id: 'memory', label: '角色记忆', detail: '状态、待办与长期记忆', app: 'memory', mark: '忆' }
            ]
        },
        {
            id: 'model',
            title: '模型与能力',
            items: [
                { id: 'api', label: 'API 与模型', detail: '聊天、记忆和感知服务', app: 'api', mark: 'AI' },
                { id: 'cot', label: '思维链', detail: '全局思考与输出策略', target: 'cot-settings-screen', advanced: true, mark: '思' },
                { id: 'regex', label: '正则规则', detail: '高级内容过滤与替换', target: 'regex-filter-manager-screen', advanced: true, mark: '.*' }
            ]
        },
        {
            id: 'appearance',
            title: '外观与桌面',
            items: [
                { id: 'appearance', label: '外观', detail: '主题、字体与界面风格', app: 'appearance', mark: '美' },
                { id: 'wallpaper', label: '壁纸', detail: '桌面、聊天与通话背景', target: 'wallpaper-screen', mark: '图' },
                { id: 'launcher', label: 'App 图标', detail: '图标、名称与桌面布局', target: 'customize-screen', mark: '桌' },
                { id: 'status', label: '状态栏', detail: '顶部状态信息与样式', target: 'status-bar-manager-screen', advanced: true, mark: '态' }
            ]
        },
        {
            id: 'data',
            title: '数据与系统',
            items: [
                { id: 'data', label: '数据与备份', detail: '空间、备份、导入与恢复', app: 'data', mark: '数' },
                { id: 'tutorial', label: '使用与迁移', detail: '教程、部署与 GitHub 备份', target: 'tutorial-screen', mark: '?' },
                { id: 'health', label: '运行状态', detail: '版本和核心模块检查', action: 'health', mark: '✓' }
            ]
        }
    ];

    function visibleSections() {
        const advancedEnabled = !global.OvoFeatureFlags || global.OvoFeatureFlags.get('advancedApps');
        return sections.map(section => ({
            ...section,
            items: section.items.filter(item => !item.advanced || advancedEnabled)
        })).filter(section => section.items.length);
    }

    function itemHtml(item) {
        return `<button type="button" class="settings-hub-item" data-settings-item="${escapeHtml(item.id)}">
            <span class="settings-hub-item-icon">${escapeHtml(item.mark)}</span>
            <span class="settings-hub-item-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span>
            <span class="settings-hub-item-arrow">›</span>
        </button>`;
    }

    function render() {
        const screen = ensureScreen();
        const profile = currentProfile();
        const character = currentCharacter();
        screen.innerHTML = `<header class="app-header">
            <button type="button" class="back-btn" data-target="home-screen">‹</button>
            <div class="title-container"><h1 class="title">设置</h1></div>
            <div class="placeholder"></div>
        </header>
        <main class="content settings-hub-content">
            <section class="settings-hub-profile">
                <img src="${escapeHtml(profile.avatar)}" alt="">
                <div><strong>${escapeHtml(profile.name)}</strong><span>${character ? `当前角色：${escapeHtml(character.remarkName || character.realName || '未命名角色')}` : '未选择当前角色'}</span></div>
            </section>
            ${visibleSections().map(section => `<section class="settings-hub-section" data-settings-section="${section.id}">
                <h2>${escapeHtml(section.title)}</h2>
                <div class="settings-hub-list">${section.items.map(itemHtml).join('')}</div>
            </section>`).join('')}
            <footer class="settings-hub-version">章鱼机 ${VERSION}</footer>
        </main>`;
        return screen;
    }

    function findItem(id) {
        for (const section of visibleSections()) {
            const item = section.items.find(entry => entry.id === id);
            if (item) return item;
        }
        return null;
    }

    function openCharacterSettings() {
        const open = character => {
            if (!character) return;
            global.currentChatId = character.id;
            global.currentChatType = 'private';
            if (typeof loadSettingsToSidebar === 'function') loadSettingsToSidebar();
            navigate('chat-settings-screen');
        };
        const selected = currentCharacter();
        if (selected) {
            open(selected);
            return;
        }
        if (global.OvoAppRegistry && typeof global.OvoAppRegistry.pickCharacter === 'function') {
            global.OvoAppRegistry.pickCharacter('选择角色设置', open);
            return;
        }
        if (typeof global.showToast === 'function') global.showToast('请从聊天页右上角新建或选择角色');
    }

    function showHealth() {
        const memory = global.OvoMemory && typeof global.OvoMemory.health === 'function'
            ? global.OvoMemory.health()
            : { ok: false };
        const message = memory.ok
            ? '核心模块运行正常'
            : '部分模块尚未就绪，请刷新后重试';
        if (typeof global.showToast === 'function') global.showToast(message);
        else global.alert(message);
    }

    function handleClick(event) {
        const button = event.target.closest('[data-settings-item]');
        if (!button) return;
        const item = findItem(button.dataset.settingsItem);
        if (!item) return;
        if (item.app && global.OvoAppRegistry) {
            global.OvoAppRegistry.openApp(item.app);
            return;
        }
        if (item.target) {
            navigate(item.target);
            return;
        }
        if (item.action === 'profile') {
            if (typeof global.setupMyProfileScreen === 'function') global.setupMyProfileScreen();
            navigate('my-profile-screen');
        }
        if (item.action === 'character-settings') openCharacterSettings();
        if (item.action === 'health') showHealth();
    }

    function open() {
        render();
        navigate('settings-hub-screen');
    }

    global.OvoSettingsHub = Object.freeze({ VERSION, open, render, sections: () => visibleSections() });
})(window);
