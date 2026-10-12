#!/usr/bin/env python3
"""Consistent SQLite backup. Treat both database and backups as private account data."""
from contextlib import closing
import argparse
from pathlib import Path
import sqlite3


def snapshot(source, destination):
    source, destination = Path(source), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Never overwrite a backup or accidentally create an empty source database.
    with destination.open('xb'):
        pass
    destination.chmod(0o600)
    try:
        with closing(sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True)) as src:
            with closing(sqlite3.connect(destination)) as dst:
                src.backup(dst)
                # A portable snapshot must not depend on root-owned WAL/SHM sidecars.
                dst.execute('PRAGMA journal_mode=DELETE')
                if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise RuntimeError('Backup integrity check failed')
    except Exception:
        destination.unlink(missing_ok=True)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    snapshot(args.source, args.destination)
