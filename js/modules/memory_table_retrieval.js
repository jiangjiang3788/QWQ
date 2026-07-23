// 结构化记忆 V2.2：混合检索、向量索引与 Prompt 注入诊断
(function () {
    'use strict';

    const Kernel = window.OvoMemoryKernel || null;
    const Core = Kernel?.core;
    if (!Core) throw new Error('记忆内核未加载');
    const escapeHtml = Core.escapeHtml;
    const clamp = Core.clamp;
    const hashText = Core.hashFingerprint;

    const RETRIEVAL_VERSION = '2.7';

    function hasExplicitVectorApi() {
        const config = window.db && db.vectorApiSettings;
        return !!(config && config.url && config.key && config.model);
    }

    function getVectorApiConfig() {
        const config = window.db && db.vectorApiSettings;
        if (!config || !config.url || !config.key || !config.model) {
            throw new Error('未配置向量 API，已回退关键词检索');
        }
        return config;
    }

    async function fetchEmbeddingBatch(texts) {
        const apiConfig = getVectorApiConfig();
        let { url, key, model } = apiConfig;
        const provider = apiConfig.provider || 'newapi';
        url = String(url || '').replace(/\/$/, '');
        if (provider === 'gemini') {
            const outputs = [];
            for (const text of texts) {
                const randomKey = typeof getRandomValue === 'function' ? getRandomValue(key) : key;
                const endpoint = `${url}/v1beta/models/${model}:embedContent?key=${randomKey}`;
                const body = { content: { parts: [{ text }] } };
                const response = window.OVOAIRequestRuntime
                    ? await window.OVOAIRequestRuntime.request({
                        task: 'memory-table-embedding', operationType: 'memory.embedding', operationStage: '正在生成档案检索向量', source: 'memory-table-retrieval-gemini', provider, model,
                        endpoint, headers: { 'Content-Type': 'application/json' }, body
                    })
                    : await fetch(endpoint, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
                    });
                if (!window.OVOAIRequestRuntime && !response.ok) {
                    throw new Error(`Embedding API Error: ${response.status} ${await response.text()}`);
                }
                const data = await response.json();
                outputs.push(data.embedding?.values || []);
            }
            return outputs;
        }

        const endpoint = `${url}/v1/embeddings`;
        const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
        const body = { model, input: texts.length === 1 ? texts[0] : texts };
        if (Number.isFinite(parseInt(apiConfig.dimensions, 10))) body.dimensions = parseInt(apiConfig.dimensions, 10);
        const response = window.OVOAIRequestRuntime
            ? await window.OVOAIRequestRuntime.request({
                task: 'memory-table-embedding', operationType: 'memory.embedding', operationStage: '正在生成档案检索向量', source: 'memory-table-retrieval-openai-compatible', provider, model,
                endpoint, headers, body
            })
            : await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!window.OVOAIRequestRuntime && !response.ok) {
            throw new Error(`Embedding API Error: ${response.status} ${await response.text()}`);
        }
        const data = await response.json();
        return (Array.isArray(data.data) ? data.data : []).map(item => item.embedding || []);
    }

    async function fetchEmbeddings(texts) {
        const list = (Array.isArray(texts) ? texts : [texts]).map(item => String(item || '').trim()).filter(Boolean);
        if (!list.length) return [];
        const batchSize = Math.max(1, parseInt((db.vectorApiSettings && db.vectorApiSettings.batchSize) || 8, 10) || 8);
        const outputs = [];
        for (let index = 0; index < list.length; index += batchSize) {
            outputs.push(...await fetchEmbeddingBatch(list.slice(index, index + batchSize)));
        }
        return outputs;
    }

    function cosineSimilarity(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let index = 0; index < a.length; index += 1) {
            const av = Number(a[index]) || 0;
            const bv = Number(b[index]) || 0;
            dot += av * bv;
            normA += av * av;
            normB += bv * bv;
        }
        if (!normA || !normB) return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    function resolveMode(engineSettings) {
        const requested = ['keyword', 'hybrid', 'auto'].includes(engineSettings?.retrievalMode)
            ? engineSettings.retrievalMode
            : 'auto';
        if (requested === 'keyword') return { requested, actual: 'keyword', reason: '用户选择关键词检索' };
        if (!hasExplicitVectorApi()) return { requested, actual: 'keyword', reason: '未配置向量 API，自动回退关键词检索' };
        return { requested, actual: 'hybrid', reason: requested === 'auto' ? '检测到向量 API，启用混合检索' : '用户选择混合检索' };
    }

    function lexicalCandidates(items, queryText, policy, limit) {
        const memoryPolicy = window.MemoryTablePolicy;
        if (!memoryPolicy) return (items || []).slice(0, limit).map(item => ({ ...item, _score: 0 }));
        return memoryPolicy.selectRelevantItems(items || [], queryText, {
            ...policy,
            threshold: 0,
            topK: Math.max(1, limit)
        });
    }

    function buildReasons(item, lexical, semantic, actualMode, effectEval) {
        const reasons = [];
        if (item.pinned) reasons.push('固定记忆');
        if (semantic >= 0.72) reasons.push('语义高度相关');
        else if (actualMode === 'hybrid' && semantic >= 0.5) reasons.push('语义相关');
        if (lexical >= 0.28) reasons.push('关键词命中');
        else if (lexical >= 0.12) reasons.push('文本片段相关');
        (effectEval?.tagReasons || []).forEach(reason => reasons.push(reason));
        if (item.active) reasons.push('当前有效');
        if ((Number(item.importance) || 0) >= 75) reasons.push('重要度较高');
        const updatedAt = Number(item.updatedAt) || 0;
        if (updatedAt && Date.now() - updatedAt < 14 * 86400000) reasons.push('近期记录');
        return reasons.length ? reasons : ['综合评分入选'];
    }

    async function prepareGroups(chat, groups, queryText, engineSettings, options = {}) {
        const mode = resolveMode(engineSettings || {});
        const effects = window.MemoryTableEffects || null;
        const feedback = window.MemoryTableFeedback || null;
        const queryContext = effects ? effects.classifyQuery(queryText) : { text: queryText, topic: [], scene: [], entity: [] };
        const semanticWeight = clamp(engineSettings?.semanticWeight, 0.55, 0, 1);
        const tagWeight = clamp(engineSettings?.tagWeight, 0.35, 0, 0.8);
        const candidateLimit = Math.round(clamp(engineSettings?.embeddingCandidateLimit, 32, 4, 200));
        const selectedByTable = {};
        const diagnostics = [];
        let dirty = false;
        let fallbackError = '';

        const prepared = (groups || []).map(group => {
            const topK = Math.max(1, Number(group.policy?.topK) || 5);
            const localLimit = Math.max(topK * 5, Math.min(candidateLimit, 28));
            const lexical = lexicalCandidates(group.items, queryText, group.policy, localLimit);
            const byId = new Map();
            const blockedCounts = new Map();
            const evalById = new Map();
            const feedbackEvalById = new Map();
            (group.items || []).forEach(item => {
                const evalResult = effects ? effects.evaluateItem(chat, item, queryContext) : null;
                const feedbackResult = feedback ? feedback.evaluateItem(chat, item, queryContext) : null;
                if (evalResult?.lifecycleEval?.changed) dirty = true;
                evalById.set(item.id, evalResult);
                feedbackEvalById.set(item.id, feedbackResult);
                if (engineSettings?.sideEffectGuardEnabled !== false && evalResult && !evalResult.allowed) {
                    (evalResult.blockedReasons || []).forEach(reason => blockedCounts.set(reason, (blockedCounts.get(reason) || 0) + 1));
                }
                if (feedbackResult && !feedbackResult.allowed) {
                    (feedbackResult.blockedReasons || []).forEach(reason => blockedCounts.set(reason, (blockedCounts.get(reason) || 0) + 1));
                }
            });
            const addCandidate = (item, effectEval, feedbackEval) => {
                if (!item) return;
                if (engineSettings?.sideEffectGuardEnabled !== false && effectEval && !effectEval.allowed) return;
                if (feedbackEval && !feedbackEval.allowed) return;
                const current = byId.get(item.id);
                const candidate = { ...item, _effectEval: effectEval || null, _feedbackEval: feedbackEval || null };
                if (!current || Number(candidate._score || 0) > Number(current._score || 0)) byId.set(item.id, candidate);
            };
            lexical.forEach(item => addCandidate(item, evalById.get(item.id) || null, feedbackEvalById.get(item.id) || null));
            if (effects && engineSettings?.sceneRoutingEnabled !== false) {
                (group.items || []).forEach(item => {
                    const evalResult = evalById.get(item.id) || effects.evaluateItem(chat, item, queryContext);
                    if (!evalResult.allowed || evalResult.tagScore <= 0) return;
                    addCandidate({ ...item, _score: Math.max(Number(item._score) || 0, evalResult.tagScore) }, evalResult, feedbackEvalById.get(item.id) || null);
                });
            }
            const candidates = Array.from(byId.values())
                .sort((a, b) => {
                    const at = Number(a._effectEval?.tagScore) || 0;
                    const bt = Number(b._effectEval?.tagScore) || 0;
                    if (bt !== at) return bt - at;
                    return (Number(b._score) || 0) - (Number(a._score) || 0);
                })
                .slice(0, localLimit);
            return { ...group, topK, candidates, blockedCounts: Array.from(blockedCounts.entries()).map(([reason, count]) => ({ reason, count })) };
        });

        let queryVector = [];
        if (mode.actual === 'hybrid' && queryText.trim()) {
            try {
                queryVector = (await fetchEmbeddings([queryText]))[0] || [];
                const allCandidates = prepared.flatMap(group => group.candidates.map(item => ({ group, item })))
                    .sort((a, b) => (b.item._score || 0) - (a.item._score || 0))
                    .slice(0, candidateLimit);
                const missing = allCandidates.filter(({ item }) => {
                    const fingerprint = hashText(item.searchText || item.text || '');
                    return !Array.isArray(item.row?.meta?.retrievalVector)
                        || !item.row.meta.retrievalVector.length
                        || item.row.meta.retrievalVectorFingerprint !== fingerprint;
                });
                if (missing.length) {
                    const vectors = await fetchEmbeddings(missing.map(({ item }) => item.searchText || item.text || ''));
                    missing.forEach(({ item }, index) => {
                        item.row.meta ||= {};
                        item.row.meta.retrievalVector = Array.isArray(vectors[index]) ? vectors[index] : [];
                        item.row.meta.retrievalVectorFingerprint = hashText(item.searchText || item.text || '');
                        item.row.meta.retrievalIndexedAt = Date.now();
                        dirty = true;
                    });
                }
            } catch (error) {
                fallbackError = error?.message || String(error);
                mode.actual = 'keyword';
                mode.reason = `向量检索失败，回退关键词：${fallbackError}`;
                queryVector = [];
            }
        }

        prepared.forEach(group => {
            const scored = group.candidates.map(item => {
                const effectEval = item._effectEval || (effects ? effects.evaluateItem(chat, item, queryContext) : null);
                const feedbackEval = item._feedbackEval || (feedback ? feedback.evaluateItem(chat, item, queryContext) : null);
                if (engineSettings?.sideEffectGuardEnabled !== false && effectEval && !effectEval.allowed) return null;
                if (feedbackEval && !feedbackEval.allowed) return null;
                const lexical = Math.max(0, Math.min(1, Number(item._score) || 0));
                const semanticRaw = mode.actual === 'hybrid'
                    ? cosineSimilarity(queryVector, item.row?.meta?.retrievalVector || [])
                    : 0;
                const semantic = Math.max(0, Math.min(1, semanticRaw));
                const similarity = mode.actual === 'hybrid'
                    ? semantic * semanticWeight + lexical * (1 - semanticWeight)
                    : lexical;
                const tagScore = engineSettings?.sceneRoutingEnabled === false ? 0 : Math.max(0, Math.min(1, Number(effectEval?.tagScore) || 0));
                let score = similarity * (1 - tagWeight) + tagScore * tagWeight;
                const effectiveConfidence = Number(effectEval?.lifecycleEval?.effectiveConfidence);
                if (Number.isFinite(effectiveConfidence)) score *= 0.45 + (Math.max(0, Math.min(100, effectiveConfidence)) / 100) * 0.55;
                if (item.pinned) score += 0.18;
                score += Number(feedbackEval?.adjustment) || 0;
                score = Math.max(0, Math.min(1.5, score));
                return {
                    ...item,
                    _score: score,
                    _lexicalScore: lexical,
                    _semanticScore: semantic,
                    _tagScore: tagScore,
                    _effectEval: effectEval,
                    _feedbackEval: feedbackEval,
                    _reasons: [
                        ...buildReasons(item, lexical, semantic, mode.actual, engineSettings?.sceneRoutingEnabled === false ? null : effectEval),
                        ...(feedbackEval?.reasons || [])
                    ]
                };
            }).filter(Boolean)
                .filter(item => item.pinned || item._score >= Number(group.policy?.threshold || 0))
                .sort((a, b) => {
                    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
                    if (b._score !== a._score) return b._score - a._score;
                    return (b.updatedAt || 0) - (a.updatedAt || 0);
                })
                .slice(0, group.topK);

            if (!options.dryRun) scored.forEach(item => effects?.markRetrieved(item));
            selectedByTable[group.key] = scored.map(item => ({
                id: item.id,
                score: item._score,
                lexicalScore: item._lexicalScore,
                semanticScore: item._semanticScore,
                tagScore: item._tagScore,
                feedbackAdjustment: Number(item._feedbackEval?.adjustment) || 0,
                reasons: item._reasons,
                effectMode: item._effectEval?.effectMode || '',
                tags: item._effectEval?.tags || null,
                usePolicy: item._effectEval?.usePolicy || null,
                directive: effects ? effects.getPromptDirective(item._effectEval?.effectMode, item._effectEval?.usePolicy, item.row, item.table) : ''
            }));
            diagnostics.push({
                key: group.key,
                templateName: group.templateName,
                tableName: group.tableName,
                mode: group.policy?.mode || 'relevant',
                candidateCount: group.items?.length || 0,
                blocked: group.blockedCounts || [],
                selected: scored.map(item => ({
                    id: item.id,
                    score: item._score,
                    lexicalScore: item._lexicalScore,
                    semanticScore: item._semanticScore,
                    tagScore: item._tagScore,
                    feedbackAdjustment: Number(item._feedbackEval?.adjustment) || 0,
                    reasons: item._reasons,
                    tags: item._effectEval?.tags || null,
                    effectMode: item._effectEval?.effectMode || '',
                    directive: effects ? effects.getPromptDirective(item._effectEval?.effectMode, item._effectEval?.usePolicy, item.row, item.table) : '',
                    text: String(item.searchText || item.text || '').slice(0, 500)
                }))
            });
        });

        return {
            selectedByTable,
            dirty,
            diagnostic: {
                version: RETRIEVAL_VERSION,
                preparedAt: Date.now(),
                queryText,
                queryContext,
                requestedMode: mode.requested,
                actualMode: mode.actual,
                modeReason: mode.reason,
                semanticWeight,
                tagWeight,
                candidateLimit,
                sceneRoutingEnabled: engineSettings?.sceneRoutingEnabled !== false,
                sideEffectGuardEnabled: engineSettings?.sideEffectGuardEnabled !== false,
                vectorApiConfigured: hasExplicitVectorApi(),
                fallbackError,
                tables: diagnostics,
                finalBlock: '',
                finalChars: 0
            }
        };
    }

    function findMostSimilar(items, text, threshold) {
        const memoryPolicy = window.MemoryTablePolicy;
        if (!memoryPolicy || !String(text || '').trim()) return null;
        let best = null;
        (items || []).forEach(item => {
            const score = memoryPolicy.computeLexicalScore(item.searchText || item.text || '', text);
            if (!best || score > best.score) best = { item, score };
        });
        return best && best.score >= (Number(threshold) || 0.34) ? best : null;
    }

    function renderDiagnostics(chat) {
        const runtime = window.MemoryTablePolicy ? MemoryTablePolicy.ensureRuntimeState(chat) : null;
        const diagnostic = runtime?.lastRetrievalDiagnostic;
        if (!diagnostic) {
            return `<div class="memory-retrieval-empty"><h3>还没有检索快照</h3><p>发送一次聊天，或点击“重建并预览”，这里会显示实际查询、命中条目、召回原因和最终注入文本。</p><button class="btn btn-primary" data-action="retrieval-rebuild">重建并预览</button></div>`;
        }
        const modeLabel = diagnostic.actualMode === 'hybrid' ? '混合检索' : '关键词检索';
        return `<div class="memory-retrieval-page">
            <div class="memory-retrieval-head">
                <div><h2>检索与 Prompt 注入诊断</h2><p>这是最近一次结构化记忆在聊天发送前的真实召回快照。</p></div>
                <div class="memory-retrieval-actions"><button class="btn btn-small btn-primary" data-action="retrieval-rebuild">重建并预览</button><button class="btn btn-small btn-secondary" data-action="retrieval-clear-index">清除向量索引</button><button class="btn btn-small btn-neutral" data-action="retrieval-clear-diagnostic">清除快照</button></div>
            </div>
            <div class="memory-retrieval-summary">
                <div><b>实际模式</b><span>${escapeHtml(modeLabel)}</span></div>
                <div><b>向量 API</b><span>${diagnostic.vectorApiConfigured ? '已配置' : '未配置'}</span></div>
                <div><b>语义 / 标签</b><span>${Number(diagnostic.semanticWeight || 0).toFixed(2)} / ${Number(diagnostic.tagWeight || 0).toFixed(2)}</span></div>
                <div><b>最终注入</b><span>${diagnostic.finalChars || 0} 字符</span></div>
            </div>
            <div class="memory-retrieval-note">${escapeHtml(diagnostic.modeReason || '')}</div>
            <details open class="memory-retrieval-query"><summary>本次检索线索与场景标签</summary><pre>${escapeHtml(diagnostic.queryText || '（空）')}

主题：${escapeHtml((diagnostic.queryContext?.topic || []).join('、') || '未识别')}
场景：${escapeHtml((diagnostic.queryContext?.scene || []).join('、') || '日常聊天')}
实体：${escapeHtml((diagnostic.queryContext?.entity || []).join('、') || '未识别')}</pre></details>
            <div class="memory-retrieval-tables">${(diagnostic.tables || []).map(table => `
                <section class="memory-retrieval-table">
                    <div class="memory-retrieval-table-head"><div><h3>${escapeHtml(table.tableName || '')}</h3><span>${escapeHtml(table.templateName || '')} · 候选 ${table.candidateCount || 0} · 命中 ${(table.selected || []).length} · 过滤 ${(table.blocked || []).reduce((sum,item)=>sum+(item.count||0),0)}</span></div></div>
                    ${(table.blocked || []).length ? `<div class="memory-effect-filtered">已过滤：${table.blocked.map(item=>`${escapeHtml(item.reason)} × ${item.count}`).join('；')}</div>` : ''}${(table.selected || []).length ? table.selected.map((item, index) => `<article class="memory-retrieval-hit">
                        <div class="memory-retrieval-hit-head"><b>#${index + 1} · ${escapeHtml(item.id)}</b><span>综合 ${Number(item.score || 0).toFixed(2)} · 标签 ${Number(item.tagScore || 0).toFixed(2)} · 词法 ${Number(item.lexicalScore || 0).toFixed(2)} · 语义 ${Number(item.semanticScore || 0).toFixed(2)} · 反馈 ${Number(item.feedbackAdjustment || 0) >= 0 ? '+' : ''}${Number(item.feedbackAdjustment || 0).toFixed(2)}</span></div>
                        <div class="memory-retrieval-reasons">${(item.reasons || []).map(reason => `<span>${escapeHtml(reason)}</span>`).join('')}</div>
                        ${item.directive ? `<div class="memory-effect-directive">${escapeHtml(item.directive)}</div>` : ''}<p>${escapeHtml(item.text || '')}</p>
                    </article>`).join('') : '<div class="memory-retrieval-none">没有达到阈值的条目</div>'}
                </section>`).join('')}</div>
            <details class="memory-retrieval-prompt"><summary>查看最终注入文本</summary><pre>${escapeHtml(diagnostic.finalBlock || '（没有注入内容）')}</pre></details>
        </div>`;
    }

    const api = {
        hasExplicitVectorApi,
        prepareGroups,
        findMostSimilar,
        renderDiagnostics,
        hashText,
        cosineSimilarity
    };

    if (Kernel) Kernel.register('retrieval', api, { legacyGlobal: 'MemoryTableRetrieval' });
    else window.MemoryTableRetrieval = api;
})();
