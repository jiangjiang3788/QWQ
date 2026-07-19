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
for rel in ['js/features/memory/kernel.js','js/features/memory/api_adapter.js','js/features/memory/domain.js','js/features/memory/facade.js','js/modules/memory_table_policy.js','js/modules/memory_table_lifecycle.js','js/modules/memory_table_effects.js','js/modules/memory_table_feedback.js','js/modules/memory_table_review.js','js/modules/memory_table_retrieval.js','js/modules/memory_table_sidecar.js','js/modules/memory_table_tasks.js','css/modules/memory_table_v2.css','memory_templates/当前默认记忆模板_V2.8.json']:
    if not (root/rel).exists(): errors.append('missing memory v2 asset: '+rel)
for rid in ['memory-table-normal-mode-btn','memory-table-json-mode-btn','memory-table-trigger-mode','memory-table-round-interval','memory-table-cursor-table-select','memory-table-cursor-position','memory-table-update-selected-btn','memory-table-review-mode','memory-table-retrieval-mode','memory-table-semantic-weight','memory-table-embedding-candidate-limit','memory-table-preview-range-btn','memory-review-tab-count','memory-range-preview-modal','memory-live-state-bar','memory-sidecar-enabled-toggle','memory-sidecar-candidate-toggle','memory-sidecar-statusbar-toggle','memory-sidecar-tab-count','memory-table-tag-weight','memory-table-scene-routing-toggle','memory-table-side-effect-guard-toggle','memory-task-tab-count','memory-feedback-tab-count']:
    if rid not in ids: errors.append('missing memory v2 id: '+rid)
