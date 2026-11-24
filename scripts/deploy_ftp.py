"""Verified, versioned Hozoryar deployment; configuration and old releases survive."""
from ftplib import FTP_TLS, error_perm
from hashlib import sha256
from pathlib import Path, PurePosixPath
import io
import json
import os
import re
import ssl
import sys
import zipfile

HOST = '2450773184.cloudylink.com'
PUBLIC = 'public_html'
PRIVATE = 'hozoryar'
CERT = Path(__file__).resolve().parents[1] / 'deploy/cloudylink-ftps.pem'


def payload(archive):
    files = {}
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            name = entry.filename
            path = PurePosixPath(name)
            if entry.is_dir():
                continue
            if path.is_absolute() or '..' in path.parts or '\\' in name:
                raise ValueError('Unsafe package path')
            if not name.startswith(('hozoryar/', 'public_html/')):
                continue  # INSTALL.md is an operator document, not a website file.
            if any(p in ('data', 'node_modules', '.git') for p in path.parts) or path.name in ('config.php', '.env'):
                raise ValueError('Private runtime data must never be packaged')
            files[name] = source.read(entry)
    for name in ('hozoryar/php/app/index.php', 'hozoryar/php/lib/Db.php', 'hozoryar/web/home.html', 'public_html/index.php', 'public_html/.htaccess'):
        if not files.get(name):
            raise ValueError('Incomplete deployment package: ' + name)
    return files


def connect(username, password):
    # This Cloudylink alias presents s387.bitcommand.com's self-signed certificate.
    # Trust that committed certificate, retain date/chain checks, then match its
    # complete DER fingerprint before sending credentials. No generic TLS bypass.
    context = ssl.create_default_context(cafile=str(CERT))
    context.check_hostname = False
    expected = sha256(ssl.PEM_cert_to_DER_cert(CERT.read_text(encoding='ascii'))).digest()
    ftp = FTP_TLS(context=context, timeout=45)
    try:
        ftp.connect(HOST, 21)
        ftp.auth()
        if sha256(ftp.sock.getpeercert(binary_form=True)).digest() != expected:
            raise RuntimeError('FTP certificate differs from the committed host pin')
        ftp.login(username, password)
        ftp.prot_p()
        ftp.set_pasv(True)
        return ftp
    except Exception:
        ftp.close()
        raise


def read(ftp, path, optional=False):
    result = io.BytesIO()
    try:
        ftp.retrbinary('RETR ' + path, result.write)
    except error_perm as error:
        if optional and str(error).startswith('550'):
            return None
        raise
    return result.getvalue()


def ensure_dir(ftp, path, known):
    current = ''
    for part in PurePosixPath(path).parts:
        current = current + '/' + part if current else part
        if current in known:
            continue
        try:
            ftp.mkd(current)
        except error_perm:
            previous = ftp.pwd()
            ftp.cwd(current)  # An existing directory is fine; an access denial isn't.
            ftp.cwd(previous)
        known.add(current)


def write_verified(ftp, path, content, known):
    ensure_dir(ftp, str(PurePosixPath(path).parent), known)
    ftp.storbinary('STOR ' + path, io.BytesIO(content), blocksize=65536)
    if sha256(read(ftp, path)).digest() != sha256(content).digest():
        raise RuntimeError('FTP readback checksum mismatch: ' + path)


