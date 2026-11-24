<?php
declare(strict_types=1);

/** Encrypted, checksummed data backup. Restore accepts only an empty migrated schema. */
final class DatabaseBackup {
    private static function tables(PDO $pdo): array {
        $rows=$pdo->query("SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME")->fetchAll();
        $names=[];
        foreach($rows as $row){
            if($row['ENGINE']!=='InnoDB'||!preg_match('/^[a-z_][a-z0-9_]*$/',$row['TABLE_NAME']))throw new RuntimeException('Only InnoDB application tables are supported');
            if($row['TABLE_NAME']!=='schema_migrations')$names[]=$row['TABLE_NAME'];
        }
        sort($names);return $names;
    }
    private static function columns(PDO $pdo,string $table): array {
        $query=$pdo->prepare('SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION');
        $query->execute([$table]);return $query->fetchAll();
    }
    private static function migrations(PDO $pdo): array {
        return $pdo->query('SELECT name,checksum,status FROM schema_migrations ORDER BY name')->fetchAll();
    }
    private static function lock(PDO $pdo): void {
        if(!(int)$pdo->query("SELECT GET_LOCK('hozoryar_schema_migrations',10)")->fetchColumn())throw new RuntimeException('Schema is busy');
    }
    public static function write(PDO $pdo,string $path,string $password): array {
        if(strlen($password)<16)throw new RuntimeException('Backup password must contain at least 16 characters');
        if(file_exists($path))throw new RuntimeException('Backup already exists; choose a new filename');
        self::lock($pdo);$temp=[];$zip=new ZipArchive();$opened=false;$success=false;
        try{
            if($zip->open($path,ZipArchive::CREATE|ZipArchive::EXCL)!==true)throw new RuntimeException('Cannot create backup');
            $opened=true;$manifest=['format'=>'hozoryar-mysql-v1','created_at'=>gmdate('c'),'migrations'=>self::migrations($pdo),'tables'=>[]];
            $pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');$pdo->beginTransaction();
            foreach(self::tables($pdo) as $table){
                $file=tempnam(dirname($path),'hzbackup_');if($file===false)throw new RuntimeException('Cannot create temporary file');$temp[]=$file;
                chmod($file,0600);$out=fopen($file,'wb');if(!$out)throw new RuntimeException('Cannot write backup');
                $meta=['columns'=>self::columns($pdo,$table),'rows'=>0];
                $query=$pdo->query("SELECT * FROM `$table`");
                try{while($row=$query->fetch()){
                    $line=json_encode($row,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)."\n";
                    if(strlen($line)>16*1024*1024||fwrite($out,$line)!==strlen($line))throw new RuntimeException('Backup row too large or disk write failed');
                    $meta['rows']++;
                }}finally{fclose($out);$query->closeCursor();}
                $meta['sha256']=hash_file('sha256',$file);$manifest['tables'][$table]=$meta;
                $entry="data/$table.ndjson";
                if(!$zip->addFile($file,$entry)||!$zip->setEncryptionName($entry,ZipArchive::EM_AES_256,$password))throw new RuntimeException('AES ZIP encryption is unavailable');
            }
            $pdo->commit();
            $zip->addFromString('manifest.json',json_encode($manifest,JSON_THROW_ON_ERROR|JSON_UNESCAPED_SLASHES));
            if(!$zip->setEncryptionName('manifest.json',ZipArchive::EM_AES_256,$password)||!$zip->close())throw new RuntimeException('Cannot finalize encrypted backup');
            $opened=false;chmod($path,0600);self::inspect($path,$password);$success=true;return $manifest;
        }finally{
            if($pdo->inTransaction())$pdo->rollBack();if($opened)$zip->close();
            foreach($temp as $file)if(is_file($file))unlink($file);
            if(!$success&&is_file($path))unlink($path);
            $pdo->query("SELECT RELEASE_LOCK('hozoryar_schema_migrations')");
        }
    }
    private static function open(string $path,string $password): ZipArchive {
        $zip=new ZipArchive();if($zip->open($path)!==true)throw new RuntimeException('Cannot open backup');
        $zip->setPassword($password);return $zip;
    }
    public static function inspect(string $path,string $password): array {
        $zip=self::open($path,$password);
        try{
            $raw=$zip->getFromName('manifest.json',4*1024*1024);
            if($raw===false)throw new RuntimeException('Wrong password or unreadable manifest');
            $manifest=json_decode($raw,true,512,JSON_THROW_ON_ERROR);
            if(($manifest['format']??'')!=='hozoryar-mysql-v1'||!is_array($manifest['tables']??null)||!is_array($manifest['migrations']??null))throw new RuntimeException('Invalid backup manifest');
            $total=0;
            foreach($manifest['tables'] as $table=>$meta){
                if(!preg_match('/^[a-z_][a-z0-9_]*$/',$table)||!is_array($meta['columns']??null)||!is_int($meta['rows']??null))throw new RuntimeException('Invalid table metadata');
                $stream=$zip->getStream("data/$table.ndjson");if(!$stream)throw new RuntimeException('Missing backup data');
                $hash=hash_init('sha256');$rows=0;
                try{while(!feof($stream)){
                    $line=fgets($stream,16*1024*1024+2);if($line===false)break;
                    $total+=strlen($line);if($total>1024*1024*1024||!str_ends_with($line,"\n"))throw new RuntimeException('Backup exceeds supported size');
                    json_decode($line,true,512,JSON_THROW_ON_ERROR);hash_update($hash,$line);$rows++;
                }}finally{fclose($stream);}
                if($rows!==$meta['rows']||!hash_equals($meta['sha256']??'',hash_final($hash)))throw new RuntimeException('Backup checksum or row count mismatch');
            }
            return $manifest;
        }finally{$zip->close();}
    }
    public static function restore(PDO $pdo,string $path,string $password): array {
        $manifest=self::inspect($path,$password);self::lock($pdo);$zip=null;
        try{
            $tables=self::tables($pdo);$source=array_keys($manifest['tables']);sort($source);
            if($tables!==$source||self::migrations($pdo)!==$manifest['migrations'])throw new RuntimeException('Target must have exactly the same migrated schema');
            foreach($tables as $table)if(self::columns($pdo,$table)!==$manifest['tables'][$table]['columns'])throw new RuntimeException('Target column schema differs');
            $deps=array_fill_keys($tables,[]);
            foreach($pdo->query('SELECT TABLE_NAME,REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL')->fetchAll() as $fk){
                if($fk['TABLE_NAME']!==$fk['REFERENCED_TABLE_NAME'])$deps[$fk['TABLE_NAME']][]=$fk['REFERENCED_TABLE_NAME'];
            }
            $order=[];while($deps){$progress=false;foreach($deps as $table=>$parents){if(array_diff($parents,$order))continue;$order[]=$table;unset($deps[$table]);$progress=true;}if(!$progress)throw new RuntimeException('Cyclic foreign keys require a separate migration plan');}
            $pdo->beginTransaction();
            // No DELETE, TRUNCATE, schema DDL or disabled foreign-key checks are used.
            foreach($tables as $table)if((int)$pdo->query("SELECT COUNT(*) FROM `$table`")->fetchColumn()!==0)throw new RuntimeException('Target is not empty; existing data is preserved');
            $zip=self::open($path,$password);
            foreach($order as $table){
                $columns=array_column($manifest['tables'][$table]['columns'],'COLUMN_NAME');
                $names=implode(',',array_map(static fn($c)=>'`'.$c.'`',$columns));
                $statement=$pdo->prepare("INSERT INTO `$table` ($names) VALUES (".implode(',',array_fill(0,count($columns),'?')).')');
                $stream=$zip->getStream("data/$table.ndjson");if(!$stream)throw new RuntimeException('Cannot read backup data');
                try{while(($line=fgets($stream,16*1024*1024+2))!==false){$row=json_decode($line,true,512,JSON_THROW_ON_ERROR);
                    if(array_keys($row)!==$columns)throw new RuntimeException('Backup column mismatch');$statement->execute(array_values($row));
                }}finally{fclose($stream);}
                if((int)$pdo->query("SELECT COUNT(*) FROM `$table`")->fetchColumn()!==$manifest['tables'][$table]['rows'])throw new RuntimeException('Restored row count mismatch');
            }
            $pdo->commit();return $manifest;
        }finally{if($pdo->inTransaction())$pdo->rollBack();if($zip)$zip->close();$pdo->query("SELECT RELEASE_LOCK('hozoryar_schema_migrations')");}
    }
}
