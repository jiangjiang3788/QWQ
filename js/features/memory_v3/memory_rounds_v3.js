(function (global) {
    'use strict';

    const M = global.MemoryV5;
    if (!M?.model || !M?.util) throw new Error('MemoryV5 core must load before rounds');

    const { id, text, unique } = M.util;
    const activeRounds = new WeakMap();

    function messageText(message) {
        const raw = Array.isArray(message?.parts)
            ? message.parts.map(part => text(part?.text)).filter(Boolean).join('\n')
            : text(message?.content);
        return raw
            .replace(/^\[[^\]]+的消息[：:]\s*/u, '')
            .replace(/^\[[^\]]+的语音[：:]\s*/u, '')
            .replace(/^\[[^\]]+发送的消息[：:]\s*/u, '')
            .replace(/\]$/u, '')
            .trim();
    }

    function isConversationMessage(message) {
        return message && (message.role === 'user' || message.role === 'assistant');
    }

    function pendingUserMessages(chat) {
        const history = Array.isArray(chat?.history) ? chat.history : [];
        let boundary = -1;
        for (let index = history.length - 1; index >= 0; index -= 1) {
            if (history[index]?.role === 'assistant') {
                boundary = index;
                break;
            }
        }
        return history.slice(boundary + 1).filter(message => message?.role === 'user' && messageText(message));
    }

    function latestCompletedRoundMessages(chat) {
        const history = Array.isArray(chat?.history) ? chat.history : [];
        for (let index = history.length - 1; index >= 0; index -= 1) {
            const roundId = history[index]?.memoryRoundId;
            if (!roundId) continue;
            const messages = history.filter(message => message?.memoryRoundId === roundId && isConversationMessage(message));
            if (messages.length) return { roundId, messages };
        }

        // Old data fallback: latest contiguous assistant batch + the user batch immediately before it.
        let end = history.length - 1;
        while (end >= 0 && !isConversationMessage(history[end])) end -= 1;
        if (end < 0) return { roundId: null, messages: [] };
        const assistantMessages = [];
        while (end >= 0 && history[end]?.role === 'assistant') {
            assistantMessages.unshift(history[end]);
            end -= 1;
        }
        const userMessages = [];
        while (end >= 0) {
            const message = history[end];
            if (message?.role === 'assistant') break;
            if (message?.role === 'user') userMessages.unshift(message);
            end -= 1;
        }
        return { roundId: null, messages: userMessages.concat(assistantMessages) };
    }

    function beginRound(chat, meta = {}) {
        M.model.ensureStore(chat);
        const users = pendingUserMessages(chat);
        const token = {
            id: id('memory_round'),
            at: Date.now(),
            historyLength: Array.isArray(chat?.history) ? chat.history.length : 0,
            userMessageIds: users.map(message => message.id).filter(Boolean),
            isBackground: meta.isBackground === true,
            isSummary: meta.isSummary === true
        };
        users.forEach(message => { message.memoryRoundId = token.id; });
        activeRounds.set(chat, token);
        return token;
    }

    function finishRound(chat, token) {
        if (!chat || !token?.id) return null;
        const history = Array.isArray(chat.history) ? chat.history : [];
        const userIds = new Set(token.userMessageIds || []);
        history.forEach((message, index) => {
            if (userIds.has(message?.id) || index >= token.historyLength) {
                if (isConversationMessage(message)) message.memoryRoundId = token.id;
            }
        });
        const current = activeRounds.get(chat);
        if (current?.id === token.id) activeRounds.delete(chat);
        return token.id;
    }

    function activeRound(chat) {
        return activeRounds.get(chat) || null;
    }

    function activeRoundMessages(chat) {
        const token = activeRound(chat);
        if (!token) return [];
        const ids = new Set(token.userMessageIds || []);
        return (Array.isArray(chat?.history) ? chat.history : []).filter(message => ids.has(message?.id));
    }

    function roundMessages(chat, options = {}) {
        const current = activeRoundMessages(chat);
        if (current.length) return current;
        const pending = pendingUserMessages(chat);
        if (pending.length) return pending;
        if (options.currentOnly === true) return [];
        return latestCompletedRoundMessages(chat).messages;
    }

    function roundText(chat, options = {}) {
        const includeAssistant = options.includeAssistant !== false;
        const messages = roundMessages(chat, options).filter(message => includeAssistant || message.role === 'user');
        return messages.map(message => messageText(message)).filter(Boolean).join('\n').slice(-16000);
    }

    function roundPayload(chat) {
        const messages = roundMessages(chat, { currentOnly: true });
        const selected = messages.length ? messages : roundMessages(chat);
        return selected.map(message => ({
            role: message.role,
            text: messageText(message)
        })).filter(item => item.text);
    }

    function queryTerms(input) {
        const source = text(input).toLowerCase();
        const terms = source.split(/[\s，。！？、；：,.!?;:\n\[\]（）()“”"'《》<>]+/u)
            .map(item => item.trim()).filter(item => item.length >= 2 && item.length <= 32);
        const chineseChunks = source.match(/[\u3400-\u9fff]{2,12}/g) || [];
        chineseChunks.forEach(chunk => {
            if (chunk.length <= 4) terms.push(chunk);
            for (let size = 2; size <= Math.min(4, chunk.length); size += 1) {
                for (let index = 0; index + size <= chunk.length; index += 1) terms.push(chunk.slice(index, index + size));
            }
        });
        return unique(terms).slice(0, 80);
    }

    M.rounds = Object.freeze({
        messageText,
        pendingUserMessages,
        latestCompletedRoundMessages,
        beginRound,
        finishRound,
        activeRound,
        roundMessages,
        roundText,
        roundPayload,
        queryTerms
    });
})(window);
