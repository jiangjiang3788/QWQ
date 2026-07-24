// 结构化记忆：自动整理通道的展示模型。
(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel || null;
    const Core = Kernel?.core;
    const Policy = Kernel?.require('policy');
    const Resolver = Kernel?.get('policyResolver');
    if (!Core || !Policy) throw new Error('记忆调度依赖未加载');

    function getModeLabel(mode) {
        if (mode === 'sidecar') return '聊天同请求';
        if (mode === 'engine') return '跟随全局';
        if (mode === 'table') return '按表设置';
        return '仅手动';
    }

    function getStateLabel(mode, info, isDue) {
        if (mode === 'sidecar') return '不额外调用 API';
        if (mode === 'manual') return `未处理 ${info.unsyncedMessages} 条`;
        return isDue
            ? `已到期 · ${info.unsyncedRounds} 轮 / ${info.unsyncedMessages} 条`
            : `${info.unsyncedRounds} 轮 / ${info.unsyncedMessages} 条`;
    }

    function build(chat, descriptors, engine, options) {
        const isRunning = !!options?.isRunning;
        const rows = [];
        const stats = { dueCount: 0, eligibleCount: 0, maxUnsyncedMessages: 0, maxUnsyncedRounds: 0 };

        (descriptors || []).forEach(({ template, table }) => {
            const resolved = Resolver?.resolve ? Resolver.resolve(chat, template.id, table, { engineSettings: engine }) : null;
            const effectiveTable = resolved?.materializedTable || table;
            const info = Policy.getUnprocessedInfo(chat, template.id, effectiveTable);
            const automationMode = Policy.getAutomationMode(chat, template.id, effectiveTable);
            const effectivePolicy = resolved?.effective?.updatePolicy || Policy.resolveEffectiveUpdatePolicy(effectiveTable, engine, automationMode);
            const isDue = Policy.isTableDue(chat, template.id, table);
            stats.maxUnsyncedMessages = Math.max(stats.maxUnsyncedMessages, info.unsyncedMessages);
            stats.maxUnsyncedRounds = Math.max(stats.maxUnsyncedRounds, info.unsyncedRounds);
            if (effectivePolicy.enabled) stats.eligibleCount += 1;
            if (isDue) stats.dueCount += 1;
            rows.push(`
                <div class="memory-auto-schedule-row" data-schedule-key="${Core.escapeAttribute(`${template.id}::${table.id}`)}">
                    <div class="memory-auto-schedule-name"><strong>${Core.escapeHtml(table.name)}</strong><small>${Core.escapeHtml(template.name)} · ${Core.escapeHtml(getModeLabel(automationMode))} · 来源：${Core.escapeHtml(Resolver?.sourceLabel ? Resolver.sourceLabel(resolved?.sourceSummary?.schedule) : '模板默认')}</small></div>
                    <select data-memory-automation-mode data-template-id="${Core.escapeAttribute(template.id)}" data-table-id="${Core.escapeAttribute(table.id)}" ${isRunning ? 'disabled' : ''}>
                        <option value="sidecar" ${automationMode === 'sidecar' ? 'selected' : ''}>聊天同请求</option>
                        <option value="engine" ${automationMode === 'engine' ? 'selected' : ''}>跟随全局</option>
                        <option value="table" ${automationMode === 'table' ? 'selected' : ''}>按表设置</option>
                        <option value="manual" ${automationMode === 'manual' ? 'selected' : ''}>仅手动</option>
                    </select>
                    <span class="memory-auto-schedule-state ${isDue ? 'is-due' : ''}">${Core.escapeHtml(getStateLabel(automationMode, info, isDue))}</span>
                </div>`);
        });

        return {
            ...stats,
            html: rows.join('') || '<div class="memory-auto-schedule-empty">暂无可配置表格</div>'
        };
    }

    Kernel.register('schedule', Object.freeze({ VERSION: '2.14-R5', getModeLabel, getStateLabel, build }));
})(window);
