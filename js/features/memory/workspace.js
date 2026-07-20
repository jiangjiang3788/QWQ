(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;

    const WORKSPACES = Object.freeze({
        memory: Object.freeze({ id: 'memory', label: '记忆', defaultView: 'tables' }),
        inbox: Object.freeze({ id: 'inbox', label: '待处理', defaultView: 'inbox_home' }),
        manage: Object.freeze({ id: 'manage', label: '管理', defaultView: 'manage_home' })
    });

    const INBOX_VIEWS = new Set(['inbox_home', 'review', 'sidecar', 'reliability', 'feedback', 'tasks']);
    const MANAGE_VIEWS = new Set(['manage_home', 'templates', 'retrieval', 'quality', 'history']);

    function getModules() {
        return {
            review: Kernel.get('review'),
            sidecar: Kernel.get('sidecar'),
            lifecycle: Kernel.get('lifecycle'),
            feedback: Kernel.get('feedback'),
            tasks: Kernel.get('tasks'),
            quality: Kernel.get('quality')
        };
    }

    function getWorkspaceForView(view) {
        if (INBOX_VIEWS.has(view)) return 'inbox';
        if (MANAGE_VIEWS.has(view)) return 'manage';
        return 'memory';
    }

    function normalizeState(workspace, view) {
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
        const taskDescriptor = findTable(templates, table => table.id === 'table_tasks' || /待办|承诺|未完成事项/.test(String(table.name || '')));
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
        const descriptor = findTable(templates, table => table.id === 'table_current_state' || /当前状态|近期状态/.test(String(table.name || '')));
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
        const counts = getCounts(chat, templates);
        const cards = [
            ['review', '更新确认', '查看总结与表格更新草案', counts.review],
            ['sidecar', '短期候选', '整理聊天产生的近期经历与观察', counts.sidecar],
            ['reliability', '需要复核', '处理冲突、过期和不确定记忆', counts.reliability],
            ['feedback', '使用反馈', '告诉系统哪些记忆有用或无关', counts.feedback],
            ['tasks', '失败与排队', '处理失败任务与后台队列', counts.tasks]
        ];
        return `<div class="memory-workbench-overview">
            <div class="memory-workbench-overview-head"><div><h2>待处理</h2><p>${counts.inbox ? `共有 ${counts.inbox} 项需要关注` : '当前没有需要处理的内容'}</p></div></div>
            <div class="memory-workbench-card-grid">${cards.map(([view, title, text, count]) => `<button type="button" class="memory-workbench-card" data-workbench-view="${view}"><span class="memory-workbench-card-icon">${renderCount(count)}</span><strong>${Core.escapeHtml(title)}</strong><small>${Core.escapeHtml(text)}</small></button>`).join('')}</div>
        </div>`;
    }

    function renderManageHome(chat, templates) {
        const counts = getCounts(chat, templates);
        const quality = Kernel.get('quality')?.ensureState?.(chat);
        const latestRun = quality?.runs?.[quality.runs.length - 1];
        const cards = [
            ['templates', '模板与字段', `${counts.templates} 个已绑定模板`, '管理表格结构与字段'],
            ['retrieval', '召回与行为', '标签、场景与相关性', '查看本轮为什么召回'],
            ['quality', '质量与诊断', latestRun ? `最近得分 ${Math.round(latestRun.score || 0)}` : '尚未建立质量基线', '运行回归与质量测试'],
            ['history', '更新历史', '查看表格变更快照', '用于核对和回滚']
        ];
        return `<div class="memory-workbench-overview">
            <div class="memory-workbench-overview-head"><div><h2>管理</h2><p>日常使用无需调整这些设置</p></div><span class="memory-workbench-health">${counts.tasks ? `${counts.tasks} 项任务待处理` : '运行正常'}</span></div>
            <div class="memory-workbench-card-grid">${cards.map(([view, title, meta, text]) => `<button type="button" class="memory-workbench-card" data-workbench-view="${view}"><strong>${Core.escapeHtml(title)}</strong><small>${Core.escapeHtml(meta)}</small><em>${Core.escapeHtml(text)}</em></button>`).join('')}</div>
        </div>`;
    }

    function renderDetailHeader(workspace, title) {
        return `<div class="memory-workbench-detail-head"><button type="button" class="btn btn-small btn-neutral" data-workbench-back="${workspace}">返回</button><h2>${Core.escapeHtml(title)}</h2></div>`;
    }

    function viewTitle(view) {
        return ({
            review: '更新确认', sidecar: '短期候选', reliability: '需要复核', feedback: '使用反馈', tasks: '任务队列',
            templates: '模板与字段', retrieval: '召回与行为', quality: '质量与诊断', history: '更新历史'
        })[view] || '';
    }

    Kernel.register('workspace', {
        VERSION: '2.9-R2',
        WORKSPACES,
        getWorkspaceForView,
        normalizeState,
        getCounts,
        getStatusSummary,
        renderInboxHome,
        renderManageHome,
        renderDetailHeader,
        viewTitle
    });
})(window);
