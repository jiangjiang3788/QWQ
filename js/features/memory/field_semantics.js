(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');

    const VERSION = '2.15-R0B';
    const SYSTEM_ROLES = Object.freeze(['general', 'core_profile', 'current_state', 'tasks', 'recent_events', 'daily_observation', 'medium_summary', 'long_candidate', 'long_store']);
    const IDENTITY_ROLES = Object.freeze(['none', 'primary_key', 'source_key', 'title', 'date', 'content', 'volatile']);
    const SEMANTIC_ROLES = Object.freeze([
        'custom', 'system_timestamp', 'created_at', 'updated_at', 'completed_at', 'state_recorded_at', 'event_date', 'event_id', 'source_record_id', 'record_type', 'title', 'content',
        'related_entity', 'impact', 'status', 'next_action', 'result', 'cancel_reason',
        'observation_date', 'sleep', 'hydration', 'activity', 'body_state', 'energy_mood',
        'data_completeness', 'source_note', 'user_scene', 'user_mental_state', 'user_body_state',
        'user_stamina', 'user_energy', 'user_stressor', 'user_need', 'user_risk', 'user_next_step',
        'assistant_scene', 'assistant_mental_state', 'assistant_runtime_state', 'assistant_user_assessment',
        'assistant_response_strategy', 'assistant_boundary_reminder', 'state_expires_at',
        'user_profile', 'assistant_profile', 'relationship_definition', 'relationship_addressing',
        'relationship_agreement', 'topic', 'summary', 'growth_subject', 'old_pattern', 'new_response',
        'evidence', 'growth_meaning', 'stability', 'reusable_experience', 'confidence',
        'candidate_category', 'candidate_content', 'exception', 'observation_span', 'evidence_count',
        'review_status', 'source_domain', 'dimension', 'category', 'confirmation_status', 'applicability_exception'
    ]);

    const TABLE_MAP = Object.freeze({
        core_profile: Object.freeze({
            '档案更新时间': ['updated_at', 'volatile'],
            'user_人格底色': ['user_profile', 'content'],
            'char_人格底色': ['assistant_profile', 'content'],
            'char_核心能力': ['assistant_profile', 'content'],
            'char_回应原则': ['assistant_response_strategy', 'content'],
            'char_喜好与生活习惯': ['assistant_profile', 'content'],
            'char_边界与底线': ['assistant_boundary_reminder', 'content'],
            'char_弱点': ['assistant_profile', 'content'],
            'char_秘密': ['assistant_profile', 'content'],
            '双方_核心关系定义': ['relationship_definition', 'content'],
            '双方_称呼系统': ['relationship_addressing', 'content'],
            '双方_相处公约': ['relationship_agreement', 'content']
        }),
        current_state: Object.freeze({
            '状态记录时间': ['state_recorded_at', 'volatile'],
            'user_当前场景': ['user_scene', 'content'],
            'user_精神状态': ['user_mental_state', 'content'],
            'user_身体状态': ['user_body_state', 'content'],
            'user_体力': ['user_stamina', 'content'],
            'user_精力': ['user_energy', 'content'],
            'user_压力源': ['user_stressor', 'content'],
            'user_当前需求': ['user_need', 'content'],
            'user_当前风险': ['user_risk', 'content'],
            'user_下一步建议': ['user_next_step', 'content'],
            'char_当前场景': ['assistant_scene', 'content'],
            'char_精神状态': ['assistant_mental_state', 'content'],
            'char_运行状态': ['assistant_runtime_state', 'content'],
            'char_对user的判断': ['assistant_user_assessment', 'content'],
            'char_回应策略': ['assistant_response_strategy', 'content'],
            'char_边界提醒': ['assistant_boundary_reminder', 'content'],
            '状态有效期': ['state_expires_at', 'volatile']
        }),
        tasks: Object.freeze({
            '事件ID': ['event_id', 'primary_key'], '创建时间': ['created_at', 'date'],
            '最后更新时间': ['updated_at', 'volatile'], '完成时间': ['completed_at', 'volatile'],
            '类型': ['record_type', 'none'], '标题': ['title', 'title'], '内容': ['content', 'content'],
            '相关主体': ['related_entity', 'none'], '影响': ['impact', 'none'], '当前状态': ['status', 'volatile'],
            '后续待办': ['next_action', 'none'], '结果': ['result', 'none'],
            '搁置或取消原因': ['cancel_reason', 'none'], '原始记录ID': ['source_record_id', 'source_key']
        }),
        recent_events: Object.freeze({
            '事件ID': ['event_id', 'primary_key'], '创建时间': ['created_at', 'date'],
            '最后更新时间': ['updated_at', 'volatile'], '完成时间': ['completed_at', 'volatile'],
            '类型': ['record_type', 'none'], '标题': ['title', 'title'], '内容': ['content', 'content'],
            '相关主体': ['related_entity', 'none'], '影响': ['impact', 'none'], '当前状态': ['status', 'volatile'],
            '后续待办': ['next_action', 'none'], '结果': ['result', 'none'],
            '搁置或取消原因': ['cancel_reason', 'none'], '原始记录ID': ['source_record_id', 'source_key']
        }),
        daily_observation: Object.freeze({
            '日期': ['observation_date', 'date'], '睡眠情况': ['sleep', 'content'],
            '饮水情况': ['hydration', 'content'], '运动与活动': ['activity', 'content'],
            '身体状态': ['body_state', 'content'], '精力与情绪': ['energy_mood', 'content'],
            '数据完整度': ['data_completeness', 'volatile'], '来源说明': ['source_note', 'volatile']
        }),
        medium_summary: Object.freeze({
            '记录类型': ['record_type', 'none'], '发生或更新时间': ['event_date', 'date'],
            '成长主体': ['growth_subject', 'none'], '主题': ['topic', 'title'], '内容或摘要': ['summary', 'content'],
            '旧模式': ['old_pattern', 'content'], '新反应': ['new_response', 'content'], '具体证据': ['evidence', 'content'],
            '成长意义': ['growth_meaning', 'content'], '稳定程度': ['stability', 'none'],
            '可复用经验': ['reusable_experience', 'content'], '置信度': ['confidence', 'volatile'],
            '原始记录ID': ['source_record_id', 'source_key']
        }),
        long_candidate: Object.freeze({
            '候选类别': ['candidate_category', 'title'], '候选内容': ['candidate_content', 'content'],
            '支持证据': ['evidence', 'content'], '反例或例外': ['exception', 'content'],
            '观察跨度': ['observation_span', 'none'], '独立证据次数': ['evidence_count', 'none'],
            '置信度': ['confidence', 'volatile'], '审核状态': ['review_status', 'volatile']
        }),
        long_store: Object.freeze({
            '来源域': ['source_domain', 'none'], '维度或类型': ['dimension', 'none'], '分类': ['category', 'title'],
            '内容': ['content', 'content'], '原置信度': ['confidence', 'volatile'],
            '确认状态': ['confirmation_status', 'volatile'], '例外或适用场景': ['applicability_exception', 'content'],
            '原始记录ID': ['source_record_id', 'source_key']
        })
    });

    const GENERIC_RULES = Object.freeze([
        [/原始记录\s*(?:id|编号|标识)?/i, 'source_record_id', 'source_key'],
        [/(?:事件|记录|任务|待办|候选|条目|事项|日程)?\s*(?:id|编号|标识)$/i, 'event_id', 'primary_key'],
        [/最后更新时间|更新时间/i, 'updated_at', 'volatile'],
        [/完成时间/i, 'completed_at', 'volatile'],
        [/创建时间/i, 'created_at', 'date'],
        [/状态记录时间/i, 'state_recorded_at', 'volatile'],
        [/发生或更新时间|发生时间/i, 'event_date', 'date'],
        [/审核状态|确认状态|进度|排序|序号|完整度|置信度/i, 'system_timestamp', 'volatile'],
        [/日期|记录时间/i, 'observation_date', 'date'],
        [/标题|主题|名称|概要|候选类别/i, 'title', 'title'],
        [/内容|摘要|描述|候选内容/i, 'content', 'content']
    ]);

    function inferLegacyTableRole(table) {
        const descriptor = table && typeof table === 'object' ? table : {};
        const identity = `${descriptor.id || ''} ${descriptor.name || ''}`;
        if (/table_current_state|当前状态|近期状态/i.test(identity)) return 'current_state';
        if (/table_tasks|待办|承诺|未完成事项/i.test(identity)) return 'tasks';
        if (/table_recent_events|近期经历|重要事件/i.test(identity)) return 'recent_events';
        if (/table_daily_observation|日常观察|睡眠.*饮水|饮水.*身体/i.test(identity)) return 'daily_observation';
        if (/长期候选|审核队列/i.test(identity)) return 'long_candidate';
        if (/稳定长期|长期特征库/i.test(identity)) return 'long_store';
        if (/中期总结|成长经验|周期总结/i.test(identity)) return 'medium_summary';
        if (/核心确认|核心档案/i.test(identity)) return 'core_profile';
        return 'general';
    }

    function inferLegacyLayer(table) {
        const name = String(table?.name || '');
        if (/审核|候选/.test(name)) return 'review';
        if (/核心|确认档案/.test(name)) return 'core';
        if (/当前|近期|事件|待办|日常|状态/.test(name)) return 'short';
        if (/周期|总结|成长|趋势/.test(name)) return 'medium';
        return 'long';
    }

    function tableRole(table) {
        const explicit = String(table?.systemRole || '').trim();
        return SYSTEM_ROLES.includes(explicit) ? explicit : inferLegacyTableRole(table);
    }

    function inferLegacy(field, table) {
        const key = String(field?.key || '').trim();
        const mapped = TABLE_MAP[tableRole(table)]?.[key];
        if (mapped) return { semanticRole: mapped[0], identityRole: mapped[1], inferredFromLegacy: true };
        for (const [pattern, semanticRole, identityRole] of GENERIC_RULES) {
            if (pattern.test(key)) return { semanticRole, identityRole, inferredFromLegacy: true };
        }
        if (/^char_|^assistant_|^role_|角色|回应策略|边界提醒|内部判断/i.test(key)) {
            return { semanticRole: 'assistant_profile', identityRole: 'content', inferredFromLegacy: true };
        }
        return { semanticRole: 'custom', identityRole: 'none', inferredFromLegacy: true };
    }

    function normalizeSemanticRole(value, field, table) {
        const role = String(value || '').trim();
        return role && /^[a-z][a-z0-9_]*$/.test(role) ? role : inferLegacy(field, table).semanticRole;
    }

    function normalizeIdentityRole(value, field, table) {
        const role = String(value || '').trim();
        return IDENTITY_ROLES.includes(role) ? role : inferLegacy(field, table).identityRole;
    }

    function resolve(field, table) {
        const explicitSemantic = String(field?.semanticRole || '').trim();
        const explicitIdentity = String(field?.identityRole || '').trim();
        const legacy = inferLegacy(field, table);
        return Object.freeze({
            semanticRole: normalizeSemanticRole(explicitSemantic, field, table),
            identityRole: normalizeIdentityRole(explicitIdentity, field, table),
            inferredFromLegacy: !explicitSemantic || !explicitIdentity,
            legacySemanticRole: legacy.semanticRole,
            legacyIdentityRole: legacy.identityRole
        });
    }

    function normalizeField(field, table) {
        const roles = resolve(field, table);
        return { ...field, semanticRole: roles.semanticRole, identityRole: roles.identityRole };
    }

    function semanticRole(field, table) { return resolve(field, table).semanticRole; }
    function identityRole(field, table) { return resolve(field, table).identityRole; }

    function findField(table, roles) {
        const wanted = new Set(Array.isArray(roles) ? roles : [roles]);
        return (table?.columns || []).find(field => wanted.has(semanticRole(field, table))) || null;
    }

    function findIdentityField(table, roles) {
        const wanted = new Set(Array.isArray(roles) ? roles : [roles]);
        return (table?.columns || []).find(field => wanted.has(identityRole(field, table))) || null;
    }

    function isTechnical(field, table) {
        const idRole = identityRole(field, table);
        const role = semanticRole(field, table);
        return ['primary_key', 'source_key', 'volatile'].includes(idRole)
            || ['system_timestamp', 'created_at', 'updated_at', 'completed_at', 'state_recorded_at', 'event_date', 'event_id', 'source_record_id', 'data_completeness', 'source_note', 'review_status', 'confirmation_status', 'confidence'].includes(role);
    }

    function policyDefaults(field, table) {
        const role = semanticRole(field, table);
        const assistantRoles = new Set(['assistant_profile', 'assistant_scene', 'assistant_mental_state', 'assistant_runtime_state', 'assistant_user_assessment', 'assistant_response_strategy', 'assistant_boundary_reminder']);
        const inferredRoles = new Set(['user_mental_state', 'user_stamina', 'user_energy', 'user_risk', 'energy_mood', 'stability']);
        const systemRoles = new Set(['system_timestamp', 'created_at', 'updated_at', 'completed_at', 'state_recorded_at', 'event_date', 'event_id', 'source_record_id', 'data_completeness', 'source_note', 'review_status', 'confirmation_status', 'confidence']);
        if (assistantRoles.has(role)) return { subject: role.includes('boundary') ? 'relationship' : 'assistant', evidence: 'inferred', commitMode: 'runtime_only', minConfidence: 0 };
        if (systemRoles.has(role)) return { subject: 'system', evidence: 'inferred', commitMode: 'direct', minConfidence: 0 };
        if (inferredRoles.has(role)) return { subject: 'user', evidence: 'inferred', commitMode: tableRole(table) === 'current_state' ? 'candidate' : 'review', minConfidence: 75 };
        if (['relationship_definition', 'relationship_addressing', 'relationship_agreement'].includes(role)) return { subject: 'relationship', evidence: 'explicit', commitMode: 'inherit', minConfidence: 65 };
        return { subject: 'user', evidence: 'explicit', commitMode: 'inherit', minConfidence: 65 };
    }

    function describe(field, table) {
        const roles = resolve(field, table);
        return `${roles.semanticRole} / ${roles.identityRole}${roles.inferredFromLegacy ? '（旧字段推导）' : ''}`;
    }

    Kernel.register('fieldSemantics', Object.freeze({
        VERSION,
        SYSTEM_ROLES,
        SEMANTIC_ROLES,
        IDENTITY_ROLES,
        TABLE_MAP,
        inferLegacyTableRole,
        inferLegacyLayer,
        tableRole,
        inferLegacy,
        normalizeSemanticRole,
        normalizeIdentityRole,
        resolve,
        normalizeField,
        semanticRole,
        identityRole,
        findField,
        findIdentityField,
        isTechnical,
        policyDefaults,
        describe
    }), { legacyGlobal: 'MemoryFieldSemantics' });
})(window);
