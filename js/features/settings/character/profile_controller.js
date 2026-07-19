(function (global) {
    'use strict';

    const runtime = global.OvoCharacterSettings;
    if (!runtime) throw new Error('OvoCharacterSettings context must load first');

    function setup() {
        const themeSelect = document.getElementById('setting-theme-color');
        themeSelect.innerHTML = '';
        Object.keys(colorThemes).forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = colorThemes[key].name;
            themeSelect.appendChild(option);
        });

        document.getElementById('chat-settings-btn')?.addEventListener('click', () => {
            if (currentChatType === 'private') {
                loadSettingsToSidebar();
                switchScreen('chat-settings-screen');
            } else if (currentChatType === 'group') {
                loadGroupSettingsToSidebar();
                switchScreen('group-settings-screen');
            }
        });

        const moreSettingsBtn = document.getElementById('more-settings-btn');
        if (moreSettingsBtn) {
            moreSettingsBtn.addEventListener('click', () => {
                switchScreen('api-settings-screen');
            });
        }

        document.querySelector('.phone-screen')?.addEventListener('click', e => {
            const openSidebar = document.querySelector('.settings-sidebar.open');
            if (openSidebar && !openSidebar.contains(e.target) && !e.target.closest('.action-btn') && !e.target.closest('.modal-overlay') && !e.target.closest('.action-sheet-overlay')) {
                openSidebar.classList.remove('open');
            }
        });

        document.getElementById('chat-settings-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveSettingsFromSidebar();
        });

        document.getElementById('chat-scroll-to-top-current-btn')?.addEventListener('click', () => {
            switchScreen('chat-room-screen');
            setTimeout(() => {
                const area = document.getElementById('message-area');
                if (area) area.scrollTop = 0;
            }, 80);
        });
        document.getElementById('chat-scroll-to-top-all-btn')?.addEventListener('click', () => {
            switchScreen('chat-room-screen');
            setTimeout(() => {
                const chat = (typeof currentChatType !== 'undefined' && currentChatType === 'private')
                    ? db.characters.find(c => c.id === currentChatId)
                    : db.groups.find(g => g.id === currentChatId);
                if (chat && chat.history && chat.history.length > 0 && typeof renderMessages === 'function') {
                    const pageSize = (typeof MESSAGES_PER_PAGE !== 'undefined') ? MESSAGES_PER_PAGE : 50;
                    currentPage = Math.ceil(chat.history.length / pageSize) || 1;
                    renderMessages(false, false);
                    const area = document.getElementById('message-area');
                    if (area) area.scrollTop = 0;
                }
            }, 80);
        });
        document.getElementById('chat-scroll-to-bottom-btn')?.addEventListener('click', () => {
            switchScreen('chat-room-screen');
            setTimeout(() => {
                const area = document.getElementById('message-area');
                if (area) area.scrollTop = area.scrollHeight;
            }, 80);
        });

        const scrollToTopOrBottomGroup = (mode) => {
            switchScreen('chat-room-screen');
            setTimeout(() => {
                const area = document.getElementById('message-area');
                if (!area) return;
                if (mode === 'bottom') {
                    area.scrollTop = area.scrollHeight;
                    return;
                }
                if (mode === 'topAll') {
                    const chat = (typeof currentChatType !== 'undefined' && currentChatType === 'group')
                        ? db.groups.find(g => g.id === currentChatId)
                        : db.characters.find(c => c.id === currentChatId);
                    if (chat && chat.history && chat.history.length > 0 && typeof renderMessages === 'function') {
                        const pageSize = (typeof MESSAGES_PER_PAGE !== 'undefined') ? MESSAGES_PER_PAGE : 50;
                        currentPage = Math.ceil(chat.history.length / pageSize) || 1;
                        renderMessages(false, false);
                        area.scrollTop = 0;
                    }
                } else {
                    area.scrollTop = 0;
                }
            }, 80);
        };
        const groupTopCurrentBtn = document.getElementById('group-chat-scroll-to-top-current-btn');
        const groupTopAllBtn = document.getElementById('group-chat-scroll-to-top-all-btn');
        const groupBottomBtn = document.getElementById('group-chat-scroll-to-bottom-btn');
        if (groupTopCurrentBtn) groupTopCurrentBtn.addEventListener('click', () => scrollToTopOrBottomGroup('topCurrent'));
        if (groupTopAllBtn) groupTopAllBtn.addEventListener('click', () => scrollToTopOrBottomGroup('topAll'));
        if (groupBottomBtn) groupBottomBtn.addEventListener('click', () => scrollToTopOrBottomGroup('bottom'));

        // --- Tab 切换逻辑 ---
        // 仅选择聊天设置和群聊设置中的 Tab，排除 CoT 设置
        const tabs = document.querySelectorAll('#chat-settings-screen .settings-tab-item, #group-settings-screen .settings-tab-item');
        const contents = document.querySelectorAll('.settings-tab-content');

        tabs.forEach(tab => {
            tab?.addEventListener('click', () => {
                // 移除所有 active 类
                tabs.forEach(t => t.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));

                // 添加当前 active 类
                tab.classList.add('active');
                const targetId = tab.getAttribute('data-tab');
                if (targetId) {
                    const targetEl = document.getElementById(targetId);
                    if (targetEl) targetEl.classList.add('active');
                }
                // 从拓展 Tab 切走时关闭「头像识别系统」子页，避免再切回拓展时还停在子页
                const avatarPanel = document.getElementById('setting-avatar-system-panel');
                const extTab = document.getElementById('setting-tab-ext');
                if (avatarPanel) avatarPanel.style.display = 'none';
                if (extTab) extTab.style.display = '';
            });
        });

        // 头像识别系统：拓展 Tab 内一行入口，点击进入子页面
        const avatarSystemEntry = document.getElementById('setting-avatar-system-entry');
        const avatarSystemPanel = document.getElementById('setting-avatar-system-panel');
        const avatarSystemBack = document.getElementById('setting-avatar-system-back');
        if (avatarSystemEntry && avatarSystemPanel) {
            avatarSystemEntry?.addEventListener('click', () => {
                if (document.getElementById('setting-tab-ext')) document.getElementById('setting-tab-ext').style.display = 'none';
                avatarSystemPanel.style.display = 'block';
            });
        }
        if (avatarSystemBack && avatarSystemPanel) {
            avatarSystemBack?.addEventListener('click', () => {
                avatarSystemPanel.style.display = 'none';
                if (document.getElementById('setting-tab-ext')) document.getElementById('setting-tab-ext').style.display = '';
            });
        }
    }

    function load(e) {
        const avatarPreviewEl = document.getElementById('setting-char-avatar-preview');
        if (avatarPreviewEl) {
            avatarPreviewEl.src = e.avatar;
        }
        const nameDisplay = document.getElementById('setting-char-name-display');
        if(nameDisplay) nameDisplay.textContent = e.remarkName;
        const realNameEl = document.getElementById('setting-char-real-name');
        if (realNameEl) realNameEl.value = e.realName || '';

        const birthdayEl = document.getElementById('setting-char-birthday');
        if (birthdayEl) birthdayEl.value = e.birthday || '';

        const enableDynamicAgeEl = document.getElementById('setting-char-enable-dynamic-age');
        if (enableDynamicAgeEl) enableDynamicAgeEl.checked = e.enableDynamicAge || false;

        document.getElementById('setting-char-remark').value = e.remarkName;

        const timezoneEl = document.getElementById('setting-char-timezone');
        const timezonePresetEl = document.getElementById('setting-char-timezone-preset');
        if (timezoneEl) timezoneEl.value = e.charTimezone || '';
        if (timezonePresetEl) {
            timezonePresetEl.value = '';
            timezonePresetEl.onchange = function() {
                if (this.value && timezoneEl) timezoneEl.value = this.value;
            };
        }

        const enableDynamicTimezoneEl = document.getElementById('setting-char-enable-dynamic-timezone');
        if (enableDynamicTimezoneEl) enableDynamicTimezoneEl.checked = e.enableDynamicTimezone || false;

        const customPromptPresetEl = document.getElementById('setting-char-custom-prompt-preset');
        if (customPromptPresetEl) {
            customPromptPresetEl.innerHTML = '<option value="">跟随全局设置</option>';
            if (db.magicRoom && db.magicRoom.presets) {
                db.magicRoom.presets.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.name;
                    opt.textContent = p.name;
                    customPromptPresetEl.appendChild(opt);
                });
            }
            customPromptPresetEl.value = e.customPromptPreset || '';
        }

        document.getElementById('setting-char-persona').value = e.persona;
        const stickerGroupsContainer = document.getElementById('setting-char-sticker-groups-container');
        stickerGroupsContainer.innerHTML = '';

        const allGroups = [...new Set(db.myStickers.map(s => s.group || '未分类'))].filter(g => g);
        const charGroups = (e.stickerGroups || '').split(/[,，]/).map(s => s.trim());

        const stickerDescEnabledEl = document.getElementById('setting-char-sticker-description-enabled');
        if (stickerDescEnabledEl) {
            stickerDescEnabledEl.checked = e.stickerDescriptionEnabled || false;
        }

        if (allGroups.length === 0) {
            stickerGroupsContainer.innerHTML = '<span style="color:#999; font-size:12px;">暂无表情包分组，请先在表情包管理中添加。</span>';
        } else {
            allGroups.forEach(group => {
                const tag = document.createElement('div');
                tag.className = 'sticker-group-tag';
                if (charGroups.includes(group)) {
                    tag.classList.add('selected');
                }
                tag.textContent = group;
                tag.dataset.group = group;

                tag.addEventListener('click', () => {
                    tag.classList.toggle('selected');
                });

                stickerGroupsContainer.appendChild(tag);
            });
        }

        {
            const myAvatarPreviewEl = document.getElementById('setting-my-avatar-preview');
            if (myAvatarPreviewEl) myAvatarPreviewEl.src = e.myAvatar || 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg';
            const myNameEl = document.getElementById('setting-my-name');
            if (myNameEl) myNameEl.value = e.myName || '';
            const myPersonaEl = document.getElementById('setting-my-persona');
            if (myPersonaEl) myPersonaEl.value = e.myPersona || '';

            const myBirthdayEl = document.getElementById('setting-my-birthday');
            if (myBirthdayEl) myBirthdayEl.value = e.myBirthday || '';
            const myEnableDynamicAgeEl = document.getElementById('setting-my-enable-dynamic-age');
            if (myEnableDynamicAgeEl) myEnableDynamicAgeEl.checked = e.myEnableDynamicAge || false;

            const myEnableDynamicTimezoneEl = document.getElementById('setting-my-enable-dynamic-timezone');
            if (myEnableDynamicTimezoneEl) myEnableDynamicTimezoneEl.checked = e.myEnableDynamicTimezone || false;
            const myTimezoneEl = document.getElementById('setting-my-timezone');
            const myTimezonePresetEl = document.getElementById('setting-my-timezone-preset');
            if (myTimezoneEl) myTimezoneEl.value = e.myTimezone || '';
            if (myTimezonePresetEl) {
                myTimezonePresetEl.value = '';
                myTimezonePresetEl.onchange = function() {
                    if (this.value && myTimezoneEl) myTimezoneEl.value = this.value;
                };
            }
        }
    }

    async function save(e) {
        const avatarPreviewEl = document.getElementById('setting-char-avatar-preview');
        if (avatarPreviewEl) {
            e.avatar = avatarPreviewEl.src;
        }
        const realNameInput = document.getElementById('setting-char-real-name');
        if (realNameInput) e.realName = (realNameInput.value || '').trim();

        const birthdayInput = document.getElementById('setting-char-birthday');
        if (birthdayInput) e.birthday = (birthdayInput.value || '').trim();

        const enableDynamicAgeInput = document.getElementById('setting-char-enable-dynamic-age');
        if (enableDynamicAgeInput) e.enableDynamicAge = enableDynamicAgeInput.checked;

        e.remarkName = document.getElementById('setting-char-remark').value;

        const timezoneInput = document.getElementById('setting-char-timezone');
        const timezonePresetEl = document.getElementById('setting-char-timezone-preset');
        if (timezoneInput) {
            e.charTimezone = (timezoneInput.value || '').trim();
            if (timezonePresetEl && timezonePresetEl.value && !timezoneInput.value) {
                e.charTimezone = timezonePresetEl.value;
            }
        }

        const enableDynamicTimezoneInput = document.getElementById('setting-char-enable-dynamic-timezone');
        if (enableDynamicTimezoneInput) e.enableDynamicTimezone = enableDynamicTimezoneInput.checked;

        const customPromptPresetInput = document.getElementById('setting-char-custom-prompt-preset');
        if (customPromptPresetInput) e.customPromptPreset = customPromptPresetInput.value;

        e.persona = document.getElementById('setting-char-persona').value;
        const selectedGroups = Array.from(document.querySelectorAll('#setting-char-sticker-groups-container .sticker-group-tag.selected'))
            .map(tag => tag.dataset.group)
            .join(',');
        e.stickerGroups = selectedGroups;

        const stickerDescEnabledEl = document.getElementById('setting-char-sticker-description-enabled');
        if (stickerDescEnabledEl) {
            e.stickerDescriptionEnabled = stickerDescEnabledEl.checked;
        }

        // 头像系统：有头像变动则识别（含缓存）并系统通知
        const myAvatarPreviewEl = document.getElementById('setting-my-avatar-preview');
        const _newMyAvatar = myAvatarPreviewEl ? myAvatarPreviewEl.src : e.myAvatar;
        if (window.AvatarSystem && e.charSenseAvatarChangeEnabled && e.myAvatar && _newMyAvatar !== e.myAvatar) {
            await window.AvatarSystem.recognizeAndNotifyUserAvatarChange(currentChatId, e.myAvatar, _newMyAvatar);
        }
        e.myAvatar = _newMyAvatar;
        e.myName = document.getElementById('setting-my-name').value;
        e.myPersona = document.getElementById('setting-my-persona').value;

        const myBirthdayInput = document.getElementById('setting-my-birthday');
        if (myBirthdayInput) e.myBirthday = (myBirthdayInput.value || '').trim();
        const myEnableDynamicAgeInput = document.getElementById('setting-my-enable-dynamic-age');
        if (myEnableDynamicAgeInput) e.myEnableDynamicAge = myEnableDynamicAgeInput.checked;

        const myEnableDynamicTimezoneInput = document.getElementById('setting-my-enable-dynamic-timezone');
        if (myEnableDynamicTimezoneInput) e.myEnableDynamicTimezone = myEnableDynamicTimezoneInput.checked;

        const myTimezoneInput = document.getElementById('setting-my-timezone');
        const myTimezonePresetEl = document.getElementById('setting-my-timezone-preset');
        if (myTimezoneInput) {
            e.myTimezone = (myTimezoneInput.value || '').trim();
            if (myTimezonePresetEl && myTimezonePresetEl.value && !myTimezoneInput.value) {
                e.myTimezone = myTimezonePresetEl.value;
            }
        }
    }

    runtime.register('profile', {
        setupOrder: 10,
        loadOrder: 10,
        saveOrder: 10,
        setup,
        load,
        save
    });
})(window);
