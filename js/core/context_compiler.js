// QWQ V5.4.1 · unified final context compiler for private chat requests
(function (global) {
    'use strict';

    const VERSION = 'context-compiler.v1';
    const DEFAULT_POLICY = Object.freeze({
        worldBookEnabled: true,
        worldBookBudget: 2400,
        worldBookPriority: 20,
        structuredEnabled: true,
        structuredBudget: 1800,
        structuredPriority: 30,
        historyEnabled: true,
        historyCount: 30,
        statusEnabled: true
    });

    function clone(value) {
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    }

    function normalizePolicy(policy) {
        const source = Object.assign({}, DEFAULT_POLICY, policy || {});
        const bounded = (value, fallback, min, max) => {
            const number = Number(value);
            return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
        };
        return {
            worldBookEnabled: source.worldBookEnabled !== false,
            worldBookBudget: bounded(source.worldBookBudget, 2400, 0, 100000),
            worldBookPriority: bounded(source.worldBookPriority, 20, 1, 999),
            structuredEnabled: source.structuredEnabled !== false,
            structuredBudget: bounded(source.structuredBudget, 1800, 0, 100000),
            structuredPriority: bounded(source.structuredPriority, 30, 1, 999),
            historyEnabled: source.historyEnabled !== false,
            historyCount: bounded(source.historyCount, 30, 1, 500),
            statusEnabled: source.statusEnabled !== false
        };
    }

    function getPolicy() {
        return normalizePolicy(global.db?.magicRoom?.contextPolicy || {});
    }

    function contentToText(content) {
        if (content == null) return '';
        if (typeof content === 'string') return content;
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

    function readSystemPrompt(body, provider) {
        if (!body || typeof body !== 'object') return '';
        if (provider === 'gemini') {
            const instruction = body.system_instruction || body.systemInstruction;
            return contentToText(instruction?.parts || instruction?.content || instruction);
        }
        return (Array.isArray(body.messages) ? body.messages : [])
            .filter(message => message?.role === 'system')
            .map(message => contentToText(message?.content))
            .join('\n\n');
    }

    function writeSystemPrompt(body, provider, prompt) {
        const value = String(prompt || '');
        if (provider === 'gemini') {
            body.system_instruction = { parts: [{ text: value }] };
            if ('systemInstruction' in body) delete body.systemInstruction;
            return;
        }
        if (!Array.isArray(body.messages)) body.messages = [];
        const indexes = [];
        body.messages.forEach((message, index) => { if (message?.role === 'system') indexes.push(index); });
        if (!indexes.length) {
            body.messages.unshift({ role: 'system', content: value });
            return;
        }
        const first = indexes[0];
        body.messages[first] = Object.assign({}, body.messages[first], { role: 'system', content: value });
        for (let index = indexes.length - 1; index >= 1; index--) body.messages.splice(indexes[index], 1);
    }

    function replaceTagBlock(prompt, tagName, transform) {
        const safeTag = String(tagName || '').replace(/[^a-z0-9_-]/gi, '');
        if (!safeTag) return String(prompt || '');
        const pattern = new RegExp(`<${safeTag}\\b([^>]*)>([\\s\\S]*?)<\\/${safeTag}>`, 'gi');
        return String(prompt || '').replace(pattern, (whole, attrs, content) => {
            const next = transform(String(content || ''), whole);
            if (next == null || next === '') return '';
            return `<${safeTag}${attrs || ''}>${next}</${safeTag}>`;
        });
    }

    function clipText(value, budget) {
        const source = String(value || '');
        const limit = Math.max(0, Number(budget) || 0);
        if (!limit) return '';
        return source.length <= limit ? source : source.slice(0, limit);
    }

    function applyStructuredPolicy(prompt, policy, changes) {
        const source = String(prompt || '');
        if (!policy.structuredEnabled) {
            const next = replaceTagBlock(source, 'structured_archive_memory', () => '');
            if (next !== source) changes.push({ sourceId: 'memory.structured', action: 'excluded', reason: 'Proment 已关闭结构化记忆' });
            return next;
        }
        let clipped = false;
        const next = replaceTagBlock(source, 'structured_archive_memory', content => {
            const normalized = content.trim();
            const value = clipText(normalized, policy.structuredBudget);
            clipped = value.length < normalized.length;
            return value ? `\n${value}\n` : '';
        });
        if (clipped) changes.push({ sourceId: 'memory.structured', action: 'clipped', reason: `按 ${policy.structuredBudget} 字符预算裁剪` });
        return next;
    }

    function applyStatusPolicy(prompt, policy, changes) {
        if (policy.statusEnabled) return String(prompt || '');
        let value = String(prompt || '');
        const before = value;
        value = replaceTagBlock(value, 'memory_live_context', () => '');
        value = value
            .replace(/你的当前状态是[：:]\s*[^。\n]*。?/g, '')
            .replace(/(^|\n)\s*(?:角色状态|当前状态)[：:]\s*[^\n]*/g, '$1')
            .replace(/\n{3,}/g, '\n\n');
        if (value !== before) changes.push({ sourceId: 'character.live_state', action: 'excluded', reason: 'Proment 已关闭状态注入' });
        return value;
    }

    function isControlText(text) {
        const value = String(text || '').trim();
        if (!value) return false;
        return value === '[incipere]'
            || value.startsWith('<thinking>')
            || value === '[继续对话。]'
            || value.startsWith('[系统通知：')
            || value.startsWith('[用户正在查看对话框')
            || value.startsWith('[system:');
    }

    function trimConversationEntries(entries, policy) {
        const conversationIndexes = [];
        entries.forEach((entry, index) => {
            const role = entry?.role === 'model' ? 'assistant' : String(entry?.role || '');
            const text = contentToText(entry?.content ?? entry?.parts);
            if ((role === 'user' || role === 'assistant' || role === 'char') && !isControlText(text)) conversationIndexes.push(index);
        });
        let keepConversation = new Set();
        if (policy.historyEnabled) {
            conversationIndexes.slice(-policy.historyCount).forEach(index => keepConversation.add(index));
        } else {
            const lastUserIndex = [...conversationIndexes].reverse().find(index => {
                const role = entries[index]?.role === 'model' ? 'assistant' : String(entries[index]?.role || '');
                return role === 'user';
            });
            if (lastUserIndex !== undefined) keepConversation.add(lastUserIndex);
        }
        const removed = conversationIndexes.filter(index => !keepConversation.has(index)).length;
        const output = entries.filter((entry, index) => {
            const role = entry?.role === 'model' ? 'assistant' : String(entry?.role || '');
            const text = contentToText(entry?.content ?? entry?.parts);
            if (role === 'system' || isControlText(text)) return true;
            if (role === 'user' || role === 'assistant' || role === 'char') return keepConversation.has(index);
            return true;
        });
        return { output, removed, kept: keepConversation.size };
    }

    function applyHistoryPolicy(body, provider, policy, changes) {
        if (provider === 'gemini') {
            const source = Array.isArray(body.contents) ? body.contents : [];
            const result = trimConversationEntries(source, policy);
            body.contents = result.output;
            if (result.removed) changes.push({ sourceId: 'chat.history', action: 'trimmed', reason: policy.historyEnabled ? `仅保留最近 ${policy.historyCount} 条对话消息` : 'Proment 已关闭历史，仅保留本轮用户输入', removed: result.removed });
            return;
        }
        const source = Array.isArray(body.messages) ? body.messages : [];
        const result = trimConversationEntries(source, policy);
        body.messages = result.output;
        if (result.removed) changes.push({ sourceId: 'chat.history', action: 'trimmed', reason: policy.historyEnabled ? `仅保留最近 ${policy.historyCount} 条对话消息` : 'Proment 已关闭历史，仅保留本轮用户输入', removed: result.removed });
    }

    function compilePrivateChatRequest(options) {
        const body = options?.requestBody;
        if (!body || typeof body !== 'object') throw new TypeError('requestBody is required');
        const provider = String(options?.provider || '');
        const policy = normalizePolicy(options?.policy || getPolicy());
        const changes = [];
        let prompt = readSystemPrompt(body, provider);
        prompt = applyStructuredPolicy(prompt, policy, changes);
        prompt = applyStatusPolicy(prompt, policy, changes);
        prompt = global.OVORetiredFeaturePolicy?.sanitizeSystemPrompt?.(prompt) || prompt;
        writeSystemPrompt(body, provider, prompt);
        applyHistoryPolicy(body, provider, policy, changes);
        global.OVORetiredFeaturePolicy?.sanitizeRequestBody?.(body);
        const result = {
            protocol: VERSION,
            mode: 'compiled',
            requestBody: body,
            systemPrompt: readSystemPrompt(body, provider),
            policy,
            changes,
            compiledAt: new Date().toISOString()
        };
        global.__ovoLastContextCompile = clone({ protocol: result.protocol, mode: result.mode, policy, changes, compiledAt: result.compiledAt });
        try { sessionStorage.setItem('ovo_last_context_compile', JSON.stringify(global.__ovoLastContextCompile)); } catch (_) {}
        return result;
    }

    global.OVOContextCompiler = Object.freeze({
        VERSION,
        DEFAULT_POLICY,
        normalizePolicy,
        getPolicy,
        contentToText,
        readSystemPrompt,
        writeSystemPrompt,
        compilePrivateChatRequest
    });
})(window);
