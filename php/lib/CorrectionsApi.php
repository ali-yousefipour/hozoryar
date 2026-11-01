<?php
declare(strict_types=1);
require_once __DIR__.'/Db.php';

final class CorrectionsApi {
    private static function instant($value): bool {
        if(!is_string($value)||!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/',$value))return false;
        try{$dt=DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s.v\Z',$value,new DateTimeZone('UTC'));
            return $dt!==false&&$dt->format('Y-m-d\TH:i:s.v\Z')===$value;
        }catch(Throwable $e){return false;}
    }
    private static function date(string $iso): string {
        return (new DateTimeImmutable($iso))->setTimezone(new DateTimeZone('Asia/Tehran'))->format('Y-m-d');
    }
    private static function intersects(array $dates,array $bounds): bool {
        return $dates[0]<=$bounds[1]&&$dates[1]>=$bounds[0];
    }
    public static function handle(string $path,string $method,array $user): bool {
        if(!preg_match('#^/api/attendance/(\d+)/(correct|corrections)$#',$path,$m))return false;
        if($user['role']==='employee')respond(403,['error'=>'دسترسی مدیریتی لازم است']);
        $cid=(int)$user['company_id'];$aid=(int)$m[1];$mode=$m[2];
        if($mode==='corrections'&&$method==='GET'){
            if(!Db::one('SELECT id FROM attendance WHERE company_id=? AND id=?',[$cid,$aid]))respond(404,['error'=>'تردد یافت نشد']);
            respond(200,['items'=>Db::all('SELECT c.old_in,c.old_out,c.new_in,c.new_out,c.reason,c.created_at,u.name actor_name
                FROM attendance_corrections c JOIN users u ON u.company_id=c.company_id AND u.id=c.actor_user_id
                WHERE c.company_id=? AND c.attendance_id=? ORDER BY c.id DESC',[$cid,$aid])]);
        }
        if($mode!=='correct'||$method!=='POST')return false;
        $b=jsonBody();$from=$b['checked_in_at']??null;$to=$b['checked_out_at']??null;$reason=$b['reason']??null;
        if(!self::instant($from)||!self::instant($to)||!is_string($reason)||mb_strlen(trim($reason))<8||mb_strlen($reason)>500)
            respond(400,['error'=>'تاریخ ورود، خروج یا دلیل اصلاح نامعتبر است']);
        $begin=strtotime($from);$finish=strtotime($to);
        if($finish<=$begin||$finish-$begin>86400)respond(400,['error'=>'طول تردد اصلاحی نامعتبر است']);
        $pdo=Db::pdo();$pdo->beginTransaction();
        try{
            // Same lock order as punch, archive and shift assignment mutations.
            Db::one('SELECT id FROM companies WHERE id=? FOR UPDATE',[$cid]);
            $current=Db::one('SELECT id,user_id,checked_in_at,checked_out_at FROM attendance WHERE company_id=? AND id=? FOR UPDATE',[$cid,$aid]);
            if(!$current){$pdo->rollBack();respond(404,['error'=>'تردد یافت نشد']);}
            if($current['checked_out_at']===null){$pdo->rollBack();respond(409,['error'=>'تردد باز قابل اصلاح نیست؛ ابتدا خروج ثبت شود']);}
            $original=[self::date($current['checked_in_at']),self::date($current['checked_out_at'])];
            $proposed=[self::date($from),self::date($to)];
            $archives=Db::all('SELECT snapshot_json FROM work_month_archives WHERE company_id=?',[$cid]);
            foreach($archives as $archive){$snapshot=json_decode($archive['snapshot_json'],true,512,JSON_THROW_ON_ERROR);
                $range=[$snapshot['from'],$snapshot['to']];
                if(self::intersects($original,$range)||self::intersects($proposed,$range)){
                    $pdo->rollBack();respond(409,['error'=>'اصلاح تردد در دوره بایگانی‌شده مجاز نیست']);
                }
            }
            $conflict=Db::one('SELECT id FROM attendance WHERE company_id=? AND user_id=? AND id<>?
                AND checked_in_at<? AND (checked_out_at IS NULL OR checked_out_at>?) LIMIT 1',
                [$cid,$current['user_id'],$aid,$to,$from]);
            if($conflict){$pdo->rollBack();respond(409,['error'=>'بازه اصلاحی با تردد دیگری تداخل دارد']);}
            Db::run('UPDATE attendance SET checked_in_at=?,checked_out_at=? WHERE company_id=? AND id=?',[$from,$to,$cid,$aid]);
            Db::run('INSERT INTO attendance_corrections(company_id,attendance_id,actor_user_id,old_in,old_out,new_in,new_out,reason)
                VALUES(?,?,?,?,?,?,?,?)',[$cid,$aid,$user['id'],$current['checked_in_at'],$current['checked_out_at'],$from,$to,trim($reason)]);
            Db::run('INSERT INTO audit_logs(company_id,actor_user_id,action,target_type,target_id) VALUES(?,?,?,?,?)',
                [$cid,$user['id'],'attendance.correct','attendance',$aid]);
            $pdo->commit();respond(200,['ok'=>true]);
        }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
    }
}
