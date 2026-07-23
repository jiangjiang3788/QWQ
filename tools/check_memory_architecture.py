#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((ROOT / 'architecture' / 'memory_domains.json').read_text(encoding='utf-8'))
errors: list[str] = []


def read(rel: str) -> str:
    path = ROOT / rel
    if not path.exists():
        errors.append(f'missing file: {rel}')
        return ''
    return path.read_text(encoding='utf-8', errors='ignore')


index = read('index.html')
controller_rel = CONTRACT['controller']
controller = read(controller_rel)
facades = CONTRACT['publicFacades']

owners: dict[str, str] = {}
for facade_name, spec in facades.items():
    rel = spec['file']
    text = read(rel)
    if f"Kernel.register('{facade_name}'" not in text and f'Kernel.register("{facade_name}"' not in text:
        errors.append(f'facade registration mismatch: {facade_name} in {rel}')
    owned = list(spec.get('owns', []))
    for module_name in owned:
        previous = owners.get(module_name)
        if previous:
            errors.append(f'duplicate module ownership: {module_name} -> {previous}, {facade_name}')
        owners[module_name] = facade_name
        if not re.search(rf"Kernel\.(?:require|get)\(['\"]{re.escape(module_name)}['\"]\)", text):
            errors.append(f'facade does not expose owned module: {facade_name} -> {module_name}')

controller_requires = re.findall(r"Kernel\.(?:require|get)\(['\"]([^'\"]+)['\"]\)", controller)
allowed = set(CONTRACT['controllerAllowedRequires'])
for name in controller_requires:
    if name not in allowed:
        errors.append(f'controller bypasses domain facade: {name}')
for name in sorted(allowed):
    if name not in controller_requires:
        errors.append(f'controller missing declared domain dependency: {name}')

controller_pos = index.find(f'src="{controller_rel}"')
if controller_pos < 0:
    errors.append('memory controller script is not loaded')
for facade_name, spec in facades.items():
    facade_pos = index.find(f'src="{spec["file"]}"')
    if facade_pos < 0:
        errors.append(f'facade script is not loaded: {spec["file"]}')
        continue
    if controller_pos >= 0 and facade_pos > controller_pos:
        errors.append(f'facade loads after controller: {spec["file"]}')
    for module_name in spec.get('owns', []):
        pattern = re.compile(rf'<script[^>]+src="([^"]+)"[^>]*></script>')
        candidates = []
        for match in pattern.finditer(index):
            rel = match.group(1).split('?', 1)[0]
            source = ROOT / rel
            if not source.exists() or source.suffix != '.js':
                continue
            source_text = source.read_text(encoding='utf-8', errors='ignore')
            if re.search(rf"Kernel\.register\(['\"]{re.escape(module_name)}['\"]", source_text):
                candidates.append(match.start())
        if not candidates:
            errors.append(f'owned module has no loaded registration: {module_name}')
        elif max(candidates) > facade_pos:
            errors.append(f'facade loads before owned module: {facade_name} -> {module_name}')

for rel, limit in CONTRACT.get('budgets', {}).items():
    path = ROOT / rel
    if not path.exists():
        errors.append(f'budget target missing: {rel}')
        continue
    lines = len(path.read_text(encoding='utf-8', errors='ignore').splitlines())
    if lines > int(limit):
        errors.append(f'line budget exceeded: {rel} {lines}>{limit}')

required_order = [
    'js/features/memory/domains/platform.js',
    'js/features/memory/domains/foundation.js',
    'js/features/memory/domains/schema.js',
    'js/features/memory/domains/governance.js',
    'js/features/memory/domains/retrieval.js',
    'js/features/memory/domains/update.js',
    'js/features/memory/domains/tables.js',
    'js/features/memory/architecture.js',
    'js/features/memory/maintenance.js',
    controller_rel,
    'js/features/memory/facade.js',
]
positions = [index.find(f'src="{rel}"') for rel in required_order]
if any(pos < 0 for pos in positions) or positions != sorted(positions):
    errors.append(f'invalid memory architecture script order: {positions}')

floating = read('js/modules/floating_ball.js')
for retired in ('renderTools(', 'renderPromentStatus(', "action === 'open-tools'", "action === 'open-proment'"):
    if retired in floating:
        errors.append(f'retired quick dock branch remains: {retired}')

schema_controller = controller
for retired in ('renderTemplateEditor(', 'renderTemplateDesigner(', 'openTemplateJsonEditor('):
    if retired in schema_controller:
        errors.append(f'retired schema editor branch remains: {retired}')

if errors:
    print('MEMORY ARCHITECTURE CHECK: FAIL')
    for error in errors:
        print('-', error)
    sys.exit(1)

print('MEMORY ARCHITECTURE CHECK: PASS')
print(f'domains={len(facades)} ownedModules={len(owners)} controllerRequires={len(controller_requires)}')
for rel, limit in CONTRACT.get('budgets', {}).items():
    lines = len((ROOT / rel).read_text(encoding='utf-8', errors='ignore').splitlines())
    print(f'budget {rel}: {lines}/{limit}')
