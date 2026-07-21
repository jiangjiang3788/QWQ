// 长期记忆组合 UI：结构化档案作为基础档案，memoryMode 选择额外补充来源。
// 这里只同步界面和隐藏 select；保存仍沿用 settings.js 的原有流程。
(function () {
    'use strict';

    const MODE_META = {
        journal: {
            label: '结构化档案 + 回忆日记',
            injection: '基础档案：结构化档案；补充来源：已收藏的回忆日记',
            help: '结构化档案在启用并绑定模板后始终进入上下文；这里决定是否额外加入收藏日记。',
            manageId: 'setting-open-journal-memory-btn'
        },
        table: {
            label: '仅结构化档案',
            injection: '基础档案：已绑定模板中的结构化字段；不追加其他长期记忆',
            help: '结构化档案会按表级注入策略与预算进入聊天；实时状态和待办仍由档案 Sidecar 单独提供。',
            manageId: 'setting-open-memory-table-btn'
        },
        vector: {
            label: '结构化档案 + 向量记忆',
            injection: '基础档案：结构化档案；补充来源：与当前对话相关的向量记忆',
            help: '即使选择向量记忆，已绑定的结构化档案仍会进入上下文；向量结果只作为额外补充。',
            manageId: 'setting-open-vector-memory-btn'
        }
    };

    let initialized = false;

    function normalizeMode(value) {
        return MODE_META[value] ? value : 'journal';
    }

    function refreshMemoryModeUI() {
        const select = document.getElementById('setting-memory-mode');
        if (!select) return;

        const mode = normalizeMode(select.value);
        if (select.value !== mode) select.value = mode;
        const meta = MODE_META[mode];

        document.querySelectorAll('[data-setting-memory-mode]').forEach(button => {
            const active = button.dataset.settingMemoryMode === mode;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-checked', active ? 'true' : 'false');
        });

        const current = document.getElementById('setting-memory-mode-current');
        const injection = document.getElementById('setting-memory-mode-injection');
        const help = document.getElementById('setting-memory-mode-help');
        if (current) current.textContent = `当前：${meta.label}`;
        if (injection) injection.textContent = meta.injection;
        if (help) help.textContent = meta.help;

        document.querySelectorAll('.memory-mode-manage-row .btn').forEach(button => {
            button.classList.toggle('is-related-mode', button.id === meta.manageId);
        });
    }

    function setupMemoryModeUI() {
        if (initialized) {
            refreshMemoryModeUI();
            return;
        }

        const select = document.getElementById('setting-memory-mode');
        if (!select) return;
        initialized = true;

        document.querySelectorAll('[data-setting-memory-mode]').forEach(button => {
            button.addEventListener('click', () => {
                select.value = normalizeMode(button.dataset.settingMemoryMode);
                select.dispatchEvent(new Event('change', { bubbles: true }));
                if (typeof triggerHapticFeedback === 'function') triggerHapticFeedback('light');
                refreshMemoryModeUI();
            });
        });

        select.addEventListener('change', refreshMemoryModeUI);

        const journalBtn = document.getElementById('setting-open-journal-memory-btn');
        if (journalBtn) {
            journalBtn.addEventListener('click', () => {
                if (typeof renderJournalList === 'function') renderJournalList();
                if (typeof switchScreen === 'function') switchScreen('memory-journal-screen');
            });
        }

        refreshMemoryModeUI();
    }

    window.setupMemoryModeUI = setupMemoryModeUI;
    window.refreshMemoryModeUI = refreshMemoryModeUI;
})();
