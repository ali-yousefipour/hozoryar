export async function workplaceDevices(container, zones, { request, esc, date, toast, guard, readOnly }) {
  const endpoint = '/api/attendance-devices';
  const zoneName = new Map(zones.map(zone => [String(zone.id), zone.name]));
  container.innerHTML = `
    <section class="card stack" aria-labelledby="devices-title">
      <div class="section-head"><h2 id="devices-title">دستگاه حضور و غیاب</h2><span class="badge">اختیاری</span></div>
      <p class="muted">برای دریافت ورود و خروج از دستگاه، رابط دستگاه را به نشانی HTTPS حضوریار متصل کنید. IP و پورت برای شناسایی دستگاه در شبکه محل کار هستند.</p>
      <div data-device-list></div>
      <div class="action-row">
        <button type="button" class="ghost" data-device-open aria-expanded="false" aria-controls="device-create" ${readOnly || !zones.length ? 'disabled' : ''}>افزودن دستگاه</button>
        <button type="button" class="ghost" data-device-refresh>به‌روزرسانی وضعیت اتصال</button>
      </div>
      ${zones.length ? '' : '<p class="muted">ابتدا یک محل کار ثبت کنید.</p>'}
      <form id="device-create" class="stack hidden" hidden>
        <div class="form-grid">
          <label>نوع اتصال<input value="رابط HTTPS" readonly></label>
          <label>محل کار<select name="zone_id" required>${zones.map(zone => `<option value="${esc(zone.id)}">${esc(zone.name)}</option>`).join('')}</select></label>
          <label>نام دستگاه<input name="name" maxlength="100" required></label>
          <label>مدل یا برند دستگاه<input name="model" maxlength="100" placeholder="ZKTeco"></label>
          <label>آدرس IP<input name="ip_address" dir="ltr" maxlength="45" placeholder="192.168.1.10"></label>
          <label>پورت<input name="port" type="number" min="1" max="65535" placeholder="4370"></label>
        </div>
        <button type="submit" class="primary">ثبت دستگاه</button>
      </form>
      <div data-device-key hidden></div>
    </section>`;
  const list = container.querySelector('[data-device-list]');
  const keyPanel = container.querySelector('[data-device-key]');
  const form = container.querySelector('#device-create');
  const open = container.querySelector('[data-device-open]');

  function toggleForm(show) {
    form.hidden = !show;
    form.classList.toggle('hidden', !show);
    open.setAttribute('aria-expanded', String(show));
    if (show) form.elements.name.focus();
  }
  function showKey(id, key) {
    const relayUrl = new URL('/api/device-relay/' + id, location.origin);
    keyPanel.innerHTML = `
      <div class="note stack">
        <strong>اطلاعات اتصال دستگاه</strong>
        <p>کلید فقط در همین مرحله نمایش داده می‌شود. آن را در تنظیمات رابط دستگاه نگه دارید.</p>
        <label>نشانی اتصال<input dir="ltr" readonly value="${esc(relayUrl.href)}"></label>
        <label>کلید اتصال (Bearer)<input dir="ltr" readonly value="${esc(key)}"></label>
        <button class="ghost" type="button" data-device-key-close>بستن اطلاعات اتصال</button>
      </div>`;
    keyPanel.hidden = false;
    keyPanel.querySelector('[data-device-key-close]').onclick = () => {
      keyPanel.replaceChildren();
      keyPanel.hidden = true;
    };
    keyPanel.scrollIntoView({ block:'nearest' });
  }
  async function refresh() {
    const { items } = await request(endpoint);
    if (!container.isConnected) return;
    list.innerHTML = items.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>دستگاه</th><th>محل کار</th><th>IP و پورت</th><th>وضعیت اتصال</th><th>عملیات</th></tr></thead>
      <tbody>${items.map(device => `
        <tr>
          <td>${esc(device.name)}<div class="muted">${esc(device.model)}</div></td>
          <td>${esc(zoneName.get(String(device.zone_id)) ?? '—')}</td>
          <td><bdi dir="ltr">${esc([device.ip_address, device.port].filter(Boolean).join(' / ') || '—')}</bdi></td>
          <td>${!Number(device.enabled) ? 'غیرفعال' : device.last_seen_at ? 'آخرین ارتباط: '+esc(date(device.last_seen_at.replace(' ','T')+'Z')) : 'در انتظار اولین ارتباط'}</td>
          <td>
            <button type="button" class="ghost" data-device-toggle="${esc(device.id)}" data-enable="${Number(device.enabled) ? '0' : '1'}" ${readOnly?'disabled':''}>${Number(device.enabled) ? 'غیرفعال کردن' : 'فعال کردن'}</button>
            <button type="button" class="ghost" data-device-rotate="${esc(device.id)}" ${readOnly?'disabled':''}>تعویض کلید</button>
          </td>
        </tr>`).join('')}</tbody></table></div>` : '<p class="muted">هنوز دستگاهی ثبت نشده است.</p>';
    list.querySelectorAll('[data-device-toggle]').forEach(button => {
      button.onclick = guard(async () => {
        await request(endpoint+'/'+button.dataset.deviceToggle,'PATCH',{ enabled:button.dataset.enable==='1' });
        await refresh();
      });
    });
    list.querySelectorAll('[data-device-rotate]').forEach(button => {
      button.onclick = guard(async () => {
        if (!window.confirm('با تعویض کلید، ارتباط با کلید قبلی قطع می‌شود. کلید جدید ساخته شود؟')) return;
        const { key } = await request(endpoint+'/'+button.dataset.deviceRotate,'PATCH',{ rotate_key:true });
        if (container.isConnected) showKey(button.dataset.deviceRotate,key);
        await refresh();
      });
    });
  }
  open.onclick = () => toggleForm(form.hidden);
  container.querySelector('[data-device-refresh]').onclick = guard(refresh);
  form.onsubmit = guard(async event => {
    const values = new FormData(event.target);
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
      const { id, key } = await request(endpoint,'POST',{
        zone_id:Number(values.get('zone_id')), name:values.get('name'), model:values.get('model'),
        ip_address:values.get('ip_address'), port:values.get('port') ? Number(values.get('port')) : null
      });
      if (!container.isConnected) return;
      form.reset();
      toggleForm(false);
      showKey(id,key);
      toast('دستگاه ثبت شد');
      await refresh();
    } finally {
      submit.disabled = false;
    }
  });
  await refresh();
}
