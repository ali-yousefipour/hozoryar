import {adminViews,adminTitles} from './admin.js?v=20261103-1';
const $=s=>document.querySelector(s), state={token:sessionStorage.getItem('hz_token'),platform:sessionStorage.getItem('hz_platform')==='1',user:null,features:{},view:'dashboard'};
const navPaths={
  dashboard:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  attendance:'M12 6v6l4 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  requests:'M8 4h12v17H4V4h4 M8 2v4 M12 11h5 M12 15h5 M8 11h.01 M8 15h.01',
  report:'M3 3v18h18 M8 16v-4 M13 16V8 M18 16V5',
  people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  shifts:'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2 M8 14h3 M8 18h3',
  map:'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15',
  monitor:'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7 M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.86 1.86-.06-.06A1.7 1.7 0 0 0 16 18.4a1.7 1.7 0 0 0-1 .6V22h-6v-3a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06L4.2 16.94l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1H1v-4h3a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88L4.2 7.06 6.06 5.2l.06.06A1.7 1.7 0 0 0 8 5.6a1.7 1.7 0 0 0 1-.6V2h6v3a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.86 1.86-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 .6 1h3v4h-3a1.7 1.7 0 0 0-.6 1'
  ,platform:'M3 5h18v14H3z M7 9h4 M7 13h4 M15 9h2 M15 13h2'
};
document.querySelectorAll('#nav button[data-view]').forEach(button=>{
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',navPaths[button.dataset.view]||navPaths.report);svg.append(path);
  button.firstChild.textContent='';button.prepend(svg);
});
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fa=n=>new Intl.NumberFormat('fa-IR').format(n||0);
const date=s=>s?new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium',timeStyle:'short',calendar:'persian',timeZone:'Asia/Tehran'}).format(new Date(typeof s==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)?s.replace(' ','T')+'+03:30':s)):'—';
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),4000);}
async function request(path,method='GET',data) {
  const res=await fetch(path,{method,headers:{...(state.token?{Authorization:'Bearer '+state.token}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
  const json=await res.json().catch(()=>({error:'پاسخ نامعتبر سرور'}));
  if(res.status===401&&state.user){loginScreen();throw new Error('نشست شما پایان یافته است. دوباره وارد شوید.');}
  if(!res.ok)throw new Error(json.error||'خطای ارتباط با سامانه');return json;
}
function card(content){return `<div class="card">${content}</div>`;}
function setContent(html){$('#content').innerHTML=html;}
function formData(form){return Object.fromEntries(new FormData(form));}
function guard(fn){return async e=>{e?.preventDefault();const button=e?.target?.querySelector?.('button[type="submit"],button.primary');if(button?.disabled)return;if(button){button.disabled=true;button.setAttribute('aria-busy','true');}try{await fn(e);}catch(err){toast(err.message);}finally{if(button){button.disabled=false;button.removeAttribute('aria-busy');}}};}
function form(label,fields,action){return `<form id="${action}" class="card stack"><h3>${label}</h3><div class="form-grid">${fields}</div><button class="primary">ثبت اطلاعات</button></form>`;}
function field(label,name,type='text',extra=''){return `<label>${label}<input name="${name}" type="${type}" ${extra} required></label>`;}

const admin=adminViews({$,state,request,esc,fa,date,minutes:(n)=>minutes(n),card,setContent,formData,guard,toast,navigate,icon,zoneManagement});
function loginScreen(){state.token=null;state.user=null;state.platform=false;sessionStorage.removeItem('hz_token');sessionStorage.removeItem('hz_platform');$('#login').classList.remove('hidden');$('#login-appearance').classList.remove('hidden');$('#app').classList.add('hidden');}
async function authenticate(){const response=await request(state.platform?'/api/platform/me':'/api/me');state.user=response.user;state.features=response.features||{};state.subscription=response.subscription||null;$('#login').classList.add('hidden');$('#login-appearance').classList.add('hidden');$('#app').classList.remove('hidden');$('#company-title').textContent=state.platform?'مدیریت مرکزی':state.user.company_name;$('#user-title').textContent=state.user.name;$('#top-user-name').textContent=state.user.name;
  document.querySelectorAll('[data-company-menu]').forEach(el=>el.classList.toggle('hidden',state.platform));
  if(state.platform){document.querySelectorAll('#nav button[data-view]').forEach(el=>el.classList.toggle('hidden',el.dataset.view!=='platform'));await navigate('platform');return;}
  document.querySelector('[data-view="platform"]').classList.add('hidden');
  document.querySelectorAll('[data-admin]').forEach(el=>el.classList.toggle('hidden',state.user.role==='employee'));
  document.querySelectorAll('[data-owner]').forEach(el=>el.classList.toggle('hidden',state.user.role!=='owner'));
  document.querySelector('[data-view="map"]').classList.toggle('hidden',!state.features.liveMap||state.user.role==='employee');
  document.querySelector('[data-view="monitor"]').classList.toggle('hidden',!state.features.monitoring||state.user.role==='employee');document.querySelector('[data-view="tracking"]').classList.toggle('hidden',!state.features.monitoring||state.user.role==='employee');
  const initial=location.hash.slice(1);const target=initial==='attendance'?'traffic':initial;const button=document.querySelector(`#nav button[data-view="${CSS.escape(target)}"]`);
  await navigate(state.user.role==='employee'?'mobile':target==='workplace-new'&&state.user.role==='owner'?target:button&&!button.classList.contains('hidden')?target:'dashboard');
}

function closeMenu(){ $('#app').classList.remove('menu-open'); $('#menu-toggle').setAttribute('aria-expanded','false'); }
$('#menu-toggle').onclick=()=>{const open=$('#app').classList.toggle('menu-open');$('#menu-toggle').setAttribute('aria-expanded',String(open));};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('#app').classList.contains('menu-open')){closeMenu();$('#menu-toggle').focus();}});
async function navigate(view){
  if(!state.platform&&state.user?.role==='employee')view='mobile';
  if(view==='workplace-new'&&(state.platform||state.user?.role!=='owner'))view='dashboard';
  if(view==='attendance')view='traffic';
  if(view==='monitor')view='tracking';
  closeMenu();
  state.view=view;if(location.hash!=='#'+view)history.replaceState(null,'','#'+view);
  document.querySelectorAll('#nav button').forEach(b=>{const active=b.dataset.view===view;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  const titles={...adminTitles,'workplace-new':'ثبت محل کار جدید',dashboard:'داشبورد مدیریتی',requests:'مرخصی و مأموریت',report:'گزارش کارکرد',people:'مدیریت پرسنل',shifts:'شیفت‌های کاری',map:'نقشه زنده نیروها',monitor:'نظارت بر پرسنل',settings:'تنظیمات شرکت',platform:'مدیریت اشتراک شرکت‌ها'};
  $('#page-title').textContent=titles[view]||view;$('#content').setAttribute('aria-busy','true');setContent('<div class="card loading-state" role="status">در حال دریافت اطلاعات…</div>');
  try{if(view==='workplace-new'){workplaceNew();return;}if(await admin.render(view))return;if(view==='archives'){await workReport();$('#report-form').classList.add('hidden');$('#report-results').classList.add('hidden');return;}if(view==='dashboard')await dashboard();if(view==='requests')await requests();if(view==='report')await workReport();if(view==='people')await people();if(view==='shifts')await shifts();if(view==='map')await liveMap();if(view==='monitor')await monitor();if(view==='settings')await settings();if(view==='platform'&&state.platform)await platformCompanies();}
  catch(e){setContent(card(`<div role="alert"><h2>اطلاعات دریافت نشد</h2><p class="error">${esc(e.message)}</p><button class="ghost" id="page-retry">تلاش مجدد</button></div>`));$('#page-retry').onclick=()=>navigate(view);}
  finally{$('#content').setAttribute('aria-busy','false');}
}

function icon(view){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${navPaths[view]||navPaths.report}"></path></svg>`;}
function personnelTable(title,items,present){
  if(!Array.isArray(items))return '';
  return card(`<h2>${title} <span class="badge">${fa(items.length)} نفر</span></h2><div class="table-wrap"><table class="table"><thead><tr><th>کد پرسنلی</th><th>نام و نام خانوادگی</th>${present?'<th>محل کار</th><th>زمان ورود</th>':''}</tr></thead><tbody>${items.map(p=>`<tr><td>${fa(p.id)}</td><td>${esc(p.name)}</td>${present?`<td>${esc(p.workplace||"—")}</td><td>${date(p.checked_in_at)}</td>`:''}</tr>`).join('')||`<tr><td colspan="${present?4:2}">در حال حاضر فردی در این فهرست نیست.</td></tr>`}</tbody></table></div>`);
}
async function dashboard(from='',to=''){
  const params=new URLSearchParams();if(from)params.set('from',from);if(to)params.set('to',to);
  const [a,setup]=await Promise.all([request('/api/dashboard?'+params),request('/api/setup')]),s=state.subscription;
  const steps=[['workplaces','محل کار','workplaces'],['shifts','تعریف شیفت','shifts'],['personnel','افزودن پرسنل','people'],['assigned','تخصیص شیفت','shifts'],['attendance','اولین تردد در اپ','mobile']];
  const setupHtml=`<section class="setup-journey" aria-labelledby="setup-title"><div class="section-head"><div><h2 id="setup-title">${setup.completed===setup.total?'فضای کاری شما آماده است':'راه‌اندازی فضای کاری'}</h2><p class="muted">${fa(setup.completed)} مرحله از ${fa(setup.total)} مرحله تکمیل شده است. وضعیت از اطلاعات همین شرکت خوانده می‌شود.</p></div><a class="home-link" href="/#start" target="_blank" rel="noopener">راهنمای شروع</a></div><ol class="setup-steps">${steps.map(([key,label,target],i)=>`<li class="${setup.steps[key]?'is-complete':''}"><button type="button" data-setup-view="${target}" ${key==='workplaces'&&state.user.role!=='owner'?'disabled':''}><span class="step-index">${fa(i+1)}</span><span>${label}<small>${setup.steps[key]?'تکمیل شده':key==='workplaces'&&state.user.role!=='owner'?'با دسترسی مالک':'ادامه این مرحله'}</small></span></button></li>`).join('')}</ol></section>`;
  const metrics=[['کل پرسنل',a.total,'people'],['حاضرین',a.present,'attendance'],['غایبین',a.unexcused_people?.length??a.absent,'monitor'],['مرخصی',a.leave_people?.length??0,'requests']];
  setContent(`<section class="card setup-card"><div><h2>فضای کاری ${esc(a.company)}</h2><p class="muted">دسترسی سریع به مدیریت پرسنل، شیفت‌ها و وضعیت تردد</p></div><div class="setup-actions"><button class="ghost" id="go-mobile">نصب اپلیکیشن موبایل</button>${state.user.role==='owner'?'<button class="ghost" id="go-workplace">ثبت محل کار</button>':''}<button class="ghost" id="go-people">${icon('people')} پرسنل</button><button class="ghost" id="go-shifts">${icon('shifts')} شیفت‌ها</button>${state.features.liveMap?`<button class="ghost" id="go-map">${icon('map')} نقشه زنده</button>`:''}</div></section>
  ${setup.completed<setup.total?setupHtml:''}
  <div class="dashboard-day"><span>${new Intl.DateTimeFormat('fa-IR',{dateStyle:'full',timeZone:'Asia/Tehran'}).format(new Date())}</span><button class="ghost" id="dashboard-refresh">به‌روزرسانی وضعیت</button></div>
  <section class="dashboard-stats" aria-label="آمار سازمان">${metrics.map(([label,value,key])=>`<article class="metric"><div class="metric-top"><span>${label}</span>${icon(key)}</div><strong>${fa(value)}<small>نفر</small></strong></article>`).join('')}</section>
  <div class="dashboard-actions"><button class="ghost" data-setup-view="requests">درخواست‌های در انتظار <b>${fa(setup.counts.pending)}</b></button><button class="ghost" data-setup-view="incomplete">ترددهای ناقص روزهای قبل <b>${fa(setup.counts.incomplete)}</b></button><span class="muted">حاضرین بر اساس تردد بدون خروج محاسبه می‌شوند.${setup.counts.incomplete?' ترددهای قدیمی را بررسی کنید.':''}</span></div>
  <div class="dashboard-lists">${personnelTable('حاضرین',a.present_people,true)}${personnelTable('غایبین',a.unexcused_people??a.absent_people,false)}${personnelTable('مرخصی',a.leave_people,false)}${personnelTable('مأموریت',a.mission_people,false)}</div>
  <div class="section-head"><h2>روند ثبت ورود</h2><span class="badge">${esc(a.period.from)} تا ${esc(a.period.to)}</span></div>
  <form id="trend-form" class="card form-grid">${field('از تاریخ (میلادی)','from','date')}${field('تا تاریخ (میلادی)','to','date')}<button class="primary">اعمال فیلتر</button></form>
  ${card(`<div class="table-wrap"><table class="table"><thead><tr><th>روز</th><th>تعداد نشست ورود</th><th>کارکنان یکتا</th></tr></thead><tbody>${a.arrivals.map(x=>`<tr><td>${esc(x.day)}</td><td>${fa(x.sessions)}</td><td>${fa(x.employees)}</td></tr>`).join('')||'<tr><td colspan="3">در این بازه ثبت ورودی وجود ندارد.</td></tr>'}</tbody></table></div>`)}
  ${s?`<div class="subscription-strip"><span class="badge ${s.expired?'':'ok'}">اشتراک ${s.expired?'پایان‌یافته':'فعال'}</span><span>پایان: ${s.subscription_end?esc(s.subscription_end):'نامحدود'}</span><span>سقف پرسنل: ${s.max_personnel===null?'نامحدود':fa(s.max_personnel)}</span></div>`:''}`);
  $('#trend-form [name=from]').value=a.period.from;$('#trend-form [name=to]').value=a.period.to;
  $('#trend-form').onsubmit=guard(async e=>{const b=formData(e.target);await dashboard(b.from,b.to);});
  document.querySelectorAll('[data-setup-view]').forEach(button=>button.onclick=()=>navigate(button.dataset.setupView));
  $('#dashboard-refresh').onclick=guard(async()=>{await dashboard(from,to);toast('وضعیت به‌روز شد');});
  $('#go-mobile').onclick=()=>navigate('mobile');
  if($('#go-workplace'))$('#go-workplace').onclick=()=>navigate('workplace-new');
  if($('#go-map'))$('#go-map').onclick=()=>navigate('map');
  $('#go-people').onclick=()=>navigate('people');$('#go-shifts').onclick=()=>navigate('shifts');
}

async function people(){
  const r=await request('/api/users'),owner=state.user.role==='owner';
  setContent(`<div class="section-head"><h2>کارکنان شرکت</h2><span class="badge">${fa(r.items.length)} نفر</span></div><label class="card">جست‌وجوی پرسنل<input id="people-search" type="search" placeholder="نام یا نام کاربری"></label><div class="card table-wrap"><table class="table"><thead><tr><th>نام</th><th>نام کاربری</th><th>نقش</th><th>وضعیت</th>${owner?'<th>عملیات</th>':''}</tr></thead><tbody id="people-rows"></tbody></table></div><section id="people-editor"></section>${owner?'<div class="section-head"><h2>افزودن کارمند</h2></div>'+form('حساب کاربری جدید',field('نام و نام خانوادگی','name')+field('نام کاربری','username','text','autocomplete="off"')+field('رمز عبور حداقل ۱۲ کاراکتر','password','password','minlength="12" autocomplete="new-password"')+'<label>سطح دسترسی<select name="role"><option value="employee">کارمند</option><option value="manager">مدیر</option></select></label>','person-form'):''}`);
  function draw(){const query=$('#people-search').value.trim().toLocaleLowerCase('fa');$('#people-rows').innerHTML=r.items.filter(p=>(p.name+' '+p.username).toLocaleLowerCase('fa').includes(query)).map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${u.role==='owner'?'مدیر شرکت':u.role==='manager'?'مدیر':'کارمند'}</td><td><span class="badge ${u.active?'ok':''}">${u.active?'فعال':'غیرفعال'}</span></td>${owner?`<td><button type="button" class="ghost person-edit" data-id="${u.id}">ویرایش</button></td>`:''}</tr>`).join('')||'<tr><td colspan="5">پرسنلی یافت نشد.</td></tr>';
    document.querySelectorAll('.person-edit').forEach(button=>button.onclick=()=>{const u=r.items.find(p=>String(p.id)===button.dataset.id);$('#people-editor').innerHTML=`<form id="person-edit-form" class="card stack"><h3>ویرایش پرسنل</h3><div class="form-grid"><label>نام و نام خانوادگی<input name="name" required maxlength="120" value="${esc(u.name)}"></label><label>نام کاربری<input name="username" required pattern="[a-zA-Z0-9_.-]{3,60}" value="${esc(u.username)}" autocomplete="off"></label><label>نقش<select name="role" ${u.role==='owner'?'disabled':''}>${(u.role==='owner'?[['owner','مدیر شرکت']]:[['employee','کارمند'],['manager','مدیر']]).map(([key,title])=>`<option value="${key}" ${u.role===key?'selected':''}>${title}</option>`).join('')}</select></label><label>وضعیت<select name="active" ${u.role==='owner'?'disabled':''}><option value="1" ${u.active?'selected':''}>فعال</option><option value="0" ${u.active?'':'selected'}>غیرفعال</option></select></label></div><div class="action-row"><button class="primary">ذخیره تغییرات</button><button type="button" class="ghost" id="person-cancel">انصراف</button></div></form>`;
      $('#person-cancel').onclick=()=>$('#people-editor').replaceChildren();$('#person-edit-form').onsubmit=guard(async e=>{const f=e.target;await request('/api/users/'+u.id,'PATCH',{name:f.elements.name.value,username:f.elements.username.value,role:f.elements.role.value,active:f.elements.active.value==='1'});toast('اطلاعات پرسنل ذخیره شد');await people();});$('#people-editor').scrollIntoView({block:'nearest'});
    });
  }
  $('#people-search').oninput=draw;draw();
  if($('#person-form'))$('#person-form').onsubmit=guard(async e=>{await request('/api/users','POST',formData(e.target));toast('کارمند اضافه شد');await people();});
}

async function shifts(){
  const [a,b,assigned]=await Promise.all([request('/api/shifts'),request('/api/users'),request('/api/assignments')]);
  b.items=b.items.filter(u=>u.active);
  const typeNames={fixed:'ثابت',weekly:'هفتگی',rotating:'چرخشی',rotation_segments:'چرخشی قطعه‌ای',floating:'شناور',advanced:'چندبخشی',auto:'خودکار'};
  setContent(`<div class="section-head"><h2>شیفت‌های تعریف‌شده</h2></div>${card(`<div class="table-wrap"><table class="table"><thead><tr><th>نام شیفت</th><th>نوع</th><th>شروع</th><th>پایان</th><th>موظفی</th><th>سقف اضافه‌کار</th></tr></thead><tbody>${a.items.map(s=>`<tr><td>${esc(s.name)}</td><td>${typeNames[s.schedule_kind]||'ثابت'}</td><td>${esc(s.start_time)}</td><td>${esc(s.end_time)}</td><td>${fa(s.duty_minutes)} دقیقه</td><td>${fa(s.daily_ot_cap)} دقیقه</td></tr>`).join('')||'<tr><td colspan="6">شیفتی تعریف نشده است.</td></tr>'}</tbody></table></div>`)}<div class="section-head"><h2>شیفت جدید</h2></div><form id="shift-form" class="card stack"><h3>تعریف شیفت</h3><div class="form-grid">${field('عنوان','name')}${field('ساعت شروع','start_time','time')}${field('ساعت پایان','end_time','time')}${field('موظفی (دقیقه)','duty_minutes','number','min="0" max="1440"')}${field('سقف اضافه‌کار روزانه (دقیقه)','daily_ot_cap','number','min="0" max="1440" value="27"')}<label>نوع شیفت<select name="schedule_kind"><option value="fixed">ثابت</option><option value="weekly">هفتگی</option><option value="rotating">چرخشی</option><option value="floating">شناور</option><option value="advanced">چندبخشی (دو بازه در روز)</option></select></label></div><div id="schedule-fields"></div><button class="primary">ثبت شیفت</button></form><div class="section-head"><h2>تخصیص شیفت</h2></div>${form('انتخاب کارمند و شیفت',`<label>کارمند<select name="user_id">${b.items.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></label><label>شیفت<select name="shift_id">${a.items.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>`,'assign-form')}`);
  const sf=$('#shift-form');
  $('#assign-form').insertAdjacentHTML('beforebegin',card(`<h3>شیفت فعلی کارکنان</h3><div class="table-wrap"><table class="table"><thead><tr><th>کارمند</th><th>شیفت فعلی</th></tr></thead><tbody>${b.items.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(assigned.items.find(a=>Number(a.user_id)===Number(u.id))?.shift_name||'تخصیص نیافته')}</td></tr>`).join('')||'<tr><td colspan="2">ابتدا پرسنل را اضافه کنید.</td></tr>'}</tbody></table></div>`));
  if(!a.items.length||!b.items.length){$('#assign-form button').disabled=true;$('#assign-form').insertAdjacentHTML('afterbegin','<p class="note">برای تخصیص، ابتدا یک کارمند فعال و یک شیفت تعریف کنید.</p>');}
  sf.elements.schedule_kind.insertAdjacentHTML('beforeend','<option value="rotation_segments">چرخشی چندبازه‌ای (الگوی خطیار)</option><option value="auto">خودکار (الگوی خطیار)</option>');
  sf.querySelector('.form-grid').insertAdjacentHTML('beforeend',
    `${field('تأخیر مجاز (دقیقه)','late_ok','number','min="0" max="360" value="0"')}${field('تعجیل مجاز (دقیقه)','early_ok','number','min="0" max="360" value="0"')}${field('اضافه‌کار قبل از شیفت (دقیقه)','ot_begin','number','min="0" max="360" value="0"')}${field('اضافه‌کار پس از شیفت (دقیقه)','ot_end','number','min="0" max="360" value="0"')}`);
  function renderSchedule(){const kind=sf.elements.schedule_kind.value;$('#schedule-fields').innerHTML=kind==='weekly'?`<fieldset><legend>روزهای کاری هفته</legend><div class="action-row">${['یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه','شنبه'].map((day,i)=>`<label style="display:block"><input type="checkbox" name="day_${i}" style="min-height:auto;width:auto" ${i<5?'checked':''}> ${day}</label>`).join('')}</div></fieldset>`:kind==='rotating'?`<div class="form-grid">${field('تعداد روز کار','work','number','min="1" max="30"')}${field('تعداد روز استراحت','rest','number','min="1" max="30"')}${field('شروع چرخه (میلادی)','anchor','date')}</div>`:kind==='rotation_segments'?`<div class="note" role="status">چرخه سه‌مرحله‌ای برای شیفت‌های صبح/عصر/شب؛ تعداد روزهای هر مرحله و بازه آن را تعیین کنید. برای مرحله استراحت، هر دو ساعت را خالی بگذارید. محاسبه از تاریخ شروع چرخه انجام می‌شود.</div><div class="form-grid">${field('شروع چرخه (میلادی)','anchor','date')}</div><div class="table-wrap"><table class="table"><thead><tr><th>مرحله</th><th>تعداد روز</th><th>شروع بازه</th><th>پایان بازه</th></tr></thead><tbody>${['صبح','عصر','شب'].map((name,i)=>`<tr><td>${name}</td><td><input type="number" name="phase_${i}_days" aria-label="تعداد روز مرحله ${name}" min="1" max="60" value="7" required></td><td><input type="time" name="phase_${i}_s" aria-label="شروع مرحله ${name}" value="${['07:00','15:00','23:00'][i]}"></td><td><input type="time" name="phase_${i}_e" aria-label="پایان مرحله ${name}" value="${['15:00','23:00','07:00'][i]}"></td></tr>`).join('')}</tbody></table></div>`:kind==='advanced'?`<div class="note">ساعات موظفی روزانه از مجموع بازه‌های همان روز محاسبه می‌شود. بازه خالی به معنای استراحت است. ساعت شروع/پایان بالای فرم فقط برای سازگاری شیفت ذخیره می‌شود.</div><div class="table-wrap"><table class="table"><thead><tr><th>روز</th><th>شروع ۱</th><th>پایان ۱</th><th>شروع ۲</th><th>پایان ۲</th></tr></thead><tbody>${['یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه','شنبه'].map((day,i)=>`<tr><td>${day}</td>${[0,1].map(j=>`<td><input type="time" aria-label="شروع ${j+1} ${day}" name="seg_${i}_${j}_s" value="${i===5?'':j===0?'08:00':'13:00'}"></td><td><input type="time" aria-label="پایان ${j+1} ${day}" name="seg_${i}_${j}_e" value="${i===5?'':j===0?'12:00':'17:00'}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'';}
  sf.elements.schedule_kind.onchange=renderSchedule;renderSchedule();
  sf.onsubmit=guard(async e=>{const f=e.target,p=formData(f),kind=p.schedule_kind;let schedule={};
    if(kind==='weekly')schedule={days:[0,1,2,3,4,5,6].filter(d=>f.elements['day_'+d].checked)};
    if(kind==='auto')schedule={auto_expected_min:Number(p.duty_minutes)};
    if(kind==='rotating')schedule={work:Number(p.work),rest:Number(p.rest),anchor:p.anchor};
    if(kind==='rotation_segments'){schedule={anchor:p.anchor,cycle:[]};for(let i=0;i<3;i++){const s=p[`phase_${i}_s`]||'',end=p[`phase_${i}_e`]||'';if(!!s!==!!end)throw new Error('ساعت شروع و پایان هر مرحله باید با هم تکمیل شوند');schedule.cycle.push({days:Number(p[`phase_${i}_days`]),segments:s?[{s,e:end}]:[]});}}
    if(kind==='advanced'){schedule.weekly={};for(let day=0;day<7;day++){const segments=[];for(let seg=0;seg<2;seg++){
      const s=p[`seg_${day}_${seg}_s`]||'',end=p[`seg_${day}_${seg}_e`]||'';
      if(!!s!==!!end)throw new Error('شروع و پایان هر بازه باید با هم تکمیل شوند');
      if(s)segments.push({s,e:end});}
      schedule.weekly[day]=segments;}}
    for(const key of ['late_ok','early_ok','ot_begin','ot_end'])schedule[key]=Number(p[key]);
    await request('/api/shifts','POST',{name:p.name,start_time:p.start_time,end_time:p.end_time,duty_minutes:Number(p.duty_minutes),daily_ot_cap:Number(p.daily_ot_cap),schedule_kind:kind,schedule});toast('شیفت ثبت شد');navigate('shifts');});
  $('#assign-form').onsubmit=guard(async e=>{const p=formData(e.target);await request('/api/assignments','POST',{user_id:Number(p.user_id),shift_id:Number(p.shift_id)});toast('شیفت تخصیص یافت');});
}

const requestTypes={annual_leave:'مرخصی استحقاقی',sick_leave:'مرخصی استعلاجی',unpaid_leave:'مرخصی بدون حقوق',mission:'مأموریت'};
const requestStates={pending:'در انتظار بررسی',approved:'تأیید شده',rejected:'رد شده'};
async function requests(){const r=await request('/api/requests');const isAdmin=state.user.role!=='employee';
  setContent(`<div class="section-head"><h2>درخواست‌های پرسنلی</h2><span class="badge">${fa(r.items.length)} درخواست</span></div>${card(`<div class="table-wrap"><table class="table"><thead><tr><th>کارمند</th><th>نوع درخواست</th><th>روز</th><th>مدت</th><th>وضعیت</th>${isAdmin?'<th>بررسی</th>':''}</tr></thead><tbody>${r.items.map(x=>`<tr><td>${esc(x.name)}</td><td>${requestTypes[x.type]}</td><td>${esc(x.work_date)}</td><td>${fa(x.minutes)} دقیقه</td><td><span class="badge ${x.status==='approved'?'ok':''}">${requestStates[x.status]}${x.status==='pending'&&x.total_steps===2?' · مرحله '+fa(x.next_stage)+' از ۲':''}</span></td>${isAdmin?`<td>${x.status==='pending'&&x.user_id!==state.user.id&&(x.total_steps===1||(x.next_stage===1&&state.user.role==='manager')||(x.next_stage===2&&state.user.role==='owner'))?`<div class="action-row"><button class="ghost decision" data-id="${x.id}" data-status="approved">تأیید</button><button class="ghost decision" data-id="${x.id}" data-status="rejected">رد</button></div>`:'—'}</td>`:''}</tr>`).join('')||`<tr><td colspan="${isAdmin?6:5}">درخواستی ثبت نشده است.</td></tr>`}</tbody></table></div>`)}<div class="section-head"><h2>ثبت درخواست جدید</h2></div><form class="card stack" id="request-form"><div class="form-grid"><label>نوع درخواست<select name="type"><option value="annual_leave">مرخصی استحقاقی</option><option value="sick_leave">مرخصی استعلاجی</option><option value="mission">مأموریت</option></select></label>${field('تاریخ (میلادی در ورودی اولیه)','work_date','date')}${field('مدت به دقیقه','minutes','number','min="1" max="1440"')}<label>توضیحات<input name="description" maxlength="500" placeholder="توضیح مختصر"></label></div><button class="primary">ارسال برای تأیید</button></form>`);
  const jalaliYear=Number(new Intl.DateTimeFormat('en-US-u-ca-persian',{year:'numeric'}).format(new Date()));
  const balance=await request('/api/leave-balance?year='+jalaliYear);
  $('#content').insertAdjacentHTML('afterbegin',`<div class="note" role="status">مانده مرخصی استحقاقی شما در سال ${fa(jalaliYear)}: <b>${fa(balance.remaining_minutes)} دقیقه</b> از سقف ${fa(balance.quota_minutes)} دقیقه (مصرف تأییدشده: ${fa(balance.used_minutes)} دقیقه). این مانده فقط مرخصی استحقاقی را پوشش می‌دهد.</div>`);
  document.querySelectorAll('.table tbody tr').forEach((row,i)=>{const item=r.items[i];if(!item)return;const cells=row.querySelectorAll('td');cells[2].textContent=item.work_date+(item.end_date&&item.end_date!==item.work_date?' تا '+item.end_date:'');cells[3].textContent=fa(item.minutes)+' دقیقه'+(item.unit==='daily'?' در هر روز':'');});
  $('#request-form .form-grid').insertAdjacentHTML('beforeend',`<label>واحد درخواست<select name="unit"><option value="hourly">ساعتی</option><option value="daily">روزانه</option></select></label><label>تاریخ پایان (برای درخواست چندروزه)<input name="end_date" type="date"></label>`);
  $('#request-form .form-grid').insertAdjacentHTML('beforeend',`<label id="substitute-label" class="hidden">جانشین مرخصی<select name="substitute_user_id"><option value="">بدون جانشین</option></select><small id="substitute-help" class="muted" role="status">جانشین‌های مجاز با توجه به تاریخ بررسی می‌شوند.</small></label>`);
  $('#request-form [name=type]').insertAdjacentHTML('beforeend','<option value="unpaid_leave">مرخصی بدون حقوق</option>');
  $('#request-form [name=description]').required=false;
  const unitInput=$('#request-form [name=unit]'),endInput=$('#request-form [name=end_date]'),minutesInput=$('#request-form [name=minutes]'),typeInput=$('#request-form [name=type]'),startInput=$('#request-form [name=work_date]'),subInput=$('#request-form [name=substitute_user_id]');
  let subLoad=0;
  async function refreshSubstitutes(){const index=++subLoad,active=unitInput.value==='daily'&&typeInput.value==='annual_leave';$('#substitute-label').classList.toggle('hidden',!active);subInput.required=false;subInput.innerHTML='<option value="">بدون جانشین</option>';
    if(!active||!startInput.value){$('#substitute-help').textContent='برای مشاهده جانشین‌های مجاز، تاریخ شروع را تعیین کنید.';return;}
    const from=startInput.value,to=endInput.value||from;$('#substitute-help').textContent='در حال بررسی ظرفیت جانشین‌ها…';
    try{const {items}=await request('/api/substitutes?'+new URLSearchParams({from,to}));if(index!==subLoad)return;
      for(const person of items){const opt=document.createElement('option');opt.value=person.id;opt.textContent=person.name+(person.available?'':' (در این بازه در دسترس نیست)');opt.disabled=!person.available;subInput.append(opt);}
      $('#substitute-help').textContent=items.length?'در مناطق دارای الزام جانشین، انتخاب جانشین در مرخصی استحقاقی روزانه اجباری است.':'هنوز جانشین واجد شرایطی تعریف نشده است. مدیر شرکت می‌تواند از تنظیمات، جانشین معرفی کند.';
    }catch(err){if(index===subLoad)$('#substitute-help').textContent=err.message;}}
  unitInput.onchange=()=>{const daily=unitInput.value==='daily';endInput.disabled=!daily;if(!daily)endInput.value='';minutesInput.value=daily?'480':'120';minutesInput.closest('label').firstChild.textContent=daily?'مدت هر روز به دقیقه':'مدت به دقیقه';refreshSubstitutes();};
  typeInput.onchange=refreshSubstitutes;startInput.onchange=refreshSubstitutes;endInput.onchange=refreshSubstitutes;
  unitInput.onchange();
  $('#request-form').onsubmit=guard(async e=>{const b=formData(e.target);b.minutes=Number(b.minutes);if(b.substitute_user_id)b.substitute_user_id=Number(b.substitute_user_id);else delete b.substitute_user_id;await request('/api/requests','POST',b);toast('درخواست ثبت شد');navigate('requests');});
  document.querySelectorAll('.table tbody tr').forEach((row,i)=>{if(r.items[i]?.substitute_name){const detail=document.createElement('small');detail.className='muted';detail.textContent=' · جانشین: '+r.items[i].substitute_name;row.cells[1]?.append(detail);}});
  document.querySelectorAll('button.decision').forEach(button=>button.onclick=guard(async()=>{await request('/api/requests/'+button.dataset.id+'/decision','POST',{status:button.dataset.status});toast('وضعیت درخواست ثبت شد');navigate('requests');}));
}

const workFields={worked:'حضور واقعی',in_shift:'در شیفت',expected:'موظفی',late_in:'تأخیر ورود',early_out:'تعجیل خروج',leave:'مرخصی با حقوق',unpaid_leave:'مرخصی بدون حقوق',mission:'مأموریت',shortage:'کسری',absence:'غیبت کامل',absence_and_shortage:'جمع غیبت و کسری (بدون تکرار)',overtime:'اضافه‌کاری',night:'شب‌کاری',surplus:'مازاد حضور',friday_work:'جمعه‌کاری',holiday_work:'تعطیل‌کاری',regular_extra:'مازاد روز عادی',gps_off_minutes:'GPS خاموش (گزارش دستگاه، غیرمالی)',internet_off_minutes:'اینترنت خاموش (گزارش دستگاه، غیرمالی)'};
const minutes=n=>`${fa(Math.floor(n/60))}:${fa(n%60).padStart(2,'۰')}`;
async function workReport(){const now=new Date(),today=now.toISOString().slice(0,10),start=today.slice(0,8)+'01',isAdmin=state.user.role!=='employee';let people=[];
  if(isAdmin)people=(await request('/api/users')).items;
  setContent(`<form id="report-form" class="card stack"><h3>گزارش کارکرد</h3><div class="form-grid">${field('از تاریخ (میلادی)','from','date')}${field('تا تاریخ (میلادی)','to','date')}${isAdmin?`<label>کارمند<select name="user_id">${people.map(p=>`<option value="${p.id}" ${p.id===state.user.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>`:''}</div><button class="primary">محاسبه گزارش</button></form><div id="report-results" style="margin-top:18px"></div>`);
  $('#report-form [name=from]').value=start;$('#report-form [name=to]').value=today;
  $('#report-form').onsubmit=guard(async e=>{const b=formData(e.target),params=new URLSearchParams(b),report=await request('/api/work-report?'+params);
    const columns=['worked','in_shift','expected','late_in','early_out','shortage','overtime','night','leave','unpaid_leave','mission','friday_work','holiday_work','gps_off_minutes','internet_off_minutes'];
    $('#report-results').innerHTML=`<div class="note">${esc(report.note)}<div class="muted">آخرین دریافت تقویم: ${report.official_calendar_status.map(x=>`${fa(x.year)} · ${date(x.fetched_at)}${x.stale?' (ذخیره قدیمی)':''}`).join(' | ')}</div></div><div class="section-head"><h2>جمع دوره</h2><button class="ghost" id="export-csv">دریافت فایل قابل بازکردن در Excel (CSV)</button></div><div class="grid">${Object.entries(workFields).map(([key,title])=>card(`<span class="stat-label">${title}</span><div class="stat-value" style="font-size:23px">${minutes(report.totals[key])}</div>`)).join('')}</div><div class="section-head"><h2>جزئیات روزانه</h2></div>${card(`<div class="table-wrap"><table class="table"><thead><tr><th>تاریخ شمسی</th><th>وضعیت روز</th>${columns.map(k=>`<th>${workFields[k]}</th>`).join('')}</tr></thead><tbody>${report.days.map(d=>`<tr><td>${esc(d.jalali||d.day)}</td><td>${d.is_official_holiday?'<span class="badge">تعطیل رسمی</span>':d.is_manual_holiday?'<span class="badge">تعطیل شرکت</span>':d.friday_work?'<span class="badge">جمعه</span>':'عادی'}${d.holiday_title?`<small class="muted" style="display:block">${esc(d.holiday_title)}</small>`:''}</td>${columns.map(k=>`<td>${minutes(d[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)}`;
    $('#export-csv').onclick=()=>{const keys=Object.keys(workFields),lines=[['تاریخ',...Object.values(workFields)].join(',')];for(const row of report.days)lines.push([row.day,...keys.map(key=>row[key])].join(','));
      const blob=new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`hozoryar-work-${report.from}-${report.to}.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    if(isAdmin){const history=await request('/api/attendance?user_id='+Number(b.user_id));
      const sessions=history.items.filter(s=>s.checked_out_at);
      const localValue=iso=>{const d=new Date(iso),offset=d.getTimezoneOffset();return new Date(d.getTime()-offset*60000).toISOString().slice(0,16);};
      $('#report-results').insertAdjacentHTML('beforeend',`<div class="section-head"><h2>اصلاح تردد با ممیزی</h2></div><div class="note">فقط ترددهای خروج‌خورده قابل اصلاح‌اند. ساعت‌ها با منطقه زمانی دستگاه شما نمایش داده می‌شوند. اصلاح تردد ماه بایگانی‌شده ممنوع است.</div><form id="attendance-correction" class="card stack"><div class="form-grid"><label>انتخاب تردد<select name="id" required>${sessions.map(s=>`<option value="${s.id}">${esc(date(s.checked_in_at))} ← ${esc(date(s.checked_out_at))}</option>`).join('')}</select></label><label>ورود جدید<input name="checked_in_at" type="datetime-local" required></label><label>خروج جدید<input name="checked_out_at" type="datetime-local" required></label><label>دلیل مستند اصلاح<input name="reason" minlength="8" maxlength="500" required></label></div><div class="action-row"><button class="primary" ${sessions.length?'':'disabled'}>ثبت اصلاح و تاریخچه</button><button type="button" class="ghost" id="correction-history" ${sessions.length?'':'disabled'}>مشاهده تاریخچه اصلاحات</button></div><div id="correction-history-result" aria-live="polite"></div></form>`);
      const edit=$('#attendance-correction'),select=edit.elements.id;
      const sync=()=>{const item=sessions.find(s=>s.id===Number(select.value));if(item){edit.elements.checked_in_at.value=localValue(item.checked_in_at);edit.elements.checked_out_at.value=localValue(item.checked_out_at);}$('#correction-history-result').textContent='';};
      select.onchange=sync;sync();
      edit.onsubmit=guard(async event=>{const values=formData(event.target);
        if(!confirm('اصلاح تردد با ثبت نام و زمان اصلاح‌کننده انجام می‌شود. ادامه می‌دهید؟'))return;
        await request('/api/attendance/'+Number(values.id)+'/correct','POST',{checked_in_at:new Date(values.checked_in_at).toISOString(),checked_out_at:new Date(values.checked_out_at).toISOString(),reason:values.reason});
        toast('اصلاح و سابقه آن ثبت شد');$('#report-form').dispatchEvent(new Event('submit',{cancelable:true}));});
      $('#correction-history').onclick=guard(async()=>{const result=await request('/api/attendance/'+Number(select.value)+'/corrections');
        $('#correction-history-result').innerHTML=result.items.map(h=>`<div class="note"><b>${esc(h.actor_name)}</b> · ${date(h.created_at)}<div>${esc(h.reason)}</div><small>قبل: ${date(h.old_in)} تا ${date(h.old_out)} / بعد: ${date(h.new_in)} تا ${date(h.new_out)}</small></div>`).join('')||'<p class="muted">سابقه اصلاحی وجود ندارد.</p>';});
    }
  });
  if(isAdmin){
    const archived=(await request('/api/work-months')).items;
    const canArchive=state.user.role==='owner';
    $('#content').insertAdjacentHTML('beforeend',`<section class="card stack" style="margin-top:20px"><h3>بایگانی ماهانه کارکرد</h3><div class="note">بایگانی ماه شمسی یا میلادی پس از پایان دوره انجام می‌شود و قابل جایگزینی نیست. این سند تأیید مالی نیست؛ تقویم رسمی هنوز اعتبارسنجی نشده است.</div>${canArchive?`<form id="archive-form" class="form-grid"><label>نوع دوره<select name="calendar"><option value="jalali">شمسی</option><option value="gregorian">میلادی</option></select></label>${field('ماه (مثلاً 1405-07)','month','text','pattern="[0-9]{4}-(0[1-9]|1[0-2])" inputmode="numeric"')}<button class="primary" type="submit">ثبت بایگانی تغییرناپذیر</button></form>`:''}<label>ماه‌های بایگانی‌شده<select id="archive-select"><option value="">انتخاب ماه</option>${archived.map(x=>`<option value="${esc(x.month)}">${esc(x.month.startsWith('j-')?'شمسی ':'میلادی ')}${esc(x.month.replace('j-',''))} — ${esc(x.created_at)}</option>`).join('')}</select></label><div id="archive-result" aria-live="polite"></div></section>`);
    if(canArchive){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US-u-ca-persian',{calendar:'persian',timeZone:'Asia/Tehran',year:'numeric',month:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));let y=Number(parts.year),m=Number(parts.month)-1;if(!m){m=12;y--;}
      $('#archive-form [name=month]').value=`${y}-${String(m).padStart(2,'0')}`;
      $('#archive-form [name=calendar]').onchange=e=>{$('#archive-form [name=month]').value=e.target.value==='gregorian'?new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)).toISOString().slice(0,7):`${y}-${String(m).padStart(2,'0')}`;};
      $('#archive-form').onsubmit=guard(async e=>{const form=formData(e.target),month=(form.calendar==='jalali'?'j-':'')+form.month;if(!confirm(`بایگانی ماه ${month} پس از ثبت قابل بازنویسی نیست. ادامه می‌دهید؟`))return;await request('/api/work-months/finalize','POST',{month});toast('بایگانی ماهانه ثبت شد');await workReport();});}
    $('#archive-select').onchange=guard(async e=>{const month=e.target.value;if(!month){$('#archive-result').innerHTML='';return;}const archived=await request('/api/work-months/'+month);
      const statusNames={pending_review:'در انتظار بررسی',reviewed:'بررسی‌شده',approved:'تأیید مدیریتی'};
      const next=archived.review_status==='pending_review'?'review':archived.review_status==='reviewed'&&state.user.role==='owner'?'approve':null;
      $('#archive-result').innerHTML=`<div class="note">بایگانی ثابت ${esc(archived.month)} — ${esc(archived.note)}<div><b>وضعیت: ${statusNames[archived.review_status]||'ثبت‌شده'}</b></div></div><div class="action-row" style="margin:12px 0"><button class="ghost" id="archive-xlsx">دریافت Excel واقعی (.xlsx)</button>${next?`<button class="primary" id="archive-review">${next==='review'?'ثبت بررسی اولیه':'تأیید مدیریتی گزارش ثابت'}</button>`:''}</div><div class="table-wrap"><table class="table"><thead><tr><th>کارمند</th><th>حضور</th><th>موظفی</th><th>کسری</th><th>غیبت</th><th>اضافه‌کاری</th><th>جمعه‌کاری</th></tr></thead><tbody>${archived.reports.map(x=>`<tr><td>${esc(x.name)}</td><td>${minutes(x.report.totals.worked)}</td><td>${minutes(x.report.totals.expected)}</td><td>${minutes(x.report.totals.shortage)}</td><td>${minutes(x.report.totals.absence||0)}</td><td>${minutes(x.report.totals.overtime)}</td><td>${minutes(x.report.totals.friday_work)}</td></tr>`).join('')}</tbody></table></div>`;
      $('#archive-xlsx').onclick=guard(async()=>{const response=await fetch('/api/work-months/'+month+'/xlsx',{headers:{Authorization:'Bearer '+state.token}});if(!response.ok)throw new Error('دریافت فایل Excel ناموفق بود');const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`hozoryar-${month}.xlsx`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
      if(next)$('#archive-review').onclick=guard(async()=>{if(!confirm('این تأیید مدیریتی است و به معنی تأیید حقوق قطعی نیست. ادامه می‌دهید؟'))return;await request('/api/work-months/'+month+'/'+next,'POST');toast('مرحله بررسی ثبت شد');$('#archive-select').dispatchEvent(new Event('change'));});
      if(archived.review_status==='approved'){
        const preview=await request('/api/work-months/'+month+'/payroll-preview');
        $('#archive-result').insertAdjacentHTML('beforeend',`<div class="section-head"><h3>تطبیق کارکرد برای تأیید مالی</h3></div><div class="note">مبنای قابل پرداخت (دقیقه): اضافه‌کاری کل + مأموریت − کسری، با امکان افزودن مازاد حضور. این برآورد مبلغ ریالی حقوق، بیمه یا مالیات نیست.</div>${archived.finance_confirmed_at?`<div class="note" role="status"><b>تأیید مالی ثبت شده است</b> · ${date(archived.finance_confirmed_at)} · صحت اثر انگشت بایگانی: ${archived.finance_integrity_ok?'تأیید شد':'مغایرت، نیازمند بررسی'}<div class="muted">SHA-256: ${esc(archived.finance_digest)}</div></div>`:`<label><input type="checkbox" id="payroll-surplus" style="width:auto;min-height:auto"> لحاظ‌کردن مازاد حضور در مبنای قابل پرداخت</label>`}<div class="table-wrap"><table class="table"><thead><tr><th>کارمند</th><th>اضافه‌کاری کل</th><th>مأموریت</th><th>کسری</th><th>مبنای قابل پرداخت</th></tr></thead><tbody id="payroll-lines"></tbody></table></div>${state.user.role==='owner'&&!archived.finance_confirmed_at?`<form id="finance-form" class="stack"><label>توضیحات و مستند تأیید مالی<textarea name="note" required maxlength="500" rows="2" placeholder="شماره سند بررسی مالی و توضیحات"></textarea></label><label><input name="confirm" type="checkbox" required style="width:auto;min-height:auto"> ارقام کارکرد را بررسی کرده‌ام و تأیید نهایی این مبنا را می‌پذیرم.</label><button class="primary">ثبت تأیید مالی غیرقابل‌تکرار</button></form>`:''}`);
        const draw=items=>{$('#payroll-lines').innerHTML=items.map(p=>`<tr><td>${esc(p.name)}</td><td>${minutes(p.overtime_minutes)}</td><td>${minutes(p.mission_minutes)}</td><td>${minutes(p.shortage_minutes)}</td><td><b>${minutes(p.payable_minutes)}</b></td></tr>`).join('');};
        draw(archived.finance_record?.items||preview.items);
        if(!archived.finance_confirmed_at){$('#payroll-surplus').onchange=guard(async e=>draw((await request('/api/work-months/'+month+'/payroll-preview?include_surplus='+(e.target.checked?'1':'0'))).items));}
        if($('#finance-form'))$('#finance-form').onsubmit=guard(async e=>{const form=e.target;if(!form.elements.confirm.checked)return;
          if(!confirm('این تأیید مالی مبنای کارکرد ثابت است و پس از ثبت قابل تغییر نیست. ادامه می‌دهید؟'))return;
          await request('/api/work-months/'+month+'/finance-confirm','POST',{include_surplus:$('#payroll-surplus').checked,confirm:true,note:form.elements.note.value.trim()});
          toast('تأیید مالی و اثر انگشت گزارش ثبت شد');$('#archive-select').dispatchEvent(new Event('change'));});
      }
    });
  }
  if(state.view==='archives'){$('#report-form').classList.add('hidden');$('#report-results').classList.add('hidden');}
}

function tileMap(el,items,provider,z=12){
  const lat=items.length?items[0].lat:36.2972,lng=items.length?items[0].lng:59.6067,size=256;
  const tx=(lng+180)/360*2**z,ty=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z;
  el.style.position='relative';el.style.direction='ltr';el.style.overflow='hidden';
  const centerX=el.clientWidth/2,centerY=el.clientHeight/2;
  for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++){
    const x=Math.floor(tx)+dx,y=Math.floor(ty)+dy;
    if(x<0||y<0||x>=2**z||y>=2**z)continue;
    const image=document.createElement('img');image.alt='';image.loading='lazy';image.style.cssText=`position:absolute;width:${size}px;height:${size}px;left:${centerX+(x-tx)*size}px;top:${centerY+(y-ty)*size}px`;
    image.src=provider==='neshan'?`/api/neshan-tiles/${z}/${x}/${y}`:`https://tile.openstreetmap.org/${z}/${x}/${y}.png`;el.append(image);
  }
  for(const item of items){const px=(item.lng+180)/360*2**z,py=(1-Math.asinh(Math.tan(item.lat*Math.PI/180))/Math.PI)/2*2**z;
    const p=document.createElement('button');p.textContent=item.name;p.title=item.name+' · '+date(item.recorded_at);p.style.cssText=`position:absolute;left:${centerX+(px-tx)*size}px;top:${centerY+(py-ty)*size}px;transform:translate(-50%,-100%);background:#6d28d9;color:white;border:3px solid white;border-radius:30px;padding:6px 10px;white-space:nowrap;box-shadow:0 4px 12px #3335;z-index:2`;el.append(p);
  }
  const attribution=document.createElement('span');attribution.textContent=provider==='neshan'?'© نشان':'© OpenStreetMap contributors';attribution.style.cssText='position:absolute;bottom:4px;right:8px;background:#fffc;padding:2px 5px;font-size:11px;z-index:3';el.append(attribution);
}
async function liveMap(){const [r,config]=await Promise.all([request('/api/live-map'),request('/api/neshan-tiles/config')]);const provider=r.provider==='neshan'&&config.enabled?'neshan':'osm';setContent(`<div class="section-head"><h2>آخرین موقعیت کارکنان حاضر</h2><button class="ghost" id="map-refresh">به‌روزرسانی</button></div><div class="note">موقعیت‌ها تنها هنگام حضور فعال و با ارسال اطلاعات توسط دستگاه ثبت می‌شوند. نقاط قدیمی‌تر از یک ساعت نمایش داده نمی‌شوند. ارائه‌دهنده نقشه: ${provider==='neshan'?'نشان':'OpenStreetMap'}.</div><div class="card" style="margin-top:16px"><div class="map" id="map-surface" role="img" aria-label="نقشه موقعیت کارکنان حاضر"></div></div><div class="section-head"><h2>نیروهای روی نقشه (${fa(r.items.length)})</h2></div>${card(r.items.map(p=>`<p><b>${esc(p.name)}</b> <span class="muted">${date(p.recorded_at)}</span></p>`).join('')||'<p>هنوز موقعیت معتبری از نیروهای حاضر ثبت نشده است.</p>')}`);tileMap($('#map-surface'),r.items,provider);$('#map-refresh').onclick=()=>navigate('map');}
async function monitor(){await admin.render('tracking');}
async function settings(){const s=await request('/api/settings');setContent(`<div class="section-head"><h2>تنظیمات مستقل شرکت</h2></div><form id="settings-form" class="card stack"><div class="form-grid"><label>ارائه‌دهنده نقشه<select name="map_provider"><option value="osm" ${s.map_provider==='osm'?'selected':''}>OpenStreetMap</option><option value="neshan" ${s.map_provider==='neshan'?'selected':''}>نشان</option></select></label><label>سرویس پیامک<select name="sms_provider"><option value="disabled">غیرفعال</option><option value="kavenegar" ${s.sms_provider==='kavenegar'?'selected':''}>کاوه‌نگار</option></select></label>${field('کلید API نقشه نشان (اختیاری)','neshan_api_key','password','autocomplete="off"')}${field('کلید API پیامک (اختیاری)','sms_api_key','password','autocomplete="off"')}${field('عرض جغرافیایی محل کار','geofence_lat','number','step="any"')}${field('طول جغرافیایی محل کار','geofence_lng','number','step="any"')}${field('شعاع مجاز (متر)','geofence_radius_m','number','min="50" max="50000"')}</div><p class="muted">کلیدهای ذخیره‌شده به مرورگر بازگردانده نمی‌شوند. برای حفظ کلید فعلی، فیلد آن را خالی بگذارید.</p><label><input name="require_location" type="checkbox" style="width:auto;min-height:auto" ${s.require_location?'checked':''}> ثبت ورود با موقعیت مکانی اجباری باشد</label><h3>امکانات فعال شرکت</h3><div class="form-grid">${Object.entries({attendance:'حضور و غیاب',shifts:'شیفت‌ها',liveMap:'نقشه زنده',monitoring:'نظارت',sms:'سامانه پیامک'}).map(([k,v])=>`<label><input type="checkbox" style="width:auto;min-height:auto" name="feature_${k}" ${s.features[k]?'checked':''}> ${v}</label>`).join('')}</div><button class="primary">ذخیره تنظیمات</button></form><div class="section-head"><h2>آزمون ارسال پیامک</h2></div>${form('ارسال پیامک آزمایشی',field('شماره موبایل','mobile','tel','pattern="09[0-9]{9}"')+field('متن پیامک','message'),'sms-form')}`);
  $('#settings-form .form-grid').insertAdjacentHTML('beforeend',`<label>گردش تأیید درخواست<select name="approval_steps"><option value="1" ${s.approval_steps===1?'selected':''}>یک‌مرحله‌ای</option><option value="2" ${s.approval_steps===2?'selected':''}>دو‌مرحله‌ای (مدیر سپس مدیر شرکت)</option></select></label>`);
  $('#settings-form .form-grid').insertAdjacentHTML('beforeend',`<label>سهمیه سالانه مرخصی استحقاقی هر نفر (دقیقه)<input name="annual_leave_minutes" type="number" min="0" max="525600" value="${s.annual_leave_minutes}" required></label>`);
  $('#settings-form [name=require_location]').closest('label').insertAdjacentHTML('afterend',`<label><input name="enforce_shift_window" type="checkbox" style="width:auto;min-height:auto" ${s.enforce_shift_window?'checked':''}> فقط در بازه مجاز شیفت امکان ثبت ورود و خروج باشد</label><p class="muted">برای شیفت‌های ساعت‌دار، بازه پیش‌فرض یک ساعت قبل و یک ساعت بعد از شروع/پایان است. پیش از فعال‌سازی، برای همه پرسنل شیفت معتبر تخصیص دهید.</p>`);
  $('#settings-form [name=neshan_api_key]').required=false;$('#settings-form [name=sms_api_key]').required=false;
  for(const k of ['geofence_lat','geofence_lng']){$(`#settings-form [name=${k}]`).required=false;$(`#settings-form [name=${k}]`).value=s[k]??'';}$('#settings-form [name=geofence_radius_m]').value=s.geofence_radius_m;
  $('#settings-form').onsubmit=guard(async e=>{const f=e.target,b=formData(f),payload={map_provider:b.map_provider,sms_provider:b.sms_provider,approval_steps:Number(b.approval_steps),annual_leave_minutes:Number(b.annual_leave_minutes),require_location:f.elements.require_location.checked,enforce_shift_window:f.elements.enforce_shift_window.checked,geofence_lat:b.geofence_lat===''?null:Number(b.geofence_lat),geofence_lng:b.geofence_lng===''?null:Number(b.geofence_lng),geofence_radius_m:Number(b.geofence_radius_m),features:{}};
    for(const key of ['attendance','shifts','liveMap','monitoring','sms'])payload.features[key]=!!f.elements['feature_'+key].checked;
    if(b.neshan_api_key)payload.neshan_api_key=b.neshan_api_key;if(b.sms_api_key)payload.sms_api_key=b.sms_api_key;
    await request('/api/settings','PATCH',payload);toast('تنظیمات ذخیره شد');await authenticate();});
  $('#sms-form').onsubmit=guard(async e=>{await request('/api/sms/send','POST',formData(e.target));toast('ارسال پیامک تأیید شد');});
  const holidays=await request('/api/holidays');
  $('#content').insertAdjacentHTML('beforeend',`<div class="section-head"><h2>تعطیلات اختصاصی شرکت</h2></div><div class="note">تعطیلات رسمی از سرویس مستقل تقویم ایران به‌صورت برخط دریافت و روی سرور ذخیره می‌شوند؛ هنگام قطعی از نسخه ذخیره‌شده استفاده می‌شود. تعطیلات دستی این بخش فقط برای شرکت شما هستند.</div><form id="holiday-form" class="card stack" style="margin-top:16px"><div class="form-grid">${field('تاریخ (میلادی)','work_date','date')}${field('عنوان تعطیلی','title')}</div><button class="primary">ذخیره تعطیلی</button></form>${card(`<h3>تعطیلات ثبت‌شده</h3><div class="table-wrap"><table class="table"><thead><tr><th>تاریخ</th><th>عنوان</th></tr></thead><tbody>${holidays.items.map(h=>`<tr><td>${esc(h.work_date)}</td><td>${esc(h.title)}</td></tr>`).join('')||'<tr><td colspan="2">تعطیلی اختصاصی ثبت نشده است.</td></tr>'}</tbody></table></div>`)}`);
  $('#holiday-form').onsubmit=guard(async e=>{await request('/api/holidays','POST',formData(e.target));toast('تعطیلی ذخیره شد');await settings();});

}

function workplaceNew(){
  setContent(`<div class="workplace-new">
    <nav class="workplace-path" aria-label="مسیر صفحه"><button type="button" class="ghost" id="zone-back">محل کار</button><span aria-hidden="true"> / </span><span>ثبت محل کار جدید</span></nav>
    <form id="zone-create" class="card workplace-form">
      <div class="workplace-fields workplace-address">
        <label>نام محل کار<input name="name" placeholder="نام محل کار را وارد کنید" maxlength="100" required></label>
        <label>شهر<input name="city" placeholder="شهر را وارد کنید" maxlength="100"></label>
        <label>آدرس<input name="address" placeholder="آدرس را وارد کنید" maxlength="500"></label>
      </div>
      <section class="workplace-location" aria-labelledby="zone-location-title">
        <h3 id="zone-location-title">موقعیت مکانی</h3>
        <div class="workplace-fields">
          <label>شکل هندسی محل کار<select name="geometry"><option value="circle">دایره</option></select></label>
          <label>شعاع (متر)<input name="radius_m" type="number" min="50" max="50000" value="100" required></label>
        </div>
        <div class="workplace-map-frame">
          <div class="map" id="zone-map" aria-label="نقشه انتخاب محل کار"></div>
          <div class="workplace-map-controls"><button type="button" id="zone-zoom-in" aria-label="بزرگ‌نمایی">+</button><button type="button" id="zone-zoom-out" aria-label="کوچک‌نمایی">−</button></div>
        <div class="workplace-coordinates">
          <label>عرض جغرافیایی<input name="lat" type="number" step="any" min="-85" max="85" value="35.6892" required></label>
          <label>طول جغرافیایی<input name="lng" type="number" step="any" min="-180" max="180" value="51.389" required></label>
          <button type="button" class="primary" id="zone-find">جستجو</button>
        </div></div>
      </section>
      <section class="workplace-location" aria-labelledby="zone-wifi-title">
        <h3 id="zone-wifi-title">WiFi (BSSID) <span class="badge">اختیاری</span></h3>
        <p class="note">با افزودن شناسهٔ مودم، ثبت ورود در اپ اندروید به حضور در محدودهٔ سیگنال وای‌فای نیاز دارد. اتصال به شبکه لازم نیست.</p>
        <div id="zone-wifi-list" class="stack"></div>
        <div class="action-row"><button type="button" class="ghost" id="zone-wifi-add">افزودن WiFi</button></div>
      </section>
      <p class="error" id="zone-error" role="alert"></p>
      <div class="action-row"><button type="submit" class="primary">ثبت</button></div>
    </form>
  </div>`);
  $('#zone-back').onclick=()=>navigate('workplaces');
  const form=$('#zone-create'),map=$('#zone-map');
  const wifiList=$('#zone-wifi-list'),wifiAdd=$('#zone-wifi-add');
  wifiAdd.onclick=()=>{
    if(wifiList.children.length>=20)return;
    const row=document.createElement('div');
    row.className='action-row';
    row.innerHTML='<label>شناسه وای‌فای<input name="wifi_bssid" dir="ltr" placeholder="00:11:22:33:44:55" maxlength="17" pattern="(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}" required></label><button type="button" class="ghost" aria-label="حذف شناسه وای‌فای">حذف</button>';
    wifiList.append(row);
    row.querySelector('input').focus();
    wifiAdd.disabled=wifiList.children.length>=20;
    row.querySelector('button').onclick=()=>{
      row.remove();
      wifiAdd.disabled=false;
      wifiAdd.focus();
    };
  };
  let lat=35.6892,lng=51.389,zoom=12;
  const render=()=>{
    map.replaceChildren();
    tileMap(map,[{lat,lng,name:'مرکز نقشه'}],'osm',zoom);
    const radius=form.elements.radius_m;
    if(!radius.value||!radius.validity.valid)return;
    const metersPerPixel=40075016.686*Math.cos(lat*Math.PI/180)/(256*2**zoom);
    const boundary=document.createElement('span');
    boundary.className='workplace-boundary';
    boundary.setAttribute('aria-hidden','true');
    boundary.style.width=boundary.style.height=2*Number(radius.value)/metersPerPixel+'px';
    map.prepend(boundary);
  };
  form.elements.radius_m.addEventListener('input',render);
  function select(latValue,lngValue){
    lat=Math.max(-85,Math.min(85,latValue));
    lng=((lngValue+540)%360)-180;
    form.elements.lat.value=lat.toFixed(7);
    form.elements.lng.value=lng.toFixed(7);
    render();
  }
  map.onclick=event=>{
    const bounds=map.getBoundingClientRect(),scale=256*2**zoom;
    const x=(lng+180)/360+(event.clientX-bounds.left-bounds.width/2)/scale;
    const y=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2+(event.clientY-bounds.top-bounds.height/2)/scale;
    select(Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI,x*360-180);
  };
  $('#zone-zoom-in').onclick=()=>{zoom=Math.min(18,zoom+1);render();};
  $('#zone-zoom-out').onclick=()=>{zoom=Math.max(3,zoom-1);render();};
  $('#zone-find').onclick=()=>{
    if(form.elements.lat.reportValidity()&&form.elements.lng.reportValidity()){
      select(Number(form.elements.lat.value),Number(form.elements.lng.value));
    }
  };
  render();
  $('#zone-create').onsubmit=async e=>{
    e.preventDefault();
    const b=formData(e.target),button=e.target.querySelector('button[type="submit"]');
    const wifi_bssids=new FormData(e.target).getAll('wifi_bssid');
    button.disabled=true;$('#zone-error').textContent='';
    try{
      await request('/api/zones','POST',{name:b.name,city:b.city,address:b.address,requires_substitute:b.requires_substitute==='1',lat:b.lat===''?null:Number(b.lat),lng:b.lng===''?null:Number(b.lng),radius_m:Number(b.radius_m),wifi_bssids});
      if(!e.target.isConnected)return;toast('محل کار ثبت شد');await navigate('workplaces');
    }catch(error){const message=$('#zone-error');if(message)message.textContent=error.message;}
    finally{button.disabled=false;}
  };
}
async function zoneManagement(){
  const [{items:zones},{items:people}]=await Promise.all([request('/api/zones'),request('/api/users')]);
  $('#content').insertAdjacentHTML('beforeend',`<div class="section-head"><h2>محل‌های کار و جانشینی مرخصی</h2><span class="badge">${fa(zones.length)} منطقه</span></div>
    <div class="note">این تنظیمات مستقل از شرکت‌های دیگرند. الزام جانشین تنها برای مرخصی استحقاقی روزانه کارکنان هر منطقه فعال می‌شود. جانشین در بازه مرخصی، شیفت نیروی غایب را پوشش می‌دهد.</div>
    <div class="action-row"><button class="primary" id="zone-open">ثبت محل کار جدید</button></div>
    ${card(`<h3>سیاست مناطق</h3><div class="table-wrap"><table class="table"><thead><tr><th>نام منطقه</th><th>جانشین مرخصی</th><th>تغییر سیاست</th></tr></thead><tbody>${zones.map(z=>`<tr><td>${esc(z.name)}<div class="muted">${esc([z.city,z.address].filter(Boolean).join("، "))}</div></td><td>${z.requires_substitute?'الزامی':'اختیاری'}</td><td><button class="ghost zone-toggle" type="button" data-id="${z.id}" data-next="${z.requires_substitute?0:1}">${z.requires_substitute?'لغو الزام':'فعال‌کردن الزام'}</button></td></tr>`).join('')||'<tr><td colspan="3">هنوز منطقه‌ای تعریف نشده است.</td></tr>'}</tbody></table></div>`)}
    <form id="staff-zone" class="card stack"><h3>منطقه و مجوز جانشینی کارکنان</h3><div class="form-grid"><label>کارمند<select name="user_id">${people.filter(p=>p.active).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><label>منطقه کاری<select name="zone_id"><option value="">بدون منطقه</option>${zones.map(z=>`<option value="${z.id}">${esc(z.name)}</option>`).join('')}</select></label></div><label><input name="can_be_substitute" type="checkbox" style="width:auto;min-height:auto"> این کارمند مجاز به جانشینی دیگران است</label><button class="primary">ذخیره تخصیص کارمند</button></form>`);
  $('#zone-open').onclick=()=>navigate('workplace-new');
  document.querySelectorAll('.zone-toggle').forEach(button=>button.onclick=guard(async()=>{button.disabled=true;await request('/api/zones/'+button.dataset.id,'PATCH',{requires_substitute:button.dataset.next==='1'});toast('سیاست منطقه ذخیره شد');await navigate('workplaces');}));
  const staffForm=$('#staff-zone');
  function selectStaff(){const selected=people.find(p=>String(p.id)===staffForm.elements.user_id.value);staffForm.elements.zone_id.value=selected?.zone_id??'';staffForm.elements.can_be_substitute.checked=!!selected?.can_be_substitute;}
  staffForm.elements.user_id.onchange=selectStaff;selectStaff();
  staffForm.onsubmit=guard(async e=>{const b=formData(e.target);await request('/api/users/'+b.user_id+'/zone','PATCH',{zone_id:b.zone_id===''?null:Number(b.zone_id),can_be_substitute:staffForm.elements.can_be_substitute.checked});toast('منطقه و مجوز جانشینی ذخیره شد');await navigate('workplaces');});
}

async function platformCompanies(){
  const {items}=await request('/api/platform/companies');
  setContent(`<div class="section-head"><h2>تنظیمات اشتراک شرکت‌ها</h2><span class="badge">${fa(items.length)} شرکت</span></div><div class="note">تاریخ پایان اشتراک شامل همان روز است و بر اساس منطقه زمانی تهران کنترل می‌شود. پس از انقضا اطلاعات قبلی خواندنی می‌مانند اما ثبت و تغییر اطلاعات غیرفعال می‌شود. سقف پرسنل، تمام حساب‌های فعال از جمله مدیر شرکت را شامل می‌شود.</div><div class="stack" style="margin-top:18px">${items.map(c=>`<form class="card stack company-plan" data-id="${c.id}"><div class="section-head" style="margin:0"><h3>${esc(c.name)}</h3><span class="badge">${esc(c.slug)}</span></div><div class="muted">${fa(c.personnel_count)} حساب فعال ${c.max_personnel!==null?`از ${fa(c.max_personnel)}`:''}</div><div class="form-grid"><label>پایان اشتراک (میلادی)<input type="date" name="subscription_end" value="${esc(c.subscription_end||'')}"><small class="muted">خالی = بدون تاریخ پایان</small></label><label>سقف حساب‌های فعال<input type="number" name="max_personnel" min="1" max="1000000" value="${esc(c.max_personnel??'')}" placeholder="نامحدود"><small class="muted">خالی = نامحدود</small></label></div><button class="primary">ذخیره تنظیمات شرکت</button></form>`).join('')||'<p class="muted">شرکتی ثبت نشده است.</p>'}</div>`);
  document.querySelectorAll('.company-plan').forEach(form=>form.onsubmit=guard(async e=>{
    const values=formData(e.target),payload={subscription_end:values.subscription_end||null,max_personnel:values.max_personnel===''?null:Number(values.max_personnel)};
    await request('/api/platform/companies/'+form.dataset.id+'/subscription','PATCH',payload);
    toast('محدودیت اشتراک ذخیره شد');await platformCompanies();
  }));
}

$('#platform-login').onchange=e=>{const company=$('#login-form [name=company]');company.required=!e.target.checked;company.closest('label').classList.toggle('hidden',e.target.checked);};
$('#login-form').onsubmit=guard(async e=>{const b=formData(e.target);state.platform=!!b.platform;const res=await request(state.platform?'/api/platform/login':'/api/login','POST',state.platform?{username:b.username,password:b.password}:b);state.token=res.token;sessionStorage.setItem('hz_token',state.token);sessionStorage.setItem('hz_platform',state.platform?'1':'0');$('#login-error').textContent='';await authenticate();});
$('#nav').onclick=e=>{const b=e.target.closest('button[data-view]');if(b && !b.classList.contains('hidden'))navigate(b.dataset.view);};
$('#logout').onclick=guard(async()=>{await request(state.platform?'/api/platform/logout':'/api/logout','POST');loginScreen();});
window.addEventListener('hashchange',()=>{let view=location.hash.slice(1);if(view==='attendance')view=state.user?.role==='employee'?'mobile':'traffic';const button=document.querySelector(`#nav button[data-view="${CSS.escape(view)}"]`);if(state.user&&((view==='workplace-new'&&state.user.role==='owner'&&!state.platform)||(button&&!button.classList.contains('hidden'))))navigate(view);});
if(state.token)authenticate().catch(()=>loginScreen());
