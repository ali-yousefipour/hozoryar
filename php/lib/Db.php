<?php
declare(strict_types=1);

final class Db {
    private static ?PDO $pdo = null;

    public static function pdo(): PDO {
        if (self::$pdo instanceof PDO) return self::$pdo;
        $file = dirname(__DIR__) . '/config.php';
        if (!is_file($file)) throw new RuntimeException('Server database configuration is missing');
        $c = require $file;
        foreach (['db_host', 'db_name', 'db_user', 'db_pass'] as $key) {
            if (!isset($c[$key]) || !is_string($c[$key])) throw new RuntimeException('Invalid database configuration');
        }
        if ($c['db_name'] === '' || $c['db_user'] === '') throw new RuntimeException('Database is not configured');
        $dsn = 'mysql:host=' . $c['db_host'] . ';dbname=' . $c['db_name'] . ';charset=utf8mb4';
        $pdo = new PDO($dsn, $c['db_user'], $c['db_pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $pdo->exec("SET SESSION time_zone = '+03:30'");
        self::$pdo = $pdo;
        return $pdo;
    }

    public static function one(string $sql, array $params = []): ?array {
        $stmt = self::pdo()->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    public static function all(string $sql, array $params = []): array {
        $stmt = self::pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public static function run(string $sql, array $params = []): int {
        $stmt = self::pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount();
    }
}
