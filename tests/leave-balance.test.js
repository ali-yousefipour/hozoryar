import test from 'node:test';
import assert from 'node:assert/strict';
import { annualLeaveByYear } from '../server/leave-balance.js';

test('annual leave is accounted in Persian year, including a Nowruz boundary',()=>{
  const amounts=annualLeaveByYear([
    {type:'annual_leave',work_date:'2026-03-19',end_date:'2026-03-22',unit:'daily',minutes:480},
    {type:'annual_leave',work_date:'2026-03-22',minutes:60},
    {type:'mission',work_date:'2026-03-21',minutes:480}
  ]);
  assert.equal(amounts.get(1404),960);
  assert.equal(amounts.get(1405),1020);
});
