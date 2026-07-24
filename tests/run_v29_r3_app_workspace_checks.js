const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

function assert(condition, message) { if (!condition) throw new Error(message); }

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const registry = fs.readFileSync(path.join(root, 'js/app_registry.js'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'js/features/apps/settings_hub.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'js/features/apps/api_workspace.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/modules/app_workspace.css'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

assert(registry.includes("const homeAppIds = Object.freeze(['worldbook', 'theater', 'favorites', 'reminder', 'search', 'appearance', 'data'])"), 'flat phone launcher app list missing');
assert(!registry.includes('launcherSections'), 'grouped launcher sections should be retired');
assert(registry.includes("id: 'settings'"), 'settings app is not registered');
assert(registry.includes("['chat', 'api', 'memory', 'settings']"), 'quick dock should expose API instead of duplicate character entry');
assert(!html.includes('id="global-bottom-nav"'), 'legacy bottom Apps navigation should be removed');
assert(ui.includes("targetId === 'more-screen'"), 'legacy More route redirect is missing');
assert(ui.includes("return 'settings-hub-screen'"), 'legacy More route does not reach Settings');
assert(html.includes('js/features/apps/settings_hub.js'), 'settings hub script not loaded');
assert(html.includes('js/features/apps/api_workspace.js'), 'API workspace script not loaded');
assert(html.includes('css/modules/app_workspace.css'), 'app workspace stylesheet not loaded');
assert(/VERSION = '2\.(?:10-R[123456]|11-R(?:[0124567]|3(?:\.1)?)|12-R[0-5]|13-R0)'/.test(settings), 'settings hub compatibility version mismatch');
for (const title of ['个人与角色', '模型与能力', '外观与桌面', '数据与系统']) {
  assert(settings.includes(title), `missing Settings section ${title}`);
}
for (const id of ['chat', 'memory', 'automation', 'perception']) {
  assert(api.includes(`id: '${id}'`), `missing API workspace ${id}`);
}
assert(api.includes("section.dataset.apiGroup = classify(section)"), 'API sections are not grouped');
assert(css.includes('.settings-hub-list'), 'settings list style missing');
assert(css.includes('.api-workspace-tabs'), 'API workspace tabs style missing');
assert(/^V?2\.(?:10-R(?:1|2(?:\.1)?|3(?:\.[123])?|4|5|6)|11-R(?:[0124567]|3(?:\.1)?)|12-R(?:[0-4]|5(?:\.[1234])?)|13-R(?:[014]|5(?:\.[1234])?)|14-R(?:0|1|2|3|4|5|6|7|8(?:\.1)?))$/.test(fs.readFileSync(path.join(root, 'VERSION.txt'), 'utf8').trim()), 'release compatibility version mismatch');

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
assert(duplicates.length === 0, `duplicate DOM ids: ${[...new Set(duplicates)].join(', ')}`);
console.log('V2.9-R3 APP WORKSPACE CHECKS: PASS');
