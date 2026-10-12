#!/usr/bin/env python3
"""Prepare an upstream release merge locally. Never deploy or force-push."""
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def git(*args, check=True):
    return subprocess.run(['git', *args], cwd=ROOT, check=check, text=True, capture_output=True)


def main():
    if git('status', '--porcelain').stdout.strip():
        raise SystemExit('Commit or stash your changes first; no files were changed.')
    if git('branch', '--show-current').stdout.strip() != 'main':
        raise SystemExit('Start on main. This tool creates a separate update branch.')
    origin = git('remote', 'get-url', 'origin').stdout.strip()
    if 'D3carabian/Stronghold-Protocol' not in origin:
        raise SystemExit('Unexpected origin; inspect remotes before updating.')
    release = json.loads(subprocess.check_output([
        'gh', 'api', 'repos/sganggs/Stronghold-Protocol/releases/latest'], text=True))
    tag = release['tag_name']
    if not re.fullmatch(r'v\d+\.\d+\.\d+', tag) or release['draft'] or release['prerelease']:
        raise SystemExit('Only a stable release is accepted.')
    lock = json.loads((ROOT / 'ops/assets.lock.json').read_text())
    if tag == lock['tag']:
        print(f'Already based on {tag}; no update needed.')
        return
    name = f'Stronghold-Protocol-{tag}.zip'
    asset = next((a for a in release['assets'] if a['name'] == name), None)
    if not asset or not re.fullmatch(r'sha256:[0-9a-f]{64}', asset.get('digest') or ''):
        raise SystemExit('Release needs a full asset archive with a GitHub SHA-256 digest.')
    git('fetch', 'upstream', f'refs/tags/{tag}:refs/tags/{tag}')
    git('switch', '-c', f'update/{tag}')
    merged = git('merge', '--no-ff', '--no-commit', tag, check=False)
    if merged.returncode:
        git('merge', '--abort')
        raise SystemExit(f'Conflicts require manual resolution on update/{tag}; production is unchanged.')
    lock.update(tag=tag, asset=name, sha256=asset['digest'].removeprefix('sha256:'), url=asset['browser_download_url'])
    (ROOT / 'ops/assets.lock.json').write_text(json.dumps(lock, indent=2) + '\n')
    print(f'Prepared update/{tag}. Review, run CI + golden + asset checks, commit and open a PR to this fork main.')
    print('Nothing was pushed or deployed. Staging playtests and an explicit production promotion remain required.')


if __name__ == '__main__':
    main()
