#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourcePath = path.resolve(process.argv[2] || '/mnt/data/阿沉_memory_package_逻辑收敛修正版.json');
const outputPath = path.resolve(process.argv[3] || path.join(root, 'docs/V2.14-R2_实际记忆包正式写入门禁验证.json'));
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function createSandbox() {
    const box = {
        console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object, Error, Promise,
        setTimeout, clearTimeout, queueMicrotask,
        window: null,
        document: { addEventListener() {}, querySelectorAll: () => [] },
        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
        db: { memoryTableTemplates: [], characters: [] }
    };
    box.window = box;
    vm.createContext(box);
    vm.runInContext(read('js/features/memory/kernel.js'), box, { filename: 'kernel.js' });
    vm.runInContext(read('js/features/memory/write_coordinator.js'), box, { filename: 'write_coordinator.js' });
    vm.runInContext(read('js/features/memory/write_gateway.js'), box, { filename: 'write_gateway.js' });
    vm.runInContext(read('js/features/memory/domain.js'), box, { filename: 'domain.js' });
    return box;
}

function countRows(pkg) {
    const templates = Array.isArray(pkg.templates) ? pkg.templates : [];
    const data = pkg.binding?.data || {};
    let rows = 0;
    templates.forEach(template => {
        const templateData = data[template.id] || {};
        (template.tables || []).forEach(table => {
            if (table.mode !== 'rows') return;
            const tableData = templateData[table.id];
            rows += Array.isArray(tableData?.__rows) ? tableData.__rows.length : 0;
        });
    });
    return rows;
}

