// QuickDock · V2.10-R3.1 快速修复：时间元数据、即时渲染与档案记忆上下文。
(() => {
    'use strict';

    const STORAGE_KEY = 'ovo_quick_dock_v2';
    const state = { open: false, panel: 'main', x: null, y: null, status: '', selectedOperationId: null };
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

    function renderPromptSourceItems(section) {
        const items = Array.isArray(section?.items) ? section.items : [];
        if (!items.length) return '';
        return `<div class="quick-dock-source-items-flat">${items.map(item => `
            <article class="quick-dock-source-item-flat ${item.sent === false ? 'is-excluded' : ''}">
                <div class="quick-dock-source-item-head">
                    <b>${escapeHtml(item.title || '来源条目')}</b>
                    <span>${item.sent === false ? '未发送' : escapeHtml(formatSourceChars(item.chars))}</span>
                </div>
                ${item.reason ? `<p>${escapeHtml(item.reason)}</p>` : ''}
                ${item.content ? `<div class="quick-dock-source-item-content">${escapeHtml(item.content)}</div>` : '<p>本条没有进入最终请求，因此不保留正文。</p>'}
            </article>`).join('')}</div>`;
    }

    function renderPromptTrace(request) {
        const trace = request?.promptTrace;
        const sections = Array.isArray(trace?.sections) ? trace.sections : [];
        if (!sections.length) return '<p class="quick-dock-operation-muted">当前请求还没有可解释的来源记录，可继续查看下方原始请求。</p>';

        const sourceSections = sections.filter(section => !section?.metadata?.verificationView);
        const verificationSections = sections.filter(section => section?.metadata?.verificationView);
        const groups = Array.isArray(trace?.summary?.byType) ? trace.summary.byType : [];

        const renderSection = section => {
            const meta = promptSourceMeta(section.type);
            const status = section.sent === false
                ? '未发送'
                : (['request_exact', 'inferred_exact', 'source_exact'].includes(section.traceMode)
                    ? '实际发送'
                    : (section.traceMode === 'source_verified' ? '已核对' : '参与组装'));
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
                    ${section.clipped ? '<p class="quick-dock-truncation-note">该来源超过 6 万字符，操作记录中仅保留前 6 万字符；最终原始请求仍可在下方核对。</p>' : ''}
                </div>
            </details>`;
        };

        return `
            <div class="quick-dock-prompt-overview">
                <div class="quick-dock-prompt-overview-head"><b>发送内容来源（同一次请求）</b><span>${sourceSections.filter(section => section.sent !== false).length} 类已发送</span></div>
                <div class="quick-dock-source-chips">
                    ${groups.map(group => { const meta = promptSourceMeta(group.type); return `<span>${escapeHtml(meta.icon)} ${escapeHtml(group.title || meta.title)} · ${escapeHtml(group.count || group.sections || 0)}</span>`; }).join('')}
                </div>
                <p>下面的“分条来源”和“最终合并结果”是同一次网络调用的两种查看方式，不会向模型发送两次。</p>
            </div>
            <div class="quick-dock-source-list">
                ${sourceSections.map(renderSection).join('')}
            </div>
            ${verificationSections.length ? `<details class="quick-dock-verification-card">
                <summary><b>查看最终合并结果</b><span>核对视图 · 不是第二次发送</span></summary>
                ${verificationSections.map(section => `<div class="quick-dock-verification-content">${escapeHtml(section.content || '')}</div>`).join('')}
            </details>` : ''}`;
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

    function renderOperationMutations(operation) {
        const entries = collectOperationMutations(operation);
        if (!entries.length) return '<p class="quick-dock-operation-muted">本次操作没有记录到持久化数据变化。只读检查和未达到条件的后台任务不会产生变化。</p>';
        return `<div class="quick-dock-mutation-list">${entries.slice(0, 100).map(({ mutation, operation: owner }) => {
            const action = mutationActionMeta(mutation.action);
            const entity = mutationEntityMeta(mutation.entityType);
            const hasDiff = mutation.before || mutation.after || (Array.isArray(mutation.fields) && mutation.fields.length);
            return `<article class="quick-dock-mutation-item" data-mutation-action="${escapeHtml(action.className)}">
                <div class="quick-dock-mutation-head">
                    <span class="quick-dock-mutation-icon">${escapeHtml(entity.icon)}</span>
                    <span><b>${escapeHtml(mutation.title || entity.label)}</b><small>${escapeHtml(entity.label)} · ${escapeHtml(owner.title || '当前操作')}</small></span>
                    <em>${escapeHtml(action.label)}${Number(mutation.count) > 1 ? ` × ${escapeHtml(mutation.count)}` : ''}</em>
                </div>
                ${mutation.summary ? `<p>${escapeHtml(mutation.summary)}</p>` : ''}
                <div class="quick-dock-mutation-meta"><span>${escapeHtml(formatOperationTime(mutation.at))}</span>${mutation.entityId ? `<span>ID：${escapeHtml(mutation.entityId)}</span>` : ''}</div>
                ${hasDiff ? `<details class="quick-dock-mutation-diff"><summary>查看写入内容${mutation.before && mutation.after ? '与前后变化' : ''}</summary>
                    ${mutation.before ? `<div><b>修改前</b><pre>${escapeHtml(mutation.before)}</pre></div>` : ''}
                    ${mutation.after ? `<div><b>${mutation.before ? '修改后' : '写入内容'}</b><pre>${escapeHtml(mutation.after)}</pre></div>` : ''}
                    ${Array.isArray(mutation.fields) && mutation.fields.length ? `<p>涉及字段：${escapeHtml(mutation.fields.join('、'))}</p>` : ''}
                </details>` : ''}
            </article>`;
        }).join('')}${entries.length > 100 ? `<p class="quick-dock-truncation-note">本次变化超过 100 条，界面只展示最近 100 条；操作摘要仍保留总数。</p>` : ''}</div>`;
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
        const runtime = getOperationRuntime();
        const operations = runtime?.list?.({ limit: 8, rootsOnly: true }) || [];
        const active = operations.filter(item => item.status === 'running' || item.status === 'queued');
        const current = active[0] || operations[0] || null;
        const history = current ? operations.filter(item => item.id !== current.id).slice(0, 5) : operations.slice(0, 5);
        const currentApi = getCurrentApi();
        panelEl.innerHTML = `
            <header class="quick-dock-panel-header">
                <div><strong>AI 操作中心</strong><span>V2.10-R3.1 · ${active.length ? `${active.length} 项主操作正在进行` : '当前没有运行中的主操作'}</span></div>
                <button type="button" class="quick-dock-icon-btn" data-qd-action="close" aria-label="关闭">×</button>
            </header>
            <section class="quick-dock-operation-current">
                <div class="quick-dock-section-title"><b>${active.length ? '当前操作' : '最近一次操作'}</b><small>${escapeHtml(currentApi.provider)} · ${escapeHtml(currentApi.model)}</small></div>
                ${renderOperationCard(current)}
            </section>
            <section class="quick-dock-operation-history">
                <div class="quick-dock-section-title"><b>最近操作</b>${operations.length ? '<button type="button" class="quick-dock-clear-history" data-qd-action="clear-operations">清除已完成</button>' : ''}</div>
                <div class="quick-dock-operation-list">
                    ${history.length ? history.map(item => renderOperationCard(item, { compact: true })).join('') : '<p class="quick-dock-operation-muted">完成更多操作后会显示在这里。</p>'}
                </div>
            </section>
            <div class="quick-dock-grid quick-dock-grid--primary quick-dock-operation-tools">
                <button type="button" data-qd-action="open-tools"><b>API 与 Git</b><small>模型切换和数据同步</small></button>
                <button type="button" data-qd-action="open-proment"><b>Proment</b><small>Prompt 与记忆状态</small></button>
                <button type="button" data-qd-action="open-console"><b>开发日志</b><small>错误排查和复制</small></button>
                ${current ? `<button type="button" data-qd-action="open-operation" data-operation-id="${escapeHtml(current.id)}"><b>操作详情</b><small>阶段、数据变化与请求</small></button>` : '<button type="button" disabled><b>操作详情</b><small>暂无可查看记录</small></button>'}
            </div>
            <p class="quick-dock-status">主操作完成后仍会持续汇总自动日记、结构化记忆、向量记忆和角色小剧场等后台工作。</p>`;
    }

    function renderTools() {
        const current = getCurrentApi();
        const config = normalizeCurrentApiConfig();
        const apiLabel = config.url ? `${current.provider} · ${config.url}` : `${current.provider} · 未配置地址`;
        panelEl.innerHTML = `
            <header class="quick-dock-panel-header">
                <div><strong>API 与数据工具</strong><span>${escapeHtml(current.provider)} · ${escapeHtml(current.model)}</span></div>
                <button type="button" class="quick-dock-icon-btn" data-qd-action="main" aria-label="返回">‹</button>
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
                <button type="button" data-qd-action="git-upload"><b>Git 上传</b><small>同步当前精简数据</small></button>
                <button type="button" data-qd-action="git-restore"><b>Git 下载</b><small>下载最新备份并恢复</small></button>
                <button type="button" data-qd-action="open-git-settings"><b>Git 设置</b><small>仓库、分支和 Token</small></button>
                <button type="button" data-qd-action="main"><b>返回操作中心</b><small>查看当前进度</small></button>
            </div>
            <p class="quick-dock-git-status"><b>Git 状态：</b>${escapeHtml(formatGitStatus())}</p>
            <p class="quick-dock-status">${escapeHtml(state.status || '点击“拉取”读取当前 API 的模型列表。')}</p>`;
        setTimeout(() => refreshModelSelect(false), 0);
    }

    function renderOperationDetail() {
        const runtime = getOperationRuntime();
        const operation = runtime?.get?.(state.selectedOperationId) || runtime?.getCurrent?.() || null;
        if (!operation) {
            state.panel = 'main';
            renderMain();
            return;
        }
        state.selectedOperationId = operation.id;
        const meta = operationStatusMeta(operation.status);
        const steps = Array.isArray(operation.steps) ? operation.steps : [];
        const requests = Array.isArray(operation.requests) ? operation.requests : [];
        const resultText = operation.result ? JSON.stringify(operation.result, null, 2) : '';
        panelEl.innerHTML = `
            <header class="quick-dock-panel-header">
                <div><strong>${escapeHtml(operation.icon || '✨')} ${escapeHtml(operation.title)}</strong><span>${escapeHtml(operation.category || '其他')} · ${escapeHtml(formatOperationTime(operation.createdAt))}</span></div>
                <div class="quick-dock-header-actions">
                    <button type="button" class="quick-dock-icon-btn quick-dock-fullscreen-btn" data-qd-action="toggle-detail-fullscreen" aria-label="切换大窗口">⛶</button>
                    <button type="button" class="quick-dock-icon-btn" data-qd-action="main" aria-label="返回">‹</button>
                </div>
            </header>
            <section class="quick-dock-operation-detail-head" data-operation-status="${escapeHtml(meta.className)}">
                <div><b>${escapeHtml(meta.label)}</b><span>${escapeHtml(formatDuration(operationDuration(operation)))}</span></div>
                <p>${escapeHtml(operationResultText(operation))}</p>
                ${(operation.status === 'running' || operation.status === 'queued') ? `<button type="button" data-qd-action="cancel-operation" data-operation-id="${escapeHtml(operation.id)}">取消本次操作</button>` : ''}
            </section>
            <section class="quick-dock-detail-section">
                <h4>执行阶段</h4>
                <div class="quick-dock-step-list">
                    ${steps.length ? steps.map(step => `<div class="quick-dock-step" data-step-status="${escapeHtml(step.status || '')}"><i></i><span><b>${escapeHtml(step.title || '处理')}</b>${step.detail ? `<small>${escapeHtml(step.detail)}</small>` : ''}</span><time>${escapeHtml(formatOperationTime(step.at))}</time></div>`).join('') : '<p class="quick-dock-operation-muted">暂无阶段记录</p>'}
                </div>
            </section>
            <section class="quick-dock-detail-section">
                <h4>后台工作 <small>${escapeHtml(operation?.background?.total || 0)} 项</small></h4>
                ${renderChildOperationList(operation)}
            </section>
            <section class="quick-dock-detail-section quick-dock-mutation-section">
                <h4>数据变化 <small>${escapeHtml(operation?.mutationSummary?.total || 0)} 项${operation?.mutationSummary?.descendant ? ` · 含后台 ${escapeHtml(operation.mutationSummary.descendant)} 项` : ''}</small></h4>
                ${renderOperationMutations(operation)}
            </section>
            <section class="quick-dock-detail-section quick-dock-request-section">
                <h4>模型请求（实际网络调用） <small>${requests.length} 次</small></h4>
                ${requests.length ? requests.map((request, index) => `
                    <article class="quick-dock-request-card is-flat">
                        <div class="quick-dock-request-head">
                            <span><b>${escapeHtml(request.model || request.task || 'AI 请求')}</b><small>${escapeHtml(request.provider || 'API')} · ${escapeHtml(request.phase || '')}</small></span>
                            <em>第 ${index + 1} 次 · ${escapeHtml(request.requestChars || request.bodyChars || 0)} 字符</em>
                        </div>
                        <div class="quick-dock-request-meta"><span>来源：${escapeHtml(request.source || '未标记')}</span><span>消息：${escapeHtml(request.messageCount || 0)} 条</span><span>耗时：${escapeHtml(formatDuration(request.durationMs))}</span></div>
                        ${request.errorMessage ? `<p class="quick-dock-request-error">${escapeHtml(request.errorMessage)}</p>` : ''}
                        ${renderPromptTrace(request)}
                        ${request.bodyPreview ? `<details class="quick-dock-raw-request"><summary>查看最终原始请求${request.bodyTruncated ? '（操作记录超过 12 万字符，已截断）' : ''}</summary><pre>${escapeHtml(request.bodyPreview)}</pre></details>` : '<p class="quick-dock-operation-muted">该历史记录未保留请求正文。</p>'}
                    </article>`).join('') : '<p class="quick-dock-operation-muted">本次操作尚未发送模型请求，或属于本地操作。</p>'}
            </section>
            ${(resultText || operation.error) ? `<section class="quick-dock-detail-section"><h4>${operation.error ? '错误信息' : '结果反馈'}</h4><pre class="quick-dock-result-pre">${escapeHtml(operation.error ? (operation.error.message || JSON.stringify(operation.error, null, 2)) : resultText)}</pre></section>` : ''}
            <button type="button" class="quick-dock-text-link" data-qd-action="copy-operation" data-operation-id="${escapeHtml(operation.id)}">复制本次操作报告</button>`;
    }


    function renderPromentStatus() {
        const char = (db.characters || []).find(item => item.id === window.currentChatId) || (db.characters || [])[0] || null;
        const policy = Object.assign({ worldBookEnabled: true, structuredEnabled: true }, db.magicRoom?.contextPolicy || {});
        const vectorPolicy = char?.vectorMemory?.injectionPolicy || { budget: 2600, priority: 40 };
        const memoryModeLabel = char?.memoryMode === 'table'
            ? '结构化档案'
            : (char?.memoryMode === 'vector' ? '向量记忆' : '回忆日记');
        panelEl.innerHTML = `
            <header class="quick-dock-panel-header">
                <div><strong>Proment 状态</strong><span>R3 · 与操作来源、后台回执和数据变化互通</span></div>
                <button type="button" class="quick-dock-icon-btn" data-qd-action="main" aria-label="返回">‹</button>
            </header>
            <div class="quick-dock-section quick-dock-proment-status">
                <p><b>当前角色</b><span>${escapeHtml(char ? (char.remarkName || char.name || '未命名') : '暂无角色')}</span></p>
                <p><b>世界书</b><span>${policy.worldBookEnabled ? `开启 · 预算 ${policy.worldBookBudget || 2400}` : '关闭'}</span></p>
                <p><b>长期记忆模式</b><span>当前使用：${memoryModeLabel}（三选一）</span></p>
                <p><b>档案设计预览</b><span>${policy.structuredEnabled ? `显示 · 预算 ${policy.structuredBudget || 1800}` : '隐藏'}，不控制真实聊天</span></p>
                <p><b>向量记忆设置</b><span>独立管理 · 预算 ${vectorPolicy.budget || 2600}</span></p>
                <p><b>最近聊天</b><span>${policy.historyEnabled === false ? '关闭' : `${policy.historyCount || 30} 条`}</span></p>
            </div>
            <button type="button" class="quick-dock-primary-wide" data-qd-action="open-proment-full">打开完整 Proment</button>
            <p class="quick-dock-status">操作详情显示本次真实来源；完整 Proment 继续负责 Prompt 与记忆的深度查看。</p>`;
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
        if (state.panel !== 'operation') panelEl.classList.remove('quick-dock-panel--detail-fullscreen');
        if (!state.open) return;
        refreshOperationBall();
        if (state.panel === 'console') renderConsole();
        else if (state.panel === 'proment') renderPromentStatus();
        else if (state.panel === 'tools') renderTools();
        else if (state.panel === 'operation') renderOperationDetail();
        else renderMain();
    }

    async function runAction(action, trigger) {
        if (action === 'close') { state.open = false; state.panel = 'main'; render(); return; }
        if (action === 'main') { state.panel = 'main'; state.selectedOperationId = null; render(); return; }
        if (action === 'open-console') { state.panel = 'console'; render(); return; }
        if (action === 'open-tools') { state.panel = 'tools'; render(); return; }
        if (action === 'toggle-detail-fullscreen') {
            panelEl.classList.toggle('quick-dock-panel--detail-fullscreen');
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
        if (action === 'copy-operation') {
            const operationId = trigger?.dataset?.operationId || state.selectedOperationId;
            const operation = getOperationRuntime()?.get?.(operationId);
            if (operation) {
                const text = JSON.stringify(operation, null, 2);
                try { await navigator.clipboard.writeText(text); }
                catch (_) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
                toast('本次操作报告已复制');
            }
            return;
        }
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
            if (state.panel === 'main' || state.panel === 'tools') render();
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
