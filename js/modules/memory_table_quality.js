// 结构化记忆 V2.8：质量评估、固定测试集、版本回归与趋势报告
(function () {
    'use strict';

    const Kernel = window.OvoMemoryKernel || null;
    const Core = Kernel?.core;
    if (!Core) throw new Error('记忆内核未加载');
    const clone = Core.clone;
    const clamp = Core.clamp;
    const createId = Core.createId;
    const unique = Core.unique;
    const escapeHtml = Core.escapeHtml;

    const VERSION = '2.8';
    const MAX_RUNS = 40;
    const DEFAULT_SETTINGS = Object.freeze({
        enabled: true,
        useCurrentRetrievalMode: false,
        autoRunOnVersionChange: true,
        minimumExpectedHitRate: 0.72,
        maximumRuleOutsideRate: 0.35,
        maximumForbiddenLeakRate: 0,
        maximumUnsafeLeakRate: 0,
        maximumDuplicateCandidateRate: 0.12,
        duplicateSimilarityThreshold: 0.84,
        maximumAveragePromptChars: 3600,
        minimumFeedbackPrecision: 0.6,
        regressionTolerance: 0.04,
        maxDuplicatePairs: 40,
        maxTestCases: 30
    });

    const DEFAULT_TEST_CASES = Object.freeze([
        {
            id: 'quality_sleep_health',
            name: '睡眠与身体状态',
            enabled: true,
            query: '我最近为什么总是没有精神？结合最近的睡眠、身体和健康情况看看。',
            expectedTopics: ['睡眠', '健康'],
            expectedScenes: ['健康追踪'],
            expectedEffects: [],
            expectedTableIds: [],
            expectedRowIds: [],
            forbiddenTopics: [],
            forbiddenEffects: ['candidate'],
            minimumExpectedHits: 1,
            expectNoRows: false
        },
        {
            id: 'quality_work_project',
            name: '工作与项目连续性',
            enabled: true,
            query: '继续修改章鱼机记忆系统的代码和项目计划，先回顾我之前在工作与项目上的想法。',
            expectedTopics: ['工作'],
            expectedScenes: ['任务执行', '计划制定'],
            expectedEffects: [],
            expectedTableIds: [],
            expectedRowIds: [],
            forbiddenTopics: [],
            forbiddenEffects: ['candidate'],
            minimumExpectedHits: 1,
            expectNoRows: false
        },
        {
            id: 'quality_relationship_emotion',
            name: '关系与情绪背景',
            enabled: true,
            query: '我最近在人际关系和情绪上有哪些变化？请结合相关经历，不要引用无关的工作记录。',
            expectedTopics: ['关系', '情绪'],
            expectedScenes: ['关系讨论', '情绪支持'],
            expectedEffects: [],
            expectedTableIds: [],
            expectedRowIds: [],
            forbiddenTopics: [],
            forbiddenEffects: ['candidate'],
            minimumExpectedHits: 1,
            expectNoRows: false
        },
        {
            id: 'quality_unrelated_smalltalk',
            name: '无关闲聊抑制',
            enabled: true,
            query: '给我讲一个和海边有关的冷笑话。',
            expectedTopics: [],
            expectedScenes: [],
            expectedEffects: [],
            expectedTableIds: [],
            expectedRowIds: [],
            forbiddenTopics: ['睡眠', '健康', '工作', '关系'],
            forbiddenEffects: ['reminder', 'candidate'],
            minimumExpectedHits: 0,
            expectNoRows: true
        }
    ]);

    function normalizeSettings(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            enabled: source.enabled !== false,
            useCurrentRetrievalMode: source.useCurrentRetrievalMode === true,
            autoRunOnVersionChange: source.autoRunOnVersionChange !== false,
            minimumExpectedHitRate: clamp(source.minimumExpectedHitRate, DEFAULT_SETTINGS.minimumExpectedHitRate, 0, 1),
            maximumRuleOutsideRate: clamp(source.maximumRuleOutsideRate, DEFAULT_SETTINGS.maximumRuleOutsideRate, 0, 1),
            maximumForbiddenLeakRate: clamp(source.maximumForbiddenLeakRate, DEFAULT_SETTINGS.maximumForbiddenLeakRate, 0, 1),
            maximumUnsafeLeakRate: clamp(source.maximumUnsafeLeakRate, DEFAULT_SETTINGS.maximumUnsafeLeakRate, 0, 1),
            maximumDuplicateCandidateRate: clamp(source.maximumDuplicateCandidateRate, DEFAULT_SETTINGS.maximumDuplicateCandidateRate, 0, 1),
            duplicateSimilarityThreshold: clamp(source.duplicateSimilarityThreshold, DEFAULT_SETTINGS.duplicateSimilarityThreshold, 0.5, 1),
            maximumAveragePromptChars: Math.round(clamp(source.maximumAveragePromptChars, DEFAULT_SETTINGS.maximumAveragePromptChars, 200, 20000)),
            minimumFeedbackPrecision: clamp(source.minimumFeedbackPrecision, DEFAULT_SETTINGS.minimumFeedbackPrecision, 0, 1),
            regressionTolerance: clamp(source.regressionTolerance, DEFAULT_SETTINGS.regressionTolerance, 0, 0.5),
            maxDuplicatePairs: Math.round(clamp(source.maxDuplicatePairs, DEFAULT_SETTINGS.maxDuplicatePairs, 5, 300)),
            maxTestCases: Math.round(clamp(source.maxTestCases, DEFAULT_SETTINGS.maxTestCases, 1, 100))
        };
    }

    function normalizeTestCase(raw, index = 0) {
        const source = raw && typeof raw === 'object' ? raw : {};
        return {
            id: String(source.id || createId('quality_case')),
            name: String(source.name || `测试 ${index + 1}`).trim() || `测试 ${index + 1}`,
            enabled: source.enabled !== false,
            query: String(source.query || '').trim(),
            expectedTopics: unique(source.expectedTopics),
            expectedScenes: unique(source.expectedScenes),
            expectedEffects: unique(source.expectedEffects),
            expectedTableIds: unique(source.expectedTableIds),
            expectedRowIds: unique(source.expectedRowIds),
            forbiddenTopics: unique(source.forbiddenTopics),
            forbiddenEffects: unique(source.forbiddenEffects),
            minimumExpectedHits: Math.round(clamp(source.minimumExpectedHits, 1, 0, 50)),
            expectNoRows: source.expectNoRows === true
        };
    }

    function ensureState(chat) {
        if (!chat) return null;
        chat.memoryTables ||= {};
        let state = chat.memoryTables.quality;
        if (!state || typeof state !== 'object') state = {};
        state.schemaVersion = VERSION;
        state.settings = normalizeSettings(state.settings);
        const originalCases = Array.isArray(state.testCases) && state.testCases.length ? state.testCases : clone(DEFAULT_TEST_CASES);
        state.testCases = originalCases.slice(0, state.settings.maxTestCases).map(normalizeTestCase);
        state.runs = Array.isArray(state.runs) ? state.runs.slice(-MAX_RUNS) : [];
        state.baselineRunId = typeof state.baselineRunId === 'string' ? state.baselineRunId : '';
        state.lastRunAt = Number(state.lastRunAt) || 0;
        state.lastError = typeof state.lastError === 'string' ? state.lastError : '';
        state.lastExportAt = Number(state.lastExportAt) || 0;
        state.lastEvaluatedSchemaVersion = typeof state.lastEvaluatedSchemaVersion === 'string' ? state.lastEvaluatedSchemaVersion : '';
        state.pendingAutoRun = state.settings.autoRunOnVersionChange && state.lastEvaluatedSchemaVersion !== VERSION && state.runs.length === 0;
        state.autoRunQueuedAt = Number(state.autoRunQueuedAt) || 0;
        chat.memoryTables.quality = state;
        return state;
    }

    function getBoundTemplates(chat) {
        const ids = new Set(chat?.memoryTables?.boundTemplateIds || []);
        return (window.db?.memoryTableTemplates || []).filter(template => ids.has(template.id));
    }

    function isRowsTable(table) {
        return table?.mode === 'rows';
    }

    function getRows(chat, templateId, tableId) {
        const rows = chat?.memoryTables?.data?.[templateId]?.[tableId]?.__rows;
        return Array.isArray(rows) ? rows : [];
    }

    function fieldValueText(value) {
        if (Array.isArray(value)) return value.join('、');
        if (value === true) return '是';
        if (value === false) return '否';
        return String(value ?? '').trim();
    }

    function rowText(table, row) {
        return (table?.columns || []).map(field => {
            const value = fieldValueText(row?.cells?.[field.id]);
            return value ? `${field.key}: ${value}` : '';
        }).filter(Boolean).join('\n');
    }

    function rowToItem(table, row, rowIndex) {
        const text = rowText(table, row);
        const meta = row?.meta || {};
        const lifecycle = meta.lifecycle || {};
        const status = lifecycle.status || 'active';
        return {
            id: row.id,
            row,
            rowIndex,
            table,
            searchText: meta.searchText || text,
            text,
            updatedAt: Number(meta.updatedAt || meta.lastMentionedAt || meta.createdAt) || 0,
            importance: Number(meta.importance) || 50,
            confidence: Number(meta.confidence) || 50,
            pinned: meta.pinned === true,
            active: ['active', 'uncertain'].includes(status)
        };
    }

    function tablePolicy(table) {
        const normalized = window.MemoryTablePolicy?.normalizeTablePolicy?.(table);
        return normalized || {
            memoryLayer: table.memoryLayer || 'long',
            injectionPolicy: table.injectionPolicy || { mode: 'relevant', topK: 5, threshold: 0.15, budget: 1200 }
        };
    }

    function isLiveTable(table) {
        if (window.MemoryTableSidecar?.isLiveTable) return window.MemoryTableSidecar.isLiveTable(table);
        const role = window.MemoryTablePolicy?.normalizeTablePolicy?.(table)?.systemRole || '';
        return role === 'current_state' || role === 'tasks';
    }

    function buildGroups(chat) {
        const groups = [];
        getBoundTemplates(chat).forEach(template => {
            (template.tables || []).forEach(table => {
                if (!isRowsTable(table) || isLiveTable(table)) return;
                const policy = tablePolicy(table).injectionPolicy;
                if (policy.mode !== 'relevant') return;
                groups.push({
                    key: `${template.id}::${table.id}`,
                    templateId: template.id,
                    tableId: table.id,
                    templateName: template.name,
                    tableName: table.name,
                    policy,
                    items: getRows(chat, template.id, table.id).map((row, index) => rowToItem(table, row, index))
                });
            });
        });
        return groups;
    }

    function getRowLookup(groups) {
        const lookup = new Map();
        groups.forEach(group => group.items.forEach(item => lookup.set(`${group.key}::${item.id}`, { group, item })));
        return lookup;
    }

    function intersects(a, b) {
        const target = new Set((b || []).map(item => String(item).trim()).filter(Boolean));
        return (a || []).some(value => target.has(String(value).trim()));
    }

    function itemMatchesSelectors(hit, test, prefix) {
        const tags = hit.tags || {};
        const topics = tags.topic || [];
        const scenes = tags.scene || [];
        const effects = unique([hit.effectMode || tags.effect || '']);
        const tableIds = unique([hit.tableId || '']);
        const rowIds = unique([hit.id || '']);
        const selectors = {
            topics: test[`${prefix}Topics`] || [],
            scenes: test[`${prefix}Scenes`] || [],
            effects: test[`${prefix}Effects`] || [],
            tableIds: test[`${prefix}TableIds`] || [],
            rowIds: test[`${prefix}RowIds`] || []
        };
        const hasAnySelector = Object.values(selectors).some(list => list.length);
        if (!hasAnySelector) return false;
        return intersects(topics, selectors.topics)
            || intersects(scenes, selectors.scenes)
            || intersects(effects, selectors.effects)
            || intersects(tableIds, selectors.tableIds)
            || intersects(rowIds, selectors.rowIds);
    }

    function unsafeReasons(item) {
        const meta = item?.row?.meta || {};
        const lifecycle = meta.lifecycle || {};
        const usePolicy = meta.usePolicy || {};
        const effect = meta.tagBundle?.effect || '';
        const reasons = [];
        if (['expired', 'archived', 'superseded', 'conflicting'].includes(lifecycle.status)) reasons.push(`生命周期 ${lifecycle.status}`);
        if (usePolicy.paused) reasons.push('已暂停');
        if (usePolicy.injectionEnabled === false) reasons.push('禁止注入');
        if (effect === 'candidate') reasons.push('未审核候选');
        if ((meta.relations?.conflictsWith || []).length) reasons.push('存在冲突关系');
        return reasons;
    }

    function flattenHits(diagnostic) {
        const hits = [];
        (diagnostic?.tables || []).forEach(group => {
            const [templateId, tableId] = String(group.key || '').split('::');
            (group.selected || []).forEach(item => hits.push({
                ...item,
                templateId,
                tableId,
                templateName: group.templateName || '',
                tableName: group.tableName || ''
            }));
        });
        return hits;
    }

    async function runTestCase(chat, groups, lookup, test, settings) {
        const runtime = window.MemoryTablePolicy?.ensureRuntimeState?.(chat);
        const engine = clone(runtime?.engineSettings || {});
        if (!settings.useCurrentRetrievalMode) engine.retrievalMode = 'keyword';
        const prepared = await window.MemoryTableRetrieval.prepareGroups(chat, groups, test.query, engine, { dryRun: true });
        const hits = flattenHits(prepared.diagnostic);
        let expectedMatches = 0;
        let forbiddenMatches = 0;
        let ruleOutside = 0;
        let unsafe = 0;
        const selected = hits.map(hit => {
            const expected = itemMatchesSelectors(hit, test, 'expected');
            const forbidden = itemMatchesSelectors(hit, test, 'forbidden');
            const linked = lookup.get(`${hit.templateId}::${hit.tableId}::${hit.id}`);
            const unsafeList = unsafeReasons(linked?.item);
            if (expected) expectedMatches += 1;
            if (forbidden) forbiddenMatches += 1;
            if (unsafeList.length) unsafe += 1;
            const hasExpectedRules = [test.expectedTopics, test.expectedScenes, test.expectedEffects, test.expectedTableIds, test.expectedRowIds].some(list => list.length);
            if ((test.expectNoRows && hits.length) || (hasExpectedRules && !expected)) ruleOutside += 1;
            return { ...hit, expected, forbidden, unsafeReasons: unsafeList };
        });
        const required = test.expectNoRows ? 0 : Math.max(0, test.minimumExpectedHits || 0);
        const expectedPass = test.expectNoRows ? selected.length === 0 : (required === 0 || expectedMatches >= required);
        const pass = expectedPass && forbiddenMatches === 0 && unsafe === 0;
        const rawPromptChars = selected.reduce((sum, item) => sum + String(item.text || '').length + String(item.directive || '').length + 26, 0);
        const promptChars = Math.min(rawPromptChars, Math.max(200, Number(engine.globalInjectionBudget) || 3600));
        return {
            id: test.id,
            name: test.name,
            query: test.query,
            actualMode: prepared.diagnostic.actualMode,
            modeReason: prepared.diagnostic.modeReason,
            selectedCount: selected.length,
            expectedMatches,
            forbiddenMatches,
            ruleOutside,
            unsafe,
            promptChars,
            expectedPass,
            pass,
            selected,
            queryContext: prepared.diagnostic.queryContext || {},
            blocked: (prepared.diagnostic.tables || []).flatMap(group => group.blocked || [])
        };
    }

    function normalizeForDuplicate(text) {
        return String(text || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 2000);
    }

    function duplicateScore(a, b) {
        const left = normalizeForDuplicate(a);
        const right = normalizeForDuplicate(b);
        if (!left || !right) return 0;
        if (left === right) return 1;
        const policy = window.MemoryTablePolicy;
        if (!policy?.computeLexicalScore) return 0;
        const one = policy.computeLexicalScore(a, b);
        const two = policy.computeLexicalScore(b, a);
        return (one + two) / 2;
    }

    function scanDuplicateCandidates(groups, settings) {
        const pairs = [];
        let rowCount = 0;
        groups.forEach(group => {
            rowCount += group.items.length;
            const list = group.items;
            for (let i = 0; i < list.length; i += 1) {
                for (let j = i + 1; j < list.length; j += 1) {
                    const score = duplicateScore(list[i].searchText, list[j].searchText);
                    if (score < settings.duplicateSimilarityThreshold) continue;
                    pairs.push({
                        tableId: group.tableId,
                        tableName: group.tableName,
                        rowIdA: list[i].id,
                        rowIdB: list[j].id,
                        score,
                        textA: String(list[i].text || '').slice(0, 240),
                        textB: String(list[j].text || '').slice(0, 240)
                    });
                }
            }
        });
        pairs.sort((a, b) => b.score - a.score);
        return {
            rowCount,
            pairCount: pairs.length,
            rate: rowCount ? Math.min(1, pairs.length / rowCount) : 0,
            pairs: pairs.slice(0, settings.maxDuplicatePairs)
        };
    }

    function collectOperationalMetrics(chat) {
        const taskState = chat?.memoryTables?.taskQueue || {};
        const tasks = [...(taskState.tasks || []), ...(taskState.history || [])].slice(-80);
        const terminal = tasks.filter(item => ['succeeded', 'failed'].includes(item.status));
        const failed = terminal.filter(item => item.status === 'failed').length;
        const feedbackState = chat?.memoryTables?.feedback || {};
        const fstats = feedbackState.stats || {};
        const feedbackTotal = (fstats.helpful || 0) + (fstats.irrelevant || 0) + (fstats.outdated || 0) + (fstats.inaccurate || 0);
        const reviewPending = window.MemoryTableReview?.getPendingCount?.(chat) || 0;
        return {
            taskFailureRate: terminal.length ? failed / terminal.length : 0,
            taskTerminalCount: terminal.length,
            taskFailedCount: failed,
            estimatedInputTokens: Number(taskState.stats?.estimatedInputTokens) || 0,
            estimatedOutputTokens: Number(taskState.stats?.estimatedOutputTokens) || 0,
            estimatedCost: Number(taskState.stats?.estimatedCost) || 0,
            feedbackPrecision: feedbackTotal ? (Number(fstats.helpful) || 0) / feedbackTotal : null,
            feedbackSampleCount: feedbackTotal,
            feedbackHelpful: Number(fstats.helpful) || 0,
            feedbackNegative: (Number(fstats.irrelevant) || 0) + (Number(fstats.outdated) || 0) + (Number(fstats.inaccurate) || 0),
            pendingReviewCount: reviewPending
        };
    }

    function calculateSummary(results, duplicate, operational, settings) {
        const expectedTests = results.filter(item => !item.queryContext?.disabled && !item.expectNoRows && item.expectedPass !== null);
        const expectedDenominator = results.filter(item => !item.expectNoRows && item.expectedMatches !== undefined && item.expectedPass !== null && item.selected !== undefined && item.id).filter(item => item.expectedMatches > 0 || item.expectedPass === false || item.selectedCount >= 0);
        const expectedHitRate = expectedDenominator.length ? expectedDenominator.filter(item => item.expectedPass).length / expectedDenominator.length : 1;
        const totalSelected = results.reduce((sum, item) => sum + item.selectedCount, 0);
        const totalRuleOutside = results.reduce((sum, item) => sum + item.ruleOutside, 0);
        const totalForbidden = results.reduce((sum, item) => sum + item.forbiddenMatches, 0);
        const totalUnsafe = results.reduce((sum, item) => sum + item.unsafe, 0);
        const averagePromptChars = results.length ? results.reduce((sum, item) => sum + item.promptChars, 0) / results.length : 0;
        const ruleOutsideRate = totalSelected ? totalRuleOutside / totalSelected : 0;
        const forbiddenLeakRate = totalSelected ? totalForbidden / totalSelected : 0;
        const unsafeLeakRate = totalSelected ? totalUnsafe / totalSelected : 0;
        const feedbackPrecision = operational.feedbackPrecision;
        const checks = {
            expectedHitRate: expectedHitRate >= settings.minimumExpectedHitRate,
            ruleOutsideRate: ruleOutsideRate <= settings.maximumRuleOutsideRate,
            forbiddenLeakRate: forbiddenLeakRate <= settings.maximumForbiddenLeakRate,
            unsafeLeakRate: unsafeLeakRate <= settings.maximumUnsafeLeakRate,
            duplicateCandidateRate: duplicate.rate <= settings.maximumDuplicateCandidateRate,
            averagePromptChars: averagePromptChars <= settings.maximumAveragePromptChars,
            feedbackPrecision: feedbackPrecision === null || operational.feedbackSampleCount < 5 || feedbackPrecision >= settings.minimumFeedbackPrecision,
            taskFailureRate: operational.taskFailureRate <= 0.15
        };
        const score = Math.round(100 * (
            expectedHitRate * 0.28
            + (1 - Math.min(1, ruleOutsideRate)) * 0.18
            + (1 - Math.min(1, forbiddenLeakRate * 4)) * 0.12
            + (1 - Math.min(1, unsafeLeakRate * 4)) * 0.17
            + (1 - Math.min(1, duplicate.rate)) * 0.10
            + (1 - Math.min(1, averagePromptChars / Math.max(1, settings.maximumAveragePromptChars * 2))) * 0.08
            + (feedbackPrecision === null ? 0.5 : feedbackPrecision) * 0.04
            + (1 - Math.min(1, operational.taskFailureRate)) * 0.03
        ));
        const failedChecks = Object.entries(checks).filter(([, pass]) => !pass).map(([key]) => key);
        return {
            score,
            status: failedChecks.length === 0 ? 'pass' : (score >= 68 ? 'warn' : 'fail'),
            checks,
            failedChecks,
            testCount: results.length,
            passedTests: results.filter(item => item.pass).length,
            expectedHitRate,
            ruleOutsideRate,
            forbiddenLeakRate,
            unsafeLeakRate,
            duplicateCandidateRate: duplicate.rate,
            duplicatePairCount: duplicate.pairCount,
            averagePromptChars,
            maximumPromptChars: results.reduce((max, item) => Math.max(max, item.promptChars), 0),
            totalSelected,
            feedbackPrecision,
            taskFailureRate: operational.taskFailureRate
        };
    }

    function compareWithBaseline(run, baseline, tolerance) {
        if (!baseline) return null;
        const current = run.summary;
        const old = baseline.summary;
        const deltas = {
            score: current.score - old.score,
            expectedHitRate: current.expectedHitRate - old.expectedHitRate,
            ruleOutsideRate: current.ruleOutsideRate - old.ruleOutsideRate,
            forbiddenLeakRate: current.forbiddenLeakRate - old.forbiddenLeakRate,
            unsafeLeakRate: current.unsafeLeakRate - old.unsafeLeakRate,
            duplicateCandidateRate: current.duplicateCandidateRate - old.duplicateCandidateRate,
            averagePromptChars: current.averagePromptChars - old.averagePromptChars
        };
        const regressions = [];
        if (deltas.expectedHitRate < -tolerance) regressions.push('命中率下降');
        if (deltas.ruleOutsideRate > tolerance) regressions.push('规则外召回上升');
        if (deltas.forbiddenLeakRate > tolerance) regressions.push('禁止项泄漏上升');
        if (deltas.unsafeLeakRate > tolerance) regressions.push('不安全记忆泄漏上升');
        if (deltas.duplicateCandidateRate > tolerance) regressions.push('相似记录候选率上升');
        if (old.averagePromptChars > 0 && deltas.averagePromptChars / old.averagePromptChars > 0.2) regressions.push('Prompt 字符显著上升');
        return { baselineRunId: baseline.id, deltas, regressions, pass: regressions.length === 0 };
    }

    async function runSuite(chat, options = {}) {
        const state = ensureState(chat);
        const settings = normalizeSettings({ ...state.settings, ...(options.settings || {}) });
        const cases = state.testCases.filter(item => item.enabled && item.query.trim());
        if (!cases.length) throw new Error('没有启用的质量测试用例');
        if (!window.MemoryTableRetrieval || !window.MemoryTablePolicy) throw new Error('检索模块未加载');
        const groups = buildGroups(chat);
        const lookup = getRowLookup(groups);
        const results = [];
        for (const test of cases) {
            const result = await runTestCase(chat, groups, lookup, test, settings);
            result.expectNoRows = test.expectNoRows;
            results.push(result);
        }
        const duplicate = scanDuplicateCandidates(groups, settings);
        const operational = collectOperationalMetrics(chat);
        const summary = calculateSummary(results, duplicate, operational, settings);
        const run = {
            id: createId('quality_run'),
            version: VERSION,
            createdAt: Date.now(),
            retrievalMode: settings.useCurrentRetrievalMode ? 'current' : 'keyword',
            settings: clone(settings),
            results,
            duplicate,
            operational,
            summary,
            comparison: null
        };
        const baseline = state.runs.find(item => item.id === state.baselineRunId) || null;
        run.comparison = compareWithBaseline(run, baseline, settings.regressionTolerance);
        state.runs.push(run);
        state.runs = state.runs.slice(-MAX_RUNS);
        state.lastRunAt = run.createdAt;
        state.lastError = '';
        state.lastEvaluatedSchemaVersion = VERSION;
        state.pendingAutoRun = false;
        state.autoRunQueuedAt = 0;
        if (!state.baselineRunId && options.setInitialBaseline !== false) state.baselineRunId = run.id;
        return run;
    }

    function updateSettings(chat, patch) {
        const state = ensureState(chat);
        state.settings = normalizeSettings({ ...state.settings, ...(patch || {}) });
        return state.settings;
    }

    function updateTestCase(chat, caseId, patch) {
        const state = ensureState(chat);
        const index = state.testCases.findIndex(item => item.id === caseId);
        if (index < 0) return null;
        state.testCases[index] = normalizeTestCase({ ...state.testCases[index], ...(patch || {}) }, index);
        return state.testCases[index];
    }

    function addTestCase(chat) {
        const state = ensureState(chat);
        if (state.testCases.length >= state.settings.maxTestCases) return null;
        const test = normalizeTestCase({
            name: `自定义测试 ${state.testCases.length + 1}`,
            query: '',
            expectedTopics: [], expectedScenes: [], expectedEffects: [], expectedTableIds: [], expectedRowIds: [],
            forbiddenTopics: [], forbiddenEffects: [], minimumExpectedHits: 1, expectNoRows: false
        }, state.testCases.length);
        state.testCases.push(test);
        return test;
    }

    function removeTestCase(chat, caseId) {
        const state = ensureState(chat);
        const before = state.testCases.length;
        state.testCases = state.testCases.filter(item => item.id !== caseId);
        return before !== state.testCases.length;
    }

    function resetTestCases(chat) {
        const state = ensureState(chat);
        state.testCases = clone(DEFAULT_TEST_CASES).map(normalizeTestCase);
        return state.testCases;
    }

    function setBaseline(chat, runId) {
        const state = ensureState(chat);
        if (!state.runs.some(item => item.id === runId)) return false;
        state.baselineRunId = runId;
        return true;
    }

    function clearRuns(chat) {
        const state = ensureState(chat);
        const count = state.runs.length;
        state.runs = [];
        state.baselineRunId = '';
        return count;
    }

    function percent(value) {
        return `${(Number(value || 0) * 100).toFixed(1)}%`;
    }

    function number(value, digits = 1) {
        return Number(value || 0).toFixed(digits);
    }

    function statusLabel(status) {
        return status === 'pass' ? '通过' : status === 'warn' ? '需关注' : '未通过';
    }

    function renderMetric(label, value, pass, note = '') {
        return `<div class="memory-quality-metric ${pass ? 'pass' : 'fail'}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ''}</div>`;
    }

    function renderTestResult(test) {
        return `<article class="memory-quality-result ${test.pass ? 'pass' : 'fail'}">
            <div class="memory-quality-result-head"><div><strong>${escapeHtml(test.name)}</strong><small>${escapeHtml(test.actualMode || '')} · 召回 ${test.selectedCount} 条 · 约 ${test.promptChars} 字符</small></div><span>${test.pass ? '通过' : '需检查'}</span></div>
            <p>${escapeHtml(test.query)}</p>
            <div class="memory-quality-result-stats"><span>预期命中 ${test.expectedMatches}</span><span>规则外 ${test.ruleOutside}</span><span>禁止泄漏 ${test.forbiddenMatches}</span><span>不安全 ${test.unsafe}</span></div>
            ${(test.selected || []).length ? `<details><summary>查看召回条目</summary><div class="memory-quality-hit-list">${test.selected.map(item => `<div class="memory-quality-hit ${item.forbidden || item.unsafeReasons?.length ? 'unsafe' : item.expected ? 'expected' : ''}"><b>${escapeHtml(item.tableName)} · ${escapeHtml(item.id)}</b><span>综合 ${number(item.score, 2)} · 标签 ${number(item.tagScore, 2)} · 词法 ${number(item.lexicalScore, 2)} · 语义 ${number(item.semanticScore, 2)}</span><p>${escapeHtml(item.text || '')}</p>${item.unsafeReasons?.length ? `<em>${escapeHtml(item.unsafeReasons.join('；'))}</em>` : ''}</div>`).join('')}</div></details>` : '<div class="memory-quality-no-hit">没有召回 rows 记忆</div>'}
        </article>`;
    }

    function renderTestEditor(test) {
        const list = value => escapeHtml((value || []).join('、'));
        return `<article class="memory-quality-case" data-quality-case-id="${escapeHtml(test.id)}">
            <div class="memory-quality-case-head"><label><input type="checkbox" data-quality-case-field="enabled" data-case-id="${escapeHtml(test.id)}" ${test.enabled ? 'checked' : ''}> 启用</label><button class="btn btn-small btn-danger" data-action="quality-remove-case" data-case-id="${escapeHtml(test.id)}">删除</button></div>
            <div class="memory-quality-case-grid">
                <label>名称<input data-quality-case-field="name" data-case-id="${escapeHtml(test.id)}" value="${escapeHtml(test.name)}"></label>
                <label>至少预期命中<input type="number" min="0" max="50" data-quality-case-field="minimumExpectedHits" data-case-id="${escapeHtml(test.id)}" value="${test.minimumExpectedHits}"></label>
                <label class="wide">测试对话<textarea rows="2" data-quality-case-field="query" data-case-id="${escapeHtml(test.id)}">${escapeHtml(test.query)}</textarea></label>
                <label>预期主题<input data-quality-case-field="expectedTopics" data-case-id="${escapeHtml(test.id)}" value="${list(test.expectedTopics)}"></label>
                <label>预期场景<input data-quality-case-field="expectedScenes" data-case-id="${escapeHtml(test.id)}" value="${list(test.expectedScenes)}"></label>
                <label>预期作用类型<input data-quality-case-field="expectedEffects" data-case-id="${escapeHtml(test.id)}" value="${list(test.expectedEffects)}"></label>
                <label>禁止主题<input data-quality-case-field="forbiddenTopics" data-case-id="${escapeHtml(test.id)}" value="${list(test.forbiddenTopics)}"></label>
                <label>禁止作用类型<input data-quality-case-field="forbiddenEffects" data-case-id="${escapeHtml(test.id)}" value="${list(test.forbiddenEffects)}"></label>
                <label>预期为空<select data-quality-case-field="expectNoRows" data-case-id="${escapeHtml(test.id)}"><option value="false" ${!test.expectNoRows ? 'selected' : ''}>否</option><option value="true" ${test.expectNoRows ? 'selected' : ''}>是</option></select></label>
            </div>
        </article>`;
    }

    function renderView(chat) {
        const state = ensureState(chat);
        const latest = state.runs[state.runs.length - 1] || null;
        const baseline = state.runs.find(item => item.id === state.baselineRunId) || null;
        const settings = state.settings;
        const summary = latest?.summary;
        const comparison = latest?.comparison;
        return `<div class="memory-quality-page">
            <div class="memory-quality-head"><div><h2>质量评估与版本回归</h2><p>用固定测试对话检查召回命中、规则外泄漏、过期与冲突误召回、相似记录、Prompt 预算、反馈效果和任务稳定性。</p></div><div class="memory-quality-toolbar"><button class="btn btn-small btn-primary" data-action="quality-run">运行测试</button><button class="btn btn-small btn-secondary" data-action="quality-export-md">导出报告</button><button class="btn btn-small btn-neutral" data-action="quality-clear-runs">清除历史</button></div></div>
            ${latest ? `<section class="memory-quality-score status-${escapeHtml(summary.status)}"><div><b>质量分</b><strong>${summary.score}</strong><span>${statusLabel(summary.status)} · ${new Date(latest.createdAt).toLocaleString()}</span></div><div class="memory-quality-score-note">${comparison ? (comparison.pass ? '与基线相比未发现明显回归' : `发现回归：${escapeHtml(comparison.regressions.join('、'))}`) : '当前运行已作为初始基线或尚未设置基线'}</div></section>` : '<div class="memory-review-empty"><p>尚未运行质量测试。</p><p>首次运行会自动保存为基线，之后可以比较版本变化。</p></div>'}
            ${summary ? `<div class="memory-quality-metrics">
                ${renderMetric('预期命中率', percent(summary.expectedHitRate), summary.checks.expectedHitRate)}
                ${renderMetric('规则外召回率', percent(summary.ruleOutsideRate), summary.checks.ruleOutsideRate)}
                ${renderMetric('禁止项泄漏', percent(summary.forbiddenLeakRate), summary.checks.forbiddenLeakRate)}
                ${renderMetric('不安全记忆泄漏', percent(summary.unsafeLeakRate), summary.checks.unsafeLeakRate)}
                ${renderMetric('相似记录候选率', percent(summary.duplicateCandidateRate), summary.checks.duplicateCandidateRate, `${summary.duplicatePairCount} 对`)}
                ${renderMetric('平均 Prompt 字符', Math.round(summary.averagePromptChars), summary.checks.averagePromptChars)}
                ${renderMetric('反馈有效率', summary.feedbackPrecision === null ? '样本不足' : percent(summary.feedbackPrecision), summary.checks.feedbackPrecision)}
                ${renderMetric('任务失败率', percent(summary.taskFailureRate), summary.checks.taskFailureRate)}
            </div>` : ''}
            <section class="memory-quality-settings"><h3>质量阈值</h3><div class="memory-quality-setting-grid">
                <label>检索模式<select data-quality-setting="useCurrentRetrievalMode"><option value="false" ${!settings.useCurrentRetrievalMode ? 'selected' : ''}>固定关键词（无 API）</option><option value="true" ${settings.useCurrentRetrievalMode ? 'selected' : ''}>当前实际模式</option></select></label>
                <label>版本变化自动回归<select data-quality-setting="autoRunOnVersionChange"><option value="true" ${settings.autoRunOnVersionChange ? 'selected' : ''}>开启</option><option value="false" ${!settings.autoRunOnVersionChange ? 'selected' : ''}>关闭</option></select></label>
                <label>最低预期命中率<input type="number" min="0" max="1" step="0.01" data-quality-setting="minimumExpectedHitRate" value="${settings.minimumExpectedHitRate}"></label>
                <label>最大规则外召回率<input type="number" min="0" max="1" step="0.01" data-quality-setting="maximumRuleOutsideRate" value="${settings.maximumRuleOutsideRate}"></label>
                <label>最大相似记录率<input type="number" min="0" max="1" step="0.01" data-quality-setting="maximumDuplicateCandidateRate" value="${settings.maximumDuplicateCandidateRate}"></label>
                <label>相似判断阈值<input type="number" min="0.5" max="1" step="0.01" data-quality-setting="duplicateSimilarityThreshold" value="${settings.duplicateSimilarityThreshold}"></label>
                <label>平均 Prompt 字符上限<input type="number" min="200" max="20000" data-quality-setting="maximumAveragePromptChars" value="${settings.maximumAveragePromptChars}"></label>
                <label>最低反馈有效率<input type="number" min="0" max="1" step="0.01" data-quality-setting="minimumFeedbackPrecision" value="${settings.minimumFeedbackPrecision}"></label>
                <label>回归容忍度<input type="number" min="0" max="0.5" step="0.01" data-quality-setting="regressionTolerance" value="${settings.regressionTolerance}"></label>
            </div></section>
            ${latest ? `<section class="memory-quality-results"><div class="memory-quality-section-head"><h3>最近一次测试结果</h3><div>${baseline ? `<button class="btn btn-small btn-secondary" data-action="quality-set-baseline" data-run-id="${escapeHtml(latest.id)}">将本次设为基线</button>` : ''}</div></div>${latest.results.map(renderTestResult).join('')}</section>` : ''}
            ${latest?.duplicate?.pairs?.length ? `<section class="memory-quality-duplicates"><h3>相似记录候选</h3>${latest.duplicate.pairs.map(pair => `<article><div><strong>${escapeHtml(pair.tableName)}</strong><span>相似度 ${number(pair.score, 2)}</span></div><p>A：${escapeHtml(pair.textA)}</p><p>B：${escapeHtml(pair.textB)}</p><small>${escapeHtml(pair.rowIdA)} ↔ ${escapeHtml(pair.rowIdB)}</small></article>`).join('')}</section>` : ''}
            <section class="memory-quality-cases"><div class="memory-quality-section-head"><div><h3>固定测试对话集</h3><p>预期和禁止项支持“、”或逗号分隔。测试用例随角色本地保存。</p></div><div><button class="btn btn-small btn-secondary" data-action="quality-add-case">新增测试</button><button class="btn btn-small btn-neutral" data-action="quality-reset-cases">恢复默认</button></div></div>${state.testCases.map(renderTestEditor).join('')}</section>
            ${state.runs.length ? `<section class="memory-quality-history"><h3>运行历史</h3><div>${[...state.runs].reverse().slice(0, 12).map(run => `<button data-action="quality-set-baseline" data-run-id="${escapeHtml(run.id)}" class="${run.id === state.baselineRunId ? 'baseline' : ''}"><strong>${run.summary.score}</strong><span>${new Date(run.createdAt).toLocaleString()} · ${statusLabel(run.summary.status)}</span>${run.id === state.baselineRunId ? '<em>基线</em>' : ''}</button>`).join('')}</div></section>` : ''}
        </div>`;
    }

    function buildMarkdown(chat, run) {
        if (!run) return '# 结构化记忆质量报告\n\n尚未运行测试。';
        const summary = run.summary;
        const lines = [
            '# 章鱼机结构化记忆质量报告', '',
            `- 版本：V${VERSION}`,
            `- 生成时间：${new Date(run.createdAt).toLocaleString()}`,
            `- 质量分：${summary.score}（${statusLabel(summary.status)}）`,
            `- 检索模式：${run.retrievalMode}`, '',
            '## 核心指标', '',
            `- 预期命中率：${percent(summary.expectedHitRate)}`,
            `- 规则外召回率：${percent(summary.ruleOutsideRate)}`,
            `- 禁止项泄漏率：${percent(summary.forbiddenLeakRate)}`,
            `- 不安全记忆泄漏率：${percent(summary.unsafeLeakRate)}`,
            `- 相似记录候选率：${percent(summary.duplicateCandidateRate)}（${summary.duplicatePairCount} 对）`,
            `- 平均 Prompt 字符：${Math.round(summary.averagePromptChars)}`,
            `- 反馈有效率：${summary.feedbackPrecision === null ? '样本不足' : percent(summary.feedbackPrecision)}`,
            `- 任务失败率：${percent(summary.taskFailureRate)}`, '',
            '## 测试用例', ''
        ];
        run.results.forEach((test, index) => {
            lines.push(`### ${index + 1}. ${test.name} — ${test.pass ? '通过' : '需检查'}`, '', `> ${test.query}`, '', `- 召回：${test.selectedCount}`, `- 预期命中：${test.expectedMatches}`, `- 规则外：${test.ruleOutside}`, `- 禁止泄漏：${test.forbiddenMatches}`, `- 不安全：${test.unsafe}`, '');
            (test.selected || []).forEach(item => lines.push(`  - ${item.tableName} / ${item.id} / ${Number(item.score || 0).toFixed(2)}：${String(item.text || '').replace(/\n/g, ' ').slice(0, 220)}`));
            lines.push('');
        });
        if (run.comparison) {
            lines.push('## 与基线比较', '', run.comparison.pass ? '- 未发现超过容忍度的明显回归。' : `- 回归项：${run.comparison.regressions.join('、')}`, '');
        }
        lines.push('## 运行与成本', '', `- 累计估算输入 Token：${run.operational.estimatedInputTokens}`, `- 累计估算输出 Token：${run.operational.estimatedOutputTokens}`, `- 累计估算费用：${run.operational.estimatedCost}`, `- 待审核批次：${run.operational.pendingReviewCount}`);
        return lines.join('\n');
    }

    function downloadReport(chat, format = 'md') {
        const state = ensureState(chat);
        const run = state.runs[state.runs.length - 1] || null;
        const content = format === 'json' ? JSON.stringify({ schemaVersion: VERSION, run }, null, 2) : buildMarkdown(chat, run);
        if (typeof document === 'undefined' || typeof Blob === 'undefined') return content;
        const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `章鱼机_记忆质量报告_V${VERSION}_${new Date().toISOString().slice(0, 10)}.${format}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        state.lastExportAt = Date.now();
        return content;
    }

    function enqueueRun(chat, options = {}) {
        if (!window.MemoryTableTasks) return null;
        const state = ensureState(chat);
        const useCurrent = options.useCurrentRetrievalMode ?? state.settings.useCurrentRetrievalMode;
        const usesVectorApi = useCurrent && window.MemoryTableRetrieval?.hasExplicitVectorApi?.();
        return window.MemoryTableTasks.enqueue(chat, 'quality_regression', {
            chatId: chat.id,
            source: options.source || 'manual_quality_regression',
            apiMode: usesVectorApi ? 'embedding' : 'local',
            useCurrentRetrievalMode: useCurrent,
            fingerprint: `${state.testCases.map(item => `${item.id}:${item.enabled}:${item.query}`).join('|')}:${JSON.stringify(state.settings)}`,
            title: '运行记忆质量回归'
        }, {
            title: '运行记忆质量回归',
            priority: 35,
            apiTask: usesVectorApi,
            apiMode: usesVectorApi ? 'embedding' : 'local',
            force: !!options.force
        });
    }

    function enqueuePendingAutoRun(chat) {
        const state = ensureState(chat);
        if (!state.pendingAutoRun || !state.settings.autoRunOnVersionChange || !window.MemoryTableTasks) return null;
        const taskState = window.MemoryTableTasks.ensureState(chat);
        const existing = (taskState.tasks || []).find(task => task.type === 'quality_regression' && ['queued','running','succeeded','failed','paused'].includes(task.status));
        if (existing) {
            state.pendingAutoRun = false;
            state.autoRunQueuedAt = Date.now();
            return { task: existing, deduped: true };
        }
        const result = enqueueRun(chat, { source: 'auto_quality_version_change', force: true, useCurrentRetrievalMode: false });
        if (result) {
            state.pendingAutoRun = false;
            state.autoRunQueuedAt = Date.now();
        }
        return result;
    }

    if (window.MemoryTableTasks) {
        window.MemoryTableTasks.registerExecutor('quality_regression', async (chat, payload) => {
            const run = await runSuite(chat, { settings: { useCurrentRetrievalMode: payload.useCurrentRetrievalMode === true } });
            return { status: 'success', runId: run.id, score: run.summary.score, qualityStatus: run.summary.status };
        });
    }

    const api = {
        VERSION,
        DEFAULT_SETTINGS,
        DEFAULT_TEST_CASES,
        ensureState,
        updateSettings,
        updateTestCase,
        addTestCase,
        removeTestCase,
        resetTestCases,
        setBaseline,
        clearRuns,
        runSuite,
        enqueueRun,
        enqueuePendingAutoRun,
        renderView,
        downloadReport,
        buildMarkdown,
        buildGroups,
        scanDuplicateCandidates
    };

    if (Kernel) Kernel.register('quality', api, { legacyGlobal: 'MemoryTableQuality' });
    else window.MemoryTableQuality = api;
})();
