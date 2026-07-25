// QWQ V5.4.2 · single application-facing gateway for all AI/model requests.
(function (global) {
    'use strict';

    const VERSION = 'ai-request-gateway.v1';
    const TASK_ALIASES = Object.freeze({
        'private-chat': 'chat.reply',
        'background-private-chat': 'chat.background',
        'image-description': 'vision.image.describe',
        'avatar-recognition': 'vision.avatar.recognize',
        'sticker-recognition': 'vision.sticker.recognize',
        'journal-generation': 'journal.generate',
        'journal-summary': 'journal.merge',
        'theater-generation': 'theater.generate',
        'theater-character-generation': 'theater.character.generate',
        'battery-interaction': 'interaction.battery',
        'block-system': 'relationship.evaluate',
        'legacy-video-call': 'call.reply',
        'legacy-call-summary': 'call.summary',
        'gpt-image-generation': 'image.generate.gpt',
        'novelai-image-generation': 'image.generate.novelai',
        'vector-embedding': 'memory.embedding'
    });

    let lastRequest = null;

    function clone(value) {
        try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
    }

    function canonicalTask(task) {
        const value = String(task || 'generic-ai');
        return TASK_ALIASES[value] || value;
    }

    function requireRuntime() {
        const runtime = global.OVOAIRequestRuntime;
        if (!runtime?.request) throw new Error('AI 请求运行时尚未加载，已阻止绕过统一网关的直接请求');
        return runtime;
    }

    function buildManifest(options, body, task) {
        if (options.contextManifest) return options.contextManifest;
        const registry = global.OVOContextSourceRegistry;
        if (!registry?.buildTaskManifest) return null;
        return registry.buildTaskManifest({
            task,
            provider: options.provider,
            model: options.model || body?.model || '',
            requestBody: body,
            promptSources: options.promptSources || [],
            scope: options.scope || {},
            source: options.source || ''
        });
    }

    async function send(options = {}) {
        const runtime = requireRuntime();
        const body = options.body && typeof options.body === 'object' ? options.body : (options.body || {});
        global.OVORetiredFeaturePolicy?.sanitizeRequestBody?.(body);
        const task = canonicalTask(options.task);
        const manifest = buildManifest(options, body, task);
        const requestOptions = Object.assign({}, options, {
            body,
            contextManifest: manifest,
            gatewayVersion: VERSION,
            canonicalTask: task
        });
        lastRequest = {
            task,
            source: String(options.source || ''),
            provider: String(options.provider || ''),
            model: String(options.model || body?.model || ''),
            manifest: clone(manifest),
            sentAt: new Date().toISOString()
        };
        global.__ovoLastAIRequestGateway = clone(lastRequest);
        try { sessionStorage.setItem('ovo_last_ai_request_gateway', JSON.stringify(lastRequest)); } catch (_) {}
        return runtime.request(requestOptions);
    }

    function getLastRequest() {
        return clone(lastRequest || global.__ovoLastAIRequestGateway || null);
    }

    global.OVOAIRequestGateway = Object.freeze({
        VERSION,
        TASK_ALIASES,
        canonicalTask,
        send,
        getLastRequest
    });
})(window);
