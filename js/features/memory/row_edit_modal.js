(function (global) {
    'use strict';
    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Domain = Kernel.require('domain');
    const Effects = Kernel.get('effects');

    function controlId(field) {
        return `memory-row-edit-${field.id}`;
    }

    function fieldControl(field, value, locked) {
        const id = controlId(field);
        const attrs = `id="${Core.escapeAttribute(id)}" data-row-edit-field="${Core.escapeAttribute(field.id)}" data-field-type="${Core.escapeAttribute(field.type || 'text')}" ${locked ? 'disabled' : ''}`;
        const type = Domain.normalizeFieldType(field.type);
        if (type === 'enum') return `<select ${attrs}>${(field.options || []).map(option => `<option value="${Core.escapeAttribute(option)}" ${String(option) === String(value ?? '') ? 'selected' : ''}>${Core.escapeHtml(option)}</option>`).join('')}</select>`;
        if (type === 'boolean') return `<label class="memory-row-edit-switch"><input ${attrs} type="checkbox" ${value ? 'checked' : ''}><span>${value ? '已开启' : '已关闭'}</span></label>`;
        if (type === 'number' || type === 'progress') return `<input ${attrs} type="number" value="${Core.escapeAttribute(String(value ?? ''))}" min="${field.min ?? ''}" max="${field.max ?? ''}">`;
        if (type === 'date') return `<input ${attrs} type="date" value="${Core.escapeAttribute(String(value || ''))}">`;
        const text = Array.isArray(value) ? value.join(', ') : String(value ?? '');
        const explicitLines = Math.max(1, text.split(/\r?\n/).length);
        const estimatedWrappedLines = Math.max(1, Math.ceil(text.length / 84));
        const rows = Math.max(type === 'longtext' ? 5 : 3, explicitLines, estimatedWrappedLines);
        return `<textarea ${attrs} rows="${rows}" data-row-edit-autogrow="true" ${type === 'tags' ? 'placeholder="用逗号分隔多个标签"' : ''}>${Core.escapeHtml(text)}</textarea>`;
    }

    function fieldCard(chat, template, table, field, value) {
        const locked = Domain.isFieldLocked(chat, template.id, table.id, field.id);
        const id = controlId(field);
        return `<div class="memory-row-edit-field ${field.important === false ? 'is-secondary' : ''}">
            <div class="memory-row-edit-key">
                <label for="${Core.escapeAttribute(id)}"><strong>${Core.escapeHtml(field.key)}</strong></label>
                ${field.group ? `<em>${Core.escapeHtml(field.group)}</em>` : ''}
                ${locked ? '<small>已锁定</small>' : ''}
            </div>
            <div class="memory-row-edit-value">
                ${fieldControl(field, value, locked)}
                ${field.aiHint ? `<p>${Core.escapeHtml(field.aiHint)}</p>` : ''}
            </div>
        </div>`;
    }

    function tagRow(id, label, control) {
        return `<div class="memory-row-edit-field memory-row-edit-tag-row">
            <div class="memory-row-edit-key"><label for="${id}"><strong>${label}</strong></label><em>整行标签</em></div>
            <div class="memory-row-edit-value">${control}</div>
        </div>`;
    }

    function tagEditor(row) {
        const bundle = row?.meta?.tagBundle || {};
        const text = key => Array.isArray(bundle[key]) ? bundle[key].join(', ') : String(bundle[key] || '');
        const effectOptions = Effects?.effectOptions?.() || [
            { value: 'fact', label: '已确认事实' },
            { value: 'temporary_state', label: '临时状态' },
            { value: 'soft_preference', label: '柔性偏好' },
            { value: 'hard_boundary', label: '明确边界' },
            { value: 'reminder', label: '提醒事项' },
            { value: 'historical_context', label: '历史背景' },
            { value: 'candidate', label: '未审核候选' }
        ];
        return `<section class="memory-row-edit-tags">
            <div class="memory-row-edit-section-head"><h4>整行标签</h4><p>标签与本行字段一起保存。</p></div>
            <div class="memory-row-edit-tag-grid">
                ${tagRow('memory-row-edit-tag-topic', '主题', `<textarea id="memory-row-edit-tag-topic" rows="3" data-row-edit-tag="topic" data-row-edit-autogrow="true">${Core.escapeHtml(text('topic'))}</textarea>`)}
                ${tagRow('memory-row-edit-tag-scene', '场景', `<textarea id="memory-row-edit-tag-scene" rows="3" data-row-edit-tag="scene" data-row-edit-autogrow="true">${Core.escapeHtml(text('scene'))}</textarea>`)}
                ${tagRow('memory-row-edit-tag-entity', '主体', `<textarea id="memory-row-edit-tag-entity" rows="3" data-row-edit-tag="entity" data-row-edit-autogrow="true">${Core.escapeHtml(text('entity'))}</textarea>`)}
                ${tagRow('memory-row-edit-tag-effect', '作用', `<select id="memory-row-edit-tag-effect" data-row-edit-tag="effect">${effectOptions.map(option => `<option value="${option.value}" ${String(bundle.effect || 'historical_context') === option.value ? 'selected' : ''}>${Core.escapeHtml(option.label)}</option>`).join('')}</select>`)}
            </div>
        </section>`;
    }

    function render(options = {}) {
        const { chat, template, table, row = null, field = null } = options;
        if (!chat || !template || !table) return { title: '编辑记忆', html: '<p>编辑上下文不存在。</p>' };
        const fields = field ? [field] : (table.columns || []);
        const body = fields.map(item => {
            const value = row ? row.cells?.[item.id] : Domain.getFieldValue(chat, template.id, table.id, item);
            return fieldCard(chat, template, table, item, value);
        }).join('');
        const rowIndex = row ? Domain.getRows(chat, template.id, table).findIndex(item => item.id === row.id) + 1 : 0;
        return {
            title: row ? `${table.name} · 编辑第 ${rowIndex} 行` : `${table.name} · 编辑${field ? `「${field.key}」` : '档案'}`,
            html: `<form id="memory-row-edit-form" class="memory-row-edit-form" data-template-id="${Core.escapeAttribute(template.id)}" data-table-id="${Core.escapeAttribute(table.id)}" data-row-id="${Core.escapeAttribute(row?.id || '')}">
                <section class="memory-row-edit-kv-table" aria-label="记忆字段和值">
                    <div class="memory-row-edit-kv-head"><strong>字段</strong><strong>值</strong></div>
                    <div class="memory-row-edit-fields">${body}</div>
                </section>
                ${row ? tagEditor(row) : ''}
            </form>`
        };
    }

    function collect(form) {
        const values = {};
        form?.querySelectorAll?.('[data-row-edit-field]').forEach(input => {
            values[input.dataset.rowEditField] = input.type === 'checkbox' ? input.checked : input.value;
        });
        const tagBundle = {};
        form?.querySelectorAll?.('[data-row-edit-tag]').forEach(input => { tagBundle[input.dataset.rowEditTag] = input.value; });
        return { values, tagBundle: Object.keys(tagBundle).length ? tagBundle : null };
    }

    Kernel.register('rowEditModal', Object.freeze({ VERSION: '2.13-R5.1', render, collect }));
})(window);
