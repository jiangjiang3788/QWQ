// V2.9-R4 设置模块：桌面自定义、全局 CSS 与状态栏
function setupCustomizeApp() {
    const customizeForm = document.getElementById('customize-form');
    
    customizeForm.addEventListener('click', async (e) => {
        const target = e.target;

        const header = target.closest('.collapsible-header');
        if (header) {
            const section = header.closest('.collapsible-section');
            if (section) {
                section.classList.toggle('open');
                return; 
            }
        }

        if (target.matches('.reset-icon-btn')) {
            const iconId = target.dataset.id;
            if (db.customIcons) {
                delete db.customIcons[iconId];
            }
            await saveData();
            renderCustomizeForm();
            setupHomeScreen();
            showToast('图标已重置');
        }

        if (target.matches('.reset-name-btn')) {
            const nameId = target.dataset.nameResetId;
            if (db.customAppNames) {
                delete db.customAppNames[nameId];
            }
            await saveData();
            renderCustomizeForm();
            setupHomeScreen();
            showToast('名称已重置');
        }

        if (target.matches('#reset-all-names-btn')) {
            if (confirm('确定要将所有应用名称恢复为默认吗？')) {
                db.customAppNames = {};
                await saveData();
                renderCustomizeForm();
                setupHomeScreen();
                showToast('所有名称已恢复默认');
            }
        }

        if (target.classList.contains('copy-css-btn')) {
            const codeBlock = target.closest('.css-template-card').querySelector('code');
            if (codeBlock) {
                navigator.clipboard.writeText(codeBlock.textContent.trim()).then(() => {
                    showToast('代码已复制到剪贴板！');
                }).catch(err => {
                    showToast('复制失败: ' + err);
                    console.error('Copy failed', err);
                });
            }
        }
        
        if (target.matches('#apply-global-css-now-btn')) {
            const textarea = document.getElementById('global-beautification-css');
            const newCss = textarea.value;
            db.globalCss = newCss;
            applyGlobalCss(newCss);
            await saveData();
            showToast('全局样式已应用');
        }
        
        if (target.matches('#global-css-import-doc-btn')) {
            document.getElementById('global-css-import-file').click();
            return;
        }
        if (target.matches('#bubble-css-import-doc-btn')) {
            document.getElementById('bubble-css-import-file').click();
            return;
        }
        if (target.matches('#group-bubble-css-import-doc-btn')) {
            document.getElementById('group-bubble-css-import-file').click();
            return;
        }
        
        if (target.matches('#reset-global-css-btn')) {
            const textarea = document.getElementById('global-beautification-css');
            textarea.value = '';
            db.globalCss = '';
            applyGlobalCss('');
            await saveData();
            showToast('已重置CSS内容');
        }
        
        if (target.matches('#global-css-apply-btn')) {
            const select = document.getElementById('global-css-preset-select');
            const presetName = select.value;
            if (!presetName) return showToast('请选择一个预设');
            const preset = db.globalCssPresets.find(p => p.name === presetName);
            if (preset) {
                const textarea = document.getElementById('global-beautification-css');
                textarea.value = preset.css;
                db.globalCss = preset.css;
                applyGlobalCss(preset.css);
                saveData();
                showToast('全局CSS预设已应用');
            }
        }
        
        if (target.matches('#global-css-save-btn')) {
            const textarea = document.getElementById('global-beautification-css');
            const css = textarea.value.trim();
            if (!css) return showToast('CSS内容为空，无法保存');
            const name = prompt('请输入此预设的名称（同名将覆盖）:');
            if (!name) return;
            if (!db.globalCssPresets) db.globalCssPresets = [];
            const existingIndex = db.globalCssPresets.findIndex(p => p.name === name);
            if (existingIndex > -1) {
                db.globalCssPresets[existingIndex].css = css;
            } else {
                db.globalCssPresets.push({ name, css });
            }
            saveData();
            populateGlobalCssPresetSelect();
            showToast('全局CSS预设已保存');
        }
        
        if (target.matches('#global-css-manage-btn')) {
            openGlobalCssManageModal();
        }
        
        if (target.matches('#apply-font-btn')) {
            const fontUrl = document.getElementById('customize-font-url').value.trim();
            db.fontUrl = fontUrl;
            db.localFontName = '';
            await saveData();
            applyGlobalFont(fontUrl);
            const nameEl = document.getElementById('local-font-name');
            if (nameEl) nameEl.style.display = 'none';
            showToast('新字体已应用！');
        }
        
        if (target.matches('#restore-font-btn')) {
            document.getElementById('customize-font-url').value = '';
            db.fontUrl = '';
            db.localFontName = '';
            await saveData();
            applyGlobalFont('');
            const nameEl = document.getElementById('local-font-name');
            if (nameEl) nameEl.style.display = 'none';
            showToast('已恢复默认字体！');
        }

        if (target.matches('#font-apply-preset-btn')) {
            const select = document.getElementById('font-preset-select');
            const presetName = select.value;
            if (!presetName) return showToast('请选择一个预设');
            applyFontPreset(presetName);
        }
        
        if (target.matches('#font-save-preset-btn')) {
            saveCurrentFontAsPreset();
        }
        
        if (target.matches('#font-manage-presets-btn')) {
            openFontManageModal();
        }

        if (target.matches('#sound-apply-preset-btn')) {
            const select = document.getElementById('sound-preset-select');
            const presetName = select.value;
            if (!presetName) return showToast('请选择一个预设');
            applySoundPreset(presetName);
        }
        
        if (target.matches('#sound-save-preset-btn')) {
            saveCurrentSoundAsPreset();
        }
        
        if (target.matches('#sound-manage-presets-btn')) {
            openSoundManageModal();
        }

        if (target.matches('#icon-apply-preset-btn')) {
            const select = document.getElementById('icon-preset-select');
            const presetName = select && select.value;
            if (!presetName) return showToast('请选择一个预设');
            applyIconPreset(presetName);
        }
        if (target.matches('#icon-save-preset-btn')) {
            saveCurrentIconsAsPreset();
        }
        if (target.matches('#icon-manage-presets-btn')) {
            openIconPresetManageModal();
        }

        if (target.matches('#voice-apply-preset-btn')) {
            const select = document.getElementById('voice-preset-select');
            const presetName = select && select.value;
            if (!presetName) return showToast('请选择一个预设');
            applyVoicePreset(presetName);
        }
        if (target.matches('#voice-save-preset-btn')) {
            saveCurrentVoiceAsPreset();
        }
        if (target.matches('#voice-manage-presets-btn')) {
            openVoicePresetManageModal();
        }

        if (target.matches('#name-apply-preset-btn')) {
            const select = document.getElementById('name-preset-select');
            const presetName = select && select.value;
            if (!presetName) return showToast('请选择一个预设');
            applyNamePreset(presetName);
        }
        if (target.matches('#name-save-preset-btn')) {
            saveCurrentNamesAsPreset();
        }
        if (target.matches('#name-manage-presets-btn')) {
            openNamePresetManageModal();
        }

        if (target.matches('#test-send-sound-btn')) {
            const url = document.getElementById('global-send-sound-url').value;
            if (url) {
                try {
                    const audio = new Audio(url);
                    audio.play().catch(e => showToast('播放失败: ' + e.message));
                } catch (e) {
                    showToast('无效的音频地址');
                }
            } else {
                showToast('未设置提示音');
            }
        }
        if (target.matches('#reset-send-sound-btn')) {
            document.getElementById('global-send-sound-url').value = '';
            db.globalSendSound = '';
            saveData();
            showToast('已重置');
        }
        if (target.matches('#test-receive-sound-btn')) {
            const url = document.getElementById('global-receive-sound-url').value;
            if (url) {
                try {
                    const audio = new Audio(url);
                    audio.play().catch(e => showToast('播放失败: ' + e.message));
                } catch (e) {
                    showToast('无效的音频地址');
                }
            } else {
                showToast('未设置提示音');
            }
        }
        if (target.matches('#reset-receive-sound-btn')) {
            document.getElementById('global-receive-sound-url').value = '';
            db.globalReceiveSound = '';
            saveData();
            showToast('已重置');
        }
        if (target.matches('#test-message-sent-sound-btn')) {
            const formGroup = target.closest('.form-group');
            const urlInput = formGroup && formGroup.querySelector('input[type="url"]');
            const url = (urlInput && urlInput.value && urlInput.value.trim()) || '';
            if (url) {
                db.globalMessageSentSound = url;
                saveData();
                try {
                    const audio = new Audio(url);
                    audio.play().catch(e => showToast('播放失败: ' + e.message));
                } catch (e) {
                    showToast('无效的音频地址');
                }
            } else {
                showToast('未设置提示音');
            }
        }
        if (target.matches('#reset-message-sent-sound-btn')) {
            const formGroup = target.closest('.form-group');
            const urlInput = formGroup && formGroup.querySelector('input[type="url"]');
            if (urlInput) urlInput.value = '';
            db.globalMessageSentSound = '';
            saveData();
            showToast('已重置');
        }
        if (target.matches('#test-incoming-call-sound-btn')) {
            const url = document.getElementById('global-incoming-call-sound-url').value;
            if (url) {
                try {
                    // 停止之前的测试音频
                    if (window._testRingAudio) {
                        window._testRingAudio.pause();
                        window._testRingAudio.src = '';
                        window._testRingAudio = null;
                    }
                    const audio = new Audio();
                    audio.preload = 'auto';
                    audio.loop = true;
                    audio.addEventListener('canplaythrough', () => {
                        audio.play().catch(e => showToast('播放失败: ' + e.message));
                    }, { once: true });
                    audio.addEventListener('ended', () => {
                        if (window._testRingAudio === audio) {
                            try { audio.currentTime = 0; audio.play().catch(() => {}); } catch(e) {}
                        }
                    });
                    audio.src = url;
                    audio.load();
                    window._testRingAudio = audio;
                    setTimeout(() => {
                        if (window._testRingAudio === audio) {
                            audio.pause();
                            audio.src = '';
                            window._testRingAudio = null;
                        }
                    }, 5000);
                } catch (e) {
                    showToast('无效的音频地址');
                }
            } else {
                showToast('未设置提示音');
            }
        }
        if (target.matches('#reset-incoming-call-sound-btn')) {
            document.getElementById('global-incoming-call-sound-url').value = '';
            db.globalIncomingCallSound = '';
            saveData();
            showToast('已重置');
        }
    });

    customizeForm.addEventListener('input', async (e) => {
        const target = e.target;

        if (target.dataset.iconId) { 
            const iconId = target.dataset.iconId;
            const newUrl = target.value.trim();
            const previewImg = document.getElementById(`icon-preview-${iconId}`);
            if (newUrl) {
                if (!db.customIcons) db.customIcons = {};
                db.customIcons[iconId] = newUrl;
                if(previewImg) previewImg.src = newUrl;
            }
            await saveData();
            setupHomeScreen();
        } 
        else if (target.dataset.nameId) {
            const nameId = target.dataset.nameId;
            const newName = target.value.trim();
            if (!db.customAppNames) db.customAppNames = {};
            if (newName) {
                db.customAppNames[nameId] = newName;
            } else {
                delete db.customAppNames[nameId];
            }
            await saveData();
            setupHomeScreen();
        }
        else if (target.id === 'global-send-sound-url') {
            db.globalSendSound = target.value.trim();
            await saveData();
        }
        else if (target.id === 'global-receive-sound-url') {
            db.globalReceiveSound = target.value.trim();
            await saveData();
        }
        else if (target.id === 'global-message-sent-sound-url') {
            db.globalMessageSentSound = target.value.trim();
            await saveData();
        }
        else if (target.id === 'global-incoming-call-sound-url') {
            db.globalIncomingCallSound = target.value.trim();
            await saveData();
        }
    });

    customizeForm.addEventListener('change', async (e) => {
        if (e.target.id === 'global-css-import-file') {
            const file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!file) return;
            const ext = (file.name.split('.').pop() || '').toLowerCase();
            const textarea = document.getElementById('global-beautification-css');
            if (!textarea) return;
            try {
                let content = '';
                if (ext === 'txt') {
                    content = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (ev) => resolve(ev.target.result || '');
                        reader.onerror = () => reject(new Error('读取TXT失败'));
                        reader.readAsText(file, 'UTF-8');
                    });
                } else if (ext === 'docx') {
                    if (typeof mammoth === 'undefined') {
                        showToast('mammoth.js 未加载，无法解析 DOCX');
                        return;
                    }
                    content = await parseDocxFile(file);
                } else {
                    showToast('仅支持 .txt 或 .docx 文件');
                    return;
                }
                textarea.value = (content || '').trim();
                showToast('已导入文档内容');
            } catch (err) {
                console.error('导入文档失败', err);
                showToast('导入失败：' + (err.message || '未知错误'));
            }
            return;
        }
        if (e.target.id === 'bubble-css-import-file') {
            const file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!file) return;
            const ext = (file.name.split('.').pop() || '').toLowerCase();
            const textarea = document.getElementById('setting-custom-bubble-css');
            if (!textarea) return;
            try {
                let content = '';
                if (ext === 'txt') {
                    content = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (ev) => resolve(ev.target.result || '');
                        reader.onerror = () => reject(new Error('读取TXT失败'));
                        reader.readAsText(file, 'UTF-8');
                    });
                } else if (ext === 'docx') {
                    if (typeof mammoth === 'undefined') {
                        showToast('mammoth.js 未加载，无法解析 DOCX');
                        return;
                    }
                    content = await parseDocxFile(file);
                } else {
                    showToast('仅支持 .txt 或 .docx 文件');
                    return;
                }
                textarea.value = (content || '').trim();
                showToast('已导入文档内容');
            } catch (err) {
                console.error('导入文档失败', err);
                showToast('导入失败：' + (err.message || '未知错误'));
            }
            return;
        }
        if (e.target.id === 'group-bubble-css-import-file') {
            const file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!file) return;
            const ext = (file.name.split('.').pop() || '').toLowerCase();
            const textarea = document.getElementById('setting-group-custom-bubble-css');
            if (!textarea) return;
            try {
                let content = '';
                if (ext === 'txt') {
                    content = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (ev) => resolve(ev.target.result || '');
                        reader.onerror = () => reject(new Error('读取TXT失败'));
                        reader.readAsText(file, 'UTF-8');
                    });
                } else if (ext === 'docx') {
                    if (typeof mammoth === 'undefined') {
                        showToast('mammoth.js 未加载，无法解析 DOCX');
                        return;
                    }
                    content = await parseDocxFile(file);
                } else {
                    showToast('仅支持 .txt 或 .docx 文件');
                    return;
                }
                textarea.value = (content || '').trim();
                showToast('已导入文档内容');
            } catch (err) {
                console.error('导入文档失败', err);
                showToast('导入失败：' + (err.message || '未知错误'));
            }
            return;
        }
        if (e.target.matches('.icon-upload-input')) {
            const file = e.target.files[0];
            if (!file) return;
            const iconId = e.target.dataset.iconId;
            
            try {
                showToast('正在处理图片...');
                const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 200, maxHeight: 200 });
                
                if (!db.customIcons) db.customIcons = {};
                db.customIcons[iconId] = compressedUrl;
                
                const previewImg = document.getElementById(`icon-preview-${iconId}`);
                const urlInput = document.querySelector(`input[data-icon-id="${iconId}"][type="url"]`);
                
                if (previewImg) previewImg.src = compressedUrl;
                if (urlInput) urlInput.value = compressedUrl;
                
                await saveData();
                setupHomeScreen();
                showToast('图标已更新');
            } catch (error) {
                console.error('图标上传失败', error);
                showToast('图片处理失败，请重试');
            } finally {
                e.target.value = null;
            }
        }

        if (e.target.id === 'global-send-sound-url') {
            db.globalSendSound = e.target.value.trim();
            saveData();
        }
        if (e.target.id === 'global-receive-sound-url') {
            db.globalReceiveSound = e.target.value.trim();
            saveData();
        }
        if (e.target.id === 'global-incoming-call-sound-url') {
            db.globalIncomingCallSound = e.target.value.trim();
            saveData();
        }
        if (e.target.id === 'multi-msg-sound-switch') {
            db.multiMsgSoundEnabled = e.target.checked;
            saveData();
        }
        if (e.target.id === 'global-send-sound-upload' || e.target.id === 'global-receive-sound-upload' || e.target.id === 'global-message-sent-sound-upload' || e.target.id === 'global-incoming-call-sound-upload') {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
                showToast('文件过大，请限制在 2MB 以内');
                e.target.value = null;
                return;
            }
            const reader = new FileReader();
            reader.onload = async (evt) => {
                const base64 = evt.target.result;
                if (e.target.id === 'global-send-sound-upload') {
                    db.globalSendSound = base64;
                    document.getElementById('global-send-sound-url').value = base64;
                } else if (e.target.id === 'global-receive-sound-upload') {
                    db.globalReceiveSound = base64;
                    document.getElementById('global-receive-sound-url').value = base64;
                } else if (e.target.id === 'global-message-sent-sound-upload') {
                    db.globalMessageSentSound = base64;
                    document.getElementById('global-message-sent-sound-url').value = base64;
                } else {
                    db.globalIncomingCallSound = base64;
                    document.getElementById('global-incoming-call-sound-url').value = base64;
                }
                await saveData();
                showToast('提示音已上传');
            };
            reader.readAsDataURL(file);
            e.target.value = null;
        }

        // 本地字体上传
        if (e.target.id === 'local-font-upload') {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = async (evt) => {
                const arrayBuffer = evt.target.result;
                
                if (!db.fontBuffer || db.fontBuffer.constructor === ArrayBuffer) {
                    db.fontBuffer = {};
                }
                db.fontBuffer[file.name] = arrayBuffer;
                
                db.fontUrl = 'local:' + file.name;
                db.localFontName = file.name;
                
                const fontUrlInput = document.getElementById('customize-font-url');
                if (fontUrlInput) fontUrlInput.value = '';
                
                const nameEl = document.getElementById('local-font-name');
                if (nameEl) {
                    nameEl.textContent = '已加载本地字体：' + file.name;
                    nameEl.style.display = 'block';
                }
                
                await saveData();
                applyGlobalFont(db.fontUrl);
                showToast('本地字体已应用！');
            };
            reader.readAsArrayBuffer(file);
            e.target.value = null;
        }
    });
}

