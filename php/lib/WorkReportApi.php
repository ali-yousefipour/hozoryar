<?php
declare(strict_types=1);
require_once __DIR__ . '/WorkCalc.php';
require_once __DIR__ . '/PersonnelApi.php';

final class WorkReportApi {
    private static function evidence(array $attendance,array $events,int $now): array {
        $start=strtotime($attendance['checked_in_at']);
        $end=min($attendance['checked_out_at']===null?$now:strtotime($attendance['checked_out_at']),$now);
        $result=['gps_off_minutes'=>0,'internet_off_minutes'=>0];
        if($end<=$start)return $result;
        $state=['gps'=>null,'internet'=>null];
        foreach($events as $event){$at=strtotime($event['recorded_at']);if($at<$start||$at>$end)continue;
            [$kind,$status]=explode('_',$event['kind']);
            if(!array_key_exists($kind,$state))continue;
            if($status==='off'&&$state[$kind]===null)$state[$kind]=$at;
            if($status==='on'&&$state[$kind]!==null){$result[$kind.'_off_minutes']+=(int)floor(($at-$state[$kind])/60);$state[$kind]=null;}
        }
        foreach($state as $kind=>$begin)if($begin!==null)$result[$kind.'_off_minutes']+=(int)floor(($end-$begin)/60);
        return $result;
    }
    public static function build(int $company,int $target,string $from,string $to,array $official): array {
        $lower=gmdate('Y-m-d',strtotime($from.' UTC')-2*86400).'T00:00:00.000Z';
        $upper=gmdate('Y-m-d',strtotime($to.' UTC')+2*86400).'T23:59:59.999Z';
        $attendance=Db::all('SELECT id,checked_in_at,checked_out_at FROM attendance WHERE company_id=? AND user_id=?
          AND checked_in_at<=? AND (checked_out_at IS NULL OR checked_out_at>=?) ORDER BY checked_in_at',[$company,$target,$upper,$lower]);
        $events=Db::all('SELECT e.attendance_id,e.kind,e.recorded_at FROM monitoring_events e JOIN attendance a ON a.id=e.attendance_id AND a.company_id=e.company_id AND a.user_id=e.user_id
          WHERE e.company_id=? AND e.user_id=? AND a.checked_in_at<=? AND (a.checked_out_at IS NULL OR a.checked_out_at>=?) ORDER BY e.recorded_at',[$company,$target,$upper,$lower]);
        $byAttendance=[];foreach($events as $event)$byAttendance[$event['attendance_id']][]=$event;
        $byDay=[];$evidence=[];$now=time();
        foreach($attendance as $row){
            $start=strtotime($row['checked_in_at']);$end=min($row['checked_out_at']===null?$now:strtotime($row['checked_out_at']),$now);
            if($start===false||$end===false||$end<=$start)continue;
            $day=(new DateTimeImmutable('@'.$start))->setTimezone(new DateTimeZone('Asia/Tehran'))->format('Y-m-d');
            if($day<$from||$day>$to)continue;
            $byDay[$day][]=[$start,$end];
            $amounts=self::evidence($row,$byAttendance[$row['id']]??[],$now);
            foreach($amounts as $key=>$amount)$evidence[$day][$key]=($evidence[$day][$key]??0)+$amount;
        }
        $shift=Db::one('SELECT s.duty_minutes,s.daily_ot_cap,s.start_time,s.end_time,s.schedule_kind,s.schedule_json FROM assignments a
          JOIN shifts s ON s.id=a.shift_id AND s.company_id=a.company_id WHERE a.company_id=? AND a.user_id=?',[$company,$target]);
        $substitutions=Db::all('SELECT sa.from_date,sa.to_date,s.duty_minutes,s.daily_ot_cap,s.start_time,s.end_time,s.schedule_kind,s.schedule_json
          FROM substitute_assignments sa JOIN assignments a ON a.company_id=sa.company_id AND a.user_id=sa.absent_user_id
          JOIN shifts s ON s.id=a.shift_id AND s.company_id=a.company_id WHERE sa.company_id=? AND sa.substitute_user_id=?
          AND sa.from_date<=? AND sa.to_date>=? ORDER BY sa.id DESC',[$company,$target,$to,$from]);
        $requests=Db::all("SELECT type,work_date,end_date,minutes FROM personnel_requests
          WHERE company_id=? AND user_id=? AND status='approved' AND work_date<=? AND end_date>=?",[$company,$target,$to,$from]);
        $calendar=CalendarApi::days($from,$to,$company,$official);
        $days=[];
        foreach($calendar as $classification){
            $day=$classification['date'];$effective=$shift;
            foreach($substitutions as $sub)if($sub['from_date']<=$day&&$sub['to_date']>=$day){$effective=$sub;break;}
            $approved=array_values(array_filter($requests,fn($r)=>$r['work_date']<=$day&&$r['end_date']>=$day));
            $metrics=WorkCalc::metrics($effective,$day,$byDay[$day]??[]);
            $result=WorkCalc::daily($day,$metrics,WorkCalc::duty($effective,$day),(int)($effective['daily_ot_cap']??27),
              $approved,$classification['is_official_holiday']||$classification['is_manual_holiday'],$effective!==null);
            $days[]=array_merge($result,$evidence[$day]??['gps_off_minutes'=>0,'internet_off_minutes'=>0],[
                'jalali'=>$classification['jalali'],'is_official_holiday'=>$classification['is_official_holiday'],
                'is_manual_holiday'=>$classification['is_manual_holiday'],'holiday_title'=>$classification['title'],
                'holiday_source'=>$classification['source']]);
        }
        return ['user_id'=>$target,'from'=>$from,'to'=>$to,'days'=>$days,'totals'=>WorkCalc::totals($days),
          'authoritative'=>false,'engine'=>'hozoryar-php-work-v1','reference'=>'Khatyar ShiftCalc rules; independent online calendar',
          'official_calendar_available'=>true,'official_calendar_status'=>$official['status'],
          'official_calendar_stale'=>$official['stale'],'official_calendar_estimated'=>$official['estimated'],
          'note'=>$official['stale']?'تقویم برخط در دسترس نیست و نسخه ذخیره‌شده استفاده شده؛ گزارش مالی قطعی نیست.':
          ($official['estimated']?'برخی تعطیلات برآوردی هستند؛ گزارش برای حقوق قطعی نیست.':'گزارش برای حقوق قطعی معتبر نیست.')];
    }
    public static function handle(string $path,string $method,array $user): bool {
        if($path!=='/api/work-report'||$method!=='GET')return false;
        $from=$_GET['from']??null;$to=$_GET['to']??null;
        if(!CalendarApi::validRange($from,$to))respond(400,['error'=>'بازه گزارش باید حداکثر ۳۵ روز باشد']);
        $target=(int)$user['id'];
        if(isset($_GET['user_id'])){
            if(!is_string($_GET['user_id'])||!ctype_digit($_GET['user_id']))respond(400,['error'=>'کارمند نامعتبر است']);
            $target=(int)$_GET['user_id'];
        }
        if($target!==(int)$user['id']&&$user['role']==='employee')respond(403,['error'=>'دسترسی مدیریتی لازم است']);
        if(!Db::one('SELECT id FROM users WHERE id=? AND company_id=?',[$target,$user['company_id']]))respond(404,['error'=>'کارمند یافت نشد']);
        try{$official=CalendarApi::official($from,$to);}
        catch(Throwable $e){respond(503,['error'=>'تقویم رسمی معتبر در دسترس نیست؛ محاسبه گزارش متوقف شد']);}
        respond(200,self::build((int)$user['company_id'],$target,$from,$to,$official));
    }
}
