// --- AI 交互模块 ---


// V2.10-R3.3：聊天任务与页面解耦。
// 页面切换只影响 UI，不再改变任务控制器、目标角色或持久化目标。
const activeChatReplyTasks = window.__ovoActiveChatReplyTasks instanceof Map
    ? window.__ovoActiveChatReplyTasks
    : new Map();
window.__ovoActiveChatReplyTasks = activeChatReplyTasks;

function getChatReplyTaskKey(chatId, chatType) {
    return `${chatType || 'private'}:${chatId || ''}`;
}

function isTargetChatViewOpen(chatId, chatType) {
    return chatId === currentChatId
        && chatType === currentChatType
        && !!document.getElementById('chat-room-screen')?.classList.contains('active');
}

async function persistChatEntity(chat, chatType) {
    if (!chat?.id) return false;
    const resolvedType = chatType
        || ((db.groups || []).some(item => item === chat || item?.id === chat.id) ? 'group' : 'private');
    if (resolvedType === 'group') {
        if (typeof saveGroup === 'function') await saveGroup(chat.id);
    } else if (typeof saveCharacter === 'function') {
        await saveCharacter(chat.id);
    }
    return true;
}

function appendMessageBubbleForTarget(message, chatId, chatType) {
    if (!isTargetChatViewOpen(chatId, chatType)) return false;
    if (typeof addMessageBubble === 'function') addMessageBubble(message, chatId, chatType);
    return true;
}

function syncChatReplyUiState(chatId = currentChatId, chatType = currentChatType) {
    const task = chatId ? activeChatReplyTasks.get(getChatReplyTaskKey(chatId, chatType)) : null;
    isGenerating = !!task;
    currentReplyAbortController = task?.controller || null;
    if (typeof getReplyBtn !== 'undefined' && getReplyBtn) getReplyBtn.disabled = !!task;
    if (typeof regenerateBtn !== 'undefined' && regenerateBtn) regenerateBtn.disabled = !!task;
    if (typeof typingIndicator !== 'undefined' && typingIndicator) {
        if (task && isTargetChatViewOpen(chatId, chatType)) {
            typingIndicator.textContent = `“${task.displayName || '角色'}”正在输入中...`;
            typingIndicator.style.display = 'block';
        } else if (typingIndicator.getAttribute('data-theater-generating') !== 'true') {
            typingIndicator.style.display = 'none';
        }
    }
    return !!task;
}

window.OVOChatReplyTasks = {
    isActive(chatId, chatType) {
        return activeChatReplyTasks.has(getChatReplyTaskKey(chatId, chatType));
    },
    get(chatId, chatType) {
        return activeChatReplyTasks.get(getChatReplyTaskKey(chatId, chatType)) || null;
    },
    list() {
        return Array.from(activeChatReplyTasks.values()).map(item => ({
            chatId: item.chatId,
            chatType: item.chatType,
            displayName: item.displayName,
            operationId: item.operationId || null,
            startedAt: item.startedAt
        }));
    },
    cancel(chatId, chatType) {
        const task = activeChatReplyTasks.get(getChatReplyTaskKey(chatId, chatType));
        if (!task?.controller) return false;
        try {
            task.controller.abort();
            return true;
        } catch (_) {
            return false;
        }
    },
    syncUi: syncChatReplyUiState
};

// 检查角色是否在免打扰时段内
function isInQuietHours(charId) {
    const char = db.characters.find(c => c.id === charId);
    if (!char || !char.autoReply || !char.autoReply.quietHours || !char.autoReply.quietHours.enabled) return false;
    const { start, end } = char.autoReply.quietHours;
    if (!start || !end) return false;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (startMin <= endMin) {
        return nowMinutes >= startMin && nowMinutes < endMin;
    } else {
        // 跨午夜，如 23:00 ~ 07:00
        return nowMinutes >= startMin || nowMinutes < endMin;
    }
}

function getActiveWorldBooksContents(character) {
    const provider = window.WorldBookContextProvider;
    if (provider && typeof provider.provide === 'function') return provider.provide(character);
    console.warn('[WorldBookContext] provider is unavailable; no worldbook content will be injected');
    return { before: '', middle: '', after: '' };
}

function getEffectivePersona(character) {
    if (!character) return '';
    let p = character.persona || '';
    const useSupplement = (character.source === 'forum' || character.source === 'peek') && (character.supplementPersonaEnabled || character.supplementPersonaAiEnabled) && (character.supplementPersonaText || '').trim();
    if (useSupplement) {
        p = (p ? p + '\n\n[已补齐的人设]\n' : '[已补齐的人设]\n') + (character.supplementPersonaText || '').trim();
    }
    return p || "一个友好、乐于助人的伙伴。";
}


function extractPrivateOutputRules(systemPrompt) {
    const text = String(systemPrompt || '');
    const blocks = [];
    const patterns = [
        /<Chatting Guidelines>[\s\S]*?<\/Chatting Guidelines>/ig,
        /【额外允许的线上功能格式】[\s\S]*?(?=\n【|\n<|$)/ig,
        /【消息收藏功能】[\s\S]*?(?=\n【|$)/ig,
        /【输出格式[^】]*】[\s\S]*?(?=\n【|\n<|$)/ig
    ];
    patterns.forEach(pattern => {
        const matches = text.match(pattern) || [];
        matches.forEach(match => { if (match && !blocks.includes(match.trim())) blocks.push(match.trim()); });
    });
    return blocks.join('\n\n');
}

