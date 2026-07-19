// V2.9-R4 设置模块：预设、壁纸、音色、图标与名称
function _getBubblePresets() {
    return db.bubbleCssPresets || [];
}
function _saveBubblePresets(arr) {
    db.bubbleCssPresets = arr || [];
    saveData();
}

function populateBubblePresetSelect(selectId) { 
    const sel = document.getElementById(selectId); 
    if (!sel) return;
    const presets = _getBubblePresets();
    sel.innerHTML = '<option value="">— 选择预设 —</option>';
    presets.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
}

function populateBubbleThemeBindingsList(bindings) {
    const listEl = document.getElementById('bubble-css-theme-bindings-list');
    const emptyEl = document.getElementById('bubble-css-theme-bindings-empty');
    if (!listEl || !emptyEl) return;
    listEl.innerHTML = '';
    const presets = _getBubblePresets();
    if (!bindings || bindings.length === 0) {
        listEl.style.display = 'none';
        emptyEl.style.display = 'block';
        return;
    }
    listEl.style.display = 'block';
    emptyEl.style.display = 'none';
    bindings.forEach((b, idx) => {
        const row = document.createElement('div');
        row.className = 'bubble-theme-binding-row';
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-color,#eee);';
        row.dataset.presetName = b.presetName;
        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = 'min-width:100px;font-weight:500;color:var(--text-color,#333);';
        nameSpan.textContent = b.presetName;
        const descInput = document.createElement('input');
        descInput.type = 'text';
        descInput.placeholder = '选填描述';
        descInput.value = b.description || '';
        descInput.style.cssText = 'flex:1;padding:6px 8px;border-radius:6px;border:1px solid var(--border-color,#eee);font-size:13px;';
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-small';
        delBtn.style.cssText = 'padding:4px 8px;border-radius:6px;color:#c62828;';
        delBtn.textContent = '移除';
        delBtn.addEventListener('click', () => {
            const char = db.characters.find(c => c.id === currentChatId);
            if (!char) return;
            if (!Array.isArray(char.bubbleCssThemeBindings)) char.bubbleCssThemeBindings = [];
            const i = char.bubbleCssThemeBindings.findIndex(x => x.presetName === b.presetName);
            if (i >= 0) char.bubbleCssThemeBindings.splice(i, 1);
            populateBubbleThemeBindingsList(char.bubbleCssThemeBindings);
        });
        row.appendChild(nameSpan);
        row.appendChild(descInput);
        row.appendChild(delBtn);
        listEl.appendChild(row);
    });
}

function collectBubbleThemeBindingsFromDOM() {
    const listEl = document.getElementById('bubble-css-theme-bindings-list');
    if (!listEl) return [];
    const rows = listEl.querySelectorAll('.bubble-theme-binding-row');
    return Array.from(rows).map(row => ({
        presetName: row.dataset.presetName || '',
        description: (row.querySelector('input') && row.querySelector('input').value) ? row.querySelector('input').value.trim() : ''
    })).filter(b => b.presetName);
}

async function applyPresetToCurrentChat(presetName) {
    const presets = _getBubblePresets();
    const preset = presets.find(p => p.name === presetName);
    if (!preset) { showToast('未找到该预设'); return; }
    
    let textarea;
    if (currentChatType === 'private') {
        textarea = document.getElementById('setting-custom-bubble-css');
    } else {
        textarea = document.getElementById('setting-group-custom-bubble-css');
    }
    if (textarea) textarea.value = preset.css;

    try {
        const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
        if (chat) {
            chat.customBubbleCss = preset.css;
            chat.useCustomBubbleCss = true;
            if (currentChatType === 'private') {
                chat.currentBubbleCssPresetName = presetName;
                chat.themeJustChangedByUser = presetName;
            }
            if (currentChatType === 'private') {
                document.getElementById('setting-use-custom-css').checked = true;
                document.getElementById('setting-custom-bubble-css').disabled = false;
            } else {
                document.getElementById('setting-group-use-custom-css').checked = true;
                document.getElementById('setting-group-custom-bubble-css').disabled = false;
            }
        }
    } catch(e){
        console.warn('applyPresetToCurrentChat: cannot write to db object', e);
    }

    try {
        // updateCustomBubbleStyle(window.currentChatId || null, preset.css, true);
        
        let previewBox;
        if (currentChatType === 'private') {
            previewBox = document.getElementById('private-bubble-css-preview');
        } else {
            previewBox = document.getElementById('group-bubble-css-preview');
        }

        if (previewBox) {
            const themeKey = (currentChatType === 'private' ? db.characters.find(c => c.id === currentChatId).theme : db.groups.find(g => g.id === currentChatId).theme) || 'white_pink';
            updateBubbleCssPreview(previewBox, preset.css, false, colorThemes[themeKey]);
        }
        showToast('预设已应用到当前聊天并保存');
        await saveData();
    } catch(e){
        console.error('applyPresetToCurrentChat error', e);
    }
}

