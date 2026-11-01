<?php
declare(strict_types=1);
require_once __DIR__ . '/CalendarApi.php';

final class DashboardApi {
    public static function handle(string $path,string $method,array $user): bool {
        if($path!=='/api/dashboard'||$method!=='GET')return false;
        if($user['role']==='employee')respond(403,['error'=>'دسترسی مدیریتی لازم است']);
        $cid=(int)$user['company_id'];
        $today=gmdate('Y-m-d',time()+12600);
        $from=$_GET['from']??gmdate('Y-m-d',time()+12600-6*86400);
        $to=$_GET['to']??$today;
        if(!CalendarApi::validRange($from,$to))respond(400,['error'=>'بازه آمار نامعتبر است']);
        $total=(int)Db::one('SELECT COUNT(*) n FROM users WHERE company_id=? AND active=1',[$cid])['n'];
        $present=(int)Db::one('SELECT COUNT(DISTINCT u.id) n FROM users u JOIN attendance a ON a.company_id=u.company_id AND a.user_id=u.id
          WHERE u.company_id=? AND u.active=1 AND a.checked_out_at IS NULL',[$cid])['n'];
        $dateExpr="DATE(DATE_ADD(STR_TO_DATE(SUBSTRING(a.checked_in_at,1,19),'%Y-%m-%dT%H:%i:%s'),INTERVAL 210 MINUTE))";
        $arrivals=Db::all("SELECT $dateExpr day,COUNT(*) sessions,COUNT(DISTINCT a.user_id) employees
          FROM attendance a JOIN users u ON u.id=a.user_id AND u.company_id=a.company_id
          WHERE a.company_id=? AND u.active=1 AND $dateExpr BETWEEN ? AND ?
          GROUP BY day ORDER BY day",[$cid,$from,$to]);
        foreach($arrivals as &$row){$row['sessions']=(int)$row['sessions'];$row['employees']=(int)$row['employees'];}unset($row);
        respond(200,['total'=>$total,'present'=>$present,'absent'=>max(0,$total-$present),
          'company'=>$user['company_name'],'period'=>['from'=>$from,'to'=>$to],'arrivals'=>$arrivals]);
    }
}
