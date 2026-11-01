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

function localMinute(timestamp){const p=Object.fromEntries(clockFormatter.formatToParts(new Date(timestamp)).map(x=>[x.type,x.value]));return Number(p.hour)*60+Number(p.minute);}
export function nightMinutes(parts,day) {
  let total=0;
  for(const part of parts){const start=localMinute(part.start),end=tehranDate(new Date(part.end))!==day?1440:localMinute(part.end);
    total+=Math.max(0,Math.min(end,360)-Math.max(start,0));
    total+=Math.max(0,Math.min(end,1440)-Math.max(start,1320));
  }
  return Math.floor(total);
}

export function dailyWork({day,worked=0,duty=0,approved=[],holiday=false,overtimeCap=27,night=0}) {
  const rounded=Math.max(0,Math.floor(worked));
  const friday=isFriday(day);
  const expected=friday||holiday?0:Math.max(0,duty);
  const leave=approved.filter(x=>x.type==='annual_leave'||x.type==='sick_leave').reduce((sum,x)=>sum+x.minutes,0);
  const mission=approved.filter(x=>x.type==='mission').reduce((sum,x)=>sum+x.minutes,0);
  const credited=Math.min(expected,leave+mission);
  const shortage=Math.max(0,expected-rounded-credited);
  const extra=Math.max(0,rounded-expected);
  const overtime=friday||holiday?0:Math.min(extra,Math.max(0,overtimeCap));
  const surplus=friday||holiday?0:Math.max(0,extra-overtime);
  return {day,worked:rounded,expected,leave,mission,shortage,surplus,overtime,night,
    friday_work:friday?rounded:0,holiday_work:holiday&&!friday?rounded:0,
    // Friday/holiday categories remain mutually exclusive; financial policy must not add them twice.
    total_overtime:overtime+(friday?rounded:0)+(holiday&&!friday?rounded:0),
    regular_extra:!friday&&!holiday?extra:0};
}
export function sumWork(rows) {
  const keys=['worked','expected','leave','mission','shortage','surplus','overtime','night','total_overtime','friday_work','holiday_work','regular_extra'];
  return Object.fromEntries(keys.map(k=>[k,rows.reduce((total,r)=>total+r[k],0)]));
}
