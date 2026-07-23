// V2.9-R4 设置模块：API、生图与子 API 控制器
function setupApiSettingsApp() {
    const e = document.getElementById('api-form'), t = document.getElementById('fetch-models-btn'),
        a = document.getElementById('api-model'), n = document.getElementById('api-provider'),
        r = document.getElementById('api-url'), s = document.getElementById('api-key'), c = {
            newapi: '',
            deepseek: 'https://api.deepseek.com',
            claude: 'https://api.anthropic.com',
            gemini: 'https://generativelanguage.googleapis.com'
        };
    db.apiSettings && (n.value = db.apiSettings.provider || 'newapi', r.value = db.apiSettings.url || '', s.value = db.apiSettings.key || '', db.apiSettings.model && (a.innerHTML = `<option value="${db.apiSettings.model}">${db.apiSettings.model}</option>`));
    if (db.apiSettings && typeof db.apiSettings.onlineRoleEnabled !== 'undefined') { document.getElementById('online-role-switch').checked = db.apiSettings.onlineRoleEnabled; } else { document.getElementById('online-role-switch').checked = true; }
    if (db.apiSettings && typeof db.apiSettings.timePerceptionEnabled !== 'undefined') { document.getElementById('time-perception-switch').checked = db.apiSettings.timePerceptionEnabled; }
    if (db.apiSettings && typeof db.apiSettings.streamEnabled !== 'undefined') { document.getElementById('stream-switch').checked = db.apiSettings.streamEnabled; } else { document.getElementById('stream-switch').checked = true; }
    if (db.apiSettings && typeof db.apiSettings.quickReplyEnabled !== 'undefined') { document.getElementById('quick-reply-switch').checked = db.apiSettings.quickReplyEnabled; } else { document.getElementById('quick-reply-switch').checked = false; }

    const tempSlider = document.getElementById('temperature-slider');
    const tempValue = document.getElementById('temperature-value');
    if (tempSlider && tempValue) {
        const savedTemp = (db.apiSettings && db.apiSettings.temperature !== undefined) ? db.apiSettings.temperature : 1.0;
        tempSlider.value = savedTemp;
        tempValue.textContent = savedTemp;

        tempSlider.addEventListener('input', (e) => {
            tempValue.textContent = e.target.value;
        });
    }

    populateApiSelect();
    n?.addEventListener('change', () => {
        if (r) r.value = c[n.value] || ''
    });

    // 提取为全局函数以便复用
    window.fetchAndPopulateModels = async (showToastFlag = true) => {
        const provider = n.value;
        let apiUrl = r.value.trim();
        const apiKey = s.value.trim();
        const modelSelect = a;
        const fetchBtn = t;

        if (!apiUrl || !apiKey) {
            if (showToastFlag) showToast('请先填写API地址和密钥！');
            return;
        }

        if (BLOCKED_API_DOMAINS.some(domain => apiUrl.includes(domain))) {
            if (showToastFlag) showToast('该 API 站点已被屏蔽，无法使用！');
            return;
        }

        if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
        
        const endpoint = provider === 'gemini' 
            ? `${apiUrl}/v1beta/models?key=${getRandomValue(apiKey)}` 
            : `${apiUrl}/v1/models`;

        if (fetchBtn) {
            fetchBtn.classList.add('loading');
            fetchBtn.disabled = true;
        }

        try {
            const headers = provider === 'gemini' ? {} : { Authorization: `Bearer ${apiKey}` };
            const response = await fetch(endpoint, { method: 'GET', headers });
            
            if (!response.ok) {
                const error = new Error(`网络响应错误: ${response.status}`);
                error.response = response;
                throw error;
            }

            const data = await response.json();
            let models = [];
            
            if (provider !== 'gemini' && data.data) {
                models = data.data.map(e => e.id);
            } else if (provider === 'gemini' && data.models) {
                models = data.models.map(e => e.name.replace('models/', ''));
            }

            // 保留当前选中的值（如果仍在列表中）
            const currentVal = modelSelect.value;
            
            modelSelect.innerHTML = '';
            if (models.length > 0) {
                models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m;
                    opt.textContent = m;
                    modelSelect.appendChild(opt);
                });
                
                // 尝试恢复之前的选择，或者使用设置中的值
                if (models.includes(currentVal)) {
                    modelSelect.value = currentVal;
                } else if (db.apiSettings && db.apiSettings.model && models.includes(db.apiSettings.model)) {
                    modelSelect.value = db.apiSettings.model;
                }
                
                if (showToastFlag) showToast('模型列表拉取成功！');
            } else {
                modelSelect.innerHTML = '<option value="">未找到任何模型</option>';
                if (showToastFlag) showToast('未找到任何模型');
            }
        } catch (err) {
            console.error(err);
            if (showToastFlag) {
                showApiError(err);
                modelSelect.innerHTML = '<option value="">拉取失败</option>';
            }
        } finally {
            if (fetchBtn) {
                fetchBtn.classList.remove('loading');
                fetchBtn.disabled = false;
            }
        }
    };

    t?.addEventListener('click', () => window.fetchAndPopulateModels(true));
    e?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!a.value) return showToast('请选择模型后保存！');
        if (BLOCKED_API_DOMAINS.some(domain => r.value.includes(domain))) {
            return showToast('该 API 站点已被屏蔽，无法保存！');
        }
        db.apiSettings = {
            provider: n.value,
            url: r.value,
            key: s.value,
            model: a.value,
            onlineRoleEnabled: document.getElementById('online-role-switch').checked,
            timePerceptionEnabled: document.getElementById('time-perception-switch').checked,
            streamEnabled: document.getElementById('stream-switch').checked,
            quickReplyEnabled: document.getElementById('quick-reply-switch').checked,
            temperature: parseFloat(document.getElementById('temperature-slider').value)
        };
        
        // 保存自动识图全局开关
        const irSwitch = document.getElementById('imageRecognition-enabled-switch');
        if (irSwitch) {
            db.imageRecognitionEnabled = irSwitch.checked;
        }

        await saveData();
        showToast('API设置已保存！')
    });
    
    // === 副API设置：总结API ===
    setupSubApiSettings('summary', 'summaryApiSettings', 'summaryApiPresets');
    
    // === 副API设置：后台活动API ===
    setupSubApiSettings('background', 'backgroundApiSettings', 'backgroundApiPresets');

    // === 副API设置：向量记忆 Embedding API ===
    setupSubApiSettings('vector', 'vectorApiSettings', 'vectorApiPresets');
    
    // === 副API设置：补齐人设API ===
    setupSubApiSettings('supplementPersona', 'supplementPersonaApiSettings', 'supplementPersonaApiPresets');
    
    // === 副API设置：偷看手机API ===
    // V6.0: Peek-specific API settings are retired.
    // setupSubApiSettings('peek', 'peekApiSettings', 'peekApiPresets');

    // === 副API设置：自动识图 API ===
    setupSubApiSettings('imageRecognition', 'imageRecognitionApiSettings', 'imageRecognitionApiPresets');
    
    if (db.imageRecognitionEnabled !== undefined) {
        document.getElementById('imageRecognition-enabled-switch').checked = db.imageRecognitionEnabled;
    } else {
        document.getElementById('imageRecognition-enabled-switch').checked = false; // 默认关闭
    }

    // === 副API设置：表情包识图 API ===
    setupSubApiSettings('stickerRecognition', 'stickerRecognitionApiSettings', 'stickerRecognitionApiPresets');

    // === 全局天气服务 API ===
    const weatherProviderEl = document.getElementById('weather-api-provider');
    const weatherKeyEl = document.getElementById('weather-api-key');
    const weatherKeyCont = document.getElementById('weather-api-key-container');
    const weatherSaveBtn = document.getElementById('weather-api-save-btn');

    if (weatherProviderEl) {
        if (db.weatherApiSettings) {
            weatherProviderEl.value = db.weatherApiSettings.provider || 'openmeteo';
            if (weatherKeyEl) weatherKeyEl.value = db.weatherApiSettings.key || '';
        }
        
        const updateWeatherKeyVisibility = () => {
            const provider = weatherProviderEl.value;
            if (provider === 'qweather' || provider === 'seniverse') {
                if (weatherKeyCont) weatherKeyCont.style.display = 'flex';
            } else {
                if (weatherKeyCont) weatherKeyCont.style.display = 'none';
            }
        };
        weatherProviderEl.addEventListener('change', updateWeatherKeyVisibility);
        updateWeatherKeyVisibility();

        if (weatherSaveBtn) {
            weatherSaveBtn.addEventListener('click', async () => {
                db.weatherApiSettings = {
                    provider: weatherProviderEl.value,
                    key: weatherKeyEl ? weatherKeyEl.value.trim() : ''
                };
                await saveData();
                showToast('全局天气 API 设置已保存！');
            });
        }
    }

    // === NovelAI 生图 API 设置 ===
    setupNovelAiSettings();

    // === GPT 生图 API 设置 ===
    setupGptImageSettings();
}

