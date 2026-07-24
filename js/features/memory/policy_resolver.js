(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Policy = Kernel.require('policy');
    const clone = Core.clone;

    const VERSION = '2.14-R5';
    const SOURCE_LABELS = Object.freeze({
        system: '系统默认',
        template: '模板默认',
        role: '当前角色覆盖',
        global: '全局默认'
    });
    const POLICY_PATHS = Object.freeze([
        'capturePolicy.mode', 'capturePolicy.frequencySource', 'capturePolicy.apiMode',
        'commitPolicy.mode', 'commitPolicy.requireUserConfirmation',
        'updatePolicy.enabled', 'updatePolicy.triggerMode', 'updatePolicy.roundInterval',
        'updatePolicy.messageInterval', 'updatePolicy.maxSourceMessages', 'updatePolicy.overlapMessages',
        'updatePolicy.useSummaryApi', 'updatePolicy.allowAdd', 'updatePolicy.allowUpdate',
        'updatePolicy.allowDelete', 'updatePolicy.instructions',
        'injectionPolicy.mode', 'injectionPolicy.topK', 'injectionPolicy.threshold',
        'injectionPolicy.budget', 'injectionPolicy.maxAgeDays', 'injectionPolicy.includePinned',
        'injectionPolicy.includeCompleted', 'injectionPolicy.instructions'
    ]);
    const POLICY_PATH_SET = new Set(POLICY_PATHS);
    const GLOBAL_SCHEDULE_PATHS = new Set([
        'updatePolicy.triggerMode', 'updatePolicy.roundInterval', 'updatePolicy.messageInterval',
        'updatePolicy.maxSourceMessages', 'updatePolicy.overlapMessages'
    ]);
    const NUMBER_PATHS = new Set([
        'updatePolicy.roundInterval', 'updatePolicy.messageInterval', 'updatePolicy.maxSourceMessages',
        'updatePolicy.overlapMessages', 'injectionPolicy.topK', 'injectionPolicy.threshold',
        'injectionPolicy.budget', 'injectionPolicy.maxAgeDays'
    ]);
    const BOOLEAN_PATHS = new Set([
        'commitPolicy.requireUserConfirmation', 'updatePolicy.enabled', 'updatePolicy.useSummaryApi',
        'updatePolicy.allowAdd', 'updatePolicy.allowUpdate', 'updatePolicy.allowDelete',
        'injectionPolicy.includePinned', 'injectionPolicy.includeCompleted'
    ]);

    function isObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function getAt(source, path) {
        return String(path || '').split('.').reduce((value, key) => value == null ? undefined : value[key], source);
    }

    function hasAt(source, path) {
        const parts = String(path || '').split('.');
        let cursor = source;
        for (const key of parts) {
            if (!isObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, key)) return false;
            cursor = cursor[key];
        }
        return true;
    }

    function setAt(target, path, value) {
        const parts = String(path || '').split('.');
        let cursor = target;
        parts.forEach((key, index) => {
            if (index === parts.length - 1) cursor[key] = value;
            else {
                if (!isObject(cursor[key])) cursor[key] = {};
                cursor = cursor[key];
            }
        });
        return target;
    }

    function deleteAt(target, path) {
        const parts = String(path || '').split('.');
        const stack = [];
        let cursor = target;
        for (const key of parts) {
            if (!isObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, key)) return false;
            stack.push([cursor, key]);
            cursor = cursor[key];
        }
        const [parent, key] = stack.pop();
        delete parent[key];
        while (stack.length) {
            const [owner, childKey] = stack.pop();
            if (isObject(owner[childKey]) && Object.keys(owner[childKey]).length === 0) delete owner[childKey];
            else break;
        }
        return true;
    }

    function stableEqual(left, right) {
        if (left === right) return true;
        return JSON.stringify(left) === JSON.stringify(right);
    }

    function coerce(path, value) {
        if (NUMBER_PATHS.has(path)) {
            if (value === '' || value === null || value === undefined) return undefined;
            const number = Number(value);
            return Number.isFinite(number) ? number : undefined;
        }
        if (BOOLEAN_PATHS.has(path)) {
            if (typeof value === 'boolean') return value;
            if (value === 'true') return true;
            if (value === 'false') return false;
            return !!value;
        }
        return value;
    }

    function ensureOverrideRoot(chat) {
        if (!chat) return {};
        const runtime = Policy.ensureRuntimeState(chat);
        if (!isObject(runtime.policyOverrides)) runtime.policyOverrides = {};
        return runtime.policyOverrides;
    }

    function getTemplateOverrides(chat, templateId) {
        const root = ensureOverrideRoot(chat);
        return isObject(root[templateId]) ? root[templateId] : {};
    }

    function cloneTemplateOverrides(chat, templateId) {
        return clone(getTemplateOverrides(chat, templateId));
    }

    function cleanTableOverride(raw) {
        const source = isObject(raw) ? raw : {};
        const clean = {};
        POLICY_PATHS.forEach(path => {
            if (!hasAt(source, path)) return;
            const value = coerce(path, getAt(source, path));
            if (value !== undefined) setAt(clean, path, value);
        });
        return clean;
    }

    function normalizeOverrideMap(raw, template) {
        const source = isObject(raw) ? raw : {};
        const allowedTableIds = new Set((template?.tables || []).map(table => table.id));
        const result = {};
        Object.entries(source).forEach(([tableId, value]) => {
            if (allowedTableIds.size && !allowedTableIds.has(tableId)) return;
            const clean = cleanTableOverride(value);
            if (Object.keys(clean).length) result[tableId] = clean;
        });
        return result;
    }

    function replaceTemplateOverrides(chat, templateId, overrideMap, template) {
        if (!chat || !templateId) throw new Error('缺少当前角色或模板');
        const root = ensureOverrideRoot(chat);
        const clean = normalizeOverrideMap(overrideMap, template);
        if (Object.keys(clean).length) root[templateId] = clean;
        else delete root[templateId];
        return clone(clean);
    }

    function mergeDescriptor(table, override) {
        const patch = cleanTableOverride(override);
        return {
            ...table,
            capturePolicy: { ...(table?.capturePolicy || {}), ...(patch.capturePolicy || {}) },
            commitPolicy: { ...(table?.commitPolicy || {}), ...(patch.commitPolicy || {}) },
            updatePolicy: { ...(table?.updatePolicy || {}), ...(patch.updatePolicy || {}) },
            injectionPolicy: { ...(table?.injectionPolicy || {}), ...(patch.injectionPolicy || {}) }
        };
    }

    function explicitTemplateSource(table, path) {
        return hasAt(table, path) ? 'template' : 'system';
    }

    function sourceFor(table, override, effectivePolicy, path) {
        if (hasAt(override, path)) return 'role';
        if (GLOBAL_SCHEDULE_PATHS.has(path)
            && effectivePolicy.capturePolicy?.mode === 'scheduled'
            && effectivePolicy.capturePolicy?.frequencySource === 'global') return 'global';
        return explicitTemplateSource(table, path);
    }

    function captureLabel(policy) {
        const labels = { sidecar: '聊天同请求', scheduled: '周期整理', manual: '手动整理', disabled: '关闭' };
        return labels[policy?.mode] || '手动整理';
    }

    function commitLabel(policy) {
        const labels = { direct: '直接生效', review: '先确认', candidate: '进入候选', manual_only: '仅人工', promotion: '批准后晋升' };
        return labels[policy?.mode] || '先确认';
    }

    function injectionLabel(policy) {
        const labels = { always: '总是注入', active: '活跃时注入', relevant: '相关时注入', never: '不注入' };
        return labels[policy?.mode] || '相关时注入';
    }

    function scheduleLabel(capturePolicy, updatePolicy) {
        if (capturePolicy?.mode !== 'scheduled') return captureLabel(capturePolicy);
        const trigger = { rounds: '按轮', messages: '按消息', either: '先到者', manual: '仅手动' }[updatePolicy?.triggerMode] || '先到者';
        const details = [];
        if (updatePolicy?.roundInterval > 0) details.push(`${updatePolicy.roundInterval} 轮`);
        if (updatePolicy?.messageInterval > 0) details.push(`${updatePolicy.messageInterval} 条`);
        return `${trigger}${details.length ? ` · ${details.join(' / ')}` : ''}`;
    }

    function resolve(chat, templateId, table, options = {}) {
        const overrideMap = isObject(options.overrides) ? options.overrides : getTemplateOverrides(chat, templateId);
        const override = cleanTableOverride(overrideMap?.[table?.id]);
        const descriptor = mergeDescriptor(table || {}, override);
        const templatePolicy = Policy.normalizeTablePolicy(table || {});
        const normalized = Policy.normalizeTablePolicy(descriptor);
        const engine = Policy.normalizeEngineSettings(options.engineSettings || chat?.memoryTables?.engineSettings);
        const effectiveUpdate = Policy.resolveEffectiveUpdatePolicy(descriptor, engine, Policy.inferAutomationMode(descriptor));
        const effective = {
            ...normalized,
            updatePolicy: effectiveUpdate
        };
        const sources = Object.fromEntries(POLICY_PATHS.map(path => [path, sourceFor(table || {}, override, normalized, path)]));
        const sourceSummary = {
            capture: sources['capturePolicy.mode'],
            commit: sources['commitPolicy.mode'],
            schedule: normalized.capturePolicy?.mode === 'scheduled'
                ? (normalized.capturePolicy?.frequencySource === 'global' ? 'global' : sources['updatePolicy.triggerMode'])
                : sources['capturePolicy.mode'],
            injection: sources['injectionPolicy.mode']
        };
        const materializedTable = {
            ...(table || {}),
            memoryLayer: effective.memoryLayer,
            systemRole: effective.systemRole,
            capturePolicy: clone(effective.capturePolicy),
            commitPolicy: clone(effective.commitPolicy),
            updatePolicy: clone(effective.updatePolicy),
            injectionPolicy: clone(effective.injectionPolicy)
        };
        return {
            templateId,
            tableId: table?.id || '',
            templatePolicy,
            override,
            effective,
            sources,
            sourceSummary,
            materializedTable,
            labels: {
                capture: captureLabel(effective.capturePolicy),
                commit: commitLabel(effective.commitPolicy),
                schedule: scheduleLabel(effective.capturePolicy, effective.updatePolicy),
                injection: injectionLabel(effective.injectionPolicy)
            },
            hasRoleOverride: Object.keys(override).length > 0
        };
    }

    function materializeTable(chat, templateId, table, options = {}) {
        return resolve(chat, templateId, table, options).materializedTable;
    }

    function materializeTemplate(chat, template, options = {}) {
        if (!template) return template;
        return {
            ...template,
            tables: (template.tables || []).map(table => materializeTable(chat, template.id, table, options))
        };
    }

    function updateOverrideDraft(draft, template, tableId, path, rawValue) {
        if (!POLICY_PATH_SET.has(path)) return { changed: false, reason: 'unsupported_path' };
        const table = (template?.tables || []).find(item => item.id === tableId);
        if (!table) return { changed: false, reason: 'table_not_found' };
        const target = isObject(draft) ? draft : {};
        target[tableId] ||= {};
        const value = coerce(path, rawValue);
        const templateValue = getAt(Policy.normalizeTablePolicy(table), path);
        if (value === undefined || stableEqual(value, templateValue)) deleteAt(target[tableId], path);
        else setAt(target[tableId], path, value);
        if (!Object.keys(cleanTableOverride(target[tableId])).length) delete target[tableId];
        else target[tableId] = cleanTableOverride(target[tableId]);
        return { changed: true, value, inherited: !target[tableId] || !hasAt(target[tableId], path) };
    }

    function resetTableOverrideDraft(draft, tableId) {
        if (!isObject(draft) || !Object.prototype.hasOwnProperty.call(draft, tableId)) return false;
        delete draft[tableId];
        return true;
    }

    function sourceLabel(source) {
        return SOURCE_LABELS[source] || SOURCE_LABELS.system;
    }

    Kernel.register('policyResolver', Object.freeze({
        VERSION,
        SOURCE_LABELS,
        POLICY_PATHS,
        ensureOverrideRoot,
        getTemplateOverrides,
        cloneTemplateOverrides,
        normalizeOverrideMap,
        replaceTemplateOverrides,
        resolve,
        materializeTable,
        materializeTemplate,
        updateOverrideDraft,
        resetTableOverrideDraft,
        sourceLabel,
        getAt,
        hasAt
    }));
})(window);