function saveCurrentTextareaAsPreset() {
    const textarea = document.getElementById('setting-custom-bubble-css') || document.getElementById('setting-group-custom-bubble-css');
    if (!textarea) return showToast('找不到自定义 CSS 文本框');
    const css = textarea.value.trim();
    if (!css) return showToast('当前 CSS 为空，无法保存');
    let name = prompt('请输入预设名称（将覆盖同名预设）:');
    if (!name) return;
    const presets = _getBubblePresets();
    const idx = presets.findIndex(p => p.name === name);
    if (idx >= 0) presets[idx].css = css;
    else presets.push({name, css});
    _saveBubblePresets(presets);
    populateBubblePresetSelect('bubble-preset-select'); populateBubblePresetSelect('group-bubble-preset-select');
    showToast('预设已保存');
}

// openManagePresetsModal 已由 settings/preset_manager.js 统一实现。

function _getMyPersonaPresets() {
    return db.myPersonaPresets || [];
}
function _saveMyPersonaPresets(arr) {
    db.myPersonaPresets = arr || [];
    saveData();
}

function populateMyPersonaSelect() {
    const sel = document.getElementById('mypersona-preset-select');
    if (!sel) return;
    const presets = _getMyPersonaPresets();
    sel.innerHTML = '<option value="">— 选择预设 —</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
}

function saveCurrentMyPersonaAsPreset() {
    const personaEl = document.getElementById('setting-my-persona');
    const avatarEl = document.getElementById('setting-my-avatar-preview');
    if (!personaEl || !avatarEl) return showToast('找不到我的人设或头像控件');
    const persona = personaEl.value.trim();
    const avatar = avatarEl.src || '';
    if (!persona && !avatar) return showToast('人设和头像都为空，无法保存');
    const name = prompt('请输入预设名称（将覆盖同名预设）：');
    if (!name) return;
    const presets = _getMyPersonaPresets();
    const idx = presets.findIndex(p => p.name === name);
    const preset = { name, persona, avatar };
    if (idx >= 0) presets[idx] = preset; else presets.push(preset);
    _saveMyPersonaPresets(presets);
    populateMyPersonaSelect();
    showToast('我的人设预设已保存');
}

async function applyMyPersonaPresetToCurrentChat(presetName) {
    const presets = _getMyPersonaPresets();
    const p = presets.find(x => x.name === presetName);
    if (!p) { showToast('未找到该预设'); return; }

    const personaEl = document.getElementById('setting-my-persona');
    const avatarEl = document.getElementById('setting-my-avatar-preview');
    if (personaEl) personaEl.value = p.persona || '';
    if (avatarEl) avatarEl.src = p.avatar || '';

    try {
        if (currentChatType === 'private') {
            const e = db.characters.find(c => c.id === currentChatId);
            if (e) {
                if (p.avatar && p.avatar !== e.myAvatar && window.AvatarSystem && e.charSenseAvatarChangeEnabled) {
                    await window.AvatarSystem.recognizeAndNotifyUserAvatarChange(currentChatId, e.myAvatar, p.avatar);
                }
                e.myPersona = p.persona || '';
                e.myAvatar = p.avatar || '';
                await saveData();
                showToast('预设已应用并保存到当前聊天');
                if (typeof loadSettingsToSidebar === 'function') try{ loadSettingsToSidebar(); }catch(e){}
                if (typeof renderChatList === 'function') try{ renderChatList(); }catch(e){}
                if (typeof renderMessages === 'function') renderMessages(false, true);
            }
        } else {
            showToast('预设已应用到界面（未检测到当前聊天保存入口）');
        }
    } catch(err) {
        console.error('applyMyPersonaPresetToCurrentChat error', err);
    }
}

// openManageMyPersonaModal 已由 settings/preset_manager.js 统一实现。

function _getFontPresets() {
    return db.fontPresets || [];
}
function _saveFontPresets(arr) {
    db.fontPresets = arr || [];
    saveData();
}

function populateFontPresetSelect() {
    const sel = document.getElementById('font-preset-select');
    if (!sel) return;
    const presets = _getFontPresets();
    sel.innerHTML = '<option value="">— 选择预设 —</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
}

