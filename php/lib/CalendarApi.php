<?php
declare(strict_types=1);
require_once __DIR__ . '/Db.php';

final class CalendarApi {
    private const SOURCE='https://www.persian-calendar.com/api/holidays';
    private const TTL_SECONDS=3600;

    public static function validDay($day): bool {
        if(!is_string($day)||!preg_match('/^\d{4}-\d{2}-\d{2}$/',$day))return false;
        [$y,$m,$d]=array_map('intval',explode('-',$day));return checkdate($m,$d,$y);
    }
    public static function validRange($from,$to,int $maxDays=35): bool {
        return self::validDay($from)&&self::validDay($to)&&$from<=$to&&
            (strtotime($to.' UTC')-strtotime($from.' UTC'))<=$maxDays*86400;
    }
    private static function formatter(string $pattern,string $locale): IntlDateFormatter {
        if(!class_exists('IntlDateFormatter'))throw new RuntimeException('PHP intl extension is required');
        $formatter=new IntlDateFormatter($locale,IntlDateFormatter::NONE,IntlDateFormatter::NONE,'Asia/Tehran',IntlDateFormatter::TRADITIONAL,$pattern);
        if(!$formatter)throw new RuntimeException('Calendar formatter initialization failed');
        return $formatter;
    }
    public static function jalali(string $day): string {
        if(!self::validDay($day))throw new InvalidArgumentException('Invalid Gregorian day');
        $formatted=self::formatter('yyyy-MM-dd','en_US@calendar=persian')->format(strtotime($day.' 12:00:00 UTC'));
        if(!is_string($formatted)||!preg_match('/^\d{4}-\d{2}-\d{2}$/',$formatted))throw new RuntimeException('Persian date conversion failed');
        return $formatted;
    }
    public static function weekday(string $day): string {
        return (string)self::formatter('EEEE','fa_IR@calendar=gregorian')->format(strtotime($day.' 12:00:00 UTC'));
    }
    private static function officialYear(int $year): array {
        $stored=Db::one('SELECT payload_json,fetched_at FROM official_calendar_years WHERE jalali_year=?',[$year]);
        $cached=$stored?json_decode($stored['payload_json'],true):null;
        $stale=false;$data=$cached;
        $age=$stored?time()-strtotime($stored['fetched_at'].' UTC'):PHP_INT_MAX;
        if(!$stored||$age>self::TTL_SECONDS){
            try {
                $data=self::download($year);
                Db::run('INSERT INTO official_calendar_years(jalali_year,payload_json,fetched_at) VALUES(?,?,UTC_TIMESTAMP())
                  ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json),fetched_at=VALUES(fetched_at)',
                  [$year,json_encode($data,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)]);
            } catch (Throwable $e) {
                if(!$stored||!is_array($cached)||!isset($cached['days']))throw new RuntimeException('Official calendar unavailable and no verified cache exists',503,$e);
                $data=$cached;$stale=true;
            }
        }
        return ['data'=>$data,'status'=>['year'=>$year,'source'=>'persian-calendar.com',
            'fetched_at'=>$stale?$stored['fetched_at']:gmdate('Y-m-d\TH:i:s').'.000Z',
            'stale'=>$stale,'estimated'=>!empty($data['estimated'])]];
    }
    private static function download(int $year): array {
        if(!function_exists('curl_init'))throw new RuntimeException('PHP curl is required for online calendar');
        $handle=curl_init(self::SOURCE.'?year='.$year);
        curl_setopt_array($handle,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>8,CURLOPT_CONNECTTIMEOUT=>5,
          CURLOPT_FOLLOWLOCATION=>false,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,
          CURLOPT_HTTPHEADER=>['Accept: application/json','User-Agent: Hozoryar-PHP/1.0']]);
        $response=curl_exec($handle);$http=(int)curl_getinfo($handle,CURLINFO_HTTP_CODE);curl_close($handle);
        if(!is_string($response)||$http!==200||strlen($response)>2_000_000)throw new RuntimeException('Official calendar request failed');
        $payload=json_decode($response,true);
        if(!is_array($payload)||($payload['year']??null)!==$year||!isset($payload['data'])||!is_array($payload['data'])||count($payload['data'])<10||count($payload['data'])>366)
            throw new RuntimeException('Official calendar payload invalid');
        $days=[];$estimated=false;
        foreach($payload['data'] as $item){
            if(!is_array($item)||!self::validDay($item['date_gregorian']??null)||
                (int)substr(self::jalali($item['date_gregorian']),0,4)!==$year||($item['year_sh']??null)!==$year||
                !isset($item['events'])||!is_array($item['events'])||isset($days[$item['date_gregorian']]))
                throw new RuntimeException('Official calendar contains inconsistent days');
            $titles=[];
            foreach($item['events'] as $event)if(is_array($event)&&($event['is_holiday']??null)===true&&is_string($event['title_fa']??null)&&trim($event['title_fa'])!=='')$titles[]=trim($event['title_fa']);
            $title=implode(' | ',$titles);
            if($title===''||mb_strlen($title)>600)throw new RuntimeException('Official holiday title invalid');
            $days[$item['date_gregorian']]=['title'=>$title,'estimated'=>($item['estimate']??null)===true];
            $estimated=$estimated||($item['estimate']??null)===true;
        }
        return ['days'=>$days,'estimated'=>$estimated];
    }
    public static function official(string $from,string $to): array {
        $years=[];$date=new DateTimeImmutable($from,new DateTimeZone('UTC'));
        while($date->format('Y-m-d')<=$to){$years[(int)substr(self::jalali($date->format('Y-m-d')),0,4)]=true;$date=$date->modify('+1 day');}
        $days=[];$status=[];
        foreach(array_keys($years) as $year){$result=self::officialYear($year);$days=array_replace($days,$result['data']['days']);$status[]=$result['status'];}
        return ['days'=>$days,'status'=>$status,
            'stale'=>(bool)array_filter($status,fn($s)=>$s['stale']),
            'estimated'=>(bool)array_filter($status,fn($s)=>$s['estimated'])];
    }
    public static function days(string $from,string $to,int $company,array $official): array {
        $manual=[];
        foreach(Db::all('SELECT work_date,title FROM company_holidays WHERE company_id=? AND work_date BETWEEN ? AND ?',[$company,$from,$to]) as $row)$manual[$row['work_date']]=$row['title'];
        $days=[];$date=new DateTimeImmutable($from,new DateTimeZone('UTC'));
        while($date->format('Y-m-d')<=$to){
            $day=$date->format('Y-m-d');$own=$manual[$day]??null;$of=$official['days'][$day]??null;
            $friday=$date->format('N')==='5';
            $days[]=['date'=>$day,'jalali'=>self::jalali($day),'weekday'=>self::weekday($day),
              'is_friday'=>$friday,'is_manual_holiday'=>$own!==null,'is_official_holiday'=>$of!==null,
              'is_holiday'=>$friday||$own!==null||$of!==null,
              'title'=>implode(' | ',array_filter([$of['title']??null,$own])),
              'source'=>$of&&$own?'official-online+manual':($of?'official-online':($own?'manual':'calculated')),
              'official_estimated'=>(bool)($of['estimated']??false)];
            $date=$date->modify('+1 day');
        }
        return $days;
    }
    public static function handle(string $path,string $method,array $user): bool {
        $cid=(int)$user['company_id'];
        if($path==='/api/holidays'&&$method==='GET')respond(200,['items'=>Db::all('SELECT work_date,title FROM company_holidays WHERE company_id=? ORDER BY work_date',[$cid])]);
        if($path==='/api/holidays'&&$method==='POST'){
            if($user['role']!=='owner')respond(403,['error'=>'فقط مدیر شرکت مجاز است']);
            $b=jsonBody();
            if(!self::validDay($b['work_date']??null)||!is_string($b['title']??null)||trim($b['title'])===''||mb_strlen($b['title'])>120)
                respond(400,['error'=>'تاریخ یا عنوان تعطیلی نامعتبر است']);
            Db::run('INSERT INTO company_holidays(company_id,work_date,title) VALUES(?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title)',[$cid,$b['work_date'],trim($b['title'])]);
            Db::run('INSERT INTO audit_logs(company_id,actor_user_id,action,target_type,target_id) VALUES(?,?,?,?,?)',[$cid,$user['id'],'holiday.save','company',$cid]);
            respond(200,['ok'=>true]);
        }
        if($path==='/api/calendar'&&$method==='GET'){
            $from=$_GET['from']??null;$to=$_GET['to']??null;
            if(!self::validRange($from,$to))respond(400,['error'=>'بازه تقویم نامعتبر است']);
            try{$official=self::official($from,$to);}
            catch(Throwable $e){respond(503,['error'=>'تقویم رسمی معتبر در دسترس نیست؛ گزارش مالی متوقف شد']);}
            respond(200,['days'=>self::days($from,$to,$cid,$official),'official_calendar_available'=>true,
              'official_calendar_status'=>$official['status'],'official_calendar_stale'=>$official['stale'],
              'official_calendar_estimated'=>$official['estimated'],
              'note'=>$official['stale']?'آخرین نسخه ذخیره‌شده استفاده شد؛ ارتباط با منبع تقویم قطع است.':'تقویم رسمی مستقل دریافت و ذخیره شده است.']);
        }
        return false;
    }
}