policy_js=(root/'js/modules/memory_table_policy.js').read_text(encoding='utf-8') if (root/'js/modules/memory_table_policy.js').exists() else ''
lifecycle_js=(root/'js/modules/memory_table_lifecycle.js').read_text(encoding='utf-8') if (root/'js/modules/memory_table_lifecycle.js').exists() else ''
feedback_js=(root/'js/modules/memory_table_feedback.js').read_text(encoding='utf-8') if (root/'js/modules/memory_table_feedback.js').exists() else ''
effects_js=(root/'js/modules/memory_table_effects.js').read_text(encoding='utf-8') if (root/'js/modules/memory_table_effects.js').exists() else ''
review_js=(root/'js/modules/memory_table_review.js').read_text(encoding='utf-8') if (root/'js/modules/memory_table_review.js').exists() else ''
sidecar_js=(root/'js/modules/memory_table_sidecar.js').read_text(encoding='utf-8') if (root/'js/modules/memory_table_sidecar.js').exists() else ''
retrieval_js=(root/'js/modules/memory_table_retrieval.js').read_text(encoding='utf-8') if (root/'js/modules/memory_table_retrieval.js').exists() else ''
tasks_js=(root/'js/modules/memory_table_tasks.js').read_text(encoding='utf-8') if (root/'js/modules/memory_table_tasks.js').exists() else ''
chat_ai_js=(root/'js/modules/chat_ai.js').read_text(encoding='utf-8')
if 'beginRound' not in policy_js or 'finishRound' not in policy_js: errors.append('memory v2 round tracker missing')
if 'memoryRoundToken' not in chat_ai_js: errors.append('chat ai not integrated with memory rounds')
facade_js=(root/'js/features/memory/facade.js').read_text(encoding='utf-8') if (root/'js/features/memory/facade.js').exists() else ''
if 'prepareMemoryTableContext' not in chat_ai_js or 'prepareMemoryTableContext: facade.context.prepare' not in facade_js: errors.append('relevant table context preparation missing')
if 'enqueueBatch' not in review_js or 'renderReviewView' not in review_js or 'dataSignature' not in review_js: errors.append('memory v2.1 review workflow missing')
if 'buildMemoryReviewBatch' not in memory_table_js or 'finalizeMemoryReviewBatch' not in memory_table_js or 'rollbackMemoryReviewBatch' not in memory_table_js: errors.append('memory v2.1 review integration missing')
if 'evaluateRow' not in lifecycle_js or 'linkRows' not in lifecycle_js or 'runMaintenance' not in lifecycle_js: errors.append('memory v2.5 lifecycle module missing')
if 'evaluateItem' not in effects_js or 'getPromptDirective' not in effects_js or 'migrateRows' not in effects_js: errors.append('memory v2.4 effects routing module missing')
if 'prepareGroups' not in retrieval_js or 'renderDiagnostics' not in retrieval_js or 'findMostSimilar' not in retrieval_js: errors.append('memory v2.2 retrieval module missing')
if 'buildSystemPrompt' not in sidecar_js or 'extractSidecar' not in sidecar_js or 'applySidecar' not in sidecar_js: errors.append('memory v2.3 sidecar module missing')
if 'memory_table_lifecycle.js' not in html or 'data-tab="reliability"' not in html: errors.append('memory v2.5 lifecycle UI integration missing')
if 'memory_table_tasks.js' not in html or 'data-tab="tasks"' not in html: errors.append('memory v2.6 task queue UI integration missing')
if 'memory_table_feedback.js' not in html or 'data-tab="feedback"' not in html: errors.append('memory v2.7 feedback UI integration missing')
if 'captureInjection' not in feedback_js or 'applyAction' not in feedback_js or 'evaluateItem' not in feedback_js: errors.append('memory v2.7 feedback module missing')
if 'enqueueTableUpdate' not in tasks_js or 'resolveReviewBatch' not in tasks_js or 'perRoundApiLimit' not in tasks_js: errors.append('memory v2.6 task queue module missing')
if 'MemoryTableSidecar.extractSidecar' not in chat_ai_js or 'enableMemorySidecar' not in chat_ai_js: errors.append('chat ai sidecar integration missing')
if 'review-toggle-merge' not in review_js or 'setProposalMergeTarget' not in review_js: errors.append('memory v2.2 merge review missing')
try:
    import json
    pkg=json.loads((root/'memory_templates/当前默认记忆模板_V2.8.json').read_text(encoding='utf-8'))
    if pkg.get('version') != 2: errors.append('memory v2 package version mismatch')
    if pkg.get('schemaVersion') != '2.8': errors.append('memory v2.8 schemaVersion mismatch')
    if pkg.get('binding',{}).get('engineSettings',{}).get('reviewMode') != 'summary_only': errors.append('memory v2.2 default review mode mismatch')
    if pkg.get('binding',{}).get('engineSettings',{}).get('retrievalMode') != 'auto': errors.append('memory v2.4 retrieval mode mismatch')
    if pkg.get('binding',{}).get('engineSettings',{}).get('tagWeight') != 0.35: errors.append('memory v2.4 tag weight mismatch')
    if pkg.get('binding',{}).get('engineSettings',{}).get('sceneRoutingEnabled') is not True: errors.append('memory v2.4 scene routing default missing')
    if pkg.get('binding',{}).get('engineSettings',{}).get('sideEffectGuardEnabled') is not True: errors.append('memory v2.4 side effect guard default missing')
    if pkg.get('binding',{}).get('sidecar',{}).get('enabled') is not True: errors.append('memory v2.3 sidecar default missing')
    live={t.get('id'):t for t in pkg.get('templates',[{}])[0].get('tables',[])}
    for tid in ['table_current_state','table_tasks']:
        if live.get(tid,{}).get('injectionPolicy',{}).get('mode') != 'never': errors.append(f'live table generic injection not disabled: {tid}')
    for tid in ['table_current_state','table_tasks','table_recent_events','table_daily_observation']:
        if live.get(tid,{}).get('updatePolicy',{}).get('enabled') is not False: errors.append(f'short table separate auto request not disabled: {tid}')
    if pkg.get('migration',{}).get('preservedOriginalRowCount') != 206: errors.append('memory v2 original row migration count mismatch')
    all_rows=[]
    tpl=pkg.get('templates',[{}])[0]
    for table in tpl.get('tables',[]):
        all_rows.extend(pkg.get('binding',{}).get('data',{}).get(tpl.get('id'),{}).get(table.get('id'),{}).get('__rows',[]))
    if len(all_rows) != 209: errors.append(f'memory v2.5 row count mismatch: {len(all_rows)}')
    if any(not row.get('meta',{}).get('tagBundle') or not row.get('meta',{}).get('usePolicy') or not row.get('meta',{}).get('usage') for row in all_rows): errors.append('memory v2.4 row metadata migration incomplete')
    if any(not row.get('meta',{}).get('evidence') or not row.get('meta',{}).get('lifecycle') or not row.get('meta',{}).get('relations') or not isinstance(row.get('meta',{}).get('versionLog'), list) for row in all_rows): errors.append('memory v2.5 reliability metadata migration incomplete')
    if any(not isinstance(row.get('meta',{}).get('feedback'), dict) for row in all_rows): errors.append('memory v2.7 feedback metadata migration incomplete')
    if pkg.get('migration',{}).get('v25',{}).get('migratedReliabilityMetadataCount') != 209: errors.append('memory v2.5 migration count mismatch')
    if pkg.get('binding',{}).get('taskQueue',{}).get('settings',{}).get('maxAttempts') != 3: errors.append('memory v2.6 task queue settings missing')
    if pkg.get('migration',{}).get('v26',{}).get('preservedTotalRowCount') != 209: errors.append('memory v2.6 migration count mismatch')
    if pkg.get('binding',{}).get('feedback',{}).get('settings',{}).get('irrelevantCooldownRounds') != 8: errors.append('memory v2.7 feedback settings missing')
    if pkg.get('migration',{}).get('v27',{}).get('migratedFeedbackMetadataCount') != 209: errors.append('memory v2.7 migration count mismatch')
    long_table=next((t for t in pkg.get('templates',[{}])[0].get('tables',[]) if t.get('name')=='稳定长期特征库'),None)
    source_field=next((f for f in (long_table or {}).get('columns',[]) if f.get('key')=='来源域'),None)
    if '长期候选审核' not in (source_field or {}).get('options',[]): errors.append('long-term candidate promotion source option missing')
