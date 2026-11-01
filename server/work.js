// Period calculation is deliberately pure: no dependence on the caller's locale or tenant.
const localDateFormatter = new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit',calendar:'gregory'
});
const weekdayFormatter = new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tehran',weekday:'short'});
export const tehranDate = date => {
  const fields=Object.fromEntries(localDateFormatter.formatToParts(date).map(x=>[x.type,x.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
};
export const isFriday = date => weekdayFormatter.format(new Date(date+'T12:00:00+03:30'))==='Fri';
const nextDateBoundary = ms => {
  const day=tehranDate(new Date(ms));let low=ms+1,high=ms+48*3600000;
  while(low<high){const mid=Math.floor((low+high)/2);if(tehranDate(new Date(mid))===day)low=mid+1;else high=mid;}
  return low;
};
export function splitSessions(sessions,from,to,now=new Date()) {
  const days=new Map();const nowMs=now.getTime();
  for(const s of sessions){let start=Date.parse(s.checked_in_at),end=s.checked_out_at?Date.parse(s.checked_out_at):nowMs;
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)continue;
    end=Math.min(end,nowMs);
    while(start<end){const day=tehranDate(new Date(start)),boundary=nextDateBoundary(start),until=Math.min(end,boundary);
      if(day>=from&&day<=to)days.set(day,(days.get(day)||0)+(until-start)/60000);
      start=until;
    }
  }
  return days;
}

export function dailyWork({day,worked=0,duty=0,approved=[],holiday=false}) {
  const rounded=Math.max(0,Math.floor(worked));
  const friday=isFriday(day);
  const expected=friday||holiday?0:Math.max(0,duty);
  const leave=approved.filter(x=>x.type==='annual_leave'||x.type==='sick_leave').reduce((sum,x)=>sum+x.minutes,0);
  const mission=approved.filter(x=>x.type==='mission').reduce((sum,x)=>sum+x.minutes,0);
  const credited=Math.min(expected,leave+mission);
  const shortage=Math.max(0,expected-rounded-credited);
  const surplus=Math.max(0,rounded-expected);
  return {day,worked:rounded,expected,leave,mission,shortage,surplus,
    friday_work:friday?rounded:0,holiday_work:holiday&&!friday?rounded:0,
    // Extra presence is informational, never added again to Friday/holiday categories.
    regular_extra:!friday&&!holiday?surplus:0};
}
export function sumWork(rows) {
  const keys=['worked','expected','leave','mission','shortage','surplus','friday_work','holiday_work','regular_extra'];
  return Object.fromEntries(keys.map(k=>[k,rows.reduce((total,r)=>total+r[k],0)]));
}
