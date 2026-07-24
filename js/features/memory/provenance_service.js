(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;

    const VERSION = '2.14-R9';
    const MAX_EVENTS = 80;
    const ACTION_LABELS = Object.freeze({
        create: '创建记录',
        update_field: '更新字段',
        upsert_match: '匹配并更新原记录',
        source_observed: '补充来源证据',
        confirm: '确认有效',
        snooze: '延后复核',
        archive: '归档',
        restore: '恢复使用',
        expire: '标记过期',
        uncertain: '标记待确认',
        supersede: '建立替代关系',
        conflict: '建立冲突关系',
        related: '建立相关关系',
        clear_relations: '解除关系',
        merge: '合并记录',
        reliability_edit: '修改来源与时效',
        maintenance: '生命周期维护',
        legacy_change: '旧版变化记录'
    });
    const SOURCE_LABELS = Object.freeze({
        user_explicit: '用户明确表达',
        user_behavior: '用户行为观察',
        assistant_inferred: '模型推断',
        summary_api: '总结 API',
        manual: '人工操作',
        legacy_import: '旧数据迁移',
        sidecar: 'Sidecar',
        review: '更新审核',
        system: '系统维护'
    });

    function clone(value) {
        if (Core.clone) return Core.clone(value);
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function clean(value, limit = 240) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
    }

    function normalizeRef(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const ref = {
            type: clean(raw.type || raw.kind || 'legacy', 40),
            id: clean(raw.id || raw.messageId || raw.roundId || raw.batchId || '', 160),
            at: Number(raw.at || raw.createdAt) || 0,
            excerpt: clean(raw.excerpt || raw.summary || '', 220)
        };
        return ref.id || ref.at || ref.excerpt ? ref : null;
    }

    function normalizeEvent(raw) {
        if (!raw || typeof raw !== 'object') return null;
        const at = Number(raw.at) || Date.now();
        const action = clean(raw.action || 'legacy_change', 80) || 'legacy_change';
        const refs = (Array.isArray(raw.refs) ? raw.refs : []).map(normalizeRef).filter(Boolean).slice(-12);
        return {
            id: clean(raw.id || `prov_${at}_${Math.random().toString(36).slice(2, 8)}`, 120),
            at,
            action,
            actor: clean(raw.actor || 'system', 60),
            source: clean(raw.source || 'system', 80),
            reason: clean(raw.reason || raw.details || '', 500),
            fieldIds: Core.unique ? Core.unique(raw.fieldIds || [], 40) : [...new Set(raw.fieldIds || [])].slice(0, 40),
            before: clean(raw.before || raw.oldSummary || '', 260),
            after: clean(raw.after || raw.newSummary || '', 260),
            refs,
            transactionId: clean(raw.transactionId || '', 120),
            operationId: clean(raw.operationId || '', 120),
            eventKey: clean(raw.eventKey || '', 180),
            relatedRowIds: Core.unique ? Core.unique(raw.relatedRowIds || [], 20) : [...new Set(raw.relatedRowIds || [])].slice(0, 20)
        };
    }

    function storedEvents(row) {
        const list = row?.meta?.provenance?.events;
        return Array.isArray(list) ? list.map(normalizeEvent).filter(Boolean) : [];
    }

    function legacyEvents(row) {
        const result = [];
        const evidence = row?.meta?.evidence || {};
        (evidence.sourceRefs || []).slice(-12).forEach(ref => {
            const normalized = normalizeRef(ref);
            if (!normalized) return;
            result.push(normalizeEvent({
                id: `legacy_source_${normalized.type}_${normalized.id || normalized.at}`,
                at: normalized.at || row?.meta?.createdAt || 0,
                action: 'source_observed',
                actor: 'legacy',
                source: evidence.primarySource || 'legacy_import',
                reason: '由旧来源证据生成',
                refs: [normalized]
            }));
        });
        (row?.meta?.versionLog || []).slice(-20).forEach((item, index) => {
            result.push(normalizeEvent({
                id: `legacy_change_${Number(item?.at) || 0}_${index}`,
                at: Number(item?.at) || row?.meta?.updatedAt || 0,
                action: 'legacy_change',
                actor: 'legacy',
                source: 'legacy_import',
                reason: item?.details || item?.action || '旧版变化记录'
            }));
        });
        return result.filter(Boolean);
    }

    function read(row) {
        const combined = [...storedEvents(row), ...legacyEvents(row)];
        const seen = new Set();
        return combined.filter(event => {
            const key = event.id || `${event.at}:${event.action}:${event.reason}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, MAX_EVENTS);
    }

    function ensure(row) {
        if (!row || typeof row !== 'object') return null;
        row.meta ||= {};
        const current = row.meta.provenance && typeof row.meta.provenance === 'object' ? row.meta.provenance : {};
        const events = Array.isArray(current.events) ? current.events.map(normalizeEvent).filter(Boolean) : [];
        row.meta.provenance = {
            schemaVersion: '1.0',
            events: events.slice(-MAX_EVENTS),
            migratedLegacyAt: Number(current.migratedLegacyAt) || 0
        };
        return row.meta.provenance;
    }

    function migrate(row) {
        const state = ensure(row);
        if (!state || state.migratedLegacyAt) return 0;
        const before = state.events.length;
        const existing = new Set(state.events.map(event => event.id));
        legacyEvents(row).reverse().forEach(event => {
            if (!event || existing.has(event.id)) return;
            state.events.push(event);
            existing.add(event.id);
        });
        state.events = state.events.slice(-MAX_EVENTS);
        state.migratedLegacyAt = Date.now();
        return Math.max(0, state.events.length - before);
    }

    function record(row, action, options = {}) {
        let state = ensure(row);
        if (!state) return null;
        if (!state.migratedLegacyAt) {
            migrate(row);
            state = ensure(row);
        }
        const event = normalizeEvent({
            ...options,
            action,
            at: options.at || Date.now(),
            refs: options.refs || options.sourceRefs || []
        });
        if (!event) return null;
        const eventKey = clean(options.eventKey || '', 180);
        if (eventKey) {
            const duplicate = state.events.find(item => item.eventKey === eventKey);
            if (duplicate) return duplicate;
            event.eventKey = eventKey;
        }
        state.events.push(event);
        state.events = state.events.slice(-MAX_EVENTS);
        row.meta.updatedAt = Math.max(Number(row.meta.updatedAt) || 0, event.at || 0);
        return event;
    }

    function sourceLabel(value) {
        return SOURCE_LABELS[value] || value || '未知来源';
    }

    function actionLabel(value) {
        if (ACTION_LABELS[value]) return ACTION_LABELS[value];
        if (String(value || '').startsWith('status:')) return '状态变化';
        return value || '变化记录';
    }

    function formatTime(value) {
        const timestamp = Number(value) || 0;
        if (!timestamp) return '时间未知';
        try { return new Date(timestamp).toLocaleString(); }
        catch (_) { return '时间未知'; }
    }

    function summarize(row) {
        const evidence = row?.meta?.evidence || {};
        const identity = row?.meta?.identity || {};
        const events = read(row);
        return {
            source: sourceLabel(evidence.primarySource || 'legacy_import'),
            confirmed: !!evidence.userConfirmed,
            sourceCount: (evidence.sourceRefs || []).length || (identity.sourceRefs || []).length || 0,
            recordKey: identity.recordKey || '',
            firstSeenAt: Number(identity.firstSeenAt || row?.meta?.createdAt) || 0,
            lastSeenAt: Number(identity.lastSeenAt || row?.meta?.updatedAt) || 0,
            matchCount: Number(identity.matchCount) || 0,
            eventCount: events.length,
            latest: events[0] || null
        };
    }

    function renderPanel(target) {
        const row = target?.row;
        const summary = summarize(row);
        const events = read(row);
        const evidence = row?.meta?.evidence || {};
        const refs = (evidence.sourceRefs || row?.meta?.identity?.sourceRefs || []).map(normalizeRef).filter(Boolean).slice(-12).reverse();
        const eventHtml = events.length ? events.map(event => `<li class="memory-provenance-event">
            <div><strong>${Core.escapeHtml(actionLabel(event.action))}</strong><time>${Core.escapeHtml(formatTime(event.at))}</time></div>
            <p>${Core.escapeHtml(event.reason || `${sourceLabel(event.source)}触发`)}</p>
            <small>${Core.escapeHtml(sourceLabel(event.source))}${event.fieldIds?.length ? ` · ${event.fieldIds.length} 个字段` : ''}${event.transactionId ? ' · 已关联写入事务' : ''}</small>
            ${(event.before || event.after) ? `<div class="memory-provenance-diff">${event.before ? `<span>之前：${Core.escapeHtml(event.before)}</span>` : ''}${event.after ? `<span>之后：${Core.escapeHtml(event.after)}</span>` : ''}</div>` : ''}
        </li>`).join('') : '<li class="memory-row-inspector-empty">暂无变化事件。后续写入会自动记录原因和来源。</li>';
        const refHtml = refs.length ? `<ul class="memory-provenance-refs">${refs.map(ref => `<li><strong>${Core.escapeHtml(ref.type || '来源')}</strong><span>${Core.escapeHtml(ref.excerpt || ref.id || '已记录')}</span><time>${Core.escapeHtml(formatTime(ref.at))}</time></li>`).join('')}</ul>` : '<p class="memory-row-inspector-empty">没有可显示的原始消息引用。</p>';
        return `<section class="memory-row-tab-panel memory-row-provenance" data-inspector-panel="provenance">
            <div class="memory-row-inspector-section-head"><div><h3>来源与变化链</h3><p>展示这条记忆从哪里来、为什么写入、后来如何修改。只保存短摘要，不复制完整聊天。</p></div><span class="memory-provenance-count">${summary.eventCount} 次变化</span></div>
            <div class="memory-provenance-summary"><span>主要来源<strong>${Core.escapeHtml(summary.source)}</strong></span><span>用户确认<strong>${summary.confirmed ? '是' : '否'}</strong></span><span>匹配更新<strong>${summary.matchCount}</strong></span><span>来源引用<strong>${summary.sourceCount}</strong></span></div>
            <section><h4>变化链</h4><ol class="memory-provenance-events">${eventHtml}</ol></section>
            <section><h4>来源引用</h4>${refHtml}</section>
        </section>`;
    }

    Kernel.register('provenanceService', Object.freeze({
        VERSION,
        ACTION_LABELS,
        SOURCE_LABELS,
        normalizeEvent,
        read,
        ensure,
        migrate,
        record,
        summarize,
        renderPanel,
        sourceLabel,
        actionLabel
    }));
})(window);
