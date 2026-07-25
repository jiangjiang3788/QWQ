(function (global) {
    'use strict';

    const M = global.MemoryV5;
    if (!M?.model || !M?.rounds) throw new Error('MemoryV5 core and rounds must load before engine');

    const { clone, text, unique, localDateTimeSeconds, id, clampTitle } = M.util;
    const {
        ensureStore, findTable, visibleFields, getFieldValue, setFieldValue,
        resolveInputValues, recordMatches, identityMatch, normalizeRecord, persist
    } = M.model;
    const { roundText, roundPayload, queryTerms } = M.rounds;
    const sidecarReports = new WeakMap();

    function hasValue(value) {
        return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
    }

    function aiWritable(table) {
        return table?.behavior?.writePolicy === 'auto' && table?.behavior?.allowAiWrite === true;
    }

    function normalizeAction(value) {
        const action = text(value).toLowerCase();
        if (action === 'add' || action === 'create' || action === '新增') return 'add';
        if (action === 'upsert' || action === 'update' || action === '更新') return 'upsert';
        if (action === 'delete' || action === 'remove' || action === '删除') return 'delete';
        return 'upsert';
    }

    function operationValueObject(operation) {
        const values = operation?.values && typeof operation.values === 'object' && !Array.isArray(operation.values)
            ? clone(operation.values)
            : {};
        ['category', 'tags', 'title', 'content', 'source', 'time'].forEach(key => {
            if (Object.prototype.hasOwnProperty.call(operation || {}, key) && !Object.prototype.hasOwnProperty.call(values, key)) {
                values[key] = clone(operation[key]);
            }
        });
        return values;
    }

    function findTarget(rows, table, operation, resolved) {
        if (operation?.recordId) {
            const byId = rows.find(row => row.id === text(operation.recordId));
            if (byId) return byId;
        }
        if (operation?.match) {
            const byMatch = rows.find(row => recordMatches(row, table, operation.match));
            if (byMatch) return byMatch;
        }
        return rows.find(row => identityMatch(row, table, resolved)) || null;
    }

    function meaningfulResolved(resolved) {
        return Object.fromEntries(Object.entries(resolved || {}).filter(([fieldId, value]) => {
            if (fieldId === 'common_source' || fieldId === 'common_time') return false;
            return hasValue(value);
        }));
    }

    function applyOperations(chat, operations, options = {}) {
        const store = ensureStore(chat);
        const origin = options.origin || 'manual';
        const roundId = options.roundId || null;
        const changed = [];
        const checked = [];
        const rejected = [];

        (Array.isArray(operations) ? operations : []).forEach(operation => {
            const table = findTable(store, text(operation?.tableId));
            if (!table) {
                rejected.push({ operation, reason: '目标表不存在' });
                return;
            }

            if (origin === 'ai' && !aiWritable(table)) {
                rejected.push({ operation, reason: table.behavior.writePolicy === 'manual' ? '该表只允许用户手动更新' : '该表不允许聊天AI直接写入' });
                return;
            }
            if (origin === 'summary') {
                rejected.push({ operation, reason: '中期压缩将在V5.2启用' });
                return;
            }

            const action = normalizeAction(operation?.action);
            const rows = store.records[table.id] ||= [];
            if (action === 'delete') {
                if (origin === 'ai') {
                    rejected.push({ operation, reason: '聊天AI不能删除正式记忆' });
                    return;
                }
                const index = operation?.recordId
                    ? rows.findIndex(row => row.id === text(operation.recordId))
                    : rows.findIndex(row => recordMatches(row, table, operation?.match));
                if (index < 0) {
                    rejected.push({ operation, reason: '没有找到要删除的记录' });
                    return;
                }
                const [removed] = rows.splice(index, 1);
                changed.push({ tableId: table.id, recordId: removed.id, action: 'delete', fields: [] });
                return;
            }

            const resolved = resolveInputValues(table, operationValueObject(operation));
            const useful = meaningfulResolved(resolved);
            if (!Object.keys(useful).length) {
                rejected.push({ operation, reason: '操作中没有可写入的有效字段' });
                return;
            }

            const source = origin === 'manual'
                ? '用户明确'
                : (M.constants.SOURCES.has(text(operation?.source)) ? text(operation.source) : 'AI判断');
            const now = new Date();
            const stamp = now.toISOString();
            const localStamp = localDateTimeSeconds(now);
            resolved.common_source = source;
            resolved.common_time = localStamp;
            const target = action === 'add'
                ? findTarget(rows, table, operation, resolved)
                : findTarget(rows, table, operation, resolved);

            if (!target) {
                const record = normalizeRecord({
                    id: text(operation?.recordId) || id('memory_record'),
                    source,
                    time: localStamp,
                    createdAt: stamp,
                    updatedAt: stamp,
                    roundId,
                    changedFieldIds: []
                }, table);
                Object.entries(resolved).forEach(([fieldId, value]) => {
                    const field = table.fields.find(item => item.id === fieldId);
                    if (!field) return;
                    setFieldValue(record, field, value);
                    record.changedFieldIds.push(field.id);
                });
                if (!record.title && record.content) {
                    record.title = clampTitle(record.content);
                    record.changedFieldIds.push('common_title');
                }
                record.changedFieldIds = unique(record.changedFieldIds);
                rows.push(record);
                changed.push({ tableId: table.id, recordId: record.id, action: 'add', fields: clone(record.changedFieldIds) });
                return;
            }

            const changedFields = [];
            Object.entries(resolved).forEach(([fieldId, value]) => {
                const field = table.fields.find(item => item.id === fieldId);
                if (!field) return;
                const previous = getFieldValue(target, field);
                if (JSON.stringify(previous) === JSON.stringify(value)) return;
                setFieldValue(target, field, value);
                changedFields.push(field.id);
            });
            if (!changedFields.length) {
                checked.push({ tableId: table.id, recordId: target.id, action: 'checked' });
                return;
            }
            target.source = source;
            target.time = localStamp;
            target.updatedAt = stamp;
            target.roundId = roundId;
            target.changedFieldIds = unique(changedFields.concat(['common_source', 'common_time']));
            changed.push({ tableId: table.id, recordId: target.id, action: 'update', fields: clone(target.changedFieldIds) });
        });

        return { changed, checked, rejected };
    }

    function formatValue(field, value) {
        if (!hasValue(value)) return '';
        if (Array.isArray(value)) return value.join('、');
        if (field.type === 'boolean') return value ? '是' : '否';
        return String(value);
    }

    function formatRecordText(table, record, fields = null) {
        const selected = Array.isArray(fields) && fields.length
            ? fields.map(fieldId => table.fields.find(field => field.id === fieldId)).filter(Boolean)
            : visibleFields(table);
        return selected.map(field => {
            const value = formatValue(field, getFieldValue(record, field));
            return value ? `${field.name}: ${value}` : '';
        }).filter(Boolean).join('\n');
    }

    function normalizeSearch(value) {
        return text(value).toLowerCase().replace(/\s+/g, ' ');
    }

    function recordScore(query, terms, table, record, store) {
        const body = normalizeSearch(formatRecordText(table, record, table.behavior.contextFieldIds));
        const metadata = normalizeSearch(`${record.category} ${(record.tags || []).join(' ')} ${record.title}`);
        const alwaysTags = store?.settings?.tagBehaviors?.alwaysInject || [];
        let score = record.tags?.some(tag => alwaysTags.includes(tag)) ? 1000 : 0;
        terms.forEach(term => {
            if (metadata.includes(term)) score += 8;
            if (body.includes(term)) score += 2;
        });
        if (query && record.title && query.includes(normalizeSearch(record.title))) score += 20;
        return score;
    }

    function isExpired(table, record) {
        const days = Number(table.behavior.retentionDays) || 0;
        if (!days) return false;
        const stamp = new Date(record.updatedAt || record.createdAt || 0).getTime();
        return Number.isFinite(stamp) && Date.now() - stamp > days * 86400000;
    }

    function canInjectRecord(record, store) {
        const neverTags = store?.settings?.tagBehaviors?.neverInject || [];
        return !(record.tags || []).some(tag => neverTags.includes(tag));
    }

    function contextRecords(chat, table, store) {
        const rows = (store.records[table.id] || [])
            .filter(record => !isExpired(table, record) && canInjectRecord(record, store));
        if (table.behavior.contextPolicy === 'always') {
            return rows.sort((a, b) => text(b.updatedAt).localeCompare(text(a.updatedAt)));
        }
        if (table.behavior.contextPolicy !== 'relevant') return [];
        const query = normalizeSearch(roundText(chat, { includeAssistant: true }));
        const terms = queryTerms(query);
        if (!query) return [];
        const perTableLimit = table.id === 'v5_daily_observation'
            ? Math.min(3, store.settings.relevantMaxPerTable || 5)
            : (store.settings.relevantMaxPerTable || 5);
        return rows.map(record => ({ record, score: recordScore(query, terms, table, record, store) }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score || text(b.record.updatedAt).localeCompare(text(a.record.updatedAt)))
            .slice(0, perTableLimit)
            .map(item => item.record);
    }

    function getContextBlock(chat) {
        const store = ensureStore(chat);
        if (!store.settings.enabled) return '';
        const sections = [];
        let total = 0;
        const max = Math.max(1, Number(store.settings.contextMaxRecords) || 32);
        for (const table of store.tables) {
            if (total >= max) break;
            const rows = contextRecords(chat, table, store).slice(0, max - total);
            if (!rows.length) continue;
            total += rows.length;
            const content = rows.map(record => formatRecordText(table, record, table.behavior.contextFieldIds)).filter(Boolean).join('\n---\n');
            if (content) sections.push(`【${table.name}】\n${content}`);
        }
        if (!sections.length) return '';
        return `\n<structured_memory version="${M.VERSION}">\n${sections.join('\n\n')}\n</structured_memory>`;
    }

    function compact(value, max = 120) {
        const raw = Array.isArray(value) ? value.join('、') : text(value);
        return raw.length > max ? `${raw.slice(0, max)}…` : raw;
    }

    function candidateFieldIds(table) {
        return unique([].concat(table.behavior.identityFieldIds || [], table.behavior.contextFieldIds || []));
    }

    function candidateObject(table, record) {
        const values = {};
        candidateFieldIds(table).slice(0, 10).forEach(fieldId => {
            const field = table.fields.find(item => item.id === fieldId);
            if (!field) return;
            const value = getFieldValue(record, field);
            if (hasValue(value)) values[field.name] = compact(value);
        });
        return { recordId: record.id, updatedAt: record.updatedAt, values };
    }

    function candidateRecords(chat, table, store) {
        const rows = (store.records[table.id] || []).filter(record => !isExpired(table, record));
        if (!rows.length) return [];
        if (table.viewMode === 'kv') {
            return rows.sort((a, b) => text(b.updatedAt).localeCompare(text(a.updatedAt))).slice(0, 20);
        }
        const query = normalizeSearch(roundText(chat, { includeAssistant: false }));
        const terms = queryTerms(query);
        const limit = table.id === 'v5_daily_observation' ? 3 : 6;
        const scored = rows.map(record => ({ record, score: query ? recordScore(query, terms, table, record, store) : 0 }))
            .sort((a, b) => b.score - a.score || text(b.record.updatedAt).localeCompare(text(a.record.updatedAt)));
        const selected = scored.filter(item => item.score > 0).slice(0, limit).map(item => item.record);
        const recentFill = table.id === 'v5_daily_observation' ? limit : Math.min(2, limit);
        for (const item of scored) {
            if (selected.length >= Math.max(recentFill, limit)) break;
            if (!selected.includes(item.record) && (item.score > 0 || selected.length < recentFill)) selected.push(item.record);
        }
        return selected.slice(0, limit);
    }

    function fieldPrompt(field) {
        const options = field.options?.length ? `；选项=${field.options.join('/')}` : '';
        return `- ${field.name}（${field.type}${options}）：${field.aiHint || '按字段名称填写'}`;
    }

    function tablePrompt(chat, table, store) {
        const identityNames = (table.behavior.identityFieldIds || [])
            .map(fieldId => table.fields.find(field => field.id === fieldId)?.name)
            .filter(Boolean);
        const candidates = candidateRecords(chat, table, store).map(record => candidateObject(table, record));
        return `<memory_table id="${table.id}" name="${table.name}">
用途：${table.description || '未填写'}
提取规则：${table.extractPrompt || table.description || '根据本轮内容判断'}
分类提示：${table.categoryHints.join('、') || '无预设'}（AI${table.aiCanSupplementCategories ? '可以' : '不可以'}补充）
标签提示：${table.tagHints.join('、') || '无预设'}（AI${table.aiCanSupplementTags ? '可以' : '不可以'}补充）
同一记录判断字段：${identityNames.join('＋') || '优先使用recordId'}
字段：
${table.fields.filter(field => !field.hidden).map(fieldPrompt).join('\n')}
现有候选记录：${candidates.length ? JSON.stringify(candidates) : '[]'}
</memory_table>`;
    }

    function buildSystemPrompt(chat) {
        const store = ensureStore(chat);
        if (!store.settings.enabled) return '';
        const tables = store.tables.filter(aiWritable);
        if (!tables.length) return '';
        const currentRound = roundPayload(chat).filter(item => item.role === 'user');
        const roundJson = JSON.stringify(currentRound.slice(-20));
        return `\n<memory_v5_protocol version="${M.VERSION}">
你同时负责生成正常聊天回复和本轮结构化记忆更新。正常回复仍严格遵守原聊天格式；记忆指令不会展示给用户。

【一轮定义】
本轮包括：用户自上次AI回复后一次性发送的全部消息，以及你这次将一次性生成的全部回复消息。先完整决定本轮可见回复，再结合用户消息和你本轮形成的有效结论，统一判断记忆更新。
本轮用户消息批次：${roundJson}

【必须执行】
1. 逐张、独立检查下面每一张可自动写入的表。当前状态不能替代事项、想法、物品或日常观察；同一信息符合多表时可以产生多条操作。
2. 只有本轮出现新事实、新进展、新结论或真实状态变化才写入。旧值没有变化时不要重写，不要为了表示“检查过”而更新时间。
3. 更新旧记录时优先使用候选中的recordId并使用action="upsert"；独立新记录使用action="add"。找不到候选时不禁止新增。
4. 更新时只提交本轮变化的字段；不要把候选旧记录整行原样复制回来。新增时应尽量填写分类、标签、标题、内容以及表格要求的关键字段。
5. 分类和标签是用户定义提示，AI可以按表设置补充；它们不构成写入许可。标题不超过10个汉字。
6. 来源：用户直接说出的事实、决定、需求或观点写“用户明确”；由你归纳、判断或提出的理解写“AI判断”。不要把两者混为一条难以区分的记录。
7. 核心档案、稳定长期记忆和中期总结不在自动写入范围，禁止尝试修改或删除。聊天AI禁止删除任何正式记录。
8. 日常观察只记录本轮明确提到的内容，不补数字；现阶段只提供少量旧记录候选，不会发送几十条历史记录。
9. 即使没有更新，也必须在回复最末尾输出空操作标签。不要用Markdown代码块包裹。

【输出协议】
在所有正常可见聊天消息之后追加且只追加一次：
<memory_ops>{"operations":[{"tableId":"表ID","action":"add或upsert","recordId":"更新旧行时填写","source":"用户明确或AI判断","values":{"字段名":"字段值"}}]}</memory_ops>
无更新时输出：<memory_ops>{"operations":[]}</memory_ops>

${tables.map(table => tablePrompt(chat, table, store)).join('\n\n')}
</memory_v5_protocol>`;
    }

    function extractSidecar(responseText) {
        const source = String(responseText || '');
        const regex = /<memory_ops>([\s\S]*?)<\/memory_ops>/gi;
        const matches = Array.from(source.matchAll(regex));
        if (!matches.length) return { cleaned: source, payload: null, error: null };
        const cleaned = source.replace(regex, '').replace(/\n{3,}/g, '\n\n').trim();
        try {
            const payload = JSON.parse(matches[matches.length - 1][1].trim());
            if (!payload || typeof payload !== 'object') throw new Error('memory_ops必须是JSON对象');
            if (!Array.isArray(payload.operations) && Array.isArray(payload.memoryOps)) payload.operations = payload.memoryOps;
            if (!Array.isArray(payload.operations)) payload.operations = [];
            return { cleaned, payload, error: null };
        } catch (error) {
            return { cleaned, payload: null, error };
        }
    }

    function ensureSidecarState(chat) {
        ensureStore(chat);
        if (!sidecarReports.has(chat)) sidecarReports.set(chat, { lastApplyReport: null });
        return sidecarReports.get(chat);
    }

    function refreshMemoryUiIfOpen() {
        const screen = document.getElementById('memory-table-screen');
        if (screen?.classList.contains('active')) M.ui?.render?.();
    }

    function showRoundNotice(chat, report) {
        const store = ensureStore(chat);
        if (!store.settings.roundNoticeEnabled) return;
        let message = '';
        if (report.error) message = '本轮记忆：更新指令解析失败';
        else if (report.changed.length) message = '本轮记忆已更新；绿点表示本轮变化';
        else if (report.rejected.length) message = `本轮记忆：没有写入（${report.rejected[0]?.reason || '指令不合法'}）`;
        else message = '本轮记忆：没有需要更新的内容';
        if (typeof global.showToast === 'function') setTimeout(() => global.showToast(message), 0);
    }

    function completeRound(chat, details = {}) {
        const report = {
            at: Date.now(),
            changed: Array.isArray(details.changed) ? details.changed : [],
            checked: Array.isArray(details.checked) ? details.checked : [],
            rejected: Array.isArray(details.rejected) ? details.rejected : [],
            error: details.error ? String(details.error) : '',
            reason: text(details.reason),
            roundId: details.roundId || null
        };
        ensureSidecarState(chat).lastApplyReport = report;
        refreshStateBar(chat);
        refreshMemoryUiIfOpen();
        showRoundNotice(chat, report);
        return report;
    }

    async function applySidecar(chat, payload, options = {}) {
        const report = applyOperations(chat, payload?.operations || payload?.memoryOps || [], {
            origin: 'ai',
            roundId: options.roundId || id('memory_round')
        });
        if (report.changed.length) await persist(chat);
        return completeRound(chat, Object.assign({ roundId: options.roundId || null }, report));
    }

    function refreshStateBar(chat) {
        if (!chat) return;
        const store = ensureStore(chat);
        const table = store.tables.find(item => item.behavior.chatStatus === true);
        const element = document.getElementById('memory-table-state-bar');
        if (!element) return;
        if (!table) {
            element.textContent = '';
            element.classList.add('hidden');
            return;
        }
        const values = (store.records[table.id] || [])
            .filter(record => record.content)
            .sort((a, b) => text(b.updatedAt).localeCompare(text(a.updatedAt)))
            .slice(0, 4)
            .map(record => record.content);
        element.textContent = values.join(' · ');
        element.classList.toggle('hidden', !values.length);
    }

    async function runAggregation() {
        return { skipped: true, reason: '中期压缩将在V5.2启用', changed: [] };
    }

    async function runEligibleAggregations() {
        return [];
    }

    M.engine = Object.freeze({
        applyOperations,
        formatRecordText,
        getContextBlock,
        buildSystemPrompt,
        extractSidecar,
        ensureSidecarState,
        completeRound,
        applySidecar,
        refreshStateBar,
        runAggregation,
        runEligibleAggregations,
        candidateRecords
    });
})(window);
