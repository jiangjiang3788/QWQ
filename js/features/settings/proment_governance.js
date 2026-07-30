// QWQ V5.4.3 · Proment governance view backed by the real Context Manifest.
(function (global) {
    'use strict';

    const VERSION = 'proment-governance.v1';
    let bound = false;

    const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[ch]));
    const clone = value => { try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; } };

    function activeCharacter() {
        const list = Array.isArray(global.db?.characters) ? global.db.characters : [];
        return list.find(item => String(item.id) === String(global.currentChatId || '')) || list[0] || null;
    }

    function policy() {
        return global.OVOContextCompiler?.getPolicy?.() || {
            worldBookEnabled: true, worldBookBudget: 2400, worldBookPriority: 20,
            structuredEnabled: true, structuredBudget: 1800, structuredPriority: 30,
            historyEnabled: true, historyCount: 30, statusEnabled: true
        };
    }

    function policyMeta(sourceId) {
        const p = policy();
        if (sourceId === 'worldbook.active') return { enabled: p.worldBookEnabled, detail: `预算 ${p.worldBookBudget} · 优先级 ${p.worldBookPriority}` };
        if (sourceId === 'memory.structured') return { enabled: p.structuredEnabled, detail: `预算 ${p.structuredBudget} · 优先级 ${p.structuredPriority}` };
        if (sourceId === 'chat.history') return { enabled: p.historyEnabled, detail: p.historyEnabled ? `最近 ${p.historyCount} 条` : '仅保留本轮输入' };
        if (sourceId === 'character.live_state' || sourceId === 'memory.live') return { enabled: p.statusEnabled, detail: p.statusEnabled ? '允许注入' : '已关闭' };
        return { enabled: true, detail: '' };
    }

    function latestRequest() {
        const operations = global.OVOOperationRuntime?.list?.({ limit: 30 }) || [];
        for (const operation of operations) {
            const requests = Array.isArray(operation?.requests) ? operation.requests.slice().reverse() : [];
            const request = requests.find(item => item?.contextManifest);
            if (request) return { operation, request, manifest: request.contextManifest };
        }
        const manifest = global.OVOContextSourceRegistry?.getLastManifest?.() || null;
        const gateway = global.OVOAIRequestGateway?.getLastRequest?.() || null;
        return manifest ? { operation: null, request: null, manifest, gateway } : null;
    }

    function taskLabel(tasks) {
        const list = Array.isArray(tasks) ? tasks : [];
        if (list.includes('*')) return '所有任务';
        if (list.length <= 3) return list.join('、') || '未声明';
        return `${list.slice(0, 3).join('、')} 等${list.length}项`;
    }

    function renderOverview() {
        const grid = document.getElementById('proment-status-grid');
        if (!grid) return;
        const char = activeCharacter();
        const latest = latestRequest();
        const registryCount = global.OVOContextSourceRegistry?.list?.().length || 0;
        const sources = latest?.manifest?.sources || [];
        const included = sources.filter(item => item.included !== false && (Number(item.chars) || Number(item.matchedChars) || 0) > 0).length;
        const rows = [
            ['当前角色', char ? (char.remarkName || char.realName || char.name || '未命名') : '暂无角色'],
            ['已注册来源', `${registryCount} 项`],
            ['最近真实请求', latest ? `${latest.manifest.task || 'AI任务'} · ${included}项来源` : '暂无'],
            ['来源覆盖', latest?.manifest?.coverage?.complete === false ? '存在未登记或停用泄漏' : (latest ? '完整' : '待请求后检查')]
        ];
        grid.innerHTML = rows.map(([label, value]) => `<div class="proment-status-card"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');
    }

    function renderRegistry() {
        const box = document.getElementById('proment-source-registry-list');
        if (!box) return;
        const definitions = global.OVOContextSourceRegistry?.list?.() || [];
        if (!definitions.length) {
            box.innerHTML = '<p class="proment-empty">上下文注册中心尚未加载。</p>';
            return;
        }
        const groups = new Map();
        definitions.sort((a, b) => (Number(a.priority) || 999) - (Number(b.priority) || 999)).forEach(def => {
            const key = def.domain || 'other';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(def);
        });
        box.innerHTML = Array.from(groups.entries()).map(([domain, items]) => `<section class="proment-source-group">
            <h4>${esc(domain)}<span>${items.length}</span></h4>
            <div>${items.map(def => {
                const meta = policyMeta(def.id);
                const state = meta.enabled ? '启用' : '关闭';
                return `<article class="proment-source-row ${meta.enabled ? '' : 'is-disabled'}">
                    <div><b>${esc(def.title || def.id)}</b><code>${esc(def.id)}</code><small>${esc(taskLabel(def.tasks))}${meta.detail ? ` · ${esc(meta.detail)}` : ''}</small></div>
                    <span>${esc(def.layer || 'context')} · ${esc(state)}</span>
                </article>`;
            }).join('')}</div>
        </section>`).join('');
    }

    function sourceDefinition(sourceId) {
        return global.OVOContextSourceRegistry?.get?.(sourceId) || null;
    }

    function sourceChars(source) {
        return Math.max(0, Number(source?.chars) || Number(source?.matchedChars) || 0);
    }

    function sourceState(source) {
        if (source?.included === false) return '未发送';
        return sourceChars(source) > 0 ? '已发送' : '已登记';
    }

    function renderLatestRequest() {
        const box = document.getElementById('proment-real-request-content');
        if (!box) return;
        const latest = latestRequest();
        if (!latest?.manifest) {
            box.innerHTML = '<p class="proment-empty">尚无真实请求。完成一次聊天、日记、识图或其他 AI 操作后，这里会显示实际发送来源。</p>';
            return;
        }
        const manifest = latest.manifest;
        const request = latest.request || {};
        const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
        const coverage = manifest.coverage || {};
        const included = sources.filter(item => item.included !== false && sourceChars(item) > 0);
        const excluded = sources.filter(item => item.included === false || sourceChars(item) === 0);
        const rows = sources.map(source => {
            const def = sourceDefinition(source.sourceId);
            const navigation = def?.navigation;
            const canOpen = !!navigation?.kind;
            return `<article class="proment-real-source ${source.included === false ? 'is-excluded' : ''}">
                <div><b>${esc(source.title || def?.title || source.sourceId)}</b><code>${esc(source.sourceId || '')}</code><small>${esc(source.reason || '由真实请求清单登记')}</small></div>
                <span>${esc(sourceState(source))} · ${sourceChars(source)} 字符</span>
                ${canOpen ? `<button type="button" data-proment-open-source="${esc(source.sourceId)}">打开来源</button>` : ''}
            </article>`;
        }).join('');
        const bodyPreview = String(request.bodyPreview || '');
        box.innerHTML = `<div class="proment-request-summary">
            <p><b>${esc(manifest.task || request.task || 'AI任务')}</b><span>${esc(manifest.provider || request.provider || 'API')} · ${esc(manifest.model || request.model || '未记录模型')}</span></p>
            <p><span>实际来源 ${included.length} 项</span><span>未发送/空来源 ${excluded.length} 项</span><span>消息 ${manifest.request?.messageCount ?? request.messageCount ?? 0} 条</span></p>
            <p class="${coverage.complete === false ? 'is-warning' : 'is-ok'}">${coverage.complete === false ? '覆盖检查未通过' : '所有实际请求内容均已登记'}${coverage.retiredSourceLeak ? ' · 检测到已停用内容' : ''}</p>
        </div><div class="proment-real-source-list">${rows || '<p class="proment-empty">本次清单没有来源条目。</p>'}</div>${bodyPreview ? `<details class="proment-request-body"><summary>查看实际请求内容${request.bodyTruncated ? '（已截断）' : ''}</summary><pre>${esc(bodyPreview)}</pre></details>` : ''}`;
    }

    function openSource(sourceId) {
        const def = sourceDefinition(sourceId);
        const kind = def?.navigation?.kind;
        const char = activeCharacter();
        if (char) {
            global.currentChatId = char.id;
            global.currentChatType = 'private';
        }
        if (kind === 'worldbook') {
            if (typeof global.renderWorldBookList === 'function') global.renderWorldBookList();
            global.switchScreen?.('world-book-screen');
            return;
        }
        if (kind === 'structured-memory') {
            if (char && typeof global.openMemoryTableForCharacter === 'function') global.openMemoryTableForCharacter(char.id);
            else global.switchScreen?.('memory-table-screen');
            return;
        }
        if (kind === 'journal-memory') { global.switchScreen?.('memory-journal-screen'); return; }
        if (kind === 'character') {
            if (typeof global.loadSettingsToSidebar === 'function') global.loadSettingsToSidebar();
            global.switchScreen?.('chat-settings-screen');
            return;
        }
        if (kind === 'user') { global.switchScreen?.('my-profile-screen'); return; }
        if (kind === 'collection') {
            if (char && typeof global.openMemoryTableForCharacter === 'function') {
                const tableId = global.MemoryV5?.constants?.FAVORITE_TABLE_ID || 'v5_message_favorites';
                global.openMemoryTableForCharacter(char.id, tableId);
            } else global.showToast?.('请先进入一个角色聊天');
            return;
        }
        global.showToast?.('该来源没有独立管理页面');
    }

    function copyLatestManifest() {
        const latest = latestRequest();
        if (!latest?.manifest) return global.showToast?.('尚无真实请求清单');
        const text = JSON.stringify(clone(latest.manifest), null, 2);
        const fallback = () => {
            const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        };
        const promise = navigator.clipboard?.writeText ? navigator.clipboard.writeText(text) : Promise.resolve().then(fallback);
        Promise.resolve(promise).catch(fallback).then(() => global.showToast?.('真实请求清单已复制'));
    }

    function renderAll() {
        renderOverview();
        renderRegistry();
        renderLatestRequest();
    }

    function bind() {
        if (bound) return;
        bound = true;
        document.addEventListener('click', event => {
            const source = event.target.closest('[data-proment-open-source]');
            if (source) { openSource(source.dataset.promentOpenSource); return; }
            if (event.target.closest('#proment-refresh-governance')) { renderAll(); return; }
            if (event.target.closest('#proment-copy-real-manifest')) { copyLatestManifest(); return; }
            if (event.target.closest('#proment-cancel-ai-requests')) {
                const count = global.OVOAIRequestRuntime?.cancelAll?.() || 0;
                global.showToast?.(count ? `已取消 ${count} 个 AI 请求` : '当前没有可取消的 AI 请求');
                renderAll();
            }
        });
        global.addEventListener('ovo:operation-change', () => {
            if (document.getElementById('magic-room-screen')?.classList.contains('active')) renderAll();
        });
    }

    function init() { bind(); renderAll(); }

    global.OvoPromentGovernance = Object.freeze({ VERSION, init, render: renderAll, latestRequest });
})(window);