function formatPromptTimestamp(timestamp) {
    const value = Number(timestamp);
    if (!Number.isFinite(value) || value <= 0) return '时间未记录';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间未记录';
    const pad2 = number => String(number).padStart(2, '0');
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absOffset = Math.abs(offsetMinutes);
    const offset = `UTC${sign}${pad2(Math.floor(absOffset / 60))}:${pad2(absOffset % 60)}`;
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${offset}`;
}

function buildPromptMessageTimePrefix(timestamp) {
    // 使用明确的内部元数据标签，避免与角色正常聊天格式混淆。
    // 最终回复仍会经过 stripPromptMetadataEcho() 二次清理。
    return `<message_meta sent_at="${formatPromptTimestamp(timestamp)}" />\n`;
}

function appendMessageMetadataProtocol(systemPrompt) {
    const prompt = String(systemPrompt || '');
    if (prompt.includes('<message_metadata_protocol>')) return prompt;
    return `${prompt}\n\n<message_metadata_protocol>\n历史消息开头可能包含 <message_meta sent_at="..." />，它只是系统提供的消息发生时间。你可以据此理解时间顺序和间隔，但绝对禁止在回复中复制、改写、解释或输出 message_meta、消息时间标签及其时间值。只输出角色真正要发送的内容。\n</message_metadata_protocol>`;
}

function stripPromptMetadataEcho(text) {
    return String(text || '')
        .replace(/^[ \t]*<message_meta\b[^>]*\/?>(?:<\/message_meta>)?[ \t]*$/gmi, '')
        .replace(/<message_meta\b[^>]*\/?>(?:<\/message_meta>)?/gi, '')
        .replace(/^[ \t]*[\[【]消息时间[：:][^\]】\r\n]*[\]】][ \t]*$/gmi, '')
        .replace(/[\[【]消息时间[：:][^\]】\r\n]*[\]】]/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function extractPromptTagContent(systemPrompt, tagName) {
    const safeTag = String(tagName || '').replace(/[^a-z0-9_-]/gi, '');
    if (!safeTag) return '';
    const match = String(systemPrompt || '').match(new RegExp(`<${safeTag}>([\\s\\S]*?)<\\/${safeTag}>`, 'i'));
    return match ? String(match[1] || '').trim() : '';
}


function extractPromptTagBlock(systemPrompt, tagName) {
    const safeTag = String(tagName || '').replace(/[^a-z0-9_-]/gi, '');
    if (!safeTag) return '';
    const match = String(systemPrompt || '').match(new RegExp(`<${safeTag}\\b[^>]*>[\\s\\S]*?<\\/${safeTag}>`, 'i'));
    return match ? String(match[0] || '').trim() : '';
}

function wrapPromptProject(tagName, content, attributes = '') {
    const body = String(content || '').trim();
    if (!body) return '';
    const attrs = String(attributes || '').trim();
    return `<${tagName}${attrs ? ` ${attrs}` : ''}>\n${body}\n</${tagName}>`;
}

function replacePromptAliases(prompt, character, linkedCharacter = null) {
    const userName = String(character?.myName || '用户').trim() || '用户';
    const charName = String(linkedCharacter?.realName || character?.realName || character?.remarkName || character?.name || '角色').trim() || '角色';
    return String(prompt || '')
        .replace(/\{\{\s*user\s*\}\}/gi, userName)
        .replace(/\{\{\s*char\s*\}\}/gi, charName);
}

function parseStructuredMemoryPromptItems(content) {
    const clean = String(content || '')
        .replace(/<\/?structured_memory\b[^>]*>/gi, '')
        .trim();
    if (!clean) return [];
    const headingPattern = /【([^】]+)】/g;
    const matches = Array.from(clean.matchAll(headingPattern));
    if (!matches.length) {
        return [{ id: 'memory-record-1', title: '结构化记忆', content: clean, chars: clean.length, sent: true, reason: '来自最终请求中的结构化记忆正文' }];
    }
    const items = [];
    matches.forEach((match, tableIndex) => {
        const tableName = String(match[1] || `记忆表 ${tableIndex + 1}`).trim();
        const start = match.index + match[0].length;
        const end = matches[tableIndex + 1]?.index ?? clean.length;
        const body = clean.slice(start, end).trim();
        const records = body.split(/\n\s*---\s*\n/g).map(value => value.trim()).filter(Boolean);
        (records.length ? records : [body]).forEach((record, recordIndex) => {
            if (!record) return;
            items.push({
                id: `memory-${tableIndex + 1}-${recordIndex + 1}`,
                title: records.length > 1 ? `${tableName} · 第 ${recordIndex + 1} 条` : tableName,
                content: record,
                chars: record.length,
                sent: true,
                reason: '来自最终请求中实际发送的记忆表记录',
                metadata: { tableName, recordIndex: recordIndex + 1 }
            });
        });
    });
    return items;
}

function describeStructuredMemoryChange(character, change) {
    const store = character?.memoryStore || null;
    const table = store?.tables?.find?.(item => String(item.id) === String(change?.tableId || '')) || null;
    const record = store?.records?.[change?.tableId]?.find?.(item => String(item.id) === String(change?.recordId || '')) || null;
    const formatter = window.MemoryV5?.engine?.formatRecordText || window.OvoMemory?.engine?.formatRecordText;
    const fallbackRecordText = table && record
        ? (table.fields || []).map(field => {
            const value = record.values && Object.prototype.hasOwnProperty.call(record.values, field.id)
                ? record.values[field.id]
                : record[field.id];
            if (value == null || value === '' || (Array.isArray(value) && !value.length)) return '';
            return `${field.name || field.id}: ${Array.isArray(value) ? value.join('、') : String(value)}`;
        }).filter(Boolean).join('\n')
        : '';
    const actualText = table && record && typeof formatter === 'function'
        ? formatter(table, record)
        : fallbackRecordText;
    const fieldNames = Array.isArray(change?.fields) && table
        ? change.fields.map(fieldId => table.fields?.find?.(field => String(field.id) === String(fieldId))?.name).filter(Boolean)
        : [];
    const actionLabel = change?.action === 'add' ? '新增' : change?.action === 'delete' ? '删除' : '更新';
    const tableName = table?.name || '结构化记忆';
    return {
        action: change?.action === 'add' ? 'create' : change?.action === 'delete' ? 'delete' : 'update',
        entityType: 'structured_memory',
        entityId: change?.recordId || '',
        title: tableName,
        summary: actualText ? `${actionLabel}：${actualText.slice(0, 160)}${actualText.length > 160 ? '…' : ''}` : `${actionLabel}${tableName}`,
        after: actualText,
        fields: fieldNames,
        meta: {
            characterId: character?.id || '',
            tableId: change?.tableId || null,
            tableName,
            recordId: change?.recordId || null
        }
    };
}

// V3：动态记忆表是聊天上下文中的唯一记忆来源。
function getStructuredArchiveContextApi() {
    const contextApi = window.OvoMemory?.context;
    if (contextApi && typeof contextApi.get === 'function') return contextApi;
    if (typeof getMemoryTableContextBlock === 'function') {
        return {
            get: getMemoryTableContextBlock,
            prepare: typeof prepareMemoryTableContext === 'function' ? prepareMemoryTableContext : null
        };
    }
    return null;
}

function hasStructuredArchiveMemory(character) {
    if (!character || !getStructuredArchiveContextApi()) return false;
    if (character.memoryStore && typeof character.memoryStore === 'object') {
        return character.memoryStore.settings?.enabled !== false
            && Array.isArray(character.memoryStore.tables)
            && character.memoryStore.tables.length > 0;
    }
    if (character.memoryTables?.enabled === false) return false;
    const boundIds = character.memoryTables?.boundTemplateIds;
    return Array.isArray(boundIds) && boundIds.length > 0;
}

function getStructuredArchiveMemoryContext(character) {
    if (!hasStructuredArchiveMemory(character)) return '';
    const contextApi = getStructuredArchiveContextApi();
    const block = contextApi?.get(character, { allowInactiveMode: true }) || '';
    return block ? `<structured_archive_memory>\n${block}\n</structured_archive_memory>` : '';
}


function getStructuredArchiveMemoryProjects(character) {
    if (!hasStructuredArchiveMemory(character)) return { core: '', longTerm: '', currentRelated: '', coreGroups: [], items: [], selectedCount: 0, omittedCount: 0, usedChars: 0, budget: 0 };
    const projectApi = window.OvoMemory?.context?.projects || window.MemoryV5?.engine?.getContextProjects || window.getMemoryTableContextProjects;
    if (typeof projectApi !== 'function') {
        const legacy = getStructuredArchiveMemoryContext(character);
        return { core: '', longTerm: legacy, currentRelated: '', coreGroups: [], items: [], selectedCount: legacy ? 1 : 0, omittedCount: 0, usedChars: legacy.length, budget: 0 };
    }
    try {
        return projectApi(character, { allowInactiveMode: true }) || { core: '', longTerm: '', currentRelated: '', coreGroups: [], items: [] };
    } catch (error) {
        console.warn('[MemoryProjects] failed to build project-based memory context:', error);
        return { core: '', longTerm: '', currentRelated: '', coreGroups: [], items: [] };
    }
}

function hasProjectMemoryPayload(systemPrompt) {
    return ['identity_core', 'long_term_memory', 'current_related_memory']
        .some(tagName => !!extractPromptTagBlock(systemPrompt, tagName));
}

function readProjectMemoryPayload(systemPrompt) {
    return ['identity_core', 'long_term_memory', 'current_related_memory']
        .map(tagName => extractPromptTagBlock(systemPrompt, tagName))
        .filter(Boolean)
        .join('\n\n');
}

function ensureStructuredArchivePromptInjection(character, systemPrompt) {
    const prompt = String(systemPrompt || '');
    if (prompt.includes('<structured_archive_memory>') || hasProjectMemoryPayload(prompt)) return prompt;
    const archive = getStructuredArchiveMemoryContext(character);
    if (!archive) return prompt;
    return `${prompt}\n\n<memoir data-source="structured-archive-guard">\n${archive}\n</memoir>`;
}


function readSystemPromptFromRequestBody(requestBody, provider) {
    if (!requestBody || typeof requestBody !== 'object') return '';
    if (provider === 'gemini') {
        const instruction = requestBody.system_instruction || requestBody.systemInstruction;
        const parts = Array.isArray(instruction?.parts) ? instruction.parts : [];
        return parts.map(part => String(part?.text || '')).join('\n');
    }
    return (Array.isArray(requestBody.messages) ? requestBody.messages : [])
        .filter(message => message?.role === 'system')
        .map(message => typeof message.content === 'string'
            ? message.content
            : (Array.isArray(message.content) ? message.content.map(part => part?.text || '').join('') : ''))
        .join('\n\n');
}

function writeSystemPromptToRequestBody(requestBody, provider, systemPrompt) {
    const prompt = String(systemPrompt || '');
    if (provider === 'gemini') {
        requestBody.system_instruction = { parts: [{ text: prompt }] };
        if ('systemInstruction' in requestBody) delete requestBody.systemInstruction;
        return;
    }
    if (!Array.isArray(requestBody.messages)) requestBody.messages = [];
    const systemIndexes = [];
    requestBody.messages.forEach((message, index) => {
        if (message?.role === 'system') systemIndexes.push(index);
    });
    if (!systemIndexes.length) {
        requestBody.messages.unshift({ role: 'system', content: prompt });
        return;
    }
    const firstIndex = systemIndexes[0];
    requestBody.messages[firstIndex] = { ...requestBody.messages[firstIndex], role: 'system', content: prompt };
    for (let i = systemIndexes.length - 1; i >= 1; i--) requestBody.messages.splice(systemIndexes[i], 1);
}

function auditAndEnsurePrivateChatMemoryPayload(character, requestBody, provider, operationId, options = {}) {
    let finalSystemPrompt = readSystemPromptFromRequestBody(requestBody, provider);
    const beforeChars = finalSystemPrompt.length;
    const enforceStructured = options.enforceStructured !== false;
    const ensureStructured = options.ensureStructured !== false;
    const expectedArchiveContext = enforceStructured ? getStructuredArchiveMemoryContext(character) : '';
    if (enforceStructured && ensureStructured) finalSystemPrompt = ensureStructuredArchivePromptInjection(character, finalSystemPrompt);
    if (finalSystemPrompt.length !== beforeChars) {
        writeSystemPromptToRequestBody(requestBody, provider, finalSystemPrompt);
    }

    const legacyStructured = extractPromptTagContent(finalSystemPrompt, 'structured_archive_memory');
    const projectStructured = readProjectMemoryPayload(finalSystemPrompt);
    const structured = [legacyStructured, projectStructured].filter(Boolean).join('\n\n');
    const vector = extractPromptTagContent(finalSystemPrompt, 'vector_memory_context');
    const journal = extractPromptTagContent(finalSystemPrompt, 'journal_memory_context');
    const live = extractPromptTagContent(finalSystemPrompt, 'memory_live_context');
    const audit = {
        version: 'memory-payload-audit.v1',
        capturedAt: Date.now(),
        characterId: character?.id || '',
        provider: provider || '',
        operationId: operationId || null,
        structuredArchiveExpected: enforceStructured && !!expectedArchiveContext,
        structuredArchivePolicyEnabled: enforceStructured,
        structuredArchiveSent: !!structured,
        structuredArchiveChars: structured.length,
        supplementalMode: character?.memoryMode || 'table',
        vectorSent: !!vector,
        vectorChars: vector.length,
        journalSent: !!journal,
        journalChars: journal.length,
        liveContextSent: !!live,
        liveContextChars: live.length,
        systemPromptChars: finalSystemPrompt.length,
        guardApplied: finalSystemPrompt.length !== beforeChars
    };
    try {
        window.__ovoLastMemoryPayloadAudit = audit;
        sessionStorage.setItem('ovo_last_memory_payload_audit', JSON.stringify(audit));
    } catch (_) {}
    if (operationId && window.OVOOperationRuntime?.update) {
        window.OVOOperationRuntime.update(operationId, {
            memoryPayloadAudit: audit
        }, 'memory-payload-audit');
    }
    if (enforceStructured && audit.structuredArchiveExpected && !audit.structuredArchiveSent) {
        throw new Error('结构化档案已启用，但最终聊天请求中仍未找到分段记忆或 structured_archive_memory');
    }
    return { requestBody, systemPrompt: finalSystemPrompt, audit };
}

function buildCombinedLongTermMemoryContext(character) {
    return getStructuredArchiveMemoryContext(character);
}

async function prepareCombinedLongTermMemoryContext(character) {
    if (!character) return '';
    if (hasStructuredArchiveMemory(character)) {
        const contextApi = getStructuredArchiveContextApi();
        if (typeof contextApi?.prepare === 'function') {
            await contextApi.prepare(character, { allowInactiveMode: true });
        }
    }
    return buildCombinedLongTermMemoryContext(character);
}


function buildPromptProjectItems(tagName, innerContent, character) {
    const content = String(innerContent || '').trim();
    if (!content) return [];
    const layerByTag = {
        identity_core: 'core',
        long_term_memory: 'longTerm',
        current_related_memory: 'currentRelated'
    };
    const targetLayer = layerByTag[tagName];
    if (targetLayer && character) {
        const linkedChar = (character.source === 'forum' && character.linkedCharId && Array.isArray(db?.characters))
            ? db.characters.find(item => item.id === character.linkedCharId) : null;
        const projects = getStructuredArchiveMemoryProjects(character);
        const items = (projects.items || []).filter(item => item.layer === targetLayer).map((item, index) => ({
            id: item.recordId ? `${item.tableId || targetLayer}:${item.recordId}:${index + 1}` : `${targetLayer}:${index + 1}`,
            title: item.title || `第 ${index + 1} 条`,
            content: replacePromptAliases(item.content || '', character, linkedChar),
            chars: replacePromptAliases(item.content || '', character, linkedChar).length,
            sent: true,
            reason: item.reason || '来自本轮实际发送的记忆项目',
            metadata: { tableName: item.tableName || '记忆', recordIndex: Number(item.recordIndex) || index + 1, layer: targetLayer }
        }));
        if (items.length) return items;
    }
    if (targetLayer) return parseStructuredMemoryPromptItems(content);
    return [];
}

function buildWorldBookProjectItems(character, position) {
    const diagnostic = window.WorldBookContextProvider?.getLastDiagnostic?.() || null;
    if (!diagnostic || diagnostic.characterId !== character?.id || !Array.isArray(diagnostic.items)) return [];
    const linkedChar = (character?.source === 'forum' && character?.linkedCharId && Array.isArray(db?.characters))
        ? db.characters.find(item => item.id === character.linkedCharId) : null;
    return diagnostic.items
        .filter(item => String(item.position || 'after') === position && item.included)
        .map(item => ({
            id: item.id,
            title: item.name || '未命名世界书',
            content: replacePromptAliases(String(item.content || ''), character, linkedChar),
            chars: Number(item.injectedChars) || String(item.content || '').length,
            sent: true,
            clipped: false,
            sourceId: item.id,
            reason: item.reason || '本次已完整发送',
            metadata: {
                position,
                alwaysOn: !!item.alwaysOn,
                matchedKeywords: item.matchedKeywords || [],
                matchedCurrentKeywords: item.matchedCurrentKeywords || [],
                matchedRecentKeywords: item.matchedRecentKeywords || []
            }
        }));
}

function buildProjectPrivateChatPromptSources(character, systemPrompt) {
    const prompt = String(systemPrompt || '');
    if (!extractPromptTagBlock(prompt, 'session_rules')) return [];
    const specs = [
        { tag: 'session_rules', registryId: 'prompt.session', type: 'system_rules', title: '00 会话总规则' },
        { tag: 'worldbook_identity_before', registryId: 'worldbook.identity_before', type: 'worldbook', title: '01 世界书·身份前', position: 'before' },
        { tag: 'identity_core', registryId: 'identity.core', type: 'structured_memory', title: '02 核心档案' },
        { tag: 'worldbook_identity_after', registryId: 'worldbook.identity_after', type: 'worldbook', title: '03 世界书·身份后', position: 'middle' },
        { tag: 'long_term_memory', registryId: 'memory.long_term', type: 'structured_memory', title: '04 长期关系记忆' },
        { tag: 'worldbook_scene_after', registryId: 'worldbook.scene_after', type: 'worldbook', title: '05 世界书·场景后置', position: 'after' },
        { tag: 'current_related_memory', registryId: 'memory.current_related', type: 'structured_memory', title: '06 当前与相关记忆' },
        { tag: 'current_environment', registryId: 'runtime.environment', type: 'system_rules', title: '07 当前环境' },
        { tag: 'interaction_rules', registryId: 'prompt.interaction_rules', type: 'system_rules', title: '08 互动规则' },
        { tag: 'output_formats', registryId: 'output.chat_protocol', type: 'output_rules', title: '09 输出规则' },
        { tag: 'background_write', registryId: 'output.background_write', type: 'output_rules', title: '10 后台写入' },
        { tag: 'message_metadata_protocol', registryId: 'prompt.message_metadata', type: 'system_rules', title: '11 消息说明' }
    ];
    return specs.map(spec => {
        const block = extractPromptTagBlock(prompt, spec.tag);
        if (!block) return null;
        const inner = extractPromptTagContent(prompt, spec.tag);
        const items = spec.position
            ? buildWorldBookProjectItems(character, spec.position)
            : buildPromptProjectItems(spec.tag, inner, character);
        return {
            type: spec.type,
            registryId: spec.registryId,
            title: spec.title,
            content: block,
            items,
            count: items.length,
            sent: true,
            reason: '按最终 system prompt 的真实项目顺序精确提取',
            traceMode: 'request_exact',
            sourceId: character.id,
            metadata: { promptTag: spec.tag, projectOrder: specs.indexOf(spec), groupedBy: items.length ? 'tableName' : null }
        };
    }).filter(Boolean);
}

function buildPrivateChatPromptSources(character, systemPrompt) {
    if (!character) return [];
    const projectSources = buildProjectPrivateChatPromptSources(character, systemPrompt);
    if (projectSources.length) return projectSources;
    const sources = [];
    const persona = getEffectivePersona(character);
    const characterProfile = [
        `角色名：${character.realName || character.remarkName || character.name || '未命名角色'}`,
        `当前状态：${character.status || '在线'}`,
        `角色人设：${persona}`
    ].join('\n');
    sources.push({
        type: 'character_profile',
            registryId: 'character.profile',
        content: characterProfile,
        sent: String(systemPrompt || '').includes(persona) || (!!character.realName && String(systemPrompt || '').includes(character.realName)),
        reason: '来自当前角色档案；是否发送根据最终 system prompt 进行核对',
        traceMode: 'source_verified',
        sourceId: character.id
    });

    const liveArchiveMemory = extractPromptTagContent(systemPrompt, 'memory_live_context');
    if (liveArchiveMemory) {
        const hasActualArchiveData = !/^当前没有已记录的实时状态或活跃待办[。.]?$/.test(liveArchiveMemory.trim());
        sources.push({
            type: 'character_memory',
            registryId: 'memory.live',
            title: '实时档案状态与待办',
            content: liveArchiveMemory,
            sent: true,
            count: hasActualArchiveData ? undefined : 0,
            reason: hasActualArchiveData
                ? '从最终 system prompt 的 memory_live_context 中提取；这是实时状态/待办，不等同于结构化档案正文'
                : '本次已发送档案记忆区块，但当前没有可用的实时状态或活跃待办',
            traceMode: 'request_exact',
            sourceId: character.id
        });
    }

    const userProfileParts = [];
    if (character.myName) userProfileParts.push(`用户称呼：${character.myName}`);
    if (character.myPersona) userProfileParts.push(`用户人设：${character.myPersona}`);
    if (userProfileParts.length) {
        const userProfile = userProfileParts.join('\n');
        sources.push({
            type: 'user_profile',
            registryId: 'user.profile',
            content: userProfile,
            sent: !character.myPersona || String(systemPrompt || '').includes(character.myPersona),
            reason: '来自当前角色绑定的用户称呼与用户人设',
            traceMode: 'source_verified'
        });
    }

    const diagnostic = window.WorldBookContextProvider?.getLastDiagnostic?.() || null;
    if (diagnostic && diagnostic.characterId === character.id && Array.isArray(diagnostic.items)) {
        const included = diagnostic.items.filter(item => item.included);
        const content = included.map(item => String(item.content || '').slice(0, Number(item.injectedChars) || String(item.content || '').length)).join('\n\n');
        sources.push({
            type: 'worldbook',
            registryId: 'worldbook.active',
            title: `世界书（注入 ${included.length}/${diagnostic.items.length} 条）`,
            content,
            count: included.length,
            sent: included.length > 0,
            reason: included.length ? `按 ${diagnostic.budget || 0} 字符预算注入` : '本次没有世界书条目进入最终 Prompt',
            traceMode: 'source_exact',
            items: diagnostic.items.map(item => ({
                id: item.id,
                title: item.name || '未命名世界书',
                content: item.included ? String(item.content || '').slice(0, Number(item.injectedChars) || String(item.content || '').length) : '',
                chars: Number(item.injectedChars) || 0,
                sent: !!item.included,
                clipped: !!item.clipped,
                sourceId: item.id,
                reason: item.reason || (item.included ? '本次已注入' : '本次未注入'),
                metadata: { position: item.position || 'after', matchedKeywords: item.matchedKeywords || [] }
            }))
        });
    }

    // V5.7.0：消息收藏已并入角色的结构化记忆表，不再注册独立收藏来源。

    const structuredArchive = extractPromptTagContent(systemPrompt, 'structured_archive_memory');
    if (structuredArchive) {
        const structuredItems = parseStructuredMemoryPromptItems(structuredArchive);
        sources.push({
            type: 'structured_memory',
            registryId: 'memory.structured',
            title: '结构化记忆',
            content: structuredArchive,
            items: structuredItems,
            count: structuredItems.length,
            metadata: { groupedBy: 'tableName' },
            sent: true,
            reason: '从最终 system prompt 的 structured_archive_memory 中提取，展示本次实际发送的记忆表记录',
            traceMode: 'request_exact',
            sourceId: character.id
        });
    }

    const vectorMemory = extractPromptTagContent(systemPrompt, 'vector_memory_context');
    if (vectorMemory) {
        sources.push({
            type: 'vector_memory',
            registryId: 'memory.vector',
            title: '向量记忆（补充检索）',
            content: vectorMemory,
            sent: true,
            reason: '当前补充记忆模式为向量记忆，内容从最终请求中提取',
            traceMode: 'request_exact'
        });
    }

    const journalMemory = extractPromptTagContent(systemPrompt, 'journal_memory_context');
    if (journalMemory) {
        sources.push({
            type: 'journal_memory',
            registryId: 'memory.journal',
            title: '回忆日记（补充记忆）',
            content: journalMemory,
            sent: true,
            reason: '当前补充记忆模式为回忆日记，内容从最终请求中提取',
            traceMode: 'request_exact'
        });
    }

    const outputRules = extractPrivateOutputRules(systemPrompt);
    if (outputRules) {
        sources.push({
            type: 'output_rules',
            registryId: 'output.chat_protocol',
            content: outputRules,
            reason: '从最终 system prompt 中提取的回复格式和对话约束',
            traceMode: 'request_exact'
        });
    }
    return sources;
}

const HUMAN_RUN_PROMPT = `<角色活人运转>\n## [PSYCHOLOGY: HEXACO-SCHEMA-ACT]\n> Personality: HEXACO-driven, dynamic traits, inner conflicts required \n> Filter: schema-bias drives emotion; no pure reaction allowed \n> Attachment: secure/insecure logic must govern intimacy  \n> If-Then Behavior: situation-dependent activation of traits only  \n---\n    ## [VITALITY]\n+inconsistency +emoflux +splitmotifs +microreact +minddrift\n---\n## [TRAJECTORY-COHERENCE]\n> Role maintains an identity narrative = coherent over time  \n> No mood/goal switch without contradiction resolution \n> Every action must protect or challenge self-concept  \n> Interrupts = inner conflict or narrative clash  \n> Output = filtered through “who I am” logic\n</角色活人运转>`;

// 后台异步生成图片描述
async function generateImageDescription(msg, chat, apiConfig, parentOperationId = null, chatType = 'private') {
    if (!msg || !msg.parts || !msg.parts.some(p => p.type === 'image' && !p.description)) return;
    
    let {url, key, model, provider} = apiConfig;
    if (!url || !key || !model) return;
    if (url.endsWith('/')) url = url.slice(0, -1);

    const prompt = "请详细描述这张图片的内容，包括人物、动作、环境、物品等细节，尽量客观准确。请将你的描述内容包裹在 <image_description> 和 </image_description> 标签内，不要输出任何其他废话。";
    
    if (typeof showToast === 'function') showToast('正在识别图片...');

    const operationRuntime = window.OVOOperationRuntime;
    const pendingImageCount = msg.parts.filter(part => part.type === 'image' && !part.description).length;
    const imageOperation = operationRuntime
        ? (parentOperationId
            ? operationRuntime.startChild(parentOperationId, 'vision.image.describe', {
                title: '识别聊天图片',
                source: 'chat-auto-description',
                stage: '准备待识别图片',
                scope: { chatId: chat?.id || '', messageId: msg.id || '', imageCount: pendingImageCount }
            })
            : operationRuntime.start('vision.image.describe', {
                title: '识别聊天图片',
                source: 'chat-auto-description',
                stage: '准备待识别图片',
                scope: { chatId: chat?.id || '', messageId: msg.id || '', imageCount: pendingImageCount }
            }))
        : null;

    try {
        operationRuntime?.stage(imageOperation?.id, '转换并读取图片');
        let requestBody;
        
        // 尝试将所有非 Base64 链接转换为 Base64
        const processImage = async (url) => {
            if (url.startsWith('data:image')) return url;
            try {
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                return await new Promise((resolve, reject) => {
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        let w = img.naturalWidth;
                        let h = img.naturalHeight;
                        const max_size = 512;
                        if (w > max_size || h > max_size) {
                            const ratio = Math.min(max_size / w, max_size / h);
                            w = Math.floor(w * ratio);
                            h = Math.floor(h * ratio);
                        }
                        canvas.width = w;
                        canvas.height = h;
                        ctx.drawImage(img, 0, 0, w, h);
                        resolve(canvas.toDataURL('image/jpeg', 0.8));
                    };
                    img.onerror = () => {
                        const imgNoCors = new Image();
                        imgNoCors.onload = () => {
                            try {
                                const canvas = document.createElement('canvas');
                                const ctx = canvas.getContext('2d');
                                let w = imgNoCors.naturalWidth;
                                let h = imgNoCors.naturalHeight;
                                const max_size = 512;
                                if (w > max_size || h > max_size) {
                                    const ratio = Math.min(max_size / w, max_size / h);
                                    w = Math.floor(w * ratio);
                                    h = Math.floor(h * ratio);
                                }
                                canvas.width = w;
                                canvas.height = h;
                                ctx.drawImage(imgNoCors, 0, 0, w, h);
                                resolve(canvas.toDataURL('image/jpeg', 0.8));
                            } catch(err) {
                                reject(new Error('Canvas tainted, cannot convert to Base64'));
                            }
                        };
                        imgNoCors.onerror = () => reject(new Error('Image load error completely'));
                        imgNoCors.src = url;
                    };
                    img.src = url;
                });
            } catch (e) {
                console.warn('[Auto-Description] Image to base64 failed, using original URL:', e);
                return url;
            }
        };

        if (provider === 'gemini') {
            const parts = [{text: prompt}];
            for (const p of msg.parts) {
                if (p.type === 'image' && !p.description) {
                    const processedData = await processImage(p.data);
                    const match = processedData.match(/^data:(image\/(.+));base64,(.*)$/);
                    if (match) {
                        if (match[1] === 'image/gif') {
                            parts.push({text: `[动态图片(GIF)]`});
                        } else {
                            parts.push({inline_data: {mime_type: match[1], data: match[3]}});
                        }
                    } else if (processedData.startsWith('http')) {
                        parts.push({text: `[图片地址: ${processedData}]`}); // Gemini 兜底
                    }
                }
            }
            requestBody = {
                contents: [{role: 'user', parts: parts}],
                generationConfig: { temperature: 0.3 }
            };
        } else {
            const content = [{type: 'text', text: prompt}];
            for (const p of msg.parts) {
                if (p.type === 'image' && !p.description) {
                    const processedData = await processImage(p.data);
                    content.push({type: 'image_url', image_url: {url: processedData}});
                }
            }
            requestBody = {
                model: model,
                messages: [{role: 'user', content: content}],
                temperature: 0.3
            };
        }

        console.log('[Auto-Description] Image Request:', JSON.stringify(requestBody).substring(0, 500) + '...');
        const endpoint = (provider === 'gemini') ? `${url}/v1beta/models/${model}:generateContent?key=${getRandomValue(key)}` : `${url}/v1/chat/completions`;
        const headers = (provider === 'gemini') ? {'Content-Type': 'application/json'} : {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`
        };

        if (!window.OVOAIRequestGateway?.send) throw new Error('统一 AI 请求网关尚未加载');
        const response = await window.OVOAIRequestGateway.send({
            task: 'image-description',
            source: 'chat-auto-description',
            provider,
            model,
            endpoint,
            headers,
            body: requestBody,
            operationId: imageOperation?.id || null,
            operationType: 'vision.image.describe',
            operationStage: '正在识别聊天图片',
            promptSources: [
                { type: 'task_instruction', title: '图片识别要求', content: prompt, reason: '用于生成聊天可读的客观图片描述' },
                { type: 'user_input', registryId: 'media.image_input', title: '待识别图片', content: '[图片内容]', count: msg.parts.filter(part => part.type === 'image' && !part.description).length, reason: '本次消息中尚无描述的图片' }
            ],
            dedupeKey: `image-description:${msg.id || currentChatId || 'current'}`,
            dedupeWindowMs: 1200
        });
        
        const result = await response.json();
        let description = "";
        if (provider === 'gemini') {
            description = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
        } else {
            description = result.choices[0].message.content;
        }

        if (description) {
            // 提取 XML 标签内的内容
            const match = description.match(/<image_description>([\s\S]*?)<\/image_description>/);
            if (match) {
                description = match[1].trim();
            } else {
                description = description.trim(); // 兜底：如果没有标签，直接使用全部内容
            }

            // 更新消息中的图片描述
            let updated = false;
            let updatedCount = 0;
            msg.parts.forEach(p => {
                if (p.type === 'image' && !p.description) {
                    p.description = description;
                    updated = true;
                    updatedCount += 1;
                }
            });
            if (updated) {
                operationRuntime?.stage(imageOperation?.id, '保存图片描述');
                await persistChatEntity(chat, chatType);
                operationRuntime?.recordMutation(imageOperation?.id, {
                    action: 'update',
                    entityType: 'chat_message',
                    entityId: msg.id || '',
                    title: '写入聊天图片描述',
                    summary: `为 ${updatedCount} 张图片写入可供模型读取的描述`,
                    count: updatedCount,
                    fields: ['parts[].description'],
                    after: description,
                    meta: { chatId: chat?.id || '', chatType }
                });
                operationRuntime?.complete(imageOperation?.id, {
                    summary: `已识别并保存 ${updatedCount} 张聊天图片描述`,
                    result: { imageCount: updatedCount, messageId: msg.id || '' }
                });
                console.log('[Auto-Description] 图片描述生成成功:', description);
                if (typeof showToast === 'function') showToast('✅ 图片描述已生成');
            } else {
                operationRuntime?.complete(imageOperation?.id, {
                    summary: '图片识别请求已完成，但没有生成可保存的描述',
                    result: { imageCount: 0, messageId: msg.id || '' }
                });
            }
        } else {
            operationRuntime?.complete(imageOperation?.id, {
                summary: '图片识别请求未返回文本描述',
                result: { imageCount: 0, messageId: msg.id || '' }
            });
        }
    } catch (error) {
        operationRuntime?.fail(imageOperation?.id, error, { stage: '图片识别失败' });
        console.error("[Auto-Description] 生成图片描述失败:", error);
    }
}

// 私聊历史窗口由 PROMENT 统一控制：0 表示发送全部可用消息，不再受角色 maxMemory 二次截断。
function getRequestHistorySlice(chat, chatType, sourceHistory) {
    const list = Array.isArray(sourceHistory) ? sourceHistory : [];
    if (chatType === 'private' && window.OVOContextCompiler?.getPolicy) {
        const policy = window.OVOContextCompiler.getPolicy();
        if (policy.historyEnabled === false || Number(policy.historyCount) === 0) return list.slice();
        const count = Math.max(1, Math.trunc(Number(policy.historyCount) || 30));
        return list.slice(-count);
    }
    const fallback = Math.max(1, Math.trunc(Number(chat?.maxMemory) || 20));
    return list.slice(-fallback);
}

// AI 交互逻辑
async function getAiReply(chatId, chatType, isBackground = false, isSummary = false, isCharBlockedMonologue = false, isPhoneControlRevokeAttempt = false) {
    let operationRecord = null;
    let operationFinished = false;
    let historyCountBefore = 0;
    let historyIdsBefore = new Set();
    let replyAbortController = null;
    let replyTaskKey = '';
    if (!isBackground && activeChatReplyTasks.has(getChatReplyTaskKey(chatId, chatType))) {
        if (typeof showToast === 'function') showToast('这个聊天已有回复任务在进行中');
        return;
    }

    // 拉黑检查：被拉黑的角色不回复（角色拉黑用户后的「让TA说说」不在此列）
    if (chatType === 'private' && !isCharBlockedMonologue) {
        const char = db.characters.find(c => c.id === chatId);
        if (char && char.isBlocked) return;
    }

    // 免打扰时段检查：后台消息在免打扰时段内直接跳过
    if (isBackground && isInQuietHours(chatId)) return;

    if (!isBackground) {
        if (db.globalSendSound) {
            playSound(db.globalSendSound);
        } else {
            AudioManager.unlock();
        }
    }

    // === API选择逻辑：根据场景选择不同API ===
    let apiConfig;
    
    if (isSummary && db.summaryApiSettings && db.summaryApiSettings.url && db.summaryApiSettings.key && db.summaryApiSettings.model) {
        // 总结功能且已配置总结API：使用总结专用API
        apiConfig = db.summaryApiSettings;
    } else if (isBackground && db.backgroundApiSettings && db.backgroundApiSettings.url && db.backgroundApiSettings.key && db.backgroundApiSettings.model) {
        // 后台活动且已配置后台API：使用后台活动专用API
        apiConfig = db.backgroundApiSettings;
    } else {
        // 默认使用主API
        apiConfig = db.apiSettings;
    }
    
    let {url, key, model, provider} = apiConfig;
    let streamEnabled = db.apiSettings.streamEnabled; // 流式输出始终使用主API的设置
    
    if (!url || !key || !model) {
        if (!isBackground) {
            showToast('请先在“api”应用中完成设置！');
            switchScreen('api-settings-screen');
        }
        return;
    }

    // 确保 BLOCKED_API_DOMAINS 存在
    const blockedDomains = (typeof BLOCKED_API_DOMAINS !== 'undefined') ? BLOCKED_API_DOMAINS : [];
    if (blockedDomains.some(domain => url.includes(domain))) {
        if (!isBackground) showToast('当前 API 站点已被屏蔽，无法发送消息！');
        return;
    }

    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }

    const chat = (chatType === 'private') ? db.characters.find(c => c.id === chatId) : db.groups.find(g => g.id === chatId);
    if (!chat) return;

    historyCountBefore = Array.isArray(chat.history) ? chat.history.length : 0;
    historyIdsBefore = new Set((Array.isArray(chat.history) ? chat.history : []).map(item => item?.id).filter(Boolean));
    if (window.OVOOperationRuntime) {
        const operationType = isSummary ? 'chat.summary' : (isBackground ? 'chat.background' : 'chat.reply');
        const displayName = chat.remarkName || chat.realName || chat.name || (chatType === 'group' ? '群聊' : '角色');
        operationRecord = window.OVOOperationRuntime.start(operationType, {
            title: isSummary ? `总结与${displayName}的对话` : (isBackground ? `${displayName}的后台回复` : `生成${displayName}的回复`),
            source: 'chat-ai-reply',
            scope: { chatId, chatType, characterName: displayName, isBackground, isSummary },
            stage: '准备聊天上下文'
        });
    }

    const memoryRoundToken = (chatType === 'private' && window.MemoryTablePolicy)
        ? window.MemoryTablePolicy.beginRound(chat, { isBackground, isSummary })
        : null;

    if (!isBackground) {
        replyAbortController = new AbortController();
        replyTaskKey = getChatReplyTaskKey(chatId, chatType);
        const typingName = chatType === 'private' ? (chat.remarkName || chat.realName || chat.name) : chat.name;
        activeChatReplyTasks.set(replyTaskKey, {
            chatId,
            chatType,
            displayName: typingName || '角色',
            controller: replyAbortController,
            operationId: operationRecord?.id || null,
            startedAt: Date.now()
        });
        syncChatReplyUiState();
        if (isTargetChatViewOpen(chatId, chatType) && typeof messageArea !== 'undefined' && messageArea) {
            messageArea.scrollTop = messageArea.scrollHeight;
        }
    }

    try {
        let requestBody;
        window.OVOOperationRuntime?.stage(operationRecord?.id, '准备聊天上下文');
        window.OVORetiredFeaturePolicy?.applyToDatabase?.(db);
        if (chatType === 'private') window.OVORetiredFeaturePolicy?.applyToCharacter?.(chat);
        let historySlice = getRequestHistorySlice(chat, chatType, chat.history);
        
        // 节点系统：上下文截断与记忆隔离
        if (chatType === 'private' && chat.activeNodeId && chat.nodes) {
            const activeNode = chat.nodes.find(n => n.id === chat.activeNodeId);
            if (activeNode) {
                let startIndex = -1;
                for (let i = chat.history.length - 1; i >= 0; i--) {
                    const m = chat.history[i];
                    if (m.isNodeBoundary && m.nodeAction === 'start' && m.nodeId === chat.activeNodeId) {
                        startIndex = i;
                        break;
                    }
                }
                if (startIndex !== -1) {
                    // 无论是否开启 readMemory，当前对话视口严格只保留节点内的消息
                    const nodeMsgs = chat.history.slice(startIndex + 1);
                    historySlice = getRequestHistorySlice(chat, chatType, nodeMsgs);
                }
            }
        }
        
        // 节点系统：过滤掉已收纳节点的消息
        if (chatType === 'private' && chat.nodes) {
            const archivedNodeIds = chat.nodes.filter(n => n.status === 'archived').map(n => n.id);
            if (archivedNodeIds.length > 0) {
                let currentArchivedNodeId = null;
                historySlice = historySlice.filter(m => {
                    if (m.isNodeBoundary) {
                        if (m.nodeAction === 'start' && archivedNodeIds.includes(m.nodeId)) {
                            currentArchivedNodeId = m.nodeId;
                            return false;
                        }
                        if (m.nodeAction === 'end' && m.nodeId === currentArchivedNodeId) {
                            currentArchivedNodeId = null;
                            return false;
                        }
                    }
                    if (currentArchivedNodeId) return false;
                    return true;
                });
            }
        }
        
        // 使用工具函数进行过滤（包含深度克隆、屏蔽过滤、双语修正、状态栏剔除）
        historySlice = filterHistoryForAI(chat, historySlice);
        historySlice = window.OVORetiredFeaturePolicy?.sanitizeHistory?.(historySlice) || historySlice;
        // 【新增】过滤掉不应进入上下文的消息（如思考过程、被撤回的消息标记等）
        historySlice = historySlice.filter(m => !m.isContextDisabled);
        
        // 【双重保险】再次过滤掉内容匹配 <thinking> 的消息，防止 isContextDisabled 属性丢失
        historySlice = historySlice.filter(m => {
            if (m.isThinking) return false;
            if (m.content && typeof m.content === 'string' && m.content.trim().startsWith('<thinking>')) return false;
            return true;
        });

        let weatherText = '';
        if (chatType === 'private' && window.WeatherService) {
            const charWeather = await window.WeatherService.getCharacterWeatherPrompt(chat);
            const userWeather = await window.WeatherService.getUserWeatherPrompt(chat);
            if (charWeather || userWeather) {
                weatherText = `\n<environment>\n${charWeather ? charWeather + '\n' : ''}${userWeather ? userWeather + '\n' : ''}</environment>\n`;
            }
        }

        let systemPrompt;
        window.OVOOperationRuntime?.stage(operationRecord?.id, chatType === 'private' ? '读取角色档案与长期记忆' : '读取群聊设定');
        if (chatType === 'private') {
            try {
                await prepareCombinedLongTermMemoryContext(chat);
            } catch (error) {
                console.warn('[MemoryContext] failed to prepare layered long-term memory:', error);
            }
            systemPrompt = generatePrivateSystemPrompt(chat, { isPhoneControlRevokeAttempt, weatherText, enableMemorySidecar: !isBackground && !isSummary });
            // 最终 payload 防线：结构化档案启用且已绑定模板时，任何自定义模板或节点分支都不能静默丢失档案。
            systemPrompt = ensureStructuredArchivePromptInjection(chat, systemPrompt);
            systemPrompt = window.OVORetiredFeaturePolicy?.sanitizeSystemPrompt?.(systemPrompt) || systemPrompt;
        } else {
            if (typeof generateGroupSystemPrompt === 'function') {
                systemPrompt = generateGroupSystemPrompt(chat);
            } else {
                systemPrompt = "Group chat system prompt not available.";
            }
        }

        // 消息时间属于内部上下文元数据，不允许模型把它作为可见聊天内容返回。
        systemPrompt = appendMessageMetadataProtocol(systemPrompt);

        // 检查是否开启了后台自动识图
        if (db.imageRecognitionEnabled) {
            let descApiConfig = (db.imageRecognitionApiSettings && db.imageRecognitionApiSettings.url && db.imageRecognitionApiSettings.key && db.imageRecognitionApiSettings.model) ? db.imageRecognitionApiSettings : db.apiSettings;
            
            // 从后往前找，只看开启之后的轮数（只找最新的一条用户消息）
            let lastUserMsg = null;
            for (let i = historySlice.length - 1; i >= 0; i--) {
                if (historySlice[i].role === 'user') {
                    lastUserMsg = historySlice[i];
                    break;
                }
            }

            if (lastUserMsg && lastUserMsg.parts) {
                const hasUnprocessedImage = lastUserMsg.parts.some(p => p.type === 'image' && !p.description);
                // 只有当有未处理图片且本消息还未触发过识图时才执行
                if (hasUnprocessedImage && !lastUserMsg.isImageRecognitionTriggered) {
                    const originalMsg = chat.history.find(m => m.id === lastUserMsg.id) || lastUserMsg;
                    // 打上标记，无论成功失败都只触发一次，避免死循环扣费
                    originalMsg.isImageRecognitionTriggered = true;
                    lastUserMsg.isImageRecognitionTriggered = true; 
                    
                    await persistChatEntity(chat, chatType); // 先保存一下标记；不依赖当前页面
                    
                    // 同步调用识图，等待结果后再继续，以便本轮主模型能看到图片描述
                    await generateImageDescription(originalMsg, chat, descApiConfig, operationRecord?.id || null, chatType);
                    
                    // 同步描述到 historySlice 的 lastUserMsg 中
                    lastUserMsg.parts.forEach((p, idx) => {
                        if (p.type === 'image' && originalMsg.parts[idx] && originalMsg.parts[idx].description) {
                            p.description = originalMsg.parts[idx].description;
                        }
                    });
                }
            }
        }

        if (provider === 'gemini') {
            let lastMsgTimeForAI = 0;
            const contents = historySlice.map(msg => {
                const role = (msg.role === 'assistant' || msg.role === 'char') ? 'model' : 'user';
                const currentMsgTime = Number(msg.timestamp) || 0;
                const timeDiff = lastMsgTimeForAI > 0 && currentMsgTime > 0 ? currentMsgTime - lastMsgTimeForAI : 0;
                let prefix = buildPromptMessageTimePrefix(currentMsgTime);
                if (db.apiSettings && db.apiSettings.timePerceptionEnabled && timeDiff > 30 * 60 * 1000) {
                    prefix += `[system: 距离上次互动已过去 ${formatTimeGap(timeDiff)}。话题可能已中断，请自然地开启新话题或对时间流逝做出反应。]
`;
                }
                if (currentMsgTime > 0) lastMsgTimeForAI = currentMsgTime;

                let parts;
                if (msg.role === 'user' && msg.quote) {
                    const replyTextMatch = msg.content.match(/\[.*?的消息：([\s\S]+?)\]/);
                    const replyText = replyTextMatch ? replyTextMatch[1] : msg.content;
                    let content = `[${chat.myName}引用“${msg.quote.content}”并回复：${replyText}]`;
                    parts = [{text: content}];
                } else if (msg.parts && msg.parts.length > 0) {
                    parts = msg.parts.map(p => {
                        if (p.type === 'text' || p.type === 'html') {
                            return {text: p.text};
                        } else if (p.type === 'image') {
                            if (p.description) {
                                return {text: `[图片描述：${p.description}]`};
                            } else {
                                const match = p.data.match(/^data:(image\/(.+));base64,(.*)$/);
                                if (match) {
                                    if (match[1] === 'image/gif') {
                                        return {text: `[动态图片(GIF)]`};
                                    }
                                    return {inline_data: {mime_type: match[1], data: match[3]}};
                                }
                            }
                        } else if (p.type === 'sticker') {
                            if (p.description) {
                                return {text: `[表情包画面：${p.description}]`};
                            } else {
                                return {text: `[一个表情包]`}; // 兜底，不再尝试发送表情包的原图数据给API
                            }
                        }
                        return null;
                    }).filter(p => p);
                } else {
                    let content = msg.content || '';
                    // 展开小剧场分享卡片
                    const theaterShareMatch = content.match(/\[小剧场分享[：:](.+?)\]/);
                    if (theaterShareMatch) {
                        const scenarioId = theaterShareMatch[1];
                        let scenario = null;
                        if (typeof db !== 'undefined' && db) {
                            if (Array.isArray(db.theaterScenarios)) {
                                scenario = db.theaterScenarios.find(s => s.id === scenarioId);
                            }
                            if (!scenario && Array.isArray(db.theaterHtmlScenarios)) {
                                scenario = db.theaterHtmlScenarios.find(s => s.id === scenarioId);
                            }
                        }
                        if (scenario) {
                            let readableContent = scenario.content || '';
                            if (scenario.mode === 'html' || /<[^>]+>/.test(readableContent)) {
                                readableContent = readableContent
                                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                                    .replace(/<[^>]+>/g, ' ')
                                    .replace(/\s{2,}/g, ' ')
                                    .trim();
                            }
                            const title = scenario.title || '小剧场';
                            const excerpt = readableContent;
                            content = content.replace(
                                /\[小剧场分享[：:].+?\]/,
                                `（我刚刚写了一篇小剧场，标题是「${title}」。以下是我写的内容：\n${excerpt}）`
                            );
                        }
                    }
                    parts = [{text: content}];
                }

                if (prefix) {
                    if (parts.length > 0 && parts[0].text) {
                        parts[0].text = prefix + parts[0].text;
                    } else {
                        parts.unshift({text: prefix});
                    }
                }
                
                if (msg.role === 'user' && chatType === 'private' && chat.characterAutoFavoriteEnabled && parts.length > 0 && parts[0].text) {
                    parts[0].text = '[id:' + msg.id + ']\n' + parts[0].text;
                }

                return { role, parts };
            });

            if (contents.length > 0 && contents[contents.length - 1].role === 'model' && !isBackground && !isCharBlockedMonologue) {
                contents.push({
                    role: 'user',
                    parts: [{ text: '[继续对话。]' }]
                });
            }

            if (isBackground) {
                contents.push({
                    role: 'user',
                    parts: [{ text: `[系统通知：距离上次互动已有一段时间。请以${chat.realName}的身份主动发起新话题，或自然地延续之前的对话。]` }]
                });
            }
            if (isCharBlockedMonologue) {
                contents.push({
                    role: 'user',
                    parts: [{ text: '[用户正在查看对话框，你可以主动说些什么。]' }]
                });
            }

            requestBody = {
                contents: contents,
                system_instruction: {parts: [{text: systemPrompt}]},
                generationConfig: {
                    temperature: db.apiSettings.temperature !== undefined ? db.apiSettings.temperature : 1.0
                }
            };
            
            // --- Gemini 联网搜索支持 ---
            if (!isBackground && !isSummary && chatType === 'private' && chat.webSearchEnabled) {
                let customPayload = null;
                if (chat.webSearchPayload && chat.webSearchPayload.trim()) {
                    try {
                        customPayload = JSON.parse(chat.webSearchPayload.trim());
                    } catch (e) {
                        console.error("解析自定义联网参数 JSON 失败:", e);
                    }
                }
                if (customPayload && typeof customPayload === 'object') {
                    Object.assign(requestBody, customPayload);
                } else {
                    requestBody.tools = [{ googleSearch: {} }];
                }
            }
        } else {
            const messages = [{role: 'system', content: systemPrompt}];
            
            let lastMsgTimeForAI = 0;
            
            historySlice.forEach(msg => {
               let content;
               const currentMsgTime = Number(msg.timestamp) || 0;
               const timeDiff = lastMsgTimeForAI > 0 && currentMsgTime > 0 ? currentMsgTime - lastMsgTimeForAI : 0;
               let prefix = buildPromptMessageTimePrefix(currentMsgTime);
               if (db.apiSettings && db.apiSettings.timePerceptionEnabled && timeDiff > 30 * 60 * 1000) {
                   prefix += `[system: 距离上次互动已过去 ${formatTimeGap(timeDiff)}。话题可能已中断，请自然地开启新话题或对时间流逝做出反应。]
`;
               }
               if (currentMsgTime > 0) lastMsgTimeForAI = currentMsgTime;

               if (msg.role === 'user' && msg.quote) {
                   const replyTextMatch = msg.content.match(/\[.*?的消息：([\s\S]+?)\]/);
                   const replyText = replyTextMatch ? replyTextMatch[1] : msg.content;
                   
                   let textContent = `${prefix}[${chat.myName}引用“${msg.quote.content}”并回复：${replyText}]`;
                   if (chatType === 'private' && chat.characterAutoFavoriteEnabled) {
                       textContent = '[id:' + msg.id + ']\n' + textContent;
                   }
                   content = [{type: 'text', text: textContent}];

               } else {
                   if (msg.parts && msg.parts.length > 0) {
                       let prefixAdded = false;
                       content = msg.parts.map(p => {
                           if (p.type === 'text' || p.type === 'html') {
                               const textContent = (!prefixAdded) ? (prefix + p.text) : p.text;
                               prefixAdded = true;
                               return {type: 'text', text: textContent};
                           } else if (p.type === 'image') {
                               if (p.description) {
                                   // 即便有描述，也同时把原图发给模型（如果模型支持的话）
                                   const textContent = (!prefixAdded) ? (prefix + `[图片描述：${p.description}]`) : `[图片描述：${p.description}]`;
                                   prefixAdded = true;
                                   return [
                                        {type: 'text', text: textContent},
                                        {type: 'image_url', image_url: {url: p.data}}
                                   ];
                               } else {
                                   return {type: 'image_url', image_url: {url: p.data}};
                               }
                           } else if (p.type === 'sticker') {
                               if (p.description) {
                                   const textContent = (!prefixAdded) ? (prefix + `[表情包画面：${p.description}]`) : `[表情包画面：${p.description}]`;
                                   prefixAdded = true;
                                   return {type: 'text', text: textContent};
                               } else {
                                   const textContent = (!prefixAdded) ? (prefix + `[一个表情包]`) : `[一个表情包]`;
                                   prefixAdded = true;
                                   return {type: 'text', text: textContent};
                               }
                           }
                           return null;
                       }).flat().filter(p => p);
                   } else {
                       content = prefix + msg.content;
                       const theaterShareMatch = content.match(/\[小剧场分享[：:](.+?)\]/);
                       if (theaterShareMatch) {
                           const scenarioId = theaterShareMatch[1];
                           let scenario = null;
                           if (typeof db !== 'undefined' && db) {
                               if (Array.isArray(db.theaterScenarios)) {
                                   scenario = db.theaterScenarios.find(s => s.id === scenarioId);
                               }
                               if (!scenario && Array.isArray(db.theaterHtmlScenarios)) {
                                   scenario = db.theaterHtmlScenarios.find(s => s.id === scenarioId);
                               }
                           }
                           if (scenario) {
                               let readableContent = scenario.content || '';
                               if (scenario.mode === 'html' || /<[^>]+>/.test(readableContent)) {
                                   readableContent = readableContent
                                       .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                                       .replace(/<[^>]+>/g, ' ')
                                       .replace(/\s{2,}/g, ' ')
                                       .trim();
                               }
                               const title = scenario.title || '小剧场';
                               const excerpt = readableContent;
                               content = content.replace(
                                   /\[小剧场分享[：:].+?\]/,
                                   `（我刚刚写了一篇小剧场，标题是「${title}」。以下是我写的内容：\n${excerpt}）`
                               );
                           }
                       }
                   }
                   if (msg.role === 'user' && chatType === 'private' && chat.characterAutoFavoriteEnabled) {
                       if (typeof content === 'string') {
                           content = '[id:' + msg.id + ']\n' + content;
                       } else if (Array.isArray(content) && content[0] && content[0].text) {
                           content[0].text = '[id:' + msg.id + ']\n' + content[0].text;
                       }
                   }
                   
                   if (typeof content === 'string') {
                       content = [{type: 'text', text: content}];
                   }
               }
               
               const role = (msg.role === 'assistant' || msg.role === 'char') ? 'assistant' : 'user';
               
               if (Array.isArray(content) && content.every(c => c.type === 'text')) {
                   messages.push({ role: role, content: content.map(c => c.text).join('') });
               } else {
                   messages.push({ role: role, content: content });
               }
            });

            if (messages.length > 1 && messages[messages.length - 1].role === 'assistant' && !isBackground && !isCharBlockedMonologue) {
                messages.push({
                    role: 'user',
                    content: '[继续对话。]'
                });
            }

            // === 【第三步：处理后台通知与 CoT 序列】 ===
            
            // 1. 如果是后台消息，先插入系统通知（作为任务输入）
            if (isBackground) {
                messages.push({
                    role: 'user',
                    content: `[系统通知：距离上次互动已有一段时间。请以${chat.realName}的身份主动发起新话题，或自然地延续之前的对话。]`
                });
            }
            if (isCharBlockedMonologue) {
                messages.push({
                    role: 'user',
                    content: '[用户正在查看对话框，你可以主动说些什么。]'
                });
            }

            // 2. 插入 CoT 序列（无论前台后台，只要开启就插入）
            let cotEnabled = false;
            let activePresetId = 'default';
            
            // 检查是否处于线下模式节点
            let isOfflineNode = false;
            if (chatType === 'private' && chat.activeNodeId && chat.nodes) {
                const activeNode = chat.nodes.find(n => n.id === chat.activeNodeId);
                if (activeNode) {
                    let baseMode = (activeNode.customConfig && activeNode.customConfig.baseMode) ? activeNode.customConfig.baseMode : 
                                   (activeNode.type === 'offline' || (activeNode.type === 'spinoff' && activeNode.spinoffMode === 'offline') ? 'offline' : 'online');
                    if (baseMode === 'offline') {
                        isOfflineNode = true;
                    }
                }
            }

            // 判断单人 CoT 设置
            let useCharCot = false;
            if (chatType === 'private' && chat.cotSettings && chat.cotSettings.enabled) {
                useCharCot = true;
            }

            if (isOfflineNode) {
                if (useCharCot) {
                    cotEnabled = chat.cotSettings.offlineEnabled;
                    activePresetId = chat.cotSettings.activeOfflinePresetId || 'default_offline';
                } else {
                    cotEnabled = db.cotSettings && db.cotSettings.offlineEnabled;
                    activePresetId = (db.cotSettings && db.cotSettings.activeOfflinePresetId) || 'default_offline';
                }
            } else {
                if (useCharCot) {
                    cotEnabled = chat.cotSettings.chatEnabled;
                    activePresetId = chat.cotSettings.activePresetId || 'default';
                } else {
                    cotEnabled = db.cotSettings && db.cotSettings.enabled;
                    activePresetId = (db.cotSettings && db.cotSettings.activePresetId) || 'default';
                }
            }
            
            if (cotEnabled) {
                let cotInstruction = '';
                const preset = (db.cotPresets || []).find(p => p.id === activePresetId);
                
                if (preset && preset.items) {
                    cotInstruction = preset.items
                        .filter(item => item.enabled)
                        .map(item => item.content)
                        .join('\n\n');
                }

                if (cotInstruction) {
                    // 1. 插入后置指令
                    messages.push({
                        role: 'system', // 或者 'user'
                        content: cotInstruction
                    });

                    // 2. 插入触发器
                    messages.push({
                        role: 'user',
                        content: '[incipere]'
                    });

                    // 3. 插入 Prefill (预填/强塞)
                    const quickReply = db.apiSettings && db.apiSettings.quickReplyEnabled;
                    messages.push({
                        role: 'assistant',
                        content: quickReply
                            ? '<thinking>\n跳过cot，专注回复\n</thinking>\n[finire]'
                            : '<thinking>'
                    });
                }
            }

        const outgoingMessages = normalizeMessagesForProvider(messages, provider);
        requestBody = {
            model: model, 
            messages: outgoingMessages, 
            stream: streamEnabled,
            temperature: db.apiSettings.temperature !== undefined ? db.apiSettings.temperature : 1.0
        };
        
        // --- 联网搜索支持 (仅为主聊天 API 请求启用) ---
        if (!isBackground && !isSummary && chatType === 'private' && chat.webSearchEnabled) {
            let customPayload = null;
            if (chat.webSearchPayload && chat.webSearchPayload.trim()) {
                try {
                    customPayload = JSON.parse(chat.webSearchPayload.trim());
                } catch (e) {
                    console.error("解析自定义联网参数 JSON 失败:", e);
                }
            }

            if (customPayload && typeof customPayload === 'object') {
                // 如果用户提供了自定义参数，将其合并进 requestBody
                Object.assign(requestBody, customPayload);
            } else {
                // 如果没有自定义参数，使用原生兼容方案
                if (provider === 'gemini') {
                    requestBody.tools = [{ googleSearch: {} }];
                } else {
                    requestBody.tools = [{ type: 'web_search' }];
                }
            }
        }
        }
        const requestTask = isSummary ? 'chat.summary' : (isBackground ? 'chat.background' : 'chat.reply');
        let compileResult = null;
        if (chatType === 'private') {
            // 先保证旧模板没有静默遗漏结构化记忆，再由唯一编译器应用真实开关、预算和历史裁剪。
            const preparedPayload = auditAndEnsurePrivateChatMemoryPayload(chat, requestBody, provider, operationRecord?.id || null, {
                enforceStructured: true,
                ensureStructured: true
            });
            requestBody = preparedPayload.requestBody;
            systemPrompt = preparedPayload.systemPrompt;
            compileResult = window.OVOContextCompiler?.compilePrivateChatRequest?.({
                task: requestTask,
                character: chat,
                provider,
                model,
                requestBody
            }) || null;
            if (compileResult) {
                requestBody = compileResult.requestBody;
                systemPrompt = compileResult.systemPrompt;
            }
            const policy = compileResult?.policy || window.OVOContextCompiler?.getPolicy?.() || {};
            const finalMemoryAudit = auditAndEnsurePrivateChatMemoryPayload(chat, requestBody, provider, operationRecord?.id || null, {
                enforceStructured: policy.structuredEnabled !== false && Number(policy.structuredBudget) > 0,
                ensureStructured: false
            });
            requestBody = finalMemoryAudit.requestBody;
            systemPrompt = finalMemoryAudit.systemPrompt;
            systemPrompt = window.OVORetiredFeaturePolicy?.sanitizeSystemPrompt?.(systemPrompt) || systemPrompt;
            writeSystemPromptToRequestBody(requestBody, provider, systemPrompt);
        }
        const promptSources = chatType === 'private'
            ? buildPrivateChatPromptSources(chat, systemPrompt)
            : [];
        const manifestBuilder = chatType === 'private'
            ? window.OVOContextSourceRegistry?.buildCompiledManifest
            : window.OVOContextSourceRegistry?.buildShadowManifest;
        const contextManifest = manifestBuilder?.({
            task: requestTask,
            scope: { chatId, chatType, characterId: chatType === 'private' ? chat.id : null },
            provider,
            model,
            requestBody,
            promptSources,
            policy: compileResult?.policy || null,
            compileChanges: compileResult?.changes || []
        }) || null;
        console.log('[DEBUG] AutoReply Request Body:', JSON.stringify(requestBody));
        window.OVOOperationRuntime?.stage(operationRecord?.id, '发送模型请求', {
            detail: `${provider || 'API'} · ${model || '未指定模型'}`
        });
        const endpoint = (provider === 'gemini') ? `${url}/v1beta/models/${model}:streamGenerateContent?key=${getRandomValue(key)}` : `${url}/v1/chat/completions`;
        const headers = (provider === 'gemini') ? {'Content-Type': 'application/json'} : {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`
        };
        if (!window.OVOAIRequestGateway?.send) throw new Error('统一 AI 请求网关尚未加载');
        const response = await window.OVOAIRequestGateway.send({
            task: requestTask,
            source: 'chat-ai-reply',
            provider,
            model,
            endpoint,
            headers,
            body: requestBody,
            operationId: operationRecord?.id || null,
            promptSources,
            contextManifest,
            signal: replyAbortController ? replyAbortController.signal : undefined,
            dedupeKey: isBackground ? '' : `chat-reply:${chatType}:${chatId}:${isSummary ? 'summary' : 'reply'}`,
            dedupeWindowMs: 1200
        });
        
        if (streamEnabled) {
            await processStream(response, chat, provider, chatId, chatType, isBackground, isCharBlockedMonologue, memoryRoundToken, operationRecord?.id || null);
        } else {
            let result;
            try {
                result = await response.json();
                console.log('【API完整响应数据】:', result);
            } catch (e) {
                const text = await response.text();
                console.error("Failed to parse JSON:", text);
                throw new Error(`API返回了非JSON格式数据 (可能是网页HTML)。请检查API地址是否正确。原始内容开头: ${text.substring(0, 50)}...`);
            }

            let fullResponse = "";
            if (provider === 'gemini') {
                fullResponse = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
            } else {
                fullResponse = result.choices[0].message.content;
            }
            
            // === 【补丁：把被吃掉的开头补回来】 ===
            // 仅在 CoT 开启且检测到闭合标签时补全
            let isOfflineNode = false;
            if (chatType === 'private' && chat.activeNodeId && chat.nodes) {
                const activeNode = chat.nodes.find(n => n.id === chat.activeNodeId);
                if (activeNode) {
                    let baseMode = (activeNode.customConfig && activeNode.customConfig.baseMode) ? activeNode.customConfig.baseMode : 
                                   (activeNode.type === 'offline' || (activeNode.type === 'spinoff' && activeNode.spinoffMode === 'offline') ? 'offline' : 'online');
                    if (baseMode === 'offline') {
                        isOfflineNode = true;
                    }
                }
            }
            
            let useCharCot = false;
            if (chatType === 'private' && chat.cotSettings && chat.cotSettings.enabled) {
                useCharCot = true;
            }
            
            let cotEnabled = false;
            if (isOfflineNode) {
                cotEnabled = useCharCot ? chat.cotSettings.offlineEnabled : (db.cotSettings && db.cotSettings.offlineEnabled);
            } else {
                cotEnabled = useCharCot ? chat.cotSettings.chatEnabled : (db.cotSettings && db.cotSettings.enabled);
            }
            // 【修改】去掉了 !isBackground，确保后台模式也能正确补全标签
            if (cotEnabled && fullResponse && !fullResponse.trim().startsWith('<thinking>')) {
                 if (fullResponse.includes('</thinking>')) {
                     fullResponse = '<thinking>' + fullResponse;
                 }
            }
            // ===================================
            
            
            await handleAiReplyContent(fullResponse, chat, chatId, chatType, isBackground, isCharBlockedMonologue, memoryRoundToken, operationRecord?.id || null);
        }

        if (operationRecord) {
            const historyNow = Array.isArray(chat.history) ? chat.history : [];
            const createdMessages = historyNow.filter(item => item?.id && !historyIdsBefore.has(item.id));
            const addedMessages = createdMessages.length || Math.max(0, historyNow.length - historyCountBefore);
            const messageMutations = createdMessages.slice(0, 40).map(message => {
                const roleLabel = message.isThinking ? '隐藏思考记录' : message.isNodeSummaryMsg ? '节点摘要' : (message.role === 'user' ? '用户消息' : message.role === 'system' ? '系统消息' : '角色消息');
                const text = String(message.content || (Array.isArray(message.parts) ? message.parts.map(part => part?.text || '').join('') : '') || '').trim();
                return {
                    action: 'create',
                    entityType: 'chat_message',
                    entityId: message.id,
                    title: roleLabel,
                    summary: text ? (text.length > 120 ? `${text.slice(0, 120)}…` : text) : '已新增一条消息记录',
                    after: text,
                    meta: { role: message.role || '', timestamp: message.timestamp || null, hidden: !!(message.isThinking || message.isContextDisabled || message.hiddenFromDisplay), chatId, chatType }
                };
            });
            if (createdMessages.length > 40) messageMutations.push({
                action: 'create', entityType: 'chat_message', count: createdMessages.length - 40,
                title: '其他新增消息', summary: `另有 ${createdMessages.length - 40} 条消息未逐条展开`, meta: { chatId, chatType }
            });
            window.OVOOperationRuntime.recordMutations?.(operationRecord.id, messageMutations);
            window.OVOOperationRuntime.complete(operationRecord.id, {
                summary: isSummary ? '对话总结已完成' : `回复已完成，新增 ${addedMessages} 条记录`,
                result: { chatId, chatType, addedMessages, messageIds: createdMessages.map(item => item.id).slice(0, 80), model, provider }
            });
            operationFinished = true;
        }
    } catch (error) {
        if (memoryRoundToken && window.MemoryTablePolicy) {
            window.MemoryTablePolicy.cancelRound(chat, memoryRoundToken);
        }
        if (error.name === 'AbortError') {
            if (operationRecord && !operationFinished) window.OVOOperationRuntime?.cancel(operationRecord.id, '模型请求已中止');
            if (!isBackground && typeof showToast === 'function') showToast('模型请求已中止');
        } else {
            if (operationRecord && !operationFinished) window.OVOOperationRuntime?.fail(operationRecord.id, error);
            if (!isBackground) showApiError(error);
            else console.error("Background Auto-Reply Error:", error);
        }
        operationFinished = true;
    } finally {
        if (!isBackground) {
            if (replyTaskKey && activeChatReplyTasks.get(replyTaskKey)?.controller === replyAbortController) {
                activeChatReplyTasks.delete(replyTaskKey);
            }
            syncChatReplyUiState();
        }
    }
}

