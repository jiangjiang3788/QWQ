(function (global) {
    'use strict';

    const runtime = global.OvoCharacterSettings;
    if (!runtime) throw new Error('OvoCharacterSettings context must load first');

    function setup() {
        document.getElementById('clear-chat-history-btn')?.addEventListener('click', async () => {
            const character = db.characters.find(c => c.id === currentChatId);
            if (!character) return;
            if (confirm(`你确定要清空与“${character.remarkName}”的所有聊天记录吗？这个操作是不可恢复的！`)) {
                character.history = [];
                character.status = '在线';
                // 清除拉黑相关记忆
                character.blockHistory = [];
                character.friendRequests = [];
                character.charBlockHistory = [];
                character.userFriendRequests = [];
                character.isBlocked = false;
                character.blockedAt = null;
                character.blockReapply = null;
                character.isBlockedByChar = false;
                character.blockedByCharAt = null;
                character.blockedByCharReason = null;
                // 隐藏角色拉黑遮罩（如果有）
                var charBlockedOverlay = document.getElementById('char-blocked-overlay');
                if (charBlockedOverlay) charBlockedOverlay.style.display = 'none';
                await saveCharacter(currentChatId);
                renderMessages(false, true);
                renderChatList();
                if (currentChatId === character.id) {
                    document.getElementById('chat-room-status-text').textContent = '在线';
                }
                showToast('聊天记录已清空');
            }
        });

        // --- 导出角色卡 ---
        document.getElementById('export-ovo-card-png-btn')?.addEventListener('click', async () => {
            const character = db.characters.find(c => c.id === currentChatId);
            if (!character) return showToast('未找到角色数据');

            try {
                showToast('正在生成 PNG 角色卡...');
                let base64Image = character.avatar;

                // 如果头像是 URL，尝试 fetch 它
                if (base64Image.startsWith('http')) {
                    try {
                        const res = await fetch(base64Image);
                        const blob = await res.blob();
                        base64Image = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                    } catch (e) {
                        console.warn('获取在线头像失败，使用默认头像', e);
                        // 提供一个内置的 base64 占位图或者提醒用户无法获取
                        return showToast('无法获取在线头像，请先更换为本地上传的头像再导出 PNG');
                    }
                }

                // 清理多余的数据：聊天记录、屏蔽历史、手机操控历史等
                const exportChar = JSON.parse(JSON.stringify(character));
                delete exportChar.history;
                delete exportChar.blockHistory;
                delete exportChar.charBlockHistory;
                delete exportChar.friendRequests;
                delete exportChar.userFriendRequests;
                delete exportChar.phoneControlHistory;

                const pngDataUrl = await writeOvoPngMetadata(base64Image, exportChar);
                const a = document.createElement('a');
                a.href = pngDataUrl;
                a.download = `OVO角色卡_${character.remarkName || character.realName || '未命名'}_${new Date().toISOString().slice(0, 10)}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                showToast('PNG 角色卡导出成功');
            } catch (error) {
                console.error('导出 PNG 角色卡失败:', error);
                showToast(`导出失败: ${error.message}`);
            }
        });

        document.getElementById('export-ovo-card-json-btn')?.addEventListener('click', () => {
            const character = db.characters.find(c => c.id === currentChatId);
            if (!character) return showToast('未找到角色数据');

            // 清理多余的数据：聊天记录、屏蔽历史、手机操控历史等
            const exportChar = JSON.parse(JSON.stringify(character));
            delete exportChar.history;
            delete exportChar.blockHistory;
            delete exportChar.charBlockHistory;
            delete exportChar.friendRequests;
            delete exportChar.userFriendRequests;
            delete exportChar.phoneControlHistory;

            const jsonStr = JSON.stringify(exportChar, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `OVO角色卡_${character.remarkName || character.realName || '未命名'}_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showToast('JSON 角色卡导出成功');
        });

        // --- 聊天记录导出 ---
        document.getElementById('export-chat-history-btn')?.addEventListener('click', () => {
            const character = db.characters.find(c => c.id === currentChatId);
            if (!character) return;
            if (!character.history || character.history.length === 0) {
                showToast('当前没有聊天记录可导出');
                return;
            }
            const exportData = {
                type: 'uwu-chat-history',
                version: 1,
                charId: character.id,
                charName: character.remarkName,
                exportTime: Date.now(),
                history: character.history
            };
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `聊天记录_${character.remarkName}_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('聊天记录导出成功');
        });

        // --- 聊天记录导入 ---
        const importChatDropZone = document.getElementById('import-chat-file-drop-zone');
        const importChatFileInput = document.getElementById('import-chat-history-file');
        const importChatFileName = document.getElementById('import-chat-file-name');

        // 点击触发文件选择
        importChatDropZone?.addEventListener('click', () => importChatFileInput?.click());
        importChatFileInput?.addEventListener('change', () => {
            if (importChatFileInput.files[0]) {
                if (importChatFileName) importChatFileName.textContent = importChatFileInput.files[0].name;
                if (importChatFileName) importChatFileName.style.color = '#333';
                if (importChatDropZone) importChatDropZone.style.borderColor = '#4a9eff';
            }
        });
        // 拖拽支持
        importChatDropZone?.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (importChatDropZone) importChatDropZone.style.borderColor = '#4a9eff';
            if (importChatDropZone) importChatDropZone.style.background = 'rgba(74,158,255,0.05)';
        });
        importChatDropZone?.addEventListener('dragleave', () => {
            if (importChatDropZone) importChatDropZone.style.borderColor = '#ccc';
            if (importChatDropZone) importChatDropZone.style.background = '';
        });
        importChatDropZone?.addEventListener('drop', (e) => {
            e.preventDefault();
            if (importChatDropZone) importChatDropZone.style.borderColor = '#ccc';
            if (importChatDropZone) importChatDropZone.style.background = '';
            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith('.json')) {
                const dt = new DataTransfer();
                dt.items.add(file);
                if (importChatFileInput) importChatFileInput.files = dt.files;
                if (importChatFileName) importChatFileName.textContent = file.name;
                if (importChatFileName) importChatFileName.style.color = '#333';
                if (importChatDropZone) importChatDropZone.style.borderColor = '#4a9eff';
            } else {
                showToast('请选择 .json 文件');
            }
        });

        document.getElementById('import-chat-history-btn')?.addEventListener('click', () => {
            const character = db.characters.find(c => c.id === currentChatId);
            if (!character) return;
            // 重置文件输入和单选按钮
            importChatFileInput.value = '';
            importChatFileName.textContent = '点击选择文件或拖拽到此处';
            importChatFileName.style.color = '#999';
            importChatDropZone.style.borderColor = '#ccc';
            importChatDropZone.style.background = '';
            const appendRadio = document.querySelector('input[name="import-chat-mode"][value="append"]');
            if (appendRadio) appendRadio.checked = true;
            document.getElementById('import-chat-mode-hint').textContent = '追加：将导入的记录添加到现有记录后面';
            document.getElementById('import-chat-history-modal').classList.add('visible');
        });

        // 导入模式切换提示
        document.querySelectorAll('input[name="import-chat-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const hint = document.getElementById('import-chat-mode-hint');
                if (e.target.value === 'append') {
                    hint.textContent = '追加：将导入的记录添加到现有记录后面';
                } else {
                    hint.textContent = '覆盖：清空现有记录，替换为导入的记录';
                    hint.style.color = '#d32f2f';
                }
            });
        });

        document.getElementById('cancel-import-chat-btn')?.addEventListener('click', () => {
            document.getElementById('import-chat-history-modal').classList.remove('visible');
        });
        document.getElementById('import-chat-history-modal')?.addEventListener('click', (e) => {
            if (e.target === document.getElementById('import-chat-history-modal')) {
                document.getElementById('import-chat-history-modal').classList.remove('visible');
            }
        });

        document.getElementById('confirm-import-chat-btn')?.addEventListener('click', async () => {
            const fileInput = document.getElementById('import-chat-history-file');
            const file = fileInput.files[0];
            if (!file) {
                showToast('请先选择文件');
                return;
            }
            const character = db.characters.find(c => c.id === currentChatId);
            if (!character) return;

            try {
                const text = await file.text();
                const data = JSON.parse(text);

                // 验证数据格式
                if (!data.history || !Array.isArray(data.history)) {
                    showToast('文件格式不正确，缺少聊天记录数据');
                    return;
                }
                if (data.type && data.type !== 'uwu-chat-history') {
                    showToast('文件类型不匹配');
                    return;
                }

                const mode = document.querySelector('input[name="import-chat-mode"]:checked').value;
                const importHistory = data.history;

                if (mode === 'overwrite') {
                    if (!confirm(`覆盖导入将清空当前所有聊天记录（${character.history.length}条），替换为导入的${importHistory.length}条记录。确定继续吗？`)) {
                        return;
                    }
                    character.history = importHistory;
                } else {
                    // 追加模式：为避免ID冲突，给导入的消息生成新ID
                    const existingIds = new Set(character.history.map(m => m.id));
                    importHistory.forEach(msg => {
                        if (existingIds.has(msg.id)) {
                            msg.id = generateUUID();
                        }
                    });
                    character.history = character.history.concat(importHistory);
                    // 按时间排序
                    character.history.sort((a, b) => a.timestamp - b.timestamp);
                }

                if (typeof recalculateChatStatus === 'function') {
                    recalculateChatStatus(character);
                }

                await saveCharacter(currentChatId);
                currentPage = 1;
                renderMessages(false, true);
                renderChatList();
                document.getElementById('import-chat-history-modal').classList.remove('visible');
                showToast(`成功${mode === 'overwrite' ? '覆盖' : '追加'}导入 ${importHistory.length} 条聊天记录`);
            } catch (e) {
                console.error('导入聊天记录失败:', e);
                showToast('导入失败：文件解析错误');
            }
        });
    }

    function load(e) {
        // 消息版本管理
        const keepRegenEl = document.getElementById('setting-keep-regen-versions');
        if (keepRegenEl) keepRegenEl.checked = e.keepRegenVersions || false;

        const sp = e.statusPanel || {};
        document.getElementById('setting-status-panel-enabled').checked = sp.enabled || false;
        document.getElementById('setting-status-prompt-suffix').value = sp.promptSuffix || '';
        document.getElementById('setting-status-regex').value = sp.regexPattern || '';
        document.getElementById('setting-status-replace').value = sp.replacePattern || '';
        document.getElementById('setting-status-history-limit').value = sp.historyLimit !== undefined ? sp.historyLimit : 3;

        const statusPanelContainer = document.getElementById('status-panel-settings-container');
        if (statusPanelContainer) {
            if (sp.enabled) {
                statusPanelContainer.style.maxHeight = '5000px';
                statusPanelContainer.style.paddingBottom = '20px';
            } else {
                statusPanelContainer.style.maxHeight = '0';
                statusPanelContainer.style.paddingBottom = '0';
            }
        }

        const newGameBtn = document.getElementById('archive-new-game-btn');
        if (newGameBtn) {
            // 先解绑之前的事件防止重复
            const newBtn = newGameBtn.cloneNode(true);
            newGameBtn.parentNode.replaceChild(newBtn, newGameBtn);

            newBtn.addEventListener('click', async () => {
                const cid = currentChatId;
                if (!cid) {
                    showToast('请先进入一个角色的聊天');
                    return;
                }
                const char = db.characters.find(c => c.id === cid);
                if (!char) return;

                const confirmed = await customConfirm('确定要为该角色开启新档吗？\n当前角色的所有聊天记录、上下文和日记将被清空，但人设等基础设置会保留。\n\n建议在此操作前先保存当前进度的存档！', '提示');
                if (!confirmed) return;

                // 清空记录与状态
                char.history = [];
                char.tokens = 0;
                if (char.memory) {
                    char.memory.journal = [];
                    char.memory.context = '';
                }
                char.nodes = [];
                char.chatHistory = [];
                char.messages = [];
                char.chatContext = '';
                char.chatSummary = '';
                if (char.memoryTables && typeof char.memoryTables === 'object') {
                    char.memoryTables.data = {};
                    char.memoryTables.history = [];
                    char.memoryTables.lastChangedFieldPaths = [];
                }
                if (char.vectorMemory && typeof char.vectorMemory === 'object') {
                    char.vectorMemory.entries = [];
                    char.vectorMemory.history = [];
                    char.vectorMemory.lastSummarizedMsgId = null;
                    char.vectorMemory.lastSummarizedMsgTimestamp = null;
                    char.vectorMemory.lastContextBlock = '';
                    char.vectorMemory.lastRetrievedEntryIds = [];
                    char.vectorMemory.lastQueryText = '';
                    char.vectorMemory.autoSummaryState = 'idle';
                    char.vectorMemory.autoSummaryPending = false;
                }

                // 同步清空拉黑和好友申请相关记忆
                char.blockHistory = [];
                char.friendRequests = [];
                char.charBlockHistory = [];
                char.userFriendRequests = [];
                char.isBlocked = false;
                char.blockedAt = null;
                char.blockReapply = null;
                char.isBlockedByChar = false;
                char.blockedByCharAt = null;
                char.blockedByCharReason = null;

                // 隐藏角色拉黑遮罩（如果有）
                var charBlockedOverlay = document.getElementById('char-blocked-overlay');
                if (charBlockedOverlay) charBlockedOverlay.style.display = 'none';

                await saveData();

                showToast('新档开启成功！');
                if (currentChatId === cid && typeof renderMessages === 'function') {
                    renderMessages();
                }
                if (typeof renderChatList === 'function') renderChatList();

                // 自动保存一个初始存档
                await createArchive(cid, '初始状态');
            });
        }

        // 加载角色正则过滤设置
        const rf = e.regexFilter || {};
        document.getElementById('setting-regex-filter-enabled').checked = rf.enabled || false;
        const rfRulesText = (rf.rules || []).map(r => r.replace ? `${r.pattern}|||${r.replace}` : r.pattern).join('\n');
        document.getElementById('setting-regex-filter-rules').value = rfRulesText;
        const regexFilterContainer = document.getElementById('regex-filter-settings-container');
        if (regexFilterContainer) {
            if (rf.enabled) {
                regexFilterContainer.style.maxHeight = '5000px';
                regexFilterContainer.style.paddingBottom = '20px';
            } else {
                regexFilterContainer.style.maxHeight = '0';
                regexFilterContainer.style.paddingBottom = '0';
            }
        }
        if (typeof populateRegexFilterPresetSelect === 'function') populateRegexFilterPresetSelect();

        const webSearchEnabledEl = document.getElementById('setting-char-web-search-enabled');
        const webSearchPayloadEl = document.getElementById('setting-char-web-search-payload');
        const webSearchPayloadCont = document.getElementById('setting-char-web-search-payload-container');
        if (webSearchEnabledEl) {
            webSearchEnabledEl.checked = !!e.webSearchEnabled;
            if (webSearchPayloadCont) {
                webSearchPayloadCont.style.display = e.webSearchEnabled ? 'flex' : 'none';
            }
            webSearchEnabledEl.onchange = function() {
                if (webSearchPayloadCont) {
                    webSearchPayloadCont.style.display = this.checked ? 'flex' : 'none';
                }
            };
        }
        if (webSearchPayloadEl) {
            webSearchPayloadEl.value = e.webSearchPayload || '';
        }

        // 加载环境与天气增强设置
        const charWeatherEnabledEl = document.getElementById('setting-char-weather-enabled');
        const charWeatherCityCont = document.getElementById('setting-char-weather-city-container');
        const charWeatherCityEl = document.getElementById('setting-char-weather-city');
        const userWeatherEnabledEl = document.getElementById('setting-user-weather-enabled');
        const userWeatherCityCont = document.getElementById('setting-user-weather-city-container');
        const userWeatherCityEl = document.getElementById('setting-user-weather-city');
        const locateBtn = document.getElementById('setting-user-weather-locate-btn');

        // 单人独立天气 API
        const charWeatherCustomApiEnabledEl = document.getElementById('setting-char-weather-custom-api-enabled');
        const charWeatherCustomApiCont = document.getElementById('setting-char-weather-custom-api-container');
        const charWeatherProviderEl = document.getElementById('setting-char-weather-provider');
        const charWeatherKeyCont = document.getElementById('setting-char-weather-key-container');
        const charWeatherKeyEl = document.getElementById('setting-char-weather-key');

        if (charWeatherEnabledEl) {
            charWeatherEnabledEl.checked = e.weatherSettings?.charEnabled || false;
            if (charWeatherCityCont) charWeatherCityCont.style.display = charWeatherEnabledEl.checked ? 'flex' : 'none';
            charWeatherEnabledEl.onchange = function() {
                if (charWeatherCityCont) charWeatherCityCont.style.display = this.checked ? 'flex' : 'none';
            };
        }
        if (charWeatherCityEl) charWeatherCityEl.value = e.weatherSettings?.charCity || '';

        if (userWeatherEnabledEl) {
            userWeatherEnabledEl.checked = e.weatherSettings?.userEnabled || false;
            if (userWeatherCityCont) userWeatherCityCont.style.display = userWeatherEnabledEl.checked ? 'flex' : 'none';
            userWeatherEnabledEl.onchange = function() {
                if (userWeatherCityCont) userWeatherCityCont.style.display = this.checked ? 'flex' : 'none';
            };
        }
        if (userWeatherCityEl) userWeatherCityEl.value = e.weatherSettings?.userCity || '';

        if (charWeatherCustomApiEnabledEl) {
            charWeatherCustomApiEnabledEl.checked = e.weatherSettings?.customApiEnabled || false;
            if (charWeatherCustomApiCont) charWeatherCustomApiCont.style.display = charWeatherCustomApiEnabledEl.checked ? 'block' : 'none';
            charWeatherCustomApiEnabledEl.onchange = function() {
                if (charWeatherCustomApiCont) charWeatherCustomApiCont.style.display = this.checked ? 'block' : 'none';
            };
        }
        if (charWeatherProviderEl) {
            charWeatherProviderEl.value = e.weatherSettings?.provider || 'openmeteo';
            const updateKeyVis = () => {
                if (charWeatherProviderEl.value === 'qweather' || charWeatherProviderEl.value === 'seniverse') {
                    if (charWeatherKeyCont) charWeatherKeyCont.style.display = 'flex';
                } else {
                    if (charWeatherKeyCont) charWeatherKeyCont.style.display = 'none';
                }
            };
            charWeatherProviderEl.onchange = updateKeyVis;
            updateKeyVis();
        }
        if (charWeatherKeyEl) charWeatherKeyEl.value = e.weatherSettings?.apiKey || '';

        // 定位按钮功能
        if (locateBtn && userWeatherCityEl) {
            // 避免重复绑定
            locateBtn.replaceWith(locateBtn.cloneNode(true));
            document.getElementById('setting-user-weather-locate-btn').addEventListener('click', async () => {
                const btn = document.getElementById('setting-user-weather-locate-btn');
                btn.textContent = '定位中...';
                btn.disabled = true;

                try {
                    if (!navigator.geolocation) {
                        throw new Error('浏览器不支持定位功能');
                    }

                    const position = await new Promise((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
                    });

                    const lat = position.coords.latitude;
                    const lon = position.coords.longitude;

                    // 将经纬度填入输入框，让获取天气的逻辑去解析坐标
                    userWeatherCityEl.value = `${lat.toFixed(4)},${lon.toFixed(4)}`;
                    showToast('定位成功！');
                } catch (error) {
                    console.error('定位失败', error);
                    showToast(error.message || '获取位置失败，请手动输入');
                } finally {
                    btn.textContent = '📍 定位';
                    btn.disabled = false;
                }
            });
        }
    }

    async function save(e) {
        // 消息版本管理
        const keepRegenSave = document.getElementById('setting-keep-regen-versions');
        e.keepRegenVersions = keepRegenSave ? keepRegenSave.checked : false;

        // 保存角色正则过滤设置
        if (!e.regexFilter) e.regexFilter = {};
        e.regexFilter.enabled = document.getElementById('setting-regex-filter-enabled').checked;
        const rfRulesText = document.getElementById('setting-regex-filter-rules').value;
        e.regexFilter.rules = (typeof parseRegexFilterRulesText === 'function') ? parseRegexFilterRulesText(rfRulesText) : [];

        const webSearchEnabledElSave = document.getElementById('setting-char-web-search-enabled');
        const webSearchPayloadElSave = document.getElementById('setting-char-web-search-payload');
        e.webSearchEnabled = webSearchEnabledElSave ? webSearchEnabledElSave.checked : false;
        e.webSearchPayload = webSearchPayloadElSave ? webSearchPayloadElSave.value.trim() : '';

        // 保存环境与天气增强设置
        if (!e.weatherSettings) e.weatherSettings = {};
        e.weatherSettings.charEnabled = document.getElementById('setting-char-weather-enabled')?.checked || false;
        e.weatherSettings.charCity = (document.getElementById('setting-char-weather-city')?.value || '').trim();
        e.weatherSettings.userEnabled = document.getElementById('setting-user-weather-enabled')?.checked || false;
        e.weatherSettings.userCity = (document.getElementById('setting-user-weather-city')?.value || '').trim();

        e.weatherSettings.customApiEnabled = document.getElementById('setting-char-weather-custom-api-enabled')?.checked || false;
        e.weatherSettings.provider = document.getElementById('setting-char-weather-provider')?.value || 'openmeteo';
        e.weatherSettings.apiKey = (document.getElementById('setting-char-weather-key')?.value || '').trim();
    }

    runtime.register('extensions', {
        setupOrder: 30,
        loadOrder: 50,
        saveOrder: 50,
        setup,
        load,
        save
    });
})(window);
