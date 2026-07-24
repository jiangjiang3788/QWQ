(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const TablePolicy = Kernel.require('policy');

    const SUBJECTS = Object.freeze(['user', 'assistant', 'relationship', 'system']);
    const EVIDENCE_MODES = Object.freeze(['explicit', 'inferred', 'manual']);
    const COMMIT_MODES = Object.freeze(['inherit', 'direct', 'review', 'candidate', 'runtime_only', 'manual_only']);

    const INFERRED_PATTERN = /精神|情绪|体力|精力|风险|倾向|判断|推测|状态评分|好感|关系阶段|依赖程度|信任|亲密度/i;
    const RUNTIME_PATTERN = /角色.*判断|回应策略|回复策略|角色策略|边界提醒|下一步建议|系统提醒|内部判断|assistant_|role_|char_/i;
    const SYSTEM_META_PATTERN = /事件ID|记录ID|原始记录ID|状态记录时间|状态有效期|创建时间|最后更新时间|更新时间|完成时间|游标|索引/i;
    const EXPLICIT_PATTERN = /当前场景|身体状态|当前需求|压力源|近期变化|标题|内容|截止|后续待办|当前状态|结果|取消原因|偏好|边界|称呼/i;

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
        const identity = `${field?.group || ''} ${field?.key || ''} ${field?.summaryLabel || ''} ${field?.aiHint || ''}`;
        const tablePolicy = TablePolicy.normalizeTablePolicy(table || {});
        let subject = 'user';
        let evidence = 'explicit';
        let commitMode = 'inherit';
        let minConfidence = 60;

        if (RUNTIME_PATTERN.test(identity)) {
            subject = /边界/.test(identity) ? 'relationship' : 'assistant';
            evidence = 'inferred';
            commitMode = 'runtime_only';
            minConfidence = 0;
        } else if (SYSTEM_META_PATTERN.test(identity)) {
            subject = 'system';
            evidence = 'inferred';
            commitMode = 'direct';
            minConfidence = 0;
        } else if (INFERRED_PATTERN.test(identity)) {
            subject = /关系|好感|依赖|信任|亲密/.test(identity) ? 'relationship' : 'user';
            evidence = 'inferred';
            commitMode = tablePolicy.memoryLayer === 'short' ? 'candidate' : 'review';
            minConfidence = 75;
        } else if (EXPLICIT_PATTERN.test(identity)) {
            subject = /边界|称呼/.test(identity) ? 'relationship' : 'user';
            evidence = 'explicit';
            commitMode = tablePolicy.commitPolicy?.mode === 'direct' ? 'direct' : 'inherit';
            minConfidence = 65;
        } else if (tablePolicy.memoryLayer === 'core' || tablePolicy.memoryLayer === 'long') {
            subject = 'user';
            evidence = 'manual';
            commitMode = 'manual_only';
            minConfidence = 100;
        }
        return { subject, evidence, commitMode, minConfidence };
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

    function getDisplayValue(chat, templateId, tableId, table, field, formalValue) {
        return effectiveCommitMode(field, table) === 'runtime_only'
            ? (getRuntimeEntry(chat, templateId, tableId, field?.id)?.value ?? formalValue)
            : formalValue;
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
        VERSION: '2.14-R3',
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
        describe
    }), { legacyGlobal: 'MemoryFieldPolicy' });
})(window);