async function processStream(response, chat, apiType, targetChatId, targetChatType, isBackground = false, isCharBlockedMonologue = false, memoryRoundToken = null, parentOperationId = null) {
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let fullResponse = "", accumulatedChunk = "";
    for (; ;) {
        const {done, value} = await reader.read();
        if (done) break;
        accumulatedChunk += decoder.decode(value, {stream: true});
        if (apiType === "openai" || apiType === "deepseek" || apiType === "claude" || apiType === "newapi") {
            const parts = accumulatedChunk.split("\n\n");
            accumulatedChunk = parts.pop();
            for (const part of parts) {
                if (part.startsWith("data: ")) {
                    const data = part.substring(6);
                    if (data.trim() !== "[DONE]") {
                        try {
                            fullResponse += JSON.parse(data).choices[0].delta?.content || "";
                        } catch (e) { 
                        }
                    }
                }
            }
        }
    }
    if (apiType === "gemini") {
        try {
            const parsedStream = JSON.parse(accumulatedChunk);
            fullResponse = parsedStream.map(item => item.candidates?.[0]?.content?.parts?.[0]?.text || "").join('');
        } catch (e) {
            console.error("Error parsing Gemini stream:", e, "Chunk:", accumulatedChunk);
            if (!isBackground) showToast("解析Gemini响应失败");
            return;
        }
    }
    // === 【补丁：补全流式输出时丢失的开头标签】 ===
    // 无论前台后台，只要是CoT开启且被预填吃掉了开头，都要补回来
    let isOfflineNode = false;
    if (targetChatType === 'private' && chat.activeNodeId && chat.nodes) {
        const activeNode = chat.nodes.find(n => n.id === chat.activeNodeId);
        if (activeNode) {
            let baseMode = (activeNode.customConfig && activeNode.customConfig.baseMode) ? activeNode.customConfig.baseMode : 
                           (activeNode.type === 'offline' || (activeNode.type === 'spinoff' && activeNode.spinoffMode === 'offline') ? 'offline' : 'online');
            if (baseMode === 'offline') {
                isOfflineNode = true;
            }
        }
    }
    
    let useCharCot = false;
    if (targetChatType === 'private' && chat.cotSettings && chat.cotSettings.enabled) {
        useCharCot = true;
    }
    
    let cotEnabled = false;
    if (isOfflineNode) {
        cotEnabled = useCharCot ? chat.cotSettings.offlineEnabled : (db.cotSettings && db.cotSettings.offlineEnabled);
    } else {
        cotEnabled = useCharCot ? chat.cotSettings.chatEnabled : (db.cotSettings && db.cotSettings.enabled);
    }
    // 【修改】去掉了 !isBackground，确保后台模式也能正确补全标签
    if (cotEnabled && fullResponse && !fullResponse.trim().startsWith('<thinking>')) {
         // 这里判断：如果内容里有闭合的 </thinking> 但开头没有 <thinking>，说明开头被 Prefill 吃掉了
         if (fullResponse.includes('</thinking>')) {
             fullResponse = '<thinking>' + fullResponse;
         }
    }

    // ===================
    await handleAiReplyContent(fullResponse, chat, targetChatId, targetChatType, isBackground, isCharBlockedMonologue, memoryRoundToken, parentOperationId);
}

