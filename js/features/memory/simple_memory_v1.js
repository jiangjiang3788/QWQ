(function (global) {
    'use strict';

    const VERSION = '3.0.3-v1.3';
    const STORE_VERSION = 1;
    const LEVELS = new Set(['short', 'medium', 'long']);
    const SOURCES = new Set(['用户明确', 'AI判断']);
    const ui = { activeTableId: '', search: '', category: '', tag: '', bound: false };
    const aggregationLocks = new Set();
    const sidecarReports = new WeakMap();
    const normalizedStores = new WeakSet();

    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const nowIso = () => new Date().toISOString();
    const id = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const text = value => String(value == null ? '' : value).trim();
    const esc = value => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const unique = values => Array.from(new Set((Array.isArray(values) ? values : text(values).split(/[,，、\n]/)).map(text).filter(Boolean)));
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    function defaultSettings() {
        return {
            enabled: true,
            allowAiJudgment: true,
            roundNoticeEnabled: true,
            injectionMaxRecords: 24,
            tagBehaviors: {
                alwaysInject: ['始终注入'],
                neverInject: ['不进入上下文']
            }
        };
    }

    function isEventIdColumn(column) {
        const name = text(column?.name || column?.key).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
        return /^(事件\s*(id|编号)|event\s*id)$/i.test(name);
    }

    function visibleColumns(table) {
        return (table?.columns || []).filter(column => column.hidden !== true && !isEventIdColumn(column));
    }

    function normalizeColumn(column, index) {
        const allowed = new Set(['text', 'longtext', 'number', 'date', 'datetime', 'select', 'multiselect', 'boolean']);
        return {
            id: text(column?.id) || id('memory_col'),
            name: text(column?.name || column?.key) || `字段${index + 1}`,
            type: allowed.has(text(column?.type)) ? text(column.type) : 'text',
            options: unique(column?.options || []),
            aiHint: text(column?.aiHint),
            required: column?.required === true,
            hidden: column?.hidden === true || isEventIdColumn(column)
        };
    }

    function normalizeTable(table, index) {
        const level = LEVELS.has(text(table?.level || table?.memoryLayer)) ? text(table.level || table.memoryLayer) : 'short';
        const columns = (Array.isArray(table?.columns) ? table.columns : []).map(normalizeColumn);
        return {
            id: text(table?.id) || id('memory_table'),
            name: text(table?.name) || `记忆表${index + 1}`,
            description: text(table?.description),
            extractPrompt: table && Object.prototype.hasOwnProperty.call(table, 'extractPrompt') ? text(table.extractPrompt) : text(table?.description),
            level,
            recordMode: table?.recordMode === 'singleton' ? 'singleton' : 'rows',
            columns,
            capture: {
                enabled: level === 'short' ? table?.capture?.enabled !== false : false,
                writeMode: ['append', 'upsert', 'replace_latest'].includes(table?.capture?.writeMode) ? table.capture.writeMode : 'upsert'
            },
            routing: {
                categories: unique(table?.routing?.categories || []),
                tags: unique(table?.routing?.tags || [])
            },
            display: {
                chatStatus: table?.display?.chatStatus === true
            },
            aggregation: {
                enabled: level === 'medium' ? table?.aggregation?.enabled === true : false,
                sourceTableIds: unique(table?.aggregation?.sourceTableIds || []),
                categoryFilters: unique(table?.aggregation?.categoryFilters || []),
                includeTags: unique(table?.aggregation?.includeTags || []),
                excludeTags: unique(table?.aggregation?.excludeTags || []),
                triggerType: ['record_count', 'manual'].includes(table?.aggregation?.triggerType) ? table.aggregation.triggerType : 'manual',
                triggerCount: Math.max(1, parseInt(table?.aggregation?.triggerCount, 10) || 8),
                lastProcessedAt: text(table?.aggregation?.lastProcessedAt)
            },
            injection: {
                enabled: table?.injection?.enabled !== false,
                categories: unique(table?.injection?.categories || []),
                includeTags: unique(table?.injection?.includeTags || []),
                excludeTags: unique(table?.injection?.excludeTags || [])
            }
        };
    }

    function normalizeRecord(record, table) {
        const values = {};
        (table.columns || []).forEach(column => {
            if (record?.values && Object.prototype.hasOwnProperty.call(record.values, column.id)) values[column.id] = clone(record.values[column.id]);
        });
        const createdAt = text(record?.createdAt) || nowIso();
        const updatedAt = text(record?.updatedAt) || createdAt;
        const fieldChanges = {};
        const rawFieldChanges = record?.fieldChanges && typeof record.fieldChanges === 'object' ? record.fieldChanges : {};
        const normalizedSource = SOURCES.has(text(record?.source)) ? text(record.source) : 'AI判断';
        const inferredAction = createdAt === updatedAt ? '新增' : '更新';
        Object.keys(values).forEach(fieldId => {
            const marker = rawFieldChanges[fieldId];
            fieldChanges[fieldId] = marker && typeof marker === 'object' ? {
                action: marker.action === '新增' ? '新增' : '更新',
                source: SOURCES.has(text(marker.source)) ? text(marker.source) : normalizedSource,
                at: text(marker.at) || updatedAt,
                marked: marker.marked !== false
            } : {
                action: inferredAction,
                source: normalizedSource,
                at: updatedAt,
                marked: true
            };
        });
        const rawChange = record?.lastChange && typeof record.lastChange === 'object' ? record.lastChange : null;
        return {
            id: text(record?.id) || id('memory_record'),
            values,
            category: text(record?.category),
            tags: unique(record?.tags || []),
            source: normalizedSource,
            createdAt,
            updatedAt,
            lastChange: rawChange ? {
                action: rawChange.action === '新增' ? '新增' : '更新',
                source: SOURCES.has(text(rawChange.source)) ? text(rawChange.source) : normalizedSource,
                at: text(rawChange.at) || updatedAt,
                marked: rawChange.marked !== false
            } : {
                action: inferredAction,
                source: normalizedSource,
                at: updatedAt,
                marked: true
            },
            fieldChanges
        };
    }

    function emptyStore() {
        return { version: STORE_VERSION, settings: defaultSettings(), tables: [], records: {} };
    }

    function normalizeStore(store) {
        const out = emptyStore();
        if (store && typeof store === 'object') {
            out.settings = Object.assign(defaultSettings(), clone(store.settings || {}));
            out.settings.tagBehaviors = Object.assign(defaultSettings().tagBehaviors, clone(store.settings?.tagBehaviors || {}));
            out.tables = (Array.isArray(store.tables) ? store.tables : []).map(normalizeTable);
            out.tables.forEach(table => {
                const raw = Array.isArray(store.records?.[table.id]) ? store.records[table.id] : [];
                out.records[table.id] = raw.map(record => normalizeRecord(record, table));
            });
        }
        return out;
    }

    function inferLegacySource(row) {
        const primary = text(row?.meta?.evidence?.primarySource || row?.meta?.source || '');
        if (/user|explicit|manual|用户/i.test(primary)) return '用户明确';
        return 'AI判断';
    }

    function legacyTags(row) {
        return unique([
            ...(Array.isArray(row?.meta?.tags) ? row.meta.tags : []),
            ...(Array.isArray(row?.meta?.tagBundle?.topic) ? row.meta.tagBundle.topic : []),
            ...(Array.isArray(row?.meta?.tagBundle?.scene) ? row.meta.tagBundle.scene : []),
            ...(Array.isArray(row?.meta?.tagBundle?.entity) ? row.meta.tagBundle.entity : [])
        ]);
    }

    function legacyCategory(row, table) {
        const categoryField = (table.columns || []).find(column => /分类|类别|类型/.test(text(column.key || column.name)));
        return text(categoryField ? row?.cells?.[categoryField.id] : '') || text(legacyTags(row)[0]);
    }

    function migrateLegacyStore(chat) {
        const store = emptyStore();
        const legacyState = chat?.memoryTables;
        const templateIds = Array.isArray(legacyState?.boundTemplateIds) ? legacyState.boundTemplateIds : [];
        const templates = Array.isArray(global.db?.memoryTableTemplates) ? global.db.memoryTableTemplates : [];
        templates.filter(template => templateIds.includes(template.id)).forEach(template => {
            (template.tables || []).filter(legacyTable => text(legacyTable.memoryLayer) !== 'review' && text(legacyTable.systemRole) !== 'long_candidate').forEach((legacyTable, tableIndex) => {
                let level = text(legacyTable.memoryLayer);
                if (level === 'core') level = 'long';
                if (level === 'review') level = 'medium';
                if (!LEVELS.has(level)) level = 'short';
                const table = normalizeTable({
                    id: legacyTable.id,
                    name: legacyTable.name,
                    description: text(legacyTable.description),
                    extractPrompt: legacyTable.extractPrompt || legacyTable.updatePolicy?.instructions || '',
                    level,
                    recordMode: legacyTable.mode === 'keyValue' ? 'singleton' : 'rows',
                    columns: (legacyTable.columns || []).map(column => ({
                        id: column.id,
                        name: column.key || column.name,
                        type: column.type === 'enum' ? 'select' : column.type === 'array' ? 'multiselect' : column.type,
                        options: column.options || [],
                        aiHint: column.aiHint || '',
                        required: false,
                        hidden: isEventIdColumn(column)
                    })),
                    capture: { enabled: level === 'short', writeMode: legacyTable.mode === 'keyValue' ? 'upsert' : 'upsert' },
                    aggregation: {
                        enabled: level === 'medium',
                        sourceTableIds: [],
                        triggerType: 'manual',
                        triggerCount: 8
                    },
                    injection: { enabled: true },
                    display: { chatStatus: text(legacyTable.systemRole) === 'current_state' }
                }, tableIndex);
                store.tables.push(table);
                const legacyData = legacyState?.data?.[template.id]?.[legacyTable.id];
                const rows = [];
                if (legacyTable.mode === 'rows') {
                    (Array.isArray(legacyData?.__rows) ? legacyData.__rows : []).forEach(row => {
                        const values = {};
                        table.columns.forEach(column => {
                            if (row?.cells && Object.prototype.hasOwnProperty.call(row.cells, column.id)) values[column.id] = clone(row.cells[column.id]);
                        });
                        rows.push(normalizeRecord({
                            id: row.id,
                            values,
                            category: legacyCategory(row, legacyTable),
                            tags: legacyTags(row),
                            source: inferLegacySource(row),
                            createdAt: row?.meta?.createdAt ? new Date(row.meta.createdAt).toISOString() : nowIso(),
                            updatedAt: row?.meta?.updatedAt ? new Date(row.meta.updatedAt).toISOString() : nowIso()
                        }, table));
                    });
                } else if (legacyData && typeof legacyData === 'object') {
                    const values = {};
                    table.columns.forEach(column => {
                        if (Object.prototype.hasOwnProperty.call(legacyData, column.id)) values[column.id] = clone(legacyData[column.id]);
                    });
                    if (Object.values(values).some(value => text(Array.isArray(value) ? value.join(',') : value))) {
                        const baseTags = table.columns.filter(column => text(values[column.id])).map(column => column.name).slice(0, 12);
                        if (text(legacyTable.systemRole) === 'core_profile') baseTags.unshift('始终注入');
                        rows.push(normalizeRecord({
                            id: `${table.id}_singleton`, values, category: text(legacyTable.name), tags: unique(baseTags), source: 'AI判断'
                        }, table));
                    }
                }
                store.records[table.id] = rows;
            });
        });
        const shortIds = store.tables.filter(table => table.level === 'short').map(table => table.id);
        store.tables.filter(table => table.level === 'medium').forEach(table => {
            if (!table.aggregation.sourceTableIds.length) table.aggregation.sourceTableIds = shortIds.slice();
            table.aggregation.enabled = true;
            table.aggregation.triggerType = 'manual';
        });
        return store;
    }

    function ensureStore(chat) {
        if (!chat || typeof chat !== 'object') return emptyStore();
        if (chat.memoryTables || !chat.memoryStore || chat.memoryStore.version !== STORE_VERSION) {
            chat.memoryStore = chat.memoryTables ? migrateLegacyStore(chat) : emptyStore();
            delete chat.memoryTables;
        }
        if (!normalizedStores.has(chat.memoryStore)) {
            chat.memoryStore = normalizeStore(chat.memoryStore);
            normalizedStores.add(chat.memoryStore);
        }
        return chat.memoryStore;
    }

    async function migrateAllCharacters() {
        if (!global.db || !Array.isArray(global.db.characters)) return;
        let changed = false;
        global.db.characters.forEach(chat => {
            if (!chat.memoryStore || chat.memoryStore.version !== STORE_VERSION || chat.memoryTables) {
                ensureStore(chat);
                changed = true;
            }
        });
        if (Array.isArray(global.db.memoryTableTemplates) && global.db.memoryTableTemplates.length) {
            global.db.memoryTableTemplates = [];
            changed = true;
        }
        if (changed) {
            try {
                await Promise.all(global.db.characters.map(chat => global.saveCharacter?.(chat.id)));
                await global.saveGlobalSettings?.();
            } catch (error) {
                console.warn('[SimpleMemoryV1] migration persist failed:', error);
            }
        }
    }

    function getCurrentChat() {
        if (!global.db || global.currentChatType !== 'private' || !global.currentChatId) return null;
        const chat = global.db.characters.find(item => item.id === global.currentChatId) || null;
        if (chat) ensureStore(chat);
        return chat;
    }

    async function persist(chat) {
        if (!chat?.id) return;
        await global.saveCharacter?.(chat.id);
    }

    function findTable(store, tableId) {
        return store.tables.find(table => table.id === tableId) || null;
    }

    function resolveValues(table, input) {
        const out = {};
        const source = input && typeof input === 'object' ? input : {};
        table.columns.forEach(column => {
            let value;
            if (Object.prototype.hasOwnProperty.call(source, column.id)) value = source[column.id];
            else if (Object.prototype.hasOwnProperty.call(source, column.name)) value = source[column.name];
            else return;
            if (column.type === 'number') value = Number(value);
            if (column.type === 'boolean') value = value === true || value === 'true' || value === '是' || value === 1;
            if (column.type === 'multiselect') value = unique(value);
            if (column.type === 'select' && column.options.length && !column.options.includes(text(value))) return;
            out[column.id] = clone(value);
        });
        return out;
    }

    function recordMatches(record, table, match) {
        if (!match || typeof match !== 'object') return false;
        const resolved = resolveValues(table, match);
        const entries = Object.entries(resolved);
        if (!entries.length) return false;
        return entries.every(([key, value]) => JSON.stringify(record.values?.[key]) === JSON.stringify(value));
    }

    function normalizeOperationSource(value, settings) {
        const source = SOURCES.has(text(value)) ? text(value) : 'AI判断';
        if (source === 'AI判断' && settings.allowAiJudgment === false) return null;
        return source;
    }

    function applyOperations(chat, operations, options = {}) {
        const store = ensureStore(chat);
        const origin = options.origin || 'ai';
        const changed = [];
        const rejected = [];
        (Array.isArray(operations) ? operations : []).forEach(operation => {
            const table = findTable(store, text(operation?.tableId));
            if (!table) return rejected.push({ operation, reason: '目标表不存在' });
            if (origin === 'ai' && (table.level !== 'short' || !table.capture.enabled)) return rejected.push({ operation, reason: '仅短期启用表允许随聊天写入' });
            if (origin === 'aggregation' && table.level !== 'medium') return rejected.push({ operation, reason: '积累结果只能写入中期表' });
            const action = ['add', 'upsert', 'delete'].includes(text(operation?.action)) ? text(operation.action) : 'upsert';
            const rows = store.records[table.id] ||= [];
            if (action === 'delete') {
                const targetId = text(operation?.recordId);
                const index = targetId ? rows.findIndex(row => row.id === targetId) : rows.findIndex(row => recordMatches(row, table, operation?.match));
                if (index < 0) return rejected.push({ operation, reason: '没有找到要删除的记录' });
                const [removed] = rows.splice(index, 1);
                changed.push({ tableId: table.id, recordId: removed.id, action: 'delete' });
                return;
            }
            const source = normalizeOperationSource(operation?.source, store.settings);
            if (!source) return rejected.push({ operation, reason: 'AI判断写入已关闭' });
            const operationCategory = text(operation?.category);
            const operationTags = unique(operation?.tags || []);
            const values = resolveValues(table, operation?.values);
            if (!Object.keys(values).length) return rejected.push({ operation, reason: '没有合法字段值' });
            let target = null;
            if (table.recordMode === 'singleton') target = rows[0] || null;
            if (!target && operation?.recordId) target = rows.find(row => row.id === text(operation.recordId)) || null;
            if (!target && table.capture.writeMode !== 'append' && operation?.match) target = rows.find(row => recordMatches(row, table, operation.match)) || null;
            if (!target && table.capture.writeMode === 'replace_latest') target = rows.slice().sort((a, b) => text(b.updatedAt).localeCompare(text(a.updatedAt)))[0] || null;
            if (!target && action === 'upsert' && table.capture.writeMode === 'upsert' && operation?.match) target = rows.find(row => recordMatches(row, table, operation.match)) || null;
            const stamp = nowIso();
            if (target) {
                const changedFields = [];
                target.fieldChanges ||= {};
                Object.entries(values).forEach(([fieldId, value]) => {
                    const hadValue = Object.prototype.hasOwnProperty.call(target.values || {}, fieldId)
                        && target.values[fieldId] !== ''
                        && target.values[fieldId] !== null
                        && target.values[fieldId] !== undefined;
                    const isDifferent = JSON.stringify(target.values?.[fieldId]) !== JSON.stringify(value);
                    target.values[fieldId] = clone(value);
                    if (isDifferent) {
                        changedFields.push(fieldId);
                        target.fieldChanges[fieldId] = { action: hadValue ? '更新' : '新增', source, at: stamp, marked: true };
                    }
                });
                const metaChanged = (operationCategory && operationCategory !== target.category)
                    || (operation?.tags !== undefined && JSON.stringify(operationTags) !== JSON.stringify(target.tags || []))
                    || source !== target.source;
                target.category = operationCategory || target.category;
                target.tags = operation?.tags !== undefined ? operationTags : target.tags;
                target.source = source;
                if (changedFields.length || metaChanged) {
                    target.updatedAt = stamp;
                    target.lastChange = { action: '更新', source, at: stamp, marked: true };
                    changed.push({ tableId: table.id, recordId: target.id, action: 'update', fields: changedFields });
                }
            } else {
                const fieldChanges = {};
                Object.keys(values).forEach(fieldId => { fieldChanges[fieldId] = { action: '新增', source, at: stamp, marked: true }; });
                const record = normalizeRecord({
                    id: text(operation?.recordId) || id('memory_record'),
                    values,
                    category: operationCategory,
                    tags: operationTags,
                    source,
                    createdAt: stamp,
                    updatedAt: stamp,
                    lastChange: { action: '新增', source, at: stamp, marked: true },
                    fieldChanges
                }, table);
                rows.push(record);
                changed.push({ tableId: table.id, recordId: record.id, action: 'add', fields: Object.keys(values) });
            }
        });
        return { changed, rejected };
    }

    function tablePrompt(table) {
        return {
            tableId: table.id,
            name: table.name,
            purpose: table.description,
            extractPrompt: table.extractPrompt,
            writeMode: table.capture.writeMode,
            recordMode: table.recordMode,
            categoryHints: table.routing.categories,
            tagHints: table.routing.tags,
            excludedTags: table.injection.excludeTags,
            columns: visibleColumns(table).map(column => ({ id: column.id, name: column.name, type: column.type, options: column.options, aiHint: column.aiHint }))
        };
    }

    function buildSystemPrompt(chat) {
        const store = ensureStore(chat);
        if (!store.settings.enabled) return '';
        const tables = store.tables.filter(table => table.level === 'short' && table.capture.enabled && table.columns.length);
        if (!tables.length) return '';
        return `\n<memory_direct_write_protocol version="${VERSION}">\n你可以在正常回复末尾附加一次隐藏记忆写入指令。只在本轮出现值得保存的新信息时输出；没有则不要输出。\n所有操作直接写入正式表，不存在候选、审核或运行态。\n目标表完全由下方动态定义决定，不得根据表名猜字段。长期表和中期表不在本轮自动写入。\n信息来源只能是“用户明确”或“AI判断”：核心事实由用户直接表达时用“用户明确”；属于你的推断或总结结论时用“AI判断”。\n分类填写一个主要分类；标签填写0至6个具体标签。表内的分类提示、标签提示只帮助你选择和填写，不是写入门槛；选定合法短期表并提供合法字段后应直接写入。请严格参考表级 extractPrompt 和字段 aiHint。\n输出格式必须严格为：\n<memory_ops>{"operations":[{"tableId":"...","action":"add|upsert|delete","recordId":"可选","match":{"字段ID或字段名":"用于查找旧记录，可选"},"values":{"字段ID或字段名":"值"},"category":"分类","tags":["标签"],"source":"用户明确|AI判断"}]}</memory_ops>\n写入指令必须放在整段回复最后，标签外不能解释指令。\n可自动写入的短期表：\n${JSON.stringify(tables.map(tablePrompt), null, 2)}\n</memory_direct_write_protocol>`;
    }

    function extractSidecar(responseText) {
        const source = String(responseText || '');
        const regex = /<memory_ops>([\s\S]*?)<\/memory_ops>/gi;
        const matches = Array.from(source.matchAll(regex));
        if (!matches.length) return { cleaned: source, payload: null, error: null };
        const last = matches[matches.length - 1];
        const cleaned = source.replace(regex, '').replace(/\n{3,}/g, '\n\n').trim();
        try {
            const payload = JSON.parse(last[1].trim());
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

    function roundNoticeText(chat, report) {
        if (report?.error) return '本轮记忆：更新指令解析失败';
        const changed = Array.isArray(report?.changed) ? report.changed : [];
        const rejected = Array.isArray(report?.rejected) ? report.rejected : [];
        if (!changed.length) {
            if (rejected.length) return `本轮记忆：没有写入（${text(rejected[0]?.reason) || '指令无效'}）`;
            return '本轮记忆：没有需要更新的内容';
        }
        return rejected.length
            ? '本轮记忆已写入；更新条目已在表格中标识，另有无效指令被忽略'
            : '本轮记忆已写入；更新条目已在表格中标识';
    }

    function completeRound(chat, details = {}) {
        const report = {
            at: Date.now(),
            changed: Array.isArray(details.changed) ? details.changed : [],
            rejected: Array.isArray(details.rejected) ? details.rejected : [],
            error: details.error ? String(details.error) : '',
            reason: text(details.reason),
            roundId: details.roundId || null
        };
        ensureSidecarState(chat).lastApplyReport = report;
        const store = ensureStore(chat);
        if (store.settings.enabled && store.settings.roundNoticeEnabled !== false) global.showToast?.(roundNoticeText(chat, report));
        return report;
    }

    async function applySidecar(chat, payload, options = {}) {
        const baseReport = applyOperations(chat, payload?.operations, { origin: 'ai' });
        const report = Object.assign({ roundId: options.roundId || null }, baseReport);
        await persist(chat);
        refreshStateBar(chat);
        if (report.changed.length) {
            setTimeout(() => runEligibleAggregations(chat).catch(error => console.warn('[SimpleMemoryV1] aggregation failed:', error)), 0);
            if (global.currentChatId === chat.id) render();
        }
        return completeRound(chat, report);
    }

    function recentChatText(chat, limit = 10) {
        return (Array.isArray(chat?.history) ? chat.history : []).slice(-limit).map(message => {
            const body = Array.isArray(message?.parts) ? message.parts.map(part => text(part?.text)).filter(Boolean).join(' ') : text(message?.content);
            return body;
        }).filter(Boolean).join('\n').slice(-12000);
    }

    function containsToken(query, token) {
        const target = text(token).toLowerCase();
        return target.length > 0 && query.toLowerCase().includes(target);
    }

    function daysOld(iso) {
        const stamp = new Date(iso).getTime();
        return Number.isFinite(stamp) ? (Date.now() - stamp) / 86400000 : 999999;
    }

    function formatRecordText(table, record) {
        const lines = visibleColumns(table).map(column => {
            const value = record.values?.[column.id];
            if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return '';
            return `${column.name}: ${Array.isArray(value) ? value.join('、') : String(value)}`;
        }).filter(Boolean);
        return lines.join('\n');
    }

    function getContextBlock(chat) {
        const store = ensureStore(chat);
        if (!store.settings.enabled) return '';
        const query = recentChatText(chat, 1);
        const always = unique(store.settings.tagBehaviors?.alwaysInject || []);
        const never = unique(store.settings.tagBehaviors?.neverInject || []);
        const candidates = [];
        store.tables.forEach(table => {
            if (!table.injection.enabled) return;
            const rows = Array.isArray(store.records[table.id]) ? store.records[table.id] : [];
            rows.forEach(record => {
                const tags = unique(record.tags || []);
                if (tags.some(tag => never.includes(tag))) return;
                if (table.injection.categories.length && !table.injection.categories.includes(record.category)) return;
                if (table.injection.excludeTags.some(tag => tags.includes(tag))) return;
                if (table.injection.includeTags.length && !table.injection.includeTags.some(tag => tags.includes(tag))) return;
                const isAlways = tags.some(tag => always.includes(tag));
                const categoryMatch = containsToken(query, record.category);
                const tagMatches = tags.filter(tag => containsToken(query, tag));
                if (!isAlways && !categoryMatch && !tagMatches.length) return;
                let score = 0;
                if (isAlways) score += 1000;
                if (categoryMatch) score += 40;
                score += tagMatches.length * 20;
                if (daysOld(record.updatedAt) <= 7) score += 5;
                candidates.push({ table, record, score, body: formatRecordText(table, record) });
            });
        });
        candidates.sort((a, b) => b.score - a.score || text(b.record.updatedAt).localeCompare(text(a.record.updatedAt)));
        const selected = [];
        for (const item of candidates) {
            selected.push(item);
            if (selected.length >= Math.max(1, parseInt(store.settings.injectionMaxRecords, 10) || 24)) break;
        }
        if (!selected.length) return '';
        return `<memory_by_category_and_tags>\n${selected.map(item => `  <memory table="${esc(item.table.name)}" category="${esc(item.record.category)}" tags="${esc(item.record.tags.join(','))}" source="${esc(item.record.source)}">\n${esc(item.body)}\n  </memory>`).join('\n')}\n</memory_by_category_and_tags>`;
    }

    async function modelJson(prompt) {
        const registry = global.OVOApiServiceRegistry;
        if (!registry) throw new Error('API服务未加载');
        const route = registry.require('summary', { allowFallback: true });
        const config = route.config;
        const protocol = registry.protocolFor(config);
        const endpoint = registry.endpointFor(config, 'chat');
        let body;
        let headers;
        if (protocol === 'gemini') {
            headers = { 'Content-Type': 'application/json' };
            body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } };
        } else {
            headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${typeof global.getRandomValue === 'function' ? global.getRandomValue(config.key) : config.key}` };
            body = { model: config.model, stream: false, temperature: 0.2, messages: [{ role: 'user', content: prompt }] };
        }
        const response = await (global.OVOAIRequestRuntime ? global.OVOAIRequestRuntime.request({
            task: 'memory-medium-aggregation', operationType: 'memory.medium.aggregate', operationStage: '正在整理中期记忆', source: 'simple-memory-v1', provider: config.provider || protocol, model: config.model, endpoint, headers, body
        }) : fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) }));
        if (!response.ok) throw new Error(`中期积累API失败：${response.status}`);
        const data = await response.json();
        let output = '';
        if (protocol === 'gemini') output = data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
        else output = data?.choices?.[0]?.message?.content || '';
        const match = String(output).match(/\{[\s\S]*\}/);
        if (!match) throw new Error('中期积累没有返回JSON');
        return JSON.parse(match[0]);
    }

    function aggregationSources(store, table) {
        const since = table.aggregation.lastProcessedAt ? new Date(table.aggregation.lastProcessedAt).getTime() : 0;
        const out = [];
        table.aggregation.sourceTableIds.forEach(sourceId => {
            const sourceTable = findTable(store, sourceId);
            if (!sourceTable) return;
            (store.records[sourceId] || []).forEach(record => {
                const updated = new Date(record.updatedAt).getTime() || 0;
                if (updated <= since) return;
                if (table.aggregation.categoryFilters.length && !table.aggregation.categoryFilters.includes(record.category)) return;
                if (table.aggregation.includeTags.length && !table.aggregation.includeTags.some(tag => record.tags.includes(tag))) return;
                if (table.aggregation.excludeTags.some(tag => record.tags.includes(tag))) return;
                out.push({ sourceTable, record, updated, text: formatRecordText(sourceTable, record) });
            });
        });
        return out.sort((a, b) => a.updated - b.updated);
    }

    async function runAggregation(chat, tableId, options = {}) {
        const store = ensureStore(chat);
        const table = findTable(store, tableId);
        if (!table || table.level !== 'medium') throw new Error('请选择中期表');
        if (aggregationLocks.has(`${chat.id}:${table.id}`)) return { skipped: true, reason: '正在整理' };
        const sources = aggregationSources(store, table);
        const manual = options.manual === true;
        if (!sources.length) return { skipped: true, reason: '没有新增来源记录' };
        if (!manual && table.aggregation.triggerType === 'record_count' && sources.length < table.aggregation.triggerCount) {
            return { skipped: true, reason: `尚未达到${table.aggregation.triggerCount}条` };
        }
        aggregationLocks.add(`${chat.id}:${table.id}`);
        try {
            const schema = visibleColumns(table).map(column => ({ id: column.id, name: column.name, type: column.type, options: column.options }));
            const prompt = `你正在为一个个人记忆系统生成中期积累记录。\n目标表：${table.name}\n用途：${table.description}\n目标字段：${JSON.stringify(schema, null, 2)}\n来源正式记录：${JSON.stringify(sources.map(item => ({ table: item.sourceTable.name, category: item.record.category, tags: item.record.tags, source: item.record.source, content: item.text, updatedAt: item.record.updatedAt })), null, 2)}\n请提炼可复用的中期总结，不要生成长期人格定论。返回纯JSON：{"records":[{"values":{"字段ID或字段名":"值"},"category":"一个分类","tags":["标签"],"source":"AI判断"}]}。不要输出JSON以外内容。`;
            const result = await modelJson(prompt);
            const operations = (Array.isArray(result?.records) ? result.records : []).map(record => ({
                tableId: table.id, action: 'add', values: record.values, category: record.category, tags: record.tags, source: 'AI判断'
            }));
            const report = applyOperations(chat, operations, { origin: 'aggregation' });
            if (!report.changed.length) {
                throw new Error(report.rejected[0]?.reason || '中期积累没有生成可写入记录');
            }
            table.aggregation.lastProcessedAt = new Date(Math.max(...sources.map(item => item.updated))).toISOString();
            await persist(chat);
            if (global.currentChatId === chat.id) render();
            return report;
        } finally {
            aggregationLocks.delete(`${chat.id}:${table.id}`);
        }
    }

    async function runEligibleAggregations(chat) {
        const store = ensureStore(chat);
        for (const table of store.tables.filter(item => item.level === 'medium' && item.aggregation.enabled && item.aggregation.triggerType === 'record_count')) {
            const sources = aggregationSources(store, table);
            if (sources.length >= table.aggregation.triggerCount) {
                try { await runAggregation(chat, table.id); } catch (error) { console.warn('[SimpleMemoryV1] auto aggregate:', error); }
                await sleep(30);
            }
        }
    }

    function refreshStateBar(chat) {
        const bar = document.getElementById('memory-live-state-bar');
        if (!bar) return;
        const store = ensureStore(chat || getCurrentChat());
        const table = store.tables.find(item => item.display?.chatStatus === true);
        if (!store.settings.enabled || !table) {
            bar.style.display = 'none';
            bar.innerHTML = '';
            return;
        }
        const rows = Array.isArray(store.records[table.id]) ? store.records[table.id] : [];
        const record = table.recordMode === 'singleton' ? rows[0] : rows.slice().sort((a, b) => text(b.updatedAt).localeCompare(text(a.updatedAt)))[0];
        if (!record) {
            bar.style.display = 'none';
            bar.innerHTML = '';
            return;
        }
        const items = visibleColumns(table).map(column => {
            const value = record.values?.[column.id];
            if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return '';
            const raw = Array.isArray(value) ? value.join('、') : column.type === 'boolean' ? (value ? '是' : '否') : String(value);
            const short = raw.length > 36 ? `${raw.slice(0, 36)}…` : raw;
            return `<span class="memory-user-state-item"><b>${esc(column.name)}</b><em>${esc(short)}</em></span>`;
        }).filter(Boolean).slice(0, 8);
        if (!items.length) {
            bar.style.display = 'none';
            bar.innerHTML = '';
            return;
        }
        bar.style.display = 'flex';
        bar.innerHTML = `<span class="memory-user-state-title">USER状态</span>${items.join('')}`;
    }

    function levelLabel(level) {
        return level === 'short' ? '短期' : level === 'medium' ? '中期' : '长期';
    }

    function valueText(column, value) {
        if (value === undefined || value === null || value === '') return '';
        if (Array.isArray(value)) return value.join('、');
        if (column.type === 'boolean') return value ? '是' : '否';
        return String(value);
    }

    function renderValue(column, value, options = {}) {
        const raw = valueText(column, value);
        if (!raw) return '<span class="sm-empty">—</span>';
        if (options.truncate === true) {
            return `<span class="sm-cell-truncated" title="${esc(raw)}">${esc(raw)}</span>`;
        }
        return `<span class="sm-cell-full">${esc(raw)}</span>`;
    }

    function updateDot(marker, title = '已写入或更新') {
        if (!marker || marker.marked === false) return '';
        const time = text(marker.at).replace('T', ' ').slice(0, 16);
        return `<span class="sm-update-dot" title="${esc(time ? `${title} · ${time}` : title)}" aria-label="${esc(title)}"></span>`;
    }

    function tableUpdateMarker(store, table) {
        const rows = store?.records?.[table?.id] || [];
        return rows.map(record => record.lastChange).filter(Boolean).sort((a, b) => text(b.at).localeCompare(text(a.at)))[0] || null;
    }

    function fieldUpdateMarker(rows, columnId) {
        return rows.map(record => record.fieldChanges?.[columnId]).filter(Boolean).sort((a, b) => text(b.at).localeCompare(text(a.at)))[0] || null;
    }

    function changeBadge(marker) {
        if (!marker) return '<span class="sm-change-badge legacy">既有</span>';
        const sourceClass = marker.source === 'AI判断' ? 'ai' : 'user';
        const label = `${marker.source || 'AI判断'}·${marker.action || '更新'}`;
        const title = text(marker.at).replace('T', ' ').slice(0, 16);
        return `<span class="sm-change-badge ${sourceClass}" title="${esc(title)}">${esc(label)}</span>`;
    }

    function columnHead(column, marker = null) {
        return `<div class="sm-column-head"><span class="sm-field-title">${esc(column.name)}${updateDot(marker, '该字段已有写入或更新')}</span>${column.aiHint ? `<small>${esc(column.aiHint)}</small>` : ''}</div>`;
    }

    function renderKvView(table, rows) {
        const record = rows[0];
        if (!record) return '<div class="sm-no-records sm-kv-empty">暂无正式内容</div>';
        const fields = visibleColumns(table).map(column => {
            const marker = record.fieldChanges?.[column.id] || null;
            return `<div class="sm-kv-row"><div class="sm-kv-key">${columnHead(column, marker)}</div><div class="sm-kv-value"><div class="sm-value-with-mark">${renderValue(column, record.values?.[column.id])}${changeBadge(marker)}</div></div></div>`;
        }).join('');
        const meta = `<div class="sm-kv-row sm-kv-meta"><div class="sm-kv-key">分类</div><div class="sm-kv-value">${esc(record.category || '—')}</div></div><div class="sm-kv-row sm-kv-meta"><div class="sm-kv-key">标签</div><div class="sm-kv-value">${esc(record.tags.join('、') || '—')}</div></div><div class="sm-kv-row sm-kv-meta"><div class="sm-kv-key">信息来源</div><div class="sm-kv-value"><span class="sm-source ${record.source === 'AI判断' ? 'ai' : 'user'}">${record.source}</span></div></div><div class="sm-kv-row sm-kv-meta"><div class="sm-kv-key">最近写入标识</div><div class="sm-kv-value">${changeBadge(record.lastChange)}</div></div><div class="sm-kv-row sm-kv-meta"><div class="sm-kv-key">更新时间</div><div class="sm-kv-value">${esc(text(record.updatedAt).replace('T', ' ').slice(0, 16))}</div></div>`;
        return `<div class="sm-kv-card">${fields}${meta}<div class="sm-kv-actions"><button data-sm-edit-record="${esc(record.id)}">编辑</button><button data-sm-delete-record="${esc(record.id)}">清空</button></div></div>`;
    }

    function renderRowsView(table, rows) {
        const columns = visibleColumns(table);
        return `<div class="sm-grid-wrap"><table class="sm-grid"><thead><tr>${columns.map(column => `<th>${columnHead(column, fieldUpdateMarker(rows, column.id))}</th>`).join('')}<th>分类</th><th>标签</th><th>信息来源</th><th>记忆标识</th><th>更新时间</th><th></th></tr></thead><tbody>${rows.map(record => `<tr>${columns.map(column => `<td>${renderValue(column, record.values?.[column.id], { truncate: true })}</td>`).join('')}<td>${esc(record.category)}</td><td><span class="sm-cell-truncated" title="${esc(record.tags.join('、'))}">${esc(record.tags.join('、'))}</span></td><td><span class="sm-source ${record.source === 'AI判断' ? 'ai' : 'user'}">${record.source}</span></td><td>${changeBadge(record.lastChange)}</td><td>${esc(text(record.updatedAt).replace('T', ' ').slice(0, 16))}</td><td class="sm-row-actions"><button data-sm-edit-record="${esc(record.id)}">编辑</button><button data-sm-delete-record="${esc(record.id)}">删除</button></td></tr>`).join('') || `<tr><td colspan="${columns.length + 6}" class="sm-no-records">暂无正式记录</td></tr>`}</tbody></table></div>`;
    }

    function activeTable(chat) {
        const store = ensureStore(chat);
        if (!store.tables.length) return null;
        let table = store.tables.find(item => item.id === ui.activeTableId);
        if (!table) table = store.tables[0];
        ui.activeTableId = table.id;
        return table;
    }

    function tableRows(store, table) {
        const query = text(ui.search).toLowerCase();
        return (store.records[table.id] || []).filter(record => {
            if (ui.category && record.category !== ui.category) return false;
            if (ui.tag && !record.tags.includes(ui.tag)) return false;
            if (!query) return true;
            return `${record.category} ${record.tags.join(' ')} ${formatRecordText(table, record)}`.toLowerCase().includes(query);
        }).sort((a, b) => text(b.updatedAt).localeCompare(text(a.updatedAt)));
    }

    function render() {
        const screen = document.getElementById('memory-table-screen');
        if (!screen) return;
        const chat = getCurrentChat();
        if (!chat) {
            screen.innerHTML = '<header class="app-header"><button class="back-btn" data-target="home-screen">‹</button><div class="title-container"><h1 class="title">记忆</h1></div></header><main class="content"><div class="placeholder-text"><p>请先进入一个角色聊天。</p></div></main>';
            return;
        }
        const store = ensureStore(chat);
        const table = activeTable(chat);
        const categories = table ? unique((store.records[table.id] || []).map(record => record.category)) : [];
        const tags = table ? unique((store.records[table.id] || []).flatMap(record => record.tags)) : [];
        const rows = table ? tableRows(store, table) : [];
        const recordsHtml = table ? (table.recordMode === 'singleton' ? renderKvView(table, rows) : renderRowsView(table, rows)) : '';
        screen.innerHTML = `
<header class="app-header sm-header">
  <button class="back-btn" data-target="chat-room-screen">‹</button>
  <div class="title-container"><h1 class="title">记忆</h1><small>${esc(chat.remarkName || chat.realName || '当前角色')}</small></div>
  <div class="action-btn-group"><button class="action-btn" data-sm-action="new-table" title="新建表">＋</button><button class="action-btn" data-sm-action="settings" title="设置">⚙</button></div>
</header>
<main class="content sm-shell">
  <section class="sm-topbar">
    <div><strong>唯一真源</strong><span>短期随聊直写 · 中期积累 · 长期手动</span></div>
    <div class="sm-top-actions"><button class="btn btn-small btn-secondary" data-sm-action="export">导出</button><button class="btn btn-small btn-secondary" data-sm-action="import">导入</button><input id="sm-import-input" type="file" accept="application/json,.json" hidden></div>
  </section>
  <section class="sm-layout">
    <aside class="sm-sidebar">
      <div class="sm-sidebar-head"><strong>自定义表</strong><span>${store.tables.length}</span></div>
      <div class="sm-table-list">${store.tables.map(item => { const marker = tableUpdateMarker(store, item); return `<button class="sm-table-item ${item.id === table?.id ? 'active' : ''}" data-sm-table="${esc(item.id)}"><span class="sm-table-name">${esc(item.name)}${updateDot(marker, '该表已有写入或更新')}</span><b class="sm-level sm-${item.level}">${levelLabel(item.level)}</b></button>`; }).join('') || '<div class="sm-empty-card">还没有表格</div>'}</div>
    </aside>
    <section class="sm-main">
      ${table ? `
      <div class="sm-table-head">
        <div><h2 class="sm-active-table-title">${esc(table.name)}${updateDot(tableUpdateMarker(store, table), '该表已有写入或更新')}</h2><p>${esc(table.description || '未填写用途说明')}</p>${table.extractPrompt ? `<p class="sm-extract-prompt"><b>extractPrompt：</b>${esc(table.extractPrompt)}</p>` : ''}</div>
        <div class="sm-table-actions">
          ${table.level === 'medium' ? '<button class="btn btn-small btn-primary" data-sm-action="aggregate">执行积累</button>' : ''}
          <button class="btn btn-small btn-primary" data-sm-action="new-record">${table.recordMode === 'singleton' && rows.length ? '编辑内容' : '新增记录'}</button>
          <button class="btn btn-small btn-secondary" data-sm-action="edit-table">表设置</button>
          <button class="btn btn-small btn-danger" data-sm-action="delete-table">删除表</button>
        </div>
      </div>
      <div class="sm-rule-line"><span>${table.recordMode === 'singleton' ? 'KV' : 'Rows'}</span><span>${levelLabel(table.level)}</span><span>${table.level === 'short' ? (table.capture.enabled ? '随聊天直接写入' : '已关闭自动写入') : table.level === 'medium' ? (table.aggregation.enabled ? `${table.aggregation.triggerType === 'record_count' ? `累计${table.aggregation.triggerCount}条自动整理` : '手动积累'}` : '未启用积累') : '仅手动写入'}</span><span>注入：${table.injection.enabled ? '按分类和标签' : '关闭'}</span>${table.display.chatStatus ? '<span>USER状态栏来源</span>' : ''}</div>
      <div class="sm-filters"><input id="sm-search" type="search" placeholder="搜索当前表" value="${esc(ui.search)}"><select id="sm-category"><option value="">全部分类</option>${categories.map(value => `<option ${value === ui.category ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select><select id="sm-tag"><option value="">全部标签</option>${tags.map(value => `<option ${value === ui.tag ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></div>
      ${recordsHtml}
      ` : '<div class="sm-empty-page"><h2>创建第一张自定义记忆表</h2><p>表名和字段不会写死在代码中。</p><button class="btn btn-primary" data-sm-action="new-table">新建表格</button></div>'}
    </section>
  </section>
</main>`;
        bindScreenEvents(screen, chat, store, table);
        refreshStateBar(chat);
    }

    function bindScreenEvents(screen, chat, store, table) {
        screen.querySelectorAll('[data-target]').forEach(button => button.addEventListener('click', () => global.showScreen?.(button.dataset.target)));
        screen.querySelectorAll('[data-sm-table]').forEach(button => button.addEventListener('click', () => { ui.activeTableId = button.dataset.smTable; ui.search = ui.category = ui.tag = ''; render(); }));
        screen.querySelector('#sm-search')?.addEventListener('input', event => { ui.search = event.target.value; render(); });
        screen.querySelector('#sm-category')?.addEventListener('change', event => { ui.category = event.target.value; render(); });
        screen.querySelector('#sm-tag')?.addEventListener('change', event => { ui.tag = event.target.value; render(); });
        screen.querySelectorAll('[data-sm-action]').forEach(button => button.addEventListener('click', async () => {
            const action = button.dataset.smAction;
            try {
                if (action === 'new-table') openTableEditor(chat, null);
                if (action === 'edit-table') openTableEditor(chat, table);
                if (action === 'new-record') openRecordEditor(chat, table, table?.recordMode === 'singleton' ? (store.records[table.id] || [])[0] || null : null);
                if (action === 'settings') openSettings(chat);
                if (action === 'export') exportStore(chat);
                if (action === 'import') screen.querySelector('#sm-import-input')?.click();
                if (action === 'delete-table' && table && confirm(`确定删除“${table.name}”及其全部记录吗？`)) {
                    store.tables = store.tables.filter(item => item.id !== table.id);
                    store.tables.forEach(item => { item.aggregation.sourceTableIds = item.aggregation.sourceTableIds.filter(sourceId => sourceId !== table.id); });
                    delete store.records[table.id]; ui.activeTableId = ''; await persist(chat); render();
                }
                if (action === 'aggregate' && table) {
                    button.disabled = true; button.textContent = '整理中…';
                    const result = await runAggregation(chat, table.id, { manual: true });
                    global.showToast?.(result?.skipped ? result.reason : `已写入${result.changed?.length || 0}条中期记录`);
                    render();
                }
            } catch (error) { console.error(error); global.showToast?.(error.message || String(error)); }
        }));
        screen.querySelector('#sm-import-input')?.addEventListener('change', event => importStore(chat, event.target.files?.[0]));
        screen.querySelectorAll('[data-sm-edit-record]').forEach(button => button.addEventListener('click', () => openRecordEditor(chat, table, (store.records[table.id] || []).find(record => record.id === button.dataset.smEditRecord))));
        screen.querySelectorAll('[data-sm-delete-record]').forEach(button => button.addEventListener('click', async () => {
            if (!confirm('确定删除这条正式记录吗？')) return;
            store.records[table.id] = (store.records[table.id] || []).filter(record => record.id !== button.dataset.smDeleteRecord);
            await persist(chat); render();
        }));
    }

    function modal(title, body, onSave, options = {}) {
        document.getElementById('sm-modal')?.remove();
        const wrap = document.createElement('div');
        wrap.id = 'sm-modal'; wrap.className = 'sm-modal-overlay';
        wrap.innerHTML = `<div class="sm-modal"><div class="sm-modal-head"><h3>${esc(title)}</h3><button type="button" data-sm-close>×</button></div><form id="sm-modal-form" class="sm-modal-form"><div class="sm-modal-body">${body}</div><div class="sm-modal-foot"><button type="button" class="btn btn-secondary" data-sm-close>取消</button><button type="submit" class="btn btn-primary">保存</button></div></form></div>`;
        document.body.appendChild(wrap);
        wrap.querySelectorAll('[data-sm-close]').forEach(button => button.addEventListener('click', () => wrap.remove()));
        wrap.querySelector('#sm-modal-form').addEventListener('submit', async event => {
            event.preventDefault();
            try { await onSave(new FormData(event.target), wrap); wrap.remove(); } catch (error) { global.showToast?.(error.message || String(error)); }
        });
        options.onOpen?.(wrap);
        return wrap;
    }

    function columnsEditorHtml(columns) {
        return `<div class="sm-form-section"><div class="sm-section-title"><strong>动态字段</strong><button type="button" class="btn btn-small btn-secondary" id="sm-add-column">添加字段</button></div><div id="sm-columns-list">${columns.map(columnRowHtml).join('')}</div></div>`;
    }

    function columnRowHtml(column = {}) {
        return `<div class="sm-column-row" data-column-id="${esc(column.id || id('memory_col'))}"><input class="sm-col-name" value="${esc(column.name || '')}" placeholder="字段名" required><select class="sm-col-type"><option value="text">单行文本</option><option value="longtext">多行文本</option><option value="number">数字</option><option value="date">日期</option><option value="datetime">日期时间</option><option value="select">单选</option><option value="multiselect">多选</option><option value="boolean">是/否</option></select><input class="sm-col-options" value="${esc((column.options || []).join('，'))}" placeholder="选项，逗号分隔"><label class="sm-col-hidden"><input type="checkbox" ${column.hidden ? 'checked' : ''}>隐藏</label><button type="button" data-remove-column>删除</button><textarea class="sm-col-hint" rows="2" placeholder="aiHint：告诉AI这个字段应如何判断和填写">${esc(column.aiHint || '')}</textarea></div>`;
    }

    function readColumns(wrap) {
        const columns = Array.from(wrap.querySelectorAll('.sm-column-row')).map((row, index) => normalizeColumn({
            id: row.dataset.columnId,
            name: row.querySelector('.sm-col-name').value,
            type: row.querySelector('.sm-col-type').value,
            options: unique(row.querySelector('.sm-col-options').value),
            aiHint: row.querySelector('.sm-col-hint')?.value || '',
            hidden: row.querySelector('.sm-col-hidden input')?.checked === true
        }, index)).filter(column => column.name);
        if (!columns.length) throw new Error('至少保留一个字段');
        return columns;
    }

    function openTableEditor(chat, existing) {
        const store = ensureStore(chat);
        const table = existing ? clone(existing) : normalizeTable({ name: '', level: 'short', columns: [{ name: '内容', type: 'longtext' }] }, store.tables.length);
        const sourceOptions = store.tables.filter(item => item.id !== table.id && item.level === 'short').map(item => `<label><input type="checkbox" name="sourceTableIds" value="${esc(item.id)}" ${table.aggregation.sourceTableIds.includes(item.id) ? 'checked' : ''}>${esc(item.name)}</label>`).join('') || '<span class="sm-help">暂无短期来源表</span>';
        const body = `
<div class="sm-form-grid"><label>表名<input name="name" value="${esc(table.name)}" required></label><label>表格类型<select name="recordMode"><option value="singleton">KV：左字段 / 右值</option><option value="rows">Rows：多行记录</option></select></label><label>记忆层级<select name="level"><option value="short">短期：随聊天写入</option><option value="medium">中期：积累写入</option><option value="long">长期：仅手动</option></select></label></div>
<label>用途说明<textarea name="description" rows="3">${esc(table.description)}</textarea></label>
<label>extractPrompt（AI提取规则）<textarea name="extractPrompt" rows="4" placeholder="说明什么时候提取、如何概括、哪些情况不要写入">${esc(table.extractPrompt)}</textarea></label>
${columnsEditorHtml(table.columns)}
<div class="sm-form-section"><strong>短期写入</strong><div class="sm-form-grid"><label><input type="checkbox" name="captureEnabled" ${table.capture.enabled ? 'checked' : ''}>允许随聊天直接写入</label><label>写入方式<select name="writeMode"><option value="upsert">匹配则更新，否则新增</option><option value="append">始终新增</option><option value="replace_latest">覆盖最近一条</option></select></label></div></div>
<div class="sm-form-section"><strong>分类与标签提示</strong><p class="sm-help">这里只提示AI如何分类和选择表，不作为写入门槛。只要目标表和字段合法，写入不会因分类或标签未命中而被拦截。</p><div class="sm-form-grid"><label>分类提示<input name="routingCategories" value="${esc(table.routing.categories.join('，'))}" placeholder="如：身体状态、当前任务"></label><label>标签提示<input name="routingTags" value="${esc(table.routing.tags.join('，'))}" placeholder="如：睡眠、工作、情绪"></label></div></div>
<div class="sm-form-section"><strong>聊天中的USER状态栏</strong><label><input type="checkbox" name="chatStatus" ${table.display.chatStatus ? 'checked' : ''}>用这张表显示USER当前状态（建议选择短期KV表，只能有一张）</label></div>
<div class="sm-form-section"><strong>中期积累</strong><label><input type="checkbox" name="aggregationEnabled" ${table.aggregation.enabled ? 'checked' : ''}>启用积累</label><div class="sm-source-checks">${sourceOptions}</div><div class="sm-form-grid"><label>分类过滤<input name="categoryFilters" value="${esc(table.aggregation.categoryFilters.join('，'))}" placeholder="留空表示全部"></label><label>包含标签<input name="aggregationIncludeTags" value="${esc(table.aggregation.includeTags.join('，'))}"></label><label>排除标签<input name="aggregationExcludeTags" value="${esc(table.aggregation.excludeTags.join('，'))}"></label><label>触发方式<select name="triggerType"><option value="manual">手动</option><option value="record_count">按新增记录数</option></select></label><label>累计条数<input name="triggerCount" type="number" min="1" value="${table.aggregation.triggerCount}"></label></div></div>
<div class="sm-form-section"><strong>分类和标签注入</strong><div class="sm-form-grid"><label><input type="checkbox" name="injectionEnabled" ${table.injection.enabled ? 'checked' : ''}>允许进入上下文</label><label>限定分类<input name="injectionCategories" value="${esc(table.injection.categories.join('，'))}" placeholder="留空表示不限制分类"></label><label>必须含标签<input name="injectionIncludeTags" value="${esc(table.injection.includeTags.join('，'))}" placeholder="留空表示不限制标签"></label><label>排除标签<input name="injectionExcludeTags" value="${esc(table.injection.excludeTags.join('，'))}"></label></div></div>`;
        modal(existing ? '编辑表格' : '新建表格', body, async (form, wrap) => {
            const oldLevel = table.level;
            table.name = text(form.get('name'));
            table.description = text(form.get('description'));
            table.extractPrompt = text(form.get('extractPrompt'));
            table.recordMode = form.get('recordMode') === 'singleton' ? 'singleton' : 'rows';
            table.level = LEVELS.has(text(form.get('level'))) ? text(form.get('level')) : 'short';
            table.columns = readColumns(wrap);
            table.capture.enabled = table.level === 'short' && form.get('captureEnabled') === 'on';
            table.capture.writeMode = text(form.get('writeMode')) || 'upsert';
            table.routing.categories = unique(form.get('routingCategories'));
            table.routing.tags = unique(form.get('routingTags'));
            table.display.chatStatus = table.level === 'short' && table.recordMode === 'singleton' && form.get('chatStatus') === 'on';
            if (table.display.chatStatus) store.tables.forEach(item => { if (item.id !== table.id) item.display.chatStatus = false; });
            table.aggregation.enabled = table.level === 'medium' && form.get('aggregationEnabled') === 'on';
            table.aggregation.sourceTableIds = form.getAll('sourceTableIds').map(text).filter(Boolean);
            table.aggregation.categoryFilters = unique(form.get('categoryFilters'));
            table.aggregation.includeTags = unique(form.get('aggregationIncludeTags'));
            table.aggregation.excludeTags = unique(form.get('aggregationExcludeTags'));
            table.aggregation.triggerType = text(form.get('triggerType')) || 'manual';
            table.aggregation.triggerCount = Math.max(1, parseInt(form.get('triggerCount'), 10) || 8);
            table.injection.enabled = form.get('injectionEnabled') === 'on';
            table.injection.categories = unique(form.get('injectionCategories'));
            table.injection.includeTags = unique(form.get('injectionIncludeTags'));
            table.injection.excludeTags = unique(form.get('injectionExcludeTags'));
            if (existing) {
                const index = store.tables.findIndex(item => item.id === existing.id); store.tables[index] = normalizeTable(table, index);
                const validIds = new Set(store.tables[index].columns.map(column => column.id));
                (store.records[table.id] || []).forEach(record => Object.keys(record.values).forEach(key => { if (!validIds.has(key)) delete record.values[key]; }));
                if (store.tables[index].recordMode === 'singleton' && (store.records[table.id] || []).length > 1) {
                    store.records[table.id] = (store.records[table.id] || []).slice().sort((a, b) => text(b.updatedAt).localeCompare(text(a.updatedAt))).slice(0, 1);
                }
            } else {
                store.tables.push(normalizeTable(table, store.tables.length)); store.records[table.id] = []; ui.activeTableId = table.id;
            }
            await persist(chat); render();
        }, { onOpen(wrap) {
            wrap.querySelector('[name="level"]').value = table.level;
            wrap.querySelector('[name="recordMode"]').value = table.recordMode;
            wrap.querySelector('[name="writeMode"]').value = table.capture.writeMode;
            wrap.querySelector('[name="triggerType"]').value = table.aggregation.triggerType;
            wrap.querySelectorAll('.sm-column-row').forEach((row, index) => { row.querySelector('.sm-col-type').value = table.columns[index]?.type || 'text'; });
            wrap.querySelector('#sm-add-column').addEventListener('click', () => wrap.querySelector('#sm-columns-list').insertAdjacentHTML('beforeend', columnRowHtml()));
            wrap.addEventListener('click', event => { if (event.target.matches('[data-remove-column]')) event.target.closest('.sm-column-row')?.remove(); });
        }});
    }

    function fieldControl(column, value) {
        const name = `value_${column.id}`;
        if (column.type === 'longtext') return `<textarea name="${esc(name)}" rows="6">${esc(value || '')}</textarea>`;
        if (column.type === 'select') return `<select name="${esc(name)}"><option value=""></option>${column.options.map(option => `<option ${text(value) === option ? 'selected' : ''}>${esc(option)}</option>`).join('')}</select>`;
        if (column.type === 'multiselect') return `<input name="${esc(name)}" value="${esc(Array.isArray(value) ? value.join('，') : value || '')}" placeholder="逗号分隔">`;
        if (column.type === 'boolean') return `<label class="sm-inline-check"><input type="checkbox" name="${esc(name)}" ${value ? 'checked' : ''}>是</label>`;
        const type = column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : column.type === 'datetime' ? 'datetime-local' : 'text';
        return `<input type="${type}" name="${esc(name)}" value="${esc(value || '')}" ${column.required ? 'required' : ''}>`;
    }

    function editorRow(label, control, hint = '') {
        return `<div class="sm-editor-row"><div class="sm-editor-label"><span>${esc(label)}</span>${hint ? `<small>${esc(hint)}</small>` : ''}</div><div class="sm-editor-control">${control}</div></div>`;
    }

    function openRecordEditor(chat, table, existing) {
        if (!table) return;
        const record = existing ? clone(existing) : normalizeRecord({ source: '用户明确' }, table);
        const fields = visibleColumns(table).map(column => editorRow(column.name, fieldControl(column, record.values?.[column.id]), column.aiHint)).join('');
        const meta = editorRow('分类', `<input name="category" value="${esc(record.category)}" placeholder="一个主要分类">`) + editorRow('标签', `<input name="tags" value="${esc(record.tags.join('，'))}" placeholder="逗号分隔">`) + editorRow('信息来源', '<select name="source"><option>用户明确</option><option>AI判断</option></select>');
        const body = `<div class="sm-record-editor">${fields}${meta}</div>`;
        modal(existing ? '编辑正式记录' : '新增正式记录', body, async form => {
            const values = Object.assign({}, record.values || {});
            visibleColumns(table).forEach(column => {
                const key = `value_${column.id}`;
                let value = column.type === 'boolean' ? form.get(key) === 'on' : form.get(key);
                if (column.type === 'multiselect') value = unique(value);
                if (column.type === 'number' && text(value)) value = Number(value);
                values[column.id] = value;
            });
            const operation = { tableId: table.id, action: existing ? 'upsert' : 'add', recordId: existing?.id, values, category: form.get('category'), tags: unique(form.get('tags')), source: form.get('source') };
            const result = applyOperations(chat, [operation], { origin: 'manual' });
            if (!result.changed.length) throw new Error(result.rejected[0]?.reason || '保存失败');
            await persist(chat); render(); refreshStateBar(chat);
        }, { onOpen(wrap) { wrap.querySelector('[name="source"]').value = record.source; } });
    }

    function openSettings(chat) {
        const store = ensureStore(chat); const s = store.settings;
        const body = `<div class="sm-form-grid"><label><input type="checkbox" name="enabled" ${s.enabled ? 'checked' : ''}>启用记忆系统</label><label><input type="checkbox" name="allowAiJudgment" ${s.allowAiJudgment ? 'checked' : ''}>允许AI判断直接写入</label><label><input type="checkbox" name="roundNoticeEnabled" ${s.roundNoticeEnabled !== false ? 'checked' : ''}>每轮显示记忆更新结果（无更新也提示）</label><label>上下文最多记录数<input name="injectionMaxRecords" type="number" min="1" value="${s.injectionMaxRecords}"></label><label>始终注入标签<input name="alwaysInject" value="${esc(s.tagBehaviors.alwaysInject.join('，'))}"></label><label>禁止注入标签<input name="neverInject" value="${esc(s.tagBehaviors.neverInject.join('，'))}"></label></div><p class="sm-help">表结构、短中长期规则、分类和标签配置均保存在当前角色的 memoryStore 中。上下文匹配只读取最近1条聊天消息。</p>`;
        modal('记忆设置', body, async form => {
            s.enabled = form.get('enabled') === 'on'; s.allowAiJudgment = form.get('allowAiJudgment') === 'on';
            s.roundNoticeEnabled = form.get('roundNoticeEnabled') === 'on';
            s.injectionMaxRecords = Math.max(1, parseInt(form.get('injectionMaxRecords'), 10) || 24);
            s.tagBehaviors.alwaysInject = unique(form.get('alwaysInject')); s.tagBehaviors.neverInject = unique(form.get('neverInject'));
            await persist(chat); render();
        });
    }

    function exportStore(chat) {
        const blob = new Blob([JSON.stringify(ensureStore(chat), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob); const link = document.createElement('a');
        link.href = url; link.download = `memoryStore_${chat.remarkName || chat.realName || chat.id}_${new Date().toISOString().slice(0, 10)}.json`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function importStore(chat, file) {
        if (!file) return;
        const parsed = JSON.parse(await file.text());
        if (!parsed || !Array.isArray(parsed.tables) || typeof parsed.records !== 'object') throw new Error('不是有效的memoryStore文件');
        if (!confirm('导入会覆盖当前角色的全部记忆表和记录，是否继续？')) return;
        chat.memoryStore = parsed; ensureStore(chat); await persist(chat); ui.activeTableId = ''; render();
    }

    function setup() {
        if (ui.bound) return render();
        ui.bound = true;
        migrateAllCharacters().finally(render);
    }

    function openForCharacter(characterId) {
        if (characterId) { global.currentChatId = characterId; global.currentChatType = 'private'; }
        global.showScreen?.('memory-table-screen'); render();
    }

    const sidecarApi = Object.freeze({
        VERSION,
        buildSystemPrompt,
        extractSidecar,
        applySidecar,
        completeRound,
        ensureState: ensureSidecarState,
        migratePolicies: ensureStore,
        refreshStateBar,
        bindUi() { refreshStateBar(getCurrentChat()); }
    });

    const policyApi = Object.freeze({
        VERSION,
        beginRound(chat) { ensureStore(chat); return { id: id('memory_round'), at: Date.now() }; },
        finishRound() {}, cancelRound() {}
    });

    const facade = Object.freeze({
        VERSION,
        state: Object.freeze({ ensure: ensureStore, currentChat: getCurrentChat }),
        screen: Object.freeze({ setup, render, openWorkspace() { render(); } }),
        context: Object.freeze({ get: getContextBlock, prepare: async chat => getContextBlock(chat), export: getContextBlock }),
        writer: Object.freeze({ apply: applyOperations }),
        aggregation: Object.freeze({ run: runAggregation, check: runEligibleAggregations }),
        health() { return { ok: true, version: VERSION, mode: 'single-source-dynamic-tables' }; }
    });

    global.MemoryTableSidecar = sidecarApi;
    global.MemoryTablePolicy = policyApi;
    global.OvoMemory = facade;
    global.ensureMemoryTableState = ensureStore;
    global.setupMemoryTableScreen = setup;
    global.renderMemoryTableScreen = render;
    global.getMemoryTableContextBlock = getContextBlock;
    global.prepareMemoryTableContext = async chat => getContextBlock(chat);
    global.exportMemoryTableContext = getContextBlock;
    global.getBoundMemoryTableTemplateIds = chat => ensureStore(chat).tables.map(table => table.id);
    global.checkAndTriggerAutoTableUpdate = async chat => runEligibleAggregations(chat);
    global.openMemoryTableForCharacter = openForCharacter;
    global.MemorySimpleV1 = Object.freeze({ VERSION, ensureStore, applyOperations, runAggregation, getContextBlock, render });
})(window);
