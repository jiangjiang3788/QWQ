(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const latestCellCache = new WeakMap();

    function entries(chat) {
        return Array.isArray(chat?.memoryTables?.history) ? chat.memoryTables.history : [];
    }

    function tableCounts(entry) {
        const counts = new Map();
        (entry?.changedFields || []).forEach(change => {
            const tableId = String(change?.tableId || '');
            if (!tableId) return;
            counts.set(tableId, (counts.get(tableId) || 0) + 1);
        });
        return counts;
    }

    function latest(chat) {
        const entry = entries(chat)[0] || null;
        return { entry, counts: tableCounts(entry) };
    }

    function cellPath(templateId, tableId, fieldId, rowId = '') {
        return `${String(templateId || '')}::${String(tableId || '')}::${String(rowId || 'single')}::${String(fieldId || '')}`;
    }

    function latestCellPaths(chat) {
        const entry = entries(chat)[0] || null;
        if (chat && typeof chat === 'object') {
            const cached = latestCellCache.get(chat);
            if (cached?.entry === entry) return cached.paths;
        }
        const paths = new Set();
        (entry?.changedFields || []).forEach(change => {
            if (!change?.templateId || !change?.tableId || !change?.fieldId) return;
            paths.add(cellPath(change.templateId, change.tableId, change.fieldId, change.rowId));
        });
        if (chat && typeof chat === 'object') latestCellCache.set(chat, { entry, paths });
        return paths;
    }

    function isCellUpdated(chat, templateId, tableId, fieldId, rowId = '') {
        if (!templateId || !tableId || !fieldId) return false;
        return latestCellPaths(chat).has(cellPath(templateId, tableId, fieldId, rowId));
    }

    function cellAttributes(chat, templateId, tableId, fieldId, rowId = '') {
        if (!isCellUpdated(chat, templateId, tableId, fieldId, rowId)) return '';
        return ' data-memory-cell-updated="true" title="本次更新的单元格" aria-label="本次更新的单元格"';
    }

    function tableCellCount(chat, tableId) {
        const id = String(tableId || '');
        const paths = new Set();
        const entry = entries(chat)[0] || null;
        (entry?.changedFields || []).forEach(change => {
            if (String(change?.tableId || '') !== id || !change?.fieldId) return;
            paths.add(cellPath(change.templateId, change.tableId, change.fieldId, change.rowId));
        });
        return paths.size;
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
        if (/review/.test(value)) return '审核写入';
        if (/auto|task_queue/.test(value)) return '自动整理';
        if (/api|journal/.test(value)) return '模型整理';
        if (/undo/.test(value)) return '撤销编辑';
        return '手动编辑';
    }

    function tableSummary(entry, templates) {
        const names = new Map();
        (templates || []).forEach(template => (template.tables || []).forEach(table => names.set(table.id, table.name)));
        return Array.from(tableCounts(entry).entries()).map(([tableId, count]) => ({
            tableId,
            tableName: names.get(tableId) || '未知表格',
            count
        })).sort((a, b) => b.count - a.count || a.tableName.localeCompare(b.tableName, 'zh-CN'));
    }

    function formatTime(timestamp) {
        if (!timestamp) return '';
        try { return new Date(timestamp).toLocaleString(); } catch (_) { return String(timestamp); }
    }

    function badge(chat, tableId) {
        const current = latest(chat);
        const count = current.counts.get(String(tableId || '')) || 0;
        return count ? `<span class="memory-table-updated-badge">本次更新 ${count}</span>` : '';
    }

    function banner(chat, table, templates) {
        const current = latest(chat);
        const count = current.counts.get(String(table?.id || '')) || 0;
        if (!count || !current.entry) return '';
        const cells = tableCellCount(chat, table.id);
        return `<div class="memory-table-update-banner"><div><strong>本次更新了这张表，已标出具体单元格</strong><span>${cells} 个单元格 · ${Core.escapeHtml(sourceLabel(current.entry.source))} · ${Core.escapeHtml(formatTime(current.entry.timestamp))} · 绿色描边为本次变化</span></div><button type="button" class="btn btn-small btn-secondary" data-action="open-memory-update-history" data-table-id="${Core.escapeAttribute(table.id)}">查看历史</button></div>`;
    }

    Kernel.register('updateActivity', Object.freeze({
        VERSION: '2.12-R5.2',
        entries,
        tableCounts,
        latest,
        cellPath,
        latestCellPaths,
        isCellUpdated,
        cellAttributes,
        tableCellCount,
        forTable,
        latestForTable,
        tableSummary,
        sourceLabel,
        formatTime,
        badge,
        banner
    }));
})(window);
