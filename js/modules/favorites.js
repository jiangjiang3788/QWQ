// --- 消息收藏模块 V5.8.3：角色自主收藏保持为私人情感动作，结构化表只负责存储 ---
(function (global) {
    'use strict';

    const TABLE_ID = global.MemoryV5?.constants?.FAVORITE_TABLE_ID || 'v5_message_favorites';
    const FavoriteMessageContent = global.OvoMessageContent || null;
    const MIGRATION_VERSION = '5.7.0';

    const text = value => String(value == null ? '' : value).trim();
    const unique = values => Array.from(new Set((Array.isArray(values) ? values : text(values).split(/[,，、\n]/u)).map(text).filter(Boolean)));
    const pad2 = value => String(value).padStart(2, '0');
    const localDateTimeSeconds = value => {
        const date = value instanceof Date ? value : new Date(Number(value) || Date.now());
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
    };

    function getMessagePreview(content, plainText, contentType) {
        const savedText = typeof plainText === 'string' ? plainText.trim() : '';
        if (contentType === 'voice' && savedText) return `[语音] ${savedText}`;
        if (savedText && contentType && contentType !== 'text' && contentType !== 'message') {
            if (contentType === 'sticker') return '[表情包]';
            if (contentType === 'photo_video') return '[照片/视频]';
        }
        if (savedText) return savedText;
        if (FavoriteMessageContent) return FavoriteMessageContent.getPreview(content);
        if (!content || typeof content !== 'string') return '';
        const messageMatch = content.match(/^\[.*?的消息：([\s\S]+?)\]$/);
        if (messageMatch && messageMatch[1]) return messageMatch[1].trim();
        const voiceMatch = content.match(/^\[.*?的语音：([\s\S]*?)\]$/);
        if (voiceMatch) return voiceMatch[1].trim() ? `[语音] ${voiceMatch[1].trim()}` : '[语音]';
        if (/\[.*?的表情包：.*?\]/.test(content)) return '[表情包]';
        if (/\[.*?发来的照片\/视频：.*?\]/.test(content)) return '[照片/视频]';
        return content;
    }

    function getFavoriteMessageSnapshot(message) {
        if (FavoriteMessageContent) return FavoriteMessageContent.snapshot(message);
        const content = typeof message?.content === 'string'
            ? message.content
            : (message?.parts && message.parts[0] ? message.parts[0].text : '');
        return { content, contentType: 'text', plainText: getMessagePreview(content) };
    }

    function getSenderName(chat, message) {
        if (message?.role === 'user') return chat?.myName || '我';
        return chat?.remarkName || chat?.realName || chat?.name || '对方';
    }

    const TAG_RULES = Object.freeze([
        ['家庭', /爸爸|父亲|妈妈|母亲|爸妈|家人|家庭|哥哥|弟弟|姐姐|妹妹|爷爷|奶奶|外公|外婆/],
        ['爸爸', /爸爸|父亲|老爸/],
        ['妈妈', /妈妈|母亲|老妈/],
        ['健康', /健康|生病|医院|医生|复查|检查|药|过敏|疼|痛|发烧|感冒|手术|住院|康复/],
        ['睡眠', /睡眠|睡觉|失眠|熬夜|早睡|晚睡|做梦/],
        ['饮食', /吃饭|食物|口味|香菜|早餐|午餐|晚餐|零食|饮料|咖啡|奶茶|火锅|甜食/],
        ['偏好', /喜欢|讨厌|偏好|最爱|不喜欢|想要|不想要/],
        ['情绪', /开心|难过|生气|焦虑|害怕|紧张|委屈|孤独|烦|累|压力|情绪/],
        ['关系', /关系|在一起|分手|恋爱|爱你|喜欢你|朋友|闺蜜|同事|相处|信任/],
        ['约定', /约定|答应|承诺|说好|一定要|记得|别忘了/],
        ['计划', /计划|准备|打算|明天|后天|下周|下个月|以后|将来|目标/],
        ['工作', /工作|上班|同事|老板|项目|客户|加班|面试|辞职|职业/],
        ['学习', /学习|考试|作业|课程|论文|复习|成绩/],
        ['学校', /学校|校园|教室|宿舍|老师|同学/],
        ['经历', /以前|小时候|童年|曾经|发生过|经历|回忆/],
        ['生日', /生日|纪念日|周年/],
        ['礼物', /礼物|送给|收到|纪念品/],
        ['旅行', /旅行|旅游|出发|酒店|机票|火车|景点/],
        ['问候', /早安|晚安|午安|你好|再见|好梦/],
        ['宠物', /宠物|猫|狗|仓鼠|兔子|养了/],
        ['金钱', /钱|工资|消费|花费|存款|借钱|转账|预算/]
    ]);

    function deriveFavoriteTags(content, note = '') {
        const source = `${text(note)}\n${text(content)}`;
        const tags = [];
        for (const match of source.matchAll(/#([^#\s，。！？、；：,.!?;:]{1,20})/gu)) tags.push(match[1]);
        TAG_RULES.forEach(([tag, pattern]) => { if (pattern.test(source)) tags.push(tag); });

        // 收藏寄语通常已经是最准确的概括，优先抽取其中的短词。
        text(note).split(/[，。！？、；：,.!?;:\s]+/u).forEach(part => {
            const cleaned = part.replace(/^(他的|她的|我的|用户的|角色的|关于|记住|以后|需要|这条|一条)/u, '').trim();
            if (/^[\u3400-\u9fffA-Za-z0-9_-]{2,8}$/u.test(cleaned)) tags.push(cleaned);
        });

        // 没有足够标签时，用分词结果补充可读关键词；不截取任意长句当标签。
        if (unique(tags).length < 2) {
            const stopWords = new Set([
                '我们', '你们', '他们', '这个', '那个', '就是', '因为', '所以', '但是', '然后', '已经', '还是', '没有',
                '可以', '觉得', '真的', '现在', '今天', '明天', '昨天', '一下', '什么', '怎么', '不要', '需要', '只是',
                '一句', '一个', '一些', '这里', '那里', '那天', '以后', '很久', '突然', '回家', '跟你', '跟我'
            ]);
            const appendWord = value => {
                const word = text(value).replace(/^[的了呢吧啊呀哦在把给和与及又都就还再很更最我你他她它]+|[的了呢吧啊呀哦]+$/gu, '');
                if (!word || stopWords.has(word)) return;
                if (/^[\u3400-\u9fff]{2,6}$/u.test(word) || /^[A-Za-z][A-Za-z0-9_-]{1,15}$/u.test(word)) tags.push(word);
            };
            try {
                if (typeof Intl !== 'undefined' && Intl.Segmenter) {
                    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
                    for (const item of segmenter.segment(source)) {
                        if (item.isWordLike) appendWord(item.segment);
                        if (unique(tags).length >= 4) break;
                    }
                }
            } catch (_) {}
            if (unique(tags).length < 2) {
                source.split(/[，。！？、；：,.!?;:\s]+/u).forEach(part => appendWord(part));
            }
        }
        return unique(tags).slice(0, 8);
    }

    function favoriteApi() {
        const M = global.MemoryV5;
        if (!M?.model || !M?.engine) throw new Error('记忆模块尚未加载');
        return M;
    }

    function favoriteTable(chat) {
        const M = favoriteApi();
        const store = M.model.ensureStore(chat);
        const table = M.model.findTable(store, TABLE_ID);
        if (!table) throw new Error('收藏记忆表不存在');
        return { M, store, table, rows: store.records[TABLE_ID] ||= [] };
    }

    function field(table, idOrName) {
        return table.fields.find(item => item.id === idOrName || item.name === idOrName || item.commonKey === idOrName) || null;
    }

    function fieldValue(M, record, table, idOrName) {
        const target = field(table, idOrName);
        return target ? M.model.getFieldValue(record, target) : undefined;
    }

    function mergeNotes(left, right) {
        const values = unique([text(left), text(right)]);
        return values.join('；');
    }


    function evaluateCharacterFavoriteCandidate(chat, message, input = {}) {
        if (!chat || !message || message.role !== 'user') return { accepted: false, reason: '只能收藏当前私聊中的用户原消息' };
        if (message.sentByCharControl || message.isSystem || message.systemGenerated) {
            return { accepted: false, reason: '系统或角色代发消息不能进入角色自主收藏' };
        }
        const eligible = Array.isArray(input.eligibleMessageIds) ? new Set(input.eligibleMessageIds.map(text)) : null;
        if (eligible && !eligible.has(text(message.id))) return { accepted: false, reason: '该消息不在当前可用的聊天上下文中' };

        const note = text(input.note).slice(0, 120);
        const draft = snapshotInput(chat, message, {
            note,
            tags: unique(input.tags).slice(0, 6),
            collectors: ['角色']
        });

        const { M, table, rows } = favoriteTable(chat);
        const messageIdField = field(table, 'favorite_message_id');
        const collectorsField = field(table, 'favorite_collectors');
        const messageKey = text(draft.messageKey || draft.messageId);
        const sameMessage = rows.find(record => messageKey && text(M.model.getFieldValue(record, messageIdField)) === messageKey) || null;
        if (sameMessage) {
            const collectors = unique(M.model.getFieldValue(sameMessage, collectorsField));
            if (collectors.includes('角色')) return { accepted: false, reason: '这条具体消息已经由角色收藏过' };
        }

        // 不按字数、信息量或正文相似度判断情感价值。
        // 两句相同文字出现在不同时间，也可能对角色具有完全不同的意义。
        return { accepted: true, draft, sameMessage };
    }

    function upsertFavoriteMemory(chat, input, options = {}) {
        const { M, table, rows } = favoriteTable(chat);
        const messageKey = text(input.messageKey || input.messageId);
        const content = text(input.content);
        if (!content) return { status: 'rejected', reason: '收藏内容为空' };
        const messageIdField = field(table, 'favorite_message_id');
        const existing = rows.find(record => messageKey && text(M.model.getFieldValue(record, messageIdField)) === messageKey) || null;
        const tags = unique(input.tags || deriveFavoriteTags(content, input.note));
        const stamp = new Date().toISOString();
        const values = {
            common_tags: tags,
            favorite_collectors: unique(input.collectors || ['用户']),
            favorite_sender: text(input.sender),
            common_content: content,
            favorite_note: text(input.note),
            favorite_message_time: text(input.messageTime) || localDateTimeSeconds(input.timestamp),
            common_category: '收藏',
            common_title: '',
            favorite_message_id: messageKey,
            favorite_legacy_ids: unique(input.legacyIds || []),
            favorite_raw_content: text(input.rawContent),
            favorite_content_type: text(input.contentType || 'text'),
            favorite_merged: input.merged === true
        };

        if (existing) {
            const beforeFavorite = options.roundId ? M.util.clone(existing) : null;
            values.common_tags = unique([].concat(existing.tags || [], tags));
            values.favorite_collectors = unique([].concat(fieldValue(M, existing, table, 'favorite_collectors') || [], input.collectors || ['用户']));
            values.favorite_note = mergeNotes(fieldValue(M, existing, table, 'favorite_note'), input.note);
            values.favorite_legacy_ids = unique([].concat(fieldValue(M, existing, table, 'favorite_legacy_ids') || [], input.legacyIds || []));
            Object.entries(values).forEach(([fieldId, value]) => {
                const target = field(table, fieldId);
                if (!target) return;
                if ((value === '' || (Array.isArray(value) && !value.length)) && fieldValue(M, existing, table, fieldId)) return;
                M.model.setFieldValue(existing, target, value, { table });
            });
            existing.source = '用户明确';
            existing.time = localDateTimeSeconds();
            existing.updatedAt = stamp;
            existing.roundId = options.roundId || existing.roundId || null;
            existing.changedFieldIds = unique(Object.keys(values));
            if (options.roundId && typeof M.engine.recordRoundMutation === 'function') {
                M.engine.recordRoundMutation(chat, options.roundId, {
                    tableId: TABLE_ID,
                    recordId: existing.id,
                    before: beforeFavorite,
                    after: existing
                });
            }
            return { status: 'updated', record: existing };
        }

        const record = M.model.normalizeRecord({
            id: M.util.id('favorite_memory'),
            tableId: TABLE_ID,
            source: '用户明确',
            time: localDateTimeSeconds(),
            createdAt: stamp,
            updatedAt: stamp,
            roundId: options.roundId || null,
            category: '收藏',
            title: '',
            content,
            tags,
            values: Object.fromEntries(Object.entries(values).filter(([key]) => !key.startsWith('common_')))
        }, table);
        rows.push(record);
        if (options.roundId && typeof M.engine.recordRoundMutation === 'function') {
            M.engine.recordRoundMutation(chat, options.roundId, {
                tableId: TABLE_ID,
                recordId: record.id,
                before: null,
                after: record
            });
        }
        return { status: 'added', record };
    }

    async function persistFavoriteChat(chat) {
        if (!chat?.id) return;
        if (typeof global.saveCharacter === 'function') await global.saveCharacter(chat.id);
        else if (typeof saveCharacter === 'function') await saveCharacter(chat.id);
    }

    function snapshotInput(chat, message, options = {}) {
        const snapshot = options.snapshot || getFavoriteMessageSnapshot(message);
        const content = text(options.content || getMessagePreview(snapshot.content, snapshot.plainText, snapshot.contentType) || snapshot.content);
        return {
            messageId: message?.id,
            messageKey: options.messageKey || message?.id,
            content,
            rawContent: text(snapshot.content),
            contentType: snapshot.contentType || 'text',
            sender: options.sender || getSenderName(chat, message),
            timestamp: options.timestamp || message?.timestamp || Date.now(),
            messageTime: options.messageTime || localDateTimeSeconds(options.timestamp || message?.timestamp || Date.now()),
            note: text(options.note),
            tags: unique(options.tags || []),
            merged: options.merged === true,
            legacyIds: unique(options.legacyIds || []),
            collectors: unique(options.collectors || ['用户'])
        };
    }

    async function addMessageToFavorites(messageId) {
        const chat = (global.db?.characters || []).find(item => item.id === global.currentChatId);
        if (!chat || global.currentChatType !== 'private') return;
        const message = (chat.history || []).find(item => item.id === messageId);
        if (!message) return;
        const draft = snapshotInput(chat, message);
        const result = upsertFavoriteMemory(chat, { ...draft, tags: deriveFavoriteTags(draft.content) });
        await persistFavoriteChat(chat);
        global.showToast?.(result.status === 'updated' ? '已更新收藏记忆' : '已收藏到记忆表');
        global.triggerHapticFeedback?.('light');
    }

    async function addFavoritesFromSelection() {
        if (!global.selectedMessageIds || global.selectedMessageIds.size === 0) {
            global.showToast?.('请至少选择一条消息');
            return;
        }
        const chat = (global.db?.characters || []).find(item => item.id === global.currentChatId);
        if (!chat || global.currentChatType !== 'private') return;
        const messages = (chat.history || []).filter(message => global.selectedMessageIds.has(message.id));
        if (!messages.length) return;
        let added = 0;
        let updated = 0;
        messages.forEach(message => {
            const draft = snapshotInput(chat, message);
            const result = upsertFavoriteMemory(chat, { ...draft, tags: deriveFavoriteTags(draft.content) });
            if (result.status === 'added') added += 1;
            if (result.status === 'updated') updated += 1;
        });
        await persistFavoriteChat(chat);
        global.exitMultiSelectMode?.();
        global.showToast?.(`收藏记忆已保存：新增${added}条${updated ? `，更新${updated}条` : ''}`);
        global.triggerHapticFeedback?.('medium');
    }

    async function addFavoritesFromSelectionMerged() {
        if (!global.selectedMessageIds || global.selectedMessageIds.size === 0) {
            global.showToast?.('请至少选择一条消息');
            return;
        }
        const chat = (global.db?.characters || []).find(item => item.id === global.currentChatId);
        if (!chat || global.currentChatType !== 'private') return;
        const messages = (chat.history || [])
            .filter(message => global.selectedMessageIds.has(message.id))
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        if (!messages.length) return;
        const parts = messages.map(message => snapshotInput(chat, message).content).filter(Boolean);
        const content = parts.join('\n\n');
        const tags = deriveFavoriteTags(content);
        const messageKey = `merged:${messages.map(message => message.id).join('|')}`;
        const result = upsertFavoriteMemory(chat, {
            messageKey,
            messageId: messages[0].id,
            content,
            rawContent: content,
            contentType: 'text',
            sender: '多条消息',
            timestamp: messages[0].timestamp || Date.now(),
            tags,
            merged: true
        });
        await persistFavoriteChat(chat);
        global.exitMultiSelectMode?.();
        global.showToast?.(result.status === 'updated' ? '已更新合并收藏记忆' : `已合并${messages.length}条消息到收藏记忆`);
        global.triggerHapticFeedback?.('medium');
    }

    // 角色静默收藏。模型表达收藏动作；程序只校验消息归属与同一消息重复，不评价情感是否“够重要”。
    async function addCharacterFavorite(messageId, characterId, note, tags = [], options = {}) {
        const chat = (global.db?.characters || []).find(item => item.id === characterId);
        if (!chat) return { status: 'rejected', reason: '角色不存在' };
        const message = (chat.history || []).find(item => item.id === messageId);
        if (!message) return { status: 'rejected', reason: '原消息不存在' };
        const evaluation = evaluateCharacterFavoriteCandidate(chat, message, {
            note,
            tags,
            eligibleMessageIds: options.eligibleMessageIds,
        });
        if (!evaluation.accepted) return { status: 'rejected', reason: evaluation.reason };
        const draft = evaluation.draft;
        const result = upsertFavoriteMemory(chat, {
            ...draft,
            tags: draft.tags.length ? draft.tags : deriveFavoriteTags(draft.content, draft.note).slice(0, 6)
        }, { roundId: options.roundId || null });
        if (result.status === 'added' || result.status === 'updated') await persistFavoriteChat(chat);
        return result;
    }

    function legacyCharacterId(favorite) {
        return text(favorite?.characterId || favorite?.chatId);
    }

    function legacyMessageKey(favorite) {
        if (favorite?.merged) return `merged:${text(favorite.id) || text(favorite.messageId)}`;
        return text(favorite?.messageId) || `legacy:${text(favorite?.id)}`;
    }

    async function migrateLegacyFavoritesToMemory() {
        const M = favoriteApi();
        await M.model.migrateAllCharacters();
        const legacy = Array.isArray(global.db?.favorites) ? global.db.favorites.slice() : [];
        if (!legacy.length) return { migrated: 0, merged: 0, unmatched: 0, total: 0 };

        const changedCharacters = new Set();
        const unmatched = [];
        let migrated = 0;
        let merged = 0;
        legacy.forEach(favorite => {
            const characterId = legacyCharacterId(favorite);
            const chat = (global.db.characters || []).find(item => String(item.id) === characterId);
            if (!chat || (favorite.chatType && favorite.chatType !== 'private')) {
                unmatched.push(favorite);
                return;
            }
            const content = text(getMessagePreview(favorite.content, favorite.plainText, favorite.contentType) || favorite.content);
            if (!content) {
                unmatched.push(favorite);
                return;
            }
            const result = upsertFavoriteMemory(chat, {
                messageKey: legacyMessageKey(favorite),
                messageId: favorite.messageId,
                content,
                rawContent: text(favorite.content),
                contentType: favorite.contentType || 'text',
                sender: favorite.sender || (favorite.favoriteBy === 'character' ? (chat.myName || '我') : '未记录'),
                timestamp: favorite.timestamp || favorite.favoriteTime || Date.now(),
                note: favorite.note || '',
                collectors: [favorite.favoriteBy === 'character' ? '角色' : '用户'],
                tags: unique(favorite.tags || deriveFavoriteTags(content, favorite.note)),
                merged: favorite.merged === true,
                legacyIds: [favorite.id].filter(Boolean)
            });
            if (result.status === 'added') migrated += 1;
            if (result.status === 'updated') merged += 1;
            changedCharacters.add(chat.id);
        });

        global.db.favoriteMigrationArchive = {
            version: MIGRATION_VERSION,
            migratedAt: new Date().toISOString(),
            sourceCount: legacy.length,
            migrated,
            merged,
            unmatchedCount: unmatched.length,
            unmatched
        };
        global.db.favorites = [];
        if (typeof saveData === 'function') await saveData();
        else {
            for (const characterId of changedCharacters) await persistFavoriteChat(global.db.characters.find(item => item.id === characterId));
            await global.saveGlobalSettings?.();
        }
        console.info('[FavoriteMemory] 旧收藏转换完成', global.db.favoriteMigrationArchive);
        return { migrated, merged, unmatched: unmatched.length, total: legacy.length };
    }

    async function setupFavoriteMemory() {
        try {
            const report = await migrateLegacyFavoritesToMemory();
            if (report.total > 0) {
                const unmatched = report.unmatched ? `，未关联 ${report.unmatched} 条已保存在转换档案` : '';
                global.showToast?.(`旧收藏已转入角色记忆：新增 ${report.migrated} 条，合并 ${report.merged} 条${unmatched}`, 6000);
            }
            return report;
        } catch (error) {
            console.error('[FavoriteMemory] 初始化或转换失败', error);
            global.showToast?.(`收藏记忆初始化失败：${error.message || error}`);
            return { migrated: 0, merged: 0, unmatched: 0, total: 0, error: String(error?.message || error) };
        }
    }

    // 旧入口仅兼容残留快捷方式，实际直接进入当前角色的收藏记忆表。
    function openFavoritesScreen() {
        const current = (global.db?.characters || []).find(item => item.id === global.currentChatId);
        if (current) {
            global.openMemoryTableForCharacter?.(current.id, TABLE_ID);
            return;
        }
        global.showToast?.('请先进入一个角色聊天，再打开收藏记忆');
    }

    global.FavoriteMemory = Object.freeze({
        TABLE_ID,
        deriveTags: deriveFavoriteTags,
        upsert: upsertFavoriteMemory,
        evaluateCharacterCandidate: evaluateCharacterFavoriteCandidate,
        migrate: migrateLegacyFavoritesToMemory,
        setup: setupFavoriteMemory,
        open: openFavoritesScreen
    });
    global.setupFavoriteMemory = setupFavoriteMemory;
    global.addMessageToFavorites = addMessageToFavorites;
    global.addFavoritesFromSelection = addFavoritesFromSelection;
    global.addFavoritesFromSelectionMerged = addFavoritesFromSelectionMerged;
    global.addCharacterFavorite = addCharacterFavorite;
    global.openFavoritesScreen = openFavoritesScreen;
})(window);
