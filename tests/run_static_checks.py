from pathlib import Path
import re, sys, zipfile
root=Path(__file__).resolve().parents[1]
errors=[]
html=(root/'index.html').read_text(encoding='utf-8')
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
