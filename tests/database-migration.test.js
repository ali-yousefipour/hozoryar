import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.js';

test('old Gregorian monthly snapshots survive schema migration to Jalali keys',()=>{
  const folder=mkdtempSync(join(tmpdir(),'hozoryar-migrate-')),path=join(folder,'old.sqlite');
  try{
    const db=openDatabase(path);
    db.exec("INSERT INTO companies(id,name,slug) VALUES(1,'شرکت نمونه','sample')");
    db.exec("INSERT INTO users(id,company_id,name,username,password_hash,role) VALUES(1,1,'مدیر','owner','placeholder','owner')");
    db.close();
    const legacy=new DatabaseSync(path);
    legacy.exec(`DROP TABLE work_month_archives;
      CREATE TABLE work_month_archives(company_id INTEGER NOT NULL,month TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,created_by INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(company_id,month),CHECK(length(month)=7));
      INSERT INTO work_month_archives(company_id,month,snapshot_json,created_by) VALUES(1,'2026-10','{}',1);`);
    legacy.close();
    const upgraded=openDatabase(path);
    assert.equal(upgraded.prepare("SELECT snapshot_json FROM work_month_archives WHERE month='2026-10'").get().snapshot_json,'{}');
    upgraded.prepare('INSERT INTO work_month_archives(company_id,month,snapshot_json,created_by) VALUES(?,?,?,?)').run(1,'j-1405-07','{}',1);
    assert.equal(upgraded.prepare('SELECT COUNT(*) n FROM work_month_archives').get().n,2);
    upgraded.close();
  }finally{rmSync(folder,{recursive:true,force:true});}
});
