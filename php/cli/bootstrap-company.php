<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require_once dirname(__DIR__) . '/lib/Db.php';

$slug = getenv('HOZORYAR_COMPANY_SLUG') ?: '';
$name = getenv('HOZORYAR_COMPANY_NAME') ?: '';
$username = getenv('HOZORYAR_OWNER_USERNAME') ?: '';
$owner = getenv('HOZORYAR_OWNER_NAME') ?: '';
$password = getenv('HOZORYAR_OWNER_PASSWORD') ?: '';
if (!preg_match('/^[a-z0-9][a-z0-9-]{1,59}$/', $slug) ||
    $name === '' || mb_strlen($name) > 160 ||
    !preg_match('/^[a-zA-Z0-9_.-]{3,60}$/', $username) ||
    $owner === '' || mb_strlen($owner) > 160 || strlen($password) < 12) {
    fwrite(STDERR, "Required HOZORYAR_COMPANY_SLUG, COMPANY_NAME, OWNER_USERNAME, OWNER_NAME, OWNER_PASSWORD (12+ characters).\n");
    exit(1);
}

$pdo = Db::pdo();
$pdo->beginTransaction();
try {
    $exists = Db::one('SELECT id FROM companies WHERE slug=?', [$slug]);
    if ($exists) throw new RuntimeException('Company slug already exists');
    $stmt = $pdo->prepare('INSERT INTO companies(name,slug) VALUES(?,?)');
    $stmt->execute([$name, $slug]);
    $id = (int)$pdo->lastInsertId();
    Db::run('INSERT INTO company_settings(company_id,features_json) VALUES(?,?)',
        [$id, json_encode(['attendance'=>true,'shifts'=>true,'liveMap'=>true,'monitoring'=>true,'sms'=>false])]);
    Db::run("INSERT INTO users(company_id,name,username,password_hash,role) VALUES(?,?,?,?,'owner')",
        [$id, $owner, $username, password_hash($password, PASSWORD_DEFAULT)]);
    $pdo->commit();
    echo "Hozoryar company and owner initialized.\n";
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, "Bootstrap failed: " . $e->getMessage() . "\n");
    exit(1);
}
