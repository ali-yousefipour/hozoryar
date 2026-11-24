import test from 'node:test';
import assert from 'node:assert/strict';
import {requestDate,requestPayload} from '../mobile/request-data.mjs';
test('employee requests convert Persian and Arabic digits, Nowruz and leap dates',()=>{
  assert.equal(requestDate('۱۴۰۵/۰۹/۰۳'),'2026-11-24');
  assert.equal(requestDate('١٤٠٣/١٢/٣٠'),'2025-03-20');
  assert.equal(requestDate('1404/01/01'),'2025-03-21');
  assert.throws(()=>requestDate('1404/12/30'));
  assert.throws(()=>requestDate('1405/13/01'));
  assert.throws(()=>requestDate('2026-11-24'));
});
test('employee request payload validates date range, duration and substitute eligibility',()=>{
  const values={type:'annual_leave',unit:'daily',from:'1405/09/03',to:'1405/09/04',minutes:'۴۸۰',description:'  test  ',substitute:'42'};
  assert.deepEqual(requestPayload(values),{type:'annual_leave',unit:'daily',work_date:'2026-11-24',end_date:'2026-11-25',minutes:480,description:'test',substitute_user_id:42});
  assert.equal(requestPayload({...values,unit:'hourly',substitute:''}).end_date,'2026-11-24');
  for(const patch of [{to:'1405/08/01'},{to:'1405/11/01'},{minutes:'0'},{minutes:'1.5'},{minutes:'1441'},{type:'mission'},{substitute:'NaN'},{description:'a'.repeat(501)}])assert.throws(()=>requestPayload({...values,...patch}));
});
