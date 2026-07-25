(function (global) {
    'use strict';

    const M = global.MemoryV5;
    if (!M?.model || !M?.rounds) throw new Error('MemoryV5 core and rounds must load before engine');

    const { clone, text, unique, localDateTimeSeconds, id, clampTitle } = M.util;
    const {
        ensureStore, findTable, visibleFields, getFieldValue, setFieldValue,
        normalizeFieldInput, fieldValuesEqual, resolveInputValues, recordMatches, identityMatch, normalizeRecord, persist
    } = M.model;
    const { roundText, roundPayload, queryTerms } = M.rounds;
    const sidecarReports = new WeakMap();

    function hasValue(value) {
        return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
    }

    const AI_PROTECTED_GROUPS = new Set(['core', 'medium', 'long']);
    const AI_PROTECTED_TABLE_IDS = new Set(['v5_core_profile', 'v5_event_summary', 'v5_thought_summary', 'v5_stable_long_term']);
    const SUMMARY_TARGETS = Object.freeze({ v5_recent_events: 'v5_event_summary', v5_thoughts: 'v5_thought_summary' });
    const OPERATION_KEYS = new Set(['tableId', 'action', 'recordId', 'source', 'values', 'match']);
    const PAYLOAD_KEYS = new Set(['operations', 'memoryOps']);

    function aiWritable(table) {
        return !!table
            && !AI_PROTECTED_GROUPS.has(table.group)
            && !AI_PROTECTED_TABLE_IDS.has(table.id)
            && table.behavior?.writePolicy === 'auto'
            && table.behavior?.allowAiWrite === true;
    }

    function normalizeAction(value) {
        const action = text(value).toLowerCase();
        if (action === 'add' || action === 'create' || action === '新增') return 'add';
        if (action === 'upsert' || action === 'update' || action === '更新') return 'upsert';
        if (action === 'delete' || action === 'remove' || action === '删除') return 'delete';
        return '';
    }

    function plainObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function validateSidecarPayload(payload) {
        if (!plainObject(payload)) throw new Error('memory_ops必须是JSON对象');
        const unknownPayloadKeys = Object.keys(payload).filter(key => !PAYLOAD_KEYS.has(key));
        if (unknownPayloadKeys.length) throw new Error(`memory_ops包含未知字段：${unknownPayloadKeys.join('、')}`);
        const operations = Array.isArray(payload.operations) ? payload.operations : payload.memoryOps;
        if (!Array.isArray(operations)) throw new Error('memory_ops.operations必须是数组');
        if (operations.length > 50) throw new Error('单轮memory_ops最多允许50项操作');
        operations.forEach((operation, index) => {
            if (!plainObject(operation)) throw new Error(`第${index + 1}项操作必须是JSON对象`);
            const unknownKeys = Object.keys(operation).filter(key => !OPERATION_KEYS.has(key));
            if (unknownKeys.length) throw new Error(`第${index + 1}项操作包含未知字段：${unknownKeys.join('、')}`);
            if (!text(operation.tableId)) throw new Error(`第${index + 1}项操作缺少tableId`);
            const action = normalizeAction(operation.action);
            if (!action) throw new Error(`第${index + 1}项操作action无效`);
            if (operation.recordId != null && typeof operation.recordId !== 'string') throw new Error(`第${index + 1}项recordId必须是字符串`);
            if (operation.source != null && !M.constants.SOURCES.has(text(operation.source))) throw new Error(`第${index + 1}项source无效`);
            if (action === 'add' || action === 'upsert') {
                if (!plainObject(operation.values)) throw new Error(`第${index + 1}项${action}操作必须提供values对象`);
            }
            if (operation.match != null && !plainObject(operation.match)) throw new Error(`第${index + 1}项match必须是对象`);
        });
        return { operations: clone(operations) };
    }

    function operationValueObject(operation) {
        const values = operation?.values && typeof operation.values === 'object' && !Array.isArray(operation.values)
            ? clone(operation.values)
            : {};
        ['category', 'tags', 'title', 'content'].forEach(key => {
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

    function acceptedInputKeys(table) {
        const keys = new Set();
        table.fields.forEach(field => {
            keys.add(field.id);
            keys.add(field.name);
            if (field.scope === 'common') keys.add(field.commonKey);
        });
        return keys;
    }

    function prepareResolvedValues(table, operation) {
        const raw = operationValueObject(operation);
        const accepted = acceptedInputKeys(table);
        const unknown = Object.keys(raw).filter(key => !accepted.has(key));
        if (unknown.length) return { ok: false, reason: `存在未知字段：${unknown.join('、')}` };
        const resolved = resolveInputValues(table, raw);
        delete resolved.common_source;
        delete resolved.common_time;
        const normalized = {};
        for (const [fieldId, value] of Object.entries(resolved)) {
            const field = table.fields.find(item => item.id === fieldId);
            if (!field) return { ok: false, reason: `字段不存在：${fieldId}` };
            const result = normalizeFieldInput(field, value);
            if (!result.ok) return { ok: false, reason: `字段“${field.name}”${result.reason}` };
            normalized[fieldId] = result.value;
        }
        return { ok: true, values: normalized };
    }

    function missingAddFields(table, values) {
        const requiredKeys = ['category', 'title', 'content'];
        return requiredKeys.map(key => {
            const field = table.fields.find(item => item.scope === 'common' && item.commonKey === key);
            return field && !hasValue(values[field.id]) ? field.name : '';
        }).filter(Boolean);
    }

    function operationValuesEqualTarget(table, target, values) {
        return Object.entries(values).every(([fieldId, value]) => {
            const field = table.fields.find(item => item.id === fieldId);
            return field && fieldValuesEqual(table, field, getFieldValue(target, field), value);
        });
    }

    function applyOperations(chat, operations, options = {}) {
        const store = ensureStore(chat);
        const origin = options.origin || 'manual';
        const roundId = options.roundId || null;
        const changed = [];
        const checked = [];
        const rejected = [];

        (Array.isArray(operations) ? operations : []).forEach((operation, operationIndex) => {
            if (!plainObject(operation)) {
                rejected.push({ operation, reason: `第${operationIndex + 1}项操作不是对象` });
                return;
            }
            const action = normalizeAction(operation.action);
            if (!action) {
                rejected.push({ operation, reason: 'action必须是add、upsert或delete' });
                return;
            }
            const table = findTable(store, text(operation.tableId));
            if (!table) {
                rejected.push({ operation, reason: '目标表不存在' });
                return;
            }

            if (origin === 'ai' && !aiWritable(table)) {
                rejected.push({ operation, reason: AI_PROTECTED_GROUPS.has(table.group) || AI_PROTECTED_TABLE_IDS.has(table.id)
                    ? '该表属于核心、中期或长期层，聊天AI没有写入权限'
                    : (table.behavior.writePolicy === 'manual' ? '该表只允许用户手动更新' : '该表不允许聊天AI直接写入') });
                return;
            }
            if (origin === 'summary' && table.group !== 'medium') {
                rejected.push({ operation, reason: '压缩流程只能写入中期总结表' });
                return;
            }

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

            if (action === 'add' && text(operation.recordId)) {
                rejected.push({ operation, reason: 'add操作不能指定recordId；更新旧记录请使用upsert' });
                return;
            }

            const prepared = prepareResolvedValues(table, operation);
            if (!prepared.ok) {
                rejected.push({ operation, reason: prepared.reason });
                return;
            }
            const resolved = prepared.values;
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
            const identityValues = Object.assign({}, resolved, {
                common_source: source,
                common_time: localStamp
            });

            if (action === 'add') {
                const missing = missingAddFields(table, resolved);
                if (missing.length) {
                    rejected.push({ operation, reason: `新增记录缺少必要内容：${missing.join('、')}` });
                    return;
                }
                const duplicate = findTarget(rows, table, operation, identityValues);
                if (duplicate) {
                    if (operationValuesEqualTarget(table, duplicate, resolved)) {
                        checked.push({ tableId: table.id, recordId: duplicate.id, action: 'checked' });
                    } else {
                        rejected.push({ operation, reason: `已存在同一记录（${duplicate.id}），请使用upsert更新` });
                    }
                    return;
                }
                const record = normalizeRecord({
                    id: id('memory_record'),
                    source,
                    time: localStamp,
                    createdAt: stamp,
                    updatedAt: stamp,
                    roundId,
                    changedFieldIds: []
                }, table);
                for (const [fieldId, value] of Object.entries(resolved)) {
                    const field = table.fields.find(item => item.id === fieldId);
                    const result = setFieldValue(record, field, value, { table });
                    if (result.status === 'changed') record.changedFieldIds.push(field.id);
                }
                setFieldValue(record, table.fields.find(item => item.id === 'common_source'), source, { table });
                setFieldValue(record, table.fields.find(item => item.id === 'common_time'), localStamp, { table });
                record.changedFieldIds = unique(record.changedFieldIds.concat(['common_source', 'common_time']));
                rows.push(record);
                changed.push({ tableId: table.id, recordId: record.id, action: 'add', fields: clone(record.changedFieldIds) });
                return;
            }

            let target = null;
            if (text(operation.recordId)) {
                target = rows.find(row => row.id === text(operation.recordId)) || null;
                if (!target) {
                    rejected.push({ operation, reason: `指定的recordId不存在：${text(operation.recordId)}` });
                    return;
                }
            } else {
                target = findTarget(rows, table, operation, identityValues);
            }
            if (!target) {
                rejected.push({ operation, reason: 'upsert没有找到目标记录；新增独立记录必须使用add并填写分类、标题和内容' });
                return;
            }

            const changedFields = [];
            for (const [fieldId, value] of Object.entries(resolved)) {
                const field = table.fields.find(item => item.id === fieldId);
                const result = setFieldValue(target, field, value, { table });
                if (result.status === 'rejected') {
                    rejected.push({ operation, reason: `字段“${field.name}”${result.reason}` });
                    return;
                }
                if (result.status === 'changed') changedFields.push(field.id);
            }
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
        if (table?.id === 'v5_current_state') return false;
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
            .filter(record => !record.compressedAt && !isExpired(table, record) && canInjectRecord(record, store));
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
        const rows = (store.records[table.id] || []).filter(record => !record.compressedAt && !isExpired(table, record));
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
3. 更新旧记录时使用action="upsert"，优先填写候选中的recordId；如果没有目标旧记录，upsert会被拒绝。独立新记录必须使用action="add"。
4. 更新时只提交本轮变化的字段；不要把候选旧记录整行原样复制回来。新增时分类、标题、内容不能为空，并填写表格要求的关键字段。
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

    function trimCodeFence(value) {
        return text(value).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }

    function cleanSidecarTail(source, startIndex) {
        const head = startIndex >= 0 ? source.slice(0, startIndex) : source;
        return head.replace(/<\s*\\?\/?\s*memory_ops\s*>/gi, '').replace(/\n{3,}/g, '\n\n').trim();
    }

    function parsePayloadText(value) {
        const parsed = JSON.parse(trimCodeFence(value));
        return validateSidecarPayload(parsed);
    }

    function extractSidecar(responseText) {
        const source = String(responseText || '');
        const normalized = source.replace(/<\s*\\\/\s*memory_ops\s*>/gi, '</memory_ops>');
        const pairRegex = /<\s*memory_ops\s*>([\s\S]*?)<\s*\/\s*memory_ops\s*>/gi;
        const matches = Array.from(normalized.matchAll(pairRegex));
        if (matches.length) {
            const last = matches[matches.length - 1];
            const firstStart = matches[0].index ?? normalized.indexOf('<memory_ops');
            const cleaned = normalized.replace(pairRegex, '').replace(/<\s*\\?\/?\s*memory_ops\s*>/gi, '').replace(/\n{3,}/g, '\n\n').trim();
            try {
                return { cleaned, payload: parsePayloadText(last[1]), error: null, markerFound: true };
            } catch (error) {
                return { cleaned: cleanSidecarTail(normalized, firstStart), payload: null, error, markerFound: true };
            }
        }

        const openMatch = normalized.match(/<\s*memory_ops\s*>/i);
        if (openMatch) {
            const startIndex = openMatch.index ?? 0;
            const payloadText = normalized.slice(startIndex + openMatch[0].length).replace(/<\s*\\?\/?\s*memory_ops\s*>[\s\S]*$/i, '');
            try {
                return { cleaned: cleanSidecarTail(normalized, startIndex), payload: parsePayloadText(payloadText), error: null, markerFound: true };
            } catch (error) {
                return { cleaned: cleanSidecarTail(normalized, startIndex), payload: null, error, markerFound: true };
            }
        }

        const closeMatch = normalized.match(/<\s*\/\s*memory_ops\s*>/i);
        if (closeMatch) {
            const closeIndex = closeMatch.index ?? normalized.length;
            const beforeClose = normalized.slice(0, closeIndex);
            const jsonStarts = Array.from(beforeClose.matchAll(/\{\s*"(?:operations|memoryOps)"\s*:/g)).map(match => match.index ?? -1);
            const jsonStart = jsonStarts.length ? jsonStarts[jsonStarts.length - 1] : -1;
            if (jsonStart >= 0) {
                try {
                    return { cleaned: cleanSidecarTail(normalized, jsonStart), payload: parsePayloadText(beforeClose.slice(jsonStart)), error: null, markerFound: true };
                } catch (error) {
                    return { cleaned: cleanSidecarTail(normalized, jsonStart), payload: null, error, markerFound: true };
                }
            }
            const error = new Error('检测到memory_ops结束标签，但缺少可识别的开始标签或JSON');
            return { cleaned: cleanSidecarTail(normalized, closeIndex), payload: null, error, markerFound: true };
        }

        const suspicious = normalized.search(/(?:^|\n)\s*\{\s*"(?:operations|memoryOps)"\s*:/m);
        if (suspicious >= 0) {
            try {
                return { cleaned: cleanSidecarTail(normalized, suspicious), payload: parsePayloadText(normalized.slice(suspicious)), error: null, markerFound: true };
            } catch (error) {
                return { cleaned: cleanSidecarTail(normalized, suspicious), payload: null, error, markerFound: true };
            }
        }
        return { cleaned: normalized, payload: null, error: null, markerFound: false };
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
        let validated;
        try {
            validated = validateSidecarPayload(payload);
        } catch (error) {
            return completeRound(chat, {
                error: error?.message || String(error),
                roundId: options.roundId || null
            });
        }
        const report = applyOperations(chat, validated.operations, {
            origin: 'ai',
            roundId: options.roundId || id('memory_round')
        });
        if (report.changed.length) await persist(chat);
        return completeRound(chat, Object.assign({ roundId: options.roundId || null }, report));
    }

    async function processReply(chat, responseText, options = {}) {
        const parsed = extractSidecar(responseText);
        if (parsed.error) {
            const report = completeRound(chat, { error: parsed.error.message || String(parsed.error), roundId: options.roundId || null });
            return Object.assign({}, parsed, { report });
        }
        if (parsed.payload) {
            const report = await applySidecar(chat, parsed.payload, { roundId: options.roundId || null });
            return Object.assign({}, parsed, { report });
        }
        const report = completeRound(chat, { reason: 'no_update', roundId: options.roundId || null });
        return Object.assign({}, parsed, { report });
    }

    function refreshStateBar(chat) {
        if (!chat) return;
        const store = ensureStore(chat);
        const table = store.tables.find(item => item.behavior.chatStatus === true);
        const element = document.getElementById('memory-live-state-bar');
        if (!element) return;
        if (!table) {
            element.textContent = '';
            element.classList.add('hidden');
            element.style.display = 'none';
            return;
        }
        const values = (store.records[table.id] || [])
            .filter(record => record.content)
            .sort((a, b) => text(b.updatedAt).localeCompare(text(a.updatedAt)))
            .slice(0, 4)
            .map(record => record.content);
        element.textContent = values.join(' · ');
        element.classList.toggle('hidden', !values.length);
        element.style.display = values.length ? '' : 'none';
        element.setAttribute('role', 'button');
        element.setAttribute('tabindex', values.length ? '0' : '-1');
        element.setAttribute('title', '点击进入记忆中的当前状态');
        const openMemory = () => {
            if (!values.length) return;
            if (typeof global.openMemoryTableForCharacter === 'function') {
                global.openMemoryTableForCharacter(chat.id, table.id);
                return;
            }
            global.currentChatId = chat.id;
            global.currentChatType = 'private';
            global.showScreen?.('memory-table-screen');
        };
        element.onclick = openMemory;
        element.onkeydown = event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openMemory();
        };
    }

    function summaryTargetFor(store, sourceTableId) {
        const targetId = SUMMARY_TARGETS[sourceTableId];
        if (!targetId) return null;
        return store.tables.find(table => table.id === targetId && table.group === 'medium') || null;
    }

    function buildSummaryDraft(chat, sourceTableId, recordIds) {
        const store = ensureStore(chat);
        const sourceTable = findTable(store, sourceTableId);
        const targetTable = summaryTargetFor(store, sourceTableId);
        if (!sourceTable || !targetTable) throw new Error('当前表没有对应的中期总结表');
        const selected = (store.records[sourceTableId] || []).filter(record => recordIds.includes(record.id) && !record.compressedAt);
        if (!selected.length) throw new Error('请选择尚未压缩的短期记录');
        const sorted = selected.slice().sort((a, b) => text(a.time).localeCompare(text(b.time)));
        const titles = sorted.map(record => record.title).filter(Boolean);
        const times = sorted.map(record => record.time).filter(Boolean);
        const contentLines = sorted.map((record, index) => `${index + 1}. ${record.title || '未命名'}：${record.content || '无内容'}`);
        const values = {
            分类: sourceTableId === 'v5_recent_events' ? '事项总结' : '思想成长',
            标签: ['已压缩', sourceTableId === 'v5_recent_events' ? '事项脉络' : '理解变化'],
            标题: sourceTableId === 'v5_recent_events' ? '近期事项总结' : '近期思想总结',
            内容: contentLines.join('\n'),
            来源: 'AI判断',
            时间: localDateTimeSeconds()
        };
        if (sourceTableId === 'v5_recent_events') {
            values['时间范围'] = times.length ? `${times[0]} 至 ${times[times.length - 1]}` : '';
            values['关联事项'] = titles;
            values['最终结果'] = sorted.map(r => r.values?.[sourceTable.fields.find(f => f.name === '结果')?.id]).filter(Boolean).join('\n');
            values['未完结部分'] = sorted.map(r => r.values?.[sourceTable.fields.find(f => f.name === '后续')?.id]).filter(Boolean).join('\n');
            values['可复用经验'] = '';
        } else {
            values['成长主体'] = '双方';
            values['旧想法'] = '';
            values['新想法'] = sorted.map(r => r.content).filter(Boolean).join('\n');
            values['变化证据'] = titles.join('、');
            values['未来指导'] = sorted.map(r => r.values?.[sourceTable.fields.find(f => f.name === '未来指导')?.id]).filter(Boolean).join('\n');
            values['关联想法'] = titles;
        }
        return { sourceTable, targetTable, selected, values };
    }

    async function runAggregation(chat, sourceTableId, recordIds, editedValues = null) {
        const store = ensureStore(chat);
        const draft = buildSummaryDraft(chat, sourceTableId, recordIds || []);
        const values = editedValues || draft.values;
        const batchId = `compression_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const report = applyOperations(chat, [{ tableId: draft.targetTable.id, action: 'add', source: 'AI判断', values }], { origin: 'summary' });
        if (!report.changed.length || report.rejected.length) return Object.assign(report, { batchId: '', sourceCount: 0 });
        const summaryRecordId = report.changed[0].recordId;
        const stamp = new Date().toISOString();
        draft.selected.forEach(record => {
            record.compressedAt = stamp;
            record.compressedBy = summaryRecordId;
            record.compressionBatchId = batchId;
        });
        await M.model.persist(chat);
        return Object.assign(report, { batchId, sourceCount: draft.selected.length, summaryRecordId });
    }

    async function deleteCompressed(chat, sourceTableId, recordIds = null) {
        const store = ensureStore(chat);
        const ids = Array.isArray(recordIds) ? new Set(recordIds) : null;
        const before = (store.records[sourceTableId] || []).length;
        store.records[sourceTableId] = (store.records[sourceTableId] || []).filter(record => !(record.compressedAt && (!ids || ids.has(record.id))));
        const deleted = before - store.records[sourceTableId].length;
        if (deleted) await M.model.persist(chat);
        return { deleted };
    }

    function buildLongTermDraft(chat, sourceTableId, recordIds) {
        const store = ensureStore(chat);
        const sourceTable = findTable(store, sourceTableId);
        const targetTable = findTable(store, 'v5_stable_long_term');
        if (!sourceTable || sourceTable.group !== 'medium') throw new Error('长期草稿只能从中期总结生成');
        if (!targetTable || targetTable.group !== 'long') throw new Error('稳定长期记忆表不存在');
        const selected = (store.records[sourceTableId] || []).filter(record => recordIds.includes(record.id));
        if (!selected.length) throw new Error('请选择至少一条中期总结');
        const sorted = selected.slice().sort((a, b) => text(a.time).localeCompare(text(b.time)));
        const titles = sorted.map(record => record.title).filter(Boolean);
        const content = sorted.map((record, index) => `${index + 1}. ${record.title || '未命名'}：${record.content || '无内容'}`).join('\n');
        const values = {
            分类: '长期规律',
            标签: ['待确认', '中期提炼'],
            标题: sourceTableId === 'v5_event_summary' ? '事项长期规律' : '成长长期规律',
            内容: content,
            来源: '用户明确',
            时间: localDateTimeSeconds(),
            长期类型: '',
            适用条件: '',
            不适用条件: '',
            来源总结: titles
        };
        return { sourceTable, targetTable, selected, values };
    }

    async function saveLongTermDraft(chat, sourceTableId, recordIds, editedValues) {
        const draft = buildLongTermDraft(chat, sourceTableId, recordIds || []);
        const values = editedValues || draft.values;
        const report = applyOperations(chat, [{ tableId: draft.targetTable.id, action: 'add', source: '用户明确', values }], { origin: 'manual' });
        if (report.changed.length && !report.rejected.length) await M.model.persist(chat);
        return report;
    }

    async function runEligibleAggregations() { return []; }

    M.engine = Object.freeze({
        applyOperations,
        formatRecordText,
        getContextBlock,
        buildSystemPrompt,
        validateSidecarPayload,
        extractSidecar,
        ensureSidecarState,
        completeRound,
        applySidecar,
        processReply,
        refreshStateBar,
        buildSummaryDraft,
        runAggregation,
        deleteCompressed,
        buildLongTermDraft,
        saveLongTermDraft,
        runEligibleAggregations,
        candidateRecords
    });
})(window);
