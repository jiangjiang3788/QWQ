// Unified API service registry: configuration routing, endpoint normalization and embedding transport.
(function (global) {
    'use strict';

    const VERSION = '2.13-R0';
    const ROLE_DEFINITIONS = Object.freeze({
        chat: Object.freeze({ dbKey: 'apiSettings', capability: 'chat', fallback: [] }),
        summary: Object.freeze({ dbKey: 'summaryApiSettings', capability: 'chat', fallback: ['chat'] }),
        vector: Object.freeze({ dbKey: 'vectorApiSettings', capability: 'embedding', fallback: [] }),
        background: Object.freeze({ dbKey: 'backgroundApiSettings', capability: 'chat', fallback: ['chat'] }),
        persona: Object.freeze({ dbKey: 'supplementPersonaApiSettings', capability: 'chat', fallback: ['chat'] }),
        vision: Object.freeze({ dbKey: 'imageRecognitionApiSettings', capability: 'vision', fallback: ['chat'] }),
        stickerVision: Object.freeze({ dbKey: 'stickerRecognitionApiSettings', capability: 'vision', fallback: ['vision', 'chat'] })
    });

    const EMBEDDING_MODEL_PATTERN = /(embed|embedding|bge|e5(?:-|_|$)|gte|m3e|jina|nomic|instructor|text2vec|multilingual-e5)/i;

    function database() {
        return global.db || {};
    }

    function definition(role) {
        return ROLE_DEFINITIONS[role] || null;
    }

    function clean(value) {
        return String(value == null ? '' : value).trim();
    }

    function normalizeBaseUrl(value) {
        return clean(value).replace(/\/+$/, '');
    }

    function isReadyConfig(config) {
        return !!(config && clean(config.url) && clean(config.key) && clean(config.model));
    }

    function isUsableConfig(role, config) {
        if (!isReadyConfig(config)) return false;
        if (role === 'vector') {
            return config.enabled === true
                && config.health === 'ready'
                && Number(config.verifiedDimension) > 0;
        }
        return true;
    }

    function isReady(role) {
        const item = definition(role);
        return !!(item && isUsableConfig(role, database()[item.dbKey]));
    }

    function protocolFor(config) {
        if (clean(config?.protocol)) return clean(config.protocol).toLowerCase();
        return clean(config?.provider).toLowerCase() === 'gemini' ? 'gemini' : 'openai-compatible';
    }

    function randomKey(key) {
        return typeof global.getRandomValue === 'function' ? global.getRandomValue(key) : key;
    }

    function openAiEndpoint(baseUrl, suffix) {
        const base = normalizeBaseUrl(baseUrl);
        if (!base) return '';
        const normalizedSuffix = clean(suffix).replace(/^\/+/, '');
        if (/\/v1$/i.test(base)) return `${base}/${normalizedSuffix}`;
        if (/\/v1\/(?:models|embeddings|chat\/completions)$/i.test(base)) {
            return base.replace(/\/v1\/(?:models|embeddings|chat\/completions)$/i, `/v1/${normalizedSuffix}`);
        }
        return `${base}/v1/${normalizedSuffix}`;
    }

    function endpointFor(config, kind) {
        const protocol = protocolFor(config);
        const base = normalizeBaseUrl(config?.url);
        if (!base) return '';
        if (kind === 'models' && clean(config?.modelsEndpoint)) return clean(config.modelsEndpoint);
        if (kind === 'embedding' && clean(config?.embeddingEndpoint)) return clean(config.embeddingEndpoint);
        if (kind === 'chat' && clean(config?.chatEndpoint)) return clean(config.chatEndpoint);
        if (protocol === 'gemini') {
            const key = encodeURIComponent(randomKey(config.key));
            const root = base.replace(/\/v1beta(?:\/models(?:\/[^/?#]+(?::(?:embedContent|generateContent))?)?)?$/i, '');
            if (kind === 'models') return `${root}/v1beta/models?key=${key}`;
            if (kind === 'embedding') return `${root}/v1beta/models/${encodeURIComponent(config.model)}:embedContent?key=${key}`;
            return `${root}/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${key}`;
        }
        if (kind === 'models') return openAiEndpoint(base, 'models');
        if (kind === 'embedding') return openAiEndpoint(base, 'embeddings');
        return openAiEndpoint(base, 'chat/completions');
    }

    function resolve(role, options = {}) {
        const requested = definition(role);
        if (!requested) throw new Error(`未知 API 角色：${role}`);
        const allowFallback = options.allowFallback !== false;
        const seen = new Set();
        const queue = [role];
        while (queue.length) {
            const currentRole = queue.shift();
            if (seen.has(currentRole)) continue;
            seen.add(currentRole);
            const current = definition(currentRole);
            if (!current) continue;
            const config = database()[current.dbKey];
            if (isUsableConfig(currentRole, config)) {
                return {
                    requestedRole: role,
                    actualRole: currentRole,
                    fallback: currentRole !== role,
                    capability: current.capability,
                    dbKey: current.dbKey,
                    config
                };
            }
            if (allowFallback) queue.push(...current.fallback);
        }
        return null;
    }

    function requireRole(role, options = {}) {
        const route = resolve(role, options);
        if (route) return route;
        if (role === 'vector') {
            throw new Error('未配置可用的向量 Embedding API。向量接口不能回退到聊天或总结模型。');
        }
        throw new Error(`请先配置${role === 'chat' ? '主聊天' : role} API`);
    }

    function looksLikeEmbeddingModel(model) {
        return EMBEDDING_MODEL_PATTERN.test(clean(model));
    }

    function sortModels(models, capability) {
        const unique = Array.from(new Set((models || []).map(clean).filter(Boolean)));
        if (capability !== 'embedding') return unique.sort((a, b) => a.localeCompare(b));
        return unique.sort((a, b) => {
            const aEmbedding = looksLikeEmbeddingModel(a) ? 1 : 0;
            const bEmbedding = looksLikeEmbeddingModel(b) ? 1 : 0;
            if (aEmbedding !== bEmbedding) return bEmbedding - aEmbedding;
            return a.localeCompare(b);
        });
    }

    async function requestResponse(options) {
        if (global.OVOAIRequestRuntime) {
            return global.OVOAIRequestRuntime.request(options);
        }
        const fetchOptions = {
            method: options.method || 'POST',
            headers: options.headers || {}
        };
        if (options.body !== undefined && fetchOptions.method !== 'GET' && fetchOptions.method !== 'HEAD') {
            fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        }
        const response = await fetch(options.endpoint, fetchOptions);
        if (!response.ok) {
            let detail = '';
            try { detail = await response.text(); } catch (_) {}
            throw new Error(`API Error: ${response.status}${detail ? ` ${detail.slice(0, 500)}` : ''}`);
        }
        return response;
    }

    async function fetchModels(role, draftConfig) {
        const item = definition(role);
        const config = draftConfig || (item ? database()[item.dbKey] : null);
        if (!config || !clean(config.url) || !clean(config.key)) {
            throw new Error('请先填写 API 地址和密钥');
        }
        const endpoint = endpointFor(config, 'models');
        const protocol = protocolFor(config);
        const headers = protocol === 'gemini' ? {} : { Authorization: `Bearer ${config.key}` };
        const response = await requestResponse({
            task: role === 'vector' ? 'vector-model-list' : 'api-model-list',
            operationType: role === 'vector' ? 'memory.vector.models' : 'settings.api.models',
            operationStage: '正在拉取模型列表',
            source: 'api-service-registry',
            provider: config.provider || protocol,
            model: config.model || '',
            endpoint,
            method: 'GET',
            headers
        });
        const data = await response.json();
        let models = [];
        if (protocol === 'gemini') {
            models = Array.isArray(data.models)
                ? data.models.map(item => clean(item?.name).replace(/^models\//, '')).filter(Boolean)
                : [];
        } else if (Array.isArray(data.data)) {
            models = data.data.map(item => clean(item?.id || item?.name)).filter(Boolean);
        } else if (Array.isArray(data.models)) {
            models = data.models.map(item => clean(item?.id || item?.name || item)).filter(Boolean);
        }
        const capability = item?.capability || 'chat';
        const sorted = sortModels(models, capability);
        return {
            models: sorted,
            embeddingCandidates: capability === 'embedding' ? sorted.filter(looksLikeEmbeddingModel) : [],
            endpoint,
            protocol
        };
    }

    function numericVector(value) {
        if (!Array.isArray(value) || !value.length) return null;
        const vector = value.map(Number);
        if (vector.some(number => !Number.isFinite(number))) return null;
        return vector;
    }

    function validateVectors(vectors, expectedCount) {
        if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
            throw new Error(`Embedding 返回数量异常：期望 ${expectedCount} 条，实际 ${Array.isArray(vectors) ? vectors.length : 0} 条`);
        }
        const normalized = vectors.map(numericVector);
        if (normalized.some(item => !item)) throw new Error('Embedding 返回内容不是有效数值向量');
        const dimensions = normalized[0].length;
        if (!dimensions || normalized.some(item => item.length !== dimensions)) {
            throw new Error('Embedding 返回向量维度不一致');
        }
        return { vectors: normalized, dimensions };
    }

    function parseOpenAiEmbeddings(data, expectedCount) {
        const rows = Array.isArray(data?.data) ? data.data.slice() : [];
        rows.sort((a, b) => (Number(a?.index) || 0) - (Number(b?.index) || 0));
        const vectors = rows.map(item => item?.embedding);
        return validateVectors(vectors, expectedCount);
    }

    async function fetchEmbeddingBatch(config, texts, options = {}) {
        const protocol = protocolFor(config);
        if (protocol === 'gemini') {
            const vectors = [];
            for (const text of texts) {
                const endpoint = endpointFor(config, 'embedding');
                const body = { content: { parts: [{ text }] } };
                const response = await requestResponse({
                    task: options.task || 'vector-embedding',
                    operationType: options.operationType || 'memory.vector.embedding',
                    operationStage: options.operationStage || '正在生成向量索引',
                    source: options.source || 'api-service-registry-gemini',
                    provider: config.provider || 'gemini',
                    model: config.model,
                    endpoint,
                    headers: { 'Content-Type': 'application/json' },
                    body
                });
                const data = await response.json();
                vectors.push(data?.embedding?.values);
            }
            return validateVectors(vectors, texts.length);
        }

        const endpoint = endpointFor(config, 'embedding');
        const body = {
            model: config.model,
            input: texts.length === 1 ? texts[0] : texts
        };
        if (Number.isFinite(parseInt(config.dimensions, 10))) body.dimensions = parseInt(config.dimensions, 10);
        const response = await requestResponse({
            task: options.task || 'vector-embedding',
            operationType: options.operationType || 'memory.vector.embedding',
            operationStage: options.operationStage || '正在生成向量索引',
            source: options.source || 'api-service-registry-openai-compatible',
            provider: config.provider || 'newapi',
            model: config.model,
            endpoint,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config.key}`
            },
            body
        });
        const data = await response.json();
        return parseOpenAiEmbeddings(data, texts.length);
    }

    async function embed(texts, options = {}) {
        const route = options.config
            ? { config: options.config, actualRole: 'vector', requestedRole: 'vector', fallback: false }
            : requireRole('vector', { allowFallback: false });
        const list = (Array.isArray(texts) ? texts : [texts]).map(clean).filter(Boolean);
        if (!list.length) return [];
        const batchSize = Math.max(1, Math.min(128, parseInt(route.config.batchSize, 10) || 8));
        const output = [];
        let dimensions = 0;
        for (let index = 0; index < list.length; index += batchSize) {
            const result = await fetchEmbeddingBatch(route.config, list.slice(index, index + batchSize), options);
            if (dimensions && result.dimensions !== dimensions) throw new Error('不同批次的向量维度不一致');
            dimensions = result.dimensions;
            output.push(...result.vectors);
        }
        return output;
    }

    async function testEmbedding(config) {
        if (!isReadyConfig(config)) throw new Error('请完整填写向量 API 地址、密钥和模型');
        const started = Date.now();
        const vectors = await embed(['向量接口连通性测试'], {
            config,
            task: 'vector-embedding-test',
            operationType: 'settings.vector.test',
            operationStage: '正在验证向量接口',
            source: 'api-settings-vector-test'
        });
        const dimension = Array.isArray(vectors[0]) ? vectors[0].length : 0;
        if (!dimension) throw new Error('接口返回成功，但没有得到有效向量');
        return {
            ok: true,
            dimension,
            latencyMs: Date.now() - started,
            protocol: protocolFor(config),
            endpoint: endpointFor(config, 'embedding'),
            model: config.model
        };
    }

    function health(role) {
        const item = definition(role);
        const config = item ? database()[item.dbKey] : null;
        if (!isReadyConfig(config)) return { state: 'missing', label: '未配置' };
        if (role !== 'vector') return { state: 'ready', label: '已配置' };
        if (config.health === 'ready' && Number(config.verifiedDimension) > 0) {
            return { state: 'ready', label: `已验证 · ${config.verifiedDimension} 维`, dimension: Number(config.verifiedDimension), verifiedAt: config.verifiedAt || null };
        }
        if (config.health === 'error') return { state: 'error', label: '验证失败', error: config.lastError || '' };
        return { state: 'unverified', label: '待验证' };
    }

    global.OVOApiServiceRegistry = Object.freeze({
        VERSION,
        roles: ROLE_DEFINITIONS,
        definition,
        isReadyConfig,
        isUsableConfig,
        isReady,
        protocolFor,
        normalizeBaseUrl,
        endpointFor,
        resolve,
        require: requireRole,
        fetchModels,
        looksLikeEmbeddingModel,
        sortModels,
        embed,
        testEmbedding,
        health,
        validateVectors
    });
})(window);