function saveCurrentFontAsPreset() {
    const fontUrlInput = document.getElementById('customize-font-url');
    const urlVal = fontUrlInput ? fontUrlInput.value.trim() : '';
    const currentFont = urlVal || db.fontUrl || '';
    if (!currentFont) return showToast('当前无字体可保存');
    
    let name = prompt('请输入预设名称（将覆盖同名预设）：');
    if (!name) return;
    
    const presets = _getFontPresets();
    const idx = presets.findIndex(p => p.name === name);
    const preset = { name, url: currentFont, localFontName: db.localFontName || '' };
    
    if (idx >= 0) presets[idx] = preset; 
    else presets.push(preset);
    
    _saveFontPresets(presets);
    populateFontPresetSelect();
    showToast('字体预设已保存');
}

function applyFontPreset(name) {
    const presets = _getFontPresets();
    const p = presets.find(x => x.name === name);
    if (!p) return showToast('未找到该预设');
    
    const fontUrlInput = document.getElementById('customize-font-url');
    const isLocal = p.url && p.url.startsWith('data:');
    if (fontUrlInput) fontUrlInput.value = isLocal ? '' : p.url;
    
    db.fontUrl = p.url;
    db.localFontName = p.localFontName || '';
    saveData();
    applyGlobalFont(p.url);
    
    const nameEl = document.getElementById('local-font-name');
    if (nameEl) {
        if (isLocal && p.localFontName) {
            nameEl.textContent = '已加载本地字体：' + p.localFontName;
            nameEl.style.display = 'block';
        } else {
            nameEl.style.display = 'none';
        }
    }
    showToast('已应用字体预设');
}

// openFontManageModal 已由 settings/preset_manager.js 统一实现。

