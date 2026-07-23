(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Model = Kernel.require('schemaModel');
    const Domain = Kernel.require('domain');
    const FieldWidth = Kernel.require('fieldWidth');
    const Policy = Kernel.get('policy');

    const escapeHtml = Core.escapeHtml;
    const escapeAttribute = Core.escapeAttribute;

    const FIELD_TYPES = [
        ['text', '短文本'],
        ['longtext', '长文本'],
        ['number', '数字'],
        ['enum', '单选'],
        ['tags', '标签'],
        ['progress', '进度'],
        ['date', '日期'],
        ['boolean', '开关']
    ];
    const LAYERS = [['core', '核心'], ['short', '短期'], ['medium', '中期'], ['long', '长期'], ['review', '审核队列']];

    function selected(value, expected) { return String(value) === String(expected) ? 'selected' : ''; }

    const fieldNameVisualUnits = FieldWidth.visualUnits;
    function fieldNameColumnWidth(table) { return FieldWidth.schemaFieldNames(table); }

    function applyFieldNameWidth(root, draft, state) {
        const tableIndex = Math.min(Math.max(0, Number(state?.activeTableIndex) || 0), Math.max(0, (draft?.tables || []).length - 1));
        const table = draft?.tables?.[tableIndex];
        const grid = root?.querySelector?.('.memory-schema-fields-grid');
        if (!table || !grid) return null;
        const width = fieldNameColumnWidth(table);
        grid.style.setProperty('--schema-field-name-width', `${width.desktop}px`);
        grid.style.setProperty('--schema-field-name-width-mobile', `${width.mobile}px`);
        grid.dataset.schemaNameWidthDesktop = String(width.desktop);
        grid.dataset.schemaNameWidthMobile = String(width.mobile);
        grid.dataset.schemaNameMaxUnits = String(width.longestUnits);
        return width;
    }

    function renderInput(role, value, options = {}) {
        const attrs = [
            `data-schema-role="${escapeAttribute(role)}"`,
            options.tableIndex != null ? `data-table-index="${options.tableIndex}"` : '',
            options.fieldIndex != null ? `data-field-index="${options.fieldIndex}"` : '',
            options.title ? `title="${escapeAttribute(options.title)}"` : '',
            options.placeholder ? `placeholder="${escapeAttribute(options.placeholder)}"` : '',
            options.className ? `class="${escapeAttribute(options.className)}"` : '',
            options.disabled ? 'disabled' : ''
        ].filter(Boolean).join(' ');
        if (options.choices) return `<select ${attrs}>${options.choices.map(item => {
            const pair = Array.isArray(item) ? item : [item, item];
            return `<option value="${escapeAttribute(pair[0])}" ${selected(value, pair[0])}>${escapeHtml(pair[1])}</option>`;
        }).join('')}</select>`;
        if (options.multiline) return `<textarea rows="${options.rows || 2}" ${attrs}>${escapeHtml(value ?? '')}</textarea>`;
        const type = options.type || 'text';
        const extra = options.step != null ? ` step="${escapeAttribute(options.step)}"` : '';
        return `<input type="${type}" ${attrs}${extra} value="${escapeAttribute(value ?? '')}">`;
    }

    function renderSummary(draft) {
        const summary = Model.summarize(draft);
        return `<section class="memory-schema-summary" aria-label="模板设置">
            <label><span>模板名称</span>${renderInput('template-name', draft.name || '')}</label>
            <label class="memory-schema-description"><span>模板描述</span>${renderInput('template-description', draft.description || '', { multiline: true, rows: 2 })}</label>
            <div class="memory-schema-counts"><b>${summary.tableCount}</b><span>张表</span><b>${summary.fieldCount}</b><span>字段</span><b>${summary.groupCount}</b><span>分组</span></div>
        </section>`;
    }

    function renderTableSettings(draft, state) {
        return `<section class="memory-schema-unified-section" aria-label="表格设置">
            <div class="memory-schema-section-head"><div><strong>表格设置</strong><small>基础设置、自动更新和注入设置已经合并为一张表；点击“编辑字段”切换下方字段表。</small></div><button type="button" class="btn btn-small btn-primary" data-schema-action="add-table">新增表格</button></div>
            <div class="memory-schema-grid-wrap memory-schema-wide-grid-wrap"><table class="memory-schema-grid memory-schema-tables-grid memory-schema-unified-table-grid">
                <thead><tr>
                    <th>表格名称</th><th>模式</th><th>层级</th><th>自动更新</th><th>触发方式</th><th>每几轮</th><th>每几条消息</th><th>读取上限</th><th>重叠消息</th><th>更新 API</th><th>允许新增</th><th>允许修改</th><th>允许删除</th><th>注入方式</th><th>Top-K</th><th>阈值</th><th>字符预算</th><th>有效期（天）</th><th>包含置顶</th><th>包含完成</th><th>提取规则</th><th>更新附加规则</th><th>注入附加规则</th><th>字段</th><th>操作</th>
                </tr></thead>
                <tbody>${draft.tables.map((table, tableIndex) => {
                    const layer = Policy ? Policy.normalizeLayer(table.memoryLayer, table.name) : (table.memoryLayer || 'short');
                    const update = Policy ? Policy.normalizeUpdatePolicy(table.updatePolicy || {}, layer) : (table.updatePolicy || {});
                    const inject = Policy ? Policy.normalizeInjectionPolicy(table.injectionPolicy || {}, layer) : (table.injectionPolicy || {});
                    return `<tr class="${tableIndex === state.activeTableIndex ? 'active' : ''}" data-schema-table-row="${tableIndex}">
                        <td class="memory-schema-sticky-name">${renderInput('table-name', table.name || '', { tableIndex, title: table.name || '' })}<small class="memory-schema-id">${escapeHtml(table.id || '')}</small></td>
                        <td>${renderInput('table-mode', table.mode || 'keyValue', { tableIndex, choices: [['keyValue', '键值表'], ['rows', '多行表']] })}</td>
                        <td>${renderInput('table-memory-layer', layer, { tableIndex, choices: LAYERS })}</td>
                        <td>${renderInput('table-update-enabled', update.enabled ? 'true' : 'false', { tableIndex, choices: [['true', '开启'], ['false', '手动']] })}</td>
                        <td>${renderInput('table-trigger-mode', update.triggerMode || 'manual', { tableIndex, choices: [['rounds', '按轮'], ['messages', '按消息'], ['either', '先到者'], ['manual', '仅手动']] })}</td>
                        <td>${renderInput('table-round-interval', update.roundInterval ?? '', { tableIndex, type: 'number', placeholder: '可空' })}</td>
                        <td>${renderInput('table-message-interval', update.messageInterval ?? '', { tableIndex, type: 'number', placeholder: '可空' })}</td>
                        <td>${renderInput('table-max-source-messages', update.maxSourceMessages ?? '', { tableIndex, type: 'number', placeholder: '可空' })}</td>
                        <td>${renderInput('table-overlap-messages', update.overlapMessages ?? '', { tableIndex, type: 'number', placeholder: '可空' })}</td>
                        <td>${renderInput('table-use-summary-api', update.useSummaryApi !== false ? 'true' : 'false', { tableIndex, choices: [['false', '主聊天 API'], ['true', '总结 API']] })}</td>
                        <td>${renderInput('table-allow-add', update.allowAdd !== false ? 'true' : 'false', { tableIndex, choices: [['true', '允许'], ['false', '禁止']] })}</td>
                        <td>${renderInput('table-allow-update', update.allowUpdate !== false ? 'true' : 'false', { tableIndex, choices: [['true', '允许'], ['false', '禁止']] })}</td>
                        <td>${renderInput('table-allow-delete', update.allowDelete ? 'true' : 'false', { tableIndex, choices: [['false', '禁止'], ['true', '允许']] })}</td>
                        <td>${renderInput('table-injection-mode', inject.mode || 'never', { tableIndex, choices: [['always', '始终'], ['active', '有效项'], ['relevant', '相关检索'], ['never', '不注入']] })}</td>
                        <td>${renderInput('table-injection-top-k', inject.topK ?? '', { tableIndex, type: 'number', placeholder: '可空' })}</td>
                        <td>${renderInput('table-injection-threshold', inject.threshold ?? '', { tableIndex, type: 'number', step: '0.01', placeholder: '可空' })}</td>
                        <td>${renderInput('table-injection-budget', inject.budget ?? '', { tableIndex, type: 'number', placeholder: '可空' })}</td>
                        <td>${renderInput('table-max-age-days', inject.maxAgeDays ?? '', { tableIndex, type: 'number', placeholder: '可空' })}</td>
                        <td>${renderInput('table-include-pinned', inject.includePinned !== false ? 'true' : 'false', { tableIndex, choices: [['true', '包含'], ['false', '排除']] })}</td>
                        <td>${renderInput('table-include-completed', inject.includeCompleted ? 'true' : 'false', { tableIndex, choices: [['false', '排除'], ['true', '包含']] })}</td>
                        <td class="memory-schema-long-cell">${renderInput('table-extract-prompt', table.extractPrompt || '', { tableIndex, multiline: true, rows: 3, placeholder: '可空' })}</td>
                        <td class="memory-schema-long-cell">${renderInput('table-update-instructions', update.instructions || '', { tableIndex, multiline: true, rows: 3, placeholder: '可空' })}</td>
                        <td class="memory-schema-long-cell">${renderInput('table-injection-instructions', inject.instructions || '', { tableIndex, multiline: true, rows: 3, placeholder: '可空' })}</td>
                        <td><button type="button" class="memory-schema-field-count ${tableIndex === state.activeTableIndex ? 'active' : ''}" data-schema-action="select-fields" data-table-index="${tableIndex}">编辑 ${(table.columns || []).length} 个字段</button></td>
                        <td><div class="memory-schema-row-actions"><button type="button" data-schema-action="move-table-up" data-table-index="${tableIndex}" aria-label="上移">↑</button><button type="button" data-schema-action="move-table-down" data-table-index="${tableIndex}" aria-label="下移">↓</button><button type="button" class="danger" data-schema-action="remove-table" data-table-index="${tableIndex}" aria-label="删除">×</button></div></td>
                    </tr>`;
                }).join('')}</tbody>
            </table></div>
        </section>`;
    }

    function renderFieldSettings(draft, state) {
        const tableIndex = Math.min(Math.max(0, Number(state.activeTableIndex) || 0), Math.max(0, draft.tables.length - 1));
        state.activeTableIndex = tableIndex;
        const table = draft.tables[tableIndex];
        if (!table) return '<section class="memory-schema-unified-section"><div class="memory-schema-empty">还没有表格。</div></section>';
        const groups = Model.fieldGroups(table);
        const width = fieldNameColumnWidth(table);
        return `<section class="memory-schema-unified-section memory-schema-fields-section" id="memory-schema-fields-section" aria-label="字段设置">
            <div class="memory-schema-section-head"><div><strong>${escapeHtml(table.name)} · 字段设置</strong><small>基础项与高级项已合并；选项、最小值和最大值都允许留空。</small></div><button type="button" class="btn btn-small btn-primary" data-schema-action="add-field" data-table-index="${tableIndex}">新增字段</button></div>
            <div class="memory-schema-grid-wrap memory-schema-wide-grid-wrap"><table class="memory-schema-grid memory-schema-fields-grid memory-schema-unified-field-grid" style="--schema-field-name-width:${width.desktop}px;--schema-field-name-width-mobile:${width.mobile}px" data-schema-name-width-desktop="${width.desktop}" data-schema-name-width-mobile="${width.mobile}" data-schema-name-max-units="${width.longestUnits}">
                <colgroup><col class="schema-col-group"><col class="schema-col-name"><col class="schema-col-type"><col class="schema-col-default"><col class="schema-col-options"><col class="schema-col-min"><col class="schema-col-max"><col class="schema-col-toggle"><col class="schema-col-toggle"><col class="schema-col-summary"><col class="schema-col-format"><col class="schema-col-ai-hint"><col class="schema-col-rules"><col class="schema-col-actions"></colgroup>
                <thead><tr><th>分组</th><th>字段名</th><th>类型</th><th>默认值</th><th>选项</th><th>最小值</th><th>最大值</th><th>普通显示</th><th>AI 编辑</th><th>摘要标签</th><th>显示格式</th><th>AI 提示</th><th>条件规则</th><th>操作</th></tr></thead>
                ${groups.map(group => `<tbody><tr class="memory-schema-group-row"><th colspan="14"><span>${escapeHtml(group.name)}</span><small>${group.fields.length} 个字段</small></th></tr>${group.fields.map(({ field, index }) => `<tr>
                    <td>${renderInput('field-group', field.group || '', { tableIndex, fieldIndex: index, placeholder: '可空' })}</td>
                    <td class="memory-schema-sticky-field-name">${renderInput('field-key', field.key || '', { tableIndex, fieldIndex: index, title: field.key || '' })}<small class="memory-schema-id">${escapeHtml(field.id || '')}</small></td>
                    <td>${renderInput('field-type', field.type || 'text', { tableIndex, fieldIndex: index, choices: FIELD_TYPES })}</td>
                    <td>${renderInput('field-default', Array.isArray(field.default) ? field.default.join(', ') : (field.default ?? ''), { tableIndex, fieldIndex: index, multiline: field.type === 'longtext', rows: field.type === 'longtext' ? 3 : 2, placeholder: '可空' })}</td>
                    <td>${renderInput('field-options', (field.options || []).join('\n'), { tableIndex, fieldIndex: index, multiline: true, rows: 3, placeholder: '每行一个；可空' })}</td>
                    <td>${renderInput('field-min', field.min ?? '', { tableIndex, fieldIndex: index, type: 'number', placeholder: '可空' })}</td>
                    <td>${renderInput('field-max', field.max ?? '', { tableIndex, fieldIndex: index, type: 'number', placeholder: '可空' })}</td>
                    <td>${renderInput('field-important', field.important !== false ? 'true' : 'false', { tableIndex, fieldIndex: index, choices: [['true', '显示'], ['false', '隐藏']] })}</td>
                    <td>${renderInput('field-ai-editable', field.aiEditable !== false ? 'true' : 'false', { tableIndex, fieldIndex: index, choices: [['true', '允许'], ['false', '只读']] })}</td>
                    <td>${renderInput('field-summary-label', field.summaryLabel || '', { tableIndex, fieldIndex: index, placeholder: '可空' })}</td>
                    <td>${renderInput('field-display-format', field.displayFormat || '{value}', { tableIndex, fieldIndex: index, placeholder: '{value}' })}</td>
                    <td class="memory-schema-long-cell">${renderInput('field-ai-hint', field.aiHint || '', { tableIndex, fieldIndex: index, multiline: true, rows: 3, placeholder: '可空' })}</td>
                    <td class="memory-schema-long-cell">${renderInput('field-conditional-rules', Domain.serializeConditionalRules(field.conditionalRules || []), { tableIndex, fieldIndex: index, multiline: true, rows: 3, placeholder: '可空' })}</td>
                    <td><div class="memory-schema-row-actions"><button type="button" data-schema-action="move-field-up" data-table-index="${tableIndex}" data-field-index="${index}" aria-label="上移">↑</button><button type="button" data-schema-action="move-field-down" data-table-index="${tableIndex}" data-field-index="${index}" aria-label="下移">↓</button><button type="button" class="danger" data-schema-action="remove-field" data-table-index="${tableIndex}" data-field-index="${index}" aria-label="删除">×</button></div></td>
                </tr>`).join('')}</tbody>`).join('')}
            </table></div>
        </section>`;
    }

    function renderRawJson(draft) {
        return `<details class="memory-schema-raw"><summary>高级：导入或查看原始 JSON</summary><p>这里仍然编辑同一份结构，只用于导入、导出和故障排查；日常配置请使用上面的统一表格。</p><textarea id="memory-schema-raw-json" rows="14">${escapeHtml(JSON.stringify(draft, null, 2))}</textarea><div><button type="button" class="btn btn-small btn-secondary" data-schema-action="refresh-raw-json">用当前结构刷新</button><button type="button" class="btn btn-small btn-primary" data-schema-action="apply-raw-json">应用原始 JSON</button></div></details>`;
    }

    function render(draft, state) {
        const safeState = state || {};
        safeState.activeTableIndex = Math.min(Math.max(0, Number(safeState.activeTableIndex) || 0), Math.max(0, (draft.tables || []).length - 1));
        return `${renderSummary(draft)}<div class="memory-schema-unified-note"><strong>统一结构工作台</strong><span>表格设置、字段设置和高级设置只在这一页维护；原始 JSON 不再作为并列视图。</span></div>${renderTableSettings(draft, safeState)}${renderFieldSettings(draft, safeState)}${renderRawJson(draft)}`;
    }

    function target(draft, tableIndex, fieldIndex) {
        if (tableIndex == null) return draft;
        const table = draft.tables?.[tableIndex];
        if (fieldIndex == null) return table;
        return table?.columns?.[fieldIndex];
    }

    function updateRole(draft, element) {
        const role = element.dataset.schemaRole;
        if (!role) return false;
        const tableIndex = element.dataset.tableIndex !== undefined ? Number(element.dataset.tableIndex) : undefined;
        const fieldIndex = element.dataset.fieldIndex !== undefined ? Number(element.dataset.fieldIndex) : undefined;
        const item = target(draft, tableIndex, fieldIndex);
        if (!item) return false;
        const value = element.value;
        const ensurePolicies = () => {
            const layer = Policy ? Policy.normalizeLayer(item.memoryLayer, item.name) : (item.memoryLayer || 'short');
            item.memoryLayer = layer;
            item.updatePolicy = Policy ? Policy.normalizeUpdatePolicy(item.updatePolicy || {}, layer) : (item.updatePolicy || {});
            item.injectionPolicy = Policy ? Policy.normalizeInjectionPolicy(item.injectionPolicy || {}, layer) : (item.injectionPolicy || {});
        };
        const optionalNumber = (raw, fallback = undefined) => raw === '' ? fallback : Number(raw);
        switch (role) {
            case 'template-name': draft.name = value; break;
            case 'template-description': draft.description = value; break;
            case 'table-name': item.name = value; break;
            case 'table-mode': item.mode = value === 'rows' ? 'rows' : 'keyValue'; break;
            case 'table-memory-layer': item.memoryLayer = value; if (Policy) { item.updatePolicy = Policy.normalizeUpdatePolicy({}, value); item.injectionPolicy = Policy.normalizeInjectionPolicy({}, value); } break;
            case 'table-extract-prompt': item.extractPrompt = value; break;
            case 'table-update-enabled': ensurePolicies(); item.updatePolicy.enabled = value !== 'false'; break;
            case 'table-trigger-mode': ensurePolicies(); item.updatePolicy.triggerMode = value; break;
            case 'table-round-interval': ensurePolicies(); item.updatePolicy.roundInterval = Math.max(0, optionalNumber(value, 0) || 0); break;
            case 'table-message-interval': ensurePolicies(); item.updatePolicy.messageInterval = Math.max(0, optionalNumber(value, 0) || 0); break;
            case 'table-max-source-messages': ensurePolicies(); item.updatePolicy.maxSourceMessages = Math.max(10, optionalNumber(value, 10) || 10); break;
            case 'table-overlap-messages': ensurePolicies(); item.updatePolicy.overlapMessages = Math.max(0, optionalNumber(value, 0) || 0); break;
            case 'table-allow-add': ensurePolicies(); item.updatePolicy.allowAdd = value === 'true'; break;
            case 'table-allow-update': ensurePolicies(); item.updatePolicy.allowUpdate = value === 'true'; break;
            case 'table-allow-delete': ensurePolicies(); item.updatePolicy.allowDelete = value === 'true'; break;
            case 'table-use-summary-api': ensurePolicies(); item.updatePolicy.useSummaryApi = value === 'true'; break;
            case 'table-update-instructions': ensurePolicies(); item.updatePolicy.instructions = value; break;
            case 'table-injection-mode': ensurePolicies(); item.injectionPolicy.mode = value; break;
            case 'table-injection-top-k': ensurePolicies(); item.injectionPolicy.topK = Math.max(0, optionalNumber(value, 0) || 0); break;
            case 'table-injection-threshold': ensurePolicies(); item.injectionPolicy.threshold = Math.max(0, Math.min(1, optionalNumber(value, 0) || 0)); break;
            case 'table-injection-budget': ensurePolicies(); item.injectionPolicy.budget = Math.max(0, optionalNumber(value, 0) || 0); break;
            case 'table-max-age-days': ensurePolicies(); item.injectionPolicy.maxAgeDays = Math.max(0, optionalNumber(value, 0) || 0); break;
            case 'table-include-pinned': ensurePolicies(); item.injectionPolicy.includePinned = value === 'true'; break;
            case 'table-include-completed': ensurePolicies(); item.injectionPolicy.includeCompleted = value === 'true'; break;
            case 'table-injection-instructions': ensurePolicies(); item.injectionPolicy.instructions = value; break;
            case 'field-key': item.key = value; break;
            case 'field-group': item.group = value; break;
            case 'field-type': item.type = Domain.normalizeFieldType(value); break;
            case 'field-default': item.default = item.type === 'tags' ? Domain.parseOptionText(value) : value; break;
            case 'field-ai-editable': item.aiEditable = value !== 'false'; break;
            case 'field-important': item.important = value !== 'false'; break;
            case 'field-summary-label': item.summaryLabel = value; break;
            case 'field-display-format': item.displayFormat = value || '{value}'; break;
            case 'field-min': item.min = value === '' ? undefined : Number(value); break;
            case 'field-max': item.max = value === '' ? undefined : Number(value); break;
            case 'field-options': item.options = Domain.parseOptionText(value); break;
            case 'field-ai-hint': item.aiHint = value; break;
            case 'field-conditional-rules': item.conditionalRules = Domain.parseConditionalRulesText(value); break;
            default: return false;
        }
        return true;
    }

    function updatePath(draft, element) {
        if (!element.dataset.schemaPath) return false;
        return Model.updatePath(draft, element.dataset.schemaPath, element.value, element.dataset.schemaValueType || 'text');
    }

    Kernel.register('schemaEditor', Object.freeze({
        VERSION: '2.13-R5.2',
        render,
        fieldNameVisualUnits,
        fieldNameColumnWidth,
        applyFieldNameWidth,
        updateRole,
        updatePath,
        mutate: Model.mutate,
        applyRawJson: Model.applyRawJson,
        prepare: Model.prepare,
        normalize: Model.normalize
    }));
})(window);
