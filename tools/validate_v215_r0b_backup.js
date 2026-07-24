#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const cp = require('child_process');

const [backupArg, outputArg] = process.argv.slice(2);
if (!backupArg || !outputArg) {
  console.error('usage: node tools/validate_v215_r0b_backup.js <backup.ee> <report.json>');
  process.exit(2);
}
const root = path.resolve(__dirname, '..');
const backup = path.resolve(backupArg);
const output = path.resolve(outputArg);
const readSource = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const readZipJson = entry => JSON.parse(cp.execFileSync('unzip', ['-p', backup, entry], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }));
const shaFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
const shaJson = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const setting = (items, key) => (items || []).find(item => item?.key === key)?.value;
const countRows = data => Object.values(data || {}).reduce((sum, templateData) => sum + Object.values(templateData || {}).reduce((tableSum, tableData) => tableSum + (Array.isArray(tableData?.__rows) ? tableData.__rows.length : 0), 0), 0);

const sourceBefore = shaFile(backup);
const characters = readZipJson('database/characters.json');
const settings = readZipJson('database/globalSettings.json');
const manifest = readZipJson('manifest.json');
const counts = readZipJson('metadata/counts.json');
const templates = setting(settings, 'memoryTableTemplates') || [];
const character = characters[0] || {};
const memoryTables = character.memoryTables || {};
const formalDataBefore = shaJson(memoryTables.data || {});
const templateIdentityBefore = templates.map(template => ({
  id: template.id, name: template.name,
  tables: (template.tables || []).map(table => ({ id: table.id, name: table.name, fields: (table.columns || []).map(field => ({ id: field.id, key: field.key })) }))
}));
const missingBefore = templates.flatMap(template => template.tables || []).flatMap(table => table.columns || []).filter(field => !field.semanticRole || !field.identityRole).length;

const modules = new Map();
const box = {
  window: null, console, Date, Math, JSON, Map, Set, Array, String, Number, Boolean, Object,
  Error, Promise, RegExp, parseInt, parseFloat, isNaN, setTimeout, clearTimeout
};
box.window = box;
vm.createContext(box);
for (const rel of [
  'js/features/memory/kernel.js',
  'js/features/memory/memory_defaults.js',
  'js/modules/memory_table_policy.js',
  'js/features/memory/field_semantics.js',
  'js/features/memory/record_identity.js',
  'js/features/memory/schema_migrator.js'
]) vm.runInContext(readSource(rel), box, { filename: rel });
const Kernel = box.OvoMemoryKernel;
const Migrator = Kernel.require('schemaMigrator');
const Semantics = Kernel.require('fieldSemantics');
const Identity = Kernel.require('recordIdentity');

const sourcePackage = {
  type: 'memory_table_package', version: 3, formatVersion: 1, schemaVersion: '3.1', producerVersion: '2.14-R9',
  packageProfile: 'portable_snapshot', templates,
  binding: { data: memoryTables.data || {}, lockedFields: memoryTables.lockedFields || {} }
};
const sourcePackageBefore = shaJson(sourcePackage);
const result = Migrator.migrate(sourcePackage);
if (!result?.payload) throw new Error('schema migration returned no payload');
const migrated = result.payload;
const migratedFields = migrated.templates.flatMap(template => template.tables || []).flatMap(table => table.columns || []);
const explicitSemantic = migratedFields.filter(field => /^[a-z][a-z0-9_]*$/.test(String(field.semanticRole || ''))).length;
const explicitIdentity = migratedFields.filter(field => Semantics.IDENTITY_ROLES.includes(field.identityRole)).length;
const templateIdentityAfter = migrated.templates.map(template => ({
  id: template.id, name: template.name,
  tables: (template.tables || []).map(table => ({ id: table.id, name: table.name, fields: (table.columns || []).map(field => ({ id: field.id, key: field.key })) }))
}));

