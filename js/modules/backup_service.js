// 完整备份服务：单用户、仅支持当前格式。
(function () {
    'use strict';

    const FORMAT = 'ovo-full-backup';
    const FORMAT_VERSION = 1;
    const APP_VERSION = (typeof appVersion !== 'undefined' && appVersion) || 'unknown';
    const EXCLUDED_LOCAL_STORAGE_KEYS = new Set(['gh_config']);

    function assertReady() {
        if (typeof JSZip === 'undefined') throw new Error('JSZip 未加载');
        if (typeof dexieDB === 'undefined' || !dexieDB) throw new Error('数据库尚未初始化');
        if (!window.crypto || !window.crypto.subtle) throw new Error('当前环境不支持 SHA-256 校验');
    }

    function stableJson(value) {
        return JSON.stringify(value);
    }

    async function sha256Text(text) {
        const bytes = new TextEncoder().encode(text);
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, '0')).join('');
    }

    function collectLocalStorage() {
        const result = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || EXCLUDED_LOCAL_STORAGE_KEYS.has(key)) continue;
            result[key] = localStorage.getItem(key);
        }
        const ghRaw = localStorage.getItem('gh_config');
        if (ghRaw) {
            try {
                const gh = JSON.parse(ghRaw);
                delete gh.token;
                result.gh_config_without_token = JSON.stringify(gh);
            } catch (_) { /* 忽略损坏配置 */ }
        }
        return result;
    }

    async function readAllTables() {
        const tables = {};
        for (const table of dexieDB.tables) tables[table.name] = await table.toArray();
        return tables;
    }

    async function createBackupBlob() {
        assertReady();
        const zip = new JSZip();
        const tables = await readAllTables();
        const counts = {};
        const checksums = {};
        const tableNames = Object.keys(tables).sort();

        for (const name of tableNames) {
            const path = `database/${name}.json`;
            const text = stableJson(tables[name]);
            zip.file(path, text);
            counts[name] = tables[name].length;
            checksums[path] = await sha256Text(text);
        }

        const localStorageText = stableJson(collectLocalStorage());
        zip.file('local-storage.json', localStorageText);
        checksums['local-storage.json'] = await sha256Text(localStorageText);

        const countsText = stableJson(counts);
        zip.file('metadata/counts.json', countsText);
        checksums['metadata/counts.json'] = await sha256Text(countsText);

        const manifest = {
            format: FORMAT,
            formatVersion: FORMAT_VERSION,
            appVersion: APP_VERSION,
            databaseName: dexieDB.name,
            createdAt: new Date().toISOString(),
            mode: 'single-user-full',
            tables: tableNames,
            excludes: ['GitHub token']
        };
        zip.file('manifest.json', stableJson(manifest));
        zip.file('metadata/checksums.json', stableJson(checksums));

        return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    }

    async function parseAndValidate(blob) {
        assertReady();
        let zip;
        try { zip = await JSZip.loadAsync(blob); }
        catch (_) { throw new Error('文件不是有效的当前版完整备份'); }

        const required = ['manifest.json', 'metadata/counts.json', 'metadata/checksums.json', 'local-storage.json'];
        for (const path of required) if (!zip.file(path)) throw new Error(`备份缺少文件: ${path}`);

        const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
        if (manifest.format !== FORMAT || manifest.formatVersion !== FORMAT_VERSION) {
            throw new Error('只支持当前版 ovo-full-backup v1 完整备份');
        }
        if (!Array.isArray(manifest.tables) || !manifest.tables.length) throw new Error('备份表清单无效');

        const checksums = JSON.parse(await zip.file('metadata/checksums.json').async('string'));
        const counts = JSON.parse(await zip.file('metadata/counts.json').async('string'));
        const tables = {};
        for (const name of manifest.tables) {
            const path = `database/${name}.json`;
            const entry = zip.file(path);
            if (!entry) throw new Error(`备份缺少数据表: ${name}`);
            const text = await entry.async('string');
            if (checksums[path] !== await sha256Text(text)) throw new Error(`校验失败: ${path}`);
            const rows = JSON.parse(text);
            if (!Array.isArray(rows)) throw new Error(`数据表格式无效: ${name}`);
            if (Number(counts[name]) !== rows.length) throw new Error(`数据数量不一致: ${name}`);
            tables[name] = rows;
        }

        for (const path of ['local-storage.json', 'metadata/counts.json']) {
            const text = await zip.file(path).async('string');
            if (checksums[path] !== await sha256Text(text)) throw new Error(`校验失败: ${path}`);
        }
        const localStorageData = JSON.parse(await zip.file('local-storage.json').async('string'));
        return { manifest, counts, tables, localStorageData };
    }

    async function restoreBackupBlob(blob) {
        const parsed = await parseAndValidate(blob);
        const currentNames = dexieDB.tables.map(t => t.name).sort();
        const backupNames = Object.keys(parsed.tables).sort();
        if (JSON.stringify(currentNames) !== JSON.stringify(backupNames)) {
            throw new Error(`备份数据库结构与当前版本不一致（当前: ${currentNames.join(', ')}；备份: ${backupNames.join(', ')}）`);
        }

        await dexieDB.transaction('rw', dexieDB.tables, async () => {
            for (const table of dexieDB.tables) {
                await table.clear();
                const rows = parsed.tables[table.name];
                if (rows.length) await table.bulkAdd(rows);
                const actual = await table.count();
                if (actual !== rows.length) throw new Error(`写入校验失败: ${table.name}`);
            }
        });

        Object.entries(parsed.localStorageData || {}).forEach(([key, value]) => {
            if (key === 'gh_config_without_token') {
                try {
                    const old = JSON.parse(localStorage.getItem('gh_config') || '{}');
                    const restored = JSON.parse(value || '{}');
                    restored.token = old.token || '';
                    localStorage.setItem('gh_config', JSON.stringify(restored));
                } catch (_) { /* 保留现状 */ }
            } else if (!EXCLUDED_LOCAL_STORAGE_KEYS.has(key)) {
                localStorage.setItem(key, value);
            }
        });

        if (typeof loadData === 'function') await loadData();
        return { success: true, manifest: parsed.manifest, counts: parsed.counts };
    }

    window.BackupService = { FORMAT, FORMAT_VERSION, createBackupBlob, parseAndValidate, restoreBackupBlob };
})();
