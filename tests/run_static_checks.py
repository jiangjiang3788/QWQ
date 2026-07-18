from pathlib import Path
import re, sys, zipfile
root=Path(__file__).resolve().parents[1]
errors=[]
html=(root/'index.html').read_text(encoding='utf-8')
# 启动必需的第三方脚本必须随项目本地部署；在线图片和字体仍允许联网。
script_srcs=re.findall(r'<script\b[^>]*\bsrc=["\']([^"\']+)', html, re.I)
external_scripts=[src for src in script_srcs if src.startswith(('http:','https:','//'))]
if external_scripts: errors.append('external startup scripts: '+', '.join(external_scripts))
required_vendor={
    'vendor/dexie.js','vendor/purify.min.js','vendor/echarts.min.js',
    'vendor/html2canvas.min.js','vendor/mammoth.browser.min.js',
    'vendor/jszip.min.js','vendor/Sortable.min.js','vendor/crypto-js.min.js'
}
missing_vendor=sorted(required_vendor-set(script_srcs))
if missing_vendor: errors.append('missing vendor script references: '+', '.join(missing_vendor))
ids=re.findall(r'\bid=["\']([^"\']+)',html)
dups=sorted({x for x in ids if ids.count(x)>1})
if dups: errors.append('duplicate ids: '+', '.join(dups[:20]))
for src in re.findall(r'(?:src|href)=["\']([^"\']+)',html):
    if src.startswith(('http:','https:','data:','#','javascript:')): continue
    p=(root/src.split('?',1)[0].lstrip('/'))
    if not p.exists(): errors.append('missing asset: '+src)
for banned in ['saveCallOnInterruptEl','setupHeartPhotoModal','widgetWallpaperModalClose']:
    hits=[]
    for p in root.rglob('*.js'):
        if banned in p.read_text(encoding='utf-8',errors='ignore'): hits.append(str(p.relative_to(root)))
    if hits: errors.append(f'retired symbol {banned}: '+', '.join(hits))
# 多行结构化档案回归检查：renderFieldEditor 只能有一个实现，且必须透传 rowId。
memory_table_js=(root/'js/modules/memory_table.js').read_text(encoding='utf-8')
render_editor_defs=re.findall(r'function\s+renderFieldEditor\s*\(', memory_table_js)
if len(render_editor_defs)!=1:
    errors.append(f'memory rows editor duplicate definition count: {len(render_editor_defs)}')
if 'rowId = ''' not in memory_table_js or 'data-row-id="${rowId}"' not in memory_table_js:
    errors.append('memory rows editor does not preserve rowId')


# 结构化记忆 V2 回归检查。
for rel in ['js/modules/memory_table_policy.js','css/modules/memory_table_v2.css','memory_templates/章鱼机_分层可检索记忆模板V2_含原数据.json']:
    if not (root/rel).exists(): errors.append('missing memory v2 asset: '+rel)
for rid in ['memory-table-normal-mode-btn','memory-table-json-mode-btn','memory-table-trigger-mode','memory-table-round-interval','memory-table-cursor-table-select','memory-table-cursor-position','memory-table-update-selected-btn']:
    if rid not in ids: errors.append('missing memory v2 id: '+rid)
policy_js=(root/'js/modules/memory_table_policy.js').read_text(encoding='utf-8') if (root/'js/modules/memory_table_policy.js').exists() else ''
chat_ai_js=(root/'js/modules/chat_ai.js').read_text(encoding='utf-8')
if 'beginRound' not in policy_js or 'finishRound' not in policy_js: errors.append('memory v2 round tracker missing')
if 'memoryRoundToken' not in chat_ai_js: errors.append('chat ai not integrated with memory rounds')
if 'prepareMemoryTableContext' not in chat_ai_js or 'window.prepareMemoryTableContext' not in memory_table_js: errors.append('relevant table context preparation missing')
try:
    import json
    pkg=json.loads((root/'memory_templates/章鱼机_分层可检索记忆模板V2_含原数据.json').read_text(encoding='utf-8'))
    if pkg.get('version') != 2: errors.append('memory v2 package version mismatch')
    if pkg.get('migration',{}).get('preservedOriginalRowCount') != 206: errors.append('memory v2 original row migration count mismatch')
except Exception as exc:
    errors.append('invalid memory v2 package: '+str(exc))

required=['proment-compare-runtime','proment-preview-worldbook','proment-preview-ai-request']
for rid in required:
    if rid not in ids: errors.append('missing required id: '+rid)
print('STATIC CHECKS:', 'PASS' if not errors else 'FAIL')
for e in errors: print('-',e)
sys.exit(1 if errors else 0)
