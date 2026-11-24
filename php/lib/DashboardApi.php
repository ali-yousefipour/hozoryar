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
        $personnel=Db::all('SELECT u.id,u.name,z.name workplace,MAX(a.checked_in_at) checked_in_at FROM users u
          LEFT JOIN attendance a ON a.company_id=u.company_id AND a.user_id=u.id AND a.checked_out_at IS NULL
          LEFT JOIN zones z ON z.company_id=u.company_id AND z.id=u.zone_id
          WHERE u.company_id=? AND u.active=1 GROUP BY u.id,u.name,z.name ORDER BY u.name',[$cid]);
        $approved=Db::all("SELECT DISTINCT r.user_id id,u.name,(r.type='mission') mission
          FROM personnel_requests r JOIN users u ON u.company_id=r.company_id AND u.id=r.user_id
          WHERE r.company_id=? AND u.active=1 AND r.status='approved' AND ? BETWEEN r.work_date AND r.end_date
          ORDER BY u.name",[$cid,$today]);
        $leavePeople=[];$missionPeople=[];$excused=[];
        foreach($approved as $person){
            $id=(int)$person['id'];$excused[$id]=true;
            $entry=['id'=>$id,'name'=>$person['name']];
            if($person['mission'])$missionPeople[]=$entry;else $leavePeople[]=$entry;
        }
        $presentPeople=[];$absentPeople=[];
        foreach($personnel as $person){
            $person['id']=(int)$person['id'];
            if($person['checked_in_at']!==null)$presentPeople[]=$person;else $absentPeople[]=$person;
        }
        respond(200,['total'=>$total,'present'=>$present,'absent'=>max(0,$total-$present),
          'present_people'=>$presentPeople,'absent_people'=>$absentPeople,
          'unexcused_people'=>array_values(array_filter($absentPeople,static fn($p)=>!isset($excused[$p['id']]))),
          'leave_people'=>$leavePeople,'mission_people'=>$missionPeople,
          'company'=>$user['company_name'],'period'=>['from'=>$from,'to'=>$to],'arrivals'=>$arrivals]);
    }
}
