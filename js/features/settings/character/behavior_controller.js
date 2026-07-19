(function (global) {
    'use strict';

    const runtime = global.OvoCharacterSettings;
    if (!runtime) throw new Error('OvoCharacterSettings context must load first');

    function setup() {
        const blockCharacterBtn = document.getElementById('block-character-btn');
        const blockSettingsPanel = document.getElementById('block-settings-panel');
        const blockConfirmModal = document.getElementById('block-confirm-modal');
        const blockReapplyModeEl = document.getElementById('block-reapply-mode');
        const blockFixedIntervalRow = document.getElementById('block-fixed-interval-row');
        if (blockCharacterBtn) {
            blockCharacterBtn.addEventListener('click', () => {
                if (!blockConfirmModal) return;
                const modeFixed = document.querySelector('input[name="block-mode"][value="fixed"]');
                const initIntervalEl = document.getElementById('block-init-interval');
                if (modeFixed) modeFixed.checked = true;
                if (initIntervalEl) initIntervalEl.value = '30';
                blockConfirmModal.classList.add('visible');
            });
        }
        document.getElementById('block-confirm-cancel') && document.getElementById('block-confirm-cancel').addEventListener('click', () => {
            if (blockConfirmModal) blockConfirmModal.classList.remove('visible');
        });
        if (blockConfirmModal) blockConfirmModal.addEventListener('click', function (ev) {
            if (ev.target === blockConfirmModal) blockConfirmModal.classList.remove('visible');
        });
        document.getElementById('block-confirm-ok')?.addEventListener('click', () => {
            const character = db.characters.find(c => c.id === currentChatId);
            if (!character) return;
            const modeEl = document.querySelector('input[name="block-mode"]:checked');
            const initIntervalEl = document.getElementById('block-init-interval');
            const mode = (modeEl && modeEl.value) || 'fixed';
            const fixedInterval = initIntervalEl ? Math.max(1, parseInt(initIntervalEl.value, 10) || 30) : 30;
            if (blockConfirmModal) blockConfirmModal.classList.remove('visible');
            if (typeof blockCharacter === 'function') blockCharacter(character.id, mode, fixedInterval);
            if (blockSettingsPanel) blockSettingsPanel.style.display = 'block';
            if (blockCharacterBtn) blockCharacterBtn.style.display = 'none';
        });
        if (blockReapplyModeEl) {
            blockReapplyModeEl?.addEventListener('change', () => {
                if (blockFixedIntervalRow) blockFixedIntervalRow.style.display = (blockReapplyModeEl.value === 'fixed') ? '' : 'none';
            });
        }
        document.getElementById('trigger-friend-request-btn')?.addEventListener('click', async () => {
            const character = db.characters.find(c => c.id === currentChatId);
            if (!character || !character.isBlocked) return;
            if (character.blockReapply && character.blockReapply.pendingRequestId) {
                if (typeof reopenPendingFriendRequest === 'function') {
                    reopenPendingFriendRequest(character.id);
                } else {
                    showToast('还有待处理的好友申请');
                }
                return;
            }
            if (typeof generateAndShowFriendRequest === 'function') await generateAndShowFriendRequest(character);
        });
        document.getElementById('unblock-character-btn')?.addEventListener('click', () => {
            const character = db.characters.find(c => c.id === currentChatId);
            if (!character) return;
            if (confirm('确定解除拉黑吗？角色将重新出现在聊天列表中。')) {
                if (typeof unblockCharacter === 'function') unblockCharacter(character.id);
                if (blockSettingsPanel) blockSettingsPanel.style.display = 'none';
                if (blockCharacterBtn) blockCharacterBtn.style.display = '';
            }
        });

        // 角色掌控模式：开关、警告弹窗、强制关闭、查看条数、日志、回收站
        (function () {
            const phoneControlEnabledEl = document.getElementById('setting-phone-control-enabled');
            const phoneControlOptionsEl = document.getElementById('setting-phone-control-options');
            const phoneControlActionsEl = document.getElementById('setting-phone-control-actions');
            const phoneControlCharFilterEl = document.getElementById('setting-phone-control-char-filter');
            const phoneControlCharSelectionEl = document.getElementById('setting-phone-control-char-selection');
            const phoneControlViewLimitEl = document.getElementById('setting-phone-control-view-limit');
            const phoneControlViewLimitValueEl = document.getElementById('setting-phone-control-view-limit-value');
            const warningModal = document.getElementById('phone-control-warning-modal');
            const forceCloseModal = document.getElementById('phone-control-force-close-modal');
            if (!phoneControlEnabledEl) return;
            function showPhoneControlOptions() {
                if (phoneControlOptionsEl) phoneControlOptionsEl.style.display = 'block';
                if (phoneControlActionsEl) phoneControlActionsEl.style.display = 'flex';
                if (phoneControlCharFilterEl) phoneControlCharFilterEl.style.display = 'flex';
                const charFilterOn = document.getElementById('setting-phone-control-char-filter-enabled');
                if (phoneControlCharSelectionEl) phoneControlCharSelectionEl.style.display = (charFilterOn && charFilterOn.checked) ? 'flex' : 'none';
            }
            function hidePhoneControlOptions() {
                if (phoneControlOptionsEl) phoneControlOptionsEl.style.display = 'none';
                if (phoneControlActionsEl) phoneControlActionsEl.style.display = 'none';
                if (phoneControlCharFilterEl) phoneControlCharFilterEl.style.display = 'none';
                if (phoneControlCharSelectionEl) phoneControlCharSelectionEl.style.display = 'none';
            }
            phoneControlEnabledEl?.addEventListener('change', async function () {
                if (this.checked) {
                    // 开启时：计算并显示 token 消耗提醒
                    if (warningModal) {
                        const tokenWarningEl = document.getElementById('phone-control-token-warning');
                        if (tokenWarningEl && currentChatId) {
                            const character = db.characters.find(c => c.id === currentChatId);
                            if (character) {
                                // 估算手机掌控模式额外 token（指令集模板约 350 + 操控历史）
                                const historyCount = (character.phoneControlHistory || []).length;
                                const extraTokens = 350 + Math.min(historyCount, 15) * 30;
                                document.getElementById('phone-control-extra-tokens').textContent = extraTokens + '+';
                                // 当前对话总 token
                                let currentTokens = 0;
                                if (typeof estimateChatTokens === 'function') {
                                    currentTokens = estimateChatTokens(character.id, 'private');
                                }
                                document.getElementById('phone-control-current-tokens').textContent = currentTokens;
                                tokenWarningEl.style.display = 'block';
                            }
                        }
                        warningModal.style.display = 'flex';
                    } else {
                        showPhoneControlOptions();
                    }
                } else {
                    hidePhoneControlOptions();
                }
            });
            if (phoneControlViewLimitEl && phoneControlViewLimitValueEl) {
                phoneControlViewLimitEl?.addEventListener('input', function () {
                    phoneControlViewLimitValueEl.textContent = this.value;
                });
            }
            document.getElementById('phone-control-warning-cancel')?.addEventListener('click', () => {
                if (warningModal) warningModal.style.display = 'none';
                if (phoneControlEnabledEl) phoneControlEnabledEl.checked = false;
                hidePhoneControlOptions();
            });
            document.getElementById('phone-control-warning-confirm')?.addEventListener('click', () => {
                if (warningModal) warningModal.style.display = 'none';
                showPhoneControlOptions();
            });
            document.getElementById('setting-phone-control-char-filter-enabled')?.addEventListener('change', function () {
                if (phoneControlCharSelectionEl) phoneControlCharSelectionEl.style.display = this.checked ? 'flex' : 'none';
            });

            // 绑定选择角色按钮事件
            const selectCharsBtn = document.getElementById('setting-phone-control-select-chars-btn');
            if (selectCharsBtn) {
                selectCharsBtn?.addEventListener('click', () => {
                    const char = db.characters.find(c => c.id === currentChatId);
                    if (!char) return;
                    const modal = document.getElementById('phone-control-char-select-modal');
                    const list = document.getElementById('phone-control-char-list');
                    const selectAllCb = document.getElementById('phone-control-char-select-all');
                    if (!modal || !list) return;

                    list.innerHTML = '';
                    const visibleIds = char.phoneControlVisibleCharIds || [];
                    const otherChars = (db.characters || []).filter(c => c.id !== char.id);

                    if (otherChars.length === 0) {
                        list.innerHTML = '<div style="color:#999;text-align:center;padding:20px;">没有其他角色可选</div>';
                    } else {
                        let allChecked = true;
                        otherChars.forEach(c => {
                            const isChecked = visibleIds.includes(c.id);
                            if (!isChecked) allChecked = false;

                            const label = document.createElement('label');
                            label.style.cssText = 'display:flex; align-items:center; gap:8px; padding:8px; border-bottom:1px solid #eee; cursor:pointer;';

                            const cb = document.createElement('input');
                            cb.type = 'checkbox';
                            cb.value = c.id;
                            cb.className = 'phone-control-char-cb';
                            cb.checked = isChecked;
                            cb.style.margin = '0';

                            const img = document.createElement('img');
                            img.src = c.avatar || 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg';
                            img.style.cssText = 'width:30px; height:30px; border-radius:50%; object-fit:cover;';

                            const nameSpan = document.createElement('span');
                            nameSpan.textContent = c.remarkName || c.realName || '未知';
                            nameSpan.style.flex = '1';

                            label.appendChild(cb);
                            label.appendChild(img);
                            label.appendChild(nameSpan);
                            list.appendChild(label);

                            cb.addEventListener('change', () => {
                                const cbs = Array.from(list.querySelectorAll('.phone-control-char-cb'));
                                if (selectAllCb) selectAllCb.checked = cbs.every(x => x.checked);
                            });
                        });
                        if (selectAllCb) selectAllCb.checked = otherChars.length > 0 && allChecked;
                    }

                    modal.style.display = 'flex';
                });
            }

            const selectAllCb = document.getElementById('phone-control-char-select-all');
            if (selectAllCb) {
                selectAllCb?.addEventListener('change', function() {
                    const cbs = document.querySelectorAll('.phone-control-char-cb');
                    cbs.forEach(cb => cb.checked = this.checked);
                });
            }

            const confirmCharsBtn = document.getElementById('phone-control-char-confirm-btn');
            if (confirmCharsBtn) {
                confirmCharsBtn?.addEventListener('click', async () => {
                    const char = db.characters.find(c => c.id === currentChatId);
                    if (!char) return;
                    const cbs = Array.from(document.querySelectorAll('.phone-control-char-cb:checked'));
                    char.phoneControlVisibleCharIds = cbs.map(cb => cb.value);
                    await saveCharacter(currentChatId);
                    document.getElementById('phone-control-char-select-modal').style.display = 'none';
                    showToast('已保存可见角色设置');
                });
            }

            const cancelCharsBtn = document.getElementById('phone-control-char-cancel-btn');
            if (cancelCharsBtn) {
                cancelCharsBtn?.addEventListener('click', () => {
                    const modal = document.getElementById('phone-control-char-select-modal');
                    if (modal) modal.style.display = 'none';
                });
            }

            document.getElementById('setting-phone-control-force-close-btn')?.addEventListener('click', () => {
                // 强制关闭前显示 token 信息
                const tokenInfoEl = document.getElementById('phone-control-close-token-info');
                if (tokenInfoEl && currentChatId) {
                    const character = db.characters.find(c => c.id === currentChatId);
                    if (character) {
                        const msgCount = character.history ? character.history.length : 0;
                        let tokenCount = 0;
                        if (typeof estimateChatTokens === 'function') {
                            tokenCount = estimateChatTokens(character.id, 'private');
                        }
                        document.getElementById('force-close-msg-count').textContent = msgCount;
                        document.getElementById('force-close-token-count').textContent = tokenCount;
                        tokenInfoEl.style.display = (msgCount > 0) ? 'block' : 'none';
                    }
                }
                if (forceCloseModal) forceCloseModal.style.display = 'flex';
            });
            document.getElementById('phone-control-force-cancel')?.addEventListener('click', () => {
                if (forceCloseModal) forceCloseModal.style.display = 'none';
            });
            document.getElementById('phone-control-force-confirm')?.addEventListener('click', async () => {
                const character = db.characters.find(c => c.id === currentChatId);
                if (character) {
                    character.phoneControlEnabled = false;
                    await saveCharacter(currentChatId);
                    if (phoneControlEnabledEl) phoneControlEnabledEl.checked = false;
                    hidePhoneControlOptions();
                    if (typeof showToast === 'function') showToast('已强制关闭');
                }
                if (forceCloseModal) forceCloseModal.style.display = 'none';
            });
            document.getElementById('setting-phone-control-log-btn')?.addEventListener('click', () => {
                const character = db.characters.find(c => c.id === currentChatId);
                if (!character) return;
                const history = character.phoneControlHistory || [];
                const lines = history.length ? history.slice().reverse().map(h => {
                    const t = h.timestamp ? new Date(h.timestamp) : null;
                    const timeStr = t ? t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0') + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') : '';
                    return timeStr + ' ' + (h.type === 'view' ? '查看' : '操作') + ' ' + (h.action || '') + (h.target ? ' (' + h.target + ')' : '') + (h.detail ? ' — ' + String(h.detail).slice(0, 60) : '');
                }).join('\n') : '暂无记录';
                alert('【操控日志】\n\n' + lines);
            });
            function renderPhoneControlRecycleList() {
                const listEl = document.getElementById('phone-control-recycle-list');
                if (!listEl) return;
                const bin = db.phoneControlRecycleBin || [];
                if (bin.length === 0) {
                    listEl.innerHTML = '<p style="color:#999;padding:12px;">回收站为空</p>';
                } else {
                    listEl.innerHTML = bin.map((item, i) => {
                        const name = item.remarkName || item.realName || '未知';
                        return '<div class="kkt-item" style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f0f0f0;">' +
                            '<span>' + name + '</span>' +
                            '<button type="button" class="btn btn-small btn-primary phone-control-restore-btn" data-index="' + i + '">恢复</button>' +
                            '</div>';
                    }).join('');
                }
            }
            document.getElementById('setting-phone-control-recycle-btn')?.addEventListener('click', () => {
                const modal = document.getElementById('phone-control-recycle-modal');
                const listEl = document.getElementById('phone-control-recycle-list');
                if (!modal || !listEl) return;
                renderPhoneControlRecycleList();
                modal.style.display = 'flex';
            });
            document.getElementById('phone-control-recycle-list')?.addEventListener('click', async (e) => {
                const btn = e.target.closest('.phone-control-restore-btn');
                if (!btn) return;
                const idx = parseInt(btn.getAttribute('data-index'), 10);
                const bin2 = db.phoneControlRecycleBin || [];
                if (isNaN(idx) || idx < 0 || idx >= bin2.length) return;
                const character = bin2[idx];
                delete character.recycledAt;
                delete character.recycledByCharId;
                db.phoneControlRecycleBin = bin2.filter((_, i) => i !== idx);
                db.characters.push(character);
                await saveData(); // 这里恢复了角色，修改了 db.characters 数组，保留全量保存或可考虑精细化但暂时保留 saveData
                if (typeof renderChatList === 'function') renderChatList();
                if (typeof showToast === 'function') showToast('已恢复');
                renderPhoneControlRecycleList();
            });
            document.getElementById('phone-control-recycle-close')?.addEventListener('click', () => {
                const modal = document.getElementById('phone-control-recycle-modal');
                if (modal) modal.style.display = 'none';
            });
        })();
    }

    function load(e) {
        // 加载单人思维链设置
        const charCotEnabledEl = document.getElementById('setting-char-cot-enabled');
        const charCotOptionsEl = document.getElementById('setting-char-cot-options');
        const charCotChatEnabledEl = document.getElementById('setting-char-cot-chat-enabled');
        const charCotChatPresetEl = document.getElementById('setting-char-cot-chat-preset');
        const charCotChatPresetCont = document.getElementById('setting-char-cot-chat-preset-container');
        const charCotCallEnabledEl = document.getElementById('setting-char-cot-call-enabled');
        const charCotCallPresetEl = document.getElementById('setting-char-cot-call-preset');
        const charCotCallPresetCont = document.getElementById('setting-char-cot-call-preset-container');
        const charCotOfflineEnabledEl = document.getElementById('setting-char-cot-offline-enabled');
        const charCotOfflinePresetEl = document.getElementById('setting-char-cot-offline-preset');
        const charCotOfflinePresetCont = document.getElementById('setting-char-cot-offline-preset-container');

        if (charCotEnabledEl) {
            charCotEnabledEl.checked = e.cotSettings?.enabled || false;
            if (charCotOptionsEl) {
                charCotOptionsEl.style.display = e.cotSettings?.enabled ? 'block' : 'none';
            }
            charCotEnabledEl.onchange = function() {
                if (charCotOptionsEl) charCotOptionsEl.style.display = this.checked ? 'block' : 'none';
            };
        }

        if (charCotChatEnabledEl) {
            charCotChatEnabledEl.checked = e.cotSettings?.chatEnabled || false;
            if (charCotChatPresetCont) charCotChatPresetCont.style.display = charCotChatEnabledEl.checked ? 'block' : 'none';
            charCotChatEnabledEl.onchange = function() {
                if (charCotChatPresetCont) charCotChatPresetCont.style.display = this.checked ? 'block' : 'none';
            };
        }
        if (charCotCallEnabledEl) {
            charCotCallEnabledEl.checked = e.cotSettings?.callEnabled || false;
            if (charCotCallPresetCont) charCotCallPresetCont.style.display = charCotCallEnabledEl.checked ? 'block' : 'none';
            charCotCallEnabledEl.onchange = function() {
                if (charCotCallPresetCont) charCotCallPresetCont.style.display = this.checked ? 'block' : 'none';
            };
        }
        if (charCotOfflineEnabledEl) {
            charCotOfflineEnabledEl.checked = e.cotSettings?.offlineEnabled || false;
            if (charCotOfflinePresetCont) charCotOfflinePresetCont.style.display = charCotOfflineEnabledEl.checked ? 'block' : 'none';
            charCotOfflineEnabledEl.onchange = function() {
                if (charCotOfflinePresetCont) charCotOfflinePresetCont.style.display = this.checked ? 'block' : 'none';
            };
        }

        // 填充预设下拉框
        const presets = db.cotPresets || [];
        const populateCotPreset = (selectEl, defaultText, activeId) => {
            if (!selectEl) return;
            selectEl.innerHTML = `<option value="">${defaultText}</option>`;
            presets.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                selectEl.appendChild(opt);
            });
            if (activeId) selectEl.value = activeId;
        };

        populateCotPreset(charCotChatPresetEl, '默认预设', e.cotSettings?.activePresetId);
        populateCotPreset(charCotCallPresetEl, '默认通话预设', e.cotSettings?.activeCallPresetId);
        populateCotPreset(charCotOfflinePresetEl, '默认线下预设', e.cotSettings?.activeOfflinePresetId);

        // 加载小剧场设置
        const charTheaterEnabledEl = document.getElementById('setting-char-theater-enabled');
        const charTheaterOptionsEl = document.getElementById('setting-char-theater-options');
        const charTheaterProbEl = document.getElementById('setting-char-theater-probability');
        const charTheaterProbValEl = document.getElementById('setting-char-theater-probability-value');
        const charTheaterFormatEl = document.getElementById('setting-char-theater-format');
        const charTheaterPromptEl = document.getElementById('setting-char-theater-prompt');
        if (charTheaterEnabledEl) {
            charTheaterEnabledEl.checked = e.charTheaterEnabled || false;
            if (charTheaterOptionsEl) {
                charTheaterOptionsEl.style.display = e.charTheaterEnabled ? '' : 'none';
            }
            charTheaterEnabledEl.onchange = function() {
                if (charTheaterOptionsEl) charTheaterOptionsEl.style.display = this.checked ? '' : 'none';
            };
        }
        if (charTheaterProbEl) {
            const prob = e.charTheaterProbability !== undefined ? e.charTheaterProbability : 20;
            charTheaterProbEl.value = prob;
            if (charTheaterProbValEl) charTheaterProbValEl.textContent = prob + '%';
            charTheaterProbEl.oninput = function() {
                if (charTheaterProbValEl) charTheaterProbValEl.textContent = this.value + '%';
            };
        }
        if (charTheaterFormatEl) charTheaterFormatEl.value = e.charTheaterFormat || 'text';
        if (charTheaterPromptEl) charTheaterPromptEl.value = e.charTheaterPrompt || '';

        // 加载聊天条数、日记条数
        const charTheaterChatCountEl = document.getElementById('setting-char-theater-chat-count');
        const charTheaterJournalCountEl = document.getElementById('setting-char-theater-journal-count');
        if (charTheaterChatCountEl) charTheaterChatCountEl.value = e.charTheaterChatCount !== undefined ? e.charTheaterChatCount : 20;
        if (charTheaterJournalCountEl) charTheaterJournalCountEl.value = e.charTheaterJournalCount !== undefined ? e.charTheaterJournalCount : 0;

        // 渲染世界书分类下拉多选（与创建剧场页面相同风格）
        _populateCharTheaterWbDropdown(e.charTheaterWorldBookIds || []);

        // 填充预设提示词下拉
        const charTheaterPresetSel = document.getElementById('setting-char-theater-prompt-preset');
        if (charTheaterPresetSel) {
            charTheaterPresetSel.innerHTML = '<option value="">— 从预设中选择 —</option>';
            const presets = (typeof getTheaterPromptPresets === 'function') ? getTheaterPromptPresets() : (db.theaterPromptPresets || []);
            presets.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id || p.name;
                opt.textContent = p.name;
                charTheaterPresetSel.appendChild(opt);
            });
        }
        // 应用预设按钮
        const charTheaterPresetApplyBtn = document.getElementById('setting-char-theater-prompt-apply');
        if (charTheaterPresetApplyBtn) {
            charTheaterPresetApplyBtn.onclick = () => {
                const sel = document.getElementById('setting-char-theater-prompt-preset');
                const textarea = document.getElementById('setting-char-theater-prompt');
                if (!sel || !textarea) return;
                const presets = (typeof getTheaterPromptPresets === 'function') ? getTheaterPromptPresets() : (db.theaterPromptPresets || []);
                const preset = presets.find(p => (p.id || p.name) === sel.value);
                if (preset) textarea.value = preset.content || '';
            };
        }

        // 自知开关
        const charTheaterSelfAwareEl = document.getElementById('setting-char-theater-self-aware');
        if (charTheaterSelfAwareEl) {
            // 兼容历史数据：可能是字符串 "true"/"false"
            const v = e.charTheaterSelfAware;
            const normalized = (v === true || v === 'true');
            charTheaterSelfAwareEl.checked = normalized;
            // 顺便把旧数据归一化为 boolean，避免后续真值判断踩坑
            e.charTheaterSelfAware = normalized;
        }

        // 独立 API 设置
        const charTheaterUseCustomApiEl = document.getElementById('setting-char-theater-use-custom-api');
        const charTheaterApiConfigEl = document.getElementById('setting-char-theater-api-config');
        if (charTheaterUseCustomApiEl && charTheaterApiConfigEl) {
            charTheaterUseCustomApiEl.checked = e.charTheaterUseCustomApi || false;
            charTheaterApiConfigEl.style.display = e.charTheaterUseCustomApi ? '' : 'none';
            charTheaterUseCustomApiEl.onchange = () => {
                charTheaterApiConfigEl.style.display = charTheaterUseCustomApiEl.checked ? '' : 'none';
            };
            const urlEl = document.getElementById('setting-char-theater-api-url');
            const keyEl = document.getElementById('setting-char-theater-api-key');
            const modelEl = document.getElementById('setting-char-theater-api-model');
            if (urlEl) urlEl.value = e.charTheaterApiUrl || '';
            if (keyEl) keyEl.value = e.charTheaterApiKey || '';
            if (modelEl) {
                // 先确保已保存的模型作为一个选项存在，再设置选中值
                const savedModel = e.charTheaterApiModel || '';
                if (savedModel) {
                    let found = Array.from(modelEl.options).some(o => o.value === savedModel);
                    if (!found) {
                        const opt = document.createElement('option');
                        opt.value = savedModel;
                        opt.textContent = savedModel;
                        modelEl.appendChild(opt);
                    }
                    modelEl.value = savedModel;
                }
            }

            // 拉取模型按钮
            const fetchModelsBtn = document.getElementById('setting-char-theater-fetch-models-btn');
            if (fetchModelsBtn) {
                fetchModelsBtn.onclick = async () => {
                    const apiUrl = (urlEl ? urlEl.value.trim() : '');
                    const apiKey = (keyEl ? keyEl.value.trim() : '');
                    if (!apiUrl || !apiKey) {
                        showToast('请先填写 API URL 和 Key');
                        return;
                    }
                    const blockedDomains = (typeof BLOCKED_API_DOMAINS !== 'undefined') ? BLOCKED_API_DOMAINS : [];
                    if (blockedDomains.some(d => apiUrl.includes(d))) {
                        showToast('该API站点已被屏蔽');
                        return;
                    }
                    const endpoint = `${apiUrl.replace(/\/$/, '')}/v1/models`;
                    fetchModelsBtn.disabled = true;
                    const origText = fetchModelsBtn.textContent;
                    fetchModelsBtn.textContent = '拉取中…';
                    try {
                        const resp = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${apiKey}` } });
                        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                        const json = await resp.json();
                        const models = (json.data || []).map(m => m.id).filter(Boolean).sort();
                        if (!models.length) { showToast('未找到可用模型'); return; }
                        const cur = modelEl ? modelEl.value : '';
                        if (modelEl) {
                            modelEl.innerHTML = '';
                            models.forEach(m => {
                                const opt = document.createElement('option');
                                opt.value = m;
                                opt.textContent = m;
                                modelEl.appendChild(opt);
                            });
                            if (models.includes(cur)) modelEl.value = cur;
                        }
                        showToast(`成功拉取 ${models.length} 个模型`);
                    } catch (err) {
                        console.error('拉取模型失败', err);
                        showToast('拉取模型失败：' + (err.message || '未知错误'));
                    } finally {
                        fetchModelsBtn.disabled = false;
                        fetchModelsBtn.textContent = origText;
                    }
                };
            }

            // 填充预设下拉
            const presetSel = document.getElementById('setting-char-theater-api-preset');
            if (presetSel) {
                presetSel.innerHTML = '<option value="">— 选择预设配置 —</option>';
                const allPresets = [
                    ...(db.apiPresets || []).map(p => ({ name: p.name + '（主API）', data: p.data })),
                    ...(db.summaryApiPresets || []).map(p => ({ name: p.name + '（总结API）', data: p.data })),
                    ...(db.backgroundApiPresets || []).map(p => ({ name: p.name + '（后台API）', data: p.data })),
                    ...(db.supplementPersonaApiPresets || []).map(p => ({ name: p.name + '（补齐人设API）', data: p.data })),                ];
                allPresets.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = JSON.stringify(p.data);
                    opt.textContent = p.name;
                    presetSel.appendChild(opt);
                });
                presetSel.onchange = () => {
                    if (!presetSel.value) return;
                    try {
                        const data = JSON.parse(presetSel.value);
                        if (urlEl) urlEl.value = data.apiUrl || data.url || '';
                        if (keyEl) keyEl.value = data.apiKey || data.key || '';
                        if (modelEl) {
                            const m = data.model || '';
                            // 如果该模型尚不在 select 列表中，先添加再选中
                            if (m) {
                                let found = Array.from(modelEl.options).some(o => o.value === m);
                                if (!found) {
                                    const opt = document.createElement('option');
                                    opt.value = m;
                                    opt.textContent = m;
                                    modelEl.appendChild(opt);
                                }
                                modelEl.value = m;
                            }
                        }
                    } catch (err) { console.warn('预设解析失败', err); }
                    presetSel.value = '';
                };
            }
        }

        const ar = e.autoReply || {};
        document.getElementById('setting-auto-reply-enabled').checked = ar.enabled || false;
        document.getElementById('setting-auto-reply-interval').value = ar.interval || 60;

        const modeSelect = document.getElementById('setting-auto-reply-mode');
        const fixedContainer = document.getElementById('setting-auto-reply-fixed-container');
        const randomContainer = document.getElementById('setting-auto-reply-random-container');

        if (modeSelect) {
            modeSelect.value = ar.mode || 'fixed';

            const updateModeDisplay = () => {
                if (modeSelect.value === 'random') {
                    if (fixedContainer) fixedContainer.style.display = 'none';
                    if (randomContainer) randomContainer.style.display = 'flex';
                } else {
                    if (fixedContainer) fixedContainer.style.display = 'flex';
                    if (randomContainer) randomContainer.style.display = 'none';
                }
            };

            updateModeDisplay();
            modeSelect.addEventListener('change', updateModeDisplay);
        }

        const minInput = document.getElementById('setting-auto-reply-min');
        if (minInput) minInput.value = ar.minInterval || 60;

        const maxInput = document.getElementById('setting-auto-reply-max');
        if (maxInput) maxInput.value = ar.maxInterval || 180;

        // === 加载消息弹窗通知设置 ===
        const bgToastEl = document.getElementById('setting-bg-toast-enabled');
        if (bgToastEl) {
            // 如果单人设置未定义，则显示全局设置的状态
            bgToastEl.checked = e.bgToastEnabled !== undefined ? e.bgToastEnabled : (db.globalToastEnabled !== false);
        }

        // === 加载免打扰时段设置 ===
        const qh = ar.quietHours || {};
        const qhEnabledEl = document.getElementById('setting-quiet-hours-enabled');
        const qhRangeEl = document.getElementById('quiet-hours-range');
        qhEnabledEl.checked = qh.enabled || false;
        document.getElementById('setting-quiet-hours-start').value = qh.start || '23:00';
        document.getElementById('setting-quiet-hours-end').value = qh.end || '07:00';
        qhRangeEl.style.display = qhEnabledEl.checked ? 'block' : 'none';
        qhEnabledEl.addEventListener('change', () => {
            qhRangeEl.style.display = qhEnabledEl.checked ? 'block' : 'none';
        });

        // === 拉黑与好友申请面板 ===
        const blockCharacterBtnEl = document.getElementById('block-character-btn');
        const blockSettingsPanelEl = document.getElementById('block-settings-panel');
        const blockReapplyModeEl = document.getElementById('block-reapply-mode');
        const blockFixedIntervalEl = document.getElementById('block-fixed-interval');
        const blockFixedIntervalRowEl = document.getElementById('block-fixed-interval-row');
        const blockRequestCountEl = document.getElementById('block-request-count');
        const canBlockUserEl = document.getElementById('setting-can-block-user');
        if (canBlockUserEl) canBlockUserEl.checked = e.canBlockUser !== false;

        // 角色掌控模式
        const phoneControlEnabledEl = document.getElementById('setting-phone-control-enabled');
        const phoneControlOptionsEl = document.getElementById('setting-phone-control-options');
        const phoneControlActionsEl = document.getElementById('setting-phone-control-actions');
        const phoneControlViewLimitEl = document.getElementById('setting-phone-control-view-limit');
        const phoneControlViewLimitValueEl = document.getElementById('setting-phone-control-view-limit-value');
        if (phoneControlEnabledEl) {
            phoneControlEnabledEl.checked = e.phoneControlEnabled || false;
            if (phoneControlOptionsEl) phoneControlOptionsEl.style.display = phoneControlEnabledEl.checked ? 'block' : 'none';
            if (phoneControlActionsEl) phoneControlActionsEl.style.display = phoneControlEnabledEl.checked ? 'flex' : 'none';
        }
        const phoneControlCharFilterEl = document.getElementById('setting-phone-control-char-filter');
        const phoneControlCharSelectionEl = document.getElementById('setting-phone-control-char-selection');
        const phoneControlCharFilterEnabledEl = document.getElementById('setting-phone-control-char-filter-enabled');
        if (phoneControlCharFilterEl) phoneControlCharFilterEl.style.display = e.phoneControlEnabled ? 'flex' : 'none';
        if (phoneControlCharFilterEnabledEl) phoneControlCharFilterEnabledEl.checked = e.phoneControlCharFilterEnabled || false;
        if (phoneControlCharSelectionEl) phoneControlCharSelectionEl.style.display = (e.phoneControlEnabled && e.phoneControlCharFilterEnabled) ? 'flex' : 'none';
        if (phoneControlViewLimitEl) {
            const limit = Math.min(50, Math.max(5, parseInt(e.phoneControlViewLimit, 10) || 10));
            phoneControlViewLimitEl.value = limit;
            if (phoneControlViewLimitValueEl) phoneControlViewLimitValueEl.textContent = limit;
        }

        if (blockCharacterBtnEl && blockSettingsPanelEl) {
            if (e.isBlocked) {
                blockCharacterBtnEl.style.display = 'none';
                blockSettingsPanelEl.style.display = 'block';
                const br = e.blockReapply || {};
                if (blockReapplyModeEl) blockReapplyModeEl.value = br.mode || 'fixed';
                if (blockFixedIntervalEl) blockFixedIntervalEl.value = Math.max(1, br.fixedInterval || 30);
                if (blockRequestCountEl) blockRequestCountEl.textContent = (e.friendRequests && e.friendRequests.length) ? e.friendRequests.length : 0;
                if (blockFixedIntervalRowEl) blockFixedIntervalRowEl.style.display = (br.mode === 'auto') ? 'none' : '';

                const triggerBtn = document.getElementById('trigger-friend-request-btn');
                if (triggerBtn) {
                    if (e.blockReapply && e.blockReapply.pendingRequestId) {
                        triggerBtn.textContent = '查看未处理申请';
                        triggerBtn.classList.add('pending');
                    } else {
                        triggerBtn.textContent = '生成好友申请';
                        triggerBtn.classList.remove('pending');
                    }
                }
            } else {
                blockCharacterBtnEl.style.display = '';
                blockSettingsPanelEl.style.display = 'none';
            }
        }
    }

    async function save(e) {
        // 保存单人思维链设置
        const charCotEnabledSave = document.getElementById('setting-char-cot-enabled');
        const charCotChatEnabledSave = document.getElementById('setting-char-cot-chat-enabled');
        const charCotChatPresetSave = document.getElementById('setting-char-cot-chat-preset');
        const charCotCallEnabledSave = document.getElementById('setting-char-cot-call-enabled');
        const charCotCallPresetSave = document.getElementById('setting-char-cot-call-preset');
        const charCotOfflineEnabledSave = document.getElementById('setting-char-cot-offline-enabled');
        const charCotOfflinePresetSave = document.getElementById('setting-char-cot-offline-preset');

        if (!e.cotSettings) e.cotSettings = {};
        e.cotSettings.enabled = charCotEnabledSave ? charCotEnabledSave.checked : false;
        e.cotSettings.chatEnabled = charCotChatEnabledSave ? charCotChatEnabledSave.checked : false;
        e.cotSettings.activePresetId = charCotChatPresetSave ? charCotChatPresetSave.value : '';
        e.cotSettings.callEnabled = charCotCallEnabledSave ? charCotCallEnabledSave.checked : false;
        e.cotSettings.activeCallPresetId = charCotCallPresetSave ? charCotCallPresetSave.value : '';
        e.cotSettings.offlineEnabled = charCotOfflineEnabledSave ? charCotOfflineEnabledSave.checked : false;
        e.cotSettings.activeOfflinePresetId = charCotOfflinePresetSave ? charCotOfflinePresetSave.value : '';

        // 保存小剧场设置
        const charTheaterEnabledSave = document.getElementById('setting-char-theater-enabled');
        const charTheaterProbSave = document.getElementById('setting-char-theater-probability');
        const charTheaterFormatSave = document.getElementById('setting-char-theater-format');
        const charTheaterPromptSave = document.getElementById('setting-char-theater-prompt');
        e.charTheaterEnabled = charTheaterEnabledSave ? charTheaterEnabledSave.checked : false;
        e.charTheaterProbability = charTheaterProbSave ? parseInt(charTheaterProbSave.value, 10) : 20;
        e.charTheaterFormat = charTheaterFormatSave ? charTheaterFormatSave.value : 'text';
        e.charTheaterPrompt = charTheaterPromptSave ? charTheaterPromptSave.value.trim() : '';
        // 保存聊天条数、日记条数
        const charTheaterChatCountSave = document.getElementById('setting-char-theater-chat-count');
        const charTheaterJournalCountSave = document.getElementById('setting-char-theater-journal-count');
        e.charTheaterChatCount = charTheaterChatCountSave ? Math.max(0, parseInt(charTheaterChatCountSave.value, 10) || 0) : 20;
        e.charTheaterJournalCount = charTheaterJournalCountSave ? Math.max(0, parseInt(charTheaterJournalCountSave.value, 10) || 0) : 0;
        // 保存世界书多选（theater风格下拉）
        const charTheaterWbOptionsCont = document.getElementById('setting-char-theater-wb-options');
        if (charTheaterWbOptionsCont) {
            e.charTheaterWorldBookIds = Array.from(
                charTheaterWbOptionsCont.querySelectorAll('.theater-multiselect-option.selected')
            ).map(opt => opt.dataset.id).filter(Boolean);
        } else {
            e.charTheaterWorldBookIds = [];
        }
        // 保存自知开关
        const charTheaterSelfAwareSave = document.getElementById('setting-char-theater-self-aware');
        e.charTheaterSelfAware = charTheaterSelfAwareSave ? charTheaterSelfAwareSave.checked : false;

        // 保存独立 API 设置
        const charTheaterUseCustomApiSave = document.getElementById('setting-char-theater-use-custom-api');
        e.charTheaterUseCustomApi = charTheaterUseCustomApiSave ? charTheaterUseCustomApiSave.checked : false;
        e.charTheaterApiUrl = (document.getElementById('setting-char-theater-api-url')?.value || '').trim();
        e.charTheaterApiKey = (document.getElementById('setting-char-theater-api-key')?.value || '').trim();
        e.charTheaterApiModel = (document.getElementById('setting-char-theater-api-model')?.value || '').trim();

        if (!e.autoReply) e.autoReply = {};
        e.autoReply.enabled = document.getElementById('setting-auto-reply-enabled').checked;

        const modeSelect = document.getElementById('setting-auto-reply-mode');
        e.autoReply.mode = modeSelect ? modeSelect.value : 'fixed';

        const autoReplyIntervalInput = parseInt(document.getElementById('setting-auto-reply-interval').value, 10);
        e.autoReply.interval = isNaN(autoReplyIntervalInput) ? 60 : autoReplyIntervalInput;

        const autoReplyMinInput = parseInt(document.getElementById('setting-auto-reply-min').value, 10);
        e.autoReply.minInterval = isNaN(autoReplyMinInput) ? 60 : autoReplyMinInput;

        const autoReplyMaxInput = parseInt(document.getElementById('setting-auto-reply-max').value, 10);
        e.autoReply.maxInterval = isNaN(autoReplyMaxInput) ? 180 : autoReplyMaxInput;

        // === 保存消息弹窗通知设置 ===
        const bgToastEl = document.getElementById('setting-bg-toast-enabled');
        if (bgToastEl) e.bgToastEnabled = bgToastEl.checked;

        // === 保存免打扰时段设置 ===
        if (!e.autoReply.quietHours) e.autoReply.quietHours = {};
        e.autoReply.quietHours.enabled = document.getElementById('setting-quiet-hours-enabled').checked;
        e.autoReply.quietHours.start = document.getElementById('setting-quiet-hours-start').value || '23:00';
        e.autoReply.quietHours.end = document.getElementById('setting-quiet-hours-end').value || '07:00';

        if (e.isBlocked) {
            if (!e.blockReapply) e.blockReapply = {};
            const blockModeEl = document.getElementById('block-reapply-mode');
            const blockIntervalEl = document.getElementById('block-fixed-interval');
            e.blockReapply.mode = (blockModeEl && blockModeEl.value) || 'fixed';
            e.blockReapply.fixedInterval = blockIntervalEl ? Math.max(1, parseInt(blockIntervalEl.value, 10) || 30) : 30;
        }
        const canBlockUserCheckbox = document.getElementById('setting-can-block-user');
        if (canBlockUserCheckbox) e.canBlockUser = canBlockUserCheckbox.checked;

        const phoneControlEnabledCheckbox = document.getElementById('setting-phone-control-enabled');
        if (phoneControlEnabledCheckbox) e.phoneControlEnabled = phoneControlEnabledCheckbox.checked;
        const phoneControlViewLimitInput = document.getElementById('setting-phone-control-view-limit');
        if (phoneControlViewLimitInput) e.phoneControlViewLimit = Math.min(50, Math.max(5, parseInt(phoneControlViewLimitInput.value, 10) || 10));
        const phoneControlCharFilterCheckbox = document.getElementById('setting-phone-control-char-filter-enabled');
        if (phoneControlCharFilterCheckbox) e.phoneControlCharFilterEnabled = phoneControlCharFilterCheckbox.checked;
        // phoneControlVisibleCharIds 的保存将在弹窗确认时直接操作 db 并触发 saveData，这里无需额外处理，只需保持状态同步
    }

    runtime.register('behavior', {
        setupOrder: 40,
        loadOrder: 30,
        saveOrder: 30,
        setup,
        load,
        save
    });
})(window);