/** 返回该角色在手机掌控下可见的角色与群聊（未开启角色过滤则返回全部，开启则只返回指定的角色及所在群聊） */
function getPhoneControlVisibleChats(controllingChar) {
    if (!controllingChar.phoneControlCharFilterEnabled || !controllingChar.phoneControlVisibleCharIds || controllingChar.phoneControlVisibleCharIds.length === 0) {
        return {
            characters: (db.characters || []).filter(c => c.id !== controllingChar.id),
            groups: db.groups || []
        };
    }
    const visibleIds = controllingChar.phoneControlVisibleCharIds;
    const characters = (db.characters || []).filter(c => {
        if (c.id === controllingChar.id) return false;
        if (visibleIds.includes(c.id)) return true;
        return false;
    });
    
    // 群聊如果包含任意一个可见角色，则也视为可见
    const groups = (db.groups || []).filter(g => {
        if (!g.members || g.members.length === 0) return false;
        // 群聊成员里有没有在可见角色列表中的
        return g.members.some(m => visibleIds.includes(m.originalCharId));
    });
    return { characters, groups };
}

/** 解析并执行 [phone-control:action|key:value...] 指令，返回清理后的文本与是否执行过指令 */
function executePhoneControlCommands(text, controllingChar) {
    if (!text || !controllingChar || !controllingChar.phoneControlEnabled) return { cleaned: text, executed: false };
    const regex = /\[phone-control:([^\|\]]+)(?:\|([^\]]*))?\]/g;
    let match;
    const toRemove = [];
    let executed = false;
    while ((match = regex.exec(text)) !== null) {
        const action = (match[1] || '').trim().toLowerCase();
        const paramStr = (match[2] || '').trim();
        const params = {};
        paramStr.split(/\|/).forEach(p => {
            const colon = p.indexOf(':');
            if (colon > 0) {
                const k = p.slice(0, colon).trim().toLowerCase();
                const v = p.slice(colon + 1).trim();
                params[k] = v;
            }
        });
        const targetName = (params.target || '').trim().replace(/^["'\s]+|["'\s]+$/g, '');
        const limit = Math.min(100, Math.max(5, parseInt(controllingChar.phoneControlViewLimit, 10) || 10));

        const pushHistory = (type, actionName, target, detail) => {
            if (!Array.isArray(controllingChar.phoneControlHistory)) controllingChar.phoneControlHistory = [];
            controllingChar.phoneControlHistory.push({ type, action: actionName, target: target || undefined, detail: detail || undefined, timestamp: Date.now() });
            if (typeof saveCharacter === 'function') saveCharacter(controllingChar.id);
            executed = true;
        };

        const { characters: visibleChars, groups: visibleGroups } = getPhoneControlVisibleChats(controllingChar);
        const findTargetChat = () => {
            const c = visibleChars.find(x => x.remarkName === targetName || x.realName === targetName);
            if (c) return { chat: c, chatId: c.id, chatType: 'private', name: c.remarkName || c.realName };
            const g = visibleGroups.find(x => x.name === targetName);
            if (g) return { chat: g, chatId: g.id, chatType: 'group', name: g.name };
            return null;
        };

        if (action === 'view-chat-list') {
            const pad = (n) => (n < 10 ? '0' + n : '' + n);
            const others = visibleChars;
            const groupList = visibleGroups;
            const chatItems = [
                ...others.map(c => ({ name: c.remarkName || c.realName || '未知', type: 'private', lastMsg: (c.history && c.history.length) ? c.history[c.history.length - 1] : null })),
                ...groupList.map(g => ({ name: g.name || '群聊', type: 'group', lastMsg: (g.history && g.history.length) ? g.history[g.history.length - 1] : null }))
            ].sort((a, b) => (b.lastMsg ? b.lastMsg.timestamp : 0) - (a.lastMsg ? a.lastMsg.timestamp : 0));
            let listText = '【用户聊天列表概览】\n';
            if (chatItems.length === 0) listText += '（暂无其他聊天）\n';
            else {
                chatItems.slice(0, 30).forEach(item => {
                    let preview = '…';
                    if (item.lastMsg) {
                        const raw = (item.lastMsg.content || '').trim();
                        const plain = raw.replace(/^\[.*?：([\s\S]*)\]$/, '$1').replace(/\[.*?\]/g, '').trim();
                        preview = plain.length > 25 ? plain.slice(0, 25) + '…' : plain || '…';
                    }
                    const t = item.lastMsg && item.lastMsg.timestamp ? new Date(item.lastMsg.timestamp) : null;
                    const timeStr = t ? `${pad(t.getMonth() + 1)}/${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}` : '';
                    listText += `- ${item.name}（${item.type === 'group' ? '群聊' : '私聊'}）：${preview} ${timeStr}\n`;
                });
            }
            controllingChar.phoneControlLastViewChatListResult = listText;
            pushHistory('view', 'view-chat-list', '', '聊天列表');
            toRemove.push(match[0]);
        } else if (action === 'read-chat' && targetName) {
            const found = findTargetChat();
            if (found) {
                const hist = (found.chat.history || []).filter(m => !m.isContextDisabled && !m.isThinking).slice(-limit);
                const lines = hist.map(m => {
                    const role = m.role === 'user' ? '用户' : (found.chatType === 'group' ? ((m.role === 'assistant' || m.role === 'char') ? m.name || '角色' : '用户') : (found.chat.realName || found.chat.remarkName));
                    const content = (m.content || '').replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim().slice(0, 200);
                    return `${role}：${content}`;
                });
                controllingChar.phoneControlLastReadResult = { targetName: found.name, chatId: found.chatId, chatType: found.chatType, lines };
                pushHistory('view', 'read-chat', targetName, `最近${lines.length}条`);
            }
            toRemove.push(match[0]);
        } else if (action === 'send-message' && targetName) {
            const content = (params.content || '').trim();
            if (content) {
                const found = findTargetChat();
                if (found) {
                    const lines = content.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                    const count = lines.length || 1;
                    const toSend = lines.length ? lines : [content];
                    let baseTs = Date.now();
                    if (!found.chat.history) found.chat.history = [];
                    toSend.forEach((line, i) => {
                        found.chat.history.push({
                            id: 'msg_' + (baseTs + i) + '_' + Math.random().toString(36).slice(2),
                            role: 'user',
                            content: line,
                            timestamp: baseTs + i,
                            sentByCharControl: true,
                            controllingCharId: controllingChar.id
                        });
                    });
                    pushHistory('action', 'send-message', targetName, count > 1 ? count + '条' : toSend[0].slice(0, 50));
                    if (typeof saveCharacter === 'function') saveCharacter(controllingChar.id);
                }
            }
            toRemove.push(match[0]);
        } else if (action === 'delete-character' && targetName) {
            const c = visibleChars.find(x => x.remarkName === targetName || x.realName === targetName);
            if (c) {
                if (!Array.isArray(db.phoneControlRecycleBin)) db.phoneControlRecycleBin = [];
                db.phoneControlRecycleBin.push({ ...c, recycledAt: Date.now(), recycledByCharId: controllingChar.id });
                db.characters = db.characters.filter(x => x.id !== c.id);
                pushHistory('action', 'delete-character', targetName, '已移入回收站');
                if (typeof saveCharacter === 'function') saveCharacter(controllingChar.id);
                if (typeof renderChatList === 'function') renderChatList();
            }
            toRemove.push(match[0]);
        } else if (action === 'toggle-setting' && targetName && params.setting) {
            const c = visibleChars.find(x => x.remarkName === targetName || x.realName === targetName);
            if (c) {
                const key = params.setting;
                const val = (params.value || '').toLowerCase() === 'on' || (params.value || '').toLowerCase() === 'true';
                if (key === 'videocallenabled' || key === 'videoCallEnabled') { c.videoCallEnabled = val; pushHistory('action', 'toggle-setting', targetName, 'videoCallEnabled=' + val); }
                else if (key === 'canblockuser' || key === 'canBlockUser') { c.canBlockUser = val; pushHistory('action', 'toggle-setting', targetName, 'canBlockUser=' + val); }
                if (typeof saveCharacter === 'function') saveCharacter(controllingChar.id);
            }
            toRemove.push(match[0]);
        } else if (action === 'clear-history' && targetName) {
            const found = findTargetChat();
            if (found) {
                const count = (found.chat.history || []).length;
                found.chat.history = [];
                // 清除拉黑相关记忆
                found.chat.blockHistory = [];
                found.chat.friendRequests = [];
                found.chat.charBlockHistory = [];
                found.chat.userFriendRequests = [];
                found.chat.isBlocked = false;
                found.chat.blockedAt = null;
                found.chat.blockReapply = null;
                found.chat.isBlockedByChar = false;
                found.chat.blockedByCharAt = null;
                found.chat.blockedByCharReason = null;
                pushHistory('action', 'clear-history', targetName, '清空' + count + '条');
                if (typeof saveCharacter === 'function') saveCharacter(controllingChar.id);
                if (typeof saveCharacter === 'function' && found.chatType === 'private') saveCharacter(found.chatId);
                if (typeof saveGroup === 'function' && found.chatType === 'group') saveGroup(found.chatId);
                if (typeof renderChatList === 'function') renderChatList();
            }
            toRemove.push(match[0]);
        }
    }
    let cleaned = text;
    toRemove.forEach(s => { cleaned = cleaned.replace(s, ''); });
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    return { cleaned, executed };
}

async function handleAiReplyContent(fullResponse, chat, targetChatId, targetChatType, isBackground = false, isCharBlockedMonologue = false, memoryRoundToken = null, parentOperationId = null) {
    const rawResponse = fullResponse;
    // 双保险：即使模型复述了内部时间元数据，也不能把它解析成独立聊天气泡。
    fullResponse = stripPromptMetadataEcho(fullResponse);
    if (fullResponse && targetChatType === 'private' && window.MemoryTableSidecar) {
        const runtime = window.OVOOperationRuntime;
        const sidecarOperation = runtime?.startChild?.(parentOperationId, 'memory.sidecar', {
            title: '检查回复内档案更新',
            source: 'chat-reply-sidecar',
            scope: { characterId: targetChatId },
            stage: '解析回复中的档案更新指令'
        }) || null;
        const sidecarResult = typeof window.MemoryTableSidecar.processReply === 'function'
            ? await window.MemoryTableSidecar.processReply(chat, fullResponse, { roundId: memoryRoundToken?.id || null })
            : (() => {
                const parsed = window.MemoryTableSidecar.extractSidecar(fullResponse);
                return Object.assign({}, parsed, { report: null });
            })();
        fullResponse = sidecarResult.cleaned;
        const report = sidecarResult.report || window.MemoryTableSidecar.ensureState(chat)?.lastApplyReport || {};
        if (sidecarResult.error) {
            console.warn('[MemorySidecar] parse failed; internal payload removed:', sidecarResult.error);
            if (!sidecarResult.report && typeof window.MemoryTableSidecar.completeRound === 'function') {
                window.MemoryTableSidecar.completeRound(chat, { error: sidecarResult.error.message || String(sidecarResult.error), roundId: memoryRoundToken?.id || null });
            }
            if (sidecarOperation) runtime.fail(sidecarOperation.id, sidecarResult.error, { summary: '档案更新指令解析失败，内部指令已从聊天正文移除' });
        } else if (sidecarResult.payload) {
            if (!sidecarResult.report) {
                runtime?.stage?.(sidecarOperation?.id, '应用档案更新指令');
                await window.MemoryTableSidecar.applySidecar(chat, sidecarResult.payload, { roundId: memoryRoundToken?.id || null });
            }
            const finalReport = sidecarResult.report || window.MemoryTableSidecar.ensureState(chat)?.lastApplyReport || {};
            const changedCount = Array.isArray(finalReport.changed) ? finalReport.changed.length : 0;
            const rejectedCount = Array.isArray(finalReport.rejected) ? finalReport.rejected.length : 0;
            if (sidecarOperation) {
                runtime.recordMutations?.(sidecarOperation.id, (Array.isArray(finalReport.changed) ? finalReport.changed : []).map(change => {
                    const mutation = describeStructuredMemoryChange(chat, change);
                    mutation.meta = Object.assign({}, mutation.meta, { roundId: memoryRoundToken?.id || null });
                    return mutation;
                }));
                runtime.complete(sidecarOperation.id, {
                    summary: changedCount ? `已应用 ${changedCount} 项档案更新` : (rejectedCount ? `没有应用更新，拒绝 ${rejectedCount} 项` : '没有可应用的档案变化'),
                    result: { changedCount, rejectedCount, changed: (finalReport.changed || []).slice(0, 100), rejected: (finalReport.rejected || []).slice(0, 100), roundId: memoryRoundToken?.id || null }
                });
            }
        } else {
            if (!sidecarResult.report && typeof window.MemoryTableSidecar.completeRound === 'function') {
                window.MemoryTableSidecar.completeRound(chat, { reason: 'no_update', roundId: memoryRoundToken?.id || null });
            }
            if (sidecarOperation) runtime.skip(sidecarOperation.id, '模型回复中没有携带档案更新指令', { result: { changedCount: 0 } });
        }
    }

    if (fullResponse) {
        // 1. 移除 [incipere] 标签
        fullResponse = fullResponse.replace(/\[incipere\]/g, "");
        fullResponse = window.OVORetiredFeaturePolicy?.sanitizeModelOutput?.(fullResponse) || fullResponse;

        // 1.5 提取并执行角色收藏指令，然后从展示内容中移除。
        // 新协议只接受消息ID、标签和寄语；正文始终由程序从当前聊天历史读取。
        const favoriteCommands = [];
        const favoriteOpsRegex = /<favorite_ops\b[^>]*>([\s\S]*?)<\/favorite_ops>/gi;
        let favoriteOpsMatch;
        while ((favoriteOpsMatch = favoriteOpsRegex.exec(fullResponse)) !== null) {
            try {
                const rawPayload = String(favoriteOpsMatch[1] || '').trim()
                    .replace(/^```(?:json)?\s*/i, '')
                    .replace(/\s*```$/i, '');
                const payload = JSON.parse(rawPayload);
                const items = Array.isArray(payload?.items) ? payload.items : [];
                items.slice(0, 3).forEach(item => {
                    const messageId = String(item?.messageId || '').trim();
                    if (!/^msg_[^\s:<>]+$/.test(messageId)) return;
                    const rawTags = Array.isArray(item?.tags) ? item.tags : String(item?.tags || '').split(/[,，、]/u);
                    const tags = Array.from(new Set(rawTags.map(value => String(value || '').trim()).filter(Boolean))).slice(0, 8);
                    favoriteCommands.push({ messageId, tags, note: String(item?.note || '').trim().slice(0, 80) });
                });
            } catch (error) {
                console.warn('[FavoriteMemory] 无法解析favorite_ops', error);
            }
        }
        fullResponse = fullResponse.replace(favoriteOpsRegex, '');

        // 兼容旧模型仍输出的[FAVORITE:消息ID:寄语]格式。
        const legacyFavoriteRegex = /\[FAVORITE:(msg_[^\]:]+):([^\]]*)\]/g;
        let legacyFavoriteMatch;
        while ((legacyFavoriteMatch = legacyFavoriteRegex.exec(fullResponse)) !== null) {
            favoriteCommands.push({ messageId: legacyFavoriteMatch[1], tags: [], note: (legacyFavoriteMatch[2] || '').trim() });
        }
        fullResponse = fullResponse.replace(legacyFavoriteRegex, '').replace(/\n{3,}/g, '\n\n').trim();
        if (targetChatType === 'private' && chat.characterAutoFavoriteEnabled && typeof addCharacterFavorite === 'function') {
            favoriteCommands.slice(0, 3).forEach(function(cmd) {
                addCharacterFavorite(cmd.messageId, targetChatId, cmd.note, cmd.tags);
            });
        }

        // 1.6 提取并执行头像系统指令，然后从展示内容中移除
        if (targetChatType === 'private' && chat.avatarSystemEnabled && window.AvatarSystem) {
            const avatarResult = window.AvatarSystem.parseAvatarCommands(fullResponse, targetChatId);
            fullResponse = avatarResult.cleaned;
            if (avatarResult.actions.length > 0) {
                window.AvatarSystem.executeAvatarActions(avatarResult.actions, targetChatId);
            }
        }

        // 1.7 捕获并分离 <thinking> 内容 (必须在提取摘要前执行，防止思维链内部的摘要标签被误提取)
        const thinkingMatch = fullResponse.match(/<thinking>([\s\S]*)<\/thinking>/);
        if (thinkingMatch) {
            const thinkingContent = thinkingMatch[0]; // 包含标签的完整内容
            
            // 创建思考过程消息对象
            const thinkingMsg = {
                id: `msg_${Date.now()}_${Math.random()}`,
                role: 'assistant',
                content: thinkingContent,
                timestamp: Date.now(),
                isThinking: true,
                isContextDisabled: true // 【关键】标记为不进入上下文
            };
            
            // 存入历史记录
            chat.history.push(thinkingMsg);

            // 【新增】清理旧的思维链消息，仅保留最近 50 条
            const maxThinkingMsgs = 50;
            let thinkingCount = 0;
            const idsToRemove = new Set();
            // 从后往前遍历，保留最近的 50 个，其他的标记为待删除
            for (let i = chat.history.length - 1; i >= 0; i--) {
                if (chat.history[i].isThinking) {
                    thinkingCount++;
                    if (thinkingCount > maxThinkingMsgs) {
                        idsToRemove.add(chat.history[i].id);
                    }
                }
            }
            if (idsToRemove.size > 0) {
                chat.history = chat.history.filter(m => !idsToRemove.has(m.id));
            }
            
            // 添加到界面气泡（由于 regex 设置，会被隐藏，仅 Debug 模式可见）
            appendMessageBubbleForTarget(thinkingMsg, targetChatId, targetChatType);
            
            // 从即将显示的文本中移除思考内容
            fullResponse = fullResponse.replace(thinkingContent, "");
        }

        if (db.globalReceiveSound) {
            playSound(db.globalReceiveSound);
        }
        // ... 后续代码保持不变 ...
        console.log('【AI原始返回内容】:', rawResponse);
        let cleanedResponse = fullResponse.replace(/^\[system:.*?\]\s*/, '').replace(/^\(时间:.*?\)\s*/, '');
        const trimmedResponse = cleanedResponse.trim();
        let messages;

        if (trimmedResponse.startsWith('<uwuxjc>') && trimmedResponse.endsWith('</uwuxjc>')) {
            messages = [{ type: 'html', content: trimmedResponse }];
        } else {
            messages = getMixedContent(fullResponse).filter(item => item.content.trim() !== '');
        }

        let firstMessageProcessed = false;

        for (const item of messages) {
            // 自动剔除不存在的表情包
            const stickerRegex = /\[(?:.*?的)?表情包：(.+?)\]/i;
            const stickerMatch = item.content.match(stickerRegex);
            if (stickerMatch) {
                let stickerName = stickerMatch[1].trim();
                // 剔除AI可能带上的 (画面:xxx) 的后缀
                const descIndex = stickerName.indexOf('(画面:');
                if (descIndex !== -1) {
                    stickerName = stickerName.substring(0, descIndex).trim();
                }
                // 兼容部分 AI 可能生成全角括号的情况 （画面：xxx）
                const descIndexFull = stickerName.indexOf('（画面:');
                if (descIndexFull !== -1) {
                    stickerName = stickerName.substring(0, descIndexFull).trim();
                }
                const descIndexFull2 = stickerName.indexOf('（画面：');
                if (descIndexFull2 !== -1) {
                    stickerName = stickerName.substring(0, descIndexFull2).trim();
                }
                const descIndexFull3 = stickerName.indexOf('(画面：');
                if (descIndexFull3 !== -1) {
                    stickerName = stickerName.substring(0, descIndexFull3).trim();
                }

                const groups = (chat.stickerGroups || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
                let targetSticker = null;
                
                // 1. 优先在绑定分组中查找
                if (groups.length > 0) {
                    targetSticker = db.myStickers.find(s => groups.includes(s.group) && s.name === stickerName);
                }
                
                // 2. 兜底在所有表情包中查找
                if (!targetSticker) {
                    targetSticker = db.myStickers.find(s => s.name === stickerName);
                }
                
                // 3. 如果完全找不到，则剔除该消息
                if (!targetSticker) {
                    console.log(`[Auto-Filter] 剔除不存在的表情包: ${stickerName}`);
                    continue; 
                }
            }

            // --- 视频/语音通话邀请检测 ---
            const callInviteRegex = /\[(.*?)向(.*?)发起了(视频|语音)通话\]/;
            const callInviteMatch = item.content.match(callInviteRegex);
            if (callInviteMatch) {
                const type = callInviteMatch[3] === '视频' ? 'video' : 'voice';
                // 触发来电界面
                if (false && window.VideoCallModule && typeof window.VideoCallModule.receiveCall === 'function') {
                    window.VideoCallModule.receiveCall(type);
                }
                // 不将此消息显示为普通气泡，或者显示为系统通知
                // 这里选择显示为系统通知样式的消息
                const message = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'system', // 使用 system 角色
                    content: item.content.trim(),
                    timestamp: Date.now()
                };
                chat.history.push(message);
                appendMessageBubbleForTarget(message, targetChatId, targetChatType);
                continue; // 跳过后续处理
            }

            if (targetChatType === 'private') {
                const char = db.characters.find(c => c.id === targetChatId);
                // 解析隐藏的 [char-action:block-user|reason:xxx]，触发角色拉黑用户（仅当角色开启 canBlockUser 时）
                if (char && char.canBlockUser !== false) {
                    const blockUserMatch = item.content.match(/\[char-action:block-user\|reason:([^\]]*)\]/);
                    if (blockUserMatch) {
                        if (typeof window.charBlockUser === 'function') window.charBlockUser(targetChatId, (blockUserMatch[1] || '').trim());
                        item.content = item.content.replace(/\[char-action:block-user\|reason:[^\]]*\]/g, '').trim();
                        if (!item.content || !item.content.trim()) continue;
                    }
                }
                if (char && char.statusPanel && char.statusPanel.enabled && char.statusPanel.regexPattern) {
                    try {
                        let pattern = char.statusPanel.regexPattern;
                        let flags = 'gs'; 

                        const matchParts = pattern.match(/^\/(.*?)\/([a-z]*)$/);
                        if (matchParts) {
                            pattern = matchParts[1];
                            flags = matchParts[2] || 'gs';
                            if (!flags.includes('s')) flags += 's';
                        }

                    const regex = new RegExp(pattern, flags);
                    const match = regex.exec(item.content);
                    
                    if (match) {
                        const rawStatus = match[0];
                        
                        let html = char.statusPanel.replacePattern;
                        
                            // 使用正则一次性查找模板中的 $数字 并替换
    html = html.replace(/\$(\d+)/g, (fullMatch, groupIndex) => {
        const index = parseInt(groupIndex, 10);
        // 如果捕获组存在，则返回对应内容；否则保持原样
        return (match[index] !== undefined) ? match[index] : fullMatch;
    });


                        // Save to history
                        if (!char.statusPanel.history) char.statusPanel.history = [];
                        
                        // Add new status to the beginning
                        char.statusPanel.history.unshift({
                            raw: rawStatus,
                            html: html,
                            timestamp: Date.now()
                        });

                        // Keep only last 20 items
                        if (char.statusPanel.history.length > 20) {
                            char.statusPanel.history = char.statusPanel.history.slice(0, 20);
                        }

                        char.statusPanel.currentStatusRaw = rawStatus;
                        char.statusPanel.currentStatusHtml = html;
                        
                        item.isStatusUpdate = true;
                        // 仅保存后续逻辑实际使用的正则。replacePattern 可能很大，
                        // 且历史消息从未读取它；逐条复制会造成严重重复。
                        item.statusSnapshot = { regex: pattern };
                        }
                    } catch (e) {
                        console.error("状态栏正则解析错误:", e);
                    }
                }
                // 解析并执行 [更换主题：主题名]（你与用户共用的对话主题）
                if (char && char.allowCharSwitchBubbleCss && Array.isArray(char.bubbleCssThemeBindings) && char.bubbleCssThemeBindings.length > 0) {
                    const themeSwitchRegex = /\[更换主题[：:]\s*([^\]\n]+)\]/g;
                    let themeSwitchMatch;
                    let contentAfterStrip = item.content;
                    while ((themeSwitchMatch = themeSwitchRegex.exec(item.content)) !== null) {
                        let themeName = themeSwitchMatch[1].trim().replace(/^[「『"【\[]+/, '').replace(/[」』"】\]]+$/, '').trim();
                        const binding = char.bubbleCssThemeBindings.find(b => b.presetName === themeName);
                        const preset = binding && (db.bubbleCssPresets || []).find(p => p.name === binding.presetName);
                        if (preset) {
                            chat.customBubbleCss = preset.css;
                            chat.useCustomBubbleCss = true;
                            char.currentBubbleCssPresetName = preset.name;
                            if (typeof updateCustomBubbleStyle === 'function') updateCustomBubbleStyle(targetChatId, preset.css, true);
                            await persistChatEntity(chat, targetChatType);
                            contentAfterStrip = contentAfterStrip.replace(themeSwitchMatch[0], '').replace(/\n{3,}/g, '\n\n').trim();
                        }
                    }
                    item.content = contentAfterStrip;
                    if (!item.content || !item.content.trim()) continue; // 仅更换主题时不再追加空消息
                }
            }

            // 如果是后台模式，跳过延迟，直接处理
            if (!isBackground) {
                const delay = firstMessageProcessed ? (900 + Math.random() * 1300) : (400 + Math.random() * 400);
                await new Promise(resolve => setTimeout(resolve, delay));
                
                // 如果开启了多条消息提示音，且不是第一条消息（第一条已由系统默认逻辑播放），则播放提示音
                if (firstMessageProcessed && db.multiMsgSoundEnabled && db.globalReceiveSound) {
                    playSound(db.globalReceiveSound);
                }
            }
            firstMessageProcessed = true;

            const aiWithdrawRegex = /\[(.*?)撤回了一条消息：([\s\S]*?)\]/;
            const aiWithdrawRegexEn = /\[(?:system:\s*)?(.*?) withdrew a message\. Original: ([\s\S]*?)\]/;
            
            const withdrawMatch = item.content.match(aiWithdrawRegex) || item.content.match(aiWithdrawRegexEn);

            if (withdrawMatch) {
                const characterName = withdrawMatch[1];
                const originalContent = withdrawMatch[2];

                const normalContent = `[${characterName}的消息：${originalContent}]`;
                
                const message = {
                    id: `msg_${Date.now()}_${Math.random()}`,
                    role: 'assistant',
                    content: normalContent,
                    parts: [{type: 'text', text: normalContent}],
                    timestamp: Date.now(),
                    originalContent: originalContent, 
                    isWithdrawn: false 
                };
                if (isCharBlockedMonologue) message.sentWhileCharBlocked = true;

                if (targetChatType === 'group') {
                    const sender = chat.members.find(m => (m.realName === characterName || m.groupNickname === characterName));
                    if (sender) {
                        message.senderId = sender.id;
                    }
                }

                chat.history.push(message);
                appendMessageBubbleForTarget(message, targetChatId, targetChatType);
                
                setTimeout(async () => {
                    message.isWithdrawn = true;
                    message.content = `[${characterName}撤回了一条消息：${originalContent}]`;
                    
                    await persistChatEntity(chat, targetChatType);
                    
                    if (isTargetChatViewOpen(targetChatId, targetChatType) && typeof renderMessages === 'function') {
                        renderMessages(false, true);
                    }
                }, 2000);

                continue; 
            }

            if (targetChatType === 'private') {
                const character = chat;
                const myName = character.myName;

                const aiQuoteRegex = new RegExp(`\\[${character.realName}引用[“"](.*?)["”]并回复：([\\s\\S]*?)\\]`);
                const aiQuoteMatch = item.content.match(aiQuoteRegex);

                if (aiQuoteMatch) {
                    const quotedText = aiQuoteMatch[1];
                    const replyText = aiQuoteMatch[2];

                    const originalMessage = chat.history.slice().reverse().find(m => {
                        if (m.role === 'user') {
                            const userMessageMatch = m.content.match(/\[.*?的消息：([\s\S]+?)\]/);
                            const userMessageText = userMessageMatch ? userMessageMatch[1] : m.content;
                            return userMessageText.trim() === quotedText.trim();
                        }
                        return false;
                    });

                    if (originalMessage) {
                        let filteredReplyText = replyText;
                        if (typeof applyRegexFilter === 'function') {
                            filteredReplyText = applyRegexFilter(replyText, targetChatId);
                        }
                        if (filteredReplyText === '') continue; // 如果过滤后内容为空，直接丢弃该条消息

                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: `[${character.realName}的消息：${filteredReplyText}]`,
                            parts: [{ type: 'text', text: `[${character.realName}的消息：${filteredReplyText}]` }],
                            timestamp: Date.now(),
                            isStatusUpdate: item.isStatusUpdate,
                            statusSnapshot: item.statusSnapshot,
                            quote: {
                                messageId: originalMessage.id,
                                senderId: 'user_me',
                                content: quotedText
                            }
                        };
                        if (isCharBlockedMonologue) message.sentWhileCharBlocked = true;
                        chat.history.push(message);
                        appendMessageBubbleForTarget(message, targetChatId, targetChatType);
                    } else {
                        let filteredReplyText2 = replyText;
                        if (typeof applyRegexFilter === 'function') {
                            filteredReplyText2 = applyRegexFilter(replyText, targetChatId);
                        }
                        if (filteredReplyText2 === '') continue; // 如果过滤后内容为空，直接丢弃该条消息

                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: `[${character.realName}的消息：${filteredReplyText2}]`,
                            parts: [{ type: 'text', text: `[${character.realName}的消息：${filteredReplyText2}]` }],
                            timestamp: Date.now(),
                            isStatusUpdate: item.isStatusUpdate,
                            statusSnapshot: item.statusSnapshot
                        };
                        if (isCharBlockedMonologue) message.sentWhileCharBlocked = true;
                        chat.history.push(message);
                        appendMessageBubbleForTarget(message, targetChatId, targetChatType);
                    }
                } else {
                    const receivedTransferRegex = new RegExp(`\\[${character.realName}的转账：.*?元；备注：.*?\\]`);
                    const giftRegex = new RegExp(`\\[${character.realName}送来的礼物：.*?\\]`);

                    const rawContent = item.content.trim();
                    let finalContent = rawContent;

                    // 应用正则过滤
                    if (typeof applyRegexFilter === 'function') {
                        finalContent = applyRegexFilter(finalContent, targetChatId);
                    }
                    if (finalContent === '') continue; // 如果过滤后内容为空，直接丢弃该条消息

                    const message = {
                        id: `msg_${Date.now()}_${Math.random()}`,
                        role: 'assistant',
                        content: finalContent,
                        parts: [{type: item.type, text: finalContent}],
                        timestamp: Date.now(),
                        isStatusUpdate: item.isStatusUpdate,
                        statusSnapshot: item.statusSnapshot
                    };
                    if (isCharBlockedMonologue) message.sentWhileCharBlocked = true;

                    if (receivedTransferRegex.test(message.content)) {
                        message.transferStatus = 'pending';
                    } else if (giftRegex.test(message.content)) {
                        message.giftStatus = 'sent';
                    }

                    chat.history.push(message);
                    appendMessageBubbleForTarget(message, targetChatId, targetChatType);
                }

            } else if (targetChatType === 'group') {
                const group = chat;
                
                // --- 私聊通知 (不拦截) ---
                if (group.allowGossip && typeof handleGossipMessage === 'function') {
                    handleGossipMessage(group, item.content);
                }

                // 优先检查是否为私聊消息
                const privateRegex = /^\[Private: (.*?) -> (.*?): ([\s\S]+?)\]$/;
                const privateEndRegex = /^\[Private-End: (.*?) -> (.*?)\]$/;
                
                if (privateRegex.test(item.content) || privateEndRegex.test(item.content)) {
                    const match = item.content.match(privateRegex) || item.content.match(privateEndRegex);
                    let senderId = 'unknown';
                    
                    if (match) {
                        const senderName = match[1];
                        // 尝试匹配发送者
                        if (senderName === group.me.nickname) {
                            senderId = 'user_me';
                        } else {
                            const sender = group.members.find(m => m.realName === senderName || m.groupNickname === senderName);
                            if (sender) senderId = sender.id;
                        }
                    }

                    const message = {
                        id: `msg_${Date.now()}_${Math.random()}`,
                        role: 'assistant',
                        content: item.content.trim(),
                        parts: [{type: item.type, text: item.content.trim()}],
                        timestamp: Date.now(),
                        senderId: senderId
                    };
                    group.history.push(message);
                    appendMessageBubbleForTarget(message, targetChatId, targetChatType);
                    continue; // 私聊消息处理完毕，跳过后续普通消息匹配
                }

                // 优先检查是否为角色接收/退回用户转账的指令消息
                const transferActionRegex = /\[(.*?)(接收|退回)(.*?)的转账\]/;
                const transferActionMatch = item.content.match(transferActionRegex);
                
                if (transferActionMatch) {
                    const actorName = transferActionMatch[1].trim();
                    const sender = group.members.find(m => (m.realName === actorName || m.groupNickname === actorName));
                    if (sender) {
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: item.content.trim(),
                            parts: [{type: item.type, text: item.content.trim()}],
                            timestamp: Date.now(),
                            senderId: sender.id,
                            isTransferAction: true
                        };
                        group.history.push(message);
                        appendMessageBubbleForTarget(message, targetChatId, targetChatType);
                    }
                    continue;
                }

                const groupTransferRegex = /\[(.*?)\s*向\s*(.*?)\s*转账[：:]([\d.,]+)元[；;]备注[：:](.*?)\]/;
                const transferMatch = item.content.match(groupTransferRegex);

                const r = /\[(.*?)((?:的消息|的语音|发送的表情包|发来的照片\/视频))：/;
                const nameMatch = item.content.match(r);
                
                if (transferMatch) {
                    const senderName = transferMatch[1];
                    const sender = group.members.find(m => (m.realName === senderName || m.groupNickname === senderName));
                    if (sender) {
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: item.content.trim(),
                            parts: [{type: item.type, text: item.content.trim()}],
                            timestamp: Date.now(),
                            senderId: sender.id,
                            transferStatus: 'pending'
                        };
                        group.history.push(message);
                        appendMessageBubbleForTarget(message, targetChatId, targetChatType);
                    }
                } else if (nameMatch || item.char) {
                    const senderName = item.char || (nameMatch[1]);
                    const sender = group.members.find(m => (m.realName === senderName || m.groupNickname === senderName));
                    console.log(sender)
                    if (sender) {
                        const message = {
                            id: `msg_${Date.now()}_${Math.random()}`,
                            role: 'assistant',
                            content: item.content.trim(),
                            parts: [{type: item.type, text: item.content.trim()}],
                            timestamp: Date.now(),
                            senderId: sender.id
                        };
                        group.history.push(message);
                        appendMessageBubbleForTarget(message, targetChatId, targetChatType);
                    }
                }
            }
        }

        if (targetChatType === 'private' && memoryRoundToken && window.MemoryTablePolicy) {
            window.MemoryTablePolicy.finishRound(chat, memoryRoundToken);
        }
        await persistChatEntity(chat, targetChatType);
        renderChatList();

        // 增量 DOM 追加在特殊消息、界面切换或异步分支中可能漏渲染。
        // 保存后对当前打开的同一聊天做一次完整对账，保证数据库与界面立即一致。
        const isTargetChatOpen = targetChatId === currentChatId && targetChatType === currentChatType
            && document.getElementById('chat-room-screen')?.classList.contains('active');
        if (isTargetChatOpen && typeof renderMessages === 'function') {
            currentPage = 1;
            renderMessages(false, true);
        }

        if (targetChatType === 'private' && (chat.source === 'forum' || chat.source === 'peek') && chat.supplementPersonaAiEnabled) {
            setTimeout(function() {
                if (typeof forumSupplementPersonaFromChat === 'function') forumSupplementPersonaFromChat(targetChatId, chat);
            }, 600);
        }

        // 触发独立的电量检查（不阻塞主流程）
        if (window.BatteryInteraction && typeof window.BatteryInteraction.triggerIndependentCheck === 'function') {
            window.BatteryInteraction.triggerIndependentCheck(chat);
        }

        // 回复全部结束后检查后台工作。显式传递父操作 ID，避免依赖“当前活跃操作”猜测归属。
        const backgroundOperationOptions = { parentOperationId, trigger: 'chat-reply' };
        if (typeof checkAndTriggerAutoJournal === 'function') {
            setTimeout(() => Promise.resolve(checkAndTriggerAutoJournal(chat, backgroundOperationOptions)).catch(error => console.warn('[AutoJournal] background receipt failed:', error)), 500);
        }
        if (typeof checkAndTriggerAutoTableUpdate === 'function') {
            setTimeout(() => Promise.resolve(checkAndTriggerAutoTableUpdate(chat, backgroundOperationOptions)).catch(error => console.warn('[MemoryTable] background receipt failed:', error)), 650);
        }
        if (typeof checkAndTriggerVectorMemory === 'function') {
            setTimeout(() => Promise.resolve(checkAndTriggerVectorMemory(chat, backgroundOperationOptions)).catch(error => console.warn('[VectorMemory] background receipt failed:', error)), 800);
        }

        // 角色主动生成小剧场（仅私聊，按概率触发）；未开启或未命中概率也会留下“已跳过”回执。
        if (targetChatType === 'private' && typeof maybeGenerateCharTheater === 'function') {
            maybeGenerateCharTheater(targetChatId, backgroundOperationOptions);
        }
    }
}

