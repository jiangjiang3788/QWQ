(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const VERSION = '2.14-R6';

    function create(env = {}) {
        const {
            MemoryFeedback, MemoryPolicy, MemoryRetrieval, MemoryRetrievalMaintenance, MemorySidecar, ensureMemoryTableState,
            getBoundTemplates, getFieldDefaultValue, getFieldDisplayValue, getRowSearchText, getRowTimestamp, getTableRuntimePolicy,
            isEmptyMemoryValue, isRowsTable, normalizeFieldValue, renderMemoryTableScreen, saveCharacter, selectMemoryView
        } = env;

        function getRowStatusText(table, row) {
            return (table.columns || [])
                .filter(field => /状态|进度|结果/.test(field.key || ''))
                .map(field => getFieldDisplayValue(field, row.cells?.[field.id]))
                .filter(Boolean)
                .join(' ');
        }
        function readRowsForRetrieval(chat, templateId, table) {
            const rows = chat?.memoryTables?.data?.[templateId]?.[table.id]?.__rows;
            return Array.isArray(rows) ? rows : [];
        }
        function readFieldValueForRetrieval(chat, templateId, tableId, field) {
            const raw = chat?.memoryTables?.data?.[templateId]?.[tableId]?.[field.id];
            return raw === undefined ? getFieldDefaultValue(field) : normalizeFieldValue(field, raw);
        }
        function rowToRetrievalItem(table, row, rowIndex) {
            const searchText = getRowSearchText(table, row);
            const statusText = getRowStatusText(table, row);
            const expiresAt = Number(row?.meta?.expiresAt) || 0;
            const completed = MemoryPolicy ? MemoryPolicy.isCompletedText(statusText) : /已完成|已取消|已过期|已解决/.test(statusText);
            return { id: row.id, row, table, rowIndex, searchText, text: searchText, updatedAt: getRowTimestamp(table, row),
                createdAt: Number(row?.meta?.createdAt) || 0, importance: Number(row?.meta?.importance) || 50,
                confidence: Number(row?.meta?.confidence) || 70, pinned: !!row?.meta?.pinned,
                completed, active: !completed && !(expiresAt > 0 && expiresAt < Date.now()), expiredByMeta: expiresAt > 0 && expiresAt < Date.now() };
        }
        function isKeyValueTableActive(chat, template, table, policy) {
            if (!policy.maxAgeDays) return true;
            let newest = 0, explicitExpiry = 0;
            (table.columns || []).forEach(field => {
                const value = readFieldValueForRetrieval(chat, template.id, table.id, field);
                if (/有效期|过期/.test(field.key || '')) explicitExpiry = Math.max(explicitExpiry, MemoryPolicy ? MemoryPolicy.parseDateLike(value) : Date.parse(String(value || '')) || 0);
                if (/记录时间|更新时间|日期|时间/.test(field.key || '')) newest = Math.max(newest, MemoryPolicy ? MemoryPolicy.parseDateLike(value) : Date.parse(String(value || '')) || 0);
            });
            if (explicitExpiry && explicitExpiry < Date.now()) return false;
            return !newest || (Date.now() - newest) <= policy.maxAgeDays * 86400000;
        }
        function selectRowsForInjection(chat, template, table, queryText, forceFull) {
            const rows = readRowsForRetrieval(chat, template.id, table);
            const items = rows.map((row, rowIndex) => rowToRetrievalItem(table, row, rowIndex));
            if (forceFull) return items;
            const policy = getTableRuntimePolicy(table, chat, template.id).injectionPolicy;
            if (policy.mode === 'never') return [];
            if (policy.mode === 'always') return policy.topK > 0 ? items.slice(-policy.topK).reverse() : items;
            if (policy.mode === 'active') {
                const active = items.filter(item => item.active || item.pinned).sort((a, b) => !!a.pinned !== !!b.pinned ? (a.pinned ? -1 : 1) : (b.importance !== a.importance ? b.importance - a.importance : (b.updatedAt || 0) - (a.updatedAt || 0)));
                return policy.topK > 0 ? active.slice(0, policy.topK) : active;
            }
            if (!MemoryPolicy) return items.slice(0, policy.topK || 5);
            const runtime = MemoryPolicy.ensureRuntimeState(chat);
            const prepared = runtime?.preparedSelectionQuery === queryText ? runtime.preparedSelections?.[`${template.id}::${table.id}`] : null;
            if (!Array.isArray(prepared)) return MemoryPolicy.selectRelevantItems(items, queryText, policy);
            const byId = new Map(items.map(item => [item.id, item]));
            return prepared.map(hit => {
                const item = byId.get(hit.id);
                return item ? { ...item, _score: Number(hit.score) || 0, _lexicalScore: Number(hit.lexicalScore) || 0,
                    _semanticScore: Number(hit.semanticScore) || 0, _tagScore: Number(hit.tagScore) || 0,
                    _reasons: Array.isArray(hit.reasons) ? hit.reasons : [], _effectMode: hit.effectMode || '',
                    _tagBundle: hit.tags || null, _usePolicy: hit.usePolicy || null, _directive: hit.directive || '' } : null;
            }).filter(Boolean);
        }
        function buildSingleTableContext(chat, template, table, queryText, options = {}) {
            const injectionPolicy = getTableRuntimePolicy(table, chat, template.id).injectionPolicy;
            const forceFull = !!options.forceFull;
            if (!forceFull && injectionPolicy.mode === 'never') return '';
            let text = `- ${table.name}\n`;
            if (isRowsTable(table)) {
                const selected = selectRowsForInjection(chat, template, table, queryText, forceFull);
                if (!selected.length) return '';
                selected.forEach((item, selectedIndex) => {
                    text += `  - 记录 ${selectedIndex + 1}${item._score !== undefined ? `（相关度 ${item._score.toFixed(2)}）` : ''}\n`;
                    (table.columns || []).filter(field => forceFull || field.important !== false).forEach(field => {
                        const raw = item.row.cells?.[field.id];
                        if (!isEmptyMemoryValue(field, raw)) text += `    - ${field.summaryLabel || field.key}: ${getFieldDisplayValue(field, raw)}\n`;
                    });
                });
            } else {
                if (!forceFull && injectionPolicy.mode === 'active' && !isKeyValueTableActive(chat, template, table, injectionPolicy)) return '';
                const fields = (table.columns || []).filter(field => forceFull || field.important !== false).filter(field => !isEmptyMemoryValue(field, readFieldValueForRetrieval(chat, template.id, table.id, field)));
                if (!fields.length) return '';
                if (!forceFull && injectionPolicy.mode === 'relevant' && MemoryPolicy) {
                    const aggregate = fields.map(field => `${field.key}: ${getFieldDisplayValue(field, readFieldValueForRetrieval(chat, template.id, table.id, field))}`).join('\n');
                    if (MemoryPolicy.computeLexicalScore(aggregate, queryText) < injectionPolicy.threshold) return '';
                }
                fields.forEach(field => { text += `  - ${field.summaryLabel || field.key}: ${getFieldDisplayValue(field, readFieldValueForRetrieval(chat, template.id, table.id, field))}\n`; });
            }
            return MemoryPolicy ? MemoryPolicy.trimToBudget(text.trim(), injectionPolicy.budget, table.name) : text.trim();
        }
        function getMemoryContextBlock(chat, options = {}) {
            ensureMemoryTableState(chat);
            const allowInactiveMode = !!options.allowInactiveMode;
            if (chat.memoryTables?.enabled === false || (chat.memoryMode !== 'table' && !options.force && !allowInactiveMode)) return '';
            const templateIds = Array.isArray(options.templateIds) && options.templateIds.length ? options.templateIds : null;
            const templates = getBoundTemplates(chat).filter(template => !templateIds || templateIds.includes(template.id));
            if (!templates.length) return '';
            const forceFull = !!options.force;
            const queryText = options.queryText || (MemoryPolicy ? MemoryPolicy.buildQueryText(chat) : '');
            const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
            if (!forceFull && runtime?.lastContextBlock && runtime.lastPreparedQuery === queryText) return runtime.lastContextBlock;
            const sections = templates.map(template => {
                const tables = (template.tables || []).filter(table => forceFull || !(MemorySidecar && MemorySidecar.isLiveTable(table)))
                    .map(table => buildSingleTableContext(chat, template, table, queryText, { forceFull })).filter(Boolean);
                return tables.length ? `《${template.name}》\n${tables.join('\n')}` : '';
            }).filter(Boolean);
            if (!sections.length) return '';
            const header = forceFull ? '【结构化记忆完整档案】\n以下是选中模板的完整结构化数据，仅用于整理或转换。' : '【结构化记忆·按需检索】\n以下内容由固定、有效或与当前话题相关的档案条目组成。未出现的内容不要擅自补全。';
            let block = `${header}\n\n${sections.join('\n\n')}`.trim();
            if (!forceFull && MemoryPolicy) {
                block = MemoryPolicy.trimToBudget(block, runtime.engineSettings.globalInjectionBudget, '结构化记忆');
                Object.assign(runtime, { lastContextBlock: block, lastPreparedQuery: queryText, lastPreparedAt: Date.now() });
            }
            return block;
        }
        function collectRelevantRetrievalGroups(chat) {
            const groups = [];
            getBoundTemplates(chat).forEach(template => (template.tables || []).forEach(table => {
                if ((MemorySidecar && MemorySidecar.isLiveTable(table)) || !isRowsTable(table)) return;
                const policy = getTableRuntimePolicy(table, chat, template.id).injectionPolicy;
                if (policy.mode !== 'relevant') return;
                groups.push({ key: `${template.id}::${table.id}`, templateName: template.name, tableName: table.name, policy,
                    items: readRowsForRetrieval(chat, template.id, table).map((row, rowIndex) => rowToRetrievalItem(table, row, rowIndex)) });
            }));
            return groups;
        }
        async function prepareMemoryTableContext(chat, options = {}) {
            ensureMemoryTableState(chat);
            const allowInactiveMode = !!options.allowInactiveMode;
            if (chat.memoryTables?.enabled === false || (chat.memoryMode !== 'table' && !options.force && !options.preview && !allowInactiveMode)) return '';
            const queryText = options.queryText || (MemoryPolicy ? MemoryPolicy.buildQueryText(chat) : '');
            const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
            if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
            if (MemoryRetrieval && MemoryPolicy && queryText.trim()) {
                const prepared = await MemoryRetrieval.prepareGroups(chat, collectRelevantRetrievalGroups(chat), queryText, runtime.engineSettings, {
                    indexSnapshot: MemoryRetrievalMaintenance?.getIndexSnapshot?.(chat), usageSnapshot: MemoryRetrievalMaintenance?.getUsageSnapshot?.(chat)
                });
                Object.assign(runtime, { preparedSelections: prepared.selectedByTable || {}, preparedSelectionQuery: queryText, lastRetrievalDiagnostic: prepared.diagnostic || null });
            }
            const block = getMemoryContextBlock(chat, { ...options, queryText });
            let runtimeChanged = false;
            if (runtime?.lastRetrievalDiagnostic) {
                Object.assign(runtime.lastRetrievalDiagnostic, { finalBlock: block, finalChars: String(block || '').length });
                if (!options.preview && !options.force) {
                    const roundId = runtime.activeRound?.id || runtime.lastRoundId || '';
                    const usage = MemoryRetrievalMaintenance?.recordUsage?.(chat, runtime.lastRetrievalDiagnostic, block, { roundId, roundIndex: runtime.rounds?.length || 0 });
                    runtimeChanged = !!usage?.changed;
                    if (MemoryFeedback?.captureInjection?.(chat, runtime.lastRetrievalDiagnostic, { queryText, roundId, finalBlock: block })) runtimeChanged = true;
                }
            }
            if (runtimeChanged && typeof saveCharacter === 'function') Promise.resolve(saveCharacter(chat.id)).catch(error => console.warn('[MemoryTable] failed to persist retrieval runtime:', error));
            return block;
        }
        function clearMemoryTableRetrievalIndex(chat) {
            if (!chat) return 0;
            const cleared = MemoryRetrievalMaintenance?.clearIndex?.(chat) || 0;
            if (MemoryPolicy) { MemoryPolicy.clearRetrievalCache(chat); MemoryPolicy.ensureRuntimeState(chat).lastRetrievalDiagnostic = null; }
            return cleared;
        }
        async function rebuildMemoryTableRetrievalPreview(chat) {
            if (!chat) return { block: '', indexReport: null };
            if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
            const indexReport = await MemoryRetrievalMaintenance?.rebuildIndex?.(chat, collectRelevantRetrievalGroups(chat));
            const block = await prepareMemoryTableContext(chat, { preview: true });
            await saveCharacter(chat.id);
            selectMemoryView(chat, 'usage_audit');
            renderMemoryTableScreen();
            return { block, indexReport };
        }

        return Object.freeze({
            VERSION,
            rowToRetrievalItem, getMemoryContextBlock, collectRelevantRetrievalGroups, prepareMemoryTableContext, clearMemoryTableRetrievalIndex,
            rebuildMemoryTableRetrievalPreview
        });
    }

    Kernel.register('retrievalOrchestrator', Object.freeze({ VERSION, create }));
})(window);