function setupPresetFeatures() {
    const saveBtn = document.getElementById('api-save-preset');
    const manageBtn = document.getElementById('api-manage-presets');
    const applyBtn = document.getElementById('api-apply-preset');
    const select = document.getElementById('api-preset-select');
    const modalClose = document.getElementById('api-close-modal');
    const importBtn = document.getElementById('api-import-presets');
    const exportBtn = document.getElementById('api-export-presets');

    if (saveBtn) saveBtn.addEventListener('click', saveCurrentApiAsPreset);
    if (manageBtn) manageBtn.addEventListener('click', openApiManageModal);
    if (applyBtn) applyBtn.addEventListener('click', function(){ const v=select.value; if(!v) return showToast('请选择预设'); applyApiPreset(v); });
    if (modalClose) modalClose.addEventListener('click', function(){ document.getElementById('api-presets-modal').style.display='none'; });
    if (importBtn) importBtn.addEventListener('click', importApiPresets);
    if (exportBtn) exportBtn.addEventListener('click', exportApiPresets);
    
    // === TTS 预设管理 ===
    const ttsSaveBtn = document.getElementById('tts-save-preset');
    const ttsManageBtn = document.getElementById('tts-manage-presets');
    const ttsApplyBtn = document.getElementById('tts-apply-preset');
    const ttsSelect = document.getElementById('tts-preset-select');
    const ttsModalClose = document.getElementById('tts-close-modal');
    const ttsImportBtn = document.getElementById('tts-import-presets');
    const ttsExportBtn = document.getElementById('tts-export-presets');

    if (ttsSaveBtn) ttsSaveBtn.addEventListener('click', saveCurrentTTSAsPreset);
    if (ttsManageBtn) ttsManageBtn.addEventListener('click', openTTSManageModal);
    if (ttsApplyBtn) ttsApplyBtn.addEventListener('click', function(){ const v=ttsSelect.value; if(!v) return showToast('请选择预设'); applyTTSPreset(v); });
    if (ttsModalClose) ttsModalClose.addEventListener('click', function(){ document.getElementById('tts-presets-modal').style.display='none'; });
    if (ttsImportBtn) ttsImportBtn.addEventListener('click', importTTSPresets);
    if (ttsExportBtn) ttsExportBtn.addEventListener('click', exportTTSPresets);
    
    const bubbleApplyBtn = document.getElementById('apply-preset-btn');
    const bubbleSaveBtn = document.getElementById('save-preset-btn');
    const bubbleManageBtn = document.getElementById('manage-presets-btn');
    const bubbleModalClose = document.getElementById('close-presets-modal');

    const groupBubbleApplyBtn = document.getElementById('group-apply-preset-btn');
    const groupBubbleSaveBtn = document.getElementById('group-save-preset-btn');
    const groupBubbleManageBtn = document.getElementById('group-manage-presets-btn');

    if (bubbleApplyBtn) bubbleApplyBtn.addEventListener('click', () => {
        const select = document.getElementById('bubble-preset-select');
        const selVal = select ? select.value : '';
        if (!selVal) return showToast('请选择要应用的预设');
        applyPresetToCurrentChat(selVal);
    });
    if (bubbleSaveBtn) bubbleSaveBtn.addEventListener('click', saveCurrentTextareaAsPreset);
    if (bubbleManageBtn) bubbleManageBtn.addEventListener('click', openManagePresetsModal);
    if (bubbleModalClose) bubbleModalClose.addEventListener('click', () => {
        const modal = document.getElementById('bubble-presets-modal');
        if (modal) modal.style.display = 'none';
    });

    const allowCharSwitchCssCb = document.getElementById('setting-allow-char-switch-bubble-css');
    const bubbleBindingsWrap = document.getElementById('bubble-css-theme-bindings-wrap');
    if (allowCharSwitchCssCb && bubbleBindingsWrap) {
        allowCharSwitchCssCb.addEventListener('change', () => {
            bubbleBindingsWrap.style.display = allowCharSwitchCssCb.checked ? 'block' : 'none';
        });
    }
    const bubbleAddThemeBtn = document.getElementById('bubble-css-add-theme-binding-btn');
    const bubbleAddThemeModal = document.getElementById('bubble-add-theme-modal');
    const bubbleAddThemePresetSelect = document.getElementById('bubble-add-theme-preset-select');
    const bubbleAddThemeDescInput = document.getElementById('bubble-add-theme-desc-input');
    const bubbleAddThemeCancelBtn = document.getElementById('bubble-add-theme-cancel-btn');
    const bubbleAddThemeConfirmBtn = document.getElementById('bubble-add-theme-confirm-btn');
    if (bubbleAddThemeBtn) bubbleAddThemeBtn.addEventListener('click', () => {
        const char = db.characters.find(c => c.id === currentChatId);
        if (!char) return showToast('请先选择角色');
        const presets = _getBubblePresets();
        const boundNames = (char.bubbleCssThemeBindings || []).map(b => b.presetName);
        const available = presets.filter(p => !boundNames.includes(p.name));
        if (!bubbleAddThemePresetSelect) return;
        bubbleAddThemePresetSelect.innerHTML = '<option value="">— 选择预设 —</option>';
        available.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = p.name;
            bubbleAddThemePresetSelect.appendChild(opt);
        });
        if (bubbleAddThemeDescInput) bubbleAddThemeDescInput.value = '';
        if (bubbleAddThemeModal) bubbleAddThemeModal.style.display = 'flex';
    });
    if (bubbleAddThemeCancelBtn) bubbleAddThemeCancelBtn.addEventListener('click', () => {
        if (bubbleAddThemeModal) bubbleAddThemeModal.style.display = 'none';
    });
    if (bubbleAddThemeConfirmBtn) bubbleAddThemeConfirmBtn.addEventListener('click', () => {
        const presetName = bubbleAddThemePresetSelect && bubbleAddThemePresetSelect.value;
        if (!presetName) return showToast('请选择预设');
        const char = db.characters.find(c => c.id === currentChatId);
        if (!char) return;
        if (!Array.isArray(char.bubbleCssThemeBindings)) char.bubbleCssThemeBindings = [];
        char.bubbleCssThemeBindings.push({
            presetName,
            description: (bubbleAddThemeDescInput && bubbleAddThemeDescInput.value) ? bubbleAddThemeDescInput.value.trim() : ''
        });
        populateBubbleThemeBindingsList(char.bubbleCssThemeBindings);
        if (bubbleAddThemeModal) bubbleAddThemeModal.style.display = 'none';
    });

    if (groupBubbleApplyBtn) groupBubbleApplyBtn.addEventListener('click', () => {
        const select = document.getElementById('group-bubble-preset-select');
        const selVal = select ? select.value : '';
        if (!selVal) return showToast('请选择要应用的预设');
        applyPresetToCurrentChat(selVal);
    });
    if (groupBubbleSaveBtn) groupBubbleSaveBtn.addEventListener('click', saveCurrentTextareaAsPreset);
    if (groupBubbleManageBtn) groupBubbleManageBtn.addEventListener('click', openManagePresetsModal);

    const personaSaveBtn = document.getElementById('mypersona-save-btn');
    const personaManageBtn = document.getElementById('mypersona-manage-btn');
    const personaApplyBtn = document.getElementById('mypersona-apply-btn');
    const personaSelect = document.getElementById('mypersona-preset-select');
    const personaModalClose = document.getElementById('mypersona-close-modal');

    if (personaSaveBtn) personaSaveBtn.addEventListener('click', saveCurrentMyPersonaAsPreset);
    if (personaManageBtn) personaManageBtn.addEventListener('click', openManageMyPersonaModal);
    if (personaApplyBtn) personaApplyBtn.addEventListener('click', function(){ const v = personaSelect ? personaSelect.value : ''; if(!v) return showToast('请选择要应用的预设'); applyMyPersonaPresetToCurrentChat(v); });
    if (personaModalClose) personaModalClose.addEventListener('click', function(){ const m = document.getElementById('mypersona-presets-modal'); if(m) m.style.display='none'; });

    const globalCssModalClose = document.getElementById('global-css-close-modal');
    if (globalCssModalClose) globalCssModalClose.addEventListener('click', () => {
        const m = document.getElementById('global-css-presets-modal');
        if(m) m.style.display = 'none';
    });

    const fontModalClose = document.getElementById('font-close-modal');
    if (fontModalClose) fontModalClose.addEventListener('click', () => {
        const m = document.getElementById('font-presets-modal');
        if (m) m.style.display = 'none';
    });

    const soundModalClose = document.getElementById('sound-close-modal');
    if (soundModalClose) soundModalClose.addEventListener('click', () => {
        const m = document.getElementById('sound-presets-modal');
        if(m) m.style.display = 'none';
    });

    const iconPresetModalClose = document.getElementById('icon-presets-close-modal');
    if (iconPresetModalClose) iconPresetModalClose.addEventListener('click', () => {
        const m = document.getElementById('icon-presets-modal');
        if (m) m.style.display = 'none';
    });

    const voicePresetModalClose = document.getElementById('voice-presets-close-modal');
    if (voicePresetModalClose) voicePresetModalClose.addEventListener('click', () => {
        const m = document.getElementById('voice-presets-modal');
        if(m) m.style.display = 'none';
    });

    const namePresetModalClose = document.getElementById('name-presets-close-modal');
    if (namePresetModalClose) namePresetModalClose.addEventListener('click', () => {
        const m = document.getElementById('name-presets-modal');
        if (m) m.style.display = 'none';
    });

}

