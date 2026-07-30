const fs = require('fs');
const vm = require('vm');
const context = { window: {}, console, structuredClone: global.structuredClone };
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/features/memory_v3/memory_core_v3.js', 'utf8'), context);
const M = context.window.MemoryV5;
const fixture = '/mnt/data/memoryStore_V5_4_1b_阿沉_2026-07-29.json';
if (!fs.existsSync(fixture)) { console.log('KV singleton migration fixture unavailable; skipped.'); process.exit(0); }
const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'));
const store = M.model.normalizeStore(raw);
const table = store.tables.find(t => t.id === 'v5_current_state');
const rows = store.records[table.id];
if (table.viewMode !== 'kv') throw new Error('current state should remain kv');
if (rows.length !== 1) throw new Error(`kv should migrate to singleton, got ${rows.length}`);
const names = table.fields.filter(f => f.scope === 'custom').map(f => f.name);
for (const expected of raw.records[table.id].map(record => record.title)) {
  if (!names.includes(expected)) throw new Error(`missing migrated field: ${expected}`);
}
const visibleCommon = table.fields.filter(f => f.scope === 'common' && !f.hidden);
if (visibleCommon.length) throw new Error('kv technical common fields should be hidden');
console.log('KV singleton migration test passed.');
