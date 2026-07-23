(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Domain = Kernel.require('domain');
    const Policy = Kernel.require('policy');

    const ROLE_RELATIONS = Object.freeze({
        core: ['current', 'long'],
        current: ['core', 'observation', 'event', 'todo'],
        task: ['current', 'event', 'long'],
        event: ['current', 'observation', 'todo', 'medium'],
        observation: ['current', 'event'],
        medium: ['event', 'todo', 'long', 'observation', 'current', 'medium'],
        candidate: ['medium', 'candidate', 'long'],
        long: ['candidate', 'medium', 'core', 'long'],
        other: ['current', 'event', 'medium', 'long']
    });

    const ROLE_REASON = Object.freeze({
        core: '核对固定事实与边界',
        current: '核对当前状态与即时需求',
        todo: '核对承诺、待办和未完成事项',
        event: '核对近期经历与事件脉络',
        observation: '核对近期日常观察和身体状态',
        medium: '检查已有成长经验、重复和阶段变化',
        candidate: '检查待审核的长期候选',
        long: '检查稳定长期特征、重复和冲突',
        other: '提供相关结构化记忆'
    });

    function inferRole(table) {
        const name = String(table?.name || '');
        if (/核心|确认档案|固定档案/.test(name)) return 'core';
        if (/当前状态|即时状态|现状/.test(name)) return 'current';
        if (/待办|承诺|未完成|提醒/.test(name)) return 'todo';
        if (/近期经历|重要事件|经历|事件/.test(name)) return 'event';
        if (/日常观察|观察|健康记录/.test(name)) return 'observation';
        if (/中期|成长|经验/.test(name)) return 'medium';
        if (/候选|审核队列/.test(name)) return 'candidate';
        if (/稳定长期|长期特征|长期记忆/.test(name)) return 'long';
        const layer = Policy.normalizeTablePolicy(table).memoryLayer;
        if (layer === 'core') return 'core';
        if (layer === 'short') return 'current';
        if (layer === 'medium') return 'medium';
        if (layer === 'review') return 'candidate';
        if (layer === 'long') return 'long';
        return 'other';
    }

    function xml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function clip(value, limit = 320) {
        const text = String(value ?? '');
        return text.length > limit ? `${text.slice(0, Math.max(0, limit - 16))}…[已裁剪]` : text;
    }

    function rowTimestamp(table, row) {
        const direct = Number(row?.meta?.lastMentionedAt || row?.meta?.updatedAt || row?.meta?.createdAt) || 0;
        if (direct) return direct;
        let best = 0;
        (table?.columns || []).forEach(field => {
            if (!/时间|日期|更新|发生|创建|完成/.test(field.key || '')) return;
            best = Math.max(best, Policy.parseDateLike(row?.cells?.[field.id]) || 0);
        });
        return best;
    }

    function rowItem(table, row, index) {
        const searchText = Domain.getRowSearchText(table, row);
        const statusText = (table.columns || [])
            .filter(field => /状态|进度|结果/.test(field.key || ''))
            .map(field => Domain.getFieldDisplayValue(field, row?.cells?.[field.id]))
            .filter(Boolean).join(' ');
        return {
            id: row.id,
            row,
            table,
            rowIndex: index,
            searchText,
            text: searchText,
            updatedAt: rowTimestamp(table, row),
            createdAt: Number(row?.meta?.createdAt) || 0,
            importance: Number(row?.meta?.importance) || 50,
            pinned: !!row?.meta?.pinned,
            completed: Policy.isCompletedText(statusText),
            active: !Policy.isCompletedText(statusText)
        };
    }

    function renderRow(table, item, index) {
        const row = item.row;
        const fields = (table.columns || []).filter(field => {
            const value = row?.cells?.[field.id];
            return !Domain.isEmptyMemoryValue(field, value) && (field.important !== false || index < 2);
        }).slice(0, 8);
        const tags = row?.meta?.tagBundle || {};
        return `    <row id="${xml(row.id)}" relevance="${Number(item._score || 0).toFixed(2)}">\n${fields.map(field => `      <field name="${xml(field.key)}">${xml(clip(Domain.getFieldDisplayValue(field, row.cells?.[field.id]), 320))}</field>`).join('\n')}${(tags.topic || tags.scene || tags.entity) ? `\n      <existing_tags topic="${xml((tags.topic || []).join(','))}" scene="${xml((tags.scene || []).join(','))}" entity="${xml((tags.entity || []).join(','))}" effect="${xml(tags.effect || '')}"/>` : ''}\n    </row>`;
    }

    function renderKeyValue(chat, template, table) {
        const fields = (table.columns || []).filter(field => {
            const value = Domain.getFieldValue(chat, template.id, table.id, field);
            return !Domain.isEmptyMemoryValue(field, value) && field.important !== false;
        }).slice(0, 8);
        if (!fields.length) return '';
        return fields.map(field => `    <field id="${xml(field.id)}" name="${xml(field.key)}">${xml(clip(Domain.getFieldDisplayValue(field, Domain.getFieldValue(chat, template.id, table.id, field)), 360))}</field>`).join('\n');
    }

    function getDescriptors(chat) {
        return Domain.getBoundTemplates(chat).flatMap(template => (template.tables || []).map(table => ({ template, table, role: inferRole(table) })));
    }

    function assemble(options = {}) {
        const chat = options.chat;
        const targetTemplate = options.template;
        const targetTable = options.table;
        if (!chat || !targetTemplate || !targetTable) return { text: '', tables: [], rowCount: 0, chars: 0 };
        const queryText = String(options.queryText || Policy.buildQueryText(chat, 12) || '').slice(-16000);
        const targetRole = inferRole(targetTable);
        const allowedRoles = new Set(ROLE_RELATIONS[targetRole] || ROLE_RELATIONS.other);
        const maxTables = Math.max(1, Math.min(7, Number(options.maxTables) || 5));
        const topK = Math.max(1, Math.min(6, Number(options.topK) || 3));
        const budget = Math.max(1200, Math.min(16000, Number(options.budget) || 7200));
        const selectedTables = [];

        const relationOrder = ROLE_RELATIONS[targetRole] || ROLE_RELATIONS.other;
        getDescriptors(chat)
            .filter(descriptor => !(descriptor.template.id === targetTemplate.id && descriptor.table.id === targetTable.id) && allowedRoles.has(descriptor.role))
            .sort((a, b) => relationOrder.indexOf(a.role) - relationOrder.indexOf(b.role))
            .forEach(descriptor => {
            let body = '';
            let rowCount = 0;
            if (Domain.isRowsTable(descriptor.table)) {
                const items = Domain.getRows(chat, descriptor.template.id, descriptor.table).map((row, index) => rowItem(descriptor.table, row, index));
                if (!items.length) return;
                const selected = Policy.selectRelevantItems(items, queryText, {
                    mode: 'relevant', topK, threshold: 0.015, includeCompleted: true,
                    includePinned: true, maxAgeDays: 0, budget: Math.floor(budget / maxTables)
                });
                const fallback = items.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, Math.min(2, topK));
                const merged = new Map();
                [...selected, ...fallback].forEach(item => merged.set(item.id, item));
                const rows = Array.from(merged.values()).slice(0, topK);
                if (!rows.length) return;
                rowCount = rows.length;
                body = rows.map((item, index) => renderRow(descriptor.table, item, index)).join('\n');
            } else {
                body = renderKeyValue(chat, descriptor.template, descriptor.table);
                if (!body) return;
            }
            selectedTables.push({ ...descriptor, body, rowCount, reason: ROLE_REASON[descriptor.role] || ROLE_REASON.other });
        });

        const chunks = [];
        let used = 0;
        for (const item of selectedTables.slice(0, maxTables)) {
            const block = `  <table templateId="${xml(item.template.id)}" tableId="${xml(item.table.id)}" name="${xml(item.table.name)}" role="${xml(item.role)}" reason="${xml(item.reason)}">\n${item.body}\n  </table>`;
            if (used + block.length > budget) continue;
            chunks.push(block);
            used += block.length;
        }
        const text = chunks.length ? `<related_memory_tables targetRole="${xml(targetRole)}">\n${chunks.join('\n')}\n</related_memory_tables>` : '';
        const runtime = Policy.ensureRuntimeState(chat);
        runtime.lastUpdateContextDiagnostic = {
            version: '2.11-R1', preparedAt: Date.now(), targetTemplateId: targetTemplate.id,
            targetTableId: targetTable.id, targetRole, queryChars: queryText.length,
            tableCount: chunks.length, rowCount: selectedTables.slice(0, chunks.length).reduce((sum, item) => sum + item.rowCount, 0),
            tables: selectedTables.slice(0, chunks.length).map(item => ({ tableId: item.table.id, tableName: item.table.name, role: item.role, reason: item.reason, rowCount: item.rowCount })),
            chars: text.length
        };
        return { text, targetRole, tables: runtime.lastUpdateContextDiagnostic.tables, rowCount: runtime.lastUpdateContextDiagnostic.rowCount, chars: text.length };
    }

    Kernel.register('contextAssembler', Object.freeze({
        VERSION: '2.11-R1',
        inferRole,
        assemble,
        relationMap: ROLE_RELATIONS
    }), { legacyGlobal: 'MemoryContextAssembler' });
})(window);
