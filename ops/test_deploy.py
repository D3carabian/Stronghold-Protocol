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
