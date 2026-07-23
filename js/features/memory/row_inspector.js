(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const TagService = Kernel.require('tagService');
    const RelationService = Kernel.require('relationService');
    const TagVocabulary = Kernel.require('tagVocabulary');
    const Effects = Kernel.get('effects');

    const TABS = Object.freeze([
        { id: 'relations', label: '关联' },
        { id: 'tags', label: '标签' },
        { id: 'vocabulary', label: '词表' }
    ]);

    function tagInput(name, label, values, placeholder) {
        const value = Array.isArray(values) ? values.join(', ') : String(values || '');
        const listId = `memory-${name}-tags`;
        return `<label class="memory-row-inspector-field"><span>${Core.escapeHtml(label)}</span><input type="text" name="${Core.escapeAttribute(name)}" list="${Core.escapeAttribute(listId)}" value="${Core.escapeAttribute(value)}" placeholder="${Core.escapeAttribute(placeholder || '')}"></label>`;
    }

    function relationItem(target, item) {
        const label = RelationService.RELATION_LABELS[item.kind] || '相关记忆';
        const percent = Math.max(0, Math.min(100, Math.round((item.score || 0) * 100)));
        const excerpt = String(item.text || '').replace(/\s+/g, ' ').slice(0, 190);
        const needsReview = (['duplicate', 'review'].includes(item.kind) || Number(item.score) >= 0.55) && !item.explicit;
        const primaryAction = needsReview
            ? `<button type="button" class="btn btn-small btn-primary" data-action="review-row-relation" data-source-row-id="${Core.escapeAttribute(target.row.id)}" data-target-row-id="${Core.escapeAttribute(item.row.id)}">审核</button>`
            : `<button type="button" class="btn btn-small btn-secondary" data-action="open-related-row" data-row-id="${Core.escapeAttribute(item.row.id)}">查看</button>`;
        return `<li class="memory-row-relation-item" data-kind="${Core.escapeAttribute(item.kind)}">
            <div class="memory-row-relation-main">
                <div class="memory-row-relation-title"><strong>${Core.escapeHtml(item.table.name)}</strong><span>${Core.escapeHtml(label)}</span>${item.explicit ? '<span class="is-explicit">已建立</span>' : ''}<em>${percent}%</em></div>
                <p>${Core.escapeHtml(excerpt || '无可显示内容')}</p>
                <small>${Core.escapeHtml((item.reasons || []).join(' · ') || '内容与标签相关')}</small>
            </div>
            <div class="memory-row-relation-actions">
                ${primaryAction}
                ${needsReview ? `<button type="button" class="memory-row-text-action" data-action="open-related-row" data-row-id="${Core.escapeAttribute(item.row.id)}">先查看</button>` : ''}
                ${!item.explicit ? `<button type="button" class="memory-row-text-action" data-action="link-row-related-cross" data-source-row-id="${Core.escapeAttribute(target.row.id)}" data-target-row-id="${Core.escapeAttribute(item.row.id)}">仅关联</button>` : ''}
            </div>
        </li>`;
    }

    function reviewDiffs(review) {
        const fields = (review.fields || []).filter(item => !item.same && (item.currentText || item.candidateText)).slice(0, 16);
        if (!fields.length) return '<p class="memory-row-inspector-empty">两条记录没有可展示的字段差异。</p>';
        return `<div class="memory-row-review-diffs">${fields.map(item => `<article class="memory-row-review-diff ${item.conflict ? 'is-conflict' : ''}">
            <strong>${Core.escapeHtml(item.key)}</strong>
            <div><span>当前</span><p>${Core.escapeHtml(item.currentText || '—')}</p></div>
            <div><span>候选</span><p>${Core.escapeHtml(item.candidateText || '—')}</p></div>
        </article>`).join('')}</div>`;
    }

    function reviewPanel(review) {
        if (!review?.current || !review?.candidate) return '';
        return `<section class="memory-row-review-panel" aria-label="记忆去重与冲突审核">
            <div class="memory-row-review-toolbar"><button type="button" class="memory-row-back-action" data-action="cancel-row-review">← 返回关联</button><div class="memory-row-review-summary"><span>可补齐 ${review.fillCurrentCount || 0}/${review.fillCandidateCount || 0}</span><span>差异 ${review.conflictCount || 0}</span><span>来源 ${review.sourceIds?.length || 0}</span></div></div>
            <header class="memory-row-review-title"><h3>去重与冲突审核</h3><p>先比较，再决定保留哪条。合并不会覆盖双方已有的非空正文，也不会直接删除记录。</p></header>
            <div class="memory-row-review-records">
                <article><span>当前记录</span><p>${Core.escapeHtml(review.current.text.slice(0, 700))}</p></article>
                <article><span>候选 · ${Core.escapeHtml(review.candidate.table.name)}</span><p>${Core.escapeHtml(review.candidate.text.slice(0, 700))}</p></article>
            </div>
            ${reviewDiffs(review)}
            <div class="memory-row-review-note">合并会汇总标签、来源证据和空字段，并将另一条标记为“已替代”；有冲突的正文仍由保留记录决定。</div>
            <div class="memory-row-review-actions" role="group" aria-label="审核决定">
                <button type="button" class="btn btn-small btn-primary" data-action="apply-row-review" data-decision="merge-current">合并到当前</button>
                <button type="button" class="btn btn-small btn-secondary" data-action="apply-row-review" data-decision="merge-candidate">合并到候选</button>
                <button type="button" class="btn btn-small btn-secondary" data-action="apply-row-review" data-decision="conflict">标记冲突</button>
                <button type="button" class="btn btn-small btn-secondary" data-action="apply-row-review" data-decision="related">仅建立关联</button>
            </div>
        </section>`;
    }

    function vocabularySection(chat) {
        const counts = TagVocabulary.count(chat);
        const aliases = TagVocabulary.list(chat).slice(-20).reverse();
        const labels = { topic: '主题', scene: '场景', entity: '主体' };
        return `<section class="memory-row-tab-panel memory-row-tag-merge" data-inspector-panel="vocabulary">
            <div class="memory-row-inspector-section-head"><div><h3>统一标签词表</h3><p>把旧标签归并到标准标签，后续模型写入时自动规范化。</p></div><span class="memory-tag-vocabulary-count">${counts.total} 条</span></div>
            <div class="memory-row-tag-merge-grid"><select name="tagMergeDimension" data-tag-merge-dimension><option value="topic">主题</option><option value="scene">场景</option><option value="entity">主体</option></select><input type="text" data-tag-merge-from placeholder="旧标签"><input type="text" data-tag-merge-to placeholder="标准标签"><button type="button" class="btn btn-small btn-primary" data-action="merge-memory-tags">合并</button></div>
            ${aliases.length ? `<ul class="memory-tag-vocabulary-list">${aliases.map(item => `<li><span>${labels[item.dimension] || item.dimension}</span><code>${Core.escapeHtml(item.aliasKey)}</code><b>→</b><strong>${Core.escapeHtml(item.canonical)}</strong><button type="button" data-action="remove-tag-alias" data-dimension="${Core.escapeAttribute(item.dimension)}" data-alias="${Core.escapeAttribute(item.aliasKey)}" aria-label="删除词表规则">×</button></li>`).join('')}</ul>` : '<p class="memory-row-inspector-empty">尚未建立同义标签规则。</p>'}
        </section>`;
    }

    function tagSection(chat, target, bundle, inventory, busy) {
        const optionsHtml = dimension => (inventory[dimension] || []).slice(0, 30).map(([tag]) => `<option value="${Core.escapeAttribute(tag)}"></option>`).join('');
        return `<form class="memory-row-tab-panel memory-row-tag-form" data-inspector-panel="tags" data-row-tag-form data-row-id="${Core.escapeAttribute(target.row.id)}">
            <div class="memory-row-inspector-section-head"><div><h3>标签</h3><p>继续使用现有 tagBundle；词表会在写入时自动归一。</p></div><label class="memory-row-tag-lock"><input type="checkbox" name="tagLocked" ${TagService.isLocked(target.row) ? 'checked' : ''}> 锁定</label></div>
            ${tagInput('topic', '主题', bundle.topic, '睡眠, 主动求助, 关系信任')}${tagInput('scene', '场景', bundle.scene, '睡前交流, 健康追踪')}${tagInput('entity', '主体', bundle.entity, '用户, 角色, 项目')}
            <label class="memory-row-inspector-field"><span>作用</span><select name="effect">${(Effects?.effectOptions?.() || [{value:'fact',label:'已确认事实'},{value:'temporary_state',label:'临时状态'},{value:'soft_preference',label:'柔性偏好'},{value:'hard_boundary',label:'明确边界'},{value:'reminder',label:'提醒事项'},{value:'historical_context',label:'历史背景'},{value:'candidate',label:'未审核候选'}]).map(option => `<option value="${option.value}" ${bundle.effect === option.value ? 'selected' : ''}>${Core.escapeHtml(option.label)}</option>`).join('')}</select></label>
            <div class="memory-row-inspector-actions"><button type="submit" class="btn btn-small btn-primary">保存标签</button><button type="button" class="btn btn-small btn-secondary" data-action="regenerate-row-tags" data-row-id="${Core.escapeAttribute(target.row.id)}" ${busy ? 'disabled' : ''}>${busy ? '生成中…' : '大模型重算'}</button></div>
            <datalist id="memory-topic-tags">${optionsHtml('topic')}</datalist><datalist id="memory-scene-tags">${optionsHtml('scene')}</datalist><datalist id="memory-entity-tags">${optionsHtml('entity')}</datalist>
        </form>`;
    }

    function relationSection(target, analysis, hasRelations) {
        const items = Array.isArray(analysis?.items) ? analysis.items.slice(0, 8) : [];
        return `<section class="memory-row-tab-panel memory-row-inspector-relations" data-inspector-panel="relations">
            <div class="memory-row-inspector-section-head"><div><h3>相关记忆</h3><p>候选只用于核对；重复、冲突和替代必须经过人工确认。</p></div><button type="button" class="memory-row-text-action" data-action="refresh-row-relations">重新分析</button></div>
            ${items.length ? `<ul>${items.map(item => relationItem(target, item)).join('')}</ul>` : '<p class="memory-row-inspector-empty">暂未找到相关记忆。</p>'}
            ${Number(analysis?.items?.length || 0) > items.length ? `<p class="memory-row-inspector-limit">仅显示最相关的 ${items.length} 条候选，共分析到 ${analysis.items.length} 条。</p>` : ''}
            ${hasRelations ? `<button type="button" class="memory-row-danger-action" data-action="clear-row-relations-cross" data-row-id="${Core.escapeAttribute(target.row.id)}">清除当前记录的全部关系</button>` : ''}
        </section>`;
    }

    function tabNavigation(activeTab, counts, vocabularyCount) {
        return `<nav class="memory-row-inspector-tabs" aria-label="记忆详情区域">${TABS.map(tab => {
            const count = tab.id === 'relations'
                ? ((counts.duplicate || 0) + (counts.conflict || 0) + (counts.review || 0) + (counts.related || 0))
                : (tab.id === 'vocabulary' ? vocabularyCount : 0);
            return `<button type="button" data-action="switch-row-inspector-tab" data-tab="${tab.id}" class="${activeTab === tab.id ? 'active' : ''}" aria-selected="${activeTab === tab.id ? 'true' : 'false'}">${tab.label}${count ? `<span>${count}</span>` : ''}</button>`;
        }).join('')}</nav>`;
    }

    function render(options = {}) {
        const { chat, target, analysis, review = null, busy = false } = options;
        if (!chat || !target) return '';
        const activeTab = TABS.some(tab => tab.id === options.tab) ? options.tab : 'relations';
        const bundle = TagService.normalize(target.row.meta?.tagBundle || {});
        const counts = analysis?.counts || {};
        const inventory = RelationService.tagInventory(chat);
        const vocabularyCount = TagVocabulary.count(chat).total || 0;
        const relationSummary = [
            counts.duplicate ? `可能重复 ${counts.duplicate}` : '',
            counts.conflict ? `冲突 ${counts.conflict}` : '',
            counts.review ? `需核对 ${counts.review}` : '',
            counts.related ? `相关 ${counts.related}` : ''
        ].filter(Boolean).join(' · ') || '暂未发现明显关联';
        const hasRelations = ['supersedes', 'supersededBy', 'conflictsWith', 'relatedTo'].some(key => target.row.meta?.relations?.[key]?.length);
        const panel = activeTab === 'tags'
            ? tagSection(chat, target, bundle, inventory, busy)
            : (activeTab === 'vocabulary' ? vocabularySection(chat) : relationSection(target, analysis, hasRelations));
        return `<button type="button" class="memory-row-inspector-backdrop visible" data-action="close-row-inspector" aria-label="关闭记忆详情"></button>
        <aside class="memory-row-inspector visible ${review ? 'is-review' : ''}" aria-label="记忆关联与标签">
            <header class="memory-row-inspector-head"><div><strong>${Core.escapeHtml(review ? '记忆审核' : target.table.name)}</strong><span>${Core.escapeHtml(review ? `${target.table.name} · 第 ${target.rowIndex + 1} 行` : `第 ${target.rowIndex + 1} 行 · ${target.template.name}`)}</span></div><button type="button" class="memory-row-inspector-close" data-action="close-row-inspector" aria-label="关闭">×</button></header>
            ${review ? '' : tabNavigation(activeTab, counts, vocabularyCount)}
            <div class="memory-row-inspector-scroll">
                ${review ? reviewPanel(review) : `<section class="memory-row-inspector-summary"><p>${Core.escapeHtml(target.text.slice(0, 900) || '当前记录没有可显示内容')}</p><div class="memory-row-inspector-stats"><span>${Core.escapeHtml(relationSummary)}</span><span>${TagService.isLocked(target.row) ? '标签已锁定' : '标签可由模型更新'}</span></div></section>${panel}`}
            </div>
        </aside>`;
    }

    Kernel.register('rowInspector', Object.freeze({ VERSION: '2.11-R3.1', render }));
})(window);
