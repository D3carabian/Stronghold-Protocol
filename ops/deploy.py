#!/usr/bin/env python3
"""Activate a local code image + asset bundle. Run on the server with sudo."""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.request import urlopen
from asset_bundle import validate


def run(*args, capture=False):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE if capture else None).stdout


def health(port):
    with urlopen(f'http://127.0.0.1:{port}/healthz', timeout=5) as response:
        value = json.load(response)
    if value.get('ok') is not True:
        raise RuntimeError('Game is not healthy')
    return value


def require_idle(report):
    keys = ('sockets', 'rooms', 'matches', 'humans')
    if any(not isinstance(report.get(key), int) or report[key] != 0 for key in keys):
        raise RuntimeError('Deployment deferred: sockets, rooms, matches and humans must all be zero')


@contextmanager
def gate(directory):
    directory.mkdir(parents=True, exist_ok=True)
    flag = directory / 'maintenance'
    # Refuse an unexplained existing gate; an operator must inspect/recover a killed deployment.
    with flag.open('x') as stream:
        stream.write('deployment\n')
    try:
        yield
    finally:
        flag.unlink(missing_ok=True)


def env_text(image, assets, control, port, environment):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/@:-]+', image):
        raise ValueError('Invalid image reference')
    for value in (str(assets), str(control)):
        if not re.fullmatch(r'/[A-Za-z0-9/_\-.]+', value):
            raise ValueError('Use absolute paths without spaces or environment substitutions')
    return (f'GAME_IMAGE={image}\nASSET_DIR={assets}\nCONTROL_DIR={control}\nAPP_PORT={port}\n'
            f'MEMORY_LIMIT={"1536m" if environment == "production" else "1024m"}\n'
            f'CPU_LIMIT={"1.0" if environment == "production" else "0.5"}\n')


def activate(root, environment, image, assets):
    if os.geteuid() != 0:
        raise RuntimeError('Run with sudo on the server')
    assets = assets.resolve()
    validate(assets)
    bundle = json.loads((assets / 'bundle.json').read_text())
    run('docker', 'image', 'inspect', image, capture=True)
    root.mkdir(parents=True, exist_ok=True)
    envdir = root / 'env'
    envdir.mkdir(exist_ok=True)
    control = Path('/srv/stronghold/control') / environment
    control.mkdir(parents=True, exist_ok=True)
    port = 3100 if environment == 'production' else 3101
    candidate_port = 3198 if environment == 'production' else 3199
    compose = str(root / 'ops/compose.yml')
    active = envdir / f'{environment}.env'
    previous = envdir / f'{environment}.previous.env'
    project = f'stronghold-{environment}'
    next_text = env_text(image, assets, control, port, environment)

    def dc(proj, envfile, *args):
        return run('docker', 'compose', '-p', proj, '--env-file', str(envfile), '-f', compose, *args)

    with (root / f'{environment}.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with tempfile.TemporaryDirectory(prefix='candidate-', dir=root) as td:
            candidate = Path(td) / 'candidate.env'
            candidate.write_text(env_text(image, assets, control, candidate_port, environment))
            try:
                dc(project + '-candidate', candidate, 'up', '-d', '--wait', '--wait-timeout', '90')
                report = health(candidate_port)
                if report.get('app') != bundle['version'].removeprefix('v'):
                    raise RuntimeError('Code and asset base versions differ')
            finally:
                dc(project + '-candidate', candidate, 'down')
        old = active.read_text() if active.exists() else None
        with gate(control):
            if old is not None:
                require_idle(health(port))
            pending = envdir / f'{environment}.next.env'
            pending.write_text(next_text)
            try:
                dc(project, pending, 'up', '-d', '--wait', '--wait-timeout', '90')
                report = health(port)
                if report.get('app') != bundle['version'].removeprefix('v'):
                    raise RuntimeError('Unexpected deployed version')
            except Exception:
                if old is not None:
                    dc(project, active, 'up', '-d', '--wait', '--wait-timeout', '90')
                else:
                    dc(project, pending, 'down')
                raise
            else:
                if old is not None:
                    previous.write_text(old)
                os.replace(pending, active)
            finally:
                pending.unlink(missing_ok=True)
        print(json.dumps({'environment': environment, 'image': image, 'assets': str(assets), 'health': health(port)}, indent=2))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('environment', choices=['production', 'staging'])
    p.add_argument('image')
    p.add_argument('assets', type=Path)
    p.add_argument('--root', type=Path, default=Path('/opt/stronghold'))
    a = p.parse_args()
    activate(a.root, a.environment, a.image, a.assets)


if __name__ == '__main__':
    main()
