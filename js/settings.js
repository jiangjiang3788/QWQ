// --- 设置与管理逻辑 (js/settings.js) ---
// V2.9-R5: 角色设置由五个领域控制器管理，本文件保留兼容入口与跨域辅助函数。

function setupChatSettings() {
    if (!window.OvoCharacterSettings) {
        throw new Error('角色设置控制器未加载');
    }
    window.OvoCharacterSettings.setupAll();
}

function loadSettingsToSidebar() {
    const character = window.OvoCharacterSettings?.getCurrentCharacter();
    if (!character) return;
    window.OvoCharacterSettings.loadAll(character);
}

async function saveSettingsFromSidebar() {
    const character = window.OvoCharacterSettings?.getCurrentCharacter();
    if (!character) return;

    await window.OvoCharacterSettings.saveAll(character);
    await saveData();
    showToast('设置已保存！');

    if (typeof chatRoomTitle !== 'undefined' && chatRoomTitle) {
        chatRoomTitle.textContent = character.remarkName;
    }
    if (typeof renderChatList === 'function') renderChatList();
    currentPage = 1;
    if (typeof renderMessages === 'function') renderMessages(false, true);
}

function renderSyncGroupList(character) {
    const syncGroupListContainer = document.getElementById('setting-sync-group-list');
    if (!syncGroupListContainer) {
        console.warn('setting-sync-group-list container not found');
        return;
    }
    
    // 如果角色不存在，清空并隐藏
    if (!character) {
        syncGroupListContainer.innerHTML = '';
        syncGroupListContainer.style.display = 'none';
        return;
    }
    
    // 如果开关未打开，清空内容但保持容器存在（显示状态由调用者控制）
    if (!character.syncGroupMemory) {
        syncGroupListContainer.innerHTML = '';
        return;
    }
    
    // 确保容器显示
    syncGroupListContainer.style.display = 'block';
    syncGroupListContainer.innerHTML = '';
    
    // 获取角色所在的所有群聊
    const groupsWithCharacter = db.groups.filter(group => 
        group.members && group.members.some(member => member.originalCharId === character.id)
    );
    
    if (groupsWithCharacter.length === 0) {
        syncGroupListContainer.innerHTML = '<div style="padding: 10px; color: #999; font-size: 12px;">该角色未加入任何群聊</div>';
    } else {
        // 添加标题
        const title = document.createElement('div');
        title.style.fontSize = '13px';
        title.style.color = '#666';
        title.style.marginBottom = '10px';
        title.style.fontWeight = '500';
        title.textContent = '选择要互通的群聊：';
        syncGroupListContainer.appendChild(title);
        
        const syncGroupIds = character.syncGroupIds || [];
        groupsWithCharacter.forEach(group => {
            const checkbox = document.createElement('label');
            checkbox.style.display = 'flex';
            checkbox.style.alignItems = 'center';
            checkbox.style.padding = '8px 0';
            checkbox.style.cursor = 'pointer';
            checkbox.style.userSelect = 'none';
            
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.value = group.id;
            input.checked = syncGroupIds.includes(group.id);
            input.style.marginRight = '10px';
            input.style.width = '18px';
            input.style.height = '18px';
            input.style.cursor = 'pointer';
            
            const label = document.createElement('span');
            label.textContent = group.name || '未命名群聊';
            label.style.fontSize = '14px';
            label.style.color = '#333';
            label.style.flex = '1';
            
            checkbox.appendChild(input);
            checkbox.appendChild(label);
            syncGroupListContainer.appendChild(checkbox);
        });
    }
}

/**
 * 渲染小剧场世界书分类下拉（与创建剧场页面风格一致）
 * @param {string[]} selectedIds - 已选中的世界书ID数组
 */
