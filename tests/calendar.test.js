import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDays, jalaliDate, jalaliMonthBounds } from '../server/calendar.js';

test('Jalali conversion follows Iranian calendar',()=>{
  assert.equal(jalaliDate('2026-03-21'),'1405-01-01');
  assert.deepEqual(jalaliMonthBounds('1405-01'),{from:'2026-03-21',to:'2026-04-20'});
  assert.deepEqual(jalaliMonthBounds('1405-07'),{from:'2026-09-23',to:'2026-10-22'});
  assert.equal(jalaliMonthBounds('1405-13'),null);
});
test('manual holidays and Friday are independent classifications',()=>{
  const days=calendarDays('2026-10-30','2026-10-31',new Map([['2026-10-30','تعطیلی شرکت']]));
  assert.equal(days[0].is_friday,true);
  assert.equal(days[0].is_manual_holiday,true);
  assert.equal(days[0].source,'manual');
  assert.equal(days[1].is_friday,false);
  assert.equal(days[1].is_holiday,false);
  assert.equal(days[0].is_official_holiday,false);
});
