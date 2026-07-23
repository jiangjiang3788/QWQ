// 结构化记忆 V2.1：更新草案审核、差异展示与安全回滚
(function () {
    'use strict';

    const Kernel = window.OvoMemoryKernel || null;
    const Core = Kernel?.core;
    if (!Core) throw new Error('记忆内核未加载');
    const clone = Core.clone;
    const escapeHtml = Core.escapeHtml;
    const createId = Core.createId;

    const MAX_PENDING_BATCHES = 20;
    const MAX_COMPLETED_BATCHES = 10;

    function ensureState(chat) {
        if (!chat) return null;
        if (!chat.memoryTables || typeof chat.memoryTables !== 'object') chat.memoryTables = {};
        if (!chat.memoryTables.reviewState || typeof chat.memoryTables.reviewState !== 'object') {
            chat.memoryTables.reviewState = {};
        }
        const state = chat.memoryTables.reviewState;
        if (!Array.isArray(state.pendingBatches)) state.pendingBatches = [];
        if (!Array.isArray(state.completedBatches)) state.completedBatches = [];
        if (state.activeBatchId === undefined) state.activeBatchId = null;
        return state;
    }

    function normalizeProposal(proposal) {
        const decision = ['pending', 'accepted', 'rejected', 'blocked'].includes(proposal?.decision)
            ? proposal.decision
            : (proposal?.valid === false ? 'blocked' : 'pending');
        return {
            ...clone(proposal || {}),
            id: proposal?.id || createId('memory_proposal'),
            decision,
            valid: proposal?.valid !== false,
            risk: ['low', 'medium', 'high'].includes(proposal?.risk) ? proposal.risk : 'low',
            editedValue: proposal?.editedValue !== undefined ? clone(proposal.editedValue) : clone(proposal?.newValue)
        };
    }

    function enqueueBatch(chat, batch) {
        const state = ensureState(chat);
        const normalized = {
            ...clone(batch || {}),
            id: batch?.id || createId('memory_review'),
            createdAt: batch?.createdAt || Date.now(),
            status: 'pending',
            proposals: (batch?.proposals || []).map(normalizeProposal)
        };
        state.pendingBatches.unshift(normalized);
        state.pendingBatches = state.pendingBatches.slice(0, MAX_PENDING_BATCHES);
        state.activeBatchId = normalized.id;
        return normalized;
    }

    function getPendingBatches(chat) {
        return ensureState(chat)?.pendingBatches || [];
    }

    function getCompletedBatches(chat) {
        return ensureState(chat)?.completedBatches || [];
    }

    function getBatch(chat, batchId) {
        const state = ensureState(chat);
        return state.pendingBatches.find(item => item.id === batchId)
            || state.completedBatches.find(item => item.id === batchId)
            || null;
    }

    function getPendingCount(chat) {
        return getPendingBatches(chat).length;
    }

    function setActiveBatch(chat, batchId) {
        const state = ensureState(chat);
        state.activeBatchId = batchId || null;
    }

    function setProposalDecision(chat, batchId, proposalId, decision) {
        const batch = getPendingBatches(chat).find(item => item.id === batchId);
        const proposal = batch?.proposals?.find(item => item.id === proposalId);
        if (!proposal || proposal.decision === 'blocked') return false;
        proposal.decision = ['accepted', 'rejected', 'pending'].includes(decision) ? decision : 'pending';
        return true;
    }

    function setAllDecisions(chat, batchId, decision) {
        const batch = getPendingBatches(chat).find(item => item.id === batchId);
        if (!batch) return false;
        batch.proposals.forEach(proposal => {
            if (proposal.decision !== 'blocked') proposal.decision = decision;
        });
        return true;
    }

    function setProposalEditedValue(chat, batchId, proposalId, value) {
        const batch = getPendingBatches(chat).find(item => item.id === batchId);
        const proposal = batch?.proposals?.find(item => item.id === proposalId);
        if (!proposal || proposal.decision === 'blocked' || proposal.editable === false) return false;
        proposal.editedValue = value;
        return true;
    }

    function setProposalMergeTarget(chat, batchId, proposalId, rowId) {
        const batch = getPendingBatches(chat).find(item => item.id === batchId);
        const proposal = batch?.proposals?.find(item => item.id === proposalId);
        if (!proposal || proposal.kind !== 'row_add' || proposal.decision === 'blocked') return false;
        proposal.mergeTargetRowId = rowId || null;
        return true;
    }

    function completeBatch(chat, batchId, result) {
        const state = ensureState(chat);
        const index = state.pendingBatches.findIndex(item => item.id === batchId);
        if (index < 0) return null;
        const [batch] = state.pendingBatches.splice(index, 1);
        const completed = {
            ...batch,
            rawContent: undefined,
            historyPreview: batch.historyPreview ? String(batch.historyPreview).slice(0, 12000) : '',
            ...clone(result || {}),
            status: result?.status || 'completed',
            completedAt: Date.now()
        };
        state.completedBatches.unshift(completed);
        state.completedBatches = state.completedBatches.slice(0, MAX_COMPLETED_BATCHES);
        state.activeBatchId = state.pendingBatches[0]?.id || null;
        return completed;
    }

    function removePendingBatch(chat, batchId) {
        const state = ensureState(chat);
        const index = state.pendingBatches.findIndex(item => item.id === batchId);
        if (index < 0) return null;
        const [batch] = state.pendingBatches.splice(index, 1);
        state.activeBatchId = state.pendingBatches[0]?.id || null;
        return batch;
    }

    function dataSignature(data) {
        const source = JSON.stringify(data || {});
        let hash = 2166136261;
        for (let i = 0; i < source.length; i++) {
            hash ^= source.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return `${source.length}:${(hash >>> 0).toString(16)}`;
    }

    function shouldRequireReview(engineSettings, context) {
        const mode = engineSettings?.reviewMode || 'summary_only';
        if (mode === 'all') return true;
        if (mode === 'manual_and_summary') return !!context?.preferSummaryApi || !context?.isAutoUpdate;
        return !!context?.preferSummaryApi;
    }

    function formatValue(value) {
        if (value === undefined || value === null || value === '') return '（空）';
        if (Array.isArray(value)) return value.join('、') || '（空）';
        if (typeof value === 'object') return JSON.stringify(value, null, 2);
        return String(value);
    }

    function getDecisionCounts(batch) {
        const counts = { pending: 0, accepted: 0, rejected: 0, blocked: 0 };
        (batch?.proposals || []).forEach(item => {
            counts[item.decision] = (counts[item.decision] || 0) + 1;
        });
        return counts;
    }

    function renderProposal(proposal, batchId) {
        const accepted = proposal.decision === 'accepted';
        const rejected = proposal.decision === 'rejected';
        const blocked = proposal.decision === 'blocked';
        const editable = proposal.editable !== false && ['field', 'row_update_field'].includes(proposal.kind) && !blocked;
        const oldText = formatValue(proposal.oldValue);
        const newText = formatValue(proposal.editedValue !== undefined ? proposal.editedValue : proposal.newValue);
        return `
            <article class="memory-review-proposal decision-${escapeHtml(proposal.decision)} risk-${escapeHtml(proposal.risk)}">
                <div class="memory-review-proposal-head">
                    <div>
                        <div class="memory-review-proposal-title">${escapeHtml(proposal.label || proposal.kind || '更新项')}</div>
                        <div class="memory-review-proposal-meta">${escapeHtml(proposal.actionLabel || proposal.kind || '')}${proposal.rowId ? ` · row=${escapeHtml(proposal.rowId)}` : ''}</div>
                    </div>
                    <div class="memory-review-badges">
                        <span class="memory-review-risk">${proposal.risk === 'high' ? '高风险' : proposal.risk === 'medium' ? '需留意' : '低风险'}</span>
                        <span class="memory-review-decision">${blocked ? '已阻止' : accepted ? '已选接受' : rejected ? '已选拒绝' : '待决定'}</span>
                    </div>
                </div>
                ${proposal.error ? `<div class="memory-review-error">${escapeHtml(proposal.error)}</div>` : ''}
                <div class="memory-review-diff">
                    <div><span>原值</span><pre>${escapeHtml(oldText)}</pre></div>
                    <div><span>建议值</span>${editable
                        ? `<textarea class="memory-review-edit" data-review-edit="1" data-batch-id="${escapeHtml(batchId)}" data-proposal-id="${escapeHtml(proposal.id)}">${escapeHtml(newText)}</textarea>`
                        : `<pre>${escapeHtml(newText)}</pre>`}</div>
                </div>
                ${proposal.duplicateSuggestion ? `<div class="memory-review-duplicate"><b>发现相似旧记录（相似度 ${Number(proposal.duplicateSuggestion.score || 0).toFixed(2)}）</b><div>${escapeHtml(proposal.duplicateSuggestion.summary || '')}</div><button type="button" class="btn btn-small ${proposal.mergeTargetRowId ? 'btn-primary' : 'btn-secondary'}" data-action="review-toggle-merge" data-batch-id="${escapeHtml(batchId)}" data-proposal-id="${escapeHtml(proposal.id)}" data-row-id="${escapeHtml(proposal.duplicateSuggestion.rowId || '')}">${proposal.mergeTargetRowId ? '已选择合并，点此改回新增' : '改为合并到该旧记录'}</button></div>` : ''}
                ${blocked ? '' : `
                    <div class="memory-review-proposal-actions">
                        <button type="button" class="btn btn-small ${accepted ? 'btn-primary' : 'btn-secondary'}" data-action="review-accept" data-batch-id="${escapeHtml(batchId)}" data-proposal-id="${escapeHtml(proposal.id)}">${accepted ? '已选中接受' : '选中接受'}</button>
                        <button type="button" class="btn btn-small ${rejected ? 'btn-danger' : 'btn-secondary'}" data-action="review-reject" data-batch-id="${escapeHtml(batchId)}" data-proposal-id="${escapeHtml(proposal.id)}">${rejected ? '已选中拒绝' : '选中拒绝'}</button>
                        <button type="button" class="btn btn-small btn-neutral" data-action="review-reset" data-batch-id="${escapeHtml(batchId)}" data-proposal-id="${escapeHtml(proposal.id)}">恢复待定</button>
                    </div>`}
            </article>`;
    }

    function renderPendingBatch(batch, active) {
        const counts = getDecisionCounts(batch);
        return `
            <section class="memory-review-batch ${active ? 'active' : ''}" data-review-batch="${escapeHtml(batch.id)}">
                <div class="memory-review-batch-head">
                    <div>
                        <h3>${escapeHtml(batch.tableName || '记忆更新草案')}</h3>
                        <div class="memory-review-batch-meta">${escapeHtml(batch.templateName || '')} · 消息 ${batch.range?.start || '?'}–${batch.range?.end || '?'} · ${batch.sourceMessageCount || 0} 条 · ${batch.apiMode === 'summary' ? '总结 API' : '主聊天 API'}${batch.apiFallback ? '（回退）' : ''}${batch.apiModel ? ` · ${escapeHtml(batch.apiModel)}` : ''}${batch.relatedContext?.tables?.length ? ` · 相关表 ${batch.relatedContext.tables.length} 张 / ${batch.relatedContext.rowCount || 0} 行` : ''}</div>
                    </div>
                    <span class="memory-review-count">${batch.proposals?.length || 0} 项</span>
                </div>
                ${batch.historyPreview ? `<details class="memory-review-source"><summary>查看本次总结范围预览</summary><pre>${escapeHtml(batch.historyPreview)}</pre></details>` : ''}
                <div class="memory-review-toolbar">
                    <button type="button" class="btn btn-small btn-primary" data-action="review-accept-all" data-batch-id="${escapeHtml(batch.id)}">全部接受</button>
                    <button type="button" class="btn btn-small btn-secondary" data-action="review-reject-all" data-batch-id="${escapeHtml(batch.id)}">全部拒绝</button>
                    <span>接受 ${counts.accepted} · 拒绝 ${counts.rejected} · 待定 ${counts.pending} · 阻止 ${counts.blocked}</span>
                </div>
                <div class="memory-review-proposals">${(batch.proposals || []).map(item => renderProposal(item, batch.id)).join('')}</div>
                <div class="memory-review-final-actions">
                    <button type="button" class="btn btn-primary" data-action="review-apply-batch" data-batch-id="${escapeHtml(batch.id)}" ${counts.accepted ? '' : 'disabled'}>保存已接受项（${counts.accepted}）</button>
                    <button type="button" class="btn btn-secondary" data-action="review-reject-batch" data-batch-id="${escapeHtml(batch.id)}">整批拒绝并推进游标</button>
                    <button type="button" class="btn btn-neutral" data-action="review-cancel-batch" data-batch-id="${escapeHtml(batch.id)}">取消草案，不推进游标</button>
                </div>
            </section>`;
    }

    function renderCompletedBatch(batch) {
        const canRollback = batch.status === 'applied' && !batch.rolledBack;
        return `
            <article class="memory-review-completed">
                <div>
                    <strong>${escapeHtml(batch.tableName || '更新审核')}</strong>
                    <div>${new Date(batch.completedAt || batch.createdAt || Date.now()).toLocaleString()} · ${batch.status === 'rejected' ? '整批拒绝' : batch.rolledBack ? '已回滚' : `应用 ${batch.appliedCount || 0} 项`}</div>
                </div>
                ${canRollback ? `<button type="button" class="btn btn-small btn-secondary" data-action="review-rollback" data-batch-id="${escapeHtml(batch.id)}">安全回滚</button>` : ''}
            </article>`;
    }

    function renderReviewView(chat) {
        const state = ensureState(chat);
        const pending = state.pendingBatches;
        const completed = state.completedBatches;
        if (!pending.length && !completed.length) {
            return `<div class="memory-review-empty"><h3>暂无更新草案</h3><p>使用总结 API 的中期、长期更新会先进入这里。游标会在审核完成后推进。</p></div>`;
        }
        const activeId = pending.some(item => item.id === state.activeBatchId)
            ? state.activeBatchId
            : pending[0]?.id;
        return `
            <div class="memory-review-page">
                <div class="memory-review-page-head">
                    <div><h2>更新审核</h2><p>逐项核对模型建议；未接受的项目不会写入档案。</p></div>
                    <span>${pending.length} 个待审核批次</span>
                </div>
                ${pending.map(batch => renderPendingBatch(batch, batch.id === activeId)).join('')}
                ${completed.length ? `<section class="memory-review-history"><h3>最近完成</h3>${completed.map(renderCompletedBatch).join('')}</section>` : ''}
            </div>`;
    }

    const api = {
        ensureState,
        enqueueBatch,
        getPendingBatches,
        getCompletedBatches,
        getBatch,
        getPendingCount,
        setActiveBatch,
        setProposalDecision,
        setAllDecisions,
        setProposalEditedValue,
        setProposalMergeTarget,
        completeBatch,
        removePendingBatch,
        dataSignature,
        shouldRequireReview,
        renderReviewView
    };

    if (Kernel) Kernel.register('review', api, { legacyGlobal: 'MemoryTableReview' });
    else window.MemoryTableReview = api;
})();
