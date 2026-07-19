// 结构化记忆 V2.5：来源证据、冲突关系、衰减、过期与归档
(function () {
    'use strict';

    const Kernel = window.OvoMemoryKernel || null;
    const Core = Kernel?.core;
    if (!Core) throw new Error('记忆内核未加载');
    const escapeHtml = Core.escapeHtml;
    const unique = (values, limit = 50) => Core.unique(values, limit);

    const VERSION = '2.5';
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
        if (effect === 'temporary_state') return { mode: 'fixed', halfLife: 7, archive: 30 };
        if (effect === 'reminder') return { mode: 'manual', halfLife: 30, archive: 90 };
        if (effect === 'soft_preference') return { mode: 'decay', halfLife: 180, archive: 720 };
        if (effect === 'historical_context') return { mode: 'decay', halfLife: 365, archive: 1460 };
        if (effect === 'candidate') return { mode: 'manual', halfLife: 30, archive: 180 };
        return { mode: 'permanent', halfLife: 3650, archive: 0 };
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
        let confidence = Math.max(0, Math.min(100, Number(meta?.confidence) || 70));
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
        if (effectiveConfidence < 20 && !meta.pinned) blocked.push(`衰减后置信度过低（${effectiveConfidence}）`);
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
        return evidence;
    }

    function addVersionLog(row, action, details = '') {
        const meta = ensureRowMeta(row, null, '');
        meta.versionLog.push({ at: Date.now(), action: String(action || ''), details: String(details || '').slice(0, 1000) });
        meta.versionLog = meta.versionLog.slice(-40);
    }

    function setStatus(row, status, reason = '') {
        const meta = ensureRowMeta(row, null, '');
        const next = normalizeStatus(status);
        const old = meta.lifecycle.status;
        meta.lifecycle.status = next;
        meta.lifecycle.statusReason = String(reason || '').trim().slice(0, 1000);
        if (next === 'archived') meta.lifecycle.archivedAt = Date.now();
        if (next === 'expired') meta.lifecycle.expiredAt = Date.now();
        if (next === 'superseded') meta.lifecycle.supersededAt = Date.now();
        meta.status = next;
        addVersionLog(row, `status:${old}->${next}`, reason);
        return old !== next;
    }

    function linkRows(current, target, mode) {
        if (!current || !target || current.id === target.id) return false;
        const a = ensureRowMeta(current, null, '');
        const b = ensureRowMeta(target, null, '');
        if (mode === 'supersedes') {
            a.relations.supersedes = unique([...a.relations.supersedes, target.id]);
            b.relations.supersededBy = unique([...b.relations.supersededBy, current.id]);
            setStatus(current, 'active', '作为更新版本生效');
            setStatus(target, 'superseded', `被 ${current.id} 替代`);
            return true;
        }
        if (mode === 'conflict') {
            a.relations.conflictsWith = unique([...a.relations.conflictsWith, target.id]);
            b.relations.conflictsWith = unique([...b.relations.conflictsWith, current.id]);
            setStatus(current, 'conflicting', `与 ${target.id} 存在冲突`);
            setStatus(target, 'conflicting', `与 ${current.id} 存在冲突`);
            return true;
        }
        if (mode === 'related') {
            a.relations.relatedTo = unique([...a.relations.relatedTo, target.id]);
            b.relations.relatedTo = unique([...b.relations.relatedTo, current.id]);
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

    function runMaintenance(chat, templates) {
        const report = { checked: 0, changed: 0, expired: 0, archived: 0, uncertain: 0 };
        iterateRows(chat, templates, (row, table) => {
            report.checked += 1;
            const before = ensureRowMeta(row, table, '').lifecycle.status;
            if (runRowMaintenance(row, table)) report.changed += 1;
            const after = row.meta.lifecycle.status;
            if (before !== after && report[after] !== undefined) report[after] += 1;
        });
        chat.memoryTables ||= {};
        chat.memoryTables.lifecycle ||= {};
        chat.memoryTables.lifecycle.lastMaintenanceAt = Date.now();
        chat.memoryTables.lifecycle.lastMaintenanceReport = report;
        return report;
    }

    function renderReliabilityView(chat, templates) {
        const stats = {};
        const sources = {};
        const due = [];
        const conflicts = [];
        const now = Date.now();
        iterateRows(chat, templates, (row, table, template) => {
            const meta = ensureRowMeta(row, table, '');
            stats[meta.lifecycle.status] = (stats[meta.lifecycle.status] || 0) + 1;
            sources[meta.evidence.primarySource] = (sources[meta.evidence.primarySource] || 0) + 1;
            if ((meta.lifecycle.expiresAt && meta.lifecycle.expiresAt <= now) || (meta.lifecycle.reviewAt && meta.lifecycle.reviewAt <= now)) {
                due.push({ row, table, template });
            }
            if (meta.lifecycle.status === 'conflicting' || meta.relations.conflictsWith.length) conflicts.push({ row, table, template });
        });
        const last = chat?.memoryTables?.lifecycle?.lastMaintenanceReport;
        const cards = Object.entries(STATUS).map(([key, label]) => `<span>${label}<strong>${stats[key] || 0}</strong></span>`).join('');
        const sourceText = Object.entries(sources).map(([key, count]) => `${SOURCE[key] || key} ${count}`).join(' · ');
        const listItem = item => `<li><strong>${escapeHtml(item.table.name)}</strong> · ${escapeHtml(textForRow(item.table, item.row).slice(0, 180))} <code>${escapeHtml(item.row.id)}</code></li>`;
        return `<div class="memory-life-view">
            <div class="memory-life-head"><div><h3>来源、冲突与遗忘</h3><p>过期、替代、归档和未解决冲突会在检索前被拦截；模型推测与旧迁移记录会降低使用强度。</p></div>
            <div class="memory-life-actions"><button class="btn btn-small btn-primary" data-action="lifecycle-maintenance">运行生命周期整理</button></div></div>
            <div class="memory-life-stat-grid">${cards}</div>
            <div class="memory-life-source-line">来源分布：${sourceText || '暂无'}</div>
            ${last ? `<div class="memory-life-last">上次整理：检查 ${last.checked || 0}，改变 ${last.changed || 0}，过期 ${last.expired || 0}，归档 ${last.archived || 0}，待确认 ${last.uncertain || 0}</div>` : ''}
            <section><h4>到期或需要复核（${due.length}）</h4>${due.length ? `<ul>${due.slice(0, 30).map(listItem).join('')}</ul>` : '<p>暂无。</p>'}</section>
            <section><h4>冲突记录（${conflicts.length}）</h4>${conflicts.length ? `<ul>${conflicts.slice(0, 30).map(listItem).join('')}</ul>` : '<p>暂无未解决冲突。</p>'}</section>
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
        runMaintenance,
        renderReliabilityView,
        textForRow
    };

    if (Kernel) Kernel.register('lifecycle', api, { legacyGlobal: 'MemoryTableLifecycle' });
    else window.MemoryTableLifecycle = api;
})();
