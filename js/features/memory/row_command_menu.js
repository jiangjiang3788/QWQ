(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;

    let outsideHandler = null;
    let escapeHandler = null;

    const COMMANDS = Object.freeze([
        ['open-row-inspector', '关联与标签'],
        ['edit-row-effect-policy', '高级使用策略'],
        ['edit-row-reliability', '来源与时效'],
        ['toggle-row-pin', '固定 / 取消固定'],
        ['toggle-row-effect-pause', '暂停 / 恢复使用'],
        ['move-row-up', '上移'],
        ['move-row-down', '下移'],
        ['delete-row', '删除']
    ]);

    function close(root = document) {
        root.querySelectorAll?.('.memory-row-command-popover').forEach(item => item.remove());
        if (outsideHandler) document.removeEventListener('pointerdown', outsideHandler, true);
        if (escapeHandler) document.removeEventListener('keydown', escapeHandler, true);
        outsideHandler = null;
        escapeHandler = null;
    }

    function open(anchor, config = {}) {
        if (!anchor) return null;
        const root = anchor.closest('#memory-table-content') || anchor.closest('#memory-table-screen') || document.body;
        close(root);
        const commands = COMMANDS.map(([action, label]) => [action, label]);
        const menu = document.createElement('div');
        menu.className = 'memory-row-command-popover';
        menu.setAttribute('role', 'menu');
        menu.innerHTML = commands.map(([action, label]) => `<button type="button" role="menuitem" data-action="${Core.escapeAttribute(action)}" data-template-id="${Core.escapeAttribute(config.templateId || '')}" data-table-id="${Core.escapeAttribute(config.tableId || '')}" data-row-id="${Core.escapeAttribute(config.rowId || '')}" class="${action === 'delete-row' ? 'is-danger' : ''}">${Core.escapeHtml(label)}</button>`).join('');
        root.appendChild(menu);
        const rect = anchor.getBoundingClientRect();
        const width = 174;
        const left = Math.max(8, Math.min(global.innerWidth - width - 8, rect.right - width));
        const estimatedHeight = Math.min(360, commands.length * 38 + 12);
        const top = rect.bottom + estimatedHeight > global.innerHeight - 8
            ? Math.max(8, rect.top - estimatedHeight)
            : rect.bottom + 5;
        Object.assign(menu.style, { left: `${left}px`, top: `${top}px`, width: `${width}px` });
        outsideHandler = event => {
            if (!menu.contains(event.target) && !anchor.contains(event.target)) close(root);
        };
        escapeHandler = event => {
            if (event.key === 'Escape') {
                close(root);
                anchor.focus?.();
            }
        };
        setTimeout(() => {
            document.addEventListener('pointerdown', outsideHandler, true);
            document.addEventListener('keydown', escapeHandler, true);
        }, 0);
        return menu;
    }

    Kernel.register('rowCommandMenu', Object.freeze({ VERSION: '2.12-R0', COMMANDS, open, close }));
})(window);
