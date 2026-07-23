(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const TableEditor = Kernel.require('tableEditor');
    const TableSession = Kernel.require('tableSession');

    const ACTIONS = new Set(['undo-table-edit', 'add-row', 'delete-row', 'move-row-up', 'move-row-down']);

    function resolveTable(context, element) {
        const template = (context.templates || []).find(item => item.id === element.dataset.templateId);
        const table = template?.tables?.find(item => item.id === element.dataset.tableId);
        return { template, table };
    }

    async function handleAction(action, element, context = {}) {
        if (!ACTIONS.has(action)) return false;
        const chat = context.getChat?.();
        if (!chat) return true;
        if (action === 'undo-table-edit') {
            const result = await TableEditor.undoLast({
                chat,
                templates: context.getBoundTemplates?.(chat) || context.templates || [],
                writer: context.save,
                root: context.gridRoot?.()
            });
            if (result.changed) context.refreshGrid?.();
            return true;
        }
        const { template, table } = resolveTable(context, element);
        if (!template || !table) return true;
        if (action === 'add-row') {
            const row = await TableEditor.addRow({ chat, template, table, writer: context.save });
            TableSession.setEditingRow(context.state, row?.id || null);
            context.render?.();
            return true;
        }
        if (action === 'delete-row') {
            if (!(context.confirm || global.confirm)?.('确定删除这一行吗？')) return true;
            const rowId = element.dataset.rowId;
            await TableEditor.deleteRow({ chat, template, table, rowId, writer: context.save });
            if (context.state?.selectedRowId === rowId) Object.assign(context.state, {
                inspectorOpen: false,
                selectedRowId: null,
                inspectorAnalysis: null
            });
            context.render?.();
            return true;
        }
        await TableEditor.moveRow({
            chat,
            template,
            table,
            rowId: element.dataset.rowId,
            delta: action === 'move-row-up' ? -1 : 1,
            writer: context.save
        });
        context.refreshGrid?.();
        return true;
    }

    async function handleFieldInput(target, context = {}) {
        if (!target?.matches?.('.memory-table-input')) return false;
        const chat = context.getChat?.();
        if (!chat) return true;
        const { template, table } = resolveTable(context, target);
        const field = table?.columns?.find(item => item.id === target.dataset.fieldId);
        if (!template || !table || !field) return true;
        await TableEditor.commitField({
            chat,
            template,
            table,
            field,
            rowId: target.dataset.rowId || '',
            rawValue: target.type === 'checkbox' ? target.checked : target.value,
            writer: context.save,
            root: context.gridRoot?.(),
            target
        });
        return true;
    }


    async function handleTagInput(target, context = {}) {
        if (!target?.matches?.('.memory-table-tag-input')) return false;
        const chat = context.getChat?.();
        if (!chat) return true;
        const rowElement = target.closest('[data-memory-row-id]');
        const template = (context.templates || []).find(item => item.id === rowElement?.dataset.templateId);
        const table = template?.tables?.find(item => item.id === rowElement?.dataset.tableId);
        const rowId = rowElement?.dataset.rowId || '';
        if (!template || !table || !rowId) return true;
        await TableEditor.commitTagDimension({
            chat,
            template,
            table,
            rowId,
            dimension: target.dataset.tagDimension || '',
            rawValue: target.value,
            writer: context.save,
            root: context.gridRoot?.(),
            target
        });
        return true;
    }

    Kernel.register('tableEditController', Object.freeze({
        VERSION: '2.11-R7',
        ACTIONS,
        handleAction,
        handleFieldInput,
        handleTagInput
    }));
})(window);
