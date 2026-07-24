(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const TablePolicy = Kernel.require('policy');
    const FieldSemantics = Kernel.get('fieldSemantics');

    const VERSION = '2.15-R0B';
    const SUBJECTS = Object.freeze(['user', 'assistant', 'relationship', 'system']);
    const EVIDENCE_MODES = Object.freeze(['explicit', 'inferred', 'manual']);
    const COMMIT_MODES = Object.freeze(['inherit', 'direct', 'review', 'candidate', 'runtime_only', 'manual_only']);

    function normalizeSubject(value) {
        return SUBJECTS.includes(value) ? value : 'user';
    }

    function normalizeEvidence(value) {
        return EVIDENCE_MODES.includes(value) ? value : 'explicit';
    }

    function normalizeCommitMode(value) {
        return COMMIT_MODES.includes(value) ? value : 'inherit';
    }

    function inferFieldPolicy(field, table) {
        const tablePolicy = TablePolicy.normalizeTablePolicy(table || {});
        const semanticDefaults = FieldSemantics?.policyDefaults?.(field, table)
            || { subject: 'user', evidence: 'explicit', commitMode: 'inherit', minConfidence: 65 };
        const semanticRole = FieldSemantics?.semanticRole?.(field, table) || 'custom';
        if ((tablePolicy.memoryLayer === 'core' || tablePolicy.memoryLayer === 'long')
            && semanticDefaults.commitMode === 'inherit'
            && !['relationship_definition', 'relationship_addressing', 'relationship_agreement'].includes(semanticRole)) {
            return { subject: semanticDefaults.subject, evidence: 'manual', commitMode: 'manual_only', minConfidence: 100 };
        }
        if (semanticDefaults.commitMode === 'inherit' && tablePolicy.commitPolicy?.mode === 'direct') {
            return { ...semanticDefaults, commitMode: 'direct' };
        }
        return { ...semanticDefaults };
    }

    function normalizeFieldPolicy(field, table) {
        const inferred = inferFieldPolicy(field, table);
        const raw = field?.writePolicy && typeof field.writePolicy === 'object' ? field.writePolicy : {};
        return {
            subject: normalizeSubject(raw.subject || inferred.subject),
            evidence: normalizeEvidence(raw.evidence || inferred.evidence),
            commitMode: normalizeCommitMode(raw.commitMode || inferred.commitMode),
            minConfidence: Math.max(0, Math.min(100, Number.isFinite(Number(raw.minConfidence)) ? Number(raw.minConfidence) : inferred.minConfidence))
        };
    }

    function tableCommitMode(table) {
        const mode = TablePolicy.normalizeTablePolicy(table || {}).commitPolicy?.mode || 'review';
        if (mode === 'promotion') return 'review';
        return mode;
    }

    function effectiveCommitMode(field, table) {
        const mode = normalizeFieldPolicy(field, table).commitMode;
        return mode === 'inherit' ? tableCommitMode(table) : mode;
    }

    function normalizeEvidenceSource(value) {
        const source = String(value || '').trim();
        if (source === 'manual' || source === 'user_manual') return 'manual';
        if (source === 'user_explicit' || source === 'explicit') return 'explicit';
        return 'inferred';
    }

    function assess(field, table, context = {}) {
        const policy = normalizeFieldPolicy(field, table);
        const sourceEvidence = normalizeEvidenceSource(context.evidence || context.source);
        const confidence = Math.max(0, Math.min(100, Number(context.confidence) || 0));
        let route = effectiveCommitMode(field, table);
        const reasons = [];

        if (context.manual === true || sourceEvidence === 'manual') {
            return { allowed: true, route: 'direct', policy, sourceEvidence, confidence: 100, reasons };
        }
        if (field?.aiEditable === false || route === 'manual_only') {
            return { allowed: false, route: 'blocked', policy, sourceEvidence, confidence, reasons: ['字段仅允许人工编辑'] };
        }
        if (policy.evidence === 'manual') {
            return { allowed: false, route: 'blocked', policy, sourceEvidence, confidence, reasons: ['字段要求人工证据'] };
        }
        if (policy.evidence === 'explicit' && sourceEvidence !== 'explicit') {
            reasons.push('缺少用户明确表达');
            if (route === 'direct') route = 'review';
        }
        if (confidence < policy.minConfidence) {
            reasons.push(`置信度低于 ${policy.minConfidence}`);
            if (route === 'direct') route = 'review';
        }
        const tableDirect = tableCommitMode(table) === 'direct';
        if (context.inferredRuntimeOnly === true
            && sourceEvidence === 'inferred'
            && !['blocked', 'manual_only', 'runtime_only'].includes(route)) {
            route = 'runtime_only';
            reasons.push(context.runtimeReason || '模型推断仅保留在会话运行态');
        }
        if (context.preferTableDirect === true
            && tableDirect
            && sourceEvidence === 'explicit'
            && confidence >= policy.minConfidence
            && policy.commitMode === 'candidate') {
            route = 'direct';
            reasons.length = 0;
        }
        if (route === 'promotion') route = 'review';
        return { allowed: route !== 'blocked', route, policy, sourceEvidence, confidence, reasons };
    }

    function ensureRuntimeState(chat) {
        chat.memoryTables ||= {};
        chat.memoryTables.runtimeState ||= {};
        const state = chat.memoryTables.runtimeState;
        state.fieldValues ||= {};
        state.schemaVersion = '2.14-R3';
        return state;
    }

    function setRuntimeValue(chat, templateId, tableId, fieldId, value, meta = {}) {
        const state = ensureRuntimeState(chat);
        state.fieldValues[templateId] ||= {};
        state.fieldValues[templateId][tableId] ||= {};
        const before = state.fieldValues[templateId][tableId][fieldId];
        state.fieldValues[templateId][tableId][fieldId] = {
            value: Core.clone(value),
            source: meta.source || 'assistant_inferred',
            confidence: Math.max(0, Math.min(100, Number(meta.confidence) || 0)),
            updatedAt: Date.now()
        };
        return { before, after: state.fieldValues[templateId][tableId][fieldId] };
    }

    function getRuntimeEntry(chat, templateId, tableId, fieldId) {
        return chat?.memoryTables?.runtimeState?.fieldValues?.[templateId]?.[tableId]?.[fieldId] || null;
    }

    function getDisplayValue(chat, templateId, tableId, table, field, formalValue, options = {}) {
        if (effectiveCommitMode(field, table) !== 'runtime_only') return formalValue;
        const runtimeEntry = getRuntimeEntry(chat, templateId, tableId, field?.id);
        if (runtimeEntry) return runtimeEntry.value;
        return options.allowLegacyFormalFallback === true ? formalValue : undefined;
    }

    function summarizeRoutes(table) {
        const counts = { direct: 0, review: 0, candidate: 0, runtime_only: 0, manual_only: 0, blocked: 0 };
        (table?.columns || []).forEach(field => {
            if (field?.aiEditable === false) {
                counts.blocked += 1;
                return;
            }
            const mode = effectiveCommitMode(field, table);
            if (Object.prototype.hasOwnProperty.call(counts, mode)) counts[mode] += 1;
            else counts.review += 1;
        });
        return counts;
    }

    function describe(field, table) {
        const policy = normalizeFieldPolicy(field, table);
        const mode = effectiveCommitMode(field, table);
        const subjectLabel = { user: '用户', assistant: '角色', relationship: '关系', system: '系统' }[policy.subject];
        const evidenceLabel = { explicit: '明确表达', inferred: '允许推断', manual: '仅人工' }[policy.evidence];
        const modeLabel = { direct: '直接', review: '审核', candidate: '候选', runtime_only: '仅运行态', manual_only: '仅人工', inherit: '继承表格' }[mode] || mode;
        return `${subjectLabel}/${evidenceLabel}/${modeLabel}/≥${policy.minConfidence}`;
    }

    Kernel.register('fieldPolicy', Object.freeze({
        VERSION,
        SUBJECTS,
        EVIDENCE_MODES,
        COMMIT_MODES,
        inferFieldPolicy,
        normalizeFieldPolicy,
        effectiveCommitMode,
        assess,
        ensureRuntimeState,
        setRuntimeValue,
        getRuntimeEntry,
        getDisplayValue,
        summarizeRoutes,
        describe
    }), { legacyGlobal: 'MemoryFieldPolicy' });
})(window);
