import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { issueSession, resolveSession, verifyPassword, revokeSession, passwordHash } from './auth.js';
import { dailyWork, splitSessions, sumWork, tehranDate } from './work.js';

const root = resolve(fileURLToPath(new URL('../web/', import.meta.url)));
const logo = resolve(fileURLToPath(new URL('../branding/hozoryar-logo.png', import.meta.url)));
const db = openDatabase();
const json = (res,code,body) => { res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body)); };
const fail = (code,message) => Object.assign(new Error(message),{status:code});
const admin = user => { if (!['owner','manager'].includes(user.role)) throw fail(403,'دسترسی مدیریتی لازم است'); };
const owner = user => { if (user.role !== 'owner') throw fail(403,'فقط مدیر شرکت مجاز است'); };
const audit = (user,action,type,id) => db.prepare('INSERT INTO audit_logs(company_id,actor_user_id,action,target_type,target_id) VALUES(?,?,?,?,?)').run(user.company_id,user.id,action,type,id??null);
const settings = companyId => db.prepare('SELECT * FROM company_settings WHERE company_id=?').get(companyId);
const features = companyId => JSON.parse(settings(companyId).features_json);
const feature = (user,key) => { if (!features(user.company_id)[key]) throw fail(403,'این قابلیت برای شرکت فعال نیست'); };
const validCoords = (lat,lng,accuracy) => typeof lat==='number' && Number.isFinite(lat) && lat>=-90 && lat<=90 && typeof lng==='number' && Number.isFinite(lng) && lng>=-180 && lng<=180 && (accuracy===undefined || (Number.isFinite(accuracy) && accuracy>=0));
const distance = (a,b,c,d) => { const r=Math.PI/180; const x=(c-a)*r,y=(d-b)*r;return 6371000*2*Math.asin(Math.sqrt(Math.sin(x/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)**2)); };

async function body(req) {
  let data='';
  for await(const chunk of req) { data+=chunk; if (data.length>65536) throw fail(413,'درخواست بیش از حد بزرگ است'); }
  try { return JSON.parse(data || '{}'); } catch { throw fail(400,'JSON نامعتبر است'); }
}
const str = (v,max=120) => typeof v==='string' && v.trim().length>0 && v.trim().length<=max;
const ownUser = (user,id) => db.prepare('SELECT id,name,role,active FROM users WHERE id=? AND company_id=?').get(id,user.company_id);

