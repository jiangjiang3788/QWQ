(function (global) {
    'use strict';

    const runtime = global.OvoCharacterSettings;
    if (!runtime) throw new Error('OvoCharacterSettings context must load first');

    function setup() {
        const useCustomCssCheckbox = document.getElementById('setting-use-custom-css'),
            customCssTextarea = document.getElementById('setting-custom-bubble-css'),
            resetCustomCssBtn = document.getElementById('reset-custom-bubble-css-btn'),
            privatePreviewBox = document.getElementById('private-bubble-css-preview');

        useCustomCssCheckbox?.addEventListener('change', (e) => {
            triggerHapticFeedback('light');
            if (customCssTextarea) customCssTextarea.disabled = !e.target.checked;
            const char = db.characters.find(c => c.id === currentChatId);
            if (char) {
                const themeKey = char.theme || 'white_pink';
                const theme = colorThemes[themeKey];
                updateBubbleCssPreview(privatePreviewBox, customCssTextarea ? customCssTextarea.value : '', !e.target.checked, theme);
            }
        });

        customCssTextarea?.addEventListener('input', (e) => {
            const char = db.characters.find(c => c.id === currentChatId);
            if (char && useCustomCssCheckbox && useCustomCssCheckbox.checked) {
                const themeKey = char.theme || 'white_pink';
                const theme = colorThemes[themeKey];
                updateBubbleCssPreview(privatePreviewBox, e.target.value, false, theme);
            }
        });

        resetCustomCssBtn?.addEventListener('click', () => {
            const char = db.characters.find(c => c.id === currentChatId);
            if (char) {
                customCssTextarea.value = '';
                useCustomCssCheckbox.checked = false;
                customCssTextarea.disabled = true;
                const themeKey = char.theme || 'white_pink';
                const theme = colorThemes[themeKey];
                updateBubbleCssPreview(privatePreviewBox, '', true, theme);
                showToast('样式已重置为默认');
            }
        });

        document.getElementById('setting-char-avatar-upload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    const compressedUrl = await compressImage(file, {quality: 0.8, maxWidth: 400, maxHeight: 400});
                    document.getElementById('setting-char-avatar-preview').src = compressedUrl;
                } catch (error) {
                    showToast('头像压缩失败，请重试');
                }
            }
        });

        document.getElementById('setting-my-avatar-upload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const char = db.characters.find(c => c.id === currentChatId);
            if (!char) return;
            try {
                const compressedUrl = await compressImage(file, {quality: 0.8, maxWidth: 400, maxHeight: 400});
                const oldMyAvatar = char.myAvatar;
                if (oldMyAvatar && compressedUrl !== oldMyAvatar && window.AvatarSystem && char.charSenseAvatarChangeEnabled) {
                    showToast('正在识别头像变化…');
                    await window.AvatarSystem.recognizeAndNotifyUserAvatarChange(currentChatId, oldMyAvatar, compressedUrl);
                }
                char.myAvatar = compressedUrl;
                await saveCharacter(currentChatId);
                document.getElementById('setting-my-avatar-preview').src = compressedUrl;
                showToast('我的头像已更新');
                if (typeof renderMessages === 'function') renderMessages(false, true);
            } catch (error) {
                showToast('头像压缩失败，请重试');
            }
            e.target.value = '';
        });

        const avatarLibraryBtn = document.getElementById('setting-avatar-library-btn');
        if (avatarLibraryBtn && window.AvatarSystem) {
            avatarLibraryBtn?.addEventListener('click', () => window.AvatarSystem.openAvatarLibraryModal(currentChatId));
        }
        const charAvatarLibraryBtn = document.getElementById('setting-char-avatar-library-btn');
        if (charAvatarLibraryBtn && window.AvatarSystem) {
            charAvatarLibraryBtn?.addEventListener('click', () => window.AvatarSystem.openCharAvatarLibraryModal(currentChatId));
        }
        const coupleAvatarLibraryBtn = document.getElementById('setting-couple-avatar-library-btn');
        if (coupleAvatarLibraryBtn && window.AvatarSystem) {
            coupleAvatarLibraryBtn?.addEventListener('click', () => window.AvatarSystem.openCoupleAvatarLibraryModal(currentChatId));
        }

        (function initAvatarRecognitionDetailModal() {
            const row = document.getElementById('setting-avatar-recognition-detail-row');
            const displaySpan = document.getElementById('avatar-recognition-detail-display');
            const modal = document.getElementById('avatar-recognition-detail-modal');
            const radios = document.querySelectorAll('input[name="ar-detail-level"]');
            const customContainer = document.getElementById('ar-custom-words-container');
            const customInput = document.getElementById('ar-custom-words-input');
            const cancelBtn = document.getElementById('ar-detail-cancel-btn');
            const confirmBtn = document.getElementById('ar-detail-confirm-btn');

            function getDisplayText() {
                const val = db.avatarRecognitionDetailLevel;
                if (val === 'brief') return '简洁（10-20字）';
                if (val === 'standard') return '标准（30-50字）';
                if (val === 'detailed' || !val) return '详细（不限）';
                const n = typeof val === 'number' ? val : parseInt(val, 10);
                return (!isNaN(n) && n > 0) ? '自定义（' + n + '字）' : '详细（不限）';
            }

            function updateDisplay() {
                if (displaySpan) displaySpan.textContent = getDisplayText();
            }

            if (row && modal) {
                row?.addEventListener('click', function () {
                    const val = db.avatarRecognitionDetailLevel;
                    const isNum = typeof val === 'number' || (typeof val === 'string' && /^\d+$/.test(val));
                    if (isNum) {
                        const n = typeof val === 'number' ? val : parseInt(val, 10);
                        customInput.value = isNaN(n) ? '' : n;
                        customContainer.style.display = '';
                        const customRadio = document.querySelector('input[name="ar-detail-level"][value="custom"]');
                        if (customRadio) customRadio.checked = true;
                        radios.forEach(function (r) { if (r.value !== 'custom') r.checked = false; });
                    } else {
                        const v = (val === 'brief' || val === 'standard' || val === 'detailed') ? val : 'detailed';
                        radios.forEach(function (r) { r.checked = (r.value === v); });
                        customContainer.style.display = 'none';
                    }
                    modal.classList.add('visible');
                });
            }

            radios.forEach(function (r) {
                r?.addEventListener('change', function () {
                    customContainer.style.display = this.value === 'custom' ? '' : 'none';
                });
            });

            if (cancelBtn) cancelBtn?.addEventListener('click', function () { modal.classList.remove('visible'); });
            if (confirmBtn) confirmBtn?.addEventListener('click', function () {
                const checked = document.querySelector('input[name="ar-detail-level"]:checked');
                if (checked && checked.value === 'custom' && customInput) {
                    const n = parseInt(customInput.value, 10);
                    db.avatarRecognitionDetailLevel = (!isNaN(n) && n > 0) ? Math.min(500, Math.max(5, n)) : 50;
                } else if (checked) {
                    db.avatarRecognitionDetailLevel = checked.value;
                }
                if (typeof saveGlobalSettings === 'function') saveGlobalSettings();
                updateDisplay();
                modal.classList.remove('visible');
            });
            modal?.addEventListener('click', function (e) { if (e.target === modal) modal.classList.remove('visible'); });

            updateDisplay();
        })();

        document.getElementById('setting-chat-bg-upload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                const char = db.characters.find(c => c.id === currentChatId);
                if (char) {
                    try {
                        const compressedUrl = await compressImage(file, {
                            quality: 0.85,
                            maxWidth: 1080,
                            maxHeight: 1920
                        });
                        char.chatBg = compressedUrl;
                        chatRoomScreen.style.backgroundImage = `url(${compressedUrl})`;
                        await saveCharacter(currentChatId);
                        showToast('聊天背景已更换');
                    } catch (error) {
                        showToast('背景压缩失败，请重试');
                    }
                }
            }
        });

        document.getElementById('reset-chat-bg-btn')?.addEventListener('click', async () => {
            const char = db.characters.find(c => c.id === currentChatId);
            if (!char) return;
            char.chatBg = '';
            chatRoomScreen.style.backgroundImage = 'none';
            await saveCharacter(currentChatId);
            showToast('已恢复默认背景');
        });

        document.getElementById('setting-call-bg-upload')?.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                const char = db.characters.find(c => c.id === currentChatId);
                if (char) {
                    try {
                        const compressedUrl = await compressImage(file, {
                            quality: 0.85,
                            maxWidth: 1080,
                            maxHeight: 1920
                        });
                        char.callWallpaper = compressedUrl;
                        await saveCharacter(currentChatId);
                        showToast('通话背景已更换');
                    } catch (error) {
                        showToast('背景压缩失败，请重试');
                    }
                }
            }
        });

        document.getElementById('reset-call-bg-btn')?.addEventListener('click', async () => {
            const char = db.characters.find(c => c.id === currentChatId);
            if (!char) return;
            char.callWallpaper = '';
            await saveCharacter(currentChatId);
            showToast('已恢复默认通话背景');
        });
    }

    function load(e) {
        document.getElementById('setting-avatar-system-enabled').checked = e.avatarSystemEnabled || false;
        document.getElementById('setting-char-sense-avatar-change').checked = e.charSenseAvatarChangeEnabled === true;
        const arDisplaySpan = document.getElementById('avatar-recognition-detail-display');
        if (arDisplaySpan) {
            const val = db.avatarRecognitionDetailLevel;
            if (val === 'brief') arDisplaySpan.textContent = '简洁（10-20字）';
            else if (val === 'standard') arDisplaySpan.textContent = '标准（30-50字）';
            else if (val === 'detailed' || !val) arDisplaySpan.textContent = '详细（不限）';
            else {
                const n = typeof val === 'number' ? val : parseInt(val, 10);
                arDisplaySpan.textContent = (!isNaN(n) && n > 0) ? '自定义（' + n + '字）' : '详细（不限）';
            }
        }
        document.getElementById('setting-show-avatar-action-msg').checked = e.showAvatarActionMsg || false;
        const charCanSwitchEl = document.getElementById('setting-char-can-switch-avatar');
        if (charCanSwitchEl) charCanSwitchEl.checked = e.charCanSwitchAvatarEnabled === true;
        const charCollectEl = document.getElementById('setting-char-collect-image-as-avatar');
        if (charCollectEl) charCollectEl.checked = e.charCollectImageAsAvatarEnabled === true;
        const charCollectCoupleEl = document.getElementById('setting-char-collect-couple-avatar');
        if (charCollectCoupleEl) charCollectCoupleEl.checked = e.charCollectCoupleAvatarEnabled === true;
        const charSenseCoupleEl = document.getElementById('setting-char-sense-couple-avatar');
        if (charSenseCoupleEl) charSenseCoupleEl.checked = e.charSenseCoupleAvatarEnabled === true;
        document.getElementById('setting-char-reminder-enabled').checked = e.charReminderEnabled || false;

        // === 加载 NovelAI 生图设置（模型/尺寸/画师串）到拓展 Tab ===
        if (db.novelAiSettings) {
            const ns = db.novelAiSettings;
            const naiModelEl = document.getElementById('novelai-model');
            const naiResEl = document.getElementById('novelai-resolution');
            const naiArtistEl = document.getElementById('novelai-artist-tags');
            if (naiModelEl && ns.model) naiModelEl.value = ns.model;
            if (naiResEl && ns.resolution) naiResEl.value = ns.resolution;
            if (naiArtistEl && ns.artistTags !== undefined) naiArtistEl.value = ns.artistTags;
        }

        // === 加载 GPT 专属画师串到拓展 Tab ===
        const gptArtistEl = document.getElementById('gpt-artist-prompt');
        if (gptArtistEl) {
            gptArtistEl.value = e.gptArtistPrompt || '';
        }

        // === 加载 TTS 配置 ===
        if (typeof TTSSettings !== 'undefined' && TTSSettings.loadChatTTSConfig) {
            TTSSettings.loadChatTTSConfig(currentChatId);
        }
    }

    async function save(e) {
        e.avatarSystemEnabled = document.getElementById('setting-avatar-system-enabled').checked;
        e.charSenseAvatarChangeEnabled = document.getElementById('setting-char-sense-avatar-change').checked;
        const charCanSwitchInput = document.getElementById('setting-char-can-switch-avatar');
        e.charCanSwitchAvatarEnabled = charCanSwitchInput ? charCanSwitchInput.checked : false;
        const charCollectInput = document.getElementById('setting-char-collect-image-as-avatar');
        e.charCollectImageAsAvatarEnabled = charCollectInput ? charCollectInput.checked : false;
        const charCollectCoupleInput = document.getElementById('setting-char-collect-couple-avatar');
        e.charCollectCoupleAvatarEnabled = charCollectCoupleInput ? charCollectCoupleInput.checked : false;
        const charSenseCoupleInput = document.getElementById('setting-char-sense-couple-avatar');
        e.charSenseCoupleAvatarEnabled = charSenseCoupleInput ? charSenseCoupleInput.checked : false;
        e.showAvatarActionMsg = document.getElementById('setting-show-avatar-action-msg').checked;
        e.charReminderEnabled = document.getElementById('setting-char-reminder-enabled').checked;

        // === 保存 NovelAI 生图设置（模型/尺寸/画师串）回 db.novelAiSettings ===
        {
            const naiModelEl = document.getElementById('novelai-model');
            const naiResEl = document.getElementById('novelai-resolution');
            const naiArtistEl = document.getElementById('novelai-artist-tags');
            if (!db.novelAiSettings) db.novelAiSettings = {};
            if (naiModelEl) db.novelAiSettings.model = naiModelEl.value;
            if (naiResEl) db.novelAiSettings.resolution = naiResEl.value;
            if (naiArtistEl) db.novelAiSettings.artistTags = naiArtistEl.value.trim();
        }

        // === 保存 GPT 专属画师串 ===
        const gptArtistEl = document.getElementById('gpt-artist-prompt');
        if (gptArtistEl) {
            e.gptArtistPrompt = gptArtistEl.value.trim();
        }
    }

    runtime.register('media', {
        setupOrder: 20,
        loadOrder: 40,
        saveOrder: 40,
        setup,
        load,
        save
    });
})(window);