def publish(ftp, files, commit, run_id):
    if not re.fullmatch(r'[0-9a-f]{40}', commit) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', run_id):
        raise ValueError('Invalid commit or deployment run identifier')
    # Never infer a different root or create a guessed public_html in a jailed account.
    root = ftp.pwd()
    ftp.cwd(PUBLIC)
    ftp.cwd(root)
    old_index = read(ftp, PUBLIC + '/index.php', optional=True)
    marker = read(ftp, PRIVATE + '/.hozoryar-instance', optional=True)
    if marker is not None and marker != b'HOZORYAR_DEPLOY_ROOT\n':
        raise RuntimeError('Destination marker belongs to another application')
    if marker is None and old_index is not None and b'hozoryar/php/app/index.php' not in old_index and b'HOZORYAR_RELEASE' not in old_index:
        raise RuntimeError('Existing public_html/index.php is not a Hozoryar entry point')
    if marker is None and read(ftp, PUBLIC + '/index.html', optional=True) is not None:
        raise RuntimeError('Review existing public_html/index.html before deploying Hozoryar')
    known = set()
    write_verified(ftp, PRIVATE + '/.htaccess', b'Require all denied\n', known)
    release = PRIVATE + '/releases/' + commit
    count = 0
    for name, content in sorted(files.items()):
        if name.startswith('hozoryar/'):
            write_verified(ftp, release + '/' + name.removeprefix('hozoryar/'), content, known)
            count += 1
    config_exists = read(ftp, PRIVATE + '/php/config.php', optional=True) is not None
    rollback = PRIVATE + '/rollback/' + run_id
    old_rules = read(ftp, PUBLIC + '/.htaccess', optional=True)
    old_version = read(ftp, PUBLIC + '/hozoryar-version.json', optional=True)
    for name, content in [('index.php', old_index), ('.htaccess', old_rules), ('hozoryar-version.json', old_version)]:
        if content is not None:
            write_verified(ftp, rollback + '/' + name, content, known)
    entry = ("<?php\ndeclare(strict_types=1);\n// HOZORYAR_RELEASE " + commit + "\n"
             "putenv('HOZORYAR_CONFIG=' . dirname(__DIR__) . '/hozoryar/php/config.php');\n"
             "require dirname(__DIR__) . '/" + release + "/php/app/index.php';\n").encode()
    # All application bytes are verified before switching the one public entry point.
    for name, content in [('.htaccess', files['public_html/.htaccess']), ('index.php', entry),
                          ('hozoryar-version.json', json.dumps({'service': 'hozoryar', 'commit': commit}).encode())]:
        staged = PRIVATE + '/.pending-' + run_id + '-' + name.lstrip('.')
        write_verified(ftp, staged, content, known)
        ftp.rename(staged, PUBLIC + '/' + name)
        if read(ftp, PUBLIC + '/' + name) != content:
            raise RuntimeError('Published entry readback mismatch: ' + name)
    write_verified(ftp, PRIVATE + '/.hozoryar-instance', b'HOZORYAR_DEPLOY_ROOT\n', known)
    record = {'commit': commit, 'release': release, 'rollback': rollback,
              'files_verified': count, 'database_config_present': config_exists,
              'database_migrations_run': False}
    write_verified(ftp, PRIVATE + '/.deploy-manifest.json', json.dumps(record, indent=2).encode(), known)
    return record


def main():
    username, password = os.environ.get('FTP_USER'), os.environ.get('FTP_PASS')
    if not username or not password:
        raise RuntimeError('GitHub secrets ftp and pass are required')
    files = payload(sys.argv[1] if len(sys.argv) > 1 else 'data/hozoryar-shared-host.zip')
    with connect(username, password) as ftp:
        record = publish(ftp, files, os.environ['GITHUB_SHA'],
                         os.environ['GITHUB_RUN_ID'] + '-' + os.environ.get('GITHUB_RUN_ATTEMPT', '1'))
    print(json.dumps(record, indent=2))
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as out:
            out.write('## Hozoryar FTP upload\n\n```json\n' + json.dumps(record, indent=2) + '\n```\n\n')
            out.write('Database configuration and migrations are managed separately. No remote files or old releases were deleted.\n')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Server replies may echo account names; do not print arbitrary FTP exceptions.
        print('Deployment failed (' + type(error).__name__ + '). Previous releases/configuration were preserved.', file=sys.stderr)
        if isinstance(error, (ValueError, RuntimeError)):
            print(str(error), file=sys.stderr)
        sys.exit(1)
