import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch, MagicMock

spec = importlib.util.spec_from_file_location('deploy_ftp', Path(__file__).parents[1] / 'scripts/deploy_ftp.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class FakeFTP:
    def __init__(self):
        self.files = {'public_html/index.php': b"require 'hozoryar/php/app/index.php';",
                      'public_html/.htaccess': b'old rules', 'hozoryar/php/config.php': b'private config'}
        self.current = '/'
        self.renames = []
        self.corrupt = False

    def pwd(self): return self.current
    def cwd(self, path): self.current = path
    def mkd(self, path): pass

    def retrbinary(self, command, callback):
        path = command.removeprefix('RETR ')
        if path not in self.files:
            raise deploy.error_perm('550 not found')
        callback(self.files[path])

    def storbinary(self, command, stream, blocksize):
        content = stream.read()
        self.files[command.removeprefix('STOR ')] = b'corrupt' if self.corrupt else content

    def rename(self, source, target):
        self.renames.append((source, target))
        self.files[target] = self.files.pop(source)


class DeploymentTests(unittest.TestCase):
    def test_verified_release_switch_preserves_config_and_rollback(self):
        ftp = FakeFTP()
        files = {'hozoryar/php/app/index.php': b'new router', 'hozoryar/web/home.html': b'new site',
                 'public_html/.htaccess': b'new rules'}
        record = deploy.publish(ftp, files, 'a' * 40, '100-1')
        self.assertEqual(record['files_verified'], 2)
        self.assertEqual(ftp.files['hozoryar/php/config.php'], b'private config')
        self.assertEqual(ftp.files['hozoryar/rollback/100-1/.htaccess'], b'old rules')
        self.assertIn(b'/releases/' + b'a' * 40, ftp.files['public_html/index.php'])
        self.assertIn(b'HOZORYAR_CONFIG', ftp.files['public_html/index.php'])
        self.assertEqual([target for _, target in ftp.renames],
                         ['public_html/.htaccess', 'public_html/index.php', 'public_html/hozoryar-version.json'])

    def test_corrupt_stage_never_switches_live_entry(self):
        ftp = FakeFTP()
        previous = ftp.files['public_html/index.php']
        ftp.corrupt = True
        with self.assertRaisesRegex(RuntimeError, 'checksum'):
            deploy.publish(ftp, {'public_html/.htaccess': b'new'}, 'a' * 40, '100-1')
        self.assertEqual(ftp.files['public_html/index.php'], previous)
        self.assertEqual(ftp.renames, [])

    def test_wrong_instance_and_injected_identifiers_are_rejected(self):
        ftp = FakeFTP()
        ftp.files['hozoryar/.hozoryar-instance'] = b'ANOTHER_APP'
        with self.assertRaisesRegex(RuntimeError, 'another application'):
            deploy.publish(ftp, {}, 'a' * 40, '100-1')
        for commit, run in [('bad', '100'), ('a' * 40, '../public_html')]:
            with self.assertRaises(ValueError): deploy.publish(FakeFTP(), {}, commit, run)

    def test_certificate_drift_is_rejected_before_login(self):
        client = MagicMock()
        client.sock.getpeercert.return_value = b'different certificate'
        with patch.object(deploy, 'FTP_TLS', return_value=client):
            with self.assertRaisesRegex(RuntimeError, 'certificate differs'):
                deploy.connect('account', 'secret')
        client.login.assert_not_called()


if __name__ == '__main__':
    unittest.main()
