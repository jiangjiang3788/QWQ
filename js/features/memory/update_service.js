(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Domain = Kernel.require('domain');
    const Policy = Kernel.require('policy');
    const ContextAssembler = Kernel.require('contextAssembler');
    const TagService = Kernel.require('tagService');
    const TagVocabulary = Kernel.require('tagVocabulary');

    function collectMessages(chat, options = {}) {
        let history = Array.isArray(chat?.history) ? [...chat.history] : [];
        if (options.start && options.end) history = history.slice(Math.max(0, options.start - 1), Math.min(history.length, options.end));
        if (typeof global.filterHistoryForAI === 'function') history = global.filterHistoryForAI(chat, history);
        history = history.filter(item => !item.isContextDisabled && !item.isThinking);
        if (!options.start && !options.end) {
            const runtime = Policy.ensureRuntimeState(chat);
            const limit = Math.max(10, Number(options.maxContextMessages) || runtime.engineSettings.maxSourceMessages || 60);
            history = history.slice(-limit);
        }
        return history;
    }

    function messageContent(item) {
        if (Array.isArray(item?.parts) && item.parts.length) return item.parts.map(part => part.text || '[图片]').join('');
        return String(item?.content || '');
    }

    function timestamp(value) {
        const number = Number(value), date = new Date(number);
        if (!number || Number.isNaN(date.getTime())) return '时间未记录';
        const pad = v => String(v).padStart(2, '0');
        const offset = -date.getTimezoneOffset(), abs = Math.abs(offset);
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} UTC${offset >= 0 ? '+' : '-'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
    }

    function buildHistoryText(chat, history) {
        return (history || []).map(item => {
            const name = item.role === 'user' ? (chat.myName || '用户') : (item.role === 'system' ? '系统' : (chat.realName || '角色'));
            return `[${timestamp(item.timestamp)}] ${name}: ${messageContent(item)}`;
        }).join('\n');
    }

    function rowTimestamp(table, row) {
        return Number(row?.meta?.lastMentionedAt || row?.meta?.updatedAt || row?.meta?.createdAt) || 0;
    }

    function rowItem(table, row, index) {
        const searchText = Domain.getRowSearchText(table, row);
        return { id: row.id, row, table, rowIndex: index, searchText, text: searchText, updatedAt: rowTimestamp(table, row), importance: Number(row?.meta?.importance) || 50, pinned: !!row?.meta?.pinned, active: true, completed: false };
    }

    function buildTemplateDefinition(chat, templates, options = {}) {
        const queryText = options.queryText || '';
        const maxCandidateRows = Math.max(3, Number(options.maxCandidateRows) || 12);
        return (templates || []).map(template => [
            `模板ID=${template.id} 名称=${template.name}`,
            template.description ? `描述=${template.description}` : '',
            ...(template.tables || []).map(table => {
                const policy = Policy.normalizeTablePolicy(table);
                let rowsText = '';
                if (Domain.isRowsTable(table)) {
                    let rows = Domain.getRows(chat, template.id, table);
                    if (options.relevantRowsOnly !== false && rows.length > maxCandidateRows) {
                        const items = rows.map((row, index) => rowItem(table, row, index));
                        const selected = Policy.selectRelevantItems(items, queryText, { mode: 'relevant', topK: maxCandidateRows, threshold: 0, includeCompleted: true, maxAgeDays: 0 });
                        const newest = items.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.min(4, maxCandidateRows));
                        const merged = new Map();
                        [...selected, ...newest].forEach(item => merged.set(item.id, item.row));
                        rows = Array.from(merged.values()).slice(0, maxCandidateRows);
                    }
                    rowsText = rows.length ? rows.map((row, index) => {
                        const cells = (table.columns || []).map(field => `${field.key}=${Domain.getFieldDisplayValue(field, row.cells?.[field.id]) || '空'}`).join(' | ');
                        const tags = row.meta?.tagBundle || {};
                        const tagText = [...(tags.topic || []), ...(tags.scene || []), ...(tags.entity || [])].length ? ` | 现有标签=${JSON.stringify(tags)}` : '';
                        return `  候选行ID=${row.id} 候选号=${index + 1} ${cells}${tagText}`;
                    }).join('\n') : '  现有候选行=空';
                }
                return [
                    `  表格ID=${table.id} 名称=${table.name} 层级=${policy.memoryLayer} 模式=${Domain.isRowsTable(table) ? 'rows' : 'keyValue'}`,
                    `  更新策略=${policy.updatePolicy.enabled ? policy.updatePolicy.triggerMode : 'manual'}；允许新增=${policy.updatePolicy.allowAdd !== false ? '是' : '否'}；允许修改=${policy.updatePolicy.allowUpdate !== false ? '是' : '否'}；允许删除=${policy.updatePolicy.allowDelete === true ? '是' : '否'}`,
                    table.extractPrompt ? `  表格提取规则=${table.extractPrompt}` : '',
                    policy.updatePolicy.instructions ? `  本表附加规则=${policy.updatePolicy.instructions}` : '',
                    ...(table.columns || []).map(field => {
                        const currentValue = Domain.isRowsTable(table) ? '见候选行' : Domain.getFieldDisplayValue(field, Domain.getFieldValue(chat, template.id, table.id, field));
                        const locked = Domain.isFieldLocked(chat, template.id, table.id, field.id);
                        const optionsText = Array.isArray(field.options) && field.options.length ? ` 可选值=${field.options.join('|')}` : '';
                        const range = typeof field.min === 'number' || typeof field.max === 'number' ? ` 范围=${field.min ?? ''}~${field.max ?? ''}` : '';
                        return `    字段ID=${field.id} 字段名=${field.key}${field.group ? ` 分组=${field.group}` : ''} 类型=${field.type}${optionsText}${range} 当前值=${currentValue || '空'} 锁定=${locked ? '是' : '否'} AI可编辑=${field.aiEditable === false ? '否' : '是'} 重要字段=${field.important !== false ? '是' : '否'} 说明=${field.aiHint || '无'}`;
                    }),
                    rowsText
                ].filter(Boolean).join('\n');
            })
        ].filter(Boolean).join('\n')).join('\n\n');
    }

    function buildUpdatePrompt(options = {}) {
        const chat = options.chat;
        const templates = options.templates || [];
        const history = options.history || [];
        const historyText = options.historyText || buildHistoryText(chat, history);
        const templateText = options.templateText || buildTemplateDefinition(chat, templates, { queryText: historyText, relevantRowsOnly: true, maxCandidateRows: options.maxCandidateRows || 12 });
        const targetTemplate = templates[0];
        const targetTable = targetTemplate?.tables?.[0];
        const related = targetTemplate && targetTable ? ContextAssembler.assemble({ chat, template: targetTemplate, table: targetTable, queryText: historyText, budget: options.relatedBudget || 7200 }) : { text: '', tables: [], rowCount: 0, chars: 0 };
        const prompt = `你现在要帮一个聊天角色更新“结构化记忆表”。请根据目标表、相关记忆表和最近聊天记录，只提取明确发生过的信息，并且只输出发生变化的字段。\n\n严格要求：\n1. 只更新没有锁定且允许 AI 编辑的字段。\n2. keyValue 表只能输出 <field>。\n3. rows 表必须使用 <row op="add|update|delete">：\n   - 新增一行用 <row op="add">，可不给 rowId。\n   - 修改已有行用 <row op="update" rowId="现有行ID">。\n   - 删除一行用 <row op="delete" rowId="现有行ID"></row>。\n4. 先核对相关记忆表和目标表已有候选行；优先 update 或补充证据，不要为同一事实反复 add。\n5. 相关记忆表只用于判断重复、冲突、前后关系和阶段变化；不得直接修改非目标表。\n6. 如果某字段或某一行没有新变化，就不要输出它。\n7. 不要臆测、不要补完、不要写解释。\n8. 如果没有任何变化，输出 <memory_updates></memory_updates>${TagService.buildPromptInstructions()}\n\n你必须严格使用以下 XML：\n<memory_updates>\n  <memory_update templateId="模板ID" tableId="表格ID">\n    <field fieldId="字段ID">新值</field>\n    <row op="add">\n      <field fieldId="字段ID">值</field>\n      <tags topic="主题1,主题2" scene="场景1" entity="主体1" effect="historical_context"/>\n    </row>\n    <row op="update" rowId="现有行ID">\n      <field fieldId="字段ID">新值</field>\n      <tags topic="主题1,主题2" scene="场景1" entity="主体1" effect="historical_context"/>\n    </row>\n    <row op="delete" rowId="现有行ID"></row>\n  </memory_update>\n</memory_updates>\n\n角色信息：\n- 角色名：${chat.realName || ''}\n- 角色人设：${chat.persona || ''}\n- 用户称呼：${chat.myName || ''}\n- 用户人设：${chat.myPersona || ''}\n\n目标表定义如下：\n${templateText}\n\n${related.text ? `用于核对的相关记忆表如下（只读）：\n${related.text}\n\n` : ''}最近聊天记录如下：\n${historyText}`;
        return { prompt, historyText, templateText, related };
    }

    Kernel.register('updateService', Object.freeze({
        VERSION: '2.11-R3.1', collectMessages, buildHistoryText, buildTemplateDefinition, buildUpdatePrompt
    }), { legacyGlobal: 'MemoryUpdateService' });
})(window);
