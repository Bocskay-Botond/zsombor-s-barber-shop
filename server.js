const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'zsombor-barber-secret-2026';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Nincs bejelentkezve' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Érvénytelen token' });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(m) {
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const min = (m % 60).toString().padStart(2, '0');
  return `${h}:${min}`;
}

// Returns day_of_week index where 0=Mon, 6=Sun
function getDayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const jsDay = d.getDay(); // 0=Sun, 1=Mon...
  return jsDay === 0 ? 6 : jsDay - 1;
}

function getAvailableSlots(dateStr, serviceId) {
  const dayIndex = getDayOfWeek(dateStr);
  const wh = db.prepare('SELECT * FROM working_hours WHERE day_of_week = ?').get(dayIndex);

  if (!wh || !wh.is_working_day) return [];

  const slotDurationMin = parseInt(
    (db.prepare("SELECT value FROM settings WHERE key = 'slot_duration'").get() || { value: '30' }).value
  );

  let serviceDuration = slotDurationMin;
  if (serviceId) {
    const svc = db.prepare('SELECT duration_minutes FROM services WHERE id = ?').get(serviceId);
    if (svc) serviceDuration = svc.duration_minutes;
  }

  const startMin = timeToMinutes(wh.start_time);
  const endMin = timeToMinutes(wh.end_time);

  // Fetch booked slots for this day (pending or confirmed)
  const bookedSlots = db.prepare(`
    SELECT b.booking_time, s.duration_minutes
    FROM bookings b
    JOIN services s ON s.id = b.service_id
    WHERE b.booking_date = ? AND b.status != 'rejected'
  `).all(dateStr);

  const slots = [];
  for (let slotStart = startMin; slotStart + serviceDuration <= endMin; slotStart += slotDurationMin) {
    const slotEnd = slotStart + serviceDuration;
    let blocked = false;

    for (const booked of bookedSlots) {
      const bStart = timeToMinutes(booked.booking_time);
      const bEnd = bStart + booked.duration_minutes;
      // Check overlap
      if (slotStart < bEnd && slotEnd > bStart) {
        blocked = true;
        break;
      }
    }

    slots.push({ time: minutesToTime(slotStart), available: !blocked });
  }

  return slots;
}

// ─── Public Routes ────────────────────────────────────────────────────────────

app.get('/api/services', (req, res) => {
  const services = db.prepare('SELECT * FROM services WHERE active = 1 ORDER BY id').all();
  res.json(services);
});

app.get('/api/availability', (req, res) => {
  const { date, service_id } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Érvénytelen dátum formátum (YYYY-MM-DD)' });
  }

  const slots = getAvailableSlots(date, service_id ? parseInt(service_id) : null);
  res.json({ date, slots });
});

app.get('/api/week-availability', (req, res) => {
  const { start_date, service_id } = req.query;
  if (!start_date || !/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
    return res.status(400).json({ error: 'Érvénytelen dátum' });
  }

  const result = [];
  const startDate = new Date(start_date + 'T12:00:00');
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayIndex = getDayOfWeek(dateStr);
    const wh = db.prepare('SELECT * FROM working_hours WHERE day_of_week = ?').get(dayIndex);
    const slots = getAvailableSlots(dateStr, service_id ? parseInt(service_id) : null);
    result.push({ date: dateStr, isWorkingDay: wh ? !!wh.is_working_day : false, slots });
  }

  res.json(result);
});

