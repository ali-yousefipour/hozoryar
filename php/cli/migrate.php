<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once dirname(__DIR__) . '/lib/Db.php';

// MySQL DDL commits implicitly. Failed migrations require inspection, not an automatic retry.
$pdo = Db::pdo();
if (!(int)$pdo->query("SELECT GET_LOCK('hozoryar_schema_migrations', 10)")->fetchColumn()) {
    fwrite(STDERR, "Another migration process is running.\n"); exit(1);
}
try {
    $pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(120) PRIMARY KEY, checksum CHAR(64) NOT NULL,
        status VARCHAR(16) NOT NULL, applied_at DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
    $files = glob(dirname(__DIR__) . '/db/*.sql'); sort($files);
    foreach ($files as $file) {
        $name = basename($file); $hash = hash_file('sha256', $file);
        $row = Db::one('SELECT checksum,status FROM schema_migrations WHERE name=?', [$name]);
        if ($row) {
            if ($row['checksum'] !== $hash || $row['status'] !== 'applied') {
                throw new RuntimeException("Inspect incomplete or changed migration: $name");
            }
            echo "Already applied: $name\n"; continue;
        }
        // Refuse to guess whether a pre-existing manual installation already applied ALTER statements.
        if ($name === basename($files[0]) && $pdo->query("SHOW TABLES LIKE 'companies'")->fetchColumn()) {
            throw new RuntimeException('Existing untracked schema: use a new dedicated database or audit and baseline it manually.');
        }
        Db::run("INSERT INTO schema_migrations(name,checksum,status) VALUES(?,?,'started')", [$name,$hash]);
        $pdo->exec(file_get_contents($file));
        Db::run("UPDATE schema_migrations SET status='applied',applied_at=UTC_TIMESTAMP() WHERE name=?", [$name]);
        echo "Applied: $name\n";
    }
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n"); exit(1);
} finally {
    $pdo->query("SELECT RELEASE_LOCK('hozoryar_schema_migrations')");
}
