// 长期记忆模式 UI：把底层 memoryMode(journal/table/vector) 明确显示为“三选一”。
// 这里只同步界面和隐藏 select；保存仍沿用 settings.js 的原有流程。
(function () {
    'use strict';

    const MODE_META = {
        journal: {
            label: '回忆日记',
            injection: '聊天将注入：已收藏的回忆日记',
            help: '自动生成日记只负责创建日记；只有选择“回忆日记”时，收藏日记才作为长期记忆进入聊天。',
            manageId: 'setting-open-journal-memory-btn'
        },
        table: {
            label: '结构化档案',
            injection: '聊天将注入：已绑定模板中的结构化字段',
            help: '结构化档案是长期记忆模式；聊天快照存档是备份/回档功能，两者不是同一个东西。',
            manageId: 'setting-open-memory-table-btn'
        },
        vector: {
            label: '向量记忆',
            injection: '聊天将注入：与当前对话最相关的向量记忆',
            help: '向量自动总结负责生成条目；选择“向量记忆”后，真实聊天才会执行检索并注入结果。',
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