const DEFAULT_WALLPAPER_URL = 'https://i.postimg.cc/W4Z9R9x4/ins-1.jpg';

function setupWallpaperApp() {
    const e = document.getElementById('wallpaper-upload'), t = document.getElementById('wallpaper-preview');
    if (t) {
        t.style.backgroundImage = `url(${db.wallpaper})`;
        t.textContent = '';
    }
    const resetBtn = document.getElementById('wallpaper-reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
            db.wallpaper = DEFAULT_WALLPAPER_URL;
            applyWallpaper(DEFAULT_WALLPAPER_URL);
            if (t) {
                t.style.backgroundImage = `url(${DEFAULT_WALLPAPER_URL})`;
                t.textContent = '';
            }
            if (e) e.value = '';
            await saveData();
            showToast('已恢复默认壁纸');
        });
    }
    if (e) {
        e.addEventListener('change', async (a) => {
            const n = a.target.files[0];
            if (n) {
                try {
                    const r = await compressImage(n, {quality: 0.85, maxWidth: 1080, maxHeight: 1920});
                    db.wallpaper = r;
                    applyWallpaper(r);
                    if (t) t.style.backgroundImage = `url(${r})`;
                    await saveData();
                    showToast('壁纸已更新');
                } catch (error) {
                    showToast('壁纸压缩失败');
                }
            }
        });
    }
    // 全局聊天壁纸（在壁纸APP中管理）
    setupGlobalChatWallpaperInWallpaperScreen();
    
    // 全局通话壁纸（在壁纸APP中管理）
    setupGlobalCallWallpaperInWallpaperScreen();
}

