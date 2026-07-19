(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    const Core = Kernel?.core;
    if (!Core) throw new Error('记忆内核未加载');
    const MemoryPolicy = Kernel.get('policy');
    const MemoryReview = Kernel.get('review');
    const MemoryEffects = Kernel.get('effects');
    const MemoryLifecycle = Kernel.get('lifecycle');
    const MemoryTasks = Kernel.get('tasks');
    const MemoryFeedback = Kernel.get('feedback');
    const MemoryQuality = Kernel.get('quality');
    const MEMORY_TABLE_HISTORY_LIMIT = 20;
    const deepClone = Core.clone;
    const createMemoryId = Core.createId;
    const moveArrayItem = Core.moveArrayItem;

    function ensureMemoryTemplateStore() {
        if (!Array.isArray(global.db.memoryTableTemplates)) {
            global.db.memoryTableTemplates = [];
        }
    }

    function ensureMemoryTableState(chat) {
        if (!chat) return;
        if (!chat.memoryMode) chat.memoryMode = 'journal';
        if (!chat.memoryTables || typeof chat.memoryTables !== 'object') {
            chat.memoryTables = {};
        }
        if (chat.memoryTables.enabled === undefined) chat.memoryTables.enabled = true;
        if (!Array.isArray(chat.memoryTables.boundTemplateIds)) chat.memoryTables.boundTemplateIds = [];
        if (!chat.memoryTables.data || typeof chat.memoryTables.data !== 'object') chat.memoryTables.data = {};
        if (!chat.memoryTables.lockedFields || typeof chat.memoryTables.lockedFields !== 'object') chat.memoryTables.lockedFields = {};
        if (!Array.isArray(chat.memoryTables.history)) chat.memoryTables.history = [];
        if (!Array.isArray(chat.memoryTables.lastChangedFieldPaths)) chat.memoryTables.lastChangedFieldPaths = [];
        if (chat.memoryTables.autoUpdateEnabled === undefined) chat.memoryTables.autoUpdateEnabled = false;
        if (!Number.isFinite(parseInt(chat.memoryTables.autoUpdateInterval, 10))) chat.memoryTables.autoUpdateInterval = 100;
        if (chat.memoryTables.lastUpdateMsgId === undefined) chat.memoryTables.lastUpdateMsgId = null;
        if (chat.memoryTables.lastUpdateMsgTimestamp === undefined) chat.memoryTables.lastUpdateMsgTimestamp = null;
        if (!chat.memoryTables.autoUpdateState) chat.memoryTables.autoUpdateState = 'idle';
        if (chat.memoryTables.autoUpdatePending === undefined) chat.memoryTables.autoUpdatePending = false;
        if (!chat.memoryTables.lifecycle || typeof chat.memoryTables.lifecycle !== 'object') chat.memoryTables.lifecycle = { schemaVersion: '2.5', lastMaintenanceAt: 0, lastMaintenanceReport: null };
        if (MemoryTasks) MemoryTasks.ensureState(chat);
        if (MemoryFeedback) MemoryFeedback.ensureState(chat);
        if (MemoryQuality) MemoryQuality.ensureState(chat);
        const reviewState = MemoryReview ? MemoryReview.ensureState(chat) : null;
        if (MemoryPolicy) {
            const runtime = MemoryPolicy.ensureRuntimeState(chat);
            const pendingIds = new Set((reviewState?.pendingBatches || []).map(item => item.id));
            Object.values(runtime.tableStates || {}).forEach(tableMap => {
                Object.values(tableMap || {}).forEach(state => {
                    if (state?.pendingReviewBatchId && !pendingIds.has(state.pendingReviewBatchId)) {
                        state.pendingReviewBatchId = null;
                        if (state.lastRunStatus === 'pending_review') state.lastRunStatus = 'idle';
                    }
                });
            });
            // 旧设置继续作为 V2 的消息量兜底，保证旧 UI / 旧存档可用。
            if (Number.isFinite(parseInt(chat.memoryTables.autoUpdateInterval, 10))) {
                runtime.engineSettings.messageInterval = Math.max(10, parseInt(chat.memoryTables.autoUpdateInterval, 10));
            }
            runtime.engineSettings.enabled = chat.memoryTables.autoUpdateEnabled !== false;
            const boundForMigration = (Array.isArray(global.db.memoryTableTemplates) ? global.db.memoryTableTemplates : []).filter(template => chat.memoryTables.boundTemplateIds.includes(template.id));
            if (MemoryEffects && !runtime.effectsMigratedAt) {
                const changed = MemoryEffects.migrateRows(chat, boundForMigration);
                runtime.effectsMigratedAt = Date.now();
                runtime.effectsMigratedRows = changed;
            }
            if (MemoryLifecycle && !runtime.lifecycleMigratedAt) {
                const changed = MemoryLifecycle.migrateRows(chat, boundForMigration);
                runtime.lifecycleMigratedAt = Date.now();
                runtime.lifecycleMigratedRows = changed;
            }
        }
    }

    function getCurrentMemoryTableChat() {
        if (!global.currentChatId || global.currentChatType !== 'private') return null;
        const chat = global.db.characters.find(c => c.id === global.currentChatId);
        if (chat) ensureMemoryTableState(chat);
        return chat || null;
    }

    function createStarterTemplate() {
        return {
            id: createMemoryId('memory_tpl'),
            name: '基础关系模板',
            description: '可自由改成恋爱、亲友、群像或剧情向结构化记忆。',
            tables: [
                {
                    id: createMemoryId('memory_table'),
                    name: '关系状态',
                    mode: 'keyValue',
                    extractPrompt: '请只更新发生明确变化的字段。优先保持客观、简洁，不要凭空编造没有发生过的设定。',
                    columns: [
                        {
                            id: createMemoryId('memory_field'),
                            key: '当前关系',
                            type: 'enum',
                            options: ['陌生', '朋友', '暧昧', '恋人'],
                            default: '朋友',
                            aiEditable: true,
                            aiHint: '根据对话中双方关系推进情况调整。'
                        },
                        {
                            id: createMemoryId('memory_field'),
                            key: '好感度',
                            type: 'progress',
                            default: 50,
                            min: 0,
                            max: 100,
                            aiEditable: true,
                            aiHint: '根据对话氛围小幅波动，一次变动不宜过大。',
                            conditionalRules: [
                                { op: '<=', value: 20, color: '#ffe7e7' },
                                { op: '>=', value: 80, color: '#e8fff1' }
                            ]
                        },
                        {
                            id: createMemoryId('memory_field'),
                            key: '最近发生的事',
                            type: 'longtext',
                            default: '',
                            aiEditable: true,
                            aiHint: '只记录最近最重要的一件事，简短概括。'
                        },
                        {
                            id: createMemoryId('memory_field'),
                            key: '特别称呼',
                            type: 'text',
                            default: '',
                            aiEditable: true,
                            aiHint: '如果角色开始用新的称呼，可以更新。'
                        }
                    ]
                }
            ]
        };
    }

    function createEmptyFieldDraft() {
        return {
            id: createMemoryId('memory_field'),
            key: '新字段',
            group: '',
            type: 'text',
            default: '',
            options: [],
            min: 0,
            max: 100,
            aiEditable: true,
            aiHint: '',
            displayFormat: '{value}',
            important: true,
            summaryLabel: '',
            conditionalRules: []
        };
    }

    function createEmptyTableDraft() {
        return {
            id: createMemoryId('memory_table'),
            name: '新表格',
            mode: 'keyValue',
            memoryLayer: 'short',
            updatePolicy: MemoryPolicy ? MemoryPolicy.normalizeUpdatePolicy({}, 'short') : {},
            injectionPolicy: MemoryPolicy ? MemoryPolicy.normalizeInjectionPolicy({}, 'short') : {},
            extractPrompt: '',
            columns: [createEmptyFieldDraft()]
        };
    }

    function normalizeConditionalRule(rule) {
        if (!rule || typeof rule !== 'object') return null;
        const op = typeof rule.op === 'string' ? rule.op : '=';
        const color = typeof rule.color === 'string' ? rule.color : '';
        return {
            op,
            value: rule.value,
            color
        };
    }

    function normalizeTemplate(rawTemplate, fallbackId) {
        if (!rawTemplate || typeof rawTemplate !== 'object') {
            throw new Error('模板必须是对象');
        }

        const template = {
            id: rawTemplate.id || fallbackId || createMemoryId('memory_tpl'),
            name: (rawTemplate.name || '').trim() || '未命名模板',
            description: typeof rawTemplate.description === 'string' ? rawTemplate.description : '',
            engineDefaults: MemoryPolicy ? MemoryPolicy.normalizeEngineSettings(rawTemplate.engineDefaults || {}) : (rawTemplate.engineDefaults || {}),
            tables: Array.isArray(rawTemplate.tables) ? rawTemplate.tables : []
        };

        if (template.tables.length === 0) {
            template.tables = createStarterTemplate().tables;
        }

        template.tables = template.tables.map((table, tableIndex) => {
            const tablePolicy = MemoryPolicy
                ? MemoryPolicy.normalizeTablePolicy(table)
                : { memoryLayer: table.memoryLayer || 'long', updatePolicy: table.updatePolicy || {}, injectionPolicy: table.injectionPolicy || {} };
            const normalizedTable = {
                id: table.id || createMemoryId('memory_table'),
                name: (table.name || '').trim() || `表格 ${tableIndex + 1}`,
                mode: table.mode === 'rows' ? 'rows' : 'keyValue',
                memoryLayer: tablePolicy.memoryLayer,
                updatePolicy: tablePolicy.updatePolicy,
                injectionPolicy: tablePolicy.injectionPolicy,
                extractPrompt: typeof table.extractPrompt === 'string' ? table.extractPrompt : '',
                columns: Array.isArray(table.columns) ? table.columns : []
            };

            if (normalizedTable.columns.length === 0) {
                normalizedTable.columns = [{
                    id: createMemoryId('memory_field'),
                    key: '字段1',
                    type: 'text',
                    default: '',
                    aiEditable: true,
                    aiHint: ''
                }];
            }

            normalizedTable.columns = normalizedTable.columns.map((field, fieldIndex) => ({
                id: field.id || createMemoryId('memory_field'),
                key: (field.key || '').trim() || `字段${fieldIndex + 1}`,
                group: typeof field.group === 'string' ? field.group.trim() : '',
                type: normalizeFieldType(field.type),
                default: field.default !== undefined ? field.default : getDefaultValueByType(normalizeFieldType(field.type)),
                options: Array.isArray(field.options) ? field.options.map(opt => String(opt)) : [],
                min: typeof field.min === 'number' ? field.min : (normalizeFieldType(field.type) === 'progress' ? 0 : undefined),
                max: typeof field.max === 'number' ? field.max : (normalizeFieldType(field.type) === 'progress' ? 100 : undefined),
                aiEditable: field.aiEditable !== false,
                aiHint: typeof field.aiHint === 'string' ? field.aiHint : '',
                displayFormat: typeof field.displayFormat === 'string' ? field.displayFormat : '{value}',
                important: field.important !== false,
                summaryLabel: typeof field.summaryLabel === 'string' ? field.summaryLabel : '',
                conditionalRules: Array.isArray(field.conditionalRules)
                    ? field.conditionalRules.map(normalizeConditionalRule).filter(Boolean)
                    : []
            }));

            return normalizedTable;
        });

        return template;
    }

    function normalizeFieldType(type) {
        const normalized = String(type || 'text').toLowerCase();
        const supported = ['text', 'longtext', 'number', 'enum', 'tags', 'progress', 'date', 'boolean'];
        return supported.includes(normalized) ? normalized : 'text';
    }

    function parseOptionText(text) {
        return String(text || '')
            .split(/\r?\n|[,，]/)
            .map(item => item.trim())
            .filter(Boolean);
    }

    function parseConditionalRulesText(text) {
        return String(text || '')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                const [op = '=', value = '', color = ''] = line.split('|').map(item => item.trim());
                return normalizeConditionalRule({
                    op,
                    value: value === '' ? '' : (isNaN(Number(value)) ? value : Number(value)),
                    color
                });
            })
            .filter(Boolean);
    }

    function serializeConditionalRules(rules) {
        return (rules || []).map(rule => `${rule.op || '='}|${rule.value ?? ''}|${rule.color || ''}`).join('\n');
    }

    function getDefaultValueByType(type) {
        switch (type) {
            case 'number':
            case 'progress':
                return 0;
            case 'boolean':
                return false;
            case 'tags':
                return [];
            default:
                return '';
        }
    }

    function getFieldDefaultValue(field) {
        if (field && field.default !== undefined) {
            return normalizeFieldValue(field, field.default);
        }
        return getDefaultValueByType(field ? field.type : 'text');
    }

    function getBoundTemplates(chat) {
        ensureMemoryTemplateStore();
        ensureMemoryTableState(chat);
        return global.db.memoryTableTemplates.filter(template => chat.memoryTables.boundTemplateIds.includes(template.id));
    }

    function isRowsTable(table) {
        return !!table && table.mode === 'rows';
    }

    function createEmptyRow(table) {
        const now = Date.now();
        const row = {
            id: createMemoryId('memory_row'),
            cells: {},
            meta: {
                createdAt: now,
                updatedAt: now,
                lastMentionedAt: now,
                expiresAt: null,
                status: 'active',
                importance: 50,
                confidence: 70,
                pinned: false,
                tags: [],
                tagBundle: { topic: [], scene: ['日常聊天'], entity: [], effect: 'historical_context' },
                usePolicy: { injectionEnabled: true, paused: false, allowedScenes: [], blockedScenes: [], maxInfluence: 'low', cooldownRounds: 0, allowProactiveMention: false, mentionPolicy: 'relevant_only' },
                usage: { retrievalCount: 0, injectionCount: 0, lastRetrievedAt: 0, lastInjectedAt: 0, lastInjectedRoundIndex: -999999, correctionCount: 0, helpfulCount: 0 },
                feedback: { helpfulCount: 0, irrelevantCount: 0, outdatedCount: 0, inaccurateCount: 0, sceneBlockedCount: 0, pauseCount: 0, forgetCount: 0, weight: 0, snoozedUntilRoundIndex: -1, sceneNegative: {}, lastType: '', lastAt: 0, lastScene: '', lastRoundId: '' },
                sourceMessageIds: [],
                evidence: { primarySource: 'manual', userEvidenceCount: 0, behaviorEvidenceCount: 0, assistantEvidenceCount: 0, summaryEvidenceCount: 0, userConfirmed: false, lastVerifiedAt: 0, sourceRefs: [], note: '' },
                lifecycle: { status: 'active', retentionMode: 'manual', expiresAt: 0, reviewAt: 0, decayHalfLifeDays: 365, autoArchiveAfterDays: 0, statusReason: '', archivedAt: 0, supersededAt: 0, expiredAt: 0 },
                relations: { supersedes: [], supersededBy: [], conflictsWith: [], relatedTo: [] },
                versionLog: [],
                retrievalVector: [],
                retrievalVectorFingerprint: '',
                retrievalIndexedAt: 0
            }
        };
        (table.columns || []).forEach(field => {
            row.cells[field.id] = getFieldDefaultValue(field);
        });
        return row;
    }

    function normalizeRowShape(table, rawRow) {
        const now = Date.now();
        const rawMeta = rawRow && rawRow.meta && typeof rawRow.meta === 'object' ? rawRow.meta : {};
        const row = {
            id: rawRow && rawRow.id ? rawRow.id : createMemoryId('memory_row'),
            cells: {},
            meta: {
                createdAt: Number(rawMeta.createdAt) || now,
                updatedAt: Number(rawMeta.updatedAt) || Number(rawMeta.createdAt) || now,
                lastMentionedAt: Number(rawMeta.lastMentionedAt) || Number(rawMeta.updatedAt) || Number(rawMeta.createdAt) || now,
                expiresAt: rawMeta.expiresAt || null,
                status: typeof rawMeta.status === 'string' ? rawMeta.status : 'active',
                importance: Number.isFinite(Number(rawMeta.importance)) ? Number(rawMeta.importance) : 50,
                confidence: Number.isFinite(Number(rawMeta.confidence)) ? Number(rawMeta.confidence) : 70,
                pinned: !!rawMeta.pinned,
                tags: Array.isArray(rawMeta.tags) ? rawMeta.tags.map(String).filter(Boolean) : [],
                tagBundle: rawMeta.tagBundle && typeof rawMeta.tagBundle === 'object' ? rawMeta.tagBundle : null,
                usePolicy: rawMeta.usePolicy && typeof rawMeta.usePolicy === 'object' ? rawMeta.usePolicy : null,
                usage: rawMeta.usage && typeof rawMeta.usage === 'object' ? rawMeta.usage : null,
                feedback: rawMeta.feedback && typeof rawMeta.feedback === 'object' ? rawMeta.feedback : null,
                sourceMessageIds: Array.isArray(rawMeta.sourceMessageIds) ? rawMeta.sourceMessageIds.map(String).filter(Boolean) : [],
                evidence: rawMeta.evidence && typeof rawMeta.evidence === 'object' ? rawMeta.evidence : null,
                lifecycle: rawMeta.lifecycle && typeof rawMeta.lifecycle === 'object' ? rawMeta.lifecycle : null,
                relations: rawMeta.relations && typeof rawMeta.relations === 'object' ? rawMeta.relations : null,
                versionLog: Array.isArray(rawMeta.versionLog) ? rawMeta.versionLog.slice(-40) : [],
                retrievalVector: Array.isArray(rawMeta.retrievalVector) ? rawMeta.retrievalVector.map(Number).filter(Number.isFinite) : [],
                retrievalVectorFingerprint: typeof rawMeta.retrievalVectorFingerprint === 'string' ? rawMeta.retrievalVectorFingerprint : '',
                retrievalIndexedAt: Number(rawMeta.retrievalIndexedAt) || 0
            }
        };
        (table.columns || []).forEach(field => {
            const rawValue = rawRow && rawRow.cells && rawRow.cells[field.id] !== undefined
                ? rawRow.cells[field.id]
                : (rawRow && rawRow[field.id] !== undefined ? rawRow[field.id] : undefined);
            row.cells[field.id] = rawValue === undefined ? getFieldDefaultValue(field) : normalizeFieldValue(field, rawValue);
        });
        const searchText = (table.columns || []).map(field => `${field.key}: ${row.cells[field.id] ?? ''}`).join('\n');
        if (MemoryEffects) MemoryEffects.ensureRowMeta(row, table, searchText);
        if (MemoryFeedback) MemoryFeedback.ensureRowMeta(row);
        if (MemoryLifecycle) MemoryLifecycle.ensureRowMeta(row, table, searchText);
        return row;
    }

    function ensureTemplateDataForChat(chat, template) {
        ensureMemoryTableState(chat);
        if (!chat.memoryTables.data[template.id] || typeof chat.memoryTables.data[template.id] !== 'object') {
            chat.memoryTables.data[template.id] = {};
        }
        if (!chat.memoryTables.lockedFields[template.id] || typeof chat.memoryTables.lockedFields[template.id] !== 'object') {
            chat.memoryTables.lockedFields[template.id] = {};
        }

        template.tables.forEach(table => {
            if (!chat.memoryTables.data[template.id][table.id] || typeof chat.memoryTables.data[template.id][table.id] !== 'object') {
                chat.memoryTables.data[template.id][table.id] = isRowsTable(table) ? { __rows: [] } : {};
            }
            if (!Array.isArray(chat.memoryTables.lockedFields[template.id][table.id])) {
                chat.memoryTables.lockedFields[template.id][table.id] = [];
            }

            if (isRowsTable(table)) {
                const tableData = chat.memoryTables.data[template.id][table.id];
                if (!Array.isArray(tableData.__rows)) {
                    const legacyRow = normalizeRowShape(table, tableData);
                    const hasLegacyValue = (table.columns || []).some(field => !isEmptyMemoryValue(field, legacyRow.cells[field.id]));
                    chat.memoryTables.data[template.id][table.id] = {
                        __rows: hasLegacyValue ? [legacyRow] : []
                    };
                } else {
                    tableData.__rows = tableData.__rows.map(row => normalizeRowShape(table, row));
                }
                return;
            }

            table.columns.forEach(field => {
                if (chat.memoryTables.data[template.id][table.id][field.id] === undefined) {
                    chat.memoryTables.data[template.id][table.id][field.id] = getFieldDefaultValue(field);
                }
            });
        });
    }

    function getRows(chat, templateId, table) {
        ensureTemplateDataForChat(chat, { id: templateId, tables: [table] });
        const rows = chat.memoryTables.data?.[templateId]?.[table.id]?.__rows;
        return Array.isArray(rows) ? rows : [];
    }

    function findRowById(chat, templateId, table, rowId) {
        return getRows(chat, templateId, table).find(row => row.id === rowId) || null;
    }

    function normalizeFieldValue(field, rawValue) {
        const type = normalizeFieldType(field && field.type);
        if (rawValue === undefined || rawValue === null) {
            return getDefaultValueByType(type);
        }

        switch (type) {
            case 'number': {
                const n = Number(rawValue);
                if (Number.isNaN(n)) return getFieldDefaultValue(field);
                return clampFieldValue(field, n);
            }
            case 'progress': {
                const n = Number(rawValue);
                if (Number.isNaN(n)) return getFieldDefaultValue(field);
                return clampFieldValue(field, n);
            }
            case 'boolean':
                if (typeof rawValue === 'boolean') return rawValue;
                return ['true', '1', 'yes', '是', '开', '开启'].includes(String(rawValue).trim().toLowerCase());
            case 'enum': {
                const value = String(rawValue).trim();
                if (Array.isArray(field.options) && field.options.length > 0 && !field.options.includes(value)) {
                    return field.default !== undefined ? field.default : field.options[0];
                }
                return value;
            }
            case 'tags':
                if (Array.isArray(rawValue)) {
                    return rawValue.map(item => String(item).trim()).filter(Boolean);
                }
                return String(rawValue).split(/[,，、]/).map(item => item.trim()).filter(Boolean);
            case 'date':
                return String(rawValue).trim();
            default:
                return String(rawValue);
        }
    }

    function clampFieldValue(field, value) {
        let result = value;
        if (typeof field.min === 'number') result = Math.max(field.min, result);
        if (typeof field.max === 'number') result = Math.min(field.max, result);
        return result;
    }

    function getFieldValue(chat, templateId, tableId, field) {
        ensureMemoryTableState(chat);
        const raw = chat.memoryTables.data?.[templateId]?.[tableId]?.[field.id];
        if (raw === undefined) {
            return getFieldDefaultValue(field);
        }
        return normalizeFieldValue(field, raw);
    }

    function pushMemoryHistory(chat, changedFields, options = {}) {
        if (!Array.isArray(changedFields) || changedFields.length === 0) return;
        if (!options.skipHistory) {
            const entry = {
                id: createMemoryId('memory_history'),
                timestamp: Date.now(),
                source: options.source || 'manual',
                snapshot: options.snapshot ? deepClone(options.snapshot) : deepClone(chat.memoryTables.data),
                changedFields
            };
            chat.memoryTables.history.unshift(entry);
            if (chat.memoryTables.history.length > MEMORY_TABLE_HISTORY_LIMIT) {
                chat.memoryTables.history = chat.memoryTables.history.slice(0, MEMORY_TABLE_HISTORY_LIMIT);
            }
        }
        chat.memoryTables.lastChangedFieldPaths = changedFields
            .map(item => item.fieldId ? buildFieldPath(item.templateId, item.tableId, item.fieldId, item.rowId) : '')
            .filter(Boolean);
    }

    function setFieldValue(chat, templateId, tableId, field, value, options = {}) {
        ensureMemoryTableState(chat);
        if (!chat.memoryTables.data[templateId]) chat.memoryTables.data[templateId] = {};
        if (!chat.memoryTables.data[templateId][tableId]) chat.memoryTables.data[templateId][tableId] = {};

        const oldValue = getFieldValue(chat, templateId, tableId, field);
        const normalized = normalizeFieldValue(field, value);
        chat.memoryTables.data[templateId][tableId][field.id] = normalized;

        if (!isSameMemoryValue(oldValue, normalized)) {
            if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
            pushMemoryHistory(chat, [{
                templateId,
                tableId,
                fieldId: field.id,
                label: field.key,
                oldValue,
                newValue: normalized
            }], options);
        }
    }

    function isSameMemoryValue(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    function buildFieldPath(templateId, tableId, fieldId, rowId = '') {
        return `${templateId}::${tableId}::${rowId || 'single'}::${fieldId}`;
    }

    function addRow(chat, templateId, table, initialValues = {}, options = {}) {
        const rows = getRows(chat, templateId, table);
        const row = createEmptyRow(table);
        (table.columns || []).forEach(field => {
            if (initialValues[field.id] !== undefined) {
                row.cells[field.id] = normalizeFieldValue(field, initialValues[field.id]);
            }
        });
        rows.push(row);
        if (MemoryLifecycle) {
            const sourceMap = { manual: 'manual', api: 'summary_api', review_v2_2: 'summary_api', candidate_approve_v2_1: 'manual', sidecar: 'assistant_inferred' };
            MemoryLifecycle.ensureRowMeta(row, table, getRowSearchText(table, row));
            MemoryLifecycle.recordSource(row, sourceMap[options.source] || (String(options.source || '').includes('review') ? 'summary_api' : 'manual'), { type: options.sourceMessageId ? 'message' : 'manual', id: options.sourceMessageId || options.source || 'manual', at: Date.now() }, { userConfirmed: options.userConfirmed === true });
        }
        if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
        pushMemoryHistory(chat, (table.columns || []).map(field => ({
            templateId,
            tableId: table.id,
            rowId: row.id,
            fieldId: field.id,
            label: `${table.name} / ${field.key}（新增行）`,
            oldValue: '',
            newValue: row.cells[field.id]
        })), options);
        return row;
    }

    function updateRowFieldValue(chat, templateId, table, rowId, field, value, options = {}) {
        const row = findRowById(chat, templateId, table, rowId);
        if (!row) return false;
        const oldValue = row.cells[field.id];
        const normalized = normalizeFieldValue(field, value);
        row.cells[field.id] = normalized;
        row.meta ||= {};
        row.meta.updatedAt = Date.now();
        row.meta.lastMentionedAt = Date.now();
        if (MemoryLifecycle) {
            const source = options.source === 'manual' ? 'manual' : (String(options.source || '').includes('review') || options.source === 'api' ? 'summary_api' : 'manual');
            MemoryLifecycle.recordSource(row, source, { type: 'manual', id: options.source || source, at: Date.now() }, { verified: options.source === 'manual' });
        }
        if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
        if (isSameMemoryValue(oldValue, normalized)) {
            return false;
        }
        pushMemoryHistory(chat, [{
            templateId,
            tableId: table.id,
            rowId,
            fieldId: field.id,
            label: `${table.name} / ${field.key}`,
            oldValue,
            newValue: normalized
        }], options);
        return true;
    }

    function deleteRow(chat, templateId, table, rowId, options = {}) {
        const rows = getRows(chat, templateId, table);
        const index = rows.findIndex(row => row.id === rowId);
        if (index < 0) return false;
        const [removed] = rows.splice(index, 1);
        if (MemoryLifecycle) MemoryLifecycle.removeReferences(chat, getBoundTemplates(chat), rowId);
        if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
        pushMemoryHistory(chat, (table.columns || []).map(field => ({
            templateId,
            tableId: table.id,
            rowId,
            fieldId: field.id,
            label: `${table.name} / ${field.key}（删除行）`,
            oldValue: removed.cells[field.id],
            newValue: ''
        })), options);
        return true;
    }

    function moveRow(chat, templateId, table, rowId, delta) {
        const rows = getRows(chat, templateId, table);
        const fromIndex = rows.findIndex(row => row.id === rowId);
        const toIndex = fromIndex + delta;
        if (fromIndex < 0 || toIndex < 0 || toIndex >= rows.length) return false;
        moveArrayItem(rows, fromIndex, toIndex);
        chat.memoryTables.lastChangedFieldPaths = [];
        return true;
    }

    function isFieldLocked(chat, templateId, tableId, fieldId) {
        ensureMemoryTableState(chat);
        return !!(chat.memoryTables.lockedFields?.[templateId]?.[tableId] || []).includes(fieldId);
    }

    function toggleFieldLock(chat, templateId, tableId, fieldId) {
        ensureMemoryTableState(chat);
        if (!chat.memoryTables.lockedFields[templateId]) chat.memoryTables.lockedFields[templateId] = {};
        if (!Array.isArray(chat.memoryTables.lockedFields[templateId][tableId])) {
            chat.memoryTables.lockedFields[templateId][tableId] = [];
        }
        const list = chat.memoryTables.lockedFields[templateId][tableId];
        const index = list.indexOf(fieldId);
        if (index >= 0) {
            list.splice(index, 1);
        } else {
            list.push(fieldId);
        }
    }

    function getFieldDisplayValue(field, value) {
        const normalized = normalizeFieldValue(field, value);
        const type = normalizeFieldType(field.type);
        if (type === 'tags') return normalized.join(', ');
        if (type === 'boolean') return normalized ? '是' : '否';
        if (type === 'progress') {
            const max = typeof field.max === 'number' ? field.max : 100;
            return `${normalized}/${max}`;
        }
        return String(normalized ?? '');
    }

    function evaluateConditionalColor(field, value) {
        if (!Array.isArray(field.conditionalRules) || field.conditionalRules.length === 0) return '';
        const current = normalizeFieldValue(field, value);
        for (const rule of field.conditionalRules) {
            if (!rule || !rule.color) continue;
            const target = rule.value;
            switch (rule.op) {
                case '>':
                    if (current > target) return rule.color;
                    break;
                case '>=':
                    if (current >= target) return rule.color;
                    break;
                case '<':
                    if (current < target) return rule.color;
                    break;
                case '<=':
                    if (current <= target) return rule.color;
                    break;
                case '!=':
                    if (current !== target) return rule.color;
                    break;
                case 'contains':
                    if (Array.isArray(current) && current.includes(target)) return rule.color;
                    if (String(current).includes(String(target))) return rule.color;
                    break;
                default:
                    if (current === target) return rule.color;
                    break;
            }
        }
        return '';
    }

    function isEmptyMemoryValue(field, value) {
        const normalized = normalizeFieldValue(field, value);
        switch (normalizeFieldType(field.type)) {
            case 'number':
            case 'progress':
                return normalized === 0 || normalized === '' || normalized === null;
            case 'boolean':
                return normalized === false;
            case 'tags':
                return !normalized || normalized.length === 0;
            default:
                return !String(normalized || '').trim();
        }
    }

    function getRowSearchText(table, row) {
        return (table.columns || []).map(field => {
            const value = getFieldDisplayValue(field, row.cells?.[field.id]);
            return `${field.key}: ${value || ''}`;
        }).join('\n');
    }


    const api = {
        ensureMemoryTemplateStore,
        ensureMemoryTableState,
        getCurrentMemoryTableChat,
        createStarterTemplate,
        createEmptyFieldDraft,
        createEmptyTableDraft,
        normalizeConditionalRule,
        normalizeTemplate,
        normalizeFieldType,
        parseOptionText,
        parseConditionalRulesText,
        serializeConditionalRules,
        getDefaultValueByType,
        getFieldDefaultValue,
        getBoundTemplates,
        isRowsTable,
        createEmptyRow,
        normalizeRowShape,
        ensureTemplateDataForChat,
        getRows,
        findRowById,
        normalizeFieldValue,
        clampFieldValue,
        getFieldValue,
        pushMemoryHistory,
        setFieldValue,
        isSameMemoryValue,
        buildFieldPath,
        addRow,
        updateRowFieldValue,
        deleteRow,
        moveRow,
        isFieldLocked,
        toggleFieldLock,
        getFieldDisplayValue,
        evaluateConditionalColor,
        isEmptyMemoryValue,
        getRowSearchText
    };

    Kernel.register('domain', api);
})(window);
