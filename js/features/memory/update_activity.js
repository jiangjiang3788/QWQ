(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const latestCellCache = new WeakMap();

    function entries(chat) {
        return Array.isArray(chat?.memoryTables?.history) ? chat.memoryTables.history : [];
    }

    function activityScope(chat) {
        const state = chat?.memoryTables;
        if (!state || !Object.prototype.hasOwnProperty.call(state, 'updateActivityScope')) return undefined;
        const scope = state.updateActivityScope;
        return scope && typeof scope === 'object' ? scope : null;
    }

    function currentEntries(chat) {
        const history = entries(chat);
        const scope = activityScope(chat);
        // 兼容没有经过状态迁移的旧对象；真实聊天状态会显式初始化为 null，避免旧批次冒充本轮更新。
        if (scope === undefined) return history.slice(0, 1);
        if (!scope) return [];
        if (scope.type === 'round' && scope.roundId) {
            const roundId = String(scope.roundId);
            return history.filter(entry => String(entry?.roundId || '') === roundId);
        }
        if (scope.type === 'history' && scope.historyId) {
            const target = history.find(entry => String(entry?.id || '') === String(scope.historyId));
            return target ? [target] : [];
        }
        return [];
    }

    function recordPath(change) {
        const templateId = String(change?.templateId || '');
        const tableId = String(change?.tableId || '');
        if (!tableId) return '';
        return `${templateId}::${tableId}::${String(change?.rowId || 'single')}`;
    }

    function recordCount(changes) {
        const records = new Set();
        (Array.isArray(changes) ? changes : []).forEach(change => {
            const path = recordPath(change);
            if (path) records.add(path);
        });
        return records.size;
    }

    function tableCounts(entry) {
        const recordsByTable = new Map();
        (entry?.changedFields || []).forEach(change => {
            const tableId = String(change?.tableId || '');
            const path = recordPath(change);
            if (!tableId || !path) return;
            if (!recordsByTable.has(tableId)) recordsByTable.set(tableId, new Set());
            recordsByTable.get(tableId).add(path);
        });
        return new Map(Array.from(recordsByTable.entries()).map(([tableId, records]) => [tableId, records.size]));
    }

    function tableFieldCounts(entry) {
        const fieldsByTable = new Map();
        (entry?.changedFields || []).forEach(change => {
            const tableId = String(change?.tableId || '');
            if (!tableId) return;
            fieldsByTable.set(tableId, (fieldsByTable.get(tableId) || 0) + 1);
        });
        return fieldsByTable;
    }

    function aggregateActivity(activityEntries) {
        if (!activityEntries.length) return null;
        const sources = Array.from(new Set(activityEntries.map(entry => String(entry?.source || 'manual'))));
        return {
            id: activityEntries.map(entry => entry?.id || '').filter(Boolean).join('|'),
            timestamp: Math.max(...activityEntries.map(entry => Number(entry?.timestamp) || 0)),
            source: sources.length === 1 ? sources[0] : 'mixed',
            roundId: activityEntries.find(entry => entry?.roundId)?.roundId || null,
            changedFields: activityEntries.flatMap(entry => Array.isArray(entry?.changedFields) ? entry.changedFields : [])
        };
    }

    function latest(chat) {
        const entry = aggregateActivity(currentEntries(chat));
        return { entry, counts: tableCounts(entry), fieldCounts: tableFieldCounts(entry) };
    }

    function cellPath(templateId, tableId, fieldId, rowId = '') {
        return `${String(templateId || '')}::${String(tableId || '')}::${String(rowId || 'single')}::${String(fieldId || '')}`;
    }

    function latestCellPaths(chat) {
        const activeEntries = currentEntries(chat);
        const cacheKey = activeEntries.map(entry => `${entry?.id || ''}:${(entry?.changedFields || []).length}`).join('|');
        if (chat && typeof chat === 'object') {
            const cached = latestCellCache.get(chat);
            if (cached?.key === cacheKey) return cached.paths;
        }
        const paths = new Set();
        activeEntries.forEach(entry => (entry?.changedFields || []).forEach(change => {
            if (!change?.templateId || !change?.tableId || !change?.fieldId) return;
            paths.add(cellPath(change.templateId, change.tableId, change.fieldId, change.rowId));
        }));
        if (chat && typeof chat === 'object') latestCellCache.set(chat, { key: cacheKey, paths });
        return paths;
    }

    function isCellUpdated(chat, templateId, tableId, fieldId, rowId = '') {
        if (!templateId || !tableId || !fieldId) return false;
        return latestCellPaths(chat).has(cellPath(templateId, tableId, fieldId, rowId));
    }

    function latestCellChange(chat, templateId, tableId, fieldId, rowId = '') {
        const target = cellPath(templateId, tableId, fieldId, rowId);
        const activityEntries = currentEntries(chat);
        for (const entry of activityEntries) {
            const change = (entry?.changedFields || []).find(item => cellPath(item.templateId, item.tableId, item.fieldId, item.rowId) === target);
            if (change) return change;
        }
        return null;
    }

    function cellAttributes(chat, templateId, tableId, fieldId, rowId = '') {
        const change = latestCellChange(chat, templateId, tableId, fieldId, rowId);
        if (!change) return '';
        const runtime = change.runtime === true || change.storage === 'runtime';
        const refreshed = change.refreshed === true;
        const label = refreshed
            ? (runtime ? '本轮重新确认的 AI 运行态判断' : '本轮重新确认的正式档案字段')
            : (runtime ? '本次更新的 AI 运行态判断' : '本次更新的正式档案单元格');
        return ` data-memory-cell-updated="true"${runtime ? ' data-memory-cell-runtime="true"' : ''} title="${Core.escapeAttribute(label)}" aria-label="${Core.escapeAttribute(label)}"`;
    }

    function tableCellCount(chat, tableId) {
        const id = String(tableId || '');
        const paths = new Set();
        const entry = latest(chat).entry;
        (entry?.changedFields || []).forEach(change => {
            if (String(change?.tableId || '') !== id || !change?.fieldId) return;
            paths.add(cellPath(change.templateId, change.tableId, change.fieldId, change.rowId));
        });
        return paths.size;
    }

    function tableRecordCount(chat, tableId) {
        return latest(chat).counts.get(String(tableId || '')) || 0;
    }

    function forTable(chat, tableId) {
        const id = String(tableId || '');
        return entries(chat).filter(entry => (entry.changedFields || []).some(change => String(change?.tableId || '') === id));
    }

    function latestForTable(chat, tableId) {
        return forTable(chat, tableId)[0] || null;
    }

    function sourceLabel(source) {
        const value = String(source || 'manual');
        if (value === 'mixed') return '多来源写入';
        if (/review/.test(value)) return '审核写入';
        if (/sidecar/.test(value)) return '聊天状态更新';
        if (/auto|task_queue/.test(value)) return '自动整理';
        if (/api|journal/.test(value)) return '模型整理';
        if (/undo/.test(value)) return '撤销编辑';
        return '手动编辑';
    }

    function tableSummary(entry, templates) {
        const names = new Map();
        (templates || []).forEach(template => (template.tables || []).forEach(table => names.set(table.id, table.name)));
        const recordCounts = tableCounts(entry);
        const fieldCounts = tableFieldCounts(entry);
        return Array.from(recordCounts.entries()).map(([tableId, count]) => ({
            tableId,
            tableName: names.get(tableId) || '未知表格',
            count,
            fieldCount: fieldCounts.get(tableId) || 0
        })).sort((a, b) => b.count - a.count || b.fieldCount - a.fieldCount || a.tableName.localeCompare(b.tableName, 'zh-CN'));
    }

    function formatTime(timestamp) {
        if (!timestamp) return '';
        try { return new Date(timestamp).toLocaleString(); } catch (_) { return String(timestamp); }
    }

    function badge(chat, tableId) {
        const count = tableRecordCount(chat, tableId);
        return count ? `<span class="memory-table-updated-badge">本次更新 ${count} 条</span>` : '';
    }

    function banner(chat, table, templates) {
        const current = latest(chat);
        const records = current.counts.get(String(table?.id || '')) || 0;
        if (!records || !current.entry) return '';
        const cells = tableCellCount(chat, table.id);
        const runtimeCells = (current.entry.changedFields || []).filter(change => String(change?.tableId || '') === String(table?.id || '') && (change.runtime === true || change.storage === 'runtime')).length;
        const refreshedCells = (current.entry.changedFields || []).filter(change => String(change?.tableId || '') === String(table?.id || '') && change.refreshed === true).length;
        const runtimeText = runtimeCells ? ` · 其中 ${runtimeCells} 个为 AI 运行态判断` : '';
        const refreshedText = refreshedCells ? ` · ${refreshedCells} 个为本轮重新确认` : '';
        return `<div class="memory-table-update-banner"><div><strong>本次更新了 ${records} 条记忆，已标出具体单元格</strong><span>${cells} 个单元格${runtimeText}${refreshedText} · ${Core.escapeHtml(sourceLabel(current.entry.source))} · ${Core.escapeHtml(formatTime(current.entry.timestamp))} · 绿色描边为本轮变化或确认</span></div><button type="button" class="btn btn-small btn-secondary" data-action="open-memory-update-history" data-table-id="${Core.escapeAttribute(table.id)}">查看历史</button></div>`;
    }

    Kernel.register('updateActivity', Object.freeze({
        VERSION: '2.13-R5.1',
        entries,
        activityScope,
        currentEntries,
        recordPath,
        recordCount,
        tableCounts,
        tableFieldCounts,
        latest,
        cellPath,
        latestCellPaths,
        isCellUpdated,
        latestCellChange,
        cellAttributes,
        tableCellCount,
        tableRecordCount,
        forTable,
        latestForTable,
        tableSummary,
        sourceLabel,
        formatTime,
        badge,
        banner
    }));
})(window);
