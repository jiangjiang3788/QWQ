(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    let lastRoute = null;

    function resolveConfig(preferSummaryApi = true) {
        const database = global.db || {};
        const summaryReady = database.summaryApiSettings && database.summaryApiSettings.url && database.summaryApiSettings.key && database.summaryApiSettings.model;
        const mainReady = database.apiSettings && database.apiSettings.url && database.apiSettings.key && database.apiSettings.model;
        let apiConfig = null;
        let actualMode = 'main';
        let fallback = false;
        if (preferSummaryApi && summaryReady) {
            apiConfig = database.summaryApiSettings;
            actualMode = 'summary';
        } else if (mainReady) {
            apiConfig = database.apiSettings;
            fallback = !!preferSummaryApi;
        }
        if (!apiConfig) throw new Error(preferSummaryApi ? '请先配置总结 API 或主聊天 API' : '请先配置主聊天 API');
        return {
            apiConfig,
            requestedMode: preferSummaryApi ? 'summary' : 'main',
            actualMode,
            fallback,
            provider: apiConfig.provider || 'newapi',
            model: apiConfig.model || ''
        };
    }

    async function requestContent(prompt, temperature = 0.2, preferSummaryApi = true, task = 'memory-table-summary', options = {}) {
        const route = resolveConfig(preferSummaryApi);
        const apiConfig = route.apiConfig;
        lastRoute = { ...route, apiConfig: undefined, requestedAt: Date.now(), task };
        let { url, key, model } = apiConfig;
        if (url.endsWith('/')) url = url.slice(0, -1);
        const provider = apiConfig.provider || 'newapi';
        const randomKey = typeof global.getRandomValue === 'function' ? global.getRandomValue(key) : key;
        const endpoint = provider === 'gemini'
            ? `${url}/v1beta/models/${model}:generateContent?key=${randomKey}`
            : `${url}/v1/chat/completions`;
        const headers = provider === 'gemini'
            ? { 'Content-Type': 'application/json' }
            : { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
        const requestBody = provider === 'gemini'
            ? { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature } }
            : { model, temperature, messages: [{ role: 'user', content: prompt }] };
        if (typeof global.fetchAiResponse !== 'function') throw new Error('AI 请求适配器未加载');
        return global.fetchAiResponse({ ...apiConfig, runtimeTask: task, runtimeSource: 'memory-table', runtimeOperationId: options.operationId || null, runtimePromptSources: options.promptSources || [] }, requestBody, headers, endpoint);
    }

    const api = {
        VERSION: '2.9-R1',
        resolveConfig,
        getConfig(preferSummaryApi = true) { return resolveConfig(preferSummaryApi).apiConfig; },
        requestContent,
        requestSummary(prompt, temperature = 0.2) { return requestContent(prompt, temperature, true, 'memory-table-summary'); },
        getLastRoute() { return lastRoute ? { ...lastRoute } : null; },
        clearLastRoute() { lastRoute = null; }
    };

    if (Kernel) Kernel.register('api', api);
    else global.MemoryTableApi = api;
})(window);
