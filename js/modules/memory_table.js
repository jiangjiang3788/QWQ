// --- 结构化记忆 / 表格记忆 (js/modules/memory_table.js) ---
(function () {
    'use strict';
    const Kernel = window.OvoMemoryKernel || null;
    const Core = Kernel?.core;
    if (!Core) throw new Error('记忆内核未加载');
    const MEMORY_TABLE_MAX_CONTEXT_MESSAGES = 60;
    const MemoryPlatformDomain = Kernel.require('memoryPlatformDomain');
    const MemoryFoundationDomain = Kernel.require('memoryFoundationDomain');
    const MemorySchemaDomain = Kernel.require('memorySchemaDomain');
    const MemoryGovernanceDomain = Kernel.require('memoryGovernanceDomain');
    const MemoryRetrievalDomain = Kernel.require('memoryRetrievalDomain');
    const MemoryUpdateDomain = Kernel.require('memoryUpdateDomain');
    const MemoryTablesDomain = Kernel.require('memoryTablesDomain');
    Kernel.require('memoryArchitecture').assertHealthy();

    const {
        policy: MemoryPolicy,
        review: MemoryReview,
        retrieval: MemoryRetrieval,
        effects: MemoryEffects,
        lifecycle: MemoryLifecycle,
        tasks: MemoryTasks,
        feedback: MemoryFeedback,
        quality: MemoryQuality,
        sidecar: MemorySidecar,
        sidecarCandidates: MemorySidecarCandidates,
        sidecarCandidateController: MemorySidecarCandidateController,
        schedule: MemorySchedule
    } = MemoryPlatformDomain;
    const {
        api: MemoryApi,
        domain: MemoryDomain,
        workspace: MemoryWorkspace
    } = MemoryFoundationDomain;
    const {
        model: MemorySchemaModel,
        editor: MemorySchemaEditor
    } = MemorySchemaDomain;
    const {
        candidate: MemoryCandidateService,
        filter: MemoryTableFilter,
        queue: MemoryGovernanceQueue,
        controller: MemoryGovernanceController,
        relation: MemoryRelationService,
        inspector: MemoryRowInspector,
        inspectorController: MemoryRowInspectorController
    } = MemoryGovernanceDomain;
    const { audit: MemoryRetrievalAudit } = MemoryRetrievalDomain;
    const {
        tags: MemoryTagService,
        context: MemoryContextAssembler,
        update: MemoryUpdateService
    } = MemoryUpdateDomain;
    const {
        grid: MemoryTableGrid,
        interaction: MemoryTableInteraction,
        session: MemoryTableSession,
        cache: MemoryTableCache,
        editController: MemoryTableEditController,
        rowEditController: MemoryRowEditController,
        updateActivity: MemoryUpdateActivity,
        workspace: MemoryTableWorkspace
    } = MemoryTablesDomain;
    const {
        ensureMemoryTemplateStore, ensureMemoryTableState: ensureMemoryTableStateBase, getCurrentMemoryTableChat: getCurrentMemoryTableChatBase, createStarterTemplate,
        createEmptyFieldDraft, createEmptyTableDraft, normalizeTemplate, normalizeFieldType, parseOptionText,
        parseConditionalRulesText, serializeConditionalRules, getDefaultValueByType, getFieldDefaultValue,
        getBoundTemplates, isRowsTable, createEmptyRow, normalizeRowShape, ensureTemplateDataForChat, getRows,
        findRowById, normalizeFieldValue, clampFieldValue, getFieldValue, pushMemoryHistory, setFieldValue,
        isSameMemoryValue, addRow, updateRowFieldValue, deleteRow, moveRow, isFieldLocked,
        toggleFieldLock, getFieldDisplayValue, isEmptyMemoryValue, getRowSearchText
    } = MemoryDomain;
    const deepClone = Core.clone;
    const createMemoryId = Core.createId;
    const moveArrayItem = Core.moveArrayItem;
    const escapeHtml = Core.escapeHtml;
    const escapeAttribute = Core.escapeAttribute;
    const resolveMemoryApiConfig = MemoryApi.resolveConfig;
    const getMemoryApiConfig = MemoryApi.getConfig;
    const requestMemoryContent = MemoryApi.requestContent;
    const requestSummaryContent = MemoryApi.requestSummary;
    const uiState = {
        hydratedChatId: null,
        workspace: 'memory',
        tab: 'tables',
        search: '',
        sort: 'default',
        editingTemplateId: null,
        templateDraft: null,
        conversionState: null,
        schemaEditorTab: 'fields',
        schemaEditorTableIndex: 0,
        viewMode: 'normal',
        activeTableId: null,
        editingRowId: null,
        editingFieldPath: null,
        focusedRowId: null,
        focusedFieldPath: null,
        settingsOpen: false,
        rangePreview: null,
        inspectorOpen: false, selectedRowId: null, inspectorAnalysis: null, inspectorReview: null, inspectorBusy: false, inspectorTab: 'relations',
        rowFilter: 'all', rowTagFilter: '', rowSorts: [], historyTableId: null
    };
    MemoryTableSession.ensure(uiState);
    function ensureMemoryTableState(chat, options = {}) {
        ensureMemoryTableStateBase(chat);
        if (!chat) return null;
        if (MemoryPolicy) {
            const runtime = MemoryPolicy.ensureRuntimeState(chat);
            const shouldHydrateUi = options.forceUiHydration === true || uiState.hydratedChatId !== chat.id;
            if (shouldHydrateUi) {
                uiState.viewMode = 'normal';
                runtime.viewMode = 'normal';
                uiState.activeTableId = runtime.activeTableId || null;
                const normalizedWorkspace = MemoryWorkspace.normalizeState(runtime.workspace || 'memory', runtime.workspaceView || 'tables');
                Object.assign(uiState, { workspace: normalizedWorkspace.workspace, tab: normalizedWorkspace.view, hydratedChatId: chat.id });
            }
        } else if (uiState.hydratedChatId !== chat.id) {
            Object.assign(uiState, { workspace: 'memory', tab: 'tables', hydratedChatId: chat.id });
        }
        return chat;
    }
    function getCurrentMemoryTableChat(options = {}) {
        const chat = getCurrentMemoryTableChatBase();
        if (chat) ensureMemoryTableState(chat, options);
        else uiState.hydratedChatId = null;
        return chat;
    }
    function applyMemoryWorkspaceState(chat, workspace, view) {
        const normalized = MemoryWorkspace.normalizeState(workspace, view || '');
        uiState.workspace = normalized.workspace;
        uiState.tab = normalized.view;
        if (chat && MemoryPolicy) Object.assign(MemoryPolicy.ensureRuntimeState(chat), {
            workspace: normalized.workspace, workspaceView: normalized.view
        });
        return normalized;
    }
    function selectMemoryWorkspace(workspace, view) {
        // 先解析/水合当前角色，再提交目标工作区。反过来会被旧运行态覆盖。
        const chat = getCurrentMemoryTableChat();
        const normalized = applyMemoryWorkspaceState(chat, workspace, view);
        renderMemoryTableScreen();
        return normalized;
    }
    const selectMemoryView = (chat, view) => applyMemoryWorkspaceState(chat, MemoryWorkspace.getWorkspaceForView(view), view);
    function findBestMemoryTableCursorFallback(chat) {
        const history = Array.isArray(chat && chat.history) ? chat.history : [];
        if (!history.length || !chat || !chat.memoryTables || !chat.memoryTables.lastUpdateMsgTimestamp) {
            return null;
        }
        for (let index = history.length - 1; index >= 0; index--) {
            const message = history[index];
            if ((message.timestamp || 0) <= chat.memoryTables.lastUpdateMsgTimestamp) {
                return message;
            }
        }
        return null;
    }
    function ensureMemoryTableAutoUpdateState(chat) {
        ensureMemoryTableState(chat);
        const history = Array.isArray(chat.history) ? chat.history : [];
        const memoryTables = chat.memoryTables;
        if (memoryTables.lastUpdateMsgId) {
            const exists = history.some(message => message.id === memoryTables.lastUpdateMsgId);
            if (!exists) {
                const fallback = findBestMemoryTableCursorFallback(chat);
                memoryTables.lastUpdateMsgId = fallback ? fallback.id : null;
                memoryTables.lastUpdateMsgTimestamp = fallback ? (fallback.timestamp || null) : null;
            }
        }
    }
    function getMemoryTableAutoUpdateCursorInfo(chat) {
        ensureMemoryTableAutoUpdateState(chat);
        const history = Array.isArray(chat && chat.history) ? chat.history : [];
        const interval = Math.max(10, parseInt(chat?.memoryTables?.autoUpdateInterval, 10) || 100);
        const cursorIndex = chat?.memoryTables?.lastUpdateMsgId
            ? history.findIndex(message => message.id === chat.memoryTables.lastUpdateMsgId)
            : -1;
        const nextStartIndex = cursorIndex + 1;
        const unsyncedCount = Math.max(0, history.length - nextStartIndex);
        const completedBatchCount = Math.floor(unsyncedCount / interval);
        return {
            history,
            interval,
            cursorIndex,
            nextStartIndex,
            unsyncedCount,
            completedBatchCount
        };
    }
    function getNextMemoryTableAutoUpdateRange(chat) {
        const info = getMemoryTableAutoUpdateCursorInfo(chat);
        if (info.completedBatchCount <= 0) return null;
        return {
            start: info.nextStartIndex + 1,
            end: info.nextStartIndex + info.interval,
            info
        };
    }
    function setMemoryTableAutoUpdateCursorByMessage(chat, message) {
        ensureMemoryTableAutoUpdateState(chat);
        chat.memoryTables.lastUpdateMsgId = message ? message.id : null;
        chat.memoryTables.lastUpdateMsgTimestamp = message ? (message.timestamp || null) : null;
        chat.memoryTables.autoUpdateState = 'idle';
    }
    function setMemoryTableAutoUpdateCursorByEndIndex(chat, endIndex) {
        const history = Array.isArray(chat && chat.history) ? chat.history : [];
        const message = history[endIndex - 1] || null;
        setMemoryTableAutoUpdateCursorByMessage(chat, message);
    }
    function resetMemoryTableAutoUpdateCursorToLatest(chat) {
        const history = Array.isArray(chat && chat.history) ? chat.history : [];
        setMemoryTableAutoUpdateCursorByMessage(chat, history.length ? history[history.length - 1] : null);
        chat.memoryTables.autoUpdatePending = false;
    }
    function getBoundTableDescriptors(chat) {
        const result = [];
        getBoundTemplates(chat).forEach(template => {
            (template.tables || []).forEach(table => result.push({ template, table }));
        });
        return result;
    }
    function refreshMemoryTableAutoUpdateControls(chat, hasTemplates = true) {
        const toggle = document.getElementById('memory-table-auto-update-toggle');
        const intervalInput = document.getElementById('memory-table-auto-update-interval');
        const roundInput = document.getElementById('memory-table-round-interval');
        const triggerSelect = document.getElementById('memory-table-trigger-mode');
        const maxSourceInput = document.getElementById('memory-table-max-source-messages');
        const reviewModeSelect = document.getElementById('memory-table-review-mode');
        const retrievalModeSelect = document.getElementById('memory-table-retrieval-mode');
        const semanticWeightInput = document.getElementById('memory-table-semantic-weight');
        const embeddingCandidateInput = document.getElementById('memory-table-embedding-candidate-limit');
        const tagWeightInput = document.getElementById('memory-table-tag-weight');
        const sceneRoutingToggle = document.getElementById('memory-table-scene-routing-toggle');
        const sideEffectGuardToggle = document.getElementById('memory-table-side-effect-guard-toggle');
        const previewRangeBtn = document.getElementById('memory-table-preview-range-btn');
        const latestBtn = document.getElementById('memory-table-update-latest-btn');
        const retryBtn = document.getElementById('memory-table-retry-btn');
        const statusEl = document.getElementById('memory-table-auto-update-status');
        const roundStatus = document.getElementById('memory-table-round-status');
        const cursorSelect = document.getElementById('memory-table-cursor-table-select');
        const cursorInput = document.getElementById('memory-table-cursor-position');
        const saveCursorBtn = document.getElementById('memory-table-save-cursor-btn');
        const updateSelectedBtn = document.getElementById('memory-table-update-selected-btn');
        const cursorLatestBtn = document.getElementById('memory-table-cursor-latest-btn');
        const cursorStartBtn = document.getElementById('memory-table-cursor-start-btn');
        const scheduleList = document.getElementById('memory-table-auto-schedule-list');
        if (!toggle || !intervalInput || !latestBtn || !retryBtn || !statusEl) return;
        const allControls = [toggle, intervalInput, roundInput, triggerSelect, maxSourceInput, reviewModeSelect, retrievalModeSelect, semanticWeightInput, tagWeightInput, embeddingCandidateInput, sceneRoutingToggle, sideEffectGuardToggle, previewRangeBtn, latestBtn, retryBtn, cursorSelect, cursorInput, saveCursorBtn, updateSelectedBtn, cursorLatestBtn, cursorStartBtn].filter(Boolean);
        if (!chat) {
            toggle.checked = false;
            allControls.forEach(control => control.disabled = true);
            statusEl.textContent = '请先进入一个私聊角色';
            if (roundStatus) roundStatus.textContent = '轮次尚未统计';
            if (cursorSelect) cursorSelect.innerHTML = '<option>暂无表格</option>';
            if (scheduleList) scheduleList.innerHTML = '<div class="memory-auto-schedule-empty">暂无可配置表格</div>';
            return;
        }
        ensureMemoryTableAutoUpdateState(chat);
        const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
        const descriptors = getBoundTableDescriptors(chat);
        const taskCounts = MemoryTasks ? MemoryTasks.getCounts(chat) : null;
        const isRunning = chat.memoryTables.autoUpdateState === 'running' || (taskCounts?.running || 0) > 0;
        const hasFailed = chat.memoryTables.autoUpdateState === 'failed' || (taskCounts?.failed || 0) > 0;
        const engine = runtime?.engineSettings || {
            triggerMode: 'messages',
            roundInterval: 2,
            messageInterval: chat.memoryTables.autoUpdateInterval || 100,
            maxSourceMessages: MEMORY_TABLE_MAX_CONTEXT_MESSAGES
        };
        toggle.checked = !!chat.memoryTables.autoUpdateEnabled && engine.enabled !== false;
        toggle.disabled = !hasTemplates;
        intervalInput.value = String(engine.messageInterval || chat.memoryTables.autoUpdateInterval || 140);
        intervalInput.disabled = !hasTemplates || isRunning;
        if (roundInput) {
            roundInput.value = String(engine.roundInterval || 2);
            roundInput.disabled = !hasTemplates || isRunning;
        }
        if (triggerSelect) {
            triggerSelect.value = engine.triggerMode || 'either';
            triggerSelect.disabled = !hasTemplates || isRunning;
        }
        if (maxSourceInput) {
            maxSourceInput.value = String(engine.maxSourceMessages || 180);
            maxSourceInput.disabled = !hasTemplates || isRunning;
        }
        if (reviewModeSelect) {
            reviewModeSelect.value = engine.reviewMode || 'summary_only';
            reviewModeSelect.disabled = !hasTemplates || isRunning;
        }
        if (retrievalModeSelect) {
            retrievalModeSelect.value = engine.retrievalMode || 'auto';
            retrievalModeSelect.disabled = !hasTemplates || isRunning;
        }
        if (semanticWeightInput) {
            semanticWeightInput.value = String(engine.semanticWeight ?? 0.55);
            semanticWeightInput.disabled = !hasTemplates || isRunning || (engine.retrievalMode === 'keyword');
        }
        if (embeddingCandidateInput) {
            embeddingCandidateInput.value = String(engine.embeddingCandidateLimit || 32);
            embeddingCandidateInput.disabled = !hasTemplates || isRunning || (engine.retrievalMode === 'keyword');
        }
        if (tagWeightInput) {
            tagWeightInput.value = String(engine.tagWeight ?? 0.35);
            tagWeightInput.disabled = !hasTemplates || isRunning;
        }
        if (sceneRoutingToggle) {
            sceneRoutingToggle.checked = engine.sceneRoutingEnabled !== false;
            sceneRoutingToggle.disabled = !hasTemplates || isRunning;
        }
        if (sideEffectGuardToggle) {
            sideEffectGuardToggle.checked = engine.sideEffectGuardEnabled !== false;
            sideEffectGuardToggle.disabled = !hasTemplates || isRunning;
        }
        const schedule = MemorySchedule.build(chat, descriptors, engine, { isRunning });
        const { dueCount, eligibleCount } = schedule;
        const totalUnsyncedMessages = schedule.maxUnsyncedMessages;
        const totalUnsyncedRounds = schedule.maxUnsyncedRounds;
        if (scheduleList) scheduleList.innerHTML = schedule.html;
        if (cursorSelect) {
            const previous = cursorSelect.value || uiState.activeTableId || runtime?.activeTableId || '';
            cursorSelect.innerHTML = descriptors.map(({ template, table }) => `<option value="${escapeAttribute(`${template.id}::${table.id}`)}">${escapeHtml(template.name)} / ${escapeHtml(table.name)}</option>`).join('') || '<option value="">暂无表格</option>';
            const desired = descriptors.some(({ template, table }) => `${template.id}::${table.id}` === previous)
                ? previous
                : (descriptors[0] ? `${descriptors[0].template.id}::${descriptors[0].table.id}` : '');
            cursorSelect.value = desired;
            const [templateId, tableId] = desired.split('::');
            if (MemoryPolicy && templateId && tableId && cursorInput) {
                const info = MemoryPolicy.getUnprocessedInfo(chat, templateId, tableId);
                cursorInput.max = String(info.history.length);
                cursorInput.value = String(Math.max(0, info.cursorIndex + 1));
            }
        }
        latestBtn.disabled = !hasTemplates || isRunning || dueCount <= 0;
        retryBtn.disabled = !hasTemplates || isRunning || (!hasFailed && dueCount <= 0);
        if (updateSelectedBtn) updateSelectedBtn.disabled = !hasTemplates || isRunning || descriptors.length === 0;
        if (previewRangeBtn) previewRangeBtn.disabled = !hasTemplates || isRunning || descriptors.length === 0;
        [saveCursorBtn, cursorLatestBtn, cursorStartBtn].filter(Boolean).forEach(button => button.disabled = !hasTemplates || isRunning || descriptors.length === 0);
        retryBtn.textContent = hasFailed ? '重试补救（上次失败）' : '重试补救';
        retryBtn.style.background = hasFailed ? '#ffe7e7' : '';
        retryBtn.style.color = hasFailed ? '#c62828' : '';
        retryBtn.style.borderColor = hasFailed ? '#f2b8b5' : '';
        latestBtn.textContent = isRunning ? '更新中...' : '更新所有到期表';
        if (roundStatus) {
            const latestRound = runtime?.rounds?.[runtime.rounds.length - 1];
            roundStatus.textContent = `已记录 ${runtime?.rounds?.length || 0} 轮${latestRound ? ` · 最近一轮 ${latestRound.messageCount} 条` : ''}`;
        }
        const pendingReviewCount = MemoryReview ? MemoryReview.getPendingCount(chat) : 0;
        const queuedTaskCount = taskCounts ? (taskCounts.queued + taskCounts.paused + taskCounts.running + taskCounts.failed) : 0;
        statusEl.textContent = hasTemplates
            ? `自动更新：${toggle.checked ? '已开启' : '已关闭'} · 自动表 ${eligibleCount} 张 · 到期 ${dueCount} 张 · 队列 ${queuedTaskCount} 项 · 待审核 ${pendingReviewCount} 批 · 最大未处理 ${totalUnsyncedRounds} 轮 / ${totalUnsyncedMessages} 条消息${toggle.checked && eligibleCount === 0 ? ' · 请把至少一张表设为“跟随全局”或“按表设置”' : ''}`
            : '先绑定模板后才能使用更新调度';
    }
    async function applyMemoryTableAutoUpdateToggle(chat, enabled) {
        if (!chat) return { status: 'noop' };
        ensureMemoryTableAutoUpdateState(chat);
        chat.memoryTables.autoUpdateEnabled = enabled;
        if (MemoryPolicy) {
            MemoryPolicy.ensureRuntimeState(chat).engineSettings.enabled = enabled;
        }
        if (!enabled) {
            chat.memoryTables.autoUpdatePending = false;
            if (chat.memoryTables.autoUpdateState === 'running') chat.memoryTables.autoUpdateState = 'idle';
            await saveCharacter(chat.id);
            refreshMemoryTableAutoUpdateControls(chat, getBoundTemplates(chat).length > 0);
            return { status: 'disabled' };
        }
        chat.memoryTables.autoUpdateState = 'idle';
        await saveCharacter(chat.id);
        refreshMemoryTableAutoUpdateControls(chat, getBoundTemplates(chat).length > 0);
        return checkAndTriggerAutoTableUpdate(chat, { showNoPendingToast: true });
    }
    function renderMemoryTableScreen() {
        const screen = document.getElementById('memory-table-screen');
        if (!screen) return;
        const chat = getCurrentMemoryTableChat();
        const content = document.getElementById('memory-table-content');
        const summary = document.getElementById('memory-table-chat-summary');
        const modePill = document.getElementById('memory-table-mode-pill');
        const empty = document.getElementById('memory-table-empty-state');
        const updateBtn = document.getElementById('memory-table-update-btn');
        const createTemplateBtn = document.getElementById('memory-table-create-template-btn');
        const fromJournalBtn = document.getElementById('memory-table-from-journal-btn');
        const toJournalBtn = document.getElementById('memory-table-to-journal-btn');
        const memoryToolbar = document.getElementById('memory-workbench-memory-toolbar');
        const manageTools = document.getElementById('memory-workbench-manage-tools');
        const settingsPanel = document.getElementById('memory-workbench-settings');
        const statusTitle = document.getElementById('memory-workbench-status-title');
        const statusDetail = document.getElementById('memory-workbench-status-detail');
        const taskSummary = document.getElementById('memory-workbench-task-summary');
        const inboxBadge = document.getElementById('memory-workbench-inbox-count');
        if (!content || !summary || !modePill || !empty) return;
        if (!chat) {
            summary.textContent = '请选择一个角色查看记忆。';
            modePill.textContent = '未选择角色';
            content.innerHTML = `<div class="memory-workbench-overview memory-character-empty">
                <div class="memory-workbench-overview-head"><div><h2>角色记忆</h2><p>记忆、待处理和管理内容都属于具体角色。</p></div></div>
                <button type="button" class="btn btn-primary" data-memory-pick-character>选择角色</button>
            </div>`;
            empty.style.display = 'none';
            if (updateBtn) updateBtn.disabled = true;
            if (fromJournalBtn) fromJournalBtn.disabled = true;
            if (toJournalBtn) toJournalBtn.disabled = true;
            refreshMemoryTableAutoUpdateControls(null, false);
            return;
        }
        ensureMemoryTableState(chat);
        MemoryTableCache.touchChat(chat.id, 'full-screen-render');
        if (MemoryQuality && MemoryTasks) MemoryQuality.enqueuePendingAutoRun(chat);
        if (MemoryTasks) {
            const taskState = MemoryTasks.ensureState(chat);
            const hasQueued = taskState.tasks.some(item => item.status === 'queued' && (!item.nextRetryAt || item.nextRetryAt <= Date.now()));
            if (taskState.settings.autoResume && !taskState.settings.paused && hasQueued && Date.now() - (taskState.lastAutoResumeAttempt || 0) > 5000) {
                taskState.lastAutoResumeAttempt = Date.now();
                setTimeout(() => processMemoryTaskQueue(chat, { skipRender: false }).catch(error => console.warn('[MemoryTable] task auto resume failed:', error)), 0);
            }
        }
        const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
        uiState.viewMode = 'normal';
        if (runtime) runtime.viewMode = 'normal';
        screen.classList.remove('memory-json-mode');
        const boundTemplates = getBoundTemplates(chat);
        const normalizedWorkspace = MemoryWorkspace.normalizeState(uiState.workspace, uiState.tab);
        uiState.workspace = normalizedWorkspace.workspace;
        uiState.tab = normalizedWorkspace.view;
        if (runtime) {
            runtime.workspace = uiState.workspace;
            runtime.workspaceView = uiState.tab;
        }
        const workbenchCounts = MemoryWorkspace.getCounts(chat, boundTemplates);
        const workbenchStatus = MemoryWorkspace.getStatusSummary(chat, boundTemplates);
        if (statusTitle) statusTitle.textContent = workbenchStatus.title;
        if (statusDetail) statusDetail.textContent = workbenchStatus.detail;
        if (taskSummary) taskSummary.textContent = `${workbenchCounts.activeTasks || 0} 项待办`;
        if (inboxBadge) {
            inboxBadge.textContent = String(workbenchCounts.inbox || 0);
            inboxBadge.style.display = workbenchCounts.inbox > 0 ? 'inline-flex' : 'none';
        }
        document.querySelectorAll('.memory-workspace-tab-btn').forEach(button => {
            button.classList.toggle('active', button.dataset.workspace === uiState.workspace);
        });
        if (memoryToolbar) memoryToolbar.hidden = uiState.workspace !== 'memory';
        if (manageTools) manageTools.hidden = uiState.workspace !== 'manage';
        if (settingsPanel) {
            settingsPanel.hidden = uiState.workspace !== 'memory';
            settingsPanel.classList.toggle('visible', uiState.workspace === 'memory' && uiState.settingsOpen);
        }
        const settingsBackdrop = document.getElementById('memory-workbench-settings-backdrop');
        if (settingsBackdrop) settingsBackdrop.classList.toggle('visible', uiState.workspace === 'memory' && uiState.settingsOpen);
        if (updateBtn) updateBtn.hidden = uiState.workspace !== 'memory';
        if (createTemplateBtn) createTemplateBtn.hidden = uiState.workspace !== 'manage';
        const modeLabel = chat.memoryMode === 'table'
            ? '结构化档案'
            : (chat.memoryMode === 'vector' ? '档案 + 向量补充' : '档案 + 日记补充');
        summary.textContent = `${chat.remarkName || chat.realName || '当前角色'} · 已绑定 ${boundTemplates.length} 个模板`;
        modePill.textContent = modeLabel;
        modePill.style.background = chat.memoryMode === 'table'
            ? 'rgba(73, 129, 255, 0.12)'
            : (chat.memoryMode === 'vector' ? 'rgba(116, 87, 255, 0.12)' : 'rgba(255, 181, 71, 0.12)');
        modePill.style.color = chat.memoryMode === 'table'
            ? '#335eea'
            : (chat.memoryMode === 'vector' ? '#5a38d6' : '#b26a00');
        if (updateBtn) updateBtn.disabled = boundTemplates.length === 0;
        if (fromJournalBtn) fromJournalBtn.disabled = (chat.memoryJournals || []).filter(item => item.isFavorited).length === 0 || boundTemplates.length === 0;
        if (toJournalBtn) toJournalBtn.disabled = !getMemoryContextBlock(chat, { force: true });
        refreshMemoryTableAutoUpdateControls(chat, boundTemplates.length > 0);
        const reviewCount = MemoryReview ? MemoryReview.getPendingCount(chat) : 0;
        const sidecarCount = (chat.memoryTables?.sidecar?.candidates || []).filter(item => item.status === 'pending').length;
        const sidecarCountEl = document.getElementById('memory-sidecar-tab-count');
        if (sidecarCountEl) {
            sidecarCountEl.textContent = String(sidecarCount);
            sidecarCountEl.style.display = sidecarCount > 0 ? 'inline-flex' : 'none';
        }
        const reviewCountEl = document.getElementById('memory-review-tab-count');
        if (reviewCountEl) {
            reviewCountEl.textContent = String(reviewCount);
            reviewCountEl.style.display = reviewCount > 0 ? 'inline-flex' : 'none';
        }
        const feedbackCount = MemoryFeedback ? MemoryFeedback.getPendingCount(chat) : 0;
        const feedbackCountEl = document.getElementById('memory-usage-audit-tab-count');
        if (feedbackCountEl) {
            feedbackCountEl.textContent = String(feedbackCount);
            feedbackCountEl.style.display = feedbackCount > 0 ? 'inline-flex' : 'none';
        }
        const taskCount = MemoryTasks ? MemoryTasks.getPendingCount(chat) : 0;
        const taskCountEl = document.getElementById('memory-task-tab-count');
        if (taskCountEl) {
            taskCountEl.textContent = String(taskCount);
            taskCountEl.style.display = taskCount > 0 ? 'inline-flex' : 'none';
        }
        document.querySelectorAll('.memory-table-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === uiState.tab);
        });
        const renderTechnicalView = view => {
            if (view === 'templates') {
                empty.style.display = db.memoryTableTemplates.length === 0 ? 'block' : 'none';
                empty.innerHTML = '<p>还没有模板</p><p>点击右上角新建模板。</p>';
                return renderTemplateLibrary(chat);
            }
            if (view === 'review') return MemoryReview ? MemoryReview.renderReviewView(chat) : '<div class="memory-review-empty"><p>更新审核模块未加载。</p></div>';
            if (['usage_audit', 'retrieval', 'feedback'].includes(view)) return MemoryRetrievalAudit.render(chat);
            if (view === 'sidecar') return MemorySidecar ? MemorySidecar.renderCandidatesView(chat) : '<div class="memory-review-empty"><p>短期候选模块未加载。</p></div>';
            if (view === 'reliability') return MemoryLifecycle ? MemoryLifecycle.renderReliabilityView(chat, boundTemplates) : '<div class="memory-review-empty"><p>可靠性模块未加载。</p></div>';
            if (view === 'tasks') return MemoryTasks ? MemoryTasks.renderView(chat) : '<div class="memory-review-empty"><p>任务队列模块未加载。</p></div>';
            if (view === 'quality') return MemoryQuality ? MemoryQuality.renderView(chat) : '<div class="memory-review-empty"><p>质量评估模块未加载。</p></div>';
            if (view === 'history') {
                empty.style.display = (chat.memoryTables.history || []).length === 0 ? 'block' : 'none';
                empty.innerHTML = '<p>还没有更新历史</p>';
                return renderHistoryView(chat);
            }
            return renderTableView(chat);
        };
        empty.style.display = 'none';
        if (uiState.workspace === 'inbox' && uiState.tab === 'inbox_home') {
            content.innerHTML = MemoryWorkspace.renderInboxHome(chat, boundTemplates);
        } else if (uiState.workspace === 'manage' && uiState.tab === 'manage_home') {
            content.innerHTML = MemoryWorkspace.renderManageHome(chat, boundTemplates);
        } else if (uiState.workspace === 'memory') {
            content.innerHTML = renderTechnicalView('tables');
            if (boundTemplates.length === 0) {
                empty.style.display = 'block';
                empty.innerHTML = '<p>还没有绑定结构记忆模板</p><p>到“管理”中创建或绑定模板。</p>';
            } else if (!content.innerHTML.trim()) {
                empty.style.display = 'block';
                empty.innerHTML = '<p>没有匹配结果</p>';
            }
        } else {
            const title = MemoryWorkspace.viewTitle(uiState.tab);
            const body = renderTechnicalView(uiState.tab);
            content.innerHTML = `${MemoryWorkspace.renderDetailHeader(uiState.workspace, title)}${body}`;
        }
        MemoryTableGrid.bind(content, { state: uiState, refreshGrid: refreshActiveMemoryTable, render: renderMemoryTableScreen, openEditor: openMemoryRecordEditor });
        try { window.dispatchEvent(new CustomEvent('memory-table-screen-opened')); } catch (_) {}
    }
    function renderTemplateLibrary(chat) {
        ensureMemoryTemplateStore();
        const templates = db.memoryTableTemplates;
        if (templates.length === 0) return '';
        return `<div class="memory-template-library">${templates.map(template => {
            const bound = chat.memoryTables.boundTemplateIds.includes(template.id);
            const summary = MemorySchemaModel.summarize(template);
            return `<div class="memory-template-list-row">
                <div class="memory-template-list-main"><strong>${escapeHtml(template.name)}</strong><p>${escapeHtml(template.description || '无描述')}</p><small>${summary.tableCount} 张表 · ${summary.fieldCount} 个字段 · ${summary.groupCount} 个分组</small></div>
                <div class="memory-template-list-actions">
                    <label class="kkt-switch" title="绑定到当前角色"><input type="checkbox" class="memory-template-bind-toggle" data-template-id="${escapeAttribute(template.id)}" ${bound ? 'checked' : ''}><span class="kkt-slider"></span></label>
                    <button class="btn btn-small btn-primary memory-template-edit-structure" data-action="open-schema-editor" data-template-id="${escapeAttribute(template.id)}">编辑结构</button>
                    <button class="btn btn-small btn-secondary" data-action="export-template" data-template-id="${escapeAttribute(template.id)}">导出</button>
                    <button class="btn btn-small btn-secondary" data-action="export-template-package" data-template-id="${escapeAttribute(template.id)}">导出记忆包</button>
                    <button class="btn btn-small btn-danger" data-action="delete-template" data-template-id="${escapeAttribute(template.id)}">删除</button>
                </div>
            </div>`;
        }).join('')}</div>`;
    }
    function activeTemplateForSchema(chat) {
        const bound = getBoundTemplates(chat);
        const activeTableId = uiState.activeTableId || MemoryPolicy?.ensureRuntimeState?.(chat)?.activeTableId;
        return bound.find(template => (template.tables || []).some(table => table.id === activeTableId)) || bound[0] || db.memoryTableTemplates[0] || null;
    }
    function renderSchemaEditor() {
        const draft = uiState.templateDraft;
        const body = document.getElementById('memory-schema-editor-body');
        const title = document.getElementById('memory-schema-editor-title');
        if (!draft || !body || !title) return;
        title.textContent = uiState.editingTemplateId ? '编辑表结构' : '新建表结构';
        body.innerHTML = MemorySchemaEditor.render(draft, { activeTableIndex: uiState.schemaEditorTableIndex });
    }
    function openSchemaEditor(template) {
        const modal = document.getElementById('memory-schema-editor-modal');
        if (!modal) return;
        uiState.editingTemplateId = template?.id || null;
        uiState.templateDraft = MemorySchemaEditor.prepare(template || null);
        uiState.schemaEditorTab = 'fields';
        uiState.schemaEditorTableIndex = 0;
        renderSchemaEditor();
        modal.classList.add('visible');
    }
    function closeSchemaEditor() {
        const modal = document.getElementById('memory-schema-editor-modal');
        if (modal) modal.classList.remove('visible');
        uiState.templateDraft = null;
        uiState.editingTemplateId = null;
        uiState.schemaEditorTab = 'fields';
        uiState.schemaEditorTableIndex = 0;
    }
    async function saveSchemaEditor() {
        if (!uiState.templateDraft) return;
        let normalized;
        try {
            normalized = MemorySchemaEditor.normalize(uiState.templateDraft, uiState.editingTemplateId || undefined);
        } catch (error) {
            showToast(error.message || '表结构不合法');
            return;
        }
        await persistTemplateNormalized(normalized);
        closeSchemaEditor();
        showToast('表结构已保存');
    }
    function updateSchemaDraft(target) {
        if (!uiState.templateDraft || !target?.dataset) return false;
        if (MemorySchemaEditor.updateRole(uiState.templateDraft, target)) return true;
        if (MemorySchemaEditor.updatePath(uiState.templateDraft, target)) return true;
        return false;
    }
    function renderHistoryView(chat) {
        const allHistory = chat.memoryTables.history || [];
        if (allHistory.length === 0) return '';
        const templates = getBoundTemplates(chat);
        const tables = new Map();
        templates.forEach(template => (template.tables || []).forEach(table => tables.set(table.id, table)));
        const filterTableId = uiState.historyTableId || '';
        const history = filterTableId ? MemoryUpdateActivity.forTable(chat, filterTableId) : allHistory;
        const filterTable = tables.get(filterTableId);
        const filterBar = filterTableId ? `<div class="memory-history-filter"><div><strong>正在查看：${escapeHtml(filterTable?.name || '指定表格')}</strong><span>${history.length} 次更新记录</span></div><button type="button" class="btn btn-small btn-neutral" data-action="clear-memory-history-filter">查看全部历史</button></div>` : '';
        if (!history.length) return `${filterBar}<div class="memory-review-empty"><p>这张表还没有更新历史。</p></div>`;
        const cards = history.map((entry, entryIndex) => {
            const sourceLabel = MemoryUpdateActivity.sourceLabel(entry.source);
            const changes = (entry.changedFields || []).filter(item => !filterTableId || item.tableId === filterTableId);
            const tableSummary = MemoryUpdateActivity.tableSummary(entry, templates);
            const changedRecordCount = MemoryUpdateActivity.recordCount(changes);
            const rows = changes.map(item => {
                const table = tables.get(item.tableId);
                return `<tr><td>${escapeHtml(table?.name || '未知表格')}</td><td>${escapeHtml(item.label || item.fieldId || '字段')}</td><td>${escapeHtml(getShortValue(item.oldValue))}</td><td>${escapeHtml(getShortValue(item.newValue))}</td></tr>`;
            }).join('');
            return `<article class="memory-history-entry ${entryIndex === 0 ? 'latest' : ''}">
                <header><div><strong>${formatDateTime(entry.timestamp)}</strong><span>${escapeHtml(sourceLabel)} · ${changedRecordCount} 条记忆 · ${changes.length} 个字段</span></div><div class="memory-history-entry-actions">${entryIndex === 0 ? '<em>最近一次</em>' : ''}<button class="btn btn-small btn-primary" data-action="restore-history" data-history-id="${escapeAttribute(entry.id)}">恢复</button></div></header>
                <div class="memory-history-table-chips">${tableSummary.map(item => `<button type="button" data-action="open-memory-update-history" data-table-id="${escapeAttribute(item.tableId)}">${escapeHtml(item.tableName)}<b>${item.count} 条</b></button>`).join('')}</div>
                <div class="memory-history-table-wrap"><table><thead><tr><th>表格</th><th>字段</th><th>修改前</th><th>修改后</th></tr></thead><tbody>${rows || '<tr><td colspan="4">没有可显示的字段变化</td></tr>'}</tbody></table></div>
            </article>`;
        }).join('');
        return `<div class="memory-history-page">${filterBar}${cards}</div>`;
    }
    function renderRowInspector(chat) {
        if (!uiState.inspectorOpen || !uiState.selectedRowId) return '';
        const target = MemoryRelationService.findById(chat, uiState.selectedRowId);
        if (!target) {
            Object.assign(uiState, { inspectorOpen: false, selectedRowId: null, inspectorAnalysis: null, inspectorReview: null, inspectorTab: 'relations' });
            return '';
        }
        const analysis = uiState.inspectorAnalysis?.target?.row?.id === target.row.id
            ? uiState.inspectorAnalysis
            : MemoryRelationService.analyze(chat, target, { topK: 14 });
        uiState.inspectorAnalysis = analysis;
        return MemoryRowInspector.render({ chat, target, analysis, review: uiState.inspectorReview, busy: uiState.inspectorBusy, tab: uiState.inspectorTab });
    }
    function openMemoryRecordEditor(descriptor) {
        return MemoryRowEditController?.open?.(descriptor, {
            getChat: getCurrentMemoryTableChat,
            getTemplates: currentChat => getBoundTemplates(currentChat),
            save: saveCharacter,
            refreshGrid: refreshActiveMemoryTable,
            gridRoot: () => document.querySelector('[data-memory-table-grid]'),
            toast: showToast,
            showError: error => typeof showApiError === 'function' ? showApiError(error) : showToast(error.message || '整行保存失败')
        });
    }

    function getMemoryTableWorkspaceConfig(chat) {
        return {
            chat,
            templates: getBoundTemplates(chat),
            state: uiState,
            renderFieldEditor,
            renderInspector: renderRowInspector,
            interactionContext: { state: uiState, refreshGrid: refreshActiveMemoryTable, render: renderMemoryTableScreen, openEditor: openMemoryRecordEditor }
        };
    }
    function renderTableView(chat) {
        return MemoryTableWorkspace.render(getMemoryTableWorkspaceConfig(chat));
    }
    function refreshActiveMemoryTable(options = {}) {
        const chat = getCurrentMemoryTableChat();
        const root = document.querySelector('[data-memory-table-grid]');
        if (!chat || !root || uiState.workspace !== 'memory') {
            renderMemoryTableScreen();
            return false;
        }
        const config = MemoryTableWorkspace.getGridConfig(getMemoryTableWorkspaceConfig(chat));
        if (!config) {
            renderMemoryTableScreen();
            return false;
        }
        return MemoryTableGrid.refresh(root, config, options);
    }
    function renderFieldEditor(templateId, tableId, field, value, locked, rowId = '') {
        const disabled = locked ? 'disabled' : '';
        const rowAttr = rowId ? `data-row-id="${rowId}"` : '';
        const baseAttrs = `class="memory-table-input" data-template-id="${templateId}" data-table-id="${tableId}" data-field-id="${field.id}" ${rowAttr} ${disabled}`;
        switch (normalizeFieldType(field.type)) {
            case 'longtext':
                return `<textarea ${baseAttrs} rows="3" style="width:100%; border:1px solid #ececec; border-radius:12px; padding:10px; font-size:14px; min-height:88px;">${escapeHtml(String(value || ''))}</textarea>`;
            case 'number':
            case 'progress':
                return `<input ${baseAttrs} type="number" value="${escapeAttribute(String(value ?? ''))}" min="${field.min ?? ''}" max="${field.max ?? ''}" style="width:100%; border:1px solid #ececec; border-radius:12px; padding:10px; font-size:14px;">`;
            case 'enum':
                return `<select ${baseAttrs} style="width:100%; border:1px solid #ececec; border-radius:12px; padding:10px; font-size:14px; background:#fff;">
                    ${(field.options || []).map(option => `<option value="${escapeAttribute(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
                </select>`;
            case 'boolean':
                return `
                    <label style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border:1px solid #ececec; border-radius:12px;">
                        <span style="font-size:14px; color:#666;">${value ? '已开启' : '已关闭'}</span>
                        <label class="kkt-switch">
                            <input ${baseAttrs} type="checkbox" ${value ? 'checked' : ''}>
                            <span class="kkt-slider"></span>
                        </label>
                    </label>
                `;
            case 'tags':
                return `<input ${baseAttrs} type="text" value="${escapeAttribute(Array.isArray(value) ? value.join(', ') : String(value || ''))}" placeholder="用逗号分隔多个标签" style="width:100%; border:1px solid #ececec; border-radius:12px; padding:10px; font-size:14px;">`;
            case 'date':
                return `<input ${baseAttrs} type="date" value="${escapeAttribute(String(value || ''))}" style="width:100%; border:1px solid #ececec; border-radius:12px; padding:10px; font-size:14px;">`;
            default:
                return `<input ${baseAttrs} type="text" value="${escapeAttribute(String(value || ''))}" style="width:100%; border:1px solid #ececec; border-radius:12px; padding:10px; font-size:14px;">`;
        }
    }
    function formatDateTime(timestamp) {
        const date = new Date(timestamp);
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const hh = String(date.getHours()).padStart(2, '0');
        const mm = String(date.getMinutes()).padStart(2, '0');
        return `${y}-${m}-${d} ${hh}:${mm}`;
    }
    function getShortValue(value) {
        if (Array.isArray(value)) return value.join(', ');
        if (typeof value === 'object' && value !== null) return JSON.stringify(value);
        const text = String(value ?? '');
        return text.length > 24 ? `${text.slice(0, 24)}...` : text;
    }
    function getFieldGroups(fields) {
        const groups = [];
        const order = new Map();
        (fields || []).forEach((field, index) => {
            const groupName = (field.group || '').trim() || '未分组';
            if (!order.has(groupName)) {
                order.set(groupName, groups.length);
                groups.push({
                    name: groupName,
                    fields: [],
                    ungrouped: !(field.group || '').trim()
                });
            }
            groups[order.get(groupName)].fields.push({ field, index });
        });
        return groups;
    }
    function getTableRuntimePolicy(table) {
        return MemoryPolicy
            ? MemoryPolicy.normalizeTablePolicy(table)
            : {
                memoryLayer: table.memoryLayer || 'long',
                updatePolicy: table.updatePolicy || {},
                injectionPolicy: table.injectionPolicy || { mode: 'always', budget: 1200 }
            };
    }
    function getRowTimestamp(table, row) {
        if (row?.meta?.lastMentionedAt || row?.meta?.updatedAt || row?.meta?.createdAt) {
            return Number(row.meta.lastMentionedAt || row.meta.updatedAt || row.meta.createdAt) || 0;
        }
        let best = 0;
        (table.columns || []).forEach(field => {
            if (!/时间|日期|更新|发生|创建|完成/.test(field.key || '')) return;
            const raw = row?.cells?.[field.id];
            const ts = MemoryPolicy ? MemoryPolicy.parseDateLike(raw) : Date.parse(String(raw || ''));
            if (Number.isFinite(ts) && ts > best) best = ts;
        });
        return best;
    }
    function getRowStatusText(table, row) {
        return (table.columns || [])
            .filter(field => /状态|进度|结果/.test(field.key || ''))
            .map(field => getFieldDisplayValue(field, row.cells?.[field.id]))
            .filter(Boolean)
            .join(' ');
    }
    function rowToRetrievalItem(table, row, rowIndex) {
        const searchText = getRowSearchText(table, row);
        if (MemoryEffects) MemoryEffects.ensureRowMeta(row, table, searchText);
        const statusText = getRowStatusText(table, row);
        const expiresAt = Number(row?.meta?.expiresAt) || 0;
        const expiredByMeta = expiresAt > 0 && expiresAt < Date.now();
        const completed = MemoryPolicy ? MemoryPolicy.isCompletedText(statusText) : /已完成|已取消|已过期|已解决/.test(statusText);
        return {
            id: row.id,
            row,
            table,
            rowIndex,
            searchText,
            text: searchText,
            updatedAt: getRowTimestamp(table, row),
            createdAt: Number(row?.meta?.createdAt) || 0,
            importance: Number(row?.meta?.importance) || 50,
            confidence: Number(row?.meta?.confidence) || 70,
            pinned: !!row?.meta?.pinned,
            completed,
            active: !completed && !expiredByMeta,
            expiredByMeta
        };
    }
    function isKeyValueTableActive(chat, template, table, policy) {
        if (!policy.maxAgeDays) return true;
        let newest = 0;
        let explicitExpiry = 0;
        (table.columns || []).forEach(field => {
            const value = getFieldValue(chat, template.id, table.id, field);
            if (/有效期|过期/.test(field.key || '')) {
                explicitExpiry = Math.max(explicitExpiry, MemoryPolicy ? MemoryPolicy.parseDateLike(value) : Date.parse(String(value || '')) || 0);
            }
            if (/记录时间|更新时间|日期|时间/.test(field.key || '')) {
                newest = Math.max(newest, MemoryPolicy ? MemoryPolicy.parseDateLike(value) : Date.parse(String(value || '')) || 0);
            }
        });
        if (explicitExpiry && explicitExpiry < Date.now()) return false;
        if (!newest) return true;
        return (Date.now() - newest) <= policy.maxAgeDays * 86400000;
    }
    function selectRowsForInjection(chat, template, table, queryText, forceFull) {
        const rows = getRows(chat, template.id, table);
        if (forceFull) return rows.map((row, rowIndex) => rowToRetrievalItem(table, row, rowIndex));
        const tablePolicy = getTableRuntimePolicy(table);
        const policy = tablePolicy.injectionPolicy;
        if (policy.mode === 'never') return [];
        const items = rows.map((row, rowIndex) => rowToRetrievalItem(table, row, rowIndex));
        if (policy.mode === 'always') {
            return policy.topK > 0 ? items.slice(-policy.topK).reverse() : items;
        }
        if (policy.mode === 'active') {
            const active = items.filter(item => item.active || item.pinned);
            active.sort((a, b) => {
                if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
                if (b.importance !== a.importance) return b.importance - a.importance;
                return (b.updatedAt || 0) - (a.updatedAt || 0);
            });
            return policy.topK > 0 ? active.slice(0, policy.topK) : active;
        }
        if (MemoryPolicy) {
            const runtime = MemoryPolicy.ensureRuntimeState(chat);
            const key = `${template.id}::${table.id}`;
            const prepared = runtime?.preparedSelectionQuery === queryText
                ? runtime.preparedSelections?.[key]
                : null;
            if (Array.isArray(prepared)) {
                const byId = new Map(items.map(item => [item.id, item]));
                return prepared.map(hit => {
                    const item = byId.get(hit.id);
                    return item ? {
                        ...item,
                        _score: Number(hit.score) || 0,
                        _lexicalScore: Number(hit.lexicalScore) || 0,
                        _semanticScore: Number(hit.semanticScore) || 0,
                        _tagScore: Number(hit.tagScore) || 0,
                        _reasons: Array.isArray(hit.reasons) ? hit.reasons : [],
                        _effectMode: hit.effectMode || '',
                        _tagBundle: hit.tags || null,
                        _usePolicy: hit.usePolicy || null,
                        _directive: hit.directive || ''
                    } : null;
                }).filter(Boolean);
            }
            return MemoryPolicy.selectRelevantItems(items, queryText, policy);
        }
        return items.slice(0, policy.topK || 5);
    }

    function buildSingleTableContext(chat, template, table, queryText, options = {}) {
        const tablePolicy = getTableRuntimePolicy(table);
        const injectionPolicy = tablePolicy.injectionPolicy;
        const forceFull = !!options.forceFull;
        if (!forceFull && injectionPolicy.mode === 'never') return '';

        let text = `- ${table.name}\n`;
        if (isRowsTable(table)) {
            const selected = selectRowsForInjection(chat, template, table, queryText, forceFull);
            if (!selected.length) return '';
            selected.forEach((item, selectedIndex) => {
                text += `  - 记录 ${selectedIndex + 1}`;
                if (item._score !== undefined) text += `（相关度 ${item._score.toFixed(2)}）`;
                text += `\n`;
                (table.columns || []).filter(field => forceFull || field.important !== false).forEach(field => {
                    const value = getFieldDisplayValue(field, item.row.cells?.[field.id]);
                    if (isEmptyMemoryValue(field, item.row.cells?.[field.id])) return;
                    text += `    - ${field.summaryLabel || field.key}: ${value}\n`;
                });
                if (!forceFull && MemoryEffects) {
                    MemoryEffects.markInjected(chat, item);
                    const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
                    if (runtime) runtime.effectsDirty = true;
                }
            });
        } else {
            if (!forceFull && injectionPolicy.mode === 'active' && !isKeyValueTableActive(chat, template, table, injectionPolicy)) return '';
            const fields = (table.columns || []).filter(field => {
                if (!forceFull && field.important === false) return false;
                const value = getFieldValue(chat, template.id, table.id, field);
                return !isEmptyMemoryValue(field, value);
            });
            if (!fields.length) return '';
            if (!forceFull && injectionPolicy.mode === 'relevant' && MemoryPolicy) {
                const aggregate = fields.map(field => `${field.key}: ${getFieldDisplayValue(field, getFieldValue(chat, template.id, table.id, field))}`).join('\n');
                const score = MemoryPolicy.computeLexicalScore(aggregate, queryText);
                if (score < injectionPolicy.threshold) return '';
            }
            fields.forEach(field => {
                const value = getFieldDisplayValue(field, getFieldValue(chat, template.id, table.id, field));
                text += `  - ${field.summaryLabel || field.key}: ${value}\n`;
            });
        }
        return MemoryPolicy ? MemoryPolicy.trimToBudget(text.trim(), injectionPolicy.budget, table.name) : text.trim();
    }

    function getMemoryContextBlock(chat, options = {}) {
        ensureMemoryTableState(chat);
        const allowInactiveMode = !!options.allowInactiveMode;
        if (chat.memoryTables?.enabled === false) return '';
        if (chat.memoryMode !== 'table' && !options.force && !allowInactiveMode) return '';
        const templateIds = Array.isArray(options.templateIds) && options.templateIds.length > 0 ? options.templateIds : null;
        const templates = getBoundTemplates(chat).filter(template => !templateIds || templateIds.includes(template.id));
        if (templates.length === 0) return '';

        const forceFull = !!options.force;
        const queryText = options.queryText || (MemoryPolicy ? MemoryPolicy.buildQueryText(chat) : '');
        const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
        if (!forceFull && runtime?.lastContextBlock && runtime.lastPreparedQuery === queryText) {
            return runtime.lastContextBlock;
        }

        const sections = [];
        templates.forEach(template => {
            ensureTemplateDataForChat(chat, template);
            const tableSections = (template.tables || [])
                .filter(table => forceFull || !(MemorySidecar && MemorySidecar.isLiveTable(table)))
                .map(table => buildSingleTableContext(chat, template, table, queryText, { forceFull }))
                .filter(Boolean);
            if (!tableSections.length) return;
            sections.push(`《${template.name}》\n${tableSections.join('\n')}`);
        });
        if (!sections.length) return '';
        const header = forceFull
            ? '【结构化记忆完整档案】\n以下是选中模板的完整结构化数据，仅用于整理或转换。'
            : '【结构化记忆·按需检索】\n以下内容由固定、有效或与当前话题相关的档案条目组成。未出现的内容不要擅自补全。';
        let block = `${header}\n\n${sections.join('\n\n')}`.trim();
        if (!forceFull && MemoryPolicy) {
            block = MemoryPolicy.trimToBudget(block, runtime.engineSettings.globalInjectionBudget, '结构化记忆');
            runtime.lastContextBlock = block;
            runtime.lastPreparedQuery = queryText;
            runtime.lastPreparedAt = Date.now();
        }
        return block;
    }

    async function prepareMemoryTableContext(chat, options = {}) {
        ensureMemoryTableState(chat);
        const allowInactiveMode = !!options.allowInactiveMode;
        if (chat.memoryTables?.enabled === false) return '';
        if (chat.memoryMode !== 'table' && !options.force && !options.preview && !allowInactiveMode) return '';
        const queryText = options.queryText || (MemoryPolicy ? MemoryPolicy.buildQueryText(chat) : '');
        const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
        if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);

        if (MemoryRetrieval && MemoryPolicy && queryText.trim()) {
            const groups = [];
            getBoundTemplates(chat).forEach(template => {
                ensureTemplateDataForChat(chat, template);
                (template.tables || []).forEach(table => {
                    if (MemorySidecar && MemorySidecar.isLiveTable(table)) return;
                    if (!isRowsTable(table)) return;
                    const tablePolicy = getTableRuntimePolicy(table);
                    if (tablePolicy.injectionPolicy.mode !== 'relevant') return;
                    const items = getRows(chat, template.id, table).map((row, rowIndex) => rowToRetrievalItem(table, row, rowIndex));
                    groups.push({
                        key: `${template.id}::${table.id}`,
                        templateName: template.name,
                        tableName: table.name,
                        policy: tablePolicy.injectionPolicy,
                        items
                    });
                });
            });
            const prepared = await MemoryRetrieval.prepareGroups(chat, groups, queryText, runtime.engineSettings);
            runtime.preparedSelections = prepared.selectedByTable || {};
            runtime.preparedSelectionQuery = queryText;
            runtime.lastRetrievalDiagnostic = prepared.diagnostic || null;
            if (prepared.dirty && typeof saveCharacter === 'function') {
                try { await saveCharacter(chat.id); } catch (error) { console.warn('[MemoryTable] failed to persist retrieval index:', error); }
            }
        }

        const block = getMemoryContextBlock(chat, { ...options, queryText });
        if (runtime?.lastRetrievalDiagnostic) {
            runtime.lastRetrievalDiagnostic.finalBlock = block;
            runtime.lastRetrievalDiagnostic.finalChars = String(block || '').length;
            if (!options.preview && !options.force && MemoryFeedback) {
                const feedbackSnapshot = MemoryFeedback.captureInjection(chat, runtime.lastRetrievalDiagnostic, {
                    queryText,
                    roundId: runtime.activeRound?.id || runtime.lastRoundId || '',
                    finalBlock: block
                });
                if (feedbackSnapshot) runtime.feedbackDirty = true;
            }
        }
        if ((runtime?.effectsDirty || runtime?.feedbackDirty) && typeof saveCharacter === 'function') {
            runtime.effectsDirty = false;
            runtime.feedbackDirty = false;
            try { await saveCharacter(chat.id); } catch (error) { console.warn('[MemoryTable] failed to persist effect/feedback usage:', error); }
        }
        return block;
    }

    function clearMemoryTableRetrievalIndex(chat) {
        if (!chat) return 0;
        let cleared = 0;
        getBoundTemplates(chat).forEach(template => {
            ensureTemplateDataForChat(chat, template);
            (template.tables || []).forEach(table => {
                if (!isRowsTable(table)) return;
                getRows(chat, template.id, table).forEach(row => {
                    row.meta ||= {};
                    if (Array.isArray(row.meta.retrievalVector) && row.meta.retrievalVector.length) cleared += 1;
                    row.meta.retrievalVector = [];
                    row.meta.retrievalVectorFingerprint = '';
                    row.meta.retrievalIndexedAt = 0;
                });
            });
        });
        if (MemoryPolicy) {
            const runtime = MemoryPolicy.ensureRuntimeState(chat);
            MemoryPolicy.clearRetrievalCache(chat);
            runtime.lastRetrievalDiagnostic = null;
        }
        return cleared;
    }

    async function rebuildMemoryTableRetrievalPreview(chat) {
        if (!chat) return '';
        if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
        const block = await prepareMemoryTableContext(chat, { preview: true });
        await saveCharacter(chat.id);
        selectMemoryView(chat, 'usage_audit');
        renderMemoryTableScreen();
        return block;
    }

    function getJournalCandidates(chat) {
        return [...(chat.memoryJournals || [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    function openConversionModal(direction) {
        const chat = getCurrentMemoryTableChat();
        const modal = document.getElementById('memory-conversion-modal');
        if (!chat || !modal) return;
        ensureMemoryTableState(chat);
        const boundTemplates = getBoundTemplates(chat);
        const journals = getJournalCandidates(chat);

        uiState.conversionState = {
            direction,
            selectedJournalIds: direction === 'journalToTable'
                ? journals.filter(item => item.isFavorited).map(item => item.id)
                : [],
            selectedTemplateIds: boundTemplates.map(item => item.id),
            strategy: 'overwrite_unlocked',
            journalStyle: 'objective',
            autoFavorite: false,
            titlePrefix: ''
        };
        renderConversionModal();
        modal.classList.add('visible');
    }

    function closeConversionModal() {
        const modal = document.getElementById('memory-conversion-modal');
        if (modal) modal.classList.remove('visible');
        uiState.conversionState = null;
    }

    function renderConversionModal() {
        const state = uiState.conversionState;
        const chat = getCurrentMemoryTableChat();
        const body = document.getElementById('memory-conversion-body');
        const title = document.getElementById('memory-conversion-title');
        if (!state || !chat || !body || !title) return;

        const journals = getJournalCandidates(chat);
        const templates = getBoundTemplates(chat);
        title.textContent = state.direction === 'journalToTable' ? '日记转表格' : '表格转日记';

        if (state.direction === 'journalToTable') {
            const selectedJournals = journals.filter(item => state.selectedJournalIds.includes(item.id));
            const selectedTemplates = templates.filter(item => state.selectedTemplateIds.includes(item.id));
            body.innerHTML = `
                <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
                    <button type="button" class="btn btn-small btn-secondary" data-conversion-action="select-favorited">仅收藏</button>
                    <button type="button" class="btn btn-small btn-secondary" data-conversion-action="select-all-journals">全选日记</button>
                    <button type="button" class="btn btn-small btn-neutral" data-conversion-action="clear-journals">清空日记</button>
                </div>
                <div class="form-group">
                    <label>选择要读取的日记</label>
                    <div style="max-height:180px; overflow:auto; border:1px solid #ececec; border-radius:12px; padding:10px; background:#fafafa;">
                        ${journals.length === 0 ? '<div style="font-size:13px; color:#999;">没有可用日记</div>' : journals.map(item => `
                            <label style="display:flex; gap:8px; align-items:flex-start; padding:8px 0; border-bottom:1px dashed #eee;">
                                <input type="checkbox" data-conversion-role="journal-toggle" value="${item.id}" ${state.selectedJournalIds.includes(item.id) ? 'checked' : ''}>
                                <span style="font-size:13px; color:#444;">
                                    <strong>${escapeHtml(item.title || '无标题')}</strong>
                                    <span style="display:block; color:#999; margin-top:2px;">${item.isFavorited ? '已收藏' : '未收藏'} · ${formatDateTime(item.createdAt || Date.now())}</span>
                                </span>
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div class="form-group">
                    <label>目标模板</label>
                    <div style="display:flex; flex-wrap:wrap; gap:8px;">
                        ${templates.map(item => `
                            <label style="padding:8px 10px; border:1px solid #ececec; border-radius:999px; background:${state.selectedTemplateIds.includes(item.id) ? 'rgba(91,140,255,0.08)' : '#fff'}; font-size:13px;">
                                <input type="checkbox" data-conversion-role="template-toggle" value="${item.id}" ${state.selectedTemplateIds.includes(item.id) ? 'checked' : ''}>
                                ${escapeHtml(item.name)}
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div class="form-group">
                    <label>覆盖策略</label>
                    <select data-conversion-role="strategy">
                        <option value="overwrite_unlocked" ${state.strategy === 'overwrite_unlocked' ? 'selected' : ''}>覆盖所有未锁定字段</option>
                        <option value="fill_empty" ${state.strategy === 'fill_empty' ? 'selected' : ''}>只填空字段</option>
                    </select>
                </div>
                <div style="background:#fafafa; border:1px solid #ececec; border-radius:12px; padding:12px;">
                    <div style="font-size:13px; font-weight:700; color:#444;">转换预览</div>
                    <div style="font-size:12px; color:#777; margin-top:8px; line-height:1.6;">
                        将读取 <strong>${selectedJournals.length}</strong> 篇日记，写入 <strong>${selectedTemplates.length}</strong> 个模板。<br>
                        当前策略：${state.strategy === 'fill_empty' ? '只填空字段' : '覆盖所有未锁定字段'}。
                    </div>
                    ${selectedJournals.length > 0 ? `<div style="margin-top:10px; font-size:12px; color:#666;">样本：${selectedJournals.slice(0, 3).map(item => escapeHtml(item.title)).join('、')}${selectedJournals.length > 3 ? '...' : ''}</div>` : ''}
                </div>
            `;
        } else {
            const selectedTemplates = templates.filter(item => state.selectedTemplateIds.includes(item.id));
            const previewBlock = getMemoryContextBlock(chat, { force: true, templateIds: state.selectedTemplateIds });
            body.innerHTML = `
                <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
                    <button type="button" class="btn btn-small btn-secondary" data-conversion-action="select-all-templates">全选模板</button>
                    <button type="button" class="btn btn-small btn-neutral" data-conversion-action="clear-templates">清空模板</button>
                </div>
                <div class="form-group">
                    <label>选择要整理成日记的模板</label>
                    <div style="display:flex; flex-wrap:wrap; gap:8px;">
                        ${templates.map(item => `
                            <label style="padding:8px 10px; border:1px solid #ececec; border-radius:999px; background:${state.selectedTemplateIds.includes(item.id) ? 'rgba(91,140,255,0.08)' : '#fff'}; font-size:13px;">
                                <input type="checkbox" data-conversion-role="template-toggle" value="${item.id}" ${state.selectedTemplateIds.includes(item.id) ? 'checked' : ''}>
                                ${escapeHtml(item.name)}
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;">
                    <div class="form-group">
                        <label>整理风格</label>
                        <select data-conversion-role="journal-style">
                            <option value="objective" ${state.journalStyle === 'objective' ? 'selected' : ''}>客观回忆</option>
                            <option value="timeline" ${state.journalStyle === 'timeline' ? 'selected' : ''}>时间线整理</option>
                            <option value="archive" ${state.journalStyle === 'archive' ? 'selected' : ''}>档案总结</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>标题前缀</label>
                        <input type="text" data-conversion-role="title-prefix" value="${escapeAttribute(state.titlePrefix || '')}" placeholder="可选，例如：结构记忆·">
                    </div>
                </div>
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding: 10px 12px; border: 1px solid #ececec; border-radius: 12px; background: #fff;">
                    <span style="font-size:14px; color:#444; font-weight:bold;">生成后自动收藏</span>
                    <label class="kkt-switch">
                        <input type="checkbox" data-conversion-role="auto-favorite" ${state.autoFavorite ? 'checked' : ''}>
                        <span class="kkt-slider"></span>
                    </label>
                </div>
                <div style="background:#fafafa; border:1px solid #ececec; border-radius:12px; padding:12px;">
                    <div style="font-size:13px; font-weight:700; color:#444;">转换预览</div>
                    <div style="font-size:12px; color:#777; margin-top:8px; line-height:1.6;">
                        将读取 <strong>${selectedTemplates.length}</strong> 个模板，并生成一篇新的记忆日记。<br>
                        风格：${state.journalStyle === 'timeline' ? '时间线整理' : state.journalStyle === 'archive' ? '档案总结' : '客观回忆'}。
                    </div>
                    <pre style="white-space:pre-wrap; margin:10px 0 0; font-size:12px; color:#555; max-height:180px; overflow:auto;">${escapeHtml(previewBlock || '暂无可用表格内容')}</pre>
                </div>
            `;
        }
    }

    const collectMessagesForMemoryTable = MemoryUpdateService.collectMessages;
    const buildTemplateDefinitionForPrompt = MemoryUpdateService.buildTemplateDefinition;
    const buildHistoryTextForPrompt = MemoryUpdateService.buildHistoryText;

    async function updateMemoryTablesFromApi(options = {}) {
        const chat = options.chat || getCurrentMemoryTableChat();
        if (!chat) {
            showToast('请先进入一个角色聊天');
            return { status: 'noop', changedFields: [] };
        }

        const targetTableKeys = new Set(Array.isArray(options.targetTableKeys) ? options.targetTableKeys : []);
        const baseTemplates = (Array.isArray(options.templateIds) && options.templateIds.length > 0
            ? getBoundTemplates(chat).filter(item => options.templateIds.includes(item.id))
            : getBoundTemplates(chat));
        const templates = baseTemplates.map(template => {
            if (targetTableKeys.size === 0) return template;
            return {
                ...template,
                tables: (template.tables || []).filter(table => targetTableKeys.has(`${template.id}::${table.id}`))
            };
        }).filter(template => (template.tables || []).length > 0);
        if (templates.length === 0) {
            showToast('请先绑定至少一个模板');
            return { status: 'noop', changedFields: [] };
        }

        const history = collectMessagesForMemoryTable(chat, {
            start: options.start,
            end: options.end
        });

        if (history.length === 0) {
            if (!options.silent) showToast('聊天记录不足，暂时无法提取');
            return { status: 'noop', changedFields: [] };
        }

        templates.forEach(template => ensureTemplateDataForChat(chat, template));

        const updatePrompt = MemoryUpdateService.buildUpdatePrompt({
            chat,
            templates,
            history,
            maxCandidateRows: options.maxCandidateRows || 12,
            relatedBudget: options.relatedBudget || 7200
        });
        const { prompt, historyText, templateText, related } = updatePrompt;
        const relatedContextSummary = { targetRole: related?.targetRole || '', tables: related?.tables || [], rowCount: related?.rowCount || 0, chars: related?.chars || 0 };

        try {
            const preferSummaryApi = templates.some(template => (template.tables || []).some(table => {
                const policy = getTableRuntimePolicy(table);
                return policy.updatePolicy.useSummaryApi !== false;
            }));
            const promptSources = [
                { type: 'task_instruction', title: '目标记忆表定义', content: templateText, reason: '本次允许修改的目标表、字段规则和已有候选行' },
                ...(related?.text ? [{ type: 'structured_archive_memory', title: `相关记忆表 · ${related.tables.length} 张`, content: related.text, reason: '只读参与去重、冲突核对和阶段判断' }] : []),
                { type: 'chat_history', title: '本次整理消息范围', content: historyText, reason: '本次结构化记忆整理的直接证据' }
            ];
            const rawContent = await requestMemoryContent(prompt, 0.2, preferSummaryApi, preferSummaryApi ? 'memory-table-summary-update' : 'memory-table-fast-update', { operationId: options.operationId || null, promptSources });
            const apiRoute = MemoryApi.getLastRoute() || { requestedMode: preferSummaryApi ? 'summary' : 'main', actualMode: preferSummaryApi ? 'summary' : 'main', fallback: false };
            const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
            const requireReview = !!options.forceReview || (!!MemoryReview && MemoryReview.shouldRequireReview(runtime?.engineSettings || {}, {
                preferSummaryApi,
                isAutoUpdate: !!options.isAutoUpdate
            }));
            if (requireReview && MemoryReview) {
                const firstTable = templates[0]?.tables?.[0];
                const firstTemplate = templates[0];
                const batch = buildMemoryReviewBatch(chat, rawContent, {
                    source: options.source || 'api',
                    targetTableKeys: Array.from(targetTableKeys),
                    start: options.start || 1,
                    end: options.end || (Array.isArray(chat.history) ? chat.history.length : 0),
                    sourceMessageCount: history.length,
                    historyPreview: historyText.length > 30000 ? `${historyText.slice(0, 30000)}
…（范围预览超过 3 万字符，已截断）` : historyText,
                    apiMode: apiRoute.actualMode || (preferSummaryApi ? 'summary' : 'main'),
                    requestedApiMode: apiRoute.requestedMode || (preferSummaryApi ? 'summary' : 'main'),
                    apiFallback: !!apiRoute.fallback,
                    apiModel: apiRoute.model || '',
                    memoryLayer: firstTable ? getTableRuntimePolicy(firstTable).memoryLayer : '',
                    relatedContext: relatedContextSummary
                });
                if (!batch) {
                    if (MemoryPolicy && firstTemplate && firstTable) {
                        MemoryPolicy.markTableProcessed(chat, firstTemplate.id, firstTable.id, options.end || (chat.history?.length || 0), 'success');
                    }
                    await saveCharacter(chat.id);
                    if (!options.suppressSuccessToast) showToast('没有检测到可更新的字段');
                    return { status: 'success', changedFields: [] };
                }
                const queued = MemoryReview.enqueueBatch(chat, batch);
                if (MemoryPolicy) {
                    const tableState = MemoryPolicy.ensureTableState(chat, queued.templateId, queued.tableId);
                    tableState.pendingReviewBatchId = queued.id;
                    tableState.lastRunStatus = 'pending_review';
                    tableState.lastRunAt = Date.now();
                }
                chat.memoryTables.autoUpdateState = 'idle';
                await saveCharacter(chat.id);
                if (!options.isAutoUpdate) selectMemoryView(chat, 'review');
                if (!options.skipRender) renderMemoryTableScreen();
                if (!options.suppressSuccessToast) showToast(`已生成 ${queued.proposals.length} 项更新草案，等待审核`);
                return { status: 'pending_review', changedFields: [], batchId: queued.id, proposedCount: queued.proposals.length, relatedContext: relatedContextSummary };
            }

            const changedFields = applyMemoryUpdatesFromXml(chat, rawContent, {
                source: options.source || 'api',
                targetTableKeys: Array.from(targetTableKeys)
            });
            if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
            if (!options.isAutoUpdate && !options.skipCursorSync) {
                const endIndex = options.end || (Array.isArray(chat.history) ? chat.history.length : 0);
                if (endIndex > 0) {
                    setMemoryTableAutoUpdateCursorByEndIndex(chat, endIndex);
                    chat.memoryTables.autoUpdatePending = false;
                }
            }
            await saveCharacter(chat.id);
            if (!options.skipRender) {
                renderMemoryTableScreen();
            }
            if (!options.suppressSuccessToast) {
                showToast(changedFields.length > 0
                    ? `表格已更新，变更 ${changedFields.length} 项`
                    : '没有检测到可更新的字段');
            }
            return { status: 'success', changedFields, relatedContext: relatedContextSummary };
        } catch (error) {
            console.error('[MemoryTable] update failed:', error);
            if (options.propagateError) throw error;
            if (typeof showApiError === 'function') showApiError(error);
            else showToast(error.message || '更新表格失败');
            return { status: 'failed', changedFields: [], error };
        }
    }

    async function updateSingleTableFromPolicy(chat, template, table, options = {}) {
        if (!MemoryPolicy) {
            return updateMemoryTablesFromApi({ chat, ...options });
        }
        const key = `${template.id}::${table.id}`;
        const range = MemoryPolicy.getTableUpdateRange(chat, template.id, table, options);
        if (!range || range.end < range.start) return { status: 'noop', changedFields: [], range: null };
        const state = MemoryPolicy.ensureTableState(chat, template.id, table.id);
        state.lastRunStatus = 'running';
        state.lastError = '';
        try {
            const result = await updateMemoryTablesFromApi({
                chat,
                start: range.start,
                end: range.end,
                targetTableKeys: [key],
                source: options.source || 'auto_v2',
                isAutoUpdate: !!options.isAutoUpdate,
                silent: true,
                skipRender: true,
                skipCursorSync: true,
                suppressSuccessToast: true,
                propagateError: true,
                relevantRowsOnly: true,
                maxCandidateRows: 12,
                forceReview: !!options.forceReview,
                operationId: options.operationId || null
            });
            if (result.status !== 'pending_review') {
                MemoryPolicy.markTableProcessed(chat, template.id, table.id, range.end, 'success');
                setMemoryTableAutoUpdateCursorByEndIndex(chat, range.end); // V1 兼容游标
            }
            return { ...result, range: { start: range.start, end: range.end }, templateId: template.id, tableId: table.id };
        } catch (error) {
            state.lastRunStatus = 'failed';
            state.lastError = error.message || String(error);
            state.lastRunAt = Date.now();
            throw error;
        }
    }

    function estimateMemoryTaskInputChars(chat, template, table, range) {
        if (!chat || !template || !table || !range) return 0;
        const history = collectMessagesForMemoryTable(chat, { start: range.start, end: range.end });
        const historyText = buildHistoryTextForPrompt(chat, history);
        let definitionChars = 0;
        let relatedChars = 0;
        try {
            definitionChars = buildTemplateDefinitionForPrompt(chat, [template], {
                queryText: historyText,
                relevantRowsOnly: true,
                maxCandidateRows: 12
            }).length;
            relatedChars = MemoryContextAssembler.assemble({ chat, template, table, queryText: historyText, budget: 7200 }).chars;
        } catch (_) {}
        return historyText.length + definitionChars + relatedChars + 2600;
    }

    function enqueueMemoryTableUpdateTask(chat, template, table, options = {}) {
        if (!MemoryTasks || !MemoryPolicy) return null;
        const range = MemoryPolicy.getTableUpdateRange(chat, template.id, table, options);
        if (!range || range.end < range.start) return null;
        const policy = getTableRuntimePolicy(table);
        const apiMode = policy.updatePolicy.useSummaryApi !== false ? 'summary' : 'main';
        const state = MemoryPolicy.ensureTableState(chat, template.id, table.id);
        const fingerprint = `${state.lastProcessedMsgId || ''}:${state.lastProcessedMsgTimestamp || ''}:${range.start}:${range.end}`;
        const result = MemoryTasks.enqueueTableUpdate(chat, {
            templateId: template.id,
            tableId: table.id,
            range: { start: range.start, end: range.end },
            source: options.source || 'task_queue_v2_6',
            isAutoUpdate: !!options.isAutoUpdate,
            forceReview: !!options.forceReview,
            apiMode,
            estimatedInputChars: estimateMemoryTaskInputChars(chat, template, table, range),
            fingerprint,
            title: `${table.name} · ${apiMode === 'summary' ? '总结整理' : '增量更新'}`,
            priority: options.priority || (options.isAutoUpdate ? 45 : 85),
            operationId: options.operationId || null
        }, { force: !!options.force });
        return { ...result, range };
    }

    async function processMemoryTaskQueue(chat, options = {}) {
        if (!MemoryTasks) return { status: 'unsupported', processed: 0, results: [] };
        const result = await MemoryTasks.process(chat, options);
        if (!options.skipRender) renderMemoryTableScreen();
        return result;
    }

    function getDueMemoryTables(chat, options = {}) {
        const descriptors = getBoundTableDescriptors(chat);
        if (!MemoryPolicy) return descriptors;
        if (Array.isArray(options.targetTableKeys) && options.targetTableKeys.length) {
            const keys = new Set(options.targetTableKeys);
            return descriptors.filter(({ template, table }) => keys.has(`${template.id}::${table.id}`));
        }
        return descriptors.filter(({ template, table }) => MemoryPolicy.isTableDue(chat, template.id, table));
    }

    async function processMemoryTableAutoUpdate(chat, options = {}) {
        if (!chat) return { status: 'noop', updatedCount: 0 };
        ensureMemoryTableAutoUpdateState(chat);
        const descriptors = getBoundTableDescriptors(chat);
        if (!descriptors.length) {
            refreshMemoryTableAutoUpdateControls(chat, false);
            return { status: 'noop', updatedCount: 0 };
        }
        if (!options.force && !chat.memoryTables.autoUpdateEnabled) {
            refreshMemoryTableAutoUpdateControls(chat, true);
            return { status: 'disabled', updatedCount: 0 };
        }
        const due = getDueMemoryTables(chat, options);
        if (!due.length) {
            chat.memoryTables.autoUpdatePending = false;
            chat.memoryTables.autoUpdateState = 'idle';
            refreshMemoryTableAutoUpdateControls(chat, true);
            if (options.showNoPendingToast) showToast('当前没有到期或待处理的表格');
            return { status: 'noop', updatedCount: 0 };
        }

        if (!MemoryTasks) {
            // 兼容：任务模块未加载时沿用 V2.5 顺序执行。
            const results = [];
            for (const descriptor of due.slice(0, options.processAllAvailable ? due.length : 2)) {
                results.push(await updateSingleTableFromPolicy(chat, descriptor.template, descriptor.table, {
                    source: options.source || 'auto_v2_legacy', isAutoUpdate: true, operationId: options.operationId || null
                }));
            }
            return { status: 'success', updatedCount: results.length, results };
        }

        const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
        const maxRuns = options.processAllAvailable
            ? due.length
            : Math.min(due.length, runtime?.engineSettings?.maxAutoTablesPerRun || 2);
        let enqueued = 0;
        let deduped = 0;
        due.slice(0, maxRuns).forEach(descriptor => {
            const queued = enqueueMemoryTableUpdateTask(chat, descriptor.template, descriptor.table, {
                source: options.source || 'auto_round_v2_6',
                isAutoUpdate: true,
                priority: 45,
                operationId: options.operationId || null
            });
            if (!queued) return;
            if (queued.deduped) deduped += 1;
            else enqueued += 1;
        });
        chat.memoryTables.autoUpdateState = 'queued';
        chat.memoryTables.autoUpdatePending = enqueued > 0;
        await saveCharacter(chat.id);
        refreshMemoryTableAutoUpdateControls(chat, true);

        const processed = await processMemoryTaskQueue(chat, {
            maxTasks: options.processAllAvailable ? Math.max(1, maxRuns) : undefined,
            skipRender: true
        });
        const taskResults = processed.results || [];
        const updatedCount = taskResults.filter(item => !item?.deferred).length;
        chat.memoryTables.autoUpdateState = taskResults.some(item => item?.task?.status === 'failed') ? 'failed' : 'idle';
        chat.memoryTables.autoUpdatePending = MemoryTasks.getPendingCount(chat) > 0;
        await saveCharacter(chat.id);
        renderMemoryTableScreen();
        refreshMemoryTableAutoUpdateControls(chat, true);
        if (options.showSuccessToast && (enqueued || deduped)) {
            showToast(`任务队列：新增 ${enqueued}，去重 ${deduped}，本次执行 ${updatedCount}`);
        }
        return { status: 'success', updatedCount, enqueued, deduped, results: taskResults };
    }

    async function retryMemoryTableAutoUpdate(chat) {
        if (!chat) return { status: 'noop', updatedCount: 0 };
        ensureMemoryTableAutoUpdateState(chat);
        chat.memoryTables.autoUpdateState = 'idle';
        if (MemoryPolicy) {
            getBoundTableDescriptors(chat).forEach(({ template, table }) => {
                const state = MemoryPolicy.ensureTableState(chat, template.id, table.id);
                if (state.lastRunStatus === 'failed') state.lastRunStatus = 'idle';
            });
        }
        if (MemoryTasks) {
            const retried = MemoryTasks.retryFailed(chat);
            await saveCharacter(chat.id);
            if (retried > 0) {
                const result = await processMemoryTaskQueue(chat, { maxTasks: retried, force: true, ignoreRoundLimit: true });
                showToast(`已重新执行 ${result.processed || 0} 个失败任务`);
                return { status: result.status, updatedCount: result.processed || 0, results: result.results || [] };
            }
        }
        return processMemoryTableAutoUpdate(chat, {
            force: true,
            processAllAvailable: true,
            showNoPendingToast: true,
            showSuccessToast: true,
            ignoreFailedState: true,
            source: 'retry_v2_6'
        });
    }

    async function updateMemoryTableToLatest(chat) {
        return processMemoryTableAutoUpdate(chat, {
            force: true,
            processAllAvailable: true,
            showNoPendingToast: true,
            showSuccessToast: true,
            ignoreFailedState: true,
            source: 'manual_due_v2'
        });
    }

    async function updateSelectedMemoryTable(chat, templateId, tableId) {
        const template = getBoundTemplates(chat).find(item => item.id === templateId);
        const table = template?.tables?.find(item => item.id === tableId);
        if (!template || !table) {
            showToast('没有找到选中的表格');
            return { status: 'noop' };
        }
        const info = MemoryPolicy ? MemoryPolicy.getUnprocessedInfo(chat, templateId, tableId) : null;
        if (info && info.unsyncedMessages <= 0) {
            showToast('该表游标后没有新增消息；可以先调整游标位置');
            return { status: 'noop' };
        }
        if (!MemoryTasks) return updateSingleTableFromPolicy(chat, template, table, { source: 'manual_selected_legacy', isAutoUpdate: false });
        const queued = enqueueMemoryTableUpdateTask(chat, template, table, {
            source: 'manual_selected_v2_6',
            isAutoUpdate: false,
            priority: 90
        });
        if (!queued) return { status: 'noop' };
        await saveCharacter(chat.id);
        const processed = await processMemoryTaskQueue(chat, { taskId: queued.task.id, maxTasks: 1, force: true, ignoreRoundLimit: true, skipRender: true });
        const entry = processed.results?.[0];
        const result = entry?.result || entry?.task?.result || { status: entry?.task?.status || 'queued', changedFields: [] };
        selectMemoryView(chat, entry?.task?.status === 'waiting_review' ? 'review' : 'tasks');
        renderMemoryTableScreen();
        if (queued.deduped) showToast(`${table.name} 的同范围任务已存在，未重复提交`);
        else if (entry?.task?.status === 'waiting_review') showToast(`${table.name} 已生成审核草案`);
        else if (entry?.task?.status === 'failed') showToast(`${table.name} 更新失败，已保留在任务队列`);
        else showToast(result.changedFields?.length ? `已更新 ${table.name}，变更 ${result.changedFields.length} 项` : `${table.name} 没有检测到变化`);
        return result;
    }


    function closeMemoryRangePreview() {
        const modal = document.getElementById('memory-range-preview-modal');
        if (modal) modal.classList.remove('visible');
        uiState.rangePreview = null;
    }

    function openMemoryRangePreview(chat, templateId, tableId) {
        if (!chat || !MemoryPolicy) return;
        const template = getBoundTemplates(chat).find(item => item.id === templateId);
        const table = template?.tables?.find(item => item.id === tableId);
        if (!template || !table) {
            showToast('没有找到选中的表格');
            return;
        }
        const range = MemoryPolicy.getTableUpdateRange(chat, templateId, table);
        if (!range || range.end < range.start) {
            showToast('该表游标后没有新增消息');
            return;
        }
        const history = collectMessagesForMemoryTable(chat, { start: range.start, end: range.end });
        const policy = getTableRuntimePolicy(table);
        const runtime = MemoryPolicy.ensureRuntimeState(chat);
        const requireReview = MemoryReview ? MemoryReview.shouldRequireReview(runtime.engineSettings, {
            preferSummaryApi: policy.updatePolicy.useSummaryApi !== false,
            isAutoUpdate: false
        }) : false;
        let apiDisplay = policy.updatePolicy.useSummaryApi !== false ? '总结 API' : '主聊天 API';
        try {
            const route = resolveMemoryApiConfig(policy.updatePolicy.useSummaryApi !== false);
            apiDisplay = route.actualMode === 'summary' ? '总结 API' : '主聊天 API';
            if (route.fallback) apiDisplay += '（总结未配置，已回退）';
            if (route.model) apiDisplay += ` · ${route.model}`;
        } catch (_) {}
        const head = history.slice(0, 3);
        const tail = history.length > 6 ? history.slice(-3) : history.slice(3);
        const previewMessages = [...head, ...(history.length > 6 ? [{ role: 'system', content: `……中间省略 ${history.length - 6} 条……` }] : []), ...tail];
        const previewText = buildHistoryTextForPrompt(chat, previewMessages);
        const relatedPreview = MemoryContextAssembler.assemble({ chat, template, table, queryText: buildHistoryTextForPrompt(chat, history), budget: 7200 });
        uiState.rangePreview = { chatId: chat.id, templateId, tableId, start: range.start, end: range.end, relatedContext: { tableCount: relatedPreview.tables.length, rowCount: relatedPreview.rowCount, chars: relatedPreview.chars } };
        const content = document.getElementById('memory-range-preview-content');
        const modal = document.getElementById('memory-range-preview-modal');
        if (!content || !modal) return;
        content.innerHTML = `
            <div class="memory-range-preview">
                <div class="memory-range-preview-grid">
                    <div><strong>目标表</strong><span>${escapeHtml(table.name)}</span></div>
                    <div><strong>处理范围</strong><span>${range.start}–${range.end}</span></div>
                    <div><strong>有效消息</strong><span>${history.length} 条</span></div>
                    <div><strong>API / 审核</strong><span>${escapeHtml(apiDisplay)} · ${requireReview ? '先审核' : '直接应用'}</span></div>
                    <div><strong>相关记忆表</strong><span>${relatedPreview.tables.length} 张 · ${relatedPreview.rowCount} 行 · ${relatedPreview.chars} 字符</span></div>
                </div>
                ${relatedPreview.tables.length ? `<div class="memory-range-related-summary">${relatedPreview.tables.map(item => `<span>${escapeHtml(item.tableName)} · ${escapeHtml(item.reason)}${item.rowCount ? ` · ${item.rowCount} 行` : ''}</span>`).join('')}</div>` : ''}
                <div style="font-size:12px;color:#667085;line-height:1.6;">相关表仅用于去重、冲突和阶段判断，不会在本次操作中被直接修改。游标尚未推进，只有完成审核才推进该表游标。</div>
                <pre>${escapeHtml(previewText || '没有可显示的消息')}</pre>
            </div>`;
        modal.classList.add('visible');
    }

    async function confirmMemoryRangePreview() {
        const preview = uiState.rangePreview;
        const chat = getCurrentMemoryTableChat();
        if (!preview || !chat || preview.chatId !== chat.id) return;
        const template = getBoundTemplates(chat).find(item => item.id === preview.templateId);
        const table = template?.tables?.find(item => item.id === preview.tableId);
        if (!template || !table) return;
        closeMemoryRangePreview();
        if (!MemoryTasks) {
            await updateSingleTableFromPolicy(chat, template, table, {
                start: preview.start, end: preview.end, source: 'manual_preview_legacy', isAutoUpdate: false, forceReview: true
            });
            return;
        }
        const queued = enqueueMemoryTableUpdateTask(chat, template, table, {
            start: preview.start,
            end: preview.end,
            source: 'manual_preview_v2_6',
            isAutoUpdate: false,
            forceReview: true,
            priority: 95
        });
        if (!queued) return;
        await saveCharacter(chat.id);
        const processed = await processMemoryTaskQueue(chat, { taskId: queued.task.id, maxTasks: 1, force: true, ignoreRoundLimit: true, skipRender: true });
        const task = processed.results?.[0]?.task || queued.task;
        selectMemoryView(chat, task.status === 'waiting_review' ? 'review' : 'tasks');
        renderMemoryTableScreen();
        if (queued.deduped) showToast('同一范围的总结任务已存在，未重复提交');
        else if (task.status === 'waiting_review') showToast('已生成更新草案，等待审核');
        else if (task.status === 'failed') showToast('生成草案失败，任务已保留可重试');
        else showToast('范围内没有检测到变化');
    }


    async function checkAndTriggerAutoTableUpdate(chat, options = {}) {
        const runtime = window.OVOOperationRuntime;
        const shouldTrack = !!(runtime && (options.parentOperationId || options.trackOperation));
        const displayName = chat ? (chat.remarkName || chat.realName || chat.name || '当前角色') : '当前角色';
        const operation = shouldTrack ? runtime.startChild(options.parentOperationId || null, 'memory.table.auto', {
            title: `检查${displayName}的结构化档案`,
            source: 'memory-table-auto-after-reply',
            scope: { characterId: chat?.id || null },
            stage: '检查结构化档案开关与表格游标'
        }) : null;
        const reviewBatchIdsBefore = new Set((MemoryReview && chat ? MemoryReview.getPendingBatches(chat) : []).map(item => item?.id).filter(Boolean));

        if (!chat || !chat.memoryTables) {
            if (operation) runtime.skip(operation.id, '当前角色没有结构化档案配置');
            return { status: 'disabled', updatedCount: 0 };
        }
        if (!chat.memoryTables.autoUpdateEnabled) {
            if (operation) runtime.skip(operation.id, '结构化档案自动更新未开启', { result: { enabled: false } });
            return { status: 'disabled', updatedCount: 0 };
        }
        ensureMemoryTableAutoUpdateState(chat);
        if (chat.memoryTables.autoUpdateState === 'failed') {
            refreshMemoryTableAutoUpdateControls(chat, getBoundTemplates(chat).length > 0);
            const error = new Error('结构化档案上次自动更新失败，等待重试');
            if (operation) runtime.fail(operation.id, error);
            return { status: 'failed', updatedCount: 0, error };
        }
        const dueCount = getDueMemoryTables(chat, {}).length;
        runtime?.stage?.(operation?.id, '检查到期档案表', { detail: `${dueCount} 张表需要检查` });
        const result = await processMemoryTableAutoUpdate(chat, {
            force: false,
            processAllAvailable: false,
            showNoPendingToast: !!options.showNoPendingToast,
            source: 'auto_round_v2',
            operationId: operation?.id || null
        });
        if (operation) {
            if (result.status === 'success') {
                const waitingReview = (result.results || []).filter(item => item?.task?.status === 'waiting_review').length;
                const changedFields = (result.results || []).flatMap(item => item?.result?.changedFields || item?.task?.result?.changedFields || []);
                recordMemoryChangedFields(operation.id, changedFields, { characterId: chat.id });
                const newReviewBatches = (MemoryReview ? MemoryReview.getPendingBatches(chat) : []).filter(item => item?.id && !reviewBatchIdsBefore.has(item.id));
                newReviewBatches.forEach(batch => recordPendingReviewBatch(operation.id, batch, chat.id));
                runtime.complete(operation.id, {
                    summary: result.updatedCount > 0
                        ? `已处理 ${result.updatedCount} 个档案任务${waitingReview ? `，${waitingReview} 个等待审核` : ''}`
                        : '结构化档案检查完成',
                    result: { ...result, dueCount, changedFieldCount: changedFields.length, reviewBatchIds: newReviewBatches.map(item => item.id) }
                });
            } else if (result.status === 'failed') {
                runtime.fail(operation.id, result.error || new Error('结构化档案自动更新失败'), { result });
            } else {
                runtime.skip(operation.id, dueCount ? '档案任务暂未执行' : '当前没有到期或待处理的档案表', {
                    result: { ...result, dueCount }
                });
            }
        }
        return result;
    }

    async function convertJournalsToTables() {
        const chat = getCurrentMemoryTableChat();
        if (!chat) {
            showToast('请先进入一个角色聊天');
            return;
        }
        openConversionModal('journalToTable');
    }

    async function convertTablesToJournal() {
        const chat = getCurrentMemoryTableChat();
        if (!chat) {
            showToast('请先进入一个角色聊天');
            return;
        }
        openConversionModal('tableToJournal');
    }

    async function executeConversionFromModal() {
        const state = uiState.conversionState;
        const chat = getCurrentMemoryTableChat();
        if (!state || !chat) return;

        if (state.direction === 'journalToTable') {
            const templates = getBoundTemplates(chat).filter(item => state.selectedTemplateIds.includes(item.id));
            const journals = getJournalCandidates(chat).filter(item => state.selectedJournalIds.includes(item.id));
            if (templates.length === 0) {
                showToast('请至少选择一个目标模板');
                return;
            }
            if (journals.length === 0) {
                showToast('请至少选择一篇日记');
                return;
            }

            templates.forEach(template => ensureTemplateDataForChat(chat, template));
            const templateText = buildTemplateDefinitionForPrompt(chat, templates);

            const journalText = journals.map(item => `标题：${item.title}\n内容：${item.content}`).join('\n\n---\n\n');
            const prompt = `请把下面这些“已确认长期记忆”的日记，抽取进结构化记忆表。只更新发生变化的字段，只能依据给定日记内容，不要编造。

输出格式必须严格是：
<memory_updates>
  <memory_update templateId="模板ID" tableId="表格ID">
    <field fieldId="字段ID">新值</field>
    <row op="add">
      <field fieldId="字段ID">值</field>
    </row>
    <row op="update" rowId="现有行ID">
      <field fieldId="字段ID">新值</field>
    </row>
    <row op="delete" rowId="现有行ID"></row>
  </memory_update>
</memory_updates>

如果没有变化，输出 <memory_updates></memory_updates>。
rows 表请使用 row 节点，不要把 rows 表伪装成普通 field。

角色信息：
- 角色名：${chat.realName || ''}
- 用户称呼：${chat.myName || ''}

模板定义：
${templateText}

日记内容：
${journalText}`;

            try {
                const rawContent = await requestSummaryContent(prompt, 0.2);
                const changedFields = applyMemoryUpdatesFromXml(chat, rawContent, {
                    source: 'api',
                    targetTemplateIds: state.selectedTemplateIds,
                    strategy: state.strategy
                });
                await saveCharacter(chat.id);
                closeConversionModal();
                renderMemoryTableScreen();
                showToast(changedFields.length > 0 ? `已从日记提取 ${changedFields.length} 项表格变更` : '没有检测到可提取的新字段');
            } catch (error) {
                console.error('[MemoryTable] journal to table failed:', error);
                if (typeof showApiError === 'function') showApiError(error);
                else showToast(error.message || '日记转表格失败');
            }
        } else {
            const selectedTemplateIds = state.selectedTemplateIds || [];
            const tableContext = getMemoryContextBlock(chat, { force: true, templateIds: selectedTemplateIds });
            if (!tableContext) {
                showToast('当前没有可转换的表格内容');
                return;
            }
            const styleInstruction = state.journalStyle === 'timeline'
                ? '请按时间线整理，突出变化过程。'
                : state.journalStyle === 'archive'
                    ? '请写成结构清晰、偏档案整理风格的总结。'
                    : '请使用客观回忆风格。';
            const prompt = `请把下面的结构化记忆整理成一篇“客观、连贯、适合长期回忆”的记忆日记。不要额外解释，只输出以下 XML：
<journal>
  <title>标题</title>
  <content>正文</content>
</journal>

要求：
1. 语气客观，不要像聊天。
2. 可以按时间线整理，但不要凭空补完。
3. 标题简洁。
4. ${styleInstruction}

结构化记忆如下：
${tableContext}`;

            try {
                const rawContent = await requestSummaryContent(prompt, 0.5);
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(`<root>${rawContent || ''}</root>`, 'text/xml');
                if (xmlDoc.querySelector('parsererror')) {
                    throw new Error('表格转日记返回格式解析失败');
                }
                const generatedTitle = xmlDoc.querySelector('title')?.textContent?.trim() || '结构化记忆整理';
                const title = `${state.titlePrefix || ''}${generatedTitle}`;
                const content = xmlDoc.querySelector('content')?.textContent?.trim() || '';
                if (!content) {
                    throw new Error('没有提取到有效日记内容');
                }
                if (!Array.isArray(chat.memoryJournals)) chat.memoryJournals = [];
                chat.memoryJournals.unshift({
                    id: createMemoryId('journal'),
                    range: null,
                    title,
                    content,
                    createdAt: Date.now(),
                    chatId: chat.id,
                    chatType: 'private',
                    isFavorited: !!state.autoFavorite,
                    source: 'memory_table_conversion'
                });
                await saveCharacter(chat.id);
                closeConversionModal();
                renderMemoryTableScreen();
                showToast('已根据表格生成新日记');
            } catch (error) {
                console.error('[MemoryTable] table to journal failed:', error);
                if (typeof showApiError === 'function') showApiError(error);
                else showToast(error.message || '表格转日记失败');
            }
        }
    }


    function getReviewRiskLevel(table, operation) {
        const policy = getTableRuntimePolicy(table);
        if (operation === 'delete') return 'high';
        if (policy.memoryLayer === 'core') return 'high';
        if (policy.memoryLayer === 'long' || policy.memoryLayer === 'review') return operation === 'add' ? 'high' : 'medium';
        if (policy.memoryLayer === 'medium') return 'medium';
        return 'low';
    }

    function summarizeRowForReview(table, row) {
        if (!row) return '';
        return (table.columns || [])
            .map(field => `${field.key}: ${getFieldDisplayValue(field, row.cells?.[field.id]) || '空'}`)
            .filter(Boolean)
            .join('\n');
    }

    function findDuplicateSuggestionForReview(chat, template, table, proposedDisplay) {
        if (!MemoryRetrieval || !isRowsTable(table)) return null;
        const proposedText = Object.entries(proposedDisplay || {}).map(([key, value]) => `${key}: ${value}`).join('\n');
        const items = getRows(chat, template.id, table).map((row, index) => rowToRetrievalItem(table, row, index));
        const match = MemoryRetrieval.findMostSimilar(items, proposedText, 0.34);
        if (!match?.item?.row) return null;
        return {
            rowId: match.item.row.id,
            score: match.score,
            summary: summarizeRowForReview(table, match.item.row)
        };
    }

    function buildMemoryReviewBatch(chat, rawContent, options = {}) {
        if (!MemoryReview) return null;
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(`<root>${rawContent || ''}</root>`, 'text/xml');
        if (xmlDoc.querySelector('parsererror')) throw new Error('结构化记忆返回格式解析失败');
        const proposals = [];
        const targetTableKeys = new Set(Array.isArray(options.targetTableKeys) ? options.targetTableKeys : []);
        const updates = Array.from(xmlDoc.querySelectorAll('memory_update'));

        updates.forEach(updateNode => {
            const templateId = updateNode.getAttribute('templateId');
            const tableId = updateNode.getAttribute('tableId');
            if (targetTableKeys.size && !targetTableKeys.has(`${templateId}::${tableId}`)) return;
            const template = db.memoryTableTemplates.find(item => item.id === templateId);
            const table = template?.tables?.find(item => item.id === tableId);
            if (!template || !table) return;
            const policy = getTableRuntimePolicy(table);
            ensureTemplateDataForChat(chat, template);

            if (isRowsTable(table)) {
                Array.from(updateNode.querySelectorAll('row')).forEach(rowNode => {
                    const op = (rowNode.getAttribute('op') || 'update').trim().toLowerCase();
                    const rowId = rowNode.getAttribute('rowId') || '';
                    if (op === 'delete') {
                        const existingRow = rowId ? findRowById(chat, templateId, table, rowId) : null;
                        proposals.push({
                            id: createMemoryId('proposal'), kind: 'row_delete', actionLabel: '删除整行',
                            templateId, tableId, templateName: template.name, tableName: table.name, rowId,
                            label: `${table.name} / 删除记录`, oldValue: summarizeRowForReview(table, existingRow), newValue: '',
                            valid: !!existingRow && policy.updatePolicy.allowDelete === true,
                            error: !existingRow ? '目标行不存在' : (policy.updatePolicy.allowDelete === true ? '' : '该表禁止 AI 删除记录'),
                            risk: 'high', editable: false
                        });
                        return;
                    }
                    if (op === 'add') {
                        const values = {};
                        const display = {};
                        Array.from(rowNode.querySelectorAll('field')).forEach(fieldNode => {
                            const fieldId = fieldNode.getAttribute('fieldId');
                            const field = (table.columns || []).find(item => item.id === fieldId);
                            if (!field || field.aiEditable === false || isFieldLocked(chat, templateId, tableId, fieldId)) return;
                            const value = normalizeFieldValue(field, fieldNode.textContent || '');
                            values[fieldId] = value;
                            display[field.key] = getFieldDisplayValue(field, value);
                        });
                        if (!Object.keys(values).length) return;
                        const duplicateSuggestion = findDuplicateSuggestionForReview(chat, template, table, display);
                        const tagBundle = MemoryTagService.parseRowNode(rowNode);
                        proposals.push({
                            id: createMemoryId('proposal'), kind: 'row_add', actionLabel: '新增记录',
                            templateId, tableId, templateName: template.name, tableName: table.name,
                            label: `${table.name} / 新增记录`, oldValue: '', newValue: display, fieldValues: values, tagBundle,
                            valid: policy.updatePolicy.allowAdd !== false,
                            error: policy.updatePolicy.allowAdd === false ? '该表禁止 AI 新增记录' : '',
                            risk: getReviewRiskLevel(table, 'add'), editable: false,
                            duplicateSuggestion,
                            mergeTargetRowId: null
                        });
                        return;
                    }
                    const targetRow = rowId ? findRowById(chat, templateId, table, rowId) : null;
                    Array.from(rowNode.querySelectorAll('field')).forEach(fieldNode => {
                        const fieldId = fieldNode.getAttribute('fieldId');
                        const field = (table.columns || []).find(item => item.id === fieldId);
                        if (!field) return;
                        const oldValue = targetRow?.cells?.[fieldId];
                        const newValue = normalizeFieldValue(field, fieldNode.textContent || '');
                        if (targetRow && isSameMemoryValue(oldValue, newValue)) return;
                        const blockedReason = !targetRow ? '目标行不存在'
                            : policy.updatePolicy.allowUpdate === false ? '该表禁止 AI 修改记录'
                            : field.aiEditable === false ? '字段禁止 AI 编辑'
                            : isFieldLocked(chat, templateId, tableId, fieldId) ? '字段已锁定' : '';
                        proposals.push({
                            id: createMemoryId('proposal'), kind: 'row_update_field', actionLabel: '修改字段',
                            templateId, tableId, templateName: template.name, tableName: table.name, rowId, fieldId,
                            label: `${table.name} / ${field.key}`, oldValue, newValue,
                            valid: !blockedReason, error: blockedReason,
                            risk: getReviewRiskLevel(table, 'update'), editable: true, fieldType: field.type
                        });
                    });
                    const tagBundle = MemoryTagService.parseRowNode(rowNode);
                    if (tagBundle && (!targetRow || !MemoryTagService.equals(targetRow.meta?.tagBundle, tagBundle))) {
                        proposals.push({
                            id: createMemoryId('proposal'), kind: 'row_tags', actionLabel: '更新标签',
                            templateId, tableId, templateName: template.name, tableName: table.name, rowId,
                            label: `${table.name} / 模型标签`, oldValue: targetRow?.meta?.tagBundle || {}, newValue: tagBundle, tagBundle,
                            valid: !!targetRow && policy.updatePolicy.allowUpdate !== false && !MemoryTagService.isLocked(targetRow),
                            error: !targetRow ? '目标行不存在' : (policy.updatePolicy.allowUpdate === false ? '该表禁止 AI 修改记录' : (MemoryTagService.isLocked(targetRow) ? '标签已锁定，不接受模型覆盖' : '')),
                            risk: 'low', editable: false
                        });
                    }
                });
                return;
            }

            Array.from(updateNode.children).filter(node => node.tagName === 'field').forEach(fieldNode => {
                const fieldId = fieldNode.getAttribute('fieldId');
                const field = (table.columns || []).find(item => item.id === fieldId);
                if (!field) return;
                const oldValue = getFieldValue(chat, templateId, tableId, field);
                const newValue = normalizeFieldValue(field, fieldNode.textContent || '');
                if (isSameMemoryValue(oldValue, newValue)) return;
                const blockedReason = policy.updatePolicy.allowUpdate === false ? '该表禁止 AI 修改'
                    : field.aiEditable === false ? '字段禁止 AI 编辑'
                    : isFieldLocked(chat, templateId, tableId, fieldId) ? '字段已锁定' : '';
                proposals.push({
                    id: createMemoryId('proposal'), kind: 'field', actionLabel: '更新字段',
                    templateId, tableId, templateName: template.name, tableName: table.name, fieldId,
                    label: `${table.name} / ${field.key}`, oldValue, newValue,
                    valid: !blockedReason, error: blockedReason,
                    risk: getReviewRiskLevel(table, 'update'), editable: true, fieldType: field.type
                });
            });
        });

        if (!proposals.length) return null;
        const first = proposals[0];
        const tableState = MemoryPolicy ? MemoryPolicy.ensureTableState(chat, first.templateId, first.tableId) : null;
        return {
            id: createMemoryId('memory_review'),
            templateId: first.templateId,
            tableId: first.tableId,
            templateName: first.templateName,
            tableName: first.tableName,
            memoryLayer: options.memoryLayer || '',
            range: { start: options.start || 1, end: options.end || (chat.history?.length || 0) },
            source: options.source || 'api',
            apiMode: options.apiMode || 'summary',
            sourceMessageCount: options.sourceMessageCount || 0,
            historyPreview: options.historyPreview || '',
            beforeTableState: tableState ? deepClone(tableState) : null,
            rawContent: rawContent || '',
            relatedContext: options.relatedContext || null,
            proposals
        };
    }

    function applyAcceptedReviewProposals(chat, batch) {
        const accepted = (batch.proposals || []).filter(item => item.decision === 'accepted' && item.valid !== false);
        const changedFields = [];
        accepted.forEach(proposal => {
            const template = db.memoryTableTemplates.find(item => item.id === proposal.templateId);
            const table = template?.tables?.find(item => item.id === proposal.tableId);
            if (!template || !table) return;
            const policy = getTableRuntimePolicy(table).updatePolicy;
            if (proposal.kind === 'row_add') {
                if (proposal.mergeTargetRowId) {
                    if (policy.allowUpdate === false) return;
                    const target = findRowById(chat, template.id, table, proposal.mergeTargetRowId);
                    if (!target) return;
                    (table.columns || []).forEach(field => {
                        if (proposal.fieldValues?.[field.id] === undefined || field.aiEditable === false || isFieldLocked(chat, template.id, table.id, field.id)) return;
                        const nextValue = normalizeFieldValue(field, proposal.fieldValues[field.id]);
                        const oldValue = target.cells[field.id];
                        if (isSameMemoryValue(oldValue, nextValue)) return;
                        target.cells[field.id] = nextValue;
                        changedFields.push({ templateId: template.id, tableId: table.id, rowId: target.id, fieldId: field.id, label: `${table.name} / ${field.key}（审核合并）`, oldValue, newValue: nextValue });
                    });
                    target.meta ||= {};
                    target.meta.updatedAt = Date.now();
                    target.meta.lastMentionedAt = Date.now();
                    target.meta.retrievalVector = [];
                    target.meta.retrievalVectorFingerprint = '';
                    if (proposal.tagBundle) {
                        const tagChange = MemoryTagService.applyToRow(target, proposal.tagBundle, { chat, source: 'review_v2_11_r1' });
                        if (tagChange.changed) changedFields.push({ templateId: template.id, tableId: table.id, rowId: target.id, fieldId: '__tags__', label: `${table.name} / 模型标签（审核合并）`, oldValue: tagChange.oldValue, newValue: tagChange.newValue });
                    }
                    if (MemoryLifecycle) MemoryLifecycle.recordSource(target, 'summary_api', { type: 'review_batch', id: batch.id, at: Date.now() });
                    return;
                }
                if (policy.allowAdd === false) return;
                const added = addRow(chat, template.id, table, proposal.fieldValues || {}, { source: 'review_v2_2', skipHistory: true });
                (table.columns || []).forEach(field => {
                    if (proposal.fieldValues?.[field.id] === undefined) return;
                    changedFields.push({ templateId: template.id, tableId: table.id, rowId: added.id, fieldId: field.id, label: `${table.name} / ${field.key}（审核新增）`, oldValue: '', newValue: added.cells[field.id] });
                });
                if (proposal.tagBundle) {
                    const tagChange = MemoryTagService.applyToRow(added, proposal.tagBundle, { chat, source: 'review_v2_11_r1' });
                    if (tagChange.changed) changedFields.push({ templateId: template.id, tableId: table.id, rowId: added.id, fieldId: '__tags__', label: `${table.name} / 模型标签（审核新增）`, oldValue: tagChange.oldValue, newValue: tagChange.newValue });
                }
                return;
            }
            if (proposal.kind === 'row_delete') {
                if (policy.allowDelete !== true) return;
                const row = findRowById(chat, template.id, table, proposal.rowId);
                if (!row) return;
                (table.columns || []).forEach(field => changedFields.push({ templateId: template.id, tableId: table.id, rowId: proposal.rowId, fieldId: field.id, label: `${table.name} / ${field.key}（审核删除）`, oldValue: row.cells[field.id], newValue: '' }));
                deleteRow(chat, template.id, table, proposal.rowId, { source: 'review_v2_1', skipHistory: true });
                return;
            }
            if (proposal.kind === 'row_tags') {
                if (policy.allowUpdate === false) return;
                const row = findRowById(chat, template.id, table, proposal.rowId);
                if (!row) return;
                const tagChange = MemoryTagService.applyToRow(row, proposal.tagBundle || proposal.newValue, { chat, source: 'review_v2_11_r1' });
                if (tagChange.changed) changedFields.push({ templateId: template.id, tableId: table.id, rowId: row.id, fieldId: '__tags__', label: `${table.name} / 模型标签`, oldValue: tagChange.oldValue, newValue: tagChange.newValue });
                return;
            }
            const field = (table.columns || []).find(item => item.id === proposal.fieldId);
            if (!field || field.aiEditable === false || isFieldLocked(chat, template.id, table.id, field.id) || policy.allowUpdate === false) return;
            const nextValue = normalizeFieldValue(field, proposal.editedValue !== undefined ? proposal.editedValue : proposal.newValue);
            if (proposal.kind === 'row_update_field') {
                const row = findRowById(chat, template.id, table, proposal.rowId);
                if (!row) return;
                const oldValue = row.cells[field.id];
                if (isSameMemoryValue(oldValue, nextValue)) return;
                row.cells[field.id] = nextValue;
                row.meta ||= {};
                row.meta.updatedAt = Date.now();
                row.meta.lastMentionedAt = Date.now();
                changedFields.push({ templateId: template.id, tableId: table.id, rowId: row.id, fieldId: field.id, label: `${table.name} / ${field.key}`, oldValue, newValue: nextValue });
                return;
            }
            const oldValue = getFieldValue(chat, template.id, table.id, field);
            if (isSameMemoryValue(oldValue, nextValue)) return;
            if (!chat.memoryTables.data[template.id]) chat.memoryTables.data[template.id] = {};
            if (!chat.memoryTables.data[template.id][table.id]) chat.memoryTables.data[template.id][table.id] = {};
            chat.memoryTables.data[template.id][table.id][field.id] = nextValue;
            changedFields.push({ templateId: template.id, tableId: table.id, fieldId: field.id, label: `${table.name} / ${field.key}`, oldValue, newValue: nextValue });
        });
        return changedFields;
    }

    function recordMemoryChangedFields(operationId, changedFields, options = {}) {
        const runtime = window.OVOOperationRuntime;
        if (!runtime?.recordMutations || !operationId) return [];
        return runtime.recordMutations(operationId, (Array.isArray(changedFields) ? changedFields : []).slice(0, 80).map(change => {
            const stringifyMutationValue = value => {
                if (value == null) return '';
                if (typeof value === 'object') { try { return JSON.stringify(value); } catch (_) {} }
                return String(value);
            };
            const oldText = stringifyMutationValue(change?.oldValue);
            const newText = stringifyMutationValue(change?.newValue);
            const action = !oldText && newText ? 'create' : (oldText && !newText ? 'delete' : 'update');
            return {
                action,
                entityType: 'structured_memory',
                entityId: change?.rowId || `${change?.templateId || ''}:${change?.tableId || ''}:${change?.fieldId || ''}`,
                title: change?.label || options.title || '结构化档案变化',
                summary: action === 'create' ? '新增档案内容' : action === 'delete' ? '删除档案内容' : '更新档案内容',
                before: change?.oldValue,
                after: change?.newValue,
                fields: change?.fieldId ? [change.fieldId] : [],
                meta: { characterId: options.characterId || null, templateId: change?.templateId || null, tableId: change?.tableId || null, rowId: change?.rowId || null, fieldId: change?.fieldId || null, batchId: options.batchId || null }
            };
        }));
    }

    function recordPendingReviewBatch(operationId, batch, characterId) {
        if (!window.OVOOperationRuntime?.recordMutation || !operationId || !batch) return null;
        const proposalCount = Array.isArray(batch.proposals) ? batch.proposals.length : 0;
        return window.OVOOperationRuntime.recordMutation(operationId, {
            action: 'pending',
            entityType: 'memory_review',
            entityId: batch.id,
            title: `${batch.tableName || '结构化档案'}待审核草案`,
            summary: `${proposalCount} 项建议等待用户确认`,
            status: 'pending',
            count: Math.max(1, proposalCount),
            meta: { characterId, templateId: batch.templateId || null, tableId: batch.tableId || null, range: batch.range || null, proposalCount }
        });
    }

    async function finalizeMemoryReviewBatch(chat, batchId, options = {}) {
        if (!chat || !MemoryReview) return { status: 'noop', changedFields: [] };
        const batch = MemoryReview.getPendingBatches(chat).find(item => item.id === batchId);
        if (!batch) throw new Error('找不到待审核草案');
        const beforeSnapshot = deepClone(chat.memoryTables.data || {});
        if (options.rejectAll) MemoryReview.setAllDecisions(chat, batchId, 'rejected');
        const changedFields = options.rejectAll ? [] : applyAcceptedReviewProposals(chat, batch);
        if (changedFields.length) pushMemoryHistory(chat, changedFields, { source: 'review_v2_1' });
        if (MemoryPolicy) {
            MemoryPolicy.markTableProcessed(chat, batch.templateId, batch.tableId, batch.range?.end || 0, options.rejectAll ? 'review_rejected' : 'success');
            MemoryPolicy.clearRetrievalCache(chat);
        }
        setMemoryTableAutoUpdateCursorByEndIndex(chat, batch.range?.end || 0);
        const tableState = MemoryPolicy ? MemoryPolicy.ensureTableState(chat, batch.templateId, batch.tableId) : null;
        const afterSnapshot = deepClone(chat.memoryTables.data || {});
        MemoryReview.completeBatch(chat, batchId, {
            status: options.rejectAll ? 'rejected' : 'applied',
            appliedCount: changedFields.length,
            beforeSnapshot,
            afterSignature: MemoryReview.dataSignature(afterSnapshot),
            afterTableState: tableState ? deepClone(tableState) : null,
            changedFields
        });
        if (MemoryTasks) MemoryTasks.resolveReviewBatch(chat, batchId, options.rejectAll ? 'rejected' : 'applied');
        await saveCharacter(chat.id);
        selectMemoryView(chat, 'review');
        renderMemoryTableScreen();
        showToast(options.rejectAll ? '已拒绝整批建议并推进游标' : `已应用 ${changedFields.length} 项审核结果`);
        return { status: options.rejectAll ? 'rejected' : 'applied', changedFields };
    }

    async function cancelMemoryReviewBatch(chat, batchId) {
        if (!chat || !MemoryReview) return;
        const batch = MemoryReview.removePendingBatch(chat, batchId);
        if (!batch) return;
        if (MemoryPolicy) {
            const state = MemoryPolicy.ensureTableState(chat, batch.templateId, batch.tableId);
            if (state.pendingReviewBatchId === batch.id) state.pendingReviewBatchId = null;
            state.lastRunStatus = 'idle';
            state.lastError = '';
        }
        if (MemoryTasks) MemoryTasks.resolveReviewBatch(chat, batchId, 'cancelled');
        await saveCharacter(chat.id);
        renderMemoryTableScreen();
        showToast('已取消草案；表格游标未推进');
    }

    async function rollbackMemoryReviewBatch(chat, batchId) {
        if (!chat || !MemoryReview) return;
        const batch = MemoryReview.getCompletedBatches(chat).find(item => item.id === batchId);
        if (!batch || batch.status !== 'applied' || batch.rolledBack || !batch.beforeSnapshot) return;
        const currentSignature = MemoryReview.dataSignature(chat.memoryTables.data || {});
        const state = MemoryPolicy ? MemoryPolicy.ensureTableState(chat, batch.templateId, batch.tableId) : null;
        const cursorMatches = !state || !batch.afterTableState || state.lastProcessedMsgId === batch.afterTableState.lastProcessedMsgId;
        if (currentSignature !== batch.afterSignature || !cursorMatches) {
            showToast('之后已有新的档案变更或游标变化，无法安全整批回滚');
            return;
        }
        chat.memoryTables.data = deepClone(batch.beforeSnapshot);
        if (MemoryPolicy && batch.beforeTableState) {
            const runtime = MemoryPolicy.ensureRuntimeState(chat);
            runtime.tableStates[batch.templateId] ||= {};
            runtime.tableStates[batch.templateId][batch.tableId] = deepClone(batch.beforeTableState);
            MemoryPolicy.clearRetrievalCache(chat);
        }
        batch.rolledBack = true;
        batch.rolledBackAt = Date.now();
        await saveCharacter(chat.id);
        renderMemoryTableScreen();
        showToast('已安全回滚该审核批次');
    }

    function applyMemoryUpdatesFromXml(chat, rawContent, options = {}) {
        ensureMemoryTableState(chat);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(`<root>${rawContent || ''}</root>`, 'text/xml');
        if (xmlDoc.querySelector('parsererror')) {
            throw new Error('结构化记忆返回格式解析失败');
        }

        const updates = Array.from(xmlDoc.querySelectorAll('memory_update'));
        if (updates.length === 0) {
            chat.memoryTables.lastChangedFieldPaths = [];
            return [];
        }

        const changedFields = [];
        updates.forEach(updateNode => {
            const templateId = updateNode.getAttribute('templateId');
            const tableId = updateNode.getAttribute('tableId');
            if (Array.isArray(options.targetTemplateIds) && options.targetTemplateIds.length > 0 && !options.targetTemplateIds.includes(templateId)) {
                return;
            }
            const template = db.memoryTableTemplates.find(item => item.id === templateId);
            const table = template ? (template.tables || []).find(item => item.id === tableId) : null;
            if (!template || !table) return;
            if (Array.isArray(options.targetTableKeys) && options.targetTableKeys.length > 0 && !options.targetTableKeys.includes(`${templateId}::${tableId}`)) return;
            const updatePolicy = getTableRuntimePolicy(table).updatePolicy;
            ensureTemplateDataForChat(chat, template);

            if (isRowsTable(table)) {
                Array.from(updateNode.querySelectorAll('row')).forEach(rowNode => {
                    const op = (rowNode.getAttribute('op') || 'update').trim().toLowerCase();
                    const rowId = rowNode.getAttribute('rowId') || '';
                    if (op === 'delete') {
                        if (updatePolicy.allowDelete !== true) return;
                        const existingRow = rowId ? findRowById(chat, templateId, table, rowId) : null;
                        if (!existingRow) return;
                        (table.columns || []).forEach(field => {
                            changedFields.push({
                                templateId,
                                tableId,
                                rowId,
                                fieldId: field.id,
                                label: `${table.name} / ${field.key}（删除行）`,
                                oldValue: existingRow.cells[field.id],
                                newValue: ''
                            });
                        });
                        deleteRow(chat, templateId, table, rowId, { source: options.source || 'api', skipHistory: true });
                        return;
                    }

                    if (op === 'add') {
                        if (updatePolicy.allowAdd === false) return;
                        const initialValues = {};
                        Array.from(rowNode.querySelectorAll('field')).forEach(fieldNode => {
                            const fieldId = fieldNode.getAttribute('fieldId');
                            const field = (table.columns || []).find(item => item.id === fieldId);
                            if (!field || field.aiEditable === false || isFieldLocked(chat, templateId, tableId, fieldId)) return;
                            initialValues[fieldId] = fieldNode.textContent || '';
                        });
                        if (Object.keys(initialValues).length === 0) return;
                        const addedRow = addRow(chat, templateId, table, initialValues, { source: options.source || 'api', skipHistory: true });
                        (table.columns || []).forEach(field => {
                            if (initialValues[field.id] === undefined) return;
                            changedFields.push({
                                templateId,
                                tableId,
                                rowId: addedRow.id,
                                fieldId: field.id,
                                label: `${table.name} / ${field.key}（新增行）`,
                                oldValue: '',
                                newValue: addedRow.cells[field.id]
                            });
                        });
                        const tagBundle = MemoryTagService.parseRowNode(rowNode);
                        if (tagBundle) {
                            const tagChange = MemoryTagService.applyToRow(addedRow, tagBundle, { chat, source: options.source || 'api' });
                            if (tagChange.changed) changedFields.push({ templateId, tableId, rowId: addedRow.id, fieldId: '__tags__', label: `${table.name} / 模型标签（新增行）`, oldValue: tagChange.oldValue, newValue: tagChange.newValue });
                        }
                        return;
                    }

                    if (updatePolicy.allowUpdate === false) return;
                    const targetRow = rowId ? findRowById(chat, templateId, table, rowId) : null;
                    if (!targetRow) return;
                    let rowChanged = false;
                    Array.from(rowNode.querySelectorAll('field')).forEach(fieldNode => {
                        const fieldId = fieldNode.getAttribute('fieldId');
                        const field = (table.columns || []).find(item => item.id === fieldId);
                        if (!field || field.aiEditable === false || isFieldLocked(chat, templateId, tableId, fieldId)) return;
                        const oldValue = targetRow.cells[field.id];
                        if (options.strategy === 'fill_empty' && !isEmptyMemoryValue(field, oldValue)) return;
                        const newValue = normalizeFieldValue(field, fieldNode.textContent || '');
                        if (isSameMemoryValue(oldValue, newValue)) return;
                        targetRow.cells[field.id] = newValue;
                        targetRow.meta ||= {};
                        targetRow.meta.updatedAt = Date.now();
                        targetRow.meta.lastMentionedAt = Date.now();
                        rowChanged = true;
                        changedFields.push({
                            templateId,
                            tableId,
                            rowId,
                            fieldId,
                            label: `${table.name} / ${field.key}`,
                            oldValue,
                            newValue
                        });
                    });
                    const tagBundle = MemoryTagService.parseRowNode(rowNode);
                    if (tagBundle) {
                        const tagChange = MemoryTagService.applyToRow(targetRow, tagBundle, { chat, source: options.source || 'api' });
                        if (tagChange.changed) {
                            rowChanged = true;
                            changedFields.push({ templateId, tableId, rowId, fieldId: '__tags__', label: `${table.name} / 模型标签`, oldValue: tagChange.oldValue, newValue: tagChange.newValue });
                        }
                    }
                    if (rowChanged && MemoryLifecycle) MemoryLifecycle.recordSource(targetRow, options.source === 'manual' ? 'manual' : 'summary_api', { type: options.source === 'manual' ? 'manual' : 'review_batch', id: options.source || 'api', at: Date.now() }, { verified: options.source === 'manual' });
                });
                return;
            }

            if (updatePolicy.allowUpdate === false) return;
            Array.from(updateNode.children)
                .filter(node => node.tagName === 'field')
                .forEach(fieldNode => {
                    const fieldId = fieldNode.getAttribute('fieldId');
                    const field = (table.columns || []).find(item => item.id === fieldId);
                    if (!field) return;
                    if (field.aiEditable === false) return;
                    if (isFieldLocked(chat, templateId, tableId, fieldId)) return;

                    const oldValue = getFieldValue(chat, templateId, tableId, field);
                    if (options.strategy === 'fill_empty' && !isEmptyMemoryValue(field, oldValue)) return;
                    const newValue = normalizeFieldValue(field, fieldNode.textContent || '');
                    if (isSameMemoryValue(oldValue, newValue)) return;

                    if (!chat.memoryTables.data[templateId]) chat.memoryTables.data[templateId] = {};
                    if (!chat.memoryTables.data[templateId][tableId]) chat.memoryTables.data[templateId][tableId] = {};
                    chat.memoryTables.data[templateId][tableId][fieldId] = newValue;
                    changedFields.push({
                        templateId,
                        tableId,
                        fieldId,
                        label: field.key,
                        oldValue,
                        newValue
                    });
                });
        });

        pushMemoryHistory(chat, changedFields, {
            source: options.source || 'api'
        });
        if (changedFields.length && MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
        return changedFields;
    }



    async function restoreHistoryEntry(historyId) {
        const chat = getCurrentMemoryTableChat();
        if (!chat) return;
        const entry = (chat.memoryTables.history || []).find(item => item.id === historyId);
        if (!entry) return;

        chat.memoryTables.data = deepClone(entry.snapshot || {});
        chat.memoryTables.lastChangedFieldPaths = [];
        await saveCharacter(chat.id);
        renderMemoryTableScreen();
        showToast('已恢复到该历史快照');
    }

    async function persistTemplateNormalized(normalized) {
        const existingIndex = db.memoryTableTemplates.findIndex(item => item.id === normalized.id);
        if (existingIndex >= 0) {
            db.memoryTableTemplates.splice(existingIndex, 1, normalized);
        } else {
            db.memoryTableTemplates.unshift(normalized);
        }

        db.characters.forEach(chat => {
            ensureMemoryTableState(chat);
            if (chat.memoryTables.boundTemplateIds.includes(normalized.id)) {
                ensureTemplateDataForChat(chat, normalized);
            }
        });

        await saveData();
        renderMemoryTableScreen();
    }

    function clearReviewBatchesForTemplate(chat, templateId) {
        if (!MemoryReview || !chat) return;
        const state = MemoryReview.ensureState(chat);
        state.pendingBatches = (state.pendingBatches || []).filter(batch => batch.templateId !== templateId);
        state.completedBatches = (state.completedBatches || []).filter(batch => batch.templateId !== templateId);
        if (state.activeBatchId && !state.pendingBatches.some(batch => batch.id === state.activeBatchId)) {
            state.activeBatchId = state.pendingBatches[0]?.id || null;
        }
        if (MemoryPolicy) {
            const runtime = MemoryPolicy.ensureRuntimeState(chat);
            Object.values(runtime.tableStates?.[templateId] || {}).forEach(tableState => {
                tableState.pendingReviewBatchId = null;
                if (tableState.lastRunStatus === 'pending_review') tableState.lastRunStatus = 'idle';
            });
        }
    }

    async function bindTemplateToChat(chat, templateId, shouldBind) {
        ensureMemoryTableState(chat);
        if (shouldBind) {
            if (!chat.memoryTables.boundTemplateIds.includes(templateId)) {
                chat.memoryTables.boundTemplateIds.push(templateId);
            }
            const template = db.memoryTableTemplates.find(item => item.id === templateId);
            if (template) ensureTemplateDataForChat(chat, template);
        } else {
            chat.memoryTables.boundTemplateIds = chat.memoryTables.boundTemplateIds.filter(id => id !== templateId);
            clearReviewBatchesForTemplate(chat, templateId);
        }
        await saveCharacter(chat.id);
        renderMemoryTableScreen();
    }

    async function deleteTemplate(templateId) {
        const ok = confirm('删除后会解除所有角色对该模板的绑定，确定继续吗？');
        if (!ok) return;

        db.memoryTableTemplates = (db.memoryTableTemplates || []).filter(item => item.id !== templateId);
        db.characters.forEach(chat => {
            ensureMemoryTableState(chat);
            chat.memoryTables.boundTemplateIds = chat.memoryTables.boundTemplateIds.filter(id => id !== templateId);
            if (chat.memoryTables.data && chat.memoryTables.data[templateId]) delete chat.memoryTables.data[templateId];
            if (chat.memoryTables.lockedFields && chat.memoryTables.lockedFields[templateId]) delete chat.memoryTables.lockedFields[templateId];
            clearReviewBatchesForTemplate(chat, templateId);
        });
        await saveData();
        renderMemoryTableScreen();
        showToast('模板已删除');
    }

    function exportTemplate(templateId) {
        const template = db.memoryTableTemplates.find(item => item.id === templateId);
        if (!template) return;
        downloadJson(template, `${template.name || 'memory-template'}.json`);
    }

    function cloneTemplateWithFreshIds(template) {
        const working = deepClone(normalizeTemplate(template));
        const idMap = {
            templateId: { [working.id]: createMemoryId('memory_tpl') },
            tableIds: {},
            fieldIds: {}
        };
        const originalTemplateId = working.id;
        working.id = idMap.templateId[originalTemplateId];
        working.tables = (working.tables || []).map(table => {
            const oldTableId = table.id;
            const newTableId = createMemoryId('memory_table');
            idMap.tableIds[oldTableId] = newTableId;
            table.id = newTableId;
            table.columns = (table.columns || []).map(field => {
                const oldFieldId = field.id;
                const newFieldId = createMemoryId('memory_field');
                idMap.fieldIds[`${oldTableId}::${oldFieldId}`] = newFieldId;
                field.id = newFieldId;
                return field;
            });
            return table;
        });
        return { template: working, idMap, originalTemplateId };
    }

    function remapTableDataForImport(template, idMap, binding = {}) {
        const oldTemplateId = Object.keys(idMap.templateId)[0];
        const sourceData = binding.data?.[oldTemplateId] || {};
        const sourceLocks = binding.lockedFields?.[oldTemplateId] || {};
        const nextData = {};
        const nextLocks = {};

        (template.tables || []).forEach(table => {
            const oldTableId = Object.keys(idMap.tableIds).find(key => idMap.tableIds[key] === table.id);
            const oldTableData = sourceData?.[oldTableId];
            const oldLocked = sourceLocks?.[oldTableId] || [];

            if (isRowsTable(table)) {
                const rows = Array.isArray(oldTableData?.__rows) ? oldTableData.__rows : [];
                const rowIdMap = {};
                rows.forEach(oldRow => { rowIdMap[oldRow?.id || createMemoryId('legacy_row')] = createMemoryId('memory_row'); });
                nextData[table.id] = {
                    __rows: rows.map(oldRow => {
                        const oldRowId = oldRow?.id || '';
                        const row = { id: rowIdMap[oldRowId] || createMemoryId('memory_row'), cells: {}, meta: deepClone(oldRow?.meta || {}) };
                        (table.columns || []).forEach(field => {
                            const sourceFieldId = Object.keys(idMap.fieldIds).find(key => idMap.fieldIds[key] === field.id)?.split('::')[1];
                            const raw = oldRow?.cells?.[sourceFieldId] !== undefined ? oldRow.cells[sourceFieldId] : oldRow?.[sourceFieldId];
                            row.cells[field.id] = raw === undefined ? getFieldDefaultValue(field) : normalizeFieldValue(field, raw);
                        });
                        if (row.meta?.relations && typeof row.meta.relations === 'object') {
                            ['supersedes', 'supersededBy', 'conflictsWith', 'relatedTo'].forEach(key => {
                                row.meta.relations[key] = (Array.isArray(row.meta.relations[key]) ? row.meta.relations[key] : []).map(id => rowIdMap[id]).filter(Boolean);
                            });
                        }
                        if (Array.isArray(row.meta?.versionLog)) row.meta.versionLog = row.meta.versionLog.slice(-40);
                        return row;
                    })
                };
            } else {
                nextData[table.id] = {};
                (table.columns || []).forEach(field => {
                    const sourceFieldId = Object.keys(idMap.fieldIds).find(key => idMap.fieldIds[key] === field.id)?.split('::')[1];
                    const raw = oldTableData?.[sourceFieldId];
                    nextData[table.id][field.id] = raw === undefined ? getFieldDefaultValue(field) : normalizeFieldValue(field, raw);
                });
            }

            nextLocks[table.id] = oldLocked.map(fieldId => {
                const mappedKey = `${oldTableId}::${fieldId}`;
                return idMap.fieldIds[mappedKey];
            }).filter(Boolean);
        });

        return {
            data: nextData,
            lockedFields: nextLocks
        };
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
        const text = await file.text();
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            showToast('导入失败：JSON 无法解析');
            return;
        }

        ensureMemoryTemplateStore();
        const isPackage = parsed && typeof parsed === 'object' && parsed.type === 'memory_table_package';
        const list = isPackage
            ? (Array.isArray(parsed.templates) ? parsed.templates : [])
            : (Array.isArray(parsed) ? parsed : [parsed]);
        const importedTemplates = [];
        const importedMappings = [];

        list.forEach(item => {
            const cloned = cloneTemplateWithFreshIds(item);
            importedTemplates.push(cloned.template);
            importedMappings.push(cloned);
            db.memoryTableTemplates.unshift(cloned.template);
        });

        const chat = getCurrentMemoryTableChat();
        if (isPackage && parsed.binding && chat && importedMappings.length > 0) {
            const shouldApply = window.confirm('检测到记忆包。是否把模板和已填好的表格数据一起导入到当前角色？');
            if (shouldApply) {
                ensureMemoryTableState(chat);
                const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
                importedMappings.forEach(({ template, idMap, originalTemplateId }) => {
                    if (!chat.memoryTables.boundTemplateIds.includes(template.id)) {
                        chat.memoryTables.boundTemplateIds.push(template.id);
                    }
                    const remapped = remapTableDataForImport(template, idMap, parsed.binding);
                    chat.memoryTables.data[template.id] = remapped.data;
                    chat.memoryTables.lockedFields[template.id] = remapped.lockedFields;
                    if (runtime) {
                        runtime.tableStates[template.id] = {};
                        const sourceStates = parsed.binding.tableStates?.[originalTemplateId] || {};
                        Object.entries(idMap.tableIds || {}).forEach(([oldTableId, newTableId]) => {
                            if (sourceStates[oldTableId]) {
                                const importedState = deepClone(sourceStates[oldTableId]);
                                importedState.pendingReviewBatchId = null;
                                if (importedState.lastRunStatus === 'pending_review') importedState.lastRunStatus = 'idle';
                                runtime.tableStates[template.id][newTableId] = importedState;
                            } else MemoryPolicy.ensureTableState(chat, template.id, newTableId);
                        });
                    }
                });
                if (parsed.binding.memoryMode) {
                    chat.memoryMode = parsed.binding.memoryMode;
                }
                chat.memoryTables.autoUpdateEnabled = parsed.binding.autoUpdateEnabled !== false;
                chat.memoryTables.autoUpdateInterval = Math.max(10, parseInt(parsed.binding.autoUpdateInterval, 10) || 140);
                if (MemoryPolicy) {
                    const runtime = MemoryPolicy.ensureRuntimeState(chat);
                    runtime.engineSettings = MemoryPolicy.normalizeEngineSettings(parsed.binding.engineSettings || {
                        messageInterval: chat.memoryTables.autoUpdateInterval
                    });
                    runtime.viewMode = 'normal';
                }
                if (parsed.binding.sidecar && typeof parsed.binding.sidecar === 'object') {
                    chat.memoryTables.sidecar = deepClone(parsed.binding.sidecar);
                    chat.memoryTables.sidecar.statusMeta = {};
                    chat.memoryTables.sidecar.history = Array.isArray(chat.memoryTables.sidecar.history) ? chat.memoryTables.sidecar.history.slice(-120) : [];
                    chat.memoryTables.sidecar.candidates = Array.isArray(chat.memoryTables.sidecar.candidates) ? chat.memoryTables.sidecar.candidates.slice(-200) : [];
                }
                chat.memoryTables.lifecycle = parsed.binding.lifecycle && typeof parsed.binding.lifecycle === 'object'
                    ? deepClone(parsed.binding.lifecycle)
                    : { schemaVersion: '2.5', lastMaintenanceAt: 0, lastMaintenanceReport: null };
                if (MemoryTasks) {
                    const importedTaskSettings = parsed.binding.taskQueue?.settings;
                    chat.memoryTables.taskQueue = { schemaVersion: '2.6', settings: importedTaskSettings ? deepClone(importedTaskSettings) : undefined, tasks: [], history: [], stats: {} };
                    MemoryTasks.ensureState(chat);
                }
                if (MemoryFeedback) {
                    const importedFeedbackSettings = parsed.binding.feedback?.settings;
                    chat.memoryTables.feedback = { schemaVersion: '2.7', settings: importedFeedbackSettings ? deepClone(importedFeedbackSettings) : undefined, rounds: [], events: [], stats: {} };
                    MemoryFeedback.ensureState(chat);
                }
                if (MemoryQuality) {
                    const importedQuality = parsed.binding.quality || {};
                    chat.memoryTables.quality = { schemaVersion: '2.8', settings: importedQuality.settings ? deepClone(importedQuality.settings) : undefined, testCases: Array.isArray(importedQuality.testCases) ? deepClone(importedQuality.testCases) : undefined, runs: [], baselineRunId: '' };
                    MemoryQuality.ensureState(chat);
                }
                if (MemorySidecar) MemorySidecar.ensureState(chat);
                await saveCharacter(chat.id);
            }
        }

        await saveData();
        renderMemoryTableScreen();
        showToast(isPackage ? `已导入 ${importedTemplates.length} 个模板/记忆包` : `已导入 ${importedTemplates.length} 个模板`);
    }

    async function handleFieldInputChange(target) {
        return MemoryTableEditController.handleFieldInput(target, {
            getChat: getCurrentMemoryTableChat,
            templates: db.memoryTableTemplates,
            save: saveCharacter,
            gridRoot: () => document.querySelector('[data-memory-table-grid]')
        });
    }

    function bindMemoryWorkspaceNavigation(screen) {
        if (!screen || screen.dataset.memoryWorkspaceNavigationBound === '1') return;
        screen.dataset.memoryWorkspaceNavigationBound = '1';
        screen.addEventListener('click', event => {
            const workspaceTab = event.target.closest('.memory-workspace-tab-btn[data-workspace]');
            if (workspaceTab) {
                event.preventDefault();
                selectMemoryWorkspace(workspaceTab.dataset.workspace, '');
                return;
            }
            const pickCharacter = event.target.closest('[data-memory-pick-character]');
            if (pickCharacter) {
                event.preventDefault();
                window.OvoAppRegistry?.pickCharacter?.('选择角色记忆', character => {
                    if (!character) return;
                    selectMemoryWorkspace('memory', 'tables');
                    if (typeof switchScreen === 'function') switchScreen('memory-table-screen', { replace: true });
                });
                return;
            }
            const workbenchView = event.target.closest('[data-workbench-view]');
            if (workbenchView) {
                const view = workbenchView.dataset.workbenchView;
                selectMemoryWorkspace(MemoryWorkspace.getWorkspaceForView(view), view);
                return;
            }
            const workbenchBack = event.target.closest('[data-workbench-back]');
            if (workbenchBack) {
                selectMemoryWorkspace(workbenchBack.dataset.workbenchBack, '');
                return;
            }
            const governanceFilter = event.target.closest('[data-governance-filter]');
            if (governanceFilter) {
                MemoryGovernanceQueue.setFilter(governanceFilter.dataset.governanceFilter || 'all');
                renderMemoryTableScreen();
            }
        });
    }

    function setupMemoryTableScreen() {
        ensureMemoryTemplateStore();
        const screen = document.getElementById('memory-table-screen');
        bindMemoryWorkspaceNavigation(screen);
        if (screen?.dataset.memoryTableScreenBound === '1') return void renderMemoryTableScreen();
        if (screen) screen.dataset.memoryTableScreenBound = '1';
        MemoryRowEditController?.bind?.();

        const searchInput = document.getElementById('memory-table-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                MemoryTableSession.setSearch(uiState, searchInput.value || '');
                if (uiState.workspace === 'memory') refreshActiveMemoryTable();
                else renderMemoryTableScreen();
            });
        }

        const sortSelect = document.getElementById('memory-table-sort-select');
        if (sortSelect) {
            sortSelect.addEventListener('change', () => {
                uiState.sort = sortSelect.value || 'default';
                renderMemoryTableScreen();
            });
        }

        const tabButtons = document.querySelectorAll('.memory-table-tab-btn');
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const view = button.dataset.tab || 'tables';
                selectMemoryWorkspace(MemoryWorkspace.getWorkspaceForView(view), view);
            });
        });

        const updateBtn = document.getElementById('memory-table-update-btn');
        if (updateBtn) {
            updateBtn.addEventListener('click', async () => {
                const chat = getCurrentMemoryTableChat();
                if (!chat) return;
                const { active } = getActiveTableDescriptor(chat);
                if (!active) {
                    showToast('请先绑定并选择一张表格');
                    return;
                }
                const updateAction = async operation => {
                    const reviewBatchIdsBefore = new Set((MemoryReview ? MemoryReview.getPendingBatches(chat) : []).map(item => item?.id).filter(Boolean));
                    const result = await updateSelectedMemoryTable(chat, active.template.id, active.table.id);
                    if (operation?.id) {
                        recordMemoryChangedFields(operation.id, result?.changedFields || [], { characterId: chat.id });
                        (MemoryReview ? MemoryReview.getPendingBatches(chat) : []).filter(item => item?.id && !reviewBatchIdsBefore.has(item.id)).forEach(batch => recordPendingReviewBatch(operation.id, batch, chat.id));
                    }
                    return result;
                };
                await (window.OVOOperationRuntime?.run ? window.OVOOperationRuntime.run('memory.table.update', { title: `更新${chat.remarkName || chat.realName || chat.name || '角色'}的结构化档案`, source: 'memory-table-manual', scope: { characterId: chat.id, templateId: active.template.id, tableId: active.table.id, tableName: active.table.name || '' }, stage: '读取聊天范围与档案规则', getSummary: result => result?.changedFields?.length ? `结构化档案已更新 ${result.changedFields.length} 项` : (result?.status === 'waiting_review' ? '已生成结构化档案审核草案' : '结构化档案更新流程已完成') }, updateAction) : updateAction());
            });
        }
        uiState.viewMode = 'normal';
        const openSchemaEditorBtn = document.getElementById('memory-table-open-schema-editor-btn');
        if (openSchemaEditorBtn) openSchemaEditorBtn.addEventListener('click', () => {
            const chat = getCurrentMemoryTableChat();
            openSchemaEditor(chat ? activeTemplateForSchema(chat) : null);
        });

        const persistEngineControls = async () => {
            const chat = getCurrentMemoryTableChat();
            if (!chat) return null;
            ensureMemoryTableState(chat);
            const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
            const triggerSelect = document.getElementById('memory-table-trigger-mode');
            const roundInput = document.getElementById('memory-table-round-interval');
            const messageInput = document.getElementById('memory-table-auto-update-interval');
            const maxSourceInput = document.getElementById('memory-table-max-source-messages');
            const reviewModeSelect = document.getElementById('memory-table-review-mode');
            const retrievalModeSelect = document.getElementById('memory-table-retrieval-mode');
            const semanticWeightInput = document.getElementById('memory-table-semantic-weight');
            const embeddingCandidateInput = document.getElementById('memory-table-embedding-candidate-limit');
            const tagWeightInput = document.getElementById('memory-table-tag-weight');
            const sceneRoutingToggle = document.getElementById('memory-table-scene-routing-toggle');
            const sideEffectGuardToggle = document.getElementById('memory-table-side-effect-guard-toggle');
            const messageInterval = Math.max(10, parseInt(messageInput?.value, 10) || 140);
            chat.memoryTables.autoUpdateInterval = messageInterval;
            if (runtime) {
                runtime.engineSettings = MemoryPolicy.normalizeEngineSettings({
                    ...runtime.engineSettings,
                    triggerMode: triggerSelect?.value || runtime.engineSettings.triggerMode,
                    roundInterval: Math.max(1, parseInt(roundInput?.value, 10) || 2),
                    messageInterval,
                    maxSourceMessages: Math.max(10, parseInt(maxSourceInput?.value, 10) || 180),
                    reviewMode: reviewModeSelect?.value || runtime.engineSettings.reviewMode || 'summary_only',
                    retrievalMode: retrievalModeSelect?.value || runtime.engineSettings.retrievalMode || 'auto',
                    semanticWeight: Math.max(0, Math.min(1, parseFloat(semanticWeightInput?.value) || 0.55)),
                    tagWeight: Math.max(0, Math.min(0.8, parseFloat(tagWeightInput?.value) || 0.35)),
                    sceneRoutingEnabled: sceneRoutingToggle ? sceneRoutingToggle.checked : true,
                    sideEffectGuardEnabled: sideEffectGuardToggle ? sideEffectGuardToggle.checked : true,
                    embeddingCandidateLimit: Math.max(4, parseInt(embeddingCandidateInput?.value, 10) || 32)
                });
            }
            await saveCharacter(chat.id);
            refreshMemoryTableAutoUpdateControls(chat, getBoundTemplates(chat).length > 0);
            return chat;
        };

        const autoUpdateToggle = document.getElementById('memory-table-auto-update-toggle');
        if (autoUpdateToggle) {
            autoUpdateToggle.addEventListener('change', async () => {
                const chat = await persistEngineControls();
                if (!chat) return;
                await applyMemoryTableAutoUpdateToggle(chat, autoUpdateToggle.checked);
                renderMemoryTableScreen();
            });
        }

        const scheduleControlIds = new Set(['memory-table-trigger-mode', 'memory-table-round-interval', 'memory-table-auto-update-interval', 'memory-table-max-source-messages']);
        ['memory-table-trigger-mode', 'memory-table-round-interval', 'memory-table-auto-update-interval', 'memory-table-max-source-messages', 'memory-table-review-mode', 'memory-table-retrieval-mode', 'memory-table-semantic-weight', 'memory-table-tag-weight', 'memory-table-embedding-candidate-limit', 'memory-table-scene-routing-toggle', 'memory-table-side-effect-guard-toggle'].forEach(id => {
            const control = document.getElementById(id);
            if (!control) return;
            control.addEventListener(control.tagName === 'SELECT' || control.type === 'checkbox' ? 'change' : 'blur', async () => {
                const chat = await persistEngineControls();
                if (chat?.memoryTables?.autoUpdateEnabled && scheduleControlIds.has(id)) {
                    await checkAndTriggerAutoTableUpdate(chat);
                }
            });
        });

        const cursorSelect = document.getElementById('memory-table-cursor-table-select');
        const cursorInput = document.getElementById('memory-table-cursor-position');
        const parseCursorKey = () => {
            const raw = cursorSelect?.value || '';
            const splitAt = raw.indexOf('::');
            return splitAt > 0 ? [raw.slice(0, splitAt), raw.slice(splitAt + 2)] : ['', ''];
        };
        const syncCursorInput = () => {
            const chat = getCurrentMemoryTableChat();
            if (!chat || !MemoryPolicy || !cursorInput) return;
            const [templateId, tableId] = parseCursorKey();
            if (!templateId || !tableId) return;
            const info = MemoryPolicy.getUnprocessedInfo(chat, templateId, tableId);
            cursorInput.max = String(info.history.length);
            cursorInput.value = String(Math.max(0, info.cursorIndex + 1));
        };
        if (cursorSelect) cursorSelect.addEventListener('change', syncCursorInput);

        const saveCursorAt = async position => {
            const chat = getCurrentMemoryTableChat();
            if (!chat || !MemoryPolicy) return;
            const [templateId, tableId] = parseCursorKey();
            if (!templateId || !tableId) return;
            MemoryPolicy.setTableCursorByPosition(chat, templateId, tableId, position);
            await saveCharacter(chat.id);
            refreshMemoryTableAutoUpdateControls(chat, true);
            showToast(`游标已保存到第 ${Math.max(0, Number(position) || 0)} 条消息`);
        };
        const saveCursorBtn = document.getElementById('memory-table-save-cursor-btn');
        if (saveCursorBtn) saveCursorBtn.addEventListener('click', () => saveCursorAt(cursorInput?.value || 0));
        const cursorLatestBtn = document.getElementById('memory-table-cursor-latest-btn');
        if (cursorLatestBtn) cursorLatestBtn.addEventListener('click', () => {
            const chat = getCurrentMemoryTableChat();
            saveCursorAt(Array.isArray(chat?.history) ? chat.history.length : 0);
        });
        const cursorStartBtn = document.getElementById('memory-table-cursor-start-btn');
        if (cursorStartBtn) cursorStartBtn.addEventListener('click', () => saveCursorAt(0));
        const updateSelectedBtn = document.getElementById('memory-table-update-selected-btn');
        if (updateSelectedBtn) {
            updateSelectedBtn.addEventListener('click', async () => {
                const chat = getCurrentMemoryTableChat();
                if (!chat) return;
                const [templateId, tableId] = parseCursorKey();
                await updateSelectedMemoryTable(chat, templateId, tableId);
            });
        }

        const previewRangeBtn = document.getElementById('memory-table-preview-range-btn');
        if (previewRangeBtn) {
            previewRangeBtn.addEventListener('click', () => {
                const chat = getCurrentMemoryTableChat();
                if (!chat) return;
                const [templateId, tableId] = parseCursorKey();
                openMemoryRangePreview(chat, templateId, tableId);
            });
        }
        const rangePreviewCloseBtn = document.getElementById('memory-range-preview-close-btn');
        if (rangePreviewCloseBtn) rangePreviewCloseBtn.addEventListener('click', closeMemoryRangePreview);
        const rangePreviewConfirmBtn = document.getElementById('memory-range-preview-confirm-btn');
        if (rangePreviewConfirmBtn) rangePreviewConfirmBtn.addEventListener('click', confirmMemoryRangePreview);
        const rangePreviewModal = document.getElementById('memory-range-preview-modal');
        if (rangePreviewModal) rangePreviewModal.addEventListener('click', event => {
            if (event.target === rangePreviewModal) closeMemoryRangePreview();
        });

        const updateLatestBtn = document.getElementById('memory-table-update-latest-btn');
        if (updateLatestBtn) {
            updateLatestBtn.addEventListener('click', async () => {
                const chat = getCurrentMemoryTableChat();
                if (!chat) return;
                await updateMemoryTableToLatest(chat);
            });
        }

        const retryBtn = document.getElementById('memory-table-retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', async () => {
                const chat = getCurrentMemoryTableChat();
                if (!chat) return;
                await retryMemoryTableAutoUpdate(chat);
            });
        }

        const createTemplateBtn = document.getElementById('memory-table-create-template-btn');
        if (createTemplateBtn) createTemplateBtn.addEventListener('click', () => openSchemaEditor(null));

        const importBtn = document.getElementById('memory-table-import-btn');
        const importInput = document.getElementById('memory-table-import-input');
        if (importBtn && importInput) {
            importBtn.addEventListener('click', () => importInput.click());
            importInput.addEventListener('change', async () => {
                await importTemplatesFromFile(importInput.files[0]);
                importInput.value = '';
            });
        }

        const exportAllBtn = document.getElementById('memory-table-export-all-btn');
        if (exportAllBtn) exportAllBtn.addEventListener('click', exportAllTemplates);

        const exportPackageBtn = document.getElementById('memory-table-export-package-btn');
        if (exportPackageBtn) exportPackageBtn.addEventListener('click', exportCurrentMemoryPackage);

        const fromJournalBtn = document.getElementById('memory-table-from-journal-btn');
        if (fromJournalBtn) fromJournalBtn.addEventListener('click', convertJournalsToTables);

        const toJournalBtn = document.getElementById('memory-table-to-journal-btn');
        if (toJournalBtn) toJournalBtn.addEventListener('click', convertTablesToJournal);

        const modeButtons = document.querySelectorAll('[data-memory-mode-switch]');
        modeButtons.forEach(button => {
            button.addEventListener('click', async () => {
                const chat = getCurrentMemoryTableChat();
                if (!chat) return;
                const nextMode = button.dataset.memoryModeSwitch;
                chat.memoryMode = nextMode === 'table' ? 'table' : (nextMode === 'vector' ? 'vector' : 'journal');
                await saveCharacter(chat.id);
                renderMemoryTableScreen();
                showToast(chat.memoryMode === 'table'
                    ? '已使用：仅结构化档案'
                    : (chat.memoryMode === 'vector' ? '已使用：结构化档案 + 向量补充' : '已使用：结构化档案 + 日记补充'));
            });
        });

        if (screen) {
            screen.addEventListener('click', async (event) => {
                const feedbackEl = event.target.closest('[data-feedback-action]');
                if (feedbackEl && MemoryFeedback) {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    const feedbackAction = feedbackEl.dataset.feedbackAction;
                    if (feedbackAction === 'undo-last') {
                        const result = MemoryFeedback.undoLast(chat);
                        if (result.changed) await saveCharacter(chat.id);
                        renderMemoryTableScreen();
                        showToast(result.message);
                        return;
                    }
                    if (feedbackAction === 'clear-reviewed-rounds') {
                        const count = MemoryFeedback.clearReviewedRounds(chat);
                        await saveCharacter(chat.id);
                        renderMemoryTableScreen();
                        showToast(`已清理 ${count} 个已反馈快照`);
                        return;
                    }
                    if (feedbackAction === 'clear-expired-rounds') {
                        const count = MemoryFeedback.clearExpiredRounds(chat);
                        await saveCharacter(chat.id);
                        renderMemoryTableScreen();
                        showToast(`已清理 ${count} 个过期反馈请求`);
                        return;
                    }
                    if (feedbackAction === 'clear-pending-tasks') {
                        if (!window.confirm('清空后这些引用轮次不再要求反馈，已完成的反馈效果会保留。确定继续吗？')) return;
                        const result = MemoryFeedback.clearPendingTasks(chat);
                        await saveCharacter(chat.id);
                        renderMemoryTableScreen();
                        showToast(`已清空 ${result.rounds} 轮、${result.items} 项待反馈任务`);
                        return;
                    }
                    if (feedbackAction === 'forget' && !window.confirm('这会停止使用并归档该条记忆。确定继续吗？')) return;
                    const result = MemoryFeedback.applyAction(chat, feedbackEl.dataset.snapshotId, feedbackEl.dataset.feedbackItemId, feedbackAction);
                    if (result.changed) await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast(result.message);
                    return;
                }
                const sidecarEl = event.target.closest('[data-sidecar-action]');
                if (sidecarEl && MemorySidecarCandidateController) {
                    const chat = getCurrentMemoryTableChat();
                    await MemorySidecarCandidateController.handle(sidecarEl.dataset.sidecarAction || '', sidecarEl, {
                        chat,
                        save: saveCharacter,
                        render: renderMemoryTableScreen,
                        confirm: message => window.confirm(message),
                        toast: showToast,
                        showError: error => typeof showApiError === 'function' ? showApiError(error) : showToast(error.message || '候选处理失败')
                    });
                    return;
                }
                const governanceEl = event.target.closest('[data-governance-action]');
                if (governanceEl) {
                    const chat = getCurrentMemoryTableChat();
                    const governanceAction = governanceEl.dataset.governanceAction || '';
                    await MemoryGovernanceController.handle(governanceAction, governanceEl, {
                        chat,
                        templates: chat ? getBoundTemplates(chat) : [],
                        save: saveCharacter,
                        render: renderMemoryTableScreen,
                        confirm: message => window.confirm(message),
                        toast: showToast,
                        showError: error => typeof showApiError === 'function' ? showApiError(error) : showToast(error.message || '候选处理失败'),
                        navigate: view => selectMemoryWorkspace(MemoryWorkspace.getWorkspaceForView(view), view),
                        openRow: item => {
                            MemoryTableSession.selectTable(uiState, item.tableId);
                            uiState.inspectorOpen = true;
                            uiState.selectedRowId = item.rowId;
                            uiState.inspectorAnalysis = null;
                            uiState.inspectorReview = null;
                            uiState.inspectorTab = 'relations';
                            applyMemoryWorkspaceState(chat, 'memory', 'tables');
                            const runtime = MemoryPolicy?.ensureRuntimeState?.(chat);
                            if (runtime) runtime.activeTableId = item.tableId;
                            renderMemoryTableScreen();
                        }
                    });
                    return;
                }
                const actionEl = event.target.closest('[data-action]');
                if (!actionEl) return;
                const action = actionEl.dataset.action;
                if (MemoryTableInteraction.handleAction(action, actionEl, {
                    state: uiState,
                    root: document.getElementById('memory-table-content') || document,
                    render: renderMemoryTableScreen,
                    refreshGrid: refreshActiveMemoryTable,
                    openEditor: openMemoryRecordEditor
                })) return;
                if (await MemoryTableEditController.handleAction(action, actionEl, {
                    getChat: getCurrentMemoryTableChat,
                    templates: db.memoryTableTemplates,
                    getBoundTemplates,
                    state: uiState,
                    save: saveCharacter,
                    render: renderMemoryTableScreen,
                    refreshGrid: refreshActiveMemoryTable,
                    gridRoot: () => document.querySelector('[data-memory-table-grid]'),
                    confirm: message => window.confirm(message)
                })) return;
                if (action === 'toggle-memory-settings') {
                    uiState.settingsOpen = !uiState.settingsOpen;
                    renderMemoryTableScreen();
                } else if (action === 'open-memory-update-history') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    uiState.historyTableId = actionEl.dataset.tableId || null;
                    applyMemoryWorkspaceState(chat, 'manage', 'history');
                    renderMemoryTableScreen();
                } else if (action === 'clear-memory-history-filter') {
                    uiState.historyTableId = null;
                    renderMemoryTableScreen();
                } else if (MemoryRowInspectorController.handles(action)) {
                    await MemoryRowInspectorController.handleAction(action, actionEl, {
                        chat: getCurrentMemoryTableChat(), state: uiState, save: saveCharacter,
                        render: renderMemoryTableScreen, toast: showToast,
                        showError: error => typeof showApiError === 'function' ? showApiError(error) : showToast(error.message || '操作失败')
                    });
                } else if (action === 'quality-run') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryQuality) return;
                    try {
                        let run = null;
                        if (MemoryTasks) {
                            const queued = MemoryQuality.enqueueRun(chat, { force: true });
                            await saveCharacter(chat.id);
                            const result = await processMemoryTaskQueue(chat, { taskId: queued.task.id, maxTasks: 1, force: true, ignoreRoundLimit: true });
                            const runId = result.results?.[0]?.result?.runId || result.results?.[0]?.task?.result?.runId;
                            run = MemoryQuality.ensureState(chat).runs.find(item => item.id === runId) || MemoryQuality.ensureState(chat).runs.slice(-1)[0] || null;
                        } else {
                            run = await MemoryQuality.runSuite(chat);
                            await saveCharacter(chat.id);
                        }
                        selectMemoryView(chat, 'quality');
                        renderMemoryTableScreen();
                        showToast(run ? `质量测试完成：${run.summary.score} 分` : '质量测试已完成');
                    } catch (error) {
                        if (typeof showApiError === 'function') showApiError(error);
                        else showToast(error.message || '质量测试失败');
                    }
                } else if (action === 'quality-export-md') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryQuality) return;
                    MemoryQuality.downloadReport(chat, 'md');
                    await saveCharacter(chat.id);
                    showToast('质量报告已导出');
                } else if (action === 'quality-clear-runs') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryQuality) return;
                    if (!window.confirm('确定清除质量测试历史和基线吗？')) return;
                    const count = MemoryQuality.clearRuns(chat);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast(`已清除 ${count} 次质量测试`);
                } else if (action === 'quality-set-baseline') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryQuality) return;
                    const ok = MemoryQuality.setBaseline(chat, actionEl.dataset.runId || '');
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast(ok ? '已设置质量回归基线' : '目标测试不存在');
                } else if (action === 'quality-add-case') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryQuality) return;
                    const created = MemoryQuality.addTestCase(chat);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast(created ? '已新增质量测试用例' : '测试用例已达到上限');
                } else if (action === 'quality-remove-case') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryQuality) return;
                    const ok = MemoryQuality.removeTestCase(chat, actionEl.dataset.caseId || '');
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast(ok ? '测试用例已删除' : '测试用例不存在');
                } else if (action === 'quality-reset-cases') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryQuality) return;
                    if (!window.confirm('恢复默认测试对话集会覆盖当前自定义用例。确定继续吗？')) return;
                    MemoryQuality.resetTestCases(chat);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast('已恢复默认质量测试集');
                } else if (action === 'task-run-queue') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryTasks) return;
                    const result = await processMemoryTaskQueue(chat, { force: true, ignoreRoundLimit: true });
                    showToast(`任务队列已执行 ${result.processed || 0} 项`);
                } else if (action === 'task-toggle-pause') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryTasks) return;
                    const paused = MemoryTasks.setPaused(chat, !MemoryTasks.ensureState(chat).settings.paused);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast(paused ? '任务队列已暂停' : '任务队列已恢复');
                } else if (action === 'task-retry-failed') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryTasks) return;
                    const count = MemoryTasks.retryFailed(chat);
                    await saveCharacter(chat.id);
                    const result = count ? await processMemoryTaskQueue(chat, { maxTasks: count, force: true, ignoreRoundLimit: true }) : { processed: 0 };
                    showToast(count ? `已重试 ${result.processed || 0} 个失败任务` : '没有失败任务');
                } else if (action === 'task-enqueue-retrieval') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryTasks) return;
                    const result = MemoryTasks.enqueueRetrievalRebuild(chat, getMemoryContextBlock(chat, { force: true }).length);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast(result.deduped ? '检索重建任务已存在' : '已加入检索重建任务');
                } else if (action === 'task-enqueue-lifecycle') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryTasks) return;
                    const result = MemoryTasks.enqueueLifecycleMaintenance(chat);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast(result.deduped ? '生命周期整理任务已存在' : '已加入生命周期整理任务');
                } else if (action === 'task-clear-completed') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryTasks) return;
                    const count = MemoryTasks.clearCompleted(chat);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast(`已清除 ${count} 个完成任务`);
                } else if (action === 'task-run-one') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryTasks) return;
                    const result = await processMemoryTaskQueue(chat, { taskId: actionEl.dataset.taskId, maxTasks: 1, force: true, ignoreRoundLimit: true });
                    showToast(result.processed ? '任务执行完成' : '任务未执行');
                } else if (action === 'task-cancel') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryTasks) return;
                    const ok = MemoryTasks.cancelTask(chat, actionEl.dataset.taskId);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast(ok ? '任务已取消' : '当前状态不能取消');
                } else if (action === 'task-open-review') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryReview) return;
                    MemoryReview.setActiveBatch(chat, actionEl.dataset.batchId || null);
                    selectMemoryView(chat, 'review');
                    renderMemoryTableScreen();
                } else if (action === 'retrieval-rebuild') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    try {
                        if (MemoryTasks) {
                            const queued = MemoryTasks.enqueueRetrievalRebuild(chat, getMemoryContextBlock(chat, { force: true }).length);
                            await saveCharacter(chat.id);
                            const result = await processMemoryTaskQueue(chat, { taskId: queued.task.id, maxTasks: 1, force: true, ignoreRoundLimit: true });
                            showToast(result.processed ? '已通过任务队列重建检索快照' : '检索重建任务已存在');
                        } else {
                            await rebuildMemoryTableRetrievalPreview(chat);
                            showToast('已重建检索快照');
                        }
                    } catch (error) {
                        if (typeof showApiError === 'function') showApiError(error);
                        else showToast(error.message || '检索预览失败');
                    }
                } else if (action === 'retrieval-clear-index') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    const count = clearMemoryTableRetrievalIndex(chat);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast(`已清除 ${count} 条行向量索引`);
                } else if (action === 'retrieval-clear-diagnostic') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryPolicy) return;
                    const runtime = MemoryPolicy.ensureRuntimeState(chat);
                    runtime.lastRetrievalDiagnostic = null;
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                } else if (action === 'review-toggle-merge') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryReview) return;
                    const batch = MemoryReview.getPendingBatches(chat).find(item => item.id === actionEl.dataset.batchId);
                    const proposal = batch?.proposals?.find(item => item.id === actionEl.dataset.proposalId);
                    if (!proposal) return;
                    const nextTarget = proposal.mergeTargetRowId ? null : (actionEl.dataset.rowId || null);
                    MemoryReview.setProposalMergeTarget(chat, actionEl.dataset.batchId, actionEl.dataset.proposalId, nextTarget);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                } else if (action === 'review-accept' || action === 'review-reject' || action === 'review-reset') {
                    event.preventDefault();
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryReview) return;
                    const decision = action === 'review-accept' ? 'accepted' : (action === 'review-reject' ? 'rejected' : 'pending');
                    const changed = MemoryReview.setProposalDecision(chat, actionEl.dataset.batchId, actionEl.dataset.proposalId, decision);
                    if (!changed) return void showToast('该项当前不能修改');
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast(decision === 'accepted' ? '已选中接受；请点击“保存已接受项”完成写入' : (decision === 'rejected' ? '已选中拒绝' : '已恢复为待定'));
                } else if (action === 'review-accept-all' || action === 'review-reject-all') {
                    event.preventDefault();
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryReview) return;
                    const decision = action === 'review-accept-all' ? 'accepted' : 'rejected';
                    const changed = MemoryReview.setAllDecisions(chat, actionEl.dataset.batchId, decision);
                    if (!changed) return void showToast('找不到该审核批次');
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast(decision === 'accepted' ? '已选中全部可接受项；请点击“保存已接受项”' : '已选中全部拒绝');
                } else if (action === 'review-apply-batch') {
                    event.preventDefault();
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryReview) return;
                    const batch = MemoryReview.getPendingBatches(chat).find(item => item.id === actionEl.dataset.batchId);
                    const acceptedCount = (batch?.proposals || []).filter(item => item.decision === 'accepted' && item.valid !== false).length;
                    if (!acceptedCount) return void showToast('还没有选中要接受的项目');
                    actionEl.disabled = true;
                    actionEl.textContent = '正在保存…';
                    const runtime = window.OVOOperationRuntime;
                    const reviewOperation = runtime?.start?.('memory.review.apply', {
                        title: `保存${batch?.tableName || '结构化档案'}审核结果`,
                        source: 'memory-review-apply',
                        scope: { characterId: chat.id, batchId: actionEl.dataset.batchId, templateId: batch?.templateId || null, tableId: batch?.tableId || null },
                        stage: '写入已接受的档案建议'
                    }) || null;
                    try {
                        const applyResult = await finalizeMemoryReviewBatch(chat, actionEl.dataset.batchId);
                        if (reviewOperation) {
                            recordMemoryChangedFields(reviewOperation.id, applyResult.changedFields || [], { characterId: chat.id, batchId: actionEl.dataset.batchId });
                            runtime.complete(reviewOperation.id, {
                                summary: `已保存 ${applyResult.changedFields?.length || 0} 项结构化档案变化`,
                                result: { batchId: actionEl.dataset.batchId, changedFieldCount: applyResult.changedFields?.length || 0 }
                            });
                        }
                    } catch (error) {
                        if (reviewOperation) runtime.fail(reviewOperation.id, error, { summary: '结构化档案审核结果保存失败' });
                        console.error('[MemoryReview] apply failed:', error);
                        showToast(error.message || '审核结果保存失败');
                        actionEl.disabled = false;
                        actionEl.textContent = `保存已接受项（${acceptedCount}）`;
                    }
                } else if (action === 'review-reject-batch') {
                    event.preventDefault();
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    actionEl.disabled = true;
                    try {
                        await finalizeMemoryReviewBatch(chat, actionEl.dataset.batchId, { rejectAll: true });
                    } catch (error) {
                        console.error('[MemoryReview] reject batch failed:', error);
                        showToast(error.message || '整批拒绝失败');
                        actionEl.disabled = false;
                    }
                } else if (action === 'review-cancel-batch') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    if (!window.confirm('取消草案后不会推进游标，之后可以重新生成。确定取消吗？')) return;
                    await cancelMemoryReviewBatch(chat, actionEl.dataset.batchId);
                } else if (action === 'review-rollback') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    if (!window.confirm('将档案恢复到本批审核应用前，并恢复该表游标。确定回滚吗？')) return;
                    await rollbackMemoryReviewBatch(chat, actionEl.dataset.batchId);
                } else if (action === 'approve-long-candidate') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    const template = getBoundTemplates(chat).find(item => item.id === actionEl.dataset.templateId);
                    const table = template?.tables?.find(item => item.id === actionEl.dataset.tableId);
                    const row = table ? findRowById(chat, template.id, table, actionEl.dataset.rowId) : null;
                    if (!template || !table || !row) return;
                    const result = MemoryCandidateService.approve(chat, { template, table }, row);
                    if (result.changed) await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast(result.changed ? (result.duplicate ? '长期库已有相同记录，候选已标记为批准' : '候选已批准并晋升到稳定长期特征库') : (result.reason || '候选未改变'));
                } else if (action === 'reject-long-candidate' || action === 'more-evidence-candidate') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    const template = getBoundTemplates(chat).find(item => item.id === actionEl.dataset.templateId);
                    const table = template?.tables?.find(item => item.id === actionEl.dataset.tableId);
                    const row = table ? findRowById(chat, template.id, table, actionEl.dataset.rowId) : null;
                    if (!template || !table || !row) return;
                    const result = MemoryCandidateService.setStatus(chat, { template, table }, row, action === 'reject-long-candidate' ? '已拒绝' : '需要更多证据');
                    if (result.changed) await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast(action === 'reject-long-candidate' ? '候选已拒绝' : '候选已标记为需要更多证据');
                } else if (action === 'lifecycle-maintenance') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryLifecycle) return;
                    if (MemoryTasks) {
                        const queued = MemoryTasks.enqueueLifecycleMaintenance(chat);
                        await saveCharacter(chat.id);
                        const result = await processMemoryTaskQueue(chat, { taskId: queued.task.id, maxTasks: 1, force: true, ignoreRoundLimit: true });
                        const report = result.results?.[0]?.result?.report || result.results?.[0]?.task?.result?.report;
                        showToast(report ? `生命周期整理完成：检查 ${report.checked}，改变 ${report.changed}` : '生命周期整理任务已处理');
                    } else {
                        const report = MemoryLifecycle.runMaintenance(chat, getBoundTemplates(chat));
                        if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
                        await saveCharacter(chat.id);
                        renderMemoryTableScreen();
                        showToast(`生命周期整理完成：检查 ${report.checked}，改变 ${report.changed}`);
                    }
                } else if (action === 'edit-row-reliability' || action === 'row-supersedes' || action === 'row-conflicts' || action === 'row-clear-relations') {
                    const chat = getCurrentMemoryTableChat();
                    const template = db.memoryTableTemplates.find(item => item.id === actionEl.dataset.templateId);
                    const table = template?.tables?.find(item => item.id === actionEl.dataset.tableId);
                    const row = table ? findRowById(chat, template.id, table, actionEl.dataset.rowId) : null;
                    if (!chat || !template || !table || !row || !MemoryLifecycle) return;
                    let changed = false;
                    if (action === 'edit-row-reliability') changed = MemoryLifecycle.editReliability(row, table);
                    if (action === 'row-supersedes' || action === 'row-conflicts') {
                        const target = MemoryLifecycle.pickTargetRow(row, table, getRows(chat, template.id, table), action === 'row-supersedes' ? '选择要被当前记录替代的旧记录' : '选择与当前记录冲突的记录');
                        if (target) changed = MemoryLifecycle.linkRows(row, target, action === 'row-supersedes' ? 'supersedes' : 'conflict');
                    }
                    if (action === 'row-clear-relations') changed = MemoryLifecycle.clearRelations(row, getRows(chat, template.id, table));
                    if (!changed) return;
                    if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                } else if (action === 'edit-row-effect-policy' || action === 'toggle-row-effect-pause' || action === 'toggle-row-pin') {
                    const chat = getCurrentMemoryTableChat();
                    const template = db.memoryTableTemplates.find(item => item.id === actionEl.dataset.templateId);
                    const table = template?.tables?.find(item => item.id === actionEl.dataset.tableId);
                    const row = table ? findRowById(chat, template.id, table, actionEl.dataset.rowId) : null;
                    if (!chat || !template || !table || !row || !MemoryEffects) return;
                    MemoryEffects.ensureRowMeta(row, table, getRowSearchText(table, row));
                    if (action === 'edit-row-effect-policy') {
                        if (!MemoryEffects.editRowPolicy(row, table)) return;
                    } else if (action === 'toggle-row-effect-pause') {
                        row.meta.usePolicy.paused = !row.meta.usePolicy.paused;
                        row.meta.updatedAt = Date.now();
                    } else if (action === 'toggle-row-pin') {
                        row.meta.pinned = !row.meta.pinned;
                        row.meta.updatedAt = Date.now();
                    }
                    if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                } else if (action === 'select-memory-table') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    MemoryTableSession.selectTable(uiState, actionEl.dataset.tableId || null);
                    MemoryTableSession.setFilter(uiState, 'all');
                    MemoryTableSession.setTagFilter(uiState, '');
                    uiState.inspectorOpen = false;
                    uiState.selectedRowId = null;
                    uiState.inspectorAnalysis = null;
                    const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
                    if (runtime) runtime.activeTableId = uiState.activeTableId;
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                } else if (action === 'toggle-lock') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    toggleFieldLock(chat, actionEl.dataset.templateId, actionEl.dataset.tableId, actionEl.dataset.fieldId);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                } else if (action === 'open-schema-editor') {
                    const template = db.memoryTableTemplates.find(item => item.id === actionEl.dataset.templateId);
                    openSchemaEditor(template || null);
                } else if (action === 'delete-template') {
                    await deleteTemplate(actionEl.dataset.templateId);
                } else if (action === 'export-template') {
                    exportTemplate(actionEl.dataset.templateId);
                } else if (action === 'export-template-package') {
                    exportTemplatePackage(actionEl.dataset.templateId);
                } else if (action === 'restore-history') {
                    await restoreHistoryEntry(actionEl.dataset.historyId);
                }
            });

            screen.addEventListener('submit', async (event) => {
                const form = event.target.closest('[data-row-tag-form]');
                if (!form) return;
                event.preventDefault();
                await MemoryRowInspectorController.handleSubmit(form, {
                    chat: getCurrentMemoryTableChat(), state: uiState, save: saveCharacter,
                    render: renderMemoryTableScreen, toast: showToast,
                    showError: error => typeof showApiError === 'function' ? showApiError(error) : showToast(error.message || '操作失败')
                });
            });

            screen.addEventListener('input', event => {
                const target = event.target;
                if (target.matches('[data-governance-search]')) MemoryGovernanceQueue.setQuery(target.value || '');
            });

            screen.addEventListener('click', event => {
                const filter = event.target.closest('[data-memory-row-filter]');
                if (filter) MemoryTableInteraction.handleFilterClick(filter, { state: uiState, render: renderMemoryTableScreen, refreshGrid: refreshActiveMemoryTable });
                const sortClear = event.target.closest('[data-memory-sort-clear]');
                if (sortClear) MemoryTableInteraction.handleSortClear(sortClear, { state: uiState, render: renderMemoryTableScreen, refreshGrid: refreshActiveMemoryTable });
            });

            screen.addEventListener('change', async (event) => {
                const target = event.target;
                if (target.matches('[data-governance-search]')) {
                    MemoryGovernanceQueue.setQuery(target.value || '');
                    renderMemoryTableScreen();
                    return;
                }
                if (target.matches('[data-governance-select]')) {
                    MemoryGovernanceQueue.toggleSelection(target.dataset.governanceSelect || '', target.checked);
                    renderMemoryTableScreen();
                    return;
                }
                if (target.matches('[data-memory-audit-round]')) {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    MemoryRetrievalAudit.setSelectedRound(chat.id, target.value || '');
                    renderMemoryTableScreen();
                    return;
                }
                const activeDescriptor = MemoryTableWorkspace.resolveActive(getCurrentMemoryTableChat(), getBoundTemplates(getCurrentMemoryTableChat()), uiState).active;
                if (MemoryTableInteraction.handleSortChange(target, { state: uiState, table: activeDescriptor?.table, render: renderMemoryTableScreen, refreshGrid: refreshActiveMemoryTable })) return;
                if (MemoryTableInteraction.handleFilterChange(target, { state: uiState, render: renderMemoryTableScreen, refreshGrid: refreshActiveMemoryTable })) return;
                if (target.matches('[data-memory-automation-mode]') && MemoryPolicy) {
                    const chat = getCurrentMemoryTableChat();
                    const template = db.memoryTableTemplates.find(item => item.id === target.dataset.templateId);
                    const table = template?.tables?.find(item => item.id === target.dataset.tableId);
                    if (!chat || !template || !table) return;
                    MemoryPolicy.setAutomationMode(chat, template.id, table, target.value);
                    await saveCharacter(chat.id);
                    refreshMemoryTableAutoUpdateControls(chat, getBoundTemplates(chat).length > 0);
                    if (chat.memoryTables.autoUpdateEnabled && ['engine', 'table'].includes(target.value)) {
                        setTimeout(() => checkAndTriggerAutoTableUpdate(chat).catch(error => console.warn('[MemoryTable] schedule update failed:', error)), 0);
                    }
                    return;
                }
                if (target.dataset.qualitySetting && MemoryQuality) {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    const key = target.dataset.qualitySetting;
                    const value = target.tagName === 'SELECT' ? target.value === 'true' : Number(target.value);
                    MemoryQuality.updateSettings(chat, { [key]: value });
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    return;
                }
                if (target.dataset.qualityCaseField && MemoryQuality) {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    const field = target.dataset.qualityCaseField;
                    let value = target.value;
                    if (target.type === 'checkbox') value = target.checked;
                    else if (field === 'expectNoRows') value = target.value === 'true';
                    else if (field === 'minimumExpectedHits') value = Number(target.value) || 0;
                    MemoryQuality.updateTestCase(chat, target.dataset.caseId, { [field]: value });
                    await saveCharacter(chat.id);
                    return;
                }
                if (target.dataset.feedbackSetting && MemoryFeedback) {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    MemoryFeedback.updateSettings(chat, { [target.dataset.feedbackSetting]: Number(target.value) });
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    return;
                }
                if ((target.dataset.taskSetting || target.dataset.taskPrice) && MemoryTasks) {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    if (target.dataset.taskSetting) {
                        const key = target.dataset.taskSetting;
                        const value = target.tagName === 'SELECT' ? target.value === 'true' : Number(target.value);
                        MemoryTasks.updateSettings(chat, { [key]: value });
                    } else {
                        MemoryTasks.updateSettings(chat, { pricing: { [target.dataset.taskPrice]: Number(target.value) || 0 } });
                    }
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    return;
                }
                if (target.dataset.reviewEdit && MemoryReview) {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    MemoryReview.setProposalEditedValue(chat, target.dataset.batchId, target.dataset.proposalId, target.value);
                    await saveCharacter(chat.id);
                    return;
                }
                if (target.classList.contains('memory-template-bind-toggle')) {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    await bindTemplateToChat(chat, target.dataset.templateId, target.checked);
                }
                if (await MemoryTableEditController.handleTagInput(target, {
                    getChat: getCurrentMemoryTableChat,
                    templates: db.memoryTableTemplates,
                    save: saveCharacter,
                    gridRoot: () => document.querySelector('[data-memory-table-grid]')
                })) return;
                if (target.classList.contains('memory-table-input')) {
                    await handleFieldInputChange(target);
                }
            });
        }

        const openFromSettingsBtn = document.getElementById('setting-open-memory-table-btn');
        if (openFromSettingsBtn) {
            openFromSettingsBtn.addEventListener('click', () => {
                renderMemoryTableScreen();
                switchScreen('memory-table-screen');
            });
        }

        const schemaModal = document.getElementById('memory-schema-editor-modal');
        if (schemaModal) {
            schemaModal.addEventListener('click', async event => {
                if (event.target === schemaModal) {
                    closeSchemaEditor();
                    return;
                }
                const tab = event.target.closest('[data-schema-tab]');
                if (tab) {
                    uiState.schemaEditorTab = ['fields', 'tables', 'json'].includes(tab.dataset.schemaTab) ? tab.dataset.schemaTab : 'fields';
                    renderSchemaEditor();
                    return;
                }
                const actionEl = event.target.closest('[data-schema-action]');
                if (!actionEl) return;
                const action = actionEl.dataset.schemaAction;
                const tableIndex = actionEl.dataset.tableIndex !== undefined ? Number(actionEl.dataset.tableIndex) : undefined;
                const fieldIndex = actionEl.dataset.fieldIndex !== undefined ? Number(actionEl.dataset.fieldIndex) : undefined;
                if (action === 'cancel') {
                    closeSchemaEditor();
                    return;
                }
                if (action === 'save') {
                    await saveSchemaEditor();
                    return;
                }
                if (action === 'starter') {
                    uiState.editingTemplateId = null;
                    uiState.templateDraft = MemorySchemaEditor.prepare(null);
                    uiState.schemaEditorTab = 'fields';
                    uiState.schemaEditorTableIndex = 0;
                    renderSchemaEditor();
                    return;
                }
                if (action === 'select-table') {
                    uiState.schemaEditorTableIndex = Math.max(0, tableIndex || 0);
                    renderSchemaEditor();
                    return;
                }
                if (action === 'select-fields') {
                    uiState.schemaEditorTableIndex = Math.max(0, tableIndex || 0);
                    renderSchemaEditor();
                    requestAnimationFrame(() => schemaModal.querySelector('#memory-schema-fields-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                    return;
                }
                if (action === 'refresh-raw-json') {
                    const textarea = schemaModal.querySelector('#memory-schema-raw-json');
                    if (textarea) textarea.value = JSON.stringify(uiState.templateDraft, null, 2);
                    return;
                }
                if (action === 'apply-raw-json') {
                    const textarea = schemaModal.querySelector('#memory-schema-raw-json');
                    if (!textarea) return;
                    try {
                        uiState.templateDraft = MemorySchemaEditor.applyRawJson(textarea.value, uiState.editingTemplateId || undefined);
                        uiState.schemaEditorTableIndex = 0;
                        renderSchemaEditor();
                        showToast('原始 JSON 已同步到同一个表结构');
                    } catch (error) {
                        showToast(error.message || 'JSON 格式不合法');
                    }
                    return;
                }
                if (MemorySchemaEditor.mutate(uiState.templateDraft, action, tableIndex, fieldIndex)) {
                    if (action === 'add-table') uiState.schemaEditorTableIndex = Math.max(0, uiState.templateDraft.tables.length - 1);
                    else if (action === 'remove-table') uiState.schemaEditorTableIndex = Math.min(uiState.schemaEditorTableIndex, Math.max(0, uiState.templateDraft.tables.length - 1));
                    renderSchemaEditor();
                }
            });
            schemaModal.addEventListener('input', event => {
                if (!updateSchemaDraft(event.target)) return;
                if (event.target.dataset.schemaRole === 'field-key') {
                    MemorySchemaEditor.applyFieldNameWidth(schemaModal, uiState.templateDraft, { activeTableIndex: uiState.schemaEditorTableIndex });
                }
            });
            schemaModal.addEventListener('change', event => {
                if (!updateSchemaDraft(event.target)) return;
                if (['field-group', 'table-name', 'table-memory-layer'].includes(event.target.dataset.schemaRole)) renderSchemaEditor();
            });
        }

        const conversionModal = document.getElementById('memory-conversion-modal');
        if (conversionModal) {
            conversionModal.addEventListener('click', async event => {
                if (event.target === conversionModal) {
                    closeConversionModal();
                    return;
                }
                const actionEl = event.target.closest('[data-conversion-action]');
                if (!actionEl) return;
                const state = uiState.conversionState;
                const chat = getCurrentMemoryTableChat();
                if (!state || !chat) return;
                const journals = getJournalCandidates(chat);
                const templates = getBoundTemplates(chat);
                const action = actionEl.dataset.conversionAction;
                if (action === 'select-favorited') {
                    state.selectedJournalIds = journals.filter(item => item.isFavorited).map(item => item.id);
                } else if (action === 'select-all-journals') {
                    state.selectedJournalIds = journals.map(item => item.id);
                } else if (action === 'clear-journals') {
                    state.selectedJournalIds = [];
                } else if (action === 'select-all-templates') {
                    state.selectedTemplateIds = templates.map(item => item.id);
                } else if (action === 'clear-templates') {
                    state.selectedTemplateIds = [];
                } else if (action === 'cancel-conversion') {
                    closeConversionModal();
                    return;
                } else if (action === 'confirm-conversion') {
                    await executeConversionFromModal();
                    return;
                }
                renderConversionModal();
            });
            conversionModal.addEventListener('change', event => {
                const target = event.target;
                const state = uiState.conversionState;
                if (!state) return;
                const role = target.dataset.conversionRole;
                if (!role) return;
                const value = target.type === 'checkbox' ? target.checked : target.value;
                if (role === 'journal-toggle') {
                    const id = target.value;
                    if (value) {
                        if (!state.selectedJournalIds.includes(id)) state.selectedJournalIds.push(id);
                    } else {
                        state.selectedJournalIds = state.selectedJournalIds.filter(item => item !== id);
                    }
                } else if (role === 'template-toggle') {
                    const id = target.value;
                    if (value) {
                        if (!state.selectedTemplateIds.includes(id)) state.selectedTemplateIds.push(id);
                    } else {
                        state.selectedTemplateIds = state.selectedTemplateIds.filter(item => item !== id);
                    }
                } else if (role === 'strategy') {
                    state.strategy = value;
                } else if (role === 'journal-style') {
                    state.journalStyle = value;
                } else if (role === 'auto-favorite') {
                    state.autoFavorite = value;
                } else if (role === 'title-prefix') {
                    state.titlePrefix = value;
                }
                renderConversionModal();
            });
            conversionModal.addEventListener('input', event => {
                const target = event.target;
                const state = uiState.conversionState;
                if (!state) return;
                const role = target.dataset.conversionRole;
                if (role === 'title-prefix') {
                    state.titlePrefix = target.value;
                }
            });
        }
    }

    function exportMemoryTableContext(chat, options = {}) {
        if (!chat) return '';
        ensureMemoryTableState(chat);
        return getMemoryContextBlock(chat, { force: true, templateIds: options.templateIds });
    }

    function getBoundMemoryTableTemplateIds(chat) {
        if (!chat) return [];
        ensureMemoryTableState(chat);
        return getBoundTemplates(chat).map(item => item.id);
    }

    async function convertTextToMemoryTable(chat, text, options = {}) {
        if (!chat) throw new Error('请先进入一个角色聊天');
        ensureMemoryTableState(chat);
        const targetTemplateIds = Array.isArray(options.targetTemplateIds) && options.targetTemplateIds.length > 0
            ? options.targetTemplateIds
            : getBoundTemplates(chat).map(item => item.id);
        const templates = getBoundTemplates(chat).filter(item => targetTemplateIds.includes(item.id));
        if (templates.length === 0) {
            throw new Error('请先绑定至少一个结构记忆模板');
        }
        templates.forEach(template => ensureTemplateDataForChat(chat, template));
        const templateText = buildTemplateDefinitionForPrompt(chat, templates);
        const prompt = `请把下面这些“已确认长期记忆”的内容，抽取进结构化记忆表。只更新发生变化的字段，只能依据给定内容，不要编造。

输出格式必须严格是：
<memory_updates>
  <memory_update templateId="模板ID" tableId="表格ID">
    <field fieldId="字段ID">新值</field>
    <row op="add">
      <field fieldId="字段ID">值</field>
    </row>
    <row op="update" rowId="现有行ID">
      <field fieldId="字段ID">新值</field>
    </row>
    <row op="delete" rowId="现有行ID"></row>
  </memory_update>
</memory_updates>

如果没有变化，输出 <memory_updates></memory_updates>。
rows 表请使用 row 节点，不要把 rows 表伪装成普通 field。

角色信息：
- 角色名：${chat.realName || ''}
- 用户称呼：${chat.myName || ''}

模板定义：
${templateText}

长期记忆内容：
${text}`;
        const rawContent = await requestSummaryContent(prompt, 0.2);
        const changedFields = applyMemoryUpdatesFromXml(chat, rawContent, {
            source: options.source || 'api',
            targetTemplateIds
        });
        await saveCharacter(chat.id);
        renderMemoryTableScreen();
        return changedFields.length;
    }

    if (MemoryTasks) {
        MemoryTasks.registerExecutor('table_update', async (chat, payload) => {
            const template = getBoundTemplates(chat).find(item => item.id === payload.templateId)
                || db.memoryTableTemplates.find(item => item.id === payload.templateId);
            const table = template?.tables?.find(item => item.id === payload.tableId);
            if (!template || !table) throw new Error('任务目标表已不存在');
            return updateSingleTableFromPolicy(chat, template, table, {
                start: payload.range?.start,
                end: payload.range?.end,
                source: payload.source || 'task_queue_v2_6',
                isAutoUpdate: !!payload.isAutoUpdate,
                forceReview: !!payload.forceReview,
                operationId: payload.operationId || null
            });
        });
        MemoryTasks.registerExecutor('retrieval_rebuild', async chat => {
            if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
            const block = await prepareMemoryTableContext(chat, { preview: true });
            return { status: 'success', chars: String(block || '').length };
        });
        MemoryTasks.registerExecutor('lifecycle_maintenance', async chat => {
            if (!MemoryLifecycle) throw new Error('生命周期模块未加载');
            const report = MemoryLifecycle.runMaintenance(chat, getBoundTemplates(chat));
            if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
            return { status: 'success', report };
        });
    }


    let resumeQueuedMemoryTasksPromise = null;
    async function resumeQueuedMemoryTasks(options = {}) {
        if (!MemoryTasks) return { chats: 0, processed: 0 };
        if (resumeQueuedMemoryTasksPromise && !options.force) return resumeQueuedMemoryTasksPromise;
        resumeQueuedMemoryTasksPromise = (async () => {
            let chats = 0, processed = 0;
            for (const chat of (db.characters || [])) {
                ensureMemoryTableState(chat);
                const taskState = MemoryTasks.ensureState(chat);
                const hasRunnable = taskState.settings.autoResume && !taskState.settings.paused
                    && taskState.tasks.some(item => item.status === 'queued' && (!item.nextRetryAt || item.nextRetryAt <= Date.now()));
                if (!hasRunnable) continue;
                chats += 1;
                const result = await processMemoryTaskQueue(chat, { skipRender: true, maxTasks: taskState.settings.maxTasksPerCycle });
                processed += Number(result?.processed) || 0;
            }
            return { chats, processed };
        })();
        try { return await resumeQueuedMemoryTasksPromise; }
        finally { resumeQueuedMemoryTasksPromise = null; }
    }
    window.resumeQueuedMemoryTasks = resumeQueuedMemoryTasks;

    function openMemoryFeedbackTab() {
        selectMemoryWorkspace('manage', 'usage_audit');
        if (typeof switchScreen === 'function') switchScreen('memory-table-screen');
    }

    Kernel.register('controller', {
        VERSION: '2.9-R2',
        ensureState: ensureMemoryTableState,
        getCurrentChat: getCurrentMemoryTableChat,
        setupScreen: setupMemoryTableScreen,
        renderScreen: renderMemoryTableScreen,
        openFeedback: openMemoryFeedbackTab,
        openWorkspace(workspace, view) {
            return selectMemoryWorkspace(workspace, view);
        },
        getContext: getMemoryContextBlock,
        prepareContext: prepareMemoryTableContext,
        exportContext: exportMemoryTableContext,
        getBoundTemplateIds: getBoundMemoryTableTemplateIds,
        convertText: convertTextToMemoryTable,
        checkAutoUpdate: checkAndTriggerAutoTableUpdate,
        resumeQueues: resumeQueuedMemoryTasks
    });
})();
