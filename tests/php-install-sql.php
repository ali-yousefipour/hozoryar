<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit(1);
$file=getenv('HOZORYAR_CONFIG');
if(!$file||!is_file($file))throw new RuntimeException('Explicit isolated test configuration required');
$config=require $file;
if(!str_starts_with($config['db_name']??'','hozoryar_test_'))throw new RuntimeException('Dedicated test database required');
require dirname(__DIR__).'/php/lib/Db.php';
$pdo=Db::pdo();
if($pdo->query('SHOW TABLES')->fetchColumn()!==false)throw new RuntimeException('Fresh-install test requires an EMPTY test database');
$sql=file_get_contents(dirname(__DIR__).'/php/db/migrations/hozoryar-install.sql');
$pdo->exec($sql);
$expected=count(glob(dirname(__DIR__).'/php/db/[0-9][0-9][0-9]_*.sql'));
$rows=Db::all('SELECT name,checksum,status FROM schema_migrations ORDER BY name');
if(count($rows)!==$expected)throw new RuntimeException('Missing migration records after import');
foreach($rows as $row){
    $source=file_get_contents(dirname(__DIR__).'/php/db/'.$row['name']);
    if($row['status']!=='applied'||$row['checksum']!==hash('sha256',str_replace(["\r\n","\r"],"\n",$source)))
        throw new RuntimeException('Imported migration status or checksum differs');
}
foreach(['users','companies','platform_admins'] as $table)
    if((int)$pdo->query('SELECT COUNT(*) FROM '.$table)->fetchColumn()!==0)throw new RuntimeException('Install SQL must not contain accounts or live data');
$tables=$pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
$rejected=false;
try{$pdo->exec($sql);}catch(PDOException $error){$rejected=$error->getCode()==='42S01';}
if(!$rejected||$tables!==$pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN))throw new RuntimeException('Repeated import must fail without replacing tables');
echo "Fresh SQL import verified: $expected migrations; empty accounts; repeated import rejected.\n";
