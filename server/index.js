import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { issueSession, resolveSession, verifyPassword, revokeSession, passwordHash, issuePlatformSession, resolvePlatformSession, revokePlatformSession } from './auth.js';
import { attendanceMetrics, dailyWork, dutyForDay, localInstant, sessionsByEntryDate, sumWork, tehranDate, allowedShiftTraffic } from './work.js';
import { calendarDays, jalaliMonthBounds } from './calendar.js';
import { loadOfficialCalendar } from './official-calendar.js';
import { archivedWorkXlsx } from './xlsx.js';
import { annualLeaveByYear } from './leave-balance.js';
import { payrollPreview, snapshotDigest } from './payroll.js';
import { reportedOfflineMinutes } from './monitoring.js';

const root = resolve(fileURLToPath(new URL('../web/', import.meta.url)));
const logo = resolve(fileURLToPath(new URL('../branding/hozoryar-logo.png', import.meta.url)));
const db = openDatabase();
const loginAttempts=new Map();
const LOGIN_WINDOW=15*60*1000,LOGIN_LIMIT=12;
function checkLoginRate(req){
  const key=req.socket.remoteAddress||'unknown',now=Date.now();
  if(loginAttempts.size>5000)for(const [ip,entry] of loginAttempts)if(now-entry.started>LOGIN_WINDOW)loginAttempts.delete(ip);
  const entry=loginAttempts.get(key);
  if(!entry||now-entry.started>LOGIN_WINDOW){loginAttempts.set(key,{started:now,count:1});return key;}
  if(entry.count>=LOGIN_LIMIT)throw fail(429,'تلاش ورود بیش از حد؛ بعداً دوباره تلاش کنید');
  entry.count++;return key;
}
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
function substituteAvailable(companyId,userId,from,to,exceptId=0){
  const reserved=db.prepare(`SELECT 1 FROM personnel_requests WHERE company_id=? AND substitute_user_id=?
    AND id<>? AND type='annual_leave' AND unit='daily' AND status IN ('pending','approved')
    AND work_date<=? AND COALESCE(end_date,work_date)>=? LIMIT 1`).get(companyId,userId,exceptId,to,from);
  const leave=db.prepare(`SELECT 1 FROM personnel_requests WHERE company_id=? AND user_id=?
    AND id<>? AND status IN ('pending','approved') AND type IN ('annual_leave','sick_leave','unpaid_leave')
    AND work_date<=? AND COALESCE(end_date,work_date)>=? LIMIT 1`).get(companyId,userId,exceptId,to,from);
  return !reserved&&!leave;
}
const validDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s||'') && !Number.isNaN(Date.parse(s)) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function annualLeaveBalance(companyId,userId,year,excludingId=0){
  const requests=db.prepare(`SELECT type,work_date,end_date,minutes FROM personnel_requests
    WHERE company_id=? AND user_id=? AND type='annual_leave' AND status='approved' AND id<>?`).all(companyId,userId,excludingId);
  const used=annualLeaveByYear(requests).get(year)||0,quota=settings(companyId).annual_leave_minutes;
  return {year,quota_minutes:quota,used_minutes:used,remaining_minutes:quota-used};
}
function buildWorkReport(companyId,targetId,from,to,official) {
  const rows=db.prepare(`SELECT id,checked_in_at,checked_out_at FROM attendance WHERE company_id=? AND user_id=?
    AND checked_in_at<=? AND (checked_out_at IS NULL OR checked_out_at>=?) ORDER BY checked_in_at`)
    .all(companyId,targetId,new Date(Date.parse(to)+2*86400000).toISOString(),new Date(Date.parse(from)-2*86400000).toISOString());
  const sessions=sessionsByEntryDate(rows,from,to);
  const deviceEvents=db.prepare(`SELECT e.attendance_id,e.kind,e.recorded_at FROM monitoring_events e
    JOIN attendance a ON a.id=e.attendance_id AND a.company_id=e.company_id AND a.user_id=e.user_id
    WHERE e.company_id=? AND e.user_id=? AND a.checked_in_at<=? AND (a.checked_out_at IS NULL OR a.checked_out_at>=?)
    ORDER BY e.recorded_at`).all(companyId,targetId,new Date(Date.parse(to)+2*86400000).toISOString(),new Date(Date.parse(from)-2*86400000).toISOString());
  const evidenceByDay=new Map();
  for(const row of rows){const day=tehranDate(new Date(row.checked_in_at));if(day<from||day>to)continue;
    const amounts=reportedOfflineMinutes(row,deviceEvents.filter(e=>e.attendance_id===row.id));
    const previous=evidenceByDay.get(day)||{gps_off_minutes:0,internet_off_minutes:0};
    for(const key of Object.keys(previous))previous[key]+=amounts[key];evidenceByDay.set(day,previous);}
  const assignment=db.prepare(`SELECT s.duty_minutes,s.daily_ot_cap,s.start_time,s.end_time,s.schedule_kind,s.schedule_json FROM assignments a JOIN shifts s ON s.id=a.shift_id AND s.company_id=a.company_id
    WHERE a.company_id=? AND a.user_id=?`).get(companyId,targetId);
  const substitutedShifts=db.prepare(`SELECT sa.from_date,sa.to_date,s.duty_minutes,s.daily_ot_cap,s.start_time,s.end_time,s.schedule_kind,s.schedule_json
    FROM substitute_assignments sa JOIN assignments a ON a.company_id=sa.company_id AND a.user_id=sa.absent_user_id
    JOIN shifts s ON s.id=a.shift_id AND s.company_id=a.company_id
    WHERE sa.company_id=? AND sa.substitute_user_id=? AND sa.from_date<=? AND sa.to_date>=?
    ORDER BY sa.id DESC`).all(companyId,targetId,to,from);
  const requests=db.prepare(`SELECT type,work_date,COALESCE(end_date,work_date) end_date,minutes FROM personnel_requests
    WHERE company_id=? AND user_id=? AND status='approved' AND work_date<=? AND COALESCE(end_date,work_date)>=?`).all(companyId,targetId,to,from);
  const manual=new Map(db.prepare('SELECT work_date,title FROM company_holidays WHERE company_id=? AND work_date BETWEEN ? AND ?').all(companyId,from,to).map(x=>[x.work_date,x.title]));
  const calendar=calendarDays(from,to,manual,official.days),byDate=new Map(calendar.map(x=>[x.date,x]));
  const days=[],cursor=new Date(from+'T12:00:00Z'),limit=new Date(to+'T12:00:00Z');
  while(cursor<=limit){const day=cursor.toISOString().slice(0,10),parts=sessions.get(day)||[];
    const effectiveShift=substitutedShifts.find(x=>x.from_date<=day&&x.to_date>=day)||assignment;
    const policy=effectiveShift?JSON.parse(effectiveShift.schedule_json||'{}'):{};
    const metrics=attendanceMetrics(effectiveShift,day,parts,policy);
    const classification=byDate.get(day);
    days.push({...dailyWork({day,...metrics,duty:dutyForDay(effectiveShift,day),overtimeCap:effectiveShift?.daily_ot_cap??27,hasShift:!!effectiveShift,approved:requests.filter(r=>r.work_date<=day&&r.end_date>=day),holiday:classification.is_official_holiday||classification.is_manual_holiday}),
      ...(evidenceByDay.get(day)||{gps_off_minutes:0,internet_off_minutes:0}),
      jalali:classification.jalali,is_official_holiday:classification.is_official_holiday,is_manual_holiday:classification.is_manual_holiday,
      holiday_title:classification.title,holiday_source:classification.source});cursor.setUTCDate(cursor.getUTCDate()+1);}
  return {user_id:targetId,from,to,days,totals:sumWork(days),authoritative:false,engine:'hozoryar-work-v5',reference:'Khatyar ShiftCalc rules; independent online calendar',
    official_calendar_available:true,official_calendar_status:official.status,official_calendar_stale:official.stale,official_calendar_estimated:official.estimated,
    note:official.stale?'تقویم برخط در دسترس نیست و آخرین نسخه ذخیره‌شده استفاده شده؛ گزارش مالی قطعی نیست.':official.estimated?'تقویم برخط دارای برخی مناسبت‌های برآوردی است؛ گزارش هنوز برای حقوق قطعی معتبر نیست.':'تعطیلات برخط از سرویس مستقل تقویم ایران دریافت شده‌اند. گزارش هنوز برای حقوق قطعی معتبر نیست.'};
}
function monthBounds(key) {
  const jalali=/^j-(1[34]\d{2}-(?:0[1-9]|1[0-2]))$/.exec(key||'');
  let from,to;
  if(jalali){const bounds=jalaliMonthBounds(jalali[1]);if(!bounds)throw fail(400,'ماه شمسی نامعتبر است');({from,to}=bounds);}
  else{
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key||''))throw fail(400,'ماه نامعتبر است');
    const [year,number]=key.split('-').map(Number);
    from=key+'-01';to=new Date(Date.UTC(year,number,0)).toISOString().slice(0,10);
  }
  if(to>=tehranDate(new Date()))throw fail(409,'بایگانی تنها برای ماه میلادی سپری‌شده مجاز است');
  return {from,to};
}