(async () => {
    assert(fs.existsSync(sourcePath), `记忆包不存在：${sourcePath}`);
    const hashBefore = hashFile(sourcePath);
    const pkg = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const box = createSandbox();
    const Kernel = box.OvoMemoryKernel;
    const Domain = Kernel.require('domain');
    const Gateway = Kernel.require('writeGateway');
    box.db.memoryTableTemplates = clone(pkg.templates || []);
    box.window.db = box.db;

    const template = box.db.memoryTableTemplates[0];
    assert(template, '记忆包没有模板');
    const chat = {
        id: 'v214-r2-actual-package-copy',
        memoryTables: clone(pkg.binding || {})
    };
    chat.memoryTables.boundTemplateIds ||= [template.id];
    chat.memoryTables.history ||= [];

    const rowsTables = (template.tables || []).filter(table => table.mode === 'rows');
    const table = rowsTables.find(item => /稳定长期/.test(item.name || ''))
        || rowsTables.find(item => Domain.getRows(chat, template.id, item).length)
        || null;
    assert(table, '没有可测试的多行记忆表');
    const rows = Domain.getRows(chat, template.id, table);
    const row = rows[0];
    assert(row, `表格“${table.name}”没有可测试记录`);
    const field = (table.columns || []).find(item => /内容|摘要|标题/.test(item.key || '')) || table.columns?.[0];
    assert(field, '没有可测试字段');

    const originalValue = clone(row.cells?.[field.id]);
    const changedValue = `${originalValue == null ? '' : String(originalValue)}\n[V2.14-R2 写入门禁验证]`;
    const beforeFailure = JSON.stringify(chat.memoryTables);
    let failureWriteAttempts = 0;
    let rollbackApplied = false;

    await assert.rejects(() => Gateway.run(chat, {
        reason: 'actual-package-failure-test',
        source: 'v214-r2-validation',
        action: 'update',
        operationId: 'v214-r2-validation-failure',
        templateId: template.id,
        tableId: table.id,
        rowId: row.id,
        persistRollback: false,
        writer: async () => {
            failureWriteAttempts += 1;
            throw new Error('模拟持久化失败');
        }
    }, () => {
        const formalRow = Domain.findRowById(chat, template.id, table, row.id);
        const oldValue = clone(formalRow.cells?.[field.id]);
        const changed = Domain.updateRowFieldValue(chat, template.id, table, row.id, field, changedValue, {
            source: 'v214-r2-validation', skipHistory: true
        });
        return {
            changed,
            changes: [{
                templateId: template.id,
                tableId: table.id,
                rowId: row.id,
                fieldId: field.id,
                label: `${table.name} / ${field.key}`,
                oldValue,
                newValue: changedValue
            }]
        };
    }), error => {
        rollbackApplied = error?.memoryRollbackApplied === true;
        return rollbackApplied;
    });
    const rollbackExact = JSON.stringify(chat.memoryTables) === beforeFailure;
    assert(rollbackExact, '模拟失败后完整 memoryTables 未恢复');

    let successWrites = 0;
    const success = await Gateway.run(chat, {
        reason: 'actual-package-success-test',
        source: 'v214-r2-validation',
        action: 'update',
        operationId: 'v214-r2-validation-success',
        templateId: template.id,
        tableId: table.id,
        rowId: row.id,
        writer: async () => { successWrites += 1; }
    }, () => {
        const formalRow = Domain.findRowById(chat, template.id, table, row.id);
        const oldValue = clone(formalRow.cells?.[field.id]);
        const changed = Domain.updateRowFieldValue(chat, template.id, table, row.id, field, changedValue, {
            source: 'v214-r2-validation', skipHistory: true
        });
        return {
            changed,
            changes: [{
                templateId: template.id,
                tableId: table.id,
                rowId: row.id,
                fieldId: field.id,
                label: `${table.name} / ${field.key}`,
                oldValue,
                newValue: changedValue
            }]
        };
    });
    assert.strictEqual(success.receipt.recordCount, 1);
    assert.strictEqual(success.receipt.fieldCount, 1);
    assert.strictEqual(success.receipt.persisted, true);

    const revert = await Gateway.run(chat, {
        reason: 'actual-package-revert-test',
        source: 'v214-r2-validation',
        action: 'update',
        operationId: 'v214-r2-validation-revert',
        templateId: template.id,
        tableId: table.id,
        rowId: row.id,
        writer: async () => { successWrites += 1; }
    }, () => {
        const formalRow = Domain.findRowById(chat, template.id, table, row.id);
        const oldValue = clone(formalRow.cells?.[field.id]);
        const changed = Domain.updateRowFieldValue(chat, template.id, table, row.id, field, originalValue, {
            source: 'v214-r2-validation', skipHistory: true
        });
        return {
            changed,
            changes: [{
                templateId: template.id,
                tableId: table.id,
                rowId: row.id,
                fieldId: field.id,
                label: `${table.name} / ${field.key}`,
                oldValue,
                newValue: originalValue
            }]
        };
    });
    assert.strictEqual(revert.receipt.recordCount, 1);
    assert.strictEqual(Domain.findRowById(chat, template.id, table, row.id).cells[field.id], originalValue);

    const hashAfter = hashFile(sourcePath);
    const report = {
        version: '2.14-R2',
        sourceFile: path.basename(sourcePath),
        templateCount: (pkg.templates || []).length,
        tableCount: (pkg.templates || []).reduce((sum, item) => sum + (item.tables || []).length, 0),
        rowCount: countRows(pkg),
        testedTable: table.name,
        testedField: field.key,
        failureWriteAttempts,
        rollbackApplied,
        rollbackExact,
        successWrites,
        receipt: {
            schemaVersion: success.receipt.schemaVersion,
            producerVersion: success.receipt.producerVersion,
            status: success.receipt.status,
            recordCount: success.receipt.recordCount,
            fieldCount: success.receipt.fieldCount,
            persisted: success.receipt.persisted
        },
        revertedToOriginalValue: true,
        sourceModified: hashBefore !== hashAfter,
        gatewayMetrics: Gateway.getMetrics()
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
})().catch(error => {
    console.error(error);
    process.exit(1);
});