function renderCustomizeForm() {
    const customizeForm = document.getElementById('customize-form');
    customizeForm.innerHTML = ''; 
    
    const container = document.createElement('div');
    container.className = 'kkt-settings-container';
    
    const iconOrder = [
        'chat-list-screen', 'api-settings-screen', 'wallpaper-screen',
        'world-book-screen', 'customize-screen', 'tutorial-screen',
        'storage-analysis-screen', 'appearance-settings-screen', 'theater-screen', 'magic-room-screen'
    ];

    let iconsContentHTML = '';
    iconOrder.forEach(id => {
        const { name, url } = defaultIcons[id];
        const currentIcon = (db.customIcons && db.customIcons[id]) || url;
        iconsContentHTML += `
        <div class="kkt-item">
            <div class="kkt-item-label">
                <img src="${currentIcon}" alt="${name}" class="kkt-small-avatar" id="icon-preview-${id}" style="width: 40px; height: 40px; border-radius: 10px; margin-right: 10px; object-fit: cover;">
                <span>${name || '模式切换'}</span>
            </div>
            <div class="kkt-item-control" style="gap: 8px;">
                <input type="url" placeholder="URL" value="${(db.customIcons && db.customIcons[id]) || ''}" data-icon-id="${id}" style="text-align:right; border:none; background:transparent; width: 100px; font-size: 13px; color: #888;">
                <input type="file" id="upload-icon-${id}" data-icon-id="${id}" accept="image/*" style="display:none;" class="icon-upload-input">
                <label for="upload-icon-${id}" class="btn btn-small btn-neutral" style="padding: 4px 8px; font-size: 12px; margin: 0; cursor: pointer;">📷</label>
                <button type="button" class="reset-icon-btn btn btn-small" data-id="${id}" style="padding: 4px 8px; font-size: 12px; margin: 0; background-color: #f0f0f0; color: #666; border:none;">↺</button>
            </div>
        </div>`;
    });

    const iconsSectionHTML = `
    <div class="kkt-group collapsible-section" style="background-color: #fff; border: none; margin-bottom: 15px;">
        <div class="kkt-item collapsible-header" style="background-color: #fff; border-bottom: 1px solid #f5f5f5; cursor: pointer; padding: 15px;">
            <div class="kkt-item-label" style="font-weight:bold; color:#333; font-size: 15px;">应用图标自定义</div>
            <span class="collapsible-arrow">▼</span>
        </div>
        <div class="collapsible-content">
            ${iconsContentHTML}
            <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin:15px 15px 15px 15px; border: 1px solid #f0f0f0;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                    <label for="icon-preset-select" style="width:auto;color:#666;font-size:13px;">图标预设库</label>
                    <select id="icon-preset-select" style="flex:1;padding:6px;border-radius:6px;border:1px solid #ddd;font-size:13px; background: transparent;"><option value="">— 选择 —</option></select>
                </div>
                <div style="display:flex;gap:8px;justify-content: flex-end;">
                    <button type="button" id="icon-apply-preset-btn" class="btn btn-small btn-primary" style="padding:4px 8px;">应用</button>
                    <button type="button" id="icon-save-preset-btn" class="btn btn-small" style="padding:4px 8px;">保存</button>
                    <button type="button" id="icon-manage-presets-btn" class="btn btn-small" style="padding:4px 8px;">管理</button>
                </div>
            </div>
        </div>
    </div>
    `;

    let namesContentHTML = '';
    iconOrder.forEach(id => {
        const { name } = defaultIcons[id];
        const currentName = (db.customAppNames && db.customAppNames[id]) || '';
        namesContentHTML += `
        <div class="kkt-item">
            <div class="kkt-item-label">
                <span style="font-size:14px;">${name}</span>
            </div>
            <div class="kkt-item-control" style="gap: 8px;">
                <input type="text" placeholder="${name}" value="${currentName}" data-name-id="${id}" style="text-align:right; border:none; background:transparent; width: 120px; font-size: 13px; color: #888;">
                <button type="button" class="reset-name-btn btn btn-small" data-name-reset-id="${id}" style="padding: 4px 8px; font-size: 12px; margin: 0; background-color: #f0f0f0; color: #666; border:none;">↺</button>
            </div>
        </div>`;
    });

    const namesSectionHTML = `
    <div class="kkt-group collapsible-section" style="background-color: #fff; border: none; margin-bottom: 15px;">
        <div class="kkt-item collapsible-header" style="background-color: #fff; border-bottom: 1px solid #f5f5f5; cursor: pointer; padding: 15px;">
            <div class="kkt-item-label" style="font-weight:bold; color:#333; font-size: 15px;">应用名称自定义</div>
            <span class="collapsible-arrow">▼</span>
        </div>
        <div class="collapsible-content">
            ${namesContentHTML}
            <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin:15px 15px 15px 15px; border: 1px solid #f0f0f0;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                    <label for="name-preset-select" style="width:auto;color:#666;font-size:13px;">名称预设库</label>
                    <select id="name-preset-select" style="flex:1;padding:6px;border-radius:6px;border:1px solid #ddd;font-size:13px; background: transparent;"><option value="">— 选择 —</option></select>
                </div>
                <div style="display:flex;gap:8px;justify-content: flex-end;">
                    <button type="button" id="name-apply-preset-btn" class="btn btn-small btn-primary" style="padding:4px 8px;">应用</button>
                    <button type="button" id="name-save-preset-btn" class="btn btn-small" style="padding:4px 8px;">保存</button>
                    <button type="button" id="name-manage-presets-btn" class="btn btn-small" style="padding:4px 8px;">管理</button>
                </div>
            </div>
            <div style="padding: 15px; display: flex; justify-content: flex-end;">
                <button type="button" id="reset-all-names-btn" class="btn btn-neutral btn-small" style="width: auto;">全部重置</button>
            </div>
        </div>
    </div>
    `;
const globalCssSectionHTML = `
    <div class="kkt-group collapsible-section" style="background-color: #fff; border: none; margin-bottom: 15px;">
        <div class="kkt-item collapsible-header" style="background-color: #fff; border-bottom: 1px solid #f5f5f5; cursor: pointer; padding: 15px;">
            <div class="kkt-item-label" style="font-weight:bold; color:#333; font-size: 15px;">全局CSS美化</div>
            <span class="collapsible-arrow">▼</span>
        </div>
        <div class="collapsible-content">
            <div class="kkt-item" style="display:block; padding: 15px;">
                <div class="form-group" style="margin-bottom: 15px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <label for="global-beautification-css" style="font-weight: bold; font-size: 14px; color: var(--primary-color); margin-bottom: 0;">CSS代码</label>
                        <div style="display: flex; gap: 8px;">
                            <button type="button" id="global-css-import-doc-btn" class="btn btn-small" style="width:auto;">导入文档</button>
                            <button type="button" id="apply-global-css-now-btn" class="btn btn-primary btn-small" style="width:auto;">立即应用</button>
                            <button type="button" id="reset-global-css-btn" class="btn btn-small" style="width:auto;">重置</button>
                        </div>
                    </div>
                    <input type="file" id="global-css-import-file" accept=".txt,.docx" style="display:none;">
                    <textarea id="global-beautification-css" class="form-group" rows="8" placeholder="在此输入CSS代码..." style="width:100%; border:1px solid #eee; border-radius:8px; padding:10px;"></textarea>
                </div>
                
                <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-bottom:15px; border: 1px solid #f0f0f0;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                        <label for="global-css-preset-select" style="width:auto;color:#666;font-size:13px;">预设库</label>
                        <select id="global-css-preset-select" style="flex:1;padding:6px;border-radius:6px;border:1px solid #ddd;font-size:13px; background: transparent;"><option value="">-- 选择 --</option></select>
                    </div>
                    <div style="display:flex;gap:8px;justify-content: flex-end;">
                        <button type="button" id="global-css-apply-btn" class="btn btn-small btn-primary" style="padding:4px 8px;">应用</button>
                        <button type="button" id="global-css-save-btn" class="btn btn-small" style="padding:4px 8px;">保存</button>
                        <button type="button" id="global-css-manage-btn" class="btn btn-small" style="padding:4px 8px;">管理</button>
                    </div>
                </div>

                <div class="css-template-module" style="border-top: 1px solid #eee; padding-top: 15px;">
                    <h5 style="font-size: 14px; color: var(--secondary-color); margin-bottom: 15px; margin-top: 0;">拓展美化代码库</h5>
                    <div class="css-template-list" style="display: flex; flex-direction: column; gap: 10px;">

                        <div class="css-template-card" style="background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                <h6 style="margin: 0; font-size: 1em; color: #333;">隐藏聊天顶栏线</h6>
                                <button type="button" class="btn btn-secondary btn-small copy-css-btn">复制</button>
                            </div>
                            <pre style="background: #f5f5f5; padding: 10px; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; font-size: 12px; max-height: 150px; overflow-y: auto;"><code>/* --- 3. 进入聊天界面-顶部栏的底部那条线的隐藏 --- */
#chat-room-screen .app-header {
border-bottom: none !important;
}</code></pre>
                        </div>
                    
                        <div class="css-template-card" style="background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                <h6 style="margin: 0; font-size: 1em; color: #333;">隐藏头像</h6>
                                <button type="button" class="btn btn-secondary btn-small copy-css-btn">复制</button>
                            </div>
                            <pre style="background: #f5f5f5; padding: 10px; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; font-size: 12px; max-height: 150px; overflow-y: auto;"><code>/* --- 隐藏聊天界面的所有头像和时间戳 --- */
.message-info {
display: none !important;
}

/* --- 修正语音和翻译气泡的边距 --- */
.voice-transcript, .translation-text {
margin-left: 8px !important;
margin-right: 8px !important;
}

/* 确保发送方的语音/翻译气泡仍然正确对齐 */
.message-wrapper.sent .voice-transcript,
.message-wrapper.sent .translation-text {
align-self: flex-end;
margin-left: auto !important;
}</code></pre>
                        </div>

                        <div class="css-template-card" style="background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                <div>
                                    <h6 style="margin: 0; font-size: 1em; color: #333;">iOS 灵动岛/刘海屏防遮挡适配补丁</h6>
                                    <span style="font-size: 12px; color: #999;">作者：1900</span>
                                </div>
                                <button type="button" class="btn btn-secondary btn-small copy-css-btn">复制</button>
                            </div>
                            <pre style="background: #f5f5f5; padding: 10px; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; font-size: 12px; max-height: 150px; overflow-y: auto;"><code>/* --- iOS 灵动岛/刘海屏防遮挡适配补丁 --- */

/* 1. 修复所有页面通用顶栏 (如聊天、列表、功能页) */
.app-header {
    padding-top: calc(15px + env(safe-area-inset-top)) !important;
    height: auto !important;
}

/* 2. 修复主屏幕 (锁屏/桌面) 小组件遮挡 */
#home-screen {
    padding-top: calc(45px + env(safe-area-inset-top)) !important;
}

/* 3. 修复右侧滑出的设置菜单顶栏遮挡 */
.settings-sidebar .header {
    padding-top: calc(15px + env(safe-area-inset-top)) !important;
}

/* 4. (可选) 底部小横条防遮挡输入框 */
.message-input-area,
#multi-select-bar,
#world-book-multi-select-bar {
    padding-bottom: calc(10px + env(safe-area-inset-bottom)) !important;
}</code></pre>
                        </div>

                        <div class="css-template-card" style="background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.05);">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                <div>
                                    <h6 style="margin: 0; font-size: 1em; color: #333;">核心容器尺寸调整：全宽幅矮窗</h6>
                                    <span style="font-size: 12px; color: #999;">作者：萤火</span>
                                </div>
                                <button type="button" class="btn btn-secondary btn-small copy-css-btn">复制</button>
                            </div>
                            <pre style="background: #f5f5f5; padding: 10px; border-radius: 8px; white-space: pre-wrap; word-wrap: break-word; font-size: 12px; max-height: 150px; overflow-y: auto;"><code>/* =========================================================
   核心容器尺寸调整：全宽幅矮窗 (左右贴边·垂直居中)
   ========================================================= */

/* 1. 主容器：全宽 + 垂直百分比缩放 */
#chat-room-screen {
    position: fixed !important;
    top: 50% !important;
    left: 0 !important;
    right: 0 !important;
    transform: translateY(-50%) !important;
    width: 100% !important;
    max-width: 100% !important;
    height: 70vh !important;
    max-height: 100vh !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
    z-index: 59 !important;
    box-shadow: none !important;
    border: none !important;
    border-radius: 0 !important;
}

/* 2. 底部输入栏：跟随容器宽度 */
.bottom-input-area,
.chat-input-wrapper {
    position: absolute !important;
    bottom: 0 !important;
    left: 0 !important;
    right: 0 !important;
    width: 100% !important;
    margin: 0 !important;
    transform: none !important;
    z-index: 100 !important;
}

/* 3. 顶部栏：跟随容器宽度 */
.app-header,
#chat-room-header-default {
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    width: 100% !important;
    z-index: 100 !important;
    border-radius: 0 !important;
}

/* 4. 内容区域：保留原有背景 */
.content {
    position: relative !important;
    width: auto !important;
    height: auto !important;
    min-height: 100% !important;
    padding-top: 60px !important;
    padding-bottom: 35px !important;
    box-sizing: border-box !important;
    overflow-y: auto !important;
    background: none !important;
    background-color: transparent !important;
}

/* 5. 消息区域 */
.message-area {
    width: 100% !important;
    box-sizing: border-box !important;
    min-height: 100% !important;
}</code></pre>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    </div>
    `;
    
    const fontsSectionHTML = `
    <div class="kkt-group collapsible-section" style="background-color: #fff; border: none; margin-bottom: 15px;">
        <div class="kkt-item collapsible-header" style="background-color: #fff; border-bottom: 1px solid #f5f5f5; cursor: pointer; padding: 15px;">
            <div class="kkt-item-label" style="font-weight:bold; color:#333; font-size: 15px;">字体设置</div>
            <span class="collapsible-arrow">▼</span>
        </div>
        <div class="collapsible-content">
            <div class="kkt-item" style="display:block; padding: 15px;">
                <!-- Font Size Slider -->
                <div class="form-group" style="margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 10px;">
                        <label style="font-weight: bold; font-size: 14px; color: var(--primary-color);">全局字体大小</label>
                        <span id="font-size-value" style="color: var(--primary-color); font-weight: bold;">${(db.fontSizeScale || 1.0).toFixed(1)}x</span>
                    </div>
                    <input type="range" id="font-size-slider" min="0.8" max="1.5" step="0.1" value="${db.fontSizeScale || 1.0}" style="width: 100%; accent-color: var(--primary-color);">
                </div>

                <div class="form-group">
                    <label for="customize-font-url" style="font-weight: bold; font-size: 14px; color: var(--primary-color);">字体文件 URL</label>
                    <div style="display: flex; gap: 8px; margin-top: 5px;">
                        <input type="url" id="customize-font-url" placeholder="例如：https://example.com/font.woff2" value="${db.fontUrl && !db.fontUrl.startsWith('data:') ? db.fontUrl : ''}" style="flex:1; border:1px solid #eee; border-radius:8px; padding:10px;">
                        <input type="file" id="local-font-upload" accept=".woff2,.woff,.ttf,.otf,.eot,.svg,.ttc" style="display: none;">
                        <label for="local-font-upload" class="btn btn-secondary btn-small" style="margin: 0; display: flex; align-items: center; cursor: pointer; white-space: nowrap;">📂 本地上传</label>
                    </div>
                    <p id="local-font-name" style="font-size: 12px; color: var(--primary-color); margin-top: 5px; display: ${db.fontUrl && db.fontUrl.startsWith('data:') ? 'block' : 'none'};">${db.localFontName ? '已加载本地字体：' + db.localFontName : ''}</p>
                    <p style="font-size: 12px; color: #999; margin-top: 5px;">支持 woff2, woff, ttf, otf, eot, svg, ttc 格式。设置后将应用到全局。</p>
                    <p style="font-size: 12px; color: #e67e22; margin-top: 3px;">⚠️ 本地上传限制 5MB，过大的字体文件可能导致应用闪退，建议使用较小的字体文件或使用 URL 链接。</p>
                </div>

                <!-- 字体预设管理区域 -->
                <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-top:15px; margin-bottom:15px; border: 1px solid #f0f0f0;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                        <label for="font-preset-select" style="width:auto;color:#666;font-size:13px;">预设库</label>
                        <select id="font-preset-select" style="flex:1;padding:6px;border-radius:6px;border:1px solid #ddd;font-size:13px; background: transparent;"><option value="">— 选择 —</option></select>
                    </div>
                    <div style="display:flex;gap:8px;justify-content: flex-end;">
                        <button type="button" id="font-apply-preset-btn" class="btn btn-small btn-primary" style="padding:4px 8px;">应用</button>
                        <button type="button" id="font-save-preset-btn" class="btn btn-small" style="padding:4px 8px;">保存</button>
                        <button type="button" id="font-manage-presets-btn" class="btn btn-small" style="padding:4px 8px;">管理</button>
                    </div>
                </div>

                <div style="display:flex; gap:10px; justify-content: flex-end; margin-top: 15px;">
                    <button type="button" id="restore-font-btn" class="btn btn-neutral btn-small">恢复默认</button>
                    <button type="button" id="apply-font-btn" class="btn btn-primary btn-small">直接应用</button>
                </div>
            </div>
        </div>
    </div>
    `;

    const soundSectionHTML = `
    <div class="kkt-group collapsible-section" style="background-color: #fff; border: none; margin-bottom: 15px;">
        <div class="kkt-item collapsible-header" style="background-color: #fff; border-bottom: 1px solid #f5f5f5; cursor: pointer; padding: 15px;">
            <div class="kkt-item-label" style="font-weight:bold; color:#333; font-size: 15px;">提示音设置</div>
            <span class="collapsible-arrow">▼</span>
        </div>
        <div class="collapsible-content">
            <div class="kkt-item" style="display:block; padding: 15px;">
                <div class="form-group" style="margin-bottom: 15px;">
                    <label style="font-weight: bold; font-size: 14px; color: var(--primary-color);">开始生成提示音</label>
                    <div style="display: flex; gap: 8px; margin-top: 5px;">
                        <input type="url" id="global-send-sound-url" placeholder="音频URL" value="${db.globalSendSound || ''}" style="flex: 1; border: 1px solid #eee; border-radius: 8px; padding: 8px;">
                        <input type="file" id="global-send-sound-upload" accept="audio/*" style="display: none;">
                        <label for="global-send-sound-upload" class="btn btn-secondary btn-small" style="margin: 0; display: flex; align-items: center; cursor: pointer;">📂</label>
                        <button type="button" id="test-send-sound-btn" class="btn btn-primary btn-small" style="margin: 0;">▶</button>
                        <button type="button" id="reset-send-sound-btn" class="btn btn-danger btn-small" style="margin: 0;">×</button>
                    </div>
                </div>
                <div class="form-group">
                    <label style="font-weight: bold; font-size: 14px; color: var(--primary-color);">收到回复提示音</label>
                    <div style="display: flex; gap: 8px; margin-top: 5px;">
                        <input type="url" id="global-receive-sound-url" placeholder="音频URL" value="${db.globalReceiveSound || ''}" style="flex: 1; border: 1px solid #eee; border-radius: 8px; padding: 8px;">
                        <input type="file" id="global-receive-sound-upload" accept="audio/*" style="display: none;">
                        <label for="global-receive-sound-upload" class="btn btn-secondary btn-small" style="margin: 0; display: flex; align-items: center; cursor: pointer;">📂</label>
                        <button type="button" id="test-receive-sound-btn" class="btn btn-primary btn-small" style="margin: 0;">▶</button>
                        <button type="button" id="reset-receive-sound-btn" class="btn btn-danger btn-small" style="margin: 0;">×</button>
                    </div>
                </div>
                <div class="form-group">
                    <label style="font-weight: bold; font-size: 14px; color: var(--primary-color);">发消息提示音</label>
                    <div style="display: flex; gap: 8px; margin-top: 5px;">
                        <input type="url" id="global-message-sent-sound-url" placeholder="音频URL" value="${db.globalMessageSentSound || ''}" style="flex: 1; border: 1px solid #eee; border-radius: 8px; padding: 8px;">
                        <input type="file" id="global-message-sent-sound-upload" accept="audio/*" style="display: none;">
                        <label for="global-message-sent-sound-upload" class="btn btn-secondary btn-small" style="margin: 0; display: flex; align-items: center; cursor: pointer;">📂</label>
                        <button type="button" id="test-message-sent-sound-btn" class="btn btn-primary btn-small" style="margin: 0;">▶</button>
                        <button type="button" id="reset-message-sent-sound-btn" class="btn btn-danger btn-small" style="margin: 0;">×</button>
                    </div>
                    <p style="font-size: 12px; color: #999; margin-top: 5px;">在输入框发送一条消息时播放。不设置则发送时不播放。</p>
                </div>
                <div class="form-group">
                    <label style="font-weight: bold; font-size: 14px; color: var(--primary-color);">来电提示音</label>
                    <div style="display: flex; gap: 8px; margin-top: 5px;">
                        <input type="url" id="global-incoming-call-sound-url" placeholder="音频URL" value="${db.globalIncomingCallSound || ''}" style="flex: 1; border: 1px solid #eee; border-radius: 8px; padding: 8px;">
                        <input type="file" id="global-incoming-call-sound-upload" accept="audio/*" style="display: none;">
                        <label for="global-incoming-call-sound-upload" class="btn btn-secondary btn-small" style="margin: 0; display: flex; align-items: center; cursor: pointer;">📂</label>
                        <button type="button" id="test-incoming-call-sound-btn" class="btn btn-primary btn-small" style="margin: 0;">▶</button>
                        <button type="button" id="reset-incoming-call-sound-btn" class="btn btn-danger btn-small" style="margin: 0;">×</button>
                    </div>
                    <p style="font-size: 12px; color: #999; margin-top: 5px;">角色主动发起通话时循环播放，接听或拒绝后停止。不设置则来电时不播放任何声音。</p>
                </div>
                
                <div class="form-group" style="margin-top: 15px; display: flex; justify-content: space-between; align-items: center;">
                    <label for="multi-msg-sound-switch" style="font-weight: bold; font-size: 14px; color: var(--primary-color); margin-bottom: 0;">多条消息连续提示音</label>
                    <label class="switch">
                        <input type="checkbox" id="multi-msg-sound-switch" ${db.multiMsgSoundEnabled ? 'checked' : ''}>
                        <span class="slider round"></span>
                    </label>
                </div>
                <p style="font-size: 12px; color: #999; margin-top: 5px;">开启后，AI 连续回复的多条消息（气泡）都会触发提示音。关闭则仅第一条触发。</p>

                <p style="font-size: 12px; color: #999; margin-top: 10px;">支持 URL 或本地上传 (mp3, wav, ogg)。本地文件将转为 Base64 存储 (限 2MB)。</p>

                <!-- 提示音预设管理区域 -->
                <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-top:15px; margin-bottom:15px; border: 1px solid #f0f0f0;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                        <label for="sound-preset-select" style="width:auto;color:#666;font-size:13px;">预设库</label>
                        <select id="sound-preset-select" style="flex:1;padding:6px;border-radius:6px;border:1px solid #ddd;font-size:13px; background: transparent;"><option value="">— 选择 —</option></select>
                    </div>
                    <div style="display:flex;gap:8px;justify-content: flex-end;">
                        <button type="button" id="sound-apply-preset-btn" class="btn btn-small btn-primary" style="padding:4px 8px;">应用</button>
                        <button type="button" id="sound-save-preset-btn" class="btn btn-small" style="padding:4px 8px;">保存</button>
                        <button type="button" id="sound-manage-presets-btn" class="btn btn-small" style="padding:4px 8px;">管理</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `;
    
    // ---------- 夜间模式设置 ----------
    const nightSettings = db.nightModeSettings || {};
    const DEFAULT_NIGHT_MODE_CSS = `/* 基础颜色变量 */
body.night-mode-active {
    --bg-color: #121212;
    --text-color: #e0e0e0;
    --white-color: #e0e0e0;
    --primary-color: #1e1e1e;
    --secondary-color: #666;
    --accent-color: #1e1e1e;
    --top-pinned-bg: #1a1a1a;
    --panel-bg: #181818;
    --chat-bottom-bar-bg: #181818;
    --folder-pill-bg: #1e1e1e;
    --folder-pill-text: #bbb;
    --folder-pill-active-bg: #333;
    --folder-pill-active-text: #fff;
    --global-title-color: #e0e0e0;
    --nav-icon-color: #777;
    --nav-active-icon-color: #e0e0e0;
    --kkt-icon-color: #e0e0e0;
    --func-icon-color: #e0e0e0;
}

/* 背景色设置 */
body.night-mode-active, 
body.night-mode-active .phone-screen, 
body.night-mode-active .screen, 
body.night-mode-active .content,
body.night-mode-active .chat-item {
    background-color: #121212 !important;
}

/* 头部栏与底部栏 */
body.night-mode-active .app-header,
body.night-mode-active .bottom-nav {
    background-color: #181818 !important;
    border-color: #222 !important;
}

/* 聊天气泡 */
body.night-mode-active .message-bubble {
    background-color: #1e1e1e !important;
    color: #e0e0e0 !important;
}
body.night-mode-active .message-wrapper.sent .message-bubble {
    background-color: #2a2a2a !important;
}

/* 输入区域 */
body.night-mode-active .message-input-area {
    background-color: #181818 !important;
    border-top-color: #222 !important;
}
body.night-mode-active .message-input-area textarea {
    background-color: #1e1e1e !important;
    color: #e0e0e0 !important;
}`;
// ---------- 顶栏状态栏设置 ----------
    const statusBarSettings = db.homeStatusBarSettings || {};
    const statusBarSectionHTML = `
    <div class="kkt-group collapsible-section" style="background-color: #fff; border: none; margin-bottom: 15px;">
        <div class="kkt-item collapsible-header" style="background-color: #fff; border-bottom: 1px solid #f5f5f5; cursor: pointer; padding: 15px;">
            <div class="kkt-item-label" style="font-weight:bold; color:#333; font-size: 15px;">顶栏电量 + 时间</div>
            <span class="collapsible-arrow">▼</span>
        </div>
        <div class="collapsible-content">
            <div class="kkt-item" style="display:block; padding: 15px;">
                <p style="font-size: 13px; color: #888; margin-bottom: 12px; line-height: 1.5;">在所有页面顶部透明显示实时时间和电量，融入界面不遮挡。可自定义顶栏容器、时间、电量的 CSS 样式。</p>

                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                    <label style="font-size:14px; color:#333;">显示顶栏状态栏</label>
                    <label class="kkt-switch"><input type="checkbox" id="home-statusbar-enabled" ${statusBarSettings.enabled ? 'checked' : ''}><span class="kkt-slider"></span></label>
                </div>

                <div style="background:#f5f5f5; border-radius:10px; padding:10px 16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; font-size:13px; color:#333;">
                    <span id="statusbar-preview-time" style="font-weight:600;">--:--</span>
                    <span style="display:flex; align-items:center; gap:4px;">
                        <svg width="18" height="11" viewBox="0 0 24 12" fill="none"><path d="M1 2.5C1 1.95 1.45 1.5 2 1.5H20C20.55 1.5 21 1.95 21 2.5V9.5C21 10.05 20.55 10.5 20 10.5H2C1.45 10.5 1 10.05 1 9.5V2.5Z" stroke="#666" stroke-width="1"/><path d="M22.5 4V8" stroke="#666" stroke-width="1.5" stroke-linecap="round"/><rect id="statusbar-preview-battery-fill" x="2" y="2.5" width="18" height="7" rx="0.5" fill="#666"/></svg>
                        <span id="statusbar-preview-level">--%</span>
                    </span>
                </div>

                <div style="margin-bottom:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <label style="font-size:14px; color:#333;">顶栏容器 CSS</label>
                    </div>
                    <textarea id="statusbar-container-css" rows="4" placeholder="例如：\nbackground: transparent;\ncolor: #333;\nborder-radius: 0;" style="width:100%; border:1px solid #eee; border-radius:8px; padding:10px; font-size:12px; font-family:monospace;">${statusBarSettings.containerCss !== undefined ? statusBarSettings.containerCss : 'background: transparent;\ncolor: #333;\nborder-radius: 0;'}</textarea>
                </div>

                <div style="margin-bottom:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <label style="font-size:14px; color:#333;">时间样式 CSS</label>
                    </div>
                    <textarea id="statusbar-time-css" rows="3" placeholder="例如：\nfont-size: 14px;\nfont-weight: bold;\ncolor: #333;" style="width:100%; border:1px solid #eee; border-radius:8px; padding:10px; font-size:12px; font-family:monospace;">${statusBarSettings.timeCss !== undefined ? statusBarSettings.timeCss : 'font-size: 14px;\nfont-weight: bold;\ncolor: #333;'}</textarea>
                </div>

                <div style="margin-bottom:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <label style="font-size:14px; color:#333;">电量样式 CSS</label>
                    </div>
                    <textarea id="statusbar-battery-css" rows="3" placeholder="例如：\nfont-size: 12px;\ncolor: #4CAF50;" style="width:100%; border:1px solid #eee; border-radius:8px; padding:10px; font-size:12px; font-family:monospace;">${statusBarSettings.batteryCss !== undefined ? statusBarSettings.batteryCss : 'font-size: 12px;\ncolor: #4CAF50;'}</textarea>
                </div>

                <div style="display:flex; gap:8px; justify-content:flex-end; margin-bottom:8px;">
                    <button type="button" id="statusbar-apply-btn" class="btn btn-primary btn-small" style="padding:4px 8px;">应用</button>
                    <button type="button" id="statusbar-reset-btn" class="btn btn-small" style="padding:4px 8px;">重置</button>
                </div>
                <div style="display:flex; gap:8px; justify-content:flex-end;">
                    <button type="button" id="statusbar-export-btn" class="btn btn-small btn-neutral" style="padding:4px 8px;">导出配置</button>
                    <button type="button" id="statusbar-import-btn" class="btn btn-small btn-neutral" style="padding:4px 8px;">导入配置</button>
                    <input type="file" id="statusbar-import-file" accept=".json" style="display:none;">
                </div>
            </div>
        </div>
    </div>
    `;

    container.innerHTML = iconsSectionHTML + namesSectionHTML + fontsSectionHTML + soundSectionHTML + globalCssSectionHTML + statusBarSectionHTML;
    customizeForm.appendChild(container);

    populateGlobalCssPresetSelect();
    populateFontPresetSelect();
    populateSoundPresetSelect();
    populateIconPresetSelect();
    populateNamePresetSelect();
    populateVoicePresetSelect();

    const fontSizeSlider = document.getElementById('font-size-slider');
    const fontSizeValue = document.getElementById('font-size-value');
    if (fontSizeSlider) {
        fontSizeSlider.addEventListener('input', (e) => {
            const scale = parseFloat(e.target.value);
            fontSizeValue.textContent = `${scale.toFixed(1)}x`;
            applyFontSize(scale);
        });
        fontSizeSlider.addEventListener('change', async (e) => {
            const scale = parseFloat(e.target.value);
            db.fontSizeScale = scale;
            await saveData();
            showToast('字体大小已保存');
        });
    }

    const globalCssTextarea = document.getElementById('global-beautification-css');
    if (globalCssTextarea) {
        globalCssTextarea.value = db.globalCss || '';
    }

    // ---------- 夜间模式事件绑定 ----------
    // ---------- 顶栏状态栏事件绑定 ----------
    setupStatusBarBindings();
}

