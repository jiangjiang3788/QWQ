(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Queue = Kernel.require('governanceQueue');
    const CandidateService = Kernel.require('candidateService');
    const Lifecycle = Kernel.get('lifecycle');
    const Policy = Kernel.get('policy');
    const Review = Kernel.get('review');
    const Feedback = Kernel.get('feedback');

    const ACTIONS = new Set([
        'open-review', 'open-view', 'open-row', 'approve-candidate', 'reject-candidate',
        'confirm-row', 'snooze-row', 'archive-row', 'bulk-confirm', 'bulk-snooze', 'bulk-archive', 'clear-selection', 'clear-feedback-tasks'
    ]);

    function ensureEvidence(row) {
        row.meta ||= {};
        row.meta.evidence ||= {};
        row.meta.evidence.userConfirmed = true;
        row.meta.evidence.confirmedAt = Date.now();
        row.meta.updatedAt = Date.now();
    }

    function confirmItem(chat, item) {
        if (!item?.row || !Lifecycle) return false;
        const meta = Lifecycle.ensureRowMeta(item.row, item.table, '');
        ensureEvidence(item.row);
        if (meta.lifecycle.status !== 'conflicting' && !['archived', 'superseded'].includes(meta.lifecycle.status)) {
            Lifecycle.setStatus(item.row, 'active', '用户在统一待处理队列中确认有效');
            item.row.meta.lifecycle.reviewAt = 0;
            item.row.meta.lifecycle.expiresAt = 0;
        }
        Policy?.clearRetrievalCache?.(chat);
        return true;
    }

    function snoozeItem(chat, item, days = 30) {
        if (!item?.row || !Lifecycle) return false;
        const meta = Lifecycle.ensureRowMeta(item.row, item.table, '');
        meta.lifecycle.reviewAt = Date.now() + Math.max(1, days) * 86400000;
        meta.lifecycle.statusReason = `用户延后 ${days} 天复核`;
        item.row.meta.updatedAt = Date.now();
        Policy?.clearRetrievalCache?.(chat);
        return true;
    }

    function archiveItem(chat, item) {
        if (!item?.row || !Lifecycle) return false;
        Lifecycle.setStatus(item.row, 'archived', '用户在统一待处理队列中归档');
        Policy?.clearRetrievalCache?.(chat);
        return true;
    }

    function lookup(chat, templates, itemId) {
        return Queue.scan(chat, templates).find(item => item.id === itemId) || null;
    }

    async function persist(context, message) {
        await context.save?.(context.chat.id);
        context.render?.();
        if (message) context.toast?.(message);
    }

    async function handle(action, element, context) {
        if (!ACTIONS.has(action)) return false;
        const chat = context.chat;
        const templates = context.templates || [];
        if (!chat) return true;
        if (action === 'clear-selection') {
            Queue.clearSelection();
            context.render?.();
            return true;
        }
        if (action === 'open-review') {
            Review?.setActiveBatch?.(chat, element.dataset.batchId || null);
            context.navigate?.('review');
            return true;
        }
        if (action === 'open-view') {
            context.navigate?.(element.dataset.view || 'tasks');
            return true;
        }
        if (action === 'clear-feedback-tasks') {
            if (!(context.confirm || global.confirm)?.('清空后这些引用轮次不再要求反馈，已完成的反馈效果会保留。确定继续吗？')) return true;
            const result = Feedback?.clearPendingTasks?.(chat) || { rounds: 0, items: 0 };
            await persist(context, `已清空 ${result.rounds} 轮、${result.items} 项待反馈任务`);
            return true;
        }
        const item = lookup(chat, templates, element.dataset.itemId || '');
        if (action === 'open-row') {
            if (item) context.openRow?.(item);
            return true;
        }
        if (action === 'approve-candidate') {
            if (!item) return true;
            try {
                const result = await CandidateService.approveAtomic(chat, item, item.row, {
                    source: 'governance_queue_v2_13_r5',
                    persist: currentChat => context.save?.(currentChat.id)
                });
                context.render?.();
                context.toast?.(result.changed
                    ? (result.duplicate ? '长期库已有对应记录，候选已关联并批准' : '候选已批准并原子晋升到长期记忆')
                    : (result.reason || '候选未改变'));
            } catch (error) {
                context.render?.();
                context.showError?.(error);
                if (!context.showError) context.toast?.(`候选批准失败，已回滚：${error.message || '未知错误'}`);
            }
            return true;
        }
        if (action === 'reject-candidate') {
            if (!item) return true;
            const result = CandidateService.setStatus(chat, item, item.row, '已拒绝', { source: 'governance_queue_v2_11_r4' });
            await persist(context, result.changed ? '候选已拒绝' : (result.reason || '候选未改变'));
            return true;
        }
        if (['confirm-row', 'snooze-row', 'archive-row'].includes(action)) {
            if (!item) return true;
            const changed = action === 'confirm-row' ? confirmItem(chat, item)
                : action === 'snooze-row' ? snoozeItem(chat, item)
                    : archiveItem(chat, item);
            Queue.toggleSelection(item.id, false);
            await persist(context, changed ? (action === 'confirm-row' ? '记忆已确认有效' : action === 'snooze-row' ? '已推迟 30 天复核' : '记忆已归档') : '记忆未改变');
            return true;
        }
        if (['bulk-confirm', 'bulk-snooze', 'bulk-archive'].includes(action)) {
            const selected = Queue.selectedItems(Queue.scan(chat, templates));
            let changed = 0;
            selected.forEach(entry => {
                const ok = action === 'bulk-confirm' ? confirmItem(chat, entry)
                    : action === 'bulk-snooze' ? snoozeItem(chat, entry)
                        : archiveItem(chat, entry);
                if (ok) changed += 1;
            });
            Queue.clearSelection();
            await persist(context, `已处理 ${changed} 条记忆`);
            return true;
        }
        return true;
    }

    Kernel.register('governanceController', Object.freeze({
        VERSION: '2.13-R5', handles: action => ACTIONS.has(action), handle, confirmItem, snoozeItem, archiveItem
    }));
})(window);
