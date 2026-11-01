<?php
declare(strict_types=1);
require_once __DIR__ . '/PersonnelApi.php';

final class ShiftApi {
    private static function time($value): bool { return is_string($value)&&preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9]$/',$value)===1; }
    private static function day($value): bool {
        if(!is_string($value)||!preg_match('/^\d{4}-\d{2}-\d{2}$/',$value))return false;
        [$y,$m,$d]=array_map('intval',explode('-',$value));return checkdate($m,$d,$y);
    }
    private static function segments($items): bool {
        if(!is_array($items)||count($items)>4)return false;
        $intervals=[];$sum=0;
        foreach($items as $item){
            if(!is_array($item)||!self::time($item['s']??null)||!self::time($item['e']??null))return false;
            [$sh,$sm]=array_map('intval',explode(':',$item['s']));[$eh,$em]=array_map('intval',explode(':',$item['e']));
            $start=$sh*60+$sm;$end=$eh*60+$em;if($end<=$start)$end+=1440;
            if($end-$start>960)return false;
            $sum+=$end-$start;$intervals[]=[$start,$end];
        }
        usort($intervals,fn($a,$b)=>$a[0]<=>$b[0]);
        foreach($intervals as $i=>$s)if($i>0&&$s[0]<$intervals[$i-1][1])return false;
        return $sum<=1440;
    }
    private static function validSchedule(string $kind,$config): bool {
        if(!is_array($config)||array_is_list($config)&&$config!==[])return false;
        foreach(['late_ok','early_ok','ot_begin','ot_end'] as $key)if(isset($config[$key])&&(!is_int($config[$key])||$config[$key]<0||$config[$key]>360))return false;
        if($kind==='weekly')return isset($config['days'])&&is_array($config['days'])&&count(array_unique($config['days']))===count($config['days'])&&
            !array_filter($config['days'],fn($d)=>!is_int($d)||$d<0||$d>6);
        if($kind==='rotating')return self::day($config['anchor']??null)&&isset($config['work'],$config['rest'])&&is_int($config['work'])&&is_int($config['rest'])&&
            $config['work']>=1&&$config['work']<=30&&$config['rest']>=1&&$config['rest']<=30;
        if($kind==='rotation_segments'){
            if(!self::day($config['anchor']??null)||!isset($config['cycle'])||!is_array($config['cycle'])||count($config['cycle'])<1||count($config['cycle'])>12)return false;
            foreach($config['cycle'] as $phase)if(!is_array($phase)||!is_int($phase['days']??null)||$phase['days']<1||$phase['days']>60||!self::segments($phase['segments']??null))return false;
        }
        if($kind==='advanced'){
            if(!isset($config['weekly'])||!is_array($config['weekly']))return false;
            foreach($config['weekly'] as $key=>$items)if(!preg_match('/^[0-6]$/',(string)$key)||!self::segments($items))return false;
        }
        if($kind==='auto'&&isset($config['auto_expected_min'])&&(!is_int($config['auto_expected_min'])||$config['auto_expected_min']<0||$config['auto_expected_min']>1440))return false;
        return true;
    }
    public static function handle(string $path,string $method,array $user): bool {
        $cid=(int)$user['company_id'];$uid=(int)$user['id'];
        if($path!=='/api/shifts'&&$path!=='/api/assignments')return false;
        if($user['role']==='employee')respond(403,['error'=>'دسترسی مدیریتی لازم است']);
        $settings=PersonnelApi::settings($cid);
        if(empty($settings['features']['shifts']))respond(403,['error'=>'شیفت‌ها برای این شرکت فعال نیست']);
        if($path==='/api/shifts'&&$method==='GET')respond(200,['items'=>Db::all('SELECT id,name,start_time,end_time,duty_minutes,daily_ot_cap,schedule_kind,schedule_json FROM shifts WHERE company_id=? ORDER BY id DESC',[$cid])]);
        if($path==='/api/shifts'&&$method==='POST'){
            $b=jsonBody();$kind=$b['schedule_kind']??'fixed';$schedule=$b['schedule']??[];
            $name=$b['name']??null;$duty=$b['duty_minutes']??null;$cap=$b['daily_ot_cap']??27;
            if(!is_string($name)||trim($name)===''||mb_strlen($name)>120||!self::time($b['start_time']??null)||!self::time($b['end_time']??null)||
                !is_int($duty)||$duty<0||$duty>1440||!is_int($cap)||$cap<0||$cap>1440||
                !in_array($kind,['fixed','weekly','rotating','rotation_segments','floating','advanced','auto'],true)||!self::validSchedule($kind,$schedule))
                respond(400,['error'=>'اطلاعات شیفت نامعتبر است']);
            Db::run('INSERT INTO shifts(company_id,name,start_time,end_time,duty_minutes,daily_ot_cap,schedule_kind,schedule_json) VALUES(?,?,?,?,?,?,?,?)',
                [$cid,trim($name),$b['start_time'],$b['end_time'],$duty,$cap,$kind,json_encode($schedule,JSON_UNESCAPED_UNICODE)]);
            $id=(int)Db::pdo()->lastInsertId();
            Db::run('INSERT INTO audit_logs(company_id,actor_user_id,action,target_type,target_id) VALUES(?,?,?,?,?)',[$cid,$uid,'shift.create','shift',$id]);
            respond(201,['id'=>$id]);
        }
        if($path==='/api/assignments'&&$method==='POST'){
            $b=jsonBody();$target=$b['user_id']??null;$shift=$b['shift_id']??null;
            if(!is_int($target)||!is_int($shift)||!Db::one('SELECT id FROM users WHERE company_id=? AND id=?',[$cid,$target])||
                !Db::one('SELECT id FROM shifts WHERE company_id=? AND id=?',[$cid,$shift]))respond(404,['error'=>'کارمند یا شیفت در شرکت وجود ندارد']);
            Db::run('INSERT INTO assignments(company_id,user_id,shift_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE shift_id=VALUES(shift_id)',[$cid,$target,$shift]);
            Db::run('INSERT INTO audit_logs(company_id,actor_user_id,action,target_type,target_id) VALUES(?,?,?,?,?)',[$cid,$uid,'shift.assign','user',$target]);
            respond(200,['ok'=>true]);
        }
        return false;
    }
}
