import test from 'node:test';
import assert from 'node:assert/strict';
import { reportedOfflineMinutes } from '../server/monitoring.js';

test('only explicit off/on device events create nonfinancial monitoring minutes',()=>{
  const session={checked_in_at:'2026-11-02T06:00:00Z',checked_out_at:'2026-11-02T08:00:00Z'};
  assert.deepEqual(reportedOfflineMinutes(session,[]),{gps_off_minutes:0,internet_off_minutes:0});
  const result=reportedOfflineMinutes(session,[
    {kind:'gps_off',recorded_at:'2026-11-02T06:15:00Z'},
    {kind:'gps_on',recorded_at:'2026-11-02T06:45:00Z'},
    {kind:'internet_off',recorded_at:'2026-11-02T07:10:00Z'}
  ],new Date('2026-11-02T09:00:00Z'));
  assert.equal(result.gps_off_minutes,30);
  assert.equal(result.internet_off_minutes,50);
});