// ============================================
// 夜间模式
// ============================================

// ============================================
// 顶栏状态栏
// ============================================

function setupStatusBarBindings() {
    const enabledCb = document.getElementById('home-statusbar-enabled');
    const containerCssArea = document.getElementById('statusbar-container-css');
    const timeCssArea = document.getElementById('statusbar-time-css');
    const batteryCssArea = document.getElementById('statusbar-battery-css');

    // 实时预览
    updateStatusBarPreviewInSettings();

    if (enabledCb) enabledCb.addEventListener('change', async () => {
        if (!db.homeStatusBarSettings) db.homeStatusBarSettings = {};
        db.homeStatusBarSettings.enabled = enabledCb.checked;
        await saveData();
        applyHomeStatusBar();
        showToast(enabledCb.checked ? '顶栏状态栏已开启' : '顶栏状态栏已关闭');
    });

    document.getElementById('statusbar-apply-btn')?.addEventListener('click', async () => {
        if (!db.homeStatusBarSettings) db.homeStatusBarSettings = {};
        db.homeStatusBarSettings.containerCss = containerCssArea?.value || '';
        db.homeStatusBarSettings.timeCss = timeCssArea?.value || '';
        db.homeStatusBarSettings.batteryCss = batteryCssArea?.value || '';
        await saveData();
        applyHomeStatusBar();
        showToast('顶栏样式已应用');
    });

    document.getElementById('statusbar-reset-btn')?.addEventListener('click', async () => {
        if (!db.homeStatusBarSettings) db.homeStatusBarSettings = {};
        db.homeStatusBarSettings.containerCss = '';
        db.homeStatusBarSettings.timeCss = '';
        db.homeStatusBarSettings.batteryCss = '';
        if (containerCssArea) containerCssArea.value = '';
        if (timeCssArea) timeCssArea.value = '';
        if (batteryCssArea) batteryCssArea.value = '';
        await saveData();
        applyHomeStatusBar();
        showToast('顶栏样式已重置');
    });

    // 导出
    document.getElementById('statusbar-export-btn')?.addEventListener('click', () => {
        const payload = { type: 'home-statusbar-config', settings: db.homeStatusBarSettings || {} };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '顶栏状态栏配置.json';
        a.click();
        URL.revokeObjectURL(a.href);
        showToast('顶栏配置已导出');
    });

    // 导入
    document.getElementById('statusbar-import-btn')?.addEventListener('click', () => {
        document.getElementById('statusbar-import-file')?.click();
    });
    document.getElementById('statusbar-import-file')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const data = JSON.parse(reader.result);
                if (!data || data.type !== 'home-statusbar-config' || !data.settings) {
                    showToast('不是有效的顶栏配置文件');
                    return;
                }
                db.homeStatusBarSettings = data.settings;
                await saveData();
                applyHomeStatusBar();
                renderCustomizeForm();
                showToast('顶栏配置已导入');
            } catch (_) {
                showToast('文件解析失败');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });
}

