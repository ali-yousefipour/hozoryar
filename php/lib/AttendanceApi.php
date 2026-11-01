<?php
declare(strict_types=1);
require_once __DIR__ . '/PersonnelApi.php';

final class AttendanceApi {
    private static function coords($lat,$lng,$accuracy): bool {
        return is_numeric($lat)&&is_numeric($lng)&&abs((float)$lat)<=90&&abs((float)$lng)<=180&&
            ($accuracy===null||(is_numeric($accuracy)&&$accuracy>=0&&$accuracy<=10000));
    }
    private static function distance(float $a,float $b,float $c,float $d): float {
        $r=6371000.0;$lat=deg2rad($c-$a);$lng=deg2rad($d-$b);
        $h=sin($lat/2)**2+cos(deg2rad($a))*cos(deg2rad($c))*sin($lng/2)**2;
        return 2*$r*asin(min(1,sqrt($h)));
    }
    public static function handle(string $path,string $method,array $user): bool {
        if($path!=='/api/attendance')return false;
        $cid=(int)$user['company_id'];$uid=(int)$user['id'];
        $settings=PersonnelApi::settings($cid);
        if(empty($settings['features']['attendance']))respond(403,['error'=>'حضور و غیاب برای شرکت فعال نیست']);
        if($method==='GET'){
            $target=$uid;
            if(isset($_GET['user_id'])){
                if($user['role']==='employee')respond(403,['error'=>'دسترسی مدیریتی لازم است']);
                if(!is_string($_GET['user_id'])||!ctype_digit($_GET['user_id']))respond(400,['error'=>'شناسه کاربر نامعتبر است']);
                $target=(int)$_GET['user_id'];
                if(!Db::one('SELECT id FROM users WHERE company_id=? AND id=?',[$cid,$target]))respond(404,['error'=>'کارمند یافت نشد']);
            }
            respond(200,['items'=>Db::all('SELECT id,checked_in_at,checked_out_at,lat,lng FROM attendance WHERE company_id=? AND user_id=? ORDER BY id DESC LIMIT 100',[$cid,$target])]);
        }
        if($method!=='POST')return false;
        $b=jsonBody();$action=$b['action']??null;
        if(!in_array($action,['in','out'],true))respond(400,['error'=>'عملیات نامعتبر است']);
        $event=$b['event_id']??null;
        if($event!==null&&(!is_string($event)||!preg_match('/^[a-zA-Z0-9_-]{16,64}$/',$event)))respond(400,['error'=>'شناسه رویداد نامعتبر است']);
        // No bypass: a company that requires a shift gate must wait until its PHP gate is ported.
        // Idempotent replay is allowed even if the policy has changed since the original event.
        $pdo=Db::pdo();$pdo->beginTransaction();
        try {
            Db::one('SELECT id FROM users WHERE company_id=? AND id=? FOR UPDATE',[$cid,$uid]);
            if($event!==null){
                $prior=Db::one('SELECT action,attendance_id,recorded_at FROM attendance_events WHERE company_id=? AND user_id=? AND event_id=?',[$cid,$uid,$event]);
                if($prior){
                    if($prior['action']!==$action){$pdo->rollBack();respond(409,['error'=>'شناسه رویداد برای عملیات دیگری استفاده شده است']);}
                    $pdo->commit();respond(200,['id'=>(int)$prior['attendance_id'],'at'=>$prior['recorded_at'],'replayed'=>true]);
                }
            }
            if($settings['enforce_shift_window']){$pdo->rollBack();respond(501,['error'=>'کنترل پنجره شیفت در نسخه PHP هنوز تکمیل نشده است']);}
            $lat=$b['lat']??null;$lng=$b['lng']??null;$accuracy=$b['accuracy']??null;
            if($action==='in'&&$settings['require_location']&&!self::coords($lat,$lng,$accuracy)){
                $pdo->rollBack();respond(400,['error'=>'موقعیت مکانی معتبر لازم است']);
            }
            if($action==='in'&&$settings['geofence_lat']!==null&&$settings['geofence_lng']!==null){
                if(!self::coords($lat,$lng,$accuracy)||self::distance((float)$lat,(float)$lng,(float)$settings['geofence_lat'],(float)$settings['geofence_lng'])>(int)$settings['geofence_radius_m']){
                    $pdo->rollBack();respond(403,['error'=>'خارج از محدوده مجاز هستید']);
                }
            }
            $at=gmdate('Y-m-d\TH:i:s').'.000Z';
            $active=Db::one('SELECT id FROM attendance WHERE company_id=? AND user_id=? AND checked_out_at IS NULL LIMIT 1',[$cid,$uid]);
            if($action==='in'){
                if($active){$pdo->rollBack();respond(409,['error'=>'حضور فعال دارید']);}
                Db::run('INSERT INTO attendance(company_id,user_id,checked_in_at,lat,lng,accuracy) VALUES(?,?,?,?,?,?)',[$cid,$uid,$at,$lat,$lng,$accuracy]);
                $id=(int)$pdo->lastInsertId();
            }else{
                if(!$active){$pdo->rollBack();respond(409,['error'=>'حضور فعالی برای خروج ندارید']);}
                $id=(int)$active['id'];Db::run('UPDATE attendance SET checked_out_at=? WHERE id=? AND company_id=?',[$at,$id,$cid]);
            }
            if($event!==null)Db::run('INSERT INTO attendance_events(company_id,user_id,event_id,action,attendance_id,recorded_at) VALUES(?,?,?,?,?,?)',[$cid,$uid,$event,$action,$id,$at]);
            Db::run('INSERT INTO audit_logs(company_id,actor_user_id,action,target_type,target_id) VALUES(?,?,?,?,?)',[$cid,$uid,'attendance.'.$action,'attendance',$id]);
            $pdo->commit();respond(201,['id'=>$id,'at'=>$at,'replayed'=>false]);
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
    }
}
