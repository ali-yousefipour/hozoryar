import test from 'node:test';
import assert from 'node:assert/strict';
import {apiBase} from '../mobile/api-config.mjs';
test('Android API allows local HTTP only in development and keeps release on HTTPS',()=>{
  assert.equal(apiBase('http://10.0.2.2:3001',true),'http://10.0.2.2:3001');
  assert.equal(apiBase('https://attendance.company.ir/'),'https://attendance.company.ir');
  for(const url of ['http://10.0.2.2:3001','http://attendance.company.ir','https://your-hozoryar-domain.example','https://user:secret@host.ir','https://host.ir/path','https://host.ir?token=abc'])assert.throws(()=>apiBase(url));
  assert.throws(()=>apiBase('http://remote.company.ir',true));
});
