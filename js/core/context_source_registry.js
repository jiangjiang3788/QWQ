// QWQ V5.4.1 · AI context source registry and compiled request manifest
// 第一阶段只登记、对账和诊断，不改变现有 Prompt 的业务效果。
(function (global) {
    'use strict';

    const VERSION = 'context-registry.v3';
    const definitions = new Map();
    let lastManifest = null;

    const TYPE_TO_SOURCE_ID = Object.freeze({
        system_rules: 'system.core_rules',
        character_profile: 'character.profile',
        user_profile: 'user.profile',
        worldbook: 'worldbook.active',
        structured_memory: 'memory.structured',
        character_memory: 'memory.live',
        journal_memory: 'memory.journal',
        vector_memory: 'memory.vector',
        chat_history: 'chat.history',
        user_input: 'chat.current_input',
        output_rules: 'output.chat_protocol',
        tool_config: 'request.tools',
        task_instruction: 'task.instruction',
        other: 'context.other'
    });

    function clone(value) {
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    }

    function register(definition) {
        if (!definition || typeof definition !== 'object') throw new TypeError('context source definition must be an object');
        const id = String(definition.id || '').trim();
        if (!id) throw new Error('context source id is required');
        if (definitions.has(id)) throw new Error(`context source already registered: ${id}`);
        const normalized = Object.freeze({
            id,
            domain: String(definition.domain || 'other'),
            layer: String(definition.layer || 'other'),
            title: String(definition.title || id),
            tasks: Object.freeze(Array.from(new Set((Array.isArray(definition.tasks) ? definition.tasks : ['*']).map(String)))),
            role: String(definition.role || 'system'),
            priority: Number.isFinite(definition.priority) ? definition.priority : 100,
            defaultBudget: Number.isFinite(definition.defaultBudget) ? Math.max(0, definition.defaultBudget) : 0,
            optional: definition.optional !== false,
            navigation: definition.navigation && typeof definition.navigation === 'object' ? Object.freeze({ ...definition.navigation }) : null
        });
        definitions.set(id, normalized);
        return normalized;
    }

    function registerMany(items) {
        return (Array.isArray(items) ? items : []).map(register);
    }

    function get(id) { return definitions.get(String(id || '')) || null; }
    function has(id) { return definitions.has(String(id || '')); }
    function list() { return Array.from(definitions.values()).map(item => ({ ...item, tasks: [...item.tasks], navigation: item.navigation ? { ...item.navigation } : null })); }

    function contentToText(content) {
        if (content == null) return '';
        if (typeof content === 'string') return content;
        if (typeof content === 'number' || typeof content === 'boolean') return String(content);
        if (Array.isArray(content)) return content.map(contentToText).filter(Boolean).join('\n');
        if (typeof content === 'object') {
            if (typeof content.text === 'string') return content.text;
            if (Array.isArray(content.parts)) return contentToText(content.parts);
            if (typeof content.content === 'string') return content.content;
            if (content.inline_data || content.image_url || content.type === 'image_url') return '[图片内容]';
            try { return JSON.stringify(content); } catch (_) { return ''; }
        }
        return String(content);
    }

    function extractMessages(body) {
        const messages = [];
        const instruction = contentToText(body?.system_instruction || body?.systemInstruction);
        if (instruction) messages.push({ role: 'system', content: instruction, providerShape: 'system_instruction' });
        if (Array.isArray(body?.messages)) {
            body.messages.forEach(message => messages.push({
                role: String(message?.role || 'unknown'),
                content: contentToText(message?.content),
                providerShape: 'messages'
            }));
        }
        if (Array.isArray(body?.contents)) {
            body.contents.forEach(message => messages.push({
                role: message?.role === 'model' ? 'assistant' : String(message?.role || 'user'),
                content: contentToText(message?.parts || message?.content),
                providerShape: 'contents'
            }));
        }
        return messages;
    }

    function sourceIdForPromptSource(source) {
        if (source?.registryId && has(source.registryId)) return source.registryId;
        return TYPE_TO_SOURCE_ID[source?.type] || 'context.other';
    }

    function sourceChars(source) {
        if (Number.isFinite(source?.chars)) return Math.max(0, source.chars);
        if (typeof source?.content === 'string') return source.content.length;
        if (Array.isArray(source?.items)) return source.items.reduce((sum, item) => sum + sourceChars(item), 0);
        return 0;
    }

    function buildShadowManifest(options = {}) {
        const body = options.requestBody || options.body || {};
        const messages = extractMessages(body);
        const promptSources = Array.isArray(options.promptSources) ? options.promptSources : [];
        const sourceEntries = promptSources.map(source => {
            const sourceId = sourceIdForPromptSource(source);
            const definition = get(sourceId);
            return {
                sourceId,
                registered: !!definition,
                title: source?.title || definition?.title || sourceId,
                domain: definition?.domain || 'other',
                layer: definition?.layer || 'other',
                role: definition?.role || 'system',
                priority: definition?.priority ?? 100,
                included: source?.sent !== false,
                chars: sourceChars(source),
                reason: source?.reason || '',
                traceType: source?.type || 'other',
                sourceRef: source?.sourceId ? { id: String(source.sourceId) } : null
            };
        });

        const systemChars = messages.filter(message => message.role === 'system').reduce((sum, message) => sum + message.content.length, 0);
        const userMessages = messages.filter(message => message.role === 'user');
        const assistantMessages = messages.filter(message => message.role === 'assistant');
        const knownSystemChars = sourceEntries.filter(entry => entry.included && entry.role === 'system').reduce((sum, entry) => sum + entry.chars, 0);
        const toolsChars = body.tools ? contentToText(body.tools).length : 0;
        const parameterObject = {};
        ['model', 'stream', 'temperature', 'max_tokens', 'maxOutputTokens', 'response_format', 'stop', 'top_p', 'topP'].forEach(key => {
            if (body[key] !== undefined) parameterObject[key] = body[key];
        });
        const paramsChars = contentToText(parameterObject).length;
        const retiredAudit = global.OVORetiredFeaturePolicy?.auditRequest?.(body) || { ok: true, findings: [] };
        const unregisteredSourceIds = sourceEntries.filter(entry => !entry.registered).map(entry => entry.sourceId);
        const unregisteredSystemChars = Math.max(0, systemChars - knownSystemChars);

        const manifest = {
            protocol: VERSION,
            mode: 'shadow',
            task: String(options.task || 'chat.reply'),
            scope: clone(options.scope || {}),
            provider: String(options.provider || ''),
            model: String(options.model || body.model || ''),
            capturedAt: new Date().toISOString(),
            registryCount: definitions.size,
            sources: sourceEntries,
            request: {
                messageCount: messages.length,
                systemMessageCount: messages.filter(message => message.role === 'system').length,
                userMessageCount: userMessages.length,
                assistantMessageCount: assistantMessages.length,
                systemChars,
                userChars: userMessages.reduce((sum, message) => sum + message.content.length, 0),
                assistantChars: assistantMessages.reduce((sum, message) => sum + message.content.length, 0),
                toolsChars,
                paramsChars
            },
            coverage: {
                knownSystemChars,
                unregisteredSystemChars,
                unregisteredSourceIds: Array.from(new Set(unregisteredSourceIds)),
                retiredSourceFindings: retiredAudit.findings || [],
                retiredSourceLeak: !retiredAudit.ok,
                complete: unregisteredSystemChars === 0 && unregisteredSourceIds.length === 0 && retiredAudit.ok
            }
        };
        lastManifest = manifest;
        global.__ovoLastContextManifest = clone(manifest);
        try { sessionStorage.setItem('ovo_last_context_manifest', JSON.stringify(manifest)); } catch (_) {}
        return clone(manifest);
    }

    function mergeRanges(ranges) {
        const sorted = (Array.isArray(ranges) ? ranges : [])
            .filter(item => Number.isFinite(item?.start) && Number.isFinite(item?.end) && item.end > item.start)
            .sort((a, b) => a.start - b.start || a.end - b.end);
        const merged = [];
        sorted.forEach(item => {
            const last = merged[merged.length - 1];
            if (!last || item.start > last.end) merged.push({ start: item.start, end: item.end });
            else last.end = Math.max(last.end, item.end);
        });
        return merged;
    }

    function isControlMessageText(value) {
        const text = String(value || '').trim();
        return text === '[incipere]'
            || text.startsWith('<thinking>')
            || text === '[继续对话。]'
            || text.startsWith('[系统通知：')
            || text.startsWith('[用户正在查看对话框')
            || text.startsWith('[system:');
    }

    function buildCompiledManifest(options = {}) {
        const body = options.requestBody || options.body || {};
        const messages = extractMessages(body);
        const promptSources = Array.isArray(options.promptSources) ? options.promptSources : [];
        const systemText = messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n');
        const matchedRanges = [];
        const sourceEntries = promptSources.map(source => {
            const sourceId = sourceIdForPromptSource(source);
            const definition = get(sourceId);
            const content = typeof source?.content === 'string' ? source.content : '';
            let matchedChars = 0;
            let matchStart = -1;
            if (content) {
                matchStart = systemText.indexOf(content);
                if (matchStart >= 0) {
                    matchedChars = content.length;
                    matchedRanges.push({ start: matchStart, end: matchStart + content.length });
                }
            }
            return {
                sourceId,
                registered: !!definition,
                title: source?.title || definition?.title || sourceId,
                domain: definition?.domain || 'other',
                layer: definition?.layer || 'other',
                role: definition?.role || 'system',
                priority: definition?.priority ?? 100,
                included: source?.sent !== false,
                chars: sourceChars(source),
                matchedChars,
                reason: source?.reason || (matchedChars ? '内容已在最终请求中精确定位' : '来源已登记，具体格式由核心模板包装'),
                traceType: source?.type || 'other',
                sourceRef: source?.sourceId ? { id: String(source.sourceId) } : null,
                accounted: matchedChars > 0
            };
        });

        const merged = mergeRanges(matchedRanges);
        const matchedSystemChars = merged.reduce((sum, item) => sum + item.end - item.start, 0);
        const residualSystemChars = Math.max(0, systemText.length - matchedSystemChars);
        const core = get('system.core_rules');
        sourceEntries.unshift({
            sourceId: 'system.core_rules', registered: !!core, title: core?.title || '核心系统规则',
            domain: core?.domain || 'prompt', layer: core?.layer || 'system', role: 'system', priority: core?.priority || 10,
            included: systemText.length > 0, chars: residualSystemChars, matchedChars: residualSystemChars,
            reason: '统一编译器对未被子来源精确覆盖的模板、包装标签和核心规则进行兜底登记',
            traceType: 'compiled_residual', sourceRef: null, accounted: true
        });

        const nonSystem = messages.filter(message => message.role !== 'system');
        let currentInputIndex = -1;
        for (let index = nonSystem.length - 1; index >= 0; index--) {
            if (nonSystem[index].role === 'user' && !isControlMessageText(nonSystem[index].content)) { currentInputIndex = index; break; }
        }
        let historyChars = 0;
        let currentInputChars = 0;
        let controlChars = 0;
        nonSystem.forEach((message, index) => {
            if (isControlMessageText(message.content)) controlChars += message.content.length;
            else if (index === currentInputIndex) currentInputChars += message.content.length;
            else historyChars += message.content.length;
        });
        const pushRequestSource = (sourceId, chars, reason, role) => {
            const definition = get(sourceId);
            sourceEntries.push({
                sourceId, registered: !!definition, title: definition?.title || sourceId,
                domain: definition?.domain || 'other', layer: definition?.layer || 'other', role: role || definition?.role || 'request',
                priority: definition?.priority ?? 100, included: chars > 0, chars, matchedChars: chars,
                reason, traceType: 'compiled_exact', sourceRef: null, accounted: true
            });
        };
        pushRequestSource('chat.history', historyChars, '最终请求中除本轮输入和控制消息之外的会话消息', 'mixed');
        pushRequestSource('chat.current_input', currentInputChars, '最终请求中最后一条真实用户输入', 'user');
        pushRequestSource('cot.instructions', controlChars, '继续对话、CoT触发与预填等控制消息', 'mixed');

        const toolsChars = body.tools ? contentToText(body.tools).length : 0;
        const parameterObject = {};
        Object.keys(body || {}).forEach(key => {
            if (['messages', 'contents', 'system_instruction', 'systemInstruction', 'tools'].includes(key)) return;
            parameterObject[key] = body[key];
        });
        const paramsChars = contentToText(parameterObject).length;
        pushRequestSource('request.tools', toolsChars, toolsChars ? '最终请求携带的模型工具定义' : '本次未发送工具定义', 'request');
        pushRequestSource('request.parameters', paramsChars, '最终请求中的模型、采样、流式及Provider参数', 'request');
        pushRequestSource('provider.wrapper', 0, `Provider消息结构：${String(options.provider || 'unknown')}`, 'request');

        const retiredAudit = global.OVORetiredFeaturePolicy?.auditRequest?.(body) || { ok: true, findings: [] };
        const unregisteredSourceIds = sourceEntries.filter(entry => !entry.registered).map(entry => entry.sourceId);
        const manifest = {
            protocol: VERSION,
            mode: 'compiled',
            task: String(options.task || 'chat.reply'),
            scope: clone(options.scope || {}),
            provider: String(options.provider || ''),
            model: String(options.model || body.model || ''),
            capturedAt: new Date().toISOString(),
            registryCount: definitions.size,
            policy: clone(options.policy || null),
            compileChanges: clone(options.compileChanges || []),
            sources: sourceEntries,
            request: {
                messageCount: messages.length,
                systemMessageCount: messages.filter(message => message.role === 'system').length,
                userMessageCount: messages.filter(message => message.role === 'user').length,
                assistantMessageCount: messages.filter(message => message.role === 'assistant').length,
                systemChars: systemText.length,
                userChars: messages.filter(message => message.role === 'user').reduce((sum, message) => sum + message.content.length, 0),
                assistantChars: messages.filter(message => message.role === 'assistant').reduce((sum, message) => sum + message.content.length, 0),
                toolsChars,
                paramsChars
            },
            coverage: {
                accountedSystemChars: systemText.length,
                unregisteredMessageChars: 0,
                unregisteredTools: [],
                unregisteredParams: [],
                unregisteredSourceIds: Array.from(new Set(unregisteredSourceIds)),
                retiredSourceFindings: retiredAudit.findings || [],
                retiredSourceLeak: !retiredAudit.ok,
                complete: unregisteredSourceIds.length === 0 && retiredAudit.ok
            }
        };
        lastManifest = manifest;
        global.__ovoLastContextManifest = clone(manifest);
        try { sessionStorage.setItem('ovo_last_context_manifest', JSON.stringify(manifest)); } catch (_) {}
        return clone(manifest);
    }

    function sourceIdForTaskPromptSource(source, task) {
        if (source?.registryId && has(source.registryId)) return source.registryId;
        const type = String(source?.type || 'other');
        if (type === 'user_input') return String(task || '').startsWith('chat.') ? 'chat.current_input' : 'task.input';
        return TYPE_TO_SOURCE_ID[type] || 'context.other';
    }

    function buildTaskManifest(options = {}) {
        const body = options.requestBody || options.body || {};
        const task = String(options.task || 'generic-ai');
        const messages = extractMessages(body);
        const allMessageText = messages.map(message => message.content).join('\n\n');
        const promptSources = Array.isArray(options.promptSources) ? options.promptSources : [];
        const sourceEntries = promptSources.map(source => {
            const sourceId = sourceIdForTaskPromptSource(source, task);
            const definition = get(sourceId);
            const chars = sourceChars(source);
            const content = typeof source?.content === 'string' ? source.content : '';
            const matchedChars = content && allMessageText.includes(content) ? content.length : 0;
            return {
                sourceId,
                registered: !!definition,
                title: source?.title || definition?.title || sourceId,
                domain: definition?.domain || 'other',
                layer: definition?.layer || 'other',
                role: definition?.role || 'mixed',
                priority: definition?.priority ?? 100,
                included: source?.sent !== false,
                chars,
                matchedChars,
                reason: source?.reason || (matchedChars ? '内容已在最终任务请求中定位' : '来源已登记，由任务模板或Provider包装'),
                traceType: source?.type || 'other',
                sourceRef: source?.sourceId ? { id: String(source.sourceId) } : null,
                accounted: true
            };
        });
        const declaredChars = sourceEntries.filter(item => item.included).reduce((sum, item) => sum + item.matchedChars, 0);
        const residualChars = Math.max(0, allMessageText.length - declaredChars);
        const taskDef = get('task.instruction');
        sourceEntries.unshift({
            sourceId: 'task.instruction', registered: !!taskDef, title: taskDef?.title || '任务指令',
            domain: taskDef?.domain || 'task', layer: taskDef?.layer || 'control', role: 'mixed',
            priority: taskDef?.priority ?? 80, included: allMessageText.length > 0,
            chars: residualChars, matchedChars: residualChars,
            reason: '统一任务编译对未被细分来源覆盖的提示模板、标签和包装文字进行兜底登记',
            traceType: 'task_residual', sourceRef: null, accounted: true
        });
        const toolsChars = body.tools ? contentToText(body.tools).length : 0;
        const parameterObject = {};
        Object.keys(body || {}).forEach(key => {
            if (['messages', 'contents', 'system_instruction', 'systemInstruction', 'tools'].includes(key)) return;
            parameterObject[key] = body[key];
        });
        const paramsChars = contentToText(parameterObject).length;
        const pushRequestSource = (sourceId, chars, reason) => {
            const definition = get(sourceId);
            sourceEntries.push({
                sourceId, registered: !!definition, title: definition?.title || sourceId,
                domain: definition?.domain || 'other', layer: definition?.layer || 'request', role: 'request',
                priority: definition?.priority ?? 100, included: chars > 0, chars, matchedChars: chars,
                reason, traceType: 'task_request', sourceRef: null, accounted: true
            });
        };
        pushRequestSource('request.tools', toolsChars, toolsChars ? '最终任务请求携带的模型工具定义' : '本次未发送工具定义');
        pushRequestSource('request.parameters', paramsChars, '最终任务请求中的模型、采样、流式及Provider参数');
        pushRequestSource('provider.wrapper', 0, `Provider消息结构：${String(options.provider || 'unknown')}`);
        const retiredAudit = global.OVORetiredFeaturePolicy?.auditRequest?.(body) || { ok: true, findings: [] };
        const unregisteredSourceIds = sourceEntries.filter(item => !item.registered).map(item => item.sourceId);
        const manifest = {
            protocol: VERSION,
            mode: 'task-compiled',
            task,
            scope: clone(options.scope || {}),
            source: String(options.source || ''),
            provider: String(options.provider || ''),
            model: String(options.model || body.model || ''),
            capturedAt: new Date().toISOString(),
            registryCount: definitions.size,
            sources: sourceEntries,
            request: {
                messageCount: messages.length,
                systemMessageCount: messages.filter(item => item.role === 'system').length,
                userMessageCount: messages.filter(item => item.role === 'user').length,
                assistantMessageCount: messages.filter(item => item.role === 'assistant').length,
                messageChars: allMessageText.length,
                toolsChars,
                paramsChars
            },
            coverage: {
                unregisteredMessageChars: 0,
                unregisteredTools: [],
                unregisteredParams: [],
                unregisteredSourceIds: Array.from(new Set(unregisteredSourceIds)),
                retiredSourceFindings: retiredAudit.findings || [],
                retiredSourceLeak: !retiredAudit.ok,
                complete: unregisteredSourceIds.length === 0 && retiredAudit.ok
            }
        };
        lastManifest = manifest;
        global.__ovoLastContextManifest = clone(manifest);
        try { sessionStorage.setItem('ovo_last_context_manifest', JSON.stringify(manifest)); } catch (_) {}
        return clone(manifest);
    }

    function getLastManifest() { return clone(lastManifest || global.__ovoLastContextManifest || null); }

    registerMany([
        { id: 'system.core_rules', domain: 'prompt', layer: 'system', title: '核心系统规则', tasks: ['chat.reply', 'chat.background', 'call.reply'], role: 'system', priority: 10, optional: false },
        { id: 'character.profile', domain: 'character', layer: 'identity', title: '角色档案', tasks: ['chat.reply', 'chat.background', 'call.reply', 'journal.generate'], role: 'system', priority: 20, optional: false, navigation: { kind: 'character' } },
        { id: 'user.profile', domain: 'user', layer: 'identity', title: '用户档案', tasks: ['chat.reply', 'chat.background', 'call.reply'], role: 'system', priority: 30, optional: true, navigation: { kind: 'user' } },
        { id: 'worldbook.active', domain: 'worldbook', layer: 'knowledge', title: '世界书', tasks: ['chat.reply', 'chat.background', 'call.reply', 'journal.generate', 'theater.generate'], role: 'system', priority: 40, optional: true, navigation: { kind: 'worldbook' } },
        { id: 'memory.structured', domain: 'memory', layer: 'memory', title: '结构化记忆', tasks: ['chat.reply', 'chat.background'], role: 'system', priority: 50, optional: true, navigation: { kind: 'structured-memory' } },
        { id: 'memory.live', domain: 'memory', layer: 'memory', title: '实时状态与待办', tasks: ['chat.reply', 'chat.background'], role: 'system', priority: 51, optional: true, navigation: { kind: 'structured-memory' } },
        { id: 'memory.journal', domain: 'memory', layer: 'memory', title: '回忆日记补充', tasks: ['chat.reply', 'chat.background'], role: 'system', priority: 52, optional: true, navigation: { kind: 'journal-memory' } },
        { id: 'memory.vector', domain: 'memory', layer: 'memory', title: '向量记忆补充', tasks: ['chat.reply', 'chat.background'], role: 'system', priority: 53, optional: true, navigation: { kind: 'structured-memory' } },
        { id: 'runtime.current_time', domain: 'runtime', layer: 'environment', title: '当前时间与时区', tasks: ['chat.reply', 'chat.background', 'call.reply'], role: 'system', priority: 60, optional: false },
        { id: 'runtime.weather', domain: 'weather', layer: 'environment', title: '天气', tasks: ['chat.reply', 'call.reply'], role: 'system', priority: 61, optional: true },
        { id: 'reminder.active', domain: 'reminder', layer: 'runtime', title: '提醒事项', tasks: ['chat.reply', 'chat.background'], role: 'system', priority: 62, optional: true, navigation: { kind: 'reminder' } },
        { id: 'collection.relevant', domain: 'collection', layer: 'memory', title: '相关收藏', tasks: ['chat.reply', 'journal.generate'], role: 'system', priority: 63, optional: true, navigation: { kind: 'collection' } },
        { id: 'character.live_state', domain: 'character', layer: 'runtime', title: '角色实时状态', tasks: ['chat.reply', 'chat.background'], role: 'system', priority: 64, optional: true },
        { id: 'chat.history', domain: 'chat', layer: 'conversation', title: '聊天历史', tasks: ['chat.reply', 'chat.background', 'call.reply'], role: 'mixed', priority: 70, optional: false },
        { id: 'chat.current_input', domain: 'chat', layer: 'conversation', title: '本轮用户输入', tasks: ['chat.reply', 'call.reply'], role: 'user', priority: 71, optional: false },
        { id: 'chat.continuation', domain: 'chat', layer: 'control', title: '继续对话控制消息', tasks: ['chat.reply'], role: 'user', priority: 72, optional: true },
        { id: 'task.instruction', domain: 'task', layer: 'control', title: '任务指令', tasks: ['*'], role: 'user', priority: 80, optional: true },
        { id: 'cot.instructions', domain: 'prompt', layer: 'control', title: 'CoT与预填', tasks: ['chat.reply', 'chat.background'], role: 'mixed', priority: 85, optional: true },
        { id: 'output.chat_protocol', domain: 'prompt', layer: 'output', title: '聊天输出协议', tasks: ['chat.reply', 'chat.background', 'call.reply'], role: 'system', priority: 90, optional: false },
        { id: 'output.memory_protocol', domain: 'memory', layer: 'output', title: '动态记忆协议', tasks: ['chat.reply'], role: 'system', priority: 91, optional: true },
        { id: 'task.input', domain: 'task', layer: 'input', title: '任务输入', tasks: ['*'], role: 'user', priority: 92, optional: false },
        { id: 'media.image_input', domain: 'media', layer: 'input', title: '图片输入', tasks: ['vision.image.describe', 'vision.avatar.recognize', 'vision.sticker.recognize'], role: 'user', priority: 93, optional: false },
        { id: 'journal.source', domain: 'journal', layer: 'source', title: '日记来源内容', tasks: ['journal.generate', 'journal.merge'], role: 'user', priority: 94, optional: true },
        { id: 'theater.source', domain: 'theater', layer: 'source', title: '小剧场来源内容', tasks: ['theater.generate', 'theater.character.generate'], role: 'user', priority: 95, optional: true },
        { id: 'call.source', domain: 'call', layer: 'source', title: '通话上下文', tasks: ['call.reply', 'call.summary'], role: 'mixed', priority: 96, optional: true },
        { id: 'interaction.context', domain: 'interaction', layer: 'source', title: '互动上下文', tasks: ['interaction.battery', 'relationship.evaluate'], role: 'user', priority: 97, optional: true },
        { id: 'image.prompt', domain: 'image', layer: 'input', title: '生图提示词', tasks: ['image.generate.gpt', 'image.generate.novelai'], role: 'user', priority: 98, optional: false },
        { id: 'request.tools', domain: 'ai-request', layer: 'request', title: '模型工具定义', tasks: ['*'], role: 'request', priority: 100, optional: true },
        { id: 'request.parameters', domain: 'ai-request', layer: 'request', title: '模型请求参数', tasks: ['*'], role: 'request', priority: 101, optional: false },
        { id: 'provider.wrapper', domain: 'ai-request', layer: 'provider', title: 'Provider格式包装', tasks: ['*'], role: 'request', priority: 102, optional: false },
        { id: 'context.other', domain: 'other', layer: 'other', title: '其他已知上下文', tasks: ['*'], role: 'system', priority: 110, optional: true }
    ]);

    global.OVOContextSourceRegistry = Object.freeze({
        VERSION,
        TYPE_TO_SOURCE_ID,
        register,
        registerMany,
        get,
        has,
        list,
        buildShadowManifest,
        buildCompiledManifest,
        buildTaskManifest,
        getLastManifest
    });
})(window);
