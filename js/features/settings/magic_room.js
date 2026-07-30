// QWQ V5.8.3 · Proment policy and fixed-slot custom rule settings.
function setupMagicRoomApp() {
    const app = document.getElementById('magic-room-screen');
    if (!app) return;

    const enabledSwitch = document.getElementById('magic-room-custom-prompt-enabled');
    const editorSection = document.getElementById('magic-room-prompt-editor');
    const promptTextarea = document.getElementById('magic-room-custom-prompt');
    const saveBtn = document.getElementById('magic-room-save-btn');
    const resetBtn = document.getElementById('magic-room-reset-prompt-btn');
    const importBtn = document.getElementById('magic-room-import-btn');
    const exportBtn = document.getElementById('magic-room-export-btn');
    const importInput = document.getElementById('magic-room-import-input');

    const policyDefaults = {
        worldBookEnabled: true, worldBookBudget: 2400, worldBookPriority: 20,
        structuredEnabled: true, structuredBudget: 1800, structuredPriority: 30,
        historyEnabled: true, historyCount: 30, statusEnabled: true
    };
    const policyEls = {
        worldBookEnabled: document.getElementById('proment-worldbook-enabled'),
        worldBookBudget: document.getElementById('proment-worldbook-budget'),
        worldBookPriority: document.getElementById('proment-worldbook-priority'),
        structuredEnabled: document.getElementById('proment-structured-enabled'),
        structuredBudget: document.getElementById('proment-structured-budget'),
        structuredPriority: document.getElementById('proment-structured-priority'),
        historyEnabled: document.getElementById('proment-history-enabled'),
        historyCount: document.getElementById('proment-history-count'),
        statusEnabled: document.getElementById('proment-status-enabled')
    };

    function getActivePromentCharacter() {
        const list = Array.isArray(db.characters) ? db.characters : [];
        return list.find(item => String(item.id) === String(window.currentChatId || '')) || list[0] || null;
    }

    function loadPromentPolicy() {
        const policy = Object.assign({}, policyDefaults, db.magicRoom?.contextPolicy || {});
        Object.entries(policyEls).forEach(([key, el]) => {
            if (!el) return;
            if (el.type === 'checkbox') el.checked = Boolean(policy[key]);
            else el.value = policy[key];
        });
    }

    function readPromentPolicy() {
        const number = (key, fallback, min, max = null) => {
            const value = Number(policyEls[key]?.value);
            if (!Number.isFinite(value)) return fallback;
            const normalized = Math.max(min, value);
            return Number.isFinite(max) ? Math.min(max, normalized) : normalized;
        };
        return {
            worldBookEnabled: !!policyEls.worldBookEnabled?.checked,
            worldBookBudget: number('worldBookBudget', 2400, 0, 100000),
            worldBookPriority: number('worldBookPriority', 20, 1, 99),
            structuredEnabled: !!policyEls.structuredEnabled?.checked,
            structuredBudget: number('structuredBudget', 1800, 0, 100000),
            structuredPriority: number('structuredPriority', 30, 1, 99),
            historyEnabled: !!policyEls.historyEnabled?.checked,
            historyCount: Math.trunc(number('historyCount', 30, 0)),
            statusEnabled: !!policyEls.statusEnabled?.checked
        };
    }

    loadPromentPolicy();
    setTimeout(() => window.OvoPromentGovernance?.init?.(), 0);
    document.getElementById('proment-open-worldbook')?.addEventListener('click', () => {
        if (typeof renderWorldBookList === 'function') renderWorldBookList();
        window.switchScreen?.('world-book-screen');
    });
    document.getElementById('proment-open-structured')?.addEventListener('click', () => {
        const char = getActivePromentCharacter();
        if (!char) return showToast('暂无角色，无法打开结构化记忆');
        if (typeof window.openMemoryTableForCharacter === 'function') window.openMemoryTableForCharacter(char.id);
        else window.switchScreen?.('memory-table-screen');
    });

    const defaultTemplate = ``;


    // Load initial settings
    if (db.magicRoom) {
        enabledSwitch.checked = db.magicRoom.customPromptEnabled || false;
        if (db.magicRoom.customPromptTemplate) {
            promptTextarea.value = db.magicRoom.customPromptTemplate;
        } else {
            promptTextarea.value = defaultTemplate;
        }
        editorSection.style.display = enabledSwitch.checked ? 'block' : 'none';
    }

    enabledSwitch.addEventListener('change', () => {
        editorSection.style.display = enabledSwitch.checked ? 'block' : 'none';
    });

    resetBtn.addEventListener('click', () => {
        if (confirm('确定要恢复默认模板吗？当前的修改将会丢失。')) {
            promptTextarea.value = defaultTemplate;
            showToast('已重置为默认模板');
        }
    });

    importBtn.addEventListener('click', () => {
        importInput.click();
    });

    // --- 提示词预设库管理逻辑 ---
    const presetSelect = document.getElementById('magic-room-preset-select');
    const applyPresetBtn = document.getElementById('magic-room-apply-preset');
    const savePresetBtn = document.getElementById('magic-room-save-preset');
    const managePresetsBtn = document.getElementById('magic-room-manage-presets');
    const presetsModal = document.getElementById('magic-room-presets-modal');
    const presetsList = document.getElementById('magic-room-presets-list');
    const closePresetsModalBtn = document.getElementById('magic-room-close-modal');

    function populateMagicRoomPresets() {
        if (!presetSelect) return;
        presetSelect.innerHTML = '<option value="">— 选择 —</option>';
        if (db.magicRoom && db.magicRoom.presets) {
            db.magicRoom.presets.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.name;
                opt.textContent = p.name;
                presetSelect.appendChild(opt);
            });
        }
    }
    
    // 初始化时填充
    populateMagicRoomPresets();

    if (applyPresetBtn) {
        applyPresetBtn.addEventListener('click', () => {
            const selected = presetSelect.value;
            if (!selected) return showToast('请先选择预设');
            const preset = (db.magicRoom.presets || []).find(p => p.name === selected);
            if (preset) {
                promptTextarea.value = preset.template;
                showToast('已加载预设：' + selected);
            }
        });
    }

    if (savePresetBtn) {
        savePresetBtn.addEventListener('click', async () => {
            const template = promptTextarea.value.trim();
            if (!template) return showToast('模板为空，无法保存');
            const name = prompt('请输入预设名称（将覆盖同名预设）：');
            if (!name || !name.trim()) return;
            
            if (!db.magicRoom) db.magicRoom = {};
            if (!db.magicRoom.presets) db.magicRoom.presets = [];
            
            const idx = db.magicRoom.presets.findIndex(p => p.name === name.trim());
            const presetObj = { name: name.trim(), template: template };
            if (idx >= 0) {
                db.magicRoom.presets[idx] = presetObj;
            } else {
                db.magicRoom.presets.push(presetObj);
            }
            
            await saveData();
            populateMagicRoomPresets();
            showToast('预设已保存');
        });
    }

    if (managePresetsBtn) {
        managePresetsBtn.addEventListener('click', () => {
            if (!presetsModal || !presetsList) return;
            presetsList.innerHTML = '';
            const presets = (db.magicRoom && db.magicRoom.presets) || [];
            if (presets.length === 0) {
                presetsList.innerHTML = '<p style="text-align:center;color:#999;padding:10px;">暂无预设</p>';
            } else {
                presets.forEach((p, idx) => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px;border-bottom:1px solid #f0f0f0;';
                    
                    const nameDiv = document.createElement('div');
                    nameDiv.style.cssText = 'flex:1;font-weight:500;';
                    nameDiv.textContent = p.name;
                    
                    const btnWrap = document.createElement('div');
                    btnWrap.style.cssText = 'display:flex;gap:6px;';
                    
                    const renameBtn = document.createElement('button');
                    renameBtn.className = 'btn btn-small';
                    renameBtn.textContent = '重命名';
                    renameBtn.onclick = async () => {
                        const newName = prompt('输入新名称：', p.name);
                        if (!newName || !newName.trim() || newName.trim() === p.name) return;
                        db.magicRoom.presets[idx].name = newName.trim();
                        await saveData();
                        populateMagicRoomPresets();
                        managePresetsBtn.click(); // re-render
                    };
                    
                    const delBtn = document.createElement('button');
                    delBtn.className = 'btn btn-danger btn-small';
                    delBtn.textContent = '删除';
                    delBtn.onclick = async () => {
                        if (!confirm('确定删除预设：' + p.name + '？')) return;
                        db.magicRoom.presets.splice(idx, 1);
                        await saveData();
                        populateMagicRoomPresets();
                        managePresetsBtn.click();
                    };
                    
                    btnWrap.appendChild(renameBtn);
                    btnWrap.appendChild(delBtn);
                    row.appendChild(nameDiv);
                    row.appendChild(btnWrap);
                    presetsList.appendChild(row);
                });
            }
            presetsModal.style.display = 'flex';
        });
    }

    if (closePresetsModalBtn) {
        closePresetsModalBtn.addEventListener('click', () => {
            presetsModal.style.display = 'none';
        });
    }

    importInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            // 兼容单个模板导入
            if (data && data.type === 'ovo-system-prompt-template' && data.template) {
                promptTextarea.value = data.template;
                showToast('模板导入成功');
            } 
            // 支持多个预设数组导入
            else if (Array.isArray(data) && data.length > 0 && data[0].template) {
                if (!db.magicRoom) db.magicRoom = {};
                if (!db.magicRoom.presets) db.magicRoom.presets = [];
                data.forEach(p => {
                    const idx = db.magicRoom.presets.findIndex(exist => exist.name === p.name);
                    if (idx >= 0) db.magicRoom.presets[idx] = p;
                    else db.magicRoom.presets.push(p);
                });
                await saveData();
                populateMagicRoomPresets();
                showToast(`成功导入 ${data.length} 个预设`);
            } else {
                showToast('无效的模板文件');
            }
        } catch (err) {
            showToast('导入失败：' + err.message);
        }
        e.target.value = '';
    });

    exportBtn.addEventListener('click', () => {
        // 如果有预设，优先提示是否导出整个预设库
        if (db.magicRoom && db.magicRoom.presets && db.magicRoom.presets.length > 0) {
            if (confirm('是否导出整个预设库？（点击取消则仅导出当前编辑框内容）')) {
                const blob = new Blob([JSON.stringify(db.magicRoom.presets, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `系统提示词预设库_${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast('预设库导出成功');
                return;
            }
        }
        
        const template = promptTextarea.value;
        if (!template) return showToast('模板为空，无法导出');
        const data = {
            type: 'ovo-system-prompt-template',
            version: 1,
            template: template
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `系统提示词模板_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('模板导出成功');
    });

    saveBtn.addEventListener('click', async () => {
        if (!db.magicRoom) db.magicRoom = {};
        db.magicRoom.customPromptEnabled = enabledSwitch.checked;
        db.magicRoom.customPromptTemplate = promptTextarea.value;
        // 保存系统通知设置
        db.magicRoom.sysNotifEnabled      = sysnotifEnabled ? sysnotifEnabled.checked : false;
        db.magicRoom.sysNotifSenderName   = sysnotifSenderName ? sysnotifSenderName.value.trim() : '';
        db.magicRoom.sysNotifShowAvatar   = sysnotifShowAvatar ? sysnotifShowAvatar.checked : true;
        const sysNotifInChatEnabledEl = document.getElementById('sysnotif-in-chat-enabled');
        db.magicRoom.sysNotifInChatEnabled = sysNotifInChatEnabledEl ? sysNotifInChatEnabledEl.checked : false;
        db.magicRoom.sysNotifShowContent  = sysnotifShowContent ? sysnotifShowContent.checked : true;
        db.magicRoom.sysNotifCustomServer = sysnotifCustomSrv ? sysnotifCustomSrv.checked : false;
        db.magicRoom.sysNotifServerUrl    = sysnotifSrvUrl ? sysnotifSrvUrl.value.trim() : '';
        db.magicRoom.sysNotifServerKey    = sysnotifSrvKey ? sysnotifSrvKey.value.trim() : '';
        db.magicRoom.contextPolicy = readPromentPolicy();
        await saveData();
        showToast('Proment 设置已保存！');
        window.OvoPromentGovernance?.render?.();
    });

    // ===== 系统通知设置初始化 =====
    const sysnotifEnabled    = document.getElementById('sysnotif-enabled');
    const sysnotifOptions    = document.getElementById('sysnotif-options');
    const sysnotifSenderName = document.getElementById('sysnotif-sender-name');
    const sysnotifShowAvatar = document.getElementById('sysnotif-show-avatar');
    const sysnotifShowContent= document.getElementById('sysnotif-show-content');
    const sysnotifCustomSrv  = document.getElementById('sysnotif-custom-server');
    const sysnotifSrvOptions = document.getElementById('sysnotif-server-options');
    const sysnotifSrvUrl     = document.getElementById('sysnotif-server-url');
    const sysnotifSrvKey     = document.getElementById('sysnotif-server-key');
    const sysnotifReqPerm    = document.getElementById('sysnotif-request-permission');
    const sysnotifPermStatus = document.getElementById('sysnotif-permission-status');

    if (sysnotifEnabled) {
        const mr = db.magicRoom || {};
        // 从 db 回填数据
        sysnotifEnabled.checked             = !!mr.sysNotifEnabled;
        sysnotifOptions.style.display       = mr.sysNotifEnabled ? 'block' : 'none';
        sysnotifSenderName.value            = mr.sysNotifSenderName || '';
        sysnotifShowAvatar.checked          = mr.sysNotifShowAvatar !== false;
        const sysNotifInChatEnabledEl = document.getElementById('sysnotif-in-chat-enabled');
        if (sysNotifInChatEnabledEl) sysNotifInChatEnabledEl.checked = !!mr.sysNotifInChatEnabled;
        sysnotifShowContent.checked         = mr.sysNotifShowContent !== false;
        sysnotifCustomSrv.checked           = !!mr.sysNotifCustomServer;
        sysnotifSrvOptions.style.display    = mr.sysNotifCustomServer ? 'block' : 'none';
        sysnotifSrvUrl.value                = mr.sysNotifServerUrl || '';
        sysnotifSrvKey.value                = mr.sysNotifServerKey || '';

        // 更新权限状态提示
        function updateSysNotifPermStatus() {
            if (!('Notification' in window)) {
                sysnotifPermStatus.textContent = '⚠️ 当前浏览器不支持通知 API';
                return;
            }
            const map = {
                granted: '✅ 已授权，系统通知功能可正常使用',
                denied:  '❌ 已被拒绝，请在浏览器/系统设置中手动开启',
                default: '⚪ 尚未申请权限，请点击上方按钮申请'
            };
            sysnotifPermStatus.textContent = map[Notification.permission] || '';
        }
        updateSysNotifPermStatus();

        // 总开关
        sysnotifEnabled.addEventListener('change', () => {
            sysnotifOptions.style.display = sysnotifEnabled.checked ? 'block' : 'none';
        });

        // 自定义服务器开关
        sysnotifCustomSrv.addEventListener('change', () => {
            sysnotifSrvOptions.style.display = sysnotifCustomSrv.checked ? 'block' : 'none';
        });

        // 申请权限按钮
        sysnotifReqPerm.addEventListener('click', async () => {
            if (!('Notification' in window)) {
                showToast('当前浏览器不支持通知 API');
                return;
            }
            const result = await Notification.requestPermission();
            updateSysNotifPermStatus();
            if (result === 'granted') {
                showToast('✅ 通知权限已授权！');
            } else if (result === 'denied') {
                showToast('❌ 权限被拒绝，请在浏览器设置中手动开启');
            } else {
                showToast('未授权，请重试');
            }
        });

        // 发送测试通知按钮
        const sysnotifTestBtn = document.getElementById('sysnotif-test-btn');
        if (sysnotifTestBtn) {
            sysnotifTestBtn.addEventListener('click', async () => {
                if (!('Notification' in window)) {
                    showToast('当前浏览器不支持通知 API');
                    return;
                }
                if (Notification.permission !== 'granted') {
                    showToast('请先申请系统通知权限！');
                    return;
                }
                const name = sysnotifSenderName.value.trim() || '章鱼喷墨机';
                await showSystemNotification({
                    title: name,
                    body: '这是一条系统级通知的测试消息，如果你看到了它，说明设置成功！',
                    icon: 'https://i.postimg.cc/Vk042Snv/5F3BCD91056B989330AE34D11901BD6E.png'
                });
            });
        }
    }
}

