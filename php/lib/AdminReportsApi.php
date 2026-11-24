<?php
declare(strict_types=1);
require_once __DIR__ . '/WorkReportApi.php';
require_once __DIR__ . '/XlsxExport.php';

/** Administrative reports adapted from Khatyar's attendance/report contracts.
 * All ownership comes from the authenticated company, never from a query parameter.
 */
final class AdminReportsApi {
    private static function output(string $kind, array $report): never {
        if (($_GET['format'] ?? 'json') !== 'xlsx') respond(200, $report);
        $items = $report['items'];
        $columns = match ($kind) {
            'attendance' => [
                'jalali'=>'تاریخ شمسی', 'name'=>'پرسنل', 'zone_name'=>'محل کار',
                'checked_in_at'=>'ورود (UTC)', 'checked_out_at'=>'خروج (UTC)', 'minutes'=>'مدت (دقیقه)'
            ],
            'leave' => [
                'name'=>'پرسنل', 'zone_name'=>'محل کار', 'type'=>'نوع', 'work_date'=>'از تاریخ',
                'end_date'=>'تا تاریخ', 'unit'=>'واحد', 'range_days'=>'روزهای بازه',
                'range_minutes'=>'دقیقه در بازه', 'status'=>'وضعیت',
                'substitute_name'=>'جانشین', 'description'=>'توضیح'
            ],
            'work-summary' => [
                'name'=>'پرسنل', 'worked'=>'حضور کل', 'in_shift'=>'حضور در شیفت',
                'expected'=>'موظفی', 'shortage'=>'کسری', 'absence'=>'غیبت',
                'absence_and_shortage'=>'جمع غیبت و کسری', 'night'=>'شب‌کاری',
                'total_overtime'=>'کل اضافه‌کاری', 'friday_work'=>'جمعه‌کاری',
                'holiday_work'=>'تعطیل‌کاری', 'mission'=>'مأموریت', 'leave'=>'مرخصی با حقوق',
                'unpaid_leave'=>'بدون حقوق', 'surplus'=>'مازاد حضور'
            ],
            'tracking' => [
                'name'=>'پرسنل', 'recorded_at'=>'زمان ثبت (UTC)',
                'lat'=>'عرض جغرافیایی', 'lng'=>'طول جغرافیایی', 'accuracy'=>'دقت (متر)'
            ],
            'audit' => [
                'name'=>'عامل', 'action'=>'عملیات', 'target_type'=>'نوع رکورد',
                'target_id'=>'شناسه رکورد', 'created_at'=>'زمان'
            ]
        };
        if ($kind === 'attendance') {
            $sessions = [];
            foreach ($items as $day) {
                foreach ($day['sessions'] as $session) $sessions[] = $session + ['jalali'=>$day['jalali']];
            }
            $items = $sessions;
        }
        if ($kind === 'work-summary') {
            $items = array_map(static fn($person) => ['name'=>$person['name']] + $person['totals'], $items);
        }
        if ($kind === 'leave') {
            $types = ['annual_leave'=>'استحقاقی', 'sick_leave'=>'استعلاجی', 'unpaid_leave'=>'بدون حقوق', 'mission'=>'مأموریت'];
            $statuses = ['approved'=>'تأییدشده', 'pending'=>'در انتظار بررسی', 'rejected'=>'ردشده'];
            foreach ($items as &$item) {
                $item['type'] = $types[$item['type']] ?? $item['type'];
                $item['status'] = $statuses[$item['status']] ?? $item['status'];
                $item['unit'] = $item['unit'] === 'daily' ? 'روزانه' : 'ساعتی';
                foreach (['work_date', 'end_date'] as $key) $item[$key] = CalendarApi::jalali($item[$key]);
            }
            unset($item);
        }
        $titles = ['attendance'=>'تردد پرسنل', 'leave'=>'مرخصی و مأموریت', 'work-summary'=>'کارکرد تجمیعی (دقیقه)',
            'tracking'=>'رهگیری موقعیت', 'audit'=>'تاریخچه عملیات'];
        $keys = array_keys($columns);
        $rows = array_map(static fn($item) => array_map(static fn($key) => $item[$key] ?? '', $keys), $items);
        $title = $titles[$kind].' | '.CalendarApi::jalali($report['from']).' تا '.CalendarApi::jalali($report['to']);
        $xlsx = XlsxExport::report($title, array_values($columns), $rows);
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="hozoryar-'.$kind.'.xlsx"');
        header('Content-Length: '.strlen($xlsx));
        echo $xlsx;
        exit;
    }
    private static function range(): array {
        $today=(new DateTimeImmutable('now',new DateTimeZone('Asia/Tehran')))->format('Y-m-d');
        $from=$_GET['from']??substr($today,0,8).'01';$to=$_GET['to']??$today;
        if(!CalendarApi::validRange($from,$to,34))respond(400,['error'=>'بازه معتبر با حداکثر ۳۵ روز انتخاب کنید']);
        return [$from,$to];
    }
    private static function filter(array $user): array {
        $sql='u.company_id=?';$params=[(int)$user['company_id']];
        foreach(['user_id'=>'u.id','zone_id'=>'u.zone_id'] as $key=>$column){
            $value=$_GET[$key]??'';
            if($value==='')continue;
            if(!is_string($value)||!ctype_digit($value)||(int)$value<1)respond(400,['error'=>'فیلتر پرسنل یا محل کار نامعتبر است']);
            $table=$key==='user_id'?'users':'zones';
            if(!Db::one("SELECT id FROM $table WHERE company_id=? AND id=?",[$user['company_id'],(int)$value]))
                respond(404,['error'=>'پرسنل یا محل کار در شرکت یافت نشد']);
            $sql.=" AND $column=?";$params[]=(int)$value;
        }
        return [$sql,$params];
    }
    private static function bounds(string $from,string $to): array {
        $tz=new DateTimeZone('Asia/Tehran');$utc=new DateTimeZone('UTC');
        return [(new DateTimeImmutable($from.' 00:00:00',$tz))->setTimezone($utc)->format('Y-m-d\TH:i:s').'.000Z',
            (new DateTimeImmutable($to.' 00:00:00',$tz))->modify('+1 day')->setTimezone($utc)->format('Y-m-d\TH:i:s').'.000Z'];
    }
    public static function handle(string $path,string $method,array $user): bool {
        if(!str_starts_with($path,'/api/reports/'))return false;
        if($method!=='GET')respond(405,['error'=>'روش نامعتبر است']);
        if(!in_array($user['role'],['owner','manager'],true))respond(403,['error'=>'دسترسی مدیریتی لازم است']);
        $known=['attendance','leave','work-summary','tracking','audit'];
        $kind=substr($path,strlen('/api/reports/'));
        if(!in_array($kind,$known,true))respond(404,['error'=>'گزارش یافت نشد']);
        [$from,$to]=self::range();[$where,$params]=self::filter($user);
        [$lower,$upper]=self::bounds($from,$to);
        if($kind==='attendance'){
            $incomplete=$_GET['incomplete']??'0';
            if(!in_array($incomplete,['0','1'],true))respond(400,['error'=>'فیلتر تردد نامعتبر است']);
            $sql="SELECT a.id,u.id user_id,u.name,z.name zone_name,a.checked_in_at,a.checked_out_at
                FROM attendance a JOIN users u ON u.company_id=a.company_id AND u.id=a.user_id
                LEFT JOIN zones z ON z.company_id=u.company_id AND z.id=u.zone_id
                WHERE $where AND a.checked_in_at>=? AND a.checked_in_at<?";
            $params[]=$lower;$params[]=$upper;
            if($incomplete==='1'){
                $today=(new DateTimeImmutable('now',new DateTimeZone('Asia/Tehran')))->format('Y-m-d');
                [$startToday]=self::bounds($today,$today);
                $sql.=' AND a.checked_out_at IS NULL AND a.checked_in_at<?';$params[]=$startToday;
            }
            $rows=Db::all($sql.' ORDER BY a.checked_in_at DESC,a.id DESC LIMIT 5001',$params);
            if(count($rows)>5000)respond(422,['error'=>'بیش از ۵۰۰۰ تردد؛ بازه یا پرسنل را محدود کنید']);
            $days=[];$tz=new DateTimeZone('Asia/Tehran');
            foreach($rows as $row){
                $day=(new DateTimeImmutable($row['checked_in_at']))->setTimezone($tz)->format('Y-m-d');
                $key=$row['user_id'].':'.$day;
                if(!isset($days[$key]))$days[$key]=['day'=>$day,'jalali'=>CalendarApi::jalali($day),
                    'user_id'=>(int)$row['user_id'],'name'=>$row['name'],'zone_name'=>$row['zone_name'],
                    'worked_minutes'=>0,'open_count'=>0,'sessions'=>[]];
                $row['id']=(int)$row['id'];$row['user_id']=(int)$row['user_id'];
                $row['minutes']=$row['checked_out_at']===null?null:max(0,(int)floor((strtotime($row['checked_out_at'])-strtotime($row['checked_in_at']))/60));
                if($row['minutes']===null)$days[$key]['open_count']++;else $days[$key]['worked_minutes']+=$row['minutes'];
                $days[$key]['sessions'][]=$row;
            }
            self::output($kind,['items'=>array_values($days),'from'=>$from,'to'=>$to,'sessions'=>count($rows),
                'note'=>'تردد شب به تاریخ ورود در تهران تعلق دارد. حضور باز در جمع مدت بسته‌شده محاسبه نمی‌شود. تردد ناقص یعنی ورود بدون خروج از روزهای قبل.']);
        }
        if($kind==='leave'){
            $type=$_GET['type']??'';$status=$_GET['status']??'';
            $excludeMissions=($_GET['exclude_missions']??'0')==='1';
            if(!in_array($type,['','annual_leave','sick_leave','unpaid_leave','mission'],true)||
                !in_array($status,['','pending','approved','rejected'],true))respond(400,['error'=>'نوع یا وضعیت درخواست نامعتبر است']);
            $sql="SELECT r.id,u.id user_id,u.name,z.name zone_name,r.type,r.work_date,r.end_date,r.unit,r.minutes,
                r.status,r.description,su.name substitute_name FROM personnel_requests r
                JOIN users u ON u.company_id=r.company_id AND u.id=r.user_id
                LEFT JOIN zones z ON z.company_id=u.company_id AND z.id=u.zone_id
                LEFT JOIN users su ON su.company_id=r.company_id AND su.id=r.substitute_user_id
                WHERE $where AND r.work_date<=? AND r.end_date>=?";
            $params[]=$to;$params[]=$from;
            if($excludeMissions)$sql.=" AND r.type<>'mission'";
            if($type!==''){$sql.=' AND r.type=?';$params[]=$type;}
            if($status!==''){$sql.=' AND r.status=?';$params[]=$status;}
            $rows=Db::all($sql.' ORDER BY r.work_date DESC,r.id DESC LIMIT 5001',$params);
            if(count($rows)>5000)respond(422,['error'=>'بازه یا پرسنل را محدود کنید']);
            $summary=[];
            foreach($rows as &$row){
                $row['id']=(int)$row['id'];$row['user_id']=(int)$row['user_id'];$row['minutes']=(int)$row['minutes'];
                $days=1+(int)((strtotime(min($to,$row['end_date']).' UTC')-strtotime(max($from,$row['work_date']).' UTC'))/86400);
                $row['range_days']=$days;$row['range_minutes']=$days*$row['minutes'];
                $key=$row['user_id'];
                if(!isset($summary[$key]))$summary[$key]=['user_id'=>$key,'name'=>$row['name'],'annual_leave'=>0,'sick_leave'=>0,'unpaid_leave'=>0,'mission'=>0,'pending'=>0];
                if($row['status']==='approved')$summary[$key][$row['type']]+=$row['range_minutes'];
                if($row['status']==='pending')$summary[$key]['pending']++;
            }unset($row);
            self::output($kind,['items'=>$rows,'summary'=>array_values($summary),'from'=>$from,'to'=>$to,
                'note'=>'مدت هر درخواست برای روزهای هم‌پوشان با بازه محاسبه می‌شود؛ جمع‌ها فقط درخواست تأییدشده‌اند و گزارش قطعی حقوق نیستند.']);
        }
        if($kind==='work-summary'){
            $people=Db::all("SELECT u.id,u.name FROM users u WHERE $where AND u.active=1 ORDER BY u.name LIMIT 101",$params);
            if(count($people)>100)respond(422,['error'=>'برای بیش از ۱۰۰ نفر، محل کار یا پرسنل مشخصی را انتخاب کنید']);
            try{$official=CalendarApi::official($from,$to);}catch(Throwable $e){respond(503,['error'=>'تقویم رسمی معتبر در دسترس نیست؛ محاسبه متوقف شد']);}
            $items=[];
            foreach($people as $person){$r=WorkReportApi::build((int)$user['company_id'],(int)$person['id'],$from,$to,$official);
                $items[]=['user_id'=>(int)$person['id'],'name'=>$person['name'],'totals'=>$r['totals']];}
            self::output($kind,['items'=>$items,'from'=>$from,'to'=>$to,'authoritative'=>false,
                'official_calendar_status'=>$official['status'],'note'=>'موتور مشترک کارکرد PHP با قواعد مرجع خطیار؛ حقوق ریالی یا پرداخت قطعی محاسبه نمی‌شود.']);
        }
        if($kind==='tracking'){
            $s=PersonnelApi::settings((int)$user['company_id']);
            if(empty($s['features']['monitoring']))respond(403,['error'=>'نظارت برای شرکت فعال نیست']);
            $rows=Db::all("SELECT h.id,u.id user_id,u.name,h.lat,h.lng,h.accuracy,h.recorded_at FROM location_history h
                JOIN users u ON u.company_id=h.company_id AND u.id=h.user_id
                WHERE $where AND h.recorded_at>=? AND h.recorded_at<? ORDER BY h.recorded_at DESC,h.id DESC LIMIT 1001",[...$params,$lower,$upper]);
            if(count($rows)>1000)respond(422,['error'=>'بیش از ۱۰۰۰ نقطه؛ بازه یا پرسنل را محدود کنید']);
            self::output($kind,['items'=>$rows,'from'=>$from,'to'=>$to,'retention_days'=>30]);
        }
        $rows=Db::all("SELECT l.id,u.name,l.action,l.target_type,l.target_id,l.created_at FROM audit_logs l
            JOIN users u ON u.company_id=l.company_id AND u.id=l.actor_user_id
            WHERE $where AND l.created_at>=? AND l.created_at<? ORDER BY l.id DESC LIMIT 1001",
            [...$params,$from.' 00:00:00',(new DateTimeImmutable($to))->modify('+1 day')->format('Y-m-d').' 00:00:00']);
        if(count($rows)>1000)respond(422,['error'=>'بازه ممیزی را محدود کنید']);
        self::output($kind,['items'=>$rows,'from'=>$from,'to'=>$to]);
    }
}
