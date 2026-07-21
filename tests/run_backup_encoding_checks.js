const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { webcrypto } = require('crypto');
const JSZip = require('../vendor/jszip.min.js');

const root = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'js/modules/backup_service.js'), 'utf8');
const localStore = new Map();
const localStorage = {
  get length() { return localStore.size; },
  key(index) { return [...localStore.keys()][index] || null; },
  getItem(key) { return localStore.has(key) ? localStore.get(key) : null; },
  setItem(key, value) { localStore.set(key, String(value)); }
};
const sandbox = {
  console,
  JSZip,
  crypto: webcrypto,
  TextEncoder,
  TextDecoder,
  structuredClone,
  localStorage,
  dexieDB: { name: 'test', tables: [] },
  window: { crypto: webcrypto },
  appVersion: 'test'
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const BackupService = sandbox.window.BackupService;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function sha(bytes) {
  const digest = await webcrypto.subtle.digest('SHA-256', bytes);
  return Buffer.from(digest).toString('hex');
}
function legacyCesu8(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
    else out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
  }
  return new Uint8Array(out);
}

(async () => {
  const tables = {
    archives: [], characters: [{ id: 'c1', text: 'emoji 👑' }], globalSettings: [],
    groups: [], myStickers: [], storage: [], worldBooks: []
  };
  const zip = new JSZip();
  const checksums = {};
  for (const [name, rows] of Object.entries(tables)) {
    const pathName = `database/${name}.json`;
    const text = JSON.stringify(rows);
    const standard = new TextEncoder().encode(text);
    checksums[pathName] = await sha(standard);
    zip.file(pathName, name === 'characters' ? legacyCesu8(text) : standard);
  }
  const counts = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]));
  const countsBytes = new TextEncoder().encode(JSON.stringify(counts));
  const localBytes = new TextEncoder().encode('{}');
  checksums['metadata/counts.json'] = await sha(countsBytes);
  checksums['local-storage.json'] = await sha(localBytes);
  zip.file('metadata/counts.json', countsBytes);
  zip.file('local-storage.json', localBytes);
  zip.file('metadata/checksums.json', new TextEncoder().encode(JSON.stringify(checksums)));
  zip.file('manifest.json', new TextEncoder().encode(JSON.stringify({
    format: 'ovo-full-backup', formatVersion: 1, appVersion: 'legacy', databaseName: 'test',
    createdAt: new Date().toISOString(), mode: 'single-user-full', tables: Object.keys(tables).sort(), excludes: []
  })));
  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const parsed = await BackupService.parseAndValidate(archive);
  assert(parsed.tables.characters[0].text === 'emoji 👑', 'legacy emoji restored');
  assert(parsed.normalizedPaths.includes('database/characters.json'), 'legacy encoding reported');
  console.log('BACKUP ENCODING CHECKS: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
