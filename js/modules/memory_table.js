// --- 结构化记忆 / 表格记忆 (js/modules/memory_table.js) ---
(function () {
    'use strict';

    const Kernel = window.OvoMemoryKernel || null;
    const Core = Kernel?.core;
    if (!Core) throw new Error('记忆内核未加载');
    const MEMORY_TABLE_MAX_CONTEXT_MESSAGES = 60;
    const MemoryPolicy = Kernel.get('policy');
    const MemoryReview = Kernel.get('review');
    const MemoryRetrieval = Kernel.get('retrieval');
    const MemoryEffects = Kernel.get('effects');
    const MemoryLifecycle = Kernel.get('lifecycle');
    const MemoryTasks = Kernel.get('tasks');
    const MemoryFeedback = Kernel.get('feedback');
    const MemoryQuality = Kernel.get('quality');
    const MemorySidecar = Kernel.get('sidecar');
    const MemorySchedule = Kernel.require('schedule');
    const MemoryApi = Kernel.require('api');
    const MemoryDomain = Kernel.require('domain');
    const MemoryWorkspace = Kernel.require('workspace');
    const {
        ensureMemoryTemplateStore, ensureMemoryTableState: ensureMemoryTableStateBase, getCurrentMemoryTableChat: getCurrentMemoryTableChatBase, createStarterTemplate,
        createEmptyFieldDraft, createEmptyTableDraft, normalizeTemplate, normalizeFieldType, parseOptionText,
        parseConditionalRulesText, serializeConditionalRules, getDefaultValueByType, getFieldDefaultValue,
        getBoundTemplates, isRowsTable, createEmptyRow, normalizeRowShape, ensureTemplateDataForChat, getRows,
        findRowById, normalizeFieldValue, clampFieldValue, getFieldValue, pushMemoryHistory, setFieldValue,
        isSameMemoryValue, buildFieldPath, addRow, updateRowFieldValue, deleteRow, moveRow, isFieldLocked,
        toggleFieldLock, getFieldDisplayValue, evaluateConditionalColor, isEmptyMemoryValue, getRowSearchText
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
        workspace: 'memory',
        tab: 'tables',
        search: '',
        sort: 'default',
        editingTemplateId: null,
        templateDraft: null,
        conversionState: null,
        designerCollapsedFieldIds: {},
        designerDrag: null,
        viewMode: 'normal',
        activeTableId: null,
        rangePreview: null
    };

    function ensureMemoryTableState(chat) {
        ensureMemoryTableStateBase(chat);
        if (chat && MemoryPolicy) {
            const runtime = MemoryPolicy.ensureRuntimeState(chat);
            uiState.viewMode = runtime.viewMode || 'normal';
            uiState.activeTableId = runtime.activeTableId || null;
            const normalizedWorkspace = MemoryWorkspace.normalizeState(runtime.workspace || uiState.workspace, runtime.workspaceView || uiState.tab);
            uiState.workspace = normalizedWorkspace.workspace;
            uiState.tab = normalizedWorkspace.view;
        }
    }

    function getCurrentMemoryTableChat() {
        const chat = getCurrentMemoryTableChatBase();
        if (chat) ensureMemoryTableState(chat);
        return chat;
    }

    function getVisibleFieldItems(chat) {
        const keyword = uiState.search.trim().toLowerCase();
        const templates = getBoundTemplates(chat);
        const items = [];

        templates.forEach(template => {
            ensureTemplateDataForChat(chat, template);
            template.tables.forEach(table => {
                table.columns.forEach(field => {
                    const value = getFieldValue(chat, template.id, table.id, field);
                    const item = {
                        template,
                        table,
                        field,
                        value,
                        locked: isFieldLocked(chat, template.id, table.id, field.id),
                        changed: (chat.memoryTables.lastChangedFieldPaths || []).includes(buildFieldPath(template.id, table.id, field.id))
                    };
                    const haystack = [
                        template.name,
                        template.description,
                        table.name,
                        field.key,
                        getFieldDisplayValue(field, value)
                    ].join(' ').toLowerCase();
                    if (!keyword || haystack.includes(keyword)) {
                        items.push(item);
                    }
                });
            });
        });

        if (uiState.sort === 'name') {
            items.sort((a, b) => a.field.key.localeCompare(b.field.key, 'zh-CN'));
        } else if (uiState.sort === 'changed') {
            items.sort((a, b) => Number(b.changed) - Number(a.changed) || a.field.key.localeCompare(b.field.key, 'zh-CN'));
        } else if (uiState.sort === 'locked') {
            items.sort((a, b) => Number(b.locked) - Number(a.locked) || a.field.key.localeCompare(b.field.key, 'zh-CN'));
        }

        return items;
    }

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
            summary.textContent = '请先进入一个私聊角色。';
            modePill.textContent = '未选择角色';
            content.innerHTML = '';
            empty.style.display = 'block';
            if (updateBtn) updateBtn.disabled = true;
            if (fromJournalBtn) fromJournalBtn.disabled = true;
            if (toJournalBtn) toJournalBtn.disabled = true;
            refreshMemoryTableAutoUpdateControls(null, false);
            return;
        }

        ensureMemoryTableState(chat);
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
        if (uiState.viewMode === 'json' && MemoryPolicy && !MemoryPolicy.isDesktopJsonAvailable()) {
            uiState.viewMode = 'normal';
            if (runtime) runtime.viewMode = 'normal';
        }
        screen.classList.toggle('memory-json-mode', uiState.viewMode === 'json');
        const normalModeBtn = document.getElementById('memory-table-normal-mode-btn');
        const jsonModeBtn = document.getElementById('memory-table-json-mode-btn');
        if (normalModeBtn) normalModeBtn.classList.toggle('active', uiState.viewMode === 'normal');
        if (jsonModeBtn) {
            jsonModeBtn.classList.toggle('active', uiState.viewMode === 'json');
            jsonModeBtn.disabled = !!(MemoryPolicy && !MemoryPolicy.isDesktopJsonAvailable());
        }
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
        if (settingsPanel) settingsPanel.hidden = uiState.workspace !== 'memory';
        if (updateBtn) updateBtn.hidden = uiState.workspace !== 'memory';
        if (createTemplateBtn) createTemplateBtn.hidden = uiState.workspace !== 'manage';
        const modeLabel = chat.memoryMode === 'table'
            ? '结构化档案模式'
            : (chat.memoryMode === 'vector' ? '向量记忆模式' : '日记模式');
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
        const feedbackCountEl = document.getElementById('memory-feedback-tab-count');
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
            if (view === 'retrieval') return MemoryRetrieval ? MemoryRetrieval.renderDiagnostics(chat) : '<div class="memory-retrieval-empty"><p>检索诊断模块未加载。</p></div>';
            if (view === 'sidecar') return MemorySidecar ? MemorySidecar.renderCandidatesView(chat) : '<div class="memory-review-empty"><p>短期候选模块未加载。</p></div>';
            if (view === 'reliability') return MemoryLifecycle ? MemoryLifecycle.renderReliabilityView(chat, boundTemplates) : '<div class="memory-review-empty"><p>可靠性模块未加载。</p></div>';
            if (view === 'feedback') return MemoryFeedback ? MemoryFeedback.renderView(chat) : '<div class="memory-review-empty"><p>使用反馈模块未加载。</p></div>';
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
            } else {
                drawAllCharts(chat);
            }
        } else {
            const title = MemoryWorkspace.viewTitle(uiState.tab);
            const body = renderTechnicalView(uiState.tab);
            content.innerHTML = `${MemoryWorkspace.renderDetailHeader(uiState.workspace, title)}${body}`;
        }
        try { window.dispatchEvent(new CustomEvent('memory-table-screen-opened')); } catch (_) {}
    }

    function renderTemplateLibrary(chat) {
        ensureMemoryTemplateStore();
        const templates = db.memoryTableTemplates;
        if (templates.length === 0) return '';

        return templates.map(template => {
            const bound = chat.memoryTables.boundTemplateIds.includes(template.id);
            const tableCount = Array.isArray(template.tables) ? template.tables.length : 0;
            const fieldCount = (template.tables || []).reduce((sum, table) => sum + ((table.columns || []).length), 0);
            return `
                <div class="memory-template-card" style="background:#fff; border-radius:16px; padding:14px; margin-bottom:12px; box-shadow:0 6px 20px rgba(0,0,0,0.04); border:1px solid #f1f1f1;">
                    <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
                        <div style="flex:1;">
                            <div style="font-size:15px; font-weight:700; color:#333;">${escapeHtml(template.name)}</div>
                            <div style="font-size:12px; color:#888; margin-top:4px;">${escapeHtml(template.description || '无描述')}</div>
                            <div style="font-size:12px; color:#999; margin-top:8px;">${tableCount} 张表 · ${fieldCount} 个字段</div>
                        </div>
                        <label class="kkt-switch">
                            <input type="checkbox" class="memory-template-bind-toggle" data-template-id="${template.id}" ${bound ? 'checked' : ''}>
                            <span class="kkt-slider"></span>
                        </label>
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
                        <button class="btn btn-small btn-primary" data-action="edit-template-visual" data-template-id="${template.id}">可视化编辑</button>
                        <button class="btn btn-small btn-secondary" data-action="edit-template-json" data-template-id="${template.id}">JSON</button>
                        <button class="btn btn-small btn-secondary" data-action="export-template" data-template-id="${template.id}">导出</button>
                        <button class="btn btn-small btn-secondary" data-action="export-template-package" data-template-id="${template.id}">导出记忆包</button>
                        <button class="btn btn-small btn-danger" data-action="delete-template" data-template-id="${template.id}">删除</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    function openTemplateDesigner(template) {
        const modal = document.getElementById('memory-template-designer-modal');
        if (!modal) return;
        const working = template ? deepClone(template) : createStarterTemplate();
        working.tables = Array.isArray(working.tables) && working.tables.length > 0 ? working.tables : [createEmptyTableDraft()];
        working.tables.forEach(table => {
            table.columns = Array.isArray(table.columns) && table.columns.length > 0 ? table.columns : [createEmptyFieldDraft()];
        });
        uiState.editingTemplateId = template ? template.id : null;
        uiState.templateDraft = working;
        uiState.designerCollapsedFieldIds = {};
        uiState.designerDrag = null;
        renderTemplateDesigner();
        modal.classList.add('visible');
    }

    function closeTemplateDesigner() {
        const modal = document.getElementById('memory-template-designer-modal');
        if (modal) modal.classList.remove('visible');
        uiState.templateDraft = null;
        uiState.designerDrag = null;
    }

    function renderTemplateDesigner() {
        const draft = uiState.templateDraft;
        const container = document.getElementById('memory-template-designer-body');
        const titleEl = document.getElementById('memory-template-designer-title');
        if (!draft || !container || !titleEl) return;

        titleEl.textContent = uiState.editingTemplateId ? '编辑模板' : '新建模板';
        container.innerHTML = `
            <div class="form-group">
                <label>模板名称</label>
                <input type="text" data-designer-role="template-name" value="${escapeAttribute(draft.name || '')}" placeholder="例如：恋爱进展模板">
            </div>
            <div class="form-group">
                <label>模板描述</label>
                <textarea rows="3" data-designer-role="template-description" placeholder="说明这个模板适合什么场景">${escapeHtml(draft.description || '')}</textarea>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin:18px 0 10px;">
                <div style="font-size:15px; font-weight:700; color:#333;">表格列表</div>
                <button type="button" class="btn btn-small btn-primary" data-action="designer-add-table">新增表格</button>
            </div>
            ${(draft.tables || []).map((table, tableIndex) => renderDesignerTableCard(table, tableIndex)).join('')}
        `;
    }

    function renderDesignerTableCard(table, tableIndex) {
        const groups = getFieldGroups(table.columns || []);
        const policy = MemoryPolicy
            ? MemoryPolicy.normalizeTablePolicy(table)
            : { memoryLayer: table.memoryLayer || 'short', updatePolicy: table.updatePolicy || {}, injectionPolicy: table.injectionPolicy || {} };
        const update = policy.updatePolicy;
        const inject = policy.injectionPolicy;
        return `
            <div draggable="true" data-designer-draggable="table" data-table-index="${tableIndex}" style="background:#fff; border:1px solid #ececec; border-radius:16px; padding:14px; margin-bottom:14px;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
                    <div style="display:flex; align-items:center; gap:8px; font-size:14px; font-weight:700; color:#333;">
                        <span style="cursor:grab; color:#999;">拖拽</span>
                        <span>表格 ${tableIndex + 1}</span>
                        <span style="font-size:11px;color:#667085;background:#f2f4f7;border-radius:999px;padding:2px 8px;">${escapeHtml(policy.memoryLayer)}</span>
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <button type="button" class="btn btn-small btn-neutral" data-action="designer-move-table-up" data-table-index="${tableIndex}">上移</button>
                        <button type="button" class="btn btn-small btn-neutral" data-action="designer-move-table-down" data-table-index="${tableIndex}">下移</button>
                        <button type="button" class="btn btn-small btn-danger" data-action="designer-remove-table" data-table-index="${tableIndex}">删除表格</button>
                    </div>
                </div>
                <div class="form-group">
                    <label>表格名称</label>
                    <input type="text" data-designer-role="table-name" data-table-index="${tableIndex}" value="${escapeAttribute(table.name || '')}">
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
                    <div class="form-group">
                        <label>表格模式</label>
                        <select data-designer-role="table-mode" data-table-index="${tableIndex}">
                            <option value="keyValue" ${table.mode !== 'rows' ? 'selected' : ''}>键值表</option>
                            <option value="rows" ${table.mode === 'rows' ? 'selected' : ''}>列表行</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>记忆层级</label>
                        <select data-designer-role="table-memory-layer" data-table-index="${tableIndex}">
                            ${[['core','核心'],['short','短期'],['medium','中期'],['long','长期'],['review','审核队列']].map(([value,label]) => `<option value="${value}" ${policy.memoryLayer === value ? 'selected' : ''}>${label}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>自动更新</label>
                        <select data-designer-role="table-update-enabled" data-table-index="${tableIndex}">
                            <option value="true" ${update.enabled ? 'selected' : ''}>开启</option>
                            <option value="false" ${!update.enabled ? 'selected' : ''}>关闭/手动</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>触发方式</label>
                        <select data-designer-role="table-trigger-mode" data-table-index="${tableIndex}">
                            ${[['rounds','按轮'],['messages','按消息'],['either','先到者'],['manual','仅手动']].map(([value,label]) => `<option value="${value}" ${update.triggerMode === value ? 'selected' : ''}>${label}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>每几轮</label>
                        <input type="number" min="0" data-designer-role="table-round-interval" data-table-index="${tableIndex}" value="${escapeAttribute(update.roundInterval ?? 0)}">
                    </div>
                    <div class="form-group">
                        <label>每几条消息</label>
                        <input type="number" min="0" data-designer-role="table-message-interval" data-table-index="${tableIndex}" value="${escapeAttribute(update.messageInterval ?? 0)}">
                    </div>
                    <div class="form-group">
                        <label>单次最多读取</label>
                        <input type="number" min="10" max="1000" data-designer-role="table-max-source-messages" data-table-index="${tableIndex}" value="${escapeAttribute(update.maxSourceMessages ?? 180)}">
                    </div>
                    <div class="form-group">
                        <label>允许删除行</label>
                        <select data-designer-role="table-allow-delete" data-table-index="${tableIndex}">
                            <option value="false" ${update.allowDelete !== true ? 'selected' : ''}>否</option>
                            <option value="true" ${update.allowDelete === true ? 'selected' : ''}>是</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>更新使用 API</label>
                        <select data-designer-role="table-use-summary-api" data-table-index="${tableIndex}">
                            <option value="false" ${update.useSummaryApi === false ? 'selected' : ''}>主聊天 API</option>
                            <option value="true" ${update.useSummaryApi !== false ? 'selected' : ''}>总结 API</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>聊天注入</label>
                        <select data-designer-role="table-injection-mode" data-table-index="${tableIndex}">
                            ${[['always','始终'],['active','有效项'],['relevant','相关检索'],['never','不注入']].map(([value,label]) => `<option value="${value}" ${inject.mode === value ? 'selected' : ''}>${label}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>相关条目 Top-K</label>
                        <input type="number" min="0" max="50" data-designer-role="table-injection-top-k" data-table-index="${tableIndex}" value="${escapeAttribute(inject.topK ?? 0)}">
                    </div>
                    <div class="form-group">
                        <label>注入字符预算</label>
                        <input type="number" min="0" max="20000" data-designer-role="table-injection-budget" data-table-index="${tableIndex}" value="${escapeAttribute(inject.budget ?? 0)}">
                    </div>
                    <div class="form-group">
                        <label>有效期（天，0=不限）</label>
                        <input type="number" min="0" data-designer-role="table-max-age-days" data-table-index="${tableIndex}" value="${escapeAttribute(inject.maxAgeDays ?? 0)}">
                    </div>
                </div>
                <div class="form-group">
                    <label>提取规则</label>
                    <textarea rows="3" data-designer-role="table-extract-prompt" data-table-index="${tableIndex}" placeholder="给总结 API 的表级提取要求">${escapeHtml(table.extractPrompt || '')}</textarea>
                </div>
                <div class="form-group">
                    <label>更新附加规则</label>
                    <textarea rows="2" data-designer-role="table-update-instructions" data-table-index="${tableIndex}" placeholder="例如：只从明确陈述更新；不得从一次情绪推断长期人格。">${escapeHtml(update.instructions || '')}</textarea>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; margin:14px 0 8px;">
                    <div style="font-size:13px; font-weight:700; color:#555;">字段</div>
                    <button type="button" class="btn btn-small btn-secondary" data-action="designer-add-field" data-table-index="${tableIndex}">新增字段</button>
                </div>
                ${groups.map(group => `
                    <div style="margin-top:10px; padding:10px 12px; border-radius:12px; background:${group.ungrouped ? 'rgba(0,0,0,0.025)' : 'rgba(91,140,255,0.06)'};">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
                            <div style="font-size:12px; font-weight:700; color:#666;">${escapeHtml(group.ungrouped ? '未分组字段' : group.name)}</div>
                            <div style="font-size:11px; color:#999;">${group.fields.length} 个字段</div>
                        </div>
                        ${group.fields.map(({ field, index }) => renderDesignerFieldCard(field, tableIndex, index)).join('')}
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderDesignerFieldCard(field, tableIndex, fieldIndex) {
        const isCollapsed = !!uiState.designerCollapsedFieldIds[field.id];
        const summaryTags = [
            field.type || 'text',
            field.group ? `分组:${field.group}` : '',
            field.aiEditable === false ? 'AI只读' : 'AI可编辑',
            field.important === false ? '仅JSON' : '普通模式显示'
        ].filter(Boolean).join(' · ');
        return `
            <div draggable="true" data-designer-draggable="field" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" style="border:1px dashed #e6e6e6; border-radius:14px; padding:12px; margin-top:10px; background:#fcfcfc;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; ${isCollapsed ? '' : 'margin-bottom:10px;'}">
                    <div style="flex:1;">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <span style="cursor:grab; color:#999; font-size:12px;">拖拽</span>
                            <div style="font-size:13px; font-weight:700; color:#444;">${escapeHtml(field.key || `字段 ${fieldIndex + 1}`)}</div>
                            <span style="font-size:11px; color:#8a8a8a; background:rgba(0,0,0,0.05); padding:2px 8px; border-radius:999px;">${escapeHtml(field.type || 'text')}</span>
                        </div>
                        <div style="font-size:12px; color:#888; margin-top:4px;">${escapeHtml(summaryTags)}</div>
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
                        <button type="button" class="btn btn-small btn-neutral" data-action="designer-toggle-field-collapse" data-field-id="${field.id}">${isCollapsed ? '展开' : '折叠'}</button>
                        <button type="button" class="btn btn-small btn-neutral" data-action="designer-move-field-up" data-table-index="${tableIndex}" data-field-index="${fieldIndex}">上移</button>
                        <button type="button" class="btn btn-small btn-neutral" data-action="designer-move-field-down" data-table-index="${tableIndex}" data-field-index="${fieldIndex}">下移</button>
                        <button type="button" class="btn btn-small btn-danger" data-action="designer-remove-field" data-table-index="${tableIndex}" data-field-index="${fieldIndex}">删除字段</button>
                    </div>
                </div>
                <div style="display:${isCollapsed ? 'none' : 'block'};">
                <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px;">
                    <div class="form-group">
                        <label>字段名</label>
                        <input type="text" data-designer-role="field-key" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" value="${escapeAttribute(field.key || '')}">
                    </div>
                    <div class="form-group">
                        <label>字段分组</label>
                        <input type="text" data-designer-role="field-group" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" value="${escapeAttribute(field.group || '')}" placeholder="例如：关系 / 事件 / 备注">
                    </div>
                    <div class="form-group">
                        <label>类型</label>
                        <select data-designer-role="field-type" data-table-index="${tableIndex}" data-field-index="${fieldIndex}">
                            ${['text', 'longtext', 'number', 'enum', 'tags', 'progress', 'date', 'boolean'].map(type => `<option value="${type}" ${field.type === type ? 'selected' : ''}>${type}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label>默认值</label>
                        <input type="text" data-designer-role="field-default" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" value="${escapeAttribute(Array.isArray(field.default) ? field.default.join(', ') : String(field.default ?? ''))}">
                    </div>
                    <div class="form-group">
                        <label>AI 可编辑</label>
                        <select data-designer-role="field-ai-editable" data-table-index="${tableIndex}" data-field-index="${fieldIndex}">
                            <option value="true" ${field.aiEditable !== false ? 'selected' : ''}>是</option>
                            <option value="false" ${field.aiEditable === false ? 'selected' : ''}>否</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>普通模式重要字段</label>
                        <select data-designer-role="field-important" data-table-index="${tableIndex}" data-field-index="${fieldIndex}">
                            <option value="true" ${field.important !== false ? 'selected' : ''}>显示</option>
                            <option value="false" ${field.important === false ? 'selected' : ''}>仅 JSON 模式</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>摘要标签</label>
                        <input type="text" data-designer-role="field-summary-label" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" value="${escapeAttribute(field.summaryLabel || '')}" placeholder="可选的简短显示名">
                    </div>
                    <div class="form-group">
                        <label>最小值</label>
                        <input type="number" data-designer-role="field-min" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" value="${escapeAttribute(field.min ?? '')}">
                    </div>
                    <div class="form-group">
                        <label>最大值</label>
                        <input type="number" data-designer-role="field-max" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" value="${escapeAttribute(field.max ?? '')}">
                    </div>
                </div>
                <div class="form-group">
                    <label>选项（enum/tags 用，一行一个或逗号分隔）</label>
                    <textarea rows="2" data-designer-role="field-options" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" placeholder="陌生&#10;朋友&#10;暧昧">${escapeHtml((field.options || []).join('\n'))}</textarea>
                </div>
                <div class="form-group">
                    <label>AI 提示</label>
                    <textarea rows="2" data-designer-role="field-ai-hint" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" placeholder="告诉 AI 这个字段该怎么更新">${escapeHtml(field.aiHint || '')}</textarea>
                </div>
                <div class="form-group">
                    <label>条件高亮规则（每行 运算符|值|颜色，例如 <=|20|#ffe7e7）</label>
                    <textarea rows="2" data-designer-role="field-conditional-rules" data-table-index="${tableIndex}" data-field-index="${fieldIndex}" placeholder=">=|80|#e8fff1">${escapeHtml(serializeConditionalRules(field.conditionalRules || []))}</textarea>
                </div>
                </div>
            </div>
        `;
    }

    function renderHistoryView(chat) {
        const history = chat.memoryTables.history || [];
        if (history.length === 0) return '';
        return history.map(entry => {
            const sourceLabel = entry.source === 'api'
                ? 'API 更新'
                : entry.source === 'auto' || entry.source === 'auto_latest'
                    ? '自动更新'
                    : '手动编辑';
            const changedText = (entry.changedFields || []).map(item => `${escapeHtml(item.label)}：${escapeHtml(getShortValue(item.oldValue))} → ${escapeHtml(getShortValue(item.newValue))}`).join('<br>');
            return `
                <div style="background:#fff; border-radius:16px; padding:14px; margin-bottom:12px; box-shadow:0 6px 20px rgba(0,0,0,0.04); border:1px solid #f1f1f1;">
                    <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
                        <div>
                            <div style="font-weight:700; color:#333;">${formatDateTime(entry.timestamp)}</div>
                            <div style="font-size:12px; color:#999; margin-top:4px;">来源：${sourceLabel} · ${entry.changedFields ? entry.changedFields.length : 0} 项变化</div>
                        </div>
                        <button class="btn btn-small btn-primary" data-action="restore-history" data-history-id="${entry.id}">恢复</button>
                    </div>
                    <div style="font-size:13px; color:#555; line-height:1.65; margin-top:10px;">${changedText || '无变化详情'}</div>
                </div>
            `;
        }).join('');
    }

    function matchesMemorySearch(parts) {
        const keyword = uiState.search.trim().toLowerCase();
        if (!keyword) return true;
        return parts.join(' ').toLowerCase().includes(keyword);
    }

    function getDisplayFieldItems(chat, template, table) {
        const items = (table.columns || []).map(field => {
            const value = getFieldValue(chat, template.id, table.id, field);
            return {
                template,
                table,
                field,
                value,
                locked: isFieldLocked(chat, template.id, table.id, field.id),
                changed: (chat.memoryTables.lastChangedFieldPaths || []).includes(buildFieldPath(template.id, table.id, field.id))
            };
        }).filter(item => matchesMemorySearch([
            template.name,
            template.description || '',
            table.name,
            item.field.group || '',
            item.field.key,
            getFieldDisplayValue(item.field, item.value)
        ]));

        if (uiState.sort === 'name') {
            items.sort((a, b) => a.field.key.localeCompare(b.field.key, 'zh-CN'));
        } else if (uiState.sort === 'changed') {
            items.sort((a, b) => Number(b.changed) - Number(a.changed) || a.field.key.localeCompare(b.field.key, 'zh-CN'));
        } else if (uiState.sort === 'locked') {
            items.sort((a, b) => Number(b.locked) - Number(a.locked) || a.field.key.localeCompare(b.field.key, 'zh-CN'));
        }

        return items;
    }

    function renderKeyValueFieldCard(item) {
        const color = evaluateConditionalColor(item.field, item.value);
        return `
            <div class="memory-field-card" style="
                background:#fff;
                border-radius:16px;
                padding:14px;
                margin-bottom:12px;
                box-shadow:0 6px 20px rgba(0,0,0,0.04);
                border:1px solid ${item.changed ? '#c6d6ff' : '#f1f1f1'};
                ${color ? `background:${color};` : ''}
            ">
                <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
                    <div style="flex:1;">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <span style="font-size:15px; font-weight:700; color:#333;">${escapeHtml(item.field.key)}</span>
                            <span style="font-size:11px; color:#8a8a8a; background:rgba(0,0,0,0.05); padding:2px 8px; border-radius:999px;">${escapeHtml(item.field.type)}</span>
                            ${item.field.group ? `<span style="font-size:11px; color:#5a6ab8; background:rgba(91,140,255,0.08); padding:2px 8px; border-radius:999px;">${escapeHtml(item.field.group)}</span>` : ''}
                            ${item.changed ? '<span style="font-size:11px; color:#335eea; background:rgba(51,94,234,0.08); padding:2px 8px; border-radius:999px;">刚更新</span>' : ''}
                            ${item.locked ? '<span style="font-size:11px; color:#b25b00; background:rgba(255,159,67,0.12); padding:2px 8px; border-radius:999px;">已锁定</span>' : ''}
                        </div>
                        ${item.field.aiHint ? `<div style="font-size:12px; color:#888; margin-top:6px;">${escapeHtml(item.field.aiHint)}</div>` : ''}
                    </div>
                    <button class="btn btn-small ${item.locked ? 'btn-secondary' : 'btn-neutral'}" data-action="toggle-lock" data-template-id="${item.template.id}" data-table-id="${item.table.id}" data-field-id="${item.field.id}">${item.locked ? '解锁' : '锁定'}</button>
                </div>
                <div style="margin-top:12px;">
                    ${renderFieldEditor(item.template.id, item.table.id, item.field, item.value, item.locked)}
                </div>
                ${renderFieldChartContainer(item.template.id, item.table.id, item.field)}
            </div>
        `;
    }

    function renderRowsTableCard(chat, template, table) {
        const rows = getRows(chat, template.id, table);
        const visibleRows = rows.filter(row => matchesMemorySearch([
            template.name,
            template.description || '',
            table.name,
            ...(table.columns || []).map(field => `${field.key} ${getFieldDisplayValue(field, row.cells[field.id])}`)
        ]));
        if (uiState.search.trim() && visibleRows.length === 0) {
            return '';
        }

        return `
            <div style="background:#fff; border-radius:18px; padding:14px; margin-bottom:16px; box-shadow:0 6px 20px rgba(0,0,0,0.04); border:1px solid #f1f1f1;">
                <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:10px;">
                    <div>
                        <div style="font-size:15px; font-weight:700; color:#333;">${escapeHtml(template.name)} / ${escapeHtml(table.name)}</div>
                        <div style="font-size:12px; color:#888; margin-top:4px;">多行表 · ${visibleRows.length}/${rows.length} 行</div>
                        ${table.extractPrompt ? `<div style="font-size:12px; color:#999; margin-top:4px;">${escapeHtml(table.extractPrompt)}</div>` : ''}
                    </div>
                    <button type="button" class="btn btn-small btn-primary" data-action="add-row" data-template-id="${template.id}" data-table-id="${table.id}">新增行</button>
                </div>
                ${rows.length === 0 ? `
                    <div style="padding:14px; border:1px dashed #e6e6e6; border-radius:14px; color:#999; font-size:13px;">还没有任何行，点击“新增行”开始录入。</div>
                ` : visibleRows.map((row, rowIndex) => `
                    <div style="border:1px solid #ececec; border-radius:14px; padding:12px; margin-top:10px; background:#fcfcfc;">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
                            <div style="font-size:13px; font-weight:700; color:#444;">第 ${rowIndex + 1} 行</div>
                            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                <button type="button" class="btn btn-small btn-neutral" data-action="move-row-up" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">上移</button>
                                <button type="button" class="btn btn-small btn-neutral" data-action="move-row-down" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">下移</button>
                                <button type="button" class="btn btn-small btn-danger" data-action="delete-row" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">删除</button>
                            </div>
                        </div>
                        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px;">
                            ${(table.columns || []).map(field => {
                                const locked = isFieldLocked(chat, template.id, table.id, field.id);
                                const changed = (chat.memoryTables.lastChangedFieldPaths || []).includes(buildFieldPath(template.id, table.id, field.id, row.id));
                                return `
                                    <div style="border:1px solid ${changed ? '#c6d6ff' : '#ececec'}; border-radius:12px; padding:10px; background:#fff;">
                                        <div style="display:flex; justify-content:space-between; gap:8px; align-items:flex-start; margin-bottom:8px;">
                                            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                                                <span style="font-size:13px; font-weight:700; color:#444;">${escapeHtml(field.key)}</span>
                                                <span style="font-size:11px; color:#8a8a8a; background:rgba(0,0,0,0.05); padding:2px 8px; border-radius:999px;">${escapeHtml(field.type)}</span>
                                                ${changed ? '<span style="font-size:11px; color:#335eea;">刚更新</span>' : ''}
                                                ${locked ? '<span style="font-size:11px; color:#b25b00;">已锁定</span>' : ''}
                                            </div>
                                            <button class="btn btn-small ${locked ? 'btn-secondary' : 'btn-neutral'}" data-action="toggle-lock" data-template-id="${template.id}" data-table-id="${table.id}" data-field-id="${field.id}">${locked ? '解锁' : '锁定'}</button>
                                        </div>
                                        ${renderFieldEditor(template.id, table.id, field, row.cells[field.id], locked, row.id)}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function getActiveTableDescriptor(chat) {
        const descriptors = [];
        getBoundTemplates(chat).forEach(template => {
            ensureTemplateDataForChat(chat, template);
            (template.tables || []).forEach(table => descriptors.push({ template, table }));
        });
        if (!descriptors.length) return { descriptors, active: null };
        const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
        const requestedId = uiState.activeTableId || runtime?.activeTableId;
        const active = descriptors.find(item => item.table.id === requestedId) || descriptors[0];
        uiState.activeTableId = active.table.id;
        if (runtime) runtime.activeTableId = active.table.id;
        return { descriptors, active };
    }

    function getVisibleColumnsForMode(table) {
        const jsonMode = uiState.viewMode === 'json' && (!MemoryPolicy || MemoryPolicy.isDesktopJsonAvailable());
        return (table.columns || []).filter(field => jsonMode || field.important !== false);
    }

    function renderV2PolicySummary(table) {
        const policy = getTableRuntimePolicy(table);
        const update = policy.updatePolicy;
        const inject = policy.injectionPolicy;
        return `
            <div class="memory-v2-policy-summary memory-v2-json-only">
                <span>layer: ${escapeHtml(policy.memoryLayer)}</span>
                <span>update: ${escapeHtml(update.enabled ? update.triggerMode : 'manual/off')}</span>
                <span>rounds: ${escapeHtml(String(update.roundInterval || 0))}</span>
                <span>messages: ${escapeHtml(String(update.messageInterval || 0))}</span>
                <span>api: ${escapeHtml(update.useSummaryApi === false ? 'main' : 'summary')}</span>
                <span>inject: ${escapeHtml(inject.mode)}</span>
                <span>topK: ${escapeHtml(String(inject.topK || 0))}</span>
                <span>budget: ${escapeHtml(String(inject.budget || 0))}</span>
            </div>
        `;
    }

    function renderV2KeyValueSheet(chat, template, table) {
        const columns = getVisibleColumnsForMode(table).filter(field => matchesMemorySearch([
            template.name,
            table.name,
            field.key,
            field.group || '',
            field.aiHint || '',
            getFieldDisplayValue(field, getFieldValue(chat, template.id, table.id, field))
        ]));
        const rowsHtml = columns.map(field => {
            const value = getFieldValue(chat, template.id, table.id, field);
            const locked = isFieldLocked(chat, template.id, table.id, field.id);
            return `
                <tr data-memory-important="${field.important !== false}">
                    <th>
                        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
                            <span>${escapeHtml(field.key)}</span>
                            <button class="btn btn-small ${locked ? 'btn-secondary' : 'btn-neutral'} memory-v2-json-only" data-action="toggle-lock" data-template-id="${template.id}" data-table-id="${table.id}" data-field-id="${field.id}">${locked ? '解锁' : '锁定'}</button>
                        </div>
                        ${field.group ? `<div style="font-size:10px;color:#98a2b3;margin-top:3px;">${escapeHtml(field.group)}</div>` : ''}
                        <div class="memory-v2-json-meta memory-v2-json-only">id=${escapeHtml(field.id)} · type=${escapeHtml(field.type)} · important=${field.important !== false}<br>${escapeHtml(field.aiHint || '')}</div>
                    </th>
                    <td><div class="memory-v2-inline-editor">${renderFieldEditor(template.id, table.id, field, value, locked)}</div></td>
                </tr>
            `;
        }).join('');
        return `<table class="memory-v2-kv"><tbody>${rowsHtml || '<tr><td class="memory-v2-empty">当前模式下没有匹配字段。</td></tr>'}</tbody></table>`;
    }

    function renderV2RowsSheet(chat, template, table) {
        const columns = getVisibleColumnsForMode(table);
        const isReviewTable = getTableRuntimePolicy(table).memoryLayer === 'review';
        const reviewStatusField = isReviewTable ? (table.columns || []).find(field => field.key === '审核状态') : null;
        const allRows = getRows(chat, template.id, table);
        const rows = allRows.filter(row => matchesMemorySearch([
            template.name,
            table.name,
            ...(columns || []).map(field => `${field.key} ${getFieldDisplayValue(field, row.cells?.[field.id])}`)
        ]));
        const head = columns.map(field => `
            <th data-memory-important="${field.important !== false}">
                ${escapeHtml(field.key)}
                <div class="memory-v2-json-meta memory-v2-json-only">${escapeHtml(field.id)}<br>${escapeHtml(field.type)}${field.aiHint ? `<br>${escapeHtml(field.aiHint)}` : ''}</div>
            </th>
        `).join('');
        const body = rows.map((row, rowIndex) => {
            const cells = columns.map(field => {
                const locked = isFieldLocked(chat, template.id, table.id, field.id);
                return `<td data-memory-important="${field.important !== false}"><div class="memory-v2-inline-editor">${renderFieldEditor(template.id, table.id, field, row.cells?.[field.id], locked, row.id)}</div></td>`;
            }).join('');
            return `
                <tr>
                    <td>
                        <div>${rowIndex + 1}</div>
                        <div class="memory-v2-row-actions">
                            <button class="btn btn-small btn-neutral" data-action="move-row-up" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">↑</button>
                            <button class="btn btn-small btn-neutral" data-action="move-row-down" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">↓</button>
                            <button class="btn btn-small btn-danger" data-action="delete-row" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">×</button>
                        </div>
                        ${MemoryEffects ? MemoryEffects.renderRowMetaSummary(row, table) : ''}
                        <div class="memory-effect-actions">
                            <button class="btn btn-small btn-secondary" data-action="edit-row-effect-policy" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">标签/策略</button>
                            <button class="btn btn-small btn-secondary" data-action="edit-row-reliability" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">来源/时效</button>
                            <button class="btn btn-small btn-neutral memory-v2-json-only" data-action="row-supersedes" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">替代旧条目</button>
                            <button class="btn btn-small btn-neutral memory-v2-json-only" data-action="row-conflicts" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">标记冲突</button>
                            <button class="btn btn-small btn-neutral memory-v2-json-only" data-action="row-clear-relations" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">清除关系</button>
                            <button class="btn btn-small btn-neutral" data-action="toggle-row-effect-pause" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">${row.meta?.usePolicy?.paused ? '启用' : '暂停'}</button>
                            <button class="btn btn-small btn-neutral" data-action="toggle-row-pin" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">${row.meta?.pinned ? '取消固定' : '固定'}</button>
                        </div>
                        ${isReviewTable ? `<div class="memory-v2-candidate-actions">
                            <button class="btn btn-small btn-primary" data-action="approve-long-candidate" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">批准晋升</button>
                            <button class="btn btn-small btn-secondary" data-action="more-evidence-candidate" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">更多证据</button>
                            <button class="btn btn-small btn-danger" data-action="reject-long-candidate" data-template-id="${template.id}" data-table-id="${table.id}" data-row-id="${row.id}">拒绝</button>
                            ${reviewStatusField ? `<span style="font-size:10px;color:#667085;">${escapeHtml(getFieldDisplayValue(reviewStatusField, row.cells?.[reviewStatusField.id]))}</span>` : ''}
                        </div>` : ''}
                        <div class="memory-v2-json-meta memory-v2-json-only">${escapeHtml(row.id)}</div>
                    </td>
                    ${cells}
                </tr>
            `;
        }).join('');
        return `
            <div class="memory-v2-rows-wrap">
                <table class="memory-v2-rows">
                    <thead><tr><th>#</th>${head}</tr></thead>
                    <tbody>${body || `<tr><td colspan="${columns.length + 1}" class="memory-v2-empty">暂无匹配记录。</td></tr>`}</tbody>
                </table>
            </div>
        `;
    }

    function renderV2RawJson(chat, template, table) {
        const tableData = deepClone(chat.memoryTables.data?.[template.id]?.[table.id] || {});
        const payload = { schema: table, data: tableData, lockedFields: chat.memoryTables.lockedFields?.[template.id]?.[table.id] || [] };
        return `<pre class="memory-v2-json-raw memory-v2-json-only">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
    }

    function renderTableView(chat) {
        const { descriptors, active } = getActiveTableDescriptor(chat);
        if (!active) return '';
        const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
        if (uiState.viewMode === 'json' && MemoryPolicy && !MemoryPolicy.isDesktopJsonAvailable()) {
            uiState.viewMode = 'normal';
            if (runtime) runtime.viewMode = 'normal';
        }
        const sidebar = descriptors.map(({ template, table }) => {
            const policy = getTableRuntimePolicy(table);
            const count = isRowsTable(table) ? `${getRows(chat, template.id, table).length} 行` : `${(table.columns || []).length} 字段`;
            return `
                <button type="button" class="memory-v2-table-item ${table.id === active.table.id ? 'active' : ''}" data-action="select-memory-table" data-table-id="${table.id}">
                    <span class="name">${escapeHtml(table.name)}</span>
                    <span class="meta">${escapeHtml(template.name)} · ${escapeHtml(policy.memoryLayer)} · ${count}</span>
                </button>
            `;
        }).join('');
        const policy = getTableRuntimePolicy(active.table);
        const tableContent = isRowsTable(active.table)
            ? renderV2RowsSheet(chat, active.template, active.table)
            : renderV2KeyValueSheet(chat, active.template, active.table);
        const rawJson = renderV2RawJson(chat, active.template, active.table);
        return `
            <div class="memory-v2-workspace">
                <aside class="memory-v2-sidebar">${sidebar}</aside>
                <section class="memory-v2-main">
                    <div class="memory-v2-sheet">
                        <div class="memory-v2-sheet-head">
                            <div>
                                <h2>${escapeHtml(active.table.name)}</h2>
                                <div class="sub">${escapeHtml(active.template.name)} · ${isRowsTable(active.table) ? '多行记录' : '键值档案'}${uiState.viewMode === 'json' ? ' · 完整字段/结构模式' : ' · 重要字段模式'}</div>
                                ${renderV2PolicySummary(active.table)}
                                ${active.table.extractPrompt ? `<div class="memory-v2-json-meta memory-v2-json-only">extractPrompt: ${escapeHtml(active.table.extractPrompt)}</div>` : ''}
                            </div>
                            <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
                                <span class="memory-v2-layer-badge">${escapeHtml(policy.memoryLayer)}</span>
                                ${isRowsTable(active.table) ? `<button type="button" class="btn btn-small btn-primary" data-action="add-row" data-template-id="${active.template.id}" data-table-id="${active.table.id}">新增行</button>` : ''}
                            </div>
                        </div>
                        ${tableContent}
                        ${rawJson}
                    </div>
                </section>
            </div>
        `;
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


    function renderFieldChartContainer(templateId, tableId, field) {
        const type = normalizeFieldType(field.type);
        if (!['number', 'progress'].includes(type)) return '';
        return `
            <div style="margin-top:12px; border-top:1px dashed #efefef; padding-top:12px;">
                <div style="font-size:12px; color:#999; margin-bottom:6px;">趋势</div>
                <canvas class="memory-field-chart" data-template-id="${templateId}" data-table-id="${tableId}" data-field-id="${field.id}" height="54" style="width:100%; height:54px;"></canvas>
            </div>
        `;
    }

    function getFieldHistorySeries(chat, templateId, tableId, fieldId, currentValue) {
        const entries = [...(chat.memoryTables.history || [])].reverse();
        const result = [];
        entries.forEach(entry => {
            const value = entry.snapshot?.[templateId]?.[tableId]?.[fieldId];
            if (typeof value === 'number') {
                result.push(value);
            }
        });
        if (typeof currentValue === 'number') {
            result.push(currentValue);
        }
        return result.slice(-12);
    }

    function drawAllCharts(chat) {
        const canvases = document.querySelectorAll('#memory-table-screen .memory-field-chart');
        canvases.forEach(canvas => {
            const templateId = canvas.dataset.templateId;
            const tableId = canvas.dataset.tableId;
            const fieldId = canvas.dataset.fieldId;
            const template = db.memoryTableTemplates.find(item => item.id === templateId);
            const table = template ? template.tables.find(item => item.id === tableId) : null;
            const field = table ? table.columns.find(item => item.id === fieldId) : null;
            if (!field) return;
            const value = getFieldValue(chat, templateId, tableId, field);
            const series = getFieldHistorySeries(chat, templateId, tableId, fieldId, value);
            drawSparkline(canvas, series, field);
        });
    }

    function drawSparkline(canvas, series, field) {
        const ctx = canvas.getContext('2d');
        const width = canvas.clientWidth || 300;
        const height = canvas.height || 54;
        canvas.width = width;
        ctx.clearRect(0, 0, width, height);

        ctx.strokeStyle = '#e6e9f2';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height - 10);
        ctx.lineTo(width, height - 10);
        ctx.stroke();

        if (!Array.isArray(series) || series.length < 2) {
            ctx.fillStyle = '#aaa';
            ctx.font = '12px sans-serif';
            ctx.fillText('暂无足够历史数据', 10, 28);
            return;
        }

        const min = typeof field.min === 'number' ? field.min : Math.min(...series);
        const max = typeof field.max === 'number' ? field.max : Math.max(...series);
        const range = Math.max(1, max - min);

        ctx.strokeStyle = '#5b8cff';
        ctx.lineWidth = 2;
        ctx.beginPath();

        series.forEach((value, index) => {
            const x = (width - 12) * (index / Math.max(1, series.length - 1)) + 6;
            const y = height - 10 - ((value - min) / range) * (height - 24);
            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        const lastValue = series[series.length - 1];
        const lastX = width - 6;
        const lastY = height - 10 - ((lastValue - min) / range) * (height - 24);
        ctx.fillStyle = '#5b8cff';
        ctx.beginPath();
        ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
        ctx.fill();
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
        if (chat.memoryMode !== 'table' && !options.force) return '';
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
        if (chat.memoryMode !== 'table' && !options.force && !options.preview) return '';
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
        uiState.tab = 'retrieval';
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

    function getHistoryMessageContent(item) {
        let content = item.content || '';
        if (item.parts && item.parts.length > 0) {
            content = item.parts.map(part => part.text || '[图片]').join('');
        }
        return content;
    }

    function collectMessagesForMemoryTable(chat, options = {}) {
        let history = Array.isArray(chat.history) ? [...chat.history] : [];
        if (options.start && options.end) {
            const startIndex = Math.max(0, options.start - 1);
            const endIndex = Math.min(history.length, options.end);
            history = history.slice(startIndex, endIndex);
        }
        if (typeof filterHistoryForAI === 'function') {
            history = filterHistoryForAI(chat, history);
        }
        history = history.filter(item => !item.isContextDisabled && !item.isThinking);
        if (!options.start && !options.end) {
            const configuredMax = Math.max(10, parseInt(options.maxContextMessages, 10) || (MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat).engineSettings.maxSourceMessages : MEMORY_TABLE_MAX_CONTEXT_MESSAGES));
            history = history.slice(-configuredMax);
        }
        return history;
    }

    function buildTemplateDefinitionForPrompt(chat, templates, options = {}) {
        const queryText = options.queryText || '';
        const relevantRowsOnly = !!options.relevantRowsOnly;
        const maxCandidateRows = Math.max(3, parseInt(options.maxCandidateRows, 10) || 12);
        return templates.map(template => {
            return [
                `模板ID=${template.id} 名称=${template.name}`,
                template.description ? `描述=${template.description}` : '',
                ...(template.tables || []).map(table => {
                    const tablePolicy = getTableRuntimePolicy(table);
                    const tableRowsText = isRowsTable(table)
                        ? (() => {
                            let rows = getRows(chat, template.id, table);
                            if (relevantRowsOnly && rows.length > maxCandidateRows && MemoryPolicy) {
                                const candidates = rows.map((row, rowIndex) => rowToRetrievalItem(table, row, rowIndex));
                                const selected = MemoryPolicy.selectRelevantItems(candidates, queryText, {
                                    ...tablePolicy.injectionPolicy,
                                    mode: 'relevant',
                                    topK: maxCandidateRows,
                                    threshold: 0,
                                    includeCompleted: true,
                                    maxAgeDays: 0
                                });
                                rows = selected.map(item => item.row);
                                const newest = getRows(chat, template.id, table)
                                    .slice()
                                    .sort((a, b) => getRowTimestamp(table, b) - getRowTimestamp(table, a))
                                    .slice(0, Math.min(4, maxCandidateRows));
                                const merged = new Map();
                                [...rows, ...newest].forEach(row => merged.set(row.id, row));
                                rows = Array.from(merged.values()).slice(0, maxCandidateRows);
                            }
                            if (!rows.length) return '  现有候选行=空';
                            return rows.map((row, rowIndex) => {
                                const cells = (table.columns || []).map(field => `${field.key}=${getFieldDisplayValue(field, row.cells[field.id]) || '空'}`).join(' | ');
                                return `  候选行ID=${row.id} 候选号=${rowIndex + 1} ${cells}`;
                            }).join('\n');
                        })()
                        : '';
                    return [
                        `  表格ID=${table.id} 名称=${table.name} 层级=${tablePolicy.memoryLayer} 模式=${isRowsTable(table) ? 'rows' : 'keyValue'}`,
                        `  更新策略=${tablePolicy.updatePolicy.enabled ? tablePolicy.updatePolicy.triggerMode : 'manual'}；允许新增=${tablePolicy.updatePolicy.allowAdd !== false ? '是' : '否'}；允许修改=${tablePolicy.updatePolicy.allowUpdate !== false ? '是' : '否'}；允许删除=${tablePolicy.updatePolicy.allowDelete === true ? '是' : '否'}`,
                        table.extractPrompt ? `  表格提取规则=${table.extractPrompt}` : '',
                        tablePolicy.updatePolicy.instructions ? `  本表附加规则=${tablePolicy.updatePolicy.instructions}` : '',
                        ...(table.columns || []).map(field => {
                            const currentValue = isRowsTable(table)
                                ? '见候选行'
                                : getFieldDisplayValue(field, getFieldValue(chat, template.id, table.id, field));
                            const locked = isFieldLocked(chat, template.id, table.id, field.id);
                            const optionsText = Array.isArray(field.options) && field.options.length > 0 ? ` 可选值=${field.options.join('|')}` : '';
                            const range = (typeof field.min === 'number' || typeof field.max === 'number')
                                ? ` 范围=${field.min ?? ''}~${field.max ?? ''}`
                                : '';
                            const group = field.group ? ` 分组=${field.group}` : '';
                            return `    字段ID=${field.id} 字段名=${field.key}${group} 类型=${field.type}${optionsText}${range} 当前值=${currentValue || '空'} 锁定=${locked ? '是' : '否'} AI可编辑=${field.aiEditable === false ? '否' : '是'} 重要字段=${field.important !== false ? '是' : '否'} 说明=${field.aiHint || '无'}`;
                        }),
                        tableRowsText
                    ].filter(Boolean).join('\n');
                })
            ].filter(Boolean).join('\n');
        }).join('\n\n');
    }

    function buildHistoryTextForPrompt(chat, history) {
        return history.map(item => {
            const name = item.role === 'user' ? (chat.myName || '用户') : (chat.realName || '角色');
            return `${name}: ${getHistoryMessageContent(item)}`;
        }).join('\n');
    }

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

        const historyText = buildHistoryTextForPrompt(chat, history);
        const templateText = buildTemplateDefinitionForPrompt(chat, templates, {
            queryText: historyText,
            relevantRowsOnly: options.relevantRowsOnly !== false,
            maxCandidateRows: options.maxCandidateRows || 12
        });
        const prompt = `你现在要帮一个聊天角色更新“结构化记忆表”。请根据给定的模板、字段规则和最近聊天记录，只提取明确发生过的信息，并且只输出发生变化的字段。

严格要求：
1. 只更新没有锁定且允许 AI 编辑的字段。
2. keyValue 表只能输出 <field>。
3. rows 表必须使用 <row op="add|update|delete">：
   - 新增一行用 <row op="add">，可不给 rowId。
   - 修改已有行用 <row op="update" rowId="现有行ID">。
   - 删除一行用 <row op="delete" rowId="现有行ID"></row>。
4. 如果某字段或某一行没有新变化，就不要输出它。
5. 不要臆测、不要补完、不要写解释。
6. 如果没有任何变化，输出 <memory_updates></memory_updates>
7. 你必须严格使用以下 XML：
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

角色信息：
- 角色名：${chat.realName || ''}
- 角色人设：${chat.persona || ''}
- 用户称呼：${chat.myName || ''}
- 用户人设：${chat.myPersona || ''}

模板定义如下：
${templateText}

最近聊天记录如下：
${historyText}`;

        try {
            const preferSummaryApi = templates.some(template => (template.tables || []).some(table => {
                const policy = getTableRuntimePolicy(table);
                return policy.updatePolicy.useSummaryApi !== false;
            }));
            const rawContent = await requestMemoryContent(prompt, 0.2, preferSummaryApi, preferSummaryApi ? 'memory-table-summary-update' : 'memory-table-fast-update');
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
                    historyPreview: historyText.length > 5000 ? `${historyText.slice(0, 5000)}
…（范围预览已截断）` : historyText,
                    apiMode: apiRoute.actualMode || (preferSummaryApi ? 'summary' : 'main'),
                    requestedApiMode: apiRoute.requestedMode || (preferSummaryApi ? 'summary' : 'main'),
                    apiFallback: !!apiRoute.fallback,
                    apiModel: apiRoute.model || '',
                    memoryLayer: firstTable ? getTableRuntimePolicy(firstTable).memoryLayer : ''
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
                if (!options.isAutoUpdate) uiState.tab = 'review';
                if (!options.skipRender) renderMemoryTableScreen();
                if (!options.suppressSuccessToast) showToast(`已生成 ${queued.proposals.length} 项更新草案，等待审核`);
                return { status: 'pending_review', changedFields: [], batchId: queued.id, proposedCount: queued.proposals.length };
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
            return { status: 'success', changedFields };
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
                forceReview: !!options.forceReview
            });
            if (result.status !== 'pending_review') {
                MemoryPolicy.markTableProcessed(chat, template.id, table.id, range.end, 'success');
                setMemoryTableAutoUpdateCursorByEndIndex(chat, range.end); // V1 兼容游标
            }
            return { ...result, range, templateId: template.id, tableId: table.id };
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
        try {
            definitionChars = buildTemplateDefinitionForPrompt(chat, [template], {
                queryText: historyText,
                relevantRowsOnly: true,
                maxCandidateRows: 12
            }).length;
        } catch (_) {}
        return historyText.length + definitionChars + 2600;
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
            priority: options.priority || (options.isAutoUpdate ? 45 : 85)
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
                    source: options.source || 'auto_v2_legacy', isAutoUpdate: true
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
                priority: 45
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
        if (entry?.task?.status === 'waiting_review') uiState.tab = 'review';
        else uiState.tab = 'tasks';
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
        uiState.rangePreview = { chatId: chat.id, templateId, tableId, start: range.start, end: range.end };
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
                </div>
                <div style="font-size:12px;color:#667085;line-height:1.6;">游标尚未推进。点击“生成更新草案”后，V2.2 会强制进入审核队列，只有完成审核才推进该表游标。</div>
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
        uiState.tab = task.status === 'waiting_review' ? 'review' : 'tasks';
        renderMemoryTableScreen();
        if (queued.deduped) showToast('同一范围的总结任务已存在，未重复提交');
        else if (task.status === 'waiting_review') showToast('已生成更新草案，等待审核');
        else if (task.status === 'failed') showToast('生成草案失败，任务已保留可重试');
        else showToast('范围内没有检测到变化');
    }


    async function checkAndTriggerAutoTableUpdate(chat, options = {}) {
        if (!chat || !chat.memoryTables || !chat.memoryTables.autoUpdateEnabled) return { status: 'disabled' };
        ensureMemoryTableAutoUpdateState(chat);
        if (chat.memoryTables.autoUpdateState === 'failed') {
            refreshMemoryTableAutoUpdateControls(chat, getBoundTemplates(chat).length > 0);
            return { status: 'failed' };
        }
        return processMemoryTableAutoUpdate(chat, {
            force: false,
            processAllAvailable: false,
            showNoPendingToast: !!options.showNoPendingToast,
            source: 'auto_round_v2'
        });
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
                        proposals.push({
                            id: createMemoryId('proposal'), kind: 'row_add', actionLabel: '新增记录',
                            templateId, tableId, templateName: template.name, tableName: table.name,
                            label: `${table.name} / 新增记录`, oldValue: '', newValue: display, fieldValues: values,
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
                    if (MemoryLifecycle) MemoryLifecycle.recordSource(target, 'summary_api', { type: 'review_batch', id: batch.id, at: Date.now() });
                    return;
                }
                if (policy.allowAdd === false) return;
                const added = addRow(chat, template.id, table, proposal.fieldValues || {}, { source: 'review_v2_2', skipHistory: true });
                (table.columns || []).forEach(field => {
                    if (proposal.fieldValues?.[field.id] === undefined) return;
                    changedFields.push({ templateId: template.id, tableId: table.id, rowId: added.id, fieldId: field.id, label: `${table.name} / ${field.key}（审核新增）`, oldValue: '', newValue: added.cells[field.id] });
                });
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
        uiState.tab = 'review';
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


    function getTableFieldByKey(table, key) {
        return (table?.columns || []).find(field => field.key === key) || null;
    }

    function getRowValueByKey(table, row, key) {
        const field = getTableFieldByKey(table, key);
        return field ? row?.cells?.[field.id] : undefined;
    }

    async function setLongCandidateStatus(chat, template, table, row, status) {
        const statusField = getTableFieldByKey(table, '审核状态');
        if (!statusField || !row) return false;
        const oldValue = row.cells[statusField.id];
        const nextValue = normalizeFieldValue(statusField, status);
        if (isSameMemoryValue(oldValue, nextValue)) return false;
        row.cells[statusField.id] = nextValue;
        row.meta ||= {};
        row.meta.updatedAt = Date.now();
        pushMemoryHistory(chat, [{ templateId: template.id, tableId: table.id, rowId: row.id, fieldId: statusField.id, label: `${table.name} / 审核状态`, oldValue, newValue: nextValue }], { source: 'candidate_review_v2_1' });
        if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
        await saveCharacter(chat.id);
        renderMemoryTableScreen();
        return true;
    }

    async function approveLongCandidate(chat, templateId, tableId, rowId) {
        const template = getBoundTemplates(chat).find(item => item.id === templateId);
        const sourceTable = template?.tables?.find(item => item.id === tableId);
        const sourceRow = sourceTable ? findRowById(chat, templateId, sourceTable, rowId) : null;
        if (!template || !sourceTable || !sourceRow) return;
        const targetTable = (template.tables || []).find(table => getTableRuntimePolicy(table).memoryLayer === 'long' && isRowsTable(table));
        if (!targetTable) {
            showToast('当前模板没有可接收候选的长期 rows 表');
            return;
        }
        const content = getRowValueByKey(sourceTable, sourceRow, '候选内容');
        const category = getRowValueByKey(sourceTable, sourceRow, '候选类别');
        if (!String(content || '').trim()) {
            showToast('候选内容为空，无法晋升');
            return;
        }
        const originalIdField = getTableFieldByKey(targetTable, '原始记录ID');
        const contentField = getTableFieldByKey(targetTable, '内容');
        const duplicate = getRows(chat, template.id, targetTable).find(row => {
            if (originalIdField && row.cells?.[originalIdField.id] === sourceRow.id) return true;
            return contentField && String(row.cells?.[contentField.id] || '').trim() === String(content).trim();
        });
        if (duplicate) {
            await setLongCandidateStatus(chat, template, sourceTable, sourceRow, '已批准');
            showToast('长期库已有相同记录，已将候选标记为批准');
            return;
        }
        const values = {};
        const assign = (key, value) => {
            const field = getTableFieldByKey(targetTable, key);
            if (field && value !== undefined && value !== null && value !== '') values[field.id] = value;
        };
        const sourceDomainField = getTableFieldByKey(targetTable, '来源域');
        if (sourceDomainField) {
            const preferred = (sourceDomainField.options || []).includes('长期候选审核') ? '长期候选审核'
                : ((sourceDomainField.options || []).includes('成长沉淀') ? '成长沉淀' : sourceDomainField.options?.[0]);
            assign('来源域', preferred);
        }
        assign('维度或类型', category);
        assign('分类', category);
        assign('内容', content);
        assign('原置信度', getRowValueByKey(sourceTable, sourceRow, '置信度'));
        assign('确认状态', '用户确认');
        const evidence = getRowValueByKey(sourceTable, sourceRow, '支持证据');
        const exception = getRowValueByKey(sourceTable, sourceRow, '反例或例外');
        assign('例外或适用场景', [exception ? `例外：${exception}` : '', evidence ? `支持证据：${evidence}` : ''].filter(Boolean).join('\n'));
        assign('原始记录ID', sourceRow.id);

        const beforeSnapshot = deepClone(chat.memoryTables.data);
        const added = addRow(chat, template.id, targetTable, values, { source: 'candidate_approve_v2_1', skipHistory: true, userConfirmed: true });
        const statusField = getTableFieldByKey(sourceTable, '审核状态');
        const oldStatus = statusField ? sourceRow.cells[statusField.id] : undefined;
        if (statusField) sourceRow.cells[statusField.id] = normalizeFieldValue(statusField, '已批准');
        if (MemoryLifecycle) {
            MemoryLifecycle.recordSource(added, 'manual', { type: 'manual', id: sourceRow.id, at: Date.now(), excerpt: String(content).slice(0, 300) }, { userConfirmed: true, verified: true });
            MemoryLifecycle.setStatus(added, 'active', '由用户批准长期候选后生效');
        }
        const changed = [];
        (targetTable.columns || []).forEach(field => {
            if (values[field.id] === undefined) return;
            changed.push({ templateId: template.id, tableId: targetTable.id, rowId: added.id, fieldId: field.id, label: `${targetTable.name} / ${field.key}（候选晋升）`, oldValue: '', newValue: added.cells[field.id] });
        });
        if (statusField) changed.push({ templateId: template.id, tableId: sourceTable.id, rowId: sourceRow.id, fieldId: statusField.id, label: `${sourceTable.name} / 审核状态`, oldValue: oldStatus, newValue: sourceRow.cells[statusField.id] });
        pushMemoryHistory(chat, changed, { source: 'candidate_approve_v2_1', snapshot: beforeSnapshot });
        if (MemoryPolicy) MemoryPolicy.clearRetrievalCache(chat);
        await saveCharacter(chat.id);
        renderMemoryTableScreen();
        showToast('候选已批准并晋升到稳定长期特征库');
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

    function openTemplateEditor(template) {
        const modal = document.getElementById('memory-template-editor-modal');
        const textarea = document.getElementById('memory-template-json');
        if (!modal || !textarea) return;

        const working = template
            ? deepClone(template)
            : (uiState.templateDraft ? deepClone(uiState.templateDraft) : createStarterTemplate());
        uiState.editingTemplateId = working.id || (template ? template.id : null);
        textarea.value = JSON.stringify(working, null, 2);
        modal.classList.add('visible');
    }

    function closeTemplateEditor() {
        const modal = document.getElementById('memory-template-editor-modal');
        if (modal) modal.classList.remove('visible');
        uiState.editingTemplateId = null;
    }

    async function saveTemplateFromEditor() {
        ensureMemoryTemplateStore();
        const textarea = document.getElementById('memory-template-json');
        if (!textarea) return;
        let parsed;
        try {
            parsed = JSON.parse(textarea.value);
        } catch (error) {
            showToast('JSON 解析失败，请检查格式');
            return;
        }

        let normalized;
        try {
            normalized = normalizeTemplate(parsed, uiState.editingTemplateId || undefined);
        } catch (error) {
            showToast(error.message || '模板格式不合法');
            return;
        }
        uiState.templateDraft = deepClone(normalized);
        await persistTemplateNormalized(normalized);
        closeTemplateEditor();
        if (document.getElementById('memory-template-designer-modal')?.classList.contains('visible')) {
            renderTemplateDesigner();
        }
        renderMemoryTableScreen();
        showToast('模板已保存');
    }

    function getDesignerDraftTarget(tableIndex, fieldIndex) {
        const draft = uiState.templateDraft;
        if (!draft) return null;
        if (tableIndex === undefined || tableIndex === null) return draft;
        const table = draft.tables?.[tableIndex];
        if (!table) return null;
        if (fieldIndex === undefined || fieldIndex === null) return table;
        return table.columns?.[fieldIndex] || null;
    }

    function updateDesignerDraftFromInput(target) {
        const role = target.dataset.designerRole;
        if (!role || !uiState.templateDraft) return;
        const tableIndex = target.dataset.tableIndex !== undefined ? Number(target.dataset.tableIndex) : undefined;
        const fieldIndex = target.dataset.fieldIndex !== undefined ? Number(target.dataset.fieldIndex) : undefined;
        const draftTarget = getDesignerDraftTarget(tableIndex, fieldIndex);
        if (!draftTarget) return;

        const value = target.type === 'checkbox' ? target.checked : target.value;
        const ensurePolicies = () => {
            const layer = MemoryPolicy ? MemoryPolicy.normalizeLayer(draftTarget.memoryLayer, draftTarget.name) : (draftTarget.memoryLayer || 'short');
            draftTarget.memoryLayer = layer;
            draftTarget.updatePolicy = MemoryPolicy ? MemoryPolicy.normalizeUpdatePolicy(draftTarget.updatePolicy || {}, layer) : (draftTarget.updatePolicy || {});
            draftTarget.injectionPolicy = MemoryPolicy ? MemoryPolicy.normalizeInjectionPolicy(draftTarget.injectionPolicy || {}, layer) : (draftTarget.injectionPolicy || {});
        };
        switch (role) {
            case 'template-name': uiState.templateDraft.name = value; break;
            case 'template-description': uiState.templateDraft.description = value; break;
            case 'table-name': draftTarget.name = value; break;
            case 'table-mode': draftTarget.mode = value === 'rows' ? 'rows' : 'keyValue'; break;
            case 'table-memory-layer':
                draftTarget.memoryLayer = value;
                if (MemoryPolicy) {
                    draftTarget.updatePolicy = MemoryPolicy.normalizeUpdatePolicy({}, value);
                    draftTarget.injectionPolicy = MemoryPolicy.normalizeInjectionPolicy({}, value);
                }
                break;
            case 'table-extract-prompt': draftTarget.extractPrompt = value; break;
            case 'table-update-enabled': ensurePolicies(); draftTarget.updatePolicy.enabled = value !== 'false'; break;
            case 'table-trigger-mode': ensurePolicies(); draftTarget.updatePolicy.triggerMode = value; break;
            case 'table-round-interval': ensurePolicies(); draftTarget.updatePolicy.roundInterval = Math.max(0, Number(value) || 0); break;
            case 'table-message-interval': ensurePolicies(); draftTarget.updatePolicy.messageInterval = Math.max(0, Number(value) || 0); break;
            case 'table-max-source-messages': ensurePolicies(); draftTarget.updatePolicy.maxSourceMessages = Math.max(10, Number(value) || 10); break;
            case 'table-allow-delete': ensurePolicies(); draftTarget.updatePolicy.allowDelete = value === 'true'; break;
            case 'table-use-summary-api': ensurePolicies(); draftTarget.updatePolicy.useSummaryApi = value === 'true'; break;
            case 'table-update-instructions': ensurePolicies(); draftTarget.updatePolicy.instructions = value; break;
            case 'table-injection-mode': ensurePolicies(); draftTarget.injectionPolicy.mode = value; break;
            case 'table-injection-top-k': ensurePolicies(); draftTarget.injectionPolicy.topK = Math.max(0, Number(value) || 0); break;
            case 'table-injection-budget': ensurePolicies(); draftTarget.injectionPolicy.budget = Math.max(0, Number(value) || 0); break;
            case 'table-max-age-days': ensurePolicies(); draftTarget.injectionPolicy.maxAgeDays = Math.max(0, Number(value) || 0); break;
            case 'field-key': draftTarget.key = value; break;
            case 'field-group': draftTarget.group = value; break;
            case 'field-type': draftTarget.type = normalizeFieldType(value); break;
            case 'field-default': draftTarget.default = draftTarget.type === 'tags' ? parseOptionText(value) : value; break;
            case 'field-ai-editable': draftTarget.aiEditable = value !== 'false'; break;
            case 'field-important': draftTarget.important = value !== 'false'; break;
            case 'field-summary-label': draftTarget.summaryLabel = value; break;
            case 'field-min': draftTarget.min = value === '' ? undefined : Number(value); break;
            case 'field-max': draftTarget.max = value === '' ? undefined : Number(value); break;
            case 'field-options': draftTarget.options = parseOptionText(value); break;
            case 'field-ai-hint': draftTarget.aiHint = value; break;
            case 'field-conditional-rules': draftTarget.conditionalRules = parseConditionalRulesText(value); break;
            default: break;
        }
    }

    function mutateDesignerDraft(action, tableIndex, fieldIndex) {
        const draft = uiState.templateDraft;
        if (!draft) return;
        if (action === 'add-table') {
            draft.tables.push(createEmptyTableDraft());
        } else if (action === 'remove-table') {
            if (draft.tables.length > 1) draft.tables.splice(tableIndex, 1);
        } else if (action === 'move-table-up') {
            moveArrayItem(draft.tables, tableIndex, tableIndex - 1);
        } else if (action === 'move-table-down') {
            moveArrayItem(draft.tables, tableIndex, tableIndex + 1);
        } else if (action === 'add-field') {
            draft.tables[tableIndex].columns.push(createEmptyFieldDraft());
        } else if (action === 'remove-field') {
            const table = draft.tables[tableIndex];
            if (table.columns.length > 1) table.columns.splice(fieldIndex, 1);
        } else if (action === 'move-field-up') {
            moveArrayItem(draft.tables[tableIndex].columns, fieldIndex, fieldIndex - 1);
        } else if (action === 'move-field-down') {
            moveArrayItem(draft.tables[tableIndex].columns, fieldIndex, fieldIndex + 1);
        }
    }

    async function saveTemplateFromDesigner() {
        if (!uiState.templateDraft) return;
        let normalized;
        try {
            normalized = normalizeTemplate(uiState.templateDraft, uiState.editingTemplateId || undefined);
        } catch (error) {
            showToast(error.message || '模板格式不合法');
            return;
        }
        uiState.templateDraft = deepClone(normalized);
        await persistTemplateNormalized(normalized);
        closeTemplateDesigner();
        showToast('模板已保存');
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
                    runtime.viewMode = parsed.binding.viewMode === 'json' && MemoryPolicy.isDesktopJsonAvailable() ? 'json' : 'normal';
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
        const chat = getCurrentMemoryTableChat();
        if (!chat) return;
        const templateId = target.dataset.templateId;
        const tableId = target.dataset.tableId;
        const fieldId = target.dataset.fieldId;
        const template = db.memoryTableTemplates.find(item => item.id === templateId);
        const table = template ? (template.tables || []).find(item => item.id === tableId) : null;
        const field = table ? (table.columns || []).find(item => item.id === fieldId) : null;
        if (!field) return;

        const rawValue = target.type === 'checkbox' ? target.checked : target.value;
        const rowId = target.dataset.rowId || '';
        if (rowId && isRowsTable(table)) {
            updateRowFieldValue(chat, templateId, table, rowId, field, rawValue, { source: 'manual' });
        } else {
            setFieldValue(chat, templateId, tableId, field, rawValue, { source: 'manual' });
        }
        await saveCharacter(chat.id);
        renderMemoryTableScreen();
    }

    function setupMemoryTableScreen() {
        ensureMemoryTemplateStore();

        const searchInput = document.getElementById('memory-table-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                uiState.search = searchInput.value || '';
                renderMemoryTableScreen();
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
                uiState.tab = button.dataset.tab || 'tables';
                uiState.workspace = MemoryWorkspace.getWorkspaceForView(uiState.tab);
                renderMemoryTableScreen();
            });
        });

        document.querySelectorAll('.memory-workspace-tab-btn').forEach(button => {
            button.addEventListener('click', () => {
                const normalized = MemoryWorkspace.normalizeState(button.dataset.workspace, '');
                uiState.workspace = normalized.workspace;
                uiState.tab = normalized.view;
                renderMemoryTableScreen();
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
                await updateSelectedMemoryTable(chat, active.template.id, active.table.id);
            });
        }

        const normalModeBtn = document.getElementById('memory-table-normal-mode-btn');
        const jsonModeBtn = document.getElementById('memory-table-json-mode-btn');
        const setViewMode = async mode => {
            const chat = getCurrentMemoryTableChat();
            if (!chat) return;
            if (mode === 'json' && MemoryPolicy && !MemoryPolicy.isDesktopJsonAvailable()) {
                showToast('JSON 模式仅电脑端开放');
                return;
            }
            uiState.viewMode = mode === 'json' ? 'json' : 'normal';
            const runtime = MemoryPolicy ? MemoryPolicy.ensureRuntimeState(chat) : null;
            if (runtime) runtime.viewMode = uiState.viewMode;
            await saveCharacter(chat.id);
            renderMemoryTableScreen();
        };
        if (normalModeBtn) normalModeBtn.addEventListener('click', () => setViewMode('normal'));
        if (jsonModeBtn) jsonModeBtn.addEventListener('click', () => setViewMode('json'));

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
        if (createTemplateBtn) createTemplateBtn.addEventListener('click', () => openTemplateDesigner(null));

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
                    ? '已切换为结构化档案模式'
                    : (chat.memoryMode === 'vector' ? '已切换为向量记忆模式' : '已切换为日记模式'));
            });
        });

        const screen = document.getElementById('memory-table-screen');
        if (screen) {
            screen.addEventListener('click', async (event) => {
                const workbenchView = event.target.closest('[data-workbench-view]');
                if (workbenchView) {
                    const view = workbenchView.dataset.workbenchView;
                    if (view === 'manage_settings') {
                        uiState.workspace = 'memory';
                        uiState.tab = 'tables';
                        renderMemoryTableScreen();
                        const details = document.getElementById('memory-workbench-advanced-settings');
                        if (details) details.open = true;
                        document.getElementById('memory-workbench-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        return;
                    }
                    uiState.tab = view;
                    uiState.workspace = MemoryWorkspace.getWorkspaceForView(view);
                    renderMemoryTableScreen();
                    return;
                }
                const workbenchBack = event.target.closest('[data-workbench-back]');
                if (workbenchBack) {
                    const normalized = MemoryWorkspace.normalizeState(workbenchBack.dataset.workbenchBack, '');
                    uiState.workspace = normalized.workspace;
                    uiState.tab = normalized.view;
                    renderMemoryTableScreen();
                    return;
                }
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
                    if (feedbackAction === 'forget' && !window.confirm('这会停止使用并归档该条记忆。确定继续吗？')) return;
                    const result = MemoryFeedback.applyAction(chat, feedbackEl.dataset.snapshotId, feedbackEl.dataset.feedbackItemId, feedbackAction);
                    if (result.changed) await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                    showToast(result.message);
                    return;
                }
                const actionEl = event.target.closest('[data-action]');
                if (!actionEl) return;
                const action = actionEl.dataset.action;
                if (action === 'quality-run') {
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
                        uiState.tab = 'quality';
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
                    uiState.tab = 'review';
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
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryReview) return;
                    const decision = action === 'review-accept' ? 'accepted' : (action === 'review-reject' ? 'rejected' : 'pending');
                    MemoryReview.setProposalDecision(chat, actionEl.dataset.batchId, actionEl.dataset.proposalId, decision);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                } else if (action === 'review-accept-all' || action === 'review-reject-all') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat || !MemoryReview) return;
                    MemoryReview.setAllDecisions(chat, actionEl.dataset.batchId, action === 'review-accept-all' ? 'accepted' : 'rejected');
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                } else if (action === 'review-apply-batch') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    await finalizeMemoryReviewBatch(chat, actionEl.dataset.batchId);
                } else if (action === 'review-reject-batch') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    await finalizeMemoryReviewBatch(chat, actionEl.dataset.batchId, { rejectAll: true });
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
                    await approveLongCandidate(chat, actionEl.dataset.templateId, actionEl.dataset.tableId, actionEl.dataset.rowId);
                } else if (action === 'reject-long-candidate' || action === 'more-evidence-candidate') {
                    const chat = getCurrentMemoryTableChat();
                    if (!chat) return;
                    const template = getBoundTemplates(chat).find(item => item.id === actionEl.dataset.templateId);
                    const table = template?.tables?.find(item => item.id === actionEl.dataset.tableId);
                    const row = table ? findRowById(chat, template.id, table, actionEl.dataset.rowId) : null;
                    if (!template || !table || !row) return;
                    await setLongCandidateStatus(chat, template, table, row, action === 'reject-long-candidate' ? '已拒绝' : '需要更多证据');
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
                    uiState.activeTableId = actionEl.dataset.tableId || null;
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
                } else if (action === 'edit-template-visual') {
                    const template = db.memoryTableTemplates.find(item => item.id === actionEl.dataset.templateId);
                    if (template) openTemplateDesigner(template);
                } else if (action === 'edit-template-json') {
                    const template = db.memoryTableTemplates.find(item => item.id === actionEl.dataset.templateId);
                    if (template) openTemplateEditor(template);
                } else if (action === 'delete-template') {
                    await deleteTemplate(actionEl.dataset.templateId);
                } else if (action === 'export-template') {
                    exportTemplate(actionEl.dataset.templateId);
                } else if (action === 'export-template-package') {
                    exportTemplatePackage(actionEl.dataset.templateId);
                } else if (action === 'restore-history') {
                    await restoreHistoryEntry(actionEl.dataset.historyId);
                } else if (action === 'add-row') {
                    const chat = getCurrentMemoryTableChat();
                    const template = db.memoryTableTemplates.find(item => item.id === actionEl.dataset.templateId);
                    const table = template ? (template.tables || []).find(item => item.id === actionEl.dataset.tableId) : null;
                    if (!chat || !table) return;
                    addRow(chat, template.id, table, {}, { source: 'manual' });
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                } else if (action === 'delete-row') {
                    const chat = getCurrentMemoryTableChat();
                    const template = db.memoryTableTemplates.find(item => item.id === actionEl.dataset.templateId);
                    const table = template ? (template.tables || []).find(item => item.id === actionEl.dataset.tableId) : null;
                    if (!chat || !table) return;
                    if (!window.confirm('确定删除这一行吗？')) return;
                    deleteRow(chat, template.id, table, actionEl.dataset.rowId, { source: 'manual' });
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                } else if (action === 'move-row-up' || action === 'move-row-down') {
                    const chat = getCurrentMemoryTableChat();
                    const template = db.memoryTableTemplates.find(item => item.id === actionEl.dataset.templateId);
                    const table = template ? (template.tables || []).find(item => item.id === actionEl.dataset.tableId) : null;
                    if (!chat || !table) return;
                    moveRow(chat, template.id, table, actionEl.dataset.rowId, action === 'move-row-up' ? -1 : 1);
                    await saveCharacter(chat.id);
                    renderMemoryTableScreen();
                }
            });

            screen.addEventListener('change', async (event) => {
                const target = event.target;
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

        const closeModalBtn = document.getElementById('memory-template-editor-cancel-btn');
        if (closeModalBtn) closeModalBtn.addEventListener('click', closeTemplateEditor);

        const saveModalBtn = document.getElementById('memory-template-editor-save-btn');
        if (saveModalBtn) saveModalBtn.addEventListener('click', saveTemplateFromEditor);

        const starterBtn = document.getElementById('memory-template-editor-starter-btn');
        if (starterBtn) {
            starterBtn.addEventListener('click', () => {
                const textarea = document.getElementById('memory-template-json');
                if (!textarea) return;
                textarea.value = JSON.stringify(createStarterTemplate(), null, 2);
            });
        }

        const editorModal = document.getElementById('memory-template-editor-modal');
        if (editorModal) {
            editorModal.addEventListener('click', event => {
                if (event.target === editorModal) closeTemplateEditor();
            });
        }

        const designerModal = document.getElementById('memory-template-designer-modal');
        if (designerModal) {
            designerModal.addEventListener('click', async event => {
                if (event.target === designerModal) {
                    closeTemplateDesigner();
                    return;
                }
                const actionEl = event.target.closest('[data-action]');
                if (!actionEl) return;
                const action = actionEl.dataset.action;
                const tableIndex = actionEl.dataset.tableIndex !== undefined ? Number(actionEl.dataset.tableIndex) : undefined;
                const fieldIndex = actionEl.dataset.fieldIndex !== undefined ? Number(actionEl.dataset.fieldIndex) : undefined;
                if (action === 'designer-add-table') {
                    mutateDesignerDraft('add-table');
                    renderTemplateDesigner();
                } else if (action === 'designer-remove-table') {
                    mutateDesignerDraft('remove-table', tableIndex);
                    renderTemplateDesigner();
                } else if (action === 'designer-move-table-up') {
                    mutateDesignerDraft('move-table-up', tableIndex);
                    renderTemplateDesigner();
                } else if (action === 'designer-move-table-down') {
                    mutateDesignerDraft('move-table-down', tableIndex);
                    renderTemplateDesigner();
                } else if (action === 'designer-add-field') {
                    mutateDesignerDraft('add-field', tableIndex);
                    renderTemplateDesigner();
                } else if (action === 'designer-remove-field') {
                    mutateDesignerDraft('remove-field', tableIndex, fieldIndex);
                    renderTemplateDesigner();
                } else if (action === 'designer-move-field-up') {
                    mutateDesignerDraft('move-field-up', tableIndex, fieldIndex);
                    renderTemplateDesigner();
                } else if (action === 'designer-move-field-down') {
                    mutateDesignerDraft('move-field-down', tableIndex, fieldIndex);
                    renderTemplateDesigner();
                } else if (action === 'designer-toggle-field-collapse') {
                    const fieldId = actionEl.dataset.fieldId;
                    uiState.designerCollapsedFieldIds[fieldId] = !uiState.designerCollapsedFieldIds[fieldId];
                    renderTemplateDesigner();
                } else if (action === 'designer-open-json') {
                    openTemplateEditor();
                } else if (action === 'designer-save') {
                    await saveTemplateFromDesigner();
                } else if (action === 'designer-cancel') {
                    closeTemplateDesigner();
                }
            });
            designerModal.addEventListener('dragstart', event => {
                const dragEl = event.target.closest('[data-designer-draggable]');
                if (!dragEl) return;
                uiState.designerDrag = {
                    type: dragEl.dataset.designerDraggable,
                    tableIndex: dragEl.dataset.tableIndex !== undefined ? Number(dragEl.dataset.tableIndex) : undefined,
                    fieldIndex: dragEl.dataset.fieldIndex !== undefined ? Number(dragEl.dataset.fieldIndex) : undefined
                };
                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = 'move';
                }
            });
            designerModal.addEventListener('dragover', event => {
                const dragEl = event.target.closest('[data-designer-draggable]');
                if (!dragEl || !uiState.designerDrag) return;
                event.preventDefault();
            });
            designerModal.addEventListener('drop', event => {
                const dragEl = event.target.closest('[data-designer-draggable]');
                if (!dragEl || !uiState.designerDrag || !uiState.templateDraft) return;
                event.preventDefault();
                const drag = uiState.designerDrag;
                if (drag.type === 'table' && dragEl.dataset.designerDraggable === 'table') {
                    moveArrayItem(uiState.templateDraft.tables, drag.tableIndex, Number(dragEl.dataset.tableIndex));
                    renderTemplateDesigner();
                } else if (
                    drag.type === 'field' &&
                    dragEl.dataset.designerDraggable === 'field' &&
                    Number(dragEl.dataset.tableIndex) === drag.tableIndex
                ) {
                    moveArrayItem(
                        uiState.templateDraft.tables[drag.tableIndex].columns,
                        drag.fieldIndex,
                        Number(dragEl.dataset.fieldIndex)
                    );
                    renderTemplateDesigner();
                }
                uiState.designerDrag = null;
            });
            designerModal.addEventListener('dragend', () => {
                uiState.designerDrag = null;
            });
            designerModal.addEventListener('input', event => {
                const target = event.target;
                if (target.dataset && target.dataset.designerRole) {
                    updateDesignerDraftFromInput(target);
                }
            });
            designerModal.addEventListener('change', event => {
                const target = event.target;
                if (target.dataset && target.dataset.designerRole) {
                    updateDesignerDraftFromInput(target);
                }
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
                forceReview: !!payload.forceReview
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

    function openMemoryFeedbackTab() {
        uiState.workspace = 'inbox';
        uiState.tab = 'feedback';
        renderMemoryTableScreen();
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
            const normalized = MemoryWorkspace.normalizeState(workspace, view);
            uiState.workspace = normalized.workspace;
            uiState.tab = normalized.view;
            renderMemoryTableScreen();
        },
        getContext: getMemoryContextBlock,
        prepareContext: prepareMemoryTableContext,
        exportContext: exportMemoryTableContext,
        getBoundTemplateIds: getBoundMemoryTableTemplateIds,
        convertText: convertTextToMemoryTable,
        checkAutoUpdate: checkAndTriggerAutoTableUpdate
    });
})();
