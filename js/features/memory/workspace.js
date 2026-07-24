(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const Policy = Kernel.get('policy');

    const WORKSPACES = Object.freeze({
        memory: Object.freeze({ id: 'memory', label: '记忆', defaultView: 'tables' }),
        inbox: Object.freeze({ id: 'inbox', label: '待处理', defaultView: 'inbox_home' }),
        manage: Object.freeze({ id: 'manage', label: '管理', defaultView: 'manage_home' })
    });

    const INBOX_VIEWS = new Set(['inbox_home', 'review', 'sidecar', 'reliability', 'tasks']);
    const MANAGE_VIEWS = new Set(['manage_home', 'templates', 'diagnostics', 'integrity', 'lifecycle', 'usage_audit', 'quality', 'history']);

    function tableRole(table) {
        return Policy?.normalizeTablePolicy ? Policy.normalizeTablePolicy(table || {}).systemRole : String(table?.systemRole || 'general');
    }

    function getModules() {
        return {
            review: Kernel.get('review'),
            sidecar: Kernel.get('sidecar'),
            lifecycle: Kernel.get('lifecycle'),
            feedback: Kernel.get('feedback'),
            tasks: Kernel.get('tasks'),
            quality: Kernel.get('quality'),
            governance: Kernel.get('governanceQueue')
        };
    }

    function canonicalView(view) {
        return ['retrieval', 'feedback'].includes(view) ? 'usage_audit' : view;
    }

    function getWorkspaceForView(view) {
        const canonical = canonicalView(view);
        if (INBOX_VIEWS.has(canonical)) return 'inbox';
        if (MANAGE_VIEWS.has(canonical)) return 'manage';
        return 'memory';
    }

    function normalizeState(workspace, view) {
        view = canonicalView(view);
        const nextWorkspace = WORKSPACES[workspace] ? workspace : getWorkspaceForView(view);
        if (nextWorkspace === 'memory') return { workspace: 'memory', view: 'tables' };
        if (nextWorkspace === 'inbox') return { workspace: 'inbox', view: INBOX_VIEWS.has(view) ? view : 'inbox_home' };
        return { workspace: 'manage', view: MANAGE_VIEWS.has(view) ? view : 'manage_home' };
    }

    function getCounts(chat, templates) {
        const modules = getModules();
        const sidecarState = modules.sidecar?.ensureState?.(chat);
        const tasks = modules.tasks?.getCounts?.(chat) || {};
        const counts = {
            review: modules.review?.getPendingCount?.(chat) || 0,
            sidecar: (sidecarState?.candidates || []).filter(item => item.status === 'pending').length,
            feedback: modules.feedback?.getPendingCount?.(chat) || 0,
            tasks: (tasks.failed || 0) + (tasks.queued || 0) + (tasks.paused || 0),
            reliability: 0,
            totalRows: 0,
            activeTasks: 0,
            templates: Array.isArray(templates) ? templates.length : 0
        };
        (templates || []).forEach(template => {
            const bound = chat?.memoryTables?.data?.[template.id] || {};
            (template.tables || []).forEach(table => {
                const rows = bound?.[table.id]?.__rows;
                if (!Array.isArray(rows)) return;
                counts.totalRows += rows.length;
                rows.forEach(row => {
                    const status = row?.meta?.lifecycle?.status;
                    if (status === 'uncertain' || status === 'conflicting' || status === 'expired') counts.reliability += 1;
                });
            });
        });
        const taskDescriptor = findTable(templates, table => tableRole(table) === 'tasks');
        if (taskDescriptor && modules.sidecar?.getActiveTaskRows) {
            counts.activeTasks = modules.sidecar.getActiveTaskRows(chat, taskDescriptor, 99).length;
        }
        counts.inbox = counts.review + counts.sidecar + counts.feedback + counts.tasks + counts.reliability;
        return counts;
    }

    function findTable(templates, predicate) {
        for (const template of templates || []) {
            const table = (template.tables || []).find(predicate);
            if (table) return { template, table };
        }
        return null;
    }

    function getStatusSummary(chat, templates) {
        const descriptor = findTable(templates, table => tableRole(table) === 'current_state');
        if (!descriptor) return { title: '暂无当前状态', detail: '聊天中出现明确变化后会自动更新。' };
        const data = chat?.memoryTables?.data?.[descriptor.template.id]?.[descriptor.table.id] || {};
        const values = (descriptor.table.columns || [])
            .filter(field => field.important !== false)
            .map(field => ({ key: field.key, value: data[field.id] }))
            .filter(item => item.value !== undefined && item.value !== null && item.value !== '' && (!Array.isArray(item.value) || item.value.length));
        if (!values.length) return { title: '暂无当前状态', detail: '聊天中出现明确变化后会自动更新。' };
        const headline = values.slice(0, 2).map(item => Array.isArray(item.value) ? item.value.join('、') : String(item.value)).join(' · ');
        const detail = values.slice(2, 5).map(item => `${item.key}：${Array.isArray(item.value) ? item.value.join('、') : item.value}`).join(' · ');
        return { title: headline || '当前状态', detail: detail || '状态会随聊天同请求更新。' };
    }

    function renderCount(value) {
        return Number(value) > 0 ? `<span class="memory-workbench-count">${Number(value)}</span>` : '';
    }

    function renderInboxHome(chat, templates) {
        const governance = getModules().governance;
        if (governance?.renderHome) return governance.renderHome(chat, templates);
        const counts = getCounts(chat, templates);
        return `<div class="memory-governance-empty">${counts.inbox ? `共有 ${counts.inbox} 项需要关注` : '当前没有需要处理的内容'}</div>`;
    }

    function renderManageHome(chat, templates) {
        const counts = getCounts(chat, templates);
        const quality = Kernel.get('quality')?.ensureState?.(chat);
        const latestRun = quality?.runs?.[quality.runs.length - 1];
        const cards = [
            ['templates', '表结构编辑器', `${counts.templates} 个已绑定模板`, '统一管理字段、表格和结构 JSON'],
            ['diagnostics', '记忆诊断中心', `${counts.reliability + counts.tasks} 项需要关注`, latestRun ? `完整性、来源、召回、质量与历史；最近质量得分 ${Math.round(latestRun.score || 0)}` : '集中查看完整性、来源时效、召回索引、质量和历史']
        ];
        return `<div class="memory-workbench-overview">
            <div class="memory-workbench-overview-head"><div><h2>管理</h2><p>日常使用无需调整这些设置</p></div><span class="memory-workbench-health">${counts.tasks ? `${counts.tasks} 项维护作业待处理` : '运行正常'}</span></div>
            <div class="memory-workbench-card-grid">${cards.map(([view, title, meta, text]) => `<button type="button" class="memory-workbench-card" data-workbench-view="${view}"><strong>${Core.escapeHtml(title)}</strong><small>${Core.escapeHtml(meta)}</small><em>${Core.escapeHtml(text)}</em></button>`).join('')}</div>
        </div>`;
    }

    function renderDiagnosticsHome(chat, templates) {
        const counts = getCounts(chat, templates);
        const quality = Kernel.get('quality')?.ensureState?.(chat);
        const latestRun = quality?.runs?.[quality.runs.length - 1];
        const cards = [
            ['integrity', '结构完整性', '记忆完整性医生', '检查孤立数据、失效引用、重复职责与游标断点'],
            ['lifecycle', '来源与时效', `${counts.reliability} 条需要复核`, '查看来源变化链，预演过期、归档、冲突与重复'],
            ['usage_audit', '召回与索引', '本轮使用与注入原因', '核对哪些记忆被召回、为什么选中以及实际注入内容'],
            ['quality', '质量测试', latestRun ? `最近得分 ${Math.round(latestRun.score || 0)}` : '尚未建立质量基线', '运行固定测试对话和质量回归'],
            ['history', '历史与回滚', '正式记忆变更快照', '查看每次写入并按快照恢复']
        ];
        return `<div class="memory-workbench-overview memory-diagnostics-center">
            <div class="memory-workbench-overview-head"><div><h2>记忆诊断中心</h2><p>入口集中，底层检查模块保持独立；所有检查默认只读。</p></div><span class="memory-workbench-health">${counts.tasks ? `${counts.tasks} 项维护作业` : '没有待运行作业'}</span></div>
            <div class="memory-workbench-card-grid">${cards.map(([view, title, meta, text]) => `<button type="button" class="memory-workbench-card" data-workbench-view="${view}"><strong>${Core.escapeHtml(title)}</strong><small>${Core.escapeHtml(meta)}</small><em>${Core.escapeHtml(text)}</em></button>`).join('')}</div>
        </div>`;
    }

    function renderDetailHeader(workspace, title) {
        return `<div class="memory-workbench-detail-head"><button type="button" class="btn btn-small btn-neutral" data-workbench-back="${workspace}">返回</button><h2>${Core.escapeHtml(title)}</h2></div>`;
    }

    function viewTitle(view) {
        return ({
            review: '更新确认', sidecar: '短期候选', reliability: '需要复核', tasks: '维护作业',
            templates: '表结构编辑器', diagnostics: '记忆诊断中心', integrity: '记忆完整性医生', lifecycle: '生命周期与变化链', usage_audit: '记忆引用与作用', retrieval: '记忆引用与作用', feedback: '记忆引用与作用', quality: '质量与诊断', history: '更新历史'
        })[view] || '';
    }

    Kernel.register('workspace', {
        VERSION: '2.15-R0B',
        WORKSPACES,
        canonicalView,
        getWorkspaceForView,
        normalizeState,
        getCounts,
        getStatusSummary,
        renderInboxHome,
        renderManageHome,
        renderDiagnosticsHome,
        renderDetailHeader,
        viewTitle
    });
})(window);