async function handleRegenerate() {
    if (isGenerating) return;

    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : db.groups.find(g => g.id === currentChatId);

    if (!chat || !chat.history || chat.history.length === 0) {
        showToast('没有可供重新生成的内容。');
        return;
    }

    let lastUserMessageIndex = -1;
    for (let i = chat.history.length - 1; i >= 0; i--) {
        const m = chat.history[i];
        if (m.role === 'user' || (m.isNodeBoundary && m.nodeAction === 'start')) {
            lastUserMessageIndex = i;
            break;
        }
    }

    if (lastUserMessageIndex === -1 || lastUserMessageIndex === chat.history.length - 1) {
        showToast('AI尚未回复，无法重新生成。');
        return;
    }

    // 检查是否开启了保留重说消息
    if (chat.keepRegenVersions) {
        // 弹出确认框
        const modal = document.getElementById('regen-save-confirm-modal');
        modal.classList.add('visible');

        // 移除旧监听器，避免重复绑定
        const yesBtn = document.getElementById('regen-save-yes-btn');
        const noBtn = document.getElementById('regen-save-no-btn');
        const newYes = yesBtn.cloneNode(true);
        const newNo = noBtn.cloneNode(true);
        yesBtn.parentNode.replaceChild(newYes, yesBtn);
        noBtn.parentNode.replaceChild(newNo, noBtn);

        newYes.addEventListener('click', async () => {
            modal.classList.remove('visible');
            // 保存即将被删除的AI回复到用户消息的版本记录中
            const userMsg = chat.history[lastUserMessageIndex];
            if (!userMsg._regenVersions) userMsg._regenVersions = [];
            const aiReplies = [];
            for (let i = lastUserMessageIndex + 1; i < chat.history.length; i++) {
                aiReplies.push({
                    content: chat.history[i].content,
                    role: chat.history[i].role,
                    senderId: chat.history[i].senderId,
                    timestamp: chat.history[i].timestamp,
                    parts: chat.history[i].parts ? JSON.parse(JSON.stringify(chat.history[i].parts)) : undefined
                });
            }
            // 避免重复保存相同内容
            const lastSaved = userMsg._regenVersions[userMsg._regenVersions.length - 1];
            const newContent = aiReplies.map(r => r.content).join('');
            if (!lastSaved || lastSaved.replies.map(r => r.content).join('') !== newContent) {
                userMsg._regenVersions.push({
                    replies: aiReplies,
                    savedAt: Date.now()
                });
            }
            await _doRegenerate(chat, lastUserMessageIndex);
        });

        newNo.addEventListener('click', async () => {
            modal.classList.remove('visible');
            await _doRegenerate(chat, lastUserMessageIndex);
        });

        return;
    }

    await _doRegenerate(chat, lastUserMessageIndex);
}

async function _doRegenerate(chat, lastUserMessageIndex) {
    const originalLength = chat.history.length;
    chat.history.splice(lastUserMessageIndex + 1);

    if (chat.history.length === originalLength) {
        showToast('未找到AI的回复，无法重新生成。');
        return;
    }
    
    if (currentChatType === 'private') {
        recalculateChatStatus(chat);
    }

    await saveCurrentChat();
    
    currentPage = 1; 
    renderMessages(false, true); 

    await getAiReply(currentChatId, currentChatType);
}

/** 将偷看记录中的单条应用内容格式化为可读摘要，供系统提示使用 */
function formatPeekContentForPrompt(entry) {
    if (!entry || !entry.content) return '';
    const c = entry.content;
    const appName = entry.appName || entry.appId || '';
    const maxLen = 600;
    const trunc = (s) => (s && String(s).length > maxLen) ? String(s).slice(0, maxLen) + '…' : (s || '');
    let text = '';
    switch (entry.appId) {
        case 'messages':
            if (c.conversations && Array.isArray(c.conversations)) {
                text = c.conversations.map(cv => {
                    const last = (cv.history && cv.history.length) ? cv.history[cv.history.length - 1] : null;
                    const lastContent = last ? (last.content || '').replace(/\[.*?\]/g, '').trim() : '…';
                    return `与 ${cv.partnerName || '某人'} 的对话，最近一条：${trunc(lastContent)}`;
                }).join('；');
            }
            break;
        case 'album':
            if (c.photos && Array.isArray(c.photos)) {
                text = c.photos.map(p => `照片/视频：${trunc(p.imageDescription)}；批注：${trunc(p.description)}`).join('；');
            }
            break;
        case 'memos':
            if (c.memos && Array.isArray(c.memos)) {
                text = c.memos.map(m => `《${m.title || '无标题'}》${trunc(m.content)}`).join('；');
            }
            break;
        case 'unlock':
            text = `昵称：${c.nickname || ''}；签名：${trunc(c.bio)}；帖子数：${(c.posts && c.posts.length) || 0}。`;
            if (c.posts && c.posts.length) {
                text += ' 最近帖子：' + c.posts.slice(0, 3).map(p => trunc(p.content)).join(' | ');
            }
            break;
        case 'wallet':
            text = `收入 ${(c.income && c.income.length) || 0} 条，支出 ${(c.expense && c.expense.length) || 0} 条。`;
            if (c.summary) text += ' 摘要：' + trunc(c.summary);
            break;
        case 'drafts':
            if (c.draft) text = `收件人：${c.draft.to || ''}；内容：${trunc(c.draft.content)}`;
            break;
        case 'steps':
            text = `当前步数：${c.currentSteps ?? '?'}；${(c.annotation && trunc(c.annotation)) || ''}`;
            break;
        case 'cart':
            if (c.items && Array.isArray(c.items)) {
                text = `共 ${c.items.length} 件：` + c.items.map(i => i.name || i.title || '商品').join('、');
            }
            break;
        case 'browser':
            if (c.history && Array.isArray(c.history)) {
                text = c.history.slice(0, 5).map(h => h.title || h.url || '').filter(Boolean).join('；');
            }
            break;
        case 'transfer':
            if (c.entries && Array.isArray(c.entries)) {
                text = c.entries.map(e => e.content || e.title || '').filter(Boolean).map(trunc).join('；');
            }
            break;
        case 'timeThoughts':
            if (c.thoughts && Array.isArray(c.thoughts)) {
                text = c.thoughts.map(t => trunc(t.content || t.text)).join('；');
            }
            break;
        default:
            text = trunc(JSON.stringify(c));
    }
    return `【${appName}】${text || '（无内容摘要）'}`;
}

/** 角色掌控模式：生成「用户手机」状态摘要，供系统提示 <phone_control> 使用（不默认带聊天列表，需角色用 view-chat-list 主动查看） */
function formatUserPhoneStateForPrompt(character) {
    if (!character || !character.phoneControlEnabled) return '';
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    let out = '\n<phone_control>\n';
    out += '你现在拥有查看并操控用户手机的权限。你看到的是用户的真实手机。\n\n';

    out += '【你可使用的操控指令】\n';
    out += '- [phone-control:view-chat-list] — 查看用户聊天列表概览（角色名/群聊名及最近一条预览）\n';
    out += '- [phone-control:read-chat|target:角色名或群聊名] — 查看与某对话的最近若干条消息\n';
    out += '- [phone-control:send-message|target:角色名或群聊名|content:消息内容] — 以用户身份向该对话发送消息；content 中换行会拆成多条依次发送\n';
    out += '- [phone-control:delete-character|target:角色名] — 将某角色移入回收站\n';
    out += '- [phone-control:toggle-setting|target:角色名|setting:设置项|value:on或off] — 开关该角色的某项设置\n';
    out += '- [phone-control:clear-history|target:角色名或群聊名] — 清空该对话的聊天记录\n';
    out += '可一次输出多条指令，系统会全部执行。请勿在回复中写出指令的说明文字，仅输出要执行的指令。\n';

    const history = character.phoneControlHistory || [];
    if (history.length > 0) {
        out += '\n【你近期的操控记录】\n';
        history.slice(-15).forEach(h => {
            const t = h.timestamp ? new Date(h.timestamp) : null;
            const timeStr = t ? `${pad(t.getMonth() + 1)}/${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}` : '';
            out += `- ${timeStr} ${h.type === 'view' ? '查看' : '操作'}：${h.action || ''} ${h.target ? '(' + h.target + ')' : ''} ${h.detail ? '— ' + (String(h.detail).slice(0, 80)) : ''}\n`;
        });
    }
    if (character.phoneControlLastViewChatListResult) {
        out += '\n' + character.phoneControlLastViewChatListResult;
        delete character.phoneControlLastViewChatListResult;
    }
    if (character.phoneControlLastReadResult) {
        const r = character.phoneControlLastReadResult;
        out += '\n【你刚才查看的对话内容】与「' + (r.targetName || '') + '」的最近' + (r.lines ? r.lines.length : 0) + '条消息：\n';
        (r.lines || []).forEach(line => { out += line + '\n'; });
        delete character.phoneControlLastReadResult;
    }
    out += '</phone_control>\n\n';
    return out;
}

