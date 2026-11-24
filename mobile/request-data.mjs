export const requestTypes={annual_leave:'مرخصی استحقاقی',sick_leave:'مرخصی استعلاجی',unpaid_leave:'مرخصی بدون حقوق',mission:'مأموریت'};
const latin=value=>String(value).replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const formatter=new Intl.DateTimeFormat('en-US-u-ca-persian',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Tehran'});
export function persianDate(value=new Date()){
  const p=Object.fromEntries(formatter.formatToParts(value).map(p=>[p.type,p.value]));
  return `${p.year}/${p.month}/${p.day}`;
}
export function requestDate(value){
  const match=/^(1[34]\d{2})[/-](\d{1,2})[/-](\d{1,2})$/.exec(latin(value).trim());
  if(!match)throw Error('تاریخ را به صورت شمسی، مانند ۱۴۰۵/۰۹/۰۳ وارد کنید.');
  const [,y,m,d]=match.map(Number);
  const target=`${y}/${String(m).padStart(2,'0')}/${String(d).padStart(2,'0')}`;
  // Search only one Persian year; Intl validates leap years without a second calendar engine.
  for(let i=0,start=Date.UTC(y+621,2,18);i<370;i++){
    const candidate=new Date(start+i*86400000);
    if(persianDate(candidate)===target)return candidate.toISOString().slice(0,10);
  }
  throw Error('تاریخ شمسی معتبر نیست.');
}
export function requestPayload(values){
  if(!Object.hasOwn(requestTypes,values.type)||!['daily','hourly'].includes(values.unit))throw Error('نوع درخواست را انتخاب کنید.');
  const from=requestDate(values.from),to=values.unit==='hourly'?from:requestDate(values.to);
  if(to<from||(Date.parse(to)-Date.parse(from))/86400000>30)throw Error('پایان باید پس از شروع و فاصله دو تاریخ حداکثر ۳۰ روز باشد.');
  const minutes=Number(latin(values.minutes).trim());
  if(!Number.isInteger(minutes)||minutes<1||minutes>1440)throw Error('مدت باید عددی بین ۱ و ۱۴۴۰ دقیقه باشد.');
  const description=String(values.description||'').trim();
  if(description.length>500)throw Error('توضیح باید حداکثر ۵۰۰ نویسه باشد.');
  const payload={type:values.type,unit:values.unit,work_date:from,end_date:to,minutes,description};
  if(values.substitute){
    const id=Number(values.substitute);
    if(values.type!=='annual_leave'||values.unit!=='daily'||!Number.isSafeInteger(id)||id<1)throw Error('جانشین انتخاب‌شده معتبر نیست.');
    payload.substitute_user_id=id;
  }
  return payload;
}
