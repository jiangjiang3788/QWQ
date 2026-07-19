// V2.9-R4 设置模块：魔法房间与后台系统通知
function setupMagicRoomApp() {
    const app = document.getElementById('magic-room-screen');
    if (!app) return;

    const enabledSwitch = document.getElementById('magic-room-custom-prompt-enabled');
    const editorSection = document.getElementById('magic-room-prompt-editor');
    const promptTextarea = document.getElementById('magic-room-custom-prompt');
    const saveBtn = document.getElementById('magic-room-save-btn');
    const resetBtn = document.getElementById('magic-room-reset-prompt-btn');
    const importBtn = document.getElementById('magic-room-import-btn');
    const exportBtn = document.getElementById('magic-room-export-btn');
    const importInput = document.getElementById('magic-room-import-input');

    const policyDefaults = {
        worldBookEnabled: true, worldBookBudget: 2400, worldBookPriority: 20,
        structuredEnabled: true, structuredBudget: 1800, structuredPriority: 30,
        historyEnabled: true, historyCount: 30,
        statusEnabled: true
    };
    const policyEls = {
        worldBookEnabled: document.getElementById('proment-worldbook-enabled'),
        worldBookBudget: document.getElementById('proment-worldbook-budget'),
        worldBookPriority: document.getElementById('proment-worldbook-priority'),
        structuredEnabled: document.getElementById('proment-structured-enabled'),
        structuredBudget: document.getElementById('proment-structured-budget'),
        structuredPriority: document.getElementById('proment-structured-priority'),
        historyEnabled: document.getElementById('proment-history-enabled'),
        historyCount: document.getElementById('proment-history-count'),
        statusEnabled: document.getElementById('proment-status-enabled')
    };

    function getActivePromentCharacter() {
        const list = Array.isArray(db.characters) ? db.characters : [];
        return list.find(item => item.id === window.currentChatId) || list[0] || null;
    }

    function loadPromentPolicy() {
        const policy = Object.assign({}, policyDefaults, db.magicRoom && db.magicRoom.contextPolicy || {});
        Object.entries(policyEls).forEach(([key, el]) => {
            if (!el) return;
            if (el.type === 'checkbox') el.checked = Boolean(policy[key]);
            else el.value = policy[key];
        });
    }

    function readPromentPolicy() {
        const number = (key, fallback, min, max) => {
            const value = Number(policyEls[key] && policyEls[key].value);
            return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
        };
        return {
            worldBookEnabled: !!(policyEls.worldBookEnabled && policyEls.worldBookEnabled.checked),
            worldBookBudget: number('worldBookBudget', 2400, 0, 100000),
            worldBookPriority: number('worldBookPriority', 20, 1, 99),
            structuredEnabled: !!(policyEls.structuredEnabled && policyEls.structuredEnabled.checked),
            structuredBudget: number('structuredBudget', 1800, 0, 100000),
            structuredPriority: number('structuredPriority', 30, 1, 99),
            historyEnabled: !!(policyEls.historyEnabled && policyEls.historyEnabled.checked),
            historyCount: number('historyCount', 30, 1, 200),
            statusEnabled: !!(policyEls.statusEnabled && policyEls.statusEnabled.checked)
        };
    }

    function renderPromentOverview() {
        const grid = document.getElementById('proment-status-grid');
        if (!grid) return;
        const char = getActivePromentCharacter();
        const worldBookCount = Array.isArray(db.worldBooks) ? db.worldBooks.length : 0;
        const rows = [
            ['当前角色', char ? (char.remarkName || char.name || '未命名') : '暂无角色'],
            ['世界书', `${worldBookCount} 本`],
            ['结构化档案', char && char.memoryTables && char.memoryTables.enabled !== false ? '可用' : '未启用'],
            ['向量记忆', '独立管理']
        ];
        grid.innerHTML = rows.map(([label, value]) => `<div class="proment-status-card"><span>${label}</span><strong>${value}</strong></div>`).join('');
    }

    loadPromentPolicy();
    renderPromentOverview();
    document.getElementById('proment-open-worldbook')?.addEventListener('click', () => {
        if (typeof renderWorldBookList === 'function') renderWorldBookList();
        if (typeof switchScreen === 'function') switchScreen('world-book-screen');
    });
    document.getElementById('proment-open-structured')?.addEventListener('click', () => {
        const char = getActivePromentCharacter();
        if (!char) return showToast('暂无角色，无法打开结构化档案');
        if (typeof window.openMemoryTableForCharacter === 'function') window.openMemoryTableForCharacter(char.id);
        else showToast('请从人物设置中进入结构化档案');
    });


    function clipPreview(text, budget) {
        const source = String(text || '');
        const limit = Math.max(0, Number(budget) || 0);
        if (!limit || source.length <= limit) return source;
        return source.slice(0, limit) + `\n…[已按预算裁剪 ${source.length - limit} 字符]`;
    }

    function buildWorldBookPreview(char, policy) {
        if (!policy.worldBookEnabled) return '[世界书已关闭]';
        const ids = new Set([...(char?.worldBookIds || []), ...((db.worldBooks || []).filter(item => item.isGlobal).map(item => item.id))]);
        const books = (db.worldBooks || []).filter(item => ids.has(item.id) && !item.disabled);
        const text = books.map(item => `【${item.name || item.title || '未命名世界书'}】\n${item.content || ''}`).join('\n\n');
        return clipPreview(text || '[当前角色没有可注入的世界书内容]', policy.worldBookBudget);
    }

    function flattenStructuredPreview(char, policy) {
        if (!policy.structuredEnabled) return '[结构化档案已关闭]';
        const data = char?.memoryTables?.data;
        if (!data || typeof data !== 'object') return '[当前角色没有结构化档案数据]';
        const lines = [];
        Object.entries(data).forEach(([templateId, tables]) => {
            const template = (db.memoryTableTemplates || []).find(item => item.id === templateId);
            Object.entries(tables || {}).forEach(([tableId, values]) => {
                const table = template?.tables?.find(item => item.id === tableId);
                if (values && Array.isArray(values.__rows)) {
                    values.__rows.forEach((row, index) => lines.push(`${template?.name || templateId} / ${table?.name || tableId} / 第${index + 1}行：${JSON.stringify(row)}`));
                } else {
                    Object.entries(values || {}).forEach(([fieldId, value]) => {
                        if (value === '' || value === null || value === undefined) return;
                        const field = table?.fields?.find(item => item.id === fieldId);
                        lines.push(`${template?.name || templateId} / ${table?.name || tableId} / ${field?.name || fieldId}：${typeof value === 'string' ? value : JSON.stringify(value)}`);
                    });
                }
            });
        });
        return clipPreview(lines.join('\n') || '[当前结构化档案没有可注入内容]', policy.structuredBudget);
    }

    function renderPromentInjectionPreview() {
        const box = document.getElementById('proment-preview-box');
        const pre = document.getElementById('proment-preview-content');
        const char = getActivePromentCharacter();
        if (!box || !pre) return;
        if (!char) { showToast('暂无角色，无法预览'); return; }
        const policy = readPromentPolicy();
        const historyItems = Array.isArray(char.history) ? char.history.slice(-policy.historyCount) : [];
        const historyText = policy.historyEnabled
            ? (historyItems.map(item => `${item.sender === 'user' ? '用户' : (char.remarkName || char.name || '角色')}：${item.content || item.text || '[非文本消息]'}`).join('\n') || '[暂无最近聊天]')
            : '[最近聊天已关闭]';
        const identityText = [
            `角色：${char.remarkName || char.name || '未命名'}`,
            char.personality ? `人设：${char.personality}` : '',
            char.description ? `描述：${char.description}` : ''
        ].filter(Boolean).join('\n');
        const statusText = policy.statusEnabled
            ? (char.status || char.currentStatus || char.statusText || '[当前没有状态内容]')
            : '[状态栏注入已关闭]';
        const sections = [
            { name: '角色身份', priority: 10, budget: identityText.length, content: identityText || '[暂无角色身份内容]' },
            { name: '世界书', priority: policy.worldBookPriority, budget: policy.worldBookBudget, content: buildWorldBookPreview(char, policy) },
            { name: '结构化档案', priority: policy.structuredPriority, budget: policy.structuredBudget, content: flattenStructuredPreview(char, policy) },
            { name: '最近聊天', priority: 50, budget: historyText.length, content: historyText },
            { name: '状态栏', priority: 60, budget: statusText.length, content: statusText }
        ].sort((a, b) => a.priority - b.priority);
        const vectorPolicy = char.vectorMemory?.injectionPolicy || {};
        const vectorText = char.vectorMemory?.lastContextBlock || '[尚无最近一次向量检索结果；请在向量记忆页面预览]';
        sections.push({ name: '向量记忆（独立设置，只读预览）', priority: Number(vectorPolicy.priority || 40), budget: Number(vectorPolicy.budget || 2600), content: clipPreview(vectorText, vectorPolicy.budget || 2600) });
        sections.sort((a, b) => a.priority - b.priority);
        const totalChars = sections.reduce((sum, item) => sum + String(item.content || '').length, 0);
        pre.textContent = `# Proment 上下文预览\n角色：${char.remarkName || char.name || '未命名'} · 区块：${sections.length} · 预览字符：${totalChars}\n说明：此页用于预览上下文来源，不会修改向量记忆独立设置。\n\n` + sections.map(item => `## ${item.name}\n优先级：${item.priority} · 预算/长度：${item.budget} 字符\n${item.content}`).join('\n\n');
        box.hidden = false;
    }

    function getLastPromptSnapshot() {
        if (window.__ovoLastPromptSnapshot) return window.__ovoLastPromptSnapshot;
        try {
            const raw = sessionStorage.getItem('ovo_last_prompt_snapshot');
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    function extractPromptSections(prompt) {
        const text = String(prompt || '');
        const specs = [
            ['角色设置', /<char_settings>([\s\S]*?)<\/char_settings>/i],
            ['用户设置', /<user_settings>([\s\S]*?)<\/user_settings>/i],
            ['环境', /<environment>([\s\S]*?)<\/environment>/i],
            ['长期记忆', /<memoir>([\s\S]*?)<\/memoir>/i],
            ['最近聊天上下文', /<recent_chat_context>([\s\S]*?)<\/recent_chat_context>/i]
        ];
        const sections = [];
        const consumed = [];
        specs.forEach(([name, re]) => {
            const match = text.match(re);
            if (!match) return;
            sections.push({ name, content: match[1].trim(), chars: match[1].trim().length });
            consumed.push(match[0]);
        });
        let remaining = text;
        consumed.forEach(block => { remaining = remaining.replace(block, ''); });
        remaining = remaining.trim();
        if (remaining) sections.unshift({ name: '系统规则与输出规则', content: remaining, chars: remaining.length });
        return sections;
    }

    function renderLastRuntimePrompt() {
        const box = document.getElementById('proment-preview-box');
        const pre = document.getElementById('proment-preview-content');
        const snapshot = getLastPromptSnapshot();
        if (!box || !pre) return;
        if (!snapshot || !snapshot.systemPrompt) {
            pre.textContent = `# 最近真实 Prompt

尚无真实请求快照。请先在私聊中完成一次 AI 请求，再回到 Proment 查看。`;
            box.hidden = false;
            return;
        }
        const sections = extractPromptSections(snapshot.systemPrompt);
        const captured = new Date(snapshot.capturedAt || Date.now()).toLocaleString();
        pre.textContent = `# 最近真实 Prompt
角色：${snapshot.characterName || '未命名'}
时间：${captured}
Provider：${snapshot.provider || '未记录'}
模型：${snapshot.model || '未记录'}
System Prompt：${snapshot.systemPromptChars || String(snapshot.systemPrompt).length} 字符
历史消息：${snapshot.historyCount ?? '未记录'} 条
区块：${sections.length}

` + sections.map(section => `## ${section.name}
实际字符：${section.chars}
${section.content}`).join('\n\n');
        box.hidden = false;
    }

    function getLastWorldBookDiagnostic() {
        if (window.__ovoLastWorldBookDiagnostic) return window.__ovoLastWorldBookDiagnostic;
        try {
            const raw = sessionStorage.getItem('ovo_last_worldbook_diagnostic');
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    function renderWorldBookDiagnostic() {
        const box = document.getElementById('proment-preview-box');
        const pre = document.getElementById('proment-preview-content');
        if (!box || !pre) return;
        const diag = getLastWorldBookDiagnostic();
        if (!diag) {
            pre.textContent = `# 世界书真实命中诊断\n\n尚无运行记录。请先在私聊中完成一次 AI 请求，再回到 Proment 查看。`;
            box.hidden = false;
            return;
        }
        const items = Array.isArray(diag.items) ? diag.items : [];
        const included = items.filter(item => item.included);
        const excluded = items.filter(item => !item.included);
        const format = item => {
            const scope = item.isGlobal ? '全局' : '角色关联';
            const matched = Array.isArray(item.matchedKeywords) && item.matchedKeywords.length ? `\n命中词：${item.matchedKeywords.join('、')}` : '';
            const keywords = Array.isArray(item.keywords) && item.keywords.length ? `\n关键词：${item.keywords.join('、')}` : '';
            return `- ${item.name}\n  范围：${scope} · 位置：${item.position || 'after'} · 权重：${item.weight ?? 100} · 内容：${item.chars || 0} 字符\n  结果：${item.included ? '已注入' : '未注入'} · 原因：${item.reason || '未知'}${matched}${keywords}`;
        };
        const sectionLines = diag.sections || {};
        pre.textContent = `# 世界书真实命中诊断\n角色：${diag.characterName || '未命名角色'}\n时间：${diag.capturedAt ? new Date(diag.capturedAt).toLocaleString() : '未知'}\n模式：${diag.mode === 'offline' ? '线下' : '线上'}\n最近消息：${diag.recentMessageCount || 0} 条 · 匹配文本：${diag.recentTextChars || 0} 字符\n候选：${diag.candidateCount || items.length} · 注入：${diag.includedCount || included.length} · 排除：${diag.excludedCount || excluded.length}\n策略：预算 ${diag.budget ?? '未记录'} · 优先级 ${diag.priority ?? '未记录'} · 剩余预算 ${diag.remainingBudget ?? '未记录'}
实际输出：${diag.outputChars || 0} 字符（前 ${sectionLines.before || 0} / 中 ${sectionLines.middle || 0} / 后 ${sectionLines.after || 0}）\n\n## 已注入\n${included.length ? included.map(format).join('\n\n') : '[没有条目被注入]'}\n\n## 未注入\n${excluded.length ? excluded.map(format).join('\n\n') : '[没有被排除的候选条目]'}\n\n说明：这是 getActiveWorldBooksContents 的真实运行记录，只读展示，不改变世界书选择、顺序或 Prompt。`;
        box.hidden = false;
    }

    function renderAIRequestDiagnostic() {
        const box = document.getElementById('proment-preview-box');
        const pre = document.getElementById('proment-preview-content');
        if (!box || !pre) return;
        let diag = null;
        try {
            diag = window.OVOAIRequestRuntime?.getLastDiagnostic?.() || window.__ovoLastAIRequestDiagnostic;
            if (!diag) {
                const raw = sessionStorage.getItem('ovo_last_ai_request_diagnostic');
                diag = raw ? JSON.parse(raw) : null;
            }
        } catch (_) {}
        if (!diag) {
            pre.textContent = `# AI 请求诊断\n\n尚无请求记录。请先执行一次 AI 请求。`;
            box.hidden = false;
            return;
        }
        const statusText = diag.ok ? (diag.phase === 'completed' ? '成功完成' : '已建立响应') : (diag.errorType === 'aborted' ? '已取消' : (diag.phase === 'queued' ? '排队中' : '失败'));
        const errorMap = {
            auth: '鉴权失败：检查 API Key 或服务权限', endpoint: '地址错误：检查 API 基础地址与兼容格式',
            rate_limit: '频率或额度限制', timeout: '请求超时', server: 'API 服务端错误',
            request: '请求参数被服务拒绝', network: '网络、跨域或连接错误',
            aborted: '请求被用户或程序取消', duplicate: '短时间重复请求已阻止', conflict: '请求状态冲突'
        };
        const phaseMap = {
            created: '已创建', queued: '等待并发槽位', sending: '正在发送', headers_received: '已收到响应头',
            completed: '响应读取完成', failed: '失败', cancelled: '已取消'
        };
        const history = window.OVOAIRequestRuntime?.getRecentDiagnostics?.() || [];
        const queue = window.OVOAIRequestRuntime?.getQueueState?.() || { active: 0, queued: 0, maxActive: 0 };
        const active = window.OVOAIRequestRuntime?.getActiveRequests?.() || [];
        const recentLines = history.slice(0, 12).map((item, index) => {
            const recentStatus = item.ok ? (item.phase === 'completed' ? '完成' : '响应') : (item.errorType || phaseMap[item.phase] || '失败');
            const firstByte = item.firstByteMs ? ` · 首字节 ${item.firstByteMs}ms` : '';
            const queued = item.queueWaitMs ? ` · 排队 ${item.queueWaitMs}ms` : '';
            return `${index + 1}. ${item.task || 'unknown'} · ${item.source || 'unknown'} · ${item.model || '未记录模型'} · ${recentStatus} · ${item.durationMs || 0}ms${firstByte}${queued}`;
        });
        const activeLines = active.map((item, index) => `${index + 1}. ${item.task || 'unknown'} · ${item.model || '未记录模型'} · ${phaseMap[item.phase] || item.phase || '运行中'} · ${item.id}`);
        pre.textContent = `# AI 请求诊断
任务：${diag.task || 'chat'}
来源：${diag.source || '未记录'}
请求 ID：${diag.id || '未记录'}
时间：${diag.capturedAt ? new Date(diag.capturedAt).toLocaleString() : '未知'}
结果：${statusText}
阶段：${phaseMap[diag.phase] || diag.phase || '未记录'}
Provider：${diag.provider || '未记录'}
模型：${diag.model || '未记录'}
接口类型：${diag.endpointType || '未记录'}
流式：${diag.stream ? '是' : '否'}
HTTP 状态：${diag.status || '未建立响应'}
总耗时：${diag.durationMs ?? 0} ms
首字节：${diag.firstByteMs ? `${diag.firstByteMs} ms` : '未记录'}
排队等待：${diag.queueWaitMs ?? 0} ms
超时上限：${diag.timeoutMs ? `${diag.timeoutMs} ms` : '不限制'}
响应体积：${diag.responseBytes ? `${diag.responseBytes} 字节` : '未记录'}
响应类型：${diag.responseType || '未记录'}
消息：${diag.messageCount ?? 0} 条（System ${diag.systemMessageCount ?? 0} / User ${diag.userMessageCount ?? 0}）
请求体积：约 ${diag.requestChars ?? 0} 字符
端点：${diag.endpoint || '未记录'}
${diag.errorType ? `错误分类：${errorMap[diag.errorType] || diag.errorType}` : ''}
${diag.cancelReason ? `取消原因：${diag.cancelReason}` : ''}
${diag.errorMessage ? `错误摘要：${diag.errorMessage}` : ''}

## 当前运行状态
活动请求：${queue.active || 0} / ${queue.maxActive || 0}
排队请求：${queue.queued || 0}
${activeLines.length ? activeLines.join('\n') : '当前没有活动请求'}

## 最近请求（最多 12 条）
${recentLines.length ? recentLines.join('\n') : '无'}

说明：诊断只保存在当前浏览器会话，不记录 API Key，不进入备份。流式请求会在响应体读取完成后更新为“响应读取完成”。`;
        box.hidden = false;
    }

    function renderPromentRuntimeComparison() {
        const box = document.getElementById('proment-preview-box');
        const pre = document.getElementById('proment-preview-content');
        const snapshot = getLastPromptSnapshot();
        const char = getActivePromentCharacter();
        if (!box || !pre) return;
        if (!snapshot || !snapshot.systemPrompt) {
            pre.textContent = '# 设计 / 真实对照\n\n尚无真实请求快照。请先完成一次私聊 AI 请求。';
            box.hidden = false; return;
        }
        const policy = readPromentPolicy();
        let diag = window.__ovoLastWorldBookDiagnostic;
        if (!diag) { try { const raw=sessionStorage.getItem('ovo_last_worldbook_diagnostic'); diag=raw?JSON.parse(raw):null; } catch (_) {} }
        const sections = extractPromptSections(snapshot.systemPrompt);
        const lines = [
            '# Proment 设计 / 真实对照',
            `角色：${snapshot.characterName || char?.remarkName || char?.name || '未命名'}`,
            `模型：${snapshot.model || '未知'} · System Prompt：${snapshot.systemPromptChars || String(snapshot.systemPrompt).length} 字符`,
            '', '## 世界书策略（已接入真实运行）',
            `开关：${policy.worldBookEnabled ? '开启':'关闭'} · 预算：${policy.worldBookBudget} · 优先级：${policy.worldBookPriority}`,
            diag ? `实际候选：${diag.candidateCount || 0} · 命中资格：${diag.eligibleCount || 0} · 实际注入：${diag.includedCount || 0} · 注入字符：${diag.outputChars || 0} · 剩余预算：${diag.remainingBudget ?? '-'} ` : '尚无世界书运行诊断',
            '', '## 真实 Prompt 区块'
        ];
        if (sections.length) sections.forEach(sec => lines.push(`- ${sec.name}：${String(sec.content || '').length} 字符`));
        else lines.push('- 未识别到标准区块，完整 Prompt 仍可在“最近真实 Prompt”查看');
        lines.push('', '## 当前生效边界', '- 世界书：开关与预算已实际生效；命中规则与 before/middle/after 位置保持原逻辑。', '- 世界书优先级：当前用于诊断和后续统一 Context Runtime 的排序元数据，不改变 before/middle/after 语义。', '- 结构化档案：不做字段级控制，保持原有独立数据与注入逻辑。', '- 向量记忆：继续独立管理，Proment 只读显示最近注入结果。');
        pre.textContent = lines.join('\n'); box.hidden=false;
    }

    document.getElementById('proment-preview-context')?.addEventListener('click', renderPromentInjectionPreview);
    document.getElementById('proment-preview-runtime')?.addEventListener('click', renderLastRuntimePrompt);
    document.getElementById('proment-compare-runtime')?.addEventListener('click', renderPromentRuntimeComparison);
    document.getElementById('proment-preview-worldbook')?.addEventListener('click', renderWorldBookDiagnostic);
    document.getElementById('proment-preview-ai-request')?.addEventListener('click', renderAIRequestDiagnostic);
    document.getElementById('proment-cancel-ai-requests')?.addEventListener('click', () => {
        const count = window.OVOAIRequestRuntime?.cancelAll?.() || 0;
        showToast(count ? `已取消 ${count} 个 AI 请求` : '当前没有可取消的 AI 请求');
        renderAIRequestDiagnostic();
    });
    document.getElementById('proment-clear-ai-diagnostics')?.addEventListener('click', () => {
        window.OVOAIRequestRuntime?.clearDiagnostics?.();
        const pre = document.getElementById('proment-preview-content');
        if (pre) pre.textContent = `# AI 请求诊断\n\n请求诊断已清除。`;
        showToast('AI 请求诊断已清除');
    });
    document.getElementById('proment-clear-runtime')?.addEventListener('click', () => {
        window.__ovoLastPromptSnapshot = null;
        try { sessionStorage.removeItem('ovo_last_prompt_snapshot'); } catch (_) {}
        const pre = document.getElementById('proment-preview-content');
        if (pre) pre.textContent = `# 最近真实 Prompt

快照已清除。`;
        showToast('最近真实 Prompt 快照已清除');
    });
    document.getElementById('proment-copy-preview')?.addEventListener('click', async () => {
        const text = document.getElementById('proment-preview-content')?.textContent || '';
        try { await navigator.clipboard.writeText(text); }
        catch (_) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
        showToast('注入预览已复制');
    });

    // 默认底层提示词模板
    const defaultTemplate = `你正在一个名为“404”的线上聊天软件中扮演一个角色。请严格遵守以下规则：
核心规则：
A. 当前时间：现在是 {{当前时间}}。你应知晓当前时间，但除非对话内容明确相关，否则不要主动提及或评论时间（例如，不要催促我睡觉）。
[System Notice] 你的出生日期是[出生日期]，你现在的年龄是[年龄]岁。
[System Notice] 你当前所在的当地时间是：[时间] ([时区])。
B. 纯线上互动：这是一个完全虚拟的线上聊天。你扮演的角色和我之间没有任何线下关系。严禁提出任何关于线下见面、现实世界互动或转为其他非本平台联系方式的建议。你必须始终保持在线角色的身份。

角色和对话规则：
{{世界书_前}}
{{世界书_中}}
<char_settings>
1. 你的角色名是：{{角色名}}。我的称呼是：{{用户称呼}}。你的当前状态是：{{角色状态}}。
2. 你的角色设定是：{{角色人设}}
3. 在对话中可根据与用户的互动逐步丰富、补充你的人设（用户可在设置中查看并编辑「已补齐的人设」）。
{{世界书_后}}
</char_settings>

<user_settings>
3. 关于我的人设：{{用户人设}}
[System Notice] 与你对话的用户（称呼：{{用户称呼}}）现在的年龄是[年龄]岁。
[System Notice] 与你对话的用户（称呼：{{用户称呼}}）当前所在的当地时间是：[时间] ([时区])。
</user_settings>

<memoir>
{{共同回忆}}
</memoir>

<logic_rules>
{{在线逻辑规则}}
</logic_rules>

<output_formats>
16. 你的输出格式必须严格遵循以下格式：
{{输出格式}}
</output_formats>`;

    // Load initial settings
    if (db.magicRoom) {
        enabledSwitch.checked = db.magicRoom.customPromptEnabled || false;
        if (db.magicRoom.customPromptTemplate) {
            promptTextarea.value = db.magicRoom.customPromptTemplate;
        } else {
            promptTextarea.value = defaultTemplate;
        }
        editorSection.style.display = enabledSwitch.checked ? 'block' : 'none';
    }

    enabledSwitch.addEventListener('change', () => {
        editorSection.style.display = enabledSwitch.checked ? 'block' : 'none';
    });

    resetBtn.addEventListener('click', () => {
        if (confirm('确定要恢复默认模板吗？当前的修改将会丢失。')) {
            promptTextarea.value = defaultTemplate;
            showToast('已重置为默认模板');
        }
    });

    importBtn.addEventListener('click', () => {
        importInput.click();
    });

    // --- 提示词预设库管理逻辑 ---
    const presetSelect = document.getElementById('magic-room-preset-select');
    const applyPresetBtn = document.getElementById('magic-room-apply-preset');
    const savePresetBtn = document.getElementById('magic-room-save-preset');
    const managePresetsBtn = document.getElementById('magic-room-manage-presets');
    const presetsModal = document.getElementById('magic-room-presets-modal');
    const presetsList = document.getElementById('magic-room-presets-list');
    const closePresetsModalBtn = document.getElementById('magic-room-close-modal');

    function populateMagicRoomPresets() {
        if (!presetSelect) return;
        presetSelect.innerHTML = '<option value="">— 选择 —</option>';
        if (db.magicRoom && db.magicRoom.presets) {
            db.magicRoom.presets.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.name;
                opt.textContent = p.name;
                presetSelect.appendChild(opt);
            });
        }
    }
    
    // 初始化时填充
    populateMagicRoomPresets();

    if (applyPresetBtn) {
        applyPresetBtn.addEventListener('click', () => {
            const selected = presetSelect.value;
            if (!selected) return showToast('请先选择预设');
            const preset = (db.magicRoom.presets || []).find(p => p.name === selected);
            if (preset) {
                promptTextarea.value = preset.template;
                showToast('已加载预设：' + selected);
            }
        });
    }

    if (savePresetBtn) {
        savePresetBtn.addEventListener('click', async () => {
            const template = promptTextarea.value.trim();
            if (!template) return showToast('模板为空，无法保存');
            const name = prompt('请输入预设名称（将覆盖同名预设）：');
            if (!name || !name.trim()) return;
            
            if (!db.magicRoom) db.magicRoom = {};
            if (!db.magicRoom.presets) db.magicRoom.presets = [];
            
            const idx = db.magicRoom.presets.findIndex(p => p.name === name.trim());
            const presetObj = { name: name.trim(), template: template };
            if (idx >= 0) {
                db.magicRoom.presets[idx] = presetObj;
            } else {
                db.magicRoom.presets.push(presetObj);
            }
            
            await saveData();
            populateMagicRoomPresets();
            showToast('预设已保存');
        });
    }

    if (managePresetsBtn) {
        managePresetsBtn.addEventListener('click', () => {
            if (!presetsModal || !presetsList) return;
            presetsList.innerHTML = '';
            const presets = (db.magicRoom && db.magicRoom.presets) || [];
            if (presets.length === 0) {
                presetsList.innerHTML = '<p style="text-align:center;color:#999;padding:10px;">暂无预设</p>';
            } else {
                presets.forEach((p, idx) => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px;border-bottom:1px solid #f0f0f0;';
                    
                    const nameDiv = document.createElement('div');
                    nameDiv.style.cssText = 'flex:1;font-weight:500;';
                    nameDiv.textContent = p.name;
                    
                    const btnWrap = document.createElement('div');
                    btnWrap.style.cssText = 'display:flex;gap:6px;';
                    
                    const renameBtn = document.createElement('button');
                    renameBtn.className = 'btn btn-small';
                    renameBtn.textContent = '重命名';
                    renameBtn.onclick = async () => {
                        const newName = prompt('输入新名称：', p.name);
                        if (!newName || !newName.trim() || newName.trim() === p.name) return;
                        db.magicRoom.presets[idx].name = newName.trim();
                        await saveData();
                        populateMagicRoomPresets();
                        managePresetsBtn.click(); // re-render
                    };
                    
                    const delBtn = document.createElement('button');
                    delBtn.className = 'btn btn-danger btn-small';
                    delBtn.textContent = '删除';
                    delBtn.onclick = async () => {
                        if (!confirm('确定删除预设：' + p.name + '？')) return;
                        db.magicRoom.presets.splice(idx, 1);
                        await saveData();
                        populateMagicRoomPresets();
                        managePresetsBtn.click();
                    };
                    
                    btnWrap.appendChild(renameBtn);
                    btnWrap.appendChild(delBtn);
                    row.appendChild(nameDiv);
                    row.appendChild(btnWrap);
                    presetsList.appendChild(row);
                });
            }
            presetsModal.style.display = 'flex';
        });
    }

    if (closePresetsModalBtn) {
        closePresetsModalBtn.addEventListener('click', () => {
            presetsModal.style.display = 'none';
        });
    }

    importInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            // 兼容单个模板导入
            if (data && data.type === 'ovo-system-prompt-template' && data.template) {
                promptTextarea.value = data.template;
                showToast('模板导入成功');
            } 
            // 支持多个预设数组导入
            else if (Array.isArray(data) && data.length > 0 && data[0].template) {
                if (!db.magicRoom) db.magicRoom = {};
                if (!db.magicRoom.presets) db.magicRoom.presets = [];
                data.forEach(p => {
                    const idx = db.magicRoom.presets.findIndex(exist => exist.name === p.name);
                    if (idx >= 0) db.magicRoom.presets[idx] = p;
                    else db.magicRoom.presets.push(p);
                });
                await saveData();
                populateMagicRoomPresets();
                showToast(`成功导入 ${data.length} 个预设`);
            } else {
                showToast('无效的模板文件');
            }
        } catch (err) {
            showToast('导入失败：' + err.message);
        }
        e.target.value = '';
    });

    exportBtn.addEventListener('click', () => {
        // 如果有预设，优先提示是否导出整个预设库
        if (db.magicRoom && db.magicRoom.presets && db.magicRoom.presets.length > 0) {
            if (confirm('是否导出整个预设库？（点击取消则仅导出当前编辑框内容）')) {
                const blob = new Blob([JSON.stringify(db.magicRoom.presets, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `系统提示词预设库_${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast('预设库导出成功');
                return;
            }
        }
        
        const template = promptTextarea.value;
        if (!template) return showToast('模板为空，无法导出');
        const data = {
            type: 'ovo-system-prompt-template',
            version: 1,
            template: template
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `系统提示词模板_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('模板导出成功');
    });

    saveBtn.addEventListener('click', async () => {
        if (!db.magicRoom) db.magicRoom = {};
        db.magicRoom.customPromptEnabled = enabledSwitch.checked;
        db.magicRoom.customPromptTemplate = promptTextarea.value;
        // 保存系统通知设置
        db.magicRoom.sysNotifEnabled      = sysnotifEnabled ? sysnotifEnabled.checked : false;
        db.magicRoom.sysNotifSenderName   = sysnotifSenderName ? sysnotifSenderName.value.trim() : '';
        db.magicRoom.sysNotifShowAvatar   = sysnotifShowAvatar ? sysnotifShowAvatar.checked : true;
        const sysNotifInChatEnabledEl = document.getElementById('sysnotif-in-chat-enabled');
        db.magicRoom.sysNotifInChatEnabled = sysNotifInChatEnabledEl ? sysNotifInChatEnabledEl.checked : false;
        db.magicRoom.sysNotifShowContent  = sysnotifShowContent ? sysnotifShowContent.checked : true;
        db.magicRoom.sysNotifCustomServer = sysnotifCustomSrv ? sysnotifCustomSrv.checked : false;
        db.magicRoom.sysNotifServerUrl    = sysnotifSrvUrl ? sysnotifSrvUrl.value.trim() : '';
        db.magicRoom.sysNotifServerKey    = sysnotifSrvKey ? sysnotifSrvKey.value.trim() : '';
        db.magicRoom.contextPolicy = readPromentPolicy();
        await saveData();
        showToast('Proment 设置已保存！');
    });

    // ===== 系统通知设置初始化 =====
    const sysnotifEnabled    = document.getElementById('sysnotif-enabled');
    const sysnotifOptions    = document.getElementById('sysnotif-options');
    const sysnotifSenderName = document.getElementById('sysnotif-sender-name');
    const sysnotifShowAvatar = document.getElementById('sysnotif-show-avatar');
    const sysnotifShowContent= document.getElementById('sysnotif-show-content');
    const sysnotifCustomSrv  = document.getElementById('sysnotif-custom-server');
    const sysnotifSrvOptions = document.getElementById('sysnotif-server-options');
    const sysnotifSrvUrl     = document.getElementById('sysnotif-server-url');
    const sysnotifSrvKey     = document.getElementById('sysnotif-server-key');
    const sysnotifReqPerm    = document.getElementById('sysnotif-request-permission');
    const sysnotifPermStatus = document.getElementById('sysnotif-permission-status');

    if (sysnotifEnabled) {
        const mr = db.magicRoom || {};
        // 从 db 回填数据
        sysnotifEnabled.checked             = !!mr.sysNotifEnabled;
        sysnotifOptions.style.display       = mr.sysNotifEnabled ? 'block' : 'none';
        sysnotifSenderName.value            = mr.sysNotifSenderName || '';
        sysnotifShowAvatar.checked          = mr.sysNotifShowAvatar !== false;
        const sysNotifInChatEnabledEl = document.getElementById('sysnotif-in-chat-enabled');
        if (sysNotifInChatEnabledEl) sysNotifInChatEnabledEl.checked = !!mr.sysNotifInChatEnabled;
        sysnotifShowContent.checked         = mr.sysNotifShowContent !== false;
        sysnotifCustomSrv.checked           = !!mr.sysNotifCustomServer;
        sysnotifSrvOptions.style.display    = mr.sysNotifCustomServer ? 'block' : 'none';
        sysnotifSrvUrl.value                = mr.sysNotifServerUrl || '';
        sysnotifSrvKey.value                = mr.sysNotifServerKey || '';

        // 更新权限状态提示
        function updateSysNotifPermStatus() {
            if (!('Notification' in window)) {
                sysnotifPermStatus.textContent = '⚠️ 当前浏览器不支持通知 API';
                return;
            }
            const map = {
                granted: '✅ 已授权，系统通知功能可正常使用',
                denied:  '❌ 已被拒绝，请在浏览器/系统设置中手动开启',
                default: '⚪ 尚未申请权限，请点击上方按钮申请'
            };
            sysnotifPermStatus.textContent = map[Notification.permission] || '';
        }
        updateSysNotifPermStatus();

        // 总开关
        sysnotifEnabled.addEventListener('change', () => {
            sysnotifOptions.style.display = sysnotifEnabled.checked ? 'block' : 'none';
        });

        // 自定义服务器开关
        sysnotifCustomSrv.addEventListener('change', () => {
            sysnotifSrvOptions.style.display = sysnotifCustomSrv.checked ? 'block' : 'none';
        });

        // 申请权限按钮
        sysnotifReqPerm.addEventListener('click', async () => {
            if (!('Notification' in window)) {
                showToast('当前浏览器不支持通知 API');
                return;
            }
            const result = await Notification.requestPermission();
            updateSysNotifPermStatus();
            if (result === 'granted') {
                showToast('✅ 通知权限已授权！');
            } else if (result === 'denied') {
                showToast('❌ 权限被拒绝，请在浏览器设置中手动开启');
            } else {
                showToast('未授权，请重试');
            }
        });

        // 发送测试通知按钮
        const sysnotifTestBtn = document.getElementById('sysnotif-test-btn');
        if (sysnotifTestBtn) {
            sysnotifTestBtn.addEventListener('click', async () => {
                if (!('Notification' in window)) {
                    showToast('当前浏览器不支持通知 API');
                    return;
                }
                if (Notification.permission !== 'granted') {
                    showToast('请先申请系统通知权限！');
                    return;
                }
                const name = sysnotifSenderName.value.trim() || '章鱼喷墨机';
                await showSystemNotification({
                    title: name,
                    body: '这是一条系统级通知的测试消息，如果你看到了它，说明设置成功！',
                    icon: 'https://i.postimg.cc/Vk042Snv/5F3BCD91056B989330AE34D11901BD6E.png'
                });
            });
        }
    }
}

