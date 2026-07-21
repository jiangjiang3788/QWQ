// 完整备份服务：单用户、支持完整备份与显式紧凑备份。
(function () {
    'use strict';

    const FORMAT = 'ovo-full-backup';
    const FORMAT_VERSION = 1;
    const APP_VERSION = (typeof appVersion !== 'undefined' && appVersion) || 'unknown';
    const EXCLUDED_LOCAL_STORAGE_KEYS = new Set(['gh_config']);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf-8');

    function assertReady() {
        if (typeof JSZip === 'undefined') throw new Error('JSZip 未加载');
        if (typeof dexieDB === 'undefined' || !dexieDB) throw new Error('数据库尚未初始化');
        if (!window.crypto || !window.crypto.subtle) throw new Error('当前环境不支持 SHA-256 校验');
    }

    function stableJson(value) {
        return JSON.stringify(value);
    }

    function cloneValue(value) {
        if (typeof structuredClone === 'function') return structuredClone(value);
        return JSON.parse(JSON.stringify(value));
    }

    async function sha256Bytes(bytes) {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest)).map(v => v.toString(16).padStart(2, '0')).join('');
    }

    function encodeText(text) {
        return encoder.encode(String(text || ''));
    }

    // 旧版 JSZip 会把 UTF-16 代理对分别写成 CESU-8，而校验值却按标准 UTF-8 计算。
    // 这里把代理对重编码为标准 UTF-8，使旧备份仍可在严格校验后恢复。
    function normalizeLegacyCesu8(bytes) {
        const out = [];
        let changed = false;
        for (let i = 0; i < bytes.length;) {
            if (i + 2 < bytes.length && bytes[i] === 0xED && bytes[i + 1] >= 0xA0 && bytes[i + 1] <= 0xBF && (bytes[i + 2] & 0xC0) === 0x80) {
                const first = ((bytes[i] & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F);
                if (first >= 0xD800 && first <= 0xDBFF && i + 5 < bytes.length
                    && bytes[i + 3] === 0xED && bytes[i + 4] >= 0xB0 && bytes[i + 4] <= 0xBF
                    && (bytes[i + 5] & 0xC0) === 0x80) {
                    const second = ((bytes[i + 3] & 0x0F) << 12) | ((bytes[i + 4] & 0x3F) << 6) | (bytes[i + 5] & 0x3F);
                    if (second >= 0xDC00 && second <= 0xDFFF) {
                        const codePoint = 0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00);
                        out.push(
                            0xF0 | (codePoint >> 18),
                            0x80 | ((codePoint >> 12) & 0x3F),
                            0x80 | ((codePoint >> 6) & 0x3F),
                            0x80 | (codePoint & 0x3F)
                        );
                        i += 6;
                        changed = true;
                        continue;
                    }
                }
                // 与 TextEncoder 一致：孤立代理项替换为 U+FFFD。
                out.push(0xEF, 0xBF, 0xBD);
                i += 3;
                changed = true;
                continue;
            }
            out.push(bytes[i]);
            i += 1;
        }
        return { bytes: changed ? new Uint8Array(out) : bytes, changed };
    }

    async function readVerifiedText(zip, path, expectedHash) {
        const entry = zip.file(path);
        if (!entry) throw new Error(`备份缺少文件: ${path}`);
        const raw = await entry.async('uint8array');
        if (!expectedHash || await sha256Bytes(raw) === expectedHash) {
            return { text: decoder.decode(raw), legacyEncodingNormalized: false };
        }
        const normalized = normalizeLegacyCesu8(raw);
        if (normalized.changed && await sha256Bytes(normalized.bytes) === expectedHash) {
            return { text: decoder.decode(normalized.bytes), legacyEncodingNormalized: true };
        }
        throw new Error(`校验失败: ${path}`);
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

    function compactTaskResult(task) {
        const result = task?.result;
        if (!result || typeof result !== 'object') return null;
        if (task.type !== 'table_update') return null;
        const range = result.range || task.payload?.range || {};
        return {
            status: result.status || '',
            changedFieldCount: Array.isArray(result.changedFields) ? result.changedFields.length : Number(result.changedFieldCount) || 0,
            batchId: result.batchId || task.reviewBatchId || null,
            proposedCount: Number(result.proposedCount) || 0,
            templateId: result.templateId || task.payload?.templateId || '',
            tableId: result.tableId || task.payload?.tableId || '',
            range: { start: Number(range.start) || 0, end: Number(range.end) || 0 }
        };
    }

    function compactTask(task, keepPayload) {
        const copy = cloneValue(task || {});
        if (!keepPayload) delete copy.payload;
        copy.result = compactTaskResult(copy);
        return copy;
    }

    function compactCharacterRow(row) {
        const character = cloneValue(row || {});
        // provided source code has no readers/writers for this retired memory system.
        delete character.unifiedMemory;
        delete character.splitBackupMeta;
        delete character.chatImageMaxWidth;
        delete character.realCameraEnabled;
        delete character.saveCallOnInterrupt;
        delete character.useRealGallery;

        if (Array.isArray(character.history)) {
            character.history.forEach(message => {
                if (message?.statusSnapshot && typeof message.statusSnapshot === 'object') {
                    delete message.statusSnapshot.replacePattern;
                }
            });
        }

        const queue = character.memoryTables?.taskQueue;
        if (queue && typeof queue === 'object') {
            const active = [];
            const archived = Array.isArray(queue.history) ? queue.history.map(item => compactTask(item, false)) : [];
            (Array.isArray(queue.tasks) ? queue.tasks : []).forEach(task => {
                if (['succeeded', 'cancelled'].includes(task?.status)) archived.push(compactTask(task, false));
                else active.push(compactTask(task, true));
            });
            queue.tasks = active.slice(-80);
            queue.history = archived.slice(-60);
        }
        return character;
    }

    async function readAllTables(options) {
        const tables = {};
        const compact = options?.compact === true;
        for (const table of dexieDB.tables) {
            const rows = await table.toArray();
            tables[table.name] = compact && table.name === 'characters'
                ? rows.map(compactCharacterRow)
                : rows;
        }
        return tables;
    }

    async function writeCheckedJson(zip, path, value, checksums) {
        const bytes = encodeText(stableJson(value));
        zip.file(path, bytes);
        checksums[path] = await sha256Bytes(bytes);
    }

    async function createBackupBlob(options) {
        assertReady();
        const compact = options?.compact === true;
        const zip = new JSZip();
        const tables = await readAllTables({ compact });
        const counts = {};
        const checksums = {};
        const tableNames = Object.keys(tables).sort();

        for (const name of tableNames) {
            const path = `database/${name}.json`;
            await writeCheckedJson(zip, path, tables[name], checksums);
            counts[name] = tables[name].length;
        }

        await writeCheckedJson(zip, 'local-storage.json', collectLocalStorage(), checksums);
        await writeCheckedJson(zip, 'metadata/counts.json', counts, checksums);

        const manifest = {
            format: FORMAT,
            formatVersion: FORMAT_VERSION,
            appVersion: APP_VERSION,
            databaseName: dexieDB.name,
            createdAt: new Date().toISOString(),
            mode: compact ? 'single-user-compact' : 'single-user-full',
            tables: tableNames,
            excludes: compact
                ? ['GitHub token', 'retired unifiedMemory', 'redundant status replacePattern', 'completed task payload/result snapshots']
                : ['GitHub token'],
            encoding: 'utf-8'
        };
        zip.file('manifest.json', encodeText(stableJson(manifest)));
        zip.file('metadata/checksums.json', encodeText(stableJson(checksums)));

        return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    }

    function createCompactBackupBlob() {
        return createBackupBlob({ compact: true });
    }

    async function parseAndValidate(blob) {
        assertReady();
        let zip;
        try { zip = await JSZip.loadAsync(blob); }
        catch (_) { throw new Error('文件不是有效的当前版完整备份'); }

        const required = ['manifest.json', 'metadata/counts.json', 'metadata/checksums.json', 'local-storage.json'];
        for (const path of required) if (!zip.file(path)) throw new Error(`备份缺少文件: ${path}`);

        const manifest = JSON.parse((await readVerifiedText(zip, 'manifest.json')).text);
        if (manifest.format !== FORMAT || manifest.formatVersion !== FORMAT_VERSION) {
            throw new Error('只支持当前版 ovo-full-backup v1 完整备份');
        }
        if (!Array.isArray(manifest.tables) || !manifest.tables.length) throw new Error('备份表清单无效');

        const checksums = JSON.parse((await readVerifiedText(zip, 'metadata/checksums.json')).text);
        const countsRead = await readVerifiedText(zip, 'metadata/counts.json', checksums['metadata/counts.json']);
        const counts = JSON.parse(countsRead.text);
        const tables = {};
        const normalizedPaths = [];
        for (const name of manifest.tables) {
            const path = `database/${name}.json`;
            const read = await readVerifiedText(zip, path, checksums[path]);
            if (read.legacyEncodingNormalized) normalizedPaths.push(path);
            const rows = JSON.parse(read.text);
            if (!Array.isArray(rows)) throw new Error(`数据表格式无效: ${name}`);
            if (Number(counts[name]) !== rows.length) throw new Error(`数据数量不一致: ${name}`);
            tables[name] = rows;
        }

        const localRead = await readVerifiedText(zip, 'local-storage.json', checksums['local-storage.json']);
        if (localRead.legacyEncodingNormalized) normalizedPaths.push('local-storage.json');
        const localStorageData = JSON.parse(localRead.text);
        return { manifest, counts, tables, localStorageData, normalizedPaths };
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
        return {
            success: true,
            manifest: parsed.manifest,
            counts: parsed.counts,
            normalizedPaths: parsed.normalizedPaths
        };
    }

    window.BackupService = {
        FORMAT,
        FORMAT_VERSION,
        createBackupBlob,
        createCompactBackupBlob,
        parseAndValidate,
        restoreBackupBlob,
        compactCharacterRow
    };
})();
