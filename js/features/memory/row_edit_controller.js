(function (global) {
    'use strict';
    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Domain = Kernel.require('domain');
    const Modal = Kernel.require('rowEditModal');
    const TableEditor = Kernel.require('tableEditor');
    let active = null;
    let bound = false;

    function resizeTextarea(textarea) {
        if (!textarea?.matches?.('[data-row-edit-autogrow]')) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.max(76, textarea.scrollHeight || 0)}px`;
    }

    function resizeAll(root) {
        root?.querySelectorAll?.('textarea[data-row-edit-autogrow]').forEach(resizeTextarea);
    }

    function resolve(descriptor, context) {
        const chat = context.getChat?.();
        const templates = context.getTemplates?.(chat) || context.templates || [];
        const template = templates.find(item => item.id === descriptor.templateId);
        const table = template?.tables?.find(item => item.id === descriptor.tableId);
        if (!chat || !template || !table) return null;
        if (descriptor.kind === 'row') {
            const row = Domain.findRowById(chat, template.id, table, descriptor.rowId);
            return row ? { chat, template, table, row, field: null } : null;
        }
        const field = (table.columns || []).find(item => item.id === descriptor.fieldId);
        return field ? { chat, template, table, row: null, field } : null;
    }

    function close() {
        document.getElementById('memory-row-edit-modal')?.classList.remove('visible');
        active = null;
    }

    function open(descriptor, context = {}) {
        const resolved = resolve(descriptor, context);
        if (!resolved) {
            context.toast?.('没有找到要编辑的记忆');
            return false;
        }
        active = { ...resolved, context };
        const view = Modal.render(resolved);
        const modal = document.getElementById('memory-row-edit-modal');
        const title = document.getElementById('memory-row-edit-title');
        const body = document.getElementById('memory-row-edit-body');
        if (!modal || !title || !body) return false;
        title.textContent = view.title;
        body.innerHTML = view.html;
        modal.classList.add('visible');
        requestAnimationFrame(() => {
            resizeAll(body);
            body.querySelector('textarea,input,select:not([disabled])')?.focus?.();
        });
        return true;
    }

    async function save() {
        if (!active) return false;
        const form = document.getElementById('memory-row-edit-form');
        const draft = Modal.collect(form);
        const saveButton = document.querySelector('[data-row-edit-action="save"]');
        if (saveButton) saveButton.disabled = true;
        try {
            const result = await TableEditor.commitRecord({
                chat: active.chat,
                template: active.template,
                table: active.table,
                rowId: active.row?.id || '',
                values: draft.values,
                tagBundle: active.row ? draft.tagBundle : null,
                writer: active.context.save,
                root: active.context.gridRoot?.()
            });
            close();
            active.context.refreshGrid?.();
            active.context.toast?.(result.changed ? `已保存整${active.row ? '行' : '项'}记忆` : '内容没有变化');
            return true;
        } catch (error) {
            active.context.showError?.(error);
            if (!active.context.showError) active.context.toast?.(`保存失败，已恢复原内容：${error.message || '未知错误'}`);
            return false;
        } finally {
            if (saveButton) saveButton.disabled = false;
        }
    }

    function bind(context = {}) {
        const modal = document.getElementById('memory-row-edit-modal');
        if (!modal || bound) return;
        bound = true;
        modal.addEventListener('click', event => {
            const action = event.target.closest('[data-row-edit-action]')?.dataset.rowEditAction;
            if (action === 'close') close();
            if (action === 'save') save();
            if (event.target === modal) close();
        });
        modal.addEventListener('input', event => resizeTextarea(event.target));
        modal.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                save();
            }
        });
        active ||= null;
        bind.context = context;
    }

    Kernel.register('rowEditController', Object.freeze({ VERSION: '2.13-R5.1', open, close, save, bind, resizeTextarea, resizeAll }));
})(window);
