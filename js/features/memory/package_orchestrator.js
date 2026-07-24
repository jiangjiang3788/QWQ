(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const VERSION = '2.14-R6';

    function create(env = {}) {
        const {
            MemoryFeedback, MemoryPackageAdapter, MemoryPolicy, MemoryQuality, MemoryReview, MemorySidecar,
            MemoryTasks, db, deepClone, ensureMemoryTableState, ensureMemoryTemplateStore, ensureTemplateDataForChat,
            getBoundTemplates, getCurrentMemoryTableChat, renderMemoryTableScreen, replaceTemplateData, saveCharacter, saveData,
            showToast
        } = env;

        function exportTemplate(templateId) {
            const template = db.memoryTableTemplates.find(item => item.id === templateId);
            if (!template) return;
            downloadJson(template, `${template.name || 'memory-template'}.json`);
        }
        const cloneTemplateWithFreshIds = MemoryPackageAdapter.cloneTemplateWithFreshIds;
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
        function buildMemoryPackagePayload(templateIds) {
            const chat = getCurrentMemoryTableChat();
            if (!chat) return null;
            ensureMemoryTableState(chat);
            const boundTemplates = getBoundTemplates(chat).filter(template => templateIds.includes(template.id));
            if (boundTemplates.length === 0) return null;
            const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
            const binding = {
                memoryMode: chat.memoryMode,
                autoUpdateEnabled: !!chat.memoryTables.autoUpdateEnabled,
                autoUpdateInterval: chat.memoryTables.autoUpdateInterval || 140,
                engineSettings: deepClone(runtime?.engineSettings || {}),
                viewMode: runtime?.viewMode || 'normal',
                tableStates: {},
                data: {},
                lockedFields: {},
                sidecar: deepClone(chat.memoryTables.sidecar || {}),
                lifecycle: deepClone(chat.memoryTables.lifecycle || {}),
                taskQueue: MemoryTasks ? { settings: deepClone(MemoryTasks.ensureState(chat).settings) } : null,
                feedback: MemoryFeedback ? { settings: deepClone(MemoryFeedback.ensureState(chat).settings) } : null,
                quality: MemoryQuality ? { settings: deepClone(MemoryQuality.ensureState(chat).settings), testCases: deepClone(MemoryQuality.ensureState(chat).testCases) } : null
            };
            boundTemplates.forEach(template => {
                ensureTemplateDataForChat(chat, template);
                binding.data[template.id] = stripRetrievalVectorsFromData(chat.memoryTables.data?.[template.id] || {});
                binding.lockedFields[template.id] = deepClone(chat.memoryTables.lockedFields?.[template.id] || {});
                binding.tableStates[template.id] = deepClone(runtime?.tableStates?.[template.id] || {});
                Object.values(binding.tableStates[template.id] || {}).forEach(state => {
                    state.pendingReviewBatchId = null;
                    if (state.lastRunStatus === 'pending_review') state.lastRunStatus = 'idle';
                });
            });
            return {
                type: 'memory_table_package',
                version: 2,
                schemaVersion: '2.8',
                producerVersion: '2.14-R6',
                packageProfile: 'portable_snapshot',
                transferPolicy: { resetRuntimeCursors: true, resetMessageReferencesOnImport: true, remapAllInternalIds: true },
                templates: deepClone(boundTemplates),
                binding
            };
        }
        function exportTemplatePackage(templateId) {
            const template = db.memoryTableTemplates.find(item => item.id === templateId);
            if (!template) return;
            const payload = buildMemoryPackagePayload([templateId]) || {
                type: 'memory_table_package',
                version: 2,
                templates: [deepClone(template)],
                binding: null
            };
            downloadJson(payload, `${template.name || 'memory-package'}_package.json`);
        }
        function exportCurrentMemoryPackage() {
            const chat = getCurrentMemoryTableChat();
            if (!chat) {
                showToast('请先进入一个角色聊天');
                return;
            }
            const boundTemplates = getBoundTemplates(chat);
            if (boundTemplates.length === 0) {
                showToast('当前没有可导出的结构记忆模板');
                return;
            }
            const payload = buildMemoryPackagePayload(boundTemplates.map(item => item.id));
            downloadJson(payload, `${chat.remarkName || chat.realName || 'memory'}_memory_package.json`);
        }
        function exportAllTemplates() {
            downloadJson(db.memoryTableTemplates || [], 'memory-table-templates.json');
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
        async function importTemplatesFromFile(file) {
            if (!file) return;
            let parsed;
            try {
                parsed = JSON.parse(await file.text());
            } catch (_) {
                showToast('导入失败：JSON 无法解析');
                return;
            }
            ensureMemoryTemplateStore();
            const isPackage = parsed && typeof parsed === 'object' && parsed.type === 'memory_table_package';
            const list = isPackage ? (Array.isArray(parsed.templates) ? parsed.templates : []) : (Array.isArray(parsed) ? parsed : [parsed]);
            const plan = MemoryPackageAdapter.createImportPlan(list, parsed?.binding || {});
            const chat = getCurrentMemoryTableChat();
            const applyBinding = !!(isPackage && parsed.binding && chat && plan.entries.length
                && window.confirm(MemoryPackageAdapter.portableImportPreview(plan, parsed.binding)));
            plan.entries.forEach(entry => db.memoryTableTemplates.unshift(entry.template));
            if (applyBinding) {
                ensureMemoryTableState(chat);
                const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
                plan.entries.forEach(entry => {
                    const { template } = entry;
                    if (!chat.memoryTables.boundTemplateIds.includes(template.id)) chat.memoryTables.boundTemplateIds.push(template.id);
                    const remapped = MemoryPackageAdapter.remapTableDataForImport(entry, parsed.binding, plan);
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
                if (parsed.binding.memoryMode) chat.memoryMode = parsed.binding.memoryMode;
                chat.memoryTables.autoUpdateEnabled = parsed.binding.autoUpdateEnabled !== false;
                chat.memoryTables.autoUpdateInterval = Math.max(10, parseInt(parsed.binding.autoUpdateInterval, 10) || 140);
                if (MemoryPolicy) {
                    const currentRuntime = MemoryPolicy.ensureRuntimeState(chat);
                    currentRuntime.engineSettings = MemoryPolicy.normalizeEngineSettings(parsed.binding.engineSettings || { messageInterval: chat.memoryTables.autoUpdateInterval });
                    currentRuntime.viewMode = 'normal';
                    currentRuntime.rounds = [];
                    currentRuntime.activeRound = null;
                    currentRuntime.lastRoundId = null;
                }
                chat.memoryTables.sidecar = MemoryPackageAdapter.remapSidecarForImport(parsed.binding.sidecar, plan);
                chat.memoryTables.lifecycle = { schemaVersion: '2.14-R0', lastMaintenanceAt: 0, lastMaintenanceReport: null };
                if (MemoryTasks) {
                    chat.memoryTables.taskQueue = { schemaVersion: '2.14-R0', settings: deepClone(parsed.binding.taskQueue?.settings), tasks: [], history: [], stats: {} };
                    MemoryTasks.ensureState(chat);
                }
                if (MemoryFeedback) {
                    chat.memoryTables.feedback = { schemaVersion: '2.14-R0', settings: deepClone(parsed.binding.feedback?.settings), rounds: [], events: [], stats: {} };
                    MemoryFeedback.ensureState(chat);
                }
                if (MemoryQuality) {
                    chat.memoryTables.quality = MemoryPackageAdapter.remapQualityForImport(parsed.binding.quality, plan);
                    MemoryQuality.ensureState(chat);
                }
                if (MemoryReview) chat.memoryTables.reviewState = { schemaVersion: '2.14-R0', pendingBatches: [], completedBatches: [], activeBatchId: null };
                if (MemorySidecar) MemorySidecar.ensureState(chat);
                await saveCharacter(chat.id);
            }
            await saveData();
            renderMemoryTableScreen();
            const summary = plan.summary;
            showToast(applyBinding
                ? `已安全导入 ${summary.templateCount} 个模板和 ${summary.rowCount} 条行记忆`
                : `已导入 ${summary.templateCount} 个模板结构`);
        }

        return Object.freeze({
            VERSION,
            exportTemplate, exportTemplatePackage, exportCurrentMemoryPackage, exportAllTemplates, downloadJson,
            importTemplatesFromFile
        });
    }

    Kernel.register('packageOrchestrator', Object.freeze({ VERSION, create }));
})(window);
