(function (global) {
    'use strict';

    const VERSION = '2.9-R6';
    const recentErrors = [];
    const MAX_ERRORS = 20;

    function pushError(type, value) {
        const message = value instanceof Error ? (value.stack || value.message) : String(value || '未知错误');
        recentErrors.push({ type, message: message.slice(0, 2000), at: new Date().toISOString() });
        if (recentErrors.length > MAX_ERRORS) recentErrors.splice(0, recentErrors.length - MAX_ERRORS);
    }

    global.addEventListener('error', event => pushError('error', event.error || event.message));
    global.addEventListener('unhandledrejection', event => pushError('unhandledrejection', event.reason));

    function safeCall(fn, fallback) {
        try { return typeof fn === 'function' ? fn() : fallback; }
        catch (error) { return { ok: false, error: error.message || String(error) }; }
    }

    function currentCharacter() {
        if (!global.db || !Array.isArray(global.db.characters) || global.currentChatType !== 'private') return null;
        const character = global.db.characters.find(item => item.id === global.currentChatId);
        return character ? { id: character.id, name: character.remarkName || character.realName || '未命名角色', memoryMode: character.memoryMode || 'journal' } : null;
    }

    function memorySummary(character) {
        if (!character) return null;
        const workspace = global.OvoMemoryKernel?.get?.('workspace');
        const templates = (global.db?.memoryTableTemplates || []).filter(template => character.memoryTables?.boundTemplateIds?.includes(template.id));
        const counts = safeCall(() => workspace?.getCounts?.(character, templates), null);
        return {
            boundTemplates: templates.length,
            historyMessages: Array.isArray(character.history) ? character.history.length : 0,
            workspace: character.memoryTables?.workspace || 'memory',
            workspaceView: character.memoryTables?.workspaceView || 'tables',
            counts
        };
    }

    function snapshot() {
        const character = currentCharacter();
        return {
            generatedAt: new Date().toISOString(),
            release: VERSION,
            appVersion: typeof global.appVersion === 'string' ? global.appVersion : null,
            route: safeCall(() => global.OvoNavigation?.snapshot?.(), { current: document.querySelector('.screen.active')?.id || null, stack: [] }),
            data: {
                characters: Array.isArray(global.db?.characters) ? global.db.characters.length : 0,
                groups: Array.isArray(global.db?.groups) ? global.db.groups.length : 0,
                memoryTemplates: Array.isArray(global.db?.memoryTableTemplates) ? global.db.memoryTableTemplates.length : 0
            },
            currentCharacter: character,
            memory: memorySummary(character),
            health: {
                memory: safeCall(() => global.OvoMemory?.health?.(), { ok: false, reason: 'not-loaded' }),
                settings: safeCall(() => global.OvoSettings?.health?.(), { ok: false, reason: 'not-loaded' }),
                characterSettings: safeCall(() => global.OvoCharacterSettings?.health?.(), { ok: false, reason: 'not-loaded' })
            },
            recentErrors: recentErrors.slice(-10)
        };
    }

    function report() {
        return JSON.stringify(snapshot(), null, 2);
    }

    function log() {
        const data = snapshot();
        console.group('[章鱼机诊断]');
        console.log(data);
        console.groupEnd();
        return data;
    }

    function ensureDialog() {
        let dialog = document.getElementById('ovo-diagnostics-dialog');
        if (dialog) return dialog;
        dialog = document.createElement('dialog');
        dialog.id = 'ovo-diagnostics-dialog';
        dialog.className = 'ovo-diagnostics-dialog';
        dialog.innerHTML = `
            <div class="ovo-diagnostics-head"><strong>运行诊断</strong><button type="button" data-diagnostics-close aria-label="关闭">×</button></div>
            <div class="ovo-diagnostics-summary" data-diagnostics-summary></div>
            <pre data-diagnostics-output></pre>
            <div class="ovo-diagnostics-actions"><button type="button" class="btn btn-secondary" data-diagnostics-copy>复制报告</button><button type="button" class="btn btn-primary" data-diagnostics-refresh>刷新</button></div>`;
        document.body.appendChild(dialog);
        dialog.addEventListener('click', async event => {
            if (event.target === dialog || event.target.closest('[data-diagnostics-close]')) {
                dialog.close();
                return;
            }
            if (event.target.closest('[data-diagnostics-refresh]')) renderDialog(dialog);
            if (event.target.closest('[data-diagnostics-copy]')) {
                const text = report();
                try {
                    await navigator.clipboard.writeText(text);
                    global.showToast?.('诊断报告已复制');
                } catch (_) {
                    global.prompt('复制诊断报告', text);
                }
            }
        });
        return dialog;
    }

    function renderDialog(dialog) {
        const data = snapshot();
        const ok = Object.values(data.health).every(item => item && item.ok !== false);
        const summary = dialog.querySelector('[data-diagnostics-summary]');
        const output = dialog.querySelector('[data-diagnostics-output]');
        if (summary) summary.innerHTML = `<strong>${ok ? '核心模块正常' : '发现需要检查的模块'}</strong><span>当前页面：${data.route?.current || '未知'} · 角色：${data.currentCharacter?.name || '未选择'} · 错误：${data.recentErrors.length}</span>`;
        if (output) output.textContent = JSON.stringify(data, null, 2);
    }

    function open() {
        const dialog = ensureDialog();
        renderDialog(dialog);
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
    }

    global.OvoDiagnostics = Object.freeze({ VERSION, snapshot, report, log, open, errors: () => recentErrors.map(item => ({ ...item })) });
})(window);
