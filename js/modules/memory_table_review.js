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

    function proposalRecordKey(proposal) {
        if (proposal?.recordKey) return String(proposal.recordKey);
        const templateId = proposal?.templateId || '';
        const tableId = proposal?.tableId || '';
        if (proposal?.rowId) return `row:${templateId}:${tableId}:${proposal.rowId}`;
        if (proposal?.kind === 'row_add') return `new:${templateId}:${tableId}:${proposal?.id || createId('record')}`;
        return `kv:${templateId}:${tableId}`;
    }

    function proposalFieldCount(proposal) {
        if (!proposal) return 0;
        if (proposal.kind === 'row_add') {
            return Math.max(1, Object.keys(proposal.fieldValues || {}).length + (proposal.tagBundle ? 1 : 0));
        }
        return 1;
    }

    function normalizeProposal(proposal) {
        const decision = ['pending', 'accepted', 'rejected', 'blocked'].includes(proposal?.decision)
            ? proposal.decision
            : (proposal?.valid === false ? 'blocked' : 'pending');
        const normalized = {
            ...clone(proposal || {}),
            id: proposal?.id || createId('memory_proposal'),
            decision,
            valid: proposal?.valid !== false,
            risk: ['low', 'medium', 'high'].includes(proposal?.risk) ? proposal.risk : 'low',
            editedValue: proposal?.editedValue !== undefined ? clone(proposal.editedValue) : clone(proposal?.newValue)
        };
        normalized.recordKey = proposalRecordKey(normalized);
        normalized.fieldChangeCount = proposalFieldCount(normalized);
        return normalized;
    }

    function groupProposalsByRecord(batch) {
        const groups = new Map();
        (batch?.proposals || []).forEach(proposal => {
            const key = proposalRecordKey(proposal);
            if (!groups.has(key)) {
                const isNew = proposal.kind === 'row_add';
                const isDelete = proposal.kind === 'row_delete';
                groups.set(key, {
                    key,
                    tableName: proposal.tableName || batch?.tableName || '记忆',
                    label: proposal.recordLabel || (isNew ? '新增记忆' : isDelete ? '删除记忆' : proposal.rowId ? '已有记忆' : '当前档案'),
                    proposals: [],
                    fieldCount: 0
                });
            }
            const group = groups.get(key);
            group.proposals.push(proposal);
            group.fieldCount += proposalFieldCount(proposal);
        });
        return Array.from(groups.values());
    }

    function recordDecision(group) {
        const actionable = (group?.proposals || []).filter(item => item.decision !== 'blocked');
        if (!actionable.length) return 'blocked';
        if (actionable.every(item => item.decision === 'accepted')) return 'accepted';
        if (actionable.every(item => item.decision === 'rejected')) return 'rejected';
        return 'pending';
    }

    function getBatchChangeSummary(batch) {
        const records = groupProposalsByRecord(batch);
        const summary = { recordCount: records.length, fieldCount: 0, acceptedRecords: 0, rejectedRecords: 0, pendingRecords: 0, blockedRecords: 0, acceptedFields: 0 };
        records.forEach(record => {
            summary.fieldCount += record.fieldCount;
            const decision = recordDecision(record);
            summary[`${decision}Records`] += 1;
            if (record.proposals.some(item => item.decision === 'accepted' && item.valid !== false)) summary.acceptedRecords += decision === 'accepted' ? 0 : 1;
            record.proposals.forEach(item => {
                if (item.decision === 'accepted' && item.valid !== false) summary.acceptedFields += proposalFieldCount(item);
            });
        });
        return summary;
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

    function setRecordDecision(chat, batchId, recordKey, decision) {
        const batch = getPendingBatches(chat).find(item => item.id === batchId);
        if (!batch) return false;
        const normalizedDecision = ['accepted', 'rejected', 'pending'].includes(decision) ? decision : 'pending';
        let changed = false;
        batch.proposals.forEach(proposal => {
            if (proposalRecordKey(proposal) !== recordKey || proposal.decision === 'blocked') return;
            proposal.decision = normalizedDecision;
            changed = true;
        });
        return changed;
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
        const commitModes = Array.isArray(context?.commitModes)
            ? context.commitModes
            : [context?.commitMode || context?.tablePolicy?.commitPolicy?.mode].filter(Boolean);
        if (commitModes.length) return commitModes.some(mode => mode === 'review' || mode === 'promotion');
        // 旧存档兼容：没有每表写入策略时才回退到历史全局审核设置。
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
        const policyMeta = proposal.fieldPolicy ? [
            proposal.fieldRoute === 'candidate' ? '进入候选' : proposal.fieldRoute === 'review' ? '需要确认' : proposal.fieldRoute === 'blocked' ? '已阻止' : '',
            proposal.evidence === 'explicit' ? '用户明确表达' : proposal.evidence === 'inferred' ? 'AI 推断' : '',
            Number.isFinite(Number(proposal.confidence)) ? `置信度 ${Number(proposal.confidence)}` : ''
        ].filter(Boolean).join(' · ') : '';
        return `
            <article class="memory-review-proposal decision-${escapeHtml(proposal.decision)} risk-${escapeHtml(proposal.risk)}">
                <div class="memory-review-proposal-head">
                    <div>
                        <div class="memory-review-proposal-title">${escapeHtml(proposal.label || proposal.kind || '更新项')}</div>
                        <div class="memory-review-proposal-meta">${escapeHtml(proposal.actionLabel || proposal.kind || '')}${policyMeta ? ` · ${escapeHtml(policyMeta)}` : ''}</div>
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

    function renderRecordGroup(record, batchId) {
        const decision = recordDecision(record);
        const accepted = decision === 'accepted';
        const rejected = decision === 'rejected';
        return `<section class="memory-review-record decision-${escapeHtml(decision)}" data-review-record="${escapeHtml(record.key)}">
            <header class="memory-review-record-head">
                <div><strong>${escapeHtml(record.label)}</strong><small>${escapeHtml(record.tableName)} · ${record.fieldCount} 个字段变化</small></div>
                <div class="memory-review-record-actions">
                    <button type="button" class="btn btn-small ${accepted ? 'btn-primary' : 'btn-secondary'}" data-action="review-record-accept" data-batch-id="${escapeHtml(batchId)}" data-record-key="${escapeHtml(record.key)}">接受整条</button>
                    <button type="button" class="btn btn-small ${rejected ? 'btn-danger' : 'btn-secondary'}" data-action="review-record-reject" data-batch-id="${escapeHtml(batchId)}" data-record-key="${escapeHtml(record.key)}">拒绝整条</button>
                    <button type="button" class="btn btn-small btn-neutral" data-action="review-record-reset" data-batch-id="${escapeHtml(batchId)}" data-record-key="${escapeHtml(record.key)}">逐字段调整</button>
                </div>
            </header>
            <div class="memory-review-record-fields">${record.proposals.map(item => renderProposal(item, batchId)).join('')}</div>
        </section>`;
    }

    function renderPendingBatch(batch, active) {
        const counts = getDecisionCounts(batch);
        const records = groupProposalsByRecord(batch);
        const summary = getBatchChangeSummary(batch);
        const acceptedRecordCount = records.filter(record => record.proposals.some(item => item.decision === 'accepted' && item.valid !== false)).length;
        return `
            <section class="memory-review-batch ${active ? 'active' : ''}" data-review-batch="${escapeHtml(batch.id)}">
                <div class="memory-review-batch-head">
                    <div>
                        <h3>${escapeHtml(batch.tableName || '记忆更新草案')}</h3>
                        <div class="memory-review-batch-meta">${escapeHtml(batch.templateName || '')} · 消息 ${batch.range?.start || '?'}–${batch.range?.end || '?'} · ${batch.sourceMessageCount || 0} 条 · ${batch.apiMode === 'summary' ? '总结 API' : '主聊天 API'}${batch.apiFallback ? '（回退）' : ''}${batch.apiModel ? ` · ${escapeHtml(batch.apiModel)}` : ''}${batch.relatedContext?.tables?.length ? ` · 只读参考 ${batch.relatedContext.tables.length} 张表 / ${batch.relatedContext.rowCount || 0} 行` : ''}</div>
                    </div>
                    <span class="memory-review-count">${summary.recordCount} 条记忆 · ${summary.fieldCount} 个字段</span>
                </div>
                ${batch.historyPreview ? `<details class="memory-review-source"><summary>查看本次整理消息范围</summary><pre>${escapeHtml(batch.historyPreview)}</pre></details>` : ''}
                <div class="memory-review-toolbar">
                    <button type="button" class="btn btn-small btn-primary" data-action="review-accept-all" data-batch-id="${escapeHtml(batch.id)}">全部接受</button>
                    <button type="button" class="btn btn-small btn-secondary" data-action="review-reject-all" data-batch-id="${escapeHtml(batch.id)}">全部拒绝</button>
                    <span>字段：接受 ${counts.accepted} · 拒绝 ${counts.rejected} · 待定 ${counts.pending} · 阻止 ${counts.blocked}</span>
                </div>
                <div class="memory-review-proposals">${records.map(record => renderRecordGroup(record, batch.id)).join('')}</div>
                <div class="memory-review-final-actions">
                    <button type="button" class="btn btn-primary" data-action="review-apply-batch" data-batch-id="${escapeHtml(batch.id)}" ${acceptedRecordCount ? '' : 'disabled'}>保存已接受记忆（${acceptedRecordCount}）</button>
                    <button type="button" class="btn btn-secondary" data-action="review-reject-batch" data-batch-id="${escapeHtml(batch.id)}">拒绝并跳过这段消息</button>
                    <button type="button" class="btn btn-neutral" data-action="review-cancel-batch" data-batch-id="${escapeHtml(batch.id)}">取消本次整理，保留处理范围</button>
                </div>
            </section>`;
    }

    function renderCompletedBatch(batch) {
        const canRollback = batch.status === 'applied' && !batch.rolledBack;
        const statusText = batch.status === 'rejected_skipped'
            ? '已拒绝并跳过消息范围'
            : batch.status === 'cancelled_preserved'
                ? '已取消，消息范围仍可重新整理'
                : batch.rolledBack
                    ? '已回滚'
                    : `应用 ${batch.appliedRecordCount || 0} 条记忆 · ${batch.appliedFieldCount ?? batch.appliedCount ?? 0} 个字段`;
        return `
            <article class="memory-review-completed">
                <div>
                    <strong>${escapeHtml(batch.tableName || '更新审核')}</strong>
                    <div>${new Date(batch.completedAt || batch.createdAt || Date.now()).toLocaleString()} · ${statusText}</div>
                </div>
                ${canRollback ? `<button type="button" class="btn btn-small btn-secondary" data-action="review-rollback" data-batch-id="${escapeHtml(batch.id)}">安全回滚</button>` : ''}
            </article>`;
    }

    function renderReviewView(chat) {
        const state = ensureState(chat);
        const pending = state.pendingBatches;
        const completed = state.completedBatches;
        if (!pending.length && !completed.length) {
            return `<div class="memory-review-empty"><h3>暂无更新草案</h3><p>表格写入方式或字段级策略要求确认时，会在这里生成单表审核批次。</p></div>`;
        }
        const activeId = pending.some(item => item.id === state.activeBatchId)
            ? state.activeBatchId
            : pending[0]?.id;
        return `
            <div class="memory-review-page">
                <div class="memory-review-page-head">
                    <div><h2>更新审核</h2><p>按记忆记录核对建议；候选字段、低置信度推断和表格审核结果都在这里确认，未接受的字段不会写入档案。</p></div>
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
        setRecordDecision,
        setProposalEditedValue,
        setProposalMergeTarget,
        completeBatch,
        removePendingBatch,
        dataSignature,
        shouldRequireReview,
        proposalRecordKey,
        proposalFieldCount,
        groupProposalsByRecord,
        getBatchChangeSummary,
        renderReviewView
    };

    if (Kernel) Kernel.register('review', api, { legacyGlobal: 'MemoryTableReview' });
    else window.MemoryTableReview = api;
})();
