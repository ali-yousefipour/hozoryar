import { isFriday } from './work.js';
import { referenceHoliday, hasReferenceYear } from './official-holidays.js';

const persian=new Intl.DateTimeFormat('en-US-u-ca-persian',{timeZone:'Asia/Tehran',calendar:'persian',year:'numeric',month:'2-digit',day:'2-digit'});
const weekday=new Intl.DateTimeFormat('fa-IR',{timeZone:'Asia/Tehran',weekday:'long'});
export function jalaliDate(isoDay){
  const parts=Object.fromEntries(persian.formatToParts(new Date(isoDay+'T12:00:00Z')).map(p=>[p.type,p.value]));
  return `${parts.year.padStart(4,'0')}-${parts.month.padStart(2,'0')}-${parts.day.padStart(2,'0')}`;
}
export function jalaliMonthBounds(month){
  if(!/^1[34]\d{2}-(0[1-9]|1[0-2])$/.test(month||''))return null;
  const year=Number(month.slice(0,4));
  const approximate=new Date(Date.UTC(year+621,2,18));
  let from=null,to=null;
  for(let i=0;i<375;i++){
    const date=new Date(approximate.getTime()+i*86400000).toISOString().slice(0,10);
    if(jalaliDate(date).slice(0,7)===month){from??=date;to=date;}
    else if(from)break;
  }
  return from?{from,to}:null;
}
export function calendarDays(from,to,manualHolidays=new Map()) {
  const days=[],cursor=new Date(from+'T12:00:00Z'),last=new Date(to+'T12:00:00Z');
  while(cursor<=last){const date=cursor.toISOString().slice(0,10),manual=manualHolidays.get(date)||null;
    const jalali=jalaliDate(date),official=referenceHoliday(jalali),friday=isFriday(date);
    days.push({date,jalali,weekday:weekday.format(cursor),is_friday:friday,is_manual_holiday:!!manual,
      is_official_holiday:!!official,is_holiday:!!manual||!!official||friday,
      title:[official,manual].filter(Boolean).join(' | '),
      source:official&&manual?'official-reference+manual':official?'official-reference':manual?'manual':'calculated',
      official_reference_available:hasReferenceYear(jalali.slice(0,4))});
    cursor.setUTCDate(cursor.getUTCDate()+1);
  }
  return days;
}
