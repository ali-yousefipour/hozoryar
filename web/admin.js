import {workplaceDevices} from './devices.js';

const persianFormatter=new Intl.DateTimeFormat('en-US-u-ca-persian',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'});
function partsDate(date){const p=Object.fromEntries(persianFormatter.formatToParts(date).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;}
export function gregorianDate(value,calendar='gregorian'){
  value=String(value).replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replaceAll('/','-');
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!m)throw new Error('تاریخ را به شکل سال-ماه-روز وارد کنید');
  if(calendar==='gregorian'){const d=new Date(value+'T12:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)throw new Error('تاریخ نامعتبر است');return value;}
  const year=Number(m[1]);if(year<1300||year>1499)throw new Error('سال شمسی باید بین ۱۳۰۰ تا ۱۴۹۹ باشد');
  let lo=Math.floor(Date.UTC(year+621,0,1)/86400000),hi=Math.floor(Date.UTC(year+622,11,31)/86400000);
  while(lo<=hi){const mid=Math.floor((lo+hi)/2),date=new Date(mid*86400000),key=partsDate(date);if(key===value)return date.toISOString().slice(0,10);if(key<value)lo=mid+1;else hi=mid-1;}
  throw new Error('تاریخ شمسی معتبر نیست');
}
export const adminTitles={reports:'مرکز گزارش‌ها','work-summary':'کارکرد',traffic:'تردد',incomplete:'تردد ناقص','leave-report':'مرخصی','leave-details':'جزییات مرخصی','mission-report':'گزارش مأموریت',tracking:'رهگیری',audit:'تاریخچه عملیات',workplaces:'محل‌های کار',archives:'بایگانی ماهانه',mobile:'اپلیکیشن اندروید'};

export function adminViews(ctx){
  const {$,state,request,esc,fa,date,minutes,card,setContent,formData,guard,toast,navigate,icon}=ctx;
  const types={annual_leave:'استحقاقی',sick_leave:'استعلاجی',unpaid_leave:'بدون حقوق',mission:'مأموریت'};
  const statuses={approved:'تأییدشده',pending:'در انتظار بررسی',rejected:'ردشده'};
  const descriptions={
    'work-summary':'جمع حضور، موظفی، کسری و اضافه‌کاری به تفکیک پرسنل',
    report:'جزئیات روزانه، اصلاح تردد و محاسبات شیفت',traffic:'سطر روزانه و جزئیات ورود و خروج با تاریخچه اصلاحات',
    incomplete:'ورودهای روزهای قبل که هنوز خروج ندارند','leave-report':'جمع مرخصی و مانده سال شمسی',
    'leave-details':'جزئیات درخواست‌های مرخصی با فیلتر نوع و وضعیت',
    'mission-report':'مأموریت‌های ساعتی و روزانه و وضعیت تأیید',tracking:'تاریخچه نقاط ثبت‌شده در حضور فعال؛ نگهداری ۳۰روزه',
    archives:'نسخه ثابت ماهانه، بررسی مدیریتی و خروجی Excel',audit:'عامل، زمان و نوع تغییرات مدیریتی'};
  function table(headers,rows){return `<div class="table-wrap"><table class="table report-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${headers.length}">اطلاعاتی در این بازه و فیلترها وجود ندارد.</td></tr>`}</tbody></table></div>`;}
  function row(cells){return `<tr>${cells.map(c=>`<td>${c}</td>`).join('')}</tr>`;}
  function day(value){return value?new Intl.DateTimeFormat('fa-IR',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z')):'—';}
  function download(filename,blob){
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function csv(filename,headers,rows){
    const safe=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
    const blob=new Blob(['\ufeff'+[headers,...rows].map(r=>r.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    download(filename+'.csv',blob);
  }
  function result(html,headers=[],rows=[],xlsxPath=''){
    const filename='hozoryar-'+state.view;
    $('#admin-result').innerHTML=`<div class="report-print-head"><b>حضوریار | ${esc(adminTitles[state.view])}</b><div>${esc(state.user.company_name)} · ${date(new Date().toISOString())}</div></div><div class="report-toolbar"><span class="muted">${fa(rows.length)} ردیف در خروجی</span><div class="action-row">${xlsxPath?'<button class="ghost" id="admin-xlsx">دریافت Excel</button>':''}<button class="ghost" id="admin-csv" ${headers.length?'':'disabled'}>دریافت CSV</button><button class="ghost" id="admin-print">چاپ / PDF</button></div></div>${html}`;
    $('#admin-csv').onclick=()=>csv(filename,headers,rows);$('#admin-print').onclick=()=>window.print();
    const xlsxButton=$('#admin-xlsx');
    if(xlsxButton)xlsxButton.onclick=guard(async()=>{
      xlsxButton.disabled=true;
      try{
        const response=await fetch(xlsxPath+'&format=xlsx',{headers:{Authorization:'Bearer '+state.token}});
        if(!response.ok){
          const body=await response.json().catch(()=>null);
          throw new Error(body?.error||'دریافت فایل Excel انجام نشد');
        }
        download(filename+'.xlsx',await response.blob());
      }finally{xlsxButton.disabled=false;}
    });
  }
  async function filterScreen(view,run){
    const [users,zones]=await Promise.all([request('/api/users'),request('/api/zones')]);
    if(state.view!==view)return;
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const now=partsDate(new Date(today+'T12:00:00Z'));
    setContent(`<form id="admin-filter" class="card stack report-filter"><h2>${esc(adminTitles[view])}</h2><div class="form-grid"><label>تقویم ورودی<select name="calendar"><option value="jalali">شمسی</option><option value="gregorian">میلادی</option></select></label><label>از تاریخ<input name="from" value="${now.slice(0,8)}01" placeholder="۱۴۰۵-۰۸-۰۱" required inputmode="numeric"><small class="field-hint">سال-ماه-روز؛ مانند ${now}</small></label><label>تا تاریخ<input name="to" value="${now}" required inputmode="numeric"></label><label>پرسنل<select name="user_id"><option value="">تمام پرسنل</option>${users.items.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><label>محل کار<select name="zone_id"><option value="">تمام محل‌ها</option>${zones.items.map(z=>`<option value="${z.id}">${esc(z.name)}</option>`).join('')}</select></label>${['leave-report','leave-details','mission-report'].includes(view)?`<label>وضعیت<select name="status"><option value="">همه وضعیت‌ها</option>${Object.entries(statuses).map(([k,t])=>`<option value="${k}">${t}</option>`).join('')}</select></label>${view!=='mission-report'?`<label>نوع درخواست<select name="type"><option value="">همه مرخصی‌ها</option>${Object.entries(types).filter(([k])=>k!=='mission').map(([k,t])=>`<option value="${k}">${t}</option>`).join('')}</select></label>`:''}`:''}</div><div class="action-row"><button class="primary" type="submit">مشاهده گزارش</button><span class="field-hint">حداکثر ۳۵ روز در هر گزارش</span></div><p id="admin-filter-error" class="error" role="alert"></p></form><section id="admin-result" aria-live="polite"></section>`);
    const form=$('#admin-filter'),errorElement=$('#admin-filter-error'),resultElement=$('#admin-result');const current=()=>form.isConnected&&state.view===view;
    form.elements.calendar.onchange=()=>{const j=form.elements.calendar.value==='jalali';for(const key of ['from','to']){const input=form.elements[key];input.type=j?'text':'date';input.value=j?(key==='from'?now.slice(0,8)+'01':now):(key==='from'?today.slice(0,8)+'01':today);}};
    async function load(e){e?.preventDefault();const button=form.querySelector('button[type=submit]');button.disabled=true;errorElement.textContent='';resultElement.setAttribute('aria-busy','true');resultElement.innerHTML='<div class="card">در حال دریافت گزارش…</div>';
      try{const values=formData(form);values.from=gregorianDate(values.from,values.calendar);values.to=gregorianDate(values.to,values.calendar);delete values.calendar;await run(values,users.items,current);}
      catch(error){errorElement.textContent=error.message;resultElement.innerHTML='';}
      finally{button.disabled=false;resultElement.removeAttribute('aria-busy');}
    }
    form.onsubmit=load;await load();
  }
  async function traffic(view){
    await filterScreen(view,async(values,users,current)=>{
      const path='/api/reports/attendance?'+new URLSearchParams({...values,incomplete:view==='incomplete'?'1':'0'});
      const r=await request(path);
      const headers=['تاریخ شمسی','پرسنل','محل کار','ورود','خروج','مدت بسته‌شده (دقیقه)','وضعیت'];
      const exported=r.items.flatMap(d=>d.sessions.map(s=>[d.jalali,d.name,d.zone_name,date(s.checked_in_at),date(s.checked_out_at),s.minutes??'',s.checked_out_at?'بسته':'بدون خروج']));
      if(!current())return;
      result(`<p class="note report-note">${esc(r.note)}</p><div class="report-totals"><span class="badge">${fa(r.sessions)} تردد</span><span class="badge">${fa(r.items.length)} روز / پرسنل</span></div>${card(table(['تاریخ','روز هفته','پرسنل','محل کار','مدت بسته‌شده','خلاصه تردد'],r.items.map(d=>row([esc(d.jalali),new Intl.DateTimeFormat('fa-IR',{weekday:'long',timeZone:'UTC'}).format(new Date(d.day+'T12:00:00Z')),esc(d.name),esc(d.zone_name||'تخصیص نیافته'),minutes(d.worked_minutes),`<details class="report-detail"><summary>${fa(d.sessions.length)} نشست ${d.open_count?`· ${fa(d.open_count)} بدون خروج`:''}</summary>${table(['ورود','خروج','مدت','عملیات'],d.sessions.map(s=>row([esc(date(s.checked_in_at)),s.checked_out_at?esc(date(s.checked_out_at)):'<span class="badge">بدون خروج</span>',s.minutes===null?'—':minutes(s.minutes),`<button type="button" class="ghost history-session" data-id="${s.id}">تاریخچه</button>${s.checked_out_at?` <button type="button" class="ghost edit-session" data-id="${s.id}">اصلاح</button>`:` <button type="button" class="ghost edit-session" data-id="${s.id}">تعیین خروج</button>`}`])))}</details>`]))))}<div id="session-action" aria-live="polite"></div>`,headers,exported,path);
      const sessions=r.items.flatMap(d=>d.sessions);
      document.querySelectorAll('.history-session').forEach(b=>b.onclick=guard(async()=>{const h=await request('/api/attendance/'+b.dataset.id+'/corrections');$('#session-action').innerHTML=card(`<h3>تاریخچه اصلاحات</h3>${h.items.map(x=>`<p><b>${esc(x.actor_name)}</b> · ${date(x.created_at)}<br>${esc(x.reason)}<br><small>قبل: ${date(x.old_in)} تا ${date(x.old_out)} · بعد: ${date(x.new_in)} تا ${date(x.new_out)}</small></p>`).join('')||'<p class="muted">اصلاحی ثبت نشده است.</p>'}`);}));
      document.querySelectorAll('.edit-session').forEach(b=>b.onclick=()=>{
        const session=sessions.find(s=>s.id===Number(b.dataset.id)),complete=!session.checked_out_at;const local=v=>{const d=new Date(v);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
        $('#session-action').innerHTML=`<form id="session-edit" class="card stack"><h3>اصلاح تردد با ثبت سابقه</h3><p class="muted">ساعت‌ها بر اساس منطقه زمانی دستگاه شما هستند. تردد بایگانی‌شده یا دارای تداخل قابل تغییر نیست.</p><div class="form-grid"><label>ورود جدید<input name="checked_in_at" type="datetime-local" value="${local(session.checked_in_at)}" ${complete?'readonly':''} required></label><label>خروج جدید<input name="checked_out_at" type="datetime-local" value="${session.checked_out_at?local(session.checked_out_at):''}" required></label><label>دلیل اصلاح<input name="reason" minlength="8" maxlength="500" required></label></div><button class="primary">ثبت اصلاح</button></form>`;
        $('#session-edit').onsubmit=guard(async e=>{const body=formData(e.target);await request('/api/attendance/'+session.id+(complete?'/complete':'/correct'),'POST',{...body,checked_in_at:new Date(body.checked_in_at).toISOString(),checked_out_at:new Date(body.checked_out_at).toISOString()});toast('اصلاح با سابقه ثبت شد');$('#admin-filter').dispatchEvent(new Event('submit',{cancelable:true}));});
        $('#session-action').scrollIntoView({block:'nearest'});
      });
    });
  }
  async function leave(view){
    await filterScreen(view,async(values,users,current)=>{
      if(view==='mission-report')values.type='mission';
      if(view!=='mission-report')values.exclude_missions='1';
      if(view==='leave-report')values.summary='1';
      const path='/api/reports/leave?'+new URLSearchParams(values);
      const r=await request(path);
      const headers=['پرسنل','نوع','از تاریخ','تا تاریخ','واحد','روزهای بازه','دقیقه در بازه','وضعیت','جانشین','توضیح'];
      const rows=r.items.map(x=>[x.name,types[x.type],day(x.work_date),day(x.end_date),x.unit==='daily'?'روزانه':'ساعتی',x.range_days,x.range_minutes,statuses[x.status],x.substitute_name||'',x.description]);
      let summary='';
      if(view==='leave-report'){
        const year=Number(partsDate(new Date(values.to+'T12:00:00Z')).slice(0,4));
        const targets=users.filter(u=>(!values.user_id||String(u.id)===values.user_id)&&(!values.zone_id||String(u.zone_id)===values.zone_id));
        if(targets.length<=100){const balances=[];
          for(let index=0;index<targets.length&&current();index+=8){
            const batch=await Promise.all(targets.slice(index,index+8).map(async u=>{
              const balance=await request('/api/leave-balance?'+new URLSearchParams({year,user_id:u.id}));
              return [esc(u.name),minutes(balance.quota_minutes),minutes(balance.used_minutes),minutes(balance.remaining_minutes)];
            }));
            balances.push(...batch);
          }
          summary=card(`<h3>مانده مرخصی استحقاقی سال ${fa(year)}</h3><p class="muted">مصرف کل سال شمسی است و به بازه جزئیات محدود نمی‌شود.</p>${table(['پرسنل','سهمیه سال','مصرف تأییدشده سال','مانده'],balances.map(row))}`);}
        else summary='<p class="note">برای مشاهده مانده، پرسنل یا محل کار با حداکثر ۱۰۰ نفر انتخاب کنید.</p>';
      }
      const sumKeys=view==='mission-report'?['mission']:['annual_leave','sick_leave','unpaid_leave'];
      const sumHeaders=['پرسنل',...sumKeys.map(k=>types[k])];
      const sumRows=r.summary.map(s=>[s.name,...sumKeys.map(k=>minutes(s[k]))]);
      const sumTable='<div class="section-head"><h2>جمع تأییدشده در بازه</h2></div>'+card(table(sumHeaders,sumRows.map(cells=>row(cells.map(esc)))));
      const detailsTable='<div class="section-head"><h2>جزییات درخواست‌ها</h2></div>'+card(table(headers,rows.map(cells=>row(cells.map(esc)))));
      if(!current())return;
      const note=`<p class="note report-note">${esc(r.note)}</p>`;
      if(view==='leave-report'){
        result(note+summary+sumTable,sumHeaders,sumRows,path);
      }else{
        result(note+(view==='mission-report'?sumTable:'')+detailsTable,headers,rows,path);
      }
    });
  }
  async function workSummary(){await filterScreen('work-summary',async(values,users,current)=>{
    const path='/api/reports/work-summary?'+new URLSearchParams(values);
    const r=await request(path);
    const columns={worked:'حضور کل',in_shift:'حضور در شیفت',expected:'موظفی',shortage:'کسری',absence:'غیبت',absence_and_shortage:'جمع غیبت و کسری',night:'شب‌کاری',total_overtime:'کل اضافه‌کاری',friday_work:'جمعه‌کاری',holiday_work:'تعطیل‌کاری',mission:'مأموریت',leave:'مرخصی با حقوق',unpaid_leave:'بدون حقوق',surplus:'مازاد حضور'};
    const headers=['پرسنل',...Object.values(columns)],rows=r.items.map(p=>[p.name,...Object.keys(columns).map(k=>minutes(p.totals[k]))]);
    if(!current())return;
    result(`<p class="note">${esc(r.note)}</p>${card(table([...headers,'جزئیات روزانه'],r.items.map((p,i)=>row([...rows[i].map(esc),`<button class="ghost work-detail" data-id="${p.user_id}">مشاهده</button>`]))))}`,headers,rows,path);
    document.querySelectorAll('.work-detail').forEach(b=>b.onclick=async()=>{await navigate('report');const form=$('#report-form');form.elements.from.value=values.from;form.elements.to.value=values.to;form.elements.user_id.value=b.dataset.id;form.dispatchEvent(new Event('submit',{cancelable:true}));});
  });}
  async function tracking(){await filterScreen('tracking',async(values,users,current)=>{
    const path='/api/reports/tracking?'+new URLSearchParams(values);
    const r=await request(path);
    const headers=['پرسنل','زمان ثبت','عرض جغرافیایی','طول جغرافیایی','دقت (متر)'],rows=r.items.map(p=>[p.name,date(p.recorded_at),p.lat,p.lng,p.accuracy??'—']);
    if(!current())return;
    result(`<p class="note">موقعیت‌ها توسط اپ اندروید و فقط در حضور فعال ثبت می‌شوند. نگهداری تاریخچه ${fa(r.retention_days)} روز است؛ خالی‌بودن فهرست به معنی غیبت نیست.</p>${card(table(headers,rows.map(r=>row(r.map(esc)))))}`,headers,rows,path);
  });}
  async function audit(){await filterScreen('audit',async(values,users,current)=>{
    const path='/api/reports/audit?'+new URLSearchParams(values);
    const r=await request(path);
    const labels={'user.create':'ایجاد پرسنل','user.zone':'تخصیص محل کار','zone.create':'ایجاد محل کار','zone.policy':'تغییر سیاست محل کار','attendance.correct':'اصلاح تردد','settings.update':'تغییر تنظیمات','attendance.in':'ثبت ورود','attendance.out':'ثبت خروج','shift.create':'ایجاد شیفت','assignment.set':'تخصیص شیفت'};
    const headers=['عامل','عملیات','نوع رکورد','شناسه رکورد','زمان'],rows=r.items.map(x=>[x.name,labels[x.action]||x.action,x.target_type,x.target_id,date(x.created_at)]);
    if(!current())return;
    result(card(table(headers,rows.map(r=>row(r.map(esc))))),headers,rows,path);
  });}
  async function workplaces(){
    setContent('<div class="note">محل‌های کار همان مناطق سازمانی حضوریارند؛ برای تخصیص پرسنل و سیاست جانشینی استفاده می‌شوند. محدوده GPS هر محل کار بر محدوده پیش‌فرض شرکت اولویت دارد؛ مختصات خالی یعنی استفاده از پیش‌فرض شرکت.</div>');
    await ctx.zoneManagement();
    const {items}=await request('/api/zones');
    $('#content').insertAdjacentHTML('beforeend',`<div class="section-head"><h2>محدوده GPS محل‌های کار</h2></div>${items.map(z=>`<form class="card stack workplace-gps" data-id="${z.id}"><h3>${esc(z.name)}</h3><div class="form-grid"><label>عرض جغرافیایی<input name="lat" type="number" step="any" min="-90" max="90" value="${esc(z.geofence_lat??'')}"></label><label>طول جغرافیایی<input name="lng" type="number" step="any" min="-180" max="180" value="${esc(z.geofence_lng??'')}"></label><label>شعاع مجاز (متر)<input name="radius_m" type="number" min="50" max="50000" value="${z.geofence_radius_m}" required></label></div><p class="muted">هر دو مختصات را وارد کنید یا برای استفاده از پیش‌فرض شرکت هر دو را خالی بگذارید.</p><button class="primary">ذخیره محدوده محل کار</button></form>`).join('')||'<p class="muted">ابتدا یک محل کار تعریف کنید.</p>'}`);
    document.querySelectorAll('.workplace-gps').forEach(form=>form.onsubmit=guard(async e=>{const b=formData(e.target);await request('/api/zones/'+form.dataset.id+'/geofence','PATCH',{lat:b.lat===''?null:Number(b.lat),lng:b.lng===''?null:Number(b.lng),radius_m:Number(b.radius_m)});toast('محدوده محل کار ذخیره شد');}));
    if(state.user.role==='owner'){
      if(items.length){
        $('#content').insertAdjacentHTML('beforeend',`<div class="section-head"><h2>وای‌فای محل‌های کار</h2></div>
          ${items.map(zone=>`<form class="card stack workplace-wifi" data-id="${zone.id}">
            <h3>${esc(zone.name)}</h3>
            <label>شناسه‌های وای‌فای (BSSID)<textarea name="wifi" dir="ltr" rows="3" placeholder="00:11:22:33:44:55">${esc((zone.wifi_bssids??[]).join('\n'))}</textarea></label>
            <p class="muted">هر شناسه را در یک خط بنویسید. برای برداشتن شرط وای‌فای، فهرست را خالی بگذارید.</p>
            <button type="submit" class="primary">ذخیره وای‌فای</button>
          </form>`).join('')}`);
        document.querySelectorAll('.workplace-wifi').forEach(form=>{
          form.onsubmit=guard(async ()=>{
            const wifi_bssids=form.elements.wifi.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
            await request('/api/zones/'+form.dataset.id+'/wifi','PATCH',{wifi_bssids});
            toast('وای‌فای محل کار ذخیره شد');
          });
        });
      }
      const devices=document.createElement('div');
      $('#content').append(devices);
      await workplaceDevices(devices,items,{request,esc,date,toast,guard,readOnly:state.subscription?.expired});
    }
  }
  function mobile(){setContent(card('<h2>اپلیکیشن اندروید حضوریار</h2><p>ثبت ورود و خروج، دریافت GPS و ارسال موقعیت از اپلیکیشن اندروید انجام می‌شود. پنل وب برای مدیریت پرسنل، شیفت‌ها، درخواست‌ها و گزارش‌هاست.</p><p class="muted">نسخه اندروید هنوز فایل نصب تأییدشده برای انتشار ندارد. نشانی API در تنظیمات اپ باید به سرور PHP حضوریار متصل شود.</p>'));}
  async function render(view){
    if(view==='reports'){setContent(`<div class="section-head"><h2>گزارش‌های سازمان</h2><span class="badge">${esc(state.user.company_name)}</span></div><div class="report-catalog">${Object.entries(descriptions).filter(([k])=>k!=='tracking'||state.features.monitoring).map(([key,desc])=>`<button class="card report-link" data-report="${key}">${icon(key)}<h2>${esc(adminTitles[key]||'کارکرد روزانه')}</h2><p>${desc}</p></button>`).join('')}</div>`);document.querySelectorAll('[data-report]').forEach(b=>b.onclick=()=>navigate(b.dataset.report));return true;}
    if(['traffic','incomplete'].includes(view)){await traffic(view);return true;}
    if(['leave-report','leave-details','mission-report'].includes(view)){await leave(view);return true;}
    if(view==='work-summary'){await workSummary();return true;}
    if(view==='tracking'){await tracking();return true;}
    if(view==='audit'){await audit();return true;}
    if(view==='workplaces'){await workplaces();return true;}
    if(view==='mobile'){mobile();return true;}
    return false;
  }
  return {render};
}
