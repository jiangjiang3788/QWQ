#!/usr/bin/env python3
"""Create a clean deploy/source release from the project directory."""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ROOT_FILES = {
    'index.html', 'manifest.json', 'sw.js', '_headers', '_redirects',
    'netlify.toml', 'NETLIFY_DEPLOY.txt', 'VERSION.txt',
    'contacts.css', 'more_menu.css',
    '章鱼机_V2.9-R11_更新说明与验收.md',
    '章鱼机_V2.9-R11_项目理解深度报告.md',
    '章鱼机_V2.9-R11_自动检查结果.txt',
}
ROOT_DIRS = {'css', 'js', 'vendor', 'memory_templates', 'tests', 'tools', 'docs'}


def build(source: Path, output: Path) -> None:
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for name in ROOT_FILES:
        src = source / name
        if src.exists():
            shutil.copy2(src, output / name)
    for name in ROOT_DIRS:
        src = source / name
        if src.exists():
            shutil.copytree(src, output / name, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    for template in source.glob('章鱼机_分层可检索记忆模板V2.8_含原数据.json'):
        shutil.copy2(template, output / template.name)
    files = sorted(path.relative_to(output).as_posix() for path in output.rglob('*') if path.is_file())
    (output / 'PACKAGE_MANIFEST.txt').write_text('\n'.join(files) + '\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    build(args.source.resolve(), args.output.resolve())
