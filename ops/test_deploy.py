import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTests(unittest.TestCase):
    def test_disconnected_match_is_not_idle(self):
        with self.assertRaises(RuntimeError):
            deploy.require_idle({'sockets': 0, 'rooms': 1, 'matches': 1, 'humans': 1})
        with self.assertRaises(RuntimeError):
            deploy.require_idle({'ok': True})
        deploy.require_idle({'sockets': 0, 'rooms': 0, 'matches': 0, 'humans': 0})

    def test_gate_cleanup_and_existing_gate(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            with self.assertRaises(RuntimeError):
                with deploy.gate(root):
                    self.assertTrue((root / 'maintenance').is_file())
                    raise RuntimeError('abort')
            self.assertFalse((root / 'maintenance').exists())
            (root / 'maintenance').touch()
            with self.assertRaises(FileExistsError):
                with deploy.gate(root):
                    pass

    def test_env_rejects_injection(self):
        with self.assertRaises(ValueError):
            deploy.env_text('image\nEVIL=yes', Path('/assets'), Path('/control'), 3100, 'production')


if __name__ == '__main__':
    unittest.main()

class AuthDeploymentTests(unittest.TestCase):
    def test_busy_email_prevents_deployment(self):
        with self.assertRaises(RuntimeError):
            deploy.require_idle(dict(sockets=0, rooms=0, matches=0, humans=0, authPending=1))

    def test_auth_paths_are_preserved_and_not_interpolated(self):
        value = deploy.env_text('test:image', Path('/assets'), Path('/control'), 3101, 'staging', '/private/staging.env', '/state/staging')
        self.assertIn('AUTH_ENV_FILE=/private/staging.env', value)
        self.assertIn('AUTH_STATE_DIR=/state/staging', value)
        with self.assertRaises(ValueError):
            deploy.env_text('test:image', Path('/assets'), Path('/control'), 3101, 'staging', '/private/$SECRET', '/state')

    def test_sqlite_backup_includes_wal_and_leaves_source_unchanged(self):
        import sqlite3
        from auth_backup import snapshot
        with tempfile.TemporaryDirectory() as d:
            source, backup = Path(d) / 'source.db', Path(d) / 'backup.db'
            db = sqlite3.connect(source)
            try:
                db.execute('PRAGMA journal_mode=WAL')
                db.execute('CREATE TABLE users (email TEXT)')
                db.execute("INSERT INTO users VALUES ('test@example.com')")
                db.commit()
                snapshot(source, backup)
                with sqlite3.connect(backup) as copy:
                    self.assertEqual(copy.execute('SELECT * FROM users').fetchone(), ('test@example.com',))
                    copy.execute('DELETE FROM users')
                self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0], 1)
                with self.assertRaises(FileExistsError):
                    snapshot(source, backup)
            finally:
                db.close()

    def test_candidate_isolated_and_failed_upgrade_restores_database(self):
        import json
        import sqlite3
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / 'env').mkdir()
            state = root / 'state'
            state.mkdir()
            db = sqlite3.connect(state / 'auth.db')
            db.execute('CREATE TABLE users (email TEXT)')
            db.execute("INSERT INTO users VALUES ('original')")
            db.commit()
            db.close()
            assets = root / 'assets'
            assets.mkdir()
            (assets / 'bundle.json').write_text(json.dumps({'version': 'v0.2.4'}))
            auth = root / 'auth.env'
            auth.write_text('AUTH_ENABLED=1\nAUTH_ENVIRONMENT=staging\nAUTH_DATABASE_PATH=/var/lib/stronghold-auth/auth.db\nAUTH_HEALTH_TOKEN=' + 'a' * 43 + '\n')
            auth.chmod(0o600)
            active = root / 'env/staging.env'
            active.write_text(deploy.env_text('old:image', assets, root / 'control/staging', 3101, 'staging', auth, state))
            phases = []

            def fake_run(*args, **kwargs):
                if 'compose' not in args or 'up' not in args:
                    return ''
                values = deploy.read_env(args[args.index('--env-file') + 1])
                dbpath = Path(values['AUTH_STATE_DIR']) / 'auth.db'
                if '-candidate' in args[args.index('-p') + 1]:
                    self.assertNotEqual(dbpath.parent, state)
                    phases.append('candidate')
                elif values['GAME_IMAGE'] == 'new:image':
                    self.assertEqual(dbpath.parent, state)
                    phases.append('failed-upgrade')
                else:
                    phases.append('rollback')
                    return ''
                with sqlite3.connect(dbpath) as copy:
                    copy.execute('DELETE FROM users')
                if phases[-1] == 'failed-upgrade':
                    raise RuntimeError('simulated unhealthy upgrade')
                return ''

            def mapped_path(value):
                return root / 'control' if str(value) == '/srv/stronghold/control' else Path(value)

            report = dict(ok=True, app='0.2.4', sockets=0, rooms=0, matches=0, humans=0, authPending=0)
            with patch.object(deploy, 'run', side_effect=fake_run), patch.object(deploy, 'validate'), \
                    patch.object(deploy, 'health', return_value=report), patch.object(deploy.os, 'geteuid', return_value=0), \
                    patch.object(deploy.os, 'chown'), patch.object(deploy, 'Path', side_effect=mapped_path):
                with self.assertRaisesRegex(RuntimeError, 'simulated unhealthy'):
                    deploy.activate(root, 'staging', 'new:image', assets)
            self.assertEqual(phases, ['candidate', 'failed-upgrade', 'rollback'])
            with sqlite3.connect(state / 'auth.db') as restored:
                self.assertEqual(restored.execute('SELECT email FROM users').fetchone()[0], 'original')
            self.assertIn('GAME_IMAGE=old:image', active.read_text())
            self.assertFalse((root / 'control/staging/maintenance').exists())
