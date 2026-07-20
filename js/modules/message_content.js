// 统一消息内容解析：供收藏、搜索与其他列表预览复用。
(function (global) {
    'use strict';

    const PATTERNS = Object.freeze([
        { type: 'message', regex: /^\[(.*?)的消息：([\s\S]*?)\]$/ },
        { type: 'voice', regex: /^\[(.*?)的语音：([\s\S]*?)\]$/ },
        { type: 'sticker', regex: /^\[(.*?)的表情包：([\s\S]*?)\]$/ },
        { type: 'photo_video', regex: /^\[(.*?)发来的照片\/视频：([\s\S]*?)\]$/ }
    ]);

    function parse(content) {
        const raw = typeof content === 'string' ? content.trim() : '';
        for (const item of PATTERNS) {
            const match = raw.match(item.regex);
            if (!match) continue;
            return {
                type: item.type,
                sender: (match[1] || '').trim(),
                text: (match[2] || '').trim(),
                raw
            };
        }
        return { type: 'text', sender: '', text: raw, raw };
    }

    function getMessageRawContent(message) {
        if (!message) return '';
        if (typeof message.content === 'string') return message.content;
        if (Array.isArray(message.parts)) return message.parts.map(part => part?.text || '').join('\n').trim();
        return '';
    }

    function getPreview(content, options) {
        const opts = options && typeof options === 'object' ? options : {};
        const parsed = parse(content);
        const text = parsed.text || '';
        if (parsed.type === 'voice') return text ? `${opts.voiceLabel || '[语音]'} ${text}` : (opts.voiceLabel || '[语音]');
        if (parsed.type === 'sticker') return opts.stickerLabel || '[表情包]';
        if (parsed.type === 'photo_video') return opts.mediaLabel || '[照片/视频]';
        return text;
    }

    function snapshot(message) {
        const content = getMessageRawContent(message);
        const parsed = parse(content);
        return {
            content,
            contentType: parsed.type,
            plainText: parsed.text || getPreview(content)
        };
    }

    global.OvoMessageContent = Object.freeze({
        VERSION: '1.0.0',
        parse,
        getPreview,
        getMessageRawContent,
        snapshot
    });
})(window);