function getOnlineLogicRules(character, startIndex = 4) {
    let rules = `${startIndex}. 我的消息中可能会出现特殊格式，请根据其内容和你的角色设定进行回应：
- [${character.myName}发送的表情包：xxx]：我给你发送了一个名为xxx的表情包。你只需要根据表情包的名字理解我的情绪或意图并回应，不需要真的发送图片。
- [${character.myName}发来了一张图片：]：我给你发送了一张图片，你需要对图片内容做出回应。
- [${character.myName}的语音：xxx]：我给你发送了一段内容为xxx的语音。
- [${character.myName}发来的照片/视频：xxx]：我给你分享了一个描述为xxx的真实的物理照片或视频。你需要对具体的照片内容做出回应。
- [${character.myName}发送的表情包：xxx]：我给你发送了一个网络聊天用的表情包/贴图，并可能附带了它的画面描述。请注意：这是用来表达情绪、吐槽或玩梗的网络表情，**绝对不是真实的物理照片**。你需要结合我的上下文和表情包的画面，理解我此刻的心情并做出自然的回应。
- [我的位置：xxx；距你约 x 千米]：我向你发送了我当前所在的位置。其中“我的位置”后的内容为我目前的地点；“距你约”后的数字和单位（如米、千米）（我选填）表示我与你之间的距离。请根据我所在的位置以及距离信息（如果有距离信息的话）自然地回应，例如关心安全、提议见面、调侃距离远近等。
- 你也可以主动告诉我你当前所在位置，使用格式 [${character.realName}的位置：xxx；距你约 x 米]（地点必填，距你约为选填），这样我就知道你在哪里，我们之间距离有多少。
- [${character.myName}引用“{被引用内容}”并回复：{回复内容}]：我引用了某条历史消息并做出了新的回复。你需要理解我引用的上下文并作出回应。
- [${character.myName} 撤回了一条消息：xxx]：我撤回了刚刚发送的一条消息，xxx是被我撤回的原文。这可能意味着我发错了、说错了话或者改变了主意。你需要根据你的人设和我们当前对话的氛围对此作出自然的反应。例如，可以装作没看见并等待我的下一句话，或好奇地问一句“怎么撤回啦？”。
- [system: xxx]：这是一条系统指令，用于设定场景或提供上下文，此条信息不应在对话中被直接提及，你只需理解其内容并应用到后续对话中。
`;

    let nextIndex = startIndex + 4;

    // V8.0: shop, gift, transfer and family-card output actions are retired.


    rules += `${nextIndex}. ✨重要✨ 你可以在对话中更新你的当前状态，但不超过15个字。比如，聊到一半你可能会说“我先去洗个澡”，然后更新你的状态，以反映你当前的行为或心情。这会让互动更真实。格式为：[${character.realName}更新状态为：xxx]。例如：[${character.realName}更新状态为：正在看电影...]。这条指令不会显示为聊天消息，只会更新你在我界面上的状态。\n`;
    nextIndex++;
    rules += `${nextIndex}. ✨重要✨ 关于撤回消息：你可以撤回你刚刚发送的消息。当你打错了字、说错了话、感到尴尬、反悔、或者只是改变了主意时，都可以这样做。这是一个体现你角色性格的机会。格式为：[${character.realName}撤回了一条消息：{被撤回消息的原文}]。⚠️严禁输出原消息再输出撤回指令！系统会自动处理“先显示原消息再变为撤回状态”的动画效果。你只需要输出这一条撤回指令即可。\n`;
    nextIndex++;
    rules += `${nextIndex}. ✨重要✨ 你可以选择单独一条消息引用，当你想要对于单独某句话做出回应/反驳/吐槽/补充时，**必须**使用引用格式，格式为：[${character.realName}引用“{某条消息内容}”并回复：{回复内容}]。这能让对话逻辑更清晰。\n`;
    nextIndex++;
    rules += `${nextIndex}. 你的所有回复都必须直接是聊天内容，绝对不允许包含任何如[心理活动]、(动作)、*环境描写*等多余的、在括号或星号里的叙述性文本。\n`;
    nextIndex++;

    const groups = (character.stickerGroups || '').split(/[,，]/)
        .map(s => s.trim())
        .filter(s => s && s !== '未分类');
        
    if (groups.length > 0) {
        const availableStickers = db.myStickers.filter(s => groups.includes(s.group));
        if (availableStickers.length > 0) {
            let stickerNames = '';
            if (character.stickerDescriptionEnabled) {
                // 如果开启了附带画面描述
                stickerNames = availableStickers.map(s => {
                    if (s.description && s.description.trim() !== '') {
                        return `${s.name}(画面:${s.description})`;
                    }
                    return s.name;
                }).join(', ');
            } else {
                stickerNames = availableStickers.map(s => s.name).join(', ');
            }
            rules += `${nextIndex}. 你拥有发送表情包的能力。这是一个可选功能，你可以根据对话氛围和内容，自行判断是否需要发送表情包来辅助表达。**必须从以下列表中选择表情包，不允许凭空捏造**：[${stickerNames}]。请使用格式：[表情包：名称]。**不要连续重复发送同一表情，尽量丰富一点，不要每次回复都发送表情**⚠️严格限制：必须完全精确地使用库中的名称，严禁编造中不存在的名称，否则表情包将无法显示。\n`;
            nextIndex++;
        }
    }

    return rules;
}

function getOnlineOutputFormats(character, worldBooksBefore, worldBooksAfter) {
    let photoVideoFormat = '';
    
    // === 自动生图判断 (支持 NovelAI / GPT) ===
    const gptEnabled = db.gptImageSettings && db.gptImageSettings.enabled && db.gptImageSettings.url && db.gptImageSettings.key;
    const naiEnabled = db.novelAiSettings && db.novelAiSettings.enabled && db.novelAiSettings.token;
    const _imgEnabled = gptEnabled || naiEnabled;
    const engine = naiEnabled ? 'novelai' : (gptEnabled ? 'gpt' : 'novelai');
    if (_imgEnabled) {
        photoVideoFormat = `e) 照片/视频: [${character.realName}发来的照片/视频：{中文描述}{{english, ${engine === 'gpt' ? 'dalle' : 'novelai'}, tags}}] (发图时必须在 {{ }} 内写英文 ${engine === 'gpt' ? 'DALL-E' : 'NovelAI'} 风格 tag。根据角色性别用1boy或1girl，包含外貌特征、服装、表情、动作、场景，不加质量词，不超过25个tag)`;
    } else {
        photoVideoFormat = `e) 照片/视频: [${character.realName}发来的照片/视频：{描述}]`;
    }
 
    let outputFormats = `
a) 普通消息: [${character.realName}的消息：{消息内容}]
d) 语音消息: [${character.realName}的语音：{语音内容}]
${photoVideoFormat}`;

    const groups = (character.stickerGroups || '').split(/[,，]/).map(s => s.trim()).filter(s => s && s !== '未分类');
    let canUseStickers = false;
    if (groups.length > 0) {
        const availableStickers = db.myStickers.filter(s => groups.includes(s.group));
        if (availableStickers.length > 0) {
            let stickerNames = '';
            if (character.stickerDescriptionEnabled) {
                stickerNames = availableStickers.map(s => {
                    if (s.description && s.description.trim() !== '') {
                        return `${s.name}(画面:${s.description})`;
                    }
                    return s.name;
                }).join(', ');
            } else {
                stickerNames = availableStickers.map(s => s.name).join(', ');
            }
            stickerInstruction = `   - **可用表情包**: 你们可以使用以下表情包来表达情绪：[${stickerNames}]。\n`;
            canUseStickers = true;
        }
    }

    outputFormats += `
j) 更新状态(此条不显示): [${character.realName}更新状态为：{新状态}]
k) 引用我的回复: [${character.realName}引用“{我的某条消息内容}”并回复：{回复内容}]
l) 发送并撤回消息: [${character.realName}撤回了一条消息：{被撤回的消息内容}]。注意：直接使用此指令系统就会自动模拟“发送后撤回”的效果，请勿先发送原消息。
s) 发送我的位置: [${character.realName}的位置：{地点}；距你约 {数字}{单位}]（必填：地点，即你当前所在位置；选填：距你约的数字和单位，单位可用米/千米/公里，不填则只发地点）`;

    // V9.0: call output formats retired.

    // V7.0: Shop and proxy-payment output formats are retired.
    if (false && character.shopInteractionEnabled) {
        outputFormats += `
o) 主动下单: [${character.realName}为${character.myName}下单了：配送方式|金额|商品清单]
p) 求代付: [${character.realName}向${character.myName}发起了代付请求:金额|商品清单]`;
    }
    // V8.0: family-card output retired.

   const allWorldBookContent = (worldBooksBefore || '') + '\n' + (worldBooksAfter || '');
   if (allWorldBookContent.includes('<orange>')) {
       outputFormats += `\n     m) HTML模块: {HTML内容}。这是一种特殊的、用于展示丰富样式的小卡片消息，格式必须为纯HTML+行内CSS，你可以用它来创造更有趣的互动。`;
   }
   
   return outputFormats;
}

function getOfflineOutputFormats(character) {
    return `a) 剧情演绎: [剧情：{包含动作、神态、对话的长文本}]\nb) 更新状态(可选): [${character.realName}更新状态为：{新状态}]`;
}

function getInjectedFormatsPrompt(character, formats) {
    if (!formats || formats.length === 0) return '';
    let prompt = '\n【额外允许的线上功能格式】\n你可以在回复中穿插使用以下格式：';
    formats.forEach(f => {
        switch(f) {
            case 'voice': prompt += `\n- 语音消息: [${character.realName}的语音：{语音内容}]`; break;
            case 'photo': prompt += `\n- 照片/视频: [${character.realName}发来的照片/视频：{描述}]`; break;
            case 'sticker': prompt += `\n- 表情包: [${character.realName}的表情包：{表情包名称}]`; break;
            case 'transfer': break; // V8.0 retired
            case 'shop': break; // V7.0 retired
            case 'location': prompt += `\n- 发送位置: [${character.realName}的位置：{地点}；距你约 {数字}{单位}]`; break;
            case 'status': prompt += `\n- 更新状态(此条不显示): [${character.realName}更新状态为：{新状态}]`; break;
            case 'withdraw': prompt += `\n- 撤回消息: [${character.realName}撤回了一条消息：{被撤回的消息内容}]`; break;
        }
    });
    return prompt + '\n';
}


function buildDynamicAgeNotice(ownerName, birthday, enabled, perspectiveLabel) {
    if (!enabled || !birthday) return '';
    const today = new Date();
    const birthDate = new Date(birthday);
    if (Number.isNaN(birthDate.getTime())) return '';
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age--;
    const dateText = `${birthDate.getFullYear()}年${birthDate.getMonth() + 1}月${birthDate.getDate()}日`;
    const isBirthday = monthDiff === 0 && today.getDate() === birthDate.getDate();
    return isBirthday
        ? `${perspectiveLabel}（${ownerName}）出生于${dateText}，今天是${age}岁生日；只在对话自然相关时体现知晓与关心。`
        : `${perspectiveLabel}（${ownerName}）出生于${dateText}，当前${age}岁。`;
}

function buildSessionProjectContent(character, currentTime) {
    const lines = [
        '当前任务：在“404”聊天软件中持续扮演当前角色，与用户进行长期、连续、自然的私聊。',
        `当前时间：${currentTime}。知晓时间顺序，但除非当前话题相关，不主动催促或评论时间。`
    ];
    if (!db.apiSettings || db.apiSettings.onlineRoleEnabled !== false) {
        lines.push('当前模式：纯线上聊天。保持在线角色身份，不主动提出线下见面、转移联系方式或假装现实接触已经发生。');
    } else {
        lines.push('当前模式：允许依据现有设定理解线上与线下关系。');
    }
    const charAge = buildDynamicAgeNotice(character.realName || '角色', character.birthday, character.enableDynamicAge, '角色');
    const userAge = buildDynamicAgeNotice(character.myName || '用户', character.myBirthday, character.myEnableDynamicAge, '用户');
    if (charAge) lines.push(charAge);
    if (userAge) lines.push(userAge);
    if (character.enableDynamicTimezone && character.charTimezone) {
        const timeText = getLocalTimeInTimezone(character.charTimezone);
        if (timeText) lines.push(`角色当地时间：${timeText}（${character.charTimezone}）。`);
    }
    if (character.myEnableDynamicTimezone && character.myTimezone) {
        const timeText = getLocalTimeInTimezone(character.myTimezone);
        if (timeText) lines.push(`用户当地时间：${timeText}（${character.myTimezone}）。`);
    }
    return lines.join('\n');
}

function buildCoreIdentityProjectContent(character, linkedChar, memoryProjects) {
    const lines = [
        `角色名：${character.realName || character.remarkName || '角色'}`,
        `用户称呼：${character.myName || '用户'}`,
        `角色当前状态：${character.status || '在线'}`
    ];
    const core = String(memoryProjects?.core || '').trim();
    if (core) {
        lines.push('以下“核心档案”是角色、用户与双方关系的主要身份设定；它按字段分类发送，优先于普通长期记忆。');
        lines.push(core);
        return lines.join('\n\n');
    }
    // 核心档案为空时才回退旧角色人设/用户人设，避免同一身份信息重复发送。
    if (linkedChar) {
        lines.push(`【双重身份与伪装】当前网名是${character.realName}，真实身份是${linkedChar.realName}。`);
        lines.push(`小号表面设定：${getEffectivePersona(character)}`);
        lines.push(`真实角色设定：${getEffectivePersona(linkedChar)}`);
        lines.push(`未被识破前保持小号表面身份，但真实角色的习惯和对用户的态度可以自然流露；被明确识破后按${linkedChar.realName}的真实身份回应。`);
    } else {
        lines.push(`角色设定：${getEffectivePersona(character)}`);
    }
    if (character.myPersona) lines.push(`用户设定：${character.myPersona}`);
    return lines.join('\n\n');
}

function buildGroupMemoryProjectContent(character) {
    if (!character.syncGroupMemory) return '';
    let groups = (db.groups || []).filter(group => group.members && group.members.some(member => member.originalCharId === character.id));
    if (Array.isArray(character.syncGroupIds) && character.syncGroupIds.length) groups = groups.filter(group => character.syncGroupIds.includes(group.id));
    const sections = [];
    groups.forEach(group => {
        let journals = (group.memoryJournals || []).filter(journal => journal.isFavorited);
        const summaryCount = Number(character.groupMemorySummaryCount) || 0;
        if (summaryCount > 0) journals = journals.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, summaryCount);
        const journalText = journals.map(journal => `标题：${journal.title}\n内容：${journal.content}`).join('\n\n---\n\n');
        const maxHistory = Number(character.groupMemoryHistoryCount) || 20;
        let history = (group.history || []).slice(-maxHistory);
        if (typeof filterHistoryForAI === 'function') history = filterHistoryForAI(group, history);
        history = history.filter(message => !message.isContextDisabled);
        const historyText = history.map(message => {
            const content = message.parts?.length ? message.parts.map(part => part.text || '[图片]').join('') : (message.content || '');
            const sender = message.senderId ? (group.members.find(member => member.id === message.senderId)?.groupNickname || '未知') : (message.role === 'user' ? group.me?.nickname || '用户' : '系统');
            return `${sender}: ${content}`;
        }).join('\n');
        if (journalText || historyText) sections.push(`【群聊“${group.name}”】\n${journalText ? `群聊总结：\n${journalText}\n` : ''}${historyText ? `最近群聊记录：\n${historyText}` : ''}`);
    });
    return sections.join('\n\n');
}

function buildEnvironmentProjectContent(character, opts) {
    const blocks = [];
    if (opts?.weatherText) blocks.push(String(opts.weatherText).replace(/^\s*<environment>|<\/environment>\s*$/g, '').trim());
    if (typeof buildBlockMemoryContext === 'function') {
        const value = buildBlockMemoryContext(character);
        if (value) blocks.push(value);
    }
    if (typeof buildCharBlockMemoryContext === 'function') {
        const value = buildCharBlockMemoryContext(character);
        if (value) blocks.push(value);
    }
    if (character.allowCharSwitchBubbleCss && Array.isArray(character.bubbleCssThemeBindings) && character.bubbleCssThemeBindings.length > 0) {
        const themeLines = character.bubbleCssThemeBindings.map(binding => `- ${binding.presetName}${binding.description?.trim() ? `：${binding.description.trim()}` : ''}`);
        let currentThemeName = character.currentBubbleCssPresetName || '';
        if (!currentThemeName && character.useCustomBubbleCss && character.customBubbleCss) {
            const matched = (db.bubbleCssPresets || []).find(preset => preset.css && preset.css.trim() === character.customBubbleCss.trim());
            if (matched) currentThemeName = matched.name;
        }
        const lines = ['【当前对话主题】', `当前使用：${currentThemeName || '默认或自定义样式'}`, `可选主题：\n${themeLines.join('\n')}`];
        if (character.themeJustChangedByUser?.trim()) {
            lines.push(`用户刚刚切换为：${character.themeJustChangedByUser.trim()}。可按人设自然回应。`);
            character.themeJustChangedByUser = '';
        }
        lines.push('需要切换时单独输出：[更换主题：主题名]。');
        blocks.push(lines.join('\n'));
    }
    if (opts?.historyText) blocks.push(opts.historyText);
    return blocks.join('\n\n');
}

function buildInteractionProjectContent(character) {
    const blocks = [];
    if (character.canBlockUser !== false) {
        blocks.push(`【角色拉黑能力】\n只有在角色确实极度愤怒、伤心或拒绝继续对话时，才可在回复末尾输出隐藏指令：[char-action:block-user|reason:简短理由]。不要把它当作普通互动手段。`);
    }
    if (db.cotSettings?.humanRunEnabled) blocks.push(HUMAN_RUN_PROMPT);
    if (window.AvatarSystem && typeof window.AvatarSystem.generateAvatarSystemPrompt === 'function') {
        const avatarPrompt = window.AvatarSystem.generateAvatarSystemPrompt(character);
        if (avatarPrompt) blocks.push(avatarPrompt);
    }
    blocks.push(getOnlineLogicRules(character, 1));
    return blocks.filter(Boolean).join('\n\n');
}

function buildOutputProjectContent(character, worldBooksBefore, worldBooksMiddle, worldBooksAfter) {
    const blocks = [];
    if (character.statusPanel?.enabled && character.statusPanel.promptSuffix) blocks.push(character.statusPanel.promptSuffix);
    blocks.push(`【基础输出格式】\n${getOnlineOutputFormats(character, worldBooksBefore, [worldBooksMiddle, worldBooksAfter].filter(Boolean).join('\n'))}`);
    const minReply = character.replyCountMin || 3;
    const maxReply = character.replyCountMax || 8;
    blocks.push(character.replyCountEnabled
        ? `【回复节奏】每次回复严格保持在${minReply}-${maxReply}条消息内；数量要自然变化，除非角色状态确实需要，不要总是触碰上限。`
        : '【回复节奏】通常一次回复3-8条短消息，数量保持自然变化。');
    blocks.push('特殊消息格式只在当前情境自然需要时使用，不要机械轮换、频繁重复或为了使用格式而使用。');
    blocks.push('避免照抄历史消息的句式和词汇；保持角色连续性，但当前回复要自然、新鲜。');
    blocks.push('不要主动终止聊天，除非用户明确提出。');
    return blocks.join('\n\n');
}

function buildBackgroundWriteProjectContent(character, opts) {
    const blocks = [];
    if (character.characterAutoFavoriteEnabled) {
        blocks.push(`【收藏记忆写入】\n你可以把当前私聊中重要的用户原消息写入本角色自己的“收藏记忆”表。收藏不需要标题，后续只按标签召回。\n在正常回复末尾追加一次：<favorite_ops>{"items":[{"messageId":"msg_123","tags":["童年","梦想"],"note":"反映他的核心愿望"}]}</favorite_ops>。\n只收藏当前聊天中的用户消息；每轮最多3条；每条2—8个简短标签；寄语可留空且不超过80字；不要填写正文或标题；不要在可见对话中提及收藏。没有要收藏的消息时不要输出favorite_ops。`);
    }
    if (opts?.enableMemorySidecar && window.MemoryTableSidecar) {
        const memoryProtocol = window.MemoryTableSidecar.buildSystemPrompt(character);
        if (memoryProtocol) blocks.push(memoryProtocol);
    }
    return blocks.join('\n\n');
}

function serializePrivatePromptProjects(projects, character, linkedChar) {
    const prompt = (Array.isArray(projects) ? projects : []).map(project => wrapPromptProject(project.tag, project.content, project.attributes || '')).filter(Boolean).join('\n\n');
    return replacePromptAliases(prompt, character, linkedChar);
}

