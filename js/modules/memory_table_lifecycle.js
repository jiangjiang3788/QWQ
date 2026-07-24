// 结构化记忆 V2.14-R9：来源证据、生命周期维护计划、冲突与归档闭环
(function () {
    'use strict';

    const Kernel = window.OvoMemoryKernel || null;
    const Core = Kernel?.core;
    if (!Core) throw new Error('记忆内核未加载');
    const escapeHtml = Core.escapeHtml;
    const unique = (values, limit = 50) => Core.unique(values, limit);
    const getProvenance = () => Kernel?.get?.('provenanceService') || null;
    const getRecordIdentity = () => Kernel?.get?.('recordIdentity') || null;
    const LifecycleDefaults = Kernel?.get?.('memoryDefaults')?.DEFAULTS?.lifecycle || {};

    const VERSION = '2.15-R0B';
    const DAY = 86400000;
    const STATUS = Object.freeze({
        active: '当前有效',
        uncertain: '尚不确定',
        conflicting: '存在冲突',
        superseded: '已被替代',
        archived: '已归档',
        expired: '已过期'
    });
    const SOURCE = Object.freeze({
        user_explicit: '用户明确表达',
        user_behavior: '用户行为观察',
        assistant_inferred: '模型推测',
        summary_api: '总结 API',
        manual: '人工录入',
        legacy_import: '旧数据迁移'
    });

    function normalizeStatus(value) {
        const key = String(value || '').trim().toLowerCase();
        return STATUS[key] ? key : 'active';
    }

    function normalizeSource(value) {
        const key = String(value || '').trim().toLowerCase();
        return SOURCE[key] ? key : 'legacy_import';
    }

    function defaultRetention(effect) {
        const retention = LifecycleDefaults.retention || {};
        const selected = retention[effect] || retention.default || { mode: 'permanent', halfLife: 3650, archive: 0 };
        return { mode: selected.mode, halfLife: Number(selected.halfLife) || 3650, archive: Number(selected.archive) || 0 };
    }

    function normalizeSourceRef(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const ref = {
            type: ['message', 'round', 'review_batch', 'manual', 'legacy'].includes(raw.type) ? raw.type : 'legacy',
            id: String(raw.id || '').trim(),
            roundId: String(raw.roundId || '').trim(),
            at: Number(raw.at) || 0,
            excerpt: String(raw.excerpt || '').trim().slice(0, 500)
        };
        if (!ref.id && !ref.roundId && !ref.excerpt && !ref.at) return null;
        return ref;
    }

    function normalizeEvidence(raw, fallback = {}) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const primarySource = normalizeSource(source.primarySource || source.source || fallback.source);
        const refs = [];
        (Array.isArray(source.sourceRefs) ? source.sourceRefs : []).forEach(item => {
            const ref = normalizeSourceRef(item);
            if (ref) refs.push(ref);
        });
        (Array.isArray(fallback.sourceMessageIds) ? fallback.sourceMessageIds : []).forEach(id => {
            const ref = normalizeSourceRef({ type: 'message', id });
            if (ref) refs.push(ref);
        });
        const dedup = [];
        const seen = new Set();
        refs.forEach(ref => {
            const key = `${ref.type}:${ref.id}:${ref.roundId}:${ref.excerpt}`;
            if (seen.has(key)) return;
            seen.add(key);
            dedup.push(ref);
        });
        const inferredUserCount = primarySource === 'user_explicit' ? 1 : 0;
        const inferredAssistantCount = primarySource === 'assistant_inferred' ? 1 : 0;
        const inferredSummaryCount = primarySource === 'summary_api' ? 1 : 0;
        return {
            primarySource,
            userEvidenceCount: Math.max(0, Number(source.userEvidenceCount) || inferredUserCount),
            behaviorEvidenceCount: Math.max(0, Number(source.behaviorEvidenceCount) || (primarySource === 'user_behavior' ? 1 : 0)),
            assistantEvidenceCount: Math.max(0, Number(source.assistantEvidenceCount) || inferredAssistantCount),
            summaryEvidenceCount: Math.max(0, Number(source.summaryEvidenceCount) || inferredSummaryCount),
            userConfirmed: !!source.userConfirmed,
            lastVerifiedAt: Number(source.lastVerifiedAt) || 0,
            sourceRefs: dedup.slice(-30),
            note: String(source.note || '').trim().slice(0, 1000)
        };
    }

    function normalizeLifecycle(raw, meta = {}, effectMode = 'historical_context') {
        const source = raw && typeof raw === 'object' ? raw : {};
        const defaults = defaultRetention(effectMode);
        const mode = ['permanent', 'fixed', 'decay', 'manual'].includes(source.retentionMode)
            ? source.retentionMode : defaults.mode;
        return {
            status: normalizeStatus(source.status || meta.status),
            retentionMode: mode,
            expiresAt: Number(source.expiresAt || meta.expiresAt) || 0,
            reviewAt: Number(source.reviewAt) || 0,
            decayHalfLifeDays: Math.max(1, Math.min(3650, Number(source.decayHalfLifeDays) || defaults.halfLife)),
            autoArchiveAfterDays: Math.max(0, Math.min(10000, Number(source.autoArchiveAfterDays) || defaults.archive)),
            statusReason: String(source.statusReason || '').trim().slice(0, 1000),
            archivedAt: Number(source.archivedAt) || 0,
            supersededAt: Number(source.supersededAt) || 0,
            expiredAt: Number(source.expiredAt) || 0
        };
    }

    function normalizeRelations(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            supersedes: unique(source.supersedes),
            supersededBy: unique(source.supersededBy),
            conflictsWith: unique(source.conflictsWith),
            relatedTo: unique(source.relatedTo)
        };
    }

    function inferSourceFromMeta(meta) {
        if (meta?.evidence?.primarySource) return meta.evidence.primarySource;
        if (meta?.source) return meta.source;
        return 'legacy_import';
    }

    function ensureRowMeta(row, table, searchText = '') {
        if (!row || typeof row !== 'object') return null;
        row.meta ||= {};
        const meta = row.meta;
        const effect = meta?.tagBundle?.effect || 'historical_context';
        meta.evidence = normalizeEvidence(meta.evidence, {
            source: inferSourceFromMeta(meta),
            sourceMessageIds: meta.sourceMessageIds
        });
        meta.lifecycle = normalizeLifecycle(meta.lifecycle, meta, effect);
        meta.relations = normalizeRelations(meta.relations);
        meta.sourceMessageIds = unique([
            ...(meta.sourceMessageIds || []),
            ...meta.evidence.sourceRefs.filter(ref => ref.type === 'message').map(ref => ref.id)
        ]);
        meta.status = meta.lifecycle.status;
        meta.expiresAt = meta.lifecycle.expiresAt || null;
        if (!Array.isArray(meta.versionLog)) meta.versionLog = [];
        return meta;
    }

    function daysSince(timestamp, now = Date.now()) {
        const value = Number(timestamp) || 0;
        if (!value) return 0;
        return Math.max(0, (now - value) / DAY);
    }

    function getEffectiveConfidence(row, now = Date.now()) {
        const meta = ensureRowMeta(row, null, '');
        let confidence = Math.max(0, Math.min(100, Number(meta?.confidence) || Number(LifecycleDefaults.defaultConfidence) || 70));
        const life = meta.lifecycle;
        const evidence = meta.evidence;
        if (evidence.userConfirmed) confidence = Math.max(confidence, 92);
        if (life.retentionMode === 'decay') {
            const age = daysSince(meta.lastMentionedAt || meta.updatedAt || meta.createdAt, now);
            confidence *= Math.pow(0.5, age / Math.max(1, life.decayHalfLifeDays));
        }
        if (life.status === 'uncertain') confidence *= 0.65;
        if (life.status === 'conflicting') confidence *= 0.35;
        if (life.status === 'superseded' || life.status === 'archived' || life.status === 'expired') confidence = 0;
        return Math.round(Math.max(0, Math.min(100, confidence)));
    }

    function runRowMaintenance(row, table, now = Date.now()) {
        const meta = ensureRowMeta(row, table, '');
        const life = meta.lifecycle;
        const before = life.status;
        if (life.expiresAt && now >= life.expiresAt && !['archived', 'superseded'].includes(life.status)) {
            life.status = 'expired';
            life.expiredAt ||= now;
            life.statusReason ||= '达到设定有效期';
        }
        if (life.autoArchiveAfterDays > 0 && !['archived', 'superseded', 'conflicting'].includes(life.status)) {
            const age = daysSince(meta.lastMentionedAt || meta.updatedAt || meta.createdAt, now);
            if (age >= life.autoArchiveAfterDays) {
                life.status = 'archived';
                life.archivedAt ||= now;
                life.statusReason ||= `超过 ${life.autoArchiveAfterDays} 天未再次确认`;
            }
        }
        if (life.reviewAt && now >= life.reviewAt && life.status === 'active' && !meta.evidence.userConfirmed) {
            life.status = 'uncertain';
            life.statusReason ||= '已到复核日期且尚未由用户确认';
        }
        meta.status = life.status;
        meta.expiresAt = life.expiresAt || null;
        return before !== life.status;
    }

    function evaluateRow(row, table, now = Date.now()) {
        const meta = ensureRowMeta(row, table, '');
        const changed = runRowMaintenance(row, table, now);
        const life = meta.lifecycle;
        const evidence = meta.evidence;
        const blocked = [];
        if (['superseded', 'archived', 'expired'].includes(life.status)) blocked.push(`生命周期：${STATUS[life.status]}`);
        if (life.status === 'conflicting') blocked.push('存在未解决冲突');
        const effectiveConfidence = getEffectiveConfidence(row, now);
        if (effectiveConfidence < (Number(LifecycleDefaults.lowConfidenceBlock) || 20) && !meta.pinned) blocked.push(`衰减后置信度过低（${effectiveConfidence}）`);
        const reasons = [`状态：${STATUS[life.status] || life.status}`, `来源：${SOURCE[evidence.primarySource] || evidence.primarySource}`];
        if (evidence.userConfirmed) reasons.push('用户已确认');
        if (life.retentionMode === 'decay') reasons.push(`衰减置信度：${effectiveConfidence}`);
        if (life.expiresAt) reasons.push(`有效至：${new Date(life.expiresAt).toLocaleDateString()}`);
        return { allowed: blocked.length === 0, blockedReasons: blocked, reasons, effectiveConfidence, lifecycle: life, evidence, relations: meta.relations, changed };
    }

    function getPromptDirective(row, table) {
        const result = evaluateRow(row, table);
        const lines = [];
        if (result.lifecycle.status === 'uncertain') lines.push('该记忆尚不确定，必须使用“可能、似乎、曾经提到”等弱化措辞。');
        if (result.evidence.primarySource === 'assistant_inferred' && !result.evidence.userConfirmed) lines.push('这是模型推测，不得当作用户明确事实主动说出。');
        if (result.evidence.primarySource === 'legacy_import' && !result.evidence.userConfirmed) lines.push('这是旧数据迁移记录，缺少原始证据时只作低强度参考。');
        if (result.lifecycle.retentionMode === 'decay') lines.push(`当前有效置信度约 ${result.effectiveConfidence}/100。`);
        return lines.join('');
    }

    function recordSource(row, source, ref = {}, options = {}) {
        const meta = ensureRowMeta(row, null, '');
        const evidence = meta.evidence;
        const normalized = normalizeSource(source);
        evidence.primarySource = normalized;
        if (normalized === 'user_explicit') evidence.userEvidenceCount += 1;
        if (normalized === 'user_behavior') evidence.behaviorEvidenceCount += 1;
        if (normalized === 'assistant_inferred') evidence.assistantEvidenceCount += 1;
        if (normalized === 'summary_api') evidence.summaryEvidenceCount += 1;
        if (options.userConfirmed) evidence.userConfirmed = true;
        if (options.verified) evidence.lastVerifiedAt = Date.now();
        const normalizedRef = normalizeSourceRef(ref);
        if (normalizedRef) evidence.sourceRefs = normalizeEvidence({ ...evidence, sourceRefs: [...evidence.sourceRefs, normalizedRef] }).sourceRefs;
        meta.updatedAt = Date.now();
        if (options.recordEvent !== false) getProvenance()?.record?.(row, 'source_observed', {
            actor: options.actor || (normalized === 'manual' ? 'user' : 'system'),
            source: normalized,
            reason: options.reason || `补充${SOURCE[normalized] || normalized}来源证据`,
            refs: normalizedRef ? [normalizedRef] : [],
            transactionId: options.transactionId,
            operationId: options.operationId,
            eventKey: options.eventKey
        });
        return evidence;
    }

    function addVersionLog(row, action, details = '') {
        const meta = ensureRowMeta(row, null, '');
        meta.versionLog.push({ at: Date.now(), action: String(action || ''), details: String(details || '').slice(0, 1000) });
        meta.versionLog = meta.versionLog.slice(-40);
    }

    function setStatus(row, status, reason = '', options = {}) {
        const meta = ensureRowMeta(row, null, '');
        const next = normalizeStatus(status);
        const old = meta.lifecycle.status;
        meta.lifecycle.status = next;
        meta.lifecycle.statusReason = String(reason || '').trim().slice(0, 1000);
        if (next === 'archived') meta.lifecycle.archivedAt = options.at || Date.now();
        if (next === 'expired') meta.lifecycle.expiredAt = options.at || Date.now();
        if (next === 'superseded') meta.lifecycle.supersededAt = options.at || Date.now();
        if (next === 'active') {
            meta.lifecycle.archivedAt = 0;
            meta.lifecycle.expiredAt = 0;
            if (old === 'superseded') meta.lifecycle.supersededAt = 0;
        }
        meta.status = next;
        if (old !== next) {
            addVersionLog(row, `status:${old}->${next}`, reason);
            const action = next === 'archived' ? 'archive'
                : next === 'expired' ? 'expire'
                    : next === 'uncertain' ? 'uncertain'
                        : next === 'active' && ['archived', 'expired', 'uncertain'].includes(old) ? 'restore'
                            : next === 'superseded' ? 'supersede' : 'maintenance';
            getProvenance()?.record?.(row, action, {
                at: options.at,
                actor: options.actor || 'system',
                source: options.source || 'system',
                reason: reason || `${STATUS[old] || old} → ${STATUS[next] || next}`,
                before: STATUS[old] || old,
                after: STATUS[next] || next,
                transactionId: options.transactionId,
                operationId: options.operationId,
                relatedRowIds: options.relatedRowIds || []
            });
        }
        return old !== next;
    }

    function linkRows(current, target, mode) {
        if (!current || !target || current.id === target.id) return false;
        const a = ensureRowMeta(current, null, '');
        const b = ensureRowMeta(target, null, '');
        if (mode === 'supersedes') {
            a.relations.supersedes = unique([...a.relations.supersedes, target.id]);
            b.relations.supersededBy = unique([...b.relations.supersededBy, current.id]);
            setStatus(current, 'active', '作为更新版本生效', { actor: 'user', source: 'manual', relatedRowIds: [target.id] });
            setStatus(target, 'superseded', `被 ${current.id} 替代`, { actor: 'user', source: 'manual', relatedRowIds: [current.id] });
            getProvenance()?.record?.(current, 'supersede', { actor: 'user', source: 'manual', reason: '人工确认当前记录替代旧记录', relatedRowIds: [target.id] });
            return true;
        }
        if (mode === 'conflict') {
            a.relations.conflictsWith = unique([...a.relations.conflictsWith, target.id]);
            b.relations.conflictsWith = unique([...b.relations.conflictsWith, current.id]);
            setStatus(current, 'conflicting', `与 ${target.id} 存在冲突`, { actor: 'user', source: 'manual', relatedRowIds: [target.id] });
            setStatus(target, 'conflicting', `与 ${current.id} 存在冲突`, { actor: 'user', source: 'manual', relatedRowIds: [current.id] });
            getProvenance()?.record?.(current, 'conflict', { actor: 'user', source: 'manual', reason: '人工建立冲突关系', relatedRowIds: [target.id] });
            return true;
        }
        if (mode === 'related') {
            a.relations.relatedTo = unique([...a.relations.relatedTo, target.id]);
            b.relations.relatedTo = unique([...b.relations.relatedTo, current.id]);
            getProvenance()?.record?.(current, 'related', { actor: 'user', source: 'manual', reason: '人工建立相关关系', relatedRowIds: [target.id] });
            return true;
        }
        return false;
    }

    function clearRelations(row, rows) {
        if (!row) return false;
        const meta = ensureRowMeta(row, null, '');
        const linked = unique([
            ...meta.relations.supersedes,
            ...meta.relations.supersededBy,
            ...meta.relations.conflictsWith,
            ...meta.relations.relatedTo
        ]);
        (rows || []).forEach(other => {
            if (!linked.includes(other.id)) return;
            const otherMeta = ensureRowMeta(other, null, '');
            ['supersedes', 'supersededBy', 'conflictsWith', 'relatedTo'].forEach(key => {
                otherMeta.relations[key] = otherMeta.relations[key].filter(id => id !== row.id);
            });
            if (otherMeta.lifecycle.status === 'conflicting' && !otherMeta.relations.conflictsWith.length) {
                setStatus(other, 'uncertain', '冲突关系已人工解除，等待再次确认');
            }
        });
        meta.relations = normalizeRelations({});
        if (meta.lifecycle.status === 'conflicting' || meta.lifecycle.status === 'superseded') {
            setStatus(row, 'uncertain', '版本关系已人工解除，等待再次确认');
        }
        addVersionLog(row, 'clear_relations', linked.join(','));
        if (linked.length) getProvenance()?.record?.(row, 'clear_relations', { actor: 'user', source: 'manual', reason: '人工解除记忆关系', relatedRowIds: linked });
        return linked.length > 0;
    }

    function textForRow(table, row) {
        return (table?.columns || []).map(field => `${field.key}: ${row?.cells?.[field.id] ?? ''}`).join(' ').slice(0, 700);
    }

    function pickTargetRow(row, table, rows, title) {
        if (typeof window.prompt !== 'function') return null;
        const candidates = (rows || []).filter(item => item.id !== row.id).slice(0, 80);
        if (!candidates.length) return null;
        const list = candidates.map((item, index) => `${index + 1}. ${textForRow(table, item).slice(0, 90)} [${item.id}]`).join('\n');
        const answer = window.prompt(`${title}\n输入序号：\n${list}`, '');
        if (answer === null) return null;
        const index = Number(answer) - 1;
        return candidates[index] || candidates.find(item => item.id === String(answer).trim()) || null;
    }

    function editReliability(row, table) {
        const meta = ensureRowMeta(row, table, '');
        if (typeof window.prompt !== 'function') return false;
        const status = window.prompt('状态：active / uncertain / conflicting / superseded / archived / expired', meta.lifecycle.status);
        if (status === null) return false;
        const source = window.prompt('主要来源：user_explicit / user_behavior / assistant_inferred / summary_api / manual / legacy_import', meta.evidence.primarySource);
        if (source === null) return false;
        const confirmed = window.prompt('用户是否确认？输入 yes / no', meta.evidence.userConfirmed ? 'yes' : 'no');
        if (confirmed === null) return false;
        const retention = window.prompt('保留方式：permanent / fixed / decay / manual', meta.lifecycle.retentionMode);
        if (retention === null) return false;
        const expires = window.prompt('到期日期 YYYY-MM-DD；留空表示无', meta.lifecycle.expiresAt ? new Date(meta.lifecycle.expiresAt).toISOString().slice(0, 10) : '');
        if (expires === null) return false;
        const review = window.prompt('复核日期 YYYY-MM-DD；留空表示无', meta.lifecycle.reviewAt ? new Date(meta.lifecycle.reviewAt).toISOString().slice(0, 10) : '');
        if (review === null) return false;
        const halfLife = window.prompt('衰减半衰期（天）', String(meta.lifecycle.decayHalfLifeDays));
        if (halfLife === null) return false;
        const autoArchive = window.prompt('多少天未确认后自动归档；0 表示关闭', String(meta.lifecycle.autoArchiveAfterDays));
        if (autoArchive === null) return false;
        const parseDate = value => value && !Number.isNaN(Date.parse(`${value}T23:59:59`)) ? Date.parse(`${value}T23:59:59`) : 0;
        meta.lifecycle = normalizeLifecycle({
            ...meta.lifecycle,
            status,
            retentionMode: retention,
            expiresAt: parseDate(String(expires).trim()),
            reviewAt: parseDate(String(review).trim()),
            decayHalfLifeDays: Number(halfLife),
            autoArchiveAfterDays: Number(autoArchive)
        }, meta, meta.tagBundle?.effect);
        meta.evidence = normalizeEvidence({ ...meta.evidence, primarySource: source, userConfirmed: /^y|yes|是|true|1$/i.test(String(confirmed).trim()) });
        meta.status = meta.lifecycle.status;
        meta.expiresAt = meta.lifecycle.expiresAt || null;
        meta.updatedAt = Date.now();
        addVersionLog(row, 'manual_reliability_edit', '人工编辑来源和生命周期');
        getProvenance()?.record?.(row, 'reliability_edit', {
            actor: 'user', source: 'manual', reason: '人工修改来源、确认状态或生命周期',
            after: `${STATUS[meta.lifecycle.status] || meta.lifecycle.status} · ${SOURCE[meta.evidence.primarySource] || meta.evidence.primarySource}`
        });
        return true;
    }

    function renderRowSummary(row, table) {
        const meta = ensureRowMeta(row, table, '');
        const life = meta.lifecycle;
        const evidence = meta.evidence;
        const confidence = getEffectiveConfidence(row);
        const relationCount = meta.relations.supersedes.length + meta.relations.supersededBy.length + meta.relations.conflictsWith.length;
        return `<div class="memory-life-summary status-${life.status}">
            <div><span>${STATUS[life.status] || life.status}</span><span>${SOURCE[evidence.primarySource] || evidence.primarySource}${evidence.userConfirmed ? ' · 已确认' : ''}</span></div>
            <small>有效置信度 ${confidence}${life.expiresAt ? ` · 至 ${new Date(life.expiresAt).toLocaleDateString()}` : ''}${relationCount ? ` · 关系 ${relationCount}` : ''}</small>
        </div>`;
    }

    function iterateRows(chat, templates, callback) {
        (templates || []).forEach(template => {
            (template.tables || []).forEach(table => {
                const rows = chat?.memoryTables?.data?.[template.id]?.[table.id]?.__rows;
                if (!Array.isArray(rows)) return;
                rows.forEach(row => callback(row, table, template));
            });
        });
    }

    function migrateRows(chat, templates) {
        let changed = 0;
        iterateRows(chat, templates, (row, table) => {
            const before = JSON.stringify({ evidence: row.meta?.evidence, lifecycle: row.meta?.lifecycle, relations: row.meta?.relations });
            ensureRowMeta(row, table, textForRow(table, row));
            const after = JSON.stringify({ evidence: row.meta?.evidence, lifecycle: row.meta?.lifecycle, relations: row.meta?.relations });
            if (before !== after) changed += 1;
        });
        return changed;
    }

    function removeReferences(chat, templates, rowId) {
        let changed = 0;
        iterateRows(chat, templates, row => {
            const meta = ensureRowMeta(row, null, '');
            ['supersedes', 'supersededBy', 'conflictsWith', 'relatedTo'].forEach(key => {
                const before = meta.relations[key].length;
                meta.relations[key] = meta.relations[key].filter(id => id !== rowId);
                if (before !== meta.relations[key].length) changed += 1;
            });
        });
        return changed;
    }

    function buildMaintenanceOperation(row, table, template, now = Date.now()) {
        const copy = Core.clone ? Core.clone(row) : JSON.parse(JSON.stringify(row));
        const meta = ensureRowMeta(copy, table, '');
        const before = meta.lifecycle.status;
        runRowMaintenance(copy, table, now);
        const after = copy.meta.lifecycle.status;
        if (before === after) return null;
        return {
            templateId: template?.id || '',
            tableId: table?.id || '',
            tableName: table?.name || '记忆表',
            rowId: row?.id || '',
            before,
            after,
            reason: copy.meta.lifecycle.statusReason || `${STATUS[before] || before} → ${STATUS[after] || after}`,
            excerpt: textForRow(table, row).slice(0, 220)
        };
    }

    function planMaintenance(chat, templates, now = Date.now()) {
        const operations = [];
        let checked = 0;
        iterateRows(chat, templates, (row, table, template) => {
            checked += 1;
            const operation = buildMaintenanceOperation(row, table, template, now);
            if (operation) operations.push(operation);
        });
        const counts = { expired: 0, archived: 0, uncertain: 0, active: 0, superseded: 0, conflicting: 0 };
        operations.forEach(item => { counts[item.after] = (counts[item.after] || 0) + 1; });
        return {
            schemaVersion: '1.0',
            createdAt: now,
            checked,
            changed: operations.length,
            operations,
            ...counts
        };
    }

    function rowLookup(templates) {
        const result = new Map();
        (templates || []).forEach(template => (template.tables || []).forEach(table => {
            result.set(`${template.id}::${table.id}`, { template, table });
        }));
        return result;
    }

    function applyMaintenancePlan(chat, templates, plan, options = {}) {
        const safePlan = plan && typeof plan === 'object' ? plan : planMaintenance(chat, templates, options.now);
        const lookup = rowLookup(templates);
        const report = { checked: Number(safePlan.checked) || 0, changed: 0, expired: 0, archived: 0, uncertain: 0, skipped: 0, operations: [] };
        (safePlan.operations || []).forEach(operation => {
            const descriptor = lookup.get(`${operation.templateId}::${operation.tableId}`);
            const rows = descriptor ? chat?.memoryTables?.data?.[operation.templateId]?.[operation.tableId]?.__rows : null;
            const row = Array.isArray(rows) ? rows.find(item => item.id === operation.rowId) : null;
            if (!row || !descriptor) { report.skipped += 1; return; }
            const current = ensureRowMeta(row, descriptor.table, '').lifecycle.status;
            if (current !== operation.before && current !== operation.after) { report.skipped += 1; return; }
            const changed = setStatus(row, operation.after, operation.reason, {
                at: safePlan.createdAt,
                actor: 'system',
                source: 'system',
                transactionId: options.transactionId,
                operationId: options.operationId
            });
            if (!changed) return;
            if (operation.after === 'uncertain') row.meta.lifecycle.reviewAt = 0;
            report.changed += 1;
            if (report[operation.after] !== undefined) report[operation.after] += 1;
            report.operations.push({ ...operation });
        });
        chat.memoryTables ||= {};
        chat.memoryTables.lifecycle ||= {};
        chat.memoryTables.lifecycle.schemaVersion = '3.1';
        chat.memoryTables.lifecycle.lastMaintenanceAt = Date.now();
        chat.memoryTables.lifecycle.lastMaintenanceReport = { ...report, operations: report.operations.slice(0, 60) };
        return report;
    }

    function runMaintenance(chat, templates, options = {}) {
        const plan = planMaintenance(chat, templates, options.now || Date.now());
        return applyMaintenancePlan(chat, templates, plan, options);
    }

    function healthReport(chat, templates, now = Date.now()) {
        const stats = {};
        const sources = {};
        const due = [];
        const conflicts = [];
        const archived = [];
        const missingSource = [];
        const expiringSoon = [];
        const signatureGroups = new Map();
        const identity = getRecordIdentity();
        let total = 0;
        iterateRows(chat, templates, (row, table, template) => {
            total += 1;
            const copy = Core.clone ? Core.clone(row) : JSON.parse(JSON.stringify(row));
            const meta = ensureRowMeta(copy, table, '');
            stats[meta.lifecycle.status] = (stats[meta.lifecycle.status] || 0) + 1;
            sources[meta.evidence.primarySource] = (sources[meta.evidence.primarySource] || 0) + 1;
            const item = { row, table, template, meta, text: textForRow(table, row) };
            if ((meta.lifecycle.expiresAt && meta.lifecycle.expiresAt <= now) || (meta.lifecycle.reviewAt && meta.lifecycle.reviewAt <= now)) due.push(item);
            if (meta.lifecycle.expiresAt && meta.lifecycle.expiresAt > now && meta.lifecycle.expiresAt <= now + (Number(LifecycleDefaults.expiringSoonDays) || 30) * DAY) expiringSoon.push(item);
            if (meta.lifecycle.status === 'conflicting' || meta.relations.conflictsWith.length) conflicts.push(item);
            if (meta.lifecycle.status === 'archived') archived.push(item);
            if (meta.evidence.primarySource === 'legacy_import' && !(meta.evidence.sourceRefs || []).length) missingSource.push(item);
            if (identity?.contentSignature && !['archived', 'superseded'].includes(meta.lifecycle.status)) {
                const signature = identity.contentSignature(table, row?.cells || {});
                if (signature) {
                    const key = `${table.id}::${signature}`;
                    const group = signatureGroups.get(key) || [];
                    group.push(item);
                    signatureGroups.set(key, group);
                }
            }
        });
        const duplicateGroups = [...signatureGroups.values()].filter(group => group.length > 1);
        const plan = planMaintenance(chat, templates, now);
        const penalty = Math.min(100,
            conflicts.length * (Number(LifecycleDefaults.healthPenalty?.conflict) || 8)
            + due.length * (Number(LifecycleDefaults.healthPenalty?.due) || 3)
            + duplicateGroups.length * (Number(LifecycleDefaults.healthPenalty?.duplicateGroup) || 4)
            + missingSource.length * (Number(LifecycleDefaults.healthPenalty?.missingSource) || 0.25)
        );
        return {
            generatedAt: now,
            total,
            stats,
            sources,
            due,
            conflicts,
            archived,
            missingSource,
            expiringSoon,
            duplicateGroups,
            plan,
            score: Math.max(0, Math.round(100 - penalty))
        };
    }

    function renderReliabilityView(chat, templates) {
        const health = healthReport(chat, templates);
        const last = chat?.memoryTables?.lifecycle?.lastMaintenanceReport;
        const cards = [
            ['健康分数', health.score],
            ['当前有效', health.stats.active || 0],
            ['待确认', health.stats.uncertain || 0],
            ['冲突', health.conflicts.length],
            ['已过期', health.stats.expired || 0],
            ['已归档', health.archived.length]
        ].map(([label, count]) => `<span>${escapeHtml(label)}<strong>${count}</strong></span>`).join('');
        const sourceText = Object.entries(health.sources).map(([key, count]) => `${SOURCE[key] || key} ${count}`).join(' · ');
        const listItem = (item, actionLabel = '查看') => `<li><div><strong>${escapeHtml(item.table.name)}</strong> · ${escapeHtml((item.text || '').slice(0, 180))}</div><button type="button" class="memory-row-text-action" data-action="open-row-inspector" data-row-id="${escapeHtml(item.row.id)}">${actionLabel}</button></li>`;
        const duplicateItem = group => `<li><div><strong>${escapeHtml(group[0]?.table?.name || '记忆表')}</strong> · ${group.length} 条内容相同或高度一致</div><button type="button" class="memory-row-text-action" data-action="open-row-inspector" data-row-id="${escapeHtml(group[0]?.row?.id || '')}">核对合并</button></li>`;
        return `<div class="memory-life-view">
            <div class="memory-life-head"><div><h3>生命周期健康与来源变化</h3><p>维护只改变到期、复核和归档状态，不自动删除正文；重复记录必须进入人工核对后才能合并。</p></div>
            <div class="memory-life-actions"><button class="btn btn-small btn-primary" data-action="lifecycle-maintenance" ${health.plan.changed ? '' : 'disabled'}>执行 ${health.plan.changed} 项维护</button></div></div>
            <div class="memory-life-stat-grid">${cards}</div>
            <div class="memory-life-source-line">来源分布：${sourceText || '暂无'} · 缺少可验证来源 ${health.missingSource.length} 条 · 30 天内到期 ${health.expiringSoon.length} 条</div>
            <div class="memory-life-last">本次预演：检查 ${health.plan.checked} 条，预计改变 ${health.plan.changed} 条（过期 ${health.plan.expired || 0}、归档 ${health.plan.archived || 0}、待确认 ${health.plan.uncertain || 0}）。${last ? `上次实际改变 ${last.changed || 0} 条。` : '尚未执行过维护。'}</div>
            <section><h4>到期或需要复核（${health.due.length}）</h4>${health.due.length ? `<ul>${health.due.slice(0, 30).map(item => listItem(item)).join('')}</ul>` : '<p>暂无。</p>'}</section>
            <section><h4>冲突记录（${health.conflicts.length}）</h4>${health.conflicts.length ? `<ul>${health.conflicts.slice(0, 30).map(item => listItem(item, '处理冲突')).join('')}</ul>` : '<p>暂无未解决冲突。</p>'}</section>
            <section><h4>可能重复（${health.duplicateGroups.length} 组）</h4>${health.duplicateGroups.length ? `<ul>${health.duplicateGroups.slice(0, 20).map(duplicateItem).join('')}</ul>` : '<p>暂无完全一致的重复记录。</p>'}</section>
            <section><h4>最近归档（${health.archived.length}）</h4>${health.archived.length ? `<ul>${health.archived.slice(-20).reverse().map(item => listItem(item)).join('')}</ul>` : '<p>暂无归档记忆。</p>'}</section>
        </div>`;
    }

    const api = {
        VERSION,
        STATUS,
        SOURCE,
        normalizeEvidence,
        normalizeLifecycle,
        normalizeRelations,
        ensureRowMeta,
        getEffectiveConfidence,
        evaluateRow,
        getPromptDirective,
        recordSource,
        setStatus,
        linkRows,
        clearRelations,
        pickTargetRow,
        editReliability,
        renderRowSummary,
        migrateRows,
        removeReferences,
        planMaintenance,
        applyMaintenancePlan,
        healthReport,
        runMaintenance,
        renderReliabilityView,
        textForRow
    };

    if (Kernel) Kernel.register('lifecycle', api, { legacyGlobal: 'MemoryTableLifecycle' });
    else window.MemoryTableLifecycle = api;
})();
