// Period calculation is deliberately pure: no dependence on the caller's locale or tenant.
const localDateFormatter = new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit',calendar:'gregory'
});
const weekdayFormatter = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tehran',weekday:'short'});
const clockFormatter = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tehran',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const tehranDate = date => {
  const fields=Object.fromEntries(localDateFormatter.formatToParts(date).map(x=>[x.type,x.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
};
export const isFriday = date => weekdayFormatter.format(new Date(date+'T12:00:00+03:30'))==='Fri';
export function dutyForDay(shift,day) {
  if(!shift)return 0;
  const kind=shift.schedule_kind||'fixed',config=JSON.parse(shift.schedule_json||'{}');
  const weekday=new Date(day+'T12:00:00Z').getUTCDay();
  if(kind==='weekly')return config.days.includes(weekday)?shift.duty_minutes:0;
  if(kind==='rotating'){
    const elapsed=Math.floor((Date.parse(day+'T00:00:00Z')-Date.parse(config.anchor+'T00:00:00Z'))/86400000);
    const index=((elapsed%(config.work+config.rest))+(config.work+config.rest))%(config.work+config.rest);
    return index<config.work?shift.duty_minutes:0;
  }
  if(kind==='floating')return shift.duty_minutes;
  return shift.duty_minutes;
}
const nextDateBoundary = ms => {
  const day=tehranDate(new Date(ms));let low=ms+1,high=ms+48*3600000;
  while(low<high){const mid=Math.floor((low+high)/2);if(tehranDate(new Date(mid))===day)low=mid+1;else high=mid;}
  return low;
};
export function splitSessionDetails(sessions,from,to,now=new Date()) {
  const days=new Map();const nowMs=now.getTime();
  for(const s of sessions){let start=Date.parse(s.checked_in_at),end=s.checked_out_at?Date.parse(s.checked_out_at):nowMs;
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)continue;
    end=Math.min(end,nowMs);
    while(start<end){const day=tehranDate(new Date(start)),boundary=nextDateBoundary(start),until=Math.min(end,boundary);
      if(day>=from&&day<=to){const parts=days.get(day)||[];parts.push({start,end:until});days.set(day,parts);}
      start=until;
    }
  }
  return days;
}
export function splitSessions(sessions,from,to,now=new Date()) {
  return new Map([...splitSessionDetails(sessions,from,to,now)].map(([day,parts])=>[day,parts.reduce((sum,p)=>sum+(p.end-p.start)/60000,0)]));
}

// Financial work ownership follows the check-in date, as in Khatyar's canonical
// attendance report. A session crossing midnight is never counted a second time.
export function sessionsByEntryDate(sessions,from,to,now=new Date()) {
  const grouped=new Map(),nowMs=now.getTime();
  for(const session of sessions){const start=Date.parse(session.checked_in_at);
    const end=Math.min(session.checked_out_at?Date.parse(session.checked_out_at):nowMs,nowMs);
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)continue;
    const day=tehranDate(new Date(start));if(day<from||day>to)continue;
    const parts=grouped.get(day)||[];parts.push({start,end});grouped.set(day,parts);
  }
  return grouped;
}

export function localInstant(day,minutes) {
  const target=Date.parse(day+'T00:00:00Z')+minutes*60000;
  let guess=target-210*60000;
  for(let i=0;i<4;i++){
    const localDay=tehranDate(new Date(guess));
    const shown=Date.parse(localDay+'T00:00:00Z')+localMinute(guess)*60000;
    const delta=target-shown;if(delta===0)break;guess+=delta;
  }
  return guess;
}