function generatePrivateSystemPrompt(character, opts) {
    opts = opts || {};
    window.OVORetiredFeaturePolicy?.applyToCharacter?.(character);
    const linkedChar = (character.source === 'forum' && character.linkedCharId && db.characters)
        ? db.characters.find(c => c.id === character.linkedCharId) : null;
    const effectiveChar = linkedChar || character;

    let { before: worldBooksBefore, middle: worldBooksMiddle, after: worldBooksAfter } = getActiveWorldBooksContents(character);
    
    const now = new Date();
    let currentTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (character.enableDynamicTimezone && character.charTimezone) {
        const tzTime = getLocalTimeInTimezone(character.charTimezone);
        if (tzTime) currentTime = tzTime;
    }

    // 检查角色是否有专属的自定义提示词，或者全局是否开启了自定义提示词
    let useCustomPrompt = false;
    let template = '';
    if (character.customPromptPreset && db.magicRoom && db.magicRoom.presets) {
        const preset = db.magicRoom.presets.find(p => p.name === character.customPromptPreset);
        if (preset) {
            useCustomPrompt = true;
            template = preset.template;
        }
    }
    
    if (!useCustomPrompt && db.magicRoom && db.magicRoom.customPromptEnabled && db.magicRoom.customPromptTemplate) {
        useCustomPrompt = true;
        template = db.magicRoom.customPromptTemplate;
    }

    // 处理用户自定义的底层系统提示词模板
    if (useCustomPrompt && template) {
        
        // 构建共同回忆字符串。即使用户自定义模板遗漏占位符，也会在末尾安全补入。
        const hadMemoryPlaceholder = /\{\{共同回忆\}\}/.test(template);
        let commonMemories = buildCombinedLongTermMemoryContext(character);
        
        // 构建群聊记忆互通字符串
        if (character.syncGroupMemory) {
            let groupsWithCharacter = db.groups.filter(group => 
                group.members && group.members.some(member => member.originalCharId === character.id)
            );
            if (character.syncGroupIds && Array.isArray(character.syncGroupIds) && character.syncGroupIds.length > 0) {
                groupsWithCharacter = groupsWithCharacter.filter(group => 
                    character.syncGroupIds.includes(group.id)
                );
            }
            if (groupsWithCharacter.length > 0) {
                let groupMemoryContext = '';
                groupsWithCharacter.forEach(group => {
                    let groupFavoritedJournals = (group.memoryJournals || []).filter(j => j.isFavorited);
                    const summaryCount = character.groupMemorySummaryCount || 0;
                    if (summaryCount > 0 && groupFavoritedJournals.length > summaryCount) {
                        groupFavoritedJournals = groupFavoritedJournals.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, summaryCount);
                    }
                    const groupFavoritedJournalsText = groupFavoritedJournals.map(j => `标题：${j.title}\n内容：${j.content}`).join('\n\n---\n\n');
                    const maxGroupHistory = character.groupMemoryHistoryCount || 20;
                    let recentGroupHistory = group.history.slice(-maxGroupHistory);
                    if (typeof filterHistoryForAI === 'function') {
                        recentGroupHistory = filterHistoryForAI(group, recentGroupHistory);
                    }
                    recentGroupHistory = recentGroupHistory.filter(m => !m.isContextDisabled);
                    if (groupFavoritedJournalsText || recentGroupHistory.length > 0) {
                        groupMemoryContext += `\n【群聊"${group.name}"的背景信息】\n`;
                        if (groupFavoritedJournalsText) groupMemoryContext += `群聊总结：\n${groupFavoritedJournalsText}\n`;
                        if (recentGroupHistory.length > 0) {
                            const historyText = recentGroupHistory.map(m => {
                                let content = m.content;
                                if (m.parts && m.parts.length > 0) content = m.parts.map(p => p.text || '[图片]').join('');
                                const senderName = m.senderId ? (group.members.find(mem => mem.id === m.senderId)?.groupNickname || '未知') : (m.role === 'user' ? group.me.nickname : '系统');
                                return `${senderName}: ${content}`;
                            }).join('\n');
                            groupMemoryContext += `最近群聊记录：\n${historyText}\n`;
                        }
                    }
                });
                if (groupMemoryContext) {
                    commonMemories += `\n【群聊记忆互通】\n以下是你所在群聊的相关背景信息，这些信息可以帮助你更好地理解我们之间的对话上下文：${groupMemoryContext}`;
                }
            }
        }

        // 构建在线逻辑规则
        let onlineLogicRules = getOnlineLogicRules(character, 4);

        // 构建输出格式
        let outputFormats = getOnlineOutputFormats(character, worldBooksBefore, worldBooksAfter);

        // 替换变量
        template = template.replace(/\{\{当前时间\}\}/g, currentTime);
        template = template.replace(/\{\{世界书_前\}\}/g, worldBooksBefore || '');
        template = template.replace(/\{\{世界书_中\}\}/g, worldBooksMiddle || '');
        template = template.replace(/\{\{世界书_后\}\}/g, worldBooksAfter || '');
        template = template.replace(/\{\{角色名\}\}/g, character.realName || '');
        template = template.replace(/\{\{用户称呼\}\}/g, character.myName || '');
        template = template.replace(/\{\{角色状态\}\}/g, character.status || '在线');
        template = template.replace(/\{\{角色人设\}\}/g, getEffectivePersona(character) || '');
        template = template.replace(/\{\{用户人设\}\}/g, character.myPersona || '');
        template = template.replace(/\{\{共同回忆\}\}/g, commonMemories || '');
        template = template.replace(/\{\{在线逻辑规则\}\}/g, onlineLogicRules || '');
        template = template.replace(/\{\{输出格式\}\}/g, outputFormats || '');
        template = template.replace(/\{\{天气信息\}\}/g, opts.weatherText || '');

        // 自定义 Prompt 常会被用户删改；遗漏 {{共同回忆}} 时不能静默丢失档案/结构化记忆。
        if (commonMemories && !hadMemoryPlaceholder) {
            const probe = commonMemories.slice(0, Math.min(120, commonMemories.length));
            if (!probe || !template.includes(probe)) {
                template += `\n\n<memoir>\n${commonMemories}\n</memoir>`;
            }
        }

        if (opts.weatherText && !template.includes('<environment>')) {
             template += opts.weatherText;
        }
        // 补充必要的结尾和选项
        if (character.replyCountEnabled) {
            const minReply = character.replyCountMin || 3;
            const maxReply = character.replyCountMax || 8;
            template += `\n<Chatting Guidelines>\n17. **对话节奏**: 你需要模拟真人的聊天习惯，你可以一次性生成多条短消息。每次回复消息条数**必须**严格限定在**${minReply}-${maxReply}条以内**，**关键规则**：请保持回复消息数量的**随机性和多样性**。**除非**你的设定偏向活跃或情绪波动大或是特殊情况下，否则**不要**触碰 ${maxReply} 条的上限。\n`;
        } else {
            template += `\n<Chatting Guidelines>\n17. **对话节奏**: 你需要模拟真人的聊天习惯，你可以一次性生成多条短消息。每次回复3-8条消息之内，**关键规则**：请保持回复消息数量的**随机性和多样性**。\n`;
        }
        template += `18. **特殊消息格式的使用原则**：(1)请把语音、撤回、转账、更新状态、引用、定位等特殊格式视为增强互动的“调味剂”，遵循**自然、主动、多样化触发逻辑。同种格式不要重复频繁发送，不同格式不要用户不提就一直不发**。\n(2)注意在本回合消息列里，特殊消息插入位置的随机性，每轮必须和上一回合插入位置不同。\n`;
        template += `19. 🌟**防复读对话**🌟：在本轮回复中，你**必须**区别于过往聊天记录而去变换句式和词汇，**绝对不要**重复或模仿历史记录中的文本结构，保持自然、随机和多样性。\n`;
        template += `</Chatting Guidelines>\n`;
        template += `20. 不要主动终止聊天进程，除非我明确提出。保持你的人设，自然地进行对话。`;

        if (character.characterAutoFavoriteEnabled) {
            template += `\n\n【消息收藏功能】\n你可以把当前私聊中重要的用户原消息写入本角色自己的“收藏记忆”表。收藏不需要标题，后续只会按标签在相关对话中发送。\n\n**使用方法**：在正常回复末尾追加一次：<favorite_ops>{"items":[{"messageId":"msg_123","tags":["童年","梦想"],"note":"反映他的核心愿望"}]}</favorite_ops>。每条用户消息在上下文中以 [id:消息ID] 标注，请使用该ID。\n\n**规则**：只收藏当前聊天中的用户消息；每轮最多3条；每条提供2—8个简短标签；寄语可留空且不超过80字；不要填写正文或标题；不要在可见对话中提及收藏行为。没有要收藏的消息时不要输出favorite_ops。`;
        }

        if (opts && opts.historyText) {
            template += '\n' + opts.historyText;
        }

        if (opts.enableMemorySidecar && window.MemoryTableSidecar) {
            template += window.MemoryTableSidecar.buildSystemPrompt(character);
        }
        template = replacePromptAliases(template, character, linkedChar);
        return window.OVORetiredFeaturePolicy?.sanitizeSystemPrompt?.(template) || template;
    }

    // 节点系统：拦截并返回专属提示词
    let activeNode = null;
    let isOfflineNode = false;
    if (character.activeNodeId && character.nodes) {
        activeNode = character.nodes.find(n => n.id === character.activeNodeId);
        if (activeNode) {
            let baseMode = (activeNode.customConfig && activeNode.customConfig.baseMode) ? activeNode.customConfig.baseMode : 
                           (activeNode.type === 'offline' || (activeNode.type === 'spinoff' && activeNode.spinoffMode === 'offline') ? 'offline' : 'online');
            if (baseMode === 'offline') {
                isOfflineNode = true;
            }
        }
    }
    


    if (activeNode) {
        let nodePrompt = `当前为剧情节点「${activeNode.name}」，你正在扮演一个角色。请严格遵守以下规则：\n`;
        nodePrompt += `核心规则：\n`;
        nodePrompt += `A. 当前时间：现在是 ${currentTime}。\n\n`;
        
        nodePrompt += `角色和对话规则：\n`;
        if (worldBooksBefore) nodePrompt += `${worldBooksBefore}\n`;
        if (worldBooksMiddle) nodePrompt += `${worldBooksMiddle}\n`;
        
        nodePrompt += `<char_settings>\n`;
        nodePrompt += `1. 你的角色名是：${character.realName}。我的称呼是：${character.myName}。\n`;
        if (linkedChar) {
            nodePrompt += `2. 你的角色设定是：${getEffectivePersona(linkedChar)}\n`;
        } else {
            nodePrompt += `2. 你的角色设定是：${getEffectivePersona(character)}\n`;
        }
        if (worldBooksAfter) nodePrompt += `${worldBooksAfter}\n`;
        nodePrompt += `</char_settings>\n\n`;
        
        nodePrompt += `<user_settings>\n`;
        if (character.myPersona) {
            nodePrompt += `3. 关于我的人设：${character.myPersona}\n`;
        }
        if (character.myEnableDynamicAge && character.myBirthday) {
            const today = new Date();
            const birthDate = new Date(character.myBirthday);
            let age = today.getFullYear() - birthDate.getFullYear();
            const m = today.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                age--;
            }
            if (m === 0 && today.getDate() === birthDate.getDate()) {
                nodePrompt += `[System Notice] ✨重要✨ 与你对话的用户（称呼：${character.myName}）出生于${birthDate.getFullYear()}年${birthDate.getMonth() + 1}月${birthDate.getDate()}日，今天正是他/她的${age}岁生日！请在对话中自然地表现出你对这一点的知晓和关心。\n`;
            } else {
                nodePrompt += `[System Notice] 与你对话的用户（称呼：${character.myName}）出生于${birthDate.getFullYear()}年${birthDate.getMonth() + 1}月${birthDate.getDate()}日，现在的年龄是${age}岁。\n`;
            }
        }
        if (character.myEnableDynamicTimezone && character.myTimezone) {
            const timeStr = getLocalTimeInTimezone(character.myTimezone);
            if (timeStr) {
                nodePrompt += `[System Notice] 与你对话的用户（称呼：${character.myName}）当前所在的当地时间是：${timeStr} (${character.myTimezone})。\n`;
            }
        }
        nodePrompt += `</user_settings>\n\n`;
        
        nodePrompt += `<node_directive>\n${activeNode.prompt}\n</node_directive>\n\n`;
        
        if (activeNode.readMemory) {
            nodePrompt += `<memoir>\n`;
            const combinedNodeMemory = buildCombinedLongTermMemoryContext(character);
            if (combinedNodeMemory) nodePrompt += `${combinedNodeMemory}\n`;

                let startIndex = -1;
                for (let i = character.history.length - 1; i >= 0; i--) {
                    const m = character.history[i];
                    if (m.isNodeBoundary && m.nodeAction === 'start' && m.nodeId === character.activeNodeId) {
                        startIndex = i;
                        break;
                    }
                }
                if (startIndex !== -1) {
                    let pastOnlineMsgs = character.history.slice(0, startIndex);
                    if (typeof filterHistoryForAI === 'function') {
                        pastOnlineMsgs = filterHistoryForAI(character, pastOnlineMsgs);
                    }
                    pastOnlineMsgs = pastOnlineMsgs.filter(m => !m.isContextDisabled && !m.isThinking);
                    
                    const maxMemory = character.maxMemory || 20;
                    pastOnlineMsgs = pastOnlineMsgs.slice(-maxMemory);
                    
                    if (pastOnlineMsgs.length > 0) {
                        const pastOnlineText = pastOnlineMsgs.map(m => {
                            let content = m.content;
                            if (m.parts && m.parts.length > 0) content = m.parts.map(p => p.text || '[图片]').join('');
                            const senderName = m.role === 'user' ? character.myName : character.realName;
                            return `${senderName}: ${content}`;
                        }).join('\n');
                        
                        nodePrompt += `<past_online_chats>\n【过往线上聊天记录】\n以下是进入当前节点前，我们之间的线上聊天记录，作为背景参考：\n${pastOnlineText}\n</past_online_chats>\n\n`;
                    }
                }

                // 群聊记忆互通功能
                if (character.syncGroupMemory) {
                    let groupsWithCharacter = db.groups.filter(group => 
                        group.members && group.members.some(member => member.originalCharId === character.id)
                    );
                    if (character.syncGroupIds && Array.isArray(character.syncGroupIds) && character.syncGroupIds.length > 0) {
                        groupsWithCharacter = groupsWithCharacter.filter(group => 
                            character.syncGroupIds.includes(group.id)
                        );
                    }
                    if (groupsWithCharacter.length > 0) {
                        let groupMemoryContext = '';
                        groupsWithCharacter.forEach(group => {
                            let groupFavoritedJournals = (group.memoryJournals || []).filter(j => j.isFavorited);
                            const summaryCount = character.groupMemorySummaryCount || 0;
                            if (summaryCount > 0 && groupFavoritedJournals.length > summaryCount) {
                                groupFavoritedJournals = groupFavoritedJournals.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, summaryCount);
                            }
                            const groupFavoritedJournalsText = groupFavoritedJournals.map(j => `标题：${j.title}\n内容：${j.content}`).join('\n\n---\n\n');
                            const maxGroupHistory = character.groupMemoryHistoryCount || 20;
                            let recentGroupHistory = group.history.slice(-maxGroupHistory);
                            if (typeof filterHistoryForAI === 'function') {
                                recentGroupHistory = filterHistoryForAI(group, recentGroupHistory);
                            }
                            recentGroupHistory = recentGroupHistory.filter(m => !m.isContextDisabled);
                            if (groupFavoritedJournalsText || recentGroupHistory.length > 0) {
                                groupMemoryContext += `\n【群聊"${group.name}"的背景信息】\n`;
                                if (groupFavoritedJournalsText) groupMemoryContext += `群聊总结：\n${groupFavoritedJournalsText}\n`;
                                if (recentGroupHistory.length > 0) {
                                    const historyText = recentGroupHistory.map(m => {
                                        let content = m.content;
                                        if (m.parts && m.parts.length > 0) content = m.parts.map(p => p.text || '[图片]').join('');
                                        const senderName = m.senderId ? (group.members.find(mem => mem.id === m.senderId)?.groupNickname || '未知') : (m.role === 'user' ? group.me.nickname : '系统');
                                        return `${senderName}: ${content}`;
                                    }).join('\n');
                                    groupMemoryContext += `最近群聊记录：\n${historyText}\n`;
                                }
                            }
                        });
                        if (groupMemoryContext) {
                            nodePrompt += `<group_memories>\n【群聊记忆互通】\n以下是你所在群聊的相关背景信息，这些信息可以帮助你更好地理解我们之间的对话上下文：${groupMemoryContext}\n</group_memories>\n`;
                        }
                    }
                }
            nodePrompt += `</memoir>\n\n`;
        }
        
        let baseMode = (activeNode.customConfig && activeNode.customConfig.baseMode) ? activeNode.customConfig.baseMode : 
                       (activeNode.type === 'offline' || (activeNode.type === 'spinoff' && activeNode.spinoffMode === 'offline') ? 'offline' : 'online');

        nodePrompt += `<logic_rules>\n`;
        if (baseMode === 'offline') {
            nodePrompt += `4. [system: xxx]：这是一条系统指令，用于设定场景或提供上下文，此条信息不应在对话中被直接提及，你只需理解其内容并应用到后续对话中。\n`;
            nodePrompt += `5. 当前为线下现实互动模式。用户的输入代表其在现实中的动作、神态、话语或推动剧情的指令。请综合理解用户的输入，并进行现实中的互动回应。\n`;
            nodePrompt += `6. 你的回复必须是长文本剧情，在一条剧情消息内输出，字数若无特殊要求则在800-1000字之内。\n`;
            nodePrompt += `7. 严禁使用任何网络聊天格式（如发送语音、表情包、转账等）。\n`;
        } else {
            nodePrompt += `4. [system: xxx]：这是一条系统指令，用于设定场景或提供上下文，此条信息不应在对话中被直接提及，你只需理解其内容并应用到后续对话中。\n`;
            nodePrompt += `5. 你的所有回复都必须直接是聊天内容，绝对不允许包含任何如[心理活动]、(动作)、*环境描写*等多余的、在括号或星号里的叙述性文本。\n`;
            nodePrompt += getOnlineLogicRules(character, 6);
        }
        nodePrompt += `</logic_rules>\n\n`;

        if (activeNode.customConfig && activeNode.customConfig.extendedRules) {
            nodePrompt += `<extended_rules>\n${activeNode.customConfig.extendedRules}\n</extended_rules>\n\n`;
        }

        if (baseMode === 'offline' && activeNode.customConfig && activeNode.customConfig.styleWorldBookIds && activeNode.customConfig.styleWorldBookIds.length > 0) {
            const styleWbContents = activeNode.customConfig.styleWorldBookIds
                .map(id => db.worldBooks.find(wb => wb.id === id))
                .filter(wb => wb && !wb.disabled)
                .map(wb => wb.content)
                .join('\n\n');
            if (styleWbContents) {
                nodePrompt += `<writing_style>\n【文风参考】\n请参考以下文风设定进行描写：\n${styleWbContents}\n</writing_style>\n\n`;
            }
        }

        if (character.statusPanel && character.statusPanel.enabled && character.statusPanel.promptSuffix) {
            nodePrompt += `15. 额外输出要求：${character.statusPanel.promptSuffix}\n`;
        }

        nodePrompt += `<output_formats>\n`;
        nodePrompt += `8. 你的基础输出格式必须严格遵循以下格式：\n`;
        
        if (baseMode === 'offline') {
            nodePrompt += getOfflineOutputFormats(character) + '\n';
        } else {
            nodePrompt += getOnlineOutputFormats(character, worldBooksBefore, worldBooksAfter) + '\n';
            if (activeNode.customConfig && activeNode.customConfig.injectedFormats) {
                nodePrompt += getInjectedFormatsPrompt(character, activeNode.customConfig.injectedFormats);
            }
        }

        if (activeNode.customConfig && activeNode.customConfig.customOutputFormat) {
            let formats = activeNode.customConfig.customOutputFormat;
            if (Array.isArray(formats)) {
                formats = formats.map(f => {
                    if (typeof f === 'object' && f !== null) return f.format || '';
                    return f;
                }).filter(f => f.trim() !== '').join('\n');
            }
            if (formats) {
                nodePrompt += `\n【自定义输出格式】\n${formats}\n`;
                nodePrompt += `(注：对于上述自定义输出格式，请务必使用类似 [动作/角色名：内容] 的中括号包裹形式，否则系统前端将无法正确解析和渲染)\n`;
            }
        }
        nodePrompt += `</output_formats>

`;
        nodePrompt = replacePromptAliases(nodePrompt, character, linkedChar);
        
        if (opts && opts.historyText) {
            nodePrompt += '\n' + opts.historyText;
        }

        if (opts.enableMemorySidecar && window.MemoryTableSidecar) {
            nodePrompt += window.MemoryTableSidecar.buildSystemPrompt(character);
        }
        return window.OVORetiredFeaturePolicy?.sanitizeSystemPrompt?.(nodePrompt) || nodePrompt;
    }

    // V5.8.0：默认私聊按角色扮演语义层级组装，而不是把功能残差堆进“核心系统规则”。
    // 核心档案仍存储在记忆表中，但发送时作为前置身份锚点；世界书三个位置是真实插入点。
    const memoryProjects = getStructuredArchiveMemoryProjects(character);
    const groupMemory = buildGroupMemoryProjectContent(character);
    const longTermMemory = [memoryProjects.longTerm, groupMemory].filter(Boolean).join('\n\n');
    const promptProjects = [
        { tag: 'session_rules', content: buildSessionProjectContent(character, currentTime) },
        { tag: 'worldbook_identity_before', content: worldBooksBefore },
        { tag: 'identity_core', content: buildCoreIdentityProjectContent(character, linkedChar, memoryProjects) },
        { tag: 'worldbook_identity_after', content: worldBooksMiddle },
        { tag: 'long_term_memory', content: longTermMemory },
        { tag: 'worldbook_scene_after', content: worldBooksAfter },
        { tag: 'current_related_memory', content: memoryProjects.currentRelated },
        { tag: 'current_environment', content: buildEnvironmentProjectContent(character, opts) },
        { tag: 'interaction_rules', content: buildInteractionProjectContent(character) },
        { tag: 'output_formats', content: buildOutputProjectContent(character, worldBooksBefore, worldBooksMiddle, worldBooksAfter) },
        { tag: 'background_write', content: buildBackgroundWriteProjectContent(character, opts) }
    ];
    const prompt = serializePrivatePromptProjects(promptProjects, character, linkedChar);
    return window.OVORetiredFeaturePolicy?.sanitizeSystemPrompt?.(prompt) || prompt;
}

// 根据文本估算 Token（汉字约 1.2，其他约 0.4，与 estimateChatTokens 一致）
function estimateTokenFromText(text) {
    if (!text || typeof text !== 'string') return 0;
    const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const other = text.length - chinese;
    return Math.ceil(chinese * 1.2 + other * 0.4);
}

// 估算当前对话上下文的 Token 数
function estimateChatTokens(chatId, chatType = 'private') {
    const breakdown = getChatTokenBreakdown(chatId, chatType);
    return breakdown ? breakdown.total : 0;
}

// 获取 Token 分布（细分：系统规则、世界书、角色人设、用户人设、表情包、长期记忆、窥屏、对话主题、记忆互通、群聊记忆、短期记忆等），用于饼图与详情展示
function getChatTokenBreakdown(chatId, chatType = 'private') {
    const chat = (chatType === 'private') ? db.characters.find(c => c.id === chatId) : db.groups.find(g => g.id === chatId);
    if (!chat) return null;

    let useCustomPrompt = false;
    if (chatType === 'private' && chat.customPromptPreset && db.magicRoom && db.magicRoom.presets) {
        const preset = db.magicRoom.presets.find(p => p.name === chat.customPromptPreset);
        if (preset) useCustomPrompt = true;
    }
    
    // 如果开启了自定义底层提示词或者是群聊，走旧逻辑（整体 systemPrompt 拆分）
    if (chatType !== 'private' || (db.magicRoom && db.magicRoom.customPromptEnabled) || useCustomPrompt) {
        return _getChatTokenBreakdownGroup(chat, chatType);
    }

    // V5.8.0 默认私聊：Token 分布直接读取与最终请求一致的项目标签，避免继续显示旧“角色人设/用户人设/核心规则”拆分。
    if (chat.activeNodeId && Array.isArray(chat.nodes) && chat.nodes.some(node => node.id === chat.activeNodeId)) {
        return _getChatTokenBreakdownGroup(chat, chatType);
    }
    const character = chat;
    let fullSystemPrompt = typeof generatePrivateSystemPrompt === 'function'
        ? generatePrivateSystemPrompt(character, { weatherText: '', enableMemorySidecar: true })
        : '';
    fullSystemPrompt = appendMessageMetadataProtocol(fullSystemPrompt);
    const projectSpecs = [
        ['session_rules', 'sessionRules', '00 会话总规则', '当前会话、时间、模式、动态年龄与时区。'],
        ['worldbook_identity_before', 'worldBookIdentityBefore', '01 世界书·身份前', '核心档案之前的世界基础与客观规则。'],
        ['identity_core', 'identityCore', '02 核心档案', '按字段分类发送的角色、用户与双方关系身份锚点。'],
        ['worldbook_identity_after', 'worldBookIdentityAfter', '03 世界书·身份后', '核心档案之后的身份环境、组织、人物与关系补充。'],
        ['long_term_memory', 'longTermMemory', '04 长期关系记忆', '中期总结、稳定长期记忆和长期群聊补充。'],
        ['worldbook_scene_after', 'worldBookSceneAfter', '05 世界书·场景后置', '靠近当前语境的场景、节点与高影响设定。'],
        ['current_related_memory', 'currentRelatedMemory', '06 当前与相关记忆', '当前状态、相关收藏、待办及其他本轮命中的记忆。'],
        ['current_environment', 'currentEnvironment', '07 当前环境', '天气、主题变化和本轮临时关系环境。'],
        ['interaction_rules', 'interactionRules', '08 互动规则', '模型理解消息与维持角色行为的规则。'],
        ['output_formats', 'outputRules', '09 输出规则', '消息格式、回复节奏、状态面板和防复读要求。'],
        ['background_write', 'backgroundWrite', '10 后台写入', '收藏记忆与动态记忆的隐藏写入协议。'],
        ['message_metadata_protocol', 'messageMetadata', '11 消息说明', '历史消息时间标签等内部元数据说明。']
    ];
    const details = projectSpecs.map(([tag, key, name, desc]) => {
        const block = extractPromptTagBlock(fullSystemPrompt, tag);
        return { key, name, value: estimateTokenFromText(block), desc };
    }).filter(item => item.value > 0);

    let historySlice = getRequestHistorySlice(chat, 'private', chat.history || []);
    historySlice = historySlice.filter(message => !message.isContextDisabled && !message.isThinking && !(typeof message.content === 'string' && message.content.trim().startsWith('<thinking>')));
    const historyText = historySlice.map(message => {
        if (message.parts?.length) return message.parts.map(part => part.text || part.description || (part.type === 'image' ? '[图片]' : part.type === 'sticker' ? '[表情包]' : '')).join('');
        return message.content || '';
    }).join('\n');
    const historyTokens = estimateTokenFromText(historyText);
    if (historyTokens > 0) details.push({ key: 'shortTermMemory', name: '聊天历史与本轮输入', value: historyTokens, desc: '按 Proment 历史条数策略进入最终消息数组的真实聊天内容。' });
    const total = details.reduce((sum, item) => sum + item.value, 0);
    return { total, details };
}

