<?php
declare(strict_types=1);
require_once __DIR__ . '/Db.php';

final class Auth {
    public static function current(): ?array {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/^Bearer ([A-Za-z0-9_-]{32,128})$/', $header, $match)) return null;
        $row = Db::one('SELECT u.id,u.name,u.role,u.company_id,c.name company_name,c.subscription_end,c.max_personnel
            FROM sessions s JOIN users u ON u.id=s.user_id AND u.company_id=s.company_id
            JOIN companies c ON c.id=u.company_id
            WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND u.active=1 AND c.active=1',
            [hash('sha256', $match[1])]);
        return $row ?: null;
    }

    public static function login(string $company, string $username, string $password): ?array {
        $key = hash('sha256', $company . "\n" . $username . "\n" . ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
        $rate = Db::one('SELECT failures,window_start,blocked_until FROM login_limits WHERE login_key=?', [$key]);
        if ($rate && $rate['blocked_until'] !== null && strtotime($rate['blocked_until'] . ' UTC') > time())
            throw new DomainException('too_many_attempts');
        $user = Db::one('SELECT u.id,u.company_id,u.name,u.role,u.password_hash,c.name company_name
            FROM users u JOIN companies c ON c.id=u.company_id
            WHERE c.slug=? AND u.username=? AND u.active=1 AND c.active=1', [$company, $username]);
        if (!$user || !password_verify($password, $user['password_hash'])) {
            Db::run('INSERT INTO login_limits(login_key,failures,window_start,blocked_until)
                VALUES(?,1,UTC_TIMESTAMP(),NULL)
                ON DUPLICATE KEY UPDATE
                  failures=IF(window_start<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),1,failures+1),
                  blocked_until=IF(window_start<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),NULL,
                    IF(failures>=5,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),blocked_until)),
                  window_start=IF(window_start<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),UTC_TIMESTAMP(),window_start)', [$key]);
            return null;
        }
        Db::run('DELETE FROM login_limits WHERE login_key=?', [$key]);
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        Db::run('INSERT INTO sessions(token_hash,company_id,user_id,expires_at) VALUES(?,?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 12 HOUR))',
            [hash('sha256', $token), $user['company_id'], $user['id']]);
        unset($user['password_hash']);
        return ['token' => $token, 'user' => $user];
    }

    public static function logout(): void {
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (preg_match('/^Bearer ([A-Za-z0-9_-]{32,128})$/', $header, $match))
            Db::run('DELETE FROM sessions WHERE token_hash=?', [hash('sha256', $match[1])]);
    }
}
