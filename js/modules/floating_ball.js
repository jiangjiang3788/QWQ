// QuickDock adapted from OWO v0.3.0. V14.6: current API model list, Git status, console and Proment; no presets, recent chats or full API shortcut.
(() => {
    'use strict';

    const STORAGE_KEY = 'ovo_quick_dock_v2';
    const state = { open: false, panel: 'main', x: null, y: null, status: '' };
    let rootEl = null;
    let panelEl = null;
    let ballEl = null;
    let drag = null;

    const logs = [];
    const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    function toast(message, duration) {
        if (typeof window.showToast === 'function') window.showToast(message, duration);
    }

    function loadPosition() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            state.x = Number.isFinite(saved.x) ? saved.x : null;
            state.y = Number.isFinite(saved.y) ? saved.y : null;
        } catch (_) {}
    }

    function savePosition() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: state.x, y: state.y })); } catch (_) {}
    }

    function applyPosition(x, y) {
        if (!rootEl) return;
        const size = 56;
        state.x = clamp(Number(x), 8, Math.max(8, window.innerWidth - size - 8));
        state.y = clamp(Number(y), 64, Math.max(64, window.innerHeight - size - 80));
        rootEl.style.left = `${state.x}px`;
        rootEl.style.top = `${state.y}px`;
        rootEl.style.right = 'auto';
        rootEl.style.bottom = 'auto';
    }

    function snapToEdge() {
        if (!rootEl) return;
        const rect = rootEl.getBoundingClientRect();
        const x = rect.left + rect.width / 2 < window.innerWidth / 2 ? 8 : window.innerWidth - rect.width - 8;
        applyPosition(x, rect.top);
        savePosition();
    }

    function getCurrentApi() {
        const api = window.db && db.apiSettings ? db.apiSettings : {};
        return { provider: api.provider || 'API', model: api.model || '未选择模型' };
    }

    function normalizeCurrentApiConfig() {
        const api = window.db && db.apiSettings ? db.apiSettings : {};
        return {
            provider: api.provider || 'newapi',
            url: api.url || api.apiUrl || '',
            key: api.key || api.apiKey || '',
            model: api.model || ''
        };
    }

    async function fetchModelsForConfig(config) {
        if (!config.url || !config.key) throw new Error('请先在底部 API 页面填写地址和密钥');
        const apiUrl = String(config.url).trim().replace(/\/$/, '');
        const provider = config.provider || 'newapi';
        const endpoint = provider === 'gemini'
            ? `${apiUrl}/v1beta/models?key=${encodeURIComponent(config.key)}`
            : `${apiUrl}/v1/models`;
        const headers = provider === 'gemini' ? {} : { Authorization: `Bearer ${config.key}` };
        const response = await fetch(endpoint, { method: 'GET', headers });
        if (!response.ok) throw new Error(`模型列表拉取失败：HTTP ${response.status}`);
        const data = await response.json();
        let models = [];
        if (provider === 'gemini' && Array.isArray(data.models)) {
            models = data.models.map(item => String(item.name || '').replace(/^models\//, ''));
        } else if (Array.isArray(data.data)) {
            models = data.data.map(item => item && item.id).filter(Boolean);
        } else if (Array.isArray(data.models)) {
            models = data.models.map(item => typeof item === 'string' ? item : item && (item.id || item.name)).filter(Boolean);
        }
        return Array.from(new Set(models)).sort((a, b) => String(a).localeCompare(String(b)));
    }

    async function loadCurrentApiModels(forceFetch = false) {
        const config = normalizeCurrentApiConfig();
        const cacheKey = `ovo_qd_current_models_${config.provider}_${config.url}`;
        if (!forceFetch) {
            try {
                const cached = JSON.parse(sessionStorage.getItem(cacheKey) || '[]');
                if (Array.isArray(cached) && cached.length) return { config, models: cached };
            } catch (_) {}
        }
        const models = await fetchModelsForConfig(config);
        try { sessionStorage.setItem(cacheKey, JSON.stringify(models)); } catch (_) {}
        return { config, models };
    }

    async function switchCurrentModel(selectedModel) {
        const modelValue = String(selectedModel || '').trim();
        if (!modelValue) throw new Error('请先选择模型');
        db.apiSettings = Object.assign({}, db.apiSettings || {}, { model: modelValue });
        await saveData();
        const model = document.getElementById('api-model');
        if (model) {
            const exists = Array.from(model.options || []).some(option => option.value === modelValue);
            if (!exists) model.add(new Option(modelValue, modelValue));
            model.value = modelValue;
        }
        state.status = `已切换模型：${modelValue}`;
        toast(state.status);
    }


    function ensureGitReady() {
        if (!window.GitHubMgr) throw new Error('Git 同步模块尚未就绪');
        if (!GitHubMgr.config || !GitHubMgr.config.token || !GitHubMgr.config.repo) throw new Error('请先在数据分析中配置 GitHub');
    }


    const GIT_STATUS_KEY = 'ovo_quick_dock_git_status_v1';

    function loadGitStatus() {
        try { return JSON.parse(localStorage.getItem(GIT_STATUS_KEY) || '{}'); }
        catch (_) { return {}; }
    }

    function saveGitStatus(kind, ok, message) {
        const value = { kind, ok: Boolean(ok), message: message || '', time: new Date().toISOString() };
        try { localStorage.setItem(GIT_STATUS_KEY, JSON.stringify(value)); } catch (_) {}
        return value;
    }

    function formatGitStatus() {
        const item = loadGitStatus();
        if (!item.time) return '尚无 Git 同步记录';
        const date = new Date(item.time);
        const time = Number.isNaN(date.getTime()) ? item.time : date.toLocaleString();
        const label = item.kind === 'upload' ? '上传' : item.kind === 'restore' ? '下载恢复' : '同步';
        return `${label}${item.ok ? '成功' : '失败'} · ${time}${item.message ? ` · ${item.message}` : ''}`;
    }

    function openGitSettings() {
        state.open = false;
        render();
        if (typeof switchScreen === 'function') switchScreen('storage-analysis-screen');
        if (typeof window.showTutorialSection === 'function') window.showTutorialSection('github');
        else toast('请在数据分析中配置 GitHub Token、仓库和分支');
    }

    async function gitUpload() {
        try {
            ensureGitReady();
        } catch (error) {
            saveGitStatus('upload', false, error.message);
            openGitSettings();
            throw error;
        }
        const ok = typeof window.customConfirm === 'function'
            ? await customConfirm('将当前完整数据上传到已配置的 GitHub 仓库，是否继续？', 'Git 上传')
            : confirm('将当前完整数据上传到 GitHub，是否继续？');
        if (!ok) return;
        state.status = '正在上传到 GitHub…'; renderStatus();
        try {
            await GitHubMgr.performUpload(message => { state.status = message; renderStatus(); });
            saveGitStatus('upload', true, '当前数据已同步');
            state.status = 'Git 上传完成';
            toast(state.status);
        } catch (error) {
            saveGitStatus('upload', false, error.message || '上传失败');
            throw error;
        }
    }

    async function gitRestore() {
        try {
            ensureGitReady();
        } catch (error) {
            saveGitStatus('restore', false, error.message);
            openGitSettings();
            throw error;
        }
        const message = [
            '将从 GitHub 下载最新备份并覆盖当前数据。',
            '恢复后页面可能自动刷新。',
            '此操作不可撤销，是否继续？'
        ].join('\n');
        const ok = typeof window.customConfirm === 'function'
            ? await customConfirm(message, 'Git 下载并恢复')
            : confirm(message);
        if (!ok) return;
        state.status = '正在从 GitHub 下载并恢复…'; renderStatus();
        try {
            await GitHubMgr.quickRestoreLatest();
            saveGitStatus('restore', true, '最新备份已恢复');
            state.status = 'Git 下载恢复完成';
            toast(state.status);
        } catch (error) {
            saveGitStatus('restore', false, error.message || '恢复失败');
            throw error;
        }
    }

    function formatLog(value) {
        if (value instanceof Error) return value.stack || value.message;
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
    }

    function pushLog(level, args) {
        const text = Array.from(args).map(formatLog).join(' ');
        if (/index\.global\.js|message channel closed|runtime\.lastError/i.test(text)) return;
        logs.push({ time: new Date().toLocaleTimeString(), level, text });
        if (logs.length > 500) logs.splice(0, logs.length - 500);
        if (state.panel === 'console') renderConsoleRows();
    }

    function installConsoleCapture() {
        if (window.__ovoQuickDockConsoleCapture) return;
        window.__ovoQuickDockConsoleCapture = true;
        ['log', 'info', 'warn', 'error'].forEach(level => {
            const original = console[level].bind(console);
            console[level] = (...args) => { original(...args); pushLog(level, args); };
        });
        window.addEventListener('error', e => pushLog('error', [e.message, e.filename ? `${e.filename}:${e.lineno}` : '', e.error || '']));
        window.addEventListener('unhandledrejection', e => pushLog('error', ['Unhandled promise rejection', e.reason]));
        pushLog('info', ['QuickDock 控制台已启动']);
    }

    function logsAsText() {
        return logs.map(item => `[${item.time}] [${item.level.toUpperCase()}] ${item.text}`).join('\n');
    }

    async function copyLogs() {
        const text = logsAsText();
        try { await navigator.clipboard.writeText(text); }
        catch (_) {
            const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        }
        toast('控制台日志已复制');
    }

    function renderStatus() {
        const el = panelEl && panelEl.querySelector('.quick-dock-status');
        if (el) el.textContent = state.status || '快捷工具已就绪';
    }

    async function refreshModelSelect(forceFetch = false) {
        const modelSelect = panelEl && panelEl.querySelector('#quick-dock-model-select');
        if (!modelSelect) return;
        modelSelect.disabled = true;
        modelSelect.innerHTML = '<option value="">正在拉取模型…</option>';
        try {
            const { config, models } = await loadCurrentApiModels(forceFetch);
            const preferred = getCurrentApi().model || config.model || '';
            const merged = models.length ? models : (preferred ? [preferred] : []);
            modelSelect.innerHTML = merged.length
                ? merged.map(model => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join('')
                : '<option value="">未找到模型</option>';
            if (preferred && merged.includes(preferred)) modelSelect.value = preferred;
            state.status = merged.length ? `已从当前 API 加载 ${merged.length} 个模型` : '当前 API 未返回模型列表';
        } catch (error) {
            const fallback = getCurrentApi().model;
            modelSelect.innerHTML = fallback
                ? `<option value="${escapeHtml(fallback)}">${escapeHtml(fallback)}（当前）</option>`
                : '<option value="">模型拉取失败</option>';
            state.status = error.message || '模型列表拉取失败';
        } finally {
            modelSelect.disabled = false;
            renderStatus();
        }
    }

    function renderMain() {
        const current = getCurrentApi();
        const config = normalizeCurrentApiConfig();
        const apiLabel = config.url ? `${current.provider} · ${config.url}` : `${current.provider} · 未配置地址`;
        panelEl.innerHTML = `
            <header class="quick-dock-panel-header">
                <div><strong>QuickDock 2.0</strong><span>${escapeHtml(current.provider)} · ${escapeHtml(current.model)}</span></div>
                <button type="button" class="quick-dock-icon-btn" data-qd-action="close" aria-label="关闭">×</button>
            </header>
            <div class="quick-dock-section">
                <div class="quick-dock-current-api"><b>当前 API</b><span>${escapeHtml(apiLabel)}</span></div>
                <label class="quick-dock-label quick-dock-label--spaced" for="quick-dock-model-select">模型列表</label>
                <div class="quick-dock-model-row">
                    <select id="quick-dock-model-select"><option value="${escapeHtml(current.model)}">${escapeHtml(current.model)}</option></select>
                    <button type="button" data-qd-action="refresh-models">拉取</button>
                </div>
                <button type="button" class="quick-dock-primary-wide quick-dock-switch-btn" data-qd-action="switch-api">切换到所选模型</button>
            </div>
            <div class="quick-dock-grid quick-dock-grid--primary">
                <button type="button" data-qd-action="git-upload"><b>Git 上传</b><small>同步当前完整数据</small></button>
                <button type="button" data-qd-action="git-restore"><b>Git 下载</b><small>下载最新备份并恢复</small></button>
                <button type="button" data-qd-action="open-console"><b>控制台</b><small>日志、复制、全屏</small></button>
                <button type="button" data-qd-action="open-proment"><b>Proment</b><small>只读状态与完整入口</small></button>
            </div>
            <p class="quick-dock-git-status"><b>Git 状态：</b>${escapeHtml(formatGitStatus())}</p>
            <p class="quick-dock-status">${escapeHtml(state.status || '点击“拉取”读取当前 API 的模型列表。')}</p>`;
        setTimeout(() => refreshModelSelect(false), 0);
    }


    function renderPromentStatus() {
        const char = (db.characters || []).find(item => item.id === window.currentChatId) || (db.characters || [])[0] || null;
        const policy = Object.assign({ worldBookEnabled: true, structuredEnabled: true }, db.magicRoom?.contextPolicy || {});
        const vectorPolicy = char?.vectorMemory?.injectionPolicy || { budget: 2600, priority: 40 };
        panelEl.innerHTML = `
            <header class="quick-dock-panel-header">
                <div><strong>Proment 状态</strong><span>只读快捷视图</span></div>
                <button type="button" class="quick-dock-icon-btn" data-qd-action="main" aria-label="返回">‹</button>
            </header>
            <div class="quick-dock-section quick-dock-proment-status">
                <p><b>当前角色</b><span>${escapeHtml(char ? (char.remarkName || char.name || '未命名') : '暂无角色')}</span></p>
                <p><b>世界书</b><span>${policy.worldBookEnabled ? `开启 · 预算 ${policy.worldBookBudget || 2400}` : '关闭'}</span></p>
                <p><b>结构化档案</b><span>${policy.structuredEnabled ? `开启 · 预算 ${policy.structuredBudget || 1800}` : '关闭'}</span></p>
                <p><b>向量记忆</b><span>独立管理 · 预算 ${vectorPolicy.budget || 2600}</span></p>
                <p><b>最近聊天</b><span>${policy.historyEnabled === false ? '关闭' : `${policy.historyCount || 30} 条`}</span></p>
            </div>
            <button type="button" class="quick-dock-primary-wide" data-qd-action="open-proment-full">打开完整 Proment</button>
            <p class="quick-dock-status">QuickDock 不直接编辑 Prompt 或记忆数据。</p>`;
    }

    function filteredLogs() {
        const filter = panelEl && panelEl.querySelector('#quick-dock-console-filter');
        const value = filter ? filter.value : 'all';
        return logs.filter(item => value === 'all' || item.level === value);
    }

    function renderConsoleRows() {
        const box = panelEl && panelEl.querySelector('#quick-dock-console-rows');
        if (!box) return;
        const items = filteredLogs();
        box.innerHTML = '';
        items.forEach(item => {
            const row = document.createElement('article');
            row.className = `quick-dock-console-row ${item.level}`;
            row.innerHTML = `<div><time>${escapeHtml(item.time)}</time><b>${escapeHtml(item.level)}</b><button type="button" data-copy-row>复制</button></div><pre></pre>`;
            row.querySelector('pre').textContent = item.text;
            row.querySelector('[data-copy-row]').addEventListener('click', async () => {
                try { await navigator.clipboard.writeText(item.text); } catch (_) {}
                toast('该条日志已复制');
            });
            box.appendChild(row);
        });
        box.scrollTop = box.scrollHeight;
    }

    function renderConsole() {
        panelEl.innerHTML = `
            <header class="quick-dock-panel-header">
                <div><strong>控制台</strong><span>仅捕获 OVO 页面自身日志</span></div>
                <button type="button" class="quick-dock-icon-btn" data-qd-action="close">×</button>
            </header>
            <div class="quick-dock-console-toolbar">
                <select id="quick-dock-console-filter"><option value="all">全部</option><option value="error">错误</option><option value="warn">警告</option><option value="info">信息</option><option value="log">日志</option></select>
                <button type="button" data-qd-action="copy-console">复制全部</button>
                <button type="button" data-qd-action="clear-console">清空</button>
                <button type="button" data-qd-action="toggle-fullscreen">全屏</button>
                <button type="button" data-qd-action="main">返回</button>
            </div>
            <div id="quick-dock-console-rows" class="quick-dock-console-rows"></div>`;
        panelEl.querySelector('#quick-dock-console-filter').addEventListener('change', renderConsoleRows);
        renderConsoleRows();
    }

    function render() {
        if (!rootEl || !panelEl) return;
        rootEl.classList.toggle('quick-dock--open', state.open);
        panelEl.hidden = !state.open;
        panelEl.classList.toggle('quick-dock-panel--console', state.panel === 'console');
        if (!state.open) return;
        if (state.panel === 'console') renderConsole();
        else if (state.panel === 'proment') renderPromentStatus();
        else renderMain();
    }

    async function runAction(action) {
        if (action === 'close') { state.open = false; state.panel = 'main'; render(); return; }
        if (action === 'main') { state.panel = 'main'; render(); return; }
        if (action === 'open-console') { state.panel = 'console'; render(); return; }
        if (action === 'open-git-settings') { openGitSettings(); return; }
        if (action === 'open-proment') { state.panel = 'proment'; render(); return; }
        if (action === 'open-proment-full') {
            state.open = false; state.panel = 'main'; render();
            if (typeof setupMagicRoomApp === 'function') setupMagicRoomApp();
            if (typeof switchScreen === 'function') switchScreen('magic-room-screen');
            return;
        }
        try {
            rootEl.classList.add('quick-dock--busy');
            if (action === 'switch-api') {
                const modelSelect = panelEl.querySelector('#quick-dock-model-select');
                await switchCurrentModel(modelSelect ? modelSelect.value : '');
            } else if (action === 'refresh-models') await refreshModelSelect(true);
            else if (action === 'git-upload') await gitUpload();
            else if (action === 'git-restore') await gitRestore();
            else if (action === 'copy-console') await copyLogs();
            else if (action === 'clear-console') { logs.length = 0; renderConsoleRows(); }
            else if (action === 'toggle-fullscreen') {
                panelEl.classList.toggle('quick-dock-panel--fullscreen');
                const button = panelEl.querySelector('[data-qd-action="toggle-fullscreen"]');
                if (button) button.textContent = panelEl.classList.contains('quick-dock-panel--fullscreen') ? '退出全屏' : '全屏';
                return;
            }
        } catch (error) {
            console.error('[QuickDock]', error);
            state.status = error.message || '操作失败';
            toast(state.status);
        } finally {
            rootEl.classList.remove('quick-dock--busy');
            if (state.panel === 'main') render();
        }
    }

    function onPanelClick(event) {
        const action = event.target.closest('[data-qd-action]');
        if (action) runAction(action.dataset.qdAction);
    }

    function onPointerDown(event) {
        if (event.button > 0) return;
        const rect = rootEl.getBoundingClientRect();
        drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, moved: false };
        ballEl.setPointerCapture?.(event.pointerId);
    }

    function onPointerMove(event) {
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 8) drag.moved = true;
        applyPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
    }

    function onPointerUp(event) {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const moved = drag.moved;
        drag = null;
        if (moved) { state.open = false; snapToEdge(); render(); }
        else { state.open = !state.open; if (!state.open) state.panel = 'main'; render(); }
    }

    function init() {
        if (rootEl || document.getElementById('quick-dock-root')) return;
        loadPosition();
        rootEl = document.createElement('div');
        rootEl.id = 'quick-dock-root';
        rootEl.className = 'quick-dock-root';
        rootEl.innerHTML = '<section class="quick-dock-panel" hidden></section><button type="button" class="quick-dock-ball" aria-label="快捷悬浮球" aria-expanded="false">悬</button>';
        document.body.appendChild(rootEl);
        panelEl = rootEl.querySelector('.quick-dock-panel');
        ballEl = rootEl.querySelector('.quick-dock-ball');
        applyPosition(state.x == null ? window.innerWidth - 64 : state.x, state.y == null ? Math.round(window.innerHeight * 0.52) : state.y);
        panelEl.addEventListener('click', onPanelClick);
        ballEl.addEventListener('pointerdown', onPointerDown);
        ballEl.addEventListener('pointermove', onPointerMove);
        ballEl.addEventListener('pointerup', onPointerUp);
        ballEl.addEventListener('pointercancel', () => { drag = null; });
        document.addEventListener('pointerdown', event => { if (state.open && !rootEl.contains(event.target)) { state.open = false; state.panel = 'main'; render(); } });
        window.addEventListener('resize', () => { applyPosition(state.x, state.y); savePosition(); });
        render();
    }

    installConsoleCapture();
    window.QuickDock = { init, open: panel => { state.panel = panel || 'main'; state.open = true; render(); }, close: () => { state.open = false; render(); } };
    // Compatibility with the V12.9-V13.4 initialization call.
    window.FloatingBall = window.QuickDock;
})();
