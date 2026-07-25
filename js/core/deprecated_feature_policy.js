// QWQ V5.4.1 · retired feature policy
// 统一关闭已明确不使用的业务。旧数据保留在本地，但不会再被读取、写入或发送给 AI。
(function (global) {
    'use strict';

    const VERSION = '5.4.1';
    const RETIRED_FEATURES = Object.freeze([
        'node-summary',
        'family-card',
        'consumption-history',
        'phone-peek-awareness',
        'phone-impersonation-awareness',
        'phone-control',
        'phone-control-revocation',
        'phone-cross-chat-history',
        'alt-account-memory-sync',
        'bilingual-output'
    ]);

    const RETIRED_SOURCE_IDS = Object.freeze([
        'node.summary',
        'node.summary_protocol',
        'family.card',
        'consumption.history',
        'phone.peek_history',
        'phone.impersonation_history',
        'phone.control_permission',
        'phone.permission_revocation',
        'phone.cross_chat_control_history',
        'account.alias_memory',
        'output.bilingual_protocol',
        'output.bilingual_rules'
    ]);

    // 只识别系统内置协议，不对用户普通文本做关键词删除。
    const RETIRED_TAGS = Object.freeze([
        'alt_shared_memory',
        'main_shared_memory',
        'family_card_from_user',
        'family_card_to_user',
        'peek_awareness',
        'peek_impersonation_awareness',
        'phone_control'
    ]);

    const RETIRED_PROTOCOL_PATTERNS = Object.freeze([
        /\[phone-control:[^\]]*\]/gi,
        /\[(?:同意关闭|拒绝关闭)\]/g,
        /<summary>[\s\S]*?<\/summary>/gi,
        /\[摘要[：:][\s\S]*?\]/g,
        /^.*✨双语模式特别指令✨.*$/gmi
    ]);

    function stripTaggedBlock(text, tagName) {
        const safe = String(tagName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return String(text || '').replace(new RegExp(`<${safe}>[\\s\\S]*?<\\/${safe}>`, 'gi'), '');
    }

    function sanitizeSystemPrompt(text) {
        let output = String(text || '');
        RETIRED_TAGS.forEach(tag => { output = stripTaggedBlock(output, tag); });
        RETIRED_PROTOCOL_PATTERNS.forEach(pattern => { output = output.replace(pattern, ''); });
        output = output
            .replace(/^.*【小号记忆互通】.*$/gmi, '')
            .replace(/^.*【主号记忆互通】.*$/gmi, '')
            .replace(/^.*【重要：剧情摘要】.*$/gmi, '')
            .replace(/^.*格式严格为：<summary>.*$/gmi, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return output;
    }

    function sanitizeModelOutput(text) {
        let output = String(text || '');
        RETIRED_PROTOCOL_PATTERNS.forEach(pattern => { output = output.replace(pattern, ''); });
        RETIRED_TAGS.forEach(tag => { output = stripTaggedBlock(output, tag); });
        return output.replace(/\n{3,}/g, '\n\n').trim();
    }

    function sanitizeHistory(history) {
        return (Array.isArray(history) ? history : [])
            .filter(message => !message?.isNodeSummaryMsg)
            .map(message => {
                const clone = { ...message };
                delete clone.nodeSummary;
                if (typeof clone.content === 'string') clone.content = sanitizeModelOutput(clone.content);
                if (Array.isArray(clone.parts)) {
                    clone.parts = clone.parts.map(part => {
                        if (!part || typeof part !== 'object') return part;
                        const next = { ...part };
                        if (typeof next.text === 'string') next.text = sanitizeModelOutput(next.text);
                        return next;
                    });
                }
                return clone;
            })
            .filter(message => {
                const content = String(message?.content || '').trim();
                const partsText = Array.isArray(message?.parts)
                    ? message.parts.map(part => String(part?.text || '')).join('').trim()
                    : '';
                return content || partsText || (Array.isArray(message?.parts) && message.parts.some(part => part?.type === 'image'));
            });
    }

    function applyToCharacter(character) {
        if (!character || typeof character !== 'object') return character;
        // 仅关闭功能，不删除旧字段和旧数据，避免升级时造成数据损失。
        character.bilingualModeEnabled = false;
        character.phoneControlEnabled = false;
        character.phoneControlCharFilterEnabled = false;
        character.familyCardEnabled = false;
        if (character.peekScreenSettings && typeof character.peekScreenSettings === 'object') {
            character.peekScreenSettings.charAwarePeek = false;
            character.peekScreenSettings.impersonateEnabled = false;
        }
        if (Array.isArray(character.nodes)) {
            character.nodes.forEach(node => {
                if (node && typeof node === 'object') node.enableSummary = false;
            });
        }
        return character;
    }

    function applyToDatabase(database) {
        if (!database || typeof database !== 'object') return database;
        if (Array.isArray(database.characters)) database.characters.forEach(applyToCharacter);
        if (Array.isArray(database.groups)) {
            database.groups.forEach(group => {
                if (!group || typeof group !== 'object') return;
                group.bilingualModeEnabled = false;
                group.bilingualMembers = [];
            });
        }
        if (database.forumSettings && typeof database.forumSettings === 'object') {
            database.forumSettings.enableCharAltDm = false;
        }
        return database;
    }

    function textFromValue(value) {
        if (value == null) return '';
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) return value.map(textFromValue).join('\n');
        if (typeof value === 'object') {
            if (typeof value.text === 'string') return value.text;
            if (typeof value.content === 'string') return value.content;
            if (Array.isArray(value.parts)) return textFromValue(value.parts);
            try { return JSON.stringify(value); } catch (_) { return ''; }
        }
        return String(value);
    }

    function collectRequestText(body) {
        // 仅核验系统侧注入内容，避免用户在普通聊天中提到某个词时被误判为功能泄漏。
        const parts = [];
        if (body?.system_instruction) parts.push(textFromValue(body.system_instruction));
        if (body?.systemInstruction) parts.push(textFromValue(body.systemInstruction));
        if (Array.isArray(body?.messages)) {
            body.messages.filter(message => message?.role === 'system').forEach(message => parts.push(textFromValue(message?.content)));
        }
        return parts.filter(Boolean).join('\n');
    }

    function auditRequest(body) {
        const text = collectRequestText(body);
        const findings = [];
        RETIRED_TAGS.forEach(tag => {
            if (new RegExp(`<${tag}>`, 'i').test(text)) findings.push({ type: 'tag', value: tag });
        });
        const protocolChecks = [
            ['phone-control', /\[phone-control:/i],
            ['node-summary', /<summary>|\[摘要[：:]/i],
            ['bilingual-output', /双语模式特别指令|「中文翻译」/i]
        ];
        protocolChecks.forEach(([value, pattern]) => {
            if (pattern.test(text)) findings.push({ type: 'protocol', value });
        });
        return {
            ok: findings.length === 0,
            findings,
            requestChars: text.length,
            checkedAt: new Date().toISOString()
        };
    }

    function removeRetiredUi() {
        const selectors = [
            '#setting-bilingual-mode',
            '#setting-bilingual-style-container',
            '#setting-group-bilingual-mode',
            '#setting-group-bilingual-style-container',
            '#setting-group-bilingual-members-container',
            '#bilingual-char-select-modal',
            '#setting-phone-control-group',
            '#phone-control-warning-modal',
            '#phone-control-force-close-modal',
            '#phone-control-char-select-modal',
            '#phone-control-recycle-modal'
        ];
        selectors.forEach(selector => document.querySelector(selector)?.closest('.kkt-item')?.remove?.() || document.querySelector(selector)?.remove?.());
    }

    function init() {
        try { applyToDatabase(global.db); } catch (error) { console.warn('[RetiredFeaturePolicy] database policy failed:', error); }
        if (typeof document !== 'undefined') {
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', removeRetiredUi, { once: true });
            else removeRetiredUi();
        }
    }

    global.OVORetiredFeaturePolicy = Object.freeze({
        VERSION,
        RETIRED_FEATURES,
        RETIRED_SOURCE_IDS,
        sanitizeSystemPrompt,
        sanitizeModelOutput,
        sanitizeHistory,
        applyToCharacter,
        applyToDatabase,
        auditRequest,
        init
    });

    init();
})(window);
