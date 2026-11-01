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
db.prepare('INSERT INTO platform_admins(username,name,password_hash) VALUES(?,?,?)').run('root','مدیر مرکزی',passwordHash('platform-strong-pass-123'));
db.prepare('INSERT INTO official_calendar_years(jalali_year,payload_json,fetched_at) VALUES(?,?,?)').run(1405,
  JSON.stringify({days:{'2026-03-21':{title:'نوروز',estimated:false},'2026-06-05':{title:'قیام ۱۵ خرداد',estimated:false}},estimated:false}),new Date().toISOString());
db.prepare('INSERT INTO official_calendar_years(jalali_year,payload_json,fetched_at) VALUES(?,?,?)').run(1404,
  JSON.stringify({days:{},estimated:false}),new Date().toISOString());
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
  assert.equal((await api('/api/dashboard?from=2026-10-20&to=2026-10-22',a)).body.arrivals.length,0);
  assert.equal((await api('/api/dashboard?from=2026-09-01&to=2026-11-01',a)).status,400);
  assert.equal((await api('/api/settings',a)).body.neshan_key_configured,false);
  assert.equal((await api('/api/settings',b,'PATCH',{map_provider:'neshan',neshan_api_key:'company-b-secret'})).status,200);
  const sa=(await api('/api/settings',a)).body,sb=(await api('/api/settings',b)).body;
  assert.equal(sa.map_provider,'osm');assert.equal(sb.map_provider,'neshan');
  assert.equal(JSON.stringify(sb).includes('company-b-secret'),false);
});

test('attendance, location, live map are isolated across tenants',async()=>{
  assert.equal((await api('/api/attendance',a,'POST',{action:'in',lat:36.3,lng:59.6,accuracy:10})).status,201);
  assert.equal((await api('/api/location',a,'POST',{lat:36.3,lng:59.6,accuracy:10})).status,200);
  assert.equal((await api('/api/location-history?user_id=1',a)).body.items.length,1);
  assert.equal((await api('/api/location-history?user_id=1',b)).status,404);
  assert.equal((await api('/api/live-map',a)).body.items.length,1);
  assert.equal((await api('/api/live-map',b)).body.items.length,0);
  assert.equal((await api('/api/dashboard',b)).body.present,0);
  assert.equal((await api('/api/attendance',b)).body.items.length,0);
  assert.equal((await api('/api/attendance',a,'POST',{action:'in',lat:36.3,lng:59.6})).status,409);
  assert.equal((await api('/api/attendance',a,'POST',{action:'out'})).status,201);
  assert.equal((await api('/api/live-map',a)).body.items.length,0);
  assert.equal((await api('/api/location',a,'POST',{lat:36.3,lng:59.6})).status,403);
});

test('attendance retry keys are transactional, replay-safe and scoped to each company',async()=>{
  const inKey='mobile-test-punch-0001',outKey='mobile-test-punch-0002';
  const first=await api('/api/attendance',a,'POST',{action:'in',lat:36.3,lng:59.6,event_id:inKey});
  assert.equal(first.status,201);
  const replay=await api('/api/attendance',a,'POST',{action:'in',event_id:inKey});
  assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(replay.body.id,first.body.id);
  assert.equal((await api('/api/attendance',a,'POST',{action:'out',event_id:inKey})).status,409);
  const foreign=await api('/api/attendance',b,'POST',{action:'in',lat:35.1,lng:51.1,event_id:inKey});
  assert.equal(foreign.status,201);assert.notEqual(foreign.body.id,first.body.id);
  assert.equal((await api('/api/attendance',a,'POST',{action:'out',event_id:outKey})).status,201);
  assert.equal((await api('/api/attendance',a,'POST',{action:'out',event_id:outKey})).body.replayed,true);
  assert.equal((await api('/api/attendance',b,'POST',{action:'out',event_id:outKey})).status,201);
});

