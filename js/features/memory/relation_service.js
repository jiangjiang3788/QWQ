(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Domain = Kernel.require('domain');
    const Policy = Kernel.require('policy');
    const Effects = Kernel.get('effects');
    const Lifecycle = Kernel.get('lifecycle');
    const TagVocabulary = Kernel.require('tagVocabulary');
    const FieldSemantics = Kernel.require('fieldSemantics');

    const RELATION_LABELS = Object.freeze({
        duplicate: '可能重复',
        conflict: '存在冲突',
        supersedes: '当前记录可替代旧记录',
        superseded_by: '已被较新记录替代',
        related: '相关记忆',
        review: '需要核对'
    });

    function normalizeList(value) {
        const source = Array.isArray(value) ? value : String(value || '').split(/[,，、;；\n]/);
        return Core.unique(source.map(item => String(item || '').trim().toLowerCase()).filter(Boolean), 40);
    }

    function rowText(table, row) {
        const meaningful = (table?.columns || []).filter(field => !FieldSemantics.isTechnical(field, table)).map(field => {
            const value = Domain.getFieldDisplayValue ? Domain.getFieldDisplayValue(field, row?.cells?.[field.id]) : row?.cells?.[field.id];
            const text = String(value ?? '').replace(/\s+/g, ' ').trim();
            return text ? `${field.key}: ${text}` : '';
        }).filter(Boolean).join(' ');
        return meaningful.replace(/\s+/g, ' ').trim();
    }

    function tokenize(text) {
        const source = String(text || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
        const tokens = new Set();
        const ascii = String(text || '').toLowerCase().match(/[a-z0-9_]{2,}/g) || [];
        ascii.forEach(token => tokens.add(token));
        for (let index = 0; index < source.length; index += 1) {
            const one = source[index];
            if (one) tokens.add(one);
            const pair = source.slice(index, index + 2);
            if (pair.length === 2) tokens.add(pair);
        }
        return tokens;
    }

    function overlapRatio(a, b) {
        const left = new Set(normalizeList(a));
        const right = new Set(normalizeList(b));
        if (!left.size || !right.size) return 0;
        let same = 0;
        left.forEach(value => { if (right.has(value)) same += 1; });
        return same / Math.max(1, Math.min(left.size, right.size));
    }

    function textSimilarity(a, b) {
        const left = tokenize(a);
        const right = tokenize(b);
        if (!left.size || !right.size) return 0;
        let same = 0;
        left.forEach(value => { if (right.has(value)) same += 1; });
        return same / Math.max(1, left.size + right.size - same);
    }

    function sourceOverlap(a, b) {
        const left = new Set((a?.meta?.sourceMessageIds || []).map(String));
        const right = new Set((b?.meta?.sourceMessageIds || []).map(String));
        if (!left.size || !right.size) return 0;
        let same = 0;
        left.forEach(value => { if (right.has(value)) same += 1; });
        return same / Math.max(1, Math.min(left.size, right.size));
    }

    function getBoundRows(chat) {
        const rows = [];
        Domain.getBoundTemplates(chat).forEach(template => {
            (template.tables || []).forEach(table => {
                if (!Domain.isRowsTable(table)) return;
                Domain.getRows(chat, template.id, table).forEach((row, rowIndex) => {
                    if (Effects) Effects.ensureRowMeta(row, table, rowText(table, row));
                    if (Lifecycle) Lifecycle.ensureRowMeta(row, table, rowText(table, row));
                    rows.push({ template, table, row, rowIndex, text: rowText(table, row) });
                });
            });
        });
        return rows;
    }

    function findById(chat, rowId) {
        return getBoundRows(chat).find(item => item.row.id === rowId) || null;
    }

    function existingRelation(target, candidate) {
        const relations = target?.row?.meta?.relations || {};
        const id = candidate?.row?.id;
        if (!id) return null;
        if ((relations.conflictsWith || []).includes(id)) return 'conflict';
        if ((relations.supersedes || []).includes(id)) return 'supersedes';
        if ((relations.supersededBy || []).includes(id)) return 'superseded_by';
        if ((relations.relatedTo || []).includes(id)) return 'related';
        return null;
    }

    function detectOpposition(targetText, candidateText) {
        const negative = /(不再|不喜欢|不需要|没有|取消|停止|拒绝|避免|不能|未完成|已结束|失效)/g;
        const positive = /(喜欢|需要|已经|确认|继续|接受|愿意|完成|有效|保持)/;
        const targetNegative = negative.test(targetText);
        negative.lastIndex = 0;
        const candidateNegative = negative.test(candidateText);
        negative.lastIndex = 0;
        const targetPositive = positive.test(String(targetText || '').replace(negative, ''));
        negative.lastIndex = 0;
        const candidatePositive = positive.test(String(candidateText || '').replace(negative, ''));
        negative.lastIndex = 0;
        return (targetNegative && candidatePositive && !candidateNegative) || (candidateNegative && targetPositive && !targetNegative);
    }

    function scoreCandidate(target, candidate) {
        const targetTags = target.row.meta?.tagBundle || {};
        const candidateTags = candidate.row.meta?.tagBundle || {};
        const topic = overlapRatio(targetTags.topic, candidateTags.topic);
        const scene = overlapRatio(targetTags.scene, candidateTags.scene);
        const entity = overlapRatio(targetTags.entity, candidateTags.entity);
        const text = textSimilarity(target.text, candidate.text);
        const sources = sourceOverlap(target.row, candidate.row);
        const sameTable = target.table.id === candidate.table.id ? 1 : 0;
        const score = Math.min(1, topic * 0.28 + scene * 0.12 + entity * 0.16 + text * 0.34 + sources * 0.06 + sameTable * 0.04);
        const explicit = existingRelation(target, candidate);
        let kind = explicit || 'related';
        if (!explicit) {
            if ((text >= 0.80 && (topic >= 0.5 || entity >= 0.5)) || text >= 0.92) kind = 'duplicate';
            else if (score >= 0.58 && detectOpposition(target.text, candidate.text)) kind = 'review';
            else if (score >= 0.60 && sameTable && topic >= 0.5 && text >= 0.45) kind = 'review';
            else kind = 'related';
        }
        const reasons = [];
        if (explicit) reasons.push('已有人工关系');
        if (topic > 0) reasons.push(`主题重合 ${Math.round(topic * 100)}%`);
        if (scene > 0) reasons.push(`场景重合 ${Math.round(scene * 100)}%`);
        if (entity > 0) reasons.push(`主体重合 ${Math.round(entity * 100)}%`);
        if (text > 0.12) reasons.push(`内容相似 ${Math.round(text * 100)}%`);
        if (sources > 0) reasons.push('来源消息重叠');
        return { score, kind, explicit: !!explicit, reasons, metrics: { topic, scene, entity, text, sources } };
    }

    function analyze(chat, targetRef, options = {}) {
        const target = typeof targetRef === 'string' ? findById(chat, targetRef) : targetRef;
        if (!target) return { target: null, items: [], counts: {} };
        const topK = Math.max(3, Math.min(30, Number(options.topK) || 12));
        const threshold = Math.max(0.08, Math.min(0.95, Number(options.threshold) || 0.18));
        const items = getBoundRows(chat)
            .filter(candidate => candidate.row.id !== target.row.id && candidate.text.length >= 8 && target.text.length >= 8)
            .map(candidate => ({ ...candidate, ...scoreCandidate(target, candidate) }))
            .filter(candidate => candidate.explicit || candidate.score >= threshold)
            .sort((a, b) => {
                const priority = { conflict: 6, supersedes: 5, superseded_by: 5, duplicate: 4, review: 3, related: 1 };
                return (priority[b.kind] || 0) - (priority[a.kind] || 0) || b.score - a.score;
            })
            .slice(0, topK);
        const counts = {};
        items.forEach(item => { counts[item.kind] = (counts[item.kind] || 0) + 1; });
        return { target, items, counts };
    }

    function link(chat, sourceId, targetId, mode) {
        const source = findById(chat, sourceId);
        const target = findById(chat, targetId);
        if (!source || !target || !Lifecycle) return false;
        return Lifecycle.linkRows(source.row, target.row, mode);
    }

    function clear(chat, rowId) {
        const target = findById(chat, rowId);
        if (!target || !Lifecycle) return false;
        return Lifecycle.clearRelations(target.row, getBoundRows(chat).map(item => item.row));
    }

    function mergeTag(chat, options = {}) {
        const dimension = ['topic', 'scene', 'entity'].includes(options.dimension) ? options.dimension : 'topic';
        const from = String(options.from || '').trim();
        const to = String(options.to || '').trim();
        if (!from || !to || from === to) return { changedRows: 0, skippedLocked: 0 };
        let changedRows = 0;
        let skippedLocked = 0;
        getBoundRows(chat).forEach(item => {
            const row = item.row;
            if (row.meta?.tagLocked) {
                skippedLocked += 1;
                return;
            }
            const bundle = row.meta?.tagBundle || {};
            const values = Array.isArray(bundle[dimension]) ? bundle[dimension] : [];
            if (!values.some(value => TagVocabulary.key(value) === TagVocabulary.key(from))) return;
            bundle[dimension] = Core.unique(values.map(value => TagVocabulary.key(value) === TagVocabulary.key(from) ? to : value), dimension === 'topic' ? 6 : 5);
            row.meta.updatedAt = Date.now();
            row.meta.tagSource = 'manual_merge_v2_11_r3';
            row.meta.retrievalVector = [];
            row.meta.retrievalVectorFingerprint = '';
            changedRows += 1;
        });
        const vocabulary = TagVocabulary.registerAlias(chat, { dimension, alias: from, canonical: to });
        return { changedRows, skippedLocked, vocabulary };
    }

    function tagInventory(chat) {
        const inventory = { topic: new Map(), scene: new Map(), entity: new Map() };
        getBoundRows(chat).forEach(item => {
            const bundle = item.row.meta?.tagBundle || {};
            Object.keys(inventory).forEach(dimension => {
                (bundle[dimension] || []).forEach(tag => inventory[dimension].set(tag, (inventory[dimension].get(tag) || 0) + 1));
            });
        });
        return Object.fromEntries(Object.entries(inventory).map(([dimension, values]) => [dimension, Array.from(values.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))]));
    }

    const api = Object.freeze({
        VERSION: '2.11-R3.1',
        RELATION_LABELS,
        getBoundRows,
        findById,
        analyze,
        link,
        clear,
        mergeTag,
        tagInventory,
        textSimilarity,
        scoreCandidate
    });

    Kernel.register('relationService', api, { legacyGlobal: 'MemoryRelationService' });
})(window);
