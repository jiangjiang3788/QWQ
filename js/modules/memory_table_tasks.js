// 结构化记忆 V2.6：持久化任务队列、幂等、防重复、失败恢复与成本估算
(function () {
    'use strict';

    const Kernel = window.OvoMemoryKernel || null;
    const Core = Kernel?.core;
    if (!Core) throw new Error('记忆内核未加载');
    const clone = Core.clone;
    const now = Date.now;
    const clamp = Core.clamp;
    const createId = Core.createId;
    const hashText = Core.hashText;
    const escapeHtml = Core.escapeHtml;

    const VERSION = '2.6';
    const TASK_LIMIT = 80;
    const HISTORY_LIMIT = 60;
    const executors = new Map();
    const runningChats = new Set();

    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        paused: false,
        autoResume: true,
        maxTasksPerCycle: 2,
        maxAttempts: 3,
        retryBaseSeconds: 8,
        perRoundApiLimit: 3,
        outputTokenEstimate: 900,
        pricing: {
            mainInputPerMillion: 0,
            mainOutputPerMillion: 0,
            summaryInputPerMillion: 0,
            summaryOutputPerMillion: 0,
            embeddingPerMillion: 0
        }
    });

    function normalizePricing(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            mainInputPerMillion: clamp(source.mainInputPerMillion, 0, 0, 100000),
            mainOutputPerMillion: clamp(source.mainOutputPerMillion, 0, 0, 100000),
            summaryInputPerMillion: clamp(source.summaryInputPerMillion, 0, 0, 100000),
            summaryOutputPerMillion: clamp(source.summaryOutputPerMillion, 0, 0, 100000),
            embeddingPerMillion: clamp(source.embeddingPerMillion, 0, 0, 100000)
        };
    }
    function normalizeSettings(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            enabled: source.enabled !== false,
            paused: source.paused === true,
            autoResume: source.autoResume !== false,
            maxTasksPerCycle: clamp(source.maxTasksPerCycle, DEFAULT_SETTINGS.maxTasksPerCycle, 1, 20),
            maxAttempts: clamp(source.maxAttempts, DEFAULT_SETTINGS.maxAttempts, 1, 10),
            retryBaseSeconds: clamp(source.retryBaseSeconds, DEFAULT_SETTINGS.retryBaseSeconds, 1, 3600),
            perRoundApiLimit: clamp(source.perRoundApiLimit, DEFAULT_SETTINGS.perRoundApiLimit, 1, 20),
            outputTokenEstimate: clamp(source.outputTokenEstimate, DEFAULT_SETTINGS.outputTokenEstimate, 100, 10000),
            pricing: normalizePricing(source.pricing || DEFAULT_SETTINGS.pricing)
        };
    }
    function ensureState(chat) {
        if (!chat) return null;
        chat.memoryTables ||= {};
        chat.memoryTables.taskQueue ||= {};
        const state = chat.memoryTables.taskQueue;
        state.schemaVersion = VERSION;
        state.settings = normalizeSettings(state.settings);
        if (!Array.isArray(state.tasks)) state.tasks = [];
        if (!Array.isArray(state.history)) state.history = [];
        if (!state.stats || typeof state.stats !== 'object') state.stats = {};
        state.stats = {
            enqueued: Number(state.stats.enqueued) || 0,
            succeeded: Number(state.stats.succeeded) || 0,
            failed: Number(state.stats.failed) || 0,
            retried: Number(state.stats.retried) || 0,
            deduped: Number(state.stats.deduped) || 0,
            recovered: Number(state.stats.recovered) || 0,
            estimatedInputTokens: Number(state.stats.estimatedInputTokens) || 0,
            estimatedOutputTokens: Number(state.stats.estimatedOutputTokens) || 0,
            estimatedCost: Number(state.stats.estimatedCost) || 0
        };
        if (!state.roundUsage || typeof state.roundUsage !== 'object') state.roundUsage = { roundId: null, apiCount: 0 };
        if (!state.lastRunAt) state.lastRunAt = 0;
        if (!state.lastError) state.lastError = '';
        let recovered = 0;
        state.tasks.forEach(task => {
            task.attempts = Number(task.attempts) || 0;
            task.maxAttempts = Number(task.maxAttempts) || state.settings.maxAttempts;
            task.priority = Number(task.priority) || 50;
            task.createdAt = Number(task.createdAt) || now();
            task.nextRetryAt = Number(task.nextRetryAt) || 0;
            task.apiTask = task.apiTask !== false;
            task.result = sanitizeTaskResult(task, task.result);
            if (task.status === 'running') {
                task.status = state.settings.autoResume ? 'queued' : 'paused';
                task.recoveredAt = now();
                task.lastError = '应用关闭或页面刷新时任务中断，已恢复到队列';
                recovered += 1;
            }
        });
        state.history = state.history.map(item => archiveTask(item));
        if (recovered) {
            state.stats.recovered += recovered;
            state.lastRecoveryAt = now();
        }
        state.tasks = state.tasks.slice(-TASK_LIMIT);
        state.history = state.history.slice(-HISTORY_LIMIT);
        return state;
    }

    function estimateTokensFromText(value) {
        const text = String(value || '');
        if (!text) return 0;
        const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
        const rest = Math.max(0, text.length - cjk);
        return Math.max(1, Math.ceil(cjk / 1.45 + rest / 4));
    }
    function estimateTokensFromChars(chars) {
        const num = Math.max(0, Number(chars) || 0);
        return Math.ceil(num / 2.1);
    }
    function getPrice(settings, apiMode, direction) {
        const pricing = settings.pricing || DEFAULT_SETTINGS.pricing;
        if (apiMode === 'embedding') return pricing.embeddingPerMillion || 0;
        if (apiMode === 'summary') return direction === 'output' ? pricing.summaryOutputPerMillion : pricing.summaryInputPerMillion;
        return direction === 'output' ? pricing.mainOutputPerMillion : pricing.mainInputPerMillion;
    }
    function calculateEstimate(settings, apiMode, inputTokens, outputTokens) {
        const input = Math.max(0, Number(inputTokens) || 0);
        const output = Math.max(0, Number(outputTokens) || 0);
        const inputCost = input * getPrice(settings, apiMode, 'input') / 1000000;
        const outputCost = apiMode === 'embedding' ? 0 : output * getPrice(settings, apiMode, 'output') / 1000000;
        return { inputTokens: input, outputTokens: output, cost: inputCost + outputCost };
    }

    const MAX_PERSISTED_RESULT_CHARS = 32000;
    const MAX_PERSISTED_CHANGED_FIELDS = 200;

    function compactRange(range) {
        if (!range || typeof range !== 'object') return null;
        const start = Number(range.start);
        const end = Number(range.end);
        return {
            start: Number.isFinite(start) ? start : 0,
            end: Number.isFinite(end) ? end : 0
        };
    }

    function compactChangedFields(fields) {
        if (!Array.isArray(fields)) return [];
        return fields.slice(0, MAX_PERSISTED_CHANGED_FIELDS).map(item => {
            if (item === null || item === undefined) return item;
            if (typeof item !== 'object') return String(item).slice(0, 300);
            return {
                templateId: item.templateId || '',
                tableId: item.tableId || '',
                rowId: item.rowId || '',
                fieldId: item.fieldId || '',
                label: String(item.label || '').slice(0, 300)
            };
        });
    }

    function sanitizeTaskResult(task, result) {
        if (!result || typeof result !== 'object') return null;
        if (task?.type === 'table_update') {
            return {
                status: result.status || '',
                changedFields: compactChangedFields(result.changedFields),
                changedFieldCount: Array.isArray(result.changedFields) ? result.changedFields.length : 0,
                batchId: result.batchId || null,
                proposedCount: Number(result.proposedCount) || 0,
                templateId: result.templateId || task.payload?.templateId || '',
                tableId: result.tableId || task.payload?.tableId || '',
                range: compactRange(result.range || task.payload?.range)
            };
        }
        let cloned;
        try { cloned = clone(result); } catch (_) { cloned = null; }
        if (!cloned) return { status: result.status || '', truncated: true };
        try {
            if (JSON.stringify(cloned).length <= MAX_PERSISTED_RESULT_CHARS) return cloned;
        } catch (_) {}
        return {
            status: result.status || '',
            summary: String(result.summary || result.message || '').slice(0, 1200),
            truncated: true
        };
    }

    function archiveTask(task) {
        const archived = { ...clone(task), payload: undefined };
        archived.result = sanitizeTaskResult(task, task?.result);
        return archived;
    }

    function getCurrentRoundId(chat) {
        return chat?.memoryTables?.lastRoundId
            || chat?.memoryTables?.engineSettings?.lastRoundId
            || chat?.memoryTables?.rounds?.slice(-1)[0]?.id
            || chat?.memoryTables?.lastRoundId
            || null;
    }
    function refreshRoundUsage(chat, state) {
        const runtimeRoundId = chat?.memoryTables?.lastRoundId || chat?.memoryTables?.rounds?.slice(-1)[0]?.id || null;
        if (state.roundUsage.roundId !== runtimeRoundId) state.roundUsage = { roundId: runtimeRoundId, apiCount: 0 };
        return state.roundUsage;
    }
    function makeIdempotencyKey(type, payload) {
        const clean = {
            type,
            chatId: payload.chatId || '',
            templateId: payload.templateId || '',
            tableId: payload.tableId || '',
            start: payload.range?.start || 0,
            end: payload.range?.end || 0,
            source: payload.source || '',
            forceReview: !!payload.forceReview,
            fingerprint: payload.fingerprint || ''
        };
        return `${type}:${hashText(JSON.stringify(clean))}`;
    }
    function activeForDedupe(task) {
        return ['queued', 'running', 'waiting_review', 'succeeded'].includes(task?.status);
    }
    function compactTasks(state) {
        const completed = state.tasks.filter(item => ['succeeded', 'cancelled'].includes(item.status));
        if (completed.length > 30) {
            const keepIds = new Set(completed.slice(-30).map(item => item.id));
            const removed = state.tasks.filter(item => ['succeeded', 'cancelled'].includes(item.status) && !keepIds.has(item.id));
            state.history.push(...removed.map(archiveTask));
            state.tasks = state.tasks.filter(item => !removed.some(old => old.id === item.id));
        }
        state.tasks = state.tasks.slice(-TASK_LIMIT);
        state.history = state.history.slice(-HISTORY_LIMIT);
    }
    function enqueue(chat, type, payload, options) {
        const state = ensureState(chat);
        const opts = options || {};
        const normalizedPayload = clone(payload || {});
        normalizedPayload.chatId ||= chat.id;
        let key = opts.idempotencyKey || makeIdempotencyKey(type, normalizedPayload);
        if (opts.force) key += `:${Date.now()}`;
        const existing = state.tasks.find(task => task.idempotencyKey === key && activeForDedupe(task));
        if (existing) {
            state.stats.deduped += 1;
            existing.lastDedupeAt = now();
            return { task: existing, deduped: true };
        }
        const apiMode = opts.apiMode || normalizedPayload.apiMode || 'main';
        const estimatedInputTokens = normalizedPayload.estimatedInputTokens
            || estimateTokensFromChars(normalizedPayload.estimatedInputChars || 0);
        const estimatedOutputTokens = normalizedPayload.estimatedOutputTokens
            || (opts.apiTask === false ? 0 : state.settings.outputTokenEstimate);
        const estimate = calculateEstimate(state.settings, apiMode, estimatedInputTokens, estimatedOutputTokens);
        const task = {
            id: createId('memory_task'),
            type,
            title: opts.title || normalizedPayload.title || type,
            status: state.settings.paused ? 'paused' : 'queued',
            priority: clamp(opts.priority, 50, 1, 100),
            idempotencyKey: key,
            payload: normalizedPayload,
            apiTask: opts.apiTask !== false,
            apiMode,
            source: normalizedPayload.source || opts.source || '',
            attempts: 0,
            maxAttempts: clamp(opts.maxAttempts, state.settings.maxAttempts, 1, 10),
            nextRetryAt: 0,
            createdAt: now(),
            startedAt: 0,
            completedAt: 0,
            reviewBatchId: null,
            lastError: '',
            lastErrorType: '',
            estimate,
            actual: null,
            result: null
        };
        state.tasks.push(task);
        state.stats.enqueued += 1;
        state.stats.estimatedInputTokens += estimate.inputTokens;
        state.stats.estimatedOutputTokens += estimate.outputTokens;
        state.stats.estimatedCost += estimate.cost;
        compactTasks(state);
        return { task, deduped: false };
    }
    function enqueueTableUpdate(chat, descriptor, options) {
        const input = descriptor || {};
        return enqueue(chat, 'table_update', {
            chatId: chat.id,
            templateId: input.templateId,
            tableId: input.tableId,
            range: input.range,
            source: input.source || 'task_queue',
            isAutoUpdate: !!input.isAutoUpdate,
            forceReview: !!input.forceReview,
            apiMode: input.apiMode || 'main',
            estimatedInputChars: input.estimatedInputChars || 0,
            fingerprint: input.fingerprint || '',
            title: input.title || '更新记忆表'
        }, {
            title: input.title || '更新记忆表',
            priority: input.priority || (input.isAutoUpdate ? 45 : 80),
            apiMode: input.apiMode || 'main',
            force: !!options?.force
        });
    }
    function enqueueRetrievalRebuild(chat, estimatedInputChars) {
        return enqueue(chat, 'retrieval_rebuild', {
            chatId: chat.id,
            source: 'manual_retrieval_rebuild',
            estimatedInputChars: estimatedInputChars || 0,
            apiMode: 'embedding',
            title: '重建记忆检索索引'
        }, { title: '重建记忆检索索引', priority: 40, apiMode: 'embedding' });
    }
    function enqueueLifecycleMaintenance(chat) {
        return enqueue(chat, 'lifecycle_maintenance', {
            chatId: chat.id,
            source: 'manual_lifecycle_maintenance',
            apiMode: 'local',
            title: '运行生命周期整理'
        }, { title: '运行生命周期整理', priority: 30, apiTask: false, apiMode: 'local' });
    }
    function registerExecutor(type, executor) {
        if (typeof executor === 'function') executors.set(type, executor);
    }
    function getTask(chat, taskId) { return ensureState(chat)?.tasks.find(item => item.id === taskId) || null; }
    function getPendingTasks(state) {
        const current = now();
        return state.tasks
            .filter(task => task.status === 'queued' && (!task.nextRetryAt || task.nextRetryAt <= current))
            .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
    }
    function isTransientError(error) {
        const type = error?.ovoType || error?.type || '';
        return ['network', 'timeout', 'rate_limit', 'server', 'endpoint'].includes(type)
            || /network|timeout|429|5\d\d|连接|超时|网络/i.test(String(error?.message || ''));
    }
    function captureDiagnostic(task) {
        const diagnostic = window.OVOAIRequestRuntime?.getLastDiagnostic?.();
        if (!diagnostic) return null;
        const inputTokens = estimateTokensFromChars(diagnostic.requestChars || 0);
        const outputTokens = estimateTokensFromChars(diagnostic.responseBytes || 0);
        return {
            requestId: diagnostic.id,
            task: diagnostic.task,
            source: diagnostic.source,
            model: diagnostic.model,
            status: diagnostic.status,
            requestChars: diagnostic.requestChars || 0,
            responseBytes: diagnostic.responseBytes || 0,
            inputTokens,
            outputTokens,
            durationMs: diagnostic.durationMs || 0,
            queueWaitMs: diagnostic.queueWaitMs || 0,
            errorType: diagnostic.errorType || '',
            capturedAt: diagnostic.completedAt || diagnostic.capturedAt || new Date().toISOString()
        };
    }
    async function persist(chat) {
        try { if (typeof saveCharacter === 'function') await saveCharacter(chat.id); } catch (error) { console.warn('[MemoryTasks] persist failed:', error); }
    }
    async function executeTask(chat, state, task, options) {
        const executor = executors.get(task.type);
        if (!executor) throw new Error(`未注册任务执行器：${task.type}`);
        const usage = refreshRoundUsage(chat, state);
        const bypassLimit = options?.ignoreRoundLimit || task.payload?.isAutoUpdate === false || task.source?.includes('manual');
        if (task.apiTask && !bypassLimit && usage.apiCount >= state.settings.perRoundApiLimit) {
            task.lastError = `本轮 API 任务已达到上限 ${state.settings.perRoundApiLimit}`;
            task.lastErrorType = 'round_limit';
            task.nextRetryAt = now() + 1000;
            return { deferred: true };
        }
        task.status = 'running';
        task.startedAt = now();
        task.attempts += 1;
        task.lastError = '';
        task.lastErrorType = '';
        state.lastRunAt = now();
        await persist(chat);
        if (task.apiTask) usage.apiCount += 1;
        const beforeDiagnosticId = task.apiTask ? window.OVOAIRequestRuntime?.getLastDiagnostic?.()?.id : null;
        try {
            const result = await executor(chat, clone(task.payload), task);
            const afterDiagnostic = task.apiTask ? captureDiagnostic(task) : null;
            task.actual = afterDiagnostic && afterDiagnostic.requestId !== beforeDiagnosticId ? afterDiagnostic : null;
            task.result = sanitizeTaskResult(task, result);
            if (result?.status === 'pending_review') {
                task.status = 'waiting_review';
                task.reviewBatchId = result.batchId || null;
            } else {
                task.status = 'succeeded';
                task.completedAt = now();
                state.stats.succeeded += 1;
            }
            await persist(chat);
            return { task, result };
        } catch (error) {
            const afterDiagnostic = task.apiTask ? captureDiagnostic(task) : null;
            task.actual = afterDiagnostic && afterDiagnostic.requestId !== beforeDiagnosticId ? afterDiagnostic : null;
            task.lastError = String(error?.message || error || '任务失败').slice(0, 1200);
            task.lastErrorType = error?.ovoType || 'error';
            const canRetry = isTransientError(error) && task.attempts < task.maxAttempts;
            if (canRetry) {
                const seconds = state.settings.retryBaseSeconds * Math.pow(2, Math.max(0, task.attempts - 1));
                task.status = 'queued';
                task.nextRetryAt = now() + seconds * 1000;
                state.stats.retried += 1;
            } else {
                task.status = 'failed';
                task.completedAt = now();
                state.stats.failed += 1;
            }
            state.lastError = task.lastError;
            await persist(chat);
            return { task, error, retryScheduled: canRetry };
        }
    }
    async function process(chat, options) {
        if (!chat) return { status: 'noop', processed: 0 };
        const state = ensureState(chat);
        if (!state.settings.enabled) return { status: 'disabled', processed: 0 };
        if (state.settings.paused && !options?.force) return { status: 'paused', processed: 0 };
        if (runningChats.has(chat.id)) return { status: 'running', processed: 0 };
        runningChats.add(chat.id);
        let processed = 0;
        const results = [];
        try {
            const limit = clamp(options?.maxTasks, state.settings.maxTasksPerCycle, 1, 50);
            const specificTaskId = options?.taskId || null;
            while (processed < limit) {
                let task = specificTaskId ? state.tasks.find(item => item.id === specificTaskId && ['queued', 'paused', 'failed'].includes(item.status)) : getPendingTasks(state)[0];
                if (!task) break;
                if (task.status === 'paused' || task.status === 'failed') {
                    task.status = 'queued';
                    task.nextRetryAt = 0;
                }
                const result = await executeTask(chat, state, task, options || {});
                results.push(result);
                if (!result?.deferred) processed += 1;
                if (specificTaskId || result?.deferred) break;
            }
            compactTasks(state);
            await persist(chat);
            return { status: 'success', processed, results };
        } finally {
            runningChats.delete(chat.id);
        }
    }
    function getRuntimeState() {
        return {
            running: runningChats.size,
            runningChatIds: Array.from(runningChats)
        };
    }

    function setPaused(chat, paused) {
        const state = ensureState(chat);
        state.settings.paused = !!paused;
        state.tasks.forEach(task => {
            if (task.status === 'queued' && paused) task.status = 'paused';
            else if (task.status === 'paused' && !paused) task.status = 'queued';
        });
        return state.settings.paused;
    }
    function retryFailed(chat) {
        const state = ensureState(chat);
        let count = 0;
        state.tasks.forEach(task => {
            if (task.status !== 'failed') return;
            task.status = state.settings.paused ? 'paused' : 'queued';
            task.nextRetryAt = 0;
            task.lastError = '';
            task.lastErrorType = '';
            count += 1;
        });
        return count;
    }
    function cancelTask(chat, taskId) {
        const task = getTask(chat, taskId);
        if (!task || !['queued', 'paused', 'failed'].includes(task.status)) return false;
        task.status = 'cancelled';
        task.completedAt = now();
        return true;
    }
    function clearCompleted(chat) {
        const state = ensureState(chat);
        const removed = state.tasks.filter(item => ['succeeded', 'cancelled'].includes(item.status));
        state.history.push(...removed.map(archiveTask));
        state.tasks = state.tasks.filter(item => !['succeeded', 'cancelled'].includes(item.status));
        compactTasks(state);
        return removed.length;
    }
    function resolveReviewBatch(chat, batchId, outcome) {
        const state = ensureState(chat);
        const task = state.tasks.find(item => item.reviewBatchId === batchId && item.status === 'waiting_review');
        if (!task) return null;
        if (outcome === 'cancelled') task.status = 'cancelled';
        else task.status = 'succeeded';
        task.reviewOutcome = outcome || 'applied';
        task.completedAt = now();
        if (task.status === 'succeeded') state.stats.succeeded += 1;
        return task;
    }
    function updateSettings(chat, patch) {
        const state = ensureState(chat);
        const next = { ...state.settings, ...(patch || {}) };
        if (patch?.pricing) next.pricing = { ...state.settings.pricing, ...patch.pricing };
        state.settings = normalizeSettings(next);
        return state.settings;
    }
    function getCounts(chat) {
        const tasks = ensureState(chat)?.tasks || [];
        const counts = { queued: 0, running: 0, waiting_review: 0, failed: 0, succeeded: 0, paused: 0, cancelled: 0 };
        tasks.forEach(task => { counts[task.status] = (counts[task.status] || 0) + 1; });
        return counts;
    }
    function getPendingCount(chat) {
        const c = getCounts(chat);
        return c.queued + c.running + c.waiting_review + c.failed + c.paused;
    }
    function statusLabel(status) {
        return ({ queued: '排队中', running: '执行中', waiting_review: '待审核', failed: '失败', succeeded: '完成', paused: '已暂停', cancelled: '已取消' })[status] || status;
    }
    function formatNumber(value) { return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(Number(value) || 0); }
    function getSessionDiagnostics() {
        const list = window.OVOAIRequestRuntime?.getRecentDiagnostics?.() || [];
        return list.filter(item => item && (String(item.task || '').includes('memory') || String(item.source || '').includes('memory'))).slice(0, 8);
    }
    function renderTask(task) {
        const range = task.payload?.range;
        const actual = task.actual;
        return `<article class="memory-task-card status-${escapeHtml(task.status)}">
            <div class="memory-task-card-head"><div><strong>${escapeHtml(task.title || task.type)}</strong><small>${statusLabel(task.status)} · 尝试 ${task.attempts}/${task.maxAttempts}${range ? ` · 消息 ${range.start}–${range.end}` : ''}</small></div><span>${task.apiMode === 'summary' ? '总结 API' : task.apiMode === 'embedding' ? '向量 API' : task.apiMode === 'local' ? '本地' : '主 API'}</span></div>
            ${task.lastError ? `<div class="memory-task-error">${escapeHtml(task.lastError)}</div>` : ''}
            <div class="memory-task-metrics">估算输入 ${formatNumber(task.estimate?.inputTokens)} token · 输出 ${formatNumber(task.estimate?.outputTokens)} token · 估算费用 ${formatNumber(task.estimate?.cost)}${actual ? ` · 实际请求 ${formatNumber(actual.requestChars)} 字符 · ${formatNumber(actual.durationMs)} ms` : ''}</div>
            <div class="memory-task-actions">
                ${['failed', 'paused', 'queued'].includes(task.status) ? `<button class="btn btn-small btn-primary" data-action="task-run-one" data-task-id="${escapeHtml(task.id)}">立即执行</button>` : ''}
                ${['queued', 'paused', 'failed'].includes(task.status) ? `<button class="btn btn-small btn-neutral" data-action="task-cancel" data-task-id="${escapeHtml(task.id)}">取消</button>` : ''}
                ${task.status === 'waiting_review' ? `<button class="btn btn-small btn-secondary" data-action="task-open-review" data-batch-id="${escapeHtml(task.reviewBatchId || '')}">前往审核</button>` : ''}
            </div>
        </article>`;
    }
    function renderView(chat) {
        const state = ensureState(chat);
        const counts = getCounts(chat);
        const settings = state.settings;
        const tasks = [...state.tasks].sort((a, b) => {
            const order = { running: 0, waiting_review: 1, queued: 2, failed: 3, paused: 4, succeeded: 5, cancelled: 6 };
            return (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.createdAt - a.createdAt;
        });
        const diagnostics = getSessionDiagnostics();
        return `<div class="memory-task-page">
            <div class="memory-task-head"><div><h2>任务队列与成本</h2><p>可恢复的顺序任务队列。主聊天仍为交互式即时请求，不会被记忆后台任务阻塞。</p></div><span>${getPendingCount(chat)} 个待处理</span></div>
            <div class="memory-task-stat-grid">
                <span>排队<strong>${counts.queued + counts.paused}</strong></span><span>执行<strong>${counts.running}</strong></span><span>待审核<strong>${counts.waiting_review}</strong></span><span>失败<strong>${counts.failed}</strong></span><span>完成<strong>${counts.succeeded}</strong></span>
            </div>
            <section class="memory-task-settings">
                <h3>执行策略</h3>
                <div class="memory-task-setting-grid">
                    <label>单轮最多任务<input type="number" min="1" max="20" data-task-setting="maxTasksPerCycle" value="${settings.maxTasksPerCycle}"></label>
                    <label>失败最多尝试<input type="number" min="1" max="10" data-task-setting="maxAttempts" value="${settings.maxAttempts}"></label>
                    <label>重试基础秒数<input type="number" min="1" max="3600" data-task-setting="retryBaseSeconds" value="${settings.retryBaseSeconds}"></label>
                    <label>每聊天轮 API 上限<input type="number" min="1" max="20" data-task-setting="perRoundApiLimit" value="${settings.perRoundApiLimit}"></label>
                    <label>预计输出 token<input type="number" min="100" max="10000" data-task-setting="outputTokenEstimate" value="${settings.outputTokenEstimate}"></label>
                    <label>刷新后自动恢复<select data-task-setting="autoResume"><option value="true" ${settings.autoResume ? 'selected' : ''}>是</option><option value="false" ${!settings.autoResume ? 'selected' : ''}>否</option></select></label>
                </div>
                <details><summary>自定义价格（每百万 token，默认 0，仅用于估算）</summary><div class="memory-task-setting-grid">
                    <label>主 API 输入<input type="number" min="0" step="0.01" data-task-price="mainInputPerMillion" value="${settings.pricing.mainInputPerMillion}"></label>
                    <label>主 API 输出<input type="number" min="0" step="0.01" data-task-price="mainOutputPerMillion" value="${settings.pricing.mainOutputPerMillion}"></label>
                    <label>总结 API 输入<input type="number" min="0" step="0.01" data-task-price="summaryInputPerMillion" value="${settings.pricing.summaryInputPerMillion}"></label>
                    <label>总结 API 输出<input type="number" min="0" step="0.01" data-task-price="summaryOutputPerMillion" value="${settings.pricing.summaryOutputPerMillion}"></label>
                    <label>向量 API<input type="number" min="0" step="0.01" data-task-price="embeddingPerMillion" value="${settings.pricing.embeddingPerMillion}"></label>
                </div></details>
                <div class="memory-task-toolbar">
                    <button class="btn btn-small btn-primary" data-action="task-run-queue">运行队列</button>
                    <button class="btn btn-small btn-secondary" data-action="task-toggle-pause">${settings.paused ? '恢复队列' : '暂停队列'}</button>
                    <button class="btn btn-small btn-secondary" data-action="task-retry-failed">重试失败</button>
                    <button class="btn btn-small btn-secondary" data-action="task-enqueue-retrieval">加入检索重建</button>
                    <button class="btn btn-small btn-secondary" data-action="task-enqueue-lifecycle">加入生命周期整理</button>
                    <button class="btn btn-small btn-neutral" data-action="task-clear-completed">清除已完成</button>
                </div>
                <div class="memory-task-summary">累计入队 ${state.stats.enqueued} · 去重 ${state.stats.deduped} · 自动重试 ${state.stats.retried} · 中断恢复 ${state.stats.recovered} · 估算输入 ${formatNumber(state.stats.estimatedInputTokens)} token · 估算费用 ${formatNumber(state.stats.estimatedCost)}</div>
            </section>
            <section><h3>当前任务</h3>${tasks.length ? `<div class="memory-task-list">${tasks.map(renderTask).join('')}</div>` : '<div class="memory-review-empty"><p>当前没有任务。</p></div>'}</section>
            <section class="memory-task-session"><h3>本会话最近记忆 API 诊断</h3>${diagnostics.length ? `<div class="memory-task-diagnostic-list">${diagnostics.map(item => `<div><strong>${escapeHtml(item.task || 'AI 请求')}</strong><span>${escapeHtml(item.model || '')} · ${item.ok ? '成功' : '失败'} · ${formatNumber(item.requestChars)} 字符 · ${formatNumber(item.durationMs)} ms${item.errorType ? ` · ${escapeHtml(item.errorType)}` : ''}</span></div>`).join('')}</div>` : '<p>暂无本会话诊断。</p>'}</section>
        </div>`;
    }

    const api = {
        VERSION,
        ensureState,
        updateSettings,
        enqueue,
        enqueueTableUpdate,
        enqueueRetrievalRebuild,
        enqueueLifecycleMaintenance,
        registerExecutor,
        process,
        setPaused,
        retryFailed,
        cancelTask,
        clearCompleted,
        resolveReviewBatch,
        getTask,
        getCounts,
        getPendingCount,
        getRuntimeState,
        estimateTokensFromText,
        estimateTokensFromChars,
        renderView
    };

    if (Kernel) Kernel.register('tasks', api, { legacyGlobal: 'MemoryTableTasks' });
    else window.MemoryTableTasks = api;
})();
