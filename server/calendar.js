import { isFriday } from './work.js';

const persian=new Intl.DateTimeFormat('en-US-u-ca-persian',{timeZone:'Asia/Tehran',calendar:'persian',year:'numeric',month:'2-digit',day:'2-digit'});
const weekday=new Intl.DateTimeFormat('fa-IR',{timeZone:'Asia/Tehran',weekday:'long'});
export function jalaliDate(isoDay){
  const parts=Object.fromEntries(persian.formatToParts(new Date(isoDay+'T12:00:00Z')).map(p=>[p.type,p.value]));
  return `${parts.year.padStart(4,'0')}-${parts.month.padStart(2,'0')}-${parts.day.padStart(2,'0')}`;
}
export function calendarDays(from,to,manualHolidays=new Map()) {
  const days=[],cursor=new Date(from+'T12:00:00Z'),last=new Date(to+'T12:00:00Z');
  while(cursor<=last){const date=cursor.toISOString().slice(0,10),manual=manualHolidays.get(date)||null;
    days.push({date,jalali:jalaliDate(date),weekday:weekday.format(cursor),is_friday:isFriday(date),is_manual_holiday:!!manual,is_official_holiday:false,is_holiday:!!manual||isFriday(date),title:manual||'',source:manual?'manual':'calculated'});
    cursor.setUTCDate(cursor.getUTCDate()+1);
  }
  return days;
}