function _populateCharTheaterWbDropdown(selectedIds) {
    const wbOptions = document.getElementById('setting-char-theater-wb-options');
    const wbDisplay = document.getElementById('setting-char-theater-wb-display');
    const wbDropdown = document.getElementById('setting-char-theater-wb-dropdown');
    if (!wbOptions || !wbDisplay) return;

    // 绑定展开/收起
    if (wbDropdown && !wbDisplay._charTheaterWbBound) {
        wbDisplay._charTheaterWbBound = true;
        wbDisplay.addEventListener('click', (e) => {
            e.stopPropagation();
            wbDropdown.style.display = wbDropdown.style.display === 'block' ? 'none' : 'block';
        });
        document.addEventListener('click', (e) => {
            if (!wbDropdown.contains(e.target) && e.target !== wbDisplay) {
                wbDropdown.style.display = 'none';
            }
        });
    }

    wbOptions.innerHTML = '';
    const allBooks = db.worldBooks || [];
    const selectedSet = new Set(selectedIds);

    if (allBooks.length === 0) {
        wbOptions.innerHTML = '<div style="padding:10px;font-size:12px;color:#999;">暂无世界书</div>';
        _updateCharTheaterWbDisplay(wbDisplay, wbOptions);
        return;
    }

    // 按分类分组
    const grouped = allBooks.reduce((acc, book) => {
        const cat = (book.category && book.category.trim()) || '未分类';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(book);
        return acc;
    }, {});

    const sortedCats = Object.keys(grouped).sort((a, b) => {
        if (a === '未分类') return -1;
        if (b === '未分类') return 1;
        return a.localeCompare(b, 'zh-Hans');
    });

    sortedCats.forEach(cat => {
        const group = document.createElement('div');
        group.className = 'theater-multiselect-group';

        const header = document.createElement('div');
        header.className = 'theater-multiselect-group-header';
        header.innerHTML = `<span class="theater-multiselect-group-title">${cat}</span><span class="theater-multiselect-group-arrow">⌃</span>`;

        const body = document.createElement('div');
        body.className = 'theater-multiselect-group-body';

        grouped[cat].forEach(book => {
            const option = document.createElement('div');
            option.className = 'theater-multiselect-option' + (selectedSet.has(book.id) ? ' selected' : '');
            option.dataset.id = book.id;
            option.innerHTML = `<div class="theater-multiselect-checkbox">✓</div><div class="theater-multiselect-label">${book.name || book.title || '未命名世界书'}</div>`;
            option.addEventListener('click', () => {
                option.classList.toggle('selected');
                _updateCharTheaterWbDisplay(wbDisplay, wbOptions);
            });
            body.appendChild(option);
        });

        if (cat !== '未分类') group.classList.add('collapsed');
        header.addEventListener('click', (e) => { e.stopPropagation(); group.classList.toggle('collapsed'); });

        group.appendChild(header);
        group.appendChild(body);
        wbOptions.appendChild(group);
    });

    _updateCharTheaterWbDisplay(wbDisplay, wbOptions);
}

function _updateCharTheaterWbDisplay(displayEl, optionsEl) {
    if (!displayEl || !optionsEl) return;
    const placeholder = displayEl.querySelector('.theater-multiselect-placeholder');
    if (!placeholder) return;
    const selected = optionsEl.querySelectorAll('.theater-multiselect-option.selected');
    if (selected.length === 0) {
        placeholder.textContent = '请选择世界书（可选）';
        displayEl.classList.remove('has-selection');
    } else {
        const names = Array.from(selected).map(o => {
            const lbl = o.querySelector('.theater-multiselect-label');
            return lbl ? lbl.textContent : '';
        }).filter(Boolean);
        placeholder.textContent = names.length > 2
            ? `已选 ${selected.length} 项：${names.slice(0, 2).join('、')}...`
            : `已选 ${selected.length} 项：${names.join('、')}`;
        displayEl.classList.add('has-selection');
    }
}


function saveCurrentTTSAsPreset() {
    const name = prompt('请输入 TTS 预设名称：');
    if (!name || !name.trim()) return;
    
    const enabled = document.getElementById('minimax-tts-enabled')?.checked || false;
    const groupId = document.getElementById('minimax-group-id')?.value || '';
    const apiKey = document.getElementById('minimax-api-key')?.value || '';
    const domain = document.getElementById('minimax-domain')?.value || 'api.minimaxi.com';
    const model = document.getElementById('minimax-tts-model')?.value || 'speech-2.8-hd';
    
    if (!db.ttsPresets) db.ttsPresets = [];
    
    db.ttsPresets.push({
        name: name.trim(),
        enabled,
        groupId,
        apiKey,
        domain,
        model
    });
    
    saveData();
    showToast('TTS 预设已保存');
    populateTTSPresetSelect();
}

