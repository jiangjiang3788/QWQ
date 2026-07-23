(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const TableSession = Kernel.require('tableSession');
    const TableGrouping = Kernel.require('tableGrouping');

    const TARGET_SELECTOR = '[data-memory-edit-target]';
    const DOUBLE_TAP_MS = 360;
    const MOVE_TOLERANCE = 18;
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

    function focusDescriptor(state, descriptor) {
        if (!descriptor) return false;
        if (descriptor.kind === 'field') TableSession.focusField(state, descriptor.fieldPath);
        else TableSession.focusRow(state, descriptor.rowId);
        return true;
    }

    function beginOrFinishEdit(state, descriptor) {
        if (!descriptor) return false;
        if (sameEditingTarget(state, descriptor)) {
            TableSession.finishEditing(state);
            TableSession.clearFocus(state);
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

    function activate(record, target, descriptor) {
        if (typeof record.context.openEditor === 'function') {
            record.suppressClickUntil = Date.now() + 450;
            record.context.openEditor(descriptor);
            try { global.navigator?.vibrate?.(10); } catch (_) {}
            return true;
        }
        const state = TableSession.ensure(record.context.state);
        focusDescriptor(state, descriptor);
        beginOrFinishEdit(state, descriptor);
        record.suppressClickUntil = Date.now() + 450;
        refresh(record.context, { focusFirstEdit: true });
        try { global.navigator?.vibrate?.(10); } catch (_) {}
        return true;
    }

    function resetTap(record) {
        record.lastTap = null;
    }

    function bind(root, context = {}) {
        if (!root) return () => {};
        const old = bindings.get(root);
        if (old) {
            old.context = context;
            return old.unbind;
        }
        const record = { context, pointer: null, lastTap: null, suppressClickUntil: 0 };

        const onDoubleClick = event => {
            if (isInteractive(event.target)) return;
            const target = closestTarget(event.target, root);
            const descriptor = describe(target);
            if (!descriptor) return;
            resetTap(record);
            activate(record, target, descriptor);
            event.preventDefault();
            event.stopPropagation();
        };

        const onPointerDown = event => {
            if (event.button !== undefined && event.button !== 0) return;
            if (isInteractive(event.target)) return;
            const target = closestTarget(event.target, root);
            const descriptor = describe(target);
            if (!descriptor) return;
            record.pointer = {
                pointerId: event.pointerId,
                pointerType: event.pointerType || '',
                startX: Number(event.clientX) || 0,
                startY: Number(event.clientY) || 0,
                target,
                descriptor,
                moved: false
            };
        };

        const onPointerMove = event => {
            const pointer = record.pointer;
            if (!pointer || pointer.pointerId !== event.pointerId) return;
            const dx = (Number(event.clientX) || 0) - pointer.startX;
            const dy = (Number(event.clientY) || 0) - pointer.startY;
            if (Math.hypot(dx, dy) > MOVE_TOLERANCE) pointer.moved = true;
        };

        const onPointerEnd = event => {
            const pointer = record.pointer;
            record.pointer = null;
            if (!pointer || pointer.pointerId !== event.pointerId || pointer.moved) return;
            if (!/touch/i.test(pointer.pointerType)) return;
            const now = Date.now();
            const previous = record.lastTap;
            const same = previous && previous.target === pointer.target;
            const close = previous && Math.hypot(pointer.startX - previous.x, pointer.startY - previous.y) <= MOVE_TOLERANCE;
            if (same && close && now - previous.time <= DOUBLE_TAP_MS) {
                resetTap(record);
                activate(record, pointer.target, pointer.descriptor);
                event.preventDefault();
            } else {
                record.lastTap = { target: pointer.target, time: now, x: pointer.startX, y: pointer.startY };
            }
        };

        const onPointerCancel = () => { record.pointer = null; };

        const onClick = event => {
            if (Date.now() < record.suppressClickUntil) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (isInteractive(event.target)) return;
            const target = closestTarget(event.target, root);
            target?.focus?.({ preventScroll: true });
        };

        const onKeyDown = event => {
            const inputLike = event.target?.matches?.('input,textarea,select,[contenteditable="true"]');
            if (event.key === 'Escape' && (record.context.state?.editingRowId || record.context.state?.editingFieldPath)) {
                TableSession.finishEditing(record.context.state);
                TableSession.clearFocus(record.context.state);
                refresh(record.context);
                event.preventDefault();
                return;
            }
            if (inputLike || event.key !== 'F2') return;
            const target = closestTarget(event.target, root);
            const descriptor = describe(target);
            if (!descriptor) return;
            activate(record, target, descriptor);
            event.preventDefault();
        };

        root.addEventListener('dblclick', onDoubleClick);
        root.addEventListener('pointerdown', onPointerDown);
        root.addEventListener('pointermove', onPointerMove, { passive: true });
        root.addEventListener('pointerup', onPointerEnd);
        root.addEventListener('pointercancel', onPointerCancel);
        root.addEventListener('click', onClick);
        root.addEventListener('keydown', onKeyDown);

        record.unbind = () => {
            root.removeEventListener('dblclick', onDoubleClick);
            root.removeEventListener('pointerdown', onPointerDown);
            root.removeEventListener('pointermove', onPointerMove);
            root.removeEventListener('pointerup', onPointerEnd);
            root.removeEventListener('pointercancel', onPointerCancel);
            root.removeEventListener('click', onClick);
            root.removeEventListener('keydown', onKeyDown);
            bindings.delete(root);
        };
        bindings.set(root, record);
        return record.unbind;
    }

    Kernel.register('tableGesture', Object.freeze({
        VERSION: '2.13-R5',
        TARGET_SELECTOR,
        DOUBLE_TAP_MS,
        MOVE_TOLERANCE,
        describe,
        focusDescriptor,
        select: focusDescriptor,
        beginOrFinishEdit,
        bind
    }));
})(window);
