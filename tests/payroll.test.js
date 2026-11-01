import test from 'node:test';
import assert from 'node:assert/strict';
import { payableWorkMinutes, payrollPreview, snapshotDigest } from '../server/payroll.js';

test('Khatyar organization payroll basis never double counts Friday or holiday',()=>{
  const totals={overtime:27,friday_work:480,holiday_work:180,total_overtime:687,mission:120,shortage:60,surplus:100};
  assert.equal(payableWorkMinutes(totals),747);
  assert.equal(payableWorkMinutes(totals,true),847);
  assert.equal(payableWorkMinutes({total_overtime:10,shortage:200}),0);
  assert.equal(payrollPreview({reports:[{id:4,name:'آزمایش',report:{totals}}]})[0].payable_minutes,747);
});

test('financial certificate fingerprint changes if archived report changes',()=>{
  assert.match(snapshotDigest('{"month":"j-1405-07"}'),/^[a-f0-9]{64}$/);
  assert.notEqual(snapshotDigest('{"month":"j-1405-07"}'),snapshotDigest('{"month":"j-1405-08"}'));
});
