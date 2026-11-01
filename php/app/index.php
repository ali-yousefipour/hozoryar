<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/lib/Auth.php';
require_once dirname(__DIR__) . '/lib/PersonnelApi.php';
require_once dirname(__DIR__) . '/lib/AttendanceApi.php';
require_once dirname(__DIR__) . '/lib/ShiftApi.php';
require_once dirname(__DIR__) . '/lib/RequestsApi.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function respond(int $status, array $payload): never {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function jsonBody(): array {
    if (($_SERVER['CONTENT_LENGTH'] ?? 0) > 65536) respond(413, ['error' => 'حجم درخواست بیش از حد مجاز است']);
    $stream = fopen('php://input', 'rb');
    if ($stream === false) respond(400, ['error' => 'بدنه درخواست قابل خواندن نیست']);
    $raw = stream_get_contents($stream, 65537);
    fclose($stream);
    if ($raw === false || strlen($raw) > 65536) respond(413, ['error' => 'حجم درخواست بیش از حد مجاز است']);
    $data = json_decode($raw, true);
    if (!is_array($data) || array_is_list($data) && $data !== []) respond(400, ['error' => 'JSON نامعتبر است']);
    return $data;
}

try {
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($path === '/api/health' && $method === 'GET') respond(200, ['ok' => true, 'service' => 'hozoryar-php', 'stage' => 'auth-foundation']);
    if ($path === '/api/login' && $method === 'POST') {
        $body = jsonBody();
        $company = $body['company'] ?? null;
        $username = $body['username'] ?? null;
        $password = $body['password'] ?? null;
        if (!is_string($company) || !is_string($username) || !is_string($password) ||
            strlen($company) > 60 || strlen($username) > 60 || strlen($password) > 200 ||
            $company === '' || $username === '' || $password === '')
            respond(400, ['error' => 'اطلاعات ورود نامعتبر است']);
        try { $result = Auth::login($company, $username, $password); }
        catch (DomainException $e) { respond(429, ['error' => 'تلاش‌های ورود بیش از حد مجاز است؛ بعداً تلاش کنید']); }
        if (!$result) respond(401, ['error' => 'اطلاعات ورود صحیح نیست']);
        respond(200, $result);
    }
    if (str_starts_with($path, '/api/')) {
        $user = Auth::current();
        if (!$user) respond(401, ['error' => 'ورود معتبر لازم است']);
        if ($path === '/api/me' && $method === 'GET') {
            $settings=PersonnelApi::settings((int)$user['company_id']);
            $expired=$user['subscription_end']!==null && $user['subscription_end'] < gmdate('Y-m-d',time()+12600);
            respond(200, ['user' => $user, 'features' => $settings['features'],
                'subscription'=>['subscription_end'=>$user['subscription_end'], 'max_personnel'=>$user['max_personnel']===null?null:(int)$user['max_personnel'],'expired'=>$expired]]);
        }
        if ($path === '/api/logout' && $method === 'POST') { Auth::logout(); respond(200, ['ok' => true]); }
        $readOnly=$method==='GET';
        if (!$readOnly && $user['subscription_end']!==null && $user['subscription_end'] < gmdate('Y-m-d',time()+12600))
            respond(402,['error'=>'اشتراک شرکت به پایان رسیده است']);
        if (PersonnelApi::handle($path,$method,$user)) exit;
        if (AttendanceApi::handle($path,$method,$user)) exit;
        if (ShiftApi::handle($path,$method,$user)) exit;
        if (RequestsApi::handle($path,$method,$user)) exit;
        respond(501, ['error' => 'این قابلیت هنوز به نسخه PHP منتقل نشده است']);
    }
    respond(503, ['error' => 'رابط وب پس از تکمیل انتقال APIها در نسخه PHP فعال خواهد شد']);
} catch (Throwable $e) {
    error_log('hozoryar_php error=' . get_class($e));
    respond(500, ['error' => 'خطای داخلی سرور']);
}
