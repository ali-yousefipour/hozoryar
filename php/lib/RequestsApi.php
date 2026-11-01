<?php
declare(strict_types=1);
require_once __DIR__ . '/PersonnelApi.php';

final class RequestsApi {
    private static function day($value): bool {
        if(!is_string($value)||!preg_match('/^\d{4}-\d{2}-\d{2}$/',$value))return false;
        [$y,$m,$d]=array_map('intval',explode('-',$value));return checkdate($m,$d,$y);
    }
    private static function validRange($from,$to): bool {
        return self::day($from)&&self::day($to)&&$to>=$from&&
            (strtotime($to.' UTC')-strtotime($from.' UTC'))<=30*86400;
    }
    private static function reject(PDO $pdo,int $status,string $message): never {
        if($pdo->inTransaction())$pdo->rollBack();respond($status,['error'=>$message]);
    }
    private static function audit(array $user,string $action,int $requestId): void {
        Db::run('INSERT INTO audit_logs(company_id,actor_user_id,action,target_type,target_id) VALUES(?,?,?,?,?)',
            [$user['company_id'],$user['id'],$action,'personnel_request',$requestId]);
    }
    private static function available(int $company,int $user,string $from,string $to,int $except=0): bool {
        $reserved=Db::one("SELECT id FROM personnel_requests WHERE company_id=? AND substitute_user_id=? AND id<>?
          AND type='annual_leave' AND unit='daily' AND status IN ('pending','approved')
          AND work_date<=? AND end_date>=? LIMIT 1",[$company,$user,$except,$to,$from]);
        $leave=Db::one("SELECT id FROM personnel_requests WHERE company_id=? AND user_id=? AND id<>?
          AND type IN ('annual_leave','sick_leave','unpaid_leave') AND status IN ('pending','approved')
          AND work_date<=? AND end_date>=? LIMIT 1",[$company,$user,$except,$to,$from]);
        return !$reserved&&!$leave;
    }
    private static function jalaliYear(string $day): int {
        if(!class_exists('IntlDateFormatter'))throw new RuntimeException('PHP intl extension is required for financial leave calculations');
        $formatter=new IntlDateFormatter('en_US@calendar=persian',IntlDateFormatter::NONE,IntlDateFormatter::NONE,'UTC',IntlDateFormatter::TRADITIONAL,'yyyy');
        $year=$formatter->format(strtotime($day.' 12:00:00 UTC'));
        if($year===false||!ctype_digit((string)$year))throw new RuntimeException('Persian date conversion failed');
        return (int)$year;
    }
    private static function annualByYear(array $rows): array {
        $years=[];
        foreach($rows as $row){
            if($row['type']!=='annual_leave')continue;
            $from=new DateTimeImmutable($row['work_date'].' 12:00:00',new DateTimeZone('UTC'));
            $to=$row['end_date']??$row['work_date'];
            while($from->format('Y-m-d')<=$to){
                $year=self::jalaliYear($from->format('Y-m-d'));
                $years[$year]=($years[$year]??0)+(int)$row['minutes'];
                $from=$from->modify('+1 day');
            }
        }
        return $years;
    }
    private static function balance(int $company,int $user,int $year,int $excluding=0): array {
        $s=PersonnelApi::settings($company);
        $rows=Db::all("SELECT type,work_date,end_date,minutes FROM personnel_requests
            WHERE company_id=? AND user_id=? AND id<>? AND type='annual_leave' AND status='approved'",[$company,$user,$excluding]);
        $used=self::annualByYear($rows)[$year]??0;$quota=(int)$s['annual_leave_minutes'];
        return ['year'=>$year,'quota_minutes'=>$quota,'used_minutes'=>$used,'remaining_minutes'=>$quota-$used];
    }
    public static function handle(string $path,string $method,array $user): bool {
        $cid=(int)$user['company_id'];$uid=(int)$user['id'];
        if($path==='/api/requests'&&$method==='GET'){
            $mine=($_GET['scope']??null)==='mine'||$user['role']==='employee';
            $sql="SELECT r.id,r.user_id,u.name,r.type,r.work_date,r.end_date,r.unit,r.minutes,r.description,
              r.status,r.created_at,r.substitute_user_id,su.name substitute_name,
              (SELECT COUNT(*) FROM request_decisions d WHERE d.company_id=r.company_id AND d.request_id=r.id)+1 next_stage
              FROM personnel_requests r JOIN users u ON u.id=r.user_id AND u.company_id=r.company_id
              LEFT JOIN users su ON su.id=r.substitute_user_id AND su.company_id=r.company_id
              WHERE r.company_id=?".($mine?' AND r.user_id=?':'').' ORDER BY r.id DESC LIMIT 200';
            $rows=Db::all($sql,$mine?[$cid,$uid]:[$cid]);$steps=(int)PersonnelApi::settings($cid)['approval_steps'];
            foreach($rows as &$r){$r['total_steps']=$steps;$r['next_stage']=(int)$r['next_stage'];}unset($r);
            respond(200,['items'=>$rows]);
        }
        if($path==='/api/leave-balance'&&$method==='GET'){
            $year=filter_var($_GET['year']??null,FILTER_VALIDATE_INT);
            $target=isset($_GET['user_id'])?filter_var($_GET['user_id'],FILTER_VALIDATE_INT):$uid;
            if($year===false||$year<1300||$year>1499||$target===false)respond(400,['error'=>'سال یا کارمند نامعتبر است']);
            if($target!==$uid&&$user['role']==='employee')respond(403,['error'=>'دسترسی مدیریتی لازم است']);
            if(!Db::one('SELECT id FROM users WHERE company_id=? AND id=?',[$cid,$target]))respond(404,['error'=>'کارمند یافت نشد']);
            respond(200,self::balance($cid,$target,$year));
        }
        if($path==='/api/substitutes'&&$method==='GET'){
            $from=$_GET['from']??null;$to=$_GET['to']??null;
            if(!self::validRange($from,$to))respond(400,['error'=>'بازه جانشینی نامعتبر است']);
            $rows=Db::all('SELECT id,name,zone_id FROM users WHERE company_id=? AND id<>? AND active=1 AND can_be_substitute=1 ORDER BY name',[$cid,$uid]);
            foreach($rows as &$r)$r['available']=self::available($cid,(int)$r['id'],$from,$to);unset($r);
            respond(200,['items'=>$rows]);
        }
        if($path==='/api/requests'&&$method==='POST'){
            $b=jsonBody();$from=$b['work_date']??null;$to=$b['end_date']??$from;
            $unit=$b['unit']??'hourly';$type=$b['type']??null;$minutes=$b['minutes']??null;
            $description=$b['description']??'';$sub=$b['substitute_user_id']??null;
            if(!in_array($type,['annual_leave','sick_leave','unpaid_leave','mission'],true)||!self::validRange($from,$to)||
                !in_array($unit,['hourly','daily'],true)||($unit==='hourly'&&$from!==$to)||!is_int($minutes)||$minutes<1||$minutes>1440||
                !is_string($description)||mb_strlen($description)>500)respond(400,['error'=>'اطلاعات درخواست نامعتبر است']);
            $eligible=$type==='annual_leave'&&$unit==='daily';
            if($sub!==null&&(!$eligible||!is_int($sub)||$sub===$uid))respond(400,['error'=>'جانشین فقط برای مرخصی استحقاقی روزانه مجاز است']);
            $pdo=Db::pdo();$pdo->beginTransaction();
            try {
                // Serializes overlapping reservations and approvals within this company.
                Db::one('SELECT id FROM companies WHERE id=? FOR UPDATE',[$cid]);
                $requester=Db::one('SELECT z.requires_substitute FROM users u LEFT JOIN zones z ON z.id=u.zone_id AND z.company_id=u.company_id WHERE u.id=? AND u.company_id=?',[$uid,$cid]);
                $replacing=Db::one('SELECT id FROM substitute_assignments WHERE company_id=? AND substitute_user_id=? AND from_date<=? AND to_date>=? LIMIT 1',[$cid,$uid,$to,$from]);
                if($eligible&&!empty($requester['requires_substitute'])&&$sub===null&&!$replacing)self::reject($pdo,400,'برای این منطقه جانشین الزامی است');
                if($sub!==null){
                    $candidate=Db::one('SELECT active,can_be_substitute FROM users WHERE company_id=? AND id=?',[$cid,$sub]);
                    if(!$candidate||!$candidate['active']||!$candidate['can_be_substitute'])self::reject($pdo,404,'جانشین مجاز یافت نشد');
                    if(!self::available($cid,$sub,$from,$to))self::reject($pdo,409,'جانشین در این بازه در دسترس نیست');
                }
                Db::run('INSERT INTO personnel_requests(company_id,user_id,type,work_date,end_date,unit,minutes,description,substitute_user_id) VALUES(?,?,?,?,?,?,?,?,?)',
                    [$cid,$uid,$type,$from,$to,$unit,$minutes,$description,$sub]);
                $id=(int)$pdo->lastInsertId();self::audit($user,'request.create',$id);
                $pdo->commit();respond(201,['id'=>$id,'status'=>'pending']);
            }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        }
        if(preg_match('#^/api/requests/(\d+)/decision$#',$path,$match)&&$method==='POST'){
            if($user['role']==='employee')respond(403,['error'=>'دسترسی مدیریتی لازم است']);
            $b=jsonBody();$status=$b['status']??null;
            if(!in_array($status,['approved','rejected'],true))respond(400,['error'=>'تصمیم نامعتبر است']);
            $pdo=Db::pdo();$pdo->beginTransaction();
            try{
                Db::one('SELECT id FROM companies WHERE id=? FOR UPDATE',[$cid]);
                $id=(int)$match[1];$target=Db::one('SELECT * FROM personnel_requests WHERE company_id=? AND id=? FOR UPDATE',[$cid,$id]);
                if(!$target)self::reject($pdo,404,'درخواست یافت نشد');
                if((int)$target['user_id']===$uid)self::reject($pdo,403,'تأیید درخواست خود مجاز نیست');
                if($target['status']!=='pending')self::reject($pdo,409,'درخواست قبلاً بررسی شده است');
                $step=(int)Db::one('SELECT COUNT(*) n FROM request_decisions WHERE company_id=? AND request_id=?',[$cid,$id])['n']+1;
                $steps=(int)PersonnelApi::settings($cid)['approval_steps'];
                if($step>$steps)self::reject($pdo,409,'مراحل تأیید تکمیل شده است');
                if($steps===2){
                    $managerCount=(int)Db::one("SELECT COUNT(*) n FROM users WHERE company_id=? AND role='manager' AND active=1",[$cid])['n'];
                    if($step===1&&$user['role']!=='manager'&&!($user['role']==='owner'&&$managerCount===0))self::reject($pdo,403,'مرحله اول با مدیر میانی است');
                    if($step===2&&$user['role']!=='owner')self::reject($pdo,403,'مرحله نهایی با مدیر شرکت است');
                }
                if($status==='approved'&&$step===$steps&&$target['type']==='annual_leave'){
                    foreach(self::annualByYear([$target]) as $year=>$minutes){
                        $balance=self::balance($cid,(int)$target['user_id'],(int)$year,$id);
                        if($minutes>$balance['remaining_minutes'])self::reject($pdo,409,'مانده مرخصی استحقاقی کافی نیست');
                    }
                }
                if($status==='approved'&&$step===$steps&&$target['type']==='annual_leave'&&$target['unit']==='daily'&&$target['substitute_user_id']!==null){
                    $sub=(int)$target['substitute_user_id'];$candidate=Db::one('SELECT active,can_be_substitute FROM users WHERE company_id=? AND id=?',[$cid,$sub]);
                    if(!$candidate||!$candidate['active']||!$candidate['can_be_substitute']||!self::available($cid,$sub,$target['work_date'],$target['end_date'],$id))
                        self::reject($pdo,409,'جانشین دیگر در دسترس نیست');
                    Db::run('INSERT INTO substitute_assignments(company_id,request_id,substitute_user_id,absent_user_id,from_date,to_date) VALUES(?,?,?,?,?,?)',
                        [$cid,$id,$sub,$target['user_id'],$target['work_date'],$target['end_date']]);
                }
                Db::run('INSERT INTO request_decisions(company_id,request_id,stage,actor_user_id,outcome) VALUES(?,?,?,?,?)',[$cid,$id,$step,$uid,$status]);
                $final=$status==='rejected'?'rejected':($step===$steps?'approved':'pending');
                if($final!=='pending')Db::run('UPDATE personnel_requests SET status=?,decided_by=?,decided_at=? WHERE company_id=? AND id=?',
                    [$final,$uid,gmdate('Y-m-d\TH:i:s').'.000Z',$cid,$id]);
                self::audit($user,'request.'.$status,$id);
                $pdo->commit();respond(200,['ok'=>true,'status'=>$final,'stage'=>$step,'total_steps'=>$steps]);
            }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        }
        return false;
    }
}