function union(parts) {
  const sorted=parts.filter(x=>x.end>x.start).sort((a,b)=>a.start-b.start);
  const merged=[];
  for(const part of sorted){const last=merged.at(-1);if(last&&part.start<=last.end)last.end=Math.max(last.end,part.end);
    else merged.push({...part});}
  return merged;
}
function overlap(parts,start,end){return parts.reduce((total,p)=>total+Math.max(0,Math.min(end,p.end)-Math.max(start,p.start))/60000,0);}
function minuteOf(hm){const [h,m]=String(hm).split(':').map(Number);return h*60+m;}
export function attendanceMetrics(shift,day,rawParts,config={}) {
  const parts=union(rawParts);
  const worked=Math.floor(parts.reduce((total,p)=>total+(p.end-p.start)/60000,0));
  const nights=splitSessionDetails(parts.map(p=>({checked_in_at:new Date(p.start).toISOString(),checked_out_at:new Date(p.end).toISOString()})),day,'9999-12-31',new Date(Math.max(Date.now(),...parts.map(p=>p.end),0)));
  const night=Math.floor([...nights].reduce((total,[date,segments])=>total+nightMinutes(segments,date),0));
  if(!shift)return {worked,in_shift:0,night,late_in:0,early_out:0,window_extra:0};
  if(shift.schedule_kind==='floating')return {worked,in_shift:worked,night,late_in:0,early_out:0,window_extra:0};
  const startMinute=minuteOf(shift.start_time),endMinute=minuteOf(shift.end_time);
  const begin=localInstant(day,startMinute),finish=localInstant(day,endMinute<=startMinute?endMinute+1440:endMinute);
  const in_shift=Math.floor(overlap(parts,begin,finish));
  const earliest=parts[0]?.start,latest=parts.at(-1)?.end;
  const late_in=earliest===undefined?0:Math.max(0,Math.floor((earliest-begin)/60000)-(config.late_ok||0));
  const early_out=latest===undefined?0:Math.max(0,Math.floor((finish-latest)/60000)-(config.early_ok||0));
  const window_extra=Math.floor(overlap(parts,begin-(config.ot_begin||0)*60000,begin)+overlap(parts,finish,finish+(config.ot_end||0)*60000));
  return {worked,in_shift,night,late_in,early_out,window_extra};
}

function localMinute(timestamp){const p=Object.fromEntries(clockFormatter.formatToParts(new Date(timestamp)).map(x=>[x.type,x.value]));return Number(p.hour)*60+Number(p.minute);}
export function nightMinutes(parts,day) {
  let total=0;
  for(const part of parts){const start=localMinute(part.start),end=tehranDate(new Date(part.end))!==day?1440:localMinute(part.end);
    total+=Math.max(0,Math.min(end,360)-Math.max(start,0));
    total+=Math.max(0,Math.min(end,1440)-Math.max(start,1320));
  }
  return Math.floor(total);
}

export function dailyWork({day,worked=0,duty=0,approved=[],holiday=false,overtimeCap=27,night=0,in_shift=worked,late_in=0,early_out=0,window_extra=0,hasShift=true}) {
  const rounded=Math.max(0,Math.floor(worked));
  const friday=isFriday(day);
  const expected=friday||holiday?0:Math.max(0,duty);
  const leave=approved.filter(x=>x.type==='annual_leave'||x.type==='sick_leave').reduce((sum,x)=>sum+x.minutes,0);
  const mission=approved.filter(x=>x.type==='mission').reduce((sum,x)=>sum+x.minutes,0);
  const credited=Math.min(expected,leave+mission);
  const shortage=Math.max(0,expected-Math.min(expected,in_shift)-credited);
  const absent=expected>0&&rounded===0&&credited===0;
  const extra=Math.max(0,rounded-expected,window_extra);
  const overtime=friday||holiday||!hasShift||expected===0?0:Math.min(extra,Math.max(0,overtimeCap));
  const surplus=friday||holiday||!hasShift||expected===0?0:Math.max(0,extra-overtime);
  return {day,worked:rounded,in_shift:Math.floor(in_shift),expected,leave,mission,shortage,absence:absent?shortage:0,absence_days:absent?1:0,absence_and_shortage:shortage,surplus,overtime,night,
    late_in:friday||holiday||!hasShift?0:late_in,early_out:friday||holiday||!hasShift?0:early_out,
    friday_work:friday?rounded:0,holiday_work:holiday&&!friday?rounded:0,
    // Friday/holiday categories remain mutually exclusive; financial policy must not add them twice.
    total_overtime:overtime+(friday?rounded:0)+(holiday&&!friday?rounded:0),
    regular_extra:!friday&&!holiday?extra:0};
}
export function sumWork(rows) {
  const keys=['worked','in_shift','expected','leave','mission','shortage','absence','absence_days','absence_and_shortage','surplus','overtime','night','late_in','early_out','total_overtime','friday_work','holiday_work','regular_extra'];
  return Object.fromEntries(keys.map(k=>[k,rows.reduce((total,r)=>total+r[k],0)]));
}