function setupGlobalChatWallpaperInWallpaperScreen() {
    const GLOBAL_CHAT_BG_KEY = 'global_chat_bg';
    const preview = document.getElementById('global-chat-wallpaper-preview');
    const previewText = document.getElementById('global-chat-wallpaper-preview-text');
    const localBtn = document.getElementById('global-chat-wallpaper-local-btn');
    const urlBtn = document.getElementById('global-chat-wallpaper-url-btn');
    const resetBtn = document.getElementById('global-chat-wallpaper-reset-btn');
    const urlRow = document.getElementById('global-chat-wallpaper-url-row');
    const urlInput = document.getElementById('global-chat-wallpaper-url-input');
    const urlApply = document.getElementById('global-chat-wallpaper-url-apply');
    const fileInput = document.getElementById('global-chat-wallpaper-file-input');

    function refreshPreview() {
        var url = db.globalChatWallpaper || '';
        if (preview) {
            if (url) {
                preview.style.backgroundImage = 'url(' + url + ')';
                if (previewText) previewText.style.display = 'none';
            } else {
                preview.style.backgroundImage = '';
                if (previewText) previewText.style.display = '';
            }
        }
    }

    refreshPreview();

    if (localBtn && fileInput) {
        localBtn.addEventListener('click', function () { fileInput.click(); });
        fileInput.addEventListener('change', async function () {
            var file = this.files && this.files[0];
            if (!file) return;
            try {
                var dataUrl = await compressImage(file, { quality: 0.85, maxWidth: 1080, maxHeight: 1920 });
                db.globalChatWallpaper = dataUrl;
                await saveData();
                refreshPreview();
                showToast('全局聊天壁纸已更新');
            } catch (_) {
                showToast('图片压缩失败');
            }
            this.value = '';
        });
    }

    if (urlBtn) {
        urlBtn.addEventListener('click', function () {
            if (urlRow) urlRow.style.display = urlRow.style.display === 'none' ? 'flex' : 'none';
            if (urlRow && urlRow.style.display === 'flex' && urlInput) urlInput.focus();
        });
    }

    if (urlApply && urlInput) {
        urlApply.addEventListener('click', async function () {
            var url = urlInput.value.trim();
            if (!url) return;
            if (!url.startsWith('http')) { showToast('请输入有效的 http/https 链接'); return; }
            db.globalChatWallpaper = url;
            await saveData();
            refreshPreview();
            if (urlRow) urlRow.style.display = 'none';
            showToast('全局聊天壁纸已更新');
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', async function () {
            db.globalChatWallpaper = '';
            await saveData();
            refreshPreview();
            showToast('已恢复默认全局聊天壁纸');
        });
    }
}

function setupGlobalCallWallpaperInWallpaperScreen() {
    const preview = document.getElementById('global-call-wallpaper-preview');
    const previewText = document.getElementById('global-call-wallpaper-preview-text');
    const localBtn = document.getElementById('global-call-wallpaper-local-btn');
    const urlBtn = document.getElementById('global-call-wallpaper-url-btn');
    const resetBtn = document.getElementById('global-call-wallpaper-reset-btn');
    const urlRow = document.getElementById('global-call-wallpaper-url-row');
    const urlInput = document.getElementById('global-call-wallpaper-url-input');
    const urlApply = document.getElementById('global-call-wallpaper-url-apply');
    const fileInput = document.getElementById('global-call-wallpaper-file-input');

    function refreshPreview() {
        var url = db.globalCallWallpaper || '';
        if (preview) {
            if (url) {
                preview.style.backgroundImage = 'url(' + url + ')';
                if (previewText) previewText.style.display = 'none';
            } else {
                preview.style.backgroundImage = '';
                if (previewText) previewText.style.display = '';
            }
        }
    }

    refreshPreview();

    if (localBtn && fileInput) {
        localBtn.addEventListener('click', function () { fileInput.click(); });
        fileInput.addEventListener('change', async function () {
            var file = this.files && this.files[0];
            if (!file) return;
            try {
                var dataUrl = await compressImage(file, { quality: 0.85, maxWidth: 1080, maxHeight: 1920 });
                db.globalCallWallpaper = dataUrl;
                await saveData();
                refreshPreview();
                showToast('全局通话壁纸已更新');
            } catch (_) {
                showToast('图片压缩失败');
            }
            this.value = '';
        });
    }

    if (urlBtn) {
        urlBtn.addEventListener('click', function () {
            if (urlRow) urlRow.style.display = urlRow.style.display === 'none' ? 'flex' : 'none';
            if (urlRow && urlRow.style.display === 'flex' && urlInput) urlInput.focus();
        });
    }

    if (urlApply && urlInput) {
        urlApply.addEventListener('click', async function () {
            var url = urlInput.value.trim();
            if (!url) return;
            if (!url.startsWith('http')) { showToast('请输入有效的 http/https 链接'); return; }
            db.globalCallWallpaper = url;
            await saveData();
            refreshPreview();
            if (urlRow) urlRow.style.display = 'none';
            showToast('全局通话壁纸已更新');
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', async function () {
            db.globalCallWallpaper = '';
            await saveData();
            refreshPreview();
            showToast('已恢复默认全局通话壁纸');
        });
    }
}

function populateGlobalCssPresetSelect() {
    const select = document.getElementById('global-css-preset-select');
    if (!select) return;
    select.innerHTML = '<option value="">— 选择预设 —</option>';
    (db.globalCssPresets || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        select.appendChild(opt);
    });
}

