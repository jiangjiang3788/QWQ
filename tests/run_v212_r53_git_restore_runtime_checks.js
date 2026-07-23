const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/modules/tutorial.js'), 'utf8');

const attempts = [];
let restored = '';
const sandbox = {
  console,
  Blob,
  Uint8Array,
  Date,
  JSON,
  Math,
  Number,
  String,
  Array,
  Object,
  Map,
  Set,
  Promise,
  atob,
  btoa,
  setTimeout: () => 0,
  clearTimeout: () => {},
  location: { reload: () => {} },
  localStorage: { getItem: () => null, setItem: () => {} },
  document: {
    getElementById: () => null,
    createElement: () => ({ style: {}, appendChild() {}, remove() {} }),
    body: { appendChild() {}, insertAdjacentHTML() {} }
  },
  showToast: () => {},
  alert: () => {},
  confirm: () => true,
  BackupService: {
    parseAndValidate: async blob => {
      const text = await blob.text();
      attempts.push(text);
      if (text === 'old-format') throw new Error('旧格式');
      return { ok: true };
    },
    restoreBackupBlob: async blob => {
      restored = await blob.text();
      return { success: true };
    }
  },
  fetch: async url => {
    if (url.endsWith('/contents/')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { name: 'AutoBackup_2026-07-22_200.ee', path: 'AutoBackup_2026-07-22_200.ee', type: 'file' },
          { name: 'AutoBackup_2026-07-21_100.ee', path: 'AutoBackup_2026-07-21_100.ee', type: 'file' }
        ]
      };
    }
    if (url.endsWith('/contents/backup_chunks')) return { ok: false, status: 404, json: async () => ({}) };
    if (url.includes('200.ee')) return { ok: true, status: 200, blob: async () => new Blob(['old-format']) };
    if (url.includes('100.ee')) return { ok: true, status: 200, blob: async () => new Blob(['current-format']) };
    throw new Error('unexpected fetch: ' + url);
  }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'tutorial.js' });
sandbox.GitHubMgr.config = { token: 'token', repo: 'owner/repo', fileName: '' };

(async () => {
  const result = await sandbox.GitHubMgr.quickRestoreLatest();
  assert.deepStrictEqual(attempts, ['old-format', 'current-format']);
  assert.strictEqual(restored, 'current-format');
  assert.strictEqual(result.success, true);
  assert.strictEqual(sandbox.GitHubMgr._encodeRepoPath('backup_chunks/a b.ee'), 'backup_chunks/a%20b.ee');
  console.log('V2.12-R5.3 GIT RESTORE RUNTIME CHECKS: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
