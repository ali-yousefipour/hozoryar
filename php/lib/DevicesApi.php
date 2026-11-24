<?php
declare(strict_types=1);
require_once __DIR__ . '/AttendanceApi.php';

final class DevicesApi {
    public static function manage(string $path, string $method, array $user): bool {
        if ($path !== '/api/attendance-devices' &&
            !preg_match('#^/api/attendance-devices/(\d+)$#D', $path, $match)) return false;
        if ($user['role'] !== 'owner') respond(403, ['error'=>'دسترسی مدیر شرکت لازم است']);
        $cid = (int)$user['company_id'];
        $id = isset($match[1]) ? (int)$match[1] : null;

        if ($id === null && $method === 'GET') {
            respond(200, ['items'=>Db::all(
                'SELECT id,zone_id,name,model,ip_address,port,enabled,last_seen_at
                 FROM attendance_devices WHERE company_id=? ORDER BY name,id', [$cid]
            )]);
        }
        if ($id === null && $method === 'POST') {
            $body = jsonBody();
            $zone = $body['zone_id'] ?? null;
            $name = self::field($body, 'name', 100);
            $model = self::field($body, 'model', 100);
            $ip = self::field($body, 'ip_address', 45);
            $port = $body['port'] ?? null;
            if (!is_int($zone) || $zone < 1 || $name === null ||
                ($ip !== null && filter_var($ip, FILTER_VALIDATE_IP) === false) ||
                ($port !== null && (!is_int($port) || $port < 1 || $port > 65535))) {
                respond(400, ['error'=>'اطلاعات دستگاه معتبر نیست']);
            }
            $key = bin2hex(random_bytes(32));
            $pdo = Db::pdo();
            $pdo->beginTransaction();
            try {
                Db::one('SELECT id FROM companies WHERE id=? FOR UPDATE', [$cid]);
                if (!Db::one('SELECT id FROM zones WHERE company_id=? AND id=?', [$cid,$zone])) {
                    $pdo->rollBack();
                    respond(404, ['error'=>'محل کار یافت نشد']);
                }
                if (Db::one('SELECT id FROM attendance_devices WHERE company_id=? AND zone_id=? AND name=?', [$cid,$zone,$name])) {
                    $pdo->rollBack();
                    respond(409, ['error'=>'نام دستگاه در این محل کار تکراری است']);
                }
                Db::run(
                    'INSERT INTO attendance_devices(company_id,zone_id,name,model,ip_address,port,token_hash)
                     VALUES(?,?,?,?,?,?,?)', [$cid,$zone,$name,$model,$ip,$port,hash('sha256',$key)]
                );
                $id = (int)$pdo->lastInsertId();
                self::audit($user, $id, 'device.create');
                $pdo->commit();
            } catch (Throwable $error) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $error;
            }
            respond(201, ['id'=>$id,'key'=>$key]);
        }
        if ($id !== null && $method === 'PATCH') {
            $body = jsonBody();
            $enabled = $body['enabled'] ?? null;
            $rotate = ($body['rotate_key'] ?? false) === true;
            if (!$rotate && !is_bool($enabled)) respond(400, ['error'=>'عملیات دستگاه نامعتبر است']);
            $pdo = Db::pdo();
            $pdo->beginTransaction();
            try {
                Db::one('SELECT id FROM companies WHERE id=? FOR UPDATE', [$cid]);
                if (!Db::one('SELECT id FROM attendance_devices WHERE company_id=? AND id=?', [$cid,$id])) {
                    $pdo->rollBack();
                    respond(404, ['error'=>'دستگاه یافت نشد']);
                }
                $result = ['ok'=>true];
                if ($rotate) {
                    $key = bin2hex(random_bytes(32));
                    Db::run('UPDATE attendance_devices SET token_hash=?,last_seen_at=NULL WHERE company_id=? AND id=?',
                        [hash('sha256',$key),$cid,$id]);
                    $result['key'] = $key;
                    self::audit($user, $id, 'device.rotate_key');
                } else {
                    Db::run('UPDATE attendance_devices SET enabled=?,last_seen_at=NULL WHERE company_id=? AND id=?',
                        [(int)$enabled,$cid,$id]);
                    self::audit($user, $id, $enabled ? 'device.enable' : 'device.disable');
                }
                $pdo->commit();
            } catch (Throwable $error) {
                if ($pdo->inTransaction()) $pdo->rollBack();
                throw $error;
            }
            respond(200, $result);
        }
        respond(405, ['error'=>'روش درخواست پشتیبانی نمی‌شود']);
    }

    public static function relay(string $path, string $method): bool {
        if (!preg_match('#^/api/device-relay/(\d+)$#D', $path, $match)) return false;
        if ($method !== 'POST') respond(405, ['error'=>'روش درخواست پشتیبانی نمی‌شود']);
        $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/^Bearer ([a-f0-9]{64})$/D', $header, $auth)) self::unauthorized();
        $device = Db::one(
            'SELECT d.id,d.company_id,d.zone_id,d.token_hash,d.enabled,c.subscription_end
             FROM attendance_devices d JOIN companies c ON c.id=d.company_id WHERE d.id=?', [(int)$match[1]]
        );
        $tokenHash = hash('sha256', $auth[1]);
        if (!$device || !$device['enabled'] || !hash_equals($device['token_hash'], $tokenHash)) self::unauthorized();
        if (self::expired($device['subscription_end'])) respond(402, ['error'=>'اشتراک شرکت به پایان رسیده است']);

        $body = jsonBody();
        if (($body['action'] ?? null) === 'ping') {
            $changed = Db::run(
                'UPDATE attendance_devices SET last_seen_at=UTC_TIMESTAMP()
                 WHERE id=? AND token_hash=? AND enabled=1', [$device['id'],$tokenHash]
            );
            if (!$changed) self::verify($device);
            respond(200, ['ok'=>true]);
        }
        $username = self::field($body, 'username', 60);
        $event = $body['event_id'] ?? null;
        if ($username === null || !is_string($event) || !preg_match('/^[a-zA-Z0-9_-]{1,64}$/D', $event)) {
            respond(400, ['error'=>'نام کاربری و شناسه رویداد دستگاه لازم است']);
        }
        $user = Db::one('SELECT id,company_id FROM users WHERE company_id=? AND zone_id=? AND username=? AND active=1',
            [$device['company_id'],$device['zone_id'],$username]);
        if (!$user) respond(404, ['error'=>'کاربر فعال در محل کار دستگاه یافت نشد']);

        AttendanceApi::handle('/api/attendance', 'POST', $user, [
            'action'=>$body['action'] ?? null,
            'event_id'=>hash('sha256', 'device:'.$device['id'].':'.$event),
        ], $device);
        return true;
    }

    public static function verify(array $device, ?int $userId = null): void {
        $current = Db::one(
            'SELECT d.enabled,d.token_hash,c.subscription_end FROM attendance_devices d
             JOIN companies c ON c.id=d.company_id WHERE d.company_id=? AND d.id=?',
            [$device['company_id'],$device['id']]
        );
        if (!$current || !$current['enabled'] || !hash_equals($current['token_hash'], $device['token_hash'])) self::unauthorized();
        if (self::expired($current['subscription_end'])) respond(402, ['error'=>'اشتراک شرکت به پایان رسیده است']);
        if ($userId !== null && !Db::one(
            'SELECT id FROM users WHERE company_id=? AND id=? AND zone_id=? AND active=1',
            [$device['company_id'],$userId,$device['zone_id']]
        )) respond(404, ['error'=>'کاربر فعال در محل کار دستگاه یافت نشد']);
    }

    private static function expired(?string $date): bool {
        return $date !== null && $date < gmdate('Y-m-d', time()+12600);
    }

    private static function unauthorized(): never {
        respond(401, ['error'=>'کلید اتصال دستگاه معتبر نیست']);
    }

    private static function field(array $body, string $key, int $max): ?string {
        $value = $body[$key] ?? '';
        if (!is_string($value) || mb_strlen($value) > $max) respond(400, ['error'=>'اطلاعات دستگاه معتبر نیست']);
        $value = trim($value);
        return $value === '' ? null : $value;
    }

    private static function audit(array $user, int $id, string $action): void {
        Db::run('INSERT INTO audit_logs(company_id,actor_user_id,action,target_type,target_id) VALUES(?,?,?,?,?)',
            [$user['company_id'],$user['id'],$action,'attendance_device',$id]);
    }
}
