// QuickDock · QWQ 5.8.0：只读请求观察；打开悬浮球不会暂停或取消模型请求。
(() => {
    'use strict';

    const STORAGE_KEY = 'ovo_quick_dock_v2';
    const PACKAGE_VERSION = '5.8.0';
    const state = { open: false, panel: 'main', x: null, y: null, status: '', selectedOperationId: null, historyVisible: 8 };
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

    const PROMPT_SOURCE_META = Object.freeze({
        identity: { title: '身份与设定', icon: '👤' }, knowledge: { title: '世界书与知识', icon: '📚' },
        memory: { title: '记忆', icon: '🧠' }, collection: { title: '收藏', icon: '⭐' }, conversation: { title: '聊天历史', icon: '💬' },
        runtime: { title: '运行环境', icon: '⏱️' }, protocol: { title: '输出协议', icon: '📐' },
        tools: { title: '工具定义', icon: '🛠️' }, request: { title: '请求参数', icon: '⚙️' },
        context: { title: '上下文来源', icon: '📎' }
    });

    function promptSourceMeta(type) {
        return PROMPT_SOURCE_META[type] || { title: '其他上下文', icon: '📎' };
    }

    function promptSourceStateLabel(section) {
        const labels = { sent: '实际发送', verified: '已核对', contributed: '参与组装', excluded: '未发送' };
        return labels[section?.state] || (section?.sent === false ? '未发送' : '参与组装');
    }

    function requestSourceSections(request, operation) {
        const manifestSources = Array.isArray(request?.contextManifest?.sources) ? request.contextManifest.sources : [];
        if (manifestSources.length) {
            return manifestSources.map(source => ({
                id: source?.sourceId || '',
                sourceId: source?.sourceId || '',
                type: source?.domain || source?.layer || 'context',
                title: source?.title || source?.sourceId || '上下文来源',
                sent: source?.included !== false,
                state: source?.included === false ? 'excluded' : (source?.accounted === false ? 'contributed' : 'sent'),
                chars: Math.max(0, Number(source?.chars || source?.matchedChars) || 0),
                count: Math.max(0, Number(source?.count) || 0),
                metadata: source?.metadata && typeof source.metadata === 'object' ? source.metadata : null,
                reason: source?.reason || '',
                content: typeof source?.content === 'string' ? source.content : '',
                items: Array.isArray(source?.items) ? source.items : []
            }));
        }
        const requestTrace = Array.isArray(request?.promptTrace?.sections) ? request.promptTrace.sections : [];
        if (requestTrace.length) return requestTrace;
        const operationTrace = Array.isArray(operation?.promptTrace?.sections) ? operation.promptTrace.sections : [];
        return operationTrace;
    }

    function historyTimeLabel(value) {
        const text = String(value || '').trim();
        if (!text || text === '时间未记录') return '时间未记录';
        return text.replace(/\s+UTC[+-]\d{2}:?\d{2}$/i, '');
    }

    function parseHistoryDisplayItem(item) {
        const raw = String(item?.content || '');
        const metadata = item?.metadata || {};
        const role = String(metadata.role || '').toLowerCase();
        const sentAt = metadata.sentAt
            || raw.match(/<message_meta\b[^>]*sent_at=["']([^"']+)["'][^>]*\/?>(?:<\/message_meta>)?/i)?.[1]
            || '';
        let content = raw
            .replace(/<message_meta\b[^>]*\/?>(?:<\/message_meta>)?/gi, '')
            .replace(/^\s*\[id:[^\]\r\n]+\]\s*/i, '')
            .trim();
        let sender = role === 'user' ? '用户' : (role === 'assistant' || role === 'model') ? '角色' : (item?.title || '消息');
        const messageMatch = content.match(/^\s*\[([^\]\r\n]+?)的消息[：:]([\s\S]*?)\]\s*$/);
        const voiceMatch = content.match(/^\s*\[([^\]\r\n]+?)的语音[：:]([\s\S]*?)\]\s*$/);
        if (messageMatch) {
            sender = messageMatch[1].trim() || sender;
            content = String(messageMatch[2] || '').trim();
        } else if (voiceMatch) {
            sender = voiceMatch[1].trim() || sender;
            content = `[语音] ${String(voiceMatch[2] || '').trim()}`.trim();
        }
        return { sender, time: historyTimeLabel(sentAt), content: content || '（空）' };
    }

    function renderHistorySourceItems(items) {
        return `<div class="quick-dock-history-message-list">${items.map(item => {
            const message = parseHistoryDisplayItem(item);
            return `<article class="quick-dock-history-message">
                <header><b>${escapeHtml(message.sender)}</b><time>${escapeHtml(message.time)}</time></header>
                <pre>${escapeHtml(message.content)}</pre>
            </article>`;
        }).join('')}</div>`;
    }

    function sourceMatches(section, sourceId) {
        return section?.sourceId === sourceId || section?.id === sourceId;
    }

    function renderFlatSourceRows(items, options = {}) {
        const list = Array.isArray(items) ? items : [];
        if (!list.length) return '<p class="quick-dock-operation-muted">本组没有可展示的实际条目。</p>';
        return `<div class="quick-dock-source-flat-list">${list.map((item, index) => {
            const content = String(item?.content || '');
            const itemChars = Math.max(0, Number(item?.chars) || content.length);
            const title = typeof options.titleFor === 'function'
                ? options.titleFor(item, index)
                : (item?.title || `条目 ${index + 1}`);
            return `<article class="quick-dock-source-flat-item ${item?.sent === false ? 'is-excluded' : ''}">
                <header><b>${escapeHtml(title)}</b><em>${escapeHtml(item?.sent === false ? '未发送' : formatSourceChars(itemChars))}</em></header>
                ${content ? `<pre>${escapeHtml(content)}</pre>` : '<p class="quick-dock-operation-muted">本条没有发送文本。</p>'}
            </article>`;
        }).join('')}</div>`;
    }

    function renderGroupedSourceItems(groups) {
        const list = (Array.isArray(groups) ? groups : []).filter(group => group && (group.count > 0 || group.items?.length));
        if (!list.length) return '<p class="quick-dock-operation-muted">没有可展示的分组条目。</p>';
        return `<div class="quick-dock-source-groups">${list.map(group => {
            const captured = Array.isArray(group.items) ? group.items.length : 0;
            const total = Math.max(captured, Number(group.count) || 0);
            const note = group.note || (captured < total ? `当前记录保留 ${captured}/${total} 条；后续新请求会完整记录。` : '');
            return `<details class="quick-dock-source-group">
                <summary><span><b>${escapeHtml(group.title || '分组')}</b><small>${escapeHtml(note)}</small></span><em>${total} 条</em></summary>
                <div class="quick-dock-source-group-body">${renderFlatSourceRows(group.items, { titleFor: group.titleFor })}</div>
            </details>`;
        }).join('')}</div>`;
    }

    function renderStructuredMemorySource(section) {
        const items = Array.isArray(section.items) ? section.items : [];
        const tableMap = new Map();
        items.forEach((item, index) => {
            const tableName = String(item?.metadata?.tableName || item?.title || '结构化记忆').replace(/\s*·\s*第\s*\d+\s*条\s*$/, '').trim() || '结构化记忆';
            if (!tableMap.has(tableName)) tableMap.set(tableName, []);
            tableMap.get(tableName).push({ ...item, __sourceIndex: index });
        });
        const groups = Array.from(tableMap.entries()).map(([title, records]) => ({
            title,
            count: records.length,
            items: records,
            titleFor: (item, index) => `第 ${Number(item?.metadata?.recordIndex) || index + 1} 条`
        }));
        return renderGroupedSourceItems(groups);
    }

    function renderGenericSourceItems(section) {
        const items = Array.isArray(section.items) ? section.items : [];
        return `<div class="quick-dock-source-items">${items.map((item, index) => {
            const content = String(item?.content || '');
            const itemChars = Math.max(0, Number(item?.chars) || content.length);
            const status = item?.sent === false ? '未发送' : '已发送';
            return `<details class="quick-dock-source-item ${item?.sent === false ? 'is-excluded' : ''}">
                <summary><span><b>${escapeHtml(item?.title || `条目 ${index + 1}`)}</b><small>${escapeHtml(item?.reason || '点击展开实际内容')}</small></span><em>${escapeHtml(status)} · ${escapeHtml(formatSourceChars(itemChars))}</em></summary>
                <div class="quick-dock-source-item-body">${content ? `<pre>${escapeHtml(content)}</pre>` : '<p class="quick-dock-operation-muted">本条没有发送文本。</p>'}</div>
            </details>`;
        }).join('')}</div>`;
    }

    function renderPromptTrace(request, operation) {
        const sections = requestSourceSections(request, operation);
        if (!sections.length) return '<p class="quick-dock-operation-muted">当前请求没有来源记录。</p>';

        const renderItems = section => {
            const items = Array.isArray(section.items) ? section.items : [];
            if (!items.length) return '';
            if (sourceMatches(section, 'chat.history')) return renderHistorySourceItems(items);
            if (['memory.structured', 'identity.core', 'memory.long_term', 'memory.current_related'].some(sourceId => sourceMatches(section, sourceId))) return renderStructuredMemorySource(section);
            return renderGenericSourceItems(section);
        };

        const renderSection = section => {
            const meta = promptSourceMeta(section.type);
            const status = promptSourceStateLabel(section);
            const content = String(section.content || '');
            const items = Array.isArray(section.items) ? section.items : [];
            const hasText = !!content || items.some(item => String(item?.content || ''));
            const sourceBody = items.length
                ? renderItems(section)
                : (content ? `<pre class="quick-dock-source-content">${escapeHtml(content)}</pre>` : '<p class="quick-dock-operation-muted">本项没有发送文本。</p>');
            const isHistorySection = sourceMatches(section, 'chat.history');
            const isStructuredMemory = ['memory.structured', 'identity.core', 'memory.long_term', 'memory.current_related'].some(sourceId => sourceMatches(section, sourceId));
            let countHint = items.length ? `${Math.max(items.length, Number(section.count) || 0)} 条明细` : (hasText ? '实际正文' : (section.reason || '本次未发送'));
            let displayTitle = section.title || meta.title;
            if (isHistorySection) countHint = `${items.length} 条消息`;
            if (isStructuredMemory) {
                const tableCount = new Set(items.map(item => String(item?.metadata?.tableName || item?.title || '结构化记忆').replace(/\s*·\s*第\s*\d+\s*条\s*$/, ''))).size;
                countHint = `${tableCount} 个表 · ${items.length} 条记录`;
            }
            const reasonHtml = isHistorySection ? '' : `<p class="quick-dock-source-summary">${escapeHtml(section.reason || '来自最终模型请求')}</p>`;
            return `<details class="quick-dock-source-card ${section.sent === false ? 'is-excluded' : ''}">
                <summary>
                    <span class="quick-dock-source-icon">${escapeHtml(section.icon || meta.icon || '•')}</span>
                    <span class="quick-dock-source-title"><b>${escapeHtml(displayTitle)}</b><small>${escapeHtml(countHint)}</small></span>
                    <em>${escapeHtml(status)} · ${escapeHtml(formatSourceChars(section.chars))}</em>
                </summary>
                <div class="quick-dock-source-body">
                    ${reasonHtml}
                    ${sourceBody}
                </div>
            </details>`;
        };
        const manifest = request?.contextManifest;
        const included = sections.filter(item => item.sent !== false && (Number(item.chars) > 0 || String(item.content || '') || (item.items || []).some(entry => String(entry?.content || '')))).length;
        const complete = manifest?.coverage?.complete !== false;
        const hasSavedText = sections.some(section => String(section.content || '') || (section.items || []).some(item => String(item?.content || '')));
        const legacyNote = hasSavedText ? '' : '<p class="quick-dock-source-summary-note">旧记录只保存了来源名称和字数；新请求会保存逐项实际文本。</p>';
        const coverageText = complete ? '文本已对账' : '需要检查';
        return `<div class="quick-dock-source-summary-head"><span>实际来源 ${included}/${sections.length} 项</span><span class="${complete ? 'is-ok' : 'is-warning'}">${coverageText}</span></div>${legacyNote}<div class="quick-dock-source-list">${sections.map(renderSection).join('')}</div>`;
    }

    function renderRequestBody(request) {
        const body = String(request?.bodyPreview || '').trim();
        if (!body) {
            return '<p class="quick-dock-operation-muted quick-dock-request-body-missing">该条记录未保留原始请求 JSON；请直接查看上方逐项来源文本。</p>';
        }
        const truncated = !!request?.bodyTruncated;
        const totalChars = Math.max(0, Number(request?.bodyChars || request?.requestChars) || 0);
        const label = truncated ? `原始请求 JSON · 存在超大单项省略 · ${totalChars} 字符` : `原始请求 JSON · 完整保存 · ${totalChars || body.length} 字符`;
        return `<details class="quick-dock-raw-request"><summary>${escapeHtml(label)}</summary>${truncated ? '<p class="quick-dock-request-truncated">仅超大单项（超过 24 万字符）会被保护性省略；普通文本请求不再按 16000 字符截断。</p>' : ''}<pre>${escapeHtml(body)}</pre></details>`;
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
            if (!groups.has(key)) groups.set(key, { mutation: { ...mutation }, operation: owner, contents: [], count: 0 });
            const group = groups.get(key);
            group.count += Math.max(1, Number(mutation.count) || 1);
            if (mutation.after) group.contents.push(String(mutation.after));
            else if (mutation.summary) group.contents.push(String(mutation.summary));
            group.mutation.at = group.mutation.at || mutation.at;
        });
        return Array.from(groups.values());
    }

    function renderMemoryWriteStatus(operation) {
        const runtime = getOperationRuntime();
        const records = [operation, ...(runtime?.getChildren?.(operation?.id, { recursive: true }) || [])];
        const memoryRecords = records.filter(record => String(record?.type || '').startsWith('memory.'));
        if (!memoryRecords.length) return '';
        const memoryMutationCount = memoryRecords.reduce((sum, record) => sum + (Array.isArray(record?.mutations) ? record.mutations.filter(item => String(item?.entityType || '').includes('memory')).length : 0), 0);
        if (memoryMutationCount) return `<p class="quick-dock-memory-write-status is-written">记忆写入已记录，下面展示实际表格内容。</p>`;
        const failed = memoryRecords.find(record => record.status === 'failed');
        if (failed) return `<p class="quick-dock-memory-write-status is-failed">记忆写入失败：${escapeHtml(failed.error?.message || failed.summary || '未知错误')}</p>`;
        const skipped = memoryRecords.find(record => record.status === 'skipped');
        if (skipped) return `<p class="quick-dock-memory-write-status">记忆已检查：${escapeHtml(skipped.summary || '本轮没有可写入的记忆')}</p>`;
        return '<p class="quick-dock-memory-write-status">记忆检查已执行，但本轮没有产生记忆数据变化。</p>';
    }

    function renderOperationMutations(operation) {
        const entries = compactOperationMutations(operation);
        const memoryStatus = renderMemoryWriteStatus(operation);
        if (!entries.length) return `${memoryStatus}<p class="quick-dock-operation-muted">本次操作没有写入数据。</p>`;

        const entityCounts = new Map();
        const actionCounts = new Map();
        const contentLines = [];
        const detailRows = [];
        entries.slice(0, 100).forEach(({ mutation, operation: owner, contents, count }) => {
            const action = mutationActionMeta(mutation.action);
            const entity = mutationEntityMeta(mutation.entityType);
            entityCounts.set(entity.label, (entityCounts.get(entity.label) || 0) + count);
            actionCounts.set(action.label, (actionCounts.get(action.label) || 0) + count);
            const uniqueContents = [...new Set(contents.filter(Boolean))];
            uniqueContents.forEach(value => contentLines.push(`${mutation.title || entity.label}：${value}`));
            const fields = Array.isArray(mutation.fields) && mutation.fields.length ? ` · 字段：${mutation.fields.join('、')}` : '';
            detailRows.push(`<div class="quick-dock-write-detail-row"><b>${escapeHtml(mutation.title || entity.label)}</b><span>${escapeHtml(action.label)}${count > 1 ? ` × ${escapeHtml(count)}` : ''}</span>${uniqueContents.length ? `<p>${uniqueContents.map(value => escapeHtml(value)).join('<br>')}</p>` : '<p>跟踪记录没有提供实际正文。</p>'}<small>${escapeHtml(owner?.title || '当前操作')} · ${escapeHtml(formatOperationTime(mutation.at))}${escapeHtml(fields)}</small></div>`);
        });

        const entityText = [...entityCounts.entries()].map(([label, count]) => `${label} ${count} 条`).join('、');
        const actionText = [...actionCounts.entries()].map(([label, count]) => `${label} ${count} 条`).join('、');
        const uniqueLines = [...new Set(contentLines)].slice(0, 6);
        const contentText = uniqueLines.length ? uniqueLines.join('；') : '跟踪记录没有提供实际正文';
        return `<div class="quick-dock-write-summary">
            ${memoryStatus}
            <p><b>写入类型：</b>${escapeHtml(entityText)}。</p>
            <p><b>实际内容：</b>${escapeHtml(contentText)}${contentLines.length > 6 ? `；另有 ${escapeHtml(contentLines.length - 6)} 条` : ''}</p>
            <small>${escapeHtml(actionText)}</small>
            <details class="quick-dock-write-details"><summary>展开全部写入内容</summary>${detailRows.join('')}${entries.length > 100 ? '<p class="quick-dock-truncation-note">仅显示最近 100 组写入。</p>' : ''}</details>
        </div>`;
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
        ballEl.innerHTML = `<span>${active.length ? String(Math.min(active.length, 9)) : 'AI'}</span><small>v${PACKAGE_VERSION}</small>`;
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
                <div class="quick-dock-section-title"><b>操作记录</b><small>最近 ${allRoots.length} 条 · 非聊天消息</small></div>
                <div class="quick-dock-history-actions">
                    ${allRoots.length ? '<button type="button" data-qd-action="clear-operations">清除已完成</button>' : ''}
                    <span>仅保存在本次浏览会话 · ${escapeHtml(formatStorageSize(storage.chars))} / ${escapeHtml(formatStorageSize(storage.budget))}${storage.compacted ? ' · 旧记录已压缩' : ''}</span>
                </div>
                <div class="quick-dock-operation-list">${history.length ? history.map(item => renderOperationCard(item, { compact: true })).join('') : '<p class="quick-dock-operation-muted">暂无历史记录。</p>'}</div>
                ${history.length < allRoots.filter(item => !current || item.id !== current.id).length ? '<button type="button" class="quick-dock-show-more" data-qd-action="show-more-history">显示更多</button>' : ''}
            </section>
            <p class="quick-dock-status">悬浮球是只读观察面板；打开、关闭或展开详情都不会暂停、取消或重新发送当前请求。操作记录与聊天历史是两套数量。</p>`;
        renderPanelShell('AI 操作中心', `QWQ v${PACKAGE_VERSION} · ${active.length ? `${active.length} 项主操作正在进行` : '当前没有运行中的主操作'}`, body, current);
    }



    function findRequestSource(request, operation, sourceId) {
        return requestSourceSections(request, operation).find(item => item.id === sourceId || item.sourceId === sourceId) || null;
    }

    function requestHistoryFacts(request, operation) {
        const history = findRequestSource(request, operation, 'chat.history');
        const current = findRequestSource(request, operation, 'chat.current_input');
        const control = findRequestSource(request, operation, 'cot.instructions');
        const historyCount = Array.isArray(history?.items) ? history.items.length : 0;
        const currentCount = Array.isArray(current?.items) ? current.items.length : 0;
        const controlCount = Array.isArray(control?.items) ? control.items.length : 0;
        const policy = request?.contextManifest?.policy || {};
        const policyText = policy.historyEnabled === false
            ? '历史已关闭（仅保留本轮输入）'
            : (Number(policy.historyCount) === 0
                ? '历史不设上限（发送全部可用消息）'
                : (Number.isFinite(Number(policy.historyCount)) ? `历史上限 ${Number(policy.historyCount)} 条消息` : '历史上限未记录'));
        const systemInstructionCount = Math.max(0, Number(request.systemMessageCount) || 0);
        return `<div class="quick-dock-history-facts">
            <span><b>消息数组</b>${escapeHtml(request.messageCount || 0)} 条</span>
            <span><b>其中历史</b>${escapeHtml(historyCount)} 条</span>
            <span><b>本轮输入</b>${escapeHtml(currentCount)} 条</span>
            ${controlCount ? `<span><b>控制消息</b>${escapeHtml(controlCount)} 条</span>` : ''}
            ${systemInstructionCount ? `<span><b>系统指令</b>${escapeHtml(systemInstructionCount)} 条</span>` : ''}
            <span><b>策略</b>${escapeHtml(policyText)}</span>
            <small>这里按最终请求里的消息条目计数，不按“对话轮次”计数；Gemini 的 system instruction 独立于 contents 消息数组。</small>
        </div>`;
    }

    function renderRequestEntry(request, operation, index, total) {
        const content = `<div class="quick-dock-request-meta"><span>调用来源：${escapeHtml(request.source || '未标记')}</span><span>耗时：${escapeHtml(formatDuration(request.durationMs))}</span><span>请求字符：${escapeHtml(request.requestChars || request.bodyChars || 0)}</span></div>${requestHistoryFacts(request, operation)}${request.errorMessage ? `<p class="quick-dock-request-error">${escapeHtml(request.errorMessage)}</p>` : ''}${renderPromptTrace(request, operation)}${renderRequestBody(request)}`;
        if (total === 1) {
            return `<section class="quick-dock-request-flat">
                <header><div><b>${escapeHtml(request.model || request.task || 'AI 请求')}</b><small>${escapeHtml(request.provider || 'API')} · ${escapeHtml(request.phase || '')}</small></div><em>${escapeHtml(request.requestChars || request.bodyChars || 0)} 字符</em></header>
                <div class="quick-dock-request-row-body">${content}</div>
            </section>`;
        }
        return `<details class="quick-dock-request-row" ${index === 0 ? 'open' : ''}><summary><span><b>${escapeHtml(request.model || request.task || 'AI 请求')}</b><small>${escapeHtml(request.provider || 'API')} · ${escapeHtml(request.phase || '')}</small></span><em>第 ${index + 1} 次 · ${escapeHtml(request.requestChars || request.bodyChars || 0)} 字符</em></summary><div class="quick-dock-request-row-body">${content}</div></details>`;
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
        const requestContent = requests.length ? requests.map((request, index) => renderRequestEntry(request, operation, index, requests.length)).join('') : '<p class="quick-dock-operation-muted">本次操作没有发送模型请求，或属于本地操作。</p>';
        const body = `
            <section class="quick-dock-operation-detail-head" data-operation-status="${escapeHtml(meta.className)}">
                <div><b>${escapeHtml(meta.label)}</b><span>${escapeHtml(formatDuration(operationDuration(operation)))}</span></div>
                <p>${escapeHtml(operationResultText(operation))}</p>
            </section>
            <div class="quick-dock-fold-list">
                ${fold('执行阶段', `${steps.length} 条`, stepContent, true)}
                ${fold('模型请求', `${requests.length} 次实际网络调用`, requestContent, true)}
                ${fold('后台工作', `${escapeHtml(operation?.background?.total || 0)} 项`, renderChildOperationList(operation))}
                ${fold('写入结果', `${escapeHtml(operation?.mutationSummary?.total || 0)} 项`, renderOperationMutations(operation), true, 'quick-dock-mutation-section')}
                ${operation.error ? fold('错误信息', '', `<pre class="quick-dock-result-pre">${escapeHtml(operation.error.message || '操作失败')}</pre>`, true) : ''}
            </div>` ;
        renderPanelShell(`${operation.icon || '✨'} ${operation.title}`, `${operation.category || '其他'} · ${formatOperationTime(operation.createdAt)}`, body, operation);
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
        else if (state.panel === 'operation') renderOperationDetail();
        else renderMain();
    }

    async function runAction(action, trigger) {
        if (action === 'close') { state.open = false; state.panel = 'main'; render(); return; }
        if (action === 'main') { state.panel = 'main'; state.selectedOperationId = null; render(); return; }
        if (action === 'open-console') { state.panel = 'console'; render(); return; }
        if (action === 'show-more-history') { state.historyVisible = Math.min(20, state.historyVisible + 6); render(); return; }
        if (action === 'open-operation') {
            state.selectedOperationId = trigger?.dataset?.operationId || getOperationRuntime()?.getCurrent?.()?.id || null;
            state.panel = 'operation';
            render();
            return;
        }
        if (action === 'clear-operations') {
            getOperationRuntime()?.clear?.({ keepActive: true });
            state.selectedOperationId = null;
            render();
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
        rootEl.innerHTML = `<section class="quick-dock-panel" hidden></section><button type="button" class="quick-dock-ball" aria-label="快捷悬浮球" aria-expanded="false"><span>AI</span><small>v${PACKAGE_VERSION}</small></button>`;
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
