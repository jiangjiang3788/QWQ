(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const FieldSemantics = Kernel.get('fieldSemantics');
    const VERSION = '2.15-R0B';

    function normalizeText(value) {
        if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean).sort().join('|');
        if (value && typeof value === 'object') {
            try { return JSON.stringify(value); } catch (_) { return String(value); }
        }
        return String(value ?? '')
            .normalize?.('NFKC')
            .toLowerCase()
            .replace(/[\s\u3000]+/g, '')
            .replace(/[，。！？；：、,.!?;:'"“”‘’（）()\[\]{}<>《》【】_-]+/g, '')
            .trim();
    }

    function unique(values, limit = 80) {
        return Core.unique(Array.isArray(values) ? values : [values], limit);
    }

    function nonEmpty(value) {
        if (Array.isArray(value)) return value.length > 0;
        if (value && typeof value === 'object') return Object.keys(value).length > 0;
        return String(value ?? '').trim() !== '';
    }

    function fieldEntries(table, cells, options = {}) {
        const includeVolatile = options.includeVolatile === true;
        return (table?.columns || []).map(field => ({
            field,
            value: cells?.[field.id],
            identityRole: FieldSemantics?.identityRole?.(field, table) || field?.identityRole || 'none',
            semanticRole: FieldSemantics?.semanticRole?.(field, table) || field?.semanticRole || 'custom'
        })).filter(entry => nonEmpty(entry.value) && (includeVolatile || entry.identityRole !== 'volatile'));
    }

    function strongKey(table, cells) {
        const entries = fieldEntries(table, cells, { includeVolatile: true })
            .filter(entry => entry.identityRole === 'primary_key' || entry.identityRole === 'source_key')
            .map(entry => `${entry.semanticRole}=${normalizeText(entry.value)}`)
            .filter(item => !item.endsWith('='));
        return entries.length ? entries.sort().join('|') : '';
    }

    function titleDateKey(table, cells) {
        const title = fieldEntries(table, cells).find(entry => entry.identityRole === 'title');
        const date = fieldEntries(table, cells, { includeVolatile: true }).find(entry => entry.identityRole === 'date');
        const titleText = normalizeText(title?.value);
        const dateText = normalizeText(date?.value);
        if (!titleText || !dateText) return '';
        return `${dateText}|${titleText}`;
    }

    function isDailyObservationTable(table) {
        const role = Kernel.get('policy')?.normalizeSystemRole?.(table?.systemRole, table) || String(table?.systemRole || '');
        return role === 'daily_observation';
    }

    function normalizeDateOnly(value) {
        const text = String(value ?? '').trim();
        if (!text) return '';
        const direct = text.match(/(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})/);
        if (direct) return `${direct[1]}-${String(direct[2]).padStart(2, '0')}-${String(direct[3]).padStart(2, '0')}`;
        const parsed = Date.parse(text);
        if (!Number.isFinite(parsed)) return normalizeText(text);
        const date = new Date(parsed);
        const pad = number => String(number).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function dailyDateKey(table, cells) {
        if (!isDailyObservationTable(table)) return '';
        const date = fieldEntries(table, cells, { includeVolatile: true }).find(entry => entry.semanticRole === 'observation_date' || entry.identityRole === 'date');
        return normalizeDateOnly(date?.value);
    }

    function contentSignature(table, cells) {
        const entries = fieldEntries(table, cells)
            .filter(entry => !['primary_key', 'source_key', 'volatile'].includes(entry.identityRole))
            .map(entry => `${entry.semanticRole}=${normalizeText(entry.value)}`)
            .filter(item => !item.endsWith('='))
            .sort();
        if (!entries.length) return '';
        return Core.hashFingerprint(entries.join('|'));
    }

    function sourceRefs(row, options = {}) {
        const meta = row?.meta || {};
        const ids = unique([
            ...(Array.isArray(meta.sourceMessageIds) ? meta.sourceMessageIds : []),
            ...(Array.isArray(options.sourceMessageIds) ? options.sourceMessageIds : []),
            options.sourceMessageId,
            options.sourceRoundId,
            meta.sourceRoundId,
            meta.sourceCandidateId,
            options.sourceCandidateId
        ].filter(Boolean));
        return ids;
    }

    function deriveSourceFingerprint(table, cells, row, options = {}) {
        const refs = sourceRefs(row, options);
        const key = strongKey(table, cells);
        const content = contentSignature(table, cells);
        const pieces = [];
        if (refs.length) pieces.push(`refs:${refs.sort().join('|')}`);
        if (key) pieces.push(`key:${key}`);
        if (content) pieces.push(`content:${content}`);
        return pieces.length ? Core.hashFingerprint(pieces.join('||')) : '';
    }

    function deriveRecordKey(table, cells, row, options = {}) {
        const existing = String(row?.meta?.identity?.recordKey || row?.meta?.recordKey || options.recordKey || '').trim();
        if (existing) return existing;
        const tableId = String(table?.id || 'table');
        const key = strongKey(table, cells);
        if (key) return `key:${tableId}:${Core.hashText(key)}`;
        const dailyDate = dailyDateKey(table, cells);
        if (dailyDate) return `daily:${tableId}:${Core.hashText(dailyDate)}`;
        const candidateId = String(options.sourceCandidateId || row?.meta?.sourceCandidateId || '').trim();
        if (candidateId) return `candidate:${tableId}:${Core.hashText(candidateId)}`;
        const titleDate = titleDateKey(table, cells);
        if (titleDate) return `event:${tableId}:${Core.hashText(titleDate)}`;
        const fingerprint = deriveSourceFingerprint(table, cells, row, options) || contentSignature(table, cells);
        if (fingerprint) return `memory:${tableId}:${Core.hashText(fingerprint)}`;
        return `row:${tableId}:${String(row?.id || Core.createId('memory_record'))}`;
    }

    function ensure(table, row, options = {}) {
        if (!row || typeof row !== 'object') return null;
        row.meta ||= {};
        const now = Number(options.at) || Date.now();
        const current = row.meta.identity && typeof row.meta.identity === 'object' ? row.meta.identity : {};
        const refs = unique([...(current.sourceRefs || []), ...sourceRefs(row, options)]);
        const sourceFingerprint = deriveSourceFingerprint(table, row.cells || {}, row, options);
        const fingerprints = unique([...(current.sourceFingerprints || []), current.sourceFingerprint, sourceFingerprint].filter(Boolean));
        const identity = {
            schemaVersion: 1,
            recordKey: deriveRecordKey(table, row.cells || {}, row, options),
            sourceFingerprint: current.sourceFingerprint || sourceFingerprint || '',
            sourceFingerprints: fingerprints,
            sourceRefs: refs,
            firstSeenAt: Number(current.firstSeenAt) || Number(row.meta.createdAt) || now,
            lastSeenAt: Math.max(Number(current.lastSeenAt) || 0, Number(row.meta.updatedAt) || 0, now),
            mergedFrom: unique(current.mergedFrom || []),
            matchCount: Math.max(1, Number(current.matchCount) || 1)
        };
        row.meta.identity = identity;
        row.meta.recordKey = identity.recordKey;
        row.meta.sourceFingerprint = identity.sourceFingerprint;
        return identity;
    }

    function touch(table, row, options = {}) {
        const identity = ensure(table, row, options);
        if (!identity) return null;
        identity.lastSeenAt = Number(options.at) || Date.now();
        if (options.matched === true) identity.matchCount = Math.max(1, Number(identity.matchCount) || 1) + 1;
        if (options.mergedFrom) identity.mergedFrom = unique([...(identity.mergedFrom || []), options.mergedFrom]);
        return identity;
    }

    function ensureUnique(table, rows) {
        const seen = new Map();
        (Array.isArray(rows) ? rows : []).forEach(row => {
            const identity = ensure(table, row);
            if (!identity?.recordKey) return;
            const baseKey = identity.recordKey;
            const count = Number(seen.get(baseKey)) || 0;
            seen.set(baseKey, count + 1);
            if (!count) return;
            const uniqueKey = `${baseKey}:${Core.hashText(String(row.id || count))}`;
            identity.recordKey = uniqueKey;
            row.meta.recordKey = uniqueKey;
        });
        return rows;
    }

    function exactKeyMatch(table, row, values) {
        const incoming = strongKey(table, values);
        if (!incoming) return false;
        return strongKey(table, row?.cells || {}) === incoming;
    }

    function sourceFingerprintMatch(table, row, values, options) {
        const incoming = deriveSourceFingerprint(table, values, { meta: options?.meta || {} }, options || {});
        if (!incoming) return false;
        const identity = ensure(table, row);
        return identity?.sourceFingerprint === incoming || (identity?.sourceFingerprints || []).includes(incoming);
    }

    function contentMatch(table, row, values) {
        const incoming = contentSignature(table, values);
        return !!incoming && contentSignature(table, row?.cells || {}) === incoming;
    }

    function titleDateMatch(table, row, values) {
        const incoming = titleDateKey(table, values);
        return !!incoming && titleDateKey(table, row?.cells || {}) === incoming;
    }

    function sourceCandidateMatch(row, options = {}) {
        const incoming = String(options.sourceCandidateId || options.meta?.sourceCandidateId || '').trim();
        return !!incoming && String(row?.meta?.sourceCandidateId || '').trim() === incoming;
    }

    function dailyDateMatch(table, row, values) {
        const incoming = dailyDateKey(table, values);
        return !!incoming && dailyDateKey(table, row?.cells || {}) === incoming;
    }

    function findMatch(rows, table, values, options = {}) {
        const list = Array.isArray(rows) ? rows : [];
        const recordKey = String(options.recordKey || options.meta?.identity?.recordKey || '').trim();
        if (recordKey) {
            const row = list.find(item => ensure(table, item)?.recordKey === recordKey);
            if (row) return { row, matchedBy: 'record_key', confidence: 1 };
        }
        let row = list.find(item => sourceCandidateMatch(item, options));
        if (row) return { row, matchedBy: 'source_candidate', confidence: 1 };
        row = list.find(item => exactKeyMatch(table, item, values));
        if (row) return { row, matchedBy: 'strong_key', confidence: 1 };
        row = list.find(item => dailyDateMatch(table, item, values));
        if (row) return { row, matchedBy: 'daily_date', confidence: 0.99 };
        row = list.find(item => sourceFingerprintMatch(table, item, values, options));
        if (row) return { row, matchedBy: 'source_fingerprint', confidence: 0.98 };
        row = list.find(item => titleDateMatch(table, item, values));
        if (row) return { row, matchedBy: 'title_date', confidence: 0.94 };
        row = list.find(item => contentMatch(table, item, values));
        if (row) return { row, matchedBy: 'content_fingerprint', confidence: 0.92 };
        return null;
    }

    function mergeValue(field, current, incoming, strategy = 'replace_non_empty') {
        if (!nonEmpty(incoming)) return current;
        if (strategy === 'fill_empty') return nonEmpty(current) ? current : incoming;
        if (strategy === 'replace_non_empty') return incoming;
        const type = String(field?.type || 'text');
        if (type === 'tags') return unique([...(Array.isArray(current) ? current : []), ...(Array.isArray(incoming) ? incoming : [incoming])], 40);
        if (['number', 'progress', 'enum', 'date', 'boolean'].includes(type)) return incoming;
        const before = String(current || '').trim();
        const after = String(incoming || '').trim();
        if (!before) return incoming;
        if (!after || before === after || before.includes(after)) return current;
        if (after.includes(before)) return incoming;
        return `${before}\n${after}`;
    }

    function describeMatch(match) {
        return ({
            record_key: '稳定记录标识',
            source_candidate: '来源候选',
            strong_key: '业务唯一字段',
            daily_date: '同一天日常观察',
            source_fingerprint: '来源指纹',
            title_date: '日期与标题',
            content_fingerprint: '内容指纹'
        })[match?.matchedBy] || '未匹配';
    }

    Kernel.register('recordIdentity', Object.freeze({
        VERSION,
        normalizeText,
        strongKey,
        titleDateKey,
        dailyDateKey,
        normalizeDateOnly,
        contentSignature,
        deriveSourceFingerprint,
        deriveRecordKey,
        ensure,
        touch,
        ensureUnique,
        findMatch,
        mergeValue,
        describeMatch
    }));
})(window);
