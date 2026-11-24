export function apiBase(value,development=false){
  const base=String(value||'').replace(/\/$/,'');let url;
  try{url=new URL(base);}catch{throw new Error('آدرس سرور حضوریار معتبر نیست');}
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.hostname.endsWith('.example'))
    throw new Error('آدرس ریشه سرور حضوریار را بدون اطلاعات ورود وارد کنید');
  const local=['localhost','127.0.0.1','10.0.2.2'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(development&&local&&url.protocol==='http:'))
    throw new Error('نسخه انتشار به آدرس HTTPS واقعی حضوریار نیاز دارد');
  return base;
}
