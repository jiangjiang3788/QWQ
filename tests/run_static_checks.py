from pathlib import Path
import re, sys, zipfile
root=Path(__file__).resolve().parents[1]
errors=[]
html=(root/'index.html').read_text(encoding='utf-8')
# 启动必需的第三方脚本必须随项目本地部署；在线图片和字体仍允许联网。
script_srcs_raw=re.findall(r'<script\b[^>]*\bsrc=["\']([^"\']+)', html, re.I)
script_srcs=[src.split('?',1)[0] for src in script_srcs_raw]
external_scripts=[src for src in script_srcs_raw if src.startswith(('http:','https:','//'))]
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
required=['proment-compare-runtime','proment-preview-worldbook','proment-preview-ai-request']
for rid in required:
    if rid not in ids: errors.append('missing required id: '+rid)
print('STATIC CHECKS:', 'PASS' if not errors else 'FAIL')
for e in errors: print('-',e)
sys.exit(1 if errors else 0)