// 群聊 Token 分布（保持兼容，从完整 systemPrompt 拆分）
function _getChatTokenBreakdownGroup(chat, chatType = 'group') {
    let systemPrompt = '';
    if (chatType === 'private') {
        if (typeof generatePrivateSystemPrompt === 'function') {
            systemPrompt = generatePrivateSystemPrompt(chat);
        }
    } else {
        if (typeof generateGroupSystemPrompt === 'function') {
            systemPrompt = generateGroupSystemPrompt(chat);
        }
    }
    const memoirMatch = systemPrompt.match(/<memoir>([\s\S]*?)<\/memoir>/);
    const memoirText = memoirMatch ? memoirMatch[1].trim() : '';
    const personaPrompt = systemPrompt.replace(/<memoir>[\s\S]*?<\/memoir>/g, '').trim();

    let historySlice = (chat.history || []).slice(-(chat.maxMemory || 20));
    historySlice = historySlice.filter(m => !m.isContextDisabled);
    let shortTermText = '';
    historySlice.forEach(msg => {
        shortTermText += msg.content || '';
        if (msg.parts) {
            msg.parts.forEach(p => {
                if (p.type === 'text') shortTermText += p.text || '';
            });
        }
    });

    const promptPersonaTokens = estimateTokenFromText(personaPrompt);
    const longTermTokens = estimateTokenFromText(memoirText);
    const shortTermTokens = estimateTokenFromText(shortTermText);
    const total = promptPersonaTokens + longTermTokens + shortTermTokens;

    const details = [
        { key: 'promptPersona', name: '提示词人设', value: promptPersonaTokens, desc: '系统规则、角色设定、输出格式等发送给 AI 的固定提示词。' },
        { key: 'longTermMemory', name: '长期记忆', value: longTermTokens, desc: '已收藏的共同回忆（日记摘要），会长期保留在上下文中。' },
        { key: 'shortTermMemory', name: '短期记忆', value: shortTermTokens, desc: '最近对话消息，随轮次滑动窗口更新。' }
    ].filter(d => d.value > 0);

    return { total, details };
}

// --- 视频/语音通话专用 AI 逻辑 ---

async function getCallReply(chat, callType, callContext, onStreamUpdate) {
    let {url, key, model, provider, streamEnabled} = db.apiSettings;
    
    // 【用户设置】移除强制关闭流式，允许后台流式生成
    // streamEnabled = false; 

    if (!url || !key || !model) {
        showToast('请先在“api”应用中完成设置！');
        return;
    }
    if (url.endsWith('/')) url = url.slice(0, -1);

    // 1. 构建 System Prompt
    const now = new Date();
    let currentTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    if (chat.enableDynamicTimezone && chat.charTimezone) {
        const tzTime = getLocalTimeInTimezone(chat.charTimezone);
        if (tzTime) currentTime = tzTime;
    }
    
    // 获取世界书（包含全局）
    const { before: worldBooksBefore, middle: worldBooksMiddle, after: worldBooksAfter } = getActiveWorldBooksContents(chat);

    let systemPrompt = `你正在一个名为“404”的线上聊天软件中扮演一个角色，正在与${chat.myName}进行${callType === 'video' ? '视频' : '语音'}通话。请严格遵守以下规则：\n`;
    systemPrompt += `核心规则：\n`;
    systemPrompt += `A. 当前时间：现在是 ${currentTime}。你应知晓当前时间，但除非对话内容明确相关，否则不要主动提及或评论时间（例如，不要催促我睡觉）。\n`;
    if (!db.apiSettings || db.apiSettings.onlineRoleEnabled !== false) {
        systemPrompt += `B. 纯线上互动：这是一个完全虚拟的线上聊天。你扮演的角色和我之间没有任何线下关系。严禁提出任何关于线下见面、现实世界互动或转为其他非本平台联系方式的建议。你必须始终保持在线角色的身份。\n\n`;
    } else {
        systemPrompt += `\n`;
    }

    
    systemPrompt += `角色和对话规则：\n`;
    if (worldBooksBefore) {
        systemPrompt += `${worldBooksBefore}\n`;
    }
    if (worldBooksMiddle) {
        systemPrompt += `${worldBooksMiddle}\n`;
    }
    systemPrompt += `<char_settings>\n`;
    systemPrompt += `1. 你的角色名是：${chat.realName}。我的称呼是：${chat.myName}。你的当前状态是：${chat.status}。\n`;
    systemPrompt += `2. 你的角色设定是：${getEffectivePersona(chat)}\n`;
    if ((chat.source === 'forum' || chat.source === 'peek') && (chat.supplementPersonaEnabled || chat.supplementPersonaAiEnabled)) {
        systemPrompt += `3. 在对话中可根据与用户的互动逐步丰富、补充你的人设（用户可在设置中查看并编辑「已补齐的人设」）。\n`;
    }
    if (worldBooksAfter) {
        systemPrompt += `${worldBooksAfter}\n`;
    }
    systemPrompt += `</char_settings>\n\n`;
    systemPrompt += `<user_settings>\n`
    if (chat.myPersona) {
        systemPrompt += `3. 关于我的人设：${chat.myPersona}\n`;
    }
    systemPrompt += `</user_settings>\n`
    
    if (window.WeatherService) {
        const charWeather = await window.WeatherService.getCharacterWeatherPrompt(chat);
        const userWeather = await window.WeatherService.getUserWeatherPrompt(chat);
        if (charWeather || userWeather) {
            systemPrompt += `\n<environment>\n${charWeather ? charWeather + '\n' : ''}${userWeather ? userWeather + '\n' : ''}</environment>\n`;
        }
    }

    // 检查是否启用“角色活人运转” (默认关闭)
    if (db.cotSettings && db.cotSettings.humanRunEnabled) {
        systemPrompt += HUMAN_RUN_PROMPT + '\n';
    }

    try {
        await prepareCombinedLongTermMemoryContext(chat);
    } catch (error) {
        console.warn('[MemoryContext] failed to prepare call memory:', error);
    }
    systemPrompt += `<memoir>\n`;
    const combinedCallMemory = buildCombinedLongTermMemoryContext(chat);
    if (combinedCallMemory) systemPrompt += `${combinedCallMemory}\n`;
    systemPrompt += `</memoir>\n\n`;

    // --- 注入最近聊天记录 ---
    const maxMemory = chat.maxMemory || 20;
    let recentHistory = chat.history.slice(-maxMemory);
    
    // 使用通用过滤函数
    if (typeof filterHistoryForAI === 'function') {
        recentHistory = filterHistoryForAI(chat, recentHistory);
    }
    // 再次过滤掉不应进入上下文的消息
    recentHistory = recentHistory.filter(m => !m.isContextDisabled);

    if (recentHistory.length > 0) {
        const historyText = recentHistory.map(m => {
            // 简单清理内容中的特殊标签，避免干扰
            let content = m.content;
            // 如果是多模态消息(parts)，提取文本
            if (m.parts && m.parts.length > 0) {
                content = m.parts.map(p => p.text || '[图片]').join('');
            }
            return content;
        }).join('\n');

        systemPrompt += `<recent_chat_context>\n`;
        systemPrompt += `这是通话前的文字聊天记录（仅供参考背景，请勿重复回复，基于此背景进行自然的实时通话）：\n`;
        systemPrompt += `${historyText}\n`;
        systemPrompt += `</recent_chat_context>\n\n`;
    }

    systemPrompt += `【重要规则】\n`;
    systemPrompt += `1. 这是实时通话，请保持口语化，模拟真人的说话习惯，语气自然。\n`;  
    systemPrompt += `${callType === 'video' ? '你需要同时描述画面/环境音和你的语音内容。' : '你需要描述环境音和你的语音内容。'}\n`;
    systemPrompt += `2. 描述画面/环境音时，请使用描述性语言，第三人称视角，客观平然。`;

    // === 真实摄像头模式提示词注入 ===
    const realCameraActive = typeof VideoCallModule !== 'undefined' && VideoCallModule.state.realCameraActive;
    if (realCameraActive) {
        systemPrompt += `\n【真实摄像头模式】\n`;
        systemPrompt += `${chat.myName}已开启真实摄像头，你可以通过附带的图片看到${chat.myName}的真实画面。请根据你看到的画面内容自然地融入对话中（比如评论对方的穿着、表情、动作、环境等），但不要每次都刻意提及，保持自然。如果图片模糊或看不清，也不必强行描述。\n`;
    }

    // === 视频通话生图模式 ===
    const _vcNaiEnabled = chat.vcNovelAiEnabled && db.novelAiSettings && db.novelAiSettings.enabled && db.novelAiSettings.token && callType === 'video';
    const _vcGptDrawEnabled = chat.vcGptDrawEnabled && db.gptImageSettings && db.gptImageSettings.enabled && db.gptImageSettings.url && db.gptImageSettings.key && callType === 'video';
    if (_vcNaiEnabled || _vcGptDrawEnabled) {
        systemPrompt += `\n【视频通话生图模式】\n`;
        systemPrompt += `你正在视频通话中，每次回复时你必须额外输出一条 [${chat.realName}的画面生图：{{english, danbooru, tags}}] 来描述当前视频画面中你的样子。\n`;
        systemPrompt += `tag 规则：根据角色性别用 1boy 或 1girl，必须包含角色外貌特征（发色、瞳色、发型等）、当前服装、表情、动作/姿势、背景/场景。不要加质量词。不超过 25 个 tag。用英文逗号分隔。\n`;
        systemPrompt += `示例：[${chat.realName}的画面生图：{{1girl, long black hair, blue eyes, white t-shirt, smiling, waving hand, bedroom, sitting on bed, webcam view, looking at viewer}}]\n`;
        systemPrompt += `每次回复都必须包含恰好一条画面生图指令，放在回复最前面。\n\n`;
    }

    systemPrompt += `【输出格式】\n`;
    systemPrompt += `请严格按照以下格式输出（可以发送多条）：\n`;
    if (_vcNaiEnabled || _vcGptDrawEnabled) {
        systemPrompt += `[${chat.realName}的画面生图：{{english, danbooru, tags}}]（每次必须恰好输出一条）\n`;
    }
    systemPrompt += `${callType === 'video' ? `[${chat.realName}的画面/环境音：描述画面动作或环境声音]\n[${chat.realName}的声音：${chat.realName}说话的内容]` : `[${chat.realName}的环境音：描述环境声音]\n[${chat.realName}的声音：${chat.realName}说话的内容]`}\n`;

    // 2. 构建消息历史
    // 将 callContext 转换为 API 格式
    const messages = [{role: 'system', content: systemPrompt}];
    
    // 获取真实摄像头截图（如果有）
    const capturedFrame = (typeof VideoCallModule !== 'undefined' && VideoCallModule.state.lastCapturedFrame) ? VideoCallModule.state.lastCapturedFrame : null;

    callContext.forEach((msg, idx) => {
        const role = msg.role === 'ai' ? 'assistant' : 'user';
        let content = msg.content;
        
        // 去掉可能存在的首尾括号，避免双重括号
        let cleanContent = msg.content.replace(/^\[\s*|\s*\]$/g, '');

        if (msg.role === 'user') {
            if (msg.type === 'visual') {
                content = `[${chat.myName}的画面/环境音：${cleanContent}]`;
            } else if (msg.type === 'voice') {
                content = `[${chat.myName}的声音：${cleanContent}]`;
            }
        } else if (msg.role === 'ai') {
            if (msg.type === 'visual') {
                content = `[${chat.realName}的画面/环境音：${cleanContent}]`;
            } else {
                content = `[${chat.realName}的声音：${cleanContent}]`;
            }
        }

        // 在最后一条用户消息上附加摄像头截图
        const isLastUserMsg = msg.role === 'user' && idx === callContext.length - 1;
        if (isLastUserMsg && capturedFrame && realCameraActive) {
            messages.push({
                role,
                content: [
                    { type: 'text', text: content },
                    { type: 'image_url', image_url: { url: capturedFrame } }
                ]
            });
        } else {
            messages.push({role, content});
        }
    });

    // === 插入 CoT 序列 (如果开启) ===
    let useCharCot = false;
    if (chat.cotSettings && chat.cotSettings.enabled) {
        useCharCot = true;
    }
    const cotEnabled = useCharCot ? chat.cotSettings.callEnabled : (db.cotSettings && db.cotSettings.callEnabled);
    
    if (cotEnabled) {
        let cotInstruction = '';
        const activePresetId = useCharCot ? (chat.cotSettings.activeCallPresetId || 'default_call') : ((db.cotSettings && db.cotSettings.activeCallPresetId) || 'default_call');
        const preset = (db.cotPresets || []).find(p => p.id === activePresetId);
        
        if (preset && preset.items) {
            cotInstruction = preset.items
                .filter(item => item.enabled)
                .map(item => item.content)
                .join('\n\n');
        }

        if (cotInstruction) {
            // 1. 插入后置指令
            messages.push({
                role: 'system',
                content: cotInstruction
            });

            // 2. 插入触发器
            messages.push({
                role: 'user',
                content: '[incipere]'
            });

            // 3. 插入 Prefill (预填/强塞)
            const quickReply = db.apiSettings && db.apiSettings.quickReplyEnabled;
            messages.push({
                role: 'assistant',
                content: quickReply
                    ? '<thinking>\n跳过cot，专注回复\n</thinking>\n[finire]'
                    : '<thinking>'
            });
        }
    }
    // ===============================

    // 3. 发起请求
    const outgoingMessages = normalizeMessagesForProvider(messages, provider);
    const requestBody = {
        model: model,
        messages: outgoingMessages,
        stream: streamEnabled,
        temperature: 0.7 // 通话稍微低一点，保持稳定
    };

    // 适配 Gemini
    if (provider === 'gemini') {
         const contents = messages.filter(m => m.role !== 'system').map(m => {
            const role = m.role === 'assistant' ? 'model' : 'user';
            let parts;
            if (Array.isArray(m.content)) {
                // 多模态消息（文本+图片）
                parts = m.content.map(p => {
                    if (p.type === 'text') return { text: p.text };
                    if (p.type === 'image_url' && p.image_url && p.image_url.url) {
                        const match = p.image_url.url.match(/^data:(image\/(.+));base64,(.*)$/);
                        if (match) return { inline_data: { mime_type: match[1], data: match[3] } };
                    }
                    return null;
                }).filter(Boolean);
            } else {
                parts = [{ text: m.content }];
            }
            return { role, parts };
        });
        requestBody.contents = contents;
        
        // 合并所有 system 消息到 system_instruction
        const allSystemPrompts = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
        requestBody.system_instruction = {parts: [{text: allSystemPrompts}]};
        
        delete requestBody.messages;
    }

    const endpoint = (provider === 'gemini') ? `${url}/v1beta/models/${model}:streamGenerateContent?key=${getRandomValue(key)}` : `${url}/v1/chat/completions`;
    const headers = (provider === 'gemini') ? {'Content-Type': 'application/json'} : {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
    };

    console.log('[VideoCall] Request Body:', JSON.stringify(requestBody, null, 2));

    try {
        if (!window.OVOAIRequestGateway?.send) throw new Error('统一 AI 请求网关尚未加载');
        const response = await window.OVOAIRequestGateway.send({
            task: 'call.reply', source: 'chat-ai-video-call', provider, model,
            endpoint, headers, body: requestBody, timeoutMs: streamEnabled ? 300000 : 180000,
            operationType: 'call.reply', operationStage: '正在生成通话回复',
            promptSources: [
                { type: 'task_instruction', registryId: 'call.source', title: '通话系统与会话上下文', content: messages.map(item => typeof item.content === 'string' ? item.content : '').filter(Boolean).join('\n'), reason: '本次通话回复使用的角色规则、通话记录和控制消息' }
            ]
        });

        if (!streamEnabled) {
            const data = await response.json();
            console.log('[VideoCall] Response Data:', data);
            
            let text = "";
            if (provider === 'gemini') {
                text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
            } else {
                if (!data.choices || !data.choices.length || !data.choices[0].message) {
                    console.error("Invalid API Response Structure:", data);
                    throw new Error("API返回数据格式异常，缺少 choices 或 message 字段");
                }
                text = data.choices[0].message.content;
            }

            // === CoT 处理：补全开头，提取思考，净化输出 ===
            let useCharCot = false;
            if (chat.cotSettings && chat.cotSettings.enabled) {
                useCharCot = true;
            }
            const currentCotEnabled = useCharCot ? chat.cotSettings.callEnabled : (db.cotSettings && db.cotSettings.callEnabled);
            
            if (currentCotEnabled && text) {
                // 1. 补全开头 (如果被 Prefill 吃掉)
                if (!text.trim().startsWith('<thinking>') && text.includes('</thinking>')) {
                    text = '<thinking>' + text;
                }
                
                // 2. 提取并移除思考内容
                const thinkingMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/);
                if (thinkingMatch) {
                    const thinkingContent = thinkingMatch[1];
                    console.log('[VideoCall CoT] Thinking:', thinkingContent);
                    // 移除思考标签及内容
                    text = text.replace(/<thinking>[\s\S]*?<\/thinking>/, "").trim();
                }
                
                // 3. 移除 [incipere] (如果有残留)
                text = text.replace(/\[incipere\]/g, "");
            }
            // =============================================

            console.log('[VideoCall] Cleaned AI Response:', text);
            // 一次性回调
            onStreamUpdate(text);
            return text;
        } else {
            console.log('[VideoCall] Stream started (Background Mode)...');
            // 流式处理 (照搬 processStream 逻辑)
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let accumulatedChunk = ""; // 引入累积缓冲区处理跨包数据
            
            while (true) {
                const {done, value} = await reader.read();
                if (done) break;
                accumulatedChunk += decoder.decode(value, {stream: true});
                
                // OpenAI / DeepSeek / Claude / NewAPI 解析逻辑 (处理跨包)
                if (provider === "openai" || provider === "deepseek" || provider === "claude" || provider === "newapi") {
                    const parts = accumulatedChunk.split("\n\n");
                    accumulatedChunk = parts.pop(); // 保留未完成的部分
                    for (const part of parts) {
                        if (part.startsWith("data: ")) {
                            const data = part.substring(6);
                            if (data.trim() !== "[DONE]") {
                                try {
                                    const text = JSON.parse(data).choices[0].delta?.content || "";
                                    if (text) {
                                        buffer += text;
                                    }
                                } catch (e) { }
                            }
                        }
                    }
                }
            }

            // Gemini 解析逻辑 (在流结束后处理完整 JSON)
            if (provider === "gemini") {
                try {
                    // 尝试解析累积的 chunk (Gemini 流式返回的是完整的 JSON 数组片段？需确认 processStream 逻辑)
                    // processStream 中 Gemini 解析是在循环外的，假设 accumulatedChunk 是完整的 JSON 数组
                    // 但如果 accumulatedChunk 是多个 JSON 对象的拼接（如 OpenAI 格式），JSON.parse 会失败。
                    // 这里假设 processStream 的逻辑是正确的：
                    const parsedStream = JSON.parse(accumulatedChunk);
                    buffer = parsedStream.map(item => item.candidates?.[0]?.content?.parts?.[0]?.text || "").join('');
                } catch (e) {
                    console.error("Error parsing Gemini stream:", e, "Chunk:", accumulatedChunk);
                    // 兜底：如果解析失败，可能是因为 accumulatedChunk 包含了 OpenAI 格式的数据（如果用户选错 provider）
                    // 尝试用 OpenAI 逻辑解析一下？
                    // 暂时不加，保持与 processStream 一致
                }
            }

            console.log('[VideoCall] Final Buffer:', buffer);

            // === CoT 处理：补全开头，提取思考，净化输出 ===
            let useCharCotStream = false;
            if (chat.cotSettings && chat.cotSettings.enabled) {
                useCharCotStream = true;
            }
            const currentCotEnabledStream = useCharCotStream ? chat.cotSettings.callEnabled : (db.cotSettings && db.cotSettings.callEnabled);

            if (currentCotEnabledStream && buffer) {
                // 1. 补全开头 (如果被 Prefill 吃掉)
                if (!buffer.trim().startsWith('<thinking>') && buffer.includes('</thinking>')) {
                    buffer = '<thinking>' + buffer;
                }
                
                // 2. 提取并移除思考内容
                const thinkingMatch = buffer.match(/<thinking>([\s\S]*?)<\/thinking>/);
                if (thinkingMatch) {
                    const thinkingContent = thinkingMatch[1];
                    console.log('[VideoCall CoT] Thinking:', thinkingContent);
                    // 移除思考标签及内容
                    buffer = buffer.replace(/<thinking>[\s\S]*?<\/thinking>/, "").trim();
                }
                
                // 3. 移除 [incipere] (如果有残留)
                buffer = buffer.replace(/\[incipere\]/g, "");
            }

            // 流结束后一次性回调
            onStreamUpdate(buffer);
            return buffer;
        }
    } catch (e) {
        console.error("Call API Error:", e);
        showToast("通话连接不稳定...");
        return null;
    }
}

async function generateCallSummary(chat, callContext) {
    // === 使用总结API（如果已配置）===
    let apiConfig;
    if (db.summaryApiSettings && db.summaryApiSettings.url && db.summaryApiSettings.key && db.summaryApiSettings.model) {
        apiConfig = db.summaryApiSettings;
    } else {
        apiConfig = db.apiSettings;
    }
    
    let {url, key, model, provider} = apiConfig;
    if (!url || !key || !model) return null;
    if (url.endsWith('/')) url = url.slice(0, -1);

    // 获取世界书（包含全局）
    const { before: worldBooksBefore, middle: worldBooksMiddle, after: worldBooksAfter } = getActiveWorldBooksContents(chat);

    // 获取回忆日记
    const favoritedJournals = (chat.memoryJournals || [])
        .filter(j => j.isFavorited)
        .map(j => `标题：${j.title}\n内容：${j.content}`)
        .join('\n\n---\n\n');

    let prompt = `请根据以下背景信息和通话记录，生成一段简短的聊天记录总结。\n\n`;

    prompt += `<char_settings>\n`;
    prompt += `角色名：${chat.realName}\n`;
    prompt += `角色设定：${getEffectivePersona(chat) || "无"}\n`;
    if (worldBooksBefore) prompt += `${worldBooksBefore}\n`;
    if (worldBooksMiddle) prompt += `${worldBooksMiddle}\n`;
    if (worldBooksAfter) prompt += `${worldBooksAfter}\n`;
    prompt += `</char_settings>\n\n`;

    prompt += `<user_settings>\n`;
    prompt += `用户称呼：${chat.myName}\n`;
    prompt += `用户人设：${chat.myPersona || "无"}\n`;
    prompt += `</user_settings>\n\n`;

    if (favoritedJournals) {
        prompt += `<memoir>\n`;
        prompt += `【共同回忆】\n${favoritedJournals}\n`;
        prompt += `</memoir>\n\n`;
    }

    prompt += `通话记录：\n`;
    prompt += `${callContext.map(m => `${m.role === 'ai' ? chat.realName : chat.myName} (${m.type}): ${m.content}`).join('\n')}\n\n`;

    prompt += `要求：\n`;
    prompt += `1. 第三人称叙述。\n`;
    prompt += `2. **客观平实**：使用第三人称视角，客观陈述事实。**绝对禁止使用强烈的情绪词汇**（如“极度愤怒”、“痛彻心扉”、“欣喜若狂”等），保持冷静、克制的叙述风格。\n`;
    prompt += `3. **无升华**：不要进行价值升华、感悟或总结性评价，仅记录发生了什么。\n`;
    prompt += `4. 不要包含“通话记录如下”等废话，直接输出总结内容。\n`;

    const messages = [{role: 'user', content: prompt}];
    
    const requestBody = {
        model: model,
        messages: messages,
        stream: false
    };
    
    if (provider === 'gemini') {
         requestBody.contents = [{role: 'user', parts: [{text: prompt}]}];
         delete requestBody.messages;
    }

    const endpoint = (provider === 'gemini') ? `${url}/v1beta/models/${model}:generateContent?key=${getRandomValue(key)}` : `${url}/v1/chat/completions`;
    const headers = (provider === 'gemini') ? {'Content-Type': 'application/json'} : {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
    };

    try {
        if (!window.OVOAIRequestGateway?.send) throw new Error('统一 AI 请求网关尚未加载');
        const response = await window.OVOAIRequestGateway.send({
            task: 'call.summary', source: 'chat-ai-call-summary', provider, model,
            endpoint, headers, body: requestBody, timeoutMs: 180000,
            operationType: 'call.summary', operationStage: '正在整理通话记录',
            promptSources: [{ type: 'task_instruction', registryId: 'call.source', title: '通话总结要求', content: prompt, reason: '根据本次通话记录生成客观摘要' }]
        });
        const data = await response.json();
        let text = "";
        if (provider === 'gemini') {
            text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        } else {
            text = data.choices[0].message.content;
        }
        return text.trim();
    } catch (e) {
        console.error("Summary API Error:", e);
        return null;
    }
}
