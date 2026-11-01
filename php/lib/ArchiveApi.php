<?php
declare(strict_types=1);
require_once __DIR__ . '/WorkReportApi.php';
require_once __DIR__ . '/XlsxExport.php';

final class ArchiveApi {
    private static function admin(array $user): void {if($user['role']==='employee')respond(403,['error'=>'دسترسی مدیریتی لازم است']);}
    private static function owner(array $user): void {if($user['role']!=='owner')respond(403,['error'=>'فقط مدیر شرکت مجاز است']);}
    private static function fail(PDO $pdo,int $status,string $error): never {
        if($pdo->inTransaction())$pdo->rollBack();respond($status,['error'=>$error]);
    }
    private static function audit(array $user,string $action): void {
        Db::run('INSERT INTO audit_logs(company_id,actor_user_id,action,target_type,target_id) VALUES(?,?,?,?,NULL)',
          [$user['company_id'],$user['id'],$action,'work_month']);
    }
    private static function bounds(string $month): array {
        if(preg_match('/^(\d{4})-(0[1-9]|1[0-2])$/',$month,$m)){
            $from=$month.'-01';$to=(new DateTimeImmutable($from,new DateTimeZone('UTC')))->modify('last day of this month')->format('Y-m-d');
        }elseif(preg_match('/^j-(1[34]\d{2})-(0[1-9]|1[0-2])$/',$month,$m)){
            $year=(int)$m[1];$target=$m[1].'-'.$m[2];$start=new DateTimeImmutable(($year+621).'-03-17',new DateTimeZone('UTC'));
            $from=null;$to=null;
            for($i=0;$i<380;$i++){$d=$start->modify('+'.$i.' day')->format('Y-m-d');
                if(substr(CalendarApi::jalali($d),0,7)===$target){$from??=$d;$to=$d;}
                elseif($from!==null)break;}
            if($from===null)respond(400,['error'=>'ماه شمسی نامعتبر است']);
        }else respond(400,['error'=>'ماه نامعتبر است']);
        if($to>=gmdate('Y-m-d',time()+12600))respond(409,['error'=>'فقط ماه پایان‌یافته قابل بایگانی است']);
        return ['from'=>$from,'to'=>$to];
    }
    private static function preview(array $snapshot,bool $include): array {
        $items=[];
        foreach($snapshot['reports'] as $entry){
            $totals=$entry['report']['totals'];$overtime=(int)($totals['total_overtime']??0);
            $mission=(int)($totals['mission']??0);$shortage=(int)($totals['shortage']??0);$surplus=(int)($totals['surplus']??0);
            $items[]=['user_id'=>$entry['id'],'name'=>$entry['name'],'overtime_minutes'=>$overtime,
                'mission_minutes'=>$mission,'shortage_minutes'=>$shortage,'surplus_minutes'=>$surplus,
                'payable_minutes'=>max(0,$overtime+$mission-$shortage+($include?$surplus:0))];
        }
        return $items;
    }
    public static function handle(string $path,string $method,array $user): bool {
        $cid=(int)$user['company_id'];$uid=(int)$user['id'];
        if($path==='/api/work-months'&&$method==='GET'){
            self::admin($user);
            respond(200,['items'=>Db::all("SELECT a.month,a.created_at,a.created_by,COALESCE(r.status,'pending_review') review_status,
                CASE WHEN f.month IS NULL THEN 0 ELSE 1 END finance_confirmed FROM work_month_archives a
                LEFT JOIN work_month_reviews r ON r.company_id=a.company_id AND r.month=a.month
                LEFT JOIN work_month_finance f ON f.company_id=a.company_id AND f.month=a.month
                WHERE a.company_id=? ORDER BY a.month DESC LIMIT 36",[$cid])]);
        }
        if($path==='/api/work-months/finalize'&&$method==='POST'){
            self::owner($user);$b=jsonBody();$month=$b['month']??null;
            if(!is_string($month))respond(400,['error'=>'ماه نامعتبر است']);
            ['from'=>$from,'to'=>$to]=self::bounds($month);
            try{$official=CalendarApi::official($from,$to);}
            catch(Throwable $e){respond(503,['error'=>'تقویم معتبر برای بایگانی موجود نیست']);}
            $pdo=Db::pdo();$pdo->beginTransaction();
            try{
                Db::one('SELECT id FROM companies WHERE id=? FOR UPDATE',[$cid]);
                if(Db::one('SELECT month FROM work_month_archives WHERE company_id=? AND month=?',[$cid,$month]))self::fail($pdo,409,'این ماه قبلاً بایگانی شده است');
                $pending=(int)Db::one("SELECT COUNT(*) n FROM personnel_requests WHERE company_id=? AND status='pending' AND work_date<=? AND end_date>=?",[$cid,$to,$from])['n'];
                if($pending)self::fail($pdo,409,'درخواست بررسی‌نشده در این ماه وجود دارد');
                $after=(new DateTimeImmutable($to,new DateTimeZone('Asia/Tehran')))->modify('+1 day')->format('Y-m-d');
                $cutoff=(new DateTimeImmutable($after.' 00:00:00',new DateTimeZone('Asia/Tehran')))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s').'.000Z';
                $open=(int)Db::one('SELECT COUNT(*) n FROM attendance WHERE company_id=? AND checked_in_at<? AND checked_out_at IS NULL',[$cid,$cutoff])['n'];
                if($open)self::fail($pdo,409,'تردد بدون خروج وجود دارد؛ پیش از بایگانی اصلاح شود');
                $people=Db::all('SELECT id,name,role FROM users WHERE company_id=? AND active=1 ORDER BY id',[$cid]);
                $reports=[];
                foreach($people as $person){$person['report']=WorkReportApi::build($cid,(int)$person['id'],$from,$to,$official);$reports[]=$person;}
                $snapshot=['month'=>$month,'calendar'=>str_starts_with($month,'j-')?'jalali':'gregorian',
                    'from'=>$from,'to'=>$to,'status'=>'archived','authoritative'=>false,'official_calendar_available'=>true,
                    'official_calendar_status'=>$official['status'],'official_calendar_stale'=>$official['stale'],
                    'official_calendar_estimated'=>$official['estimated'],
                    'note'=>'گزارش ثابت ولی غیرقطعی حقوق؛ تقویم مستقل رسمی یا کش معتبر استفاده شد.','reports'=>$reports];
                Db::run('INSERT INTO work_month_archives(company_id,month,snapshot_json,created_by) VALUES(?,?,?,?)',
                    [$cid,$month,json_encode($snapshot,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),$uid]);
                Db::run('INSERT INTO work_month_reviews(company_id,month) VALUES(?,?)',[$cid,$month]);
                self::audit($user,'work_month.archive');$pdo->commit();
                respond(201,['ok'=>true,'month'=>$month,'users'=>count($people),'status'=>'archived','authoritative'=>false]);
            }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
        }
        if(preg_match('#^/api/work-months/((?:j-)?\d{4}-\d{2})(?:/(review|approve|payroll-preview|finance-confirm|xlsx))?$#',$path,$match)){
            self::admin($user);$month=$match[1];$action=$match[2]??null;self::bounds($month);
            if($action==='xlsx'&&$method==='GET'){
                $row=Db::one('SELECT snapshot_json FROM work_month_archives WHERE company_id=? AND month=?',[$cid,$month]);
                if(!$row)respond(404,['error'=>'بایگانی یافت نشد']);
                $data=XlsxExport::bytes(json_decode($row['snapshot_json'],true,512,JSON_THROW_ON_ERROR));
                header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                header('Content-Disposition: attachment; filename="hozoryar-'.$month.'.xlsx"');
                header('Content-Length: '.strlen($data));
                echo $data;exit;
            }
            if($action==='review'||$action==='approve'){
                if($method!=='POST')return false;
                if($action==='approve')self::owner($user);
                $pdo=Db::pdo();$pdo->beginTransaction();
                try{
                    Db::one('SELECT id FROM companies WHERE id=? FOR UPDATE',[$cid]);
                    $row=Db::one('SELECT status FROM work_month_reviews WHERE company_id=? AND month=? FOR UPDATE',[$cid,$month]);
                    if(!$row)self::fail($pdo,404,'بایگانی یافت نشد');
                    if($action==='review'){
                        if($row['status']!=='pending_review')self::fail($pdo,409,'این دوره قبلاً بررسی شده است');
                        $managers=(int)Db::one("SELECT COUNT(*) n FROM users WHERE company_id=? AND role='manager' AND active=1",[$cid])['n'];
                        if($managers>0&&$user['role']!=='manager')self::fail($pdo,403,'بررسی اولیه با مدیر میانی است');
                        Db::run("UPDATE work_month_reviews SET status='reviewed',reviewer_user_id=?,reviewed_at=? WHERE company_id=? AND month=?",
                            [$uid,gmdate('Y-m-d\TH:i:s').'.000Z',$cid,$month]);
                    }else{
                        if($row['status']!=='reviewed')self::fail($pdo,409,'ابتدا بررسی اولیه لازم است');
                        Db::run("UPDATE work_month_reviews SET status='approved',approver_user_id=?,approved_at=? WHERE company_id=? AND month=?",
                            [$uid,gmdate('Y-m-d\TH:i:s').'.000Z',$cid,$month]);
                    }
                    self::audit($user,'work_month.'.$action);$pdo->commit();respond(200,['ok'=>true,'status'=>$action==='review'?'reviewed':'approved','authoritative'=>false]);
                }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
            }
            if($action==='payroll-preview'||$action==='finance-confirm'){
                if($method!==($action==='payroll-preview'?'GET':'POST'))return false;
                if($action==='finance-confirm')self::owner($user);
                $input=$method==='POST'?jsonBody():['include_surplus'=>($_GET['include_surplus']??null)==='1'];
                if(!is_bool($input['include_surplus']??null))respond(400,['error'=>'سیاست مازاد حضور مشخص نیست']);
                if($action==='finance-confirm'&&(($input['confirm']??null)!==true||!is_string($input['note']??null)||trim($input['note'])===''||mb_strlen($input['note'])>500))
                    respond(400,['error'=>'تأیید صریح و توضیح مالی لازم است']);
                $pdo=Db::pdo();if($action==='finance-confirm')$pdo->beginTransaction();
                try{
                    if($action==='finance-confirm')Db::one('SELECT id FROM companies WHERE id=? FOR UPDATE',[$cid]);
                    $row=Db::one('SELECT a.snapshot_json,r.status review_status FROM work_month_archives a
                        LEFT JOIN work_month_reviews r ON r.company_id=a.company_id AND r.month=a.month WHERE a.company_id=? AND a.month=?',[$cid,$month]);
                    if(!$row){if($pdo->inTransaction())self::fail($pdo,404,'بایگانی یافت نشد');respond(404,['error'=>'بایگانی یافت نشد']);}
                    $snapshot=json_decode($row['snapshot_json'],true,512,JSON_THROW_ON_ERROR);
                    $preview=self::preview($snapshot,$input['include_surplus']);$digest=hash('sha256',$row['snapshot_json']);
                    $existing=Db::one('SELECT month FROM work_month_finance WHERE company_id=? AND month=?',[$cid,$month]);
                    if($action==='finance-confirm'){
                        if($row['review_status']!=='approved')self::fail($pdo,409,'ابتدا تأیید مدیریتی لازم است');
                        if(!empty($snapshot['official_calendar_stale'])||!empty($snapshot['official_calendar_estimated']))self::fail($pdo,409,'تقویم رسمی نیازمند بازبینی است');
                        if($existing)self::fail($pdo,409,'تأیید مالی قبلاً ثبت شده است');
                        Db::run('INSERT INTO work_month_finance(company_id,month,snapshot_sha256,include_surplus,payroll_json,confirmed_by) VALUES(?,?,?,?,?,?)',
                          [$cid,$month,$digest,(int)$input['include_surplus'],json_encode(['note'=>$input['note'],'items'=>$preview],JSON_UNESCAPED_UNICODE),$uid]);
                        self::audit($user,'work_month.finance_confirm');$pdo->commit();
                        respond(201,['ok'=>true,'month'=>$month,'financially_confirmed'=>true,'snapshot_sha256'=>$digest,'authoritative'=>false]);
                    }
                    respond(200,['month'=>$month,'include_surplus'=>$input['include_surplus'],'items'=>$preview,
                        'snapshot_sha256'=>$digest,'financially_confirmed'=>$existing!==null,
                        'note'=>'مبنای دقیقه‌ای کارکرد، بدون محاسبه مبلغ حقوق و کسورات بیمه و مالیات.']);
                }catch(Throwable $e){if($pdo->inTransaction())$pdo->rollBack();throw $e;}
            }
            if($action===null&&$method==='GET'){
                $row=Db::one('SELECT a.snapshot_json,a.created_at,a.created_by,COALESCE(r.status,\'pending_review\') review_status,
                  r.reviewer_user_id,r.reviewed_at,r.approver_user_id,r.approved_at,
                  f.snapshot_sha256 finance_digest,f.include_surplus finance_include_surplus,f.confirmed_by finance_confirmed_by,
                  f.confirmed_at finance_confirmed_at,f.payroll_json finance_record
                  FROM work_month_archives a LEFT JOIN work_month_reviews r ON r.company_id=a.company_id AND r.month=a.month
                  LEFT JOIN work_month_finance f ON f.company_id=a.company_id AND f.month=a.month
                  WHERE a.company_id=? AND a.month=?',[$cid,$month]);
                if(!$row)respond(404,['error'=>'بایگانی وجود ندارد']);
                $snapshot=json_decode($row['snapshot_json'],true,512,JSON_THROW_ON_ERROR);
                $snapshotDigest=hash('sha256',$row['snapshot_json']);
                $record=$row['finance_record']?json_decode($row['finance_record'],true):null;
                unset($row['snapshot_json'],$row['finance_record']);
                respond(200,array_merge($snapshot,$row,['finance_record'=>$record,
                    'finance_integrity_ok'=>$row['finance_digest']!==null?hash_equals($row['finance_digest'],$snapshotDigest):null]));
            }
        }
        return false;
    }
}
