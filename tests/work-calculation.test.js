import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyWork, dutyForDay, splitSessions, sumWork } from '../server/work.js';

test('Friday is exclusive of a manually declared holiday',()=>{
  const friday=dailyWork({day:'2026-10-30',worked:600,duty:480,holiday:true});
  assert.equal(friday.friday_work,600);
  assert.equal(friday.holiday_work,0);
  assert.equal(friday.regular_extra,0);
  assert.equal(friday.expected,0);
});

test('leave and mission credit expected minutes but not as worked attendance',()=>{
  const day=dailyWork({day:'2026-11-02',worked:180,duty:480,approved:[
    {type:'annual_leave',minutes:120},{type:'mission',minutes:60}
  ]});
  assert.equal(day.worked,180);assert.equal(day.leave,120);
  assert.equal(day.mission,60);assert.equal(day.shortage,120);
  assert.equal(day.surplus,0);
});

test('night session splits across Tehran midnight and open session is capped at now',()=>{
  const sessions=[{checked_in_at:'2026-11-01T19:30:00.000Z',checked_out_at:'2026-11-01T22:30:00.000Z'}];
  const result=splitSessions(sessions,'2026-11-01','2026-11-02',new Date('2026-11-02T01:00:00.000Z'));
  assert.equal(result.get('2026-11-01'),60);
  assert.equal(result.get('2026-11-02'),120);
  const open=splitSessions([{checked_in_at:'2026-11-02T06:00:00Z',checked_out_at:null}], '2026-11-02','2026-11-02',new Date('2026-11-02T07:15:00Z'));
  assert.equal(open.get('2026-11-02'),75);
});

test('monthly summary is a simple non-duplicating sum',()=>{
  const days=[dailyWork({day:'2026-10-30',worked:240,holiday:true}),dailyWork({day:'2026-10-31',worked:450,duty:480})];
  const sum=sumWork(days);assert.equal(sum.worked,690);assert.equal(sum.friday_work,240);
  assert.equal(sum.holiday_work,0);assert.equal(sum.shortage,30);
});

test('weekly, rotating and floating shifts use independent duty rules',()=>{
  const weekly={duty_minutes:480,schedule_kind:'weekly',schedule_json:JSON.stringify({days:[1,2,3,4]})};
  assert.equal(dutyForDay(weekly,'2026-11-02'),480);
  assert.equal(dutyForDay(weekly,'2026-11-06'),0);
  const rotating={duty_minutes:600,schedule_kind:'rotating',schedule_json:JSON.stringify({anchor:'2026-11-01',work:2,rest:2})};
  assert.equal(dutyForDay(rotating,'2026-11-02'),600);
  assert.equal(dutyForDay(rotating,'2026-11-03'),0);
  assert.equal(dutyForDay(rotating,'2026-10-31'),0);
  assert.equal(dutyForDay({duty_minutes:360,schedule_kind:'floating',schedule_json:'{}'},'2026-11-02'),360);
});
