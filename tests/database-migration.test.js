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

test('legacy leave requests and decisions survive unpaid-leave CHECK migration',()=>{
  const folder=mkdtempSync(join(tmpdir(),'hozoryar-leave-migrate-')),path=join(folder,'old.sqlite');
  try{
    const initial=openDatabase(path);
    initial.exec("INSERT INTO companies(id,name,slug) VALUES(1,'شرکت الف','alpha')");
    initial.exec("INSERT INTO users(id,company_id,name,username,password_hash,role) VALUES(1,1,'مدیر','admin','hash','owner')");
    initial.close();
    const legacy=new DatabaseSync(path);
    legacy.exec(`DROP TABLE personnel_requests;
      CREATE TABLE personnel_requests(id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL,user_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('annual_leave','sick_leave','mission')),
      work_date TEXT NOT NULL,minutes INTEGER NOT NULL,description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',decided_by INTEGER,decided_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO personnel_requests(id,company_id,user_id,type,work_date,minutes,status) VALUES(13,1,1,'annual_leave','2026-08-10',120,'approved');
      INSERT INTO request_decisions(company_id,request_id,stage,actor_user_id,outcome) VALUES(1,13,1,1,'approved');`);
    legacy.close();
    const db=openDatabase(path);
    assert.equal(db.prepare('SELECT type,status,unit FROM personnel_requests WHERE id=13').get().unit,'hourly');
    assert.equal(db.prepare('SELECT request_id FROM request_decisions WHERE request_id=13').get().request_id,13);
    db.prepare('INSERT INTO personnel_requests(company_id,user_id,type,work_date,minutes) VALUES(?,?,?,?,?)').run(1,1,'unpaid_leave','2026-08-11',480);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM personnel_requests WHERE type='unpaid_leave'").get().n,1);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    db.close();
  }finally{rmSync(folder,{recursive:true,force:true});}
});
