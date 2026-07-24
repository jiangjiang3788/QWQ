(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;

    const VERSION = '2.14-R7';
    const CURRENT_SCHEMA_VERSION = '3.0';
    const LEGACY_DEFAULT_VERSION = '2.8';
    const PROFILE_ALIASES = Object.freeze({
        template: 'template_bundle',
        templates: 'template_bundle',
        template_only: 'template_bundle',
        template_bundle: 'template_bundle',
        portable: 'portable_snapshot',
        portable_snapshot: 'portable_snapshot',
        memory_snapshot: 'portable_snapshot',
        full: 'full_backup',
        backup: 'full_backup',
        full_backup: 'full_backup'
    });

    function clone(value) {
        return Core.clone ? Core.clone(value) : JSON.parse(JSON.stringify(value));
    }

    function normalizeProfile(value, payload = {}) {
        const raw = String(value || '').trim().toLowerCase();
        if (PROFILE_ALIASES[raw]) return PROFILE_ALIASES[raw];
        if (payload.backup || payload.characterMemory) return 'full_backup';
        if (payload.binding) return 'portable_snapshot';
        return 'template_bundle';
    }

    function normalizeSchemaVersion(payload) {
        const raw = String(payload?.schemaVersion || '').trim();
        if (!raw && payload?.type === 'memory_table_package') return LEGACY_DEFAULT_VERSION;
        const match = raw.match(/^(\d+)\.(\d+)/);
        return match ? `${Number(match[1])}.${Number(match[2])}` : raw;
    }

    function appendTrace(payload, step) {
        const trace = Array.isArray(payload.migrationTrace) ? payload.migrationTrace.slice(-30) : [];
        trace.push({ id: step.id, from: step.from, to: step.to, title: step.title, at: Date.now() });
        payload.migrationTrace = trace;
    }

    const MIGRATIONS = Object.freeze([
        Object.freeze({
            id: 'memory-package-2.8-to-2.9',
            from: '2.8',
            to: '2.9',
            title: '补齐记忆包类型与导出语义',
            apply(source) {
                const payload = clone(source || {});
                payload.type = 'memory_table_package';
                payload.version = Math.max(2, Number(payload.version) || 2);
                payload.schemaVersion = '2.9';
                payload.producerVersion = String(payload.producerVersion || 'legacy');
                payload.packageProfile = normalizeProfile(payload.packageProfile, payload);
                payload.templates = Array.isArray(payload.templates) ? payload.templates : [];
                if (payload.packageProfile === 'template_bundle') payload.binding = null;
                if (payload.packageProfile === 'portable_snapshot') {
                    payload.binding = payload.binding && typeof payload.binding === 'object' ? payload.binding : {};
                    payload.transferPolicy = {
                        resetRuntimeCursors: true,
                        resetMessageReferencesOnImport: true,
                        remapAllInternalIds: true,
                        ...(payload.transferPolicy || {})
                    };
                }
                appendTrace(payload, this);
                return payload;
            }
        }),
        Object.freeze({
            id: 'memory-package-2.9-to-3.0',
            from: '2.9',
            to: '3.0',
            title: '统一模板、迁移快照与完整备份格式',
            apply(source) {
                const payload = clone(source || {});
                payload.type = 'memory_table_package';
                payload.version = 3;
                payload.formatVersion = 1;
                payload.schemaVersion = '3.0';
                payload.packageProfile = normalizeProfile(payload.packageProfile, payload);
                payload.createdAt = Number(payload.createdAt) || Date.now();
                payload.templates = Array.isArray(payload.templates) ? payload.templates : [];
                if (payload.packageProfile === 'template_bundle') {
                    payload.binding = null;
                    delete payload.backup;
                    payload.transferPolicy = {
                        preserveTemplateIds: false,
                        includeCharacterData: false,
                        includeRuntimeState: false
                    };
                } else if (payload.packageProfile === 'portable_snapshot') {
                    payload.binding = payload.binding && typeof payload.binding === 'object' ? payload.binding : {};
                    delete payload.backup;
                    payload.transferPolicy = {
                        resetRuntimeCursors: true,
                        resetMessageReferencesOnImport: true,
                        remapAllInternalIds: true,
                        includeRuntimeHistory: false,
                        ...(payload.transferPolicy || {})
                    };
                } else {
                    payload.backup = payload.backup && typeof payload.backup === 'object'
                        ? payload.backup
                        : (payload.characterMemory && typeof payload.characterMemory === 'object' ? { characterMemory: payload.characterMemory } : {});
                    payload.transferPolicy = {
                        preserveAllIds: true,
                        preserveRuntimeState: true,
                        originalCharacterOnly: true,
                        ...(payload.transferPolicy || {})
                    };
                }
                appendTrace(payload, this);
                return payload;
            }
        })
    ]);

    function findPath(fromVersion, targetVersion = CURRENT_SCHEMA_VERSION) {
        const path = [];
        let cursor = fromVersion;
        const visited = new Set();
        while (cursor !== targetVersion) {
            if (visited.has(cursor)) return null;
            visited.add(cursor);
            const step = MIGRATIONS.find(item => item.from === cursor);
            if (!step) return null;
            path.push(step);
            cursor = step.to;
        }
        return path;
    }

    function validatePackage(payload) {
        const errors = [];
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) errors.push('记忆包必须是 JSON 对象');
        if (payload?.type !== 'memory_table_package') errors.push('不是结构化记忆包');
        if (!Array.isArray(payload?.templates)) errors.push('记忆包缺少模板数组');
        const profile = normalizeProfile(payload?.packageProfile, payload || {});
        if (profile === 'portable_snapshot' && (!payload.binding || typeof payload.binding !== 'object')) errors.push('可迁移快照缺少记忆绑定数据');
        if (profile === 'full_backup' && (!payload.backup || typeof payload.backup !== 'object')) errors.push('完整备份缺少角色记忆数据');
        return errors;
    }

    function preview(input) {
        const payload = input && typeof input === 'object' ? input : null;
        const fromVersion = normalizeSchemaVersion(payload);
        if (!payload || payload.type !== 'memory_table_package') {
            return Object.freeze({ ok: false, isPackage: false, fromVersion: '', toVersion: CURRENT_SCHEMA_VERSION, profile: '', steps: [], warnings: [], errors: ['不是结构化记忆包'] });
        }
        if (!fromVersion) {
            return Object.freeze({ ok: false, isPackage: true, fromVersion: '', toVersion: CURRENT_SCHEMA_VERSION, profile: normalizeProfile(payload.packageProfile, payload), steps: [], warnings: [], errors: ['无法识别记忆包版本'] });
        }
        const path = findPath(fromVersion);
        if (!path) {
            const future = Number.parseFloat(fromVersion) > Number.parseFloat(CURRENT_SCHEMA_VERSION);
            return Object.freeze({
                ok: false,
                isPackage: true,
                fromVersion,
                toVersion: CURRENT_SCHEMA_VERSION,
                profile: normalizeProfile(payload.packageProfile, payload),
                steps: [],
                warnings: [],
                errors: [future ? `记忆包版本 ${fromVersion} 高于当前支持版本 ${CURRENT_SCHEMA_VERSION}` : `没有从 ${fromVersion} 到 ${CURRENT_SCHEMA_VERSION} 的迁移路径`]
            });
        }
        const warnings = [];
        if (path.length) warnings.push('迁移只在内存副本中执行，确认导入后才会写入。');
        if (normalizeProfile(payload.packageProfile, payload) === 'full_backup') warnings.push('完整备份仅允许恢复到原角色。');
        return Object.freeze({
            ok: true,
            isPackage: true,
            fromVersion,
            toVersion: CURRENT_SCHEMA_VERSION,
            profile: normalizeProfile(payload.packageProfile, payload),
            steps: path.map(step => Object.freeze({ id: step.id, from: step.from, to: step.to, title: step.title })),
            warnings,
            errors: []
        });
    }

    function migrate(input) {
        const report = preview(input);
        if (!report.ok) {
            const error = new Error(report.errors.join('；') || '记忆包迁移失败');
            error.migrationReport = report;
            throw error;
        }
        let payload = clone(input);
        const path = findPath(report.fromVersion) || [];
        path.forEach(step => { payload = step.apply(payload); });
        payload.schemaVersion = CURRENT_SCHEMA_VERSION;
        payload.packageProfile = normalizeProfile(payload.packageProfile, payload);
        const validationErrors = validatePackage(payload);
        if (validationErrors.length) {
            const error = new Error(validationErrors.join('；'));
            error.migrationReport = { ...report, errors: validationErrors };
            throw error;
        }
        return Object.freeze({
            payload,
            report: Object.freeze({ ...report, applied: path.map(step => step.id), migrated: path.length > 0 })
        });
    }

    function formatPreview(report) {
        if (!report?.ok) return `无法导入：${(report?.errors || ['未知迁移错误']).join('；')}`;
        if (!report.steps.length) return `Schema ${report.toVersion}，无需迁移。`;
        return [
            `Schema ${report.fromVersion} → ${report.toVersion}`,
            ...report.steps.map((step, index) => `${index + 1}. ${step.title}`),
            '',
            ...report.warnings
        ].filter(Boolean).join('\n');
    }

    Kernel.register('schemaMigrator', Object.freeze({
        VERSION,
        CURRENT_SCHEMA_VERSION,
        MIGRATIONS,
        normalizeProfile,
        normalizeSchemaVersion,
        validatePackage,
        preview,
        migrate,
        formatPreview
    }));
})(window);
