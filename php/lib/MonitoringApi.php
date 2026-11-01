<?php
declare(strict_types=1);
require_once __DIR__ . '/PersonnelApi.php';

final class MonitoringApi {
    private static function feature(array $user,string $key): array {
        $s=PersonnelApi::settings((int)$user['company_id']);
        if(empty($s['features'][$key]))respond(403,['error'=>'این قابلیت برای شرکت فعال نیست']);
        return $s;
    }
    private static function admin(array $user): void {if($user['role']==='employee')respond(403,['error'=>'دسترسی مدیریتی لازم است']);}
    private static function coords($lat,$lng,$accuracy): bool {
        return (is_int($lat)||is_float($lat))&&(is_int($lng)||is_float($lng))&&abs($lat)<=90&&abs($lng)<=180&&
          ($accuracy===null||(is_int($accuracy)||is_float($accuracy))&&$accuracy>=0&&$accuracy<=10000);
    }
    private static function target(array $user): int {
        $input=$_GET['user_id']??null;
        if(!is_string($input)||!ctype_digit($input))respond(400,['error'=>'شناسه کارمند نامعتبر است']);
        $target=(int)$input;
        if(!Db::one('SELECT id FROM users WHERE company_id=? AND id=?',[$user['company_id'],$target]))respond(404,['error'=>'کارمند یافت نشد']);
        return $target;
    }
    public static function handle(string $path,string $method,array $user): bool {
        $cid=(int)$user['company_id'];$uid=(int)$user['id'];
        if($path==='/api/location'&&$method==='POST'){
            self::feature($user,'monitoring');$b=jsonBody();
            if(!self::coords($b['lat']??null,$b['lng']??null,$b['accuracy']??null))respond(400,['error'=>'مختصات نامعتبر است']);
            if(!Db::one('SELECT id FROM attendance WHERE company_id=? AND user_id=? AND checked_out_at IS NULL',[$cid,$uid]))
                respond(403,['error'=>'ثبت موقعیت فقط در حضور فعال مجاز است']);
            $at=gmdate('Y-m-d\TH:i:s').'.000Z';
            $pdo=Db::pdo();$pdo->beginTransaction();
            try{
                Db::run('INSERT INTO locations(company_id,user_id,lat,lng,accuracy,recorded_at) VALUES(?,?,?,?,?,?)
                  ON DUPLICATE KEY UPDATE lat=VALUES(lat),lng=VALUES(lng),accuracy=VALUES(accuracy),recorded_at=VALUES(recorded_at)',
                  [$cid,$uid,$b['lat'],$b['lng'],$b['accuracy']??null,$at]);
                Db::run('INSERT INTO location_history(company_id,user_id,lat,lng,accuracy,recorded_at) VALUES(?,?,?,?,?,?)',
                  [$cid,$uid,$b['lat'],$b['lng'],$b['accuracy']??null,$at]);
                Db::run('DELETE FROM location_history WHERE company_id=? AND recorded_at < ?',[$cid,gmdate('Y-m-d\TH:i:s',time()-30*86400).'.000Z']);
                $pdo->commit();respond(200,['ok'=>true]);
            }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        }
        if($path==='/api/location-history'&&$method==='GET'){
            self::admin($user);self::feature($user,'monitoring');$target=self::target($user);
            respond(200,['items'=>Db::all('SELECT lat,lng,accuracy,recorded_at FROM location_history WHERE company_id=? AND user_id=? ORDER BY id DESC LIMIT 250',[$cid,$target]),'retention_days'=>30]);
        }
        if($path==='/api/monitoring/event'&&$method==='POST'){
            self::feature($user,'monitoring');$b=jsonBody();
            if(!in_array($b['kind']??null,['gps_off','gps_on','internet_off','internet_on'],true))respond(400,['error'=>'نوع رویداد نامعتبر است']);
            $active=Db::one('SELECT id FROM attendance WHERE company_id=? AND user_id=? AND checked_out_at IS NULL',[$cid,$uid]);
            if(!$active)respond(403,['error'=>'رویداد فقط در حضور فعال مجاز است']);
            Db::run('INSERT INTO monitoring_events(company_id,user_id,attendance_id,kind,recorded_at) VALUES(?,?,?,?,?)',
              [$cid,$uid,$active['id'],$b['kind'],gmdate('Y-m-d\TH:i:s').'.000Z']);
            respond(201,['id'=>(int)Db::pdo()->lastInsertId(),'evidence_only'=>true]);
        }
        if($path==='/api/monitoring/events'&&$method==='GET'){
            self::admin($user);self::feature($user,'monitoring');$target=self::target($user);
            respond(200,['items'=>Db::all('SELECT kind,recorded_at,attendance_id FROM monitoring_events WHERE company_id=? AND user_id=? ORDER BY id DESC LIMIT 250',[$cid,$target]),'evidence_only'=>true]);
        }
        if($path==='/api/live-map'&&$method==='GET'){
            self::admin($user);$s=self::feature($user,'liveMap');
            $fresh=gmdate('Y-m-d\TH:i:s',time()-3600).'.000Z';
            $rows=Db::all('SELECT u.id,u.name,l.lat,l.lng,l.accuracy,l.recorded_at FROM locations l
                JOIN users u ON u.id=l.user_id AND u.company_id=l.company_id
                JOIN attendance a ON a.user_id=l.user_id AND a.company_id=l.company_id AND a.checked_out_at IS NULL
                WHERE l.company_id=? AND u.active=1 AND l.recorded_at>=? ORDER BY u.name',[$cid,$fresh]);
            respond(200,['provider'=>$s['map_provider'],'items'=>$rows]);
        }
        if($path==='/api/neshan-tiles/config'&&$method==='GET'){
            self::admin($user);$s=self::feature($user,'liveMap');
            respond(200,['enabled'=>$s['map_provider']==='neshan'&&!empty($s['neshan_api_key']),'tiles'=>'/api/neshan-tiles/{z}/{x}/{y}']);
        }
        if(preg_match('#^/api/neshan-tiles/(\d{1,2})/(\d{1,9})/(\d{1,9})$#',$path,$m)&&$method==='GET'){
            self::admin($user);$s=self::feature($user,'liveMap');
            $z=(int)$m[1];$x=(int)$m[2];$y=(int)$m[3];
            if($s['map_provider']!=='neshan'||empty($s['neshan_api_key'])||$z>19||$x>=2**$z||$y>=2**$z)
                respond(404,['error'=>'نقشه نشان فعال نیست']);
            if(!function_exists('curl_init'))respond(503,['error'=>'افزونه curl روی هاست فعال نیست']);
            $ch=curl_init("https://api.neshan.org/v1/tiles/$z/$x/$y");
            curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>7,
                CURLOPT_FOLLOWLOCATION=>false,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,
                CURLOPT_HTTPHEADER=>['Api-Key: '.$s['neshan_api_key']]]);
            $data=curl_exec($ch);$status=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE);$type=(string)curl_getinfo($ch,CURLINFO_CONTENT_TYPE);curl_close($ch);
            if($status!==200||!is_string($data)||strlen($data)>300000||!str_starts_with($type,'image/'))respond(502,['error'=>'دریافت نقشه ناموفق بود']);
            header('Content-Type: '.$type);header('Cache-Control: private, max-age=300');echo $data;exit;
        }
        if($path==='/api/sms/send'&&$method==='POST'){
            if($user['role']!=='owner')respond(403,['error'=>'فقط مدیر شرکت مجاز است']);
            $s=self::feature($user,'sms');$b=jsonBody();
            if($s['sms_provider']!=='kavenegar'||empty($s['sms_api_key']))respond(409,['error'=>'سرویس پیامک تنظیم نشده است']);
            if(!is_string($b['mobile']??null)||!preg_match('/^09\d{9}$/',$b['mobile'])||
                !is_string($b['message']??null)||trim($b['message'])===''||mb_strlen($b['message'])>300)respond(400,['error'=>'شماره یا متن نامعتبر است']);
            if(!function_exists('curl_init'))respond(503,['error'=>'افزونه curl روی هاست فعال نیست']);
            $key=rawurlencode($s['sms_api_key']);$ch=curl_init('https://api.kavenegar.com/v1/'.$key.'/sms/send.json');
            curl_setopt_array($ch,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>http_build_query(['receptor'=>$b['mobile'],'message'=>$b['message']]),
                CURLOPT_HTTPHEADER=>['Content-Type: application/x-www-form-urlencoded'],CURLOPT_RETURNTRANSFER=>true,
                CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>10,CURLOPT_FOLLOWLOCATION=>false,
                CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2]);
            $reply=curl_exec($ch);$http=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE);curl_close($ch);
            $json=is_string($reply)?json_decode($reply,true):null;
            if($http!==200||!is_array($json)||($json['return']['status']??null)!==200)respond(502,['error'=>'ارسال پیامک تأیید نشد']);
            Db::run('INSERT INTO audit_logs(company_id,actor_user_id,action,target_type,target_id) VALUES(?,?,?,?,?)',[$cid,$uid,'sms.send','company',$cid]);
            respond(200,['ok'=>true]);
        }
        return false;
    }
}
