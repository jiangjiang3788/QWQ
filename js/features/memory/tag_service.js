(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const TagVocabulary = Kernel.get('tagVocabulary');
    const EFFECTS = new Set(['fact', 'temporary_state', 'soft_preference', 'hard_boundary', 'reminder', 'historical_context', 'candidate']);

    function normalizeList(value, limit) {
        const source = Array.isArray(value) ? value : String(value || '').split(/[,，、;；\n]/);
        return Core.unique(source.map(item => String(item || '').trim()).filter(Boolean), limit);
    }

    function normalize(bundle) {
        const raw = bundle && typeof bundle === 'object' ? bundle : {};
        const effectRaw = String(raw.effect || '').trim();
        return {
            topic: normalizeList(raw.topic, 6),
            scene: normalizeList(raw.scene, 5),
            entity: normalizeList(raw.entity, 5),
            effect: EFFECTS.has(effectRaw) ? effectRaw : (effectRaw || 'historical_context')
        };
    }

    function equals(a, b) {
        return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
    }

    function parseAttributeList(node, name) {
        return normalizeList(node?.getAttribute?.(name) || '', name === 'topic' ? 6 : 5);
    }

    function parseRowNode(rowNode) {
        if (!rowNode) return null;
        const node = Array.from(rowNode.children || []).find(child => child.tagName === 'tags' || child.tagName === 'tag_bundle');
        if (!node) return null;
        return normalize({
            topic: parseAttributeList(node, 'topic'),
            scene: parseAttributeList(node, 'scene'),
            entity: parseAttributeList(node, 'entity'),
            effect: node.getAttribute('effect') || 'historical_context'
        });
    }

    function isLocked(row) {
        return !!row?.meta?.tagLocked;
    }

    function setLocked(row, locked) {
        if (!row) return false;
        row.meta ||= {};
        const next = !!locked;
        const changed = !!row.meta.tagLocked !== next;
        row.meta.tagLocked = next;
        if (changed) row.meta.updatedAt = Date.now();
        return changed;
    }

    function applyToRow(row, bundle, options = {}) {
        if (!row || !bundle) return { changed: false, oldValue: null, newValue: null, locked: false };
        if (isLocked(row) && options.force !== true) {
            return { changed: false, oldValue: normalize(row.meta?.tagBundle || {}), newValue: normalize(bundle), locked: true };
        }
        const next = TagVocabulary && options.chat ? normalize(TagVocabulary.canonicalizeBundle(options.chat, bundle)) : normalize(bundle);
        row.meta ||= {};
        const oldValue = normalize(row.meta.tagBundle || {});
        if (equals(oldValue, next)) return { changed: false, oldValue, newValue: next };
        row.meta.tagBundle = next;
        row.meta.updatedAt = Date.now();
        row.meta.retrievalVector = [];
        row.meta.retrievalVectorFingerprint = '';
        if (options.source) row.meta.tagSource = String(options.source);
        return { changed: true, oldValue, newValue: next, locked: false };
    }

    function buildRegenerationPrompt(table, row, related = [], options = {}) {
        const rowText = (table?.columns || []).map(field => `${field.key}: ${row?.cells?.[field.id] ?? ''}`).join('\n');
        const relatedText = (related || []).slice(0, 6).map(item => `- ${item.table?.name || ''} [${item.row?.id || ''}] ${String(item.text || '').slice(0, 500)}`).join('\n');
        return `请只为下面这条结构化记忆重新生成标签，不要修改记忆正文。\n\n严格返回：\n<tags topic="主题1,主题2" scene="场景1" entity="主体1" effect="historical_context"/>\n\n规则：\n1. topic 1–6 个稳定主题；scene 0–5 个使用场景；entity 只写明确主体。\n2. effect 只能是 fact、temporary_state、soft_preference、hard_boundary、reminder、historical_context 或 candidate。\n3. 不要堆同义词，不要因为相关记忆有某标签就机械复制。\n\n目标表：${table?.name || ''}\n目标行ID：${row?.id || ''}\n目标内容：\n${rowText}\n\n相关记忆（仅供消歧）：\n${relatedText || '无'}${TagVocabulary && options.chat ? TagVocabulary.promptText(options.chat, 30) : ''}`;
    }

    function parseGeneratedBundle(rawText) {
        const text = String(rawText || '').trim();
        if (!text) return null;
        const xmlMatch = text.match(/<tags\b[^>]*\/?>(?:<\/tags>)?/i);
        if (xmlMatch && typeof DOMParser !== 'undefined') {
            const doc = new DOMParser().parseFromString(`<root>${xmlMatch[0]}</root>`, 'text/xml');
            const node = doc.querySelector('tags');
            if (node) return normalize({
                topic: node.getAttribute('topic') || '',
                scene: node.getAttribute('scene') || '',
                entity: node.getAttribute('entity') || '',
                effect: node.getAttribute('effect') || ''
            });
        }
        const jsonText = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
        try {
            const parsed = JSON.parse(jsonText);
            return normalize(parsed.tags || parsed.tagBundle || parsed);
        } catch (_) {
            return null;
        }
    }

    function summarize(bundle) {
        const value = normalize(bundle);
        const parts = [];
        if (value.topic.length) parts.push(`主题：${value.topic.join('、')}`);
        if (value.scene.length) parts.push(`场景：${value.scene.join('、')}`);
        if (value.entity.length) parts.push(`主体：${value.entity.join('、')}`);
        if (value.effect) parts.push(`作用：${value.effect}`);
        return parts.join('；');
    }

    function buildPromptInstructions() {
        return `\n8. 对 rows 表的新增行和有实质变化的更新行，必须根据整行内容生成标签，并在 row 节点内输出一个 <tags>：\n   <tags topic="主题1,主题2" scene="场景1,场景2" entity="主体1,主体2" effect="historical_context"/>\n9. topic 只保留 1–6 个稳定主题；scene 只保留 0–5 个使用场景；entity 只保留明确出现的主体；不要生成同义词堆叠。\n10. effect 只能表达这条记忆的主要用途，只能是 fact、temporary_state、soft_preference、hard_boundary、reminder、historical_context 或 candidate。\n11. 标签必须来自记忆内容本身，不得因为相关表中出现某标签就机械复制。`;
    }

    const api = Object.freeze({
        VERSION: '2.11-R3.1',
        normalize,
        equals,
        parseRowNode,
        applyToRow,
        isLocked,
        setLocked,
        summarize,
        buildPromptInstructions,
        buildRegenerationPrompt,
        parseGeneratedBundle
    });

    Kernel.register('tagService', api, { legacyGlobal: 'MemoryTagService' });
})(window);
