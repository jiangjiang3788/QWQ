(function (global) {
    'use strict';

    const runtime = global.OvoCharacterSettings;
    if (!runtime) throw new Error('OvoCharacterSettings context must load first');

    function setup() {
        let currentWorldBookMode = 'online';

        function renderWorldBookSelectionList() {
            const globalIds = (db.worldBooks || []).filter(wb => wb.isGlobal && !wb.disabled).map(wb => wb.id);
            let displayIds = [];
            if (currentChatType === 'private') {
                const character = db.characters.find(c => c.id === currentChatId);
                if (!character) return;
                const ids = currentWorldBookMode === 'offline' ? (character.offlineWorldBookIds || []) : (character.worldBookIds || []);
                displayIds = [...new Set([...ids, ...globalIds])];
            } else if (currentChatType === 'group') {
                const group = db.groups.find(g => g.id === currentChatId);
                if (!group) return;
                const ids = currentWorldBookMode === 'offline' ? (group.offlineWorldBookIds || []) : (group.worldBookIds || []);
                displayIds = [...new Set([...ids, ...globalIds])];
            }
            renderCategorizedWorldBookList(document.getElementById('world-book-selection-list'), db.worldBooks, displayIds, 'wb-select');
        }

        document.getElementById('link-world-book-btn')?.addEventListener('click', () => {
            currentWorldBookMode = 'online';
            const tabs = document.querySelectorAll('#world-book-mode-tabs .settings-tab-item');
            tabs.forEach(t => t.classList.remove('active'));
            const onlineTab = document.querySelector('#world-book-mode-tabs .settings-tab-item[data-mode="online"]');
            if (onlineTab) onlineTab.classList.add('active');

            renderWorldBookSelectionList();
            document.getElementById('world-book-selection-modal').classList.add('visible');
        });

        const wbModeTabs = document.querySelectorAll('#world-book-mode-tabs .settings-tab-item');
        wbModeTabs.forEach(tab => {
            tab?.addEventListener('click', () => {
                wbModeTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                currentWorldBookMode = tab.getAttribute('data-mode');
                renderWorldBookSelectionList();
            });
        });

        document.getElementById('save-world-book-selection-btn')?.addEventListener('click', async () => {
            const globalIds = (db.worldBooks || []).filter(wb => wb.isGlobal && !wb.disabled).map(wb => wb.id);
            const selectedIds = Array.from(document.getElementById('world-book-selection-list').querySelectorAll('.item-checkbox:checked')).map(input => input.value);
            const toSave = selectedIds.filter(id => !globalIds.includes(id));
            if (currentChatType === 'private') {
                const character = db.characters.find(c => c.id === currentChatId);
                if (character) {
                    if (currentWorldBookMode === 'offline') {
                        character.offlineWorldBookIds = toSave;
                    } else {
                        character.worldBookIds = toSave;
                    }
                    await saveCharacter(currentChatId);
                }
            } else if (currentChatType === 'group') {
                const group = db.groups.find(g => g.id === currentChatId);
                if (group) {
                    if (currentWorldBookMode === 'offline') {
                        group.offlineWorldBookIds = toSave;
                    } else {
                        group.worldBookIds = toSave;
                    }
                    await saveGroup(currentChatId);
                }
            } else {
                await saveData();
            }
            document.getElementById('world-book-selection-modal').classList.remove('visible');
            showToast('世界书关联已更新');
        });

        const statusPanelSwitch = document.getElementById('setting-status-panel-enabled');
        if (statusPanelSwitch) {
            statusPanelSwitch.addEventListener('change', (e) => {
                triggerHapticFeedback('light');
                const container = document.getElementById('status-panel-settings-container');
                if (container) {
                    if (e.target.checked) {
                        container.style.maxHeight = '5000px';
                        container.style.paddingBottom = '20px';
                    } else {
                        container.style.maxHeight = '0';
                        container.style.paddingBottom = '0';
                    }
                }
            });
        }

        const replyCountSwitch = document.getElementById('setting-reply-count-enabled');
        if (replyCountSwitch) {
            replyCountSwitch.addEventListener('change', (e) => {
                triggerHapticFeedback('light');
                const container = document.getElementById('setting-reply-count-container');
                if (container) {
                    container.style.display = e.target.checked ? 'flex' : 'none';
                }
            });
        }

        const autoJournalSwitch = document.getElementById('setting-auto-journal-enabled');
        if (autoJournalSwitch) {
            autoJournalSwitch.addEventListener('change', async (e) => {
                triggerHapticFeedback('light');
                const container = document.getElementById('setting-auto-journal-interval-container');
                if (container) {
                    container.style.display = e.target.checked ? 'flex' : 'none';
                }

                const chat = db.characters.find(character => character.id === currentChatId);
                if (!chat) return;

                const intervalInput = parseInt(document.getElementById('setting-auto-journal-interval').value, 10);
                chat.autoJournalInterval = (isNaN(intervalInput) || intervalInput < 10) ? 100 : intervalInput;

                if (typeof applyAutoJournalToggleDecision === 'function') {
                    await applyAutoJournalToggleDecision(chat, e.target.checked, { chatType: 'private' });
                } else {
                    chat.autoJournalEnabled = e.target.checked;
                }

                if (typeof saveCharacter === 'function') {
                    await saveCharacter(currentChatId);
                } else {
                    await saveData();
                }
            });
        }

        const autoJournalRetryBtn = document.getElementById('setting-auto-journal-retry-btn');
        if (autoJournalRetryBtn) {
            autoJournalRetryBtn.addEventListener('click', async () => {
                const chat = db.characters.find(character => character.id === currentChatId);
                if (!chat) return;

                const intervalInput = parseInt(document.getElementById('setting-auto-journal-interval').value, 10);
                chat.autoJournalInterval = (isNaN(intervalInput) || intervalInput < 10) ? 100 : intervalInput;

                if (typeof retryAutoJournalForChat === 'function') {
                    await retryAutoJournalForChat(chat, { chatType: 'private' });
                }

                if (typeof saveCharacter === 'function') {
                    await saveCharacter(currentChatId);
                } else {
                    await saveData();
                }
            });
        }

        const summarizeLatestBtn = document.getElementById('setting-summarize-latest-btn');
        if (summarizeLatestBtn) {
            summarizeLatestBtn.addEventListener('click', async () => {
                const chat = db.characters.find(character => character.id === currentChatId);
                if (!chat) return;

                const intervalInput = parseInt(document.getElementById('setting-auto-journal-interval').value, 10);
                chat.autoJournalInterval = (isNaN(intervalInput) || intervalInput < 10) ? 100 : intervalInput;

                if (typeof getAutoJournalCursorInfo !== 'function' || typeof askSummarizeLatestOptions !== 'function' || typeof summarizeUntilLatest !== 'function') {
                    return;
                }

                const info = getAutoJournalCursorInfo(chat);
                if (info.unsummarizedCount <= 0) {
                    showToast('当前没有新增消息需要总结');
                    return;
                }

                const choice = await askSummarizeLatestOptions(info);
                if (!choice) return;

                await summarizeUntilLatest(chat, {
                    chatType: 'private',
                    mode: choice.mode,
                    splitSize: choice.splitSize,
                    includeRemainder: choice.includeRemainder
                });

                if (typeof saveCharacter === 'function') {
                    await saveCharacter(currentChatId);
                } else {
                    await saveData();
                }
            });
        }

        const autoJournalIntervalInputEl = document.getElementById('setting-auto-journal-interval');
        if (autoJournalIntervalInputEl) {
            autoJournalIntervalInputEl.addEventListener('blur', async () => {
                const chat = db.characters.find(character => character.id === currentChatId);
                if (!chat) return;

                const intervalInput = parseInt(autoJournalIntervalInputEl.value, 10);
                chat.autoJournalInterval = (isNaN(intervalInput) || intervalInput < 10) ? 100 : intervalInput;

                if (typeof refreshAutoJournalButton === 'function') {
                    refreshAutoJournalButton(chat, 'private');
                }

                if (typeof saveCharacter === 'function') {
                    await saveCharacter(currentChatId);
                } else {
                    await saveData();
                }
            });
        }

        const charAwareUserFavoritesEl = document.getElementById('setting-char-aware-user-favorites');
        if (charAwareUserFavoritesEl) {
            charAwareUserFavoritesEl.addEventListener('change', (e) => {
                triggerHapticFeedback('light');
                const container = document.getElementById('setting-aware-favorite-scope-container');
                if (container) {
                    container.style.display = e.target.checked ? 'block' : 'none';
                }
            });
        }

        const syncGroupMemorySwitch = document.getElementById('setting-sync-group-memory');
        if (syncGroupMemorySwitch) {
            syncGroupMemorySwitch.addEventListener('change', (e) => {
                triggerHapticFeedback('light');
                const historyContainer = document.getElementById('setting-group-memory-container');
                const summaryContainer = document.getElementById('setting-group-summary-container');
                const syncGroupListContainer = document.getElementById('setting-sync-group-list');
                if (historyContainer) {
                    historyContainer.style.display = e.target.checked ? 'flex' : 'none';
                }
                if (summaryContainer) {
                    summaryContainer.style.display = e.target.checked ? 'flex' : 'none';
                }
                if (syncGroupListContainer) {
                    syncGroupListContainer.style.display = e.target.checked ? 'block' : 'none';
                    // 如果开关打开，渲染群聊列表
                    if (e.target.checked) {
                        const character = db.characters.find(c => c.id === currentChatId);
                        if (character) {
                            renderSyncGroupList(character);
                        }
                    }
                }
            });
        }
    }

    function load(e) {
        const themeColorEl = document.getElementById('setting-theme-color');
        if (themeColorEl) themeColorEl.value = e.theme || 'white_pink';
        const maxMemoryEl = document.getElementById('setting-max-memory');
        if (maxMemoryEl) maxMemoryEl.value = e.maxMemory;
        const syncGroupMemoryEl = document.getElementById('setting-sync-group-memory');
        if (syncGroupMemoryEl) syncGroupMemoryEl.checked = e.syncGroupMemory || false;

        // 群聊记忆互通相关设置
        const groupMemoryHistoryCount = e.groupMemoryHistoryCount !== undefined ? e.groupMemoryHistoryCount : 20;
        const groupMemorySummaryCount = e.groupMemorySummaryCount !== undefined ? e.groupMemorySummaryCount : 0;

        const groupJournalFavTopEl = document.getElementById('setting-group-journal-favorite-top');
        if (groupJournalFavTopEl) groupJournalFavTopEl.checked = e.journalFavoriteTop !== false; // 默认开启
        document.getElementById('setting-group-memory-history-count').value = groupMemoryHistoryCount;
        document.getElementById('setting-group-memory-summary-count').value = groupMemorySummaryCount;

        // 根据开关状态显示/隐藏设置项
        const historyContainer = document.getElementById('setting-group-memory-container');
        const summaryContainer = document.getElementById('setting-group-summary-container');
        const syncGroupListContainer = document.getElementById('setting-sync-group-list');

        if (historyContainer) {
            historyContainer.style.display = e.syncGroupMemory ? 'flex' : 'none';
        }
        if (summaryContainer) {
            summaryContainer.style.display = e.syncGroupMemory ? 'flex' : 'none';
        }

        // 渲染群聊选择列表（函数内部会根据开关状态控制显示）
        renderSyncGroupList(e);

        // 确保容器显示状态正确（在渲染后再次确认）
        if (syncGroupListContainer) {
            syncGroupListContainer.style.display = e.syncGroupMemory ? 'block' : 'none';
        }

        document.getElementById('setting-reply-count-enabled').checked = e.replyCountEnabled || false;
        const replyCountContainer = document.getElementById('setting-reply-count-container');
        if (replyCountContainer) {
            replyCountContainer.style.display = e.replyCountEnabled ? 'flex' : 'none';
        }
        document.getElementById('setting-reply-count-min').value = e.replyCountMin || 3;
        document.getElementById('setting-reply-count-max').value = e.replyCountMax || 8;

        const stickerSmartMatchEl = document.getElementById('setting-sticker-smart-match');
        if (stickerSmartMatchEl) stickerSmartMatchEl.checked = e.stickerSmartMatchEnabled || false;

        document.getElementById('setting-auto-journal-enabled').checked = e.autoJournalEnabled || false;
        const memoryModeEl = document.getElementById('setting-memory-mode');
        if (memoryModeEl) memoryModeEl.value = e.memoryMode || 'journal';
        if (typeof refreshMemoryModeUI === 'function') refreshMemoryModeUI();
        const autoJournalIntervalContainer = document.getElementById('setting-auto-journal-interval-container');
        if (autoJournalIntervalContainer) {
            autoJournalIntervalContainer.style.display = e.autoJournalEnabled ? 'flex' : 'none';
        }
        document.getElementById('setting-auto-journal-interval').value = e.autoJournalInterval || 100;
        if (typeof ensureAutoJournalState === 'function') {
            ensureAutoJournalState(e);
        }
        if (typeof refreshAutoJournalButton === 'function') {
            refreshAutoJournalButton(e, 'private');
        }

        const charAutoFavEl = document.getElementById('setting-char-auto-favorite');
        if (charAutoFavEl) charAutoFavEl.checked = e.characterAutoFavoriteEnabled || false;

        const charAwareUserFavoritesEl = document.getElementById('setting-char-aware-user-favorites');
        const awareFavoriteScopeContainer = document.getElementById('setting-aware-favorite-scope-container');
        if (charAwareUserFavoritesEl) {
            charAwareUserFavoritesEl.checked = e.charAwareUserFavorites || false;
            if (awareFavoriteScopeContainer) {
                awareFavoriteScopeContainer.style.display = e.charAwareUserFavorites ? 'block' : 'none';
            }
        }

        const awareScopeCurrent = document.getElementById('setting-aware-favorite-scope-current');
        const awareScopeAll = document.getElementById('setting-aware-favorite-scope-all');
        if (e.awareFavoriteScope === 'all') {
            if (awareScopeAll) awareScopeAll.checked = true;
        } else {
            if (awareScopeCurrent) awareScopeCurrent.checked = true;
        }

        const journalFavTopEl = document.getElementById('setting-journal-favorite-top');
        if (journalFavTopEl) journalFavTopEl.checked = e.journalFavoriteTop !== false; // 默认开启

        document.getElementById('setting-bilingual-mode').checked = e.bilingualModeEnabled || false;
        document.getElementById('setting-bilingual-style').value = e.bilingualBubbleStyle || 'under';

        document.getElementById('setting-avatar-mode').value = e.avatarMode || 'full';
        const avatarRadius = e.avatarRadius !== undefined ? e.avatarRadius : 50;
        document.getElementById('setting-avatar-radius').value = avatarRadius;
        document.getElementById('setting-avatar-radius-value').textContent = `${avatarRadius}%`;

        const radiusSlider = document.getElementById('setting-avatar-radius');
        const radiusValue = document.getElementById('setting-avatar-radius-value');
        radiusSlider.oninput = () => {
            radiusValue.textContent = `${radiusSlider.value}%`;
        };

        // 头像圆角重置按钮
        const resetAvatarRadiusBtn = document.getElementById('reset-avatar-radius-btn');
        if (resetAvatarRadiusBtn) {
            resetAvatarRadiusBtn.onclick = () => {
                radiusSlider.value = 50;
                radiusValue.textContent = '50%';
            };
        }

        document.getElementById('setting-bubble-blur').checked = e.bubbleBlurEnabled !== false; 

        document.getElementById('setting-title-layout').value = e.titleLayout || 'left';
        document.getElementById('setting-show-timestamp').checked = e.showTimestamp || false;
        document.getElementById('setting-timestamp-style').value = e.timestampStyle || 'bubble';
        document.getElementById('setting-timestamp-format').value = e.timestampFormat || 'hm';
        document.getElementById('setting-show-status').checked = e.showStatus !== false;
        document.getElementById('setting-show-status-update-msg').checked = e.showStatusUpdateMsg || false;
        document.getElementById('setting-show-reminder-msg').checked = e.showReminderMsg !== false;

        const useCustomCssCheckbox = document.getElementById('setting-use-custom-css'),
            customCssTextarea = document.getElementById('setting-custom-bubble-css'),
            privatePreviewBox = document.getElementById('private-bubble-css-preview');
        useCustomCssCheckbox.checked = e.useCustomBubbleCss || false;
        customCssTextarea.value = e.customBubbleCss || '';
        customCssTextarea.disabled = !useCustomCssCheckbox.checked;
        const theme = colorThemes[e.theme || 'white_pink'];
        updateBubbleCssPreview(privatePreviewBox, e.customBubbleCss, !e.useCustomBubbleCss, theme);
        populateBubblePresetSelect('bubble-preset-select');
        const allowCharSwitchCssEl = document.getElementById('setting-allow-char-switch-bubble-css');
        const bindingsWrap = document.getElementById('bubble-css-theme-bindings-wrap');
        if (allowCharSwitchCssEl) allowCharSwitchCssEl.checked = !!e.allowCharSwitchBubbleCss;
        if (bindingsWrap) bindingsWrap.style.display = (e.allowCharSwitchBubbleCss ? 'block' : 'none');
        populateBubbleThemeBindingsList(e.bubbleCssThemeBindings || []);
        populateMyPersonaSelect();
        if (typeof populateStatusBarPresetSelect === 'function') {
            populateStatusBarPresetSelect();
        }
    }

    async function save(e) {
        e.theme = document.getElementById('setting-theme-color').value;
        e.maxMemory = document.getElementById('setting-max-memory').value;
        e.syncGroupMemory = document.getElementById('setting-sync-group-memory').checked;
        e.groupMemoryHistoryCount = parseInt(document.getElementById('setting-group-memory-history-count').value, 10) || 20;
        e.groupMemorySummaryCount = parseInt(document.getElementById('setting-group-memory-summary-count').value, 10) || 0;

        // 保存选中的群聊ID列表
        const syncGroupListContainer = document.getElementById('setting-sync-group-list');
        if (syncGroupListContainer && e.syncGroupMemory) {
            const selectedCheckboxes = syncGroupListContainer.querySelectorAll('input[type="checkbox"]:checked');
            e.syncGroupIds = Array.from(selectedCheckboxes).map(cb => cb.value);
        } else {
            e.syncGroupIds = [];
        }

        e.replyCountEnabled = document.getElementById('setting-reply-count-enabled').checked;
        e.replyCountMin = parseInt(document.getElementById('setting-reply-count-min').value, 10) || 3;
        e.replyCountMax = parseInt(document.getElementById('setting-reply-count-max').value, 10) || 8;
        const stickerSmartMatchCb = document.getElementById('setting-sticker-smart-match');
        e.stickerSmartMatchEnabled = stickerSmartMatchCb ? stickerSmartMatchCb.checked : false;

        if (typeof ensureAutoJournalState === 'function') {
            ensureAutoJournalState(e);
        }
        e.autoJournalEnabled = document.getElementById('setting-auto-journal-enabled').checked;
        const memoryModeElSave = document.getElementById('setting-memory-mode');
        e.memoryMode = memoryModeElSave ? memoryModeElSave.value : 'journal';
        if (typeof refreshMemoryModeUI === 'function') refreshMemoryModeUI();
        const autoJournalIntervalInput = parseInt(document.getElementById('setting-auto-journal-interval').value, 10);
        e.autoJournalInterval = (isNaN(autoJournalIntervalInput) || autoJournalIntervalInput < 10) ? 100 : autoJournalIntervalInput;
        const charAutoFavEl = document.getElementById('setting-char-auto-favorite');
        e.characterAutoFavoriteEnabled = charAutoFavEl ? charAutoFavEl.checked : false;

        const charAwareUserFavoritesEl = document.getElementById('setting-char-aware-user-favorites');
        e.charAwareUserFavorites = charAwareUserFavoritesEl ? charAwareUserFavoritesEl.checked : false;

        const awareScopeAll = document.getElementById('setting-aware-favorite-scope-all');
        e.awareFavoriteScope = (awareScopeAll && awareScopeAll.checked) ? 'all' : 'current';

        const journalFavTopEl = document.getElementById('setting-journal-favorite-top');
        if (journalFavTopEl) {
            e.journalFavoriteTop = journalFavTopEl.checked;
        } else if (e.journalFavoriteTop === undefined) {
            e.journalFavoriteTop = true; // 如果元素不存在且未定义过，默认保护为 true
        }

        e.useCustomBubbleCss = document.getElementById('setting-use-custom-css').checked;
        e.customBubbleCss = document.getElementById('setting-custom-bubble-css').value;
        e.allowCharSwitchBubbleCss = document.getElementById('setting-allow-char-switch-bubble-css').checked;
        e.bubbleCssThemeBindings = collectBubbleThemeBindingsFromDOM();
        if (e.allowCharSwitchBubbleCss) {
            const cssTrim = (e.customBubbleCss || '').trim();
            const presets = _getBubblePresets();
            const matched = presets.find(p => p.css && (p.css.trim() === cssTrim));
            e.currentBubbleCssPresetName = matched ? matched.name : '';
        }
        e.bilingualModeEnabled = document.getElementById('setting-bilingual-mode').checked;
        e.bilingualBubbleStyle = document.getElementById('setting-bilingual-style').value;

        e.avatarMode = document.getElementById('setting-avatar-mode').value;
        e.avatarRadius = parseInt(document.getElementById('setting-avatar-radius').value, 10);

        const chatScreen = document.getElementById('chat-room-screen');

        e.bubbleBlurEnabled = document.getElementById('setting-bubble-blur').checked;
        if (e.bubbleBlurEnabled) {
            chatScreen.classList.remove('disable-blur');
        } else {
            chatScreen.classList.add('disable-blur');
        }

        e.titleLayout = document.getElementById('setting-title-layout').value;
        const header = document.getElementById('chat-room-header-default');
        if (e.titleLayout === 'center') {
            header.classList.add('title-centered');
        } else {
            header.classList.remove('title-centered');
        }

        e.showTimestamp = document.getElementById('setting-show-timestamp').checked;

        if (e.showTimestamp) {
            chatScreen.classList.add('show-timestamp');
        } else {
            chatScreen.classList.remove('show-timestamp');
        }
        chatScreen.classList.remove('timestamp-side');

        e.timestampStyle = document.getElementById('setting-timestamp-style').value;
        chatScreen.classList.remove('timestamp-style-bubble', 'timestamp-style-avatar');
        chatScreen.classList.add(`timestamp-style-${e.timestampStyle || 'bubble'}`);

        e.timestampFormat = document.getElementById('setting-timestamp-format').value;

        e.showStatus = document.getElementById('setting-show-status').checked;
        const subtitle = document.getElementById('chat-room-subtitle');
        if (subtitle) {
            subtitle.style.display = e.showStatus ? 'flex' : 'none';
        }

        e.showStatusUpdateMsg = document.getElementById('setting-show-status-update-msg').checked;
        e.showReminderMsg = document.getElementById('setting-show-reminder-msg').checked;

        if (!e.statusPanel) e.statusPanel = {};
        e.statusPanel.enabled = document.getElementById('setting-status-panel-enabled').checked;
        e.statusPanel.promptSuffix = document.getElementById('setting-status-prompt-suffix').value;
        e.statusPanel.regexPattern = document.getElementById('setting-status-regex').value;
        e.statusPanel.replacePattern = document.getElementById('setting-status-replace').value;
        const historyLimitInput = parseInt(document.getElementById('setting-status-history-limit').value, 10);
        e.statusPanel.historyLimit = isNaN(historyLimitInput) ? 3 : historyLimitInput;
    }

    runtime.register('chat', {
        setupOrder: 50,
        loadOrder: 20,
        saveOrder: 20,
        setup,
        load,
        save
    });
})(window);
