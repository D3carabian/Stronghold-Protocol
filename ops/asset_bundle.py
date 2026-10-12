#!/usr/bin/env python3
"""Import only assets from a verified release ZIP; never execute bundled code."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tempfile
from urllib.parse import unquote, urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MANIFESTS = ('data/assets.json', 'data/local-assets.json')


def asset_path(name):
    p = PurePosixPath(name)
    if '\\' in name or p.is_absolute() or '..' in p.parts or ':' in name or '\x00' in name:
        raise ValueError('Unsafe asset path')
    return name.startswith(('public/assets/', 'public/fonts/')) or name in MANIFESTS


def urls(value):
    if isinstance(value, str) and value.startswith(('/assets/', '/fonts/')):
        yield 'public' + unquote(urlsplit(value).path)
    elif isinstance(value, dict):
        for item in value.values():
            yield from urls(item)
    elif isinstance(value, list):
        for item in value:
            yield from urls(item)


def validate(root):
    root = root.resolve()
    paths = set()
    for name in MANIFESTS:
        paths.update(urls(json.loads((root / name).read_text(encoding='utf-8'))))
    if not paths:
        raise ValueError('Empty asset manifest')
    paths.add('public/fonts/fonts.css')
    for name in paths:
        if not asset_path(name):
            raise ValueError('Invalid manifest entry')
        target = (root / name).resolve()
        if not target.is_relative_to(root) or not target.is_file() or target.stat().st_size == 0:
            raise ValueError(f'Missing or unsafe asset: {name}')
    return len(paths)


def import_zip(archive, destination, expected_sha, version, source='upstream-release'):
    if destination.exists():
        raise ValueError('Destination exists; use a new immutable bundle directory')
    with archive.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    if actual != expected_sha:
        raise ValueError('Archive SHA-256 does not match the trusted release metadata')
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.import-', dir=destination.parent))
    try:
        with zipfile.ZipFile(archive) as z:
            package = json.loads(z.read('Stronghold-Protocol/package.json'))
            if package['version'] != version.removeprefix('v'):
                raise ValueError('Archive application version mismatch')
            total = 0
            seen = set()
            for info in z.infolist():
                if not info.filename.startswith('Stronghold-Protocol/'):
                    raise ValueError('Unexpected archive root')
                name = info.filename.removeprefix('Stronghold-Protocol/')
                if not name or info.is_dir():
                    continue
                if not asset_path(name):
                    continue
                if name in seen or stat.S_ISLNK(info.external_attr >> 16):
                    raise ValueError('Duplicate or symlink asset')
                seen.add(name)
                total += info.file_size
                if total > 4 * 1024**3:
                    raise ValueError('Asset archive exceeds size budget')
                target = stage / name
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(info) as src, target.open('wb') as out:
                    shutil.copyfileobj(src, out)
                target.chmod(0o644)
            checked = validate(stage)
            (stage / 'bundle.json').write_text(json.dumps({
                'source': source, 'version': version, 'archive_sha256': actual,
                'files': len(seen), 'manifest_paths_checked': checked,
            }, indent=2) + '\n')
            stage.chmod(0o755)
            os.rename(stage, destination)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return checked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    imp = sub.add_parser('import-release')
    imp.add_argument('archive', type=Path)
    imp.add_argument('destination', type=Path)
    imp.add_argument('--lock', type=Path, default=ROOT / 'ops/assets.lock.json')
    check = sub.add_parser('validate')
    check.add_argument('directory', type=Path)
    args = parser.parse_args()
    if args.command == 'validate':
        print(f'Validated {validate(args.directory)} manifest paths')
    else:
        lock = json.loads(args.lock.read_text(encoding='utf-8-sig'))
        count = import_zip(args.archive, args.destination, lock['sha256'], lock['tag'], lock.get('source', 'upstream-release'))
        print(f'Imported and validated {count} manifest paths')


if __name__ == '__main__':
    main()