function applyTTSPreset(name) {
    if (!db.ttsPresets) return;
    const preset = db.ttsPresets.find(p => p.name === name);
    if (!preset) return showToast('预设不存在');
    
    document.getElementById('minimax-tts-enabled').checked = preset.enabled || false;
    document.getElementById('minimax-group-id').value = preset.groupId || '';
    document.getElementById('minimax-api-key').value = preset.apiKey || '';
    document.getElementById('minimax-domain').value = preset.domain || 'api.minimaxi.com';
    document.getElementById('minimax-tts-model').value = preset.model || 'speech-2.8-hd';
    
    showToast(`已应用 TTS 预设：${name}`);
}

function populateTTSPresetSelect() {
    const select = document.getElementById('tts-preset-select');
    if (!select) return;
    select.innerHTML = '<option value="">— 选择 —</option>';
    (db.ttsPresets || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        select.appendChild(opt);
    });
}

// openTTSManageModal 已由 settings/preset_manager.js 统一实现。

function importTTSPresets() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const imported = JSON.parse(text);
            if (!Array.isArray(imported)) throw new Error('格式错误');
            db.ttsPresets = db.ttsPresets || [];
            db.ttsPresets.push(...imported);
            await saveData();
            populateTTSPresetSelect();
            showToast(`已导入 ${imported.length} 个 TTS 预设`);
        } catch (err) {
            showToast('导入失败: ' + err.message);
        }
    };
    input.click();
}

function exportTTSPresets() {
    const presets = db.ttsPresets || [];
    if (!presets.length) return showToast('没有可导出的 TTS 预设');
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tts_presets_' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('TTS 预设已导出');
}

// 在页面加载时填充 TTS 预设列表，并绑定气泡样式「导入文档」（委托到 document，因按钮在 chat/group-settings-form 内）
document.addEventListener('DOMContentLoaded', () => {
    populateTTSPresetSelect();

    document.addEventListener('click', (e) => {
        if (e.target.matches('#bubble-css-import-doc-btn')) {
            const el = document.getElementById('bubble-css-import-file');
            if (el) el.click();
        } else if (e.target.matches('#group-bubble-css-import-doc-btn')) {
            const el = document.getElementById('group-bubble-css-import-file');
            if (el) el.click();
        }
    });
    document.addEventListener('change', async (e) => {
        if (e.target.id === 'bubble-css-import-file' || e.target.id === 'group-bubble-css-import-file') {
            const file = e.target.files && e.target.files[0];
            e.target.value = '';
            const textareaId = e.target.id === 'bubble-css-import-file' ? 'setting-custom-bubble-css' : 'setting-group-custom-bubble-css';
            if (!file) return;
            const ext = (file.name.split('.').pop() || '').toLowerCase();
            const textarea = document.getElementById(textareaId);
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
        }
    });
});


// 备份提示
function promptForBackupIfNeeded(triggerType) {
    if (triggerType === 'history_milestone') {
        showToast('uwu提醒您：记得备份噢');
    }
}

// 重新计算并更新角色状态
function recalculateChatStatus(chat) {
    if (!chat || !chat.history) return;
    
    // 仅针对私聊且非群聊
    // 注意：虽然函数参数叫 chat，但在调用处需确保是 private 类型或者在这里判断
    // 由于群聊没有状态栏，这里主要针对 private
    // 但为了通用性，我们可以检查 chat.realName 是否存在
    
    if (!chat.realName) return; // 简单判断，群聊通常没有单人的 realName 用于状态更新（群聊逻辑不同）

    const updateStatusRegex = new RegExp(`\\[${chat.realName}更新状态为：(.*?)\\]`);
    let foundStatus = '在线'; // 默认状态

    // 倒序遍历历史记录
    for (let i = chat.history.length - 1; i >= 0; i--) {
        const msg = chat.history[i];
        // 忽略被撤回的消息
        if (msg.isWithdrawn) continue;

        const match = msg.content.match(updateStatusRegex);
        if (match) {
            foundStatus = match[1];
            break; // 找到最近的一个状态，停止遍历
        }
    }

    // 更新状态
    chat.status = foundStatus;
    
    // 如果当前正在该聊天室，实时更新 UI
    if (currentChatId === chat.id) {
        const statusTextEl = document.getElementById('chat-room-status-text');
        if (statusTextEl) {
            statusTextEl.textContent = foundStatus;
        }
    }
}