// openGlobalCssManageModal 已由 settings/preset_manager.js 统一实现。

function _getSoundPresets() {
    return db.soundPresets || [];
}
function _saveSoundPresets(arr) {
    db.soundPresets = arr || [];
    saveData();
}

function populateSoundPresetSelect() {
    const sel = document.getElementById('sound-preset-select');
    if (!sel) return;
    const presets = _getSoundPresets();
    sel.innerHTML = '<option value="">— 选择预设 —</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
}

function saveCurrentSoundAsPreset() {
    const sendUrl = document.getElementById('global-send-sound-url').value.trim();
    const receiveUrl = document.getElementById('global-receive-sound-url').value.trim();
    const messageSentUrl = (document.getElementById('global-message-sent-sound-url')?.value || '').trim();
    const incomingCallUrl = (document.getElementById('global-incoming-call-sound-url')?.value || '').trim();
    
    if (!sendUrl && !receiveUrl && !messageSentUrl && !incomingCallUrl) return showToast('提示音配置为空，无法保存');
    
    let name = prompt('请输入预设名称（将覆盖同名预设）：');
    if (!name) return;
    
    const presets = _getSoundPresets();
    const idx = presets.findIndex(p => p.name === name);
    const preset = { name, sendSound: sendUrl, receiveSound: receiveUrl, messageSentSound: messageSentUrl, incomingCallSound: incomingCallUrl };
    
    if (idx >= 0) presets[idx] = preset; 
    else presets.push(preset);
    
    _saveSoundPresets(presets);
    populateSoundPresetSelect();
    showToast('提示音预设已保存');
}

function applySoundPreset(name) {
    const presets = _getSoundPresets();
    const p = presets.find(x => x.name === name);
    if (!p) return showToast('未找到该预设');
    
    const sendInput = document.getElementById('global-send-sound-url');
    const receiveInput = document.getElementById('global-receive-sound-url');
    const incomingCallInput = document.getElementById('global-incoming-call-sound-url');
    
    if (sendInput) sendInput.value = p.sendSound || '';
    if (receiveInput) receiveInput.value = p.receiveSound || '';
    if (incomingCallInput) incomingCallInput.value = p.incomingCallSound || '';
    
    db.globalSendSound = p.sendSound || '';
    db.globalReceiveSound = p.receiveSound || '';
    db.globalIncomingCallSound = p.incomingCallSound || '';
    saveData();
    
    showToast('已应用提示音预设');
}

// openSoundManageModal 已由 settings/preset_manager.js 统一实现。

// ========== 音色预设库 ==========
function _getVoicePresets() {
    return db.voicePresets || [];
}
function _saveVoicePresets(arr) {
    db.voicePresets = arr || [];
    saveData();
}

function populateVoicePresetSelect() {
    const sel = document.getElementById('voice-preset-select');
    if (!sel) return;
    const presets = _getVoicePresets();
    sel.innerHTML = '<option value="">— 选择 —</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
}

function saveCurrentVoiceAsPreset() {
    if (typeof currentChatId === 'undefined' || !currentChatId) return showToast('请先打开一个角色');
    const chat = db.characters && db.characters.find(c => c.id === currentChatId);
    if (!chat || !chat.ttsConfig) return showToast('当前角色无语音配置');

    const tc = chat.ttsConfig;
    const preset = {
        voiceId: tc.voiceId || '',
        customVoiceId: tc.customVoiceId || '',
        language: tc.language || 'auto',
        speed: tc.speed != null ? tc.speed : 1,
        userVoiceId: tc.userVoiceId || '',
        userCustomVoiceId: tc.userCustomVoiceId || '',
        userLanguage: tc.userLanguage || 'auto',
        userSpeed: tc.userSpeed != null ? tc.userSpeed : 1
    };

    const name = prompt('请输入音色预设名称（将覆盖同名预设）：');
    if (!name) return;

    const presets = _getVoicePresets();
    const idx = presets.findIndex(p => p.name === name);
    const entry = { name, ...preset };
    if (idx >= 0) presets[idx] = entry;
    else presets.push(entry);

    _saveVoicePresets(presets);
    populateVoicePresetSelect();
    showToast('音色预设已保存');
}

