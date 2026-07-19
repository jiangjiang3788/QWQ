(function (global) {
    'use strict';

    const VERSION = '2.9-R4';

    function element(tag, options) {
        const config = options || {};
        const node = document.createElement(tag);
        if (config.className) node.className = config.className;
        if (config.text != null) node.textContent = String(config.text);
        if (config.html != null) node.innerHTML = String(config.html);
        if (config.attrs) {
            Object.entries(config.attrs).forEach(([key, value]) => {
                if (value != null) node.setAttribute(key, String(value));
            });
        }
        if (config.dataset) {
            Object.entries(config.dataset).forEach(([key, value]) => {
                if (value != null) node.dataset[key] = String(value);
            });
        }
        return node;
    }

    function button(label, options) {
        const config = options || {};
        const node = element('button', {
            className: ['ui-button', config.variant ? `ui-button--${config.variant}` : '', config.className || ''].filter(Boolean).join(' '),
            text: label,
            attrs: { type: config.type || 'button', title: config.title || null }
        });
        if (typeof config.onClick === 'function') node.addEventListener('click', config.onClick);
        return node;
    }

    function emptyState(text) {
        return element('p', { className: 'ui-empty-state', text: text || '暂无内容' });
    }

    function closeOverlay(overlay) {
        const node = typeof overlay === 'string' ? document.getElementById(overlay) : overlay;
        if (!node) return false;
        node.classList.remove('is-open');
        node.style.display = 'none';
        node.setAttribute('aria-hidden', 'true');
        return true;
    }

    function openOverlay(overlay) {
        const node = typeof overlay === 'string' ? document.getElementById(overlay) : overlay;
        if (!node) return false;
        node.classList.add('ui-overlay', 'is-open');
        node.style.display = 'flex';
        node.setAttribute('aria-hidden', 'false');
        return true;
    }

    function renderActionList(list, items, options) {
        if (!list) return;
        const config = options || {};
        list.replaceChildren();
        if (!Array.isArray(items) || !items.length) {
            list.appendChild(emptyState(config.emptyText));
            return;
        }
        items.forEach((item, index) => {
            const row = element('div', { className: 'ui-action-row' });
            const copy = element('div', { className: 'ui-action-row__copy' });
            copy.appendChild(element('strong', { text: item.title || item.name || `项目 ${index + 1}` }));
            const detail = typeof config.describe === 'function' ? config.describe(item, index) : item.detail;
            if (detail) copy.appendChild(element('small', { text: detail }));
            row.appendChild(copy);

            const actions = element('div', { className: 'ui-action-row__actions' });
            (typeof config.actions === 'function' ? config.actions(item, index) : []).forEach(action => {
                actions.appendChild(button(action.label, {
                    variant: action.variant || 'secondary',
                    title: action.title,
                    onClick: action.onClick
                }));
            });
            row.appendChild(actions);
            list.appendChild(row);
        });
    }

    function bindOverlayDismiss(root) {
        const scope = root || document;
        scope.addEventListener('click', event => {
            const overlay = event.target.closest('.ui-overlay');
            if (overlay && event.target === overlay) closeOverlay(overlay);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => bindOverlayDismiss(document), { once: true });
    } else {
        bindOverlayDismiss(document);
    }

    global.OvoUI = Object.freeze({
        VERSION,
        element,
        button,
        emptyState,
        openOverlay,
        closeOverlay,
        renderActionList
    });
})(window);
