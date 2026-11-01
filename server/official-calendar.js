import { jalaliDate } from './calendar.js';

const SOURCE='https://www.persian-calendar.com/api/holidays';
// The provider currently advertises Cache-Control: max-age=3600.
const MAX_AGE_MS=60*60*1000;
export class CalendarUnavailableError extends Error {
  constructor(message='داده معتبر تعطیلات رسمی در دسترس نیست؛ محاسبه گزارش تا دریافت تقویم متوقف شد'){
    super(message);this.status=503;
  }
}
function validDay(day){return /^\d{4}-\d{2}-\d{2}$/.test(day||'')&&!Number.isNaN(Date.parse(day))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;}
export function parseOfficialYear(year,payload){
  if(!payload||payload.year!==year||!Array.isArray(payload.data)||payload.data.length<10||payload.data.length>366)
    throw new CalendarUnavailableError('ساختار پاسخ تقویم رسمی نامعتبر است');
  const days={},seen=new Set();let estimated=false;
  for(const item of payload.data){
    const date=item?.date_gregorian;
    if(!validDay(date)||jalaliDate(date).slice(0,4)!==String(year)||item.year_sh!==year||!Array.isArray(item.events)||seen.has(date))
      throw new CalendarUnavailableError('اطلاعات روزهای تقویم رسمی ناسازگار است');
    seen.add(date);
    const events=item.events.filter(e=>e?.is_holiday===true);
    if(!events.length)throw new CalendarUnavailableError('پاسخ تعطیلات، روز غیرتعطیل دارد');
    const title=events.map(e=>typeof e.title_fa==='string'?e.title_fa.trim():'').filter(Boolean).join(' | ');
    if(!title||title.length>600)throw new CalendarUnavailableError('عنوان تعطیلی رسمی نامعتبر است');
    days[date]={title,estimated:item.estimate===true};
    estimated ||= item.estimate===true;
  }
  return {days,estimated};
}
async function downloadYear(year,fetcher){
  const url=`${SOURCE}?year=${year}`;
  const response=await fetcher(url,{headers:{'User-Agent':'Hozoryar/0.8 (+https://github.com/ali-yousefipour/hozoryar)','Accept':'application/json'},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new CalendarUnavailableError('سرویس تقویم رسمی پاسخ معتبر نداد');
  return parseOfficialYear(year,await response.json());
}
export async function loadOfficialCalendar(db,from,to,{fetcher=globalThis.fetch,now=Date.now()}={}){
  const years=new Set(),cursor=new Date(from+'T12:00:00Z'),last=new Date(to+'T12:00:00Z');
  while(cursor<=last){years.add(Number(jalaliDate(cursor.toISOString().slice(0,10)).slice(0,4)));cursor.setUTCDate(cursor.getUTCDate()+1);}
  const days=new Map(),status=[];
  for(const year of years){
    const stored=db.prepare('SELECT payload_json,fetched_at FROM official_calendar_years WHERE jalali_year=?').get(year);
    let data=stored?JSON.parse(stored.payload_json):null,stale=false;
    if(!stored||now-Date.parse(stored.fetched_at)>MAX_AGE_MS){
      try{
        data=await downloadYear(year,fetcher);
        db.prepare(`INSERT INTO official_calendar_years(jalali_year,payload_json,fetched_at) VALUES(?,?,?)
          ON CONFLICT(jalali_year) DO UPDATE SET payload_json=excluded.payload_json,fetched_at=excluded.fetched_at`)
          .run(year,JSON.stringify(data),new Date(now).toISOString());
      }catch(e){if(!stored)throw e instanceof CalendarUnavailableError?e:new CalendarUnavailableError();stale=true;}
    }
    for(const [date,item] of Object.entries(data.days))days.set(date,item);
    status.push({year,source:'persian-calendar.com',fetched_at:stale?stored.fetched_at:new Date(now).toISOString(),stale,estimated:data.estimated});
  }
  return {days,status,stale:status.some(x=>x.stale),estimated:status.some(x=>x.estimated)};
}
