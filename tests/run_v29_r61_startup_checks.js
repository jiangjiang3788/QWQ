const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
const customization = fs.readFileSync(path.join(root, 'js/features/settings/customization.js'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

assert(!/^\s*updateClock\s*\(/m.test(main), 'main.js no longer calls the removed updateClock() function');
assert(!/setInterval\s*\(\s*updateClock\b/.test(main), 'main.js no longer schedules the removed updateClock function');
assert(/function\s+applyHomeStatusBar\s*\(/.test(customization), 'home status bar implementation remains available');
assert(/setInterval\s*\(\s*\(\)\s*=>[\s\S]*?htsb-time/.test(customization), 'home status bar keeps its own time refresh loop');
assert(/setInterval\s*\(\s*checkAutoReply\s*,\s*60000\s*\)/.test(main), 'auto-reply timer remains enabled');

if (process.exitCode) process.exit(process.exitCode);
