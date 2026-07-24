(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Feedback = Kernel.get('feedback');
    const Policy = Kernel.get('policy');

    const VERSION = '2.12-R1';
    const selectedRoundByChat = new Map();

    const EFFECT_LABELS = Object.freeze({
        fact: '确认事实',
        temporary_state: '当前状态',
        soft_preference: '回应偏好',
        hard_boundary: '关系边界',
        reminder: '提醒事项',
        historical_context: '历史背景',
        candidate: '候选参考'
    });

    const FEEDBACK_LABELS = Object.freeze({
        pending: '待反馈',
        expired: '反馈已过期',
        helpful: '有帮助',
        irrelevant: '无关',
        outdated: '已过时',
        inaccurate: '不准确',
        block_scene: '当前场景禁用',
        no_proactive: '不主动提及',
        pause: '已暂停',
        forget: '已忘记',
        reset_feedback: '已重置'
    });

    function unique(values, limit = 20) {
        return Core.unique((values || []).filter(Boolean), limit);
    }

    function text(value) {
        return String(value ?? '').replace(/\s+/g, ' ').trim();
    }

    function truncate(value, limit = 120) {
        const normalized = text(value);
        return normalized.length > limit ? `${normalized.slice(0, Math.max(1, limit - 1))}…` : normalized;
    }

    function getRuntime(chat) {
        return Policy?.ensureRuntimeState?.(chat) || chat?.memoryTables || null;
    }

    function getDiagnostic(chat) {
        return getRuntime(chat)?.lastRetrievalDiagnostic || null;
    }

    function getCompletedRounds(chat) {
        const state = Feedback?.ensureState?.(chat);
        return [...(state?.rounds || [])]
            .filter(round => round?.requestStatus !== 'prepared' && round?.status !== 'expired')
            .sort((a, b) => (Number(b.completedAt || b.createdAt) || 0) - (Number(a.completedAt || a.createdAt) || 0));
    }

    function flattenDiagnostic(diagnostic) {
        const items = [];
        (diagnostic?.tables || []).forEach(group => {
            const [templateId = '', tableId = ''] = String(group.key || '').split('::');
            (group.selected || []).forEach(hit => items.push({
                id: `${templateId}::${tableId}::${hit.id}`,
                templateId,
                tableId,
                rowId: hit.id,
                templateName: group.templateName || '',
                tableName: group.tableName || '',
                text: hit.text || '',
                score: Number(hit.score) || 0,
                effectMode: hit.effectMode || hit.tags?.effect || '',
                directive: hit.directive || '',
                reasons: Array.isArray(hit.reasons) ? hit.reasons : [],
                tags: hit.tags || null,
                feedback: 'pending',
                feedbackAt: 0
            }));
        });
        return items;
    }

    function diagnosticRound(chat) {
        const diagnostic = getDiagnostic(chat);
        if (!diagnostic) return null;
        return {
            id: `diagnostic:${diagnostic.preparedAt || 0}`,
            roundId: '',
            createdAt: diagnostic.preparedAt || Date.now(),
            completedAt: diagnostic.preparedAt || Date.now(),
            queryText: diagnostic.queryText || '',
            queryContext: diagnostic.queryContext || {},
            actualMode: diagnostic.actualMode || 'keyword',
            finalChars: Number(diagnostic.finalChars) || 0,
            finalBlock: diagnostic.finalBlock || '',
            status: 'preview',
            requestStatus: 'completed',
            isDiagnosticOnly: true,
            pureRead: diagnostic.pureRead === true,
            indexCoverage: diagnostic.indexCoverage || null,
            items: flattenDiagnostic(diagnostic)
        };
    }

    function getAvailableRounds(chat) {
        const completed = getCompletedRounds(chat);
        if (completed.length) return completed;
        const fallback = diagnosticRound(chat);
        return fallback ? [fallback] : [];
    }

    function getSelectedRound(chat) {
        const rounds = getAvailableRounds(chat);
        if (!rounds.length) return null;
        const stored = selectedRoundByChat.get(chat?.id);
        const selected = rounds.find(round => round.id === stored) || rounds[0];
        selectedRoundByChat.set(chat?.id, selected.id);
        return selected;
    }

    function setSelectedRound(chatId, roundId) {
        if (!chatId) return false;
        selectedRoundByChat.set(chatId, String(roundId || ''));
        return true;
    }

    function recordTitle(item) {
        const source = String(item?.text || '');
        const patterns = [
            /(?:^|\n)标题\s*[:：]\s*([^\n]+)/,
            /(?:^|\n)主题\s*[:：]\s*([^\n]+)/,
            /(?:^|\n)核心内容\s*[:：]\s*([^\n]+)/,
            /(?:^|\n)内容或摘要\s*[:：]\s*([^\n]+)/,
            /(?:^|\n)内容\s*[:：]\s*([^\n]+)/,
            /(?:^|\n)事件ID\s*[:：]\s*([^\n]+)/
        ];
        for (const pattern of patterns) {
            const match = source.match(pattern);
            if (match?.[1]) return truncate(match[1], 56);
        }
        const firstUseful = source.split(/\n+/).map(line => text(line)).find(line => line && !/^(创建时间|最后更新时间|完成时间|置信度|来源说明|原始记录ID)\s*[:：]/.test(line));
        return truncate(firstUseful || item?.rowId || '记忆记录', 56);
    }

    function recordExcerpt(item) {
        const source = String(item?.text || '');
        const contentMatch = source.match(/(?:内容|内容或摘要|新反应|描述|身体状态|精力与情绪)\s*[:：]\s*([^\n]+)/);
        return truncate(contentMatch?.[1] || source, 150);
    }

    function classifyReason(reason) {
        const value = text(reason);
        if (!value) return null;
        if (/固定|置顶|强制/.test(value)) return { id: 'fixed', label: '固定附带', detail: value };
        if (/语义|向量/.test(value)) return { id: 'semantic', label: '语义相似', detail: value };
        if (/关键词|词法|文本命中/.test(value)) return { id: 'keyword', label: '关键词匹配', detail: value };
        if (/标签|主题|场景|实体/.test(value)) return { id: 'tag', label: '标签/场景', detail: value };
        if (/反馈|用户标记|降权|加权/.test(value)) return { id: 'feedback', label: '历史反馈', detail: value };
        if (/近期|更新时间|当前有效|重要度|置信度/.test(value)) return { id: 'freshness', label: '时效/重要度', detail: value };
        if (/来源|旧数据|证据/.test(value)) return { id: 'evidence', label: '来源证据', detail: value };
        if (/作用/.test(value)) return { id: 'effect', label: '作用类型', detail: value };
        return { id: 'rule', label: '规则命中', detail: value };
    }

    function reasonModel(item) {
        const classified = (item?.reasons || []).map(classifyReason).filter(Boolean);
        const labels = unique(classified.map(reason => reason.label), 4);
        const details = unique(classified.map(reason => reason.detail), 8);
        return {
            labels: labels.length ? labels : ['相关性匹配'],
            summary: labels.join(' + '),
            details
        };
    }

    function effectLabel(item) {
        const key = item?.effectMode || item?.tags?.effect || 'historical_context';
        return EFFECT_LABELS[key] || key || '背景参考';
    }

    function useModel(item) {
        const role = effectLabel(item);
        const directive = truncate(item?.directive || '', 120);
        return { role, directive: directive || `${role}，仅在当前话题相关时使用` };
    }

    function feedbackLabel(value) {
        return FEEDBACK_LABELS[value] || value || '待反馈';
    }

    function feedbackTone(value) {
        if (value === 'helpful') return 'positive';
        if (['irrelevant', 'outdated', 'inaccurate', 'block_scene', 'forget'].includes(value)) return 'negative';
        if (['pause', 'no_proactive'].includes(value)) return 'muted';
        return 'pending';
    }

    function buildItems(round) {
        return (round?.items || []).map(item => ({
            ...item,
            title: recordTitle(item),
            excerpt: recordExcerpt(item),
            reason: reasonModel(item),
            use: useModel(item),
            feedbackLabel: feedbackLabel(item.feedback),
            feedbackTone: feedbackTone(item.feedback)
        }));
    }

    function buildTableSummary(items) {
        const groups = new Map();
        items.forEach(item => {
            const key = `${item.templateId || ''}::${item.tableId || item.tableName || ''}`;
            if (!groups.has(key)) groups.set(key, {
                key,
                templateName: item.templateName || '',
                tableName: item.tableName || '未命名表',
                count: 0,
                scoreTotal: 0,
                reasons: [],
                roles: [],
                pending: 0,
                helpful: 0,
                negative: 0
            });
            const group = groups.get(key);
            group.count += 1;
            group.scoreTotal += Number(item.score) || 0;
            group.reasons.push(...item.reason.labels);
            group.roles.push(item.use.role);
            if (item.feedback === 'pending') group.pending += 1;
            else if (item.feedback === 'helpful') group.helpful += 1;
            else if (!['expired', 'reset_feedback'].includes(item.feedback)) group.negative += 1;
        });
        return [...groups.values()].map(group => ({
            ...group,
            averageScore: group.count ? group.scoreTotal / group.count : 0,
            reasons: unique(group.reasons, 4),
            roles: unique(group.roles, 4)
        })).sort((a, b) => b.count - a.count || b.averageScore - a.averageScore);
    }

    function getViewModel(chat) {
        const rounds = getAvailableRounds(chat);
        const round = getSelectedRound(chat);
        const items = buildItems(round);
        const tables = buildTableSummary(items);
        const feedbackState = Feedback?.ensureState?.(chat);
        const diagnostic = getDiagnostic(chat);
        return {
            rounds,
            round,
            items,
            tables,
            feedbackState,
            diagnostic,
            pending: items.filter(item => item.feedback === 'pending').length,
            totalPending: Feedback?.getPendingCount?.(chat) || 0,
            helpful: items.filter(item => item.feedback === 'helpful').length,
            negative: items.filter(item => ['irrelevant', 'outdated', 'inaccurate', 'block_scene', 'forget'].includes(item.feedback)).length,
            queryContext: round?.queryContext || {},
            queryText: round?.queryText || '',
            finalBlock: round?.finalBlock || diagnostic?.finalBlock || '',
            finalChars: Number(round?.finalChars || diagnostic?.finalChars) || 0
        };
    }

    function dateTime(value) {
        const number = Number(value) || 0;
        if (!number) return '时间未知';
        try { return new Date(number).toLocaleString(); }
        catch (_) { return '时间未知'; }
    }

    function renderRoundOptions(rounds, selectedId) {
        return rounds.slice(0, 20).map((round, index) => {
            const label = index === 0 ? `最近一轮 · ${dateTime(round.completedAt || round.createdAt)}` : `${dateTime(round.completedAt || round.createdAt)} · ${(round.items || []).length} 条`;
            return `<option value="${Core.escapeAttribute(round.id)}" ${round.id === selectedId ? 'selected' : ''}>${Core.escapeHtml(label)}</option>`;
        }).join('');
    }

    function renderSummaryTable(model) {
        if (!model.tables.length) return '<div class="memory-audit-empty">这一轮没有实际注入的结构化记忆。</div>';
        return `<div class="memory-audit-table-wrap"><table class="memory-audit-table memory-audit-table-summary">
            <thead><tr><th>来源表</th><th>引用</th><th>为什么引用</th><th>用于什么</th><th>相关度</th><th>反馈状态</th></tr></thead>
            <tbody>${model.tables.map(group => `<tr>
                <td data-label="来源表"><strong>${Core.escapeHtml(group.tableName)}</strong><small>${Core.escapeHtml(group.templateName)}</small></td>
                <td data-label="引用">${group.count} 条</td>
                <td data-label="为什么引用">${group.reasons.map(reason => `<span class="memory-audit-chip">${Core.escapeHtml(reason)}</span>`).join('')}</td>
                <td data-label="用于什么">${group.roles.map(role => `<span class="memory-audit-role">${Core.escapeHtml(role)}</span>`).join('')}</td>
                <td data-label="相关度"><b>${group.averageScore.toFixed(2)}</b></td>
                <td data-label="反馈状态"><span class="memory-audit-feedback-status">${group.pending ? `待反馈 ${group.pending}` : ''}${group.helpful ? `${group.pending ? ' · ' : ''}有帮助 ${group.helpful}` : ''}${group.negative ? `${group.pending || group.helpful ? ' · ' : ''}需调整 ${group.negative}` : ''}${!group.pending && !group.helpful && !group.negative ? '已处理' : ''}</span></td>
            </tr>`).join('')}</tbody>
        </table></div>`;
    }

    function renderFeedbackActions(round, item) {
        if (round?.isDiagnosticOnly) return '<span class="memory-audit-feedback-status">预览，发送后可反馈</span>';
        if (item.feedback !== 'pending') {
            return `<span class="memory-audit-feedback-badge ${item.feedbackTone}">${Core.escapeHtml(item.feedbackLabel)}</span><button class="memory-audit-text-action" data-feedback-action="reset_item" data-snapshot-id="${Core.escapeAttribute(round.id)}" data-feedback-item-id="${Core.escapeAttribute(item.id)}">重置</button>`;
        }
        return `<div class="memory-audit-feedback-primary">
            <button data-feedback-action="helpful" data-snapshot-id="${Core.escapeAttribute(round.id)}" data-feedback-item-id="${Core.escapeAttribute(item.id)}">有帮助</button>
            <button data-feedback-action="irrelevant" data-snapshot-id="${Core.escapeAttribute(round.id)}" data-feedback-item-id="${Core.escapeAttribute(item.id)}">无关</button>
            <button data-feedback-action="outdated" data-snapshot-id="${Core.escapeAttribute(round.id)}" data-feedback-item-id="${Core.escapeAttribute(item.id)}">过时</button>
            <button data-feedback-action="inaccurate" data-snapshot-id="${Core.escapeAttribute(round.id)}" data-feedback-item-id="${Core.escapeAttribute(item.id)}">不准确</button>
        </div><details class="memory-audit-feedback-more"><summary>更多处理</summary><div>
            <button data-feedback-action="block_scene" data-snapshot-id="${Core.escapeAttribute(round.id)}" data-feedback-item-id="${Core.escapeAttribute(item.id)}">禁用当前场景</button>
            <button data-feedback-action="no_proactive" data-snapshot-id="${Core.escapeAttribute(round.id)}" data-feedback-item-id="${Core.escapeAttribute(item.id)}">不要主动提</button>
            <button data-feedback-action="pause" data-snapshot-id="${Core.escapeAttribute(round.id)}" data-feedback-item-id="${Core.escapeAttribute(item.id)}">暂停使用</button>
            <button class="danger" data-feedback-action="forget" data-snapshot-id="${Core.escapeAttribute(round.id)}" data-feedback-item-id="${Core.escapeAttribute(item.id)}">忘记</button>
        </div></details>`;
    }

    function renderDetailTable(model) {
        if (!model.items.length) return '';
        return `<div class="memory-audit-table-wrap"><table class="memory-audit-table memory-audit-table-detail">
            <thead><tr><th>来源表</th><th>引用记录</th><th>引用原因</th><th>本轮作用</th><th>相关度</th><th>反馈</th></tr></thead>
            <tbody>${model.items.map(item => `<tr>
                <td data-label="来源表"><strong>${Core.escapeHtml(item.tableName || '未命名表')}</strong><small>${Core.escapeHtml(item.templateName || '')}</small></td>
                <td data-label="引用记录"><strong>${Core.escapeHtml(item.title)}</strong><p>${Core.escapeHtml(item.excerpt)}</p><small>${Core.escapeHtml(item.rowId || '')}</small></td>
                <td data-label="引用原因"><div class="memory-audit-reason-main">${Core.escapeHtml(item.reason.summary)}</div><div class="memory-audit-reason-list">${item.reason.details.slice(0, 5).map(reason => `<span>${Core.escapeHtml(reason)}</span>`).join('')}</div></td>
                <td data-label="本轮作用"><span class="memory-audit-role">${Core.escapeHtml(item.use.role)}</span><p>${Core.escapeHtml(item.use.directive)}</p></td>
                <td data-label="相关度"><b>${Number(item.score || 0).toFixed(2)}</b></td>
                <td data-label="反馈">${renderFeedbackActions(model.round, item)}</td>
            </tr>`).join('')}</tbody>
        </table></div>`;
    }

    function renderSettings(model) {
        const settings = model.feedbackState?.settings;
        if (!settings) return '';
        return `<details class="memory-audit-settings"><summary>召回与反馈策略</summary><div class="memory-audit-settings-grid">
            <label><span>无关后冷却轮数</span><input type="number" min="0" max="200" data-feedback-setting="irrelevantCooldownRounds" value="${settings.irrelevantCooldownRounds}"></label>
            <label><span>有用加权</span><input type="number" min="0" max="0.3" step="0.01" data-feedback-setting="helpfulBoost" value="${settings.helpfulBoost}"></label>
            <label><span>无关降权</span><input type="number" min="0" max="0.5" step="0.01" data-feedback-setting="irrelevantPenalty" value="${settings.irrelevantPenalty}"></label>
            <label><span>反馈有效天数</span><input type="number" min="1" max="90" data-feedback-setting="pendingFeedbackTtlDays" value="${settings.pendingFeedbackTtlDays}"></label>
            <label><span>最多待反馈轮次</span><input type="number" min="1" max="10" data-feedback-setting="maxPendingFeedbackRounds" value="${settings.maxPendingFeedbackRounds}"></label>
            <label><span>保留使用快照</span><input type="number" min="5" max="300" data-feedback-setting="maxRoundSnapshots" value="${settings.maxRoundSnapshots}"></label>
        </div></details>`;
    }

    function render(chat) {
        const model = getViewModel(chat);
        if (!model.round) {
            return `<div class="memory-audit-page"><header class="memory-audit-head"><div><h2>记忆引用与作用</h2><p>查看本轮引用了哪些记忆表、为什么引用，以及它们对回复承担的作用。</p></div><button class="btn btn-small btn-primary" data-action="retrieval-rebuild">更新索引并预览</button></header><div class="memory-audit-empty"><strong>还没有引用记录</strong><span>发送一次使用结构化记忆的聊天，或先重建召回预览。</span></div></div>`;
        }
        const context = model.queryContext || {};
        const modeLabel = model.round.actualMode === 'hybrid' ? '混合检索' : '关键词检索';
        return `<div class="memory-audit-page">
            <header class="memory-audit-head">
                <div><h2>记忆引用与作用</h2><p>先看引用了哪些表，再核对具体记录、引用原因和本轮作用。</p></div>
                <div class="memory-audit-head-actions"><button class="btn btn-small btn-primary" data-action="retrieval-rebuild">更新索引并预览</button><button class="btn btn-small btn-secondary" data-feedback-action="undo-last">撤销最近反馈</button>${model.totalPending ? `<button class="btn btn-small btn-neutral memory-audit-clear-pending" data-feedback-action="clear-pending-tasks">清空全部待反馈（${model.totalPending}）</button>` : ''}</div>
            </header>
            <div class="memory-audit-roundbar">
                <label><span>查看轮次</span><select data-memory-audit-round>${renderRoundOptions(model.rounds, model.round.id)}</select></label>
                <div class="memory-audit-roundmeta"><b>${dateTime(model.round.completedAt || model.round.createdAt)}</b><span>${modeLabel} · ${model.round.pureRead ? '纯读取 · ' : ''}${model.items.length} 条引用 · ${model.tables.length} 张表 · ${model.finalChars} 字符${model.round.indexCoverage ? ` · 索引 ${model.round.indexCoverage.indexed || 0}/${model.round.indexCoverage.candidates || 0}` : ''}</span></div>
            </div>
            <div class="memory-audit-context"><strong>本轮检索线索</strong><span>主题：${Core.escapeHtml((context.topic || []).join('、') || '未识别')}</span><span>场景：${Core.escapeHtml((context.scene || []).join('、') || '日常聊天')}</span><span>主体：${Core.escapeHtml((context.entity || []).join('、') || '未识别')}</span></div>
            <section class="memory-audit-section"><div class="memory-audit-section-head"><div><h3>引用表总览</h3><p>先确认本轮从哪些表取了记忆，以及每张表进入 Prompt 的原因和用途。</p></div><span>${model.pending} 项待反馈</span></div>${renderSummaryTable(model)}</section>
            <section class="memory-audit-section"><div class="memory-audit-section-head"><div><h3>引用记录明细</h3><p>反馈会直接用于后续相关性、冷却、时效和场景策略。</p></div></div>${renderDetailTable(model)}</section>
            <div class="memory-audit-technical">
                <details><summary>查看本轮检索文本</summary><pre>${Core.escapeHtml(model.queryText || '（空）')}</pre></details>
                <details><summary>查看最终注入 Prompt</summary><pre>${Core.escapeHtml(model.finalBlock || '（当前快照未保留完整注入文本）')}</pre></details>
                ${renderSettings(model)}
                <details><summary>维护操作</summary><div class="memory-audit-maintenance"><button class="btn btn-small btn-neutral" data-action="retrieval-clear-index">清除向量索引</button><button class="btn btn-small btn-neutral" data-action="retrieval-clear-diagnostic">清除召回快照</button><button class="btn btn-small btn-neutral" data-feedback-action="clear-reviewed-rounds">清理已反馈轮次</button><button class="btn btn-small btn-neutral" data-feedback-action="clear-expired-rounds">清理过期轮次</button></div></details>
            </div>
        </div>`;
    }

    Kernel.register('retrievalAudit', Object.freeze({
        VERSION,
        getAvailableRounds,
        getSelectedRound,
        setSelectedRound,
        getViewModel,
        buildTableSummary,
        reasonModel,
        effectLabel,
        render
    }));
})(window);
