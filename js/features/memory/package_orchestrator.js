(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const SchemaMigrator = Kernel.require('schemaMigrator');
    const VERSION = '2.14-R7';
    const SCHEMA_VERSION = SchemaMigrator.CURRENT_SCHEMA_VERSION;

    function create(env = {}) {
        const {
            MemoryFeedback, MemoryPackageAdapter, MemoryPolicy, MemoryQuality, MemoryReview, MemorySidecar,
            MemoryTasks, MemoryWriteGateway, db, deepClone, ensureMemoryTableState, ensureMemoryTemplateStore,
            ensureTemplateDataForChat, getBoundTemplates, getCurrentMemoryTableChat, renderMemoryTableScreen,
            replaceTemplateData, saveCharacter, saveData, showToast
        } = env;

        function nowPackage(profile, templates) {
            return {
                type: 'memory_table_package',
                version: 3,
                formatVersion: 1,
                schemaVersion: SCHEMA_VERSION,
                producerVersion: VERSION,
                packageProfile: profile,
                createdAt: Date.now(),
                templates: deepClone(templates || [])
            };
        }

        function countRowsInData(data) {
            let count = 0;
            Object.values(data || {}).forEach(templateData => Object.values(templateData || {}).forEach(tableData => {
                if (Array.isArray(tableData?.__rows)) count += tableData.__rows.length;
            }));
            return count;
        }

        function countRowsInMemoryTables(memoryTables) {
            return countRowsInData(memoryTables?.data || {});
        }

        function stripRetrievalVectorsFromData(data) {
            const cloned = deepClone(data || {});
            Object.values(cloned).forEach(tableData => {
                if (!tableData || !Array.isArray(tableData.__rows)) return;
                tableData.__rows.forEach(row => {
                    if (!row?.meta) return;
                    delete row.meta.retrievalVector;
                    delete row.meta.retrievalVectorFingerprint;
                    delete row.meta.retrievalIndexedAt;
                });
            });
            return cloned;
        }

        function buildTemplateBundlePayload(templateIds = null) {
            const all = Array.isArray(db?.memoryTableTemplates) ? db.memoryTableTemplates : [];
            const selected = Array.isArray(templateIds) ? all.filter(item => templateIds.includes(item.id)) : all;
            return {
                ...nowPackage('template_bundle', selected),
                binding: null,
                transferPolicy: {
                    preserveTemplateIds: false,
                    includeCharacterData: false,
                    includeRuntimeState: false
                }
            };
        }

        function buildPortableSnapshotPayload(templateIds) {
            const chat = getCurrentMemoryTableChat?.();
            if (!chat) return null;
            ensureMemoryTableState(chat);
            const selectedIds = Array.isArray(templateIds) ? templateIds : [];
            const boundTemplates = getBoundTemplates(chat).filter(template => !selectedIds.length || selectedIds.includes(template.id));
            if (!boundTemplates.length) return null;
            const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
            const binding = {
                memoryMode: chat.memoryMode,
                autoUpdateEnabled: !!chat.memoryTables.autoUpdateEnabled,
                autoUpdateInterval: chat.memoryTables.autoUpdateInterval || 140,
                engineSettings: deepClone(runtime?.engineSettings || {}),
                viewMode: 'normal',
                tableStates: {},
                data: {},
                lockedFields: {},
                sidecar: deepClone(chat.memoryTables.sidecar || {}),
                lifecycle: deepClone(chat.memoryTables.lifecycle || {}),
                taskQueue: MemoryTasks ? { settings: deepClone(MemoryTasks.ensureState(chat).settings) } : null,
                feedback: MemoryFeedback ? { settings: deepClone(MemoryFeedback.ensureState(chat).settings) } : null,
                quality: MemoryQuality ? {
                    settings: deepClone(MemoryQuality.ensureState(chat).settings),
                    testCases: deepClone(MemoryQuality.ensureState(chat).testCases)
                } : null
            };
            boundTemplates.forEach(template => {
                ensureTemplateDataForChat(chat, template);
                binding.data[template.id] = stripRetrievalVectorsFromData(chat.memoryTables.data?.[template.id] || {});
                binding.lockedFields[template.id] = deepClone(chat.memoryTables.lockedFields?.[template.id] || {});
                binding.tableStates[template.id] = deepClone(runtime?.tableStates?.[template.id] || {});
                Object.values(binding.tableStates[template.id] || {}).forEach(state => {
                    state.lastProcessedMsgId = null;
                    state.lastProcessedMsgTimestamp = 0;
                    state.lastProcessedRoundId = null;
                    state.customCursorPosition = null;
                    state.pendingReviewBatchId = null;
                    if (state.lastRunStatus === 'pending_review') state.lastRunStatus = 'idle';
                });
            });
            return {
                ...nowPackage('portable_snapshot', boundTemplates),
                transferPolicy: {
                    resetRuntimeCursors: true,
                    resetMessageReferencesOnImport: true,
                    remapAllInternalIds: true,
                    includeRuntimeHistory: false
                },
                binding
            };
        }

        function buildFullBackupPayload() {
            const chat = getCurrentMemoryTableChat?.();
            if (!chat) return null;
            ensureMemoryTableState(chat);
            const boundTemplates = getBoundTemplates(chat);
            return {
                ...nowPackage('full_backup', boundTemplates),
                subject: {
                    characterId: String(chat.id || ''),
                    displayName: String(chat.remarkName || chat.realName || chat.name || '当前角色')
                },
                transferPolicy: {
                    preserveAllIds: true,
                    preserveRuntimeState: true,
                    originalCharacterOnly: true
                },
                backup: {
                    memoryMode: chat.memoryMode,
                    memoryTables: deepClone(chat.memoryTables || {})
                }
            };
        }

        function downloadJson(data, filename) {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        }

        function exportTemplate(templateId) {
            const template = db.memoryTableTemplates.find(item => item.id === templateId);
            if (!template) return;
            downloadJson(buildTemplateBundlePayload([templateId]), `${template.name || 'memory-template'}_template.json`);
        }

        function exportAllTemplates() {
            downloadJson(buildTemplateBundlePayload(), 'memory-table-templates_template.json');
        }

        function exportTemplatePackage(templateId) {
            const template = db.memoryTableTemplates.find(item => item.id === templateId);
            if (!template) return;
            const payload = buildPortableSnapshotPayload([templateId]);
            if (!payload) {
                showToast('当前角色未绑定该模板，只能导出模板结构');
                exportTemplate(templateId);
                return;
            }
            downloadJson(payload, `${template.name || 'memory'}_portable_snapshot.json`);
        }

        function exportCurrentMemoryPackage() {
            const chat = getCurrentMemoryTableChat?.();
            if (!chat) return showToast('请先进入一个角色聊天');
            const payload = buildPortableSnapshotPayload(getBoundTemplates(chat).map(item => item.id));
            if (!payload) return showToast('当前没有可导出的结构记忆模板');
            downloadJson(payload, `${chat.remarkName || chat.realName || 'memory'}_portable_snapshot.json`);
        }

        function exportFullBackup() {
            const chat = getCurrentMemoryTableChat?.();
            if (!chat) return showToast('请先进入一个角色聊天');
            const payload = buildFullBackupPayload();
            downloadJson(payload, `${chat.remarkName || chat.realName || 'memory'}_full_memory_backup.json`);
        }

        function fullBackupPreview(payload, migrationReport = null) {
            const rows = countRowsInMemoryTables(payload?.backup?.memoryTables);
            const subject = payload?.subject?.displayName || payload?.subject?.characterId || '原角色';
            return [
                migrationReport ? SchemaMigrator.formatPreview(migrationReport) : '',
                migrationReport ? '' : '',
                `检测到“${subject}”的完整记忆备份。`,
                `包含 ${payload.templates?.length || 0} 个模板、${rows} 条行记忆，以及审核、候选、索引、游标和历史运行状态。`,
                '',
                '恢复后会覆盖当前角色的全部结构化记忆状态，并保持原模板、表格、字段和记忆 ID。',
                '该格式只能恢复到导出时的同一角色。',
                '',
                '确定继续恢复吗？'
            ].filter((line, index, list) => line !== '' || (index > 0 && list[index - 1] !== '')).join('\n');
        }

        async function restoreFullBackup(payload, migrationReport = null) {
            const chat = getCurrentMemoryTableChat?.();
            if (!chat) throw new Error('请先进入需要恢复的角色聊天');
            const sourceCharacterId = String(payload?.subject?.characterId || '');
            if (!sourceCharacterId || sourceCharacterId !== String(chat.id || '')) {
                throw new Error('完整备份只能恢复到导出时的原角色；跨角色请使用“迁移快照”');
            }
            if (!global.confirm(fullBackupPreview(payload, migrationReport))) return { cancelled: true };
            const backupTables = deepClone(payload.backup?.memoryTables || {});
            const backupMode = payload.backup?.memoryMode || chat.memoryMode;
            const backupTemplates = deepClone(payload.templates || []);
            const capture = () => ({
                memoryTables: deepClone(chat.memoryTables || {}),
                memoryMode: chat.memoryMode,
                templates: deepClone(db.memoryTableTemplates || [])
            });
            const restore = (_chat, snapshot) => {
                chat.memoryTables = deepClone(snapshot.memoryTables || {});
                chat.memoryMode = snapshot.memoryMode;
                db.memoryTableTemplates = deepClone(snapshot.templates || []);
            };
            const mutate = async () => {
                const byId = new Map((db.memoryTableTemplates || []).map((item, index) => [item.id, index]));
                backupTemplates.forEach(template => {
                    if (byId.has(template.id)) db.memoryTableTemplates[byId.get(template.id)] = deepClone(template);
                    else db.memoryTableTemplates.unshift(deepClone(template));
                });
                chat.memoryMode = backupMode;
                chat.memoryTables = deepClone(backupTables);
                ensureMemoryTableState(chat, { forceUiHydration: true });
                return {
                    changed: true,
                    action: 'restore',
                    recordCount: countRowsInMemoryTables(chat.memoryTables),
                    fieldCount: 0,
                    summary: `恢复 ${countRowsInMemoryTables(chat.memoryTables)} 条记忆及完整运行状态`
                };
            };
            if (MemoryWriteGateway?.run) {
                await MemoryWriteGateway.run(chat, {
                    reason: 'full-memory-backup-restore',
                    action: 'restore',
                    capture,
                    restore,
                    writer: async () => { await saveCharacter(chat.id); await saveData(); },
                    rollbackWriter: async () => { await saveCharacter(chat.id); await saveData(); }
                }, mutate);
            } else {
                const snapshot = capture();
                try { await mutate(); await saveCharacter(chat.id); await saveData(); }
                catch (error) { restore(chat, snapshot); throw error; }
            }
            renderMemoryTableScreen();
            showToast(`已恢复完整备份：${countRowsInMemoryTables(chat.memoryTables)} 条记忆`);
            return { restored: true };
        }

        function preparePackage(parsed) {
            const preview = SchemaMigrator.preview(parsed);
            if (!preview.ok) throw new Error(preview.errors.join('；'));
            return SchemaMigrator.migrate(parsed);
        }

        async function importPortableOrTemplates(payload, migrationReport) {
            ensureMemoryTemplateStore();
            const list = Array.isArray(payload.templates) ? payload.templates : [];
            const plan = MemoryPackageAdapter.createImportPlan(list, payload.binding || {});
            const chat = getCurrentMemoryTableChat?.();
            const migrationText = SchemaMigrator.formatPreview(migrationReport);
            const applyBinding = !!(payload.packageProfile === 'portable_snapshot' && payload.binding && chat && plan.entries.length
                && global.confirm(`${migrationText}\n\n${MemoryPackageAdapter.portableImportPreview(plan, payload.binding)}`));
            plan.entries.forEach(entry => db.memoryTableTemplates.unshift(entry.template));
            if (applyBinding) {
                ensureMemoryTableState(chat);
                const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
                plan.entries.forEach(entry => {
                    const { template } = entry;
                    if (!chat.memoryTables.boundTemplateIds.includes(template.id)) chat.memoryTables.boundTemplateIds.push(template.id);
                    const remapped = MemoryPackageAdapter.remapTableDataForImport(entry, payload.binding, plan);
                    replaceTemplateData(chat, template.id, remapped.data, { source: 'portable-import' });
                    chat.memoryTables.lockedFields[template.id] = remapped.lockedFields;
                    if (runtime) {
                        runtime.tableStates[template.id] = {};
                        (template.tables || []).forEach(table => {
                            const state = MemoryPolicy.ensureTableState(chat, template.id, table.id, { table });
                            Object.assign(state, MemoryPackageAdapter.freshRuntimeState(), { automationMode: MemoryPolicy.inferAutomationMode(table) });
                        });
                    }
                });
                if (payload.binding.memoryMode) chat.memoryMode = payload.binding.memoryMode;
                chat.memoryTables.autoUpdateEnabled = payload.binding.autoUpdateEnabled !== false;
                chat.memoryTables.autoUpdateInterval = Math.max(10, parseInt(payload.binding.autoUpdateInterval, 10) || 140);
                if (MemoryPolicy) {
                    const currentRuntime = MemoryPolicy.ensureRuntimeState(chat);
                    currentRuntime.engineSettings = MemoryPolicy.normalizeEngineSettings(payload.binding.engineSettings || { messageInterval: chat.memoryTables.autoUpdateInterval });
                    currentRuntime.viewMode = 'normal';
                    currentRuntime.rounds = [];
                    currentRuntime.activeRound = null;
                    currentRuntime.lastRoundId = null;
                }
                chat.memoryTables.sidecar = MemoryPackageAdapter.remapSidecarForImport(payload.binding.sidecar, plan);
                chat.memoryTables.lifecycle = { schemaVersion: VERSION, lastMaintenanceAt: 0, lastMaintenanceReport: null };
                if (MemoryTasks) {
                    chat.memoryTables.taskQueue = { schemaVersion: VERSION, settings: deepClone(payload.binding.taskQueue?.settings), tasks: [], history: [], stats: {} };
                    MemoryTasks.ensureState(chat);
                }
                if (MemoryFeedback) {
                    chat.memoryTables.feedback = { schemaVersion: VERSION, settings: deepClone(payload.binding.feedback?.settings), rounds: [], events: [], stats: {} };
                    MemoryFeedback.ensureState(chat);
                }
                if (MemoryQuality) {
                    chat.memoryTables.quality = MemoryPackageAdapter.remapQualityForImport(payload.binding.quality, plan);
                    MemoryQuality.ensureState(chat);
                }
                if (MemoryReview) chat.memoryTables.reviewState = { schemaVersion: VERSION, pendingBatches: [], completedBatches: [], activeBatchId: null };
                if (MemorySidecar) MemorySidecar.ensureState(chat);
                await saveCharacter(chat.id);
            }
            await saveData();
            renderMemoryTableScreen();
            const summary = plan.summary;
            showToast(applyBinding
                ? `已安全导入 ${summary.templateCount} 个模板和 ${summary.rowCount} 条行记忆`
                : `已导入 ${summary.templateCount} 个模板结构`);
            return { plan, applyBinding };
        }

        async function importTemplatesFromFile(file) {
            if (!file) return;
            let parsed;
            try { parsed = JSON.parse(await file.text()); }
            catch (_) { return showToast('导入失败：JSON 无法解析'); }
            try {
                const isPackage = parsed && typeof parsed === 'object' && parsed.type === 'memory_table_package';
                if (!isPackage) {
                    const rawPayload = buildTemplateBundlePayload([]);
                    rawPayload.templates = Array.isArray(parsed) ? parsed : [parsed];
                    return importPortableOrTemplates(rawPayload, SchemaMigrator.preview(rawPayload));
                }
                const migrated = preparePackage(parsed);
                if (migrated.payload.packageProfile === 'full_backup') return await restoreFullBackup(migrated.payload, migrated.report);
                if (migrated.payload.packageProfile === 'template_bundle' && migrated.report.steps.length) {
                    const accepted = global.confirm(`${SchemaMigrator.formatPreview(migrated.report)}\n\n将导入 ${migrated.payload.templates.length} 个模板结构，不包含角色记忆。`);
                    if (!accepted) return { cancelled: true };
                }
                return await importPortableOrTemplates(migrated.payload, migrated.report);
            } catch (error) {
                console.error('[MemoryPackageOrchestrator] import failed:', error);
                showToast(`导入失败：${error.message || '未知错误'}`);
                return { error };
            }
        }

        return Object.freeze({
            VERSION,
            buildTemplateBundlePayload,
            buildPortableSnapshotPayload,
            buildFullBackupPayload,
            exportTemplate,
            exportTemplatePackage,
            exportCurrentMemoryPackage,
            exportFullBackup,
            exportAllTemplates,
            downloadJson,
            importTemplatesFromFile,
            restoreFullBackup,
            fullBackupPreview,
            countRowsInMemoryTables
        });
    }

    Kernel.register('packageOrchestrator', Object.freeze({ VERSION, create }));
})(window);