app.post('/api/bookings', (req, res) => {
  const { guest_name, email, phone, service_id, booking_date, booking_time } = req.body;

  if (!guest_name || !email || !service_id || !booking_date || !booking_time) {
    return res.status(400).json({ error: 'Hiányzó mezők' });
  }

  const service = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(service_id);
  if (!service) return res.status(400).json({ error: 'Érvénytelen szolgáltatás' });

  // Check if slot is still available
  const slots = getAvailableSlots(booking_date, service_id);
  const slot = slots.find(s => s.time === booking_time);
  if (!slot || !slot.available) {
    return res.status(409).json({ error: 'Ez az időpont már foglalt. Kérlek válassz másikat.' });
  }

  const result = db.prepare(`
    INSERT INTO bookings (guest_name, email, phone, service_id, booking_date, booking_time, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(guest_name, email, phone || '', service_id, booking_date, booking_time);

  res.status(201).json({
    id: result.lastInsertRowid,
    message: `Foglalás rögzítve! Hamarosan visszaigazolást küldünk, ${guest_name}.`
  });
});

app.get('/api/settings/public', (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('shop_name','shop_address','shop_phone')").all();
  const result = {};
  rows.forEach(r => result[r.key] = r.value);
  res.json(result);
});

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Hiányzó adatok' });

  const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Hibás felhasználónév vagy jelszó' });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, username: user.username });
});

// ─── Admin Routes ─────────────────────────────────────────────────────────────

app.get('/api/admin/bookings', requireAuth, (req, res) => {
  const { date, status } = req.query;
  let query = `
    SELECT b.*, s.name as service_name, s.price, s.duration_minutes
    FROM bookings b
    JOIN services s ON s.id = b.service_id
  `;
  const params = [];
  const conditions = [];
  if (date) { conditions.push('b.booking_date = ?'); params.push(date); }
  if (status) { conditions.push('b.status = ?'); params.push(status); }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY b.booking_date DESC, b.booking_time ASC';

  res.json(db.prepare(query).all(...params));
});

app.put('/api/admin/bookings/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  if (!['pending', 'confirmed', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Érvénytelen státusz' });
  }
  const result = db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Nem található' });
  res.json({ success: true });
});

app.delete('/api/admin/bookings/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM bookings WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Admin: Services CRUD
app.get('/api/admin/services', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM services ORDER BY id').all());
});

app.post('/api/admin/services', requireAuth, (req, res) => {
  const { name, description, price, duration_minutes, image_url } = req.body;
  if (!name || !price || !duration_minutes) return res.status(400).json({ error: 'Hiányzó mezők' });
  const r = db.prepare(
    'INSERT INTO services (name, description, price, duration_minutes, image_url) VALUES (?, ?, ?, ?, ?)'
  ).run(name, description || '', price, duration_minutes, image_url || '');
  res.status(201).json({ id: r.lastInsertRowid });
});

app.put('/api/admin/services/:id', requireAuth, (req, res) => {
  const { name, description, price, duration_minutes, image_url, active } = req.body;
  db.prepare(`
    UPDATE services SET name=?, description=?, price=?, duration_minutes=?, image_url=?, active=?
    WHERE id=?
  `).run(name, description || '', price, duration_minutes, image_url || '', active ?? 1, req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/services/:id', requireAuth, (req, res) => {
  db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Admin: Working Hours
app.get('/api/admin/working-hours', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM working_hours ORDER BY day_of_week').all());
});

app.put('/api/admin/working-hours', requireAuth, (req, res) => {
  const hours = req.body;
  if (!Array.isArray(hours)) return res.status(400).json({ error: 'Array szükséges' });
  const update = db.prepare(
    'UPDATE working_hours SET start_time=?, end_time=?, is_working_day=? WHERE day_of_week=?'
  );
  const tx = db.transaction(() => hours.forEach(h => update.run(h.start_time, h.end_time, h.is_working_day ? 1 : 0, h.day_of_week)));
  tx();
  res.json({ success: true });
});

// Admin: Settings
app.get('/api/admin/settings', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  rows.forEach(r => result[r.key] = r.value);
  res.json(result);
});

app.put('/api/admin/settings', requireAuth, (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction(() => {
    Object.entries(req.body).forEach(([k, v]) => upsert.run(k, String(v)));
  });
  tx();
  res.json({ success: true });
});

app.put('/api/admin/password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Hibás jelenlegi jelszó' });
  }
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ success: true });
});

// Admin: Stats
app.get('/api/admin/stats', requireAuth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const todayRevenue = db.prepare(`
    SELECT COALESCE(SUM(s.price), 0) as total
    FROM bookings b JOIN services s ON s.id = b.service_id
    WHERE b.booking_date = ? AND b.status = 'confirmed'
  `).get(today).total;

  const pending = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status = 'pending'").get().c;
  const todayConfirmed = db.prepare("SELECT COUNT(*) as c FROM bookings WHERE booking_date = ? AND status = 'confirmed'").get(today).c;

  // Weekly revenue for last 7 days
  const weekRevenue = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const rev = db.prepare(`
      SELECT COALESCE(SUM(s.price), 0) as total
      FROM bookings b JOIN services s ON s.id = b.service_id
      WHERE b.booking_date = ? AND b.status = 'confirmed'
    `).get(ds).total;
    weekRevenue.push({ date: ds, revenue: rev });
  }

  res.json({ todayRevenue, pending, todayConfirmed, weekRevenue });
});

// ─── Catch-all: serve SPA ─────────────────────────────────────────────────────
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.listen(PORT, () => {
  console.log(`Zsombor's Barber Shop szerver fut: http://localhost:${PORT}`);
});
