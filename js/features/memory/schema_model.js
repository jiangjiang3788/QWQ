(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Domain = Kernel.require('domain');
    const Policy = Kernel.get('policy');

    const clone = Core.clone;
    const moveArrayItem = Core.moveArrayItem;

    function prepare(template) {
        const draft = template ? clone(template) : Domain.createStarterTemplate();
        draft.tables = Array.isArray(draft.tables) && draft.tables.length ? draft.tables : [Domain.createEmptyTableDraft()];
        draft.tables.forEach(table => {
            table.columns = Array.isArray(table.columns) && table.columns.length ? table.columns : [Domain.createEmptyFieldDraft()];
            const layer = Policy ? Policy.normalizeLayer(table.memoryLayer, table.name) : (table.memoryLayer || 'short');
            table.memoryLayer = layer;
            table.updatePolicy = Policy ? Policy.normalizeUpdatePolicy(table.updatePolicy || {}, layer) : (table.updatePolicy || {});
            table.injectionPolicy = Policy ? Policy.normalizeInjectionPolicy(table.injectionPolicy || {}, layer) : (table.injectionPolicy || {});
        });
        return draft;
    }

    function normalize(draft, fallbackId) {
        return Domain.normalizeTemplate(draft, fallbackId);
    }

    function summarize(draft) {
        const tables = Array.isArray(draft?.tables) ? draft.tables : [];
        const fieldCount = tables.reduce((sum, table) => sum + (Array.isArray(table.columns) ? table.columns.length : 0), 0);
        const groups = new Set();
        tables.forEach(table => (table.columns || []).forEach(field => groups.add(`${table.id || table.name}::${String(field.group || '未分组').trim() || '未分组'}`)));
        return { tableCount: tables.length, fieldCount, groupCount: groups.size };
    }

    function fieldGroups(table) {
        const result = [];
        const map = new Map();
        (table?.columns || []).forEach((field, index) => {
            const name = String(field.group || '').trim() || '未分组';
            if (!map.has(name)) {
                const item = { name, ungrouped: name === '未分组', fields: [] };
                map.set(name, item);
                result.push(item);
            }
            map.get(name).fields.push({ field, index });
        });
        return result;
    }

    function getPath(root, path) {
        const parts = String(path || '').split('.').filter(Boolean).map(part => /^\d+$/.test(part) ? Number(part) : part);
        return parts.reduce((value, key) => value == null ? undefined : value[key], root);
    }

    function setPath(root, path, value) {
        const parts = String(path || '').split('.').filter(Boolean).map(part => /^\d+$/.test(part) ? Number(part) : part);
        if (!parts.length) return false;
        let target = root;
        for (let index = 0; index < parts.length - 1; index++) {
            const key = parts[index];
            if (target[key] == null || typeof target[key] !== 'object') target[key] = typeof parts[index + 1] === 'number' ? [] : {};
            target = target[key];
        }
        target[parts[parts.length - 1]] = value;
        return true;
    }

    function parseValue(raw, type) {
        if (type === 'boolean') return raw === true || raw === 'true';
        if (type === 'number') return raw === '' || raw == null ? undefined : Number(raw);
        if (type === 'array') return Domain.parseOptionText(raw);
        if (type === 'json') {
            if (typeof raw !== 'string') return raw;
            return raw.trim() ? JSON.parse(raw) : [];
        }
        return raw == null ? '' : String(raw);
    }

    function updatePath(draft, path, raw, type) {
        return setPath(draft, path, parseValue(raw, type));
    }

    function makeRow(section, label, path, type, value, options = {}) {
        return { section, label, path, type, value, readOnly: !!options.readOnly, choices: options.choices || null, multiline: !!options.multiline };
    }

    function scalarRows(draft) {
        const rows = [
            makeRow('模板', '模板 ID', 'id', 'text', draft.id || '', { readOnly: true }),
            makeRow('模板', '模板名称', 'name', 'text', draft.name || ''),
            makeRow('模板', '模板描述', 'description', 'text', draft.description || '', { multiline: true })
        ];
        (draft.tables || []).forEach((table, tableIndex) => {
            const base = `tables.${tableIndex}`;
            const section = `表格 ${tableIndex + 1} · ${table.name || '未命名'}`;
            const update = table.updatePolicy || {};
            const inject = table.injectionPolicy || {};
            rows.push(
                makeRow(section, '表格 ID', `${base}.id`, 'text', table.id || '', { readOnly: true }),
                makeRow(section, '表格名称', `${base}.name`, 'text', table.name || ''),
                makeRow(section, '模式', `${base}.mode`, 'text', table.mode || 'keyValue', { choices: ['keyValue', 'rows'] }),
                makeRow(section, '记忆层级', `${base}.memoryLayer`, 'text', table.memoryLayer || 'short', { choices: ['core', 'short', 'medium', 'long', 'review'] }),
                makeRow(section, '提取规则', `${base}.extractPrompt`, 'text', table.extractPrompt || '', { multiline: true }),
                makeRow(section, '自动更新', `${base}.updatePolicy.enabled`, 'boolean', update.enabled !== false),
                makeRow(section, '触发方式', `${base}.updatePolicy.triggerMode`, 'text', update.triggerMode || 'manual', { choices: ['rounds', 'messages', 'either', 'manual'] }),
                makeRow(section, '轮次间隔', `${base}.updatePolicy.roundInterval`, 'number', update.roundInterval ?? 0),
                makeRow(section, '消息间隔', `${base}.updatePolicy.messageInterval`, 'number', update.messageInterval ?? 0),
                makeRow(section, '读取上限', `${base}.updatePolicy.maxSourceMessages`, 'number', update.maxSourceMessages ?? 180),
                makeRow(section, '允许删除', `${base}.updatePolicy.allowDelete`, 'boolean', update.allowDelete === true),
                makeRow(section, '使用总结 API', `${base}.updatePolicy.useSummaryApi`, 'boolean', update.useSummaryApi !== false),
                makeRow(section, '更新附加规则', `${base}.updatePolicy.instructions`, 'text', update.instructions || '', { multiline: true }),
                makeRow(section, '注入模式', `${base}.injectionPolicy.mode`, 'text', inject.mode || 'never', { choices: ['always', 'active', 'relevant', 'never'] }),
                makeRow(section, 'Top-K', `${base}.injectionPolicy.topK`, 'number', inject.topK ?? 0),
                makeRow(section, '字符预算', `${base}.injectionPolicy.budget`, 'number', inject.budget ?? 0),
                makeRow(section, '有效期（天）', `${base}.injectionPolicy.maxAgeDays`, 'number', inject.maxAgeDays ?? 0)
            );
            (table.columns || []).forEach((field, fieldIndex) => {
                const fieldBase = `${base}.columns.${fieldIndex}`;
                const fieldSection = `${section} / 字段 ${fieldIndex + 1} · ${field.key || '未命名'}`;
                rows.push(
                    makeRow(fieldSection, '字段 ID', `${fieldBase}.id`, 'text', field.id || '', { readOnly: true }),
                    makeRow(fieldSection, '字段名', `${fieldBase}.key`, 'text', field.key || ''),
                    makeRow(fieldSection, '字段分组', `${fieldBase}.group`, 'text', field.group || ''),
                    makeRow(fieldSection, '类型', `${fieldBase}.type`, 'text', field.type || 'text', { choices: ['text', 'longtext', 'number', 'enum', 'tags', 'progress', 'date', 'boolean'] }),
                    makeRow(fieldSection, '默认值', `${fieldBase}.default`, Array.isArray(field.default) ? 'array' : (typeof field.default === 'number' ? 'number' : 'text'), Array.isArray(field.default) ? field.default.join(', ') : (field.default ?? '')),
                    makeRow(fieldSection, '选项', `${fieldBase}.options`, 'array', (field.options || []).join(', ')),
                    makeRow(fieldSection, 'AI 可编辑', `${fieldBase}.aiEditable`, 'boolean', field.aiEditable !== false),
                    makeRow(fieldSection, '普通模式显示', `${fieldBase}.important`, 'boolean', field.important !== false),
                    makeRow(fieldSection, '摘要标签', `${fieldBase}.summaryLabel`, 'text', field.summaryLabel || ''),
                    makeRow(fieldSection, '最小值', `${fieldBase}.min`, 'number', field.min ?? ''),
                    makeRow(fieldSection, '最大值', `${fieldBase}.max`, 'number', field.max ?? ''),
                    makeRow(fieldSection, '显示格式', `${fieldBase}.displayFormat`, 'text', field.displayFormat || '{value}'),
                    makeRow(fieldSection, 'AI 提示', `${fieldBase}.aiHint`, 'text', field.aiHint || '', { multiline: true }),
                    makeRow(fieldSection, '条件规则', `${fieldBase}.conditionalRules`, 'json', JSON.stringify(field.conditionalRules || []), { multiline: true })
                );
            });
        });
        return rows;
    }

    function mutate(draft, action, tableIndex, fieldIndex) {
        if (!draft) return false;
        if (action === 'add-table') draft.tables.push(Domain.createEmptyTableDraft());
        else if (action === 'remove-table' && draft.tables.length > 1) draft.tables.splice(tableIndex, 1);
        else if (action === 'move-table-up') moveArrayItem(draft.tables, tableIndex, tableIndex - 1);
        else if (action === 'move-table-down') moveArrayItem(draft.tables, tableIndex, tableIndex + 1);
        else if (action === 'add-field') draft.tables[tableIndex]?.columns.push(Domain.createEmptyFieldDraft());
        else if (action === 'remove-field' && draft.tables[tableIndex]?.columns.length > 1) draft.tables[tableIndex].columns.splice(fieldIndex, 1);
        else if (action === 'move-field-up') moveArrayItem(draft.tables[tableIndex]?.columns || [], fieldIndex, fieldIndex - 1);
        else if (action === 'move-field-down') moveArrayItem(draft.tables[tableIndex]?.columns || [], fieldIndex, fieldIndex + 1);
        else return false;
        return true;
    }

    function applyRawJson(text, fallbackId) {
        const parsed = JSON.parse(String(text || ''));
        return normalize(parsed, fallbackId);
    }

    Kernel.register('schemaModel', Object.freeze({
        VERSION: '2.12-R3',
        prepare,
        normalize,
        summarize,
        fieldGroups,
        getPath,
        setPath,
        parseValue,
        updatePath,
        scalarRows,
        mutate,
        applyRawJson
    }));
})(window);
