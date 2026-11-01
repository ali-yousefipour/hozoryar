import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openDatabase } from '../server/db.js';

test('backup verification accepts valid Hozoryar SQLite and rejects missing files',()=>{
  const folder=mkdtempSync(join(tmpdir(),'hozoryar-verify-'));
  try{
    const file=join(folder,'safe.sqlite'),db=openDatabase(file);db.close();
    const script=new URL('../server/verify-backup.js',import.meta.url).pathname;
    const ok=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
    assert.equal(ok.status,0,ok.stderr);
    const missing=spawnSync(process.execPath,[script,join(folder,'missing.sqlite')],{encoding:'utf8'});
    assert.equal(missing.status,1);
  }finally{rmSync(folder,{recursive:true,force:true});}
});

test('offline restore preserves old database and rejects WAL sidecars',()=>{
  const folder=mkdtempSync(join(tmpdir(),'hozoryar-restore-test-'));
  try{
    const target=join(folder,'live.sqlite'),source=join(folder,'backup.sqlite');
    const old=openDatabase(target);old.prepare('INSERT INTO companies(name,slug) VALUES(?,?)').run('نسخه قدیم','old');old.close();
    const backup=openDatabase(source);backup.prepare('INSERT INTO companies(name,slug) VALUES(?,?)').run('نسخه جدید','new');backup.close();
    const script=new URL('../server/restore-backup.js',import.meta.url).pathname;
    const result=spawnSync(process.execPath,[script,source,'--offline-confirm'],{encoding:'utf8',env:{...process.env,DB_PATH:target}});
    assert.equal(result.status,0,result.stderr);
    const current=openDatabase(target);assert.equal(current.prepare('SELECT slug FROM companies').get().slug,'new');current.close();
    assert.match(result.stdout,/Original database preserved/);
    const unauthorized=spawnSync(process.execPath,[script,source],{encoding:'utf8',env:{...process.env,DB_PATH:target}});
    assert.equal(unauthorized.status,1);
  }finally{rmSync(folder,{recursive:true,force:true});}
});
