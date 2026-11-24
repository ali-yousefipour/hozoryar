import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import http from 'node:http';
import {gregorianDate} from '../web/admin.js';

test('report date conversion validates Jalali, Persian digits and Gregorian dates',()=>{
  assert.equal(gregorianDate('۱۴۰۵/۰۸/۱۰','jalali'),'2026-11-01');
  assert.equal(gregorianDate('1403-12-30','jalali'),'2025-03-20');
  assert.throws(()=>gregorianDate('1404-12-30','jalali'));
  assert.throws(()=>gregorianDate('2026-02-30'));
  assert.throws(()=>gregorianDate('1405-13-01','jalali'));
});

test('PHP reports enforce tenants, roles, entry-day ownership and approved request totals',{
  skip:!process.env.HOZORYAR_PHP_TEST_CONFIG,timeout:30000
},async t=>{
  const env={...process.env,HOZORYAR_CONFIG:process.env.HOZORYAR_PHP_TEST_CONFIG};
  const seed=spawnSync('php',['tests/php-admin-fixture.php'],{env,encoding:'utf8'});
  assert.equal(seed.status,0,seed.stderr);const fixture=JSON.parse(seed.stdout);
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const server=spawn('php',['-S',`127.0.0.1:${port}`,'-t','php/app','php/app/index.php'],{env,stdio:['ignore','ignore','pipe']});
  t.after(async()=>{server.kill();if(server.exitCode===null)await once(server,'exit');});
  await new Promise((resolve,reject)=>{server.stderr.on('data',b=>{if(b.toString().includes('Development Server'))resolve();});server.once('error',reject);});
  const api=(path,token,method='GET',body)=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port,path,method,headers:{Connection:'close',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})}},res=>{
      let text='';res.setEncoding('utf8');res.on('data',c=>text+=c);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(e){reject(new Error(text));}});
    });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
  });
  const login=async(company,username='admin')=>{const r=await api('/api/login',null,'POST',{company,username,password:'TestReports!74pass'});assert.equal(r.status,200);return r.body.token;};
  const a=await login(fixture.a.company),b=await login(fixture.b.company),employee=await login(fixture.a.company,'employee');
  const range='?from=2026-10-28&to=2026-10-31';
  for(const kind of ['attendance','leave','tracking','audit','work-summary']){
    assert.equal((await api('/api/reports/'+kind+range)).status,401,kind);
    assert.equal((await api('/api/reports/'+kind+range,employee)).status,403,kind);
  }
  let r=await api('/api/reports/attendance'+range,a);assert.equal(r.status,200);assert.equal(r.body.sessions,3);
  assert.equal(r.body.items.find(d=>d.day==='2026-10-28').worked_minutes,540);
  assert.equal(r.body.items.find(d=>d.day==='2026-10-28').sessions.length,2);
  assert.ok(r.body.items.every(d=>d.user_id===fixture.a.user_id));
  r=await api('/api/reports/attendance'+range,b);assert.equal(r.body.sessions,1);assert.ok(r.body.items.every(d=>d.user_id===fixture.b.user_id));
  r=await api('/api/reports/attendance'+range+'&incomplete=1',a);assert.equal(r.body.sessions,1);assert.equal(r.body.items[0].day,'2026-10-29');
  for(const filter of [`user_id=${fixture.b.user_id}`,`zone_id=${fixture.b.zone_id}`])assert.equal((await api('/api/reports/attendance'+range+'&'+filter,a)).status,404);
  assert.equal((await api('/api/reports/attendance?from=2026-02-30&to=2026-03-02',a)).status,400);
  assert.equal((await api('/api/reports/attendance?from=2026-01-01&to=2026-12-31',a)).status,400);
  r=await api('/api/reports/leave?from=2026-10-29&to=2026-10-30&exclude_missions=1',a);assert.equal(r.status,200);
  assert.equal(r.body.summary[0].annual_leave,960);assert.equal(r.body.summary[0].sick_leave,0);assert.equal(r.body.summary[0].pending,1);assert.equal(r.body.items.length,2);
  r=await api('/api/reports/work-summary?from=2026-10-28&to=2026-10-28&user_id='+fixture.a.user_id,a);assert.equal(r.status,200);assert.equal(r.body.items[0].totals.worked,540);
  assert.equal((await api('/api/reports/leave'+range,b)).body.items.length,0);
  assert.equal((await api('/api/reports/tracking'+range,a)).body.items.length,1);
  assert.equal((await api('/api/reports/tracking'+range,b)).body.items.length,0);
  const correction={checked_in_at:'2026-10-28T20:00:00.000Z',checked_out_at:'2026-10-29T03:30:00.000Z',reason:'Test audited correction'};
  assert.equal((await api(`/api/attendance/${fixture.closed_id}/correct`,b,'POST',correction)).status,404);
  assert.equal((await api(`/api/attendance/${fixture.closed_id}/correct`,a,'POST',correction)).status,200);
  r=await api(`/api/attendance/${fixture.closed_id}/corrections`,a);assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].actor_name,'Owner a');
  const edit={name:'Updated employee',username:'employee',role:'employee',active:false};
  assert.equal((await api(`/api/users/${fixture.b.user_id}`,a,'PATCH',edit)).status,404);
  assert.equal((await api(`/api/users/${fixture.employee_id}`,employee,'PATCH',edit)).status,403);
  assert.equal((await api(`/api/users/${fixture.a.user_id}`,a,'PATCH',{...edit,username:'admin',role:'owner'})).status,403);
  assert.equal((await api(`/api/users/${fixture.inactive_id}`,a,'PATCH',{...edit,username:'inactive',active:true})).status,409);
  assert.equal((await api(`/api/users/${fixture.employee_id}`,a,'PATCH',edit)).status,200);
  assert.equal((await api('/api/me',employee)).status,401);
  assert.equal((await api(`/api/users/${fixture.inactive_id}`,a,'PATCH',{...edit,username:'inactive',active:true})).status,200);
  const gps={lat:36.3,lng:59.6,radius_m:200};
  assert.equal((await api(`/api/zones/${fixture.b.zone_id}/geofence`,a,'PATCH',gps)).status,404);
  assert.equal((await api(`/api/zones/${fixture.a.zone_id}/geofence`,b,'PATCH',gps)).status,404);
  assert.equal((await api(`/api/zones/${fixture.a.zone_id}/geofence`,a,'PATCH',{...gps,lng:null})).status,400);
  assert.equal((await api(`/api/zones/${fixture.a.zone_id}/geofence`,a,'PATCH',gps)).status,200);
  // Existing active account has no open attendance and inherits the assigned workplace.
  assert.equal((await api(`/api/users/${fixture.inactive_id}/zone`,a,'PATCH',{zone_id:fixture.a.zone_id,can_be_substitute:false})).status,200);
  const staff=await login(fixture.a.company,'inactive');
  assert.equal((await api('/api/attendance',staff,'POST',{action:'in',lat:0,lng:0,accuracy:10})).status,403);
  assert.equal((await api('/api/attendance',staff,'POST',{action:'in',...gps,accuracy:10})).status,201);
  assert.equal((await api('/api/attendance',staff,'POST',{action:'out'})).status,201);
  const devices='/api/attendance-devices';
  const config={zone_id:fixture.a.zone_id,name:'Side door',model:'Test relay',ip_address:'192.168.1.10',port:4370};
  assert.equal((await api(devices,staff,'POST',config)).status,403);
  assert.equal((await api(devices,b,'POST',config)).status,404);
  r=await api(devices,a,'POST',config);assert.equal(r.status,201);
  const {id:deviceId,key:deviceKey}=r.body;
  const device=`${devices}/${deviceId}`,relay='/api/device-relay/'+deviceId;
  assert.equal((await api(device,b,'PATCH',{enabled:false})).status,404);
  assert.deepEqual((await api(devices,b)).body.items,[]);
  assert.equal((await api(relay,a,'POST',{action:'ping'})).status,401);
  assert.equal((await api(relay,deviceKey,'POST',{action:'ping'})).status,200);
  r=await api(devices,a);assert.ok(r.body.items[0].last_seen_at);assert.ok(!JSON.stringify(r.body).includes(deviceKey));
  const punch={action:'in',username:'inactive',event_id:'terminal-1'};
  assert.equal((await api(relay,deviceKey,'POST',{...punch,username:'employee'})).status,404);
  assert.equal((await api(relay,deviceKey,'POST',punch)).status,201);
  r=await api(relay,deviceKey,'POST',punch);assert.equal(r.status,200);assert.equal(r.body.replayed,true);
  assert.equal((await api(relay,deviceKey,'POST',{...punch,action:'out',event_id:'terminal-2'})).status,201);
  r=await api(device,a,'PATCH',{rotate_key:true});assert.equal(r.status,200);
  assert.equal((await api(relay,deviceKey,'POST',{action:'ping'})).status,401);
  assert.equal((await api(relay,r.body.key,'POST',{action:'ping'})).status,200);
  assert.equal((await api(device,a,'PATCH',{enabled:false})).status,200);
  assert.equal((await api(relay,r.body.key,'POST',{action:'ping'})).status,401);
  const completion={checked_in_at:'2026-10-29T04:30:00.000Z',checked_out_at:'2026-10-29T12:30:00.000Z',reason:'Confirmed actual exit time'};
  assert.equal((await api(`/api/attendance/${fixture.open_id}/complete`,b,'POST',completion)).status,404);
  assert.equal((await api(`/api/attendance/${fixture.open_id}/complete`,a,'POST',{...completion,checked_in_at:'2026-10-29T04:00:00.000Z'})).status,409);
  assert.equal((await api(`/api/attendance/${fixture.open_id}/complete`,a,'POST',completion)).status,200);
  assert.equal((await api(`/api/attendance/${fixture.open_id}/complete`,a,'POST',completion)).status,409);
  r=await api(`/api/attendance/${fixture.open_id}/corrections`,a);assert.equal(r.body.items[0].old_out,null);
  assert.equal((await api('/api/reports/attendance'+range+'&incomplete=1',a)).body.items.length,0);
});
