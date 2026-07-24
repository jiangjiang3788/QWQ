const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

assert(['2.12-R5.3', '2.13-R0', '2.13-R1', '2.13-R4', '2.13-R5', '2.13-R5.1', '2.13-R5.2', '2.13-R5.3', '2.13-R5.4', '2.14-R0', '2.14-R1', '2.14-R2', '2.14-R3', '2.14-R4', '2.14-R5', '2.14-R6', '2.14-R7', '2.14-R8', '2.14-R8.1'].includes(read('VERSION.txt').trim()));
const html = read('index.html');
const widthSource = read('js/features/memory/field_width.js');
const gridSource = read('js/features/memory/table_grid.js');
const gestureSource = read('js/features/memory/table_gesture.js');
const workspaceSource = read('js/features/memory/table_workspace.js');
const css = read('css/modules/memory_table_flat.css');
const tutorial = read('js/modules/tutorial.js');
const architecture = JSON.parse(read('architecture/memory_domains.json'));

assert(html.includes('js/features/memory/field_width.js'));
assert(html.indexOf('field_width.js') < html.indexOf('schema_editor.js'));
assert(architecture.publicFacades.memoryFoundationDomain.owns.includes('fieldWidth'));
assert(widthSource.includes("Kernel.register('fieldWidth'"));
assert(gridSource.includes('FieldWidth.keyValueLabels'));
assert(gridSource.includes('memory-kv-label-col'));
assert(gridSource.includes('--memory-kv-label-width-mobile'));
assert(gridSource.includes('title="${Core.escapeAttribute(field.key)}"'));
assert(css.includes('text-overflow:ellipsis'));
assert(css.includes('white-space:nowrap'));
assert(css.includes('max-width:var(--memory-kv-label-width-mobile'));
assert(workspaceSource.includes('双击打开整行编辑'));
assert(read('index.html').includes('id="memory-row-edit-modal"'));
assert(workspaceSource.includes('手机双点'));
assert(!workspaceSource.includes('单击选中'));
assert(!workspaceSource.includes('Enter 编辑'));
assert(gestureSource.includes("root.addEventListener('dblclick'"));
assert(gestureSource.includes('DOUBLE_TAP_MS = 360'));
assert(gestureSource.includes("event.key !== 'F2'"));
assert(!gestureSource.includes('LONG_PRESS_MS'));
assert(gridSource.includes('，双击编辑'));
assert(tutorial.includes('_listRestoreCandidates'));
assert(tutorial.includes('_downloadRestoreCandidate'));
assert(tutorial.includes('_fetchGitRaw'));
assert(tutorial.includes("'Accept': 'application/vnd.github.v3.raw'"));
assert(tutorial.includes('await BackupService.parseAndValidate(blob)'));
assert(tutorial.includes('跳过无效候选'));
assert(tutorial.includes('仓库不存在、路径错误或 Token 无权访问 (404)'));

function context() {
  const c = { window: {}, console, Date, JSON, Math, Set, Map, Promise, setTimeout, clearTimeout };
  c.window.window = c.window;
  vm.createContext(c);
  vm.runInContext(read('js/features/memory/kernel.js'), c);
  return c;
}
const c = context();
vm.runInContext(widthSource, c);
const widths = c.window.OvoMemoryKernel.get('fieldWidth');
const compact = widths.keyValueLabels({ columns: [{ key: '短名' }] });
const longest = widths.keyValueLabels({ columns: [{ key: '双方_核心关系定义' }] });
assert(compact.desktop >= 116 && compact.desktop <= 260);
assert(compact.mobile >= 92 && compact.mobile <= 172);
assert(longest.desktop > compact.desktop);
assert(longest.mobile > compact.mobile);
assert(longest.mobile <= 172);
assert(longest.desktop <= 260);

console.log('V2.12-R5.3 KV / DOUBLE EDIT / RESTORE CHECKS: PASS');
