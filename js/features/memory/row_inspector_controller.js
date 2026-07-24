(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const TagService = Kernel.require('tagService');
    const RelationService = Kernel.require('relationService');
    const MergeReviewService = Kernel.require('mergeReviewService');
    const TagVocabulary = Kernel.require('tagVocabulary');
    const MemoryApi = Kernel.require('api');
    const Policy = Kernel.get('policy');

    const ACTIONS = new Set([
        'open-row-inspector', 'close-row-inspector', 'refresh-row-relations', 'open-related-row',
        'link-row-related-cross', 'link-row-conflict-cross', 'link-row-supersedes-cross',
        'clear-row-relations-cross', 'merge-memory-tags', 'regenerate-row-tags',
        'review-row-relation', 'cancel-row-review', 'apply-row-review', 'remove-tag-alias',
        'switch-row-inspector-tab'
    ]);

    function resetAnalysis(state) { state.inspectorAnalysis = null; }
    function resetReview(state) { state.inspectorReview = null; }
    function render(context) { context.render(); }
    function toast(context, message) { context.toast(message); }
    function clearCache(chat) { if (Policy) Policy.clearRetrievalCache(chat); }

    async function persist(context, chat) {
        clearCache(chat);
        await context.save(chat.id);
    }

    function close(state) {
        Object.assign(state, { inspectorOpen: false, selectedRowId: null, inspectorAnalysis: null, inspectorReview: null, inspectorBusy: false, inspectorTab: 'relations' });
    }

    async function regenerateTags(actionEl, context) {
        const { chat, state } = context;
        if (!chat || state.inspectorBusy) return true;
        const target = RelationService.findById(chat, actionEl.dataset.rowId || '');
        if (!target) return true;
        const analysis = RelationService.analyze(chat, target, { topK: 6 });
        const prompt = TagService.buildRegenerationPrompt(target.table, target.row, analysis.items, { chat });
        state.inspectorBusy = true;
        render(context);
        const execute = async operation => {
            const raw = await MemoryApi.requestContent(prompt, 0.1, true, 'memory-table-tags', {
                operationId: operation?.id || null,
                promptSources: [{ id: `memory-row:${target.row.id}`, type: 'structured_archive_memory', label: `${target.table.name} / 标签重算`, content: prompt, sent: true }]
            });
            const bundle = TagService.parseGeneratedBundle(raw);
            if (!bundle) throw new Error('模型没有返回有效标签');
            const result = TagService.applyToRow(target.row, bundle, { chat, source: 'ai_regenerate_v2_11_r31', force: true });
            await persist(context, chat);
            return result;
        };
        try {
            const runtime = global.OVOOperationRuntime;
            if (runtime?.run) await runtime.run('memory.tags.regenerate', {
                title: `重新生成${target.table.name}标签`, source: 'memory-row-inspector',
                scope: { characterId: chat.id, templateId: target.template.id, tableId: target.table.id, rowId: target.row.id },
                stage: '读取当前记录、词表与相关记忆',
                getSummary: result => result?.changed ? '标签已重新生成并按词表归一' : '模型标签与现有标签一致'
            }, execute);
            else await execute(null);
            toast(context, '标签已重新生成');
        } catch (error) {
            console.error('[MemoryTable] regenerate tags failed:', error);
            context.showError(error);
        } finally {
            state.inspectorBusy = false;
            resetAnalysis(state);
            render(context);
        }
        return true;
    }

    async function handleAction(action, actionEl, context) {
        if (!ACTIONS.has(action)) return false;
        const { chat, state } = context;
        if (action === 'open-row-inspector') {
            state.selectedRowId = actionEl.dataset.rowId || null;
            state.inspectorOpen = !!state.selectedRowId;
            state.inspectorTab = 'relations';
            resetAnalysis(state);
            resetReview(state);
            render(context);
            return true;
        }
        if (action === 'close-row-inspector') {
            close(state);
            render(context);
            return true;
        }
        if (action === 'switch-row-inspector-tab') {
            const tab = actionEl.dataset.tab || 'relations';
            state.inspectorTab = ['relations', 'provenance', 'tags', 'vocabulary'].includes(tab) ? tab : 'relations';
            resetReview(state);
            render(context);
            return true;
        }
        if (!chat) return true;
        if (action === 'refresh-row-relations') {
            if (state.selectedRowId) state.inspectorAnalysis = RelationService.analyze(chat, state.selectedRowId, { topK: 14 });
            resetReview(state);
            render(context);
            return true;
        }
        if (action === 'review-row-relation') {
            state.inspectorReview = MergeReviewService.preview(chat, actionEl.dataset.sourceRowId || '', actionEl.dataset.targetRowId || '');
            render(context);
            return true;
        }
        if (action === 'cancel-row-review') {
            resetReview(state);
            state.inspectorTab = 'relations';
            render(context);
            return true;
        }
        if (action === 'apply-row-review') {
            const review = state.inspectorReview;
            if (!review) return true;
            const decision = actionEl.dataset.decision || '';
            const labels = {
                'merge-current': '保留当前记录并合并证据',
                'merge-candidate': '保留候选记录并合并证据',
                conflict: '保留两条并标记冲突',
                related: '仅建立关联'
            };
            if (!global.confirm(`确定执行“${labels[decision] || decision}”吗？合并不会自动覆盖双方都有内容的字段。`)) return true;
            let result = null;
            const perform = async operation => {
                result = MergeReviewService.resolve(chat, review.current.row.id, review.candidate.row.id, decision);
                if (result.changed && operation?.id && global.OVOOperationRuntime?.recordMutation) {
                    global.OVOOperationRuntime.recordMutation(operation.id, {
                        action: 'update', entityType: 'memory_row', entityId: review.current.row.id,
                        title: labels[decision] || '审核记忆关系',
                        summary: String(decision).startsWith('merge-')
                            ? `合并证据并保留 ${decision === 'merge-current' ? '当前记录' : '候选记录'}`
                            : (decision === 'conflict' ? '两条记忆保留并标记冲突' : '建立跨表关联'),
                        count: String(decision).startsWith('merge-') ? 2 : 1,
                        fields: result.copiedFields?.map(item => item.key) || []
                    });
                }
                return { changed: !!result.changed, decision, copiedFieldCount: result.copiedFields?.length || 0, reason: result.reason || '' };
            };
            const runtime = global.OVOOperationRuntime;
            if (runtime?.run) {
                await runtime.run('memory.merge.review', {
                    title: labels[decision] || '审核档案记忆关系', source: 'memory-row-inspector',
                    scope: { characterId: chat.id, currentRowId: review.current.row.id, candidateRowId: review.candidate.row.id },
                    stage: '核对两条记忆与合并边界',
                    getSummary: summary => summary.changed ? (labels[decision] || '审核已完成') : (summary.reason || '没有产生变化')
                }, perform);
            } else await perform(null);
            if (!result?.changed) {
                toast(context, result?.reason || '没有产生变化');
                return true;
            }
            if (decision === 'merge-candidate') {
                state.activeTableId = review.candidate.table.id;
                state.selectedRowId = review.candidate.row.id;
            }
            await persist(context, chat);
            resetAnalysis(state);
            resetReview(state);
            render(context);
            toast(context, labels[decision] || '审核已完成');
            return true;
        }
        if (action === 'open-related-row') {
            const target = RelationService.findById(chat, actionEl.dataset.rowId || '');
            if (!target) return true;
            state.activeTableId = target.table.id;
            state.selectedRowId = target.row.id;
            state.inspectorOpen = true;
            state.inspectorTab = 'relations';
            resetAnalysis(state);
            resetReview(state);
            const runtime = Policy ? Policy.ensureRuntimeState(chat) : null;
            if (runtime) runtime.activeTableId = target.table.id;
            await context.save(chat.id);
            render(context);
            return true;
        }
        if (action.startsWith('link-row-')) {
            const mode = action === 'link-row-conflict-cross' ? 'conflict' : (action === 'link-row-supersedes-cross' ? 'supersedes' : 'related');
            if (!RelationService.link(chat, actionEl.dataset.sourceRowId || '', actionEl.dataset.targetRowId || '', mode)) return true;
            await persist(context, chat);
            resetAnalysis(state);
            resetReview(state);
            render(context);
            toast(context, mode === 'conflict' ? '已建立冲突关系' : (mode === 'supersedes' ? '已标记为替代旧记录' : '已建立相关关系'));
            return true;
        }
        if (action === 'clear-row-relations-cross') {
            if (!global.confirm('确定清除当前记录与其他表格行的全部关系吗？')) return true;
            if (!RelationService.clear(chat, actionEl.dataset.rowId || '')) return true;
            await persist(context, chat);
            resetAnalysis(state);
            resetReview(state);
            render(context);
            toast(context, '关系已清除');
            return true;
        }
        if (action === 'merge-memory-tags') {
            const container = actionEl.closest('.memory-row-tag-merge');
            const dimension = container?.querySelector('[data-tag-merge-dimension]')?.value || 'topic';
            const from = container?.querySelector('[data-tag-merge-from]')?.value?.trim() || '';
            const to = container?.querySelector('[data-tag-merge-to]')?.value?.trim() || '';
            if (!from || !to) {
                toast(context, '请填写旧标签和统一后的标签');
                return true;
            }
            if (!global.confirm(`将当前角色全部“${from}”标签合并为“${to}”，并写入统一词表吗？已锁定记录不会修改。`)) return true;
            const result = RelationService.mergeTag(chat, { dimension, from, to });
            if (!result.changedRows && !result.vocabulary?.changed) {
                toast(context, result.skippedLocked ? `没有可修改记录；跳过 ${result.skippedLocked} 条已锁定记录` : '没有找到该标签');
                return true;
            }
            await persist(context, chat);
            resetAnalysis(state);
            render(context);
            toast(context, `已统一 ${result.changedRows} 条记忆，并记录同义词规则${result.skippedLocked ? `；跳过 ${result.skippedLocked} 条锁定记录` : ''}`);
            return true;
        }
        if (action === 'remove-tag-alias') {
            if (!TagVocabulary.removeAlias(chat, actionEl.dataset.dimension || '', actionEl.dataset.alias || '')) return true;
            await persist(context, chat);
            render(context);
            toast(context, '词表规则已删除；现有记忆标签保持不变');
            return true;
        }
        if (action === 'regenerate-row-tags') return regenerateTags(actionEl, context);
        return true;
    }

    async function handleSubmit(form, context) {
        if (!form?.matches?.('[data-row-tag-form]')) return false;
        const { chat, state } = context;
        const target = chat ? RelationService.findById(chat, form.dataset.rowId || '') : null;
        if (!chat || !target) return true;
        const data = new FormData(form);
        const result = TagService.applyToRow(target.row, {
            topic: data.get('topic') || '', scene: data.get('scene') || '', entity: data.get('entity') || '',
            effect: data.get('effect') || 'historical_context'
        }, { chat, source: 'manual_inspector_v2_11_r31', force: true });
        const lockChanged = TagService.setLocked(target.row, data.get('tagLocked') === 'on');
        if (!result.changed && !lockChanged) {
            toast(context, '标签没有变化');
            return true;
        }
        await persist(context, chat);
        resetAnalysis(state);
        render(context);
        toast(context, '标签已保存并按词表归一');
        return true;
    }

    Kernel.register('rowInspectorController', Object.freeze({ VERSION: '2.14-R9', handles: action => ACTIONS.has(action), handleAction, handleSubmit }));
})(window);
