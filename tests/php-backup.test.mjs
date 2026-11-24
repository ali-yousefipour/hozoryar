import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('MySQL backups are encrypted, verified and never overwrite an existing backup',{
  skip:!process.env.HOZORYAR_PHP_TEST_CONFIG,timeout:30000
},()=>{
  const folder=mkdtempSync(join(tmpdir(),'hz-mysql-backup-')),path=join(folder,'backup.zip');
  const env={...process.env,HOZORYAR_CONFIG:process.env.HOZORYAR_PHP_TEST_CONFIG,HOZORYAR_BACKUP_PASSWORD:'TestBackup!74pQ29m'};
  const run=(mode,password=env.HOZORYAR_BACKUP_PASSWORD)=>spawnSync('php',['php/cli/database-backup.php',mode,path],{env:{...env,HOZORYAR_BACKUP_PASSWORD:password},encoding:'utf8'});
  try{
    const guard=spawnSync('php',['-r',`$c=require getenv('HOZORYAR_CONFIG');exit(str_starts_with($c['db_name'],'hozoryar_test_')?0:1);`],{env,encoding:'utf8'});assert.equal(guard.status,0,'Dedicated test database required');
    let r=run('create');assert.equal(r.status,0,r.stderr);assert.ok(JSON.parse(r.stdout).tables>20);
    r=run('verify');assert.equal(r.status,0,r.stderr);
    assert.equal(run('verify','WrongPassword!74').status,1);
    assert.equal(run('create').status,1);
    assert.equal(run('restore').status,1,'Explicit confirmation is required');
    const hidden=spawnSync('php',['-r',`$z=new ZipArchive();$z->open($argv[1]);exit($z->getFromName('manifest.json')===false?0:1);`,path],{encoding:'utf8'});assert.equal(hidden.status,0,'Manifest must be encrypted');
    // Replace an entry; manifest still contains the authentic row count and hash.
    const tamper=spawnSync('php',['-r',`$z=new ZipArchive();$z->open($argv[1]);$z->addFromString('data/companies.ndjson',"{}\\n");$z->close();`,path],{encoding:'utf8'});assert.equal(tamper.status,0);
    assert.equal(run('verify').status,1,'Tampered data must fail verification');
  }finally{rmSync(folder,{recursive:true,force:true,maxRetries:3});}
});
