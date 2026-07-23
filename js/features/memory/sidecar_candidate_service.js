(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    const Core = Kernel?.core;
    if (!Core) throw new Error('记忆内核未加载');
    const Domain = Kernel.require('domain');

    const VERSION = '2.13-R4';
    const STATUS = Object.freeze({
        PENDING: 'pending',
        PROMOTED: 'promoted',
        MERGED: 'merged',
        DISMISSED: 'dismissed',
        DELETED: 'deleted',
        LEGACY_UNVERIFIED: 'legacy_unverified'
    });
    const ACTIONABLE = new Set([STATUS.PENDING, STATUS.LEGACY_UNVERIFIED]);
    const CLOSED = new Set([STATUS.PROMOTED, STATUS.MERGED, STATUS.DISMISSED, STATUS.DELETED]);
    const STATUS_LABELS = Object.freeze({
        pending: '待处理',
        promoted: '已保存到档案',
        merged: '已合并到档案',
        dismissed: '已忽略',
        deleted: '已删除',
        legacy_unverified: '旧版去向未验证'
    });
    const TARGET_RULES = Object.freeze({
        experience: Object.freeze({
            ids: Object.freeze(['table_recent_events']),
            name: /近期经历|重要事件/
        }),
        daily_observation: Object.freeze({
            ids: Object.freeze(['table_daily_observation']),
            name: /日常观察|睡眠.*饮水|饮水.*身体/
        })
    });

    function nowText() {
        const date = new Date();
        const pad = value => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function todayText() {
        return nowText().slice(0, 10);
    }

    function candidateType(candidate) {
        return candidate?.type === 'daily_observation' ? 'daily_observation' : 'experience';
    }

    function isRowsTarget(table, type) {
        if (!table || !Domain.isRowsTable(table)) return false;
        const rule = TARGET_RULES[type] || TARGET_RULES.experience;
        return rule.ids.includes(table.id) || rule.name.test(String(table.name || ''));
    }

    function normalizeCandidate(candidate) {
        if (!candidate || typeof candidate !== 'object') return null;
        candidate.type = candidateType(candidate);
        if (candidate.status === 'processed') {
            candidate.status = candidate.targetRowId ? STATUS.PROMOTED : STATUS.LEGACY_UNVERIFIED;
            if (!candidate.migrationNote && !candidate.targetRowId) {
                candidate.migrationNote = '旧版仅标记为已整理，未记录正式档案目标。';
            }
        }
        if (!Object.values(STATUS).includes(candidate.status)) candidate.status = STATUS.PENDING;
        if (!Number.isFinite(Number(candidate.createdAt))) candidate.createdAt = Date.now();
        return candidate;
    }

    function migrateLegacyCandidates(chat) {
        const rawCandidates = Array.isArray(chat?.memoryTables?.sidecar?.candidates) ? chat.memoryTables.sidecar.candidates : [];
        const before = new Map(rawCandidates.map(candidate => [candidate?.id, candidate?.status]));
        const state = Kernel.require('sidecar').ensureState(chat);
        let changed = 0;
        state.candidates = (state.candidates || []).map(candidate => {
            const normalized = normalizeCandidate(candidate);
            if (normalized && before.get(normalized.id) !== normalized.status) changed += 1;
            return normalized;
        }).filter(Boolean);
        state.schemaVersion = VERSION;
        return changed;
    }

    function boundTemplates(chat) {
        return Domain.getBoundTemplates(chat) || [];
    }

    function descriptorByIds(chat, templateId, tableId, type) {
        if (!templateId || !tableId) return null;
        const template = boundTemplates(chat).find(item => item.id === templateId);
        const table = template?.tables?.find(item => item.id === tableId);
        return isRowsTarget(table, type) ? { template, table } : null;
    }

    function resolveTarget(chat, candidate) {
        const type = candidateType(candidate);
        const preferred = descriptorByIds(chat, candidate?.suggestedTargetTemplateId, candidate?.suggestedTargetTableId, type);
        if (preferred) return preferred;
        const rule = TARGET_RULES[type];
        for (const template of boundTemplates(chat)) {
            const tableById = (template.tables || []).find(table => rule.ids.includes(table.id) && Domain.isRowsTable(table));
            if (tableById) return { template, table: tableById };
        }
        for (const template of boundTemplates(chat)) {
            const tableByName = (template.tables || []).find(table => isRowsTarget(table, type));
            if (tableByName) return { template, table: tableByName };
        }
        return null;
    }

    function findField(table, pattern) {
        return (table.columns || []).find(field => pattern.test(String(field.key || ''))) || null;
    }

    function assign(values, table, pattern, value) {
        if (value === undefined || value === null || value === '') return;
        const field = findField(table, pattern);
        if (field) values[field.id] = value;
    }

    function summaryTitle(summary) {
        const text = String(summary || '').replace(/\s+/g, ' ').trim();
        if (text.length <= 42) return text;
        const punctuation = text.slice(0, 60).search(/[。！？；]/);
        return `${text.slice(0, punctuation > 10 ? punctuation + 1 : 42)}…`;
    }

    function tagSummary(candidate) {
        const tags = candidate?.tags || {};
        const parts = [];
        if (Array.isArray(tags.topic) && tags.topic.length) parts.push(`主题：${tags.topic.join('、')}`);
        if (Array.isArray(tags.scene) && tags.scene.length) parts.push(`场景：${tags.scene.join('、')}`);
        if (tags.effect) parts.push(`作用：${tags.effect}`);
        return parts.join('；');
    }

    function buildExperienceValues(candidate, table) {
        const values = {};
        const completedField = findField(table, /^当前状态$/);
        const canComplete = completedField?.type === 'enum' && (completedField.options || []).includes('已完成');
        assign(values, table, /^事件ID$/, candidate.id);
        assign(values, table, /^创建时间$/, nowText());
        assign(values, table, /最后更新时间|更新时间/, nowText());
        assign(values, table, /^完成时间$/, canComplete ? nowText() : '');
        assign(values, table, /^类型$/, '近期经历');
        assign(values, table, /^标题$/, summaryTitle(candidate.summary));
        assign(values, table, /^内容$/, candidate.summary);
        assign(values, table, /相关主体/, Array.isArray(candidate.tags?.entity) ? candidate.tags.entity : []);
        assign(values, table, /^影响$/, tagSummary(candidate));
        assign(values, table, /^当前状态$/, canComplete ? '已完成' : '进行中');
        assign(values, table, /原始记录ID/, candidate.id);
        return values;
    }

    function buildDailyValues(candidate, table) {
        const values = {};
        const tagText = [
            ...(candidate.tags?.topic || []),
            ...(candidate.tags?.scene || []),
            candidate.tags?.effect || '',
            candidate.summary || ''
        ].join(' ');
        assign(values, table, /^日期$/, todayText());
        let classified = false;
        const classify = (pattern, fieldPattern) => {
            if (!pattern.test(tagText)) return;
            assign(values, table, fieldPattern, candidate.summary);
            classified = true;
        };
        classify(/睡眠|入睡|醒来|困|梦/, /睡眠情况/);
        classify(/饮水|喝水|水分|口渴/, /饮水情况/);
        classify(/运动|活动|步行|走路|锻炼/, /运动与活动/);
        classify(/身体|疼|痛|胃|腰|胸|头|发冷|发热|乏力|健康/, /身体状态/);
        classify(/精力|情绪|焦虑|压力|紧张|麻木|恢复/, /精力与情绪/);
        if (!classified) assign(values, table, /身体状态|精力与情绪|来源说明/, candidate.summary);
        assign(values, table, /数据完整度/, Math.max(0, Math.min(100, Number(candidate.confidence) || 0)));
        assign(values, table, /来源说明/, `聊天候选 · ${candidate.source || 'unknown'} · 置信度 ${Number(candidate.confidence) || 0} · ${candidate.id}`);
        return values;
    }

    function buildValues(candidate, table) {
        return candidateType(candidate) === 'daily_observation'
            ? buildDailyValues(candidate, table)
            : buildExperienceValues(candidate, table);
    }

    function buildRowMeta(candidate) {
        const tags = candidate.tags || {};
        return {
            sourceCandidateId: candidate.id,
            sourceRoundId: candidate.sourceRoundId || null,
            tagBundle: {
                topic: Array.isArray(tags.topic) ? tags.topic.slice(0, 10) : [],
                scene: Array.isArray(tags.scene) ? tags.scene.slice(0, 10) : [],
                entity: Array.isArray(tags.entity) ? tags.entity.slice(0, 10) : [],
                effect: String(tags.effect || (candidateType(candidate) === 'daily_observation' ? 'temporary_state' : 'historical_context'))
            }
        };
    }

    function getCandidate(chat, candidateId) {
        migrateLegacyCandidates(chat);
        return Kernel.require('sidecar').ensureState(chat).candidates.find(item => item.id === candidateId) || null;
    }

    function rowContainsCandidate(table, row, candidate) {
        if (row?.meta?.sourceCandidateId === candidate.id) return true;
        const origin = findField(table, /原始记录ID/);
        return !!origin && String(row.cells?.[origin.id] || '') === candidate.id;
    }

    function markResolved(candidate, status, descriptor, row, options = {}) {
        candidate.status = status;
        candidate.targetTemplateId = descriptor?.template?.id || null;
        candidate.targetTableId = descriptor?.table?.id || null;
        candidate.targetTableName = descriptor?.table?.name || '';
        candidate.targetRowId = row?.id || null;
        candidate.operationId = options.operationId || candidate.operationId || null;
        candidate.processedAt = Date.now();
        candidate.processedBy = options.processedBy || 'user';
        candidate.migrationNote = '';
    }

    function ensureActionable(candidate) {
        if (!candidate) throw new Error('候选不存在或已被清理');
        if (!ACTIONABLE.has(candidate.status)) {
            throw new Error(`候选当前状态为“${STATUS_LABELS[candidate.status] || candidate.status}”，不能重复处理`);
        }
    }

    function promote(chat, candidateId, options = {}) {
        const candidate = getCandidate(chat, candidateId);
        if (!candidate) throw new Error('候选不存在或已被清理');
        if (candidate.status === STATUS.PROMOTED && candidate.targetRowId) {
            const descriptor = descriptorByIds(chat, candidate.targetTemplateId, candidate.targetTableId, candidateType(candidate));
            const row = descriptor ? Domain.findRowById(chat, descriptor.template.id, descriptor.table, candidate.targetRowId) : null;
            return { changed: false, duplicate: true, action: 'promote', candidate, descriptor, row, message: '候选已经保存到正式档案，没有重复新增' };
        }
        ensureActionable(candidate);
        const descriptor = resolveTarget(chat, candidate);
        if (!descriptor) throw new Error(candidateType(candidate) === 'daily_observation' ? '没有找到“日常观察”正式表' : '没有找到“近期经历、想法与重要事件”正式表');
        const rows = Domain.getRows(chat, descriptor.template.id, descriptor.table);
        const existing = rows.find(row => rowContainsCandidate(descriptor.table, row, candidate));
        if (existing) {
            markResolved(candidate, STATUS.PROMOTED, descriptor, existing, options);
            return { changed: true, duplicate: true, action: 'promote', candidate, descriptor, row: existing, message: `正式档案已存在，已重新关联到 ${descriptor.table.name}` };
        }
        const row = Domain.addRow(chat, descriptor.template.id, descriptor.table, buildValues(candidate, descriptor.table), {
            source: 'sidecar_candidate_promote_v2_13_r4',
            userConfirmed: true,
            sourceMessageId: candidate.sourceRoundId || '',
            meta: buildRowMeta(candidate)
        });
        if (!row) throw new Error('正式档案行创建失败');
        markResolved(candidate, STATUS.PROMOTED, descriptor, row, options);
        return { changed: true, duplicate: false, action: 'promote', candidate, descriptor, row, message: `已保存到 ${descriptor.table.name}` };
    }

    function mergeValue(field, current, incoming) {
        if (incoming === undefined || incoming === null || incoming === '') return current;
        if (field.type === 'tags') {
            const oldList = Array.isArray(current) ? current : String(current || '').split(/[,，、\n]/).filter(Boolean);
            const newList = Array.isArray(incoming) ? incoming : String(incoming || '').split(/[,，、\n]/).filter(Boolean);
            return Array.from(new Set([...oldList, ...newList].map(item => String(item).trim()).filter(Boolean))).slice(0, 20);
        }
        if (field.type === 'number' || field.type === 'progress') {
            const before = Number(current);
            const after = Number(incoming);
            if (!Number.isFinite(before)) return incoming;
            return Number.isFinite(after) ? Math.max(before, after) : current;
        }
        if (field.type === 'enum' || field.type === 'date' || field.type === 'boolean') return current === undefined || current === null || current === '' ? incoming : current;
        const before = String(current || '').trim();
        const after = String(incoming || '').trim();
        if (!before) return incoming;
        if (!after || before === after || before.includes(after)) return current;
        return `${before}\n${after}`;
    }

    function merge(chat, candidateId, rowId, options = {}) {
        const candidate = getCandidate(chat, candidateId);
        if (!candidate) throw new Error('候选不存在或已被清理');
        if (candidate.status === STATUS.MERGED && candidate.targetRowId) {
            const descriptor = descriptorByIds(chat, candidate.targetTemplateId, candidate.targetTableId, candidateType(candidate));
            const row = descriptor ? Domain.findRowById(chat, descriptor.template.id, descriptor.table, candidate.targetRowId) : null;
            return { changed: false, duplicate: true, fieldChanges: 0, action: 'merge', candidate, descriptor, row, message: '候选已经合并到正式档案，没有重复写入' };
        }
        ensureActionable(candidate);
        const descriptor = resolveTarget(chat, candidate);
        if (!descriptor) throw new Error('没有找到候选对应的正式档案表');
        const row = Domain.findRowById(chat, descriptor.template.id, descriptor.table, rowId);
        if (!row) throw new Error('请选择仍然存在的目标档案记录');
        const values = buildValues(candidate, descriptor.table);
        let fieldChanges = 0;
        (descriptor.table.columns || []).forEach(field => {
            if (values[field.id] === undefined) return;
            const next = mergeValue(field, row.cells?.[field.id], values[field.id]);
            if (Domain.isSameMemoryValue(row.cells?.[field.id], next)) return;
            if (Domain.updateRowFieldValue(chat, descriptor.template.id, descriptor.table, row.id, field, next, { source: 'sidecar_candidate_merge_v2_13_r4' })) fieldChanges += 1;
        });
        markResolved(candidate, STATUS.MERGED, descriptor, row, options);
        return { changed: true, duplicate: fieldChanges === 0, fieldChanges, action: 'merge', candidate, descriptor, row, message: fieldChanges ? `已合并到 ${descriptor.table.name}` : `目标记录已包含该候选，已建立关联` };
    }

    function dismiss(chat, candidateId, options = {}) {
        const candidate = getCandidate(chat, candidateId);
        ensureActionable(candidate);
        candidate.status = STATUS.DISMISSED;
        candidate.processedAt = Date.now();
        candidate.processedBy = options.processedBy || 'user';
        candidate.operationId = options.operationId || null;
        return { changed: true, action: 'dismiss', candidate, message: '候选已忽略，不会写入正式档案' };
    }

    function remove(chat, candidateId, options = {}) {
        const candidate = getCandidate(chat, candidateId);
        if (!candidate) throw new Error('候选不存在或已被清理');
        if (candidate.status === STATUS.DELETED) return { changed: false, action: 'delete', candidate, message: '候选已经删除' };
        candidate.status = STATUS.DELETED;
        candidate.deletedAt = Date.now();
        candidate.processedBy = options.processedBy || 'user';
        candidate.operationId = options.operationId || null;
        return { changed: true, action: 'delete', candidate, message: '候选已删除；正式档案未受影响' };
    }

    function clearClosed(chat) {
        const state = Kernel.require('sidecar').ensureState(chat);
        const before = state.candidates.length;
        state.candidates = state.candidates.filter(item => !CLOSED.has(normalizeCandidate(item)?.status));
        const count = before - state.candidates.length;
        return { changed: count > 0, action: 'clear-closed', count, message: count ? `已清理 ${count} 条已结束候选` : '没有可清理的已结束候选' };
    }

    function clearAll(chat) {
        const state = Kernel.require('sidecar').ensureState(chat);
        const count = state.candidates.length;
        state.candidates = [];
        return { changed: count > 0, action: 'clear-all', count, message: count ? `已清空 ${count} 条短期候选` : '候选池已经为空' };
    }

    function execute(chat, action, options = {}) {
        if (!chat) throw new Error('当前记忆档案上下文不存在');
        migrateLegacyCandidates(chat);
        if (action === 'save') return promote(chat, options.candidateId, options);
        if (action === 'merge') return merge(chat, options.candidateId, options.targetRowId, options);
        if (action === 'dismiss') return dismiss(chat, options.candidateId, options);
        if (action === 'delete') return remove(chat, options.candidateId, options);
        if (action === 'clear-closed') return clearClosed(chat);
        if (action === 'clear-all') return clearAll(chat);
        throw new Error(`不支持的候选操作：${action || '空'}`);
    }

    function rowLabel(table, row) {
        const preferred = (table.columns || []).filter(field => /标题|内容|日期|身体状态|睡眠情况|精力与情绪/.test(String(field.key || '')));
        const text = preferred.map(field => String(row.cells?.[field.id] || '').trim()).filter(Boolean).join(' · ')
            || Domain.getRowSearchText(table, row).replace(/\n/g, ' · ');
        return text.slice(0, 90) || row.id;
    }

    function listMergeTargets(chat, candidate, limit = 30) {
        const descriptor = resolveTarget(chat, candidate);
        if (!descriptor) return [];
        return Domain.getRows(chat, descriptor.template.id, descriptor.table)
            .slice()
            .sort((a, b) => Number(b.meta?.updatedAt || b.meta?.createdAt || 0) - Number(a.meta?.updatedAt || a.meta?.createdAt || 0))
            .slice(0, limit)
            .map(row => ({ rowId: row.id, label: rowLabel(descriptor.table, row), tableId: descriptor.table.id, tableName: descriptor.table.name }));
    }

    function statusLabel(status) {
        return STATUS_LABELS[status] || status || '待处理';
    }

    Kernel.register('sidecarCandidateService', Object.freeze({
        VERSION,
        STATUS,
        ACTIONABLE,
        CLOSED,
        normalizeCandidate,
        migrateLegacyCandidates,
        resolveTarget,
        listMergeTargets,
        statusLabel,
        execute,
        promote,
        merge,
        dismiss,
        remove,
        clearClosed,
        clearAll
    }));
})(window);
