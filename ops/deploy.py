#!/usr/bin/env python3
"""Activate a local code image + asset bundle. Run on the server with sudo."""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import time
import subprocess
import tempfile
from urllib.request import urlopen, Request
from auth_backup import snapshot
from asset_bundle import validate


def run(*args, capture=False):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE if capture else None).stdout


def read_env(filename):
    values = {}
    if not filename or not Path(filename).exists():
        return values
    for line in Path(filename).read_text().splitlines():
        if not line or line.startswith('#'):
            continue
        name, separator, value = line.partition('=')
        if not separator or not re.fullmatch(r'[A-Z][A-Z0-9_]*', name):
            raise ValueError('Invalid environment file')
        values[name] = value
    return values


def health(port, auth_file=None):
    token = read_env(auth_file).get('AUTH_HEALTH_TOKEN')
    headers = {'X-Stronghold-Health': token} if token else {}
    with urlopen(Request(f'http://127.0.0.1:{port}/healthz', headers=headers), timeout=5) as response:
        value = json.load(response)
    if value.get('ok') is not True:
        raise RuntimeError('Game is not healthy')
    return value


def require_idle(report):
    keys = ('sockets', 'rooms', 'matches', 'humans')
    if 'authPending' in report:
        keys += ('authPending',)
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


def env_text(image, assets, control, port, environment, auth_file=None, auth_state=None):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._/@:-]+', image):
        raise ValueError('Invalid image reference')
    for value in (str(assets), str(control), *([str(auth_file), str(auth_state)] if auth_file else [])):
        if not re.fullmatch(r'/[A-Za-z0-9/_\-.]+', value):
            raise ValueError('Use absolute paths without spaces or environment substitutions')
    return (f'GAME_IMAGE={image}\nASSET_DIR={assets}\nCONTROL_DIR={control}\nAPP_PORT={port}\n'
            f'MEMORY_LIMIT={"1536m" if environment == "production" else "1024m"}\n'
            f'CPU_LIMIT={"1.0" if environment == "production" else "0.5"}\n'
            + (f'AUTH_ENV_FILE={auth_file}\nAUTH_STATE_DIR={auth_state}\n' if auth_file else ''))


def activate(root, environment, image, assets, auth_file=None):
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
    def dc(proj, envfile, *args):
        files = ['-f', compose]
        if read_env(envfile).get('AUTH_ENV_FILE'):
            files += ['-f', str(root / 'ops/compose.auth.yml')]
        return run('docker', 'compose', '-p', proj, '--env-file', str(envfile), *files, *args)

    with (root / f'{environment}.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        old = active.read_text() if active.exists() else None
        old_values = read_env(active)
        old_auth = old_values.get('AUTH_ENV_FILE')
        auth_file = str(auth_file.resolve()) if auth_file else old_auth
        # Preserve identity state on every later deploy; disabling auth needs a deliberate recovery procedure.
        state = Path(old_values.get('AUTH_STATE_DIR', f'/srv/stronghold/auth/{environment}')) if auth_file else None
        if auth_file:
            config = read_env(auth_file)
            if (config.get('AUTH_ENABLED') != '1' or config.get('AUTH_ENVIRONMENT') != environment
                    or config.get('AUTH_DATABASE_PATH') != '/var/lib/stronghold-auth/auth.db'
                    or len(config.get('AUTH_HEALTH_TOKEN', '')) < 43):
                raise ValueError('Invalid authentication deployment configuration')
            if Path(auth_file).stat().st_mode & 0o077:
                raise ValueError('Authentication environment file must be private (mode 600)')
            if old_auth and auth_file != old_auth:
                raise ValueError('Use the existing authentication env path; key rotation requires a separate migration')
            state.mkdir(parents=True, exist_ok=True, mode=0o700)
            state.chmod(0o700)
            os.chown(state, 1000, 1000)
        next_text = env_text(image, assets, control, port, environment, auth_file, state)
        with tempfile.TemporaryDirectory(prefix='candidate-', dir=root) as td:
            candidate = Path(td) / 'candidate.env'
            candidate_state = Path(td) / 'auth'
            if state:
                candidate_state.mkdir(mode=0o700)
                os.chown(candidate_state, 1000, 1000)
                if (state / 'auth.db').exists():
                    snapshot(state / 'auth.db', candidate_state / 'auth.db')
                    os.chown(candidate_state / 'auth.db', 1000, 1000)
            candidate.write_text(env_text(image, assets, control, candidate_port, environment, auth_file, candidate_state))
            try:
                dc(project + '-candidate', candidate, 'up', '-d', '--wait', '--wait-timeout', '90')
                report = health(candidate_port, auth_file)
                if report.get('app') != bundle['version'].removeprefix('v'):
                    raise RuntimeError('Code and asset base versions differ')
                if auth_file and 'authPending' not in report:
                    raise RuntimeError('Candidate does not implement authentication')
            finally:
                dc(project + '-candidate', candidate, 'down')
        with gate(control):
            if old is not None:
                require_idle(health(port, old_auth))
            backup = None
            if state and (state / 'auth.db').exists():
                backup = root / 'backups' / f'{environment}-{time.time_ns()}.db'
                snapshot(state / 'auth.db', backup)
            pending = envdir / f'{environment}.next.env'
            pending.write_text(next_text)
            try:
                dc(project, pending, 'up', '-d', '--wait', '--wait-timeout', '90')
                report = health(port, auth_file)
                if report.get('app') != bundle['version'].removeprefix('v'):
                    raise RuntimeError('Unexpected deployed version')
            except Exception:
                # Stop all writers before restoring the snapshot. The gate still blocks new logins and games.
                dc(project, pending, 'down')
                if state:
                    for name in ('auth.db', 'auth.db-wal', 'auth.db-shm'):
                        (state / name).unlink(missing_ok=True)
                    if backup:
                        shutil.copyfile(backup, state / 'auth.db')
                        (state / 'auth.db').chmod(0o600)
                        os.chown(state / 'auth.db', 1000, 1000)
                if old is not None:
                    dc(project, active, 'up', '-d', '--wait', '--wait-timeout', '90')
                raise
            else:
                if old is not None:
                    previous.write_text(old)
                os.replace(pending, active)
            finally:
                pending.unlink(missing_ok=True)
        print(json.dumps({'environment': environment, 'image': image, 'assets': str(assets), 'health': health(port, auth_file)}, indent=2))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('environment', choices=['production', 'staging'])
    p.add_argument('image')
    p.add_argument('assets', type=Path)
    p.add_argument('--root', type=Path, default=Path('/opt/stronghold'))
    p.add_argument('--auth-config', type=Path, help='Private auth env file; later deploys preserve the active setting')
    a = p.parse_args()
    activate(a.root, a.environment, a.image, a.assets, a.auth_config)


if __name__ == '__main__':
    main()
