(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    const Core = Kernel?.core;
    if (!Core) throw new Error('记忆内核未加载');
    const Service = Kernel.require('sidecarCandidateService');
    const WriteGateway = Kernel.get('writeGateway') || Kernel.require('writeCoordinator');
    const Policy = Kernel.get('policy');
    const ACTIONS = new Set(['save', 'merge', 'dismiss', 'delete', 'clear-closed', 'clear-all']);

    function operationTitle(action) {
        return action === 'save' ? '保存短期候选到档案'
            : action === 'merge' ? '合并短期候选'
                : action === 'dismiss' ? '忽略短期候选'
                    : action === 'delete' ? '删除短期候选'
                        : action === 'clear-all' ? '清空短期候选'
                            : '清理已结束候选';
    }

    function startOperation(action, chat, candidateId) {
        return global.OVOOperationRuntime?.start?.('memory.sidecar.candidate', {
            title: operationTitle(action),
            category: '记忆',
            source: 'memory_sidecar_v2_13_r4',
            scope: { characterId: chat?.id || '', candidateId: candidateId || '', action }
        }) || null;
    }

    function recordOperation(operation, result) {
        if (!operation || !global.OVOOperationRuntime) return;
        const runtime = global.OVOOperationRuntime;
        const candidate = result.candidate;
        if (result.action === 'promote' || result.action === 'merge') {
            runtime.recordMutation(operation.id, {
                action: result.action === 'promote' && !result.duplicate ? 'create' : 'update',
                entityType: 'structured_memory',
                entityId: result.row?.id || '',
                title: result.descriptor?.table?.name || '正式档案',
                summary: result.message,
                meta: { candidateId: candidate?.id || '', tableId: result.descriptor?.table?.id || '' }
            });
        }
        runtime.recordMutation(operation.id, {
            action: result.action === 'delete' ? 'delete' : 'update',
            entityType: 'memory_candidate',
            entityId: candidate?.id || '',
            title: '短期候选',
            summary: result.message,
            after: candidate?.status || result.action
        });
        runtime.complete(operation.id, { summary: result.message, result: { action: result.action, changed: result.changed !== false } });
    }

    function targetRowId(element, context) {
        if (element?.dataset?.targetRowId) return element.dataset.targetRowId;
        const card = element?.closest?.('.memory-sidecar-candidate');
        return card?.querySelector?.('[data-sidecar-merge-target]')?.value || '';
    }

    async function handle(action, element, context = {}) {
        if (!ACTIONS.has(action)) return false;
        const chat = context.chat;
        if (!chat) {
            context.showError?.(new Error('请先进入一个角色的记忆档案'));
            return true;
        }
        if (action === 'clear-all' && !(context.confirm || global.confirm)?.('确定清空全部短期候选吗？正式档案不会被删除。')) return true;
        const candidateId = element?.dataset?.candidateId || '';
        const operation = startOperation(action, chat, candidateId);
        try {
            const result = await WriteGateway.run(chat, {
                reason: `sidecar-candidate-${action}`,
                writer: context.save,
                persistRollback: true
            }, ({ transactionId }) => Service.execute(chat, action, {
                candidateId,
                targetRowId: targetRowId(element, context),
                operationId: operation?.id || transactionId,
                processedBy: 'user'
            }));
            recordOperation(operation, result);
            context.render?.();
            context.toast?.(result.message);
            return true;
        } catch (error) {
            global.OVOOperationRuntime?.fail?.(operation?.id, error, { summary: `候选处理失败：${error.message || error}` });
            context.render?.();
            if (context.showError) context.showError(error);
            else context.toast?.(`候选处理失败：${error.message || error}`);
            return true;
        }
    }

    Kernel.register('sidecarCandidateController', Object.freeze({
        VERSION: '2.14-R2',
        handles: action => ACTIONS.has(action),
        handle
    }));
})(window);