function updateStatusBarPreviewInSettings() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timeEl = document.getElementById('statusbar-preview-time');
    if (timeEl) timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

    if ('getBattery' in navigator) {
        navigator.getBattery().then(battery => {
            const level = Math.floor(battery.level * 100);
            const levelEl = document.getElementById('statusbar-preview-level');
            const fillEl = document.getElementById('statusbar-preview-battery-fill');
            if (levelEl) levelEl.textContent = `${level}%`;
            if (fillEl) fillEl.setAttribute('width', 18 * battery.level);
        }).catch(() => {});
    }
}

function applyHomeStatusBar() {
    const phoneScreen = document.querySelector('.phone-screen');
    if (!phoneScreen) return;
    const settings = db.homeStatusBarSettings || {};
    let bar = phoneScreen.querySelector('.home-top-statusbar');

    if (!settings.enabled) {
        if (bar) bar.remove();
        document.body.classList.remove('has-statusbar');
        let styleEl = document.getElementById('home-statusbar-custom-style');
        if (styleEl) styleEl.textContent = '';
        return;
    }
    
    document.body.classList.add('has-statusbar');

    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'home-top-statusbar';
        bar.innerHTML = `
            <span class="htsb-time"></span>
            <span class="htsb-battery">
                <svg width="18" height="11" viewBox="0 0 24 12" fill="none">
                    <path d="M1 2.5C1 1.95 1.45 1.5 2 1.5H20C20.55 1.5 21 1.95 21 2.5V9.5C21 10.05 20.55 10.5 20 10.5H2C1.45 10.5 1 10.05 1 9.5V2.5Z" stroke="currentColor" stroke-width="1"/>
                    <path d="M22.5 4V8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    <rect class="htsb-battery-fill" x="2" y="2.5" width="18" height="7" rx="0.5" fill="currentColor"/>
                </svg>
                <span class="htsb-battery-level">--%</span>
            </span>`;
        phoneScreen.insertBefore(bar, phoneScreen.firstChild);
    }

    // 更新时间
    const pad = n => String(n).padStart(2, '0');
    const updateBar = () => {
        const now = new Date();
        const timeEl = bar.querySelector('.htsb-time');
        if (timeEl) timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    };
    updateBar();

    // 更新电量
    if ('getBattery' in navigator) {
        navigator.getBattery().then(battery => {
            const updateBat = () => {
                const level = Math.floor(battery.level * 100);
                const levelEl = bar.querySelector('.htsb-battery-level');
                const fillEl = bar.querySelector('.htsb-battery-fill');
                if (levelEl) levelEl.textContent = `${level}%`;
                if (fillEl) fillEl.setAttribute('width', 18 * battery.level);
            };
            updateBat();
            battery.addEventListener('levelchange', updateBat);
            battery.addEventListener('chargingchange', updateBat);
        }).catch(() => {});
    }

    // 自定义CSS
    let styleEl = document.getElementById('home-statusbar-custom-style');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'home-statusbar-custom-style';
        document.head.appendChild(styleEl);
    }
    let css = '';
    if (settings.containerCss) css += `.home-top-statusbar { ${settings.containerCss} }\n`;
    if (settings.timeCss) css += `.home-top-statusbar .htsb-time { ${settings.timeCss} }\n`;
    if (settings.batteryCss) css += `.home-top-statusbar .htsb-battery, .home-top-statusbar .htsb-battery-level { ${settings.batteryCss} }\n`;
    styleEl.textContent = css;
}

// 定时刷新顶栏时间
setInterval(() => {
    const bar = document.querySelector('.phone-screen > .home-top-statusbar .htsb-time');
    if (bar) {
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        bar.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }
}, 30000);



// ============================================
// TTS 预设管理
// ============================================

