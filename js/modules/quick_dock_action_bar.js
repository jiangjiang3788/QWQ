// QuickDock action rail · V2.12-R2
(() => {
    'use strict';

    const VERSION = '2.12-R2';
    const ACTIONS = Object.freeze([
        { action: 'main', label: '操作', hint: '状态与历史', panel: 'main' },
        { action: 'open-operation', label: '详情', hint: '阶段与请求', panel: 'operation', needsOperation: true },
        { action: 'open-proment-full', label: 'Proment', hint: 'Prompt 与记忆' },
        { action: 'open-console', label: '日志', hint: '错误排查', panel: 'console' },
        { action: 'open-coverage', label: '覆盖', hint: '能力核验', panel: 'coverage' },
        { action: 'git-upload', label: 'Git 上传', hint: '同步当前数据' },
        { action: 'git-restore', label: 'Git 恢复', hint: '下载并恢复' },
        { action: 'open-git-settings', label: 'Git 设置', hint: '仓库与 Token' }
    ]);

    const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));

    function renderAction(action, context) {
        const disabled = action.needsOperation && !context.operationId;
        const selected = action.panel && action.panel === context.activePanel;
        const operationAttr = action.action === 'open-operation' && context.operationId
            ? ` data-operation-id="${escapeHtml(context.operationId)}"`
            : '';
        return `<button type="button" class="quick-dock-top-action" data-qd-action="${escapeHtml(action.action)}"${operationAttr}${disabled ? ' disabled' : ''}${selected ? ' aria-current="page"' : ''}>
            <b>${escapeHtml(action.label)}</b><small>${escapeHtml(disabled ? '暂无记录' : action.hint)}</small>
        </button>`;
    }

    function render(context = {}) {
        const api = context.api || {};
        const currentModel = api.model || '未选择模型';
        return `<section class="quick-dock-action-hub" data-quick-dock-action-hub>
            <div class="quick-dock-model-control">
                <label for="quick-dock-top-model-select"><span>当前模型</span><small>${escapeHtml(api.provider || 'API')}</small></label>
                <select id="quick-dock-top-model-select" aria-label="当前模型"><option value="${escapeHtml(currentModel)}">${escapeHtml(currentModel)}</option></select>
                <button type="button" data-qd-action="refresh-models">刷新</button>
                <button type="button" data-qd-action="switch-api">应用</button>
            </div>
            <nav class="quick-dock-top-actions" aria-label="AI 操作中心主操作">
                ${ACTIONS.map(action => renderAction(action, context)).join('')}
            </nav>
        </section>`;
    }

    window.QuickDockActionBar = Object.freeze({ VERSION, ACTIONS, render });
})();
