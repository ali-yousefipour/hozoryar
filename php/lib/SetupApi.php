<?php
declare(strict_types=1);
require_once __DIR__.'/Db.php';

final class SetupApi {
    public static function handle(string $path,string $method,array $user): bool {
        if($path!=='/api/setup'||$method!=='GET')return false;
        if(!in_array($user['role'],['owner','manager'],true))respond(403,['error'=>'دسترسی مدیریتی لازم است']);
        $cid=(int)$user['company_id'];
        $counts=[];
        $queries=[
            'workplaces'=>'SELECT COUNT(*) n FROM zones WHERE company_id=?',
            'shifts'=>'SELECT COUNT(*) n FROM shifts WHERE company_id=?',
            'personnel'=>"SELECT COUNT(*) n FROM users WHERE company_id=? AND active=1 AND role<>'owner'",
            'assigned'=>"SELECT COUNT(*) n FROM assignments a JOIN users u ON u.company_id=a.company_id AND u.id=a.user_id WHERE a.company_id=? AND u.active=1 AND u.role<>'owner'",
            'attendance'=>'SELECT COUNT(*) n FROM attendance WHERE company_id=?',
            'pending'=>"SELECT COUNT(*) n FROM personnel_requests WHERE company_id=? AND status='pending'",
            'incomplete'=>"SELECT COUNT(*) n FROM attendance WHERE company_id=? AND checked_out_at IS NULL AND checked_in_at<?",
        ];
        $today=(new DateTimeImmutable('today',new DateTimeZone('Asia/Tehran')))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
        foreach($queries as $key=>$sql)$counts[$key]=(int)Db::one($sql,$key==='incomplete'?[$cid,$today]:[$cid])['n'];
        $steps=[];
        foreach(['workplaces','shifts','personnel','assigned','attendance'] as $key)$steps[$key]=$counts[$key]>0;
        $steps['assigned']=$counts['personnel']>0&&$counts['assigned']===$counts['personnel'];
        respond(200,['counts'=>$counts,'steps'=>$steps,'completed'=>count(array_filter($steps)),'total'=>count($steps)]);
    }
}
