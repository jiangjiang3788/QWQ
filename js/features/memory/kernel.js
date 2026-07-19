(function (global) {
    'use strict';

    const modules = new Map();
    const legacyGlobals = new Map();
    const registrations = [];

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeAttribute(value) {
        return escapeHtml(value).replace(/`/g, '&#096;');
    }

    function clamp(value, fallback, min, max) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(max, Math.max(min, number));
    }

    function unique(values, limit = 60) {
        const out = [];
        const seen = new Set();
        const source = Array.isArray(values) ? values : String(values || '').split(/[,，、\n]/);
        source.forEach(value => {
            const text = String(value || '').trim();
            if (!text || seen.has(text)) return;
            seen.add(text);
            out.push(text);
        });
        return out.slice(0, Math.max(0, Number(limit) || 0));
    }

    function createId(prefix = 'memory') {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function hashText(text) {
        const source = String(text || '');
        let hash = 2166136261;
        for (let index = 0; index < source.length; index += 1) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16);
    }

    function hashFingerprint(text) {
        const source = String(text || '');
        return `${source.length}:${hashText(source)}`;
    }

    function moveArrayItem(list, fromIndex, toIndex) {
        if (!Array.isArray(list) || fromIndex === toIndex) return false;
        if (fromIndex < 0 || fromIndex >= list.length || toIndex < 0 || toIndex >= list.length) return false;
        const [item] = list.splice(fromIndex, 1);
        list.splice(toIndex, 0, item);
        return true;
    }

    const core = Object.freeze({
        clone,
        escapeHtml,
        escapeAttribute,
        clamp,
        unique,
        createId,
        hashText,
        hashFingerprint,
        moveArrayItem
    });

    function register(name, api, options = {}) {
        const key = String(name || '').trim();
        if (!key) throw new Error('记忆模块必须提供名称');
        if (!api || typeof api !== 'object') throw new Error(`记忆模块 ${key} 的 API 无效`);
        modules.set(key, api);
        registrations.push({ name: key, version: api.VERSION || '', at: Date.now() });
        if (options.legacyGlobal) {
            legacyGlobals.set(options.legacyGlobal, key);
            global[options.legacyGlobal] = api;
        }
        return api;
    }

    function get(name) {
        return modules.get(String(name || '').trim()) || null;
    }

    function requireModule(name) {
        const api = get(name);
        if (!api) throw new Error(`记忆模块未加载：${name}`);
        return api;
    }

    function health(required = []) {
        const missing = required.filter(name => !modules.has(name));
        return {
            ok: missing.length === 0,
            missing,
            loaded: Array.from(modules.keys()),
            registrations: registrations.slice()
        };
    }

    global.OvoMemoryKernel = Object.freeze({
        VERSION: '2.9-R2',
        core,
        register,
        get,
        require: requireModule,
        has(name) { return modules.has(String(name || '').trim()); },
        list() { return Array.from(modules.keys()); },
        health,
        legacyGlobals() { return Object.fromEntries(legacyGlobals); }
    });
})(window);
