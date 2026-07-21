const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'js/modules/backup_service.js'), 'utf8');
const tutorial = fs.readFileSync(path.join(root, 'js/modules/tutorial.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const checks = [
  ['current format', service.includes("const FORMAT = 'ovo-full-backup'") && service.includes('const FORMAT_VERSION = 1')],
  ['all Dexie tables enumerated', service.includes('for (const table of dexieDB.tables)')],
  ['SHA-256 validation', service.includes("crypto.subtle.digest('SHA-256'") && service.includes('校验失败')],
  ['transactional restore', service.includes("dexieDB.transaction('rw', dexieDB.tables")],
  ['GitHub token excluded', service.includes("EXCLUDED_LOCAL_STORAGE_KEYS = new Set(['gh_config'])")],
  ['full local export uses service', tutorial.includes('BackupService.createBackupBlob()')],
  ['full local import validates first', tutorial.includes('BackupService.parseAndValidate(file)') && tutorial.includes('BackupService.restoreBackupBlob(file)')],
  ['GitHub restore uses service', (tutorial.match(/BackupService\.restoreBackupBlob/g) || []).length >= 3],
  ['service loaded before tutorial', html.indexOf('backup_service.js') < html.indexOf('tutorial.js')]
];
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error('BACKUP CHECKS: FAIL');
  failed.forEach(([name]) => console.error('- ' + name));
  process.exit(1);
}
console.log('BACKUP CHECKS: PASS (' + checks.length + ')');
