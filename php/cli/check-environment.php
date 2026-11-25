<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(403);exit;}
require_once dirname(__DIR__).'/lib/Db.php';
$checks=['php_83'=>PHP_VERSION_ID>=80300];
foreach(['pdo_mysql','mbstring','intl','curl','zip'] as $ext)$checks['extension_'.$ext]=extension_loaded($ext);
$checks['encrypted_zip']=class_exists('ZipArchive')&&ZipArchive::isEncryptionMethodSupported(ZipArchive::EM_AES_256,true);
try{
    $pdo=Db::pdo();$checks['mysql_connection']=$pdo->getAttribute(PDO::ATTR_DRIVER_NAME)==='mysql';
    $applied=Db::all('SELECT name,checksum,status FROM schema_migrations');$byName=array_column($applied,null,'name');
    $checks['migrations']=true;
    foreach(glob(dirname(__DIR__).'/db/*.sql') as $file){$row=$byName[basename($file)]??null;
        $canonical=hash('sha256',str_replace(["\r\n","\r"],"\n",file_get_contents($file)));
        if(!$row||$row['status']!=='applied'||(!hash_equals($row['checksum'],$canonical)&&!hash_equals($row['checksum'],hash_file('sha256',$file))))$checks['migrations']=false;}
}catch(Throwable $e){$checks['mysql_schema']=false;}
if(in_array('--online',$argv,true)){
    try{require_once dirname(__DIR__).'/lib/CalendarApi.php';$today=(new DateTimeImmutable('now',new DateTimeZone('Asia/Tehran')))->format('Y-m-d');
        $calendar=CalendarApi::official($today,$today);$checks['verified_calendar']=!$calendar['stale'];
    }catch(Throwable $e){$checks['verified_calendar']=false;}
}
$ok=!in_array(false,$checks,true);echo json_encode(['ok'=>$ok,'checks'=>$checks],JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES)."\n";exit($ok?0:1);
