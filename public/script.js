/* ── Utilities ────────────────────────────────────────────────────────────── */
function showToast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  t.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

async function apiFetch(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toDateStr(date) {
  return date.toISOString().slice(0, 10);
}

const DAY_NAMES = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat', 'Vasárnap'];

/* ── State ────────────────────────────────────────────────────────────────── */
let currentWeekStart = getMonday(new Date());
let selectedDate = null;
let selectedTime = null;
let selectedServiceId = null;
let services = [];

/* ── Load Settings ────────────────────────────────────────────────────────── */
async function loadPublicSettings() {
  try {
    const s = await apiFetch('/api/settings/public');
    if (s.shop_name) {
      document.title = s.shop_name;
      document.getElementById('shop-name-nav').textContent = s.shop_name;
      document.getElementById('shop-name-footer').textContent = s.shop_name;
    }
    if (s.shop_address) document.getElementById('shop-address').textContent = '📍 ' + s.shop_address;
    if (s.shop_phone) document.getElementById('shop-phone').textContent = '📞 ' + s.shop_phone;
  } catch {}
}

/* ── Services ─────────────────────────────────────────────────────────────── */
async function loadServices() {
  try {
    services = await apiFetch('/api/services');
    renderServiceCards();
    populateServiceSelect();
  } catch {
    showToast('Nem sikerült betölteni a szolgáltatásokat.', 'error');
  }
}

function renderServiceCards() {
  const grid = document.getElementById('services-grid');
  if (!services.length) {
    grid.innerHTML = '<p style="color:var(--text-muted);text-align:center">Nincsenek elérhető szolgáltatások.</p>';
    return;
  }
  grid.innerHTML = services.map(s => `
    <div class="service-card" data-id="${s.id}" data-duration="${s.duration_minutes}">
      ${s.image_url
        ? `<img src="${s.image_url}" alt="${s.name}" onerror="this.parentElement.querySelector('.service-card-placeholder')?.style&&(this.style.display='none')">`
        : `<div class="service-card-placeholder">✂</div>`
      }
      <div class="service-card-body">
        <h3>${s.name}</h3>
        <p>${s.description || 'Professzionális szolgáltatás prémium minőségben.'}</p>
        <div class="service-meta">
          <span class="service-price">${s.price.toLocaleString('hu-HU')} Ft</span>
          <span class="service-duration">⏱ ${s.duration_minutes} perc</span>
        </div>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.service-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectedServiceId = parseInt(card.dataset.id);
      document.getElementById('b-service').value = selectedServiceId;
      clearSelection();
      document.getElementById('booking').scrollIntoView({ behavior: 'smooth', block: 'start' });
      loadWeekCalendar();
    });
  });
}

function populateServiceSelect() {
  const sel = document.getElementById('b-service');
  sel.innerHTML = '<option value="">Válassz szolgáltatást...</option>' +
    services.map(s => `<option value="${s.id}">${s.name} — ${s.price.toLocaleString('hu-HU')} Ft (${s.duration_minutes} perc)</option>`).join('');

  sel.addEventListener('change', () => {
    selectedServiceId = parseInt(sel.value) || null;
    document.querySelectorAll('.service-card').forEach(c => {
      c.classList.toggle('selected', parseInt(c.dataset.id) === selectedServiceId);
    });
    clearSelection();
    loadWeekCalendar();
  });
}

/* ── Calendar ─────────────────────────────────────────────────────────────── */
function updateWeekLabel() {
  const end = addDays(currentWeekStart, 6);
  document.getElementById('week-label').textContent =
    `${currentWeekStart.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' })}`;
}

async function loadWeekCalendar() {
  updateWeekLabel();
  const grid = document.getElementById('week-grid');
  grid.innerHTML = '<div style="grid-column:1/-1;padding:1rem;text-align:center;color:var(--text-muted)"><span class="loading-spinner"></span> Betöltés...</div>';

  try {
    const url = `/api/week-availability?start_date=${toDateStr(currentWeekStart)}${selectedServiceId ? '&service_id=' + selectedServiceId : ''}`;
    const days = await apiFetch(url);
    renderWeekGrid(days);
  } catch {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:1rem;text-align:center;color:var(--text-muted)">Nem sikerült betölteni a naptárat.</div>';
  }
}

function renderWeekGrid(days) {
  const grid = document.getElementById('week-grid');
  const today = toDateStr(new Date());

  grid.innerHTML = days.map((day, i) => {
    const isToday = day.date === today;
    const d = new Date(day.date + 'T12:00:00');
    const dayNum = d.getDate();
    const dayName = DAY_NAMES[i];

    if (!day.isWorkingDay) {
      return `
        <div class="day-column">
          <div class="day-header">
            <div class="day-name">${dayName}</div>
            <div class="day-date${isToday ? ' today' : ''}">${dayNum}</div>
          </div>
          <div class="day-closed">Zárva</div>
        </div>`;
    }

    const slotsHtml = day.slots.length === 0
      ? '<div style="font-size:0.75rem;color:var(--text-muted);padding:0.3rem;text-align:center">Nincs szabad idő</div>'
      : day.slots.map(slot => {
          const isSelected = day.date === selectedDate && slot.time === selectedTime;
          const cls = isSelected ? 'selected' : (slot.available ? 'available' : 'booked');
          const disabled = !slot.available && !isSelected ? 'disabled' : '';
          return `<button class="slot-btn ${cls}" data-date="${day.date}" data-time="${slot.time}" ${disabled}>${slot.time}</button>`;
        }).join('');

    return `
      <div class="day-column">
        <div class="day-header">
          <div class="day-name">${dayName}</div>
          <div class="day-date${isToday ? ' today' : ''}">${dayNum}</div>
        </div>
        <div class="day-slots">${slotsHtml}</div>
      </div>`;
  }).join('');

  // Attach slot click handlers
  grid.querySelectorAll('.slot-btn.available, .slot-btn.selected').forEach(btn => {
    btn.addEventListener('click', () => selectSlot(btn.dataset.date, btn.dataset.time));
  });
}

function selectSlot(date, time) {
  selectedDate = date;
  selectedTime = time;

  const displayStr = `${formatDate(date)} — ${time}`;
  document.getElementById('b-date').value = date;
  document.getElementById('b-time').value = time;
  document.getElementById('b-datetime-display').value = displayStr;

  const display = document.getElementById('selected-slot-display');
  document.getElementById('selected-slot-info').textContent = displayStr;
  display.classList.add('visible');

  // Re-render slots to highlight selected
  const allSlotBtns = document.querySelectorAll('.slot-btn');
  allSlotBtns.forEach(btn => {
    const wasSelected = btn.classList.contains('selected');
    if (btn.dataset.date === date && btn.dataset.time === time) {
      btn.className = 'slot-btn selected';
    } else if (wasSelected) {
      btn.className = 'slot-btn available';
      btn.disabled = false;
    }
  });

  document.getElementById('booking').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearSelection() {
  selectedDate = null;
  selectedTime = null;
  document.getElementById('b-date').value = '';
  document.getElementById('b-time').value = '';
  document.getElementById('b-datetime-display').value = '';
  document.getElementById('selected-slot-display').classList.remove('visible');
}

/* ── Booking Submit ───────────────────────────────────────────────────────── */
document.getElementById('book-btn').addEventListener('click', async () => {
  const name = document.getElementById('b-name').value.trim();
  const email = document.getElementById('b-email').value.trim();
  const phone = document.getElementById('b-phone').value.trim();
  const serviceId = parseInt(document.getElementById('b-service').value);
  const date = document.getElementById('b-date').value;
  const time = document.getElementById('b-time').value;

  if (!name || !email || !serviceId || !date || !time) {
    showToast('Kérlek töltsd ki az összes kötelező mezőt és válassz időpontot!', 'error');
    return;
  }

  const btn = document.getElementById('book-btn');
  btn.disabled = true;
  btn.textContent = 'Küldés...';

  try {
    const r = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_name: name, email, phone, service_id: serviceId, booking_date: date, booking_time: time })
    });
    const data = await r.json();

    if (!r.ok) {
      showToast(data.error || 'Hiba történt a foglalás során.', 'error');
      return;
    }

    showToast(data.message, 'success');
    document.getElementById('b-name').value = '';
    document.getElementById('b-email').value = '';
    document.getElementById('b-phone').value = '';
    document.getElementById('b-service').value = '';
    document.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
    selectedServiceId = null;
    clearSelection();
    loadWeekCalendar();

  } catch {
    showToast('Hálózati hiba. Kérlek próbáld újra.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Foglalás elküldése';
  }
});

/* ── Nav buttons ──────────────────────────────────────────────────────────── */
document.getElementById('prev-week').addEventListener('click', () => {
  const today = getMonday(new Date());
  if (currentWeekStart <= today) return;
  currentWeekStart = addDays(currentWeekStart, -7);
  clearSelection();
  loadWeekCalendar();
});

document.getElementById('next-week').addEventListener('click', () => {
  currentWeekStart = addDays(currentWeekStart, 7);
  clearSelection();
  loadWeekCalendar();
});

document.getElementById('clear-slot-btn').addEventListener('click', () => {
  clearSelection();
  loadWeekCalendar();
});

/* ── Reveal on scroll ─────────────────────────────────────────────────────── */
const observer = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
}, { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

/* ── Init ─────────────────────────────────────────────────────────────────── */
loadPublicSettings();
loadServices();
loadWeekCalendar();
