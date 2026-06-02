/* ── Auth Guard ───────────────────────────────────────────────────────────── */
const token = localStorage.getItem('bb_token');
if (!token) window.location.href = '/login';
document.getElementById('admin-username').textContent = localStorage.getItem('bb_user') || 'admin';

/* ── API Helper ───────────────────────────────────────────────────────────── */
async function api(method, url, body) {
  const opts = {
    method,
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  if (r.status === 401) { localStorage.removeItem('bb_token'); window.location.href = '/login'; }
  return r;
}

/* ── Toast ────────────────────────────────────────────────────────────────── */
function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  t.innerHTML = `<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/* ── Sidebar Navigation ───────────────────────────────────────────────────── */
const SECTION_TITLES = {
  overview: 'Áttekintés', bookings: 'Foglalások',
  services: 'Szolgáltatások', hours: 'Munkaidő', settings: 'Beállítások'
};

function activateSection(name) {
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('active'));
  document.getElementById('section-' + name).classList.add('active');
  document.querySelector(`.sidebar-nav li[data-section="${name}"]`).classList.add('active');
  document.getElementById('section-title').textContent = SECTION_TITLES[name] || '';

  const loaders = { overview: loadStats, bookings: loadBookings, services: loadServices, hours: loadWorkingHours, settings: loadSettings };
  if (loaders[name]) loaders[name]();
}

document.querySelectorAll('.sidebar-nav li').forEach(li => {
  li.addEventListener('click', e => {
    e.preventDefault();
    activateSection(li.dataset.section);
  });
});

document.getElementById('logout-btn').addEventListener('click', e => {
  e.preventDefault();
  localStorage.removeItem('bb_token');
  localStorage.removeItem('bb_user');
  window.location.href = '/login';
});

/* ── Overview / Stats ─────────────────────────────────────────────────────── */
let chartInstance = null;

async function loadStats() {
  try {
    const r = await api('GET', '/api/admin/stats');
    const d = await r.json();
    document.getElementById('stat-revenue').textContent = d.todayRevenue.toLocaleString('hu-HU') + ' Ft';
    document.getElementById('stat-pending').textContent = d.pending;
    document.getElementById('stat-confirmed').textContent = d.todayConfirmed;
    renderChart(d.weekRevenue);
  } catch { showToast('Nem sikerült betölteni a statisztikákat.', 'error'); }
}

function renderChart(weekData) {
  const ctx = document.getElementById('revenue-chart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: weekData.map(d => {
        const dt = new Date(d.date + 'T12:00:00');
        return dt.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
      }),
      datasets: [{
        label: 'Bevétel (Ft)',
        data: weekData.map(d => d.revenue),
        borderColor: '#c9a84c',
        backgroundColor: 'rgba(201,168,76,0.1)',
        borderWidth: 2, tension: 0.4, fill: true,
        pointBackgroundColor: '#c9a84c'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#aaa' } } },
      scales: {
        y: { beginAtZero: true, ticks: { color: '#aaa', callback: v => v.toLocaleString('hu-HU') + ' Ft' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        x: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,0.05)' } }
      }
    }
  });
}

/* ── Bookings ─────────────────────────────────────────────────────────────── */
async function loadBookings() {
  const date = document.getElementById('bookings-date-filter').value;
  const status = document.getElementById('bookings-status-filter').value;
  const tbody = document.getElementById('bookings-tbody');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="9"><span class="loading-spinner"></span></td></tr>';

  try {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (status) params.set('status', status);
    const r = await api('GET', '/api/admin/bookings?' + params);
    const bookings = await r.json();

    if (!bookings.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="9">Nincsenek foglalások a megadott feltételekkel.</td></tr>';
      return;
    }

    tbody.innerHTML = bookings.map(b => {
      const badgeClass = { pending: 'badge-pending', confirmed: 'badge-confirmed', rejected: 'badge-rejected' }[b.status] || '';
      const badgeText = { pending: 'Várakozó', confirmed: 'Megerősített', rejected: 'Elutasított' }[b.status] || b.status;
      return `<tr data-id="${b.id}">
        <td><strong>${b.guest_name}</strong></td>
        <td>${b.email}</td>
        <td>${b.phone || '–'}</td>
        <td>${b.service_name}</td>
        <td>${b.booking_date}</td>
        <td>${b.booking_time}</td>
        <td>${b.price.toLocaleString('hu-HU')} Ft</td>
        <td><span class="badge ${badgeClass}">${badgeText}</span></td>
        <td>
          <div class="actions-cell">
            ${b.status !== 'confirmed' ? `<button class="btn btn-sm btn-success" data-action="confirm" title="Megerősít">✔</button>` : ''}
            ${b.status !== 'rejected' ? `<button class="btn btn-sm btn-danger" data-action="reject" title="Elutasít">✖</button>` : ''}
            <button class="btn btn-sm" data-action="delete" title="Töröl">🗑</button>
          </div>
        </td>
      </tr>`;
    }).join('');

  } catch { showToast('Nem sikerült betölteni a foglalásokat.', 'error'); }
}

document.getElementById('bookings-filter-btn').addEventListener('click', loadBookings);
document.getElementById('bookings-date-filter').addEventListener('change', loadBookings);

document.getElementById('bookings-tbody').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const row = btn.closest('tr');
  const id = row.dataset.id;

  if (action === 'delete') {
    if (!confirm('Biztosan törölni szeretnéd ezt a foglalást?')) return;
    await api('DELETE', `/api/admin/bookings/${id}`);
    showToast('Foglalás törölve.', 'success');
  } else {
    const status = action === 'confirm' ? 'confirmed' : 'rejected';
    await api('PUT', `/api/admin/bookings/${id}/status`, { status });
    showToast(action === 'confirm' ? 'Foglalás megerősítve!' : 'Foglalás elutasítva.', 'success');
  }

  loadBookings();
  loadStats();
});

/* ── Services ─────────────────────────────────────────────────────────────── */
async function loadServices() {
  const container = document.getElementById('services-list');
  container.innerHTML = '<div style="text-align:center;padding:1rem"><span class="loading-spinner"></span></div>';

  try {
    const r = await api('GET', '/api/admin/services');
    const services = await r.json();

    if (!services.length) {
      container.innerHTML = '<p style="color:var(--text-muted);padding:1rem">Nincsenek szolgáltatások.</p>';
      return;
    }

    container.innerHTML = services.map(s => `
      <div class="service-list-item" data-id="${s.id}">
        <div class="service-list-info">
          <strong>${s.name}</strong>
          <span>${s.description || ''} · ${s.duration_minutes} perc · ${s.active ? '✅ Aktív' : '❌ Inaktív'}</span>
        </div>
        <div class="service-list-price">${s.price.toLocaleString('hu-HU')} Ft</div>
        <button class="btn btn-sm" data-action="edit" data-id="${s.id}">✏️</button>
        <button class="btn btn-sm btn-danger" data-action="delete" data-id="${s.id}">🗑</button>
      </div>
    `).join('');

    // Store for modal use
    window._services = services;

  } catch { showToast('Nem sikerült betölteni a szolgáltatásokat.', 'error'); }
}

document.getElementById('services-list').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;

  if (action === 'edit') {
    const svc = (window._services || []).find(s => String(s.id) === id);
    if (!svc) return;
    openServiceModal(svc);
  } else if (action === 'delete') {
    if (!confirm('Biztosan inaktiválod ezt a szolgáltatást?')) return;
    await api('DELETE', `/api/admin/services/${id}`);
    showToast('Szolgáltatás törölve (inaktiválva).', 'success');
    loadServices();
  }
});

document.getElementById('add-service-btn').addEventListener('click', () => openServiceModal(null));

function openServiceModal(svc) {
  document.getElementById('modal-title').textContent = svc ? 'Szolgáltatás szerkesztése' : 'Új szolgáltatás';
  document.getElementById('m-service-id').value = svc ? svc.id : '';
  document.getElementById('m-name').value = svc ? svc.name : '';
  document.getElementById('m-desc').value = svc ? svc.description : '';
  document.getElementById('m-price').value = svc ? svc.price : '';
  document.getElementById('m-duration').value = svc ? svc.duration_minutes : '30';
  document.getElementById('m-image').value = svc ? svc.image_url : '';
  document.getElementById('service-modal').classList.add('open');
}

function closeModal() { document.getElementById('service-modal').classList.remove('open'); }
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-cancel').addEventListener('click', closeModal);
document.getElementById('service-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

document.getElementById('modal-save').addEventListener('click', async () => {
  const id = document.getElementById('m-service-id').value;
  const body = {
    name: document.getElementById('m-name').value.trim(),
    description: document.getElementById('m-desc').value.trim(),
    price: parseInt(document.getElementById('m-price').value),
    duration_minutes: parseInt(document.getElementById('m-duration').value),
    image_url: document.getElementById('m-image').value.trim(),
    active: 1
  };

  if (!body.name || !body.price || !body.duration_minutes) {
    showToast('Kérlek töltsd ki a kötelező mezőket!', 'error');
    return;
  }

  if (id) {
    await api('PUT', `/api/admin/services/${id}`, body);
    showToast('Szolgáltatás frissítve!', 'success');
  } else {
    await api('POST', '/api/admin/services', body);
    showToast('Új szolgáltatás hozzáadva!', 'success');
  }

  closeModal();
  loadServices();
});

/* ── Working Hours ────────────────────────────────────────────────────────── */
const DAY_NAMES = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat', 'Vasárnap'];

async function loadWorkingHours() {
  const container = document.getElementById('working-hours-form');
  container.innerHTML = '<div style="text-align:center;padding:1rem"><span class="loading-spinner"></span></div>';

  try {
    const r = await api('GET', '/api/admin/working-hours');
    const hours = await r.json();
    window._workingHours = hours;

    container.innerHTML = hours.map(h => `
      <div class="wh-row" data-day="${h.day_of_week}">
        <div class="wh-day">${DAY_NAMES[h.day_of_week]}</div>
        <label class="wh-toggle">
          <input type="checkbox" class="wh-active" ${h.is_working_day ? 'checked' : ''}> Dolgozik
        </label>
        <div class="form-group">
          <input type="time" class="wh-start" value="${h.start_time}" ${h.is_working_day ? '' : 'disabled'}>
        </div>
        <div class="form-group">
          <input type="time" class="wh-end" value="${h.end_time}" ${h.is_working_day ? '' : 'disabled'}>
        </div>
      </div>
    `).join('');

    // Toggle disabled state on checkbox change
    container.querySelectorAll('.wh-active').forEach(cb => {
      cb.addEventListener('change', () => {
        const row = cb.closest('.wh-row');
        row.querySelector('.wh-start').disabled = !cb.checked;
        row.querySelector('.wh-end').disabled = !cb.checked;
      });
    });

  } catch { showToast('Nem sikerült betölteni a munkaidőt.', 'error'); }
}

document.getElementById('save-hours-btn').addEventListener('click', async () => {
  const rows = document.querySelectorAll('.wh-row');
  const hours = Array.from(rows).map(row => ({
    day_of_week: parseInt(row.dataset.day),
    is_working_day: row.querySelector('.wh-active').checked,
    start_time: row.querySelector('.wh-start').value,
    end_time: row.querySelector('.wh-end').value
  }));

  const r = await api('PUT', '/api/admin/working-hours', hours);
  if (r.ok) { showToast('Munkaidő sikeresen mentve!', 'success'); }
  else { showToast('Hiba a mentés során.', 'error'); }
});

/* ── Settings ─────────────────────────────────────────────────────────────── */
async function loadSettings() {
  try {
    const r = await api('GET', '/api/admin/settings');
    const s = await r.json();
    document.getElementById('s-shop-name').value = s.shop_name || '';
    document.getElementById('s-address').value = s.shop_address || '';
    document.getElementById('s-phone').value = s.shop_phone || '';
    document.getElementById('s-slot-duration').value = s.slot_duration || '30';
  } catch { showToast('Nem sikerült betölteni a beállításokat.', 'error'); }
}

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const body = {
    shop_name: document.getElementById('s-shop-name').value,
    shop_address: document.getElementById('s-address').value,
    shop_phone: document.getElementById('s-phone').value,
    slot_duration: document.getElementById('s-slot-duration').value
  };
  const r = await api('PUT', '/api/admin/settings', body);
  if (r.ok) showToast('Beállítások mentve!', 'success');
  else showToast('Hiba a mentés során.', 'error');
});

document.getElementById('save-password-btn').addEventListener('click', async () => {
  const curPass = document.getElementById('s-cur-pass').value;
  const newPass = document.getElementById('s-new-pass').value;
  if (!curPass || !newPass) { showToast('Töltsd ki mindkét mezőt!', 'error'); return; }
  if (newPass.length < 6) { showToast('Az új jelszó legalább 6 karakter legyen!', 'error'); return; }

  const r = await api('PUT', '/api/admin/password', { current_password: curPass, new_password: newPass });
  const d = await r.json();
  if (r.ok) {
    showToast('Jelszó sikeresen módosítva!', 'success');
    document.getElementById('s-cur-pass').value = '';
    document.getElementById('s-new-pass').value = '';
  } else {
    showToast(d.error || 'Hiba a jelszóváltás során.', 'error');
  }
});

/* ── Init ─────────────────────────────────────────────────────────────────── */
loadStats();
