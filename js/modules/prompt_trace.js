// OVO Prompt Trace - V2.10-R1
// 把模型最终请求整理成用户可理解的来源视图；只做只读追踪，不参与 Prompt 决策。
(function (global) {
    'use strict';

    const CONTENT_LIMIT = 12000;
    const ITEM_LIMIT = 36;
    const TYPE_META = Object.freeze({
        system_rules: { title: '系统规则', icon: '⚙️', order: 10 },
        character_profile: { title: '角色档案', icon: '🎭', order: 20 },
        user_profile: { title: '用户档案', icon: '👤', order: 30 },
        worldbook: { title: '世界书', icon: '🌍', order: 40 },
        structured_memory: { title: '结构化记忆', icon: '🗂️', order: 50 },
        journal_memory: { title: '日记记忆', icon: '📔', order: 51 },
        vector_memory: { title: '向量记忆', icon: '🧭', order: 52 },
        chat_history: { title: '聊天历史', icon: '💬', order: 60 },
        user_input: { title: '本次输入', icon: '✍️', order: 70 },
        task_instruction: { title: '任务要求', icon: '🎯', order: 80 },
        output_rules: { title: '输出规则', icon: '📐', order: 90 },
        tool_config: { title: '工具与模型参数', icon: '🧰', order: 100 },
        other: { title: '其他上下文', icon: '📎', order: 110 }
    });

    function makeId(prefix) {
        return `${prefix || 'source'}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function clipText(value, limit = CONTENT_LIMIT) {
        const text = String(value == null ? '' : value);
        if (text.length <= limit) return { text, chars: text.length, clipped: false };
        return { text: `${text.slice(0, limit)}\n…（内容过长，已截断）`, chars: text.length, clipped: true };
    }

    function contentToText(content) {
        if (content == null) return '';
        if (typeof content === 'string') return content;
        if (typeof content === 'number' || typeof content === 'boolean') return String(content);
        if (Array.isArray(content)) {
            return content.map(part => {
                if (part == null) return '';
                if (typeof part === 'string') return part;
                if (typeof part.text === 'string') return part.text;
                if (part.type === 'text' && typeof part.text === 'string') return part.text;
                if (part.inline_data || part.image_url || part.type === 'image_url') return '[图片内容]';
                try { return JSON.stringify(part); } catch (_) { return String(part); }
            }).filter(Boolean).join('\n');
        }
        if (typeof content === 'object') {
            if (typeof content.text === 'string') return content.text;
            if (Array.isArray(content.parts)) return contentToText(content.parts);
            try { return JSON.stringify(content, null, 2); } catch (_) { return String(content); }
        }
        return String(content);
    }

    function normalizeItem(item, parentType) {
        const type = item?.type || parentType || 'other';
        const meta = TYPE_META[type] || TYPE_META.other;
        const clipped = clipText(item?.content || '');
        return {
            id: item?.id || makeId('item'),
            type,
            title: item?.title || meta.title,
            summary: item?.summary || '',
            content: clipped.text,
            chars: Number.isFinite(item?.chars) ? Math.max(0, item.chars) : clipped.chars,
            count: Number.isFinite(item?.count) ? Math.max(0, item.count) : 1,
            sent: item?.sent !== false,
            reason: item?.reason || '',
            clipped: !!item?.clipped || clipped.clipped,
            sourceId: item?.sourceId || '',
            metadata: item?.metadata && typeof item.metadata === 'object' ? { ...item.metadata } : {}
        };
    }

    function normalizeSource(source) {
        const type = source?.type || 'other';
        const meta = TYPE_META[type] || TYPE_META.other;
        const clipped = clipText(source?.content || '');
        const items = Array.isArray(source?.items)
            ? source.items.slice(0, ITEM_LIMIT).map(item => normalizeItem(item, type))
            : [];
        const itemChars = items.reduce((sum, item) => sum + (Number(item.chars) || 0), 0);
        return {
            id: source?.id || makeId('source'),
            type,
            title: source?.title || meta.title,
            icon: source?.icon || meta.icon,
            summary: source?.summary || '',
            content: clipped.text,
            chars: Number.isFinite(source?.chars) ? Math.max(0, source.chars) : (clipped.chars || itemChars),
            count: Number.isFinite(source?.count) ? Math.max(0, source.count) : (items.length || (clipped.text ? 1 : 0)),
            sent: source?.sent !== false,
            reason: source?.reason || '',
            clipped: !!source?.clipped || clipped.clipped,
            traceMode: source?.traceMode || 'source',
            sourceId: source?.sourceId || '',
            items,
            metadata: source?.metadata && typeof source.metadata === 'object' ? { ...source.metadata } : {}
        };
    }

    function normalizeSources(sources) {
        return (Array.isArray(sources) ? sources : [])
            .filter(Boolean)
            .map(normalizeSource)
            .filter(source => source.content || source.items.length || source.count > 0)
            .sort((a, b) => ((TYPE_META[a.type] || TYPE_META.other).order - (TYPE_META[b.type] || TYPE_META.other).order));
    }

    function extractMessages(body) {
        const result = [];
        if (Array.isArray(body?.messages)) {
            body.messages.forEach((message, index) => {
                if (!message) return;
                result.push({
                    id: `message_${index}`,
                    role: message.role || 'unknown',
                    text: contentToText(message.content),
                    index,
                    providerShape: 'messages'
                });
            });
        }
        const instruction = contentToText(body?.system_instruction || body?.systemInstruction);
        if (instruction) {
            result.unshift({ id: 'system_instruction', role: 'system', text: instruction, index: -1, providerShape: 'gemini' });
        }
        if (Array.isArray(body?.contents)) {
            body.contents.forEach((message, index) => {
                if (!message) return;
                const role = message.role === 'model' ? 'assistant' : (message.role || 'user');
                result.push({
                    id: `content_${index}`,
                    role,
                    text: contentToText(message.parts || message.content),
                    index,
                    providerShape: 'gemini'
                });
            });
        }
        return result;
    }

    function isControlMessage(text) {
        const value = String(text || '').trim();
        return /^\[(继续对话|incipere|用户正在查看对话框|系统通知)[\s\S]*\]$/i.test(value)
            || /^<thinking>[\s\S]*<\/thinking>/i.test(value);
    }

    function splitMemoryUpdatePrompt(text) {
        const value = String(text || '');
        if (!/结构化记忆表/.test(value) || !/模板定义如下[:：]/.test(value) || !/最近聊天记录如下[:：]/.test(value)) return [];
        const roleMarker = value.search(/角色信息[:：]/);
        const templateMarker = value.search(/模板定义如下[:：]/);
        const historyMarker = value.search(/最近聊天记录如下[:：]/);
        if (templateMarker < 0 || historyMarker < 0) return [];
        const taskEnd = roleMarker >= 0 ? roleMarker : templateMarker;
        const task = value.slice(0, taskEnd).trim();
        const role = roleMarker >= 0 ? value.slice(roleMarker, templateMarker).trim() : '';
        const template = value.slice(templateMarker, historyMarker).replace(/^模板定义如下[:：]\s*/i, '').trim();
        const history = value.slice(historyMarker).replace(/^最近聊天记录如下[:：]\s*/i, '').trim();
        const roleLines = role.split('\n').map(line => line.trim()).filter(Boolean);
        const characterLines = roleLines.filter(line => /角色名|角色人设/.test(line));
        const userLines = roleLines.filter(line => /用户称呼|用户人设/.test(line));
        return normalizeSources([
            task && { type: 'output_rules', title: '提取与输出约束', content: task, reason: '用于限定结构化档案的提取边界和 XML 输出格式', traceMode: 'inferred_exact' },
            characterLines.length && { type: 'character_profile', content: characterLines.join('\n'), reason: '来自本次档案更新 Prompt 中的角色信息', traceMode: 'inferred_exact' },
            userLines.length && { type: 'user_profile', content: userLines.join('\n'), reason: '来自本次档案更新 Prompt 中的用户信息', traceMode: 'inferred_exact' },
            template && { type: 'structured_memory', title: '目标档案与现有数据', content: template, reason: '包含目标模板、字段规则、当前值和候选行', traceMode: 'inferred_exact' },
            history && { type: 'chat_history', title: '用于提取的聊天范围', content: history, count: history.split('\n').filter(Boolean).length, reason: '这是本次档案更新实际读取的聊天文本', traceMode: 'inferred_exact' }
        ].filter(Boolean));
    }

    function inferSources(body, meta = {}) {
        const messages = extractMessages(body);
        const sources = [];
        const systemTexts = messages.filter(item => item.role === 'system').map(item => item.text).filter(Boolean);
        const conversation = messages.filter(item => item.role !== 'system' && item.text);
        const singleUser = conversation.length === 1 && conversation[0].role === 'user' ? conversation[0].text : '';
        const memorySections = splitMemoryUpdatePrompt(singleUser);
        if (memorySections.length) return memorySections;

        if (systemTexts.length) {
            sources.push({
                type: 'system_rules',
                title: systemTexts.length > 1 ? '完整系统消息' : '完整系统提示词',
                content: systemTexts.join('\n\n---\n\n'),
                count: systemTexts.length,
                reason: '从最终模型请求中读取，包含实际发送的系统规则',
                traceMode: 'request_exact'
            });
        }

        let userInputIndex = -1;
        for (let index = conversation.length - 1; index >= 0; index -= 1) {
            const item = conversation[index];
            if (item.role === 'user' && !isControlMessage(item.text)) {
                userInputIndex = index;
                break;
            }
        }
        if (userInputIndex < 0 && conversation.length) userInputIndex = conversation.length - 1;
        const historyItems = conversation.filter((item, index) => index !== userInputIndex && !isControlMessage(item.text));
        if (historyItems.length) {
            sources.push({
                type: 'chat_history',
                content: historyItems.map(item => `${item.role}: ${item.text}`).join('\n\n'),
                count: historyItems.length,
                reason: '由最终请求中的历史 user / assistant 消息整理',
                traceMode: 'request_exact',
                items: historyItems.slice(0, ITEM_LIMIT).map(item => ({
                    id: item.id,
                    title: item.role === 'assistant' ? '角色消息' : '用户消息',
                    content: item.text,
                    sourceId: item.id,
                    reason: `最终请求第 ${item.index + 1} 条消息`
                }))
            });
        }
        if (userInputIndex >= 0 && conversation[userInputIndex]) {
            const item = conversation[userInputIndex];
            sources.push({
                type: 'user_input',
                title: meta.task && String(meta.task).includes('background') ? '本次后台任务输入' : '本次实际输入',
                content: item.text,
                reason: '从最终请求中识别的最后一条非控制 user 消息',
                traceMode: 'request_exact'
            });
        }

        const controlItems = conversation.filter(item => isControlMessage(item.text));
        if (controlItems.length) {
            sources.push({
                type: 'task_instruction',
                title: '运行控制指令',
                content: controlItems.map(item => item.text).join('\n'),
                count: controlItems.length,
                reason: '继续对话、后台触发或思考预填等运行指令',
                traceMode: 'request_exact'
            });
        }

        const config = {};
        ['temperature', 'top_p', 'max_tokens', 'maxOutputTokens', 'stream', 'tools', 'tool_choice', 'response_format', 'generationConfig'].forEach(key => {
            if (body && body[key] !== undefined) config[key] = body[key];
        });
        if (Object.keys(config).length) {
            let content = '';
            try { content = JSON.stringify(config, null, 2); } catch (_) { content = String(config); }
            sources.push({ type: 'tool_config', content, reason: '最终请求中的模型生成参数与工具配置', traceMode: 'request_exact' });
        }
        return normalizeSources(sources);
    }

    function mergeSources(explicitSources, inferredSources) {
        const explicit = normalizeSources(explicitSources);
        const inferred = normalizeSources(inferredSources);
        const result = [...explicit];
        const exactTypes = new Set(explicit.map(source => source.type));
        inferred.forEach(source => {
            // 系统规则保留“完整最终系统提示词”作为核对层；其他类型由显式来源优先。
            if (source.type !== 'system_rules' && exactTypes.has(source.type)) return;
            if (source.type === 'system_rules' && result.some(item => item.type === 'system_rules' && item.traceMode === 'request_exact')) return;
            result.push(source);
        });
        return result.sort((a, b) => ((TYPE_META[a.type] || TYPE_META.other).order - (TYPE_META[b.type] || TYPE_META.other).order));
    }

    function summarize(sections) {
        const byType = {};
        sections.forEach(section => {
            if (!byType[section.type]) byType[section.type] = { type: section.type, title: (TYPE_META[section.type] || TYPE_META.other).title, count: 0, chars: 0, sections: 0 };
            byType[section.type].count += Number(section.count) || 0;
            byType[section.type].chars += Number(section.chars) || 0;
            byType[section.type].sections += 1;
        });
        return {
            sectionCount: sections.length,
            sentSectionCount: sections.filter(section => section.sent !== false).length,
            sourceChars: sections.reduce((sum, section) => sum + (Number(section.chars) || 0), 0),
            byType: Object.values(byType).sort((a, b) => ((TYPE_META[a.type] || TYPE_META.other).order - (TYPE_META[b.type] || TYPE_META.other).order))
        };
    }

    function build(body, explicitSources, meta = {}) {
        const sections = mergeSources(explicitSources, inferSources(body, meta));
        return {
            version: 'prompt-trace.v1',
            capturedAt: new Date().toISOString(),
            task: meta.task || '',
            source: meta.source || '',
            provider: meta.provider || '',
            model: meta.model || body?.model || '',
            sections,
            summary: summarize(sections)
        };
    }

    function source(type, options = {}) {
        return normalizeSource({ ...options, type });
    }

    global.OVOPromptTrace = {
        VERSION: '2.10-R1',
        TYPE_META,
        build,
        source,
        normalizeSources,
        extractMessages,
        contentToText
    };
})(window);
