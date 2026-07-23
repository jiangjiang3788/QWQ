(function (global) {
    'use strict';

    const VERSION = '2.13-R0';
    const Registry = global.OVOApiServiceRegistry || null;
    const groups = Object.freeze([
        { id: 'chat', label: '聊天', description: '主聊天连接与回复策略' },
        { id: 'memory', label: '记忆', description: '总结与向量检索' },
        { id: 'automation', label: '自动化', description: '后台活动与人设整理' },
        { id: 'perception', label: '感知', description: '图片、天气与表情识别' }
    ]);

    let activeGroup = 'chat';
    let initialized = false;

    function ready(config) {
        return !!(config && config.url && config.key && config.model);
    }

    function classify(section) {
        const title = (section.querySelector('h3')?.textContent || '').trim();
        if (/总结|向量/.test(title)) return 'memory';
        if (/后台活动|补齐人设/.test(title)) return 'automation';
        if (/识图|天气/.test(title)) return 'perception';
        return 'automation';
    }

    function statusFor(group) {
        const data = global.db || {};
        if (group === 'chat') return Registry ? (Registry.isReady('chat') ? '已配置' : '待配置') : (ready(data.apiSettings) ? '已配置' : '待配置');
        if (group === 'memory') {
            const summaryReady = Registry ? Registry.isReady('summary') : ready(data.summaryApiSettings);
            const vectorHealth = Registry ? Registry.health('vector') : { state: ready(data.vectorApiSettings) ? 'unverified' : 'missing' };
            if (vectorHealth.state === 'ready' && summaryReady) return '总结 + 向量';
            if (vectorHealth.state === 'ready') return '向量已验证';
            if (vectorHealth.state === 'error') return '向量异常';
            if (vectorHealth.state === 'unverified') return '向量待验证';
            return summaryReady ? '总结已配置' : '总结跟随主 API';
        }
        if (group === 'automation') return ready(data.backgroundApiSettings) || ready(data.supplementPersonaApiSettings) ? '已配置' : '使用主 API';
        const weatherReady = !!(data.weatherApiSettings && data.weatherApiSettings.provider);
        const perceptionReady = ready(data.imageRecognitionApiSettings) || ready(data.stickerRecognitionApiSettings) || weatherReady;
        return perceptionReady ? '已配置' : '使用默认';
    }

    function workspaceHtml() {
        return `<section class="api-workspace" id="api-workspace">
            <div class="api-workspace-tabs" role="tablist">
                ${groups.map(group => `<button type="button" role="tab" data-api-workspace="${group.id}"><strong>${group.label}</strong><small>${statusFor(group.id)}</small></button>`).join('')}
            </div>
            <div class="api-workspace-summary"><strong id="api-workspace-title"></strong><span id="api-workspace-description"></span></div>
        </section>`;
    }

    function ensureWorkspace() {
        const screen = document.getElementById('api-settings-screen');
        if (!screen) return null;
        let workspace = document.getElementById('api-workspace');
        if (!workspace) {
            const content = screen.querySelector('main.content');
            if (!content) return null;
            content.insertAdjacentHTML('afterbegin', workspaceHtml());
            workspace = document.getElementById('api-workspace');
            workspace.addEventListener('click', event => {
                const button = event.target.closest('[data-api-workspace]');
                if (button) show(button.dataset.apiWorkspace);
            });
        }
        return workspace;
    }

    function tagSections() {
        const screen = document.getElementById('api-settings-screen');
        if (!screen) return;
        const form = screen.querySelector('#api-form');
        if (form) form.dataset.apiGroup = 'chat';
        screen.querySelectorAll('.collapsible-section').forEach(section => {
            section.dataset.apiGroup = classify(section);
        });
    }

    function renderHeader() {
        const group = groups.find(item => item.id === activeGroup) || groups[0];
        const workspace = ensureWorkspace();
        if (!workspace) return;
        workspace.querySelectorAll('[data-api-workspace]').forEach(button => {
            const active = button.dataset.apiWorkspace === activeGroup;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', active ? 'true' : 'false');
            const small = button.querySelector('small');
            if (small) small.textContent = statusFor(button.dataset.apiWorkspace);
        });
        const title = workspace.querySelector('#api-workspace-title');
        const description = workspace.querySelector('#api-workspace-description');
        if (title) title.textContent = group.label;
        if (description) description.textContent = group.description;
    }

    function show(groupId) {
        if (!groups.some(group => group.id === groupId)) groupId = 'chat';
        activeGroup = groupId;
        init();
        const screen = document.getElementById('api-settings-screen');
        if (!screen) return;
        screen.querySelectorAll('[data-api-group]').forEach(section => {
            section.hidden = section.dataset.apiGroup !== activeGroup;
        });
        const content = screen.querySelector('main.content');
        if (content && typeof content.scrollTo === 'function') content.scrollTo({ top: 0, behavior: 'auto' });
        renderHeader();
    }

    function init() {
        ensureWorkspace();
        tagSections();
        initialized = true;
        renderHeader();
    }

    function open(groupId) {
        if (typeof switchScreen === 'function') switchScreen('api-settings-screen');
        show(groupId || activeGroup);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => show('chat'), { once: true });
    } else {
        show('chat');
    }

    global.OvoApiWorkspace = Object.freeze({ VERSION, init, open, show, groups: () => groups.map(item => ({ ...item })), get activeGroup() { return activeGroup; }, get initialized() { return initialized; } });
})(window);
