<?php
declare(strict_types=1);
// Run only with a dedicated, migrated disposable test database.
$config=getenv('HOZORYAR_CONFIG');
if(!$config)exit(1);
$settings=require $config;
if(!str_starts_with($settings['db_name']??'','hozoryar_test_'))throw new RuntimeException('Dedicated test database required');
require dirname(__DIR__).'/php/lib/Db.php';
$pdo=Db::pdo();$pdo->beginTransaction();
$salt=bin2hex(random_bytes(4));$result=[];
foreach(['a','b'] as $key){
    Db::run('INSERT INTO companies(name,slug) VALUES(?,?)',['Report company '.$key,'report-'.$key.'-'.$salt]);$cid=(int)$pdo->lastInsertId();
    Db::run('INSERT INTO company_settings(company_id,features_json) VALUES(?,?)',[$cid,json_encode(['attendance'=>true,'monitoring'=>true,'liveMap'=>true,'shifts'=>true,'sms'=>false])]);
    Db::run('INSERT INTO zones(company_id,name,requires_substitute) VALUES(?,?,0)',[$cid,'Office '.$key]);$zone=(int)$pdo->lastInsertId();
    Db::run("INSERT INTO users(company_id,name,username,password_hash,role,zone_id) VALUES(?,?,?,?,?,?)",[$cid,'Owner '.$key,'admin',password_hash('TestReports!74pass',PASSWORD_DEFAULT),'owner',$zone]);$uid=(int)$pdo->lastInsertId();
    $result[$key]=['company'=>'report-'.$key.'-'.$salt,'user_id'=>$uid,'zone_id'=>$zone];
    Db::run('INSERT INTO attendance(company_id,user_id,checked_in_at,checked_out_at) VALUES(?,?,?,?)',[$cid,$uid,'2026-10-28T04:30:00.000Z','2026-10-28T05:30:00.000Z']);
    if($key==='a'){
        Db::run('INSERT INTO attendance(company_id,user_id,checked_in_at,checked_out_at) VALUES(?,?,?,?)',[$cid,$uid,'2026-10-28T20:00:00.000Z','2026-10-29T04:00:00.000Z']);$result['closed_id']=(int)$pdo->lastInsertId();
        Db::run('INSERT INTO attendance(company_id,user_id,checked_in_at) VALUES(?,?,?)',[$cid,$uid,'2026-10-29T04:30:00.000Z']);
        $result['open_id']=(int)$pdo->lastInsertId();
        foreach([['annual_leave','2026-10-28','2026-10-30','daily',480,'approved'],['mission','2026-10-29','2026-10-29','hourly',120,'approved'],['sick_leave','2026-10-30','2026-10-30','hourly',60,'pending']] as $r)
            Db::run('INSERT INTO personnel_requests(company_id,user_id,type,work_date,end_date,unit,minutes,status) VALUES(?,?,?,?,?,?,?,?)',[$cid,$uid,...$r]);
        Db::run('INSERT INTO location_history(company_id,user_id,lat,lng,accuracy,recorded_at) VALUES(?,?,?,?,?,?)',[$cid,$uid,36.3,59.6,15,'2026-10-28T05:00:00.000Z']);
        Db::run('INSERT INTO users(company_id,name,username,password_hash,role) VALUES(?,?,?,?,?)',[$cid,'Employee a','employee',password_hash('TestReports!74pass',PASSWORD_DEFAULT),'employee']);
        $result['employee_id']=(int)$pdo->lastInsertId();
        Db::run("INSERT INTO users(company_id,name,username,password_hash,role,active) VALUES(?,?,?,?,?,0)",[$cid,'Inactive a','inactive',password_hash('TestReports!74pass',PASSWORD_DEFAULT),'employee']);
        $result['inactive_id']=(int)$pdo->lastInsertId();
        Db::run('UPDATE companies SET max_personnel=2 WHERE id=?',[$cid]);
    }
}
// Synthetic calendar only in the isolated test database. No live cache is touched.
Db::run('INSERT INTO official_calendar_years(jalali_year,payload_json,fetched_at) VALUES(1405,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json),fetched_at=UTC_TIMESTAMP()',[json_encode(['days'=>[],'estimated'=>false])]);
$pdo->commit();echo json_encode($result);
