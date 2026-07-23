// QuickDock · V2.13-R2：操作与详情合并，固定实用详情层级。
(() => {
    'use strict';

    const STORAGE_KEY = 'ovo_quick_dock_v2';
    const REPORT_MODE = 'detailed';
    const state = { open: false, panel: 'main', x: null, y: null, status: '', selectedOperationId: null, historyQuery: '', historyStatus: '', historyCategory: '', historyType: '', historyFrom: '', historyTo: '', historyVisible: 20 };
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

    function saveDockPreferences() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: state.x, y: state.y })); } catch (_) {}
    }

    function savePosition() {
        saveDockPreferences();
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


    function formatStorageSize(chars) {
        const value = Math.max(0, Number(chars) || 0);
        if (value < 1000) return `${value} 字符`;
        if (value < 1000000) return `${(value / 1000).toFixed(1)}k 字符`;
        return `${(value / 1000000).toFixed(2)}M 字符`;
    }

    function downloadText(filename, text, mime = 'text/markdown;charset=utf-8') {
        const blob = new Blob([String(text || '')], { type: mime });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function reportFilename(prefix, extension = 'md') {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `${prefix}_${stamp}.${extension}`;
    }

    function readHistoryFilterControls() {
        return {
            query: panelEl?.querySelector('#quick-dock-history-query')?.value?.trim() || '',
            status: panelEl?.querySelector('#quick-dock-history-status')?.value || '',
            category: panelEl?.querySelector('#quick-dock-history-category')?.value || '',
            type: panelEl?.querySelector('#quick-dock-history-type')?.value || '',
            from: panelEl?.querySelector('#quick-dock-history-from')?.value || '',
            to: panelEl?.querySelector('#quick-dock-history-to')?.value || ''
        };
    }


    function getOperationRuntime() {
        return window.OVOOperationRuntime || null;
    }

    function formatOperationTime(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function formatDuration(ms) {
        const value = Number(ms) || 0;
        if (value < 1000) return `${Math.max(0, Math.round(value))}ms`;
        if (value < 60000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}秒`;
        return `${Math.floor(value / 60000)}分${Math.round((value % 60000) / 1000)}秒`;
    }

    function operationStatusMeta(status) {
        const map = {
            running: { label: '进行中', className: 'running' },
            queued: { label: '等待中', className: 'queued' },
            success: { label: '已完成', className: 'success' },
            failed: { label: '失败', className: 'failed' },
            cancelled: { label: '已取消', className: 'cancelled' },
            interrupted: { label: '已中断', className: 'interrupted' },
            skipped: { label: '已跳过', className: 'skipped' }
        };
        return map[status] || { label: status || '未知', className: 'unknown' };
    }

    function operationDuration(operation) {
        if (!operation?.createdAt) return 0;
        const start = new Date(operation.createdAt).getTime();
        const end = new Date(operation.completedAt || operation.updatedAt || Date.now()).getTime();
        return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
    }

    function operationResultText(operation) {
        if (operation?.summary) return operation.summary;
        if (operation?.status === 'running' || operation?.status === 'queued') return operation.stage || '正在处理';
        if (operation?.error?.message) return operation.error.message;
        return operation?.stage || '暂无结果摘要';
    }



    function backgroundSummaryText(operation) {
        const background = operation?.background || {};
        if (!background.total) return '';
        const parts = [];
        if (background.pending) parts.push(`${background.pending} 项处理中`);
        if (background.success) parts.push(`${background.success} 项完成`);
        if (background.skipped) parts.push(`${background.skipped} 项跳过`);
        if (background.failed) parts.push(`${background.failed} 项失败`);
        return `后台 ${background.total} 项${parts.length ? ` · ${parts.join(' · ')}` : ''}`;
    }

    function renderChildOperationList(operation) {
        const runtime = getOperationRuntime();
        const children = runtime?.getChildren?.(operation?.id) || [];
        if (!children.length) return '<p class="quick-dock-operation-muted">本次操作没有记录到后台子任务。</p>';
        return `<div class="quick-dock-child-operation-list">${children.map(child => {
            const meta = operationStatusMeta(child.status);
            return `<button type="button" class="quick-dock-child-operation" data-qd-action="open-operation" data-operation-id="${escapeHtml(child.id)}" data-operation-status="${escapeHtml(meta.className)}">
                <span class="quick-dock-child-icon">${escapeHtml(child.icon || '•')}</span>
                <span><b>${escapeHtml(child.title || '后台任务')}</b><small>${escapeHtml(operationResultText(child))}</small></span>
                <em>${escapeHtml(meta.label)}</em>
            </button>`;
        }).join('')}</div>`;
    }

    function formatSourceChars(value) {
        const chars = Math.max(0, Number(value) || 0);
        if (chars < 1000) return `${chars} 字符`;
        return `${(chars / 1000).toFixed(chars < 10000 ? 1 : 0)}k 字符`;
    }

    function promptSourceMeta(type) {
        const meta = window.OVOPromptTrace?.TYPE_META?.[type];
        return meta || { title: '其他上下文', icon: '📎' };
    }

    function promptSourceStateLabel(section) {
        const labels = { sent: '实际发送', verified: '已核对', contributed: '参与组装', excluded: '未发送' };
        return labels[section?.state] || (section?.sent === false ? '未发送' : '参与组装');
    }

    function promptSourceFocusAttributes(operation, request, section) {
        return `data-operation-id="${escapeHtml(operation?.id || '')}" data-request-id="${escapeHtml(request?.id || '')}" data-source-id="${escapeHtml(section?.id || '')}"`;
    }

    function findPromptSource(trigger) {
        const operation = getOperationRuntime()?.get?.(trigger?.dataset?.operationId || state.selectedOperationId);
        const request = (operation?.requests || []).find(item => item.id === trigger?.dataset?.requestId) || null;
        const source = (request?.promptTrace?.sections || []).find(item => item.id === trigger?.dataset?.sourceId) || null;
        return { operation, request, source };
    }


    function activatePromptCharacter(characterId) {
        if (!characterId || !Array.isArray(window.db?.characters)) return null;
        const character = db.characters.find(item => String(item.id) === String(characterId));
        if (!character) return null;
        window.currentChatId = character.id;
        window.currentChatType = 'private';
        return character;
    }

    function installSourceReturnButton() {
        document.getElementById('quick-dock-source-return')?.remove();
        const button = document.createElement('button');
        button.id = 'quick-dock-source-return';
        button.type = 'button';
        button.textContent = '‹ 返回操作详情';
        button.addEventListener('click', () => { button.remove(); state.panel = 'operation'; state.open = true; render(); });
        document.body.appendChild(button);
    }

    function openPromptSourceManagement(source) {
        const navigation = source?.navigation || {};
        activatePromptCharacter(navigation.characterId);
        installSourceReturnButton();
        state.open = false; render();
        if (navigation.kind === 'worldbook') {
            if (typeof renderWorldBookList === 'function') renderWorldBookList();
            if (typeof switchScreen === 'function') switchScreen('world-book-screen');
            return;
        }
        if (navigation.kind === 'structured-memory') {
            if (navigation.characterId && typeof window.openMemoryTableForCharacter === 'function') window.openMemoryTableForCharacter(navigation.characterId);
            else if (typeof switchScreen === 'function') switchScreen('memory-table-screen');
            return;
        }
        if (navigation.kind === 'vector-memory' && typeof switchScreen === 'function') { switchScreen('vector-memory-screen'); return; }
        if (navigation.kind === 'journal-memory' && typeof switchScreen === 'function') { switchScreen('memory-journal-screen'); return; }
        toast('该来源没有可直接打开的管理页面');
    }

    function renderPromptSourceItems(section) {
        const items = Array.isArray(section?.items) ? section.items : [];
        if (!items.length) return '';
        return `<div class="quick-dock-source-items-flat">${items.map(item => `
            <article class="quick-dock-source-item-flat ${item.sent === false ? 'is-excluded' : ''}">
                <div class="quick-dock-source-item-head">
                    <b>${escapeHtml(item.title || '来源条目')}</b>
                    <span>${escapeHtml(promptSourceStateLabel(item))} · ${escapeHtml(formatSourceChars(item.chars))}</span>
                </div>
                ${item.reason ? `<p>${escapeHtml(item.reason)}</p>` : ''}
                ${item.content ? `<div class="quick-dock-source-item-content">${escapeHtml(item.content)}</div>` : '<p>本条没有进入最终请求，因此不保留正文。</p>'}
            </article>`).join('')}</div>`;
    }

    function renderPromptTrace(request, operation) {
        const trace = request?.promptTrace;
        const sections = Array.isArray(trace?.sections) ? trace.sections : [];
        if (!sections.length) return '<p class="quick-dock-operation-muted">当前请求没有可解释的来源记录。</p>';
        const sourceSections = sections.filter(section => !section?.metadata?.verificationView);

        const renderSection = section => {
            const meta = promptSourceMeta(section.type);
            const status = promptSourceStateLabel(section);
            const canOpenSource = section.navigation?.kind && section.navigation.kind !== 'proment';
            return `<details class="quick-dock-source-card ${section.sent === false ? 'is-excluded' : ''}">
                <summary>
                    <span class="quick-dock-source-icon">${escapeHtml(section.icon || meta.icon)}</span>
                    <span class="quick-dock-source-title"><b>${escapeHtml(section.title || meta.title)}</b><small>${escapeHtml(section.reason || '本次请求来源')}</small></span>
                    <em>${escapeHtml(status)} · ${escapeHtml(formatSourceChars(section.chars))}</em>
                </summary>
                <div class="quick-dock-source-body">
                    ${section.summary ? `<p class="quick-dock-source-summary">${escapeHtml(section.summary)}</p>` : ''}
                    ${section.content ? `<div class="quick-dock-source-content">${escapeHtml(section.content)}</div>` : (!section.items?.length ? '<p class="quick-dock-operation-muted">该来源没有保留正文。</p>' : '')}
                    ${renderPromptSourceItems(section)}
                    ${canOpenSource ? `<div class="quick-dock-source-actions"><button type="button" data-qd-action="open-source-management" ${promptSourceFocusAttributes(operation, request, section)}>${escapeHtml(section.navigation.label || '打开来源')}</button><small>${escapeHtml(section.evidence || '')}${section.fingerprint ? ` · ${escapeHtml(section.fingerprint)}` : ''}</small></div>` : (section.evidence || section.fingerprint ? `<div class="quick-dock-source-actions"><small>${escapeHtml(section.evidence || '')}${section.fingerprint ? ` · ${escapeHtml(section.fingerprint)}` : ''}</small></div>` : '')}
                    ${section.clipped ? '<p class="quick-dock-truncation-note">该来源过长，操作记录仅保留受控预览。</p>' : ''}
                </div>
            </details>`;
        };
        return `<div class="quick-dock-source-list">${sourceSections.map(renderSection).join('')}</div>`;
    }

    function mutationActionMeta(action) {
        const map = {
            create: { label: '新增', icon: '+', className: 'create' },
            update: { label: '更新', icon: '↻', className: 'update' },
            accept: { label: '接受并写入', icon: '✓', className: 'update' },
            delete: { label: '删除', icon: '−', className: 'delete' },
            pending: { label: '等待确认', icon: '…', className: 'pending' },
            other: { label: '变化', icon: '•', className: 'other' }
        };
        return map[action] || map.other;
    }

    function mutationEntityMeta(type) {
        const map = {
            chat_message: { label: '聊天消息', icon: '💬' },
            character_memory: { label: '角色档案记忆', icon: '🧩' },
            structured_memory: { label: '结构化记忆', icon: '🗂️' },
            memory_review: { label: '待审核草案', icon: '📝' },
            journal: { label: '日记记忆', icon: '📔' },
            vector_memory: { label: '向量记忆', icon: '🧠' },
            theater: { label: '小剧场', icon: '🎭' }
        };
        return map[type] || { label: '其他数据', icon: '📎' };
    }

    function collectOperationMutations(operation) {
        const runtime = getOperationRuntime();
        const records = [operation, ...(runtime?.getChildren?.(operation?.id, { recursive: true }) || [])];
        return records.flatMap(record => (Array.isArray(record?.mutations) ? record.mutations : []).map(mutation => ({ mutation, operation: record })))
            .sort((a, b) => new Date(b.mutation.at || b.operation.updatedAt || 0).getTime() - new Date(a.mutation.at || a.operation.updatedAt || 0).getTime());
    }

    function mutationSummaryText(summary) {
        if (!summary?.total) return '';
        const parts = [];
        if (summary.created) parts.push(`新增 ${summary.created}`);
        if (summary.updated) parts.push(`更新 ${summary.updated}`);
        if (summary.deleted) parts.push(`删除 ${summary.deleted}`);
        if (summary.pending) parts.push(`待确认 ${summary.pending}`);
        if (summary.other) parts.push(`其他 ${summary.other}`);
        return `数据变化 ${summary.total} 项${parts.length ? ` · ${parts.join(' · ')}` : ''}`;
    }

    function compactOperationMutations(operation) {
        const groups = new Map();
        collectOperationMutations(operation).forEach(({ mutation, operation: owner }) => {
            const key = [mutation.action || 'other', mutation.entityType || 'other', mutation.title || '', owner?.id || ''].join('|');
            if (!groups.has(key)) groups.set(key, { mutation: { ...mutation }, operation: owner, contents: [], ids: [], count: 0 });
            const group = groups.get(key);
            group.count += Math.max(1, Number(mutation.count) || 1);
            if (mutation.after) group.contents.push(String(mutation.after));
            else if (mutation.summary) group.contents.push(String(mutation.summary));
            if (mutation.entityId) group.ids.push(String(mutation.entityId));
            group.mutation.at = group.mutation.at || mutation.at;
        });
        return Array.from(groups.values());
    }

    function renderOperationMutations(operation) {
        const entries = compactOperationMutations(operation);
        if (!entries.length) return '<p class="quick-dock-operation-muted">本次操作没有写入数据。</p>';

        const entityCounts = new Map();
        const actionCounts = new Map();
        const contentLines = [];
        const detailRows = [];
        entries.slice(0, 100).forEach(({ mutation, operation: owner, contents, count, ids }) => {
            const action = mutationActionMeta(mutation.action);
            const entity = mutationEntityMeta(mutation.entityType);
            entityCounts.set(entity.label, (entityCounts.get(entity.label) || 0) + count);
            actionCounts.set(action.label, (actionCounts.get(action.label) || 0) + count);
            const uniqueContents = [...new Set(contents.filter(Boolean))];
            uniqueContents.forEach(text => contentLines.push(`${mutation.title || entity.label}：${text}`));
            detailRows.push(`<div class="quick-dock-write-detail-row"><b>${escapeHtml(mutation.title || entity.label)}</b><span>${escapeHtml(action.label)}${count > 1 ? ` × ${escapeHtml(count)}` : ''}</span>${uniqueContents.length ? `<p>${uniqueContents.map(text => escapeHtml(text)).join('<br>')}</p>` : '<p>已写入，未保留正文预览。</p>'}${ids.length ? `<small>ID：${escapeHtml([...new Set(ids)].join('、'))} · ${escapeHtml(owner?.title || '当前操作')} · ${escapeHtml(formatOperationTime(mutation.at))}</small>` : ''}</div>`);
        });

        const entityText = [...entityCounts.entries()].map(([label, count]) => `${label} ${count} 条`).join('、');
        const actionText = [...actionCounts.entries()].map(([label, count]) => `${label} ${count} 条`).join('、');
        const uniqueLines = [...new Set(contentLines)].slice(0, 6);
        const contentText = uniqueLines.length ? uniqueLines.join('；') : '正文未保留';
        return `<div class="quick-dock-write-summary">
            <p><b>已写入：</b>${escapeHtml(entityText)}。</p>
            <p><b>具体内容：</b>${escapeHtml(contentText)}${contentLines.length > 6 ? `；另有 ${escapeHtml(contentLines.length - 6)} 条` : ''}</p>
            <small>${escapeHtml(actionText)}</small>
            <details class="quick-dock-write-details"><summary>查看写入明细</summary>${detailRows.join('')}${entries.length > 100 ? '<p class="quick-dock-truncation-note">仅显示最近 100 组写入。</p>' : ''}</details>
        </div>`;
    }

    function renderMemoryPayloadAudit(operation) {
        const audit = operation?.memoryPayloadAudit;
        if (!audit || typeof audit !== 'object') {
            return '<p class="quick-dock-operation-muted">该历史记录没有最终请求级记忆核验。新发送的私聊会在模型请求形成后进行核验。</p>';
        }
        const item = (title, sent, chars, detail) => `<div class="${sent ? 'is-sent' : 'is-missing'}"><b>${escapeHtml(title)}</b><span>${sent ? `已进入同一次模型请求 · ${escapeHtml(chars || 0)} 字符` : escapeHtml(detail || '本次没有发送')}</span></div>`;
        const archiveDetail = audit.structuredArchiveExpected
            ? '已启用档案但最终请求未检测到内容'
            : '该角色未启用或未绑定结构化档案';
        return `<div class="quick-dock-memory-audit">
            ${item('结构化档案', !!audit.structuredArchiveSent, audit.structuredArchiveChars, archiveDetail)}
            ${item('向量记忆补充', !!audit.vectorSent, audit.vectorChars, '本次没有可用向量结果或未选择向量补充')}
            ${item('回忆日记补充', !!audit.journalSent, audit.journalChars, '本次没有收藏日记或未选择日记补充')}
            ${item('实时状态与待办', !!audit.liveContextSent, audit.liveContextChars, '本次没有实时状态或待办')}
        </div><p class="quick-dock-memory-audit-note">核验位置：Provider 请求体完成后、实际网络调用前。以上内容与聊天消息属于同一次主请求，不是额外的记忆请求。${audit.guardApplied ? '本次检测到模板遗漏，已在最终请求体中自动补入结构化档案。' : ''}</p>`;
    }

    function renderOperationCard(operation, options = {}) {
        if (!operation) return '<div class="quick-dock-operation-empty">还没有操作记录。发送消息、生成小剧场或更新结构化档案后，这里会显示完整进度。</div>';
        const meta = operationStatusMeta(operation.status);
        const request = Array.isArray(operation.requests) ? operation.requests[operation.requests.length - 1] : null;
        const requestLine = request
            ? `${request.provider || 'API'} · ${request.model || '未指定模型'} · ${request.requestChars || request.bodyChars || 0} 字符`
            : '尚未发送模型请求';
        return `
            <article class="quick-dock-operation-card ${options.compact ? 'is-compact' : ''}" data-operation-status="${escapeHtml(meta.className)}">
                <button type="button" class="quick-dock-operation-open" data-qd-action="open-operation" data-operation-id="${escapeHtml(operation.id)}">
                    <div class="quick-dock-operation-head">
                        <span class="quick-dock-operation-icon">${escapeHtml(operation.icon || '✨')}</span>
                        <span class="quick-dock-operation-title"><b>${escapeHtml(operation.title || '执行操作')}</b><small>${escapeHtml(operation.category || '其他')} · ${escapeHtml(formatOperationTime(operation.createdAt))}</small></span>
                        <em class="quick-dock-operation-status">${escapeHtml(meta.label)}</em>
                    </div>
                    <p class="quick-dock-operation-stage">${escapeHtml(operation.status === 'running' || operation.status === 'queued' ? operation.stage : operationResultText(operation))}</p>
                    ${backgroundSummaryText(operation) ? `<p class="quick-dock-operation-background">${escapeHtml(backgroundSummaryText(operation))}</p>` : ''}
                    ${mutationSummaryText(operation.mutationSummary) ? `<p class="quick-dock-operation-mutations">${escapeHtml(mutationSummaryText(operation.mutationSummary))}</p>` : ''}
                    ${options.compact ? '' : `<div class="quick-dock-operation-meta"><span>${escapeHtml(requestLine)}</span><span>${escapeHtml(formatDuration(operationDuration(operation)))}</span></div>`}
                </button>
                ${(operation.status === 'running' || operation.status === 'queued') && !options.compact ? `<button type="button" class="quick-dock-operation-cancel" data-qd-action="cancel-operation" data-operation-id="${escapeHtml(operation.id)}">取消</button>` : ''}
            </article>`;
    }

    function refreshOperationBall() {
        if (!ballEl || !rootEl) return;
        const runtime = getOperationRuntime();
        const active = runtime?.getActive?.() || [];
        const recent = runtime?.list?.({ limit: 1 }) || [];
        const hasFailure = recent[0] && (recent[0].status === 'failed' || recent[0].status === 'interrupted');
        rootEl.classList.toggle('quick-dock--operation-active', active.length > 0);
        rootEl.classList.toggle('quick-dock--operation-error', !active.length && hasFailure);
        ballEl.textContent = active.length ? String(Math.min(active.length, 9)) : 'AI';
        ballEl.setAttribute('aria-label', active.length ? `${active.length} 个操作正在进行` : '打开 AI 操作中心');
        ballEl.setAttribute('aria-expanded', state.open ? 'true' : 'false');
    }

    function getDockOperation() {
        const runtime = getOperationRuntime();
        return runtime?.get?.(state.selectedOperationId) || runtime?.getCurrent?.() || runtime?.list?.({ limit: 1, rootsOnly: true })?.[0] || null;
    }

    function renderActionHub(operation = getDockOperation()) {
        return window.QuickDockActionBar?.render?.({
            activePanel: state.panel,
            api: getCurrentApi(),
            operationId: operation?.id || ''
        }) || '';
    }

    function renderPanelShell(title, subtitle, body, operation = getDockOperation()) {
        panelEl.innerHTML = `<header class="quick-dock-panel-header quick-dock-panel-header--shared">
            ${state.panel !== 'main' ? '<button type="button" class="quick-dock-icon-btn quick-dock-back-btn" data-qd-action="main" aria-label="返回操作历史">‹</button>' : ''}
            <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle || '')}</span></div>
            <button type="button" class="quick-dock-icon-btn quick-dock-close-btn" data-qd-action="close" aria-label="关闭操作中心">×</button>
        </header>
        ${renderActionHub(operation)}
        <main class="quick-dock-panel-content" data-quick-dock-panel-content>${body}</main>`;
        setTimeout(() => refreshModelSelect(false), 0);
    }

    async function refreshModelSelect(forceFetch = false) {
        const modelSelect = panelEl && panelEl.querySelector('#quick-dock-top-model-select');
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
        const runtime = getOperationRuntime();
        const allRoots = runtime?.list?.({ limit: 100, rootsOnly: true }) || [];
        const active = allRoots.filter(item => item.status === 'running' || item.status === 'queued');
        const current = active[0] || allRoots[0] || null;
        const history = allRoots.filter(item => !current || item.id !== current.id).slice(0, state.historyVisible);
        const storage = runtime?.getStorageStats?.() || {};
        const currentApi = getCurrentApi();
        const body = `
            <section class="quick-dock-operation-current">
                <div class="quick-dock-section-title"><b>${active.length ? '当前操作' : '最近一次操作'}</b><small>${escapeHtml(currentApi.provider)} · ${escapeHtml(currentApi.model)}</small></div>
                ${renderOperationCard(current)}
            </section>
            <section class="quick-dock-history-workbench">
                <div class="quick-dock-section-title"><b>操作历史</b><small>${allRoots.length} 条</small></div>
                <div class="quick-dock-history-actions">
                    <button type="button" data-qd-action="export-history">导出操作报告</button>
                    ${allRoots.length ? '<button type="button" data-qd-action="clear-operations">清除全部已完成</button>' : ''}
                    <span>记录占用 ${escapeHtml(formatStorageSize(storage.chars))} / ${escapeHtml(formatStorageSize(storage.budget))}${storage.compacted ? ' · 已自动压缩' : ''}</span>
                </div>
                <div class="quick-dock-operation-list">${history.length ? history.map(item => renderOperationCard(item, { compact: true })).join('') : '<p class="quick-dock-operation-muted">暂无历史记录。</p>'}</div>
                ${history.length < allRoots.filter(item => !current || item.id !== current.id).length ? '<button type="button" class="quick-dock-show-more" data-qd-action="show-more-history">显示更多</button>' : ''}
            </section>
            <p class="quick-dock-status">点击任意记录查看详情；详情中的执行阶段、模型请求、后台工作和写入结果均可折叠。</p>`;
        renderPanelShell('AI 操作中心', `V2.13-R3 · ${active.length ? `${active.length} 项主操作正在进行` : '当前没有运行中的主操作'}`, body, current);
    }



    function renderOperationDetail() {
        const runtime = getOperationRuntime();
        const operation = runtime?.get?.(state.selectedOperationId) || runtime?.getCurrent?.() || null;
        if (!operation) { state.panel = 'main'; renderMain(); return; }
        state.selectedOperationId = operation.id;
        const meta = operationStatusMeta(operation.status);
        const steps = Array.isArray(operation.steps) ? operation.steps : [];
        const requests = Array.isArray(operation.requests) ? operation.requests : [];
        const fold = (title, metaText, content, open = false, cls = '') => `<details class="quick-dock-fold ${cls}" ${open ? 'open' : ''}><summary><span>${escapeHtml(title)}</span><small>${metaText || ''}</small></summary><div class="quick-dock-fold-body">${content}</div></details>`;
        const stepContent = `<div class="quick-dock-step-list">${steps.length ? steps.map(step => `<div class="quick-dock-step" data-step-status="${escapeHtml(step.status || '')}"><i></i><span><b>${escapeHtml(step.title || '处理')}</b>${step.detail ? `<small>${escapeHtml(step.detail)}</small>` : ''}</span><time>${escapeHtml(formatOperationTime(step.at))}</time></div>`).join('') : '<p class="quick-dock-operation-muted">暂无阶段记录</p>'}</div>`;
        const requestContent = requests.length ? requests.map((request, index) => `<details class="quick-dock-request-row"><summary><span><b>${escapeHtml(request.model || request.task || 'AI 请求')}</b><small>${escapeHtml(request.provider || 'API')} · ${escapeHtml(request.phase || '')}</small></span><em>第 ${index + 1} 次 · ${escapeHtml(request.requestChars || request.bodyChars || 0)} 字符</em></summary><div class="quick-dock-request-row-body"><div class="quick-dock-request-meta"><span>来源：${escapeHtml(request.source || '未标记')}</span><span>消息：${escapeHtml(request.messageCount || 0)} 条</span><span>耗时：${escapeHtml(formatDuration(request.durationMs))}</span></div>${request.errorMessage ? `<p class="quick-dock-request-error">${escapeHtml(request.errorMessage)}</p>` : ''}${renderPromptTrace(request, operation)}</div></details>`).join('') : '<p class="quick-dock-operation-muted">本次操作没有发送模型请求，或属于本地操作。</p>';
        const body = `
            <section class="quick-dock-operation-detail-head" data-operation-status="${escapeHtml(meta.className)}">
                <div><b>${escapeHtml(meta.label)}</b><span>${escapeHtml(formatDuration(operationDuration(operation)))}</span></div>
                <p>${escapeHtml(operationResultText(operation))}</p>
                ${(operation.status === 'running' || operation.status === 'queued') ? `<button type="button" data-qd-action="cancel-operation" data-operation-id="${escapeHtml(operation.id)}">取消本次操作</button>` : ''}
            </section>
            <div class="quick-dock-fold-list">
                ${fold('执行阶段', `${steps.length} 条`, stepContent, true)}
                ${fold('模型请求', `${requests.length} 次实际网络调用`, requestContent)}
                ${fold('后台工作', `${escapeHtml(operation?.background?.total || 0)} 项`, renderChildOperationList(operation))}
                ${fold('写入结果', `${escapeHtml(operation?.mutationSummary?.total || 0)} 项`, renderOperationMutations(operation), true, 'quick-dock-mutation-section')}
                ${fold('本次聊天记忆核验', '最终请求体', renderMemoryPayloadAudit(operation))}
                ${operation.error ? fold('错误信息', '', `<pre class="quick-dock-result-pre">${escapeHtml(operation.error.message || '操作失败')}</pre>`, true) : ''}
            </div>
            <div class="quick-dock-report-actions"><button type="button" data-qd-action="copy-operation" data-operation-id="${escapeHtml(operation.id)}">复制操作报告</button><button type="button" data-qd-action="download-operation-report" data-operation-id="${escapeHtml(operation.id)}">下载操作报告</button></div>`;
        renderPanelShell(`${operation.icon || '✨'} ${operation.title}`, `${operation.category || '其他'} · ${formatOperationTime(operation.createdAt)}`, body, operation);
    }



    function renderCapabilityCoverage() {
        const catalog = window.OVOAICapabilityCatalog;
        const definitions = (catalog?.list?.() || []).filter(item => item.type !== 'ai.request');
        const recent = window.OVOAIRequestRuntime?.getCapabilityCoverage?.() || [];
        const recentMap = new Map(recent.map(item => [item.type, item]));
        const generic = recentMap.get('ai.request') || null;
        const categories = new Map();
        definitions.forEach(item => {
            if (!categories.has(item.category || '其他')) categories.set(item.category || '其他', []);
            categories.get(item.category || '其他').push(item);
        });
        const recentTotal = recent.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
        const usedCount = definitions.filter(item => recentMap.has(item.type)).length;
        const body = `
            <section class="quick-dock-coverage-summary">
                <div><b>${escapeHtml(definitions.length)}</b><span>已登记产品操作</span></div>
                <div><b>${escapeHtml(usedCount)}</b><span>最近会话已实际调用</span></div>
                <div><b>${escapeHtml(recentTotal)}</b><span>最近保留的网络请求</span></div>
                <div><b>${escapeHtml(generic?.count || 0)}</b><span>仍为通用分类</span></div>
            </section>
            <p class="quick-dock-operation-muted">“已登记”表示该功能具有专属名称、类别和图标；“最近调用”来自当前会话真实请求诊断，不调用的功能不会凭空显示成功。</p>
            <div class="quick-dock-coverage-groups">
                ${Array.from(categories.entries()).map(([category, items]) => `
                    <section class="quick-dock-detail-section quick-dock-coverage-group">
                        <h4>${escapeHtml(category)} <small>${items.length} 项</small></h4>
                        <div class="quick-dock-coverage-list">
                            ${items.map(item => {
                                const usage = recentMap.get(item.type);
                                const status = usage ? (usage.failed > 0 && usage.success === 0 ? '最近失败' : '最近已调用') : '尚未调用';
                                return `<article data-coverage-used="${usage ? 'true' : 'false'}">
                                    <span>${escapeHtml(item.icon || '✨')}</span>
                                    <div><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.type)}</small></div>
                                    <em>${escapeHtml(status)}${usage ? ` · ${usage.count} 次` : ''}</em>
                                </article>`;
                            }).join('')}
                        </div>
                    </section>`).join('')}
            </div>
            <p class="quick-dock-status">静态发布检查还会阻止新增的未登记 AI task，避免后续功能绕回笼统日志。</p>`;
        renderPanelShell('AI 功能覆盖', 'V2.13-R3 · 能力目录与请求核验', body);
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
        const body = `
            <div class="quick-dock-console-toolbar">
                <select id="quick-dock-console-filter"><option value="all">全部</option><option value="error">错误</option><option value="warn">警告</option><option value="info">信息</option><option value="log">日志</option></select>
                <button type="button" data-qd-action="copy-console">复制全部</button>
                <button type="button" data-qd-action="clear-console">清空</button>
            </div>
            <div id="quick-dock-console-rows" class="quick-dock-console-rows"></div>`;
        renderPanelShell('开发日志', '仅捕获 OVO 页面自身日志', body);
        panelEl.querySelector('#quick-dock-console-filter').addEventListener('change', renderConsoleRows);
        renderConsoleRows();
    }

    function render() {
        if (!rootEl || !panelEl) return;
        rootEl.classList.toggle('quick-dock--open', state.open);
        panelEl.hidden = !state.open;
        panelEl.classList.toggle('quick-dock-panel--console', state.panel === 'console');
        panelEl.classList.toggle('quick-dock-panel--app-fullscreen', state.open);
        document.body.classList.toggle('quick-dock-body-open', state.open);
        if (state.panel !== 'operation') panelEl.classList.remove('quick-dock-panel--detail-fullscreen');
        if (!state.open) return;
        refreshOperationBall();
        if (state.panel === 'console') renderConsole();
        else if (state.panel === 'coverage') renderCapabilityCoverage();
        else if (state.panel === 'operation') renderOperationDetail();
        else renderMain();
    }

    async function runAction(action, trigger) {
        if (action === 'close') { state.open = false; state.panel = 'main'; render(); return; }
        if (action === 'main') { state.panel = 'main'; state.selectedOperationId = null; render(); return; }
        if (action === 'open-console') { state.panel = 'console'; render(); return; }
        if (action === 'open-coverage') { state.panel = 'coverage'; render(); return; }
        if (action === 'apply-history-filters') {
            const filters = readHistoryFilterControls();
            state.historyQuery = filters.query; state.historyStatus = filters.status; state.historyCategory = filters.category; state.historyType = filters.type; state.historyFrom = filters.from; state.historyTo = filters.to; state.historyVisible = 20; render(); return;
        }
        if (action === 'reset-history-filters') {
            state.historyQuery = ''; state.historyStatus = ''; state.historyCategory = ''; state.historyType = ''; state.historyFrom = ''; state.historyTo = ''; state.historyVisible = 20; render(); return;
        }
        if (action === 'show-more-history') { state.historyVisible = Math.min(100, state.historyVisible + 20); render(); return; }
        if (action === 'export-history') {
            const text = getOperationRuntime()?.exportHistory?.({ mode: REPORT_MODE, format: 'markdown', rootsOnly: true, limit: 100 });
            if (text) { downloadText(reportFilename('章鱼机_AI操作历史报告'), text); toast('脱敏操作报告已下载'); }
            return;
        }
        if (action === 'open-operation') {
            state.selectedOperationId = trigger?.dataset?.operationId || getOperationRuntime()?.getCurrent?.()?.id || null;
            state.panel = 'operation';
            render();
            return;
        }
        if (action === 'cancel-operation') {
            const operationId = trigger?.dataset?.operationId || state.selectedOperationId;
            if (operationId) getOperationRuntime()?.cancel?.(operationId, '用户从操作中心取消');
            render();
            return;
        }
        if (action === 'clear-operations') {
            getOperationRuntime()?.clear?.({ keepActive: true });
            state.selectedOperationId = null;
            render();
            return;
        }
        if (action === 'open-source-management') {
            const { source } = findPromptSource(trigger);
            if (!source) { toast('没有找到该来源记录'); return; }
            openPromptSourceManagement(source);
            return;
        }
        if (action === 'copy-operation' || action === 'download-operation-report') {
            const operationId = trigger?.dataset?.operationId || state.selectedOperationId;
            const runtime = getOperationRuntime();
            const text = runtime?.exportReport?.(operationId, { mode: REPORT_MODE, format: 'markdown', includeChildren: true }) || '';
            if (text && action === 'download-operation-report') {
                downloadText(reportFilename('章鱼机_AI操作报告'), text);
                toast('脱敏操作报告已下载');
            } else if (text) {
                try { await navigator.clipboard.writeText(text); }
                catch (_) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
                toast('脱敏操作报告已复制');
            }
            return;
        }
        if (action === 'open-git-settings') { openGitSettings(); return; }
        try {
            rootEl.classList.add('quick-dock--busy');
            if (action === 'switch-api') {
                const modelSelect = panelEl.querySelector('#quick-dock-top-model-select');
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
        if (action) runAction(action.dataset.qdAction, action);
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
        panelEl.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target?.id === 'quick-dock-history-query') { event.preventDefault(); runAction('apply-history-filters', event.target); } });
        ballEl.addEventListener('pointerdown', onPointerDown);
        ballEl.addEventListener('pointermove', onPointerMove);
        ballEl.addEventListener('pointerup', onPointerUp);
        ballEl.addEventListener('pointercancel', () => { drag = null; });
        document.addEventListener('pointerdown', event => { if (state.open && !rootEl.contains(event.target)) { state.open = false; state.panel = 'main'; render(); } });
        window.addEventListener('resize', () => { applyPosition(state.x, state.y); savePosition(); });
        window.addEventListener('ovo:operation-change', () => {
            refreshOperationBall();
            if (state.open && (state.panel === 'main' || state.panel === 'operation')) render();
        });
        refreshOperationBall();
        render();
    }

    installConsoleCapture();
    window.QuickDock = {
        init,
        open: panel => { state.panel = panel || 'main'; state.open = true; render(); },
        openOperation: id => { state.selectedOperationId = id || getOperationRuntime()?.getCurrent?.()?.id || null; state.panel = 'operation'; state.open = true; render(); },
        close: () => { state.open = false; render(); }
    };
    // Compatibility with the V12.9-V13.4 initialization call.
    window.FloatingBall = window.QuickDock;
})();
