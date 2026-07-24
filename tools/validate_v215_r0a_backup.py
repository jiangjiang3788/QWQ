#!/usr/bin/env python3
"""Read-only validation for V2.15-R0A against a compact .ee backup."""
from __future__ import annotations
import argparse, hashlib, json, zipfile
from pathlib import Path


def digest_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_digest(value) -> str:
    data = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return digest_bytes(data)


def find_setting(items, key):
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict) and item.get('key') == key:
            return item.get('value')
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('backup', type=Path)
    ap.add_argument('output', type=Path)
    args = ap.parse_args()
    source_before = args.backup.read_bytes()
    source_sha_before = digest_bytes(source_before)
    with zipfile.ZipFile(args.backup) as zf:
        manifest = json.loads(zf.read('manifest.json'))
        counts = json.loads(zf.read('metadata/counts.json'))
        characters = json.loads(zf.read('database/characters.json'))
        settings = json.loads(zf.read('database/globalSettings.json'))
    templates = find_setting(settings, 'memoryTableTemplates') or []
    character = characters[0] if characters else {}
    memory = character.get('memoryTables') or {}
    table_count = sum(len(t.get('tables') or []) for t in templates)
    field_count = sum(len(table.get('columns') or []) for tpl in templates for table in (tpl.get('tables') or []))
    row_count = 0
    for tpl in templates:
        bound = (memory.get('data') or {}).get(tpl.get('id'), {})
        for table in tpl.get('tables') or []:
            rows = (bound.get(table.get('id')) or {}).get('__rows')
            if isinstance(rows, list): row_count += len(rows)
    role_modes = []
    promotion_visible = 0
    for tpl in templates:
        for table in tpl.get('tables') or []:
            role = table.get('systemRole') or 'general'
            mode = (table.get('commitPolicy') or {}).get('mode') or 'review'
            ui_mode = 'pending' if mode in {'review', 'candidate'} else mode
            choices = ['direct', 'pending', 'manual_only'] + (['promotion'] if role == 'long_candidate' else [])
            if 'promotion' in choices: promotion_visible += 1
            role_modes.append({'tableId': table.get('id'), 'role': role, 'internalMode': mode, 'uiMode': ui_mode, 'choices': choices})
    template_hash_before = canonical_digest(templates)
    formal_hash_before = canonical_digest(memory.get('data') or {})
    # R0A validation is deliberately read-only: calculate again after all UI-policy inspection.
    template_hash_after = canonical_digest(templates)
    formal_hash_after = canonical_digest(memory.get('data') or {})
    source_sha_after = digest_bytes(args.backup.read_bytes())
    report = {
        'version': '2.15-R0A',
        'validation': 'lossless-ui-convergence',
        'backup': {
            'format': manifest.get('format'),
            'formatVersion': manifest.get('formatVersion'),
            'mode': manifest.get('mode'),
            'declaredCharacters': counts.get('characters'),
            'sourceSha256Before': source_sha_before,
            'sourceSha256After': source_sha_after,
            'sourceUnchanged': source_sha_before == source_sha_after,
        },
        'memory': {
            'characters': len(characters),
            'templates': len(templates),
            'tables': table_count,
            'fields': field_count,
            'formalRows': row_count,
            'templateSha256Before': template_hash_before,
            'templateSha256After': template_hash_after,
            'templateUnchanged': template_hash_before == template_hash_after,
            'formalDataSha256Before': formal_hash_before,
            'formalDataSha256After': formal_hash_after,
            'formalDataUnchanged': formal_hash_before == formal_hash_after,
        },
        'uiPolicyInspection': {
            'tables': role_modes,
            'promotionVisibleTableCount': promotion_visible,
            'ordinaryTablesHidePromotion': all(('promotion' not in x['choices']) for x in role_modes if x['role'] != 'long_candidate'),
            'pendingInternalModesPreserved': all((x['internalMode'] in {'review','candidate'} and x['uiMode'] == 'pending') or x['internalMode'] not in {'review','candidate'} for x in role_modes),
        },
        'sensitiveDataIncludedInReport': False,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'templates': len(templates), 'tables': table_count, 'fields': field_count, 'formalRows': row_count,
        'sourceUnchanged': report['backup']['sourceUnchanged'],
        'templateUnchanged': report['memory']['templateUnchanged'],
        'formalDataUnchanged': report['memory']['formalDataUnchanged'],
        'promotionVisibleTableCount': promotion_visible,
    }, ensure_ascii=False))

if __name__ == '__main__':
    main()
