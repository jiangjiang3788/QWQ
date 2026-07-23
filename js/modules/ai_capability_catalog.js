// OVO AI Capability Catalog - V2.10-R4
// 将模型任务映射到用户可读的产品操作。这里仅保存元数据，不包含业务实现或用户数据。
(function (global) {
    'use strict';

    const DEFINITIONS = [
        { type: 'chat.reply', title: '生成角色回复', category: '聊天', icon: '💬', tasks: ['private-chat'] },
        { type: 'chat.background', title: '生成后台回复', category: '聊天', icon: '🌙', tasks: ['background-chat'] },
        { type: 'chat.summary', title: '生成对话总结', category: '总结', icon: '📝', tasks: ['summary'] },
        { type: 'theater.generate', title: '生成小剧场', category: '小剧场', icon: '🎭', tasks: ['theater-generation'] },
        { type: 'theater.character', title: '角色创作小剧场', category: '小剧场', icon: '🎭', tasks: ['theater-character-generation'] },
        { type: 'journal.generate', title: '生成回忆日记', category: '日记', icon: '📔', tasks: ['journal-generation'] },
        { type: 'journal.summary', title: '整理回忆日记', category: '日记', icon: '📝', tasks: ['journal-summary'] },
        { type: 'journal.auto', title: '检查自动日记总结', category: '后台工作', icon: '📔', tasks: [] },
        { type: 'memory.sidecar', title: '应用回复内档案更新', category: '记忆', icon: '🧩', tasks: [] },
        { type: 'memory.table.update', title: '更新结构化档案', category: '记忆', icon: '🗂️', taskPatterns: [/^memory-table-(summary|fast)-update$/, /^memory-table-summary$/] },
        { type: 'memory.tags.regenerate', title: '重新生成记忆标签', category: '记忆', icon: '🏷️', tasks: ['memory-table-tags'] },
        { type: 'memory.review.apply', title: '保存结构化档案审核结果', category: '记忆', icon: '✅', tasks: [] },
        { type: 'memory.table.auto', title: '检查结构化档案更新', category: '后台工作', icon: '🗂️', tasks: [] },
        { type: 'memory.embedding', title: '生成结构化档案向量', category: '记忆', icon: '🔎', tasks: ['memory-table-embedding'] },
        { type: 'memory.vector.summary', title: '生成向量记忆摘要', category: '记忆', icon: '🧠', tasks: ['vector-summary'] },
        { type: 'memory.vector.embedding', title: '生成向量记忆索引', category: '记忆', icon: '🧠', tasks: ['vector-embedding'] },
        { type: 'memory.vector.auto', title: '检查向量记忆总结', category: '后台工作', icon: '🧠', tasks: [] },
        { type: 'vision.image.describe', title: '识别聊天图片', category: '图片识别', icon: '🖼️', tasks: ['image-description'] },
        { type: 'vision.avatar.recognize', title: '识别头像内容', category: '图片识别', icon: '👤', tasks: ['avatar-recognition'] },
        { type: 'vision.sticker.recognize', title: '识别表情包内容', category: '图片识别', icon: '😀', tasks: ['sticker-recognition'] },
        { type: 'vision.sticker.batch', title: '批量识别表情包', category: '图片识别', icon: '🧩', tasks: [] },
        { type: 'image.generate.gpt', title: '生成图片', category: '图片生成', icon: '🎨', tasks: ['gpt-image-generation'] },
        { type: 'image.generate.novelai', title: '使用 NovelAI 生成图片', category: '图片生成', icon: '🎨', tasks: ['novelai-image-generation'] },
        { type: 'call.reply', title: '生成通话回复', category: '通话', icon: '📞', tasks: ['legacy-video-call'] },
        { type: 'call.summary', title: '生成通话总结', category: '通话', icon: '☎️', tasks: ['legacy-call-summary'] },
        { type: 'interaction.battery', title: '生成电量互动', category: '互动', icon: '🔋', tasks: ['battery-interaction'] },
        { type: 'safety.block.check', title: '判断拉黑与好友申请', category: '关系', icon: '🚫', tasks: ['block-system'] },
        { type: 'ai.request', title: '执行 AI 功能', category: '其他', icon: '✨', tasks: ['generic-ai'] }
    ];

    function normalize(value) {
        return String(value || '').trim().toLowerCase();
    }

    function publicDefinition(definition) {
        if (!definition) return null;
        return {
            type: definition.type,
            title: definition.title,
            category: definition.category,
            icon: definition.icon,
            tasks: Array.isArray(definition.tasks) ? definition.tasks.slice() : []
        };
    }

    function findByType(type) {
        const normalized = normalize(type);
        return DEFINITIONS.find(item => normalize(item.type) === normalized) || null;
    }

    function resolve(meta = {}) {
        const explicit = findByType(meta.operationType || meta.type);
        if (explicit) return publicDefinition(explicit);
        const task = normalize(meta.task);
        const source = normalize(meta.source);
        let match = DEFINITIONS.find(item => (item.tasks || []).some(value => normalize(value) === task));
        if (!match && task) {
            match = DEFINITIONS.find(item => (item.taskPatterns || []).some(pattern => pattern.test(task)));
        }
        if (!match && source) {
            if (source.includes('avatar')) match = findByType('vision.avatar.recognize');
            else if (source.includes('sticker')) match = findByType('vision.sticker.recognize');
            else if (source.includes('battery')) match = findByType('interaction.battery');
            else if (source.includes('block')) match = findByType('safety.block.check');
            else if (source.includes('video-call')) match = findByType('call.reply');
            else if (source.includes('call-summary')) match = findByType('call.summary');
            else if (source.includes('vector-memory')) match = task.includes('embedding') ? findByType('memory.vector.embedding') : findByType('memory.vector.summary');
            else if (source.includes('memory-table-retrieval')) match = findByType('memory.embedding');
            else if (source.includes('journal')) match = task.includes('summary') ? findByType('journal.summary') : findByType('journal.generate');
            else if (source.includes('image') && source.includes('description')) match = findByType('vision.image.describe');
        }
        return publicDefinition(match || findByType('ai.request'));
    }

    function list() {
        return DEFINITIONS.map(publicDefinition);
    }

    function knownTasks() {
        return Array.from(new Set(DEFINITIONS.flatMap(item => item.tasks || []))).sort();
    }

    global.OVOAICapabilityCatalog = { VERSION: '2.10-R4', resolve, list, knownTasks, get: type => publicDefinition(findByType(type)) };
})(window);
