(function (global) {
    'use strict';

    const Kernel = global.OvoMemoryKernel;
    if (!Kernel) throw new Error('记忆内核未加载');
    const Core = Kernel.core;
    const DIMENSIONS = Object.freeze(['topic', 'scene', 'entity']);
    const MAX_ALIASES_PER_DIMENSION = 240;

    function clean(value) {
        return String(value || '').trim().replace(/\s+/g, ' ');
    }

    function key(value) {
        return clean(value).toLocaleLowerCase().replace(/[\s\-_·•/\\]+/g, '');
    }

    function ensure(chat) {
        if (!chat) return null;
        chat.memoryTables ||= {};
        const raw = chat.memoryTables.tagVocabulary;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            chat.memoryTables.tagVocabulary = { version: 1, aliases: { topic: {}, scene: {}, entity: {} }, updatedAt: 0 };
        }
        const store = chat.memoryTables.tagVocabulary;
        store.version = 1;
        store.aliases ||= {};
        DIMENSIONS.forEach(dimension => {
            if (!store.aliases[dimension] || typeof store.aliases[dimension] !== 'object' || Array.isArray(store.aliases[dimension])) {
                store.aliases[dimension] = {};
            }
        });
        return store;
    }

    function resolve(chat, dimension, value) {
        const normalizedDimension = DIMENSIONS.includes(dimension) ? dimension : 'topic';
        let current = clean(value);
        if (!current || !chat) return current;
        const aliases = ensure(chat)?.aliases?.[normalizedDimension] || {};
        const visited = new Set();
        for (let step = 0; step < 8; step += 1) {
            const lookup = key(current);
            if (!lookup || visited.has(lookup)) break;
            visited.add(lookup);
            const next = clean(aliases[lookup]);
            if (!next || key(next) === lookup) break;
            current = next;
        }
        return current;
    }

    function canonicalizeList(chat, dimension, values, limit) {
        const source = Array.isArray(values) ? values : String(values || '').split(/[,，、;；\n]/);
        return Core.unique(source.map(value => resolve(chat, dimension, value)).filter(Boolean), limit);
    }

    function canonicalizeBundle(chat, bundle) {
        const raw = bundle && typeof bundle === 'object' ? bundle : {};
        return {
            topic: canonicalizeList(chat, 'topic', raw.topic, 6),
            scene: canonicalizeList(chat, 'scene', raw.scene, 5),
            entity: canonicalizeList(chat, 'entity', raw.entity, 5),
            effect: String(raw.effect || '').trim()
        };
    }

    function registerAlias(chat, options = {}) {
        const dimension = DIMENSIONS.includes(options.dimension) ? options.dimension : 'topic';
        const alias = clean(options.alias);
        const canonical = clean(options.canonical);
        if (!chat || !alias || !canonical || key(alias) === key(canonical)) return { changed: false, dimension, alias, canonical };
        const store = ensure(chat);
        const aliases = store.aliases[dimension];
        const aliasKey = key(alias);
        const previous = clean(aliases[aliasKey]);
        aliases[aliasKey] = canonical;
        const entries = Object.entries(aliases);
        if (entries.length > MAX_ALIASES_PER_DIMENSION) {
            entries.slice(0, entries.length - MAX_ALIASES_PER_DIMENSION).forEach(([oldKey]) => delete aliases[oldKey]);
        }
        store.updatedAt = Date.now();
        return { changed: previous !== canonical, dimension, alias, canonical, previous };
    }

    function removeAlias(chat, dimension, alias) {
        if (!chat) return false;
        const normalizedDimension = DIMENSIONS.includes(dimension) ? dimension : 'topic';
        const aliases = ensure(chat).aliases[normalizedDimension];
        const aliasKey = key(alias);
        if (!aliasKey || aliases[aliasKey] === undefined) return false;
        delete aliases[aliasKey];
        chat.memoryTables.tagVocabulary.updatedAt = Date.now();
        return true;
    }

    function list(chat, dimension = '') {
        if (!chat) return [];
        const store = ensure(chat);
        const dimensions = DIMENSIONS.includes(dimension) ? [dimension] : DIMENSIONS;
        const result = [];
        dimensions.forEach(current => {
            Object.entries(store.aliases[current]).forEach(([aliasKey, canonical]) => {
                result.push({ dimension: current, aliasKey, canonical: clean(canonical) });
            });
        });
        return result.sort((a, b) => a.dimension.localeCompare(b.dimension) || a.canonical.localeCompare(b.canonical) || a.aliasKey.localeCompare(b.aliasKey));
    }

    function count(chat) {
        const result = { topic: 0, scene: 0, entity: 0, total: 0 };
        list(chat).forEach(item => { result[item.dimension] += 1; result.total += 1; });
        return result;
    }

    function promptText(chat, maxPerDimension = 30) {
        if (!chat) return '';
        const lines = [];
        DIMENSIONS.forEach(dimension => {
            const entries = list(chat, dimension).slice(-Math.max(1, Number(maxPerDimension) || 30));
            if (!entries.length) return;
            lines.push(`${dimension}: ${entries.map(item => `${item.aliasKey}→${item.canonical}`).join('；')}`);
        });
        return lines.length ? `\n现有标签词表（输出时必须使用箭头右侧的统一标签）：\n${lines.join('\n')}` : '';
    }

    const api = Object.freeze({
        VERSION: '2.11-R3.1',
        DIMENSIONS,
        clean,
        key,
        ensure,
        resolve,
        canonicalizeList,
        canonicalizeBundle,
        registerAlias,
        removeAlias,
        list,
        count,
        promptText
    });

    Kernel.register('tagVocabulary', api, { legacyGlobal: 'MemoryTagVocabulary' });
})(window);
