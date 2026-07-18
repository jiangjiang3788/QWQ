// --- 结构化记忆 / 表格记忆 (js/modules/memory_table.js) ---
(function () {
    const MEMORY_TABLE_HISTORY_LIMIT = 20;
    const MEMORY_TABLE_MAX_CONTEXT_MESSAGES = 60; // V1 兼容默认值；V2 可由角色设置覆盖
    const MemoryPolicy = window.MemoryTablePolicy || null;

    const uiState = {
        tab: 'tables',
        search: '',
        sort: 'default',
        editingTemplateId: null,
        templateDraft: null,
        conversionState: null,
        designerCollapsedFieldIds: {},
        designerDrag: null,
        viewMode: 'normal',
        activeTableId: null
    };

    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function createMemoryId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function moveArrayItem(list, fromIndex, toIndex) {
        if (!Array.isArray(list) || fromIndex === toIndex) return;
        if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return;
        const [item] = list.splice(fromIndex, 1);
        list.splice(toIndex, 0, item);
    }

    function ensureMemoryTemplateStore() {
        if (!Array.isArray(db.memoryTableTemplates)) {
            db.memoryTableTemplates = [];
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
        if (MemoryPolicy) {
            const runtime = MemoryPolicy.ensureRuntimeState(chat);
            uiState.viewMode = runtime.viewMode || 'normal';
            uiState.activeTableId = runtime.activeTableId || null;
            // 旧设置继续作为 V2 的消息量兜底，保证旧 UI / 旧存档可用。
            if (Number.isFinite(parseInt(chat.memoryTables.autoUpdateInterval, 10))) {
                runtime.engineSettings.messageInterval = Math.max(10, parseInt(chat.memoryTables.autoUpdateInterval, 10));
            }
            runtime.engineSettings.enabled = chat.memoryTables.autoUpdateEnabled !== false;
        }
    }

    function getCurrentMemoryTableChat() {
        if (!currentChatId || currentChatType !== 'private') return null;
        const chat = db.characters.find(c => c.id === currentChatId);
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
        return db.memoryTableTemplates.filter(template => chat.memoryTables.boundTemplateIds.includes(template.id));
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
                sourceMessageIds: []
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
                sourceMessageIds: Array.isArray(rawMeta.sourceMessageIds) ? rawMeta.sourceMessageIds.map(String).filter(Boolean) : []
            }
        };
        (table.columns || []).forEach(field => {
            const rawValue = rawRow && rawRow.cells && rawRow.cells[field.id] !== undefined
                ? rawRow.cells[field.id]
                : (rawRow && rawRow[field.id] !== undefined ? rawRow[field.id] : undefined);
            row.cells[field.id] = rawValue === undefined ? getFieldDefaultValue(field) : normalizeFieldValue(field, rawValue);
        });
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
                snapshot: deepClone(chat.memoryTables.data),
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

    function getVisibleFieldItems(chat) {
        const keyword = uiState.search.trim().toLowerCase();
        const templates = getBoundTemplates(chat);
        const items = [];

        templates.forEach(template => {
            ensureTemplateDataForChat(chat, template);
            template.tables.forEach(table => {
                table.columns.forEach(field => {
                    const value = getFieldValue(chat, template.id, table.id, field);
                    const item = {
                        template,
                        table,
                        field,
                        value,
                        locked: isFieldLocked(chat, template.id, table.id, field.id),
                        changed: (chat.memoryTables.lastChangedFieldPaths || []).includes(buildFieldPath(template.id, table.id, field.id))
                    };
                    const haystack = [
                        template.name,
                        template.description,
                        table.name,
                        field.key,
                        getFieldDisplayValue(field, value)
                    ].join(' ').toLowerCase();
                    if (!keyword || haystack.includes(keyword)) {
                        items.push(item);
                    }
                });
            });
        });

        if (uiState.sort === 'name') {
            items.sort((a, b) => a.field.key.localeCompare(b.field.key, 'zh-CN'));
        } else if (uiState.sort === 'changed') {
            items.sort((a, b) => Number(b.changed) - Number(a.changed) || a.field.key.localeCompare(b.field.key, 'zh-CN'));
        } else if (uiState.sort === 'locked') {
            items.sort((a, b) => Number(b.locked) - Number(a.locked) || a.field.key.localeCompare(b.field.key, 'zh-CN'));
        }

        return items;
    }

    function findBestMemoryTableCursorFallback(chat) {
        const history = Array.isArray(chat && chat.history) ? chat.history : [];
        if (!history.length || !chat || !chat.memoryTables || !chat.memoryTables.lastUpdateMsgTimestamp) {
            return null;
        }

        for (let index = history.length - 1; index >= 0; index--) {
            const message = history[index];
            if ((message.timestamp || 0) <= chat.memoryTables.lastUpdateMsgTimestamp) {
                return message;
            }
        }

        return null;
    }

    function ensureMemoryTableAutoUpdateState(chat) {
        ensureMemoryTableState(chat);
        const history = Array.isArray(chat.history) ? chat.history : [];
        const memoryTables = chat.memoryTables;

        if (memoryTables.lastUpdateMsgId) {
            const exists = history.some(message => message.id === memoryTables.lastUpdateMsgId);
            if (!exists) {
                const fallback = findBestMemoryTableCursorFallback(chat);
                memoryTables.lastUpdateMsgId = fallback ? fallback.id : null;
                memoryTables.lastUpdateMsgTimestamp = fallback ? (fallback.timestamp || null) : null;
            }
        }
    }

    function getMemoryTableAutoUpdateCursorInfo(chat) {
        ensureMemoryTableAutoUpdateState(chat);
        const history = Array.isArray(chat && chat.history) ? chat.history : [];
        const interval = Math.max(10, parseInt(chat?.memoryTables?.autoUpdateInterval, 10) || 100);
        const cursorIndex = chat?.memoryTables?.lastUpdateMsgId
            ? history.findIndex(message => message.id === chat.memoryTables.lastUpdateMsgId)
            : -1;
        const nextStartIndex = cursorIndex + 1;
        const unsyncedCount = Math.max(0, history.length - nextStartIndex);
        const completedBatchCount = Math.floor(unsyncedCount / interval);

        return {
            history,
            interval,
            cursorIndex,
            nextStartIndex,
            unsyncedCount,
            completedBatchCount
        };
    }

    function getNextMemoryTableAutoUpdateRange(chat) {
        const info = getMemoryTableAutoUpdateCursorInfo(chat);
        if (info.completedBatchCount <= 0) return null;
        return {
            start: info.nextStartIndex + 1,
            end: info.nextStartIndex + info.interval,
            info
        };
    }

    function setMemoryTableAutoUpdateCursorByMessage(chat, message) {
        ensureMemoryTableAutoUpdateState(chat);
        chat.memoryTables.lastUpdateMsgId = message ? message.id : null;
        chat.memoryTables.lastUpdateMsgTimestamp = message ? (message.timestamp || null) : null;
        chat.memoryTables.autoUpdateState = 'idle';
    }

    function setMemoryTableAutoUpdateCursorByEndIndex(chat, endIndex) {
        const history = Array.isArray(chat && chat.history) ? chat.history : [];
        const message = history[endIndex - 1] || null;
        setMemoryTableAutoUpdateCursorByMessage(chat, message);
    }

    function resetMemoryTableAutoUpdateCursorToLatest(chat) {
        const history = Array.isArray(chat && chat.history) ? chat.history : [];
        setMemoryTableAutoUpdateCursorByMessage(chat, history.length ? history[history.length - 1] : null);
        chat.memoryTables.autoUpdatePending = false;
    }

    function getBoundTableDescriptors(chat) {
        const result = [];
        getBoundTemplates(chat).forEach(template => {
            (template.tables || []).forEach(table => result.push({ template, table }));
        });
        return result;
    }

    function refreshMemoryTableAutoUpdateControls(chat, hasTemplates = true) {
        const toggle = document.getElementById('memory-table-auto-update-toggle');
        const intervalInput = document.getElementById('memory-table-auto-update-interval');
        const roundInput = document.getElementById('memory-table-round-interval');
        const triggerSelect = document.getElementById('memory-table-trigger-mode');
        const maxSourceInput = document.getElementById('memory-table-max-source-messages');
        const latestBtn = document.getElementById('memory-table-update-latest-btn');
        const retryBtn = document.getElementById('memory-table-retry-btn');
        const statusEl = document.getElementById('memory-table-auto-update-status');
        const roundStatus = document.getElementById('memory-table-round-status');
        const cursorSelect = document.getElementById('memory-table-cursor-table-select');
        const cursorInput = document.getElementById('memory-table-cursor-position');
        const saveCursorBtn = document.getElementById('memory-table-save-cursor-btn');
        const updateSelectedBtn = document.getElementById('memory-table-update-selected-btn');
        const cursorLatestBtn = document.getElementById('memory-table-cursor-latest-btn');
        const cursorStartBtn = document.getElementById('memory-table-cursor-start-btn');

        if (!toggle || !intervalInput || !latestBtn || !retryBtn || !statusEl) return;

        const allControls = [toggle, intervalInput, roundInput, triggerSelect, maxSourceInput, latestBtn, retryBtn, cursorSelect, cursorInput, saveCursorBtn, updateSelectedBtn, cursorLatestBtn, cursorStartBtn].filter(Boolean);
        if (!chat) {
            toggle.checked = false;
            allControls.forEach(control => control.disabled = true);
            statusEl.textContent = '请先进入一个私聊角色';
            if (roundStatus) roundStatus.textContent = '轮次尚未统计';
            if (cursorSelect) cursorSelect.innerHTML = '<option>暂无表格</option>';
            return;
        }

        ensureMemoryTableAutoUpdateState(chat);
        const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
        const descriptors = getBoundTableDescriptors(chat);
        const isRunning = chat.memoryTables.autoUpdateState === 'running';
        const hasFailed = chat.memoryTables.autoUpdateState === 'failed';
        const engine = runtime?.engineSettings || {
            triggerMode: 'messages',
            roundInterval: 2,
            messageInterval: chat.memoryTables.autoUpdateInterval || 100,
            maxSourceMessages: MEMORY_TABLE_MAX_CONTEXT_MESSAGES
        };

        toggle.checked = !!chat.memoryTables.autoUpdateEnabled && engine.enabled !== false;
        toggle.disabled = !hasTemplates;
        intervalInput.value = String(engine.messageInterval || chat.memoryTables.autoUpdateInterval || 140);
        intervalInput.disabled = !hasTemplates || isRunning;
        if (roundInput) {
            roundInput.value = String(engine.roundInterval || 2);
            roundInput.disabled = !hasTemplates || isRunning;
        }
        if (triggerSelect) {
            triggerSelect.value = engine.triggerMode || 'either';
            triggerSelect.disabled = !hasTemplates || isRunning;
        }
        if (maxSourceInput) {
            maxSourceInput.value = String(engine.maxSourceMessages || 180);
            maxSourceInput.disabled = !hasTemplates || isRunning;
        }

        let dueCount = 0;
        let totalUnsyncedMessages = 0;
        let totalUnsyncedRounds = 0;
        descriptors.forEach(({ template, table }) => {
            if (!MemoryPolicy) return;
            const info = MemoryPolicy.getUnprocessedInfo(chat, template.id, table.id);
            totalUnsyncedMessages = Math.max(totalUnsyncedMessages, info.unsyncedMessages);
            totalUnsyncedRounds = Math.max(totalUnsyncedRounds, info.unsyncedRounds);
            if (MemoryPolicy.isTableDue(chat, template.id, table)) dueCount += 1;
        });

        if (cursorSelect) {
            const previous = cursorSelect.value || uiState.activeTableId || runtime?.activeTableId || '';
            cursorSelect.innerHTML = descriptors.map(({ template, table }) => `<option value="${escapeAttribute(`${template.id}::${table.id}`)}">${escapeHtml(template.name)} / ${escapeHtml(table.name)}</option>`).join('') || '<option value="">暂无表格</option>';
            const desired = descriptors.some(({ template, table }) => `${template.id}::${table.id}` === previous)
                ? previous
                : (descriptors[0] ? `${descriptors[0].template.id}::${descriptors[0].table.id}` : '');
            cursorSelect.value = desired;
            const [templateId, tableId] = desired.split('::');
            if (MemoryPolicy && templateId && tableId && cursorInput) {
                const info = MemoryPolicy.getUnprocessedInfo(chat, templateId, tableId);
                cursorInput.max = String(info.history.length);
                cursorInput.value = String(Math.max(0, info.cursorIndex + 1));
            }
        }

        latestBtn.disabled = !hasTemplates || isRunning || dueCount <= 0;
        retryBtn.disabled = !hasTemplates || isRunning || (!hasFailed && dueCount <= 0);
        if (updateSelectedBtn) updateSelectedBtn.disabled = !hasTemplates || isRunning || descriptors.length === 0;
        [saveCursorBtn, cursorLatestBtn, cursorStartBtn].filter(Boolean).forEach(button => button.disabled = !hasTemplates || isRunning || descriptors.length === 0);
        retryBtn.textContent = hasFailed ? '重试补救（上次失败）' : '重试补救';
        retryBtn.style.background = hasFailed ? '#ffe7e7' : '';
        retryBtn.style.color = hasFailed ? '#c62828' : '';
        retryBtn.style.borderColor = hasFailed ? '#f2b8b5' : '';
        latestBtn.textContent = isRunning ? '更新中...' : '更新所有到期表';
        if (roundStatus) {
            const latestRound = runtime?.rounds?.[runtime.rounds.length - 1];
            roundStatus.textContent = `已记录 ${runtime?.rounds?.length || 0} 轮${latestRound ? ` · 最近一轮 ${latestRound.messageCount} 条` : ''}`;
        }
        statusEl.textContent = hasTemplates
            ? `自动更新：${toggle.checked ? '已开启' : '已关闭'} · 到期表 ${dueCount} 张 · 最大未处理 ${totalUnsyncedRounds} 轮 / ${totalUnsyncedMessages} 条消息`
            : '先绑定模板后才能使用更新调度';
    }

    async function applyMemoryTableAutoUpdateToggle(chat, enabled) {
        if (!chat) return { status: 'noop' };
        ensureMemoryTableAutoUpdateState(chat);
        chat.memoryTables.autoUpdateEnabled = enabled;
        if (MemoryPolicy) {
            MemoryPolicy.ensureRuntimeState(chat).engineSettings.enabled = enabled;
        }
        if (!enabled) {
            chat.memoryTables.autoUpdatePending = false;
            if (chat.memoryTables.autoUpdateState === 'running') chat.memoryTables.autoUpdateState = 'idle';
            await saveCharacter(chat.id);
            refreshMemoryTableAutoUpdateControls(chat, getBoundTemplates(chat).length > 0);
            return { status: 'disabled' };
        }
        chat.memoryTables.autoUpdateState = 'idle';
        await saveCharacter(chat.id);
        refreshMemoryTableAutoUpdateControls(chat, getBoundTemplates(chat).length > 0);
        return checkAndTriggerAutoTableUpdate(chat, { showNoPendingToast: true });
    }

    function renderMemoryTableScreen() {
        const screen = document.getElementById('memory-table-screen');
        if (!screen) return;

        const chat = getCurrentMemoryTableChat();
        const content = document.getElementById('memory-table-content');
        const summary = document.getElementById('memory-table-chat-summary');
        const modePill = document.getElementById('memory-table-mode-pill');
        const empty = document.getElementById('memory-table-empty-state');
        const updateBtn = document.getElementById('memory-table-update-btn');
        const fromJournalBtn = document.getElementById('memory-table-from-journal-btn');
        const toJournalBtn = document.getElementById('memory-table-to-journal-btn');

        if (!content || !summary || !modePill || !empty) return;

        if (!chat) {
            summary.textContent = '请先进入一个私聊角色。';
            modePill.textContent = '未选择角色';
            content.innerHTML = '';
            empty.style.display = 'block';
            if (updateBtn) updateBtn.disabled = true;
            if (fromJournalBtn) fromJournalBtn.disabled = true;
            if (toJournalBtn) toJournalBtn.disabled = true;
            refreshMemoryTableAutoUpdateControls(null, false);
            return;
        }

        ensureMemoryTableState(chat);
        const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
        if (uiState.viewMode === 'json' && MemoryPolicy && !MemoryPolicy.isDesktopJsonAvailable()) {
            uiState.viewMode = 'normal';
            if (runtime) runtime.viewMode = 'normal';
        }
        screen.classList.toggle('memory-json-mode', uiState.viewMode === 'json');
        const normalModeBtn = document.getElementById('memory-table-normal-mode-btn');
        const jsonModeBtn = document.getElementById('memory-table-json-mode-btn');
        if (normalModeBtn) normalModeBtn.classList.toggle('active', uiState.viewMode === 'normal');
        if (jsonModeBtn) {
            jsonModeBtn.classList.toggle('active', uiState.viewMode === 'json');
            jsonModeBtn.disabled = !!(MemoryPolicy && !MemoryPolicy.isDesktopJsonAvailable());
        }
        const boundTemplates = getBoundTemplates(chat);
        const modeLabel = chat.memoryMode === 'table'
            ? '结构化档案模式'
            : (chat.memoryMode === 'vector' ? '向量记忆模式' : '日记模式');
        summary.textContent = `${chat.remarkName || chat.realName || '当前角色'} · 已绑定 ${boundTemplates.length} 个模板`;
        modePill.textContent = modeLabel;
        modePill.style.background = chat.memoryMode === 'table'
            ? 'rgba(73, 129, 255, 0.12)'
            : (chat.memoryMode === 'vector' ? 'rgba(116, 87, 255, 0.12)' : 'rgba(255, 181, 71, 0.12)');
        modePill.style.color = chat.memoryMode === 'table'
            ? '#335eea'
            : (chat.memoryMode === 'vector' ? '#5a38d6' : '#b26a00');
        if (updateBtn) updateBtn.disabled = boundTemplates.length === 0;
        if (fromJournalBtn) fromJournalBtn.disabled = (chat.memoryJournals || []).filter(item => item.isFavorited).length === 0 || boundTemplates.length === 0;
        if (toJournalBtn) toJournalBtn.disabled = !getMemoryContextBlock(chat, { force: true });
        refreshMemoryTableAutoUpdateControls(chat, boundTemplates.length > 0);

        document.querySelectorAll('.memory-table-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === uiState.tab);
        });

        if (uiState.tab === 'templates') {
            content.innerHTML = renderTemplateLibrary(chat);
            empty.style.display = db.memoryTableTemplates.length === 0 ? 'block' : 'none';
            empty.innerHTML = '<p>还没有模板</p><p>点击上方“新建模板”开始。</p>';
        } else if (uiState.tab === 'history') {
            content.innerHTML = renderHistoryView(chat);
            empty.style.display = (chat.memoryTables.history || []).length === 0 ? 'block' : 'none';
            empty.innerHTML = '<p>还没有更新历史</p><p>通过手动更新或编辑字段后，这里会记录快照。</p>';
        } else {
            content.innerHTML = renderTableView(chat);
            if (boundTemplates.length === 0) {
                empty.style.display = 'block';
                empty.innerHTML = '<p>还没有绑定任何结构化模板</p><p>先去“模板库”创建并绑定模板吧。</p>';
            } else if (!content.innerHTML.trim()) {
                empty.style.display = 'block';
                empty.innerHTML = '<p>当前没有匹配结果</p><p>试试调整搜索词，或新增字段/行内容。</p>';
            } else {
                empty.style.display = 'none';
            }
            drawAllCharts(chat);
        }
    }

    function renderTemplateLibrary(chat) {
        ensureMemoryTemplateStore();
        const templates = db.memoryTableTemplates;
        if (templates.length === 0) return '';

        return templates.map(template => {
            const bound = chat.memoryTables.boundTemplateIds.includes(template.id);
            const tableCount = Array.isArray(template.tables) ? template.tables.length : 0;
            const fieldCount = (template.tables || []).reduce((sum, table) => sum + ((table.columns || []).length), 0);
            return `
                <div class="memory-template-card" style="background:#fff; border-radius:16px; padding:14px; margin-bottom:12px; box-shadow:0 6px 20px rgba(0,0,0,0.04); border:1px solid #f1f1f1;">
                    <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
                        <div style="flex:1;">
                            <div style="font-size:15px; font-weight:700; color:#333;">${escapeHtml(template.name)}</div>
                            <div style="font-size:12px; color:#888; margin-top:4px;">${escapeHtml(template.description || '无描述')}</div>
                            <div style="font-size:12px; color:#999; margin-top:8px;">${tableCount} 张表 · ${fieldCount} 个字段</div>
                        </div>
                        <label class="kkt-switch">
                            <input type="checkbox" class="memory-template-bind-toggle" data-template-id="${template.id}" ${bound ? 'checked' : ''}>
                            <span class="kkt-slider"></span>
                        </label>
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
                        <button class="btn btn-small btn-primary" data-action="edit-template-visual" data-template-id="${template.id}">可视化编辑</button>
                        <button class="btn btn-small btn-secondary" data-action="edit-template-json" data-template-id="${template.id}">JSON</button>
                        <button class="btn btn-small btn-secondary" data-action="export-template" data-template-id="${template.id}">导出</button>
                        <button class="btn btn-small btn-secondary" data-action="export-template-package" data-template-id="${template.id}">导出记忆包</button>
                        <button class="btn btn-small btn-danger" data-action="delete-template" data-template-id="${template.id}">删除</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function openTemplateDesigner(template) {
        const modal = document.getElementById('memory-template-designer-modal');
        if (!modal) return;
        const working = template ? deepClone(template) : createStarterTemplate();
        working.tables = Array.isArray(working.tables) && working.tables.length > 0 ? working.tables : [createEmptyTableDraft()];
        working.tables.forEach(table => {
            table.columns = Array.isArray(table.columns) && table.columns.length > 0 ? table.columns : [createEmptyFieldDraft()];
        });
        uiState.editingTemplateId = template ? template.id : null;
        uiState.templateDraft = working;
        uiState.designerCollapsedFieldIds = {};
        uiState.designerDrag = null;
        renderTemplateDesigner();
        modal.classList.add('visible');
    }

    function closeTemplateDesigner() {
        const modal = document.getElementById('memory-template-designer-modal');
        if (modal) modal.classList.remove('visible');
        uiState.templateDraft = null;
        uiState.designerDrag = null;
    }

    function renderTemplateDesigner() {
        const draft = uiState.templateDraft;
        const container = document.getElementById('memory-template-designer-body');
        const titleEl = document.getElementById('memory-template-designer-title');
        if (!draft || !container || !titleEl) return;

        titleEl.textContent = uiState.editingTemplateId ? '编辑模板' : '新建模板';
        container.innerHTML = `
            <div class="form-group">
                <label>模板名称</label>
                <input type="text" data-designer-role="template-name" value="${escapeAttribute(draft.name || '')}" placeholder="例如：恋爱进展模板">
            </div>
            <div class="form-group">
                <label>模板描述</label>
                <textarea rows="3" data-designer-role="template-description" placeholder="说明这个模板适合什么场景">${escapeHtml(draft.description || '')}</textarea>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin:18px 0 10px;">
                <div style="font-size:15px; font-weight:700; color:#333;">表格列表</div>
                <button type="button" class="btn btn-small btn-primary" data-action="designer-add-table">新增表格</button>
            </div>
            ${(draft.tables || []).map((table, tableIndex) => renderDesignerTableCard(table, tableIndex)).join('')}
        `;
    }

    function renderDesignerTableCard(table, tableIndex) {
        const groups = getFieldGroups(table.columns || []);
        const policy = MemoryPolicy
            ? MemoryPolicy.normalizeTablePolicy(table)
            : { memoryLayer: table.memoryLayer || 'short', updatePolicy: table.updatePolicy || {}, injectionPolicy: table.injectionPolicy || {} };
        const update = policy.updatePolicy;
        const inject = policy.injectionPolicy;
        return `
            <div draggable="true" data-designer-draggable="table" data-table-index="${tableIndex}" style="background:#fff; border:1px solid #ececec; border-radius:16px; padding:14px; margin-bottom:14px;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
                    <div style="display:flex; align-items:center; gap:8px; font-size:14px; font-weight:700; color:#333;">
                        <span style="cursor:grab; color:#999;">拖拽</span>
                        <span>表格 ${tableIndex + 1}</span>
                        <span style="font-size:11px;color:#667085;background:#f2f4f7;border-radius:999px;padding:2px 8px;">${escapeHtml(policy.memoryLayer)}</span>
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <button type="button" class="btn btn-small btn-neutral" data-action="designer-move-table-up" data-table-index="${tableIndex}">上移</button>
                        <button type="button" class="btn btn-small btn-neutral" data-action="designer-move-table-down" data-table-index="${tableIndex}">下移</button>
                        <button type="button" class="btn btn-small btn-danger" data-action="designer-remove-table" data-table-index="${tableIndex}">删除表格</button>
                    </div>
                </div>
                <div class="form-group">
                    <label>表格名称</label>
                    <input type="text" data-designer-role="table-name" data-table-index="${tableIndex}" value="${escapeAttribute(table.name || '')}">
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
                    <div class="form-group">
                        <label>表格模式</label>
                        <select data-designer-role="table-mode" data-table-index="${tableIndex}">
                            <option value="keyValue" ${table.mode !== 'rows' ? 'selected' : ''}>键值表</option>
                            <option value="rows" ${table.mode === 'rows' ? 'selected' : ''}>列表行</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>记忆层级</label>
                        <select data-designer-role="table-memory-layer" data-table-index="${tableIndex}">
                            ${[['core','核心'],['short','短期'],['medium','中期'],['long','长期'],['review','审核队列']].map(([value,label]) => `<option value="${value}" ${policy.memoryLayer === value ? 'selected' : ''}>${label}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>自动更新</label>
                        <select data-designer-role="table-update-enabled" data-table-index="${tableIndex}">
                            <option value="true" ${update.enabled ? 'selected' : ''}>开启</option>
                            <option value="false" ${!update.enabled ? 'selected' : ''}>关闭/手动</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>触发方式</label>
                        <select data-designer-role="table-trigger-mode" data-table-index="${tableIndex}">
                            ${[['rounds','按轮'],['messages','按消息'],['either','先到者'],['manual','仅手动']].map(([value,label]) => `<option value="${value}" ${update.triggerMode === value ? 'selected' : ''}>${label}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>每几轮</label>
                        <input type="number" min="0" data-designer-role="table-round-interval" data-table-index="${tableIndex}" value="${escapeAttribute(update.roundInterval ?? 0)}">
                    </div>
                    <div class="form-group">
                        <label>每几条消息</label>
                        <input type="number" min="0" data-designer-role="table-message-interval" data-table-index="${tableIndex}" value="${escapeAttribute(update.messageInterval ?? 0)}">
                    </div>
                    <div class="form-group">
                        <label>单次最多读取</label>
                        <input type="number" min="10" max="1000" data-designer-role="table-max-source-messages" data-table-index="${tableIndex}" value="${escapeAttribute(update.maxSourceMessages ?? 180)}">
                    </div>
                    <div class="form-group">
                        <label>允许删除行</label>
                        <select data-designer-role="table-allow-delete" data-table-index="${tableIndex}">
                            <option value="false" ${update.allowDelete !== true ? 'selected' : ''}>否</option>
                            <option value="true" ${update.allowDelete === true ? 'selected' : ''}>是</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>更新使用 API</label>
                        <select data-designer-role="table-use-summary-api" data-table-index="${tableIndex}">
                            <option value="false" ${update.useSummaryApi === false ? 'selected' : ''}>主聊天 API</option>
                            <option value="true" ${update.useSummaryApi !== false ? 'selected' : ''}>总结 API</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>聊天注入</label>
                        <select data-designer-role="table-injection-mode" data-table-index="${tableIndex}">
                            ${[['always','始终'],['active','有效项'],['relevant','相关检索'],['never','不注入']].map(([value,label]) => `<option value="${value}" ${inject.mode === value ? 'selected' : ''}>${label}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>相关条目 Top-K</label>
                        <input type="number" min="0" max="50" data-designer-role="table-injection-top-k" data-table-index="${tableIndex}" value="${escapeAttribute(inject.topK ?? 0)}">
                    </div>
                    <div class="form-group">
                        <label>注入字符预算</label>
                        <input type="number" min="0" max="20000" data-designer-role="table-injection-budget" data-table-index="${tableIndex}" value="${escapeAttribute(inject.budget ?? 0)}">
                    </div>
                    <div class="form-group">
                        <label>有效期（天，0=不限）</label>
                        <input type="number" min="0" data-designer-role="table-max-age-days" data-table-index="${tableIndex}" value="${escapeAttribute(inject.maxAgeDays ?? 0)}">
                    </div>
                </div>
                <div class="form-group">
                    <label>提取规则</label>
                    <textarea rows="3" data-designer-role="table-extract-prompt" data-table-index="${tableIndex}" placeholder="给总结 API 的表级提取要求">${escapeHtml(table.extractPrompt || '')}</textarea>
                </div>
                <div class="form-group">
                    <label>更新附加规则</label>
                    <textarea rows="2" data-designer-role="table-update-instructions" data-table-index="${tableIndex}" placeholder="例如：只从明确陈述更新；不得从一次情绪推断长期人格。">${escapeHtml(update.instructions || '')}</textarea>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin:14px 0 8px;">
                    <div style="font-size:13px; font-weight:700; color:#555;">字段</div>
                    <button type="button" class="btn btn-small btn-secondary" data-action="designer-add-field" data-table-index="${tableIndex}">新增字段</button>
                </div>
                ${groups.map(group => `
                    <div style="margin-top:10px; padding:10px 12px; border-radius:12px; background:${group.ungrouped ? 'rgba(0,0,0,0.025)' : 'rgba(91,140,255,0.06)'};">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
                            <div style="font-size:12px; font-weight:700; color:#666;">${escapeHtml(group.ungrouped ? '未分组字段' : group.name)}</div>
                            <div style="font-size:11px; color:#999;">${group.fields.length} 个字段</div>
                        </div>
                        ${group.fields.map(({ field, index }) => renderDesignerFieldCard(field, tableIndex, index)).join('')}
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderDesignerFieldCard(field, tableIndex, fieldIndex) {
        const isCollapsed = !!uiState.designerCollapsedFieldIds[field.id];
        const summaryTags = [
            field.type || 'text',
            field.group ? `分组:${field.group}` : '',
            field.aiEditable === false ? 'AI只读' : 'AI可编辑',
            field.important === false ? '仅JSON' : '普通模式显示'
        ].filter(Boolean).join(' · ');
        return `
            <div draggable="true" data-designer-draggable="field" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" style="border:1px dashed #e6e6e6; border-radius:14px; padding:12px; margin-top:10px; background:#fcfcfc;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; ${isCollapsed ? '' : 'margin-bottom:10px;'}">
                    <div style="flex:1;">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <span style="cursor:grab; color:#999; font-size:12px;">拖拽</span>
                            <div style="font-size:13px; font-weight:700; color:#444;">${escapeHtml(field.key || `字段 ${fieldIndex + 1}`)}</div>
                            <span style="font-size:11px; color:#8a8a8a; background:rgba(0,0,0,0.05); padding:2px 8px; border-radius:999px;">${escapeHtml(field.type || 'text')}</span>
                        </div>
                        <div style="font-size:12px; color:#888; margin-top:4px;">${escapeHtml(summaryTags)}</div>
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                        <button type="button" class="btn btn-small btn-neutral" data-action="designer-toggle-field-collapse" data-field-id="${field.id}">${isCollapsed ? '展开' : '折叠'}</button>
                        <button type="button" class="btn btn-small btn-neutral" data-action="designer-move-field-up" data-table-index="${tableIndex}" data-field-index="${fieldIndex}">上移</button>
                        <button type="button" class="btn btn-small btn-neutral" data-action="designer-move-field-down" data-table-index="${tableIndex}" data-field-index="${fieldIndex}">下移</button>
                        <button type="button" class="btn btn-small btn-danger" data-action="designer-remove-field" data-table-index="${tableIndex}" data-field-index="${fieldIndex}">删除字段</button>
                    </div>
                </div>
                <div style="display:${isCollapsed ? 'none' : 'block'};">
                <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px;">
                    <div class="form-group">
                        <label>字段名</label>
                        <input type="text" data-designer-role="field-key" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" value="${escapeAttribute(field.key || '')}">
                    </div>
                    <div class="form-group">
                        <label>字段分组</label>
                        <input type="text" data-designer-role="field-group" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" value="${escapeAttribute(field.group || '')}" placeholder="例如：关系 / 事件 / 备注">
                    </div>
                    <div class="form-group">
                        <label>类型</label>
                        <select data-designer-role="field-type" data-table-index="${tableIndex}" data-field-index="${fieldIndex}">
                            ${['text', 'longtext', 'number', 'enum', 'tags', 'progress', 'date', 'boolean'].map(type => `<option value="${type}" ${field.type === type ? 'selected' : ''}>${type}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>默认值</label>
                        <input type="text" data-designer-role="field-default" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" value="${escapeAttribute(Array.isArray(field.default) ? field.default.join(', ') : String(field.default ?? ''))}">
                    </div>
                    <div class="form-group">
                        <label>AI 可编辑</label>
                        <select data-designer-role="field-ai-editable" data-table-index="${tableIndex}" data-field-index="${fieldIndex}">
                            <option value="true" ${field.aiEditable !== false ? 'selected' : ''}>是</option>
                            <option value="false" ${field.aiEditable === false ? 'selected' : ''}>否</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>普通模式重要字段</label>
                        <select data-designer-role="field-important" data-table-index="${tableIndex}" data-field-index="${fieldIndex}">
                            <option value="true" ${field.important !== false ? 'selected' : ''}>显示</option>
                            <option value="false" ${field.important === false ? 'selected' : ''}>仅 JSON 模式</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>摘要标签</label>
                        <input type="text" data-designer-role="field-summary-label" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" value="${escapeAttribute(field.summaryLabel || '')}" placeholder="可选的简短显示名">
                    </div>
                    <div class="form-group">
                        <label>最小值</label>
                        <input type="number" data-designer-role="field-min" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" value="${escapeAttribute(field.min ?? '')}">
                    </div>
                    <div class="form-group">
                        <label>最大值</label>
                        <input type="number" data-designer-role="field-max" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" value="${escapeAttribute(field.max ?? '')}">
                    </div>
                </div>
                <div class="form-group">
                    <label>选项（enum/tags 用，一行一个或逗号分隔）</label>
                    <textarea rows="2" data-designer-role="field-options" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" placeholder="陌生&#10;朋友&#10;暧昧">${escapeHtml((field.options || []).join('\n'))}</textarea>
                </div>
                <div class="form-group">
                    <label>AI 提示</label>
                    <textarea rows="2" data-designer-role="field-ai-hint" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" placeholder="告诉 AI 这个字段该怎么更新">${escapeHtml(field.aiHint || '')}</textarea>
                </div>
                <div class="form-group">
                    <label>条件高亮规则（每行 运算符|值|颜色，例如 <=|20|#ffe7e7）</label>
                    <textarea rows="2" data-designer-role="field-conditional-rules" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" placeholder=">=|80|#e8fff1">${escapeHtml(serializeConditionalRules(field.conditionalRules || []))}</textarea>
                </div>
                </div>
            </div>
        `;
    }

    function renderHistoryView(chat) {
        const history = chat.memoryTables.history || [];
        if (history.length === 0) return '';
        return history.map(entry => {
            const sourceLabel = entry.source === 'api'
                ? 'API 更新'
                : entry.source === 'auto' || entry.source === 'auto_latest'
                    ? '自动更新'
                    : '手动编辑';
            const changedText = (entry.changedFields || []).map(item => `${escapeHtml(item.label)}：${escapeHtml(getShortValue(item.oldValue))} → ${escapeHtml(getShortValue(item.newValue))}`).join('<br>');
            return `
                <div style="background:#fff; border-radius:16px; padding:14px; margin-bottom:12px; box-shadow:0 6px 20px rgba(0,0,0,0.04); border:1px solid #f1f1f1;">
                    <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
                        <div>
                            <div style="font-weight:700; color:#333;">${formatDateTime(entry.timestamp)}</div>
                            <div style="font-size:12px; color:#999; margin-top:4px;">来源：${sourceLabel} · ${entry.changedFields ? entry.changedFields.length : 0} 项变化</div>
                        </div>
                        <button class="btn btn-small btn-primary" data-action="restore-history" data-history-id="${entry.id}">恢复</button>
                    </div>
                    <div style="font-size:13px; color:#555; line-height:1.65; margin-top:10px;">${changedText || '无变化详情'}</div>
                </div>
            `;
        }).join('');
    }

    function matchesMemorySearch(parts) {
        const keyword = uiState.search.trim().toLowerCase();
        if (!keyword) return true;
        return parts.join(' ').toLowerCase().includes(keyword);
    }

    function getDisplayFieldItems(chat, template, table) {
        const items = (table.columns || []).map(field => {
            const value = getFieldValue(chat, template.id, table.id, field);
            return {
                template,
                table,
                field,
                value,
                locked: isFieldLocked(chat, template.id, table.id, field.id),
                changed: (chat.memoryTables.lastChangedFieldPaths || []).includes(buildFieldPath(template.id, table.id, field.id))
            };
        }).filter(item => matchesMemorySearch([
            template.name,
            template.description || '',
            table.name,
            item.field.group || '',
            item.field.key,
            getFieldDisplayValue(item.field, item.value)
        ]));

        if (uiState.sort === 'name') {
            items.sort((a, b) => a.field.key.localeCompare(b.field.key, 'zh-CN'));
        } else if (uiState.sort === 'changed') {
            items.sort((a, b) => Number(b.changed) - Number(a.changed) || a.field.key.localeCompare(b.field.key, 'zh-CN'));
        } else if (uiState.sort === 'locked') {
            items.sort((a, b) => Number(b.locked) - Number(a.locked) || a.field.key.localeCompare(b.field.key, 'zh-CN'));
        }

        return items;
    }

    function renderKeyValueFieldCard(item) {
        const color = evaluateConditionalColor(item.field, item.value);
        return `
            <div class="memory-field-card" style="
                background:#fff;
                border-radius:16px;
                padding:14px;
                margin-bottom:12px;
                box-shadow:0 6px 20px rgba(0,0,0,0.04);
                border:1px solid ${item.changed ? '#c6d6ff' : '#f1f1f1'};
                ${color ? `background:${color};` : ''}
            ">
                <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
                    <div style="flex:1;">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <span style="font-size:15px; font-weight:700; color:#333;">${escapeHtml(item.field.key)}</span>
                            <span style="font-size:11px; color:#8a8a8a; background:rgba(0,0,0,0.05); padding:2px 8px; border-radius:999px;">${escapeHtml(item.field.type)}</span>
                            ${item.field.group ? `<span style="font-size:11px; color:#5a6ab8; background:rgba(91,140,255,0.08); padding:2px 8px; border-radius:999px;">${escapeHtml(item.field.group)}</span>` : ''}
                            ${item.changed ? '<span style="font-size:11px; color:#335eea; background:rgba(51,94,234,0.08); padding:2px 8px; border-radius:999px;">刚更新</span>' : ''}
                            ${item.locked ? '<span style="font-size:11px; color:#b25b00; background:rgba(255,159,67,0.12); padding:2px 8px; border-radius:999px;">已锁定</span>' : ''}
                        </div>
                        ${item.field.aiHint ? `<div style="font-size:12px; color:#888; margin-top:6px;">${escapeHtml(item.field.aiHint)}</div>` : ''}
                    </div>
                    <button class="btn btn-small ${item.locked ? 'btn-secondary' : 'btn-neutral'}" data-action="toggle-lock" data-template-id="${item.template.id}" data-table-id="${item.table.id}" data-field-id="${item.field.id}">${item.locked ? '解锁' : '锁定'}</button>
                </div>
                <div style="margin-top:12px;">
                    ${renderFieldEditor(item.template.id, item.table.id, item.field, item.value, item.locked)}
                </div>
                ${renderFieldChartContainer(item.template.id, item.table.id, item.field)}
            </div>
        `;
    }

    function renderRowsTableCard(chat, template, table) {
        const rows = getRows(chat, template.id, table);
        const visibleRows = rows.filter(row => matchesMemorySearch([
            template.name,
            template.description || '',
            table.name,
            ...(table.columns || []).map(field => `${field.key} ${getFieldDisplayValue(field, row.cells[field.id])}`)
        ]));
        if (uiState.search.trim() && visibleRows.length === 0) {
            return '';
        }

        return `
            <div style="background:#fff; border-radius:18px; padding:14px; margin-bottom:16px; box-shadow:0 6px 20px rgba(0,0,0,0.04); border:1px solid #f1f1f1;">
                <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:10px;">
                    <div>
                        <div style="font-size:15px; font-weight:700; color:#333;">${escapeHtml(template.name)} / ${escapeHtml(table.name)}</div>
                        <div style="font-size:12px; color:#888; margin-top:4px;">多行表 · ${visibleRows.length}/${rows.length} 行</div>
                        ${table.extractPrompt ? `<div style="font-size:12px; color:#999; margin-top:4px;">${escapeHtml(table.extractPrompt)}</div>` : ''}
                    </div>
                    <button type="button" class="btn btn-small btn-primary" data-action="add-row" data-template-id="${template.id}" data-table-id="${table.id}">新增行</button>
                </div>
                ${rows.length === 0 ? `
                    <div style="padding:14px; border:1px dashed #e6e6e6; border-radius:14px; color:#999; font-size:13px;">还没有任何行，点击“新增行”开始录入。</div>
                ` : visibleRows.map((row, rowIndex) => `
                    <div style="border:1px solid #ececec; border-radius:14px; padding:12px; margin-top:10px; background:#fcfcfc;">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
                            <div style="font-size:13px; font-weight:700; color:#444;">第 ${rowIndex + 1} 行</div>
                            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                <button type="button" class="btn btn-small btn-neutral" data-action="move-row-up" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">上移</button>
                                <button type="button" class="btn btn-small btn-neutral" data-action="move-row-down" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">下移</button>
                                <button type="button" class="btn btn-small btn-danger" data-action="delete-row" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">删除</button>
                            </div>
                        </div>
                        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;">
                            ${(table.columns || []).map(field => {
                                const locked = isFieldLocked(chat, template.id, table.id, field.id);
                                const changed = (chat.memoryTables.lastChangedFieldPaths || []).includes(buildFieldPath(template.id, table.id, field.id, row.id));
                                return `
                                    <div style="border:1px solid ${changed ? '#c6d6ff' : '#ececec'}; border-radius:12px; padding:10px; background:#fff;">
                                        <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start; margin-bottom:8px;">
                                            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                                                <span style="font-size:13px; font-weight:700; color:#444;">${escapeHtml(field.key)}</span>
                                                <span style="font-size:11px; color:#8a8a8a; background:rgba(0,0,0,0.05); padding:2px 8px; border-radius:999px;">${escapeHtml(field.type)}</span>
                                                ${changed ? '<span style="font-size:11px; color:#335eea;">刚更新</span>' : ''}
                                                ${locked ? '<span style="font-size:11px; color:#b25b00;">已锁定</span>' : ''}
                                            </div>
                                            <button class="btn btn-small ${locked ? 'btn-secondary' : 'btn-neutral'}" data-action="toggle-lock" data-template-id="${template.id}" data-table-id="${table.id}" data-field-id="${field.id}">${locked ? '解锁' : '锁定'}</button>
                                        </div>
                                        ${renderFieldEditor(template.id, table.id, field, row.cells[field.id], locked, row.id)}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function getActiveTableDescriptor(chat) {
        const descriptors = [];
        getBoundTemplates(chat).forEach(template => {
            ensureTemplateDataForChat(chat, template);
            (template.tables || []).forEach(table => descriptors.push({ template, table }));
        });
        if (!descriptors.length) return { descriptors, active: null };
        const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
        const requestedId = uiState.activeTableId || runtime?.activeTableId;
        const active = descriptors.find(item => item.table.id === requestedId) || descriptors[0];
        uiState.activeTableId = active.table.id;
        if (runtime) runtime.activeTableId = active.table.id;
        return { descriptors, active };
    }

    function getVisibleColumnsForMode(table) {
        const jsonMode = uiState.viewMode === 'json' && (!MemoryPolicy || MemoryPolicy.isDesktopJsonAvailable());
        return (table.columns || []).filter(field => jsonMode || field.important !== false);
    }

    function renderV2PolicySummary(table) {
        const policy = getTableRuntimePolicy(table);
        const update = policy.updatePolicy;
        const inject = policy.injectionPolicy;
        return `
            <div class="memory-v2-policy-summary memory-v2-json-only">
                <span>layer: ${escapeHtml(policy.memoryLayer)}</span>
                <span>update: ${escapeHtml(update.enabled ? update.triggerMode : 'manual/off')}</span>
                <span>rounds: ${escapeHtml(String(update.roundInterval || 0))}</span>
                <span>messages: ${escapeHtml(String(update.messageInterval || 0))}</span>
                <span>api: ${escapeHtml(update.useSummaryApi === false ? 'main' : 'summary')}</span>
                <span>inject: ${escapeHtml(inject.mode)}</span>
                <span>topK: ${escapeHtml(String(inject.topK || 0))}</span>
                <span>budget: ${escapeHtml(String(inject.budget || 0))}</span>
            </div>
        `;
    }

    function renderV2KeyValueSheet(chat, template, table) {
        const columns = getVisibleColumnsForMode(table).filter(field => matchesMemorySearch([
            template.name,
            table.name,
            field.key,
            field.group || '',
            field.aiHint || '',
            getFieldDisplayValue(field, getFieldValue(chat, template.id, table.id, field))
        ]));
        const rowsHtml = columns.map(field => {
            const value = getFieldValue(chat, template.id, table.id, field);
            const locked = isFieldLocked(chat, template.id, table.id, field.id);
            return `
                <tr data-memory-important="${field.important !== false}">
                    <th>
                        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
                            <span>${escapeHtml(field.key)}</span>
                            <button class="btn btn-small ${locked ? 'btn-secondary' : 'btn-neutral'} memory-v2-json-only" data-action="toggle-lock" data-template-id="${template.id}" data-table-id="${table.id}" data-field-id="${field.id}">${locked ? '解锁' : '锁定'}</button>
                        </div>
                        ${field.group ? `<div style="font-size:10px;color:#98a2b3;margin-top:3px;">${escapeHtml(field.group)}</div>` : ''}
                        <div class="memory-v2-json-meta memory-v2-json-only">id=${escapeHtml(field.id)} · type=${escapeHtml(field.type)} · important=${field.important !== false}<br>${escapeHtml(field.aiHint || '')}</div>
                    </th>
                    <td><div class="memory-v2-inline-editor">${renderFieldEditor(template.id, table.id, field, value, locked)}</div></td>
                </tr>
            `;
        }).join('');
        return `<table class="memory-v2-kv"><tbody>${rowsHtml || '<tr><td class="memory-v2-empty">当前模式下没有匹配字段。</td></tr>'}</tbody></table>`;
    }

    function renderV2RowsSheet(chat, template, table) {
        const columns = getVisibleColumnsForMode(table);
        const allRows = getRows(chat, template.id, table);
        const rows = allRows.filter(row => matchesMemorySearch([
            template.name,
            table.name,
            ...(columns || []).map(field => `${field.key} ${getFieldDisplayValue(field, row.cells?.[field.id])}`)
        ]));
        const head = columns.map(field => `
            <th data-memory-important="${field.important !== false}">
                ${escapeHtml(field.key)}
                <div class="memory-v2-json-meta memory-v2-json-only">${escapeHtml(field.id)}<br>${escapeHtml(field.type)}${field.aiHint ? `<br>${escapeHtml(field.aiHint)}` : ''}</div>
            </th>
        `).join('');
        const body = rows.map((row, rowIndex) => {
            const cells = columns.map(field => {
                const locked = isFieldLocked(chat, template.id, table.id, field.id);
                return `<td data-memory-important="${field.important !== false}"><div class="memory-v2-inline-editor">${renderFieldEditor(template.id, table.id, field, row.cells?.[field.id], locked, row.id)}</div></td>`;
            }).join('');
            return `
                <tr>
                    <td>
                        <div>${rowIndex + 1}</div>
                        <div class="memory-v2-row-actions">
                            <button class="btn btn-small btn-neutral" data-action="move-row-up" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">↑</button>
                            <button class="btn btn-small btn-neutral" data-action="move-row-down" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">↓</button>
                            <button class="btn btn-small btn-danger" data-action="delete-row" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">×</button>
                        </div>
                        <div class="memory-v2-json-meta memory-v2-json-only">${escapeHtml(row.id)}</div>
                    </td>
                    ${cells}
                </tr>
            `;
        }).join('');
        return `
            <div class="memory-v2-rows-wrap">
                <table class="memory-v2-rows">
                    <thead><tr><th>#</th>${head}</tr></thead>
                    <tbody>${body || `<tr><td colspan="${columns.length + 1}" class="memory-v2-empty">暂无匹配记录。</td></tr>`}</tbody>
                </table>
            </div>
        `;
    }

    function renderV2RawJson(chat, template, table) {
        const tableData = deepClone(chat.memoryTables.data?.[template.id]?.[table.id] || {});
        const payload = { schema: table, data: tableData, lockedFields: chat.memoryTables.lockedFields?.[template.id]?.[table.id] || [] };
        return `<pre class="memory-v2-json-raw memory-v2-json-only">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
    }

    function renderTableView(chat) {
        const { descriptors, active } = getActiveTableDescriptor(chat);
        if (!active) return '';
        const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
        if (uiState.viewMode === 'json' && MemoryPolicy && !MemoryPolicy.isDesktopJsonAvailable()) {
            uiState.viewMode = 'normal';
            if (runtime) runtime.viewMode = 'normal';
        }
        const sidebar = descriptors.map(({ template, table }) => {
            const policy = getTableRuntimePolicy(table);
            const count = isRowsTable(table) ? `${getRows(chat, template.id, table).length} 行` : `${(table.columns || []).length} 字段`;
            return `
                <button type="button" class="memory-v2-table-item ${table.id === active.table.id ? 'active' : ''}" data-action="select-memory-table" data-table-id="${table.id}">
                    <span class="name">${escapeHtml(table.name)}</span>
                    <span class="meta">${escapeHtml(template.name)} · ${escapeHtml(policy.memoryLayer)} · ${count}</span>
                </button>
            `;
        }).join('');
        const policy = getTableRuntimePolicy(active.table);
        const tableContent = isRowsTable(active.table)
            ? renderV2RowsSheet(chat, active.template, active.table)
            : renderV2KeyValueSheet(chat, active.template, active.table);
        const rawJson = renderV2RawJson(chat, active.template, active.table);
        return `
            <div class="memory-v2-workspace">
                <aside class="memory-v2-sidebar">${sidebar}</aside>
                <section class="memory-v2-main">
                    <div class="memory-v2-sheet">
                        <div class="memory-v2-sheet-head">
                            <div>
                                <h2>${escapeHtml(active.table.name)}</h2>
                                <div class="sub">${escapeHtml(active.template.name)} · ${isRowsTable(active.table) ? '多行记录' : '键值档案'}${uiState.viewMode === 'json' ? ' · 完整字段/结构模式' : ' · 重要字段模式'}</div>
                                ${renderV2PolicySummary(active.table)}
                                ${active.table.extractPrompt ? `<div class="memory-v2-json-meta memory-v2-json-only">extractPrompt: ${escapeHtml(active.table.extractPrompt)}</div>` : ''}
                            </div>
                            <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
                                <span class="memory-v2-layer-badge">${escapeHtml(policy.memoryLayer)}</span>
                                ${isRowsTable(active.table) ? `<button type="button" class="btn btn-small btn-primary" data-action="add-row" data-template-id="${active.template.id}" data-table-id="${active.table.id}">新增行</button>` : ''}
                            </div>
                        </div>
                        ${tableContent}
                        ${rawJson}
                    </div>
                </section>
            </div>
        `;
    }

    function renderFieldEditor(templateId, tableId, field, value, locked, rowId = '') {
        const disabled = locked ? 'disabled' : '';
        const rowAttr = rowId ? `data-row-id="${rowId}"` : '';
        const baseAttrs = `class="memory-table-input" data-template-id="${templateId}" data-table-id="${tableId}" data-field-id="${field.id}" ${rowAttr} ${disabled}`;
        switch (normalizeFieldType(field.type)) {
            case 'longtext':
                return `<textarea ${baseAttrs} rows="3" style="width:100%; border:1px solid #ececec; border-radius:12px; padding:10px; font-size:14px; min-height:88px;">${escapeHtml(String(value || ''))}</textarea>`;
            case 'number':
            case 'progress':
                return `<input ${baseAttrs} type="number" value="${escapeAttribute(String(value ?? ''))}" min="${field.min ?? ''}" max="${field.max ?? ''}" style="width:100%; border:1px solid #ececec; border-radius:12px; padding:10px; font-size:14px;">`;
            case 'enum':
                return `<select ${baseAttrs} style="width:100%; border:1px solid #ececec; border-radius:12px; padding:10px; font-size:14px; background:#fff;">
                    ${(field.options || []).map(option => `<option value="${escapeAttribute(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
                </select>`;
            case 'boolean':
                return `
                    <label style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border:1px solid #ececec; border-radius:12px;">
                        <span style="font-size:14px; color:#666;">${value ? '已开启' : '已关闭'}</span>
                        <label class="kkt-switch">
                            <input ${baseAttrs} type="checkbox" ${value ? 'checked' : ''}>
                            <span class="kkt-slider"></span>
                        </label>
                    </label>
                `;
            case 'tags':
                return `<input ${baseAttrs} type="text" value="${escapeAttribute(Array.isArray(value) ? value.join(', ') : String(value || ''))}" placeholder="用逗号分隔多个标签" style="width:100%; border:1px solid #ececec; border-radius:12px; padding:10px; font-size:14px;">`;
            case 'date':
                return `<input ${baseAttrs} type="date" value="${escapeAttribute(String(value || ''))}" style="width:100%; border:1px solid #ececec; border-radius:12px; padding:10px; font-size:14px;">`;
            default:
                return `<input ${baseAttrs} type="text" value="${escapeAttribute(String(value || ''))}" style="width:100%; border:1px solid #ececec; border-radius:12px; padding:10px; font-size:14px;">`;
        }
    }


    function renderFieldChartContainer(templateId, tableId, field) {
        const type = normalizeFieldType(field.type);
        if (!['number', 'progress'].includes(type)) return '';
        return `
            <div style="margin-top:12px; border-top:1px dashed #efefef; padding-top:12px;">
                <div style="font-size:12px; color:#999; margin-bottom:6px;">趋势</div>
                <canvas class="memory-field-chart" data-template-id="${templateId}" data-table-id="${tableId}" data-field-id="${field.id}" height="54" style="width:100%; height:54px;"></canvas>
            </div>
        `;
    }

    function getFieldHistorySeries(chat, templateId, tableId, fieldId, currentValue) {
        const entries = [...(chat.memoryTables.history || [])].reverse();
        const result = [];
        entries.forEach(entry => {
            const value = entry.snapshot?.[templateId]?.[tableId]?.[fieldId];
            if (typeof value === 'number') {
                result.push(value);
            }
        });
        if (typeof currentValue === 'number') {
            result.push(currentValue);
        }
        return result.slice(-12);
    }

    function drawAllCharts(chat) {
        const canvases = document.querySelectorAll('#memory-table-screen .memory-field-chart');
        canvases.forEach(canvas => {
            const templateId = canvas.dataset.templateId;
            const tableId = canvas.dataset.tableId;
            const fieldId = canvas.dataset.fieldId;
            const template = db.memoryTableTemplates.find(item => item.id === templateId);
            const table = template ? template.tables.find(item => item.id === tableId) : null;
            const field = table ? table.columns.find(item => item.id === fieldId) : null;
            if (!field) return;
            const value = getFieldValue(chat, templateId, tableId, field);
            const series = getFieldHistorySeries(chat, templateId, tableId, fieldId, value);
            drawSparkline(canvas, series, field);
        });
    }

    function drawSparkline(canvas, series, field) {
        const ctx = canvas.getContext('2d');
        const width = canvas.clientWidth || 300;
        const height = canvas.height || 54;
        canvas.width = width;
        ctx.clearRect(0, 0, width, height);

        ctx.strokeStyle = '#e6e9f2';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height - 10);
        ctx.lineTo(width, height - 10);
        ctx.stroke();

        if (!Array.isArray(series) || series.length < 2) {
            ctx.fillStyle = '#aaa';
            ctx.font = '12px sans-serif';
            ctx.fillText('暂无足够历史数据', 10, 28);
            return;
        }

        const min = typeof field.min === 'number' ? field.min : Math.min(...series);
        const max = typeof field.max === 'number' ? field.max : Math.max(...series);
        const range = Math.max(1, max - min);

        ctx.strokeStyle = '#5b8cff';
        ctx.lineWidth = 2;
        ctx.beginPath();

        series.forEach((value, index) => {
            const x = (width - 12) * (index / Math.max(1, series.length - 1)) + 6;
            const y = height - 10 - ((value - min) / range) * (height - 24);
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        const lastValue = series[series.length - 1];
        const lastX = width - 6;
        const lastY = height - 10 - ((lastValue - min) / range) * (height - 24);
        ctx.fillStyle = '#5b8cff';
        ctx.beginPath();
        ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    function formatDateTime(timestamp) {
        const date = new Date(timestamp);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        return `${y}-${m}-${d} ${hh}:${mm}`;
    }

    function getShortValue(value) {
        if (Array.isArray(value)) return value.join(', ');
        if (typeof value === 'object' && value !== null) return JSON.stringify(value);
        const text = String(value ?? '');
        return text.length > 24 ? `${text.slice(0, 24)}...` : text;
    }

    function escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttribute(text) {
        return escapeHtml(text).replace(/"/g, '&quot;');
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

    function getFieldGroups(fields) {
        const groups = [];
        const order = new Map();
        (fields || []).forEach((field, index) => {
            const groupName = (field.group || '').trim() || '未分组';
            if (!order.has(groupName)) {
                order.set(groupName, groups.length);
                groups.push({
                    name: groupName,
                    fields: [],
                    ungrouped: !(field.group || '').trim()
                });
            }
            groups[order.get(groupName)].fields.push({ field, index });
        });
        return groups;
    }

    function getTableRuntimePolicy(table) {
        return MemoryPolicy
            ? MemoryPolicy.normalizeTablePolicy(table)
            : {
                memoryLayer: table.memoryLayer || 'long',
                updatePolicy: table.updatePolicy || {},
                injectionPolicy: table.injectionPolicy || { mode: 'always', budget: 1200 }
            };
    }

    function getRowSearchText(table, row) {
        return (table.columns || []).map(field => {
            const value = getFieldDisplayValue(field, row.cells?.[field.id]);
            return `${field.key}: ${value || ''}`;
        }).join('\n');
    }

    function getRowTimestamp(table, row) {
        if (row?.meta?.lastMentionedAt || row?.meta?.updatedAt || row?.meta?.createdAt) {
            return Number(row.meta.lastMentionedAt || row.meta.updatedAt || row.meta.createdAt) || 0;
        }
        let best = 0;
        (table.columns || []).forEach(field => {
            if (!/时间|日期|更新|发生|创建|完成/.test(field.key || '')) return;
            const raw = row?.cells?.[field.id];
            const ts = MemoryPolicy ? MemoryPolicy.parseDateLike(raw) : Date.parse(String(raw || ''));
            if (Number.isFinite(ts) && ts > best) best = ts;
        });
        return best;
    }

    function getRowStatusText(table, row) {
        return (table.columns || [])
            .filter(field => /状态|进度|结果/.test(field.key || ''))
            .map(field => getFieldDisplayValue(field, row.cells?.[field.id]))
            .filter(Boolean)
            .join(' ');
    }

    function rowToRetrievalItem(table, row, rowIndex) {
        const searchText = getRowSearchText(table, row);
        const statusText = getRowStatusText(table, row);
        const expiresAt = Number(row?.meta?.expiresAt) || 0;
        const expiredByMeta = expiresAt > 0 && expiresAt < Date.now();
        const completed = MemoryPolicy ? MemoryPolicy.isCompletedText(statusText) : /已完成|已取消|已过期|已解决/.test(statusText);
        return {
            id: row.id,
            row,
            rowIndex,
            searchText,
            text: searchText,
            updatedAt: getRowTimestamp(table, row),
            createdAt: Number(row?.meta?.createdAt) || 0,
            importance: Number(row?.meta?.importance) || 50,
            confidence: Number(row?.meta?.confidence) || 70,
            pinned: !!row?.meta?.pinned,
            completed,
            active: !completed && !expiredByMeta,
            expiredByMeta
        };
    }

    function isKeyValueTableActive(chat, template, table, policy) {
        if (!policy.maxAgeDays) return true;
        let newest = 0;
        let explicitExpiry = 0;
        (table.columns || []).forEach(field => {
            const value = getFieldValue(chat, template.id, table.id, field);
            if (/有效期|过期/.test(field.key || '')) {
                explicitExpiry = Math.max(explicitExpiry, MemoryPolicy ? MemoryPolicy.parseDateLike(value) : Date.parse(String(value || '')) || 0);
            }
            if (/记录时间|更新时间|日期|时间/.test(field.key || '')) {
                newest = Math.max(newest, MemoryPolicy ? MemoryPolicy.parseDateLike(value) : Date.parse(String(value || '')) || 0);
            }
        });
        if (explicitExpiry && explicitExpiry < Date.now()) return false;
        if (!newest) return true;
        return (Date.now() - newest) <= policy.maxAgeDays * 86400000;
    }

    function selectRowsForInjection(chat, template, table, queryText, forceFull) {
        const rows = getRows(chat, template.id, table);
        if (forceFull) return rows.map((row, rowIndex) => rowToRetrievalItem(table, row, rowIndex));
        const tablePolicy = getTableRuntimePolicy(table);
        const policy = tablePolicy.injectionPolicy;
        if (policy.mode === 'never') return [];
        const items = rows.map((row, rowIndex) => rowToRetrievalItem(table, row, rowIndex));
        if (policy.mode === 'always') {
            return policy.topK > 0 ? items.slice(-policy.topK).reverse() : items;
        }
        if (policy.mode === 'active') {
            const active = items.filter(item => item.active || item.pinned);
            active.sort((a, b) => {
                if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
                if (b.importance !== a.importance) return b.importance - a.importance;
                return (b.updatedAt || 0) - (a.updatedAt || 0);
            });
            return policy.topK > 0 ? active.slice(0, policy.topK) : active;
        }
        return MemoryPolicy
            ? MemoryPolicy.selectRelevantItems(items, queryText, policy)
            : items.slice(0, policy.topK || 5);
    }

    function buildSingleTableContext(chat, template, table, queryText, options = {}) {
        const tablePolicy = getTableRuntimePolicy(table);
        const injectionPolicy = tablePolicy.injectionPolicy;
        const forceFull = !!options.forceFull;
        if (!forceFull && injectionPolicy.mode === 'never') return '';

        let text = `- ${table.name}\n`;
        if (isRowsTable(table)) {
            const selected = selectRowsForInjection(chat, template, table, queryText, forceFull);
            if (!selected.length) return '';
            selected.forEach((item, selectedIndex) => {
                text += `  - 记录 ${selectedIndex + 1}`;
                if (item._score !== undefined) text += `（相关度 ${item._score.toFixed(2)}）`;
                text += `\n`;
                (table.columns || []).filter(field => forceFull || field.important !== false).forEach(field => {
                    const value = getFieldDisplayValue(field, item.row.cells?.[field.id]);
                    if (isEmptyMemoryValue(field, item.row.cells?.[field.id])) return;
                    text += `    - ${field.summaryLabel || field.key}: ${value}\n`;
                });
            });
        } else {
            if (!forceFull && injectionPolicy.mode === 'active' && !isKeyValueTableActive(chat, template, table, injectionPolicy)) return '';
            const fields = (table.columns || []).filter(field => {
                if (!forceFull && field.important === false) return false;
                const value = getFieldValue(chat, template.id, table.id, field);
                return !isEmptyMemoryValue(field, value);
            });
            if (!fields.length) return '';
            if (!forceFull && injectionPolicy.mode === 'relevant' && MemoryPolicy) {
                const aggregate = fields.map(field => `${field.key}: ${getFieldDisplayValue(field, getFieldValue(chat, template.id, table.id, field))}`).join('\n');
                const score = MemoryPolicy.computeLexicalScore(aggregate, queryText);
                if (score < injectionPolicy.threshold) return '';
            }
            fields.forEach(field => {
                const value = getFieldDisplayValue(field, getFieldValue(chat, template.id, table.id, field));
                text += `  - ${field.summaryLabel || field.key}: ${value}\n`;
            });
        }
        return MemoryPolicy ? MemoryPolicy.trimToBudget(text.trim(), injectionPolicy.budget, table.name) : text.trim();
    }

    function getMemoryContextBlock(chat, options = {}) {
        ensureMemoryTableState(chat);
        if (chat.memoryMode !== 'table' && !options.force) return '';
        const templateIds = Array.isArray(options.templateIds) && options.templateIds.length > 0 ? options.templateIds : null;
        const templates = getBoundTemplates(chat).filter(template => !templateIds || templateIds.includes(template.id));
        if (templates.length === 0) return '';

        const forceFull = !!options.force;
        const queryText = options.queryText || (MemoryPolicy ? MemoryPolicy.buildQueryText(chat) : '');
        const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
        if (!forceFull && runtime?.lastContextBlock && runtime.lastPreparedQuery === queryText) {
            return runtime.lastContextBlock;
        }

        const sections = [];
        templates.forEach(template => {
            ensureTemplateDataForChat(chat, template);
            const tableSections = (template.tables || [])
                .map(table => buildSingleTableContext(chat, template, table, queryText, { forceFull }))
                .filter(Boolean);
            if (!tableSections.length) return;
            sections.push(`《${template.name}》\n${tableSections.join('\n')}`);
        });
        if (!sections.length) return '';
        const header = forceFull
            ? '【结构化记忆完整档案】\n以下是选中模板的完整结构化数据，仅用于整理或转换。'
            : '【结构化记忆·按需检索】\n以下内容由固定、有效或与当前话题相关的档案条目组成。未出现的内容不要擅自补全。';
        let block = `${header}\n\n${sections.join('\n\n')}`.trim();
        if (!forceFull && MemoryPolicy) {
            block = MemoryPolicy.trimToBudget(block, runtime.engineSettings.globalInjectionBudget, '结构化记忆');
            runtime.lastContextBlock = block;
            runtime.lastPreparedQuery = queryText;
            runtime.lastPreparedAt = Date.now();
        }
        return block;
    }

    async function prepareMemoryTableContext(chat, options = {}) {
        ensureMemoryTableState(chat);
        if (chat.memoryMode !== 'table' && !options.force) return '';
        // MVP 使用关键词、时效、状态和重要度检索。接口保留为 async，后续可无缝接入 embedding。
        if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
        return getMemoryContextBlock(chat, { ...options, queryText: options.queryText || (MemoryPolicy ? MemoryPolicy.buildQueryText(chat) : '') });
    }

    function getMemoryApiConfig(preferSummaryApi = true) {
        const summaryReady = db.summaryApiSettings && db.summaryApiSettings.url && db.summaryApiSettings.key && db.summaryApiSettings.model;
        const apiConfig = preferSummaryApi && summaryReady ? db.summaryApiSettings : db.apiSettings;
        if (!apiConfig || !apiConfig.url || !apiConfig.key || !apiConfig.model) {
            throw new Error(preferSummaryApi ? '请先配置总结 API 或主聊天 API' : '请先配置主聊天 API');
        }
        return apiConfig;
    }

    async function requestMemoryContent(prompt, temperature = 0.2, preferSummaryApi = true, task = 'memory-table-summary') {
        const apiConfig = getMemoryApiConfig(preferSummaryApi);
        let { url, key, model } = apiConfig;
        if (url.endsWith('/')) url = url.slice(0, -1);
        const endpoint = `${url}/v1/chat/completions`;
        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`
        };
        const requestBody = {
            model,
            temperature,
            messages: [{ role: 'user', content: prompt }]
        };
        return fetchAiResponse({ ...apiConfig, runtimeTask: task, runtimeSource: 'memory-table' }, requestBody, headers, endpoint);
    }

    async function requestSummaryContent(prompt, temperature = 0.2) {
        return requestMemoryContent(prompt, temperature, true, 'memory-table-summary');
    }

    function getJournalCandidates(chat) {
        return [...(chat.memoryJournals || [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    function openConversionModal(direction) {
        const chat = getCurrentMemoryTableChat();
        const modal = document.getElementById('memory-conversion-modal');
        if (!chat || !modal) return;
        ensureMemoryTableState(chat);
        const boundTemplates = getBoundTemplates(chat);
        const journals = getJournalCandidates(chat);

        uiState.conversionState = {
            direction,
            selectedJournalIds: direction === 'journalToTable'
                ? journals.filter(item => item.isFavorited).map(item => item.id)
                : [],
            selectedTemplateIds: boundTemplates.map(item => item.id),
            strategy: 'overwrite_unlocked',
            journalStyle: 'objective',
            autoFavorite: false,
            titlePrefix: ''
        };
        renderConversionModal();
        modal.classList.add('visible');
    }

    function closeConversionModal() {
        const modal = document.getElementById('memory-conversion-modal');
        if (modal) modal.classList.remove('visible');
        uiState.conversionState = null;
    }

    function renderConversionModal() {
        const state = uiState.conversionState;
        const chat = getCurrentMemoryTableChat();
        const body = document.getElementById('memory-conversion-body');
        const title = document.getElementById('memory-conversion-title');
        if (!state || !chat || !body || !title) return;

        const journals = getJournalCandidates(chat);
        const templates = getBoundTemplates(chat);
        title.textContent = state.direction === 'journalToTable' ? '日记转表格' : '表格转日记';

        if (state.direction === 'journalToTable') {
            const selectedJournals = journals.filter(item => state.selectedJournalIds.includes(item.id));
            const selectedTemplates = templates.filter(item => state.selectedTemplateIds.includes(item.id));
            body.innerHTML = `
                <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
                    <button type="button" class="btn btn-small btn-secondary" data-conversion-action="select-favorited">仅收藏</button>
                    <button type="button" class="btn btn-small btn-secondary" data-conversion-action="select-all-journals">全选日记</button>
                    <button type="button" class="btn btn-small btn-neutral" data-conversion-action="clear-journals">清空日记</button>
                </div>
                <div class="form-group">
                    <label>选择要读取的日记</label>
                    <div style="max-height:180px; overflow:auto; border:1px solid #ececec; border-radius:12px; padding:10px; background:#fafafa;">
                        ${journals.length === 0 ? '<div style="font-size:13px; color:#999;">没有可用日记</div>' : journals.map(item => `
                            <label style="display:flex; gap:8px; align-items:flex-start; padding:8px 0; border-bottom:1px dashed #eee;">
                                <input type="checkbox" data-conversion-role="journal-toggle" value="${item.id}" ${state.selectedJournalIds.includes(item.id) ? 'checked' : ''}>
                                <span style="font-size:13px; color:#444;">
                                    <strong>${escapeHtml(item.title || '无标题')}</strong>
                                    <span style="display:block; color:#999; margin-top:2px;">${item.isFavorited ? '已收藏' : '未收藏'} · ${formatDateTime(item.createdAt || Date.now())}</span>
                                </span>
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div class="form-group">
                    <label>目标模板</label>
                    <div style="display:flex; flex-wrap:wrap; gap:8px;">
                        ${templates.map(item => `
                            <label style="padding:8px 10px; border:1px solid #ececec; border-radius:999px; background:${state.selectedTemplateIds.includes(item.id) ? 'rgba(91,140,255,0.08)' : '#fff'}; font-size:13px;">
                                <input type="checkbox" data-conversion-role="template-toggle" value="${item.id}" ${state.selectedTemplateIds.includes(item.id) ? 'checked' : ''}>
                                ${escapeHtml(item.name)}
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div class="form-group">
                    <label>覆盖策略</label>
                    <select data-conversion-role="strategy">
                        <option value="overwrite_unlocked" ${state.strategy === 'overwrite_unlocked' ? 'selected' : ''}>覆盖所有未锁定字段</option>
                        <option value="fill_empty" ${state.strategy === 'fill_empty' ? 'selected' : ''}>只填空字段</option>
                    </select>
                </div>
                <div style="background:#fafafa; border:1px solid #ececec; border-radius:12px; padding:12px;">
                    <div style="font-size:13px; font-weight:700; color:#444;">转换预览</div>
                    <div style="font-size:12px; color:#777; margin-top:8px; line-height:1.6;">
                        将读取 <strong>${selectedJournals.length}</strong> 篇日记，写入 <strong>${selectedTemplates.length}</strong> 个模板。<br>
                        当前策略：${state.strategy === 'fill_empty' ? '只填空字段' : '覆盖所有未锁定字段'}。
                    </div>
                    ${selectedJournals.length > 0 ? `<div style="margin-top:10px; font-size:12px; color:#666;">样本：${selectedJournals.slice(0, 3).map(item => escapeHtml(item.title)).join('、')}${selectedJournals.length > 3 ? '...' : ''}</div>` : ''}
                </div>
            `;
        } else {
            const selectedTemplates = templates.filter(item => state.selectedTemplateIds.includes(item.id));
            const previewBlock = getMemoryContextBlock(chat, { force: true, templateIds: state.selectedTemplateIds });
            body.innerHTML = `
                <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
                    <button type="button" class="btn btn-small btn-secondary" data-conversion-action="select-all-templates">全选模板</button>
                    <button type="button" class="btn btn-small btn-neutral" data-conversion-action="clear-templates">清空模板</button>
                </div>
                <div class="form-group">
                    <label>选择要整理成日记的模板</label>
                    <div style="display:flex; flex-wrap:wrap; gap:8px;">
                        ${templates.map(item => `
                            <label style="padding:8px 10px; border:1px solid #ececec; border-radius:999px; background:${state.selectedTemplateIds.includes(item.id) ? 'rgba(91,140,255,0.08)' : '#fff'}; font-size:13px;">
                                <input type="checkbox" data-conversion-role="template-toggle" value="${item.id}" ${state.selectedTemplateIds.includes(item.id) ? 'checked' : ''}>
                                ${escapeHtml(item.name)}
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;">
                    <div class="form-group">
                        <label>整理风格</label>
                        <select data-conversion-role="journal-style">
                            <option value="objective" ${state.journalStyle === 'objective' ? 'selected' : ''}>客观回忆</option>
                            <option value="timeline" ${state.journalStyle === 'timeline' ? 'selected' : ''}>时间线整理</option>
                            <option value="archive" ${state.journalStyle === 'archive' ? 'selected' : ''}>档案总结</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>标题前缀</label>
                        <input type="text" data-conversion-role="title-prefix" value="${escapeAttribute(state.titlePrefix || '')}" placeholder="可选，例如：结构记忆·">
                    </div>
                </div>
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding: 10px 12px; border: 1px solid #ececec; border-radius: 12px; background: #fff;">
                    <span style="font-size:14px; color:#444; font-weight:bold;">生成后自动收藏</span>
                    <label class="kkt-switch">
                        <input type="checkbox" data-conversion-role="auto-favorite" ${state.autoFavorite ? 'checked' : ''}>
                        <span class="kkt-slider"></span>
                    </label>
                </div>
                <div style="background:#fafafa; border:1px solid #ececec; border-radius:12px; padding:12px;">
                    <div style="font-size:13px; font-weight:700; color:#444;">转换预览</div>
                    <div style="font-size:12px; color:#777; margin-top:8px; line-height:1.6;">
                        将读取 <strong>${selectedTemplates.length}</strong> 个模板，并生成一篇新的记忆日记。<br>
                        风格：${state.journalStyle === 'timeline' ? '时间线整理' : state.journalStyle === 'archive' ? '档案总结' : '客观回忆'}。
                    </div>
                    <pre style="white-space:pre-wrap; margin:10px 0 0; font-size:12px; color:#555; max-height:180px; overflow:auto;">${escapeHtml(previewBlock || '暂无可用表格内容')}</pre>
                </div>
            `;
        }
    }

    function getHistoryMessageContent(item) {
        let content = item.content || '';
        if (item.parts && item.parts.length > 0) {
            content = item.parts.map(part => part.text || '[图片]').join('');
        }
        return content;
    }

    function collectMessagesForMemoryTable(chat, options = {}) {
        let history = Array.isArray(chat.history) ? [...chat.history] : [];
        if (options.start && options.end) {
            const startIndex = Math.max(0, options.start - 1);
            const endIndex = Math.min(history.length, options.end);
            history = history.slice(startIndex, endIndex);
        }
        if (typeof filterHistoryForAI === 'function') {
            history = filterHistoryForAI(chat, history);
        }
        history = history.filter(item => !item.isContextDisabled && !item.isThinking);
        if (!options.start && !options.end) {
            const configuredMax = Math.max(10, parseInt(options.maxContextMessages, 10) || (MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat).engineSettings.maxSourceMessages : MEMORY_TABLE_MAX_CONTEXT_MESSAGES));
            history = history.slice(-configuredMax);
        }
        return history;
    }

    function buildTemplateDefinitionForPrompt(chat, templates, options = {}) {
        const queryText = options.queryText || '';
        const relevantRowsOnly = !!options.relevantRowsOnly;
        const maxCandidateRows = Math.max(3, parseInt(options.maxCandidateRows, 10) || 12);
        return templates.map(template => {
            return [
                `模板ID=${template.id} 名称=${template.name}`,
                template.description ? `描述=${template.description}` : '',
                ...(template.tables || []).map(table => {
                    const tablePolicy = getTableRuntimePolicy(table);
                    const tableRowsText = isRowsTable(table)
                        ? (() => {
                            let rows = getRows(chat, template.id, table);
                            if (relevantRowsOnly && rows.length > maxCandidateRows && MemoryPolicy) {
                                const candidates = rows.map((row, rowIndex) => rowToRetrievalItem(table, row, rowIndex));
                                const selected = MemoryPolicy.selectRelevantItems(candidates, queryText, {
                                    ...tablePolicy.injectionPolicy,
                                    mode: 'relevant',
                                    topK: maxCandidateRows,
                                    threshold: 0,
                                    includeCompleted: true,
                                    maxAgeDays: 0
                                });
                                rows = selected.map(item => item.row);
                                const newest = getRows(chat, template.id, table)
                                    .slice()
                                    .sort((a, b) => getRowTimestamp(table, b) - getRowTimestamp(table, a))
                                    .slice(0, Math.min(4, maxCandidateRows));
                                const merged = new Map();
                                [...rows, ...newest].forEach(row => merged.set(row.id, row));
                                rows = Array.from(merged.values()).slice(0, maxCandidateRows);
                            }
                            if (!rows.length) return '  现有候选行=空';
                            return rows.map((row, rowIndex) => {
                                const cells = (table.columns || []).map(field => `${field.key}=${getFieldDisplayValue(field, row.cells[field.id]) || '空'}`).join(' | ');
                                return `  候选行ID=${row.id} 候选号=${rowIndex + 1} ${cells}`;
                            }).join('\n');
                        })()
                        : '';
                    return [
                        `  表格ID=${table.id} 名称=${table.name} 层级=${tablePolicy.memoryLayer} 模式=${isRowsTable(table) ? 'rows' : 'keyValue'}`,
                        `  更新策略=${tablePolicy.updatePolicy.enabled ? tablePolicy.updatePolicy.triggerMode : 'manual'}；允许新增=${tablePolicy.updatePolicy.allowAdd !== false ? '是' : '否'}；允许修改=${tablePolicy.updatePolicy.allowUpdate !== false ? '是' : '否'}；允许删除=${tablePolicy.updatePolicy.allowDelete === true ? '是' : '否'}`,
                        table.extractPrompt ? `  表格提取规则=${table.extractPrompt}` : '',
                        tablePolicy.updatePolicy.instructions ? `  本表附加规则=${tablePolicy.updatePolicy.instructions}` : '',
                        ...(table.columns || []).map(field => {
                            const currentValue = isRowsTable(table)
                                ? '见候选行'
                                : getFieldDisplayValue(field, getFieldValue(chat, template.id, table.id, field));
                            const locked = isFieldLocked(chat, template.id, table.id, field.id);
                            const optionsText = Array.isArray(field.options) && field.options.length > 0 ? ` 可选值=${field.options.join('|')}` : '';
                            const range = (typeof field.min === 'number' || typeof field.max === 'number')
                                ? ` 范围=${field.min ?? ''}~${field.max ?? ''}`
                                : '';
                            const group = field.group ? ` 分组=${field.group}` : '';
                            return `    字段ID=${field.id} 字段名=${field.key}${group} 类型=${field.type}${optionsText}${range} 当前值=${currentValue || '空'} 锁定=${locked ? '是' : '否'} AI可编辑=${field.aiEditable === false ? '否' : '是'} 重要字段=${field.important !== false ? '是' : '否'} 说明=${field.aiHint || '无'}`;
                        }),
                        tableRowsText
                    ].filter(Boolean).join('\n');
                })
            ].filter(Boolean).join('\n');
        }).join('\n\n');
    }

    function buildHistoryTextForPrompt(chat, history) {
        return history.map(item => {
            const name = item.role === 'user' ? (chat.myName || '用户') : (chat.realName || '角色');
            return `${name}: ${getHistoryMessageContent(item)}`;
        }).join('\n');
    }

    async function updateMemoryTablesFromApi(options = {}) {
        const chat = options.chat || getCurrentMemoryTableChat();
        if (!chat) {
            showToast('请先进入一个角色聊天');
            return { status: 'noop', changedFields: [] };
        }

        const targetTableKeys = new Set(Array.isArray(options.targetTableKeys) ? options.targetTableKeys : []);
        const baseTemplates = (Array.isArray(options.templateIds) && options.templateIds.length > 0
            ? getBoundTemplates(chat).filter(item => options.templateIds.includes(item.id))
            : getBoundTemplates(chat));
        const templates = baseTemplates.map(template => {
            if (targetTableKeys.size === 0) return template;
            return {
                ...template,
                tables: (template.tables || []).filter(table => targetTableKeys.has(`${template.id}::${table.id}`))
            };
        }).filter(template => (template.tables || []).length > 0);
        if (templates.length === 0) {
            showToast('请先绑定至少一个模板');
            return { status: 'noop', changedFields: [] };
        }

        const history = collectMessagesForMemoryTable(chat, {
            start: options.start,
            end: options.end
        });

        if (history.length === 0) {
            if (!options.silent) showToast('聊天记录不足，暂时无法提取');
            return { status: 'noop', changedFields: [] };
        }

        templates.forEach(template => ensureTemplateDataForChat(chat, template));

        const historyText = buildHistoryTextForPrompt(chat, history);
        const templateText = buildTemplateDefinitionForPrompt(chat, templates, {
            queryText: historyText,
            relevantRowsOnly: options.relevantRowsOnly !== false,
            maxCandidateRows: options.maxCandidateRows || 12
        });
        const prompt = `你现在要帮一个聊天角色更新“结构化记忆表”。请根据给定的模板、字段规则和最近聊天记录，只提取明确发生过的信息，并且只输出发生变化的字段。

严格要求：
1. 只更新没有锁定且允许 AI 编辑的字段。
2. keyValue 表只能输出 <field>。
3. rows 表必须使用 <row op="add|update|delete">：
   - 新增一行用 <row op="add">，可不给 rowId。
   - 修改已有行用 <row op="update" rowId="现有行ID">。
   - 删除一行用 <row op="delete" rowId="现有行ID"></row>。
4. 如果某字段或某一行没有新变化，就不要输出它。
5. 不要臆测、不要补完、不要写解释。
6. 如果没有任何变化，输出 <memory_updates></memory_updates>
7. 你必须严格使用以下 XML：
<memory_updates>
  <memory_update templateId="模板ID" tableId="表格ID">
    <field fieldId="字段ID">新值</field>
    <row op="add">
      <field fieldId="字段ID">值</field>
    </row>
    <row op="update" rowId="现有行ID">
      <field fieldId="字段ID">新值</field>
    </row>
    <row op="delete" rowId="现有行ID"></row>
  </memory_update>
</memory_updates>

角色信息：
- 角色名：${chat.realName || ''}
- 角色人设：${chat.persona || ''}
- 用户称呼：${chat.myName || ''}
- 用户人设：${chat.myPersona || ''}

模板定义如下：
${templateText}

最近聊天记录如下：
${historyText}`;

        try {
            const preferSummaryApi = templates.some(template => (template.tables || []).some(table => {
                const policy = getTableRuntimePolicy(table);
                return policy.memoryLayer === 'medium' || policy.memoryLayer === 'long' || policy.memoryLayer === 'review' || policy.updatePolicy.useSummaryApi !== false;
            }));
            const rawContent = await requestMemoryContent(prompt, 0.2, preferSummaryApi, preferSummaryApi ? 'memory-table-summary-update' : 'memory-table-fast-update');
            const changedFields = applyMemoryUpdatesFromXml(chat, rawContent, {
                source: options.source || 'api',
                targetTableKeys: Array.from(targetTableKeys)
            });
            if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
            if (!options.isAutoUpdate && !options.skipCursorSync) {
                const endIndex = options.end || (Array.isArray(chat.history) ? chat.history.length : 0);
                if (endIndex > 0) {
                    setMemoryTableAutoUpdateCursorByEndIndex(chat, endIndex);
                    chat.memoryTables.autoUpdatePending = false;
                }
            }
            await saveCharacter(chat.id);
            if (!options.skipRender) {
                renderMemoryTableScreen();
            }
            if (!options.suppressSuccessToast) {
                showToast(changedFields.length > 0
                    ? `表格已更新，变更 ${changedFields.length} 项`
                    : '没有检测到可更新的字段');
            }
            return { status: 'success', changedFields };
        } catch (error) {
            console.error('[MemoryTable] update failed:', error);
            if (options.propagateError) throw error;
            if (typeof showApiError === 'function') showApiError(error);
            else showToast(error.message || '更新表格失败');
            return { status: 'failed', changedFields: [], error };
        }
    }

    async function updateSingleTableFromPolicy(chat, template, table, options = {}) {
        if (!MemoryPolicy) {
            return updateMemoryTablesFromApi({ chat, ...options });
        }
        const key = `${template.id}::${table.id}`;
        const range = MemoryPolicy.getTableUpdateRange(chat, template.id, table, options);
        if (!range || range.end < range.start) return { status: 'noop', changedFields: [], range: null };
        const state = MemoryPolicy.ensureTableState(chat, template.id, table.id);
        state.lastRunStatus = 'running';
        state.lastError = '';
        try {
            const result = await updateMemoryTablesFromApi({
                chat,
                start: range.start,
                end: range.end,
                targetTableKeys: [key],
                source: options.source || 'auto_v2',
                isAutoUpdate: !!options.isAutoUpdate,
                silent: true,
                skipRender: true,
                skipCursorSync: true,
                suppressSuccessToast: true,
                propagateError: true,
                relevantRowsOnly: true,
                maxCandidateRows: 12
            });
            MemoryPolicy.markTableProcessed(chat, template.id, table.id, range.end, 'success');
            setMemoryTableAutoUpdateCursorByEndIndex(chat, range.end); // V1 兼容游标
            return { ...result, range, templateId: template.id, tableId: table.id };
        } catch (error) {
            state.lastRunStatus = 'failed';
            state.lastError = error.message || String(error);
            state.lastRunAt = Date.now();
            throw error;
        }
    }

    function getDueMemoryTables(chat, options = {}) {
        const descriptors = getBoundTableDescriptors(chat);
        if (!MemoryPolicy) return descriptors;
        if (Array.isArray(options.targetTableKeys) && options.targetTableKeys.length) {
            const keys = new Set(options.targetTableKeys);
            return descriptors.filter(({ template, table }) => keys.has(`${template.id}::${table.id}`));
        }
        return descriptors.filter(({ template, table }) => MemoryPolicy.isTableDue(chat, template.id, table));
    }

    async function processMemoryTableAutoUpdate(chat, options = {}) {
        if (!chat) return { status: 'noop', updatedCount: 0 };
        ensureMemoryTableAutoUpdateState(chat);
        const descriptors = getBoundTableDescriptors(chat);
        if (!descriptors.length) {
            refreshMemoryTableAutoUpdateControls(chat, false);
            return { status: 'noop', updatedCount: 0 };
        }
        if (!options.force && !chat.memoryTables.autoUpdateEnabled) {
            refreshMemoryTableAutoUpdateControls(chat, true);
            return { status: 'disabled', updatedCount: 0 };
        }
        if (chat.memoryTables.autoUpdateState === 'running') return { status: 'running', updatedCount: 0 };
        if (chat.memoryTables.autoUpdateState === 'failed' && !options.ignoreFailedState) return { status: 'failed', updatedCount: 0 };

        const due = getDueMemoryTables(chat, options);
        if (!due.length) {
            chat.memoryTables.autoUpdatePending = false;
            chat.memoryTables.autoUpdateState = 'idle';
            refreshMemoryTableAutoUpdateControls(chat, true);
            if (options.showNoPendingToast) showToast('当前没有到期或待处理的表格');
            return { status: 'noop', updatedCount: 0 };
        }

        const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
        const maxRuns = options.processAllAvailable
            ? Math.max(due.length, runtime?.engineSettings?.maxAutoTablesPerRun || due.length)
            : Math.min(due.length, runtime?.engineSettings?.maxAutoTablesPerRun || 2);
        chat.memoryTables.autoUpdateState = 'running';
        chat.memoryTables.autoUpdatePending = false;
        refreshMemoryTableAutoUpdateControls(chat, true);
        let updatedCount = 0;
        const results = [];
        try {
            for (const descriptor of due.slice(0, maxRuns)) {
                const result = await updateSingleTableFromPolicy(chat, descriptor.template, descriptor.table, {
                    source: options.source || 'auto_v2',
                    isAutoUpdate: true
                });
                if (result.status !== 'noop') updatedCount += 1;
                results.push(result);
                await saveCharacter(chat.id);
            }
            chat.memoryTables.autoUpdateState = 'idle';
            chat.memoryTables.autoUpdatePending = false;
            await saveCharacter(chat.id);
            renderMemoryTableScreen();
            refreshMemoryTableAutoUpdateControls(chat, true);
            if (options.showSuccessToast && updatedCount > 0) showToast(`已更新 ${updatedCount} 张到期表格`);
            return { status: 'success', updatedCount, results };
        } catch (error) {
            console.error('[MemoryTable] V2 auto update failed:', error);
            chat.memoryTables.autoUpdateState = 'failed';
            chat.memoryTables.autoUpdatePending = false;
            await saveCharacter(chat.id);
            refreshMemoryTableAutoUpdateControls(chat, true);
            if (typeof showApiError === 'function') showApiError(error);
            else showToast(error.message || '表格更新失败');
            return { status: 'failed', updatedCount, results, error };
        }
    }

    async function retryMemoryTableAutoUpdate(chat) {
        if (!chat) return { status: 'noop', updatedCount: 0 };
        ensureMemoryTableAutoUpdateState(chat);
        chat.memoryTables.autoUpdateState = 'idle';
        if (MemoryPolicy) {
            getBoundTableDescriptors(chat).forEach(({ template, table }) => {
                const state = MemoryPolicy.ensureTableState(chat, template.id, table.id);
                if (state.lastRunStatus === 'failed') state.lastRunStatus = 'idle';
            });
        }
        return processMemoryTableAutoUpdate(chat, {
            force: true,
            processAllAvailable: true,
            showNoPendingToast: true,
            showSuccessToast: true,
            ignoreFailedState: true,
            source: 'retry_v2'
        });
    }

    async function updateMemoryTableToLatest(chat) {
        return processMemoryTableAutoUpdate(chat, {
            force: true,
            processAllAvailable: true,
            showNoPendingToast: true,
            showSuccessToast: true,
            ignoreFailedState: true,
            source: 'manual_due_v2'
        });
    }

    async function updateSelectedMemoryTable(chat, templateId, tableId) {
        const template = getBoundTemplates(chat).find(item => item.id === templateId);
        const table = template?.tables?.find(item => item.id === tableId);
        if (!template || !table) {
            showToast('没有找到选中的表格');
            return { status: 'noop' };
        }
        const info = MemoryPolicy ? MemoryPolicy.getUnprocessedInfo(chat, templateId, tableId) : null;
        if (info && info.unsyncedMessages <= 0) {
            showToast('该表游标后没有新增消息；可以先调整游标位置');
            return { status: 'noop' };
        }
        chat.memoryTables.autoUpdateState = 'running';
        refreshMemoryTableAutoUpdateControls(chat, true);
        try {
            const result = await updateSingleTableFromPolicy(chat, template, table, {
                source: 'manual_selected_v2',
                isAutoUpdate: false
            });
            chat.memoryTables.autoUpdateState = 'idle';
            await saveCharacter(chat.id);
            renderMemoryTableScreen();
            showToast(result.changedFields?.length ? `已更新 ${table.name}，变更 ${result.changedFields.length} 项` : `${table.name} 没有检测到变化`);
            return result;
        } catch (error) {
            chat.memoryTables.autoUpdateState = 'failed';
            await saveCharacter(chat.id);
            if (typeof showApiError === 'function') showApiError(error);
            else showToast(error.message || '更新选中表失败');
            return { status: 'failed', error };
        }
    }

    async function checkAndTriggerAutoTableUpdate(chat, options = {}) {
        if (!chat || !chat.memoryTables || !chat.memoryTables.autoUpdateEnabled) return { status: 'disabled' };
        ensureMemoryTableAutoUpdateState(chat);
        if (chat.memoryTables.autoUpdateState === 'failed') {
            refreshMemoryTableAutoUpdateControls(chat, getBoundTemplates(chat).length > 0);
            return { status: 'failed' };
        }
        return processMemoryTableAutoUpdate(chat, {
            force: false,
            processAllAvailable: false,
            showNoPendingToast: !!options.showNoPendingToast,
            source: 'auto_round_v2'
        });
    }

    async function convertJournalsToTables() {
        const chat = getCurrentMemoryTableChat();
        if (!chat) {
            showToast('请先进入一个角色聊天');
            return;
        }
        openConversionModal('journalToTable');
    }

    async function convertTablesToJournal() {
        const chat = getCurrentMemoryTableChat();
        if (!chat) {
            showToast('请先进入一个角色聊天');
            return;
        }
        openConversionModal('tableToJournal');
    }

    async function executeConversionFromModal() {
        const state = uiState.conversionState;
        const chat = getCurrentMemoryTableChat();
        if (!state || !chat) return;

        if (state.direction === 'journalToTable') {
            const templates = getBoundTemplates(chat).filter(item => state.selectedTemplateIds.includes(item.id));
            const journals = getJournalCandidates(chat).filter(item => state.selectedJournalIds.includes(item.id));
            if (templates.length === 0) {
                showToast('请至少选择一个目标模板');
                return;
            }
            if (journals.length === 0) {
                showToast('请至少选择一篇日记');
                return;
            }

            templates.forEach(template => ensureTemplateDataForChat(chat, template));
            const templateText = buildTemplateDefinitionForPrompt(chat, templates);

            const journalText = journals.map(item => `标题：${item.title}\n内容：${item.content}`).join('\n\n---\n\n');
            const prompt = `请把下面这些“已确认长期记忆”的日记，抽取进结构化记忆表。只更新发生变化的字段，只能依据给定日记内容，不要编造。

输出格式必须严格是：
<memory_updates>
  <memory_update templateId="模板ID" tableId="表格ID">
    <field fieldId="字段ID">新值</field>
    <row op="add">
      <field fieldId="字段ID">值</field>
    </row>
    <row op="update" rowId="现有行ID">
      <field fieldId="字段ID">新值</field>
    </row>
    <row op="delete" rowId="现有行ID"></row>
  </memory_update>
</memory_updates>

如果没有变化，输出 <memory_updates></memory_updates>。
rows 表请使用 row 节点，不要把 rows 表伪装成普通 field。

角色信息：
- 角色名：${chat.realName || ''}
- 用户称呼：${chat.myName || ''}

模板定义：
${templateText}

日记内容：
${journalText}`;

            try {
                const rawContent = await requestSummaryContent(prompt, 0.2);
                const changedFields = applyMemoryUpdatesFromXml(chat, rawContent, {
                    source: 'api',
                    targetTemplateIds: state.selectedTemplateIds,
                    strategy: state.strategy
                });
                await saveCharacter(chat.id);
                closeConversionModal();
                renderMemoryTableScreen();
                showToast(changedFields.length > 0 ? `已从日记提取 ${changedFields.length} 项表格变更` : '没有检测到可提取的新字段');
            } catch (error) {
                console.error('[MemoryTable] journal to table failed:', error);
                if (typeof showApiError === 'function') showApiError(error);
                else showToast(error.message || '日记转表格失败');
            }
        } else {
            const selectedTemplateIds = state.selectedTemplateIds || [];
            const tableContext = getMemoryContextBlock(chat, { force: true, templateIds: selectedTemplateIds });
            if (!tableContext) {
                showToast('当前没有可转换的表格内容');
                return;
            }
            const styleInstruction = state.journalStyle === 'timeline'
                ? '请按时间线整理，突出变化过程。'
                : state.journalStyle === 'archive'
                    ? '请写成结构清晰、偏档案整理风格的总结。'
                    : '请使用客观回忆风格。';
            const prompt = `请把下面的结构化记忆整理成一篇“客观、连贯、适合长期回忆”的记忆日记。不要额外解释，只输出以下 XML：
<journal>
  <title>标题</title>
  <content>正文</content>
</journal>

要求：
1. 语气客观，不要像聊天。
2. 可以按时间线整理，但不要凭空补完。
3. 标题简洁。
4. ${styleInstruction}

结构化记忆如下：
${tableContext}`;

            try {
                const rawContent = await requestSummaryContent(prompt, 0.5);
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(`<root>${rawContent || ''}</root>`, 'text/xml');
                if (xmlDoc.querySelector('parsererror')) {
                    throw new Error('表格转日记返回格式解析失败');
                }
                const generatedTitle = xmlDoc.querySelector('title')?.textContent?.trim() || '结构化记忆整理';
                const title = `${state.titlePrefix || ''}${generatedTitle}`;
                const content = xmlDoc.querySelector('content')?.textContent?.trim() || '';
                if (!content) {
                    throw new Error('没有提取到有效日记内容');
                }
                if (!Array.isArray(chat.memoryJournals)) chat.memoryJournals = [];
                chat.memoryJournals.unshift({
                    id: createMemoryId('journal'),
                    range: null,
                    title,
                    content,
                    createdAt: Date.now(),
                    chatId: chat.id,
                    chatType: 'private',
                    isFavorited: !!state.autoFavorite,
                    source: 'memory_table_conversion'
                });
                await saveCharacter(chat.id);
                closeConversionModal();
                renderMemoryTableScreen();
                showToast('已根据表格生成新日记');
            } catch (error) {
                console.error('[MemoryTable] table to journal failed:', error);
                if (typeof showApiError === 'function') showApiError(error);
                else showToast(error.message || '表格转日记失败');
            }
        }
    }

    function applyMemoryUpdatesFromXml(chat, rawContent, options = {}) {
        ensureMemoryTableState(chat);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(`<root>${rawContent || ''}</root>`, 'text/xml');
        if (xmlDoc.querySelector('parsererror')) {
            throw new Error('结构化记忆返回格式解析失败');
        }

        const updates = Array.from(xmlDoc.querySelectorAll('memory_update'));
        if (updates.length === 0) {
            chat.memoryTables.lastChangedFieldPaths = [];
            return [];
        }

        const changedFields = [];
        updates.forEach(updateNode => {
            const templateId = updateNode.getAttribute('templateId');
            const tableId = updateNode.getAttribute('tableId');
            if (Array.isArray(options.targetTemplateIds) && options.targetTemplateIds.length > 0 && !options.targetTemplateIds.includes(templateId)) {
                return;
            }
            const template = db.memoryTableTemplates.find(item => item.id === templateId);
            const table = template ? (template.tables || []).find(item => item.id === tableId) : null;
            if (!template || !table) return;
            if (Array.isArray(options.targetTableKeys) && options.targetTableKeys.length > 0 && !options.targetTableKeys.includes(`${templateId}::${tableId}`)) return;
            const updatePolicy = getTableRuntimePolicy(table).updatePolicy;
            ensureTemplateDataForChat(chat, template);

            if (isRowsTable(table)) {
                Array.from(updateNode.querySelectorAll('row')).forEach(rowNode => {
                    const op = (rowNode.getAttribute('op') || 'update').trim().toLowerCase();
                    const rowId = rowNode.getAttribute('rowId') || '';
                    if (op === 'delete') {
                        if (updatePolicy.allowDelete !== true) return;
                        const existingRow = rowId ? findRowById(chat, templateId, table, rowId) : null;
                        if (!existingRow) return;
                        (table.columns || []).forEach(field => {
                            changedFields.push({
                                templateId,
                                tableId,
                                rowId,
                                fieldId: field.id,
                                label: `${table.name} / ${field.key}（删除行）`,
                                oldValue: existingRow.cells[field.id],
                                newValue: ''
                            });
                        });
                        deleteRow(chat, templateId, table, rowId, { source: options.source || 'api', skipHistory: true });
                        return;
                    }

                    if (op === 'add') {
                        if (updatePolicy.allowAdd === false) return;
                        const initialValues = {};
                        Array.from(rowNode.querySelectorAll('field')).forEach(fieldNode => {
                            const fieldId = fieldNode.getAttribute('fieldId');
                            const field = (table.columns || []).find(item => item.id === fieldId);
                            if (!field || field.aiEditable === false || isFieldLocked(chat, templateId, tableId, fieldId)) return;
                            initialValues[fieldId] = fieldNode.textContent || '';
                        });
                        if (Object.keys(initialValues).length === 0) return;
                        const addedRow = addRow(chat, templateId, table, initialValues, { source: options.source || 'api', skipHistory: true });
                        (table.columns || []).forEach(field => {
                            if (initialValues[field.id] === undefined) return;
                            changedFields.push({
                                templateId,
                                tableId,
                                rowId: addedRow.id,
                                fieldId: field.id,
                                label: `${table.name} / ${field.key}（新增行）`,
                                oldValue: '',
                                newValue: addedRow.cells[field.id]
                            });
                        });
                        return;
                    }

                    if (updatePolicy.allowUpdate === false) return;
                    const targetRow = rowId ? findRowById(chat, templateId, table, rowId) : null;
                    if (!targetRow) return;
                    Array.from(rowNode.querySelectorAll('field')).forEach(fieldNode => {
                        const fieldId = fieldNode.getAttribute('fieldId');
                        const field = (table.columns || []).find(item => item.id === fieldId);
                        if (!field || field.aiEditable === false || isFieldLocked(chat, templateId, tableId, fieldId)) return;
                        const oldValue = targetRow.cells[field.id];
                        if (options.strategy === 'fill_empty' && !isEmptyMemoryValue(field, oldValue)) return;
                        const newValue = normalizeFieldValue(field, fieldNode.textContent || '');
                        if (isSameMemoryValue(oldValue, newValue)) return;
                        targetRow.cells[field.id] = newValue;
                        targetRow.meta ||= {};
                        targetRow.meta.updatedAt = Date.now();
                        targetRow.meta.lastMentionedAt = Date.now();
                        changedFields.push({
                            templateId,
                            tableId,
                            rowId,
                            fieldId,
                            label: `${table.name} / ${field.key}`,
                            oldValue,
                            newValue
                        });
                    });
                });
                return;
            }

            if (updatePolicy.allowUpdate === false) return;
            Array.from(updateNode.children)
                .filter(node => node.tagName === 'field')
                .forEach(fieldNode => {
                    const fieldId = fieldNode.getAttribute('fieldId');
                    const field = (table.columns || []).find(item => item.id === fieldId);
                    if (!field) return;
                    if (field.aiEditable === false) return;
                    if (isFieldLocked(chat, templateId, tableId, fieldId)) return;

                    const oldValue = getFieldValue(chat, templateId, tableId, field);
                    if (options.strategy === 'fill_empty' && !isEmptyMemoryValue(field, oldValue)) return;
                    const newValue = normalizeFieldValue(field, fieldNode.textContent || '');
                    if (isSameMemoryValue(oldValue, newValue)) return;

                    if (!chat.memoryTables.data[templateId]) chat.memoryTables.data[templateId] = {};
                    if (!chat.memoryTables.data[templateId][tableId]) chat.memoryTables.data[templateId][tableId] = {};
                    chat.memoryTables.data[templateId][tableId][fieldId] = newValue;
                    changedFields.push({
                        templateId,
                        tableId,
                        fieldId,
                        label: field.key,
                        oldValue,
                        newValue
                    });
                });
        });

        pushMemoryHistory(chat, changedFields, {
            source: options.source || 'api'
        });
        if (changedFields.length && MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
        return changedFields;
    }

    async function restoreHistoryEntry(historyId) {
        const chat = getCurrentMemoryTableChat();
        if (!chat) return;
        const entry = (chat.memoryTables.history || []).find(item => item.id === historyId);
        if (!entry) return;

        chat.memoryTables.data = deepClone(entry.snapshot || {});
        chat.memoryTables.lastChangedFieldPaths = [];
        await saveCharacter(chat.id);
        renderMemoryTableScreen();
        showToast('已恢复到该历史快照');
    }

    async function persistTemplateNormalized(normalized) {
        const existingIndex = db.memoryTableTemplates.findIndex(item => item.id === normalized.id);
        if (existingIndex >= 0) {
            db.memoryTableTemplates.splice(existingIndex, 1, normalized);
        } else {
            db.memoryTableTemplates.unshift(normalized);
        }

        db.characters.forEach(chat => {
            ensureMemoryTableState(chat);
            if (chat.memoryTables.boundTemplateIds.includes(normalized.id)) {
                ensureTemplateDataForChat(chat, normalized);
            }
        });

        await saveData();
        renderMemoryTableScreen();
    }

    async function bindTemplateToChat(chat, templateId, shouldBind) {
        ensureMemoryTableState(chat);
        if (shouldBind) {
            if (!chat.memoryTables.boundTemplateIds.includes(templateId)) {
                chat.memoryTables.boundTemplateIds.push(templateId);
            }
            const template = db.memoryTableTemplates.find(item => item.id === templateId);
            if (template) ensureTemplateDataForChat(chat, template);
        } else {
            chat.memoryTables.boundTemplateIds = chat.memoryTables.boundTemplateIds.filter(id => id !== templateId);
        }
        await saveCharacter(chat.id);
        renderMemoryTableScreen();
    }

    function openTemplateEditor(template) {
        const modal = document.getElementById('memory-template-editor-modal');
        const textarea = document.getElementById('memory-template-json');
        if (!modal || !textarea) return;

        const working = template
            ? deepClone(template)
            : (uiState.templateDraft ? deepClone(uiState.templateDraft) : createStarterTemplate());
        uiState.editingTemplateId = working.id || (template ? template.id : null);
        textarea.value = JSON.stringify(working, null, 2);
        modal.classList.add('visible');
    }

    function closeTemplateEditor() {
        const modal = document.getElementById('memory-template-editor-modal');
        if (modal) modal.classList.remove('visible');
        uiState.editingTemplateId = null;
    }

    async function saveTemplateFromEditor() {
        ensureMemoryTemplateStore();
        const textarea = document.getElementById('memory-template-json');
        if (!textarea) return;
        let parsed;
        try {
            parsed = JSON.parse(textarea.value);
        } catch (error) {
            showToast('JSON 解析失败，请检查格式');
            return;
        }

        let normalized;
        try {
            normalized = normalizeTemplate(parsed, uiState.editingTemplateId || undefined);
        } catch (error) {
            showToast(error.message || '模板格式不合法');
            return;
        }
        uiState.templateDraft = deepClone(normalized);
        await persistTemplateNormalized(normalized);
        closeTemplateEditor();
        if (document.getElementById('memory-template-designer-modal')?.classList.contains('visible')) {
            renderTemplateDesigner();
        }
        renderMemoryTableScreen();
        showToast('模板已保存');
    }

    function getDesignerDraftTarget(tableIndex, fieldIndex) {
        const draft = uiState.templateDraft;
        if (!draft) return null;
        if (tableIndex === undefined || tableIndex === null) return draft;
        const table = draft.tables?.[tableIndex];
        if (!table) return null;
        if (fieldIndex === undefined || fieldIndex === null) return table;
        return table.columns?.[fieldIndex] || null;
    }

    function updateDesignerDraftFromInput(target) {
        const role = target.dataset.designerRole;
        if (!role || !uiState.templateDraft) return;
        const tableIndex = target.dataset.tableIndex !== undefined ? Number(target.dataset.tableIndex) : undefined;
        const fieldIndex = target.dataset.fieldIndex !== undefined ? Number(target.dataset.fieldIndex) : undefined;
        const draftTarget = getDesignerDraftTarget(tableIndex, fieldIndex);
        if (!draftTarget) return;

        const value = target.type === 'checkbox' ? target.checked : target.value;
        const ensurePolicies = () => {
            const layer = MemoryPolicy ? MemoryPolicy.normalizeLayer(draftTarget.memoryLayer, draftTarget.name) : (draftTarget.memoryLayer || 'short');
            draftTarget.memoryLayer = layer;
            draftTarget.updatePolicy = MemoryPolicy ? MemoryPolicy.normalizeUpdatePolicy(draftTarget.updatePolicy || {}, layer) : (draftTarget.updatePolicy || {});
            draftTarget.injectionPolicy = MemoryPolicy ? MemoryPolicy.normalizeInjectionPolicy(draftTarget.injectionPolicy || {}, layer) : (draftTarget.injectionPolicy || {});
        };
        switch (role) {
            case 'template-name': uiState.templateDraft.name = value; break;
            case 'template-description': uiState.templateDraft.description = value; break;
            case 'table-name': draftTarget.name = value; break;
            case 'table-mode': draftTarget.mode = value === 'rows' ? 'rows' : 'keyValue'; break;
            case 'table-memory-layer':
                draftTarget.memoryLayer = value;
                if (MemoryPolicy) {
                    draftTarget.updatePolicy = MemoryPolicy.normalizeUpdatePolicy({}, value);
                    draftTarget.injectionPolicy = MemoryPolicy.normalizeInjectionPolicy({}, value);
                }
                break;
            case 'table-extract-prompt': draftTarget.extractPrompt = value; break;
            case 'table-update-enabled': ensurePolicies(); draftTarget.updatePolicy.enabled = value !== 'false'; break;
            case 'table-trigger-mode': ensurePolicies(); draftTarget.updatePolicy.triggerMode = value; break;
            case 'table-round-interval': ensurePolicies(); draftTarget.updatePolicy.roundInterval = Math.max(0, Number(value) || 0); break;
            case 'table-message-interval': ensurePolicies(); draftTarget.updatePolicy.messageInterval = Math.max(0, Number(value) || 0); break;
            case 'table-max-source-messages': ensurePolicies(); draftTarget.updatePolicy.maxSourceMessages = Math.max(10, Number(value) || 10); break;
            case 'table-allow-delete': ensurePolicies(); draftTarget.updatePolicy.allowDelete = value === 'true'; break;
            case 'table-use-summary-api': ensurePolicies(); draftTarget.updatePolicy.useSummaryApi = value === 'true'; break;
            case 'table-update-instructions': ensurePolicies(); draftTarget.updatePolicy.instructions = value; break;
            case 'table-injection-mode': ensurePolicies(); draftTarget.injectionPolicy.mode = value; break;
            case 'table-injection-top-k': ensurePolicies(); draftTarget.injectionPolicy.topK = Math.max(0, Number(value) || 0); break;
            case 'table-injection-budget': ensurePolicies(); draftTarget.injectionPolicy.budget = Math.max(0, Number(value) || 0); break;
            case 'table-max-age-days': ensurePolicies(); draftTarget.injectionPolicy.maxAgeDays = Math.max(0, Number(value) || 0); break;
            case 'field-key': draftTarget.key = value; break;
            case 'field-group': draftTarget.group = value; break;
            case 'field-type': draftTarget.type = normalizeFieldType(value); break;
            case 'field-default': draftTarget.default = draftTarget.type === 'tags' ? parseOptionText(value) : value; break;
            case 'field-ai-editable': draftTarget.aiEditable = value !== 'false'; break;
            case 'field-important': draftTarget.important = value !== 'false'; break;
            case 'field-summary-label': draftTarget.summaryLabel = value; break;
            case 'field-min': draftTarget.min = value === '' ? undefined : Number(value); break;
            case 'field-max': draftTarget.max = value === '' ? undefined : Number(value); break;
            case 'field-options': draftTarget.options = parseOptionText(value); break;
            case 'field-ai-hint': draftTarget.aiHint = value; break;
            case 'field-conditional-rules': draftTarget.conditionalRules = parseConditionalRulesText(value); break;
            default: break;
        }
    }

    function mutateDesignerDraft(action, tableIndex, fieldIndex) {
        const draft = uiState.templateDraft;
        if (!draft) return;
        if (action === 'add-table') {
            draft.tables.push(createEmptyTableDraft());
        } else if (action === 'remove-table') {
            if (draft.tables.length > 1) draft.tables.splice(tableIndex, 1);
        } else if (action === 'move-table-up') {
            moveArrayItem(draft.tables, tableIndex, tableIndex - 1);
        } else if (action === 'move-table-down') {
            moveArrayItem(draft.tables, tableIndex, tableIndex + 1);
        } else if (action === 'add-field') {
            draft.tables[tableIndex].columns.push(createEmptyFieldDraft());
        } else if (action === 'remove-field') {
            const table = draft.tables[tableIndex];
            if (table.columns.length > 1) table.columns.splice(fieldIndex, 1);
        } else if (action === 'move-field-up') {
            moveArrayItem(draft.tables[tableIndex].columns, fieldIndex, fieldIndex - 1);
        } else if (action === 'move-field-down') {
            moveArrayItem(draft.tables[tableIndex].columns, fieldIndex, fieldIndex + 1);
        }
    }

    async function saveTemplateFromDesigner() {
        if (!uiState.templateDraft) return;
        let normalized;
        try {
            normalized = normalizeTemplate(uiState.templateDraft, uiState.editingTemplateId || undefined);
        } catch (error) {
            showToast(error.message || '模板格式不合法');
            return;
        }
        uiState.templateDraft = deepClone(normalized);
        await persistTemplateNormalized(normalized);
        closeTemplateDesigner();
        showToast('模板已保存');
    }

    async function deleteTemplate(templateId) {
        const ok = confirm('删除后会解除所有角色对该模板的绑定，确定继续吗？');
        if (!ok) return;

        db.memoryTableTemplates = (db.memoryTableTemplates || []).filter(item => item.id !== templateId);
        db.characters.forEach(chat => {
            ensureMemoryTableState(chat);
            chat.memoryTables.boundTemplateIds = chat.memoryTables.boundTemplateIds.filter(id => id !== templateId);
            if (chat.memoryTables.data && chat.memoryTables.data[templateId]) delete chat.memoryTables.data[templateId];
            if (chat.memoryTables.lockedFields && chat.memoryTables.lockedFields[templateId]) delete chat.memoryTables.lockedFields[templateId];
        });
        await saveData();
        renderMemoryTableScreen();
        showToast('模板已删除');
    }

    function exportTemplate(templateId) {
        const template = db.memoryTableTemplates.find(item => item.id === templateId);
        if (!template) return;
        downloadJson(template, `${template.name || 'memory-template'}.json`);
    }

    function cloneTemplateWithFreshIds(template) {
        const working = deepClone(normalizeTemplate(template));
        const idMap = {
            templateId: { [working.id]: createMemoryId('memory_tpl') },
            tableIds: {},
            fieldIds: {}
        };
        const originalTemplateId = working.id;
        working.id = idMap.templateId[originalTemplateId];
        working.tables = (working.tables || []).map(table => {
            const oldTableId = table.id;
            const newTableId = createMemoryId('memory_table');
            idMap.tableIds[oldTableId] = newTableId;
            table.id = newTableId;
            table.columns = (table.columns || []).map(field => {
                const oldFieldId = field.id;
                const newFieldId = createMemoryId('memory_field');
                idMap.fieldIds[`${oldTableId}::${oldFieldId}`] = newFieldId;
                field.id = newFieldId;
                return field;
            });
            return table;
        });
        return { template: working, idMap, originalTemplateId };
    }

    function remapTableDataForImport(template, idMap, binding = {}) {
        const oldTemplateId = Object.keys(idMap.templateId)[0];
        const sourceData = binding.data?.[oldTemplateId] || {};
        const sourceLocks = binding.lockedFields?.[oldTemplateId] || {};
        const nextData = {};
        const nextLocks = {};

        (template.tables || []).forEach(table => {
            const oldTableId = Object.keys(idMap.tableIds).find(key => idMap.tableIds[key] === table.id);
            const oldTableData = sourceData?.[oldTableId];
            const oldLocked = sourceLocks?.[oldTableId] || [];

            if (isRowsTable(table)) {
                const rows = Array.isArray(oldTableData?.__rows) ? oldTableData.__rows : [];
                nextData[table.id] = {
                    __rows: rows.map(oldRow => {
                        const row = { id: createMemoryId('memory_row'), cells: {}, meta: deepClone(oldRow?.meta || {}) };
                        (table.columns || []).forEach(field => {
                            const sourceFieldId = Object.keys(idMap.fieldIds).find(key => idMap.fieldIds[key] === field.id)?.split('::')[1];
                            const raw = oldRow?.cells?.[sourceFieldId] !== undefined ? oldRow.cells[sourceFieldId] : oldRow?.[sourceFieldId];
                            row.cells[field.id] = raw === undefined ? getFieldDefaultValue(field) : normalizeFieldValue(field, raw);
                        });
                        return row;
                    })
                };
            } else {
                nextData[table.id] = {};
                (table.columns || []).forEach(field => {
                    const sourceFieldId = Object.keys(idMap.fieldIds).find(key => idMap.fieldIds[key] === field.id)?.split('::')[1];
                    const raw = oldTableData?.[sourceFieldId];
                    nextData[table.id][field.id] = raw === undefined ? getFieldDefaultValue(field) : normalizeFieldValue(field, raw);
                });
            }

            nextLocks[table.id] = oldLocked.map(fieldId => {
                const mappedKey = `${oldTableId}::${fieldId}`;
                return idMap.fieldIds[mappedKey];
            }).filter(Boolean);
        });

        return {
            data: nextData,
            lockedFields: nextLocks
        };
    }

    function buildMemoryPackagePayload(templateIds) {
        const chat = getCurrentMemoryTableChat();
        if (!chat) return null;
        ensureMemoryTableState(chat);
        const boundTemplates = getBoundTemplates(chat).filter(template => templateIds.includes(template.id));
        if (boundTemplates.length === 0) return null;
        const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
        const binding = {
            memoryMode: chat.memoryMode,
            autoUpdateEnabled: !!chat.memoryTables.autoUpdateEnabled,
            autoUpdateInterval: chat.memoryTables.autoUpdateInterval || 140,
            engineSettings: deepClone(runtime?.engineSettings || {}),
            viewMode: runtime?.viewMode || 'normal',
            tableStates: {},
            data: {},
            lockedFields: {}
        };

        boundTemplates.forEach(template => {
            ensureTemplateDataForChat(chat, template);
            binding.data[template.id] = deepClone(chat.memoryTables.data?.[template.id] || {});
            binding.lockedFields[template.id] = deepClone(chat.memoryTables.lockedFields?.[template.id] || {});
            binding.tableStates[template.id] = deepClone(runtime?.tableStates?.[template.id] || {});
        });

        return {
            type: 'memory_table_package',
            version: 2,
            templates: deepClone(boundTemplates),
            binding
        };
    }

    function exportTemplatePackage(templateId) {
        const template = db.memoryTableTemplates.find(item => item.id === templateId);
        if (!template) return;
        const payload = buildMemoryPackagePayload([templateId]) || {
            type: 'memory_table_package',
            version: 2,
            templates: [deepClone(template)],
            binding: null
        };
        downloadJson(payload, `${template.name || 'memory-package'}_package.json`);
    }

    function exportCurrentMemoryPackage() {
        const chat = getCurrentMemoryTableChat();
        if (!chat) {
            showToast('请先进入一个角色聊天');
            return;
        }
        const boundTemplates = getBoundTemplates(chat);
        if (boundTemplates.length === 0) {
            showToast('当前没有可导出的结构记忆模板');
            return;
        }
        const payload = buildMemoryPackagePayload(boundTemplates.map(item => item.id));
        downloadJson(payload, `${chat.remarkName || chat.realName || 'memory'}_memory_package.json`);
    }

    function exportAllTemplates() {
        downloadJson(db.memoryTableTemplates || [], 'memory-table-templates.json');
    }

    function downloadJson(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    async function importTemplatesFromFile(file) {
        if (!file) return;
        const text = await file.text();
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            showToast('导入失败：JSON 无法解析');
            return;
        }

        ensureMemoryTemplateStore();
        const isPackage = parsed && typeof parsed === 'object' && parsed.type === 'memory_table_package';
        const list = isPackage
            ? (Array.isArray(parsed.templates) ? parsed.templates : [])
            : (Array.isArray(parsed) ? parsed : [parsed]);
        const importedTemplates = [];
        const importedMappings = [];

        list.forEach(item => {
            const cloned = cloneTemplateWithFreshIds(item);
            importedTemplates.push(cloned.template);
            importedMappings.push(cloned);
            db.memoryTableTemplates.unshift(cloned.template);
        });

        const chat = getCurrentMemoryTableChat();
        if (isPackage && parsed.binding && chat && importedMappings.length > 0) {
            const shouldApply = window.confirm('检测到记忆包。是否把模板和已填好的表格数据一起导入到当前角色？');
            if (shouldApply) {
                ensureMemoryTableState(chat);
                const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
                importedMappings.forEach(({ template, idMap, originalTemplateId }) => {
                    if (!chat.memoryTables.boundTemplateIds.includes(template.id)) {
                        chat.memoryTables.boundTemplateIds.push(template.id);
                    }
                    const remapped = remapTableDataForImport(template, idMap, parsed.binding);
                    chat.memoryTables.data[template.id] = remapped.data;
                    chat.memoryTables.lockedFields[template.id] = remapped.lockedFields;
                    if (runtime) {
                        runtime.tableStates[template.id] = {};
                        const sourceStates = parsed.binding.tableStates?.[originalTemplateId] || {};
                        Object.entries(idMap.tableIds || {}).forEach(([oldTableId, newTableId]) => {
                            if (sourceStates[oldTableId]) runtime.tableStates[template.id][newTableId] = deepClone(sourceStates[oldTableId]);
                            else MemoryPolicy.ensureTableState(chat, template.id, newTableId);
                        });
                    }
                });
                if (parsed.binding.memoryMode) {
                    chat.memoryMode = parsed.binding.memoryMode;
                }
                chat.memoryTables.autoUpdateEnabled = parsed.binding.autoUpdateEnabled !== false;
                chat.memoryTables.autoUpdateInterval = Math.max(10, parseInt(parsed.binding.autoUpdateInterval, 10) || 140);
                if (MemoryPolicy) {
                    const runtime = MemoryPolicy.ensureRuntimeState(chat);
                    runtime.engineSettings = MemoryPolicy.normalizeEngineSettings(parsed.binding.engineSettings || {
                        messageInterval: chat.memoryTables.autoUpdateInterval
                    });
                    runtime.viewMode = parsed.binding.viewMode === 'json' && MemoryPolicy.isDesktopJsonAvailable() ? 'json' : 'normal';
                }
                await saveCharacter(chat.id);
            }
        }

        await saveData();
        renderMemoryTableScreen();
        showToast(isPackage ? `已导入 ${importedTemplates.length} 个模板/记忆包` : `已导入 ${importedTemplates.length} 个模板`);
    }

    async function handleFieldInputChange(target) {
        const chat = getCurrentMemoryTableChat();
        if (!chat) return;
        const templateId = target.dataset.templateId;
        const tableId = target.dataset.tableId;
        const fieldId = target.dataset.fieldId;
        const template = db.memoryTableTemplates.find(item => item.id === templateId);
        const table = template ? (template.tables || []).find(item => item.id === tableId) : null;
        const field = table ? (table.columns || []).find(item => item.id === fieldId) : null;
        if (!field) return;

        const rawValue = target.type === 'checkbox' ? target.checked : target.value;
        const rowId = target.dataset.rowId || '';
        if (rowId && isRowsTable(table)) {
            updateRowFieldValue(chat, templateId, table, rowId, field, rawValue, { source: 'manual' });
        } else {
            setFieldValue(chat, templateId, tableId, field, rawValue, { source: 'manual' });
        }
        await saveCharacter(chat.id);
        renderMemoryTableScreen();
    }

    function setupMemoryTableScreen() {
        ensureMemoryTemplateStore();

        const searchInput = document.getElementById('memory-table-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                uiState.search = searchInput.value || '';
                renderMemoryTableScreen();
            });
        }

        const sortSelect = document.getElementById('memory-table-sort-select');
        if (sortSelect) {
            sortSelect.addEventListener('change', () => {
                uiState.sort = sortSelect.value || 'default';
                renderMemoryTableScreen();
            });
        }

        const tabButtons = document.querySelectorAll('.memory-table-tab-btn');
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                uiState.tab = button.dataset.tab || 'tables';
                renderMemoryTableScreen();
            });
        });

        const updateBtn = document.getElementById('memory-table-update-btn');
        if (updateBtn) {
            updateBtn.addEventListener('click', async () => {
                const chat = getCurrentMemoryTableChat();
                if (!chat) return;
                const { active } = getActiveTableDescriptor(chat);
                if (!active) {
                    showToast('请先绑定并选择一张表格');
                    return;
                }
                await updateSelectedMemoryTable(chat, active.template.id, active.table.id);
            });
        }

        const normalModeBtn = document.getElementById('memory-table-normal-mode-btn');
        const jsonModeBtn = document.getElementById('memory-table-json-mode-btn');
        const setViewMode = async mode => {
            const chat = getCurrentMemoryTableChat();
            if (!chat) return;
            if (mode === 'json' && MemoryPolicy && !MemoryPolicy.isDesktopJsonAvailable()) {
                showToast('JSON 模式仅电脑端开放');
                return;
            }
            uiState.viewMode = mode === 'json' ? 'json' : 'normal';
            const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
            if (runtime) runtime.viewMode = uiState.viewMode;
            await saveCharacter(chat.id);
            renderMemoryTableScreen();
        };
        if (normalModeBtn) normalModeBtn.addEventListener('click', () => setViewMode('normal'));
        if (jsonModeBtn) jsonModeBtn.addEventListener('click', () => setViewMode('json'));

        const persistEngineControls = async () => {
            const chat = getCurrentMemoryTableChat();
            if (!chat) return null;
            ensureMemoryTableState(chat);
            const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
            const triggerSelect = document.getElementById('memory-table-trigger-mode');
            const roundInput = document.getElementById('memory-table-round-interval');
            const messageInput = document.getElementById('memory-table-auto-update-interval');
            const maxSourceInput = document.getElementById('memory-table-max-source-messages');
            const messageInterval = Math.max(10, parseInt(messageInput?.value, 10) || 140);
            chat.memoryTables.autoUpdateInterval = messageInterval;
            if (runtime) {
                runtime.engineSettings = MemoryPolicy.normalizeEngineSettings({
                    ...runtime.engineSettings,
                    triggerMode: triggerSelect?.value || runtime.engineSettings.triggerMode,
                    roundInterval: Math.max(1, parseInt(roundInput?.value, 10) || 2),
                    messageInterval,
                    maxSourceMessages: Math.max(10, parseInt(maxSourceInput?.value, 10) || 180)
                });
            }
            await saveCharacter(chat.id);
            refreshMemoryTableAutoUpdateControls(chat, getBoundTemplates(chat).length > 0);
            return chat;
        };

        const autoUpdateToggle = document.getElementById('memory-table-auto-update-toggle');
        if (autoUpdateToggle) {
            autoUpdateToggle.addEventListener('change', async () => {
                const chat = await persistEngineControls();
                if (!chat) return;
                await applyMemoryTableAutoUpdateToggle(chat, autoUpdateToggle.checked);
                renderMemoryTableScreen();
            });
        }

        ['memory-table-trigger-mode', 'memory-table-round-interval', 'memory-table-auto-update-interval', 'memory-table-max-source-messages'].forEach(id => {
            const control = document.getElementById(id);
            if (!control) return;
            control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'blur', persistEngineControls);
        });

        const cursorSelect = document.getElementById('memory-table-cursor-table-select');
        const cursorInput = document.getElementById('memory-table-cursor-position');
        const parseCursorKey = () => {
            const raw = cursorSelect?.value || '';
            const splitAt = raw.indexOf('::');
            return splitAt > 0 ? [raw.slice(0, splitAt), raw.slice(splitAt + 2)] : ['', ''];
        };
        const syncCursorInput = () => {
            const chat = getCurrentMemoryTableChat();
            if (!chat || !MemoryPolicy || !cursorInput) return;
            const [templateId, tableId] = parseCursorKey();
            if (!templateId || !tableId) return;
            const info = MemoryPolicy.getUnprocessedInfo(chat, templateId, tableId);
            cursorInput.max = String(info.history.length);
            cursorInput.value = String(Math.max(0, info.cursorIndex + 1));
        };
        if (cursorSelect) cursorSelect.addEventListener('change', syncCursorInput);

        const saveCursorAt = async position => {
            const chat = getCurrentMemoryTableChat();
            if (!chat || !MemoryPolicy) return;
            const [templateId, tableId] = parseCursorKey();
            if (!templateId || !tableId) return;
            MemoryPolicy.setTableCursorByPosition(chat, templateId, tableId, position);
            await saveCharacter(chat.id);
            refreshMemoryTableAutoUpdateControls(chat, true);
            showToast(`游标已保存到第 ${Math.max(0, Number(position) || 0)} 条消息`);
        };
        const saveCursorBtn = document.getElementById('memory-table-save-cursor-btn');
        if (saveCursorBtn) saveCursorBtn.addEventListener('click', () => saveCursorAt(cursorInput?.value || 0));
        const cursorLatestBtn = document.getElementById('memory-table-cursor-latest-btn');
        if (cursorLatestBtn) cursorLatestBtn.addEventListener('click', () => {
            const chat = getCurrentMemoryTableChat();
            saveCursorAt(Array.isArray(chat?.history) ? chat.history.length : 0);
        });
        const cursorStartBtn = document.getElementById('memory-table-cursor-start-btn');
        if (cursorStartBtn) cursorStartBtn.addEventListener('click', () => saveCursorAt(0));
        const updateSelectedBtn = document.getElementById('memory-table-update-selected-btn');
        if (updateSelectedBtn) {
            updateSelectedBtn.addEventListener('click', async () => {
                const chat = getCurrentMemoryTableChat();
                if (!chat) return;
                const [templateId, tableId] = parseCursorKey();
                await updateSelectedMemoryTable(chat, templateId, tableId);
            });
        }

        const updateLatestBtn = document.getElementById('memory-table-update-latest-btn');
        if (updateLatestBtn) {
            updateLatestBtn.addEventListener('click', async () => {
                const chat = getCurrentMemoryTableChat();
                if (!chat) return;
                await updateMemoryTableToLatest(chat);
            });
        }

        const retryBtn = document.getElementById('memory-table-retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', async () => {
                const chat = getCurrentMemoryTableChat();
                if (!chat) return;
                await retryMemoryTableAutoUpdate(chat);
            });
        }

        const createTemplateBtn = document.getElementById('memory-table-create-template-btn');
        if (createTemplateBtn) createTemplateBtn.addEventListener('click', () => openTemplateDesigner(null));

        const importBtn = document.getElementById('memory-table-import-btn');
        const importInput = document.getElementById('memory-table-import-input');
        if (importBtn && importInput) {
            importBtn.addEventListener('click', () => importInput.click());
            importInput.addEventListener('change', async () => {
                await importTemplatesFromFile(importInput.files[0]);
                importInput.value = '';
            });
        }

        const exportAllBtn = document.getElementById('memory-table-export-all-btn');
        if (exportAllBtn) exportAllBtn.addEventListener('click', exportAllTemplates);

        const exportPackageBtn = document.getElementById('memory-table-export-package-btn');
        if (exportPackageBtn) exportPackageBtn.addEventListener('click', exportCurrentMemoryPackage);

        const fromJournalBtn = document.getElementById('memory-table-from-journal-btn');
        if (fromJournalBtn) fromJournalBtn.addEventListener('click', convertJournalsToTables);

        const toJournalBtn = document.getElementById('memory-table-to-journal-btn');
        if (toJournalBtn) toJournalBtn.addEventListener('click', convertTablesToJournal);

        const modeButtons = document.querySelectorAll('[data-memory-mode-switch]');
        modeButtons.forEach(button => {
            button.addEventListener('click', async () => {
                const chat = getCurrentMemoryTableChat();
                if (!chat) return;
                const nextMode = button.dataset.memoryModeSwitch;
                chat.memoryMode = nextMode === 'table' ? 'table' : (nextMode === 'vector' ? 'vector' : 'journal');
                await saveCharacter(chat.id);
                renderMemoryTableScreen();
                showToast(chat.memoryMode === 'table'
                    ? '已切换为结构化档案模式'
                    : (chat.memoryMode === 'vector' ? '已切换为向量记忆模式' : '已切换为日记模式'));
            });
        });

        const screen = document.getElementById('memory-table-screen');
        if (screen) {
            screen.addEventListener('click', async (event) => {
                const actionEl = event.target.closest('[data-action]');
                if (!actionEl) return;
                const action = actionEl.dataset.action;
                if (action === 'select-memory-table') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    uiState.activeTableId = actionEl.dataset.tableId || null;
                    const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
                    if (runtime) runtime.activeTableId = uiState.activeTableId;
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                } else if (action === 'toggle-lock') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    toggleFieldLock(chat, actionEl.dataset.templateId, actionEl.dataset.tableId, actionEl.dataset.fieldId);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                } else if (action === 'edit-template-visual') {
                    const template = db.memoryTableTemplates.find(item => item.id === actionEl.dataset.templateId);
                    if (template) openTemplateDesigner(template);
                } else if (action === 'edit-template-json') {
                    const template = db.memoryTableTemplates.find(item => item.id === actionEl.dataset.templateId);
                    if (template) openTemplateEditor(template);
                } else if (action === 'delete-template') {
                    await deleteTemplate(actionEl.dataset.templateId);
                } else if (action === 'export-template') {
                    exportTemplate(actionEl.dataset.templateId);
                } else if (action === 'export-template-package') {
                    exportTemplatePackage(actionEl.dataset.templateId);
                } else if (action === 'restore-history') {
                    await restoreHistoryEntry(actionEl.dataset.historyId);
                } else if (action === 'add-row') {
                    const chat = getCurrentMemoryTableChat();
                    const template = db.memoryTableTemplates.find(item => item.id === actionEl.dataset.templateId);
                    const table = template ? (template.tables || []).find(item => item.id === actionEl.dataset.tableId) : null;
                    if (!chat || !table) return;
                    addRow(chat, template.id, table, {}, { source: 'manual' });
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                } else if (action === 'delete-row') {
                    const chat = getCurrentMemoryTableChat();
                    const template = db.memoryTableTemplates.find(item => item.id === actionEl.dataset.templateId);
                    const table = template ? (template.tables || []).find(item => item.id === actionEl.dataset.tableId) : null;
                    if (!chat || !table) return;
                    if (!window.confirm('确定删除这一行吗？')) return;
                    deleteRow(chat, template.id, table, actionEl.dataset.rowId, { source: 'manual' });
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                } else if (action === 'move-row-up' || action === 'move-row-down') {
                    const chat = getCurrentMemoryTableChat();
                    const template = db.memoryTableTemplates.find(item => item.id === actionEl.dataset.templateId);
                    const table = template ? (template.tables || []).find(item => item.id === actionEl.dataset.tableId) : null;
                    if (!chat || !table) return;
                    moveRow(chat, template.id, table, actionEl.dataset.rowId, action === 'move-row-up' ? -1 : 1);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                }
            });

            screen.addEventListener('change', async (event) => {
                const target = event.target;
                if (target.classList.contains('memory-template-bind-toggle')) {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    await bindTemplateToChat(chat, target.dataset.templateId, target.checked);
                }
                if (target.classList.contains('memory-table-input')) {
                    await handleFieldInputChange(target);
                }
            });
        }

        const openFromSettingsBtn = document.getElementById('setting-open-memory-table-btn');
        if (openFromSettingsBtn) {
            openFromSettingsBtn.addEventListener('click', () => {
                renderMemoryTableScreen();
                switchScreen('memory-table-screen');
            });
        }

        const closeModalBtn = document.getElementById('memory-template-editor-cancel-btn');
        if (closeModalBtn) closeModalBtn.addEventListener('click', closeTemplateEditor);

        const saveModalBtn = document.getElementById('memory-template-editor-save-btn');
        if (saveModalBtn) saveModalBtn.addEventListener('click', saveTemplateFromEditor);

        const starterBtn = document.getElementById('memory-template-editor-starter-btn');
        if (starterBtn) {
            starterBtn.addEventListener('click', () => {
                const textarea = document.getElementById('memory-template-json');
                if (!textarea) return;
                textarea.value = JSON.stringify(createStarterTemplate(), null, 2);
            });
        }

        const editorModal = document.getElementById('memory-template-editor-modal');
        if (editorModal) {
            editorModal.addEventListener('click', event => {
                if (event.target === editorModal) closeTemplateEditor();
            });
        }

        const designerModal = document.getElementById('memory-template-designer-modal');
        if (designerModal) {
            designerModal.addEventListener('click', async event => {
                if (event.target === designerModal) {
                    closeTemplateDesigner();
                    return;
                }
                const actionEl = event.target.closest('[data-action]');
                if (!actionEl) return;
                const action = actionEl.dataset.action;
                const tableIndex = actionEl.dataset.tableIndex !== undefined ? Number(actionEl.dataset.tableIndex) : undefined;
                const fieldIndex = actionEl.dataset.fieldIndex !== undefined ? Number(actionEl.dataset.fieldIndex) : undefined;
                if (action === 'designer-add-table') {
                    mutateDesignerDraft('add-table');
                    renderTemplateDesigner();
                } else if (action === 'designer-remove-table') {
                    mutateDesignerDraft('remove-table', tableIndex);
                    renderTemplateDesigner();
                } else if (action === 'designer-move-table-up') {
                    mutateDesignerDraft('move-table-up', tableIndex);
                    renderTemplateDesigner();
                } else if (action === 'designer-move-table-down') {
                    mutateDesignerDraft('move-table-down', tableIndex);
                    renderTemplateDesigner();
                } else if (action === 'designer-add-field') {
                    mutateDesignerDraft('add-field', tableIndex);
                    renderTemplateDesigner();
                } else if (action === 'designer-remove-field') {
                    mutateDesignerDraft('remove-field', tableIndex, fieldIndex);
                    renderTemplateDesigner();
                } else if (action === 'designer-move-field-up') {
                    mutateDesignerDraft('move-field-up', tableIndex, fieldIndex);
                    renderTemplateDesigner();
                } else if (action === 'designer-move-field-down') {
                    mutateDesignerDraft('move-field-down', tableIndex, fieldIndex);
                    renderTemplateDesigner();
                } else if (action === 'designer-toggle-field-collapse') {
                    const fieldId = actionEl.dataset.fieldId;
                    uiState.designerCollapsedFieldIds[fieldId] = !uiState.designerCollapsedFieldIds[fieldId];
                    renderTemplateDesigner();
                } else if (action === 'designer-open-json') {
                    openTemplateEditor();
                } else if (action === 'designer-save') {
                    await saveTemplateFromDesigner();
                } else if (action === 'designer-cancel') {
                    closeTemplateDesigner();
                }
            });
            designerModal.addEventListener('dragstart', event => {
                const dragEl = event.target.closest('[data-designer-draggable]');
                if (!dragEl) return;
                uiState.designerDrag = {
                    type: dragEl.dataset.designerDraggable,
                    tableIndex: dragEl.dataset.tableIndex !== undefined ? Number(dragEl.dataset.tableIndex) : undefined,
                    fieldIndex: dragEl.dataset.fieldIndex !== undefined ? Number(dragEl.dataset.fieldIndex) : undefined
                };
                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = 'move';
                }
            });
            designerModal.addEventListener('dragover', event => {
                const dragEl = event.target.closest('[data-designer-draggable]');
                if (!dragEl || !uiState.designerDrag) return;
                event.preventDefault();
            });
            designerModal.addEventListener('drop', event => {
                const dragEl = event.target.closest('[data-designer-draggable]');
                if (!dragEl || !uiState.designerDrag || !uiState.templateDraft) return;
                event.preventDefault();
                const drag = uiState.designerDrag;
                if (drag.type === 'table' && dragEl.dataset.designerDraggable === 'table') {
                    moveArrayItem(uiState.templateDraft.tables, drag.tableIndex, Number(dragEl.dataset.tableIndex));
                    renderTemplateDesigner();
                } else if (
                    drag.type === 'field' &&
                    dragEl.dataset.designerDraggable === 'field' &&
                    Number(dragEl.dataset.tableIndex) === drag.tableIndex
                ) {
                    moveArrayItem(
                        uiState.templateDraft.tables[drag.tableIndex].columns,
                        drag.fieldIndex,
                        Number(dragEl.dataset.fieldIndex)
                    );
                    renderTemplateDesigner();
                }
                uiState.designerDrag = null;
            });
            designerModal.addEventListener('dragend', () => {
                uiState.designerDrag = null;
            });
            designerModal.addEventListener('input', event => {
                const target = event.target;
                if (target.dataset && target.dataset.designerRole) {
                    updateDesignerDraftFromInput(target);
                }
            });
            designerModal.addEventListener('change', event => {
                const target = event.target;
                if (target.dataset && target.dataset.designerRole) {
                    updateDesignerDraftFromInput(target);
                }
            });
        }

        const conversionModal = document.getElementById('memory-conversion-modal');
        if (conversionModal) {
            conversionModal.addEventListener('click', async event => {
                if (event.target === conversionModal) {
                    closeConversionModal();
                    return;
                }
                const actionEl = event.target.closest('[data-conversion-action]');
                if (!actionEl) return;
                const state = uiState.conversionState;
                const chat = getCurrentMemoryTableChat();
                if (!state || !chat) return;
                const journals = getJournalCandidates(chat);
                const templates = getBoundTemplates(chat);
                const action = actionEl.dataset.conversionAction;
                if (action === 'select-favorited') {
                    state.selectedJournalIds = journals.filter(item => item.isFavorited).map(item => item.id);
                } else if (action === 'select-all-journals') {
                    state.selectedJournalIds = journals.map(item => item.id);
                } else if (action === 'clear-journals') {
                    state.selectedJournalIds = [];
                } else if (action === 'select-all-templates') {
                    state.selectedTemplateIds = templates.map(item => item.id);
                } else if (action === 'clear-templates') {
                    state.selectedTemplateIds = [];
                } else if (action === 'cancel-conversion') {
                    closeConversionModal();
                    return;
                } else if (action === 'confirm-conversion') {
                    await executeConversionFromModal();
                    return;
                }
                renderConversionModal();
            });
            conversionModal.addEventListener('change', event => {
                const target = event.target;
                const state = uiState.conversionState;
                if (!state) return;
                const role = target.dataset.conversionRole;
                if (!role) return;
                const value = target.type === 'checkbox' ? target.checked : target.value;
                if (role === 'journal-toggle') {
                    const id = target.value;
                    if (value) {
                        if (!state.selectedJournalIds.includes(id)) state.selectedJournalIds.push(id);
                    } else {
                        state.selectedJournalIds = state.selectedJournalIds.filter(item => item !== id);
                    }
                } else if (role === 'template-toggle') {
                    const id = target.value;
                    if (value) {
                        if (!state.selectedTemplateIds.includes(id)) state.selectedTemplateIds.push(id);
                    } else {
                        state.selectedTemplateIds = state.selectedTemplateIds.filter(item => item !== id);
                    }
                } else if (role === 'strategy') {
                    state.strategy = value;
                } else if (role === 'journal-style') {
                    state.journalStyle = value;
                } else if (role === 'auto-favorite') {
                    state.autoFavorite = value;
                } else if (role === 'title-prefix') {
                    state.titlePrefix = value;
                }
                renderConversionModal();
            });
            conversionModal.addEventListener('input', event => {
                const target = event.target;
                const state = uiState.conversionState;
                if (!state) return;
                const role = target.dataset.conversionRole;
                if (role === 'title-prefix') {
                    state.titlePrefix = target.value;
                }
            });
        }
    }

    function exportMemoryTableContext(chat, options = {}) {
        if (!chat) return '';
        ensureMemoryTableState(chat);
        return getMemoryContextBlock(chat, { force: true, templateIds: options.templateIds });
    }

    function getBoundMemoryTableTemplateIds(chat) {
        if (!chat) return [];
        ensureMemoryTableState(chat);
        return getBoundTemplates(chat).map(item => item.id);
    }

    async function convertTextToMemoryTable(chat, text, options = {}) {
        if (!chat) throw new Error('请先进入一个角色聊天');
        ensureMemoryTableState(chat);
        const targetTemplateIds = Array.isArray(options.targetTemplateIds) && options.targetTemplateIds.length > 0
            ? options.targetTemplateIds
            : getBoundTemplates(chat).map(item => item.id);
        const templates = getBoundTemplates(chat).filter(item => targetTemplateIds.includes(item.id));
        if (templates.length === 0) {
            throw new Error('请先绑定至少一个结构记忆模板');
        }
        templates.forEach(template => ensureTemplateDataForChat(chat, template));
        const templateText = buildTemplateDefinitionForPrompt(chat, templates);
        const prompt = `请把下面这些“已确认长期记忆”的内容，抽取进结构化记忆表。只更新发生变化的字段，只能依据给定内容，不要编造。

输出格式必须严格是：
<memory_updates>
  <memory_update templateId="模板ID" tableId="表格ID">
    <field fieldId="字段ID">新值</field>
    <row op="add">
      <field fieldId="字段ID">值</field>
    </row>
    <row op="update" rowId="现有行ID">
      <field fieldId="字段ID">新值</field>
    </row>
    <row op="delete" rowId="现有行ID"></row>
  </memory_update>
</memory_updates>

如果没有变化，输出 <memory_updates></memory_updates>。
rows 表请使用 row 节点，不要把 rows 表伪装成普通 field。

角色信息：
- 角色名：${chat.realName || ''}
- 用户称呼：${chat.myName || ''}

模板定义：
${templateText}

长期记忆内容：
${text}`;
        const rawContent = await requestSummaryContent(prompt, 0.2);
        const changedFields = applyMemoryUpdatesFromXml(chat, rawContent, {
            source: options.source || 'api',
            targetTemplateIds
        });
        await saveCharacter(chat.id);
        renderMemoryTableScreen();
        return changedFields.length;
    }

    window.ensureMemoryTableState = ensureMemoryTableState;
    window.setupMemoryTableScreen = setupMemoryTableScreen;
    window.renderMemoryTableScreen = renderMemoryTableScreen;
    window.getMemoryTableContextBlock = getMemoryContextBlock;
    window.prepareMemoryTableContext = prepareMemoryTableContext;
    window.exportMemoryTableContext = exportMemoryTableContext;
    window.getBoundMemoryTableTemplateIds = getBoundMemoryTableTemplateIds;
    window.convertTextToMemoryTable = convertTextToMemoryTable;
    window.checkAndTriggerAutoTableUpdate = checkAndTriggerAutoTableUpdate;
})();
