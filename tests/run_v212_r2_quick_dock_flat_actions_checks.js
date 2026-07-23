const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.12-R2', '2.12-R3', '2.12-R4', '2.12-R5', '2.12-R5.1', '2.12-R5.2', '2.12-R5.3'].includes(read('VERSION.txt').trim()));
const dock = read('js/modules/floating_ball.js');
const barSource = read('js/modules/quick_dock_action_bar.js');
const css = read('css/modules/quick_dock.css');
const html = read('index.html');

assert(html.includes('js/modules/quick_dock_action_bar.js'));
assert(html.indexOf('quick_dock_action_bar.js') < html.indexOf('floating_ball.js'));
assert(!dock.includes('function renderTools()'));
assert(!dock.includes('function renderPromentStatus()'));
assert(!dock.includes("action === 'open-tools'"));
assert(!dock.includes("action === 'open-proment'"));
assert(!dock.includes('quick-dock-operation-tools'));
assert(dock.includes('renderPanelShell'));
assert(dock.includes('quick-dock-top-model-select'));
assert(css.includes('.quick-dock-action-hub'));
assert(css.includes('.quick-dock-top-actions'));
assert(css.includes('grid-template-columns:repeat(4,minmax(0,1fr))'));

const context = { window: {} };
vm.createContext(context);
vm.runInContext(barSource, context);
const bar = context.window.QuickDockActionBar;
assert(bar);
assert.strictEqual(bar.VERSION, '2.12-R2');
assert.strictEqual(bar.ACTIONS.length, 8);
const markup = bar.render({ activePanel: 'main', api: { provider: 'newapi', model: 'test-model' }, operationId: 'op-1' });
['操作','详情','Proment','日志','覆盖','Git 上传','Git 恢复','Git 设置'].forEach(label => assert(markup.includes(label)));
assert(markup.includes('quick-dock-top-model-select'));
assert(markup.includes('data-qd-action="switch-api"'));
assert(markup.includes('data-qd-action="refresh-models"'));
assert(markup.indexOf('当前模型') < markup.indexOf('Git 设置'));

const noOperation = bar.render({ activePanel: 'main', api: { model: 'x' }, operationId: '' });
assert(/data-qd-action="open-operation"[^>]*disabled/.test(noOperation));
console.log('V2.12-R2 QUICK DOCK FLAT ACTIONS CHECKS: PASS');
