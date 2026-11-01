import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.js';
import { loadOfficialCalendar, CalendarUnavailableError, parseOfficialYear } from '../server/official-calendar.js';

const payload={year:1405,data:Array.from({length:11},(_,i)=>({
  year_sh:1405,month_sh:1,day_sh:i+1,
  date_gregorian:new Date(Date.UTC(2026,2,21+i)).toISOString().slice(0,10),
  estimate:false,events:[{title_fa:`تعطیلی نمونه ${i+1}`,is_holiday:true}]
}))};

test('provider validates online response, caches by year and uses stale cache on outage',async()=>{
  const db=openDatabase(':memory:');let count=0;
  const fetcher=async(url,opts)=>{count++;assert.equal(url,'https://www.persian-calendar.com/api/holidays?year=1405');
    assert.equal(opts.headers.Accept,'application/json');return {ok:true,json:async()=>payload};};
  const now=Date.parse('2026-11-01T12:00:00Z');
  try{
    const first=await loadOfficialCalendar(db,'2026-03-21','2026-03-22',{fetcher,now});
    assert.equal(first.days.get('2026-03-21').title,'تعطیلی نمونه 1');
    assert.equal(first.stale,false);assert.equal(count,1);
    await loadOfficialCalendar(db,'2026-03-21','2026-03-21',{fetcher,now:now+60000});
    assert.equal(count,1);
    const stale=await loadOfficialCalendar(db,'2026-03-21','2026-03-21',{fetcher:async()=>{throw Error('offline');},now:now+25*3600000});
    assert.equal(stale.stale,true);
    assert.equal(stale.days.get('2026-03-21').title,'تعطیلی نمونه 1');
  }finally{db.close();}
});

test('provider rejects malformed or unavailable official data instead of treating dates as ordinary',async()=>{
  assert.throws(()=>parseOfficialYear(1405,{...payload,year:1404}),CalendarUnavailableError);
  assert.throws(()=>parseOfficialYear(1405,{...payload,data:payload.data.map(d=>({...d,date_gregorian:'2026-03-21'}))}),CalendarUnavailableError);
  const db=openDatabase(':memory:');
  try{
    await assert.rejects(loadOfficialCalendar(db,'2026-03-21','2026-03-21',{
      fetcher:async()=>({ok:false,status:429})
    }),err=>err.status===503);
  }finally{db.close();}
});
