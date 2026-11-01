import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedShiftTraffic, attendanceMetrics, dailyWork, dutyForDay, localInstant, nightMinutes, sessionsByEntryDate, splitSessionDetails, splitSessions, sumWork } from '../server/work.js';

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

test('absence is reported separately without adding it twice to shortage',()=>{
  const absent=dailyWork({day:'2026-11-02',worked:0,duty:480});
  assert.equal(absent.absence,480);assert.equal(absent.absence_days,1);
  assert.equal(absent.shortage,480);assert.equal(absent.absence_and_shortage,480);
  const credited=dailyWork({day:'2026-11-02',worked:0,duty:480,approved:[{type:'annual_leave',minutes:120}]});
  assert.equal(credited.absence,0);assert.equal(credited.shortage,360);
  const total=sumWork([absent,credited]);assert.equal(total.absence,480);
  assert.equal(total.absence_and_shortage,840);
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

test('Khatyar overtime cap separates overtime and surplus without duplication',()=>{
  const day=dailyWork({day:'2026-11-02',worked:600,duty:480,overtimeCap:27});
  assert.equal(day.overtime,27);assert.equal(day.surplus,93);
  assert.equal(day.total_overtime,27);assert.equal(day.regular_extra,120);
  const friday=dailyWork({day:'2026-10-30',worked:600,duty:480,holiday:true,overtimeCap:27});
  assert.equal(friday.overtime,0);assert.equal(friday.friday_work,600);
  assert.equal(friday.holiday_work,0);assert.equal(friday.total_overtime,600);
});

test('Khatyar night period 22:00 to 06:00 is counted in Tehran time',()=>{
  const parts=splitSessionDetails([{checked_in_at:'2026-11-01T17:30:00Z',checked_out_at:'2026-11-02T03:30:00Z'}],
    '2026-11-01','2026-11-02',new Date('2026-11-02T04:00:00Z'));
  assert.equal(nightMinutes(parts.get('2026-11-01'), '2026-11-01'),120);
  assert.equal(nightMinutes(parts.get('2026-11-02'), '2026-11-02'),360);
});

test('overnight session belongs entirely to its check-in date in work report',()=>{
  const sessions=[{checked_in_at:'2026-11-01T19:30:00Z',checked_out_at:'2026-11-02T03:30:00Z'}];
  const grouped=sessionsByEntryDate(sessions,'2026-11-01','2026-11-02',new Date('2026-11-02T04:00:00Z'));
  assert.equal(grouped.get('2026-11-01').length,1);
  assert.equal(grouped.get('2026-11-02'),undefined);
  const shift={start_time:'23:00',end_time:'07:00',schedule_kind:'fixed'};
  const metrics=attendanceMetrics(shift,'2026-11-01',grouped.get('2026-11-01'));
  assert.equal(metrics.worked,480);assert.equal(metrics.in_shift,480);
  assert.equal(metrics.late_in,0);assert.equal(metrics.early_out,0);
  assert.equal(metrics.night,420);
});

test('shift window computes late, early and valid before/after overtime',()=>{
  const day='2026-11-02';
  const parts=[{start:localInstant(day,8*60+20),end:localInstant(day,15*60+35)}];
  const metrics=attendanceMetrics({start_time:'08:00',end_time:'16:00',schedule_kind:'fixed'},day,parts,{late_ok:5,early_ok:10,ot_begin:30,ot_end:30});
  assert.equal(metrics.worked,435);assert.equal(metrics.in_shift,435);
  assert.equal(metrics.late_in,15);assert.equal(metrics.early_out,15);
  assert.equal(metrics.window_extra,0);
  const report=dailyWork({day,...metrics,duty:480,overtimeCap:27});
  assert.equal(report.shortage,45);
});

test('advanced Khatyar-style split shift excludes breaks and derives daily duty from segments',()=>{
  const shift={schedule_kind:'advanced',schedule_json:JSON.stringify({weekly:{1:[{s:'08:00',e:'12:00'},{s:'13:00',e:'17:00'}]}})};
  const day='2026-11-02';
  assert.equal(dutyForDay(shift,day),480);
  assert.equal(dutyForDay(shift,'2026-11-03'),0);
  const parts=[{start:localInstant(day,7*60+45),end:localInstant(day,12*60)},{start:localInstant(day,13*60+10),end:localInstant(day,17*60+30)}];
  const metrics=attendanceMetrics(shift,day,parts,{ot_begin:30,ot_end:30});
  assert.equal(metrics.worked,515);
  assert.equal(metrics.in_shift,470);
  assert.equal(metrics.window_extra,45);
  assert.equal(metrics.late_in,0);assert.equal(metrics.early_out,0);
  const report=dailyWork({day,...metrics,duty:dutyForDay(shift,day),overtimeCap:27});
  assert.equal(report.shortage,10);assert.equal(report.overtime,27);assert.equal(report.surplus,18);
});

test('Khatyar segmented rotation cycles through distinct periods and overnight attendance',()=>{
  const shift={schedule_kind:'rotation_segments',schedule_json:JSON.stringify({anchor:'2026-11-02',cycle:[
    {days:2,segments:[{s:'07:00',e:'15:00'}]},
    {days:1,segments:[]},
    {days:2,segments:[{s:'23:00',e:'07:00'}]}
  ]})};
  assert.equal(dutyForDay(shift,'2026-11-01'),0);
  assert.equal(dutyForDay(shift,'2026-11-02'),480);
  assert.equal(dutyForDay(shift,'2026-11-04'),0);
  assert.equal(dutyForDay(shift,'2026-11-05'),480);
  assert.equal(dutyForDay(shift,'2026-11-07'),480);
  const day='2026-11-05',metrics=attendanceMetrics(shift,day,[{start:localInstant(day,23*60),end:localInstant(day,31*60)}]);
  assert.equal(metrics.worked,480);assert.equal(metrics.in_shift,480);
  assert.equal(metrics.late_in,0);assert.equal(metrics.early_out,0);
});

test('overtime windows count only approved margins and respect daily cap',()=>{
  const day='2026-11-02';
  const parts=[{start:localInstant(day,7*60+15),end:localInstant(day,16*60+45)}];
  const metrics=attendanceMetrics({start_time:'08:00',end_time:'16:00',schedule_kind:'fixed'},day,parts,{ot_begin:30,ot_end:20});
  assert.equal(metrics.worked,570);
  assert.equal(metrics.in_shift,480);
  assert.equal(metrics.window_extra,50);
  assert.equal(metrics.late_in,0);
  assert.equal(metrics.early_out,0);
  const report=dailyWork({day,...metrics,duty:480,overtimeCap:27});
  assert.equal(report.overtime,27);
  assert.equal(report.surplus,63);
});

test('unpaid leave is separately reported, excuses absence but is never counted as presence or paid leave',()=>{
  const report=dailyWork({day:'2026-11-02',worked:0,in_shift:0,duty:480,
    approved:[{type:'unpaid_leave',minutes:480}],hasShift:true});
  assert.equal(report.unpaid_leave,480);
  assert.equal(report.leave,0);assert.equal(report.mission,0);
  assert.equal(report.worked,0);assert.equal(report.shortage,0);
  assert.equal(report.absence,0);
  assert.equal(sumWork([report]).unpaid_leave,480);
});

test('Khatyar automatic shift uses independent daily duty and no fixed-clock tardiness',()=>{
  const day='2026-11-02';
  const shift={schedule_kind:'auto',schedule_json:JSON.stringify({auto_expected_min:453})};
  const metrics=attendanceMetrics(shift,day,[{start:localInstant(day,9*60),end:localInstant(day,17*60)}]);
  assert.equal(dutyForDay(shift,day),453);
  assert.equal(metrics.worked,480);assert.equal(metrics.in_shift,480);
  assert.equal(metrics.late_in,0);assert.equal(metrics.early_out,0);
  const report=dailyWork({day,...metrics,duty:dutyForDay(shift,day),overtimeCap:27});
  assert.equal(report.overtime,27);assert.equal(report.shortage,0);
  assert.equal(report.surplus,0);
});

test('shift traffic gates use start/end windows and recognize previous-day night checkout',()=>{
  const day='2026-11-02';
  const fixed={schedule_kind:'fixed',start_time:'08:00',end_time:'16:00',duty_minutes:480,schedule_json:'{}'};
  assert.equal(allowedShiftTraffic(fixed,localInstant(day,7*60+30),'in'),true);
  assert.equal(allowedShiftTraffic(fixed,localInstant(day,11*60),'in'),false);
  assert.equal(allowedShiftTraffic(fixed,localInstant(day,16*60+40),'out'),true);
  assert.equal(allowedShiftTraffic(fixed,localInstant(day,11*60),'out'),false);
  const night={...fixed,start_time:'23:00',end_time:'07:00'};
  const tomorrow='2026-11-03';
  assert.equal(allowedShiftTraffic(night,localInstant(tomorrow,6*60+30),'out'),true);
  assert.equal(allowedShiftTraffic(night,localInstant(tomorrow,12*60),'out'),false);
  const floating={schedule_kind:'auto',schedule_json:'{}'};
  assert.equal(allowedShiftTraffic(floating,localInstant(day,11*60),'in'),true);
});
