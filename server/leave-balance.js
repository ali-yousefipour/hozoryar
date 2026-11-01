import { jalaliDate } from './calendar.js';

// Count each approved annual-leave day in its own Persian calendar year.
// Daily requests store minutes PER DAY; hourly requests must be single-day.
export function annualLeaveByYear(requests) {
  const totals=new Map();
  for(const request of requests){
    if(request.type!=='annual_leave')continue;
    const from=request.work_date,to=request.end_date||from;
    const start=Date.parse(from+'T12:00:00Z'),end=Date.parse(to+'T12:00:00Z');
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<start)continue;
    for(let time=start;time<=end;time+=86400000){
      const day=new Date(time).toISOString().slice(0,10),year=Number(jalaliDate(day).slice(0,4));
      totals.set(year,(totals.get(year)||0)+request.minutes);
    }
  }
  return totals;
}
