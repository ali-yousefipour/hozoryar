import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.js';
import { passwordHash } from '../server/auth.js';

const folder=mkdtempSync(join(tmpdir(),'hozoryar-test-'));
process.env.DB_PATH=join(folder,'test.sqlite');
const db=openDatabase(process.env.DB_PATH);
const insertCompany=db.prepare('INSERT INTO companies(name,slug) VALUES(?,?)');
const insertUser=db.prepare('INSERT INTO users(company_id,name,username,password_hash,role) VALUES(?,?,?,?,?)');
for (const [name,slug] of [['شرکت الف','alpha'],['شرکت ب','beta']]) {
  const id=Number(insertCompany.run(name,slug).lastInsertRowid);
  insertUser.run(id,'مدیر '+name,'admin',passwordHash('strong-password-123'),'owner');
  db.prepare('INSERT INTO company_settings(company_id) VALUES(?)').run(id);
}
db.close();
const { createServer }=await import('../server/index.js');
const server=createServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
test.after(async()=>{await new Promise(resolve=>server.close(resolve));rmSync(folder,{recursive:true,force:true});});

async function api(path,token,method='GET',body){const res=await fetch(origin+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:res.status,body:await res.json()};}
const a=(await api('/api/login',null,'POST',{company:'alpha',username:'admin',password:'strong-password-123'})).body.token;
const b=(await api('/api/login',null,'POST',{company:'beta',username:'admin',password:'strong-password-123'})).body.token;

test('different companies have separate users, settings and dashboard',async()=>{
  const create=await api('/api/users',a,'POST',{name:'کارمند الف',username:'staff',password:'strong-password-123',role:'employee'});
  assert.equal(create.status,201);
  assert.equal((await api('/api/users',a)).body.items.length,2);
  assert.equal((await api('/api/users',b)).body.items.length,1);
  assert.equal((await api('/api/dashboard',a)).body.total,2);
  assert.equal((await api('/api/dashboard',b)).body.total,1);
  assert.equal((await api('/api/settings',a)).body.neshan_key_configured,false);
  assert.equal((await api('/api/settings',b,'PATCH',{map_provider:'neshan',neshan_api_key:'company-b-secret'})).status,200);
  const sa=(await api('/api/settings',a)).body,sb=(await api('/api/settings',b)).body;
  assert.equal(sa.map_provider,'osm');assert.equal(sb.map_provider,'neshan');
  assert.equal(JSON.stringify(sb).includes('company-b-secret'),false);
});

test('attendance, location, live map are isolated across tenants',async()=>{
  assert.equal((await api('/api/attendance',a,'POST',{action:'in',lat:36.3,lng:59.6,accuracy:10})).status,201);
  assert.equal((await api('/api/location',a,'POST',{lat:36.3,lng:59.6,accuracy:10})).status,200);
  assert.equal((await api('/api/live-map',a)).body.items.length,1);
  assert.equal((await api('/api/live-map',b)).body.items.length,0);
  assert.equal((await api('/api/dashboard',b)).body.present,0);
  assert.equal((await api('/api/attendance',b)).body.items.length,0);
  assert.equal((await api('/api/attendance',a,'POST',{action:'in',lat:36.3,lng:59.6})).status,409);
  assert.equal((await api('/api/attendance',a,'POST',{action:'out'})).status,201);
  assert.equal((await api('/api/live-map',a)).body.items.length,0);
  assert.equal((await api('/api/location',a,'POST',{lat:36.3,lng:59.6})).status,403);
});

test('cannot assign another tenant employee or shift',async()=>{
  const shift=(await api('/api/shifts',a,'POST',{name:'روز',start_time:'08:00',end_time:'16:00',duty_minutes:480}));
  assert.equal(shift.status,201);
  const foreign=await api('/api/assignments',b,'POST',{user_id:3,shift_id:shift.body.id});
  assert.equal(foreign.status,404);
  assert.equal((await api('/api/shifts',b)).body.items.length,0);
});

test('unauthorized access is blocked',async()=>{
  assert.equal((await api('/api/dashboard')).status,401);
  const login=await api('/api/login',null,'POST',{company:'alpha',username:'admin',password:'wrong'});
  assert.equal(login.status,401);
});