// 提取为全局函数以便复用
window.fetchAndPopulateGptModels = async (showToastFlag = true) => {
    const urlEl = document.getElementById('gpt-image-url');
    const keyEl = document.getElementById('gpt-image-key');
    const modelEl = document.getElementById('gpt-image-model');
    const modelSelectEl = document.getElementById('gpt-image-model-select');
    const fetchModelsBtn = document.getElementById('gpt-image-fetch-models-btn');

    // 如果是通过自动调用且没有 DOM，尝试从 db 中读取
    const apiUrl = urlEl ? urlEl.value.trim() : (db.gptImageSettings?.url || '');
    const apiKey = keyEl ? keyEl.value.trim() : (db.gptImageSettings?.key || '');

    if (!apiUrl || !apiKey) {
        if (showToastFlag) showToast('请先填写 GPT API 地址和 Key');
        return;
    }

    const blockedDomains = (typeof BLOCKED_API_DOMAINS !== 'undefined') ? BLOCKED_API_DOMAINS : [];
    if (blockedDomains.some(d => apiUrl.includes(d))) {
        if (showToastFlag) showToast('该API站点已被屏蔽');
        return;
    }

    const endpoint = `${apiUrl.replace(/\/$/, '')}/v1/models`;
    let origText = '';
    if (fetchModelsBtn) {
        fetchModelsBtn.disabled = true;
        origText = fetchModelsBtn.textContent;
        fetchModelsBtn.textContent = '拉取中…';
    }

    try {
        const resp = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        const models = (json.data || []).map(m => m.id).filter(Boolean).sort();
        
        if (!models.length) {
            if (showToastFlag) showToast('未找到可用模型');
            if (modelSelectEl) modelSelectEl.innerHTML = '<option value="">未找到任何模型</option>';
            return;
        }

        const cur = modelEl ? modelEl.value : (db.gptImageSettings?.model || '');
        if (modelSelectEl) {
            modelSelectEl.innerHTML = '<option value="">— 请选择 —</option>';
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                modelSelectEl.appendChild(opt);
            });
            if (models.includes(cur)) modelSelectEl.value = cur;
        }
        if (showToastFlag) showToast(`成功拉取 ${models.length} 个模型`);
    } catch (err) {
        console.error('[GPT Image] 拉取模型失败:', err);
        if (showToastFlag) showToast('拉取模型失败：' + (err.message || '未知错误'));
        if (modelSelectEl) modelSelectEl.innerHTML = '<option value="">拉取失败</option>';
    } finally {
        if (fetchModelsBtn) {
            fetchModelsBtn.disabled = false;
            fetchModelsBtn.textContent = origText;
        }
    }
};

// --- 预设管理 ---
function _getApiPresets() {
    return db.apiPresets || [];
}
function _saveApiPresets(arr) {
    db.apiPresets = arr || [];
    saveData();
}

function populateApiSelect() {
    const sel = document.getElementById('api-preset-select');
    if (!sel) return;
    const presets = _getApiPresets();
    sel.innerHTML = '<option value="">— 选择 API 预设 —</option>';
    presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    sel.appendChild(opt);
    });
}

function saveCurrentApiAsPreset() {
    const apiKeyEl = document.querySelector('#api-key');
    const apiUrlEl = document.querySelector('#api-url');
    const providerEl = document.querySelector('#api-provider');
    const modelEl = document.querySelector('#api-model');

    const data = {
        apiKey: apiKeyEl ? apiKeyEl.value : '',
        apiUrl: apiUrlEl ? apiUrlEl.value : '',
        provider: providerEl ? providerEl.value : '',
        model: modelEl ? modelEl.value : ''
    };
    
    let name = prompt('为该 API 预设填写名称（会覆盖同名预设）：');
    if (!name) return;
    const presets = _getApiPresets();
    const idx = presets.findIndex(p => p.name === name);
    const preset = {name: name, data: data};
    if (idx >= 0) presets[idx] = preset; else presets.push(preset);
    _saveApiPresets(presets);
    populateApiSelect();
    showToast('API 预设已保存');
}

async function applyApiPreset(name) {
    const presets = _getApiPresets();
    const p = presets.find(x => x.name === name);
    if (!p) return showToast('未找到该预设');
    try {
        const apiKeyEl = document.querySelector('#api-key');
        const apiUrlEl = document.querySelector('#api-url');
        const providerEl = document.querySelector('#api-provider');
        const modelEl = document.querySelector('#api-model');

        if (apiKeyEl && p.data && typeof p.data.apiKey !== 'undefined') apiKeyEl.value = p.data.apiKey;
        if (apiUrlEl && p.data && typeof p.data.apiUrl !== 'undefined') apiUrlEl.value = p.data.apiUrl;
        if (providerEl && p.data && typeof p.data.provider !== 'undefined') providerEl.value = p.data.provider;
        if (modelEl && p.data && typeof p.data.model !== 'undefined') {
            modelEl.innerHTML = `<option value="${p.data.model}">${p.data.model}</option>`;
            modelEl.value = p.data.model;
        }

        showToast('已应用 API 预设');
    } catch(e) {
        console.error('applyApiPreset error', e);
    }
}

// openApiManageModal 已由 settings/preset_manager.js 统一实现。

