(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const TableSession = Kernel.require('tableSession');
    const TableGrouping = Kernel.require('tableGrouping');

    const TARGET_SELECTOR = '[data-memory-edit-target]';
    const LONG_PRESS_MS = 480;
    const MOVE_TOLERANCE = 12;
    const bindings = new WeakMap();

    function closestTarget(node, root) {
        const target = node?.closest?.(TARGET_SELECTOR) || null;
        return target && root?.contains?.(target) ? target : null;
    }

    function isInteractive(node) {
        return !!node?.closest?.('button,a,input,textarea,select,summary,[contenteditable="true"],[role="menuitem"]');
    }

    function describe(target) {
        if (!target) return null;
        const kind = target.dataset.memoryEditKind;
        if (kind === 'field') {
            return {
                kind,
                templateId: target.dataset.templateId || '',
                tableId: target.dataset.tableId || '',
                fieldId: target.dataset.fieldId || '',
                fieldPath: TableGrouping.fieldPath(target.dataset.templateId, target.dataset.tableId, target.dataset.fieldId)
            };
        }
        if (kind === 'row') {
            return {
                kind,
                templateId: target.dataset.templateId || '',
                tableId: target.dataset.tableId || '',
                rowId: target.dataset.rowId || target.dataset.memoryRowId || ''
            };
        }
        return null;
    }

    function sameEditingTarget(state, descriptor) {
        if (!descriptor) return false;
        if (descriptor.kind === 'field') return state.editingFieldPath === descriptor.fieldPath;
        return state.editingRowId === descriptor.rowId;
    }

    function select(state, descriptor) {
        if (!descriptor) return false;
        if (descriptor.kind === 'field') {
            if (state.focusedFieldPath === descriptor.fieldPath && !state.focusedRowId) return false;
            TableSession.focusField(state, descriptor.fieldPath);
        } else {
            if (state.focusedRowId === descriptor.rowId && !state.focusedFieldPath) return false;
            TableSession.focusRow(state, descriptor.rowId);
        }
        return true;
    }

    function beginOrFinishEdit(state, descriptor) {
        if (!descriptor) return false;
        if (sameEditingTarget(state, descriptor)) {
            TableSession.finishEditing(state);
            return true;
        }
        if (descriptor.kind === 'field') TableSession.setEditingField(state, descriptor.fieldPath);
        else TableSession.setEditingRow(state, descriptor.rowId);
        return true;
    }

    function refresh(context, options = {}) {
        if (typeof context.refreshGrid === 'function') return context.refreshGrid(options);
        return context.render?.();
    }

    function clearPress(record) {
        if (!record) return;
        if (record.timer) global.clearTimeout(record.timer);
        record.target?.classList?.remove('is-memory-longpress-pending');
        record.timer = 0;
    }

    function bind(root, context = {}) {
        if (!root) return () => {};
        const old = bindings.get(root);
        if (old) {
            old.context = context;
            return old.unbind;
        }
        const record = { context, press: null, suppressClickUntil: 0 };

        const onPointerDown = event => {
            if (event.button !== undefined && event.button !== 0) return;
            if (isInteractive(event.target)) return;
            const target = closestTarget(event.target, root);
            const descriptor = describe(target);
            if (!descriptor) return;
            clearPress(record.press);
            record.press = {
                pointerId: event.pointerId,
                startX: Number(event.clientX) || 0,
                startY: Number(event.clientY) || 0,
                target,
                descriptor,
                timer: 0,
                fired: false
            };
            target.classList.add('is-memory-longpress-pending');
            record.press.timer = global.setTimeout(() => {
                const active = record.press;
                if (!active || active.target !== target) return;
                active.fired = true;
                target.classList.remove('is-memory-longpress-pending');
                target.classList.add('is-memory-longpress-fired');
                record.suppressClickUntil = Date.now() + 700;
                const state = TableSession.ensure(record.context.state);
                select(state, descriptor);
                beginOrFinishEdit(state, descriptor);
                try { global.navigator?.vibrate?.(12); } catch (_) {}
                refresh(record.context, { focusFirstEdit: true });
            }, LONG_PRESS_MS);
        };

        const onPointerMove = event => {
            const press = record.press;
            if (!press || press.pointerId !== event.pointerId || press.fired) return;
            const dx = (Number(event.clientX) || 0) - press.startX;
            const dy = (Number(event.clientY) || 0) - press.startY;
            if (Math.hypot(dx, dy) > MOVE_TOLERANCE) {
                clearPress(press);
                record.press = null;
            }
        };

        const onPointerEnd = event => {
            const press = record.press;
            if (!press || (event.pointerId !== undefined && press.pointerId !== event.pointerId)) return;
            clearPress(press);
            record.press = null;
        };

        const onClick = event => {
            if (Date.now() < record.suppressClickUntil) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (isInteractive(event.target)) return;
            const target = closestTarget(event.target, root);
            const descriptor = describe(target);
            if (!descriptor) return;
            const state = TableSession.ensure(record.context.state);
            const changed = select(state, descriptor);
            if (changed) refresh(record.context);
        };

        const onKeyDown = event => {
            const inputLike = event.target?.matches?.('input,textarea,select,[contenteditable="true"]');
            if (event.key === 'Escape' && (record.context.state?.editingRowId || record.context.state?.editingFieldPath)) {
                TableSession.finishEditing(record.context.state);
                refresh(record.context);
                event.preventDefault();
                return;
            }
            if (inputLike || event.key !== 'Enter') return;
            const target = closestTarget(event.target, root);
            const descriptor = describe(target);
            if (!descriptor) return;
            const state = TableSession.ensure(record.context.state);
            select(state, descriptor);
            beginOrFinishEdit(state, descriptor);
            refresh(record.context, { focusFirstEdit: true });
            event.preventDefault();
        };

        root.addEventListener('pointerdown', onPointerDown);
        root.addEventListener('pointermove', onPointerMove, { passive: true });
        root.addEventListener('pointerup', onPointerEnd);
        root.addEventListener('pointercancel', onPointerEnd);
        root.addEventListener('click', onClick);
        root.addEventListener('keydown', onKeyDown);

        record.unbind = () => {
            clearPress(record.press);
            root.removeEventListener('pointerdown', onPointerDown);
            root.removeEventListener('pointermove', onPointerMove);
            root.removeEventListener('pointerup', onPointerEnd);
            root.removeEventListener('pointercancel', onPointerEnd);
            root.removeEventListener('click', onClick);
            root.removeEventListener('keydown', onKeyDown);
            bindings.delete(root);
        };
        bindings.set(root, record);
        return record.unbind;
    }

    Kernel.register('tableGesture', Object.freeze({
        VERSION: '2.12-R0',
        TARGET_SELECTOR,
        LONG_PRESS_MS,
        MOVE_TOLERANCE,
        describe,
        select,
        beginOrFinishEdit,
        bind
    }));
})(window);
