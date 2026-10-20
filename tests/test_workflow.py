import io
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
import zipfile
import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = yaml.load((ROOT / 'workflow.yml').read_text(), Loader=yaml.BaseLoader)


class WorkflowTests(unittest.TestCase):
    def unpack(self, entries):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        (root / 'temp').mkdir()
        with zipfile.ZipFile(root / 'temp/source.zip', 'w') as archive:
            for name, content in entries:
                archive.writestr(name, content)
        step = next(s for s in WORKFLOW['jobs']['prepare']['steps'] if s.get('id') == 'input')
        script = step['run'].split("python3 - <<'PY'\n", 1)[1].rsplit('\nPY', 1)[0]
        result = subprocess.run(['python3', '-c', script], env={**os.environ,
            'RUNNER_TEMP': str(root / 'temp'), 'GITHUB_WORKSPACE': str(root),
            'GITHUB_OUTPUT': str(root / 'outputs')}, capture_output=True, text=True)
        return root, result

    def test_bundle_in_nested_build_directory_is_accepted(self):
        root, result = self.unpack([('myapp/build/outputs/bundle/release/app.aab', b'app-bundle')])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((root / 'unsigned/app.aab').read_bytes(), b'app-bundle')
        self.assertIn('kind=bundle', (root / 'outputs').read_text())

    def test_source_with_outer_folder_and_existing_build_output(self):
        files = [('project/settings.gradle.kts', b''), ('project/gradlew', b''),
            ('project/gradle/wrapper/gradle-wrapper.jar', b''),
            ('project/gradle/wrapper/gradle-wrapper.properties', b''),
            ('project/build/old.aab', b'old')]
        root, result = self.unpack(files)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('kind=project', (root / 'outputs').read_text())
        self.assertFalse((root / 'source/project/build/old.aab').exists())

    def test_apk_only_multiple_bundles_and_missing_wrapper_fail(self):
        for files in [[('app.apk', b'apk')], [('one.aab', b'a'), ('two.aab', b'b')], [('settings.gradle', b'')]]:
            _, result = self.unpack(files)
            self.assertNotEqual(result.returncode, 0)

    def test_traversal_links_and_private_key_files_fail(self):
        for name in ['../escape.aab', '/absolute.aab', 'C:/drive.aab', 'app.jks', 'key.properties', '.env', 'app\nname.aab']:
            _, result = self.unpack([(name, b'private')])
            self.assertNotEqual(result.returncode, 0, name)
        link = zipfile.ZipInfo('app.aab')
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        _, result = self.unpack([(link, b'../target')])
        self.assertNotEqual(result.returncode, 0)

    def test_signing_secrets_exist_only_in_isolated_signing_step(self):
        jobs = WORKFLOW['jobs']
        self.assertNotIn('secrets.', str(jobs['prepare']))
        self.assertNotIn('secrets.', str(jobs['cleanup']))
        secret_steps = [s for s in jobs['sign']['steps'] if 'secrets.' in str(s)]
        self.assertEqual(len(secret_steps), 1)
        self.assertIn('Sign and verify', secret_steps[0]['name'])
        self.assertNotIn('checkout', str(jobs['sign']))
        self.assertIn('private == true', jobs['prepare']['if'])
        self.assertEqual(jobs['prepare']['permissions'], {'contents': 'read'})
        self.assertEqual(jobs['sign']['permissions'], {'actions': 'read'})

    def test_only_signed_outputs_are_published_and_cleanup_is_always_scoped(self):
        sign = WORKFLOW['jobs']['sign']
        upload = next(s for s in sign['steps'] if 'upload-artifact' in s.get('uses', ''))
        self.assertEqual(upload['with']['path'], 'signed/')
        self.assertEqual(upload['with']['retention-days'], '1')
        cleanup = WORKFLOW['jobs']['cleanup']
        self.assertIn('always()', cleanup['if'])
        self.assertIn("release.get('draft') is True", cleanup['steps'][0]['run'])
        self.assertIn('native-convert-input-', cleanup['steps'][0]['run'])


if __name__ == '__main__':
    unittest.main()