async function api(req,res,url) {
  const method=req.method,path=url.pathname;
  if (path==='/api/health' && method==='GET') return json(res,200,{ok:true,service:'hozoryar'});
  if(path==='/api/platform/login' && method==='POST') {
    const key=checkLoginRate(req),b=await body(req);
    if(!str(b.username,60)||!str(b.password,200))throw fail(400,'اطلاعات ورود کامل نیست');
    const administrator=db.prepare('SELECT * FROM platform_admins WHERE username=? AND active=1').get(b.username);
    if(!administrator||!verifyPassword(b.password,administrator.password_hash))throw fail(401,'اطلاعات ورود صحیح نیست');
    loginAttempts.delete(key);
    return json(res,200,{...issuePlatformSession(db,administrator),user:{id:administrator.id,name:administrator.name,role:'platform_admin'}});
  }
  if(path.startsWith('/api/platform/')) {
    const platform=resolvePlatformSession(db,req.headers.authorization);
    if(!platform)throw fail(401,'ورود مدیر کل سامانه لازم است');
    if(path==='/api/platform/me'&&method==='GET')return json(res,200,{user:{...platform,role:'platform_admin'}});
    if(path==='/api/platform/logout'&&method==='POST'){
      revokePlatformSession(db,(req.headers.authorization||'').replace(/^Bearer /,''));return json(res,200,{ok:true});
    }
    if(path==='/api/platform/companies'&&method==='GET'){
      const items=db.prepare(`SELECT c.id,c.name,c.slug,c.active,c.subscription_end,c.max_personnel,
        (SELECT COUNT(*) FROM users u WHERE u.company_id=c.id AND u.active=1) personnel_count
        FROM companies c ORDER BY c.id`).all();
      return json(res,200,{items});
    }
    const match=/^\/api\/platform\/companies\/(\d+)\/subscription$/.exec(path);
    if(match&&method==='PATCH'){
      const companyId=Number(match[1]),b=await body(req);
      if(!Object.keys(b).length||Object.keys(b).some(k=>!['subscription_end','max_personnel'].includes(k)))throw fail(400,'تنظیمات نامعتبر است');
      if(b.subscription_end!==undefined&&b.subscription_end!==null&&!validDay(b.subscription_end))throw fail(400,'تاریخ پایان اشتراک نامعتبر است');
      if(b.max_personnel!==undefined&&b.max_personnel!==null&&(!Number.isInteger(b.max_personnel)||b.max_personnel<1||b.max_personnel>1000000))throw fail(400,'سقف پرسنل نامعتبر است');
      db.exec('BEGIN IMMEDIATE');
      try{
        const company=db.prepare('SELECT * FROM companies WHERE id=?').get(companyId);
        if(!company)throw fail(404,'شرکت یافت نشد');
        const count=db.prepare('SELECT COUNT(*) n FROM users WHERE company_id=? AND active=1').get(companyId).n;
        const cap=b.max_personnel===undefined?company.max_personnel:b.max_personnel;
        if(cap!==null&&cap<count)throw fail(409,`سقف از تعداد ${count} کاربر فعال کمتر است`);
        db.prepare('UPDATE companies SET subscription_end=?,max_personnel=? WHERE id=?')
          .run(b.subscription_end===undefined?company.subscription_end:b.subscription_end,cap,companyId);
        db.exec('COMMIT');return json(res,200,{ok:true,personnel_count:count});
      }catch(e){db.exec('ROLLBACK');throw e;}
    }
    throw fail(404,'مسیر مدیریت مرکزی یافت نشد');
  }
  if (path==='/api/login' && method==='POST') {
    const loginIp=checkLoginRate(req);
    const b=await body(req);
    if (![b.company,b.username,b.password].every(x=>str(x,200))) throw fail(400,'اطلاعات ورود کامل نیست');
    const user=db.prepare(`SELECT u.*,c.name company_name FROM users u JOIN companies c ON c.id=u.company_id
      WHERE c.slug=? AND c.active=1 AND u.username=? AND u.active=1`).get(b.company,b.username);
    if (!user || !verifyPassword(b.password,user.password_hash)) throw fail(401,'اطلاعات ورود صحیح نیست');
    loginAttempts.delete(loginIp);
    const session=issueSession(db,user);
    return json(res,200,{...session,user:{id:user.id,name:user.name,role:user.role,company_id:user.company_id,company_name:user.company_name}});
  }
  const token=(req.headers.authorization||'').replace(/^Bearer /,'');
  const user=resolveSession(db,req.headers.authorization);
  if (!user) throw fail(401,'ابتدا وارد حساب شوید');
  if (path==='/api/logout' && method==='POST') {revokeSession(db,token);return json(res,200,{ok:true});}
  const company=db.prepare('SELECT subscription_end,max_personnel FROM companies WHERE id=?').get(user.company_id);
  const expired=company.subscription_end!==null&&company.subscription_end<tehranDate(new Date());
  if (path==='/api/me' && method==='GET') return json(res,200,{user,features:features(user.company_id),subscription:{...company,expired}});
  if(method!=='GET'&&expired)throw fail(402,'اشتراک شرکت پایان یافته است؛ اطلاعات قابل مشاهده هستند اما عملیات جدید غیرفعال شده است');
  if (path==='/api/dashboard' && method==='GET') {
    admin(user);
    const cid=user.company_id;
    const total=db.prepare('SELECT COUNT(*) n FROM users WHERE company_id=? AND active=1').get(cid).n;
    const present=db.prepare(`SELECT COUNT(*) n FROM attendance a JOIN users u ON u.id=a.user_id AND u.company_id=a.company_id
       WHERE a.company_id=? AND a.checked_out_at IS NULL AND u.active=1`).get(cid).n;
    const end=url.searchParams.get('to')||tehranDate(new Date());
    const start=url.searchParams.get('from')||new Date(Date.parse(end)-6*86400000).toISOString().slice(0,10);
    if(!validDay(start)||!validDay(end)||start>end||Date.parse(end)-Date.parse(start)>35*86400000)throw fail(400,'بازه آمار باید حداکثر ۳۵ روز باشد');
    const arrivals=db.prepare(`SELECT date(a.checked_in_at,'+210 minutes') day,COUNT(*) sessions,COUNT(DISTINCT a.user_id) employees
      FROM attendance a JOIN users u ON u.id=a.user_id AND u.company_id=a.company_id
      WHERE a.company_id=? AND u.active=1 AND date(a.checked_in_at,'+210 minutes') BETWEEN ? AND ? GROUP BY day ORDER BY day`)
      .all(cid,start,end);
    return json(res,200,{total,present,absent:total-present,company:user.company_name,period:{from:start,to:end},arrivals});
  }
  if (path==='/api/users' && method==='GET') {
    admin(user);return json(res,200,{items:db.prepare('SELECT id,name,username,role,active,zone_id,can_be_substitute FROM users WHERE company_id=? ORDER BY id DESC').all(user.company_id)});
  }
  if (path==='/api/users' && method==='POST') {
    owner(user);const b=await body(req);
    if (!str(b.name)||!str(b.username,60)||!str(b.password,200)||b.password.length<12||!['manager','employee'].includes(b.role)) throw fail(400,'اطلاعات کارمند نامعتبر است');
    db.exec('BEGIN IMMEDIATE');let result;
    try{
      const cap=db.prepare('SELECT max_personnel FROM companies WHERE id=?').get(user.company_id).max_personnel;
      const count=db.prepare('SELECT COUNT(*) n FROM users WHERE company_id=? AND active=1').get(user.company_id).n;
      if(cap!==null&&count>=cap)throw fail(409,'ظرفیت پرسنل شرکت تکمیل شده است؛ با مدیر سامانه تماس بگیرید');
      result=db.prepare('INSERT INTO users(company_id,name,username,password_hash,role) VALUES(?,?,?,?,?)').run(user.company_id,b.name,b.username,passwordHash(b.password),b.role);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    audit(user,'user.create','user',Number(result.lastInsertRowid));return json(res,201,{id:Number(result.lastInsertRowid)});
  }
  if(path==='/api/zones'&&method==='GET'){
    admin(user);return json(res,200,{items:db.prepare('SELECT id,name,requires_substitute FROM zones WHERE company_id=? ORDER BY name').all(user.company_id)});
  }
  if(path==='/api/zones'&&method==='POST'){
    owner(user);const b=await body(req);
    if(!str(b.name,100)||typeof b.requires_substitute!=='boolean')throw fail(400,'اطلاعات منطقه نامعتبر است');
    if(db.prepare('SELECT 1 FROM zones WHERE company_id=? AND name=?').get(user.company_id,b.name.trim()))throw fail(409,'منطقه تکراری است');
    const result=db.prepare('INSERT INTO zones(company_id,name,requires_substitute) VALUES(?,?,?)').run(user.company_id,b.name.trim(),Number(b.requires_substitute));
    audit(user,'zone.create','zone',Number(result.lastInsertRowid));return json(res,201,{id:Number(result.lastInsertRowid)});
  }
  const zoneUpdate=/^\/api\/zones\/(\d+)$/.exec(path);
  if(zoneUpdate&&method==='PATCH'){
    owner(user);const b=await body(req),id=Number(zoneUpdate[1]);
    if(typeof b.requires_substitute!=='boolean')throw fail(400,'سیاست جانشین نامعتبر است');
    const result=db.prepare('UPDATE zones SET requires_substitute=? WHERE id=? AND company_id=?').run(Number(b.requires_substitute),id,user.company_id);
    if(!result.changes)throw fail(404,'منطقه یافت نشد');
    audit(user,'zone.policy','zone',id);return json(res,200,{ok:true});
  }
  const userZone=/^\/api\/users\/(\d+)\/zone$/.exec(path);
  if(userZone&&method==='PATCH'){
    owner(user);const b=await body(req),id=Number(userZone[1]);
    if(!ownUser(user,id))throw fail(404,'کارمند یافت نشد');
    if(b.zone_id!==null&&(!Number.isInteger(b.zone_id)||!db.prepare('SELECT 1 FROM zones WHERE id=? AND company_id=?').get(b.zone_id,user.company_id)))throw fail(404,'منطقه متعلق به شرکت نیست');
    if(typeof b.can_be_substitute!=='boolean')throw fail(400,'مجوز جانشینی نامعتبر است');
    db.prepare('UPDATE users SET zone_id=?,can_be_substitute=? WHERE id=? AND company_id=?').run(b.zone_id,Number(b.can_be_substitute),id,user.company_id);
    audit(user,'user.zone','user',id);return json(res,200,{ok:true});
  }
  if (path==='/api/shifts' && method==='GET') {feature(user,'shifts');return json(res,200,{items:db.prepare('SELECT id,name,start_time,end_time,duty_minutes,daily_ot_cap,schedule_kind,schedule_json FROM shifts WHERE company_id=?').all(user.company_id)});}
  if (path==='/api/shifts' && method==='POST') {
    admin(user);feature(user,'shifts');const b=await body(req);
    if(!str(b.name)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start_time)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.end_time)||!Number.isInteger(b.duty_minutes)||b.duty_minutes<0||b.duty_minutes>1440) throw fail(400,'اطلاعات شیفت نامعتبر است');
    const cap=b.daily_ot_cap??27;if(!Number.isInteger(cap)||cap<0||cap>1440)throw fail(400,'سقف اضافه‌کاری روزانه نامعتبر است');
    const kind=b.schedule_kind||'fixed',config=b.schedule||{};
    if(!['fixed','weekly','rotating','rotation_segments','floating','advanced','auto'].includes(kind))throw fail(400,'نوع شیفت نامعتبر است');
    if(kind==='auto'&&config.auto_expected_min!==undefined&&(!Number.isInteger(config.auto_expected_min)||config.auto_expected_min<0||config.auto_expected_min>1440))throw fail(400,'موظفی شیفت خودکار نامعتبر است');
    if(kind==='weekly'&&(!Array.isArray(config.days)||config.days.some(x=>!Number.isInteger(x)||x<0||x>6)||new Set(config.days).size!==config.days.length))throw fail(400,'روزهای شیفت هفتگی نامعتبر است');
    if(kind==='rotating'&&(!Number.isInteger(config.work)||config.work<1||config.work>30||!Number.isInteger(config.rest)||config.rest<1||config.rest>30||!/^\d{4}-\d{2}-\d{2}$/.test(config.anchor||'')||Number.isNaN(Date.parse(config.anchor))))throw fail(400,'چرخه شیفت نامعتبر است');
    if(kind==='rotation_segments'&&(!validDay(config.anchor)||!Array.isArray(config.cycle)||config.cycle.length<1||config.cycle.length>12||config.cycle.some(phase=>!phase||!Number.isInteger(phase.days)||phase.days<1||phase.days>60||!Array.isArray(phase.segments))))throw fail(400,'چرخه شیفت قطعه‌ای نامعتبر است');
    if(['advanced','rotation_segments'].includes(kind)){
      if(kind==='advanced'&&(!config.weekly||typeof config.weekly!=='object'||Array.isArray(config.weekly)||Object.keys(config.weekly).some(day=>!/^[0-6]$/.test(day))))throw fail(400,'تقویم شیفت چندبخشی نامعتبر است');
      const hm=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v||'');
      for(const items of (kind==='advanced'?Object.values(config.weekly):config.cycle.map(phase=>phase.segments))){
        if(!Array.isArray(items)||items.length>4)throw fail(400,'حداکثر چهار بازه شیفت در روز مجاز است');
        const intervals=[];
        for(const item of items){if(!item||!hm(item.s)||!hm(item.e))throw fail(400,'ساعت بازه شیفت نامعتبر است');
          const [sh,sm]=item.s.split(':').map(Number),[eh,em]=item.e.split(':').map(Number),start=sh*60+sm,rawEnd=eh*60+em;
          const end=rawEnd<=start?rawEnd+1440:rawEnd;
          if(end-start>960)throw fail(400,'طول بازه شیفت بیش از ۱۶ ساعت است');
          intervals.push({start,end});}
        intervals.sort((a,b)=>a.start-b.start);
        if(intervals.some((it,i)=>i>0&&it.start<intervals[i-1].end)||intervals.reduce((sum,i)=>sum+i.end-i.start,0)>1440)throw fail(400,'بازه‌های شیفت هم‌پوشانی دارند');
      }
    }
    if(['late_ok','early_ok','ot_begin','ot_end'].some(k=>config[k]!==undefined&&(!Number.isInteger(config[k])||config[k]<0||config[k]>360)))throw fail(400,'تلورانس یا پنجره اضافه‌کاری نامعتبر است');
    const result=db.prepare('INSERT INTO shifts(company_id,name,start_time,end_time,duty_minutes,daily_ot_cap,schedule_kind,schedule_json) VALUES(?,?,?,?,?,?,?,?)').run(user.company_id,b.name,b.start_time,b.end_time,b.duty_minutes,cap,kind,JSON.stringify(config));
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
    const items=mine?db.prepare(`SELECT r.id,r.user_id,u.name,r.type,r.work_date,r.end_date,r.unit,r.minutes,r.description,r.status,r.created_at,r.substitute_user_id,su.name substitute_name
      FROM personnel_requests r JOIN users u ON u.id=r.user_id AND u.company_id=r.company_id
      LEFT JOIN users su ON su.id=r.substitute_user_id AND su.company_id=r.company_id
      WHERE r.company_id=? AND r.user_id=? ORDER BY r.id DESC LIMIT 200`).all(user.company_id,user.id)
    :db.prepare(`SELECT r.id,r.user_id,u.name,r.type,r.work_date,r.end_date,r.unit,r.minutes,r.description,r.status,r.created_at,r.substitute_user_id,su.name substitute_name
      FROM personnel_requests r JOIN users u ON u.id=r.user_id AND u.company_id=r.company_id
      LEFT JOIN users su ON su.id=r.substitute_user_id AND su.company_id=r.company_id
      WHERE r.company_id=? ORDER BY r.id DESC LIMIT 200`).all(user.company_id);
    for(const item of items){item.next_stage=db.prepare('SELECT COUNT(*) n FROM request_decisions WHERE company_id=? AND request_id=?').get(user.company_id,item.id).n+1;item.total_steps=settings(user.company_id).approval_steps;}
    return json(res,200,{items});
  }
  if(path==='/api/substitutes'&&method==='GET'){
    const from=url.searchParams.get('from'),to=url.searchParams.get('to');
    if(!validDay(from)||!validDay(to)||to<from||Date.parse(to)-Date.parse(from)>30*86400000)throw fail(400,'بازه جانشینی نامعتبر است');
    const items=db.prepare(`SELECT id,name,zone_id FROM users WHERE company_id=? AND active=1 AND can_be_substitute=1 AND id<>? ORDER BY name`)
      .all(user.company_id,user.id).map(s=>({...s,available:substituteAvailable(user.company_id,s.id,from,to)}));
    return json(res,200,{items});
  }
  if(path==='/api/leave-balance' && method==='GET'){
    const year=Number(url.searchParams.get('year')),targetId=Number(url.searchParams.get('user_id')||user.id);
    if(!Number.isInteger(year)||year<1300||year>1499||!Number.isInteger(targetId)||!ownUser(user,targetId))throw fail(400,'سال شمسی یا کاربر نامعتبر است');
    if(targetId!==user.id)admin(user);
    return json(res,200,annualLeaveBalance(user.company_id,targetId,year));
  }
  if(path==='/api/requests' && method==='POST') {
    const b=await body(req);
    const end=b.end_date||b.work_date,unit=b.unit||'hourly';
    if(!['annual_leave','sick_leave','unpaid_leave','mission'].includes(b.type)||!validDay(b.work_date)||!validDay(end)||end<b.work_date||Date.parse(end)-Date.parse(b.work_date)>30*86400000||!['hourly','daily'].includes(unit)||(unit==='hourly'&&end!==b.work_date)||!Number.isInteger(b.minutes)||b.minutes<1||b.minutes>1440||(b.description!==undefined&&typeof b.description!=='string')||(b.description||'').length>500) throw fail(400,'اطلاعات درخواست نامعتبر است');
    const eligible=b.type==='annual_leave'&&unit==='daily',subId=b.substitute_user_id??null;
    if(subId!==null&&(!eligible||!Number.isInteger(subId)||subId===user.id))throw fail(400,'جانشین فقط برای مرخصی استحقاقی روزانه مجاز است');
    db.exec('BEGIN IMMEDIATE');let result;
    try{
      const requester=db.prepare(`SELECT z.requires_substitute FROM users u LEFT JOIN zones z ON z.id=u.zone_id AND z.company_id=u.company_id
        WHERE u.id=? AND u.company_id=?`).get(user.id,user.company_id);
      const substituteSelf=db.prepare(`SELECT 1 FROM substitute_assignments WHERE company_id=? AND substitute_user_id=? AND from_date<=? AND to_date>=? LIMIT 1`)
        .get(user.company_id,user.id,end,b.work_date);
      if(eligible&&requester?.requires_substitute&&!subId&&!substituteSelf)throw fail(400,'برای این منطقه انتخاب نیروی جایگزین الزامی است');
      if(subId!==null){const sub=db.prepare('SELECT active,can_be_substitute FROM users WHERE id=? AND company_id=?').get(subId,user.company_id);
        if(!sub?.active||!sub.can_be_substitute)throw fail(404,'نیروی جایگزین مجاز در شرکت وجود ندارد');
        if(!substituteAvailable(user.company_id,subId,b.work_date,end))throw fail(409,'نیروی جایگزین در این بازه در دسترس نیست');}
      result=db.prepare(`INSERT INTO personnel_requests(company_id,user_id,type,work_date,end_date,unit,minutes,description,substitute_user_id)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(user.company_id,user.id,b.type,b.work_date,end,unit,b.minutes,b.description||'',subId);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    const id=Number(result.lastInsertRowid);audit(user,'request.create','personnel_request',id);return json(res,201,{id,status:'pending'});
  }
  const decision=/^\/api\/requests\/(\d+)\/decision$/.exec(path);
  if(decision && method==='POST') {
    admin(user);const id=Number(decision[1]),b=await body(req);
    if(!['approved','rejected'].includes(b.status)) throw fail(400,'وضعیت نامعتبر است');
    db.exec('BEGIN IMMEDIATE');
    try {
      const target=db.prepare('SELECT id,user_id,status,type,work_date,end_date,minutes,unit,substitute_user_id FROM personnel_requests WHERE id=? AND company_id=?').get(id,user.company_id);
      if(!target)throw fail(404,'درخواست شرکت یافت نشد');
      if(target.user_id===user.id)throw fail(403,'تأیید درخواست خود مجاز نیست');
      if(target.status!=='pending')throw fail(409,'این درخواست قبلاً بررسی شده است');
      const previous=db.prepare('SELECT COUNT(*) n FROM request_decisions WHERE company_id=? AND request_id=?').get(user.company_id,id).n;
      const step=previous+1,totalSteps=settings(user.company_id).approval_steps;
      if(step>totalSteps)throw fail(409,'مراحل تأیید تکمیل شده‌اند');
      if(totalSteps===2) {
        const managers=db.prepare(`SELECT COUNT(*) n FROM users WHERE company_id=? AND role='manager' AND active=1`).get(user.company_id).n;
        if(step===1 && user.role!=='manager' && !(user.role==='owner'&&managers===0))throw fail(403,'مرحله اول تأیید با مدیر میانی است');
        if(step===2 && user.role!=='owner')throw fail(403,'مرحله نهایی تأیید با مدیر شرکت است');
      }
      if(b.status==='approved'&&step===totalSteps&&target.type==='annual_leave'){
        const next=annualLeaveByYear([target]);
        for(const [year,minutes] of next){const balance=annualLeaveBalance(user.company_id,target.user_id,year,id);
          if(minutes>balance.remaining_minutes)throw fail(409,`مانده مرخصی استحقاقی سال ${year} کافی نیست`);}
      }
      if(b.status==='approved'&&step===totalSteps&&target.type==='annual_leave'&&target.unit==='daily'&&target.substitute_user_id){
        const sub=db.prepare('SELECT active,can_be_substitute FROM users WHERE company_id=? AND id=?').get(user.company_id,target.substitute_user_id);
        if(!sub?.active||!sub.can_be_substitute||!substituteAvailable(user.company_id,target.substitute_user_id,target.work_date,target.end_date||target.work_date,id))
          throw fail(409,'جانشین دیگر در دسترس نیست');
        db.prepare(`INSERT INTO substitute_assignments(company_id,request_id,substitute_user_id,absent_user_id,from_date,to_date)
          VALUES(?,?,?,?,?,?)`).run(user.company_id,id,target.substitute_user_id,target.user_id,target.work_date,target.end_date||target.work_date);
      }
      db.prepare('INSERT INTO request_decisions(company_id,request_id,stage,actor_user_id,outcome) VALUES(?,?,?,?,?)').run(user.company_id,id,step,user.id,b.status);
      const finalStatus=b.status==='rejected'?'rejected':step===totalSteps?'approved':'pending';
      if(finalStatus!=='pending')db.prepare(`UPDATE personnel_requests SET status=?,decided_by=?,decided_at=? WHERE id=? AND company_id=?`).run(finalStatus,user.id,new Date().toISOString(),id,user.company_id);
      audit(user,'request.'+b.status,'personnel_request',id);db.exec('COMMIT');return json(res,200,{ok:true,status:finalStatus,stage:step,total_steps:totalSteps});
    } catch(e){db.exec('ROLLBACK');throw e;}
  }
  if(path==='/api/holidays' && method==='GET') {
    return json(res,200,{items:db.prepare('SELECT work_date,title FROM company_holidays WHERE company_id=? ORDER BY work_date').all(user.company_id)});
  }
  if(path==='/api/calendar' && method==='GET') {
    const from=url.searchParams.get('from'),to=url.searchParams.get('to');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(to||'')||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||from>to||Date.parse(to)-Date.parse(from)>35*86400000)throw fail(400,'بازه تقویم نامعتبر است');
    const manual=new Map(db.prepare('SELECT work_date,title FROM company_holidays WHERE company_id=? AND work_date BETWEEN ? AND ?').all(user.company_id,from,to).map(r=>[r.work_date,r.title]));
    const official=await loadOfficialCalendar(db,from,to);
    const days=calendarDays(from,to,manual,official.days);
    return json(res,200,{days,official_calendar_available:true,official_calendar_status:official.status,official_calendar_stale:official.stale,official_calendar_estimated:official.estimated,
      note:official.stale?'آخرین نسخه ذخیره‌شده استفاده شد؛ ارتباط با منبع تقویم قطع است.':'داده تعطیلات از منبع برخط مستقل حضوریار دریافت و ذخیره شده است.'});
  }
  if(path==='/api/holidays' && method==='POST') {
    owner(user);const b=await body(req);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(b.work_date||'')||Number.isNaN(Date.parse(b.work_date))||!str(b.title,120)) throw fail(400,'تاریخ یا عنوان تعطیلی نامعتبر است');
    db.prepare('INSERT INTO company_holidays(company_id,work_date,title) VALUES(?,?,?) ON CONFLICT(company_id,work_date) DO UPDATE SET title=excluded.title').run(user.company_id,b.work_date,b.title);
    audit(user,'holiday.save','company',user.company_id);return json(res,200,{ok:true});
  }
  if(path==='/api/work-report' && method==='GET') {
    const from=url.searchParams.get('from'),to=url.searchParams.get('to');
    if(!validDay(from)||!validDay(to)||from>to||Date.parse(to)-Date.parse(from)>35*86400000) throw fail(400,'بازه گزارش باید حداکثر ۳۵ روز باشد');
    const targetId=url.searchParams.has('user_id')?Number(url.searchParams.get('user_id')):user.id;
    if(targetId!==user.id)admin(user);
    if(!ownUser(user,targetId))throw fail(404,'کارمند یافت نشد');
    const official=await loadOfficialCalendar(db,from,to);
    return json(res,200,buildWorkReport(user.company_id,targetId,from,to,official));
  }
  if(path==='/api/work-months' && method==='GET') {
    admin(user);
    const items=db.prepare(`SELECT a.month,a.created_at,a.created_by,COALESCE(r.status,'pending_review') review_status,
      CASE WHEN f.month IS NULL THEN 0 ELSE 1 END finance_confirmed
      FROM work_month_archives a LEFT JOIN work_month_reviews r ON r.company_id=a.company_id AND r.month=a.month
      LEFT JOIN work_month_finance f ON f.company_id=a.company_id AND f.month=a.month
      WHERE a.company_id=? ORDER BY a.month DESC LIMIT 36`).all(user.company_id);
    return json(res,200,{items});
  }
  const exportMatch=/^\/api\/work-months\/((?:j-)?\d{4}-\d{2})\/xlsx$/.exec(path);
  if(exportMatch&&method==='GET'){
    admin(user);const month=exportMatch[1];monthBounds(month);
    const row=db.prepare('SELECT snapshot_json FROM work_month_archives WHERE company_id=? AND month=?').get(user.company_id,month);
    if(!row)throw fail(404,'گزارش بایگانی یافت نشد');
    const data=archivedWorkXlsx(JSON.parse(row.snapshot_json));
    res.writeHead(200,{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':`attachment; filename="hozoryar-${month}.xlsx"`,'content-length':data.length,'cache-control':'no-store','x-content-type-options':'nosniff'});
    return res.end(data);
  }
  const archiveMatch=/^\/api\/work-months\/(j-)?(\d{4}-\d{2})$/.exec(path);
  if(archiveMatch && method==='GET') {
    admin(user);const month=archiveMatch[0].split('/').at(-1);monthBounds(month);
    const row=db.prepare(`SELECT a.snapshot_json,a.created_at,a.created_by,COALESCE(r.status,'pending_review') review_status,
      r.reviewer_user_id,r.reviewed_at,r.approver_user_id,r.approved_at,
      f.snapshot_sha256 finance_digest,f.include_surplus finance_include_surplus,f.confirmed_by finance_confirmed_by,f.confirmed_at finance_confirmed_at,f.payroll_json finance_record
      FROM work_month_archives a LEFT JOIN work_month_reviews r ON r.company_id=a.company_id AND r.month=a.month
      LEFT JOIN work_month_finance f ON f.company_id=a.company_id AND f.month=a.month
      WHERE a.company_id=? AND a.month=?`).get(user.company_id,month);
    if(!row)throw fail(404,'بایگانی این ماه وجود ندارد');
    const {snapshot_json,finance_record,...meta}=row;return json(res,200,{...JSON.parse(snapshot_json),...meta,
      finance_record:finance_record?JSON.parse(finance_record):null,
      finance_integrity_ok:row.finance_digest?snapshotDigest(snapshot_json)===row.finance_digest:null});
  }
  const financeMatch=/^\/api\/work-months\/((?:j-)?\d{4}-\d{2})\/(payroll-preview|finance-confirm)$/.exec(path);
  if(financeMatch && (method==='GET'||method==='POST')){
    admin(user);const [,month,action]=financeMatch;monthBounds(month);
    if((action==='payroll-preview'&&method!=='GET')||(action==='finance-confirm'&&method!=='POST'))throw fail(405,'روش نامعتبر است');
    if(action==='finance-confirm')owner(user);
    const input=method==='POST'?await body(req):{include_surplus:url.searchParams.get('include_surplus')==='1'};
    if(typeof input.include_surplus!=='boolean')throw fail(400,'سیاست مازاد حضور باید مشخص باشد');
    if(action==='finance-confirm'&&(input.confirm!==true||!str(input.note,500)))throw fail(400,'تأیید صریح و توضیح مالی الزامی است');
    if(action==='finance-confirm')db.exec('BEGIN IMMEDIATE');
    try{
      const row=db.prepare(`SELECT a.snapshot_json,r.status review_status FROM work_month_archives a
        LEFT JOIN work_month_reviews r ON r.company_id=a.company_id AND r.month=a.month
        WHERE a.company_id=? AND a.month=?`).get(user.company_id,month);
      if(!row)throw fail(404,'بایگانی یافت نشد');
      const snapshot=JSON.parse(row.snapshot_json),preview=payrollPreview(snapshot,input.include_surplus),sha=snapshotDigest(row.snapshot_json);
      if(action==='finance-confirm'){
        if(row.review_status!=='approved')throw fail(409,'ابتدا تأیید مدیریتی لازم است');
        if(snapshot.official_calendar_stale||snapshot.official_calendar_estimated)throw fail(409,'تقویم رسمی این بایگانی نیازمند بازبینی است');
        if(db.prepare('SELECT 1 FROM work_month_finance WHERE company_id=? AND month=?').get(user.company_id,month))throw fail(409,'تأیید مالی این ماه قبلاً ثبت شده است');
        db.prepare(`INSERT INTO work_month_finance(company_id,month,snapshot_sha256,include_surplus,payroll_json,confirmed_by)
          VALUES(?,?,?,?,?,?)`).run(user.company_id,month,sha,Number(input.include_surplus),JSON.stringify({note:input.note,items:preview}),user.id);
        audit(user,'work_month.finance_confirm','work_month',null);
        db.exec('COMMIT');return json(res,201,{ok:true,month,financially_confirmed:true,snapshot_sha256:sha,authoritative:false});
      }
      return json(res,200,{month,include_surplus:input.include_surplus,items:preview,snapshot_sha256:sha,
        financially_confirmed:!!db.prepare('SELECT 1 FROM work_month_finance WHERE company_id=? AND month=?').get(user.company_id,month),
        note:'مبنای محاسبه دقیقه کارکرد است؛ محاسبه مبلغ حقوق، کسورات بیمه و مالیات در این نسخه انجام نمی‌شود.'});
    }catch(e){if(action==='finance-confirm')db.exec('ROLLBACK');throw e;}
  }
  const reviewMatch=/^\/api\/work-months\/((?:j-)?\d{4}-\d{2})\/(review|approve)$/.exec(path);
  if(reviewMatch&&method==='POST'){
    admin(user);const [,month,action]=reviewMatch;monthBounds(month);
    if(action==='approve')owner(user);
    db.exec('BEGIN IMMEDIATE');
    try{
      if(!db.prepare('SELECT 1 FROM work_month_archives WHERE company_id=? AND month=?').get(user.company_id,month))throw fail(404,'بایگانی یافت نشد');
      const review=db.prepare('SELECT * FROM work_month_reviews WHERE company_id=? AND month=?').get(user.company_id,month);
      const current=review?.status||'pending_review';
      if(action==='review'){
        if(current!=='pending_review')throw fail(409,'این دوره قبلاً بررسی شده است');
        const hasManager=db.prepare("SELECT COUNT(*) n FROM users WHERE company_id=? AND role='manager' AND active=1").get(user.company_id).n>0;
        if(hasManager&&user.role!=='manager')throw fail(403,'بررسی اولیه باید توسط مدیر میانی انجام شود');
        db.prepare(`INSERT INTO work_month_reviews(company_id,month,status,reviewer_user_id,reviewed_at) VALUES(?,?,?,?,?)
          ON CONFLICT(company_id,month) DO UPDATE SET status=excluded.status,reviewer_user_id=excluded.reviewer_user_id,reviewed_at=excluded.reviewed_at`)
          .run(user.company_id,month,'reviewed',user.id,new Date().toISOString());
      }else{
        if(current!=='reviewed')throw fail(409,'ابتدا باید بررسی اولیه انجام شود');
        db.prepare(`UPDATE work_month_reviews SET status='approved',approver_user_id=?,approved_at=? WHERE company_id=? AND month=?`)
          .run(user.id,new Date().toISOString(),user.company_id,month);
      }
      audit(user,'work_month.'+action,'work_month',null);
      db.exec('COMMIT');return json(res,200,{ok:true,status:action==='review'?'reviewed':'approved',authoritative:false});
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  if(path==='/api/work-months/finalize' && method==='POST') {
    owner(user);const {month}=await body(req),{from,to}=monthBounds(month);
    const official=await loadOfficialCalendar(db,from,to);
    db.exec('BEGIN IMMEDIATE');
    try {
      if(db.prepare('SELECT 1 FROM work_month_archives WHERE company_id=? AND month=?').get(user.company_id,month))throw fail(409,'این ماه قبلاً بایگانی شده و قابل بازنویسی نیست');
      const pending=db.prepare("SELECT COUNT(*) n FROM personnel_requests WHERE company_id=? AND work_date<=? AND COALESCE(end_date,work_date)>=? AND status='pending'").get(user.company_id,to,from).n;
      if(pending)throw fail(409,`${pending} درخواست بررسی‌نشده در این ماه وجود دارد`);
      const nextDay=new Date(Date.parse(to)+86400000).toISOString().slice(0,10);
      const open=db.prepare('SELECT COUNT(*) n FROM attendance WHERE company_id=? AND checked_in_at<? AND checked_out_at IS NULL').get(user.company_id,new Date(localInstant(nextDay,0)).toISOString()).n;
      if(open)throw fail(409,`${open} حضور بدون خروج وجود دارد؛ پیش از بایگانی بررسی کنید`);
      const people=db.prepare('SELECT id,name,role FROM users WHERE company_id=? AND active=1 ORDER BY id').all(user.company_id);
      const reports=people.map(person=>({...person,report:buildWorkReport(user.company_id,person.id,from,to,official)}));
      const snapshot={month,calendar:month.startsWith('j-')?'jalali':'gregorian',from,to,status:'archived',authoritative:false,official_calendar_available:true,
        official_calendar_status:official.status,official_calendar_stale:official.stale,official_calendar_estimated:official.estimated,
        note:'این سند ثابت از تقویم مستقل برخط یا آخرین نسخه ذخیره‌شده استفاده کرده و تأیید حقوق و دستمزد نیست.',reports};
      db.prepare('INSERT INTO work_month_archives(company_id,month,snapshot_json,created_by) VALUES(?,?,?,?)')
        .run(user.company_id,month,JSON.stringify(snapshot),user.id);
      db.prepare('INSERT INTO work_month_reviews(company_id,month) VALUES(?,?)').run(user.company_id,month);
      audit(user,'work_month.archive','work_month',null);
      db.exec('COMMIT');return json(res,201,{ok:true,month,users:people.length,status:'archived',authoritative:false});
    } catch(e){db.exec('ROLLBACK');throw e;}
  }
  if (path==='/api/settings' && method==='GET') {
    owner(user);const s=settings(user.company_id);
    return json(res,200,{map_provider:s.map_provider,sms_provider:s.sms_provider,require_location:!!s.require_location,enforce_shift_window:!!s.enforce_shift_window,geofence_lat:s.geofence_lat,geofence_lng:s.geofence_lng,geofence_radius_m:s.geofence_radius_m,approval_steps:s.approval_steps,annual_leave_minutes:s.annual_leave_minutes,features:JSON.parse(s.features_json),neshan_key_configured:!!s.neshan_api_key,sms_key_configured:!!s.sms_api_key});
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
    if(b.approval_steps!==undefined && ![1,2].includes(b.approval_steps))throw fail(400,'تعداد مراحل تأیید نامعتبر است');
    if(b.enforce_shift_window!==undefined&&typeof b.enforce_shift_window!=='boolean')throw fail(400,'سیاست بازه مجاز تردد نامعتبر است');
    if(b.annual_leave_minutes!==undefined&&(!Number.isInteger(b.annual_leave_minutes)||b.annual_leave_minutes<0||b.annual_leave_minutes>525600))throw fail(400,'سقف سالانه مرخصی نامعتبر است');
    const f=b.features===undefined?JSON.parse(s.features_json):b.features;
    if(!f||typeof f!=='object'||Array.isArray(f)||Object.keys(f).some(k=>!['liveMap','attendance','monitoring','shifts','sms'].includes(k))||Object.values(f).some(v=>typeof v!=='boolean')) throw fail(400,'تنظیمات قابلیت‌ها نامعتبر است');
    db.prepare(`UPDATE company_settings SET map_provider=?,neshan_api_key=?,sms_provider=?,sms_api_key=?,require_location=?,enforce_shift_window=?,geofence_lat=?,geofence_lng=?,geofence_radius_m=?,approval_steps=?,annual_leave_minutes=?,features_json=? WHERE company_id=?`)
      .run(b.map_provider??s.map_provider,b.neshan_api_key===undefined?s.neshan_api_key:b.neshan_api_key,b.sms_provider??s.sms_provider,b.sms_api_key===undefined?s.sms_api_key:b.sms_api_key,b.require_location===undefined?s.require_location:Number(!!b.require_location),b.enforce_shift_window===undefined?s.enforce_shift_window:Number(b.enforce_shift_window),b.geofence_lat===undefined?s.geofence_lat:b.geofence_lat,b.geofence_lng===undefined?s.geofence_lng:b.geofence_lng,b.geofence_radius_m??s.geofence_radius_m,b.approval_steps??s.approval_steps,b.annual_leave_minutes??s.annual_leave_minutes,JSON.stringify(f),user.company_id);
    audit(user,'settings.update','company',user.company_id);return json(res,200,{ok:true});
  }
  if (path==='/api/attendance' && method==='POST') {
    feature(user,'attendance');const b=await body(req),s=settings(user.company_id);
    if(!['in','out'].includes(b.action)) throw fail(400,'عملیات نامعتبر است');
    if(b.event_id!==undefined&&(!/^[-a-zA-Z0-9_]{16,64}$/.test(b.event_id)||typeof b.event_id!=='string'))throw fail(400,'شناسه یکتای ثبت تردد نامعتبر است');
    // A network retry of a successfully committed punch returns its original result.
    // The event is scoped to the authenticated tenant and person, never client-supplied ids.
    if(b.event_id){const previous=db.prepare('SELECT action,attendance_id,recorded_at FROM attendance_events WHERE company_id=? AND user_id=? AND event_id=?').get(user.company_id,user.id,b.event_id);
      if(previous){if(previous.action!==b.action)throw fail(409,'شناسه رویداد قبلاً برای عملیات دیگری استفاده شده است');
        return json(res,200,{id:previous.attendance_id,at:previous.recorded_at,replayed:true});}}
    if(b.action==='in' && s.require_location && !validCoords(b.lat,b.lng,b.accuracy)) throw fail(400,'موقعیت مکانی معتبر لازم است');
    if(b.action==='in' && s.geofence_lat!==null && s.geofence_lng!==null && (!validCoords(b.lat,b.lng,b.accuracy)||distance(b.lat,b.lng,s.geofence_lat,s.geofence_lng)>s.geofence_radius_m)) throw fail(403,'خارج از محدوده مجاز هستید');
    if(s.enforce_shift_window){const shift=db.prepare(`SELECT s.* FROM assignments a JOIN shifts s ON s.id=a.shift_id AND s.company_id=a.company_id
      WHERE a.company_id=? AND a.user_id=?`).get(user.company_id,user.id);
      if(!allowedShiftTraffic(shift,Date.now(),b.action))throw fail(403,'ثبت تردد خارج از بازه مجاز شیفت است');}
    const now=new Date().toISOString();let id;
    db.exec('BEGIN IMMEDIATE');
    try{if(b.action==='in') {
      if(db.prepare('SELECT id FROM attendance WHERE company_id=? AND user_id=? AND checked_out_at IS NULL').get(user.company_id,user.id)) throw fail(409,'حضور فعال دارید');
      id=Number(db.prepare('INSERT INTO attendance(company_id,user_id,checked_in_at,lat,lng,accuracy) VALUES(?,?,?,?,?,?)').run(user.company_id,user.id,now,b.lat??null,b.lng??null,b.accuracy??null).lastInsertRowid);
    } else {
      const active=db.prepare('SELECT id FROM attendance WHERE company_id=? AND user_id=? AND checked_out_at IS NULL').get(user.company_id,user.id);
      if(!active) throw fail(409,'حضور فعالی برای خروج ندارید');
      id=active.id;db.prepare('UPDATE attendance SET checked_out_at=? WHERE id=? AND company_id=?').run(now,id,user.company_id);
    }
    if(b.event_id)db.prepare('INSERT INTO attendance_events(company_id,user_id,event_id,action,attendance_id,recorded_at) VALUES(?,?,?,?,?,?)')
      .run(user.company_id,user.id,b.event_id,b.action,id,now);
    audit(user,'attendance.'+b.action,'attendance',id);
    db.exec('COMMIT');return json(res,201,{id,at:now,replayed:false});
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  if (path==='/api/attendance' && method==='GET') {
    feature(user,'attendance');let id=user.id;
    if(url.searchParams.has('user_id')) {admin(user);id=Number(url.searchParams.get('user_id'));if(!ownUser(user,id)) throw fail(404,'کارمند یافت نشد');}
    return json(res,200,{items:db.prepare('SELECT id,checked_in_at,checked_out_at,lat,lng FROM attendance WHERE company_id=? AND user_id=? ORDER BY id DESC LIMIT 100').all(user.company_id,id)});
  }
  const correctionMatch=/^\/api\/attendance\/(\d+)\/(correct|corrections)$/.exec(path);
  if(correctionMatch){admin(user);const attendanceId=Number(correctionMatch[1]),action=correctionMatch[2];
    const target=db.prepare('SELECT id,user_id,checked_in_at,checked_out_at FROM attendance WHERE id=? AND company_id=?').get(attendanceId,user.company_id);
    if(!target)throw fail(404,'تردد یافت نشد');
    if(action==='corrections'&&method==='GET')return json(res,200,{items:db.prepare(`SELECT c.old_in,c.old_out,c.new_in,c.new_out,c.reason,c.created_at,u.name actor_name
      FROM attendance_corrections c JOIN users u ON u.id=c.actor_user_id AND u.company_id=c.company_id
      WHERE c.company_id=? AND c.attendance_id=? ORDER BY c.id DESC`).all(user.company_id,attendanceId)});
    if(action==='correct'&&method==='POST'){
      const b=await body(req),iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString()===v;
      if(!iso(b.checked_in_at)||!iso(b.checked_out_at)||!str(b.reason,500)||b.reason.trim().length<8)throw fail(400,'تاریخ ورود، خروج یا دلیل اصلاح نامعتبر است');
      const from=Date.parse(b.checked_in_at),to=Date.parse(b.checked_out_at);
      if(to<=from||to-from>24*3600000)throw fail(400,'طول تردد اصلاحی نامعتبر است');
      db.exec('BEGIN IMMEDIATE');
      try{
        const current=db.prepare('SELECT checked_in_at,checked_out_at FROM attendance WHERE id=? AND company_id=?').get(attendanceId,user.company_id);
        if(!current?.checked_out_at)throw fail(409,'تردد باز قابل اصلاح نیست؛ ابتدا خروج ثبت شود');
        const archives=db.prepare('SELECT snapshot_json FROM work_month_archives WHERE company_id=?').all(user.company_id);
        const originalFrom=tehranDate(new Date(current.checked_in_at)),originalTo=tehranDate(new Date(current.checked_out_at));
        const proposedFrom=tehranDate(new Date(from)),proposedTo=tehranDate(new Date(to));
        for(const item of archives){const a=JSON.parse(item.snapshot_json);
          if((originalFrom<=a.to&&originalTo>=a.from)||(proposedFrom<=a.to&&proposedTo>=a.from))throw fail(409,'اصلاح تردد در دوره بایگانی‌شده مجاز نیست');}
        const conflict=db.prepare(`SELECT 1 FROM attendance WHERE company_id=? AND user_id=? AND id<>?
          AND checked_in_at<? AND (checked_out_at IS NULL OR checked_out_at>?) LIMIT 1`).get(user.company_id,target.user_id,attendanceId,b.checked_out_at,b.checked_in_at);
        if(conflict)throw fail(409,'بازه اصلاحی با تردد دیگری تداخل دارد');
        db.prepare('UPDATE attendance SET checked_in_at=?,checked_out_at=? WHERE company_id=? AND id=?')
          .run(b.checked_in_at,b.checked_out_at,user.company_id,attendanceId);
        db.prepare(`INSERT INTO attendance_corrections(company_id,attendance_id,actor_user_id,old_in,old_out,new_in,new_out,reason)
          VALUES(?,?,?,?,?,?,?,?)`).run(user.company_id,attendanceId,user.id,current.checked_in_at,current.checked_out_at,b.checked_in_at,b.checked_out_at,b.reason.trim());
        audit(user,'attendance.correct','attendance',attendanceId);db.exec('COMMIT');return json(res,200,{ok:true});
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
    throw fail(405,'روش نامعتبر است');
  }
  if(path==='/api/monitoring/event'&&method==='POST'){
    feature(user,'monitoring');const b=await body(req);
    if(!['gps_off','gps_on','internet_off','internet_on'].includes(b.kind))throw fail(400,'نوع رویداد نظارتی نامعتبر است');
    const active=db.prepare('SELECT id FROM attendance WHERE company_id=? AND user_id=? AND checked_out_at IS NULL').get(user.company_id,user.id);
    if(!active)throw fail(403,'ثبت رویداد فقط در حضور فعال مجاز است');
    const result=db.prepare('INSERT INTO monitoring_events(company_id,user_id,attendance_id,kind,recorded_at) VALUES(?,?,?,?,?)')
      .run(user.company_id,user.id,active.id,b.kind,new Date().toISOString());
    return json(res,201,{id:Number(result.lastInsertRowid),evidence_only:true});
  }
  if(path==='/api/monitoring/events'&&method==='GET'){
    admin(user);feature(user,'monitoring');const targetId=Number(url.searchParams.get('user_id'));
    if(!Number.isInteger(targetId)||!ownUser(user,targetId))throw fail(404,'کارمند یافت نشد');
    return json(res,200,{items:db.prepare(`SELECT kind,recorded_at,attendance_id FROM monitoring_events
      WHERE company_id=? AND user_id=? ORDER BY id DESC LIMIT 250`).all(user.company_id,targetId),evidence_only:true});
  }
  if (path==='/api/location' && method==='POST') {
    feature(user,'monitoring');const b=await body(req);
    if(!validCoords(b.lat,b.lng,b.accuracy)) throw fail(400,'مختصات نامعتبر است');
    if(!db.prepare('SELECT id FROM attendance WHERE company_id=? AND user_id=? AND checked_out_at IS NULL').get(user.company_id,user.id)) throw fail(403,'ثبت موقعیت فقط در حضور فعال مجاز است');
    const capturedAt=new Date().toISOString();
    db.prepare(`INSERT INTO locations(company_id,user_id,lat,lng,accuracy,recorded_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(company_id,user_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,accuracy=excluded.accuracy,recorded_at=excluded.recorded_at`)
      .run(user.company_id,user.id,b.lat,b.lng,b.accuracy??null,capturedAt);
    db.prepare('INSERT INTO location_history(company_id,user_id,lat,lng,accuracy,recorded_at) VALUES(?,?,?,?,?,?)')
      .run(user.company_id,user.id,b.lat,b.lng,b.accuracy??null,capturedAt);
    db.prepare("DELETE FROM location_history WHERE company_id=? AND julianday(recorded_at)<julianday('now','-30 days')").run(user.company_id);
    return json(res,200,{ok:true});
  }
  if(path==='/api/location-history'&&method==='GET'){
    admin(user);feature(user,'monitoring');
    const id=Number(url.searchParams.get('user_id'));
    if(!Number.isInteger(id)||!ownUser(user,id))throw fail(404,'کارمند یافت نشد');
    const items=db.prepare(`SELECT lat,lng,accuracy,recorded_at FROM location_history
      WHERE company_id=? AND user_id=? ORDER BY recorded_at DESC LIMIT 250`).all(user.company_id,id);
    return json(res,200,{items,retention_days:30});
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
