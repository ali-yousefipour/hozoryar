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
