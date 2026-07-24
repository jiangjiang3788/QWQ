(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Domain = Kernel.require('domain');
    const TagService = Kernel.require('tagService');
    const RelationService = Kernel.require('relationService');
    const TagVocabulary = Kernel.require('tagVocabulary');
    const Lifecycle = Kernel.get('lifecycle');
    const Policy = Kernel.get('policy');
    const Provenance = Kernel.get('provenanceService');
    const FieldSemantics = Kernel.require('fieldSemantics');

    function clone(value) {
        return Core.clone ? Core.clone(value) : JSON.parse(JSON.stringify(value));
    }

    function isEmpty(field, value) {
        if (Domain.isEmptyMemoryValue) return Domain.isEmptyMemoryValue(field, value);
        if (Array.isArray(value)) return value.length === 0;
        return value === undefined || value === null || String(value).trim() === '';
    }

    function fieldMatchKey(field, table) {
        const role = FieldSemantics.semanticRole(field, table);
        return role && role !== 'custom' ? `semantic:${role}` : `key:${String(field?.key || '').trim()}`;
    }

    function fieldMap(descriptor) {
        const result = new Map();
        (descriptor?.table?.columns || [])
            .filter(field => !FieldSemantics.isTechnical(field, descriptor?.table))
            .forEach(field => result.set(fieldMatchKey(field, descriptor?.table), field));
        return result;
    }

    function preview(chat, currentId, candidateId) {
        const current = RelationService.findById(chat, currentId);
        const candidate = RelationService.findById(chat, candidateId);
        if (!current || !candidate) return null;
        const currentFields = fieldMap(current);
        const candidateFields = fieldMap(candidate);
        const keys = Core.unique([...currentFields.keys(), ...candidateFields.keys()].filter(Boolean), 80);
        const fields = keys.map(matchKey => {
            const leftField = currentFields.get(matchKey), rightField = candidateFields.get(matchKey);
            const key = String(leftField?.key || rightField?.key || matchKey.replace(/^[^:]+:/, ''));
            const leftValue = leftField ? current.row.cells?.[leftField.id] : undefined;
            const rightValue = rightField ? candidate.row.cells?.[rightField.id] : undefined;
            const leftText = leftField ? String(Domain.getFieldDisplayValue(leftField, leftValue) ?? '') : '';
            const rightText = rightField ? String(Domain.getFieldDisplayValue(rightField, rightValue) ?? '') : '';
            const same = JSON.stringify(leftValue) === JSON.stringify(rightValue);
            return {
                key,
                matchKey,
                currentFieldId: leftField?.id || '',
                candidateFieldId: rightField?.id || '',
                currentValue: leftValue,
                candidateValue: rightValue,
                currentText: leftText,
                candidateText: rightText,
                same,
                canFillCurrent: !!leftField && !!rightField && isEmpty(leftField, leftValue) && !isEmpty(rightField, rightValue),
                canFillCandidate: !!leftField && !!rightField && isEmpty(rightField, rightValue) && !isEmpty(leftField, leftValue),
                conflict: !!leftField && !!rightField && !same && !isEmpty(leftField, leftValue) && !isEmpty(rightField, rightValue)
            };
        });
        const currentBundle = TagService.normalize(current.row.meta?.tagBundle || {});
        const candidateBundle = TagService.normalize(candidate.row.meta?.tagBundle || {});
        const mergedBundle = TagVocabulary.canonicalizeBundle(chat, {
            topic: [...currentBundle.topic, ...candidateBundle.topic],
            scene: [...currentBundle.scene, ...candidateBundle.scene],
            entity: [...currentBundle.entity, ...candidateBundle.entity],
            effect: currentBundle.effect || candidateBundle.effect
        });
        const sourceIds = Core.unique([...(current.row.meta?.sourceMessageIds || []), ...(candidate.row.meta?.sourceMessageIds || [])], 200);
        return {
            current,
            candidate,
            fields,
            fillCurrentCount: fields.filter(item => item.canFillCurrent).length,
            fillCandidateCount: fields.filter(item => item.canFillCandidate).length,
            conflictCount: fields.filter(item => item.conflict).length,
            mergedBundle,
            sourceIds,
            relation: RelationService.scoreCandidate(current, candidate)
        };
    }

    function mergeRelations(winner, loser) {
        if (!Lifecycle) return;
        const winnerMeta = Lifecycle.ensureRowMeta(winner, null, '');
        const loserMeta = Lifecycle.ensureRowMeta(loser, null, '');
        ['relatedTo', 'conflictsWith'].forEach(key => {
            winnerMeta.relations[key] = Core.unique([
                ...(winnerMeta.relations[key] || []),
                ...(loserMeta.relations[key] || [])
            ].filter(id => id !== winner.id && id !== loser.id), 160);
        });
        winnerMeta.relations.supersedes = Core.unique([
            ...(winnerMeta.relations.supersedes || []),
            ...(loserMeta.relations.supersedes || [])
        ].filter(id => id !== winner.id && id !== loser.id), 160);
    }

    function recordAudit(chat, entry) {
        chat.memoryTables ||= {};
        const history = Array.isArray(chat.memoryTables.mergeAudit) ? chat.memoryTables.mergeAudit : [];
        history.unshift({ id: Core.createId('memory_merge'), at: Date.now(), ...entry });
        chat.memoryTables.mergeAudit = history.slice(0, 40);
    }

    function applyMerge(chat, winnerId, loserId, options = {}) {
        const plan = preview(chat, winnerId, loserId);
        if (!plan) return { changed: false, reason: '记录不存在' };
        const winner = plan.current;
        const loser = plan.candidate;
        const winnerFields = fieldMap(winner);
        const loserFields = fieldMap(loser);
        const changedFields = [];
        if (options.copyEmptyFields !== false) {
            plan.fields.forEach(item => {
                if (!item.canFillCurrent) return;
                const winnerField = winnerFields.get(item.matchKey), loserField = loserFields.get(item.matchKey);
                if (!winnerField || !loserField) return;
                const oldValue = clone(winner.row.cells?.[winnerField.id]);
                const newValue = clone(loser.row.cells?.[loserField.id]);
                Domain.updateRowFieldValue(chat, winner.template.id, winner.table, winner.row.id, winnerField, newValue, {
                    source: 'manual_memory_merge_v2_14_r2',
                    skipHistory: true
                });
                changedFields.push({ key: item.key, fieldId: winnerField.id, oldValue, newValue });
            });
        }
        winner.row.meta ||= {};
        loser.row.meta ||= {};
        const tags = TagService.applyToRow(winner.row, plan.mergedBundle, {
            chat,
            source: 'manual_memory_merge_v2_11_r3',
            force: options.forceTags === true || !TagService.isLocked(winner.row)
        });
        winner.row.meta.sourceMessageIds = plan.sourceIds;
        if (winner.row.meta.evidence && loser.row.meta.evidence) {
            const refs = [...(winner.row.meta.evidence.sourceRefs || []), ...(loser.row.meta.evidence.sourceRefs || [])];
            const seen = new Set();
            winner.row.meta.evidence.sourceRefs = refs.filter(ref => {
                const signature = `${ref?.type || ''}:${ref?.id || ''}:${ref?.at || 0}`;
                if (seen.has(signature)) return false;
                seen.add(signature);
                return true;
            }).slice(-120);
        }
        mergeRelations(winner.row, loser.row);
        if (Lifecycle) Lifecycle.linkRows(winner.row, loser.row, 'supersedes');
        winner.row.meta.updatedAt = Date.now();
        winner.row.meta.retrievalVector = [];
        winner.row.meta.retrievalVectorFingerprint = '';
        if (Policy) Policy.clearRetrievalCache(chat);
        recordAudit(chat, {
            action: 'merge',
            winnerId: winner.row.id,
            loserId: loser.row.id,
            winnerTableId: winner.table.id,
            loserTableId: loser.table.id,
            copiedFieldKeys: changedFields.map(item => item.key),
            mergedSourceCount: plan.sourceIds.length,
            tagsChanged: !!tags.changed,
            conflictFieldCount: plan.conflictCount
        });
        Provenance?.record?.(winner.row, 'merge', {
            actor: 'user', source: 'manual',
            reason: `合并另一条记忆，补齐 ${changedFields.length} 个字段并汇总 ${plan.sourceIds.length} 个来源`,
            fieldIds: changedFields.map(item => item.fieldId),
            relatedRowIds: [loser.row.id]
        });
        return {
            changed: true,
            winner,
            loser,
            copiedFields: changedFields,
            tags,
            mergedSourceCount: plan.sourceIds.length,
            conflictFieldCount: plan.conflictCount
        };
    }

    function resolve(chat, currentId, candidateId, decision) {
        const current = RelationService.findById(chat, currentId);
        const candidate = RelationService.findById(chat, candidateId);
        if (!current || !candidate) return { changed: false, reason: '记录不存在' };
        let result = null;
        if (decision === 'merge-current') result = applyMerge(chat, currentId, candidateId);
        else if (decision === 'merge-candidate') result = applyMerge(chat, candidateId, currentId);
        else if (decision === 'current-supersedes') result = { changed: RelationService.link(chat, currentId, candidateId, 'supersedes') };
        else if (decision === 'candidate-supersedes') result = { changed: RelationService.link(chat, candidateId, currentId, 'supersedes') };
        else if (decision === 'conflict') result = { changed: RelationService.link(chat, currentId, candidateId, 'conflict') };
        else if (decision === 'related') result = { changed: RelationService.link(chat, currentId, candidateId, 'related') };
        else result = { changed: false, reason: '未知审核动作' };
        if (result.changed && !String(decision).startsWith('merge-')) {
            recordAudit(chat, { action: decision, currentId, candidateId });
            if (Policy) Policy.clearRetrievalCache(chat);
        }
        return result;
    }

    const api = Object.freeze({
        VERSION: '2.15-R0B',
        preview,
        applyMerge,
        resolve
    });

    Kernel.register('mergeReviewService', api, { legacyGlobal: 'MemoryMergeReviewService' });
})(window);
