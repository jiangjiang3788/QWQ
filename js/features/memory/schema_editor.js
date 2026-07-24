(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Model = Kernel.require('schemaModel');
    const Domain = Kernel.require('domain');
    const FieldWidth = Kernel.require('fieldWidth');
    const Policy = Kernel.get('policy');
    const FieldPolicy = Kernel.get('fieldPolicy');
    const FieldSemantics = Kernel.get('fieldSemantics');

    const escapeHtml = Core.escapeHtml;
    const escapeAttribute = Core.escapeAttribute;

    const FIELD_TYPES = [
        ['text', '短文本'], ['longtext', '长文本'], ['number', '数字'], ['enum', '单选'],
        ['tags', '标签'], ['progress', '进度'], ['date', '日期'], ['boolean', '开关']
    ];
    const LAYERS = [['core', '核心'], ['short', '短期'], ['medium', '中期'], ['long', '长期'], ['review', '审核队列']];
    const SYSTEM_ROLES = [
        ['general', '普通记忆表'], ['core_profile', '核心档案'], ['current_state', '当前状态'],
        ['tasks', '待办事项'], ['recent_events', '近期经历'], ['daily_observation', '日常观察'],
        ['medium_summary', '中期总结'], ['long_candidate', '长期候选'], ['long_store', '稳定长期库']
    ];
    const CAPTURE_MODES = [
        ['sidecar', '聊天同请求'], ['scheduled', '周期整理'], ['manual', '手动整理'], ['disabled', '关闭']
    ];
    const COMMIT_MODES = [
        ['direct', '自动生效'], ['pending', '待确认'], ['manual_only', '仅人工编辑']
    ];

    function isPromotionTable(table) {
        const normalized = Policy?.normalizeTablePolicy ? Policy.normalizeTablePolicy(table || {}) : (table || {});
        return (normalized.systemRole || table?.systemRole || '') === 'long_candidate';
    }

    function displayCommitMode(mode) {
        return mode === 'review' || mode === 'candidate' ? 'pending' : (mode || 'pending');
    }

    function commitModeChoices(table) {
        const choices = COMMIT_MODES.map(item => [...item]);
        if (isPromotionTable(table)) choices.push(['promotion', '长期晋升']);
        return choices;
    }

    function resolveUiCommitMode(table, requested, currentMode = '') {
        if (requested !== 'pending') return requested;
        const normalized = Policy?.normalizeTablePolicy ? Policy.normalizeTablePolicy(table || {}) : (table || {});
        const current = currentMode || normalized.commitPolicy?.mode || table?.commitPolicy?.mode || '';
        if (current === 'review' || current === 'candidate') return current;
        const role = normalized.systemRole || table?.systemRole || 'general';
        return ['recent_events', 'daily_observation'].includes(role) ? 'candidate' : 'review';
    }
    const API_MODES = [['none', '不额外调用'], ['main', '主聊天 API'], ['summary', '总结 API']];
    const FREQUENCY_SOURCES = [['global', '使用全局默认'], ['table', '本表自定义']];

    const FIELD_SUBJECTS = [['user', '用户'], ['assistant', '角色'], ['relationship', '双方关系'], ['system', '系统运行']];
    const FIELD_EVIDENCE = [['explicit', '用户明确表达'], ['inferred', '允许推断'], ['manual', '仅人工确认']];
    const FIELD_COMMIT_MODES = [['inherit', '继承表格'], ['direct', '自动生效'], ['pending', '待确认'], ['runtime_only', '仅运行态'], ['manual_only', '仅人工编辑']];

    const SEMANTIC_LABELS = Object.freeze({
        custom: '自定义', system_timestamp: '系统时间', created_at: '创建时间', updated_at: '更新时间', completed_at: '完成时间', state_recorded_at: '状态记录时间', event_date: '事件发生时间', event_id: '事件标识', source_record_id: '来源记录标识',
        record_type: '记录类型', title: '标题', content: '正文', related_entity: '相关主体', impact: '影响',
        status: '状态', next_action: '下一步', result: '结果', cancel_reason: '取消原因', observation_date: '观察日期',
        sleep: '睡眠', hydration: '饮水', activity: '活动', body_state: '身体状态', energy_mood: '精力情绪',
        data_completeness: '数据完整度', source_note: '来源说明', user_scene: '用户场景', user_mental_state: '用户精神状态',
        user_body_state: '用户身体状态', user_stamina: '用户体力', user_energy: '用户精力', user_stressor: '用户压力源',
        user_need: '用户需求', user_risk: '用户风险', user_next_step: '用户下一步建议', assistant_scene: '角色场景',
        assistant_mental_state: '角色精神状态', assistant_runtime_state: '角色运行态', assistant_user_assessment: '角色对用户判断',
        assistant_response_strategy: '角色回应策略', assistant_boundary_reminder: '角色边界提醒', state_expires_at: '状态有效期',
        user_profile: '用户档案', assistant_profile: '角色档案', relationship_definition: '关系定义',
        relationship_addressing: '称呼系统', relationship_agreement: '相处约定', topic: '主题', summary: '摘要',
        growth_subject: '成长主体', old_pattern: '旧模式', new_response: '新反应', evidence: '证据',
        growth_meaning: '成长意义', stability: '稳定程度', reusable_experience: '可复用经验', confidence: '置信度',
        candidate_category: '候选类别', candidate_content: '候选内容', exception: '反例或例外', observation_span: '观察跨度',
        evidence_count: '证据次数', review_status: '审核状态', source_domain: '来源域', dimension: '维度',
        category: '分类', confirmation_status: '确认状态', applicability_exception: '适用场景或例外'
    });
    const SEMANTIC_ROLES = (FieldSemantics?.SEMANTIC_ROLES || ['custom']).map(role => [role, SEMANTIC_LABELS[role] || role]);
    const IDENTITY_ROLES = [['none', '不参与身份'], ['primary_key', '主业务键'], ['source_key', '来源键'], ['title', '标题'], ['date', '日期'], ['content', '内容'], ['volatile', '易变技术字段']];

    function displayFieldCommitMode(mode) {
        return mode === 'review' || mode === 'candidate' ? 'pending' : (mode || 'inherit');
    }

    function resolveFieldUiCommitMode(field, table, requested, currentMode = '') {
        if (requested !== 'pending') return requested;
        const current = currentMode || field?.writePolicy?.commitMode || '';
        if (current === 'review' || current === 'candidate') return current;
        const tableMode = Policy?.normalizeTablePolicy ? Policy.normalizeTablePolicy(table || {}).commitPolicy?.mode : table?.commitPolicy?.mode;
        return tableMode === 'candidate' ? 'candidate' : 'review';
    }

    function selected(value, expected) { return String(value) === String(expected) ? 'selected' : ''; }

    const fieldNameVisualUnits = FieldWidth.visualUnits;
    function fieldNameColumnWidth(table) { return FieldWidth.schemaFieldNames(table); }

    function applyFieldNameWidth(root, draft, state) {
        const tableIndex = Math.min(Math.max(0, Number(state?.activeTableIndex) || 0), Math.max(0, (draft?.tables || []).length - 1));
        const table = draft?.tables?.[tableIndex];
        const grid = root?.querySelector?.('.memory-schema-fields-grid');
        if (!table || !grid) return null;
        const width = fieldNameColumnWidth(table);
        grid.style.setProperty('--schema-field-name-width', `${width.desktop}px`);
        grid.style.setProperty('--schema-field-name-width-mobile', `${width.mobile}px`);
        grid.dataset.schemaNameWidthDesktop = String(width.desktop);
        grid.dataset.schemaNameWidthMobile = String(width.mobile);
        grid.dataset.schemaNameMaxUnits = String(width.longestUnits);
        return width;
    }

    function renderInput(role, value, options = {}) {
        const attrs = [
            `data-schema-role="${escapeAttribute(role)}"`,
            options.tableIndex != null ? `data-table-index="${options.tableIndex}"` : '',
            options.fieldIndex != null ? `data-field-index="${options.fieldIndex}"` : '',
            options.title ? `title="${escapeAttribute(options.title)}"` : '',
            options.placeholder ? `placeholder="${escapeAttribute(options.placeholder)}"` : '',
            options.className ? `class="${escapeAttribute(options.className)}"` : '',
            options.policyPath ? `data-policy-path="${escapeAttribute(options.policyPath)}"` : '',
            options.internalMode ? `data-commit-internal-mode="${escapeAttribute(options.internalMode)}"` : '',
            options.disabled ? 'disabled' : ''
        ].filter(Boolean).join(' ');
        if (options.choices) return `<select ${attrs}>${options.choices.map(item => {
            const pair = Array.isArray(item) ? item : [item, item];
            return `<option value="${escapeAttribute(pair[0])}" ${selected(value, pair[0])}>${escapeHtml(pair[1])}</option>`;
        }).join('')}</select>`;
        if (options.multiline) return `<textarea rows="${options.rows || 2}" ${attrs}>${escapeHtml(value ?? '')}</textarea>`;
        const type = options.type || 'text';
        const extra = options.step != null ? ` step="${escapeAttribute(options.step)}"` : '';
        return `<input type="${type}" ${attrs}${extra} value="${escapeAttribute(value ?? '')}">`;
    }

    function renderSummary(draft, state = {}) {
        const summary = Model.summarize(draft);
        const roleScope = state.policyScope === 'role';
        return `<section class="memory-schema-summary" aria-label="模板设置">
            <label><span>模板名称</span>${renderInput('template-name', draft.name || '', { disabled: roleScope })}</label>
            <label class="memory-schema-description"><span>模板描述</span>${renderInput('template-description', draft.description || '', { multiline: true, rows: 2, disabled: roleScope })}</label>
            <div class="memory-schema-counts"><b>${summary.tableCount}</b><span>张表</span><b>${summary.fieldCount}</b><span>字段</span><b>${summary.groupCount}</b><span>分组</span></div>
        </section>`;
    }

    function runtimeCell(runtime, key, fallback = '—') {
        const value = runtime?.[key];
        return value === undefined || value === null || value === '' ? fallback : escapeHtml(String(value));
    }

    function sourceBadge(source) {
        const label = stateSourceLabel(source);
        return `<span class="memory-schema-source-badge source-${escapeAttribute(source || 'system')}">${escapeHtml(label)}</span>`;
    }

    function stateSourceLabel(source) {
        return ({ role: '当前角色', template: '模板', global: '全局', system: '系统' })[source] || '系统';
    }

    function renderPolicyScope(state) {
        const roleAvailable = state.roleScopeAvailable !== false;
        const roleScope = state.policyScope === 'role';
        return `<section class="memory-schema-policy-scope" aria-label="策略设置范围">
            <div><strong>设置范围</strong><span>${roleScope ? '只影响当前角色；没有覆盖的项目继续继承模板或全局默认。' : '修改模板默认；所有绑定此模板的角色都会继承，已有角色覆盖不受影响。'}</span></div>
            <div class="memory-schema-scope-actions">
                <button type="button" class="${roleScope ? '' : 'active'}" data-schema-action="policy-scope-template">模板默认</button>
                <button type="button" class="${roleScope ? 'active' : ''}" data-schema-action="policy-scope-role" ${roleAvailable ? '' : 'disabled'}>当前角色覆盖</button>
            </div>
        </section>`;
    }

    function renderEffectiveSummary(resolution) {
        if (!resolution) return '<span class="memory-schema-effective-empty">保存后计算</span>';
        const labels = resolution.labels || {};
        const counts = FieldPolicy?.summarizeRoutes?.(resolution.materializedTable) || {};
        const pending = Number(counts.review || 0) + Number(counts.candidate || 0);
        const pendingDetail = counts.review && counts.candidate ? `（审核 ${counts.review} · 候选 ${counts.candidate}）` : '';
        const parts = [
            counts.direct ? `直接写入 ${counts.direct}` : '',
            pending ? `待确认 ${pending}${pendingDetail}` : '',
            counts.runtime_only ? `仅运行态 ${counts.runtime_only}` : '',
            counts.manual_only ? `仅人工 ${counts.manual_only}` : '',
            counts.blocked ? `禁止自动写入 ${counts.blocked}` : ''
        ].filter(Boolean);
        const fieldSummary = parts.length ? `字段实际分流：${parts.join(' · ')}` : '字段实际分流：无可写字段';
        return `<div class="memory-schema-effective-summary"><strong>${escapeHtml(labels.capture || '')}</strong><span>${escapeHtml(labels.commit || '')}</span><span>${escapeHtml(labels.schedule || '')}</span><span>${escapeHtml(labels.injection || '')}</span><small class="memory-schema-field-route-summary">${escapeHtml(fieldSummary)}</small></div>`;
    }

    function renderSourceSummary(resolution) {
        if (!resolution) return '—';
        const sources = resolution.sourceSummary || {};
        return `<div class="memory-schema-source-summary"><label>采集${sourceBadge(sources.capture)}</label><label>写入${sourceBadge(sources.commit)}</label><label>周期${sourceBadge(sources.schedule)}</label><label>召回${sourceBadge(sources.injection)}</label></div>`;
    }

    function renderTableSettings(draft, state) {
        const conflicts = Model.roleConflicts(draft);
        const runtimeByTableId = state.runtimeByTableId || {};
        const effectiveByTableId = state.effectiveByTableId || {};
        const roleScope = state.policyScope === 'role';
        const policy = (role, path, value, options = {}) => renderInput(role, value, { ...options, policyPath: path });
        return `<section class="memory-schema-unified-section" aria-label="表格设置">
            <div class="memory-schema-section-head"><div><strong>表格策略与结构</strong><small>“当前生效”是系统实际使用的结果；来源会标明当前角色、模板、全局或系统默认。</small></div><button type="button" class="btn btn-small btn-primary" data-schema-action="add-table" ${roleScope ? 'disabled' : ''}>新增表格</button></div>
            <div class="memory-schema-column-legend"><span>基础</span><span>采集与写入</span><span>周期</span><span>召回</span><span>有效值与来源</span><span>运行状态</span></div>
            <div class="memory-schema-grid-wrap memory-schema-wide-grid-wrap"><table class="memory-schema-grid memory-schema-tables-grid memory-schema-unified-table-grid">
                <thead><tr>
                    <th>表格名称</th><th>表格职责</th><th>形态</th><th>层级</th>
                    <th>信息来源</th><th>写入方式</th><th>调用 API</th><th>频率来源</th>
                    <th>触发</th><th>轮数</th><th>消息数</th><th>读取上限</th><th>重叠消息</th>
                    <th>新增</th><th>修改</th><th>删除</th>
                    <th>注入</th><th>Top-K</th><th>阈值</th><th>预算</th><th>有效期</th><th>置顶</th><th>已完成</th>
                    <th>提取规则</th><th>更新规则</th><th>注入规则</th><th>字段</th>
                    <th>当前生效</th><th>来源</th>
                    <th>未处理</th><th>上次运行</th><th>待确认</th><th>游标</th><th>运行</th><th>操作</th>
                </tr></thead>
                <tbody>${draft.tables.map((table, tableIndex) => {
                    const resolution = effectiveByTableId[table.id] || null;
                    const normalized = roleScope && resolution?.effective
                        ? resolution.effective
                        : (Policy?.normalizeTablePolicy ? Policy.normalizeTablePolicy(table) : table);
                    const layer = normalized.memoryLayer || table.memoryLayer || 'short';
                    const role = normalized.systemRole || table.systemRole || 'general';
                    const capture = normalized.capturePolicy || table.capturePolicy || { mode: 'manual', frequencySource: 'table', apiMode: 'summary' };
                    const commit = normalized.commitPolicy || table.commitPolicy || { mode: 'review' };
                    const update = normalized.updatePolicy || table.updatePolicy || {};
                    const inject = normalized.injectionPolicy || table.injectionPolicy || {};
                    const scheduled = capture.mode === 'scheduled';
                    const ownSchedule = scheduled && capture.frequencySource === 'table';
                    const runtime = runtimeByTableId[table.id];
                    const conflict = conflicts.get(tableIndex) || runtime?.roleConflict;
                    return `<tr class="${tableIndex === state.activeTableIndex ? 'active' : ''} ${conflict ? 'has-role-conflict' : ''}" data-schema-table-row="${tableIndex}">
                        <td class="memory-schema-sticky-name">${renderInput('table-name', table.name || '', { tableIndex, title: table.name || '', disabled: roleScope })}</td>
                        <td class="memory-schema-role-cell">${renderInput('table-system-role', role, { tableIndex, choices: SYSTEM_ROLES, disabled: roleScope })}${conflict ? `<small class="memory-schema-conflict">同一职责重复 ${conflict.count} 次</small>` : ''}</td>
                        <td>${renderInput('table-mode', table.mode || 'keyValue', { tableIndex, choices: [['keyValue', 'KV'], ['rows', '多行']], disabled: roleScope })}</td>
                        <td>${renderInput('table-memory-layer', layer, { tableIndex, choices: LAYERS, disabled: roleScope })}</td>
                        <td>${policy('table-capture-mode', 'capturePolicy.mode', capture.mode, { tableIndex, choices: CAPTURE_MODES })}</td>
                        <td>${policy('table-commit-mode', 'commitPolicy.mode', displayCommitMode(commit.mode), { tableIndex, choices: commitModeChoices(table), internalMode: commit.mode })}</td>
                        <td>${policy('table-api-mode', 'capturePolicy.apiMode', capture.apiMode, { tableIndex, choices: API_MODES, disabled: capture.mode === 'sidecar' || capture.mode === 'disabled' })}</td>
                        <td>${policy('table-frequency-source', 'capturePolicy.frequencySource', capture.frequencySource, { tableIndex, choices: FREQUENCY_SOURCES, disabled: !scheduled })}</td>
                        <td>${policy('table-trigger-mode', 'updatePolicy.triggerMode', update.triggerMode || 'manual', { tableIndex, choices: [['rounds', '按轮'], ['messages', '按消息'], ['either', '先到者'], ['manual', '仅手动']], disabled: !ownSchedule })}</td>
                        <td>${policy('table-round-interval', 'updatePolicy.roundInterval', update.roundInterval ?? '', { tableIndex, type: 'number', placeholder: '默认', disabled: !ownSchedule })}</td>
                        <td>${policy('table-message-interval', 'updatePolicy.messageInterval', update.messageInterval ?? '', { tableIndex, type: 'number', placeholder: '默认', disabled: !ownSchedule })}</td>
                        <td>${policy('table-max-source-messages', 'updatePolicy.maxSourceMessages', update.maxSourceMessages ?? '', { tableIndex, type: 'number', placeholder: '默认', disabled: !ownSchedule })}</td>
                        <td>${policy('table-overlap-messages', 'updatePolicy.overlapMessages', update.overlapMessages ?? '', { tableIndex, type: 'number', placeholder: '默认', disabled: !ownSchedule })}</td>
                        <td>${policy('table-allow-add', 'updatePolicy.allowAdd', update.allowAdd !== false ? 'true' : 'false', { tableIndex, choices: [['true', '允许'], ['false', '禁止']] })}</td>
                        <td>${policy('table-allow-update', 'updatePolicy.allowUpdate', update.allowUpdate !== false ? 'true' : 'false', { tableIndex, choices: [['true', '允许'], ['false', '禁止']] })}</td>
                        <td>${policy('table-allow-delete', 'updatePolicy.allowDelete', update.allowDelete ? 'true' : 'false', { tableIndex, choices: [['false', '禁止'], ['true', '允许']] })}</td>
                        <td>${policy('table-injection-mode', 'injectionPolicy.mode', inject.mode || 'never', { tableIndex, choices: [['always', '始终'], ['active', '有效项'], ['relevant', '相关'], ['never', '从不']] })}</td>
                        <td>${policy('table-injection-top-k', 'injectionPolicy.topK', inject.topK ?? '', { tableIndex, type: 'number', placeholder: '可空' })}</td>
                        <td>${policy('table-injection-threshold', 'injectionPolicy.threshold', inject.threshold ?? '', { tableIndex, type: 'number', step: '0.01', placeholder: '可空' })}</td>
                        <td>${policy('table-injection-budget', 'injectionPolicy.budget', inject.budget ?? '', { tableIndex, type: 'number', placeholder: '可空' })}</td>
                        <td>${policy('table-max-age-days', 'injectionPolicy.maxAgeDays', inject.maxAgeDays ?? '', { tableIndex, type: 'number', placeholder: '可空' })}</td>
                        <td>${policy('table-include-pinned', 'injectionPolicy.includePinned', inject.includePinned !== false ? 'true' : 'false', { tableIndex, choices: [['true', '包含'], ['false', '排除']] })}</td>
                        <td>${policy('table-include-completed', 'injectionPolicy.includeCompleted', inject.includeCompleted ? 'true' : 'false', { tableIndex, choices: [['false', '排除'], ['true', '包含']] })}</td>
                        <td class="memory-schema-long-cell">${renderInput('table-extract-prompt', table.extractPrompt || '', { tableIndex, multiline: true, rows: 3, placeholder: '可空', disabled: roleScope })}</td>
                        <td class="memory-schema-long-cell">${policy('table-update-instructions', 'updatePolicy.instructions', update.instructions || '', { tableIndex, multiline: true, rows: 3, placeholder: '可空' })}</td>
                        <td class="memory-schema-long-cell">${policy('table-injection-instructions', 'injectionPolicy.instructions', inject.instructions || '', { tableIndex, multiline: true, rows: 3, placeholder: '可空' })}</td>
                        <td><button type="button" class="memory-schema-field-count ${tableIndex === state.activeTableIndex ? 'active' : ''}" data-schema-action="select-fields" data-table-index="${tableIndex}">${(table.columns || []).length} 个字段</button></td>
                        <td class="memory-schema-effective-cell">${renderEffectiveSummary(resolution)}</td>
                        <td class="memory-schema-source-cell">${renderSourceSummary(resolution)}</td>
                        <td class="memory-schema-runtime-cell">${runtimeCell(runtime, 'unsyncedMessages')}</td>
                        <td class="memory-schema-runtime-cell">${runtimeCell(runtime, 'lastRunLabel')}</td>
                        <td class="memory-schema-runtime-cell">${runtime?.pendingReview ? '有' : (runtime ? '无' : '—')}</td>
                        <td class="memory-schema-runtime-cell">${runtimeCell(runtime, 'cursorPosition')}</td>
                        <td><div class="memory-schema-runtime-actions"><button type="button" data-schema-action="run-table-update" data-table-index="${tableIndex}" ${runtime ? '' : 'disabled'}>整理</button><button type="button" data-schema-action="cursor-start" data-table-index="${tableIndex}" ${runtime ? '' : 'disabled'}>从头</button><button type="button" data-schema-action="cursor-latest" data-table-index="${tableIndex}" ${runtime ? '' : 'disabled'}>最新</button></div></td>
                        <td>${roleScope
                            ? `<button type="button" class="memory-schema-reset-override" data-schema-action="reset-role-override" data-table-index="${tableIndex}" ${resolution?.hasRoleOverride ? '' : 'disabled'}>恢复模板</button>`
                            : `<div class="memory-schema-row-actions"><button type="button" data-schema-action="move-table-up" data-table-index="${tableIndex}" aria-label="上移">↑</button><button type="button" data-schema-action="move-table-down" data-table-index="${tableIndex}" aria-label="下移">↓</button><button type="button" class="danger" data-schema-action="remove-table" data-table-index="${tableIndex}" aria-label="删除">×</button></div>`}</td>
                    </tr>`;
                }).join('')}</tbody>
            </table></div>
        </section>`;
    }

    function renderFieldSettings(draft, state) {
        const tableIndex = state.activeTableIndex || 0;
        const table = draft.tables?.[tableIndex];
        if (!table) return '<section class="memory-schema-unified-section"><div class="memory-schema-empty">还没有表格。</div></section>';
        const groups = Model.fieldGroups(table);
        const width = fieldNameColumnWidth(table);
        const roleScope = state.policyScope === 'role';
        return `<section class="memory-schema-unified-section memory-schema-fields-section ${roleScope ? 'is-readonly' : ''}" id="memory-schema-fields-section" aria-label="字段设置">
            <div class="memory-schema-section-head"><div><strong>${escapeHtml(table.name)} · 字段设置</strong><small>字段 ID 不在日常界面显示；选项、最小值和最大值都允许留空；每个字段可以独立决定主体、证据要求、写入方式和最低置信度。</small></div><button type="button" class="btn btn-small btn-primary" data-schema-action="add-field" data-table-index="${tableIndex}" ${roleScope ? 'disabled' : ''}>新增字段</button></div>
            <div class="memory-schema-grid-wrap memory-schema-wide-grid-wrap"><table class="memory-schema-grid memory-schema-fields-grid memory-schema-unified-field-grid" style="--schema-field-name-width:${width.desktop}px;--schema-field-name-width-mobile:${width.mobile}px" data-schema-name-width-desktop="${width.desktop}" data-schema-name-width-mobile="${width.mobile}" data-schema-name-max-units="${width.longestUnits}">
                <colgroup><col class="schema-col-group"><col class="schema-col-name"><col class="schema-col-type"><col class="schema-col-semantic"><col class="schema-col-identity"><col class="schema-col-default"><col class="schema-col-options"><col class="schema-col-min"><col class="schema-col-max"><col class="schema-col-display"><col class="schema-col-ai"><col class="schema-col-subject"><col class="schema-col-evidence"><col class="schema-col-commit"><col class="schema-col-confidence"><col class="schema-col-summary"><col class="schema-col-format"><col class="schema-col-hint"><col class="schema-col-rules"><col class="schema-col-actions"></colgroup>
                <thead><tr><th>分组</th><th>字段名</th><th>类型</th><th>字段语义</th><th>身份作用</th><th>默认值</th><th>选项</th><th>最小值</th><th>最大值</th><th>普通显示</th><th>AI 编辑</th><th>信息主体</th><th>证据要求</th><th>字段写入</th><th>最低置信度</th><th>摘要标签</th><th>显示格式</th><th>AI 提示</th><th>条件规则</th><th>操作</th></tr></thead>
                ${groups.map(group => `<tbody><tr class="memory-schema-group-row"><th colspan="20"><span>${escapeHtml(group.name)}</span><small>${group.fields.length} 个字段</small></th></tr>${group.fields.map(({ field, index }) => `<tr>
                    <td>${renderInput('field-group', field.group || '', { tableIndex, fieldIndex: index, placeholder: '未分组' })}</td>
                    <td class="memory-schema-sticky-field-name">${renderInput('field-key', field.key || '', { tableIndex, fieldIndex: index, title: field.key || '', className: 'schema-col-name' })}</td>
                    <td>${renderInput('field-type', field.type || 'text', { tableIndex, fieldIndex: index, choices: FIELD_TYPES })}</td>
                    <td>${renderInput('field-semantic-role', FieldSemantics?.semanticRole?.(field, table) || field.semanticRole || 'custom', { tableIndex, fieldIndex: index, choices: SEMANTIC_ROLES })}</td>
                    <td>${renderInput('field-identity-role', FieldSemantics?.identityRole?.(field, table) || field.identityRole || 'none', { tableIndex, fieldIndex: index, choices: IDENTITY_ROLES })}</td>
                    <td>${renderInput('field-default', Array.isArray(field.default) ? field.default.join(', ') : (field.default ?? ''), { tableIndex, fieldIndex: index, multiline: field.type === 'longtext', rows: field.type === 'longtext' ? 3 : 2, placeholder: '可空' })}</td>
                    <td>${renderInput('field-options', (field.options || []).join('\n'), { tableIndex, fieldIndex: index, multiline: true, rows: 3, placeholder: '可空' })}</td>
                    <td>${renderInput('field-min', field.min ?? '', { tableIndex, fieldIndex: index, type: 'number', placeholder: '可空' })}</td>
                    <td>${renderInput('field-max', field.max ?? '', { tableIndex, fieldIndex: index, type: 'number', placeholder: '可空' })}</td>
                    <td>${renderInput('field-important', field.important !== false ? 'true' : 'false', { tableIndex, fieldIndex: index, choices: [['true', '显示'], ['false', '隐藏']] })}</td>
                    <td>${renderInput('field-ai-editable', field.aiEditable !== false ? 'true' : 'false', { tableIndex, fieldIndex: index, choices: [['true', '允许'], ['false', '只读']] })}</td>
                    <td>${renderInput('field-policy-subject', (FieldPolicy?.normalizeFieldPolicy(field, table) || field.writePolicy || {}).subject || 'user', { tableIndex, fieldIndex: index, choices: FIELD_SUBJECTS })}</td>
                    <td>${renderInput('field-policy-evidence', (FieldPolicy?.normalizeFieldPolicy(field, table) || field.writePolicy || {}).evidence || 'explicit', { tableIndex, fieldIndex: index, choices: FIELD_EVIDENCE })}</td>
                    <td>${(() => { const mode = (FieldPolicy?.normalizeFieldPolicy(field, table) || field.writePolicy || {}).commitMode || 'inherit'; return renderInput('field-policy-commit', displayFieldCommitMode(mode), { tableIndex, fieldIndex: index, choices: FIELD_COMMIT_MODES, internalMode: mode }); })()}</td>
                    <td>${renderInput('field-policy-confidence', (FieldPolicy?.normalizeFieldPolicy(field, table) || field.writePolicy || {}).minConfidence ?? 60, { tableIndex, fieldIndex: index, type: 'number', placeholder: '0-100' })}</td>
                    <td>${renderInput('field-summary-label', field.summaryLabel || '', { tableIndex, fieldIndex: index, placeholder: '可空' })}</td>
                    <td>${renderInput('field-display-format', field.displayFormat || '{value}', { tableIndex, fieldIndex: index, placeholder: '{value}' })}</td>
                    <td class="memory-schema-long-cell">${renderInput('field-ai-hint', field.aiHint || '', { tableIndex, fieldIndex: index, multiline: true, rows: 3, placeholder: '可空' })}</td>
                    <td class="memory-schema-long-cell">${renderInput('field-conditional-rules', Domain.serializeConditionalRules(field.conditionalRules || []), { tableIndex, fieldIndex: index, multiline: true, rows: 3, placeholder: '可空' })}</td>
                    <td><div class="memory-schema-row-actions"><button type="button" data-schema-action="move-field-up" data-table-index="${tableIndex}" data-field-index="${index}" aria-label="上移">↑</button><button type="button" data-schema-action="move-field-down" data-table-index="${tableIndex}" data-field-index="${index}" aria-label="下移">↓</button><button type="button" class="danger" data-schema-action="remove-field" data-table-index="${tableIndex}" data-field-index="${index}" aria-label="删除">×</button></div></td>
                </tr>`).join('')}</tbody>`).join('')}
            </table></div>
        </section>`;
    }

    function renderRawJson(draft, state = {}) {
        return `<details class="memory-schema-raw" ${state.policyScope === 'role' ? 'hidden' : ''}><summary>高级：导入或查看原始 JSON</summary><p>内部 ID 只在这里保留，用于导入、导出和故障排查；日常配置请使用上面的统一表格。</p><textarea id="memory-schema-raw-json" rows="14">${escapeHtml(JSON.stringify(draft, null, 2))}</textarea><div><button type="button" class="btn btn-small btn-secondary" data-schema-action="refresh-raw-json">用当前结构刷新</button><button type="button" class="btn btn-small btn-primary" data-schema-action="apply-raw-json">应用原始 JSON</button></div></details>`;
    }

    function render(draft, state) {
        const safeState = state || {};
        safeState.activeTableIndex = Math.min(Math.max(0, Number(safeState.activeTableIndex) || 0), Math.max(0, (draft.tables || []).length - 1));
        return `${renderSummary(draft, safeState)}${renderPolicyScope(safeState)}<div class="memory-schema-unified-note"><strong>统一结构工作台 · 有效策略</strong><span>模板默认与当前角色覆盖共用同一解释器；表格右侧会显示最终生效结果和来源。</span></div>${renderTableSettings(draft, safeState)}${renderFieldSettings(draft, safeState)}${renderRawJson(draft, safeState)}`;
    }

    function target(draft, tableIndex, fieldIndex) {
        if (tableIndex == null) return draft;
        const table = draft.tables?.[tableIndex];
        if (fieldIndex == null) return table;
        return table?.columns?.[fieldIndex];
    }

    function updateRole(draft, element) {
        const role = element.dataset.schemaRole;
        if (!role) return false;
        const tableIndex = element.dataset.tableIndex !== undefined ? Number(element.dataset.tableIndex) : undefined;
        const fieldIndex = element.dataset.fieldIndex !== undefined ? Number(element.dataset.fieldIndex) : undefined;
        const item = target(draft, tableIndex, fieldIndex);
        if (!item) return false;
        const value = element.value;
        const ensurePolicies = () => {
            const normalized = Policy?.normalizeTablePolicy ? Policy.normalizeTablePolicy(item) : item;
            item.memoryLayer = normalized.memoryLayer || item.memoryLayer || 'short';
            item.systemRole = normalized.systemRole || item.systemRole || 'general';
            item.capturePolicy = normalized.capturePolicy || item.capturePolicy || { mode: 'manual', frequencySource: 'table', apiMode: 'summary' };
            item.commitPolicy = normalized.commitPolicy || item.commitPolicy || { mode: 'review', requireUserConfirmation: true };
            item.updatePolicy = normalized.updatePolicy || item.updatePolicy || {};
            item.injectionPolicy = normalized.injectionPolicy || item.injectionPolicy || {};
        };
        const optionalNumber = (raw, fallback = undefined) => raw === '' ? fallback : Number(raw);
        switch (role) {
            case 'template-name': draft.name = value; break;
            case 'template-description': draft.description = value; break;
            case 'table-name': item.name = value; break;
            case 'table-mode': item.mode = value === 'rows' ? 'rows' : 'keyValue'; break;
            case 'table-memory-layer': item.memoryLayer = value; ensurePolicies(); break;
            case 'table-system-role': item.systemRole = value; ensurePolicies(); break;
            case 'table-capture-mode':
                ensurePolicies(); item.capturePolicy.mode = value;
                if (value === 'sidecar' || value === 'disabled') item.capturePolicy.apiMode = 'none';
                item.updatePolicy.enabled = value === 'scheduled';
                item.updatePolicy.triggerMode = value === 'scheduled' && item.updatePolicy.triggerMode === 'manual' ? 'either' : (value === 'scheduled' ? item.updatePolicy.triggerMode : 'manual');
                break;
            case 'table-commit-mode': {
                ensurePolicies();
                const resolvedMode = resolveUiCommitMode(item, value);
                item.commitPolicy.mode = resolvedMode;
                item.commitPolicy.requireUserConfirmation = resolvedMode === 'review' || resolvedMode === 'promotion';
                break;
            }
            case 'table-api-mode': ensurePolicies(); item.capturePolicy.apiMode = value; if (value !== 'none') item.updatePolicy.useSummaryApi = value === 'summary'; break;
            case 'table-frequency-source': ensurePolicies(); item.capturePolicy.frequencySource = value; break;
            case 'table-extract-prompt': item.extractPrompt = value; break;
            case 'table-trigger-mode': ensurePolicies(); item.updatePolicy.triggerMode = value; break;
            case 'table-round-interval': ensurePolicies(); item.updatePolicy.roundInterval = Math.max(0, optionalNumber(value, 0) || 0); break;
            case 'table-message-interval': ensurePolicies(); item.updatePolicy.messageInterval = Math.max(0, optionalNumber(value, 0) || 0); break;
            case 'table-max-source-messages': ensurePolicies(); item.updatePolicy.maxSourceMessages = Math.max(10, optionalNumber(value, 10) || 10); break;
            case 'table-overlap-messages': ensurePolicies(); item.updatePolicy.overlapMessages = Math.max(0, optionalNumber(value, 0) || 0); break;
            case 'table-allow-add': ensurePolicies(); item.updatePolicy.allowAdd = value === 'true'; break;
            case 'table-allow-update': ensurePolicies(); item.updatePolicy.allowUpdate = value === 'true'; break;
            case 'table-allow-delete': ensurePolicies(); item.updatePolicy.allowDelete = value === 'true'; break;
            case 'table-update-instructions': ensurePolicies(); item.updatePolicy.instructions = value; break;
            case 'table-injection-mode': ensurePolicies(); item.injectionPolicy.mode = value; break;
            case 'table-injection-top-k': ensurePolicies(); item.injectionPolicy.topK = Math.max(0, optionalNumber(value, 0) || 0); break;
            case 'table-injection-threshold': ensurePolicies(); item.injectionPolicy.threshold = Math.max(0, Math.min(1, optionalNumber(value, 0) || 0)); break;
            case 'table-injection-budget': ensurePolicies(); item.injectionPolicy.budget = Math.max(0, optionalNumber(value, 0) || 0); break;
            case 'table-max-age-days': ensurePolicies(); item.injectionPolicy.maxAgeDays = Math.max(0, optionalNumber(value, 0) || 0); break;
            case 'table-include-pinned': ensurePolicies(); item.injectionPolicy.includePinned = value === 'true'; break;
            case 'table-include-completed': ensurePolicies(); item.injectionPolicy.includeCompleted = value === 'true'; break;
            case 'table-injection-instructions': ensurePolicies(); item.injectionPolicy.instructions = value; break;
            case 'field-key': item.key = value; break;
            case 'field-group': item.group = value; break;
            case 'field-type': item.type = Domain.normalizeFieldType(value); break;
            case 'field-semantic-role': item.semanticRole = FieldSemantics?.normalizeSemanticRole?.(value, item, draft.tables?.[tableIndex]) || value || 'custom'; break;
            case 'field-identity-role': item.identityRole = FieldSemantics?.normalizeIdentityRole?.(value, item, draft.tables?.[tableIndex]) || value || 'none'; break;
            case 'field-default': item.default = item.type === 'tags' ? Domain.parseOptionText(value) : value; break;
            case 'field-ai-editable': item.aiEditable = value !== 'false'; break;
            case 'field-policy-subject': item.writePolicy = { ...(FieldPolicy?.normalizeFieldPolicy(item, draft.tables?.[tableIndex]) || item.writePolicy || {}), subject: value }; break;
            case 'field-policy-evidence': item.writePolicy = { ...(FieldPolicy?.normalizeFieldPolicy(item, draft.tables?.[tableIndex]) || item.writePolicy || {}), evidence: value }; break;
            case 'field-policy-commit': {
                const normalizedField = FieldPolicy?.normalizeFieldPolicy(item, draft.tables?.[tableIndex]) || item.writePolicy || {};
                item.writePolicy = { ...normalizedField, commitMode: resolveFieldUiCommitMode(item, draft.tables?.[tableIndex], value, element.dataset.commitInternalMode || '') };
                break;
            }
            case 'field-policy-confidence': item.writePolicy = { ...(FieldPolicy?.normalizeFieldPolicy(item, draft.tables?.[tableIndex]) || item.writePolicy || {}), minConfidence: Math.max(0, Math.min(100, Number(value) || 0)) }; break;
            case 'field-important': item.important = value !== 'false'; break;
            case 'field-summary-label': item.summaryLabel = value; break;
            case 'field-display-format': item.displayFormat = value || '{value}'; break;
            case 'field-min': item.min = value === '' ? undefined : Number(value); break;
            case 'field-max': item.max = value === '' ? undefined : Number(value); break;
            case 'field-options': item.options = Domain.parseOptionText(value); break;
            case 'field-ai-hint': item.aiHint = value; break;
            case 'field-conditional-rules': item.conditionalRules = Domain.parseConditionalRulesText(value); break;
            default: return false;
        }
        return true;
    }

    function updatePath(draft, element) {
        if (!element.dataset.schemaPath) return false;
        return Model.updatePath(draft, element.dataset.schemaPath, element.value, element.dataset.schemaValueType || 'text');
    }

    Kernel.register('schemaEditor', Object.freeze({
        VERSION: '2.15-R0B',
        render,
        fieldNameVisualUnits,
        fieldNameColumnWidth,
        applyFieldNameWidth,
        updateRole,
        updatePath,
        mutate: Model.mutate,
        applyRawJson: Model.applyRawJson,
        prepare: Model.prepare,
        normalize: Model.normalize,
        displayCommitMode,
        commitModeChoices,
        resolveUiCommitMode,
        displayFieldCommitMode,
        resolveFieldUiCommitMode
    }));
})(window);