function exportApiPresets() {
    const presets = _getApiPresets();
    const blob = new Blob([JSON.stringify(presets, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'api_presets.json'; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}
function importApiPresets() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json';
    inp.onchange = function(e){
        const f = e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = function(){ try { const data = JSON.parse(r.result); if (Array.isArray(data)) { _saveApiPresets(data); populateApiSelect(); openApiManageModal(); } else alert('文件格式不正确'); } catch(e){ alert('导入失败：'+e.message); } };
        r.readAsText(f);
    };
    inp.click();
}

    // === 副API通用设置函数 ===
    var subApiDisplayNames = { summary: '总结', background: '后台活动', vector: '向量记忆', supplementPersona: '补齐人设', imageRecognition: '自动识图', stickerRecognition: '表情包识图' };
function setupSubApiSettings(prefix, dbKey, presetsKey) {
    const displayName = subApiDisplayNames[prefix] || prefix;
    const roleMap = {
        summary: 'summary',
        background: 'background',
        vector: 'vector',
        supplementPersona: 'persona',
        imageRecognition: 'vision',
        stickerRecognition: 'stickerVision'
    };
    const role = roleMap[prefix] || prefix;
    const registry = window.OVOApiServiceRegistry || null;
    const providerEl = document.getElementById(`${prefix}-api-provider`);
    const urlEl = document.getElementById(`${prefix}-api-url`);
    const keyEl = document.getElementById(`${prefix}-api-key`);
    const modelEl = document.getElementById(`${prefix}-api-model`);
    const fetchBtn = document.getElementById(`${prefix}-fetch-models-btn`);
    const saveBtn = document.getElementById(`${prefix}-api-save-btn`);
    const batchSizeEl = prefix === 'vector' ? document.getElementById('vector-api-batch-size') : null;
    const dimensionsEl = prefix === 'vector' ? document.getElementById('vector-api-dimensions') : null;
    const healthEl = prefix === 'vector' ? document.getElementById('vector-api-health') : null;

    if (!providerEl || !urlEl || !keyEl || !modelEl || !fetchBtn || !saveBtn) return;

    const providerUrls = {
        newapi: '',
        deepseek: 'https://api.deepseek.com',
        claude: 'https://api.anthropic.com',
        gemini: 'https://generativelanguage.googleapis.com'
    };

    function draftConfig() {
        const config = {
            provider: providerEl.value || 'newapi',
            protocol: providerEl.value === 'gemini' ? 'gemini' : 'openai-compatible',
            url: urlEl.value.trim(),
            key: keyEl.value.trim(),
            model: modelEl.value
        };
        if (prefix === 'vector') {
            config.batchSize = Math.max(1, Math.min(128, parseInt(batchSizeEl?.value, 10) || 8));
            const dimensions = parseInt(dimensionsEl?.value, 10);
            if (Number.isFinite(dimensions) && dimensions > 0) config.dimensions = dimensions;
        }
        return config;
    }

    function setVectorHealth(state, label, detail = '') {
        if (!healthEl) return;
        healthEl.dataset.state = state;
        healthEl.textContent = label;
        healthEl.title = detail;
    }

    function dispatchConfigSaved() {
        const event = new CustomEvent('api-config-saved', { bubbles: true, detail: { prefix, role, dbKey } });
        (providerEl.closest('.collapsible-section') || document.getElementById('api-settings-screen'))?.dispatchEvent(event);
    }

    const saved = db[dbKey] || {};
    if (prefix === 'vector') {
        providerEl.value = saved.provider === 'gemini' ? 'gemini' : 'newapi';
    } else {
        providerEl.value = saved.provider || 'newapi';
    }
    urlEl.value = saved.url || '';
    keyEl.value = saved.key || '';
    if (saved.model) modelEl.innerHTML = `<option value="${saved.model}">${saved.model}</option>`;
    if (batchSizeEl) batchSizeEl.value = String(Math.max(1, Math.min(128, parseInt(saved.batchSize, 10) || 8)));
    if (dimensionsEl) dimensionsEl.value = Number(saved.dimensions) > 0 ? String(saved.dimensions) : '';
    if (prefix === 'vector') {
        if (saved.health === 'ready' && Number(saved.verifiedDimension) > 0) {
            setVectorHealth('ready', `已验证 · ${saved.verifiedDimension} 维`);
        } else if (saved.health === 'error') {
            setVectorHealth('error', '验证失败', saved.lastError || '');
        } else if (saved.url || saved.key || saved.model) {
            setVectorHealth('unverified', '待验证');
        } else {
            setVectorHealth('missing', '未配置');
        }
    }

    providerEl.addEventListener('change', () => {
        urlEl.value = providerUrls[providerEl.value] || '';
        if (prefix === 'vector') setVectorHealth('unverified', '待验证');
    });

    fetchBtn.addEventListener('click', async () => {
        const config = draftConfig();
        if (!config.url || !config.key) return showToast('请先填写 API 地址和密钥！');
        if (BLOCKED_API_DOMAINS.some(domain => config.url.includes(domain))) return showToast('该 API 站点已被屏蔽，无法使用！');
        fetchBtn.classList.add('loading');
        fetchBtn.disabled = true;
        try {
            let models = [];
            let embeddingCandidates = [];
            if (registry) {
                const result = await registry.fetchModels(role, config);
                models = result.models || [];
                embeddingCandidates = result.embeddingCandidates || [];
            } else {
                let apiUrl = config.url.replace(/\/$/, '');
                const endpoint = config.provider === 'gemini'
                    ? `${apiUrl}/v1beta/models?key=${getRandomValue(config.key)}`
                    : `${apiUrl}${/\/v1$/i.test(apiUrl) ? '' : '/v1'}/models`;
                const headers = config.provider === 'gemini' ? {} : { Authorization: `Bearer ${config.key}` };
                const response = await fetch(endpoint, { method: 'GET', headers });
                if (!response.ok) throw new Error(`网络响应错误: ${response.status}`);
                const data = await response.json();
                models = config.provider === 'gemini'
                    ? (data.models || []).map(item => item.name.replace(/^models\//, ''))
                    : (data.data || []).map(item => item.id);
            }

            const previous = modelEl.value || saved.model || '';
            modelEl.innerHTML = '<option value="">— 请选择模型 —</option>';
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = prefix === 'vector' && registry?.looksLikeEmbeddingModel(model) ? `${model} · 向量候选` : model;
                modelEl.appendChild(option);
            });
            if (previous && models.includes(previous)) modelEl.value = previous;
            if (!models.length) {
                modelEl.innerHTML = '<option value="">未找到任何模型</option>';
                showToast('未找到任何模型');
            } else if (prefix === 'vector') {
                setVectorHealth('unverified', '待验证');
                showToast(embeddingCandidates.length
                    ? `已拉取 ${models.length} 个模型，其中 ${embeddingCandidates.length} 个疑似向量模型；保存时会真实验证。`
                    : `已拉取 ${models.length} 个模型。请选择 Embedding 模型，保存时会真实验证。`);
            } else {
                showToast(`模型列表拉取成功，共 ${models.length} 个！`);
            }
        } catch (err) {
            console.error(err);
            if (typeof showApiError === 'function') showApiError(err);
            else showToast(err.message || '模型列表拉取失败');
            modelEl.innerHTML = '<option value="">拉取失败</option>';
            if (prefix === 'vector') setVectorHealth('error', '拉取失败', err.message || String(err));
        } finally {
            fetchBtn.classList.remove('loading');
            fetchBtn.disabled = false;
        }
    });

    saveBtn.addEventListener('click', async () => {
        const config = draftConfig();
        if (!config.model && (config.url || config.key)) return showToast('请选择模型后保存！');
        if (BLOCKED_API_DOMAINS.some(domain => config.url.includes(domain))) return showToast('该 API 站点已被屏蔽，无法保存！');

        if (!config.url && !config.key && !config.model) {
            db[dbKey] = {};
            await saveData();
            if (prefix === 'vector') setVectorHealth('missing', '未配置');
            dispatchConfigSaved();
            showToast(displayName + ' API 设置已清空！');
            return;
        }

        if (prefix === 'vector') {
            saveBtn.classList.add('loading');
            saveBtn.disabled = true;
            setVectorHealth('unverified', '验证中…');
            try {
                if (!registry) throw new Error('统一 API 服务未加载');
                const result = await registry.testEmbedding(config);
                db[dbKey] = {
                    ...config,
                    enabled: true,
                    health: 'ready',
                    verifiedAt: Date.now(),
                    verifiedDimension: result.dimension,
                    verifiedLatencyMs: result.latencyMs,
                    lastError: ''
                };
                await saveData();
                setVectorHealth('ready', `已验证 · ${result.dimension} 维`);
                dispatchConfigSaved();
                showToast(`向量 API 已验证并保存：${result.dimension} 维，${result.latencyMs} ms`);
            } catch (err) {
                const message = String(err?.message || err || '未知错误').slice(0, 600);
                db[dbKey] = {
                    ...config,
                    enabled: false,
                    health: 'error',
                    verifiedAt: null,
                    verifiedDimension: null,
                    lastError: message
                };
                await saveData();
                setVectorHealth('error', '验证失败', message);
                dispatchConfigSaved();
                showToast(`向量 API 验证失败：${message}`);
            } finally {
                saveBtn.classList.remove('loading');
                saveBtn.disabled = false;
            }
            return;
        }

        db[dbKey] = config;
        await saveData();
        dispatchConfigSaved();
        showToast(displayName + ' API 设置已保存！');
    });

    setupSubApiPresets(prefix, dbKey, presetsKey);
}

// === 副API预设管理 ===
function setupSubApiPresets(prefix, dbKey, presetsKey) {
    const presetSelect = document.getElementById(`${prefix}-api-preset-select`);
    const applyBtn = document.getElementById(`${prefix}-api-apply-preset`);
    const savePresetBtn = document.getElementById(`${prefix}-api-save-preset`);
    const manageBtn = document.getElementById(`${prefix}-api-manage-presets`);
    const importBtn = document.getElementById(`${prefix}-api-import-presets`);
    const exportBtn = document.getElementById(`${prefix}-api-export-presets`);
    const modal = document.getElementById(`${prefix}-api-presets-modal`);
    const closeModalBtn = document.getElementById(`${prefix}-api-close-modal`);
    const presetsList = document.getElementById(`${prefix}-api-presets-list`);
    
    // 填充预设列表
    function populatePresets() {
        const presets = db[presetsKey] || [];
        if (presetSelect) presetSelect.innerHTML = '<option value="">— 选择 —</option>';
        presets.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = p.name;
            if (presetSelect) presetSelect.appendChild(opt);
        });
    }
    
    populatePresets();
    
    // 应用预设
    applyBtn?.addEventListener('click', async () => {
        const name = presetSelect ? presetSelect.value : '';
        if (!name) return showToast('请选择预设');
        
        const presets = db[presetsKey] || [];
        const preset = presets.find(p => p.name === name);
        if (!preset) return showToast('未找到该预设');
        
        try {
            const providerEl = document.getElementById(`${prefix}-api-provider`);
            const urlEl = document.getElementById(`${prefix}-api-url`);
            const keyEl = document.getElementById(`${prefix}-api-key`);
            const modelEl = document.getElementById(`${prefix}-api-model`);
            const batchSizeEl = prefix === 'vector' ? document.getElementById('vector-api-batch-size') : null;
            const dimensionsEl = prefix === 'vector' ? document.getElementById('vector-api-dimensions') : null;
            const healthEl = prefix === 'vector' ? document.getElementById('vector-api-health') : null;
            const presetData = preset.data || {};
            const normalizedProvider = prefix === 'vector'
                ? (presetData.provider === 'gemini' || presetData.protocol === 'gemini' ? 'gemini' : 'newapi')
                : presetData.provider;

            if (providerEl && normalizedProvider) providerEl.value = normalizedProvider;
            if (urlEl) urlEl.value = presetData.apiUrl || presetData.url || '';
            if (keyEl) keyEl.value = presetData.apiKey || presetData.key || '';
            if (modelEl && presetData.model) {
                modelEl.innerHTML = `<option value="${presetData.model}">${presetData.model}</option>`;
            }
            if (batchSizeEl) batchSizeEl.value = String(Math.max(1, Math.min(128, parseInt(presetData.batchSize, 10) || 8)));
            if (dimensionsEl) dimensionsEl.value = Number(presetData.dimensions) > 0 ? String(presetData.dimensions) : '';
            if (healthEl) {
                healthEl.dataset.state = 'unverified';
                healthEl.textContent = '待验证';
                healthEl.title = '预设只填充表单；点击“测试并保存向量 API”后才会启用。';
            }

            showToast(prefix === 'vector' ? '预设已应用，请测试并保存后启用。' : '预设已应用到表单！');
        } catch (err) {
            console.error(err);
            showToast('应用预设失败');
        }
    });
    
    // 另存为预设
    savePresetBtn?.addEventListener('click', () => {
        const providerEl = document.getElementById(`${prefix}-api-provider`);
        const urlEl = document.getElementById(`${prefix}-api-url`);
        const keyEl = document.getElementById(`${prefix}-api-key`);
        const modelEl = document.getElementById(`${prefix}-api-model`);
        const batchSizeEl = prefix === 'vector' ? document.getElementById('vector-api-batch-size') : null;
        const dimensionsEl = prefix === 'vector' ? document.getElementById('vector-api-dimensions') : null;

        const data = {
            provider: providerEl ? providerEl.value : '',
            protocol: providerEl?.value === 'gemini' ? 'gemini' : 'openai-compatible',
            apiUrl: urlEl ? urlEl.value.trim() : '',
            apiKey: keyEl ? keyEl.value.trim() : '',
            model: modelEl ? modelEl.value : ''
        };
        if (prefix === 'vector') {
            data.batchSize = Math.max(1, Math.min(128, parseInt(batchSizeEl?.value, 10) || 8));
            const dimensions = parseInt(dimensionsEl?.value, 10);
            if (Number.isFinite(dimensions) && dimensions > 0) data.dimensions = dimensions;
        }
        
        let name = prompt('为该预设填写名称（会覆盖同名预设）：');
        if (!name) return;
        
        const presets = db[presetsKey] || [];
        const idx = presets.findIndex(p => p.name === name);
        const preset = { name: name, data: data };
        
        if (idx >= 0) presets[idx] = preset;
        else presets.push(preset);
        
        db[presetsKey] = presets;
        saveData();
        populatePresets();
        showToast('预设已保存');
    });
    
    // 管理预设
    manageBtn?.addEventListener('click', () => {
        renderPresetsList();
        if (modal) modal.style.display = 'flex';
    });
    
    function renderPresetsList() {
        const presets = db[presetsKey] || [];
        presetsList.innerHTML = '';
        
        if (presets.length === 0) {
            presetsList.innerHTML = '<p style="text-align:center;color:#999;">暂无预设</p>';
            return;
        }
        
        presets.forEach((preset, idx) => {
            const div = document.createElement('div');
            div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px;margin-bottom:6px;border:1px solid #e0e0e0;border-radius:6px;background:#fafafa;';
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = preset.name;
            nameSpan.style.cssText = 'flex:1;font-weight:500;';
            
            const delBtn = document.createElement('button');
            delBtn.textContent = '删除';
            delBtn.className = 'btn btn-small';
            delBtn.style.cssText = 'background:#ff4444;color:white;padding:4px 12px;';
            delBtn.onclick = () => {
                if (confirm(`确定删除预设"${preset.name}"吗？`)) {
                    presets.splice(idx, 1);
                    db[presetsKey] = presets;
                    saveData();
                    renderPresetsList();
                    populatePresets();
                    showToast('预设已删除');
                }
            };
            
            div.appendChild(nameSpan);
            div.appendChild(delBtn);
            if (presetsList) presetsList.appendChild(div);
        });
    }
    
    closeModalBtn?.addEventListener('click', () => {
        if (modal) modal.style.display = 'none';
    });
    
    // 导入预设
    importBtn?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
                const text = await file.text();
                const imported = JSON.parse(text);
                
                if (!Array.isArray(imported)) {
                    showToast('文件格式错误');
                    return;
                }
                
                db[presetsKey] = db[presetsKey] || [];
                imported.forEach(preset => {
                    const idx = db[presetsKey].findIndex(p => p.name === preset.name);
                    if (idx >= 0) db[presetsKey][idx] = preset;
                    else db[presetsKey].push(preset);
                });
                
                await saveData();
                populatePresets();
                showToast('预设已导入');
            } catch (err) {
                console.error(err);
                showToast('导入失败，请检查文件格式');
            }
        };
        input.click();
    });
    
    // 导出预设
    exportBtn?.addEventListener('click', () => {
        const presets = db[presetsKey] || [];
        if (presets.length === 0) {
            showToast('暂无预设可导出');
            return;
        }
        
        const json = JSON.stringify(presets, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${prefix}_api_presets_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('预设已导出');
    });
}

