<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(403);exit;}
require_once dirname(__DIR__).'/lib/Db.php';

$username=getenv('HOZORYAR_PLATFORM_USERNAME')?:'';
$name=getenv('HOZORYAR_PLATFORM_NAME')?:'';
$password=getenv('HOZORYAR_PLATFORM_PASSWORD')?:'';
if(!preg_match('/^[a-zA-Z0-9_.-]{3,60}$/',$username)||trim($name)===''||mb_strlen($name)>160||strlen($password)<12){
    fwrite(STDERR,"Set HOZORYAR_PLATFORM_USERNAME, PLATFORM_NAME and PLATFORM_PASSWORD (12+ characters).\n");exit(1);
}
try{
    Db::run('INSERT INTO platform_admins(username,name,password_hash) VALUES(?,?,?)',
        [$username,trim($name),password_hash($password,PASSWORD_DEFAULT)]);
    echo "Hozoryar platform administrator initialized.\n";
}catch(Throwable $e){fwrite(STDERR,"Could not create administrator (check uniqueness and database setup).\n");exit(1);}
