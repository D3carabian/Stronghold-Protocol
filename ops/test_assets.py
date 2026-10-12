import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('bundle', Path(__file__).with_name('asset_bundle.py'))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class AssetTests(unittest.TestCase):
    def archive(self, root, missing=False, traversal=False):
        p = root / 'release.zip'
        with zipfile.ZipFile(p, 'w') as z:
            prefix = 'Stronghold-Protocol/'
            z.writestr(prefix + 'package.json', '{"version":"0.2.4"}')
            z.writestr(prefix + 'data/assets.json', json.dumps({'image': '/assets/a.webp'}))
            z.writestr(prefix + 'data/local-assets.json', '{}')
            z.writestr(prefix + 'public/fonts/fonts.css', 'body{}')
            if not missing:
                z.writestr(prefix + 'public/assets/a.webp', b'asset')
            z.writestr(prefix + 'server/index.js', 'must not be imported')
            if traversal:
                z.writestr(prefix + 'public/assets/../../escape', 'bad')
        return p, hashlib.sha256(p.read_bytes()).hexdigest()

    def test_import_excludes_code(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            p, sha = self.archive(root)
            bundle.import_zip(p, root / 'out', sha, 'v0.2.4')
            self.assertTrue((root / 'out/public/assets/a.webp').is_file())
            self.assertFalse((root / 'out/server').exists())

    def test_rejects_bad_digest_missing_asset_and_traversal(self):
        for mode in ('digest', 'missing', 'traversal'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as d:
                root = Path(d)
                p, sha = self.archive(root, missing=mode == 'missing', traversal=mode == 'traversal')
                with self.assertRaises(ValueError):
                    bundle.import_zip(p, root / 'out', '0' * 64 if mode == 'digest' else sha, 'v0.2.4')
                self.assertFalse((root / 'out').exists())


if __name__ == '__main__':
    unittest.main()
