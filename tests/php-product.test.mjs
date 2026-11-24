import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';

test('PHP product journey: public site, setup, personnel, shift, punch, request and frozen period',{
  skip:!process.env.HOZORYAR_PHP_TEST_CONFIG,timeout:45000
},async t=>{
  const env={...process.env,HOZORYAR_CONFIG:process.env.HOZORYAR_PHP_TEST_CONFIG};
  const seed=spawnSync('php',['tests/php-admin-fixture.php'],{env,encoding:'utf8'});
  assert.equal(seed.status,0,seed.stderr);const fixture=JSON.parse(seed.stdout);
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const server=spawn('php',['-S',`127.0.0.1:${port}`,'-t','php/app','php/app/index.php'],{env,stdio:['ignore','ignore','pipe']});
  t.after(async()=>{server.kill();if(server.exitCode===null)await once(server,'exit');});
  await new Promise((resolve,reject)=>{server.stderr.on('data',b=>{if(b.toString().includes('Development Server'))resolve();});server.once('error',reject);});
  const base=`http://127.0.0.1:${port}`;
  const api=async(path,token,method='GET',body)=>{
    const res=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return {status:res.status,body:await res.json()};
  };
  for(const [path,needle] of [['/','از ثبت حضور'],['/login','login-form'],['/index.html','login-form'],['/home.css','hero'],['/product.css','setup-steps']]){
    const res=await fetch(base+path);assert.equal(res.status,200,path);assert.ok((await res.text()).includes(needle),path);
  }
  const font=await fetch(base+'/fonts/Vazirmatn-Regular.ttf');assert.equal(font.status,200);assert.match(font.headers.get('content-type'),/font\/ttf/);
  for(const path of ['/php/config.php','/data/reports-test-config.php','/fonts/../../php/config.php'])assert.equal((await fetch(base+path)).status,404,path);
  assert.equal((await api('/api/setup')).status,401);
  const login=async(company,username='admin')=>{const r=await api('/api/login',null,'POST',{company,username,password:'TestReports!74pass'});assert.equal(r.status,200);return r.body.token;};
  const owner=await login(fixture.a.company),other=await login(fixture.b.company),employee=await login(fixture.a.company,'employee');
  assert.equal((await api('/api/setup',employee)).status,403);
  let setup=await api('/api/setup',owner);assert.equal(setup.body.counts.personnel,1);assert.equal(setup.body.steps.shifts,false);
  assert.equal((await api('/api/setup',other)).body.counts.personnel,0);
  assert.equal((await api('/api/zones',employee,'POST',{name:'دفتر جدید',requires_substitute:false})).status,403);
  assert.equal((await api('/api/zones',owner,'POST',{name:'دفتر جدید',requires_substitute:false,city:'مشهد',address:'نشانی آزمایشی'})).status,201);
  assert.equal((await api('/api/setup',owner)).body.counts.workplaces,2);
  assert.equal((await api('/api/setup',other)).body.counts.workplaces,1);
  let r=await api('/api/shifts',owner,'POST',{name:'روزانه آزمایشی',start_time:'08:00',end_time:'16:00',duty_minutes:480,daily_ot_cap:60,schedule_kind:'fixed',schedule:{}});
  assert.equal(r.status,201);const shift=r.body.id;
  assert.equal((await api('/api/assignments',other,'POST',{user_id:fixture.employee_id,shift_id:shift})).status,404);
  assert.equal((await api('/api/assignments',owner,'POST',{user_id:fixture.employee_id,shift_id:shift})).status,200);
  assert.equal((await api('/api/assignments',owner)).body.items[0].shift_id,shift);
  assert.equal((await api('/api/assignments',employee)).status,403);
  assert.deepEqual((await api('/api/assignments',other)).body.items,[]);
  setup=await api('/api/setup',owner);assert.equal(setup.body.steps.assigned,true);assert.equal(setup.body.steps.shifts,true);
  assert.equal((await api('/api/setup',other)).body.steps.shifts,false);
  const event={action:'in',event_id:'product-journey-punch-0001',lat:36.3,lng:59.6,accuracy:10};
  r=await api('/api/attendance',employee,'POST',event);assert.equal(r.status,201);
  r=await api('/api/attendance',employee,'POST',event);assert.equal(r.status,200);assert.equal(r.body.replayed,true);
  assert.equal((await api('/api/attendance',employee,'POST',{action:'out',event_id:'product-journey-punch-0002'})).status,201);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  r=await api(`/api/reports/attendance?from=${today}&to=${today}&user_id=${fixture.employee_id}`,owner);
  assert.equal(r.status,200);assert.equal(r.body.sessions,1);
  const leave={type:'annual_leave',unit:'daily',work_date:'2026-11-25',end_date:'2026-11-25',minutes:480,description:'Employee mobile request'};
  r=await api('/api/requests',employee,'POST',leave);assert.equal(r.status,201);const id=r.body.id;
  assert.equal((await api(`/api/requests/${id}/decision`,other,'POST',{status:'approved'})).status,404);
  assert.equal((await api(`/api/requests/${id}/decision`,employee,'POST',{status:'approved'})).status,403);
  assert.equal((await api(`/api/requests/${id}/decision`,owner,'POST',{status:'approved'})).status,200);
  assert.equal((await api('/api/requests?scope=mine',employee)).body.items.find(r=>r.id===id).status,'approved');
  const cid=(await api('/api/me',owner)).body.user.company_id;
  const freeze=spawnSync('php',['-r',`require 'php/lib/Db.php';Db::run('INSERT INTO work_month_archives(company_id,month,snapshot_json,created_by) VALUES(?,?,?,?)',[(int)$argv[1],'2026-09',json_encode(['from'=>'2026-09-01','to'=>'2026-09-30','reports'=>[]]),(int)$argv[2]]);`,String(cid),String(fixture.a.user_id)],{env,encoding:'utf8'});
  assert.equal(freeze.status,0,freeze.stderr);
  assert.equal((await api('/api/requests',employee,'POST',{...leave,work_date:'2026-09-30',end_date:'2026-10-01'})).status,409);
  assert.equal((await api('/api/requests',other,'POST',{...leave,work_date:'2026-09-30',end_date:'2026-10-01'})).status,201);
  assert.equal((await api('/api/users',owner,'POST',{name:'همکار جدید',username:'new.employee',password:'TestReports!74pass',role:'employee'})).status,409);
  assert.equal((await api(`/api/users/${fixture.employee_id}`,owner,'PATCH',{name:'Employee a',username:'employee',role:'employee',active:false})).status,200);
  r=await api('/api/users',owner,'POST',{name:'همکار جدید',username:'new.employee',password:'TestReports!74pass',role:'employee'});assert.equal(r.status,201);
  assert.equal((await api('/api/setup',owner)).body.steps.assigned,false,'Inactive staff assignment must not complete setup');
  assert.equal((await api('/api/assignments',owner,'POST',{user_id:r.body.id,shift_id:shift})).status,200);
  assert.equal((await api('/api/setup',owner)).body.steps.assigned,true);
});
