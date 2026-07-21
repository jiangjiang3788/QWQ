#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
errors: list[str] = []
index = (root / 'index.html').read_text(encoding='utf-8')

for retired in ('id="phone-screen"', 'id="storage-screen"', 'id="burnout-update-modal"', 'id="create-group-btn-kkt"'):
    if retired in index:
        errors.append(f'retired UI still present: {retired}')

nav_targets = re.findall(r'class="nav-item[^\"]*"[^>]+data-target="([^"]+)"', index)
if nav_targets:
    errors.append(f'legacy bottom navigation still present: {nav_targets}')

registry = (root / 'js' / 'app_registry.js').read_text(encoding='utf-8')
for app_id in ('memory', 'worldbook', 'theater', 'favorites', 'reminder', 'search', 'chat', 'api', 'settings'):
    if f"id: '{app_id}'" not in registry:
        errors.append(f'missing app registry item: {app_id}')
for retired_app in ('characters', 'contacts'):
    if f"id: '{retired_app}'" in registry:
        errors.append(f'retired duplicate app still registered: {retired_app}')
if 'phone-app-grid' not in registry or 'launcherSections' in registry:
    errors.append('phone-style flat launcher contract is missing')

if 'js/core/feature_flags.js' not in index or 'js/app_registry.js' not in index:
    errors.append('app registry scripts are not loaded')
for rel in ('js/features/apps/settings_hub.js', 'js/features/apps/api_workspace.js', 'css/modules/app_workspace.css'):
    if rel not in index:
        errors.append(f'app workspace asset is not loaded: {rel}')

for js in sorted((root / 'js').rglob('*.js')):
    result = subprocess.run(['node', '--check', str(js)], capture_output=True, text=True)
    if result.returncode:
        errors.append(f'JS syntax: {js.relative_to(root)}\n{result.stderr.strip()}')



character_files = [
    'js/features/settings/character/context.js',
    'js/features/settings/character/profile_controller.js',
    'js/features/settings/character/media_controller.js',
    'js/features/settings/character/extensions_controller.js',
    'js/features/settings/character/behavior_controller.js',
    'js/features/settings/character/chat_controller.js',
]
for rel in character_files:
    if not (root / rel).exists():
        errors.append(f'missing character settings controller: {rel}')
settings_core = (root / 'js/settings.js').read_text(encoding='utf-8')
if len(settings_core.splitlines()) >= 500:
    errors.append('settings.js exceeds R5 compatibility facade target')
positions = [index.find(rel) for rel in character_files] + [index.find('js/settings.js')]
if any(position < 0 for position in positions) or positions != sorted(positions):
    errors.append(f'invalid character settings script order: {positions}')

required_memory_files = [
    'js/features/memory/kernel.js',
    'js/features/memory/domain.js',
    'js/features/memory/api_adapter.js',
    'js/features/memory/facade.js',
    'js/features/memory/workspace.js',
]
for rel in required_memory_files:
    if not (root / rel).exists():
        errors.append(f'missing memory kernel file: {rel}')
positions = [index.find('js/features/memory/kernel.js'), index.find('js/features/memory/api_adapter.js'), index.find('js/features/memory/domain.js'), index.find('js/features/memory/workspace.js'), index.find('js/modules/memory_table.js'), index.find('js/features/memory/facade.js')]
if any(position < 0 for position in positions) or positions != sorted(positions):
    errors.append(f'invalid memory kernel script order: {positions}')
main_memory = (root / 'js/modules/memory_table.js').read_text(encoding='utf-8')
if len(main_memory.splitlines()) >= 4650:
    errors.append('memory_table.js exceeds R1 line target')
helper_pattern = re.compile(r'^\s*function\s+(clone|deepClone|escapeHtml|escapeAttribute|clamp|clampNumber|unique|createId|createMemoryId|hashText|moveArrayItem)\b', re.M)
for file in (root / 'js/modules').glob('memory_table*.js'):
    found = helper_pattern.findall(file.read_text(encoding='utf-8'))
    if found:
        errors.append(f'duplicate shared helpers in {file.name}: {found}')

template = root / 'memory_templates' / '当前默认记忆模板_V2.8.json'
if not template.exists():
    errors.append('current V2.8 memory template is missing')
else:
    data = json.loads(template.read_text(encoding='utf-8'))
    rows = 0
    for template_data in data.get('templates', []):
        bound = data.get('binding', {}).get('data', {}).get(template_data.get('id'), {})
        for table in template_data.get('tables', []):
            rows += len(bound.get(table.get('id'), {}).get('__rows', []))
    if rows != 209:
        errors.append(f'unexpected memory row count: {rows}')
    digest = hashlib.sha256(template.read_bytes()).hexdigest()
    print(f'memory-template-sha256={digest}')

if errors:
    print('\n'.join(f'ERROR: {item}' for item in errors))
    sys.exit(1)
print('V2.9-R11 REFACTOR BASELINE: PASS')