// === NovelAI 生图 API 设置 ===
// === GPT 生图 API 设置 ===
function setupGptImageSettings() {
    const urlEl = document.getElementById('gpt-image-url');
    const keyEl = document.getElementById('gpt-image-key');
    const modelEl = document.getElementById('gpt-image-model');
    const modelSelectEl = document.getElementById('gpt-image-model-select');
    const fetchModelsBtn = document.getElementById('gpt-image-fetch-models-btn');
    const sizeEl = document.getElementById('gpt-image-size');
    const sysPromptEl = document.getElementById('gpt-image-system-prompt');
    const negPromptEl = document.getElementById('gpt-image-negative-prompt');
    const saveBtn = document.getElementById('gpt-image-save-btn');
    const testBtn = document.getElementById('gpt-image-test-btn');

    // 预设管理DOM
    const presetSelect = document.getElementById('gpt-image-preset-select');
    const applyPresetBtn = document.getElementById('gpt-image-apply-preset');
    const savePresetBtn = document.getElementById('gpt-image-save-preset');
    const managePresetBtn = document.getElementById('gpt-image-manage-presets');
    const importPresetBtn = document.getElementById('gpt-image-import-presets');
    const exportPresetBtn = document.getElementById('gpt-image-export-presets');
    const manageModal = document.getElementById('gpt-image-presets-modal');
    const closeModalBtn = document.getElementById('gpt-image-close-modal');
    const presetListContainer = document.getElementById('gpt-image-presets-list');

    // 互斥开关逻辑
    const gptEnabledCheckbox = document.getElementById('gpt-image-enabled');
    if (gptEnabledCheckbox) {
        gptEnabledCheckbox.addEventListener('change', function() {
            if (this.checked) {
                const novelaiEnabledCheckbox = document.getElementById('novelai-enabled');
                if (novelaiEnabledCheckbox && novelaiEnabledCheckbox.checked) {
                    novelaiEnabledCheckbox.checked = false;
                    showToast('已自动关闭 NovelAI 生图，两种生图引擎只能开启一个');
                }
            }
        });
    }

    // 加载设置
    if (db.gptImageSettings) {
        const s = db.gptImageSettings;
        const enabledEl = document.getElementById('gpt-image-enabled');
        if (enabledEl) enabledEl.checked = !!s.enabled;
        if (urlEl) urlEl.value = s.url || '';
        if (keyEl) keyEl.value = s.key || '';
        if (modelEl) modelEl.value = s.model || 'dall-e-3';
        let defaultSize = '512x512';
        if (Object.keys(s).length > 0 && !s.size) {
            defaultSize = '1024x1024';
        }
        if (sizeEl) sizeEl.value = s.size || defaultSize;
        if (sysPromptEl) sysPromptEl.value = s.systemPrompt || '';
        if (negPromptEl) negPromptEl.value = s.negativePrompt || '';
    }

    // 保存设置
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const enabledEl = document.getElementById('gpt-image-enabled');
            let defaultSize = '512x512';
            if (db.gptImageSettings && Object.keys(db.gptImageSettings).length > 0 && !db.gptImageSettings.size) {
                defaultSize = '1024x1024';
            }
            db.gptImageSettings = {
                enabled: enabledEl ? enabledEl.checked : false,
                url: urlEl ? urlEl.value.trim() : '',
                key: keyEl ? keyEl.value.trim() : '',
                model: modelEl ? modelEl.value.trim() : 'dall-e-3',
                size: sizeEl ? sizeEl.value : defaultSize,
                systemPrompt: sysPromptEl ? sysPromptEl.value.trim() : '',
                negativePrompt: negPromptEl ? negPromptEl.value.trim() : ''
            };
            await saveData();
            showToast('GPT 生图设置已保存！');
        });
    }

    // 拉取模型
    if (fetchModelsBtn) {
        fetchModelsBtn.addEventListener('click', () => window.fetchAndPopulateGptModels(true));
    }

    if (modelSelectEl) {
        modelSelectEl.addEventListener('change', () => {
            if (modelSelectEl.value && modelEl) {
                modelEl.value = modelSelectEl.value;
            }
        });
    }

    // 测试生图
    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            const url = urlEl ? urlEl.value.trim() : '';
            const key = keyEl ? keyEl.value.trim() : '';
            if (!url || !key) {
                showToast('请先填写 GPT API 地址和 Key');
                return;
            }

            testBtn.disabled = true;
            testBtn.querySelector('.btn-text').textContent = '⏳ 生成中...';

            try {
                // 如果 window.generateGptImage 还没有加载出来，做个安全检查
                if (typeof generateGptImage !== 'function') {
                    throw new Error('生图功能尚未就绪，请刷新重试');
                }

                let defaultSize = '512x512';
                if (db.gptImageSettings && Object.keys(db.gptImageSettings).length > 0 && !db.gptImageSettings.size) {
                    defaultSize = '1024x1024';
                }
                const result = await generateGptImage('1girl, beautiful, masterpiece', {
                    url: url,
                    key: key,
                    model: modelEl ? modelEl.value.trim() : 'dall-e-3',
                    size: sizeEl ? sizeEl.value : defaultSize,
                    systemPrompt: sysPromptEl ? sysPromptEl.value.trim() : '',
                    negativePrompt: negPromptEl ? negPromptEl.value.trim() : ''
                });

                if (result && result.imageUrl) {
                    const preview = document.getElementById('gpt-image-test-preview');
                    const img = document.getElementById('gpt-image-test-image');
                    if (preview && img) {
                        img.src = result.imageUrl;
                        preview.style.display = 'block';
                        img.onclick = () => {
                            if (typeof openImageViewer === 'function') {
                                openImageViewer(result.imageUrl);
                            }
                        };
                        img.style.cursor = 'zoom-in';
                    }
                    showToast('✅ GPT 测试生图成功！');
                }
            } catch (err) {
                console.error('[GPT Image] 测试生图失败:', err);
                showToast('❌ 生图失败: ' + (err.message || '未知错误'));
            } finally {
                testBtn.disabled = false;
                testBtn.querySelector('.btn-text').textContent = '🎨 测试 GPT 生图';
            }
        });
    }

    // 预设管理逻辑
    function _getGptPresets() {
        return db.gptImagePresets || [];
    }
    
    function _saveGptPresets(arr) {
        db.gptImagePresets = arr || [];
        saveData();
    }

    function populateGptPresets() {
        if (!presetSelect) return;
        const presets = _getGptPresets();
        presetSelect.innerHTML = '<option value="">— 选择 —</option>';
        presets.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = p.name;
            presetSelect.appendChild(opt);
        });
    }

    populateGptPresets();

    if (applyPresetBtn) {
        applyPresetBtn.addEventListener('click', () => {
            const name = presetSelect.value;
            if (!name) return showToast('请先选择预设');
            const p = _getGptPresets().find(x => x.name === name);
            if (!p) return showToast('未找到该预设');

            const enabledEl = document.getElementById('gpt-image-enabled');
            if (enabledEl && p.data.enabled !== undefined) enabledEl.checked = !!p.data.enabled;
            if (urlEl && p.data.url !== undefined) urlEl.value = p.data.url;
            if (keyEl && p.data.key !== undefined) keyEl.value = p.data.key;
            if (modelEl && p.data.model !== undefined) {
                modelEl.value = p.data.model;
                if (modelSelectEl && Array.from(modelSelectEl.options).some(o => o.value === p.data.model)) {
                    modelSelectEl.value = p.data.model;
                }
            }
            if (sizeEl && p.data.size !== undefined) sizeEl.value = p.data.size;
            if (sysPromptEl && p.data.systemPrompt !== undefined) sysPromptEl.value = p.data.systemPrompt;
            if (negPromptEl && p.data.negativePrompt !== undefined) negPromptEl.value = p.data.negativePrompt;
            
            showToast(`已加载 GPT 预设：${name}`);
        });
    }

    if (savePresetBtn) {
        savePresetBtn.addEventListener('click', () => {
            const enabledEl = document.getElementById('gpt-image-enabled');
            let defaultSize = '512x512';
            if (db.gptImageSettings && Object.keys(db.gptImageSettings).length > 0 && !db.gptImageSettings.size) {
                defaultSize = '1024x1024';
            }
            const data = {
                enabled: enabledEl ? enabledEl.checked : false,
                url: urlEl ? urlEl.value.trim() : '',
                key: keyEl ? keyEl.value.trim() : '',
                model: modelEl ? modelEl.value.trim() : 'dall-e-3',
                size: sizeEl ? sizeEl.value : defaultSize,
                systemPrompt: sysPromptEl ? sysPromptEl.value.trim() : '',
                negativePrompt: negPromptEl ? negPromptEl.value.trim() : ''
            };
            
            const name = prompt('请输入预设名称（将覆盖同名预设）：');
            if (!name || !name.trim()) return;
            
            const presets = _getGptPresets();
            const idx = presets.findIndex(p => p.name === name.trim());
            const presetObj = { name: name.trim(), data: data };
            
            if (idx >= 0) presets[idx] = presetObj;
            else presets.push(presetObj);
            
            _saveGptPresets(presets);
            populateGptPresets();
            showToast('GPT 生图预设已保存');
        });
    }

    function renderGptPresetsList() {
        if (!presetListContainer) return;
        presetListContainer.innerHTML = '';
        const presets = _getGptPresets();
        if (presets.length === 0) {
            presetListContainer.innerHTML = '<p style="text-align:center;color:#999;padding:10px;">暂无预设</p>';
            return;
        }
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
            renameBtn.onclick = () => {
                const newName = prompt('输入新名称：', p.name);
                if (!newName || !newName.trim() || newName.trim() === p.name) return;
                const all = _getGptPresets();
                all[idx].name = newName.trim();
                _saveGptPresets(all);
                populateGptPresets();
                renderGptPresetsList();
            };
            
            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger btn-small';
            delBtn.textContent = '删除';
            delBtn.onclick = () => {
                if (!confirm('确定删除预设：' + p.name + '？')) return;
                const all = _getGptPresets();
                all.splice(idx, 1);
                _saveGptPresets(all);
                populateGptPresets();
                renderGptPresetsList();
            };
            
            btnWrap.appendChild(renameBtn);
            btnWrap.appendChild(delBtn);
            row.appendChild(nameDiv);
            row.appendChild(btnWrap);
            presetListContainer.appendChild(row);
        });
    }

    if (managePresetBtn) managePresetBtn.addEventListener('click', () => {
        if (!manageModal) return;
        renderGptPresetsList();
        manageModal.style.display = 'flex';
    });

    if (closeModalBtn) closeModalBtn.addEventListener('click', () => {
        if (manageModal) manageModal.style.display = 'none';
    });
    
    if (exportPresetBtn) exportPresetBtn.addEventListener('click', () => {
        const presets = _getGptPresets();
        if (presets.length === 0) return showToast('暂无预设可导出');
        const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `GPT_Image_Presets_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('GPT 生图预设已导出');
    });

    if (importPresetBtn) importPresetBtn.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.json';
        inp.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const imported = JSON.parse(text);
                if (!Array.isArray(imported)) {
                    showToast('格式不正确：需要预设数组');
                    return;
                }
                const presets = _getGptPresets();
                imported.forEach(p => {
                    if (p.name && p.data) {
                        const idx = presets.findIndex(exist => exist.name === p.name);
                        if (idx >= 0) presets[idx] = p;
                        else presets.push(p);
                    }
                });
                _saveGptPresets(presets);
                populateGptPresets();
                showToast(`成功导入 ${imported.length} 个 GPT 预设`);
            } catch (err) {
                showToast('导入失败：' + err.message);
            }
        };
        inp.click();
    });
}

function setupNovelAiSettings() {
    // --- 新增：全局生图超时时间配置初始化 ---
    if (typeof db !== 'undefined' && db.imageGenTimeout === undefined) db.imageGenTimeout = 0; // 默认 0s (不限制)
    const timeoutInput = document.getElementById('global-image-gen-timeout');
    if (timeoutInput) {
        timeoutInput.value = db.imageGenTimeout;
        timeoutInput.addEventListener('change', async (e) => {
            db.imageGenTimeout = parseInt(e.target.value, 10) || 0; // 0代表不限制
            await saveData();
            showToast('生图超时时间已保存');
        });
    }

    const autoCompressEl = document.getElementById('global-auto-compress-image');
    if (autoCompressEl) {
        if (db.autoCompressImage !== undefined) {
            autoCompressEl.checked = db.autoCompressImage;
        } else {
            autoCompressEl.checked = true; // 默认开启
            db.autoCompressImage = true;
        }
        autoCompressEl.addEventListener('change', async (e) => {
            db.autoCompressImage = e.target.checked;
            await saveData();
            showToast('自动压缩生图设置已保存');
        });
    }

    const enabledEl = document.getElementById('novelai-enabled');
    if (enabledEl) {
        enabledEl.addEventListener('change', function() {
            if (this.checked) {
                const gptEnabledCheckbox = document.getElementById('gpt-image-enabled');
                if (gptEnabledCheckbox && gptEnabledCheckbox.checked) {
                    gptEnabledCheckbox.checked = false;
                    showToast('已自动关闭 GPT 生图，两种生图引擎只能开启一个');
                }
            }
        });
    }

    const tokenEl = document.getElementById('novelai-token');
    const customUrlEnabledEl = document.getElementById('novelai-custom-url-enabled');
    const customUrlContainer = document.getElementById('novelai-custom-url-container');
    const customUrlEl = document.getElementById('novelai-custom-url');
    const modelEl = document.getElementById('novelai-model');
    const resolutionEl = document.getElementById('novelai-resolution');
    const samplerEl = document.getElementById('novelai-sampler');
    const stepsSlider = document.getElementById('novelai-steps');
    const stepsValue = document.getElementById('novelai-steps-value');
    const scaleSlider = document.getElementById('novelai-scale');
    const scaleValue = document.getElementById('novelai-scale-value');
    const systemPromptEl = document.getElementById('novelai-system-prompt');
    const artistTagsEl = document.getElementById('novelai-artist-tags');
    const negativePromptEl = document.getElementById('novelai-negative-prompt');
    const saveBtn = document.getElementById('novelai-save-btn');
    const testBtn = document.getElementById('novelai-test-btn');

    // === NovelAI 预设管理相关 DOM ===
    const presetSelect = document.getElementById('novelai-preset-select');
    const applyPresetBtn = document.getElementById('novelai-apply-preset');
    const savePresetBtn = document.getElementById('novelai-save-preset');
    const managePresetBtn = document.getElementById('novelai-manage-presets');
    const importPresetBtn = document.getElementById('novelai-import-presets');
    const exportPresetBtn = document.getElementById('novelai-export-presets');
    const manageModal = document.getElementById('novelai-presets-modal');
    const closeModalBtn = document.getElementById('novelai-close-modal');
    const presetListContainer = document.getElementById('novelai-presets-list');

    // 加载已保存的设置
    if (db.novelAiSettings) {
        const s = db.novelAiSettings;
        if (enabledEl) enabledEl.checked = !!s.enabled;
        if (tokenEl) tokenEl.value = s.token || '';
        if (customUrlEnabledEl) {
            customUrlEnabledEl.checked = !!s.customUrlEnabled;
            if (customUrlContainer) customUrlContainer.style.display = s.customUrlEnabled ? 'flex' : 'none';
        }
        if (customUrlEl) customUrlEl.value = s.customUrl || '';
        if (modelEl && s.model) modelEl.value = s.model;
        if (resolutionEl && s.resolution) resolutionEl.value = s.resolution;
        if (samplerEl && s.sampler) samplerEl.value = s.sampler;
        if (stepsSlider && s.steps !== undefined) {
            stepsSlider.value = s.steps;
            if (stepsValue) stepsValue.textContent = s.steps;
        }
        if (scaleSlider && s.scale !== undefined) {
            scaleSlider.value = s.scale;
            if (scaleValue) scaleValue.textContent = s.scale;
        }
        if (systemPromptEl && s.systemPrompt !== undefined) {
            systemPromptEl.value = s.systemPrompt;
        }
        if (artistTagsEl && s.artistTags !== undefined) {
            artistTagsEl.value = s.artistTags;
        }
        if (negativePromptEl && s.negativePrompt !== undefined) {
            negativePromptEl.value = s.negativePrompt;
        }
    }

    // 滑块实时反馈
    if (stepsSlider && stepsValue) {
        stepsSlider.addEventListener('input', (e) => {
            stepsValue.textContent = e.target.value;
        });
    }
    if (scaleSlider && scaleValue) {
        scaleSlider.addEventListener('input', (e) => {
            scaleValue.textContent = e.target.value;
        });
    }
    
    if (customUrlEnabledEl && customUrlContainer) {
        customUrlEnabledEl.addEventListener('change', (e) => {
            customUrlContainer.style.display = e.target.checked ? 'flex' : 'none';
        });
    }

    // 保存设置
    if (saveBtn) {
        saveBtn?.addEventListener('click', async () => {
            db.novelAiSettings = {
                enabled: enabledEl ? enabledEl.checked : false,
                token: tokenEl ? tokenEl.value.trim() : '',
                customUrlEnabled: customUrlEnabledEl ? customUrlEnabledEl.checked : false,
                customUrl: customUrlEl ? customUrlEl.value.trim() : '',
                model: modelEl ? modelEl.value : 'nai-diffusion-4-curated-preview',
                resolution: resolutionEl ? resolutionEl.value : '832x1216',
                sampler: samplerEl ? samplerEl.value : 'k_euler',
                steps: stepsSlider ? parseInt(stepsSlider.value) : 28,
                scale: scaleSlider ? parseFloat(scaleSlider.value) : 5,
                systemPrompt: systemPromptEl ? systemPromptEl.value.trim() : '',
                artistTags: artistTagsEl ? artistTagsEl.value.trim() : '',
                negativePrompt: negativePromptEl ? negativePromptEl.value : ''
            };
            await saveData();
            showToast('NovelAI 生图设置已保存！');
        });
    }

    // 测试生图
    if (testBtn) {
        testBtn?.addEventListener('click', async () => {
            const token = tokenEl ? tokenEl.value.trim() : '';
            if (!token) {
                showToast('请先填写 NovelAI API Token');
                return;
            }

            testBtn.disabled = true;
            testBtn.querySelector('.btn-text').textContent = '⏳ 生成中...';

            try {
                const result = await generateNovelAiImage('1girl, upper body, beautiful', {
                    token: token,
                    customUrlEnabled: customUrlEnabledEl ? customUrlEnabledEl.checked : false,
                    customUrl: customUrlEl ? customUrlEl.value.trim() : '',
                    model: modelEl ? modelEl.value : 'nai-diffusion-4-curated-preview',
                    resolution: resolutionEl ? resolutionEl.value : '832x1216',
                    sampler: samplerEl ? samplerEl.value : 'k_euler',
                    steps: stepsSlider ? parseInt(stepsSlider.value) : 28,
                    scale: scaleSlider ? parseFloat(scaleSlider.value) : 5,
                    systemPrompt: systemPromptEl ? systemPromptEl.value.trim() : '',
                    artistTags: artistTagsEl ? artistTagsEl.value.trim() : '',
                    negativePrompt: negativePromptEl ? negativePromptEl.value : ''
                });

                if (result && result.imageUrl) {
                    const preview = document.getElementById('novelai-test-preview');
                    const img = document.getElementById('novelai-test-image');
                    if (preview && img) {
                        img.src = result.imageUrl;
                        preview.style.display = 'block';
                        img.onclick = () => {
                            if (typeof openImageViewer === 'function') {
                                openImageViewer(result.imageUrl);
                            }
                        };
                        img.style.cursor = 'zoom-in';
                    }
                    showToast('✅ 测试生图成功！');
                }
            } catch (err) {
                console.error('[NovelAI] 测试生图失败:', err);
                showToast('❌ 生图失败: ' + (err.message || '未知错误'));
            } finally {
                testBtn.disabled = false;
                testBtn.querySelector('.btn-text').textContent = '🎨 测试生图';
            }
        });
    }

    // === NovelAI 预设管理逻辑 ===

    function _getNovelAiPresets() {
        return db.novelAiPresets || [];
    }
    
    function _saveNovelAiPresets(arr) {
        db.novelAiPresets = arr || [];
        saveData();
    }

    function populateNovelAiPresets() {
        if (!presetSelect) return;
        const presets = _getNovelAiPresets();
        presetSelect.innerHTML = '<option value="">— 选择 —</option>';
        presets.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = p.name;
            presetSelect.appendChild(opt);
        });
    }

    // 初始渲染
    populateNovelAiPresets();

    if (applyPresetBtn) {
        applyPresetBtn.addEventListener('click', () => {
            const selectedName = presetSelect.value;
            if (!selectedName) return showToast('请先选择预设');
            const presets = _getNovelAiPresets();
            const p = presets.find(x => x.name === selectedName);
            if (!p) return showToast('未找到该预设');

            if (tokenEl && p.data.token !== undefined) tokenEl.value = p.data.token;
            if (customUrlEnabledEl && p.data.customUrlEnabled !== undefined) {
                customUrlEnabledEl.checked = !!p.data.customUrlEnabled;
                if (customUrlContainer) customUrlContainer.style.display = p.data.customUrlEnabled ? 'flex' : 'none';
            }
            if (customUrlEl && p.data.customUrl !== undefined) customUrlEl.value = p.data.customUrl;
            if (modelEl && p.data.model) modelEl.value = p.data.model;
            if (resolutionEl && p.data.resolution) resolutionEl.value = p.data.resolution;
            if (samplerEl && p.data.sampler) samplerEl.value = p.data.sampler;
            if (stepsSlider && p.data.steps !== undefined) {
                stepsSlider.value = p.data.steps;
                if (stepsValue) stepsValue.textContent = p.data.steps;
            }
            if (scaleSlider && p.data.scale !== undefined) {
                scaleSlider.value = p.data.scale;
                if (scaleValue) scaleValue.textContent = p.data.scale;
            }
            if (systemPromptEl && p.data.systemPrompt !== undefined) systemPromptEl.value = p.data.systemPrompt;
            if (artistTagsEl && p.data.artistTags !== undefined) artistTagsEl.value = p.data.artistTags;
            if (negativePromptEl && p.data.negativePrompt !== undefined) negativePromptEl.value = p.data.negativePrompt;
            
            showToast(`已加载 NovelAI 预设：${selectedName}`);
        });
    }

    if (savePresetBtn) {
        savePresetBtn.addEventListener('click', () => {
            const data = {
                token: tokenEl ? tokenEl.value.trim() : '',
                customUrlEnabled: customUrlEnabledEl ? customUrlEnabledEl.checked : false,
                customUrl: customUrlEl ? customUrlEl.value.trim() : '',
                model: modelEl ? modelEl.value : 'nai-diffusion-4-curated-preview',
                resolution: resolutionEl ? resolutionEl.value : '832x1216',
                sampler: samplerEl ? samplerEl.value : 'k_euler',
                steps: stepsSlider ? parseInt(stepsSlider.value) : 28,
                scale: scaleSlider ? parseFloat(scaleSlider.value) : 5,
                systemPrompt: systemPromptEl ? systemPromptEl.value.trim() : '',
                artistTags: artistTagsEl ? artistTagsEl.value.trim() : '',
                negativePrompt: negativePromptEl ? negativePromptEl.value : ''
            };
            
            const name = prompt('请输入预设名称（将覆盖同名预设）：');
            if (!name || !name.trim()) return;
            
            const presets = _getNovelAiPresets();
            const idx = presets.findIndex(p => p.name === name.trim());
            const presetObj = { name: name.trim(), data: data };
            
            if (idx >= 0) {
                presets[idx] = presetObj;
            } else {
                presets.push(presetObj);
            }
            
            _saveNovelAiPresets(presets);
            populateNovelAiPresets();
            showToast('NovelAI 预设已保存');
        });
    }

    function renderPresetsList() {
        if (!presetListContainer) return;
        presetListContainer.innerHTML = '';
        const presets = _getNovelAiPresets();
        if (presets.length === 0) {
            presetListContainer.innerHTML = '<p style="text-align:center;color:#999;padding:10px;">暂无预设</p>';
            return;
        }
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
            renameBtn.onclick = () => {
                const newName = prompt('输入新名称：', p.name);
                if (!newName || !newName.trim() || newName.trim() === p.name) return;
                const all = _getNovelAiPresets();
                all[idx].name = newName.trim();
                _saveNovelAiPresets(all);
                populateNovelAiPresets();
                renderPresetsList();
            };
            
            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-danger btn-small';
            delBtn.textContent = '删除';
            delBtn.onclick = () => {
                if (!confirm('确定删除预设：' + p.name + '？')) return;
                const all = _getNovelAiPresets();
                all.splice(idx, 1);
                _saveNovelAiPresets(all);
                populateNovelAiPresets();
                renderPresetsList();
            };
            
            btnWrap.appendChild(renameBtn);
            btnWrap.appendChild(delBtn);
            row.appendChild(nameDiv);
            row.appendChild(btnWrap);
            presetListContainer.appendChild(row);
        });
    }

    if (managePresetBtn) {
        managePresetBtn.addEventListener('click', () => {
            if (!manageModal) return;
            renderPresetsList();
            manageModal.style.display = 'flex';
        });
    }

    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            if (manageModal) manageModal.style.display = 'none';
        });
    }
    
    if (exportPresetBtn) {
        exportPresetBtn.addEventListener('click', () => {
            const presets = _getNovelAiPresets();
            if (presets.length === 0) return showToast('暂无预设可导出');
            const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `NovelAI_Presets_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('NovelAI 预设已导出');
        });
    }

    if (importPresetBtn) {
        importPresetBtn.addEventListener('click', () => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = '.json';
            inp.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    const imported = JSON.parse(text);
                    if (!Array.isArray(imported)) {
                        showToast('格式不正确：需要预设数组');
                        return;
                    }
                    const presets = _getNovelAiPresets();
                    imported.forEach(p => {
                        if (p.name && p.data) {
                            const idx = presets.findIndex(exist => exist.name === p.name);
                            if (idx >= 0) presets[idx] = p;
                            else presets.push(p);
                        }
                    });
                    _saveNovelAiPresets(presets);
                    populateNovelAiPresets();
                    showToast(`成功导入 ${imported.length} 个 NovelAI 预设`);
                } catch (err) {
                    showToast('导入失败：' + err.message);
                }
            };
            inp.click();
        });
    }
}

