<?php
declare(strict_types=1);
require_once __DIR__ . '/Db.php';

final class PersonnelApi {
    private static function admin(array $user): void {
        if ($user['role'] === 'employee') respond(403, ['error'=>'دسترسی مدیریتی لازم است']);
    }
    private static function owner(array $user): void {
        if ($user['role'] !== 'owner') respond(403, ['error'=>'فقط مدیر شرکت مجاز است']);
    }
    private static function audit(array $user, string $action, string $type, ?int $id = null): void {
        Db::run('INSERT INTO audit_logs(company_id,actor_user_id,action,target_type,target_id) VALUES(?,?,?,?,?)',
            [$user['company_id'],$user['id'],$action,$type,$id]);
    }
    public static function settings(int $companyId): array {
        $s=Db::one('SELECT * FROM company_settings WHERE company_id=?', [$companyId]);
        if (!$s) throw new RuntimeException('Company settings missing');
        $s['features']=json_decode($s['features_json'],true,512,JSON_THROW_ON_ERROR);
        return $s;
    }
    public static function handle(string $path,string $method,array $user): bool {
        $cid=(int)$user['company_id'];
        if ($path==='/api/users' && $method==='GET') {
            self::admin($user);
            respond(200,['items'=>Db::all('SELECT id,name,username,role,active,zone_id,can_be_substitute FROM users WHERE company_id=? ORDER BY id DESC',[$cid])]);
        }
        if ($path==='/api/users' && $method==='POST') {
            self::owner($user);$b=jsonBody();
            if (!is_string($b['name']??null)||trim($b['name'])===''||mb_strlen($b['name'])>120||
                !is_string($b['username']??null)||trim($b['username'])===''||strlen($b['username'])>60||
                !is_string($b['password']??null)||strlen($b['password'])<12||strlen($b['password'])>200||
                !in_array($b['role']??null,['employee','manager'],true)) respond(400,['error'=>'اطلاعات کارمند نامعتبر است']);
            $pdo=Db::pdo();$pdo->beginTransaction();
            try {
                $company=Db::one('SELECT max_personnel FROM companies WHERE id=? FOR UPDATE',[$cid]);
                $count=Db::one('SELECT COUNT(*) n FROM users WHERE company_id=? AND active=1',[$cid]);
                if ($company['max_personnel']!==null&&(int)$count['n']>=(int)$company['max_personnel']) {
                    $pdo->rollBack();respond(409,['error'=>'ظرفیت پرسنل شرکت تکمیل است']);
                }
                Db::run('INSERT INTO users(company_id,name,username,password_hash,role) VALUES(?,?,?,?,?)',
                    [$cid,trim($b['name']),trim($b['username']),password_hash($b['password'],PASSWORD_DEFAULT),$b['role']]);
                $id=(int)$pdo->lastInsertId();self::audit($user,'user.create','user',$id);
                $pdo->commit();respond(201,['id'=>$id]);
            } catch (Throwable $e) { if ($pdo->inTransaction()) $pdo->rollBack();throw $e; }
        }
        if ($path==='/api/zones'&&$method==='GET') {
            self::admin($user);respond(200,['items'=>Db::all('SELECT id,name,requires_substitute FROM zones WHERE company_id=? ORDER BY name',[$cid])]);
        }
        if ($path==='/api/zones'&&$method==='POST') {
            self::owner($user);$b=jsonBody();
            if (!is_string($b['name']??null)||trim($b['name'])===''||mb_strlen($b['name'])>100||!is_bool($b['requires_substitute']??null))
                respond(400,['error'=>'اطلاعات منطقه نامعتبر است']);
            if (Db::one('SELECT id FROM zones WHERE company_id=? AND name=?',[$cid,trim($b['name'])])) respond(409,['error'=>'منطقه تکراری است']);
            Db::run('INSERT INTO zones(company_id,name,requires_substitute) VALUES(?,?,?)',[$cid,trim($b['name']),(int)$b['requires_substitute']]);
            $id=(int)Db::pdo()->lastInsertId();self::audit($user,'zone.create','zone',$id);respond(201,['id'=>$id]);
        }
        if (preg_match('#^/api/zones/(\d+)$#',$path,$m)&&$method==='PATCH') {
            self::owner($user);$b=jsonBody();if(!is_bool($b['requires_substitute']??null))respond(400,['error'=>'سیاست منطقه نامعتبر است']);
            if (!Db::one('SELECT id FROM zones WHERE company_id=? AND id=?',[$cid,(int)$m[1]]))respond(404,['error'=>'منطقه یافت نشد']);
            Db::run('UPDATE zones SET requires_substitute=? WHERE company_id=? AND id=?',[(int)$b['requires_substitute'],$cid,(int)$m[1]]);
            self::audit($user,'zone.policy','zone',(int)$m[1]);respond(200,['ok'=>true]);
        }
        if (preg_match('#^/api/users/(\d+)/zone$#',$path,$m)&&$method==='PATCH') {
            self::owner($user);$b=jsonBody();$uid=(int)$m[1];
            if (!Db::one('SELECT id FROM users WHERE id=? AND company_id=?',[$uid,$cid]))respond(404,['error'=>'کارمند یافت نشد']);
            if (!array_key_exists('zone_id',$b)||($b['zone_id']!==null&&!is_int($b['zone_id']))||!is_bool($b['can_be_substitute']??null))respond(400,['error'=>'اطلاعات تخصیص نامعتبر است']);
            if ($b['zone_id']!==null&&!Db::one('SELECT id FROM zones WHERE id=? AND company_id=?',[$b['zone_id'],$cid]))respond(404,['error'=>'منطقه در شرکت یافت نشد']);
            Db::run('UPDATE users SET zone_id=?,can_be_substitute=? WHERE company_id=? AND id=?',[$b['zone_id'],(int)$b['can_be_substitute'],$cid,$uid]);
            self::audit($user,'user.zone','user',$uid);respond(200,['ok'=>true]);
        }
        if ($path==='/api/settings'&&$method==='GET') {
            self::owner($user);$s=self::settings($cid);
            respond(200,['map_provider'=>$s['map_provider'],'sms_provider'=>$s['sms_provider'],
                'require_location'=>(bool)$s['require_location'],'enforce_shift_window'=>(bool)$s['enforce_shift_window'],
                'geofence_lat'=>$s['geofence_lat']===null?null:(float)$s['geofence_lat'],
                'geofence_lng'=>$s['geofence_lng']===null?null:(float)$s['geofence_lng'],
                'geofence_radius_m'=>(int)$s['geofence_radius_m'],'approval_steps'=>(int)$s['approval_steps'],
                'annual_leave_minutes'=>(int)$s['annual_leave_minutes'],'features'=>$s['features'],
                'neshan_key_configured'=>!empty($s['neshan_api_key']),'sms_key_configured'=>!empty($s['sms_api_key'])]);
        }
        if ($path==='/api/settings'&&$method==='PATCH') {
            self::owner($user);$b=jsonBody();$s=self::settings($cid);
            $enums=['map_provider'=>['osm','neshan'],'sms_provider'=>['disabled','kavenegar']];
            foreach($enums as $key=>$values)if(isset($b[$key])&&!in_array($b[$key],$values,true))respond(400,['error'=>'گزینه تنظیمات نامعتبر است']);
            foreach(['neshan_api_key','sms_api_key'] as $key)if(array_key_exists($key,$b)&&(!is_string($b[$key])||strlen($b[$key])>200))respond(400,['error'=>'کلید سرویس نامعتبر است']);
            foreach(['require_location','enforce_shift_window'] as $key)if(isset($b[$key])&&!is_bool($b[$key]))respond(400,['error'=>'سیاست ورود نامعتبر است']);
            foreach(['geofence_lat'=>90,'geofence_lng'=>180] as $key=>$bound)if(isset($b[$key])&&(!is_numeric($b[$key])||abs((float)$b[$key])>$bound))respond(400,['error'=>'مختصات نامعتبر است']);
            foreach(['geofence_radius_m'=>[50,50000],'approval_steps'=>[1,2],'annual_leave_minutes'=>[0,525600]] as $key=>$bounds)
                if(isset($b[$key])&&(!is_int($b[$key])||$b[$key]<$bounds[0]||$b[$key]>$bounds[1]))respond(400,['error'=>'مقدار تنظیمات نامعتبر است']);
            if(isset($b['features'])){
                if(!is_array($b['features'])||array_is_list($b['features']))respond(400,['error'=>'امکانات نامعتبر است']);
                foreach($b['features'] as $key=>$v)if(!in_array($key,['liveMap','attendance','monitoring','shifts','sms'],true)||!is_bool($v))respond(400,['error'=>'امکانات نامعتبر است']);
            }
            $keys=['map_provider','neshan_api_key','sms_provider','sms_api_key','require_location','enforce_shift_window','geofence_lat','geofence_lng','geofence_radius_m','approval_steps','annual_leave_minutes'];
            $update=[];$params=[];
            foreach($keys as $key)if(array_key_exists($key,$b)){$update[]="$key=?";$params[]=is_bool($b[$key])?(int)$b[$key]:$b[$key];}
            if(array_key_exists('features',$b)){$update[]='features_json=?';$params[]=json_encode(array_replace($s['features'],$b['features']));}
            if($update){$params[]=$cid;Db::run('UPDATE company_settings SET '.implode(',',$update).' WHERE company_id=?',$params);}
            self::audit($user,'settings.update','company',$cid);respond(200,['ok'=>true]);
        }
        return false;
    }
}