async function api(req,res,url) {
  const method=req.method,path=url.pathname;
  if (path==='/api/health' && method==='GET') return json(res,200,{ok:true,service:'hozoryar'});
  if (path==='/api/login' && method==='POST') {
    const b=await body(req);
    if (![b.company,b.username,b.password].every(x=>str(x,200))) throw fail(400,'اطلاعات ورود کامل نیست');
    const user=db.prepare(`SELECT u.*,c.name company_name FROM users u JOIN companies c ON c.id=u.company_id
      WHERE c.slug=? AND c.active=1 AND u.username=? AND u.active=1`).get(b.company,b.username);
    if (!user || !verifyPassword(b.password,user.password_hash)) throw fail(401,'اطلاعات ورود صحیح نیست');
    const session=issueSession(db,user);
    return json(res,200,{...session,user:{id:user.id,name:user.name,role:user.role,company_id:user.company_id,company_name:user.company_name}});
  }
  const token=(req.headers.authorization||'').replace(/^Bearer /,'');
  const user=resolveSession(db,req.headers.authorization);
  if (!user) throw fail(401,'ابتدا وارد حساب شوید');
  if (path==='/api/logout' && method==='POST') {revokeSession(db,token);return json(res,200,{ok:true});}
  if (path==='/api/me' && method==='GET') return json(res,200,{user,features:features(user.company_id)});
  if (path==='/api/dashboard' && method==='GET') {
    admin(user);
    const cid=user.company_id;
    const total=db.prepare('SELECT COUNT(*) n FROM users WHERE company_id=? AND active=1').get(cid).n;
    const present=db.prepare(`SELECT COUNT(*) n FROM attendance a JOIN users u ON u.id=a.user_id AND u.company_id=a.company_id
       WHERE a.company_id=? AND a.checked_out_at IS NULL AND u.active=1`).get(cid).n;
    return json(res,200,{total,present,absent:total-present,company:user.company_name});
  }
  if (path==='/api/users' && method==='GET') {
    admin(user);return json(res,200,{items:db.prepare('SELECT id,name,username,role,active FROM users WHERE company_id=? ORDER BY id DESC').all(user.company_id)});
  }
  if (path==='/api/users' && method==='POST') {
    owner(user);const b=await body(req);
    if (!str(b.name)||!str(b.username,60)||!str(b.password,200)||b.password.length<12||!['manager','employee'].includes(b.role)) throw fail(400,'اطلاعات کارمند نامعتبر است');
    const result=db.prepare('INSERT INTO users(company_id,name,username,password_hash,role) VALUES(?,?,?,?,?)').run(user.company_id,b.name,b.username,passwordHash(b.password),b.role);
    audit(user,'user.create','user',Number(result.lastInsertRowid));return json(res,201,{id:Number(result.lastInsertRowid)});
  }
  if (path==='/api/shifts' && method==='GET') {feature(user,'shifts');return json(res,200,{items:db.prepare('SELECT id,name,start_time,end_time,duty_minutes FROM shifts WHERE company_id=?').all(user.company_id)});}
  if (path==='/api/shifts' && method==='POST') {
    admin(user);feature(user,'shifts');const b=await body(req);
    if(!str(b.name)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start_time)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.end_time)||!Number.isInteger(b.duty_minutes)||b.duty_minutes<0||b.duty_minutes>1440) throw fail(400,'اطلاعات شیفت نامعتبر است');
    const result=db.prepare('INSERT INTO shifts(company_id,name,start_time,end_time,duty_minutes) VALUES(?,?,?,?,?)').run(user.company_id,b.name,b.start_time,b.end_time,b.duty_minutes);
    audit(user,'shift.create','shift',Number(result.lastInsertRowid));return json(res,201,{id:Number(result.lastInsertRowid)});
  }
  if (path==='/api/assignments' && method==='POST') {
    admin(user);const b=await body(req);
    if(!Number.isInteger(b.user_id)||!Number.isInteger(b.shift_id)||!ownUser(user,b.user_id)||!db.prepare('SELECT id FROM shifts WHERE id=? AND company_id=?').get(b.shift_id,user.company_id)) throw fail(404,'کارمند یا شیفت در این شرکت وجود ندارد');
    db.prepare('INSERT INTO assignments(company_id,user_id,shift_id) VALUES(?,?,?) ON CONFLICT(company_id,user_id) DO UPDATE SET shift_id=excluded.shift_id').run(user.company_id,b.user_id,b.shift_id);
    audit(user,'shift.assign','user',b.user_id);return json(res,200,{ok:true});
  }
  if(path==='/api/requests' && method==='GET') {
    const mine=url.searchParams.get('scope')==='mine'||user.role==='employee';
    const items=mine?db.prepare(`SELECT r.id,r.user_id,u.name,r.type,r.work_date,r.minutes,r.description,r.status,r.created_at
      FROM personnel_requests r JOIN users u ON u.id=r.user_id AND u.company_id=r.company_id
      WHERE r.company_id=? AND r.user_id=? ORDER BY r.id DESC LIMIT 200`).all(user.company_id,user.id)
    :db.prepare(`SELECT r.id,r.user_id,u.name,r.type,r.work_date,r.minutes,r.description,r.status,r.created_at
      FROM personnel_requests r JOIN users u ON u.id=r.user_id AND u.company_id=r.company_id
      WHERE r.company_id=? ORDER BY r.id DESC LIMIT 200`).all(user.company_id);
    return json(res,200,{items});
  }
  if(path==='/api/requests' && method==='POST') {
    const b=await body(req);
    if(!['annual_leave','sick_leave','mission'].includes(b.type)||!/^\d{4}-\d{2}-\d{2}$/.test(b.work_date)||Number.isNaN(Date.parse(b.work_date))||!Number.isInteger(b.minutes)||b.minutes<1||b.minutes>1440||(b.description!==undefined&&typeof b.description!=='string')||(b.description||'').length>500) throw fail(400,'اطلاعات درخواست نامعتبر است');
    const result=db.prepare(`INSERT INTO personnel_requests(company_id,user_id,type,work_date,minutes,description)
      VALUES(?,?,?,?,?,?)`).run(user.company_id,user.id,b.type,b.work_date,b.minutes,b.description||'');
    const id=Number(result.lastInsertRowid);audit(user,'request.create','personnel_request',id);return json(res,201,{id,status:'pending'});
  }
  const decision=/^\/api\/requests\/(\d+)\/decision$/.exec(path);
  if(decision && method==='POST') {
    admin(user);const id=Number(decision[1]),b=await body(req);
    if(!['approved','rejected'].includes(b.status)) throw fail(400,'وضعیت نامعتبر است');
    const target=db.prepare('SELECT id,user_id,status FROM personnel_requests WHERE id=? AND company_id=?').get(id,user.company_id);
    if(!target)throw fail(404,'درخواست شرکت یافت نشد');
    if(target.user_id===user.id)throw fail(403,'تأیید درخواست خود مجاز نیست');
    if(target.status!=='pending')throw fail(409,'این درخواست قبلاً بررسی شده است');
    db.prepare(`UPDATE personnel_requests SET status=?,decided_by=?,decided_at=? WHERE id=? AND company_id=? AND status='pending'`)
      .run(b.status,user.id,new Date().toISOString(),id,user.company_id);
    audit(user,'request.'+b.status,'personnel_request',id);return json(res,200,{ok:true});
  }
  if(path==='/api/holidays' && method==='GET') {
    return json(res,200,{items:db.prepare('SELECT work_date,title FROM company_holidays WHERE company_id=? ORDER BY work_date').all(user.company_id)});
  }
  if(path==='/api/holidays' && method==='POST') {
    owner(user);const b=await body(req);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(b.work_date||'')||Number.isNaN(Date.parse(b.work_date))||!str(b.title,120)) throw fail(400,'تاریخ یا عنوان تعطیلی نامعتبر است');
    db.prepare('INSERT INTO company_holidays(company_id,work_date,title) VALUES(?,?,?) ON CONFLICT(company_id,work_date) DO UPDATE SET title=excluded.title').run(user.company_id,b.work_date,b.title);
    audit(user,'holiday.save','company',user.company_id);return json(res,200,{ok:true});
  }
  if(path==='/api/work-report' && method==='GET') {
    const from=url.searchParams.get('from'),to=url.searchParams.get('to');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||'')||from>to||Date.parse(to)-Date.parse(from)>35*86400000) throw fail(400,'بازه گزارش باید حداکثر ۳۵ روز باشد');
    const targetId=url.searchParams.has('user_id')?Number(url.searchParams.get('user_id')):user.id;
    if(targetId!==user.id)admin(user);
    if(!ownUser(user,targetId))throw fail(404,'کارمند یافت نشد');
    const rows=db.prepare(`SELECT checked_in_at,checked_out_at FROM attendance WHERE company_id=? AND user_id=?
      AND checked_in_at<=? AND (checked_out_at IS NULL OR checked_out_at>=?) ORDER BY checked_in_at`)
      .all(user.company_id,targetId,new Date(Date.parse(to)+2*86400000).toISOString(),new Date(Date.parse(from)-2*86400000).toISOString());
    const sessions=splitSessions(rows,from,to);
    const assignment=db.prepare(`SELECT s.duty_minutes FROM assignments a JOIN shifts s ON s.id=a.shift_id AND s.company_id=a.company_id
       WHERE a.company_id=? AND a.user_id=?`).get(user.company_id,targetId);
    const requests=db.prepare(`SELECT type,work_date,minutes FROM personnel_requests
       WHERE company_id=? AND user_id=? AND status='approved' AND work_date BETWEEN ? AND ?`).all(user.company_id,targetId,from,to);
    const holidays=new Set(db.prepare('SELECT work_date FROM company_holidays WHERE company_id=? AND work_date BETWEEN ? AND ?').all(user.company_id,from,to).map(x=>x.work_date));
    const days=[],cursor=new Date(from+'T12:00:00Z'),limit=new Date(to+'T12:00:00Z');
    while(cursor<=limit){const day=cursor.toISOString().slice(0,10);days.push(dailyWork({day,worked:sessions.get(day)||0,duty:assignment?.duty_minutes||0,approved:requests.filter(r=>r.work_date===day),holiday:holidays.has(day)}));cursor.setUTCDate(cursor.getUTCDate()+1);}
    return json(res,200,{user_id:targetId,from,to,days,totals:sumWork(days),note:'محاسبات نسخه پایه: موظفی شیفت روزانه، تعطیلات دستی و جمعه؛ بدون تقویم رسمی، سقف اضافه‌کاری و قواعد پیشرفته خطیار.'});
  }
  if (path==='/api/settings' && method==='GET') {
    owner(user);const s=settings(user.company_id);
    return json(res,200,{map_provider:s.map_provider,sms_provider:s.sms_provider,require_location:!!s.require_location,geofence_lat:s.geofence_lat,geofence_lng:s.geofence_lng,geofence_radius_m:s.geofence_radius_m,features:JSON.parse(s.features_json),neshan_key_configured:!!s.neshan_api_key,sms_key_configured:!!s.sms_api_key});
  }
  if (path==='/api/settings' && method==='PATCH') {
    owner(user);const b=await body(req);const s=settings(user.company_id);
    if(b.map_provider!==undefined && !['osm','neshan'].includes(b.map_provider)) throw fail(400,'ارائه‌دهنده نقشه نامعتبر است');
    if(b.sms_provider!==undefined && !['disabled','kavenegar'].includes(b.sms_provider)) throw fail(400,'سرویس پیامک نامعتبر است');
    if(b.neshan_api_key!==undefined && (typeof b.neshan_api_key!=='string'||b.neshan_api_key.length>200)) throw fail(400,'کلید نشان نامعتبر است');
    if(b.sms_api_key!==undefined && (typeof b.sms_api_key!=='string'||b.sms_api_key.length>200)) throw fail(400,'کلید پیامک نامعتبر است');
    if(b.geofence_lat!==undefined && b.geofence_lat!==null && (!Number.isFinite(b.geofence_lat)||Math.abs(b.geofence_lat)>90)) throw fail(400,'عرض جغرافیایی نامعتبر است');
    if(b.geofence_lng!==undefined && b.geofence_lng!==null && (!Number.isFinite(b.geofence_lng)||Math.abs(b.geofence_lng)>180)) throw fail(400,'طول جغرافیایی نامعتبر است');
    if(b.geofence_radius_m!==undefined && (!Number.isInteger(b.geofence_radius_m)||b.geofence_radius_m<50||b.geofence_radius_m>50000)) throw fail(400,'شعاع نامعتبر است');
    const f=b.features===undefined?JSON.parse(s.features_json):b.features;
    if(!f||typeof f!=='object'||Array.isArray(f)||Object.keys(f).some(k=>!['liveMap','attendance','monitoring','shifts','sms'].includes(k))||Object.values(f).some(v=>typeof v!=='boolean')) throw fail(400,'تنظیمات قابلیت‌ها نامعتبر است');
    db.prepare(`UPDATE company_settings SET map_provider=?,neshan_api_key=?,sms_provider=?,sms_api_key=?,require_location=?,geofence_lat=?,geofence_lng=?,geofence_radius_m=?,features_json=? WHERE company_id=?`)
      .run(b.map_provider??s.map_provider,b.neshan_api_key===undefined?s.neshan_api_key:b.neshan_api_key,b.sms_provider??s.sms_provider,b.sms_api_key===undefined?s.sms_api_key:b.sms_api_key,b.require_location===undefined?s.require_location:Number(!!b.require_location),b.geofence_lat===undefined?s.geofence_lat:b.geofence_lat,b.geofence_lng===undefined?s.geofence_lng:b.geofence_lng,b.geofence_radius_m??s.geofence_radius_m,JSON.stringify(f),user.company_id);
    audit(user,'settings.update','company',user.company_id);return json(res,200,{ok:true});
  }
  if (path==='/api/attendance' && method==='POST') {
    feature(user,'attendance');const b=await body(req),s=settings(user.company_id);
    if(!['in','out'].includes(b.action)) throw fail(400,'عملیات نامعتبر است');
    if(b.action==='in' && s.require_location && !validCoords(b.lat,b.lng,b.accuracy)) throw fail(400,'موقعیت مکانی معتبر لازم است');
    if(b.action==='in' && s.geofence_lat!==null && s.geofence_lng!==null && (!validCoords(b.lat,b.lng,b.accuracy)||distance(b.lat,b.lng,s.geofence_lat,s.geofence_lng)>s.geofence_radius_m)) throw fail(403,'خارج از محدوده مجاز هستید');
    const now=new Date().toISOString();let id;
    if(b.action==='in') {
      if(db.prepare('SELECT id FROM attendance WHERE company_id=? AND user_id=? AND checked_out_at IS NULL').get(user.company_id,user.id)) throw fail(409,'حضور فعال دارید');
      id=Number(db.prepare('INSERT INTO attendance(company_id,user_id,checked_in_at,lat,lng,accuracy) VALUES(?,?,?,?,?,?)').run(user.company_id,user.id,now,b.lat??null,b.lng??null,b.accuracy??null).lastInsertRowid);
    } else {
      const active=db.prepare('SELECT id FROM attendance WHERE company_id=? AND user_id=? AND checked_out_at IS NULL').get(user.company_id,user.id);
      if(!active) throw fail(409,'حضور فعالی برای خروج ندارید');
      id=active.id;db.prepare('UPDATE attendance SET checked_out_at=? WHERE id=? AND company_id=?').run(now,id,user.company_id);
    }
    audit(user,'attendance.'+b.action,'attendance',id);return json(res,201,{id,at:now});
  }
  if (path==='/api/attendance' && method==='GET') {
    feature(user,'attendance');let id=user.id;
    if(url.searchParams.has('user_id')) {admin(user);id=Number(url.searchParams.get('user_id'));if(!ownUser(user,id)) throw fail(404,'کارمند یافت نشد');}
    return json(res,200,{items:db.prepare('SELECT id,checked_in_at,checked_out_at,lat,lng FROM attendance WHERE company_id=? AND user_id=? ORDER BY id DESC LIMIT 100').all(user.company_id,id)});
  }
  if (path==='/api/location' && method==='POST') {
    feature(user,'monitoring');const b=await body(req);
    if(!validCoords(b.lat,b.lng,b.accuracy)) throw fail(400,'مختصات نامعتبر است');
    if(!db.prepare('SELECT id FROM attendance WHERE company_id=? AND user_id=? AND checked_out_at IS NULL').get(user.company_id,user.id)) throw fail(403,'ثبت موقعیت فقط در حضور فعال مجاز است');
    db.prepare(`INSERT INTO locations(company_id,user_id,lat,lng,accuracy,recorded_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(company_id,user_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,accuracy=excluded.accuracy,recorded_at=excluded.recorded_at`)
      .run(user.company_id,user.id,b.lat,b.lng,b.accuracy??null,new Date().toISOString());return json(res,200,{ok:true});
  }
  if (path==='/api/live-map' && method==='GET') {
    admin(user);feature(user,'liveMap');
    return json(res,200,{provider:settings(user.company_id).map_provider,items:db.prepare(`SELECT u.id,u.name,l.lat,l.lng,l.accuracy,l.recorded_at FROM locations l
      JOIN users u ON u.id=l.user_id AND u.company_id=l.company_id
      JOIN attendance a ON a.user_id=l.user_id AND a.company_id=l.company_id AND a.checked_out_at IS NULL
      WHERE l.company_id=? AND u.active=1 AND julianday(l.recorded_at) >= julianday('now','-60 minutes') ORDER BY u.name`).all(user.company_id)});
  }
  if (path==='/api/neshan-tiles/config' && method==='GET') {
    admin(user);feature(user,'liveMap');const s=settings(user.company_id);
    return json(res,200,{enabled:s.map_provider==='neshan'&&!!s.neshan_api_key,tiles:'/api/neshan-tiles/{z}/{x}/{y}'});
  }
  const tile=/^\/api\/neshan-tiles\/(\d{1,2})\/(\d{1,9})\/(\d{1,9})$/.exec(path);
  if(tile && method==='GET') {
    admin(user);feature(user,'liveMap');const s=settings(user.company_id);
    const [z,x,y]=tile.slice(1).map(Number);
    if(s.map_provider!=='neshan'||!s.neshan_api_key||z>19||x>=2**z||y>=2**z) throw fail(404,'نقشه نشان فعال نیست');
    // Server-side key never reaches browsers; upstream URL uses Neshan raster tile API.
    const response=await fetch(`https://api.neshan.org/v1/tiles/${z}/${x}/${y}`,{headers:{'Api-Key':s.neshan_api_key},signal:AbortSignal.timeout(7000)});
    if(!response.ok) throw fail(502,'دریافت نقشه نشان ناموفق بود');
    const binary=Buffer.from(await response.arrayBuffer());if(binary.length>300000) throw fail(502,'پاسخ نقشه بیش از حد بزرگ است');
    res.writeHead(200,{'content-type':response.headers.get('content-type')?.startsWith('image/')?response.headers.get('content-type'):'image/png','cache-control':'private,max-age=300'});return res.end(binary);
  }
  if(path==='/api/sms/send' && method==='POST') {
    owner(user);feature(user,'sms');const s=settings(user.company_id),b=await body(req);
    if(s.sms_provider!=='kavenegar'||!s.sms_api_key) throw fail(409,'سامانه پیامک شرکت تنظیم نشده است');
    if(!/^09\d{9}$/.test(b.mobile||'')||!str(b.message,300)) throw fail(400,'شماره یا متن پیامک نامعتبر است');
    const form=new URLSearchParams({receptor:b.mobile,message:b.message});
    const response=await fetch(`https://api.kavenegar.com/v1/${encodeURIComponent(s.sms_api_key)}/sms/send.json`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(10000)});
    if(!response.ok) throw fail(502,'سرویس پیامک پاسخ موفق نداد');
    const reply=await response.json();if(reply.return?.status!==200) throw fail(502,'ارسال پیامک تأیید نشد');
    audit(user,'sms.send','company',user.company_id);return json(res,200,{ok:true});
  }
  throw fail(404,'مسیر یافت نشد');
}

async function staticFile(req,res,url) {
  if(req.method!=='GET') throw fail(405,'روش نامعتبر است');
  const path=url.pathname==='/brand-logo.png'?logo:resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(path!==logo && path!==root && !path.startsWith(root+sep)) throw fail(403,'مسیر نامعتبر است');
  const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.json':'application/json; charset=utf-8'};
  try {const bytes=await readFile(path);res.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; style-src 'self' https://unpkg.com; script-src 'self' https://unpkg.com; img-src 'self' data: https://*.tile.openstreetmap.org https://*.openstreetmap.org; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(bytes);}
  catch {throw fail(404,'فایل یافت نشد');}
}

export function createServer() {return http.createServer(async(req,res)=>{
  try {const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/')) await api(req,res,url);else await staticFile(req,res,url);}
  catch(err){if(!res.headersSent)json(res,err.status||500,{error:err.status?err.message:'خطای داخلی سرور'});else res.destroy();}
});}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  createServer().listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('Hozoryar listening on 127.0.0.1:'+ (process.env.PORT||3000)));
}
