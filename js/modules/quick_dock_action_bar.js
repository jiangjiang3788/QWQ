// QuickDock action rail · V2.14
(() => {
    'use strict';

    const VERSION = '2.14';

    const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));

    function render(context = {}) {
        const api = context.api || {};
        const currentModel = api.model || '未选择模型';
        return `<section class="quick-dock-action-hub" data-quick-dock-action-hub>
            <div class="quick-dock-model-control">
                <label for="quick-dock-top-model-select"><span>模型</span><small>${escapeHtml(api.provider || 'API')}</small></label>
                <select id="quick-dock-top-model-select" aria-label="当前模型"><option value="${escapeHtml(currentModel)}">${escapeHtml(currentModel)}</option></select>
                <button type="button" data-qd-action="refresh-models">刷新</button>
                <button type="button" data-qd-action="switch-api">应用</button>
            </div>
            <div class="quick-dock-compact-tools">
                <button type="button" data-qd-action="open-console">日志</button>
                <details>
                    <summary>Git</summary>
                    <div>
                        <button type="button" data-qd-action="git-upload">上传</button>
                        <button type="button" data-qd-action="git-restore">恢复</button>
                        <button type="button" data-qd-action="open-git-settings">设置</button>
                    </div>
                </details>
            </div>
        </section>`;
    }

    window.QuickDockActionBar = Object.freeze({ VERSION, render });
})();