test('monitoring evidence is tenant-scoped and requires active attendance',async()=>{
  assert.equal((await api('/api/monitoring/event',a,'POST',{kind:'gps_off'})).status,403);
  assert.equal((await api('/api/monitoring/event',a,'POST',{kind:'unknown'})).status,400);
  assert.equal((await api('/api/attendance',a,'POST',{action:'in',lat:36.3,lng:59.6})).status,201);
  assert.equal((await api('/api/monitoring/event',a,'POST',{kind:'gps_off'})).status,201);
  assert.equal((await api('/api/monitoring/events?user_id=1',a)).body.items[0].kind,'gps_off');
  assert.equal((await api('/api/monitoring/events?user_id=1',b)).status,404);
  assert.equal((await api('/api/attendance',a,'POST',{action:'out'})).status,201);
  assert.equal((await api('/api/monitoring/event',a,'POST',{kind:'gps_on'})).status,403);
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

test('multi-day mission is approved once, credited each day and blocks archive while pending',async()=>{
  const staff=(await api('/api/login',null,'POST',{company:'alpha',username:'staff',password:'strong-password-123'})).body.token;
  const manager=(await api('/api/login',null,'POST',{company:'alpha',username:'middle',password:'strong-password-123'})).body.token;
  assert.equal((await api('/api/requests',staff,'POST',{type:'mission',work_date:'2026-08-10',end_date:'2026-08-12',unit:'hourly',minutes:120})).status,400);
  assert.equal((await api('/api/requests',staff,'POST',{type:'mission',work_date:'2026-08-12',end_date:'2026-08-10',unit:'daily',minutes:480})).status,400);
  const created=await api('/api/requests',staff,'POST',{type:'mission',work_date:'2026-08-10',end_date:'2026-08-12',unit:'daily',minutes:480});
  assert.equal(created.status,201);
  const listing=(await api('/api/requests',staff)).body.items.find(x=>x.id===created.body.id);
  assert.equal(listing.end_date,'2026-08-12');assert.equal(listing.unit,'daily');
  assert.equal((await api('/api/work-months/finalize',a,'POST',{month:'2026-08'})).status,409);
  assert.equal((await api(`/api/requests/${created.body.id}/decision`,manager,'POST',{status:'approved'})).status,200);
  assert.equal((await api('/api/work-months/finalize',a,'POST',{month:'2026-08'})).status,409);
  assert.equal((await api(`/api/requests/${created.body.id}/decision`,a,'POST',{status:'approved'})).status,200);
  const report=await api('/api/work-report?from=2026-08-09&to=2026-08-13',staff);
  assert.equal(report.status,200);
  for(const day of ['2026-08-10','2026-08-11','2026-08-12'])assert.equal(report.body.days.find(x=>x.day===day).mission,480);
  assert.equal(report.body.totals.mission,1440);
  assert.equal((await api('/api/work-report?from=2026-08-10&to=2026-08-12',b)).body.totals.mission,0);
});

test('unpaid leave is tenant-isolated, approved in two stages and excluded from annual balance',async()=>{
  const staff=(await api('/api/login',null,'POST',{company:'alpha',username:'staff',password:'strong-password-123'})).body.token;
  const manager=(await api('/api/login',null,'POST',{company:'alpha',username:'middle',password:'strong-password-123'})).body.token;
  const before=(await api('/api/leave-balance?year=1405',staff)).body.used_minutes;
  const created=await api('/api/requests',staff,'POST',{type:'unpaid_leave',work_date:'2026-07-11',minutes:480,unit:'daily',description:'مرخصی بدون حقوق'});
  assert.equal(created.status,201);
  assert.equal((await api('/api/requests',b)).body.items.some(x=>x.id===created.body.id),false);
  assert.equal((await api(`/api/requests/${created.body.id}/decision`,manager,'POST',{status:'approved'})).status,200);
  assert.equal((await api(`/api/requests/${created.body.id}/decision`,a,'POST',{status:'approved'})).status,200);
  const report=(await api('/api/work-report?from=2026-07-11&to=2026-07-11',staff)).body.days[0];
  assert.equal(report.unpaid_leave,480);assert.equal(report.leave,0);
  assert.equal(report.shortage,0);assert.equal(report.worked,0);
  assert.equal((await api('/api/leave-balance?year=1405',staff)).body.used_minutes,before);
});

test('zones require daily annual-leave substitute and reserve it per company and date',async()=>{
  const zone=await api('/api/zones',a,'POST',{name:'مبادی ورودی',requires_substitute:true});
  assert.equal(zone.status,201);
  assert.equal((await api('/api/zones',b)).body.items.length,0);
  assert.equal((await api('/api/zones/'+zone.body.id,b,'PATCH',{requires_substitute:false})).status,404);
  const candidate={body:{id:4}}; // Existing company manager acts as the test substitute; active-user counts stay unchanged.
  assert.equal((await api('/api/users/'+candidate.body.id+'/zone',a,'PATCH',{zone_id:zone.body.id,can_be_substitute:true})).status,200);
  assert.equal((await api('/api/users/3/zone',a,'PATCH',{zone_id:zone.body.id,can_be_substitute:false})).status,200);
  const staff=(await api('/api/login',null,'POST',{company:'alpha',username:'staff',password:'strong-password-123'})).body.token;
  const manager=(await api('/api/login',null,'POST',{company:'alpha',username:'middle',password:'strong-password-123'})).body.token;
  const base={type:'annual_leave',unit:'daily',work_date:'2025-05-11',end_date:'2025-05-12',minutes:480};
  assert.equal((await api('/api/requests',staff,'POST',base)).status,400);
  assert.equal((await api('/api/requests',staff,'POST',{...base,substitute_user_id:2})).status,404);
  const list=(await api('/api/substitutes?from=2025-05-11&to=2025-05-12',staff)).body.items;
  assert.equal(list.find(x=>x.id===candidate.body.id).available,true);
  const created=await api('/api/requests',staff,'POST',{...base,substitute_user_id:candidate.body.id});
  assert.equal(created.status,201);
  assert.equal((await api('/api/requests',staff,'POST',{...base,substitute_user_id:candidate.body.id})).status,409);
  assert.equal((await api('/api/substitutes?from=2025-05-11&to=2025-05-12',staff)).body.items.find(x=>x.id===candidate.body.id).available,false);
  assert.equal((await api('/api/requests/'+created.body.id+'/decision',manager,'POST',{status:'approved'})).status,200);
  assert.equal((await api('/api/requests/'+created.body.id+'/decision',a,'POST',{status:'approved'})).status,200);
  const stored=openDatabase(process.env.DB_PATH);
  assert.equal(stored.prepare('SELECT substitute_user_id FROM substitute_assignments WHERE request_id=?').get(created.body.id).substitute_user_id,candidate.body.id);
  stored.close();
  const regular=await api('/api/shifts',a,'POST',{name:'شیفت مرخصی‌گیرنده',start_time:'08:00',end_time:'16:00',duty_minutes:480,daily_ot_cap:27});
  const own=await api('/api/shifts',a,'POST',{name:'شیفت اصلی جانشین',start_time:'09:00',end_time:'15:00',duty_minutes:360,daily_ot_cap:27});
  assert.equal(regular.status,201);assert.equal(own.status,201);
  assert.equal((await api('/api/assignments',a,'POST',{user_id:3,shift_id:regular.body.id})).status,200);
  assert.equal((await api('/api/assignments',a,'POST',{user_id:4,shift_id:own.body.id})).status,200);
  const substituteReport=await api('/api/work-report?user_id=4&from=2025-05-10&to=2025-05-13',a);
  assert.equal(substituteReport.status,200);
  assert.equal(substituteReport.body.days.find(d=>d.day==='2025-05-11').expected,480);
  assert.equal(substituteReport.body.days.find(d=>d.day==='2025-05-13').expected,360);
  assert.equal((await api('/api/requests',staff)).body.items.find(x=>x.id===created.body.id).substitute_name,'مدیر میانی');
  assert.equal((await api('/api/requests',b)).body.items.some(x=>x.id===created.body.id),false);
});

test('annual leave quota is company-specific, checked at final approval and employee-visible',async()=>{
  const staff=(await api('/api/login',null,'POST',{company:'alpha',username:'staff',password:'strong-password-123'})).body.token;
  const manager=(await api('/api/login',null,'POST',{company:'alpha',username:'middle',password:'strong-password-123'})).body.token;
  assert.equal((await api('/api/settings',a,'PATCH',{annual_leave_minutes:240})).status,200);
  assert.equal((await api('/api/settings',b)).body.annual_leave_minutes,12480);
  const original=await api('/api/leave-balance?year=1405',staff);
  assert.equal(original.status,200);assert.equal(original.body.used_minutes,120);assert.equal(original.body.remaining_minutes,120);
  assert.equal((await api('/api/leave-balance?year=1405&user_id=1',staff)).status,403);
  const request=await api('/api/requests',staff,'POST',{type:'annual_leave',work_date:'2026-12-02',minutes:121});
  assert.equal(request.status,201);
  const route=`/api/requests/${request.body.id}/decision`;
  assert.equal((await api(route,manager,'POST',{status:'approved'})).status,200);
  assert.equal((await api(route,a,'POST',{status:'approved'})).status,409);
  assert.equal((await api('/api/requests',staff)).body.items.find(x=>x.id===request.body.id).status,'pending');
  assert.equal((await api(route,a,'POST',{status:'rejected'})).status,200);
  const allowed=await api('/api/requests',staff,'POST',{type:'annual_leave',work_date:'2026-12-03',minutes:120});
  assert.equal(allowed.status,201);
  assert.equal((await api(`/api/requests/${allowed.body.id}/decision`,manager,'POST',{status:'approved'})).status,200);
  assert.equal((await api(`/api/requests/${allowed.body.id}/decision`,a,'POST',{status:'approved'})).status,200);
  assert.equal((await api('/api/leave-balance?year=1405',staff)).body.remaining_minutes,0);
  assert.equal((await api('/api/settings',a,'PATCH',{annual_leave_minutes:12480})).status,200);
});

test('Neshan and Kavenegar gateways use tenant secrets server-side without exposing keys',async()=>{
  assert.equal((await api('/api/settings',a,'PATCH',{map_provider:'neshan',neshan_api_key:'test-neshan-secret',sms_provider:'kavenegar',sms_api_key:'test-sms-secret',features:{liveMap:true,attendance:true,monitoring:true,shifts:true,sms:true}})).status,200);
  const originalFetch=globalThis.fetch,calls=[];
  globalThis.fetch=(url,opts)=>{
    if(typeof url==='string'&&url.startsWith('https://api.neshan.org/')){
      calls.push({provider:'neshan',url,header:opts.headers['Api-Key']});
      return Promise.resolve(new Response(Uint8Array.from([137,80,78,71]),{status:200,headers:{'content-type':'image/png'}}));
    }
    if(typeof url==='string'&&url.startsWith('https://api.kavenegar.com/')){
      calls.push({provider:'kavenegar',url,body:opts.body.toString()});
      return Promise.resolve(Response.json({return:{status:200}}));
    }
    return originalFetch(url,opts);
  };
  try {
    const map=await originalFetch(origin+'/api/neshan-tiles/1/1/1',{headers:{Authorization:'Bearer '+a}});
    assert.equal(map.status,200);assert.equal(map.headers.get('content-type'),'image/png');
    assert.equal((await api('/api/sms/send',a,'POST',{mobile:'09123456789',message:'آزمون حضوریار'})).status,200);
    assert.equal((await api('/api/sms/send',b,'POST',{mobile:'09123456789',message:'نباید ارسال شود'})).status,403);
    assert.equal(calls.length,2);assert.equal(calls[0].header,'test-neshan-secret');
    assert.equal(calls[1].body.includes('receptor=09123456789'),true);
    assert.equal(calls[1].url.includes('test-sms-secret'),true);
    assert.equal(JSON.stringify((await api('/api/settings',a)).body).includes('test-neshan-secret'),false);
    assert.equal(JSON.stringify((await api('/api/settings',a)).body).includes('test-sms-secret'),false);
  } finally {globalThis.fetch=originalFetch;}
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
  const trend=(await api('/api/dashboard?from=2026-10-20&to=2026-10-21',a)).body.arrivals;
  assert.equal(trend.length,1);assert.equal(trend[0].employees,1);
  assert.equal((await api('/api/dashboard?from=2026-10-20&to=2026-10-21',b)).body.arrivals.length,0);
});

test('online cached holiday is used in work reporting and Friday is not double-counted',async()=>{
  const date='2026-03-21';
  const calendar=await api('/api/calendar?from='+date+'&to='+date,a);
  assert.equal(calendar.status,200);
  assert.equal(calendar.body.official_calendar_available,true);
  assert.equal(calendar.body.official_calendar_stale,false);
  assert.equal(calendar.body.days[0].is_official_holiday,true);
  const inserted=openDatabase(process.env.DB_PATH);
  inserted.prepare('INSERT INTO attendance(company_id,user_id,checked_in_at,checked_out_at) VALUES(?,?,?,?)')
    .run(1,3,'2026-03-21T05:00:00Z','2026-03-21T06:00:00Z');
  inserted.close();
  const report=await api('/api/work-report?from='+date+'&to='+date+'&user_id=3',a);
  assert.equal(report.status,200);
  assert.equal(report.body.days[0].holiday_work,60);
  assert.equal(report.body.days[0].friday_work,0);
  assert.equal(report.body.days[0].is_official_holiday,true);
  assert.equal(report.body.days[0].holiday_source,'official-online');
  assert.equal(report.body.authoritative,false);
  assert.equal((await api('/api/work-report?from='+date+'&to='+date,b)).body.days[0].worked,0);
  const fridayDb=openDatabase(process.env.DB_PATH);
  fridayDb.prepare('INSERT INTO attendance(company_id,user_id,checked_in_at,checked_out_at) VALUES(?,?,?,?)')
    .run(1,3,'2026-06-05T05:00:00Z','2026-06-05T06:00:00Z');
  fridayDb.close();
  const friday=(await api('/api/work-report?from=2026-06-05&to=2026-06-05&user_id=3',a)).body.days[0];
  assert.equal(friday.is_official_holiday,true);
  assert.equal(friday.friday_work,60);
  assert.equal(friday.holiday_work,0);
  assert.equal(friday.total_overtime,60);
});

test('monthly archive is owner-only, immutable, tenant-scoped and blocked by pending requests',async()=>{
  const staff=(await api('/api/login',null,'POST',{company:'alpha',username:'staff',password:'strong-password-123'})).body.token;
  const manager=(await api('/api/login',null,'POST',{company:'alpha',username:'middle',password:'strong-password-123'})).body.token;
  assert.equal((await api('/api/work-months/finalize',staff,'POST',{month:'2026-10'})).status,403);
  assert.equal((await api('/api/work-months/finalize',manager,'POST',{month:'2026-10'})).status,403);
  assert.equal((await api('/api/work-months/finalize',a,'POST',{month:'2026-11'})).status,409);
  const pending=await api('/api/requests',staff,'POST',{type:'annual_leave',work_date:'2026-10-20',minutes:60});
  assert.equal(pending.status,201);
  assert.equal((await api('/api/work-months/finalize',a,'POST',{month:'2026-10'})).status,409);
  const url=`/api/requests/${pending.body.id}/decision`;
  assert.equal((await api(url,manager,'POST',{status:'approved'})).status,200);
  assert.equal((await api(url,a,'POST',{status:'approved'})).status,200);
  // An attendance started in November must not block archiving October.
  const boundaryDb=openDatabase(process.env.DB_PATH);
  boundaryDb.prepare('INSERT INTO attendance(company_id,user_id,checked_in_at) VALUES(?,?,?)').run(1,3,'2026-11-02T06:00:00Z');
  boundaryDb.close();
  const archive=await api('/api/work-months/finalize',a,'POST',{month:'2026-10'});
  assert.equal(archive.status,201);assert.equal(archive.body.authoritative,false);
  assert.equal((await api('/api/work-months/finalize',a,'POST',{month:'2026-10'})).status,409);
  assert.equal((await api('/api/work-months/2026-10',b)).status,404);
  assert.equal((await api('/api/work-months',b)).body.items.length,0);
  const snapshot=(await api('/api/work-months/2026-10',a)).body;
  assert.equal(snapshot.status,'archived');assert.equal(snapshot.reports.length,3);
  const original=snapshot.reports.find(x=>x.id===3).report.totals.worked;
  assert.equal(original,480);
  const write=openDatabase(process.env.DB_PATH);
  write.prepare('INSERT INTO attendance(company_id,user_id,checked_in_at,checked_out_at) VALUES(?,?,?,?)').run(1,3,'2026-10-22T06:00:00Z','2026-10-22T07:00:00Z');
  write.close();
  assert.equal((await api('/api/work-months/2026-10',a)).body.reports.find(x=>x.id===3).report.totals.worked,original);
  assert.equal((await api('/api/work-report?from=2026-10-20&to=2026-10-22',staff)).body.totals.worked,540);
});

test('Jalali monthly archives use exact Persian boundaries and separate keys',async()=>{
  const archive=await api('/api/work-months/finalize',a,'POST',{month:'j-1405-07'});
  assert.equal(archive.status,201);
  const snapshot=(await api('/api/work-months/j-1405-07',a)).body;
  assert.equal(snapshot.from,'2026-09-23');assert.equal(snapshot.to,'2026-10-22');
  assert.equal(snapshot.calendar,'jalali');
  assert.equal(snapshot.authoritative,false);
  assert.equal((await api('/api/work-months/j-1405-07',b)).status,404);
  assert.equal((await api('/api/work-months/finalize',a,'POST',{month:'j-1405-08'})).status,409);
});

test('archived work reports receive separate manager review and owner approval, never payroll authority',async()=>{
  const manager=(await api('/api/login',null,'POST',{company:'alpha',username:'middle',password:'strong-password-123'})).body.token;
  const staff=(await api('/api/login',null,'POST',{company:'alpha',username:'staff',password:'strong-password-123'})).body.token;
  const path='/api/work-months/j-1405-07';
  assert.equal((await api(path+'/approve',a,'POST')).status,409);
  assert.equal((await api(path+'/review',staff,'POST')).status,403);
  assert.equal((await api(path+'/review',a,'POST')).status,403);
  assert.equal((await api(path+'/review',manager,'POST')).status,200);
  assert.equal((await api(path+'/review',manager,'POST')).status,409);
  assert.equal((await api(path+'/approve',manager,'POST')).status,403);
  const approved=await api(path+'/approve',a,'POST');
  assert.equal(approved.status,200);assert.equal(approved.body.authoritative,false);
  assert.equal((await api(path+'/approve',a,'POST')).status,409);
  assert.equal((await api(path,b)).status,404);
  const snapshot=(await api(path,a)).body;
  assert.equal(snapshot.review_status,'approved');
  assert.equal(snapshot.authoritative,false);
  assert.equal((await api('/api/work-months',a)).body.items.find(x=>x.month==='j-1405-07').review_status,'approved');
  const xlsx=await fetch(origin+path+'/xlsx',{headers:{Authorization:'Bearer '+a}});
  assert.equal(xlsx.status,200);
  assert.match(xlsx.headers.get('content-type'),/spreadsheetml/);
  assert.equal((await xlsx.arrayBuffer()).byteLength>1000,true);
  assert.equal((await fetch(origin+path+'/xlsx',{headers:{Authorization:'Bearer '+b}})).status,404);
});

test('financial signoff requires owner and managerial approval and locks a digest of archived minutes',async()=>{
  const path='/api/work-months/j-1405-07';
  const manager=(await api('/api/login',null,'POST',{company:'alpha',username:'middle',password:'strong-password-123'})).body.token;
  const preview=await api(path+'/payroll-preview',a);
  assert.equal(preview.status,200);assert.equal(preview.body.items.length,3);
  assert.equal(preview.body.items[0].payable_minutes>=0,true);
  assert.equal((await api(path+'/payroll-preview',b)).status,404);
  const payload={include_surplus:false,confirm:true,note:'بررسی سند مالی ۱۴۰۵/۰۷'};
  assert.equal((await api('/api/work-months/2026-10/finance-confirm',a,'POST',payload)).status,409);
  assert.equal((await api(path+'/finance-confirm',manager,'POST',payload)).status,403);
  assert.equal((await api(path+'/finance-confirm',a,'POST',{include_surplus:false,confirm:false,note:'اشتباه'})).status,400);
  const confirmed=await api(path+'/finance-confirm',a,'POST',payload);
  assert.equal(confirmed.status,201);assert.equal(confirmed.body.financially_confirmed,true);
  assert.equal(confirmed.body.authoritative,false);
  assert.equal((await api(path+'/finance-confirm',a,'POST',payload)).status,409);
  const details=(await api(path,a)).body;
  assert.equal(details.finance_integrity_ok,true);
  assert.equal(details.finance_record.items.length,3);
  assert.equal(details.finance_digest,confirmed.body.snapshot_sha256);
  assert.equal((await api('/api/work-months',a)).body.items.find(x=>x.month==='j-1405-07').finance_confirmed,1);
  assert.equal((await api(path,b)).status,404);
});

test('platform administrator alone can configure per-company subscription and personnel quota',async()=>{
  const login=await api('/api/platform/login',null,'POST',{username:'root',password:'platform-strong-pass-123'});
  assert.equal(login.status,200);const platform=login.body.token;
  assert.equal((await api('/api/platform/companies',a)).status,401);
  assert.equal((await api('/api/platform/me',platform)).body.user.role,'platform_admin');
  const companies=await api('/api/platform/companies',platform);
  assert.equal(companies.body.items.length,2);
  assert.equal((await api('/api/platform/companies/1/subscription',platform,'PATCH',{max_personnel:2})).status,409);
  assert.equal((await api('/api/platform/companies/1/subscription',platform,'PATCH',{max_personnel:3})).status,200);
  assert.equal((await api('/api/users',a,'POST',{name:'کاربر چهارم',username:'fourth',password:'strong-password-123',role:'employee'})).status,409);
  assert.equal((await api('/api/platform/companies/1/subscription',platform,'PATCH',{max_personnel:4})).status,200);
  assert.equal((await api('/api/users',a,'POST',{name:'کاربر چهارم',username:'fourth',password:'strong-password-123',role:'employee'})).status,201);
  assert.equal((await api('/api/platform/companies/2/subscription',platform,'PATCH',{subscription_end:'2026-11-01'})).status,200);
  assert.equal((await api('/api/me',b)).body.subscription.expired,false);
  assert.equal((await api('/api/platform/companies/2/subscription',platform,'PATCH',{subscription_end:'2026-10-31',max_personnel:1})).status,200);
  assert.equal((await api('/api/me',b)).body.subscription.expired,true);
  assert.equal((await api('/api/users',b)).status,200);
  assert.equal((await api('/api/users',b,'POST',{name:'ممنوع',username:'blocked',password:'strong-password-123',role:'employee'})).status,402);
  assert.equal((await api('/api/platform/companies/2/subscription',a,'PATCH',{subscription_end:null})).status,401);
  assert.equal((await api('/api/platform/companies/2/subscription',platform,'PATCH',{subscription_end:null})).status,200);
  assert.equal((await api('/api/me',b)).body.subscription.expired,false);
  assert.equal((await api('/api/platform/logout',platform,'POST')).status,200);
  assert.equal((await api('/api/platform/companies',platform)).status,401);
});

test('segmented rotation validates each company cycle and overlap rules',async()=>{
  const base={name:'چرخش فازها',start_time:'07:00',end_time:'15:00',duty_minutes:480,daily_ot_cap:27,schedule_kind:'rotation_segments'};
  const schedule={anchor:'2026-11-01',cycle:[{days:7,segments:[{s:'07:00',e:'15:00'}]},{days:7,segments:[{s:'15:00',e:'23:00'}]},{days:7,segments:[{s:'23:00',e:'07:00'}]}]};
  const created=await api('/api/shifts',a,'POST',{...base,schedule});assert.equal(created.status,201);
  assert.equal((await api('/api/shifts',b)).body.items.some(s=>s.id===created.body.id),false);
  assert.equal((await api('/api/shifts',a,'POST',{...base,schedule:{...schedule,cycle:[{days:1,segments:[{s:'08:00',e:'12:00'},{s:'11:00',e:'15:00'}]}]}})).status,400);
  assert.equal((await api('/api/shifts',a,'POST',{...base,schedule:{...schedule,cycle:[{days:0,segments:[]}]}})).status,400);
});

test('advanced shifts validate overlapping segments and remain tenant-owned',async()=>{
  const base={name:'شیفت دو بخشی',start_time:'08:00',end_time:'17:00',duty_minutes:480,schedule_kind:'advanced'};
  const invalid=await api('/api/shifts',a,'POST',{...base,schedule:{weekly:{1:[{s:'08:00',e:'12:00'},{s:'11:30',e:'16:00'}]}}});
  assert.equal(invalid.status,400);
  const good=await api('/api/shifts',a,'POST',{...base,schedule:{weekly:{1:[{s:'08:00',e:'12:00'},{s:'13:00',e:'17:00'}]}}});
  assert.equal(good.status,201);
  assert.equal((await api('/api/assignments',b,'POST',{user_id:2,shift_id:good.body.id})).status,404);
});

test('automatic shift enforces its custom duty bounds and stays inside company',async()=>{
  const base={name:'شیفت خودکار',start_time:'00:00',end_time:'00:00',duty_minutes:453,schedule_kind:'auto'};
  assert.equal((await api('/api/shifts',a,'POST',{...base,schedule:{auto_expected_min:1500}})).status,400);
  const created=await api('/api/shifts',a,'POST',{...base,schedule:{auto_expected_min:453}});
  assert.equal(created.status,201);
  assert.equal((await api('/api/shifts',b)).body.items.some(s=>s.id===created.body.id),false);
});

test('company shift-window policy defaults off and rejects out-of-window attendance when enabled',async()=>{
  assert.equal((await api('/api/settings',a)).body.enforce_shift_window,false);
  const shift=await api('/api/shifts',a,'POST',{name:'روز بدون بازه',start_time:'08:00',end_time:'17:00',duty_minutes:480,
    schedule_kind:'advanced',schedule:{weekly:{0:[],1:[],2:[],3:[],4:[],5:[],6:[]}}});
  assert.equal(shift.status,201);
  assert.equal((await api('/api/assignments',a,'POST',{user_id:1,shift_id:shift.body.id})).status,200);
  assert.equal((await api('/api/settings',a,'PATCH',{enforce_shift_window:true})).status,200);
  assert.equal((await api('/api/attendance',a,'POST',{action:'in',lat:36.3,lng:59.6})).status,403);
  assert.equal((await api('/api/settings',b)).body.enforce_shift_window,false);
  assert.equal((await api('/api/settings',a,'PATCH',{enforce_shift_window:false})).status,200);
});

test('attendance corrections are audited, tenant-scoped and reject archived or overlapping periods',async()=>{
  const staff=(await api('/api/login',null,'POST',{company:'alpha',username:'staff',password:'strong-password-123'})).body.token;
  const write=openDatabase(process.env.DB_PATH);
  const id=Number(write.prepare('INSERT INTO attendance(company_id,user_id,checked_in_at,checked_out_at) VALUES(?,?,?,?)')
    .run(1,3,'2026-09-01T06:00:00.000Z','2026-09-01T08:00:00.000Z').lastInsertRowid);
  const archiveId=Number(write.prepare('INSERT INTO attendance(company_id,user_id,checked_in_at,checked_out_at) VALUES(?,?,?,?)')
    .run(1,3,'2026-10-05T06:00:00.000Z','2026-10-05T08:00:00.000Z').lastInsertRowid);
  write.close();
  const path='/api/attendance/'+id+'/correct';
  const payload={checked_in_at:'2026-09-01T06:30:00.000Z',checked_out_at:'2026-09-01T09:00:00.000Z',reason:'اصلاح با بررسی گزارش ورود و خروج'};
  assert.equal((await api(path,staff,'POST',payload)).status,403);
  assert.equal((await api(path,b,'POST',payload)).status,404);
  assert.equal((await api(path,a,'POST',payload)).status,200);
  const history=(await api('/api/attendance/'+id+'/corrections',a)).body.items;
  assert.equal(history.length,1);assert.equal(history[0].old_in,'2026-09-01T06:00:00.000Z');
  assert.equal(history[0].new_out,payload.checked_out_at);assert.equal(history[0].actor_name,'مدیر شرکت الف');
  assert.equal((await api('/api/attendance/'+id+'/corrections',b)).status,404);
  assert.equal((await api(path,a,'POST',{...payload,checked_out_at:'2026-09-01T07:00:00.000Z',reason:'کوتاه'})).status,400);
  assert.equal((await api(path,a,'POST',{...payload,checked_in_at:'2026-10-06T06:30:00.000Z',checked_out_at:'2026-10-06T09:00:00.000Z'})).status,409);
  assert.equal((await api('/api/attendance/'+archiveId+'/correct',a,'POST',payload)).status,409);
});