const recent = migrated.templates.flatMap(template => template.tables || []).find(table => table.systemRole === 'recent_events');
const renamed = recent ? JSON.parse(JSON.stringify(recent)) : null;
if (renamed) (renamed.columns || []).forEach((field, index) => { field.key = `显示名_${index + 1}`; });
const primary = renamed && Semantics.findIdentityField(renamed, 'primary_key');
const title = renamed && Semantics.findField(renamed, 'title');
const content = renamed && Semantics.findField(renamed, 'content');
const date = renamed && Semantics.findIdentityField(renamed, 'date');
const sampleCells = {};
if (primary) sampleCells[primary.id] = 'REAL-BACKUP-SEMANTIC-1';
if (title) sampleCells[title.id] = '改名后标题';
if (content) sampleCells[content.id] = '改名后正文';
if (date) sampleCells[date.id] = '2026-07-24';
const strongKey = renamed ? Identity.strongKey(renamed, sampleCells) : '';
const titleDateKey = renamed ? Identity.titleDateKey(renamed, sampleCells) : '';
const longCandidate = migrated.templates.flatMap(template => template.tables || []).find(table => table.systemRole === 'long_candidate');

const sourceAfter = shaFile(backup);
const report = {
  version: '2.15-R0B',
  validation: 'semantic-identity-hardcode-removal',
  backup: {
    format: manifest.format, formatVersion: manifest.formatVersion, mode: manifest.mode,
    declaredCharacters: counts.characters,
    sourceSha256Before: sourceBefore, sourceSha256After: sourceAfter, sourceUnchanged: sourceBefore === sourceAfter
  },
  memory: {
    characters: characters.length,
    templates: templates.length,
    tables: templates.reduce((sum, template) => sum + (template.tables || []).length, 0),
    fields: templates.reduce((sum, template) => sum + (template.tables || []).reduce((n, table) => n + (table.columns || []).length, 0), 0),
    formalRowsBefore: countRows(memoryTables.data),
    formalRowsAfter: countRows(migrated.binding?.data),
    formalDataSha256Before: formalDataBefore,
    formalDataSha256After: shaJson(migrated.binding?.data || {}),
    formalDataUnchanged: formalDataBefore === shaJson(migrated.binding?.data || {}),
    templateIdsNamesFieldsUnchanged: shaJson(templateIdentityBefore) === shaJson(templateIdentityAfter)
  },
  migration: {
    sourceSchema: '3.1', targetSchema: migrated.schemaVersion,
    steps: Array.from(result.report?.steps || [], step => step.id || step),
    sourcePackageUnchanged: sourcePackageBefore === shaJson(sourcePackage),
    fieldsMissingExplicitRolesBefore: missingBefore,
    fieldsWithExplicitSemanticRoleAfter: explicitSemantic,
    fieldsWithExplicitIdentityRoleAfter: explicitIdentity,
    totalFieldsAfter: migratedFields.length,
    longCandidateFieldMapPresent: !!longCandidate?.promotionPolicy?.fieldMap,
    idempotent: Migrator.migrate(migrated).report.migrated === false
  },
  renamedFieldValidation: {
    recentEventsFoundBySystemRole: !!recent,
    primaryFieldFoundAfterRename: !!primary,
    titleFieldFoundAfterRename: !!title,
    contentFieldFoundAfterRename: !!content,
    strongKeyAfterRename: strongKey,
    titleDateKeyAfterRename: titleDateKey,
    recordIdentitySurvivesRename: !!strongKey && (!!date ? !!titleDateKey : true)
  },
  sensitiveDataIncludedInReport: false
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  templates: report.memory.templates, tables: report.memory.tables, fields: report.memory.fields,
  rows: report.memory.formalRowsBefore, sourceUnchanged: report.backup.sourceUnchanged,
  formalDataUnchanged: report.memory.formalDataUnchanged, schema: `${report.migration.sourceSchema}->${report.migration.targetSchema}`,
  explicitRoles: `${explicitSemantic}/${migratedFields.length}`, renameSafe: report.renamedFieldValidation.recordIdentitySurvivesRename
}, null, 2));