except Exception as exc:
    errors.append('invalid memory v2 package: '+str(exc))


# V2.9-R1 memory kernel boundaries.
kernel_js=(root/'js/features/memory/kernel.js').read_text(encoding='utf-8') if (root/'js/features/memory/kernel.js').exists() else ''
domain_js=(root/'js/features/memory/domain.js').read_text(encoding='utf-8') if (root/'js/features/memory/domain.js').exists() else ''
api_adapter_js=(root/'js/features/memory/api_adapter.js').read_text(encoding='utf-8') if (root/'js/features/memory/api_adapter.js').exists() else ''
workspace_js=(root/'js/features/memory/workspace.js').read_text(encoding='utf-8') if (root/'js/features/memory/workspace.js').exists() else ''
for token in ["Kernel.register('policy'", "Kernel.register('lifecycle'", "Kernel.register('effects'", "Kernel.register('feedback'", "Kernel.register('review'", "Kernel.register('retrieval'", "Kernel.register('sidecar'", "Kernel.register('tasks'", "Kernel.register('quality'", "Kernel.register('controller'"]:
    if token not in ''.join([policy_js,lifecycle_js,effects_js,feedback_js,review_js,retrieval_js,sidecar_js,tasks_js,(root/'js/modules/memory_table_quality.js').read_text(encoding='utf-8'),memory_table_js]): errors.append('memory kernel registration missing: '+token)
if "Kernel.register('domain'" not in domain_js or "Kernel.register('api'" not in api_adapter_js or "Kernel.register('workspace'" not in workspace_js: errors.append('memory domain/api/workspace registration missing')
script_order=[html.find('js/features/memory/kernel.js'),html.find('js/features/memory/api_adapter.js'),html.find('js/features/memory/domain.js'),html.find('js/features/memory/workspace.js'),html.find('js/modules/memory_table.js'),html.find('js/features/memory/facade.js')]
if any(pos < 0 for pos in script_order) or script_order != sorted(script_order): errors.append('memory kernel script order invalid')
if len(memory_table_js.splitlines()) >= 4650: errors.append('memory_table.js has not been reduced below R1 target')
helper_pattern=re.compile(r'^\s*function\s+(clone|deepClone|escapeHtml|escapeAttribute|clamp|clampNumber|unique|createId|createMemoryId|hashText|moveArrayItem)\b',re.M)
helper_hits=[]
for rel in root.glob('js/modules/memory_table*.js'):
    found=helper_pattern.findall(rel.read_text(encoding='utf-8'))
    if found: helper_hits.append(rel.name+':'+','.join(found))
if helper_hits: errors.append('memory shared helpers not converged: '+'; '.join(helper_hits))

required=['proment-compare-runtime','proment-preview-worldbook','proment-preview-ai-request']
for rid in required:
    if rid not in ids: errors.append('missing required id: '+rid)
print('STATIC CHECKS:', 'PASS' if not errors else 'FAIL')
for e in errors: print('-',e)
sys.exit(1 if errors else 0)
