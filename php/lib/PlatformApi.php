<?php
declare(strict_types=1);
require_once __DIR__.'/Db.php';

final class PlatformApi {
    private static function token(): ?string {
        $header=$_SERVER['HTTP_AUTHORIZATION']??$_SERVER['REDIRECT_HTTP_AUTHORIZATION']??'';
        return preg_match('/^Bearer ([A-Za-z0-9_-]{32,128})$/',$header,$m)?$m[1]:null;
    }
    private static function current(): ?array {
        $token=self::token();if($token===null)return null;
        return Db::one('SELECT a.id,a.name,a.username FROM platform_sessions s JOIN platform_admins a ON a.id=s.admin_id
            WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND a.active=1',[hash('sha256',$token)]);
    }
    private static function day($value): bool {
        if(!is_string($value)||!preg_match('/^\d{4}-\d{2}-\d{2}$/',$value))return false;
        [$y,$m,$d]=array_map('intval',explode('-',$value));return checkdate($m,$d,$y);
    }
    public static function handle(string $path,string $method): bool {
        if(!str_starts_with($path,'/api/platform/'))return false;
        if($path==='/api/platform/login'&&$method==='POST'){
            $b=jsonBody();$username=$b['username']??null;$password=$b['password']??null;
            if(!is_string($username)||$username===''||strlen($username)>60||!is_string($password)||$password===''||strlen($password)>200)
                respond(400,['error'=>'اطلاعات ورود کامل نیست']);
            $key=hash('sha256',"platform\n".$username."\n".($_SERVER['REMOTE_ADDR']??'unknown'));
            $rate=Db::one('SELECT blocked_until FROM login_limits WHERE login_key=?',[$key]);
            if($rate&&$rate['blocked_until']!==null&&strtotime($rate['blocked_until'].' UTC')>time())
                respond(429,['error'=>'تلاش‌های ورود بیش از حد مجاز است']);
            $admin=Db::one('SELECT id,name,username,password_hash FROM platform_admins WHERE username=? AND active=1',[$username]);
            if(!$admin||!password_verify($password,$admin['password_hash'])){
                Db::run('INSERT INTO login_limits(login_key,failures,window_start,blocked_until) VALUES(?,1,UTC_TIMESTAMP(),NULL)
                    ON DUPLICATE KEY UPDATE failures=IF(window_start<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),1,failures+1),
                    blocked_until=IF(window_start<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),NULL,
                      IF(failures>=5,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),blocked_until)),
                    window_start=IF(window_start<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),UTC_TIMESTAMP(),window_start)',[$key]);
                respond(401,['error'=>'اطلاعات ورود صحیح نیست']);
            }
            Db::run('DELETE FROM login_limits WHERE login_key=?',[$key]);
            $token=rtrim(strtr(base64_encode(random_bytes(32)),'+/','-_'),'=');
            Db::run('INSERT INTO platform_sessions(token_hash,admin_id,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 12 HOUR))',
                [hash('sha256',$token),$admin['id']]);
            unset($admin['password_hash']);$admin['role']='platform_admin';
            respond(200,['token'=>$token,'user'=>$admin]);
        }
        $admin=self::current();if(!$admin)respond(401,['error'=>'ورود مدیر کل سامانه لازم است']);
        if($path==='/api/platform/me'&&$method==='GET')respond(200,['user'=>array_merge($admin,['role'=>'platform_admin'])]);
        if($path==='/api/platform/logout'&&$method==='POST'){
            Db::run('DELETE FROM platform_sessions WHERE token_hash=?',[hash('sha256',self::token())]);respond(200,['ok'=>true]);
        }
        if($path==='/api/platform/companies'&&$method==='GET')respond(200,['items'=>Db::all('SELECT c.id,c.name,c.slug,c.active,c.subscription_end,c.max_personnel,
            (SELECT COUNT(*) FROM users u WHERE u.company_id=c.id AND u.active=1) personnel_count
            FROM companies c ORDER BY c.id')]);
        if(preg_match('#^/api/platform/companies/(\d+)/subscription$#',$path,$m)&&$method==='PATCH'){
            $b=jsonBody();if(!$b||array_diff(array_keys($b),['subscription_end','max_personnel']))respond(400,['error'=>'تنظیمات نامعتبر است']);
            if(array_key_exists('subscription_end',$b)&&$b['subscription_end']!==null&&!self::day($b['subscription_end']))respond(400,['error'=>'تاریخ پایان اشتراک نامعتبر است']);
            if(array_key_exists('max_personnel',$b)&&$b['max_personnel']!==null&&(!is_int($b['max_personnel'])||$b['max_personnel']<1||$b['max_personnel']>1000000))respond(400,['error'=>'سقف پرسنل نامعتبر است']);
            $pdo=Db::pdo();$pdo->beginTransaction();
            try{
                $company=Db::one('SELECT subscription_end,max_personnel FROM companies WHERE id=? FOR UPDATE',[(int)$m[1]]);
                if(!$company){$pdo->rollBack();respond(404,['error'=>'شرکت یافت نشد']);}
                $count=(int)Db::one('SELECT COUNT(*) n FROM users WHERE company_id=? AND active=1',[(int)$m[1]])['n'];
                $cap=array_key_exists('max_personnel',$b)?$b['max_personnel']:$company['max_personnel'];
                if($cap!==null&&(int)$cap<$count){$pdo->rollBack();respond(409,['error'=>'سقف کمتر از تعداد '.$count.' کاربر فعال است']);}
                Db::run('UPDATE companies SET subscription_end=?,max_personnel=? WHERE id=?',
                    [array_key_exists('subscription_end',$b)?$b['subscription_end']:$company['subscription_end'],$cap,(int)$m[1]]);
                $pdo->commit();respond(200,['ok'=>true,'personnel_count'=>$count]);
            }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        }
        respond(404,['error'=>'مسیر مدیریت مرکزی یافت نشد']);
    }
}
