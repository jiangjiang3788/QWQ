(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Model = Kernel.require('schemaModel');
    const Domain = Kernel.require('domain');
    const Policy = Kernel.get('policy');

    const escapeHtml = Core.escapeHtml;
    const escapeAttribute = Core.escapeAttribute;

    const FIELD_TYPES = ['text', 'longtext', 'number', 'enum', 'tags', 'progress', 'date', 'boolean'];
    const LAYERS = [['core', '核心'], ['short', '短期'], ['medium', '中期'], ['long', '长期'], ['review', '审核队列']];

    function selected(value, expected) { return String(value) === String(expected) ? 'selected' : ''; }

    function fieldNameVisualUnits(value) {
        return Array.from(String(value || '').trim()).reduce((sum, char) => {
            if (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF01-\uFF60]/u.test(char)) return sum + 1;
            if (/[A-Z0-9]/.test(char)) return sum + 0.66;
            if (/[a-z]/.test(char)) return sum + 0.56;
            if (/[_\-./]/.test(char)) return sum + 0.42;
            if (/\s/.test(char)) return sum + 0.34;
            return sum + 0.72;
        }, 0);
    }

    function fieldNameColumnWidth(table) {
        const names = (table?.columns || []).map(field => field?.key || '').filter(Boolean);
        const longestUnits = Math.max(4, ...names.map(fieldNameVisualUnits));
        return Object.freeze({
            longestUnits: Number(longestUnits.toFixed(2)),
            desktop: Math.round(Math.min(112, Math.max(68, 18 + longestUnits * 10))),
            mobile: Math.round(Math.min(74, Math.max(54, 10 + longestUnits * 6.6)))
        });
    }

    function fieldNameWidthStyle(table) {
        const width = fieldNameColumnWidth(table);
        return `--schema-field-name-width:${width.desktop}px;--schema-field-name-width-mobile:${width.mobile}px`;
    }

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
        const attrs = `data-schema-role="${role}"${options.tableIndex != null ? ` data-table-index="${options.tableIndex}"` : ''}${options.fieldIndex != null ? ` data-field-index="${options.fieldIndex}"` : ''}${options.title ? ` title="${escapeAttribute(options.title)}"` : ''}`;
        if (options.choices) return `<select ${attrs}>${options.choices.map(item => {
            const pair = Array.isArray(item) ? item : [item, item];
            return `<option value="${escapeAttribute(pair[0])}" ${selected(value, pair[0])}>${escapeHtml(pair[1])}</option>`;
        }).join('')}</select>`;
        if (options.multiline) return `<textarea rows="2" ${attrs}>${escapeHtml(value ?? '')}</textarea>`;
        const type = options.type || 'text';
        return `<input type="${type}" ${attrs} value="${escapeAttribute(value ?? '')}">`;
    }

    function renderSummary(draft) {
        const summary = Model.summarize(draft);
        return `<div class="memory-schema-summary">
            <label><span>模板名称</span>${renderInput('template-name', draft.name || '')}</label>
            <label class="memory-schema-description"><span>模板描述</span>${renderInput('template-description', draft.description || '', { multiline: true })}</label>
            <div class="memory-schema-counts"><b>${summary.tableCount}</b><span>张表</span><b>${summary.fieldCount}</b><span>字段</span><b>${summary.groupCount}</b><span>分组</span></div>
        </div>`;
    }

    function renderTablePicker(draft, state) {
        const active = Math.min(Math.max(0, Number(state.activeTableIndex) || 0), Math.max(0, draft.tables.length - 1));
        state.activeTableIndex = active;
        return `<div class="memory-schema-table-picker" role="tablist">${draft.tables.map((table, index) => `<button type="button" class="${index === active ? 'active' : ''}" data-schema-action="select-table" data-table-index="${index}">${escapeHtml(table.name || `表格 ${index + 1}`)}</button>`).join('')}</div>`;
    }

    function renderFieldsTab(draft, state) {
        const tableIndex = Math.min(Math.max(0, Number(state.activeTableIndex) || 0), Math.max(0, draft.tables.length - 1));
        const table = draft.tables[tableIndex];
        if (!table) return '<div class="memory-schema-empty">还没有表格。</div>';
        const groups = Model.fieldGroups(table);
        const nameWidth = fieldNameColumnWidth(table);
        return `${renderTablePicker(draft, state)}
            <div class="memory-schema-section-head"><div><strong>${escapeHtml(table.name)}</strong><small>按字段组统一展示；修改分组名称后会立即重新归组。</small></div><button type="button" class="btn btn-small btn-primary" data-schema-action="add-field" data-table-index="${tableIndex}">新增字段</button></div>
            <div class="memory-schema-grid-wrap"><table class="memory-schema-grid memory-schema-fields-grid" style="--schema-field-name-width:${nameWidth.desktop}px;--schema-field-name-width-mobile:${nameWidth.mobile}px" data-schema-name-width-desktop="${nameWidth.desktop}" data-schema-name-width-mobile="${nameWidth.mobile}" data-schema-name-max-units="${nameWidth.longestUnits}">
                <colgroup><col class="schema-col-group"><col class="schema-col-name"><col class="schema-col-type"><col class="schema-col-default"><col class="schema-col-toggle"><col class="schema-col-toggle"><col class="schema-col-summary"><col class="schema-col-actions"></colgroup>
                <thead><tr><th>分组</th><th>字段名</th><th>类型</th><th>默认值</th><th>普通显示</th><th>AI 编辑</th><th>摘要标签</th><th>操作</th></tr></thead>
                ${groups.map(group => `<tbody><tr class="memory-schema-group-row"><th colspan="8"><span>${escapeHtml(group.name)}</span><small>${group.fields.length} 个字段</small></th></tr>${group.fields.map(({ field, index }) => `<tr>
                    <td>${renderInput('field-group', field.group || '', { tableIndex, fieldIndex: index })}</td>
                    <td>${renderInput('field-key', field.key || '', { tableIndex, fieldIndex: index, title: field.key || '' })}<small class="memory-schema-id">${escapeHtml(field.id || '')}</small></td>
                    <td>${renderInput('field-type', field.type || 'text', { tableIndex, fieldIndex: index, choices: FIELD_TYPES })}</td>
                    <td>${renderInput('field-default', Array.isArray(field.default) ? field.default.join(', ') : (field.default ?? ''), { tableIndex, fieldIndex: index })}</td>
                    <td>${renderInput('field-important', field.important !== false ? 'true' : 'false', { tableIndex, fieldIndex: index, choices: [['true', '显示'], ['false', '隐藏']] })}</td>
                    <td>${renderInput('field-ai-editable', field.aiEditable !== false ? 'true' : 'false', { tableIndex, fieldIndex: index, choices: [['true', '允许'], ['false', '只读']] })}</td>
                    <td>${renderInput('field-summary-label', field.summaryLabel || '', { tableIndex, fieldIndex: index })}</td>
                    <td><div class="memory-schema-row-actions"><button type="button" data-schema-action="move-field-up" data-table-index="${tableIndex}" data-field-index="${index}" aria-label="上移">↑</button><button type="button" data-schema-action="move-field-down" data-table-index="${tableIndex}" data-field-index="${index}" aria-label="下移">↓</button><button type="button" class="danger" data-schema-action="remove-field" data-table-index="${tableIndex}" data-field-index="${index}" aria-label="删除">×</button></div></td>
                </tr>`).join('')}</tbody>`).join('')}
            </table></div>
            <details class="memory-schema-field-advanced"><summary>当前表字段高级设置</summary>${(table.columns || []).map((field, fieldIndex) => `<section><h4>${escapeHtml(field.key || `字段 ${fieldIndex + 1}`)}</h4><div class="memory-schema-settings-grid">
                <label><span>选项</span>${renderInput('field-options', (field.options || []).join('\n'), { tableIndex, fieldIndex, multiline: true })}</label>
                <label><span>最小值</span>${renderInput('field-min', field.min ?? '', { tableIndex, fieldIndex, type: 'number' })}</label>
                <label><span>最大值</span>${renderInput('field-max', field.max ?? '', { tableIndex, fieldIndex, type: 'number' })}</label>
                <label><span>AI 提示</span>${renderInput('field-ai-hint', field.aiHint || '', { tableIndex, fieldIndex, multiline: true })}</label>
                <label><span>条件规则</span>${renderInput('field-conditional-rules', Domain.serializeConditionalRules(field.conditionalRules || []), { tableIndex, fieldIndex, multiline: true })}</label>
            </div></section>`).join('')}</details>`;
    }

    function renderTablesTab(draft, state) {
        return `<div class="memory-schema-section-head"><div><strong>表格设置</strong><small>表格、更新策略和注入策略使用同一份 schema。</small></div><button type="button" class="btn btn-small btn-primary" data-schema-action="add-table">新增表格</button></div>
            <div class="memory-schema-grid-wrap"><table class="memory-schema-grid memory-schema-tables-grid"><thead><tr><th>表格名称</th><th>模式</th><th>层级</th><th>自动更新</th><th>触发方式</th><th>注入方式</th><th>字段</th><th>操作</th></tr></thead><tbody>${draft.tables.map((table, tableIndex) => {
                const layer = Policy ? Policy.normalizeLayer(table.memoryLayer, table.name) : (table.memoryLayer || 'short');
                const update = Policy ? Policy.normalizeUpdatePolicy(table.updatePolicy || {}, layer) : (table.updatePolicy || {});
                const inject = Policy ? Policy.normalizeInjectionPolicy(table.injectionPolicy || {}, layer) : (table.injectionPolicy || {});
                return `<tr class="${tableIndex === state.activeTableIndex ? 'active' : ''}">
                    <td>${renderInput('table-name', table.name || '', { tableIndex })}<small class="memory-schema-id">${escapeHtml(table.id || '')}</small></td>
                    <td>${renderInput('table-mode', table.mode || 'keyValue', { tableIndex, choices: [['keyValue', '键值表'], ['rows', '多行表']] })}</td>
                    <td>${renderInput('table-memory-layer', layer, { tableIndex, choices: LAYERS })}</td>
                    <td>${renderInput('table-update-enabled', update.enabled ? 'true' : 'false', { tableIndex, choices: [['true', '开启'], ['false', '手动']] })}</td>
                    <td>${renderInput('table-trigger-mode', update.triggerMode || 'manual', { tableIndex, choices: [['rounds', '按轮'], ['messages', '按消息'], ['either', '先到者'], ['manual', '仅手动']] })}</td>
                    <td>${renderInput('table-injection-mode', inject.mode || 'never', { tableIndex, choices: [['always', '始终'], ['active', '有效项'], ['relevant', '相关检索'], ['never', '不注入']] })}</td>
                    <td><button type="button" class="memory-schema-field-count" data-schema-action="select-fields" data-table-index="${tableIndex}">${(table.columns || []).length} 个</button></td>
                    <td><div class="memory-schema-row-actions"><button type="button" data-schema-action="move-table-up" data-table-index="${tableIndex}" aria-label="上移">↑</button><button type="button" data-schema-action="move-table-down" data-table-index="${tableIndex}" aria-label="下移">↓</button><button type="button" class="danger" data-schema-action="remove-table" data-table-index="${tableIndex}" aria-label="删除">×</button></div></td>
                </tr>`;
            }).join('')}</tbody></table></div>
            ${renderTableAdvanced(draft, state)}`;
    }

    function renderTableAdvanced(draft, state) {
        const tableIndex = Math.min(Math.max(0, Number(state.activeTableIndex) || 0), Math.max(0, draft.tables.length - 1));
        const table = draft.tables[tableIndex];
        if (!table) return '';
        const layer = Policy ? Policy.normalizeLayer(table.memoryLayer, table.name) : (table.memoryLayer || 'short');
        const update = Policy ? Policy.normalizeUpdatePolicy(table.updatePolicy || {}, layer) : (table.updatePolicy || {});
        const inject = Policy ? Policy.normalizeInjectionPolicy(table.injectionPolicy || {}, layer) : (table.injectionPolicy || {});
        return `<section class="memory-schema-flat-settings"><div class="memory-schema-section-head"><div><strong>${escapeHtml(table.name)} · 高级设置</strong><small>高级项仍属于当前表，不会创建第二套配置。</small></div></div><div class="memory-schema-settings-grid">
            <label><span>每几轮</span>${renderInput('table-round-interval', update.roundInterval ?? 0, { tableIndex, type: 'number' })}</label>
            <label><span>每几条消息</span>${renderInput('table-message-interval', update.messageInterval ?? 0, { tableIndex, type: 'number' })}</label>
            <label><span>单次最多读取</span>${renderInput('table-max-source-messages', update.maxSourceMessages ?? 180, { tableIndex, type: 'number' })}</label>
            <label><span>允许删除行</span>${renderInput('table-allow-delete', update.allowDelete ? 'true' : 'false', { tableIndex, choices: [['false', '否'], ['true', '是']] })}</label>
            <label><span>更新 API</span>${renderInput('table-use-summary-api', update.useSummaryApi !== false ? 'true' : 'false', { tableIndex, choices: [['false', '主聊天 API'], ['true', '总结 API']] })}</label>
            <label><span>相关 Top-K</span>${renderInput('table-injection-top-k', inject.topK ?? 0, { tableIndex, type: 'number' })}</label>
            <label><span>注入字符预算</span>${renderInput('table-injection-budget', inject.budget ?? 0, { tableIndex, type: 'number' })}</label>
            <label><span>有效期（天）</span>${renderInput('table-max-age-days', inject.maxAgeDays ?? 0, { tableIndex, type: 'number' })}</label>
            <label class="wide"><span>提取规则</span>${renderInput('table-extract-prompt', table.extractPrompt || '', { tableIndex, multiline: true })}</label>
            <label class="wide"><span>更新附加规则</span>${renderInput('table-update-instructions', update.instructions || '', { tableIndex, multiline: true })}</label>
        </div></section>`;
    }

    function renderPathEditor(row) {
        const attrs = `data-schema-path="${escapeAttribute(row.path)}" data-schema-value-type="${escapeAttribute(row.type)}"`;
        if (row.readOnly) return `<code>${escapeHtml(row.value ?? '')}</code>`;
        if (row.choices) return `<select ${attrs}>${row.choices.map(choice => `<option value="${escapeAttribute(choice)}" ${selected(row.value, choice)}>${escapeHtml(choice)}</option>`).join('')}</select>`;
        if (row.type === 'boolean') return `<select ${attrs}><option value="true" ${row.value ? 'selected' : ''}>true</option><option value="false" ${!row.value ? 'selected' : ''}>false</option></select>`;
        if (row.multiline) return `<textarea rows="2" ${attrs}>${escapeHtml(row.value ?? '')}</textarea>`;
        return `<input type="${row.type === 'number' ? 'number' : 'text'}" ${attrs} value="${escapeAttribute(row.value ?? '')}">`;
    }

    function renderJsonTab(draft) {
        const rows = Model.scalarRows(draft);
        const sections = [];
        const map = new Map();
        rows.forEach(row => {
            if (!map.has(row.section)) { const item = { name: row.section, rows: [] }; map.set(row.section, item); sections.push(item); }
            map.get(row.section).rows.push(row);
        });
        return `<div class="memory-schema-json-note"><strong>结构 JSON</strong><span>默认以路径表编辑同一份 schema；原始 JSON 只作为高级导入出口。</span></div>
            <div class="memory-schema-json-sections">${sections.map((section, index) => `<details ${index < 3 ? 'open' : ''}><summary>${escapeHtml(section.name)}<small>${section.rows.length} 项</small></summary><div class="memory-schema-grid-wrap"><table class="memory-schema-grid memory-schema-json-grid"><thead><tr><th>路径</th><th>类型</th><th>值</th></tr></thead><tbody>${section.rows.map(row => `<tr><td><code>${escapeHtml(row.path)}</code><small>${escapeHtml(row.label)}</small></td><td>${escapeHtml(row.type)}</td><td>${renderPathEditor(row)}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}</div>
            <details class="memory-schema-raw"><summary>高级：导入或查看原始 JSON</summary><textarea id="memory-schema-raw-json" rows="12">${escapeHtml(JSON.stringify(draft, null, 2))}</textarea><div><button type="button" class="btn btn-small btn-secondary" data-schema-action="refresh-raw-json">用当前结构刷新</button><button type="button" class="btn btn-small btn-primary" data-schema-action="apply-raw-json">应用原始 JSON</button></div></details>`;
    }

    function render(draft, state) {
        const tab = ['fields', 'tables', 'json'].includes(state.tab) ? state.tab : 'fields';
        state.tab = tab;
        const body = tab === 'tables' ? renderTablesTab(draft, state) : tab === 'json' ? renderJsonTab(draft) : renderFieldsTab(draft, state);
        return `${renderSummary(draft)}<nav class="memory-schema-tabs"><button type="button" class="${tab === 'fields' ? 'active' : ''}" data-schema-tab="fields">字段</button><button type="button" class="${tab === 'tables' ? 'active' : ''}" data-schema-tab="tables">表格</button><button type="button" class="${tab === 'json' ? 'active' : ''}" data-schema-tab="json">结构 JSON</button></nav><div class="memory-schema-tab-body">${body}</div>`;
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
        switch (role) {
            case 'template-name': draft.name = value; break;
            case 'template-description': draft.description = value; break;
            case 'table-name': item.name = value; break;
            case 'table-mode': item.mode = value === 'rows' ? 'rows' : 'keyValue'; break;
            case 'table-memory-layer': item.memoryLayer = value; if (Policy) { item.updatePolicy = Policy.normalizeUpdatePolicy({}, value); item.injectionPolicy = Policy.normalizeInjectionPolicy({}, value); } break;
            case 'table-extract-prompt': item.extractPrompt = value; break;
            case 'table-update-enabled': ensurePolicies(); item.updatePolicy.enabled = value !== 'false'; break;
            case 'table-trigger-mode': ensurePolicies(); item.updatePolicy.triggerMode = value; break;
            case 'table-round-interval': ensurePolicies(); item.updatePolicy.roundInterval = Math.max(0, Number(value) || 0); break;
            case 'table-message-interval': ensurePolicies(); item.updatePolicy.messageInterval = Math.max(0, Number(value) || 0); break;
            case 'table-max-source-messages': ensurePolicies(); item.updatePolicy.maxSourceMessages = Math.max(10, Number(value) || 10); break;
            case 'table-allow-delete': ensurePolicies(); item.updatePolicy.allowDelete = value === 'true'; break;
            case 'table-use-summary-api': ensurePolicies(); item.updatePolicy.useSummaryApi = value === 'true'; break;
            case 'table-update-instructions': ensurePolicies(); item.updatePolicy.instructions = value; break;
            case 'table-injection-mode': ensurePolicies(); item.injectionPolicy.mode = value; break;
            case 'table-injection-top-k': ensurePolicies(); item.injectionPolicy.topK = Math.max(0, Number(value) || 0); break;
            case 'table-injection-budget': ensurePolicies(); item.injectionPolicy.budget = Math.max(0, Number(value) || 0); break;
            case 'table-max-age-days': ensurePolicies(); item.injectionPolicy.maxAgeDays = Math.max(0, Number(value) || 0); break;
            case 'field-key': item.key = value; break;
            case 'field-group': item.group = value; break;
            case 'field-type': item.type = Domain.normalizeFieldType(value); break;
            case 'field-default': item.default = item.type === 'tags' ? Domain.parseOptionText(value) : value; break;
            case 'field-ai-editable': item.aiEditable = value !== 'false'; break;
            case 'field-important': item.important = value !== 'false'; break;
            case 'field-summary-label': item.summaryLabel = value; break;
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
        VERSION: '2.12-R3',
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
