// --- 结构化记忆 V2.3：聊天同请求短期更新 / 状态条 / 待办操作 / 候选池 ---
(function () {
    'use strict';

    const Kernel = window.OvoMemoryKernel || null;
    const Core = Kernel?.core;
    if (!Core) throw new Error('记忆内核未加载');
    const escapeHtml = Core.escapeHtml;
    const escapeAttribute = Core.escapeAttribute || Core.escapeHtml;
    const FieldPolicy = Kernel.get('fieldPolicy') || Object.freeze({
        describe: () => '兼容默认',
        effectiveCommitMode: () => 'direct',
        assess: field => ({ allowed: field?.aiEditable !== false, route: field?.aiEditable === false ? 'blocked' : 'direct', policy: {}, sourceEvidence: 'inferred', confidence: 0, reasons: [] }),
        setRuntimeValue: () => null,
        getRuntimeEntry: () => null
    });
    const Review = Kernel.get('review');
    const PolicyResolver = Kernel.get('policyResolver');

    const VERSION = '2.14-R8.1';
    const MAX_CANDIDATES = 200;
    const MAX_HISTORY = 120;
    const LIVE_TABLE_IDS = new Set(['table_current_state', 'table_tasks']);
    const CANDIDATE_TABLE_IDS = new Set(['table_recent_events', 'table_daily_observation']);
    const ACTIVE_TASK_STATUSES = new Set(['进行中', '待办', '搁置']);
    const TERMINAL_TASK_STATUSES = new Set(['已完成', '取消']);

    function nowText() {
        const date = new Date();
        const pad = value => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function makeId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }

    function normalizeCandidateStatus(candidate) {
        if (!candidate || typeof candidate !== 'object') return null;
        if (candidate.status === 'processed') {
            candidate.status = candidate.targetRowId ? 'promoted' : 'legacy_unverified';
            if (!candidate.targetRowId && !candidate.migrationNote) candidate.migrationNote = '旧版仅标记为已整理，未记录正式档案目标。';
        }
        const allowed = new Set(['pending', 'promoted', 'merged', 'dismissed', 'deleted', 'legacy_unverified']);
        if (!allowed.has(candidate.status)) candidate.status = 'pending';
        return candidate;
    }

    function ensureMemoryTables(chat) {
        if (!chat) return null;
        chat.memoryTables ||= {};
        chat.memoryTables.data ||= {};
        chat.memoryTables.lockedFields ||= {};
        chat.memoryTables.sidecar ||= {};
        const state = chat.memoryTables.sidecar;
        if (state.enabled === undefined) state.enabled = true;
        if (state.captureCandidates === undefined) state.captureCandidates = true;
        if (state.showStatusBar === undefined) state.showStatusBar = true;
        if (!Array.isArray(state.candidates)) state.candidates = [];
        state.candidates = state.candidates.map(normalizeCandidateStatus).filter(Boolean);
        if (!Array.isArray(state.history)) state.history = [];
        if (!state.statusMeta || typeof state.statusMeta !== 'object') state.statusMeta = {};
        if (!state.lastApplyReport || typeof state.lastApplyReport !== 'object') state.lastApplyReport = null;
        state.schemaVersion = VERSION;
        return state;
    }

    function getBoundTemplates(chat) {
        if (!chat || !Array.isArray(db?.memoryTableTemplates)) return [];
        const ids = new Set(chat.memoryTables?.boundTemplateIds || []);
        return db.memoryTableTemplates.filter(template => ids.has(template.id));
    }

    function tableRole(table) {
        return Kernel.get('policy')?.normalizeSystemRole?.(table?.systemRole, table) || String(table?.systemRole || '');
    }

    function isCurrentStateTable(table) {
        return !!table && (tableRole(table) === 'current_state' || table.id === 'table_current_state' || /当前状态|近期状态/.test(String(table.name || '')));
    }

    function isTaskTable(table) {
        return !!table && (tableRole(table) === 'tasks' || table.id === 'table_tasks' || /待办|承诺|未完成事项/.test(String(table.name || '')));
    }

    function isCandidateSourceTable(table) {
        const role = tableRole(table);
        return !!table && (role === 'recent_events' || role === 'daily_observation' || CANDIDATE_TABLE_IDS.has(table.id) || /近期经历|重要事件|日常观察|睡眠|饮水/.test(String(table.name || '')));
    }

    function isLiveTable(table) {
        return isCurrentStateTable(table) || isTaskTable(table);
    }

    function findTable(chat, predicate, options = {}) {
        for (const template of getBoundTemplates(chat)) {
            for (const sourceTable of (template.tables || [])) {
                const table = PolicyResolver?.materializeTable
                    ? PolicyResolver.materializeTable(chat, template.id, sourceTable)
                    : sourceTable;
                if (!predicate(table)) continue;
                if (options.forCapture && table.capturePolicy?.mode !== 'sidecar') continue;
                return { template, table, sourceTable };
            }
        }
        return null;
    }

    function ensureTableData(chat, template, table) {
        chat.memoryTables.data[template.id] ||= {};
        if (!chat.memoryTables.data[template.id][table.id]) {
            chat.memoryTables.data[template.id][table.id] = table.mode === 'rows' ? { __rows: [] } : {};
        }
        const data = chat.memoryTables.data[template.id][table.id];
        if (table.mode === 'rows' && !Array.isArray(data.__rows)) data.__rows = [];
        return data;
    }

    function getLockedSet(chat, templateId, tableId) {
        const list = chat.memoryTables?.lockedFields?.[templateId]?.[tableId];
        return new Set(Array.isArray(list) ? list : []);
    }

    function normalizeValue(field, value) {
        if (value === undefined) return undefined;
        if (value === null) return field.type === 'tags' ? [] : '';
        switch (field.type) {
            case 'number': {
                const num = Number(value);
                return Number.isFinite(num) ? num : undefined;
            }
            case 'progress': {
                const num = Number(value);
                if (!Number.isFinite(num)) return undefined;
                const min = Number.isFinite(Number(field.min)) ? Number(field.min) : 0;
                const max = Number.isFinite(Number(field.max)) ? Number(field.max) : 100;
                return Math.max(min, Math.min(max, num));
            }
            case 'boolean':
                if (typeof value === 'boolean') return value;
                if (/^(true|1|是|开启)$/i.test(String(value))) return true;
                if (/^(false|0|否|关闭)$/i.test(String(value))) return false;
                return undefined;
            case 'tags':
                if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean).slice(0, 20);
                return String(value).split(/[,，、\n]/).map(item => item.trim()).filter(Boolean).slice(0, 20);
            case 'enum': {
                const text = String(value).trim();
                if (Array.isArray(field.options) && field.options.length && !field.options.includes(text)) return undefined;
                return text;
            }
            default:
                return String(value).trim().slice(0, field.type === 'longtext' ? 4000 : 1000);
        }
    }

    function resolveField(table, keyOrId) {
        const value = String(keyOrId || '').trim();
        return (table.columns || []).find(field => field.id === value || field.key === value || field.summaryLabel === value) || null;
    }

    function canEditField(chat, template, table, field) {
        if (!field || field.aiEditable === false) return false;
        return !getLockedSet(chat, template.id, table.id).has(field.id);
    }

    function queueFieldProposal(report, template, table, field, oldValue, newValue, assessment, context = {}) {
        report.pendingFieldProposals ||= [];
        report.pendingFieldProposals.push({
            id: makeId('sidecar_field_proposal'),
            kind: context.rowId ? 'row_update_field' : 'field',
            actionLabel: assessment.route === 'candidate' ? '候选字段' : '更新字段',
            templateId: template.id,
            tableId: table.id,
            templateName: template.name,
            tableName: table.name,
            rowId: context.rowId || undefined,
            fieldId: field.id,
            label: `${table.name} / ${field.key}`,
            oldValue,
            newValue,
            valid: true,
            error: assessment.reasons.join('；'),
            risk: assessment.route === 'candidate' ? 'medium' : 'low',
            editable: true,
            fieldType: field.type,
            fieldPolicy: assessment.policy,
            fieldRoute: assessment.route,
            evidence: assessment.sourceEvidence,
            confidence: assessment.confidence
        });
    }

    function normalizeFieldInput(raw, context = {}) {
        const structured = raw && typeof raw === 'object' && !Array.isArray(raw)
            && (Object.prototype.hasOwnProperty.call(raw, 'value')
                || Object.prototype.hasOwnProperty.call(raw, 'evidence')
                || Object.prototype.hasOwnProperty.call(raw, 'source')
                || Object.prototype.hasOwnProperty.call(raw, 'confidence'));
        const sourceRaw = structured ? (raw.evidence || raw.source) : (context.source || context.evidence);
        return {
            value: structured ? raw.value : raw,
            source: sourceRaw === 'user_explicit' || sourceRaw === 'explicit' ? 'user_explicit' : 'assistant_inferred',
            confidence: Math.max(0, Math.min(100, Number(structured ? raw.confidence : context.confidence) || 0))
        };
    }

    function setFields(chat, template, table, target, patch, report, prefix, context = {}) {
        if (!patch || typeof patch !== 'object') return 0;
        let changed = 0;
        context.fieldResults ||= [];
        Object.entries(patch).forEach(([key, raw]) => {
            const field = resolveField(table, key);
            if (!canEditField(chat, template, table, field)) {
                report.rejected.push(`${prefix || table.name}.${key}: 字段不存在、已锁定或禁止 AI 编辑`);
                return;
            }
            const input = normalizeFieldInput(raw, context);
            const value = normalizeValue(field, input.value);
            if (value === undefined) {
                report.rejected.push(`${prefix || table.name}.${field.key}: 值不符合字段类型或枚举`);
                return;
            }
            const runtimeId = context.rowId ? `${context.rowId}::${field.id}` : field.id;
            const formalBefore = target[field.id];
            const runtimeBefore = FieldPolicy.getRuntimeEntry?.(chat, template.id, table.id, runtimeId)?.value;
            const assessment = FieldPolicy.assess(field, table, {
                source: input.source,
                confidence: input.confidence,
                inferredRuntimeOnly: context.inferredRuntimeOnly === true,
                preferTableDirect: context.preferTableDirect === true,
                runtimeReason: context.runtimeReason
            });
            const before = assessment.route === 'runtime_only' ? runtimeBefore : formalBefore;
            const result = { fieldId: field.id, field, value, before, assessment, source: input.source, confidence: input.confidence, changed: false };
            context.fieldResults.push(result);
            if (JSON.stringify(before) === JSON.stringify(value)) return;
            if (!assessment.allowed || assessment.route === 'blocked') {
                report.rejected.push(`${prefix || table.name}.${field.key}: ${assessment.reasons.join('；') || '字段策略阻止写入'}`);
                return;
            }
            if (assessment.route === 'runtime_only') {
                FieldPolicy.setRuntimeValue(chat, template.id, table.id, runtimeId, value, {
                    source: input.source,
                    confidence: input.confidence
                });
                report.runtimeChanged ||= [];
                report.runtimeChanged.push(`${prefix || table.name}.${field.key}`);
                context.runtimeChanged = (context.runtimeChanged || 0) + 1;
                context.anyChanged = true;
                result.changed = true;
                return;
            }
            if (assessment.route === 'review' || assessment.route === 'candidate') {
                if (context.rowAdd) {
                    context.deferredValues ||= {};
                    context.deferredValues[field.id] = value;
                    context.deferredDecisions ||= {};
                    context.deferredDecisions[field.id] = assessment;
                } else {
                    queueFieldProposal(report, template, table, field, formalBefore, value, assessment, context);
                }
                context.pendingCount = (context.pendingCount || 0) + 1;
                return;
            }
            target[field.id] = value;
            changed += 1;
            context.formalChanged = (context.formalChanged || 0) + 1;
            context.anyChanged = true;
            result.changed = true;
            report.changed.push(`${prefix || table.name}.${field.key}`);
        });
        return changed;
    }

    function flushFieldReviewBatches(chat, report, context = {}) {
        if (!Review || !Array.isArray(report.pendingFieldProposals) || !report.pendingFieldProposals.length) return [];
        const groups = new Map();
        report.pendingFieldProposals.forEach(proposal => {
            const key = `${proposal.templateId}::${proposal.tableId}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(proposal);
        });
        const batches = [];
        groups.forEach(proposals => {
            const first = proposals[0];
            batches.push(Review.enqueueBatch(chat, {
                id: makeId('memory_review'),
                templateId: first.templateId,
                tableId: first.tableId,
                templateName: first.templateName,
                tableName: first.tableName,
                source: 'sidecar_field_policy',
                apiMode: 'main',
                requestedApiMode: 'main',
                sourceMessageCount: 1,
                range: { start: 0, end: 0 },
                historyPreview: '',
                fieldPolicyVersion: '2.14-R8.1',
                proposals
            }));
        });
        report.reviewBatchIds = batches.map(item => item.id);
        return batches;
    }
    function migratePolicies(chat) {
        ensureMemoryTables(chat);
        let dirty = false;
        getBoundTemplates(chat).forEach(template => {
            (template.tables || []).forEach(table => {
                if (isLiveTable(table) || isCandidateSourceTable(table)) {
                    table.capturePolicy = {
                        ...(table.capturePolicy || {}),
                        mode: 'sidecar',
                        frequencySource: 'table',
                        apiMode: 'none'
                    };
                    table.commitPolicy = {
                        ...(table.commitPolicy || {}),
                        mode: isLiveTable(table) ? 'direct' : 'candidate',
                        requireUserConfirmation: false
                    };
                    table.updatePolicy ||= {};
                    if (table.updatePolicy.enabled !== false || table.updatePolicy.triggerMode !== 'manual') {
                        table.updatePolicy.enabled = false;
                        table.updatePolicy.triggerMode = 'manual';
                        table.updatePolicy.roundInterval = 0;
                        table.updatePolicy.messageInterval = 0;
                        table.updatePolicy.instructions = `${table.updatePolicy.instructions || ''}\nV2.3：由主聊天 sidecar 或总结候选整理维护，不再单独自动请求。`.trim();
                        dirty = true;
                    }
                }
                if (isLiveTable(table)) {
                    table.injectionPolicy ||= {};
                    if (table.injectionPolicy.mode !== 'never') {
                        table.injectionPolicy.mode = 'never';
                        table.injectionPolicy.instructions = `${table.injectionPolicy.instructions || ''}\nV2.3：改由实时状态/待办通道注入，避免与普通检索重复。`.trim();
                        dirty = true;
                    }
                }
            });
        });
        return dirty;
    }

    function getFieldDisplay(field, value) {
        if (value === undefined || value === null || value === '') return '';
        if (Array.isArray(value)) return value.join('、');
        if (typeof value === 'boolean') return value ? '是' : '否';
        return String(value);
    }
    function getEffectiveFieldValue(chat, template, table, field, formalValue, rowId) {
        if (FieldPolicy.effectiveCommitMode(field, table) !== 'runtime_only') return formalValue;
        const runtimeId = rowId ? `${rowId}::${field.id}` : field.id;
        return FieldPolicy.getRuntimeEntry(chat, template.id, table.id, runtimeId)?.value;
    }

    function isStatusExpired(table, data) {
        const field = (table.columns || []).find(item => /状态有效期/.test(item.key));
        const value = field ? data[field.id] : '';
        if (!value) return false;
        const timestamp = Date.parse(String(value).trim().length <= 10 ? `${value}T23:59:59` : String(value));
        return Number.isFinite(timestamp) && Date.now() > timestamp;
    }

    function buildStatusContext(chat, descriptor) {
        if (!descriptor) return '';
        const { template, table } = descriptor;
        const data = ensureTableData(chat, template, table);
        if (isStatusExpired(table, data)) return '';
        const fields = (table.columns || []).filter(field => field.important !== false).map(field => {
            const value = getFieldDisplay(field, getEffectiveFieldValue(chat, template, table, field, data[field.id]));
            return value ? `- ${field.key}: ${value}` : '';
        }).filter(Boolean);
        return fields.length ? `【当前状态｜近3-7天，可能变化】\n${fields.join('\n')}` : '';
    }

    function getActiveTaskRows(chat, descriptor, limit = 6) {
        if (!descriptor) return [];
        const { template, table } = descriptor;
        const data = ensureTableData(chat, template, table);
        const statusField = (table.columns || []).find(field => field.key === '当前状态');
        const updatedField = (table.columns || []).find(field => /最后更新时间|更新时间/.test(field.key));
        return (data.__rows || []).filter(row => {
            const status = statusField ? String(row.cells?.[statusField.id] || '') : '';
            return !TERMINAL_TASK_STATUSES.has(status);
        }).sort((a, b) => {
            const av = updatedField ? Date.parse(a.cells?.[updatedField.id] || '') || 0 : Number(a.meta?.updatedAt) || 0;
            const bv = updatedField ? Date.parse(b.cells?.[updatedField.id] || '') || 0 : Number(b.meta?.updatedAt) || 0;
            return bv - av;
        }).slice(0, limit);
    }

    function buildTaskContext(chat, descriptor) {
        if (!descriptor) return '';
        const { table } = descriptor;
        const rows = getActiveTaskRows(chat, descriptor, 6);
        if (!rows.length) return '';
        const title = (table.columns || []).find(field => field.key === '标题');
        const content = (table.columns || []).find(field => field.key === '内容');
        const status = (table.columns || []).find(field => field.key === '当前状态');
        const next = (table.columns || []).find(field => field.key === '后续待办');
        return `【活跃待办与未完成事项】\n${rows.map(row => {
            const parts = [
                title ? row.cells?.[title.id] : '',
                content ? row.cells?.[content.id] : '',
                next ? row.cells?.[next.id] : ''
            ].map(value => String(value || '').trim()).filter(Boolean);
            const statusText = status ? String(row.cells?.[status.id] || '进行中') : '进行中';
            const sourceFlag = row.meta?.source === 'assistant_inferred' ? ' [AI推测，勿主动提醒]' : '';
            const usePolicy = row.meta?.usePolicy || {};
            const policyFlags = [];
            if (usePolicy.paused) policyFlags.push('已暂停，禁止主动提及');
            if (usePolicy.allowProactiveMention === false) policyFlags.push('仅相关时参考');
            if (usePolicy.mentionPolicy === 'trigger_only') policyFlags.push('仅触发时提醒');
            const policyText = policyFlags.length ? ` [${policyFlags.join('；')}]` : '';
            return `- [rowId:${row.id}] [${statusText}]${sourceFlag}${policyText} ${parts.join('｜').slice(0, 500)}`;
        }).join('\n')}\n使用规则：只在当前话题相关或明确触发时自然提及；不要每轮催促；没有用户明确证据时不要自行标记完成。`;
    }

    function describeFields(table, scope) {
        return (table.columns || []).filter(field => {
            if (scope === 'status') return field.important !== false && !/状态记录时间|状态有效期/.test(field.key);
            if (scope === 'task') return !/事件ID|创建时间|最后更新时间|完成时间|原始记录ID/.test(field.key);
            return true;
        }).map(field => {
            const options = field.type === 'enum' && field.options?.length ? `，可选：${field.options.join('/')}` : '';
            return `- ${field.key}（${field.type}${options}；策略：${FieldPolicy.describe(field, table)}）`;
        }).join('\n');
    }

    function buildSystemPrompt(chat) {
        const state = ensureMemoryTables(chat);
        if (!state?.enabled || chat.memoryTables?.enabled === false || getBoundTemplates(chat).length === 0) return '';
        migratePolicies(chat);
        const statusDescriptor = findTable(chat, isCurrentStateTable, { forCapture: true });
        const taskDescriptor = findTable(chat, isTaskTable, { forCapture: true });
        if (!statusDescriptor && !taskDescriptor) return '';
        const liveSections = [
            buildStatusContext(chat, statusDescriptor),
            buildTaskContext(chat, taskDescriptor)
        ].filter(Boolean).join('\n\n');

        const statusFields = statusDescriptor ? describeFields(statusDescriptor.table, 'status') : '无当前状态表';
        const taskFields = taskDescriptor ? describeFields(taskDescriptor.table, 'task') : '无待办表';
        const candidateEnabled = state.captureCandidates !== false;
        return `\n\n<memory_live_context>\n${liveSections || '当前没有已记录的实时状态或活跃待办。'}\n</memory_live_context>\n\n` +
`<memory_sidecar_protocol>\n你在完成所有正常可见聊天消息后，必须额外输出且只输出一个隐藏区块：\n<memory_sidecar>{严格 JSON}</memory_sidecar>\n前端会隐藏该区块。不得使用 Markdown 代码围栏，不得把说明文字写进 JSON。即使没有变化，也要返回空结构。\n\nJSON 结构：\n{\n  "version": 2,\n  "status": {\n    "fields": {\n      "字段ID或字段名": {"value":"值","evidence":"user_explicit|assistant_inferred","confidence":0}\n    },\n    "validDays": 3\n  },\n  "taskOps": [],\n  "candidates": []\n}\n\n当前状态允许更新的字段（fields 的键可使用字段 ID 或字段名）：\n${statusFields}\n规则：每个字段必须单独给出 evidence 和 confidence；只修改本轮出现新证据的字段；不要清空未提及字段；validDays 只能为 1-7。用户原话或无歧义事实标 user_explicit；模型推断标 assistant_inferred，推断状态只进入会话运行态，不作为用户确定事实。兼容旧版全局 source/confidence，但不要再生成旧格式。\n\n待办字段：\n${taskFields}\ntaskOps 仅允许：\n- 新增：{"op":"add","fields":{"字段ID或字段名":"值"},"confidence":0-100,"source":"user_explicit|assistant_inferred"}\n- 更新：{"op":"update","rowId":"现有rowId","fields":{...}}\n- 完成：{"op":"complete","rowId":"现有rowId","result":"结果，可空"}\n- 取消：{"op":"cancel","rowId":"现有rowId","reason":"原因，可空"}\n- 重开：{"op":"reopen","rowId":"现有rowId"}\n禁止 delete。用户说“应该/也许/以后”不等于明确待办；用户未明确完成时禁止 complete；禁止虚构截止时间。\n\n${candidateEnabled ? `candidates 用于提取近期经历或日常观察；当前角色将目标表设为直接写入时，用户明确表达且满足字段阈值的候选会自动 Upsert，否则进入待处理：\n[{"type":"experience|daily_observation","summary":"简短客观摘要","tags":{"topic":[],"scene":[],"entity":[],"effect":"historical_context|temporary_state"},"confidence":0-100,"source":"user_explicit|assistant_inferred"}]\n只保存对未来聊天确有价值的新信息，普通寒暄不要生成候选。` : 'candidates 必须返回空数组。'}\n</memory_sidecar_protocol>`;
    }

    function parseJsonLoose(text) {
        let source = String(text || '').trim();
        source = source.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        source = source.replace(/,\s*([}\]])/g, '$1');
        try { return JSON.parse(source); } catch (_) {}
        const start = source.indexOf('{');
        const end = source.lastIndexOf('}');
        if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1));
        throw new Error('memory_sidecar JSON 无法解析');
    }

    function extractSidecar(responseText) {
        const text = String(responseText || '');
        const regex = /<memory_sidecar>([\s\S]*?)<\/memory_sidecar>/i;
        const match = text.match(regex);
        if (!match) return { cleaned: text, payload: null, error: null };
        const cleaned = text.replace(match[0], '').replace(/\n{3,}/g, '\n\n').trim();
        try {
            return { cleaned, payload: parseJsonLoose(match[1]), error: null };
        } catch (error) {
            return { cleaned, payload: null, error };
        }
    }

    function applyStatus(chat, payload, report) {
        if (!payload || typeof payload !== 'object' || !payload.fields || typeof payload.fields !== 'object') return;
        const descriptor = findTable(chat, isCurrentStateTable, { forCapture: true });
        if (!descriptor) return;
        const { template, table } = descriptor;
        const data = ensureTableData(chat, template, table);
        const context = {
            source: payload.source === 'user_explicit' ? 'user_explicit' : 'assistant_inferred',
            confidence: Math.max(0, Math.min(100, Number(payload.confidence) || 0)),
            inferredRuntimeOnly: true,
            preferTableDirect: true,
            runtimeReason: '当前状态的模型推断只保留在会话运行态',
            fieldResults: []
        };
        setFields(chat, template, table, data, payload.fields, report, '当前状态', context);
        if (!context.anyChanged) return;
        const timeField = (table.columns || []).find(field => /状态记录时间|更新时间/.test(field.key));
        if (timeField && canEditField(chat, template, table, timeField)) data[timeField.id] = nowText();
        const validField = (table.columns || []).find(field => /状态有效期/.test(field.key));
        if (validField && canEditField(chat, template, table, validField)) {
            const days = Math.max(1, Math.min(7, Number(payload.validDays) || 3));
            const expires = new Date(Date.now() + days * 86400000);
            data[validField.id] = expires.toISOString().slice(0, 10);
        }
        const state = ensureMemoryTables(chat);
        context.fieldResults.filter(item => item.changed).forEach(item => {
            state.statusMeta[item.fieldId] = {
                source: item.source,
                evidence: item.assessment.sourceEvidence,
                confidence: item.confidence,
                route: item.assessment.route,
                updatedAt: Date.now()
            };
        });
    }

    function migrateCurrentStateReviewBatches(chat, report) {
        if (!Review?.getPendingBatches || !Review?.removePendingBatch) return 0;
        const descriptor = findTable(chat, isCurrentStateTable, { forCapture: true });
        if (!descriptor) return 0;
        const batches = Review.getPendingBatches(chat).filter(batch => batch?.source === 'sidecar_field_policy' && batch?.tableId === descriptor.table.id);
        if (!batches.length) return 0;
        const latest = new Map();
        batches.forEach(batch => (batch.proposals || []).forEach(proposal => {
            if (!proposal?.fieldId) return;
            const at = Number(proposal.updatedAt || proposal.createdAt || batch.createdAt) || 0;
            const existing = latest.get(proposal.fieldId);
            if (!existing || at >= existing.at) latest.set(proposal.fieldId, { proposal, at });
        }));
        batches.forEach(batch => Review.removePendingBatch(chat, batch.id));
        const data = ensureTableData(chat, descriptor.template, descriptor.table);
        latest.forEach(({ proposal }) => {
            const value = proposal.editedValue !== undefined ? proposal.editedValue : proposal.newValue;
            setFields(chat, descriptor.template, descriptor.table, data, {
                [proposal.fieldId]: {
                    value,
                    evidence: proposal.evidence || 'assistant_inferred',
                    confidence: Number(proposal.confidence) || 0
                }
            }, report, '当前状态迁移', {
                inferredRuntimeOnly: true,
                preferTableDirect: true,
                runtimeReason: '旧当前状态推断审核迁移到会话运行态'
            });
        });
        report.reviewCompacted = { removedBatches: batches.length, latestFields: latest.size };
        return batches.length;
    }

    function findFieldByPattern(table, pattern) {
        return (table.columns || []).find(field => pattern.test(field.key));
    }

    function setAutoField(chat, template, table, cells, pattern, value, report) {
        const field = findFieldByPattern(table, pattern);
        if (!field) return false;
        if (!canEditField(chat, template, table, field)) {
            if (report) report.rejected.push(`${table.name}.${field.key}: 已锁定或禁止 AI 编辑`);
            return false;
        }
        const normalized = normalizeValue(field, value);
        if (normalized === undefined) return false;
        cells[field.id] = normalized;
        return true;
    }

    function applyTaskOps(chat, taskOps, report, context = {}) {
        if (!Array.isArray(taskOps) || !taskOps.length) return;
        const descriptor = findTable(chat, isTaskTable, { forCapture: true });
        if (!descriptor) return;
        const { template, table } = descriptor;
        const data = ensureTableData(chat, template, table);
        for (const operation of taskOps.slice(0, 12)) {
            const op = String(operation?.op || '').toLowerCase();
            if (!['add', 'update', 'complete', 'cancel', 'reopen'].includes(op)) {
                report.rejected.push(`待办操作 ${op || '空'}：不在白名单`);
                continue;
            }
            if (op === 'add') {
                const cells = {};
                const tempReport = { changed: [], rejected: report.rejected, pendingFieldProposals: report.pendingFieldProposals };
                const addContext = { source: operation.source === 'user_explicit' ? 'user_explicit' : 'assistant_inferred', confidence: Math.max(0, Math.min(100, Number(operation.confidence) || 0)), rowAdd: true, deferredValues: {}, deferredDecisions: {} };
                setFields(chat, template, table, cells, operation.fields || {}, tempReport, '新增待办', addContext);
                const titleField = findFieldByPattern(table, /^标题$/);
                const contentField = findFieldByPattern(table, /^内容$/);
                const proposedCells = { ...cells, ...(addContext.deferredValues || {}) };
                if (!String(proposedCells[titleField?.id] || proposedCells[contentField?.id] || '').trim()) {
                    report.rejected.push('新增待办：缺少标题或内容');
                    continue;
                }
                if (Object.keys(addContext.deferredValues || {}).length) {
                    report.pendingFieldProposals ||= [];
                    report.pendingFieldProposals.push({
                        id: makeId('sidecar_row_proposal'), kind: 'row_add', actionLabel: '候选待办',
                        templateId: template.id, tableId: table.id, templateName: template.name, tableName: table.name,
                        label: `${table.name} / 新增待办`, oldValue: '',
                        newValue: Object.fromEntries((table.columns || []).filter(field => proposedCells[field.id] !== undefined).map(field => [field.key, proposedCells[field.id]])),
                        fieldValues: proposedCells, fieldDecisions: addContext.deferredDecisions,
                        valid: true, error: '', risk: 'medium', editable: false, fieldRoute: 'candidate',
                        evidence: addContext.source, confidence: addContext.confidence
                    });
                    report.changed.push('新增待办候选');
                    continue;
                }
                const titleText = titleField ? String(cells[titleField.id] || '').trim().toLowerCase() : '';
                const contentText = contentField ? String(cells[contentField.id] || '').trim().toLowerCase() : '';
                const duplicate = data.__rows.find(existing => {
                    const statusField = findFieldByPattern(table, /^当前状态$/);
                    const currentStatus = statusField ? String(existing.cells?.[statusField.id] || '') : '';
                    if (TERMINAL_TASK_STATUSES.has(currentStatus)) return false;
                    const oldTitle = titleField ? String(existing.cells?.[titleField.id] || '').trim().toLowerCase() : '';
                    const oldContent = contentField ? String(existing.cells?.[contentField.id] || '').trim().toLowerCase() : '';
                    return (titleText && oldTitle === titleText) || (contentText && oldContent === contentText);
                });
                if (duplicate) {
                    setFields(chat, template, table, duplicate.cells, operation.fields || {}, report, `合并待办:${duplicate.id}`, { rowId: duplicate.id, source: operation.source === 'user_explicit' ? 'user_explicit' : 'assistant_inferred', confidence: Number(operation.confidence) || 0 });
                    duplicate.meta ||= {};
                    duplicate.meta.updatedAt = Date.now();
                    if (window.MemoryTableLifecycle) window.MemoryTableLifecycle.recordSource(duplicate, operation.source === 'user_explicit' ? 'user_explicit' : 'assistant_inferred', { type: 'round', roundId: context.roundId || '', at: Date.now() }, { userConfirmed: operation.source === 'user_explicit' });
                    setAutoField(chat, template, table, duplicate.cells, /最后更新时间/, nowText(), report);
                    report.changed.push(`合并重复待办:${duplicate.id}`);
                    continue;
                }
                const row = { id: makeId('memory_row'), cells, meta: {
                    createdAt: Date.now(), updatedAt: Date.now(), lastMentionedAt: Date.now(), status: 'active', importance: 70,
                    source: operation.source === 'user_explicit' ? 'user_explicit' : 'assistant_inferred',
                    confidence: Math.max(0, Math.min(100, Number(operation.confidence) || 0)), pinned: false,
                    tags: ['待办'],
                    tagBundle: { topic: ['待办'], scene: ['计划制定', '任务执行'], entity: [], effect: 'reminder' },
                    usePolicy: { injectionEnabled: true, paused: false, allowedScenes: [], blockedScenes: [], maxInfluence: 'medium', cooldownRounds: 3, allowProactiveMention: false, mentionPolicy: 'relevant_only' },
                    usage: { retrievalCount: 0, injectionCount: 0, lastRetrievedAt: 0, lastInjectedAt: 0, lastInjectedRoundIndex: -999999, correctionCount: 0, helpfulCount: 0 },
                    sourceMessageIds: [],
                    evidence: { primarySource: operation.source === 'user_explicit' ? 'user_explicit' : 'assistant_inferred', userEvidenceCount: 0, behaviorEvidenceCount: 0, assistantEvidenceCount: 0, summaryEvidenceCount: 0, userConfirmed: false, lastVerifiedAt: 0, sourceRefs: [], note: '' },
                    lifecycle: { status: 'active', retentionMode: 'manual', expiresAt: 0, reviewAt: 0, decayHalfLifeDays: 30, autoArchiveAfterDays: 90, statusReason: '', archivedAt: 0, supersededAt: 0, expiredAt: 0 },
                    relations: { supersedes: [], supersededBy: [], conflictsWith: [], relatedTo: [] },
                    versionLog: []
                } };
                if (window.MemoryTableEffects) window.MemoryTableEffects.ensureRowMeta(row, table, `${cells[titleField?.id] || ''} ${cells[contentField?.id] || ''}`);
                if (window.MemoryTableLifecycle) window.MemoryTableLifecycle.recordSource(row, operation.source === 'user_explicit' ? 'user_explicit' : 'assistant_inferred', { type: 'round', roundId: context.roundId || '', at: Date.now() }, { userConfirmed: operation.source === 'user_explicit' });
                setAutoField(chat, template, table, row.cells, /事件ID/, row.id, report);
                setAutoField(chat, template, table, row.cells, /创建时间/, nowText(), report);
                setAutoField(chat, template, table, row.cells, /最后更新时间/, nowText(), report);
                const statusField = findFieldByPattern(table, /^当前状态$/);
                if (statusField && !row.cells[statusField.id]) row.cells[statusField.id] = '待办';
                data.__rows.push(row);
                report.changed.push(`新增待办:${row.id}`);
                continue;
            }
            const row = data.__rows.find(item => item.id === operation.rowId);
            if (!row) {
                report.rejected.push(`${op}: 找不到 rowId ${operation.rowId || ''}`);
                continue;
            }
            row.cells ||= {};
            row.meta ||= {};
            if (op === 'update') {
                setFields(chat, template, table, row.cells, operation.fields || {}, report, `待办:${row.id}`, { rowId: row.id, source: operation.source === 'user_explicit' ? 'user_explicit' : 'assistant_inferred', confidence: Number(operation.confidence) || 0 });
            } else if (op === 'complete') {
                setAutoField(chat, template, table, row.cells, /^当前状态$/, '已完成', report);
                setAutoField(chat, template, table, row.cells, /完成时间/, nowText(), report);
                if (operation.result) setAutoField(chat, template, table, row.cells, /^结果$/, operation.result, report);
                report.changed.push(`完成待办:${row.id}`);
            } else if (op === 'cancel') {
                setAutoField(chat, template, table, row.cells, /^当前状态$/, '取消', report);
                if (operation.reason) setAutoField(chat, template, table, row.cells, /搁置或取消原因/, operation.reason, report);
                report.changed.push(`取消待办:${row.id}`);
            } else if (op === 'reopen') {
                setAutoField(chat, template, table, row.cells, /^当前状态$/, '进行中', report);
                setAutoField(chat, template, table, row.cells, /完成时间/, '', report);
                report.changed.push(`重开待办:${row.id}`);
            }
            setAutoField(chat, template, table, row.cells, /最后更新时间/, nowText(), report);
            row.meta.updatedAt = Date.now();
            if (window.MemoryTableLifecycle) window.MemoryTableLifecycle.recordSource(row, operation.source === 'user_explicit' ? 'user_explicit' : 'assistant_inferred', { type: 'round', roundId: context.roundId || '', at: Date.now() }, { userConfirmed: operation.source === 'user_explicit' });
        }
    }

    function applyCandidates(chat, candidates, report, context) {
        const state = ensureMemoryTables(chat);
        if (state.captureCandidates === false || !Array.isArray(candidates)) return;
        candidates.slice(0, 8).forEach(item => {
            const type = item?.type === 'daily_observation' ? 'daily_observation' : 'experience';
            const descriptor = findTable(chat, table => type === 'daily_observation'
                ? tableRole(table) === 'daily_observation'
                : tableRole(table) === 'recent_events', { forCapture: true });
            if (!descriptor) return;
            const summary = String(item?.summary || '').trim().slice(0, 1600);
            if (!summary) return;
            const duplicate = state.candidates.find(existing => existing.status === 'pending' && existing.type === type && existing.summary === summary);
            if (duplicate) return;
            const tags = item.tags && typeof item.tags === 'object' ? item.tags : {};
            const targetService = Kernel.get('sidecarCandidateService');
            const target = targetService?.resolveTarget?.(chat, { type }) || null;
            const candidate = {
                id: makeId('memory_candidate'),
                type,
                summary,
                suggestedTargetTemplateId: target?.template?.id || null,
                suggestedTargetTableId: target?.table?.id || null,
                tags: {
                    topic: Array.isArray(tags.topic) ? tags.topic.map(String).slice(0, 10) : [],
                    scene: Array.isArray(tags.scene) ? tags.scene.map(String).slice(0, 10) : [],
                    entity: Array.isArray(tags.entity) ? tags.entity.map(String).slice(0, 10) : [],
                    effect: String(tags.effect || (type === 'daily_observation' ? 'temporary_state' : 'historical_context'))
                },
                confidence: Math.max(0, Math.min(100, Number(item.confidence) || 0)),
                source: item.source === 'user_explicit' ? 'user_explicit' : 'assistant_inferred',
                sourceRoundId: context?.roundId || null,
                createdAt: Date.now(),
                status: 'pending'
            };
            state.candidates.push(candidate);
            const auto = targetService?.assessAutoCommit?.(chat, candidate);
            if (auto?.direct) {
                try {
                    const result = targetService.promote(chat, candidate.id, { processedBy: 'sidecar_auto', operationId: context?.roundId || null });
                    report.changed.push(`候选直接写入:${type}:${result.matchedBy || (result.duplicate ? 'matched' : 'created')}`);
                } catch (error) {
                    report.rejected.push(`候选自动写入失败:${type}:${error?.message || String(error)}`);
                    report.changed.push(`新增候选:${type}`);
                }
            } else {
                report.changed.push(`新增候选:${type}`);
            }
        });
        state.candidates = state.candidates.slice(-MAX_CANDIDATES);
    }

    async function applySidecar(chat, payload, context = {}) {
        const state = ensureMemoryTables(chat);
        const report = { at: Date.now(), changed: [], runtimeChanged: [], pendingFieldProposals: [], rejected: [], error: '', roundId: context.roundId || null };
        if (!state.enabled || !payload || typeof payload !== 'object') return report;
        const mutate = () => {
            const currentState = ensureMemoryTables(chat);
            migrateCurrentStateReviewBatches(chat, report);
            applyStatus(chat, payload.status, report);
            applyTaskOps(chat, payload.taskOps, report, context);
            applyCandidates(chat, payload.candidates, report, context);
            flushFieldReviewBatches(chat, report, context);
            report.pendingProposalCount = Array.isArray(report.pendingFieldProposals) ? report.pendingFieldProposals.length : 0;
            delete report.pendingFieldProposals;
            currentState.lastApplyReport = report;
            currentState.history.push(report);
            currentState.history = currentState.history.slice(-MAX_HISTORY);
            if (report.changed.length) {
                chat.memoryTables.lastChangedFieldPaths = report.changed.slice(-100);
                if (window.MemoryTablePolicy) window.MemoryTablePolicy.clearRetrievalCache(chat);
            }
            return { changed: true, report };
        };
        try {
            const gateway = Kernel?.get?.('writeGateway') || Kernel?.get?.('writeCoordinator');
            if (!gateway) throw new Error('记忆正式写入门禁未加载');
            await gateway.run(chat, {
                reason: 'sidecar-chat-apply',
                source: 'sidecar-chat',
                action: 'update',
                writer: typeof saveCharacter === 'function' ? saveCharacter : null,
                persistRollback: true
            }, mutate);
            refreshStateBar(chat);
            if (typeof renderMemoryTableScreen === 'function' && typeof currentChatId !== 'undefined' && currentChatId === chat.id) {
                try { renderMemoryTableScreen(); } catch (_) {}
            }
        } catch (error) {
            report.error = error?.message || String(error);
            ensureMemoryTables(chat).lastApplyReport = report;
            console.warn('[MemorySidecar] apply failed and rolled back:', error);
        }
        return report;
    }

    function getStatusSummary(chat) {
        const descriptor = findTable(chat, isCurrentStateTable);
        if (!descriptor) return null;
        const { template, table } = descriptor;
        const data = ensureTableData(chat, template, table);
        if (isStatusExpired(table, data)) return null;
        const findValue = regex => {
            const field = (table.columns || []).find(item => regex.test(item.key));
            return field ? getFieldDisplay(field, getEffectiveFieldValue(chat, template, table, field, data[field.id])) : '';
        };
        const mentalField = (table.columns || []).find(item => /user_精神状态/.test(item.key));
        const mentalMeta = mentalField ? ensureMemoryTables(chat).statusMeta?.[mentalField.id] : null;
        return {
            scene: findValue(/user_当前场景/),
            mental: findValue(/user_精神状态/),
            body: findValue(/user_身体状态/),
            energy: findValue(/user_精力/),
            need: findValue(/user_当前需求/),
            pressure: findValue(/user_压力源/),
            validUntil: findValue(/状态有效期/),
            updatedAt: findValue(/状态记录时间/),
            inferred: mentalMeta?.source === 'assistant_inferred'
        };
    }

    function refreshStateBar(chat) {
        const bar = document.getElementById('memory-live-state-bar');
        if (!bar) return;
        if (!chat || chat.memoryTables?.enabled === false || getBoundTemplates(chat).length === 0 || ensureMemoryTables(chat).showStatusBar === false) {
            bar.style.display = 'none';
            return;
        }
        migratePolicies(chat);
        const summary = getStatusSummary(chat);
        if (!summary) {
            bar.style.display = 'none';
            return;
        }
        const mentalText = summary.mental ? `${summary.mental}${summary.inferred ? '（推测）' : ''}` : '';
        const headline = [mentalText, summary.energy ? `精力 ${summary.energy}` : '', summary.scene].filter(value => value && value !== '待记录').join(' · ');
        const detail = [summary.need && summary.need !== '待记录。' ? `需求：${summary.need}` : '', summary.pressure && summary.pressure !== '待记录。' ? `压力：${summary.pressure}` : ''].filter(Boolean).join('　');
        if (!headline && !detail) {
            bar.style.display = 'none';
            return;
        }
        bar.style.display = 'flex';
        const feedbackSnapshot = window.MemoryTableFeedback ? window.MemoryTableFeedback.getLastSnapshot(chat) : null;
        const pendingFeedback = feedbackSnapshot ? (feedbackSnapshot.items || []).filter(item => item.feedback === 'pending').length : 0;
        const feedbackChip = feedbackSnapshot ? `<button type="button" class="memory-live-feedback-chip" data-open-memory-feedback="true">本轮引用 ${(feedbackSnapshot.items || []).length}${pendingFeedback ? ` · 待反馈 ${pendingFeedback}` : ''}</button>` : '';
        bar.innerHTML = `<div class="memory-live-state-main"><strong>${escapeHtml(headline || '当前状态')}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</div><div class="memory-live-state-meta">${escapeHtml(summary.validUntil ? `有效至 ${summary.validUntil}` : (summary.updatedAt || ''))}${feedbackChip}</div>`;
        bar.title = [summary.body, summary.need, summary.pressure].filter(Boolean).join('\n');
    }

    function renderCandidatesView(chat) {
        const state = ensureMemoryTables(chat);
        const service = Kernel.get('sidecarCandidateService');
        service?.migrateLegacyCandidates?.(chat);
        const candidates = [...state.candidates]
            .filter(item => item.status !== 'deleted')
            .sort((a, b) => b.createdAt - a.createdAt);
        const pending = candidates.filter(item => item.status === 'pending' || item.status === 'legacy_unverified').length;
        const report = state.lastApplyReport;
        return `<div class="memory-sidecar-view">
            <div class="memory-sidecar-summary">
                <div><strong>聊天同请求短期更新</strong><p>当前状态和待办由正常聊天响应中的隐藏 sidecar 更新；近期经历与日常观察会按当前角色的最终策略处理：明确且允许直接写入的内容自动归档，其余进入候选。</p></div>
                <div class="memory-sidecar-badges"><span>待处理 ${pending}</span><span>协议 V${VERSION}</span></div>
            </div>
            ${report ? `<div class="memory-sidecar-last-report"><strong>最近一次解析</strong><div>写入 ${report.changed?.length || 0} 项，拒绝 ${report.rejected?.length || 0} 项${report.error ? `，错误：${escapeHtml(report.error)}` : ''}</div></div>` : ''}
            <div class="memory-sidecar-toolbar">
                <button class="btn btn-small btn-secondary" data-sidecar-action="clear-closed">清理已结束候选</button>
                <button class="btn btn-small btn-danger" data-sidecar-action="clear-all">清空候选池</button>
            </div>
            ${candidates.length ? candidates.map(item => {
                const status = item.status || 'pending';
                const actionable = status === 'pending' || status === 'legacy_unverified';
                const target = service?.resolveTarget?.(chat, item) || null;
                const mergeTargets = actionable ? (service?.listMergeTargets?.(chat, item, 30) || []) : [];
                const targetTrace = item.targetRowId
                    ? `<div class="memory-sidecar-target-trace">${status === 'merged' ? '已合并到' : '已保存到'}：${escapeHtml(item.targetTableName || item.targetTableId || '正式档案')} / ${escapeHtml(item.targetRowId)}</div>`
                    : '';
                const legacyWarning = status === 'legacy_unverified'
                    ? `<div class="memory-sidecar-warning">旧版曾标记为“已整理”，但没有目标表或目标行记录。请重新保存、合并、忽略或删除。</div>`
                    : '';
                const mergeSelect = mergeTargets.length
                    ? `<select data-sidecar-merge-target data-candidate-id="${escapeAttribute(item.id)}"><option value="">选择已有记录…</option>${mergeTargets.map(row => `<option value="${escapeAttribute(row.rowId)}">${escapeHtml(row.label)}</option>`).join('')}</select>`
                    : `<span class="memory-sidecar-no-target">${target ? '目标表暂无可合并记录' : '未找到对应正式档案表'}</span>`;
                return `<div class="memory-sidecar-candidate ${escapeAttribute(status)}" data-candidate-card-id="${escapeAttribute(item.id)}">
                    <div class="memory-sidecar-candidate-head"><strong>${item.type === 'daily_observation' ? '日常观察' : '近期经历'}</strong><span>${new Date(item.createdAt).toLocaleString()}</span></div>
                    <p>${escapeHtml(item.summary)}</p>
                    <div class="memory-sidecar-tags">${[...(item.tags?.topic || []), ...(item.tags?.scene || []), ...(item.tags?.entity || [])].map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
                    ${legacyWarning}${targetTrace}
                    <div class="memory-sidecar-target-row"><span>正式目标：${escapeHtml(target?.table?.name || item.targetTableName || '未配置')}</span>${actionable ? mergeSelect : ''}</div>
                    <div class="memory-sidecar-candidate-actions">
                        <span>置信度 ${Number(item.confidence) || 0} · ${escapeHtml(item.source || '')} · ${escapeHtml(service?.statusLabel?.(status) || status)}</span>
                        ${actionable ? `<button class="btn btn-small btn-primary" data-sidecar-action="save" data-candidate-id="${escapeAttribute(item.id)}">保存到档案</button><button class="btn btn-small btn-secondary" data-sidecar-action="merge" data-candidate-id="${escapeAttribute(item.id)}" ${mergeTargets.length ? '' : 'disabled'}>合并到已有记录</button><button class="btn btn-small btn-secondary" data-sidecar-action="dismiss" data-candidate-id="${escapeAttribute(item.id)}">暂时忽略</button>` : ''}
                        <button class="btn btn-small btn-danger" data-sidecar-action="delete" data-candidate-id="${escapeAttribute(item.id)}">${actionable ? '删除' : '移除候选记录'}</button>
                    </div>
                </div>`;
            }).join('') : '<div class="memory-review-empty"><p>还没有短期候选。</p><p>正常聊天中出现值得整理的新经历或生活观察时，会自动进入这里。</p></div>'}
        </div>`;
    }

    function bindUi() {
        const enabled = document.getElementById('memory-sidecar-enabled-toggle');
        const candidates = document.getElementById('memory-sidecar-candidate-toggle');
        const statusBar = document.getElementById('memory-sidecar-statusbar-toggle');
        const liveBar = document.getElementById('memory-live-state-bar');
        if (liveBar) {
            liveBar.style.cursor = 'pointer';
            liveBar.addEventListener('click', event => {
                if (event.target.closest('[data-open-memory-feedback]') && typeof window.openMemoryFeedbackTab === 'function') {
                    window.openMemoryFeedbackTab();
                    return;
                }
                if (typeof renderMemoryTableScreen === 'function') renderMemoryTableScreen();
                if (typeof switchScreen === 'function') switchScreen('memory-table-screen');
            });
        }
        const syncControls = () => {
            if (typeof currentChatId === 'undefined' || currentChatType !== 'private') return;
            const chat = db.characters.find(item => item.id === currentChatId);
            if (!chat) return;
            const state = ensureMemoryTables(chat);
            if (enabled) enabled.checked = state.enabled !== false;
            if (candidates) candidates.checked = state.captureCandidates !== false;
            if (statusBar) statusBar.checked = state.showStatusBar !== false;
        };
        const saveControl = async () => {
            if (typeof currentChatId === 'undefined' || currentChatType !== 'private') return;
            const chat = db.characters.find(item => item.id === currentChatId);
            if (!chat) return;
            const state = ensureMemoryTables(chat);
            if (enabled) state.enabled = enabled.checked;
            if (candidates) state.captureCandidates = candidates.checked;
            if (statusBar) state.showStatusBar = statusBar.checked;
            if (typeof saveCharacter === 'function') await saveCharacter(chat.id);
            refreshStateBar(chat);
        };
        [enabled, candidates, statusBar].filter(Boolean).forEach(input => input.addEventListener('change', saveControl));
        window.addEventListener('memory-table-screen-opened', syncControls);
        syncControls();
    }

    const api = {
        VERSION,
        ensureState: ensureMemoryTables,
        migratePolicies,
        isLiveTable,
        isCandidateSourceTable,
        buildSystemPrompt,
        extractSidecar,
        applySidecar,
        refreshStateBar,
        renderCandidatesView,
        bindUi,
        getActiveTaskRows
    };

    if (Kernel) Kernel.register('sidecar', api, { legacyGlobal: 'MemoryTableSidecar' });
    else window.MemoryTableSidecar = api;
})();