function applyVoicePreset(name) {
    if (typeof currentChatId === 'undefined' || !currentChatId) return showToast('请先打开一个角色');
    const chat = db.characters && db.characters.find(c => c.id === currentChatId);
    if (!chat) return showToast('未找到角色');

    const presets = _getVoicePresets();
    const p = presets.find(x => x.name === name);
    if (!p) return showToast('未找到该预设');

    if (!chat.ttsConfig) chat.ttsConfig = {};
    chat.ttsConfig.voiceId = p.voiceId || '';
    chat.ttsConfig.customVoiceId = p.customVoiceId || '';
    chat.ttsConfig.language = p.language || 'auto';
    chat.ttsConfig.speed = p.speed != null ? p.speed : 1;
    chat.ttsConfig.userVoiceId = p.userVoiceId || '';
    chat.ttsConfig.userCustomVoiceId = p.userCustomVoiceId || '';
    chat.ttsConfig.userLanguage = p.userLanguage || 'auto';
    chat.ttsConfig.userSpeed = p.userSpeed != null ? p.userSpeed : 1;

    saveData();

    // 刷新表单 UI
    if (typeof TTSSettings !== 'undefined') TTSSettings.loadChatTTSConfig(currentChatId);

    showToast('已应用音色预设：' + name);
}

// openVoicePresetManageModal 已由 settings/preset_manager.js 统一实现。

function _getIconPresets() {
    return db.iconPresets || [];
}
function _saveIconPresets(arr) {
    db.iconPresets = arr || [];
    saveData();
}

function populateIconPresetSelect() {
    const sel = document.getElementById('icon-preset-select');
    if (!sel) return;
    const presets = _getIconPresets();
    sel.innerHTML = '<option value="">— 选择预设 —</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
}

function saveCurrentIconsAsPreset() {
    const customIcons = db.customIcons ? JSON.parse(JSON.stringify(db.customIcons)) : {};
    const name = prompt('请输入预设名称（将覆盖同名预设）：');
    if (!name) return;
    const presets = _getIconPresets();
    const idx = presets.findIndex(p => p.name === name);
    const preset = { name, customIcons };
    if (idx >= 0) presets[idx] = preset;
    else presets.push(preset);
    _saveIconPresets(presets);
    populateIconPresetSelect();
    showToast('图标预设已保存');
}

function applyIconPreset(name) {
    const presets = _getIconPresets();
    const p = presets.find(x => x.name === name);
    if (!p) return showToast('未找到该预设');
    db.customIcons = p.customIcons ? JSON.parse(JSON.stringify(p.customIcons)) : {};
    saveData();
    const iconIds = Object.keys(defaultIcons || {});
    iconIds.forEach(id => {
        const url = (db.customIcons && db.customIcons[id]) || (defaultIcons[id] && defaultIcons[id].url) || '';
        const input = document.querySelector(`input[data-icon-id="${id}"][type="url"]`);
        const preview = document.getElementById(`icon-preview-${id}`);
        if (input) input.value = url || '';
        if (preview) preview.src = url;
    });
    if (typeof setupHomeScreen === 'function') setupHomeScreen();
    showToast('已应用图标预设');
}

// openIconPresetManageModal 已由 settings/preset_manager.js 统一实现。

function _getNamePresets() {
    return db.namePresets || [];
}
function _saveNamePresets(arr) {
    db.namePresets = arr || [];
    saveData();
}

function populateNamePresetSelect() {
    const sel = document.getElementById('name-preset-select');
    if (!sel) return;
    const presets = _getNamePresets();
    sel.innerHTML = '<option value="">— 选择预设 —</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        sel.appendChild(opt);
    });
}

function saveCurrentNamesAsPreset() {
    const customAppNames = db.customAppNames ? JSON.parse(JSON.stringify(db.customAppNames)) : {};
    if (!Object.keys(customAppNames).length) return showToast('当前没有自定义名称，无法保存');
    const name = prompt('请输入预设名称（将覆盖同名预设）：');
    if (!name) return;
    const presets = _getNamePresets();
    const idx = presets.findIndex(p => p.name === name);
    const preset = { name, customAppNames };
    if (idx >= 0) presets[idx] = preset;
    else presets.push(preset);
    _saveNamePresets(presets);
    populateNamePresetSelect();
    showToast('名称预设已保存');
}

function applyNamePreset(name) {
    const presets = _getNamePresets();
    const p = presets.find(x => x.name === name);
    if (!p) return showToast('未找到该预设');
    db.customAppNames = p.customAppNames ? JSON.parse(JSON.stringify(p.customAppNames)) : {};
    saveData();
    if (typeof setupHomeScreen === 'function') setupHomeScreen();
    renderCustomizeForm();
    showToast('已应用名称预设');
}

// openNamePresetManageModal 已由 settings/preset_manager.js 统一实现。

