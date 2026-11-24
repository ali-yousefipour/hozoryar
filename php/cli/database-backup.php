<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(403);exit;}
require_once dirname(__DIR__).'/lib/Db.php';
require_once dirname(__DIR__).'/lib/DatabaseBackup.php';
[$script,$mode,$path]=array_pad($argv,3,'');$password=getenv('HOZORYAR_BACKUP_PASSWORD')?:'';
try{
    if(!in_array($mode,['create','verify','restore'],true)||$path===''||strlen($password)<16)
        throw new RuntimeException('Usage: php php/cli/database-backup.php create|verify|restore /private/file.zip; set HOZORYAR_BACKUP_PASSWORD (16+ characters)');
    $parent=realpath(dirname($path));$public=realpath(dirname(__DIR__).'/app');
    if(!$parent||str_starts_with(strtolower(str_replace('\\','/',$parent).'/'),strtolower(str_replace('\\','/',$public).'/')))
        throw new RuntimeException('Use an existing private directory outside the web root');
    if($mode==='restore'&&!in_array('--empty-target-confirm',$argv,true))throw new RuntimeException('Restore requires --empty-target-confirm and a separate empty migrated database; keep its web service stopped');
    $manifest=match($mode){'create'=>DatabaseBackup::write(Db::pdo(),$path,$password),'verify'=>DatabaseBackup::inspect($path,$password),'restore'=>DatabaseBackup::restore(Db::pdo(),$path,$password)};
    echo json_encode(['ok'=>true,'mode'=>$mode,'tables'=>count($manifest['tables']),'rows'=>array_sum(array_column($manifest['tables'],'rows'))],JSON_THROW_ON_ERROR)."\n";
}catch(Throwable $e){fwrite(STDERR,$e->getMessage()."\n");exit(1);}
