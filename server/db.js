import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path = process.env.DB_PATH || 'data/hozoryar.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS platform_admins (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS platform_sessions (
      token_hash TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES platform_admins(id),
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL, username TEXT NOT NULL, password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','manager','employee')),
      active INTEGER NOT NULL DEFAULT 1, UNIQUE(company_id, username),
      UNIQUE(company_id, id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, company_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id)
    );
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
      duty_minutes INTEGER NOT NULL CHECK(duty_minutes BETWEEN 0 AND 1440),
      daily_ot_cap INTEGER NOT NULL DEFAULT 27 CHECK(daily_ot_cap BETWEEN 0 AND 1440),
      schedule_kind TEXT NOT NULL DEFAULT 'fixed',
      schedule_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(company_id,id)
    );
    CREATE TABLE IF NOT EXISTS assignments (
      company_id INTEGER NOT NULL, user_id INTEGER NOT NULL, shift_id INTEGER NOT NULL,
      PRIMARY KEY(company_id,user_id),
      FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id),
      FOREIGN KEY(company_id,shift_id) REFERENCES shifts(company_id,id)
    );
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      checked_in_at TEXT NOT NULL, checked_out_at TEXT,
      lat REAL, lng REAL, accuracy REAL,
      FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id),
      CHECK(checked_out_at IS NULL OR checked_out_at >= checked_in_at)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_open_attendance
      ON attendance(company_id,user_id) WHERE checked_out_at IS NULL;
    CREATE INDEX IF NOT EXISTS attendance_company_date
      ON attendance(company_id,checked_in_at);
    CREATE TABLE IF NOT EXISTS locations (
      company_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      lat REAL NOT NULL, lng REAL NOT NULL, accuracy REAL,
      recorded_at TEXT NOT NULL, PRIMARY KEY(company_id,user_id),
      FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id)
    );
    CREATE TABLE IF NOT EXISTS location_history (
      id INTEGER PRIMARY KEY,company_id INTEGER NOT NULL,user_id INTEGER NOT NULL,
      lat REAL NOT NULL,lng REAL NOT NULL,accuracy REAL,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id)
    );
    CREATE INDEX IF NOT EXISTS location_history_employee_date ON location_history(company_id,user_id,recorded_at);
    CREATE TABLE IF NOT EXISTS company_settings (
      company_id INTEGER PRIMARY KEY REFERENCES companies(id),
      map_provider TEXT NOT NULL DEFAULT 'osm',
      neshan_api_key TEXT NOT NULL DEFAULT '',
      sms_provider TEXT NOT NULL DEFAULT 'disabled',
      sms_api_key TEXT NOT NULL DEFAULT '',
      geofence_lat REAL, geofence_lng REAL,
      geofence_radius_m INTEGER NOT NULL DEFAULT 300,
      require_location INTEGER NOT NULL DEFAULT 1,
      approval_steps INTEGER NOT NULL DEFAULT 1 CHECK(approval_steps IN (1,2)),
      annual_leave_minutes INTEGER NOT NULL DEFAULT 12480 CHECK(annual_leave_minutes BETWEEN 0 AND 525600),
      features_json TEXT NOT NULL DEFAULT '{"liveMap":true,"attendance":true,"monitoring":true,"shifts":true,"sms":false}'
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, actor_user_id INTEGER NOT NULL,
      action TEXT NOT NULL, target_type TEXT NOT NULL, target_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(company_id,actor_user_id) REFERENCES users(company_id,id)
    );
    CREATE TABLE IF NOT EXISTS personnel_requests (
      id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('annual_leave','sick_leave','mission')),
      work_date TEXT NOT NULL, minutes INTEGER NOT NULL CHECK(minutes BETWEEN 1 AND 1440),
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      decided_by INTEGER, decided_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(company_id,user_id) REFERENCES users(company_id,id),
      FOREIGN KEY(company_id,decided_by) REFERENCES users(company_id,id)
    );
    CREATE INDEX IF NOT EXISTS personnel_requests_company_date ON personnel_requests(company_id,work_date,status);
    CREATE TABLE IF NOT EXISTS request_decisions (
      id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, request_id INTEGER NOT NULL,
      stage INTEGER NOT NULL, actor_user_id INTEGER NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('approved','rejected')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(company_id,actor_user_id) REFERENCES users(company_id,id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS request_one_decision_per_stage ON request_decisions(company_id,request_id,stage);
    CREATE TABLE IF NOT EXISTS company_holidays (
      company_id INTEGER NOT NULL REFERENCES companies(id), work_date TEXT NOT NULL,
      title TEXT NOT NULL, PRIMARY KEY(company_id,work_date)
    );
    CREATE TABLE IF NOT EXISTS official_calendar_years (
      jalali_year INTEGER PRIMARY KEY, payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS work_month_archives (
      company_id INTEGER NOT NULL REFERENCES companies(id), month TEXT NOT NULL,
      snapshot_json TEXT NOT NULL, created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(company_id,month),
      FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
      CHECK(length(month) IN (7,9))
    );
    CREATE TABLE IF NOT EXISTS work_month_reviews (
      company_id INTEGER NOT NULL, month TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN ('pending_review','reviewed','approved')),
      reviewer_user_id INTEGER, reviewed_at TEXT,
      approver_user_id INTEGER, approved_at TEXT,
      PRIMARY KEY(company_id,month),
      FOREIGN KEY(company_id,month) REFERENCES work_month_archives(company_id,month),
      FOREIGN KEY(company_id,reviewer_user_id) REFERENCES users(company_id,id),
      FOREIGN KEY(company_id,approver_user_id) REFERENCES users(company_id,id)
    );
  `);
  // Existing 0.1/0.2 databases are upgraded in place without touching tenant data.
  const settingColumns=db.prepare('PRAGMA table_info(company_settings)').all().map(x=>x.name);
  const companyColumns=db.prepare('PRAGMA table_info(companies)').all().map(x=>x.name);
  if(!companyColumns.includes('subscription_end'))db.exec('ALTER TABLE companies ADD COLUMN subscription_end TEXT');
  if(!companyColumns.includes('max_personnel'))db.exec('ALTER TABLE companies ADD COLUMN max_personnel INTEGER CHECK(max_personnel IS NULL OR max_personnel>=1)');
  const archiveSql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='work_month_archives'").get()?.sql||'';
  if(archiveSql.includes('CHECK(length(month)=7)')){
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE work_month_archives_migrated (
        company_id INTEGER NOT NULL REFERENCES companies(id), month TEXT NOT NULL,
        snapshot_json TEXT NOT NULL, created_by INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(company_id,month),
        FOREIGN KEY(company_id,created_by) REFERENCES users(company_id,id),
        CHECK(length(month) IN (7,9))
      );
      INSERT INTO work_month_archives_migrated(company_id,month,snapshot_json,created_by,created_at)
        SELECT company_id,month,snapshot_json,created_by,created_at FROM work_month_archives;
      DROP TABLE work_month_archives;
      ALTER TABLE work_month_archives_migrated RENAME TO work_month_archives;
      COMMIT;`);
  }
  if(!settingColumns.includes('approval_steps'))db.exec('ALTER TABLE company_settings ADD COLUMN approval_steps INTEGER NOT NULL DEFAULT 1 CHECK(approval_steps IN (1,2))');
  if(!settingColumns.includes('annual_leave_minutes'))db.exec('ALTER TABLE company_settings ADD COLUMN annual_leave_minutes INTEGER NOT NULL DEFAULT 12480 CHECK(annual_leave_minutes BETWEEN 0 AND 525600)');
  const shiftColumns=db.prepare('PRAGMA table_info(shifts)').all().map(x=>x.name);
  if(!shiftColumns.includes('schedule_kind'))db.exec("ALTER TABLE shifts ADD COLUMN schedule_kind TEXT NOT NULL DEFAULT 'fixed'");
  if(!shiftColumns.includes('schedule_json'))db.exec("ALTER TABLE shifts ADD COLUMN schedule_json TEXT NOT NULL DEFAULT '{}'");
  if(!shiftColumns.includes('daily_ot_cap'))db.exec('ALTER TABLE shifts ADD COLUMN daily_ot_cap INTEGER NOT NULL DEFAULT 27 CHECK(daily_ot_cap BETWEEN 0 AND 1440)');
  const requestColumns=db.prepare('PRAGMA table_info(personnel_requests)').all().map(x=>x.name);
  if(!requestColumns.includes('end_date'))db.exec('ALTER TABLE personnel_requests ADD COLUMN end_date TEXT');
  if(!requestColumns.includes('unit'))db.exec("ALTER TABLE personnel_requests ADD COLUMN unit TEXT NOT NULL DEFAULT 'hourly' CHECK(unit IN ('hourly','daily'))");
  return db;
}