test('personnel request decisions stay inside their company and affect reports',async()=>{
  const staffLogin=await api('/api/login',null,'POST',{company:'alpha',username:'staff',password:'strong-password-123'});
  assert.equal(staffLogin.status,200);
  const staff=staffLogin.body.token;
  const created=await api('/api/requests',staff,'POST',{type:'annual_leave',work_date:'2026-11-02',minutes:120,description:'مرخصی ساعتی'});
  assert.equal(created.status,201);
  assert.equal((await api('/api/requests',b)).body.items.length,0);
  assert.equal((await api(`/api/requests/${created.body.id}/decision`,b,'POST',{status:'approved'})).status,404);
  assert.equal((await api(`/api/requests/${created.body.id}/decision`,staff,'POST',{status:'approved'})).status,403);
  assert.equal((await api(`/api/requests/${created.body.id}/decision`,a,'POST',{status:'approved'})).status,200);
  assert.equal((await api(`/api/requests/${created.body.id}/decision`,a,'POST',{status:'rejected'})).status,409);
  assert.equal((await api('/api/assignments',a,'POST',{user_id:3,shift_id:1})).status,200);
  const report=await api('/api/work-report?from=2026-11-02&to=2026-11-02',staff);
  assert.equal(report.status,200);
  assert.equal(report.body.days[0].leave,120);
  assert.equal(report.body.days[0].expected,480);
  assert.equal(report.body.days[0].shortage,360);
  assert.equal((await api('/api/work-report?from=2026-11-02&to=2026-11-02&user_id=3',b)).status,404);
});

test('two-step approvals require manager then company owner',async()=>{
  const m=await api('/api/users',a,'POST',{name:'مدیر میانی',username:'middle',password:'strong-password-123',role:'manager'});
  assert.equal(m.status,201);
  const manager=(await api('/api/login',null,'POST',{company:'alpha',username:'middle',password:'strong-password-123'})).body.token;
  assert.equal((await api('/api/settings',a,'PATCH',{approval_steps:2})).status,200);
  const staff=(await api('/api/login',null,'POST',{company:'alpha',username:'staff',password:'strong-password-123'})).body.token;
  const created=await api('/api/requests',staff,'POST',{type:'mission',work_date:'2026-11-03',minutes:120});
  assert.equal(created.status,201);
  const url=`/api/requests/${created.body.id}/decision`;
  assert.equal((await api(url,a,'POST',{status:'approved'})).status,403);
  const first=await api(url,manager,'POST',{status:'approved'});
  assert.equal(first.status,200);assert.equal(first.body.status,'pending');
  assert.equal((await api(url,manager,'POST',{status:'approved'})).status,403);
  const second=await api(url,a,'POST',{status:'approved'});
  assert.equal(second.status,200);assert.equal(second.body.status,'approved');
  assert.equal((await api('/api/work-report?from=2026-11-03&to=2026-11-03',staff)).body.days[0].mission,120);
});

test('calendar holidays and overnight report remain tenant-scoped',async()=>{
  const created=await api('/api/holidays',a,'POST',{work_date:'2026-11-04',title:'تعطیلی اختصاصی الف'});
  assert.equal(created.status,200);
  const ca=await api('/api/calendar?from=2026-11-04&to=2026-11-04',a);
  const cb=await api('/api/calendar?from=2026-11-04&to=2026-11-04',b);
  assert.equal(ca.body.days[0].is_manual_holiday,true);
  assert.equal(cb.body.days[0].is_manual_holiday,false);
  const shift=await api('/api/shifts',a,'POST',{name:'شب',start_time:'23:00',end_time:'07:00',duty_minutes:480,daily_ot_cap:27});
  assert.equal(shift.status,201);
  assert.equal((await api('/api/assignments',a,'POST',{user_id:3,shift_id:shift.body.id})).status,200);
  const insert=openDatabase(process.env.DB_PATH);
  insert.prepare('INSERT INTO attendance(company_id,user_id,checked_in_at,checked_out_at) VALUES(?,?,?,?)').run(1,3,'2026-10-20T19:30:00Z','2026-10-21T03:30:00Z');
  insert.close();
  const staff=(await api('/api/login',null,'POST',{company:'alpha',username:'staff',password:'strong-password-123'})).body.token;
  const report=await api('/api/work-report?from=2026-10-20&to=2026-10-21',staff);
  assert.equal(report.status,200);
  assert.equal(report.body.days[0].worked,480);
  assert.equal(report.body.days[0].in_shift,480);
  assert.equal(report.body.days[1].worked,0);
  assert.equal((await api('/api/work-report?from=2026-10-20&to=2026-10-21',b)).body.totals.worked,0);
});
