const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── JWT secret ───────────────────────────────────────────────────────────────
// Prefer an explicit JWT_SECRET env var (required for production). If none is set,
// fall back to a random secret persisted in .jwtsecret so tokens survive restarts
// and the app is never deployed with a publicly-known hardcoded secret.
function loadJwtSecret() {
  const fromEnv = (process.env.JWT_SECRET || '').trim();
  if (fromEnv.length >= 16) return fromEnv;

  const secretPath = path.join(__dirname, '.jwtsecret');
  try {
    const existing = fs.readFileSync(secretPath, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch { /* not created yet */ }

  const generated = crypto.randomBytes(48).toString('hex');
  try {
    // mode 0o600 restricts the file to the owner on POSIX; on Windows it is ignored
    // (NTFS ACLs apply), so on shared/Windows hosts set JWT_SECRET explicitly instead.
    fs.writeFileSync(secretPath, generated, { mode: 0o600 });
    console.warn('[biztonság] Nincs JWT_SECRET env változó — generáltam egyet (.jwtsecret). Éles üzemhez állíts be sajátot.');
  } catch {
    console.warn('[biztonság] JWT_SECRET nincs beállítva és a .jwtsecret nem írható — ideiglenes secret memóriában. Minden újraindítás kijelentkeztet!');
  }
  return generated;
}
const JWT_SECRET = loadJwtSecret();

// trust proxy only when explicitly behind a reverse proxy (so req.ip is correct
// for rate limiting without letting direct clients spoof X-Forwarded-For).
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

// ─── Security headers + CSP ─────────────────────────────────────────────────--
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join('; '));
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Simple in-memory rate limiter (no external deps) ──────────────────────────
function rateLimiter({ windowMs, max, message }) {
  const hits = new Map(); // ip -> [timestamps]
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const recent = (hits.get(ip) || []).filter(t => now - t < windowMs);
    if (recent.length >= max) {
      res.setHeader('Retry-After', String(Math.ceil((windowMs - (now - recent[0])) / 1000)));
      return res.status(429).json({ error: message || 'Túl sok kérés. Próbáld újra később.' });
    }
    recent.push(now);
    hits.set(ip, recent);
    if (hits.size > 5000) { // opportunistic cleanup
      for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k);
    }
    next();
  };
}
const loginLimiter = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10, message: 'Túl sok bejelentkezési kísérlet. Próbáld újra 15 perc múlva.' });
const bookingLimiter = rateLimiter({ windowMs: 10 * 60 * 1000, max: 6, message: 'Túl sok foglalási kísérlet. Próbáld újra később.' });
const availabilityLimiter = rateLimiter({ windowMs: 60 * 1000, max: 60, message: 'Túl sok kérés. Lassíts egy kicsit.' });

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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BOOKING_HORIZON_DAYS = 120; // how far ahead a guest may book

// Local (not UTC) YYYY-MM-DD so "today" matches the shop's wall clock.
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function isValidDateStr(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T12:00:00');
  return !isNaN(d.getTime()) && localDateStr(d) === s;
}

function timeToMinutes(t) {
  const [h, m] = String(t).split(':').map(Number);
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
  // Never offer slots for past days.
  if (dateStr < localDateStr()) return [];

  const dayIndex = getDayOfWeek(dateStr);
  const wh = db.prepare('SELECT * FROM working_hours WHERE day_of_week = ?').get(dayIndex);
  if (!wh || !wh.is_working_day) return [];

  let slotDurationMin = parseInt(
    (db.prepare("SELECT value FROM settings WHERE key = 'slot_duration'").get() || { value: '30' }).value,
    10
  );
  if (!Number.isFinite(slotDurationMin) || slotDurationMin <= 0) slotDurationMin = 30; // guard against infinite loop

  let serviceDuration = slotDurationMin;
  if (serviceId) {
    const svc = db.prepare('SELECT duration_minutes FROM services WHERE id = ?').get(serviceId);
    if (svc && svc.duration_minutes > 0) serviceDuration = svc.duration_minutes;
  }

  const startMin = timeToMinutes(wh.start_time);
  const endMin = timeToMinutes(wh.end_time);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) return [];

  // Fetch booked slots for this day (anything not rejected blocks the time)
  const bookedSlots = db.prepare(`
    SELECT b.booking_time, s.duration_minutes
    FROM bookings b
    JOIN services s ON s.id = b.service_id
    WHERE b.booking_date = ? AND b.status != 'rejected'
  `).all(dateStr);

  const cutoff = dateStr === localDateStr() ? nowMinutes() : -1; // hide past times today

  const slots = [];
  for (let slotStart = startMin; slotStart + serviceDuration <= endMin; slotStart += slotDurationMin) {
    const slotEnd = slotStart + serviceDuration;
    let blocked = slotStart <= cutoff;

    if (!blocked) {
      for (const booked of bookedSlots) {
        const bStart = timeToMinutes(booked.booking_time);
        const bEnd = bStart + booked.duration_minutes;
        if (slotStart < bEnd && slotEnd > bStart) { blocked = true; break; } // overlap
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

app.get('/api/availability', availabilityLimiter, (req, res) => {
  const { date, service_id } = req.query;
  if (!isValidDateStr(date)) {
    return res.status(400).json({ error: 'Érvénytelen dátum formátum (YYYY-MM-DD)' });
  }
  const slots = getAvailableSlots(date, service_id ? parseInt(service_id, 10) : null);
  res.json({ date, slots });
});

app.get('/api/week-availability', availabilityLimiter, (req, res) => {
  const { start_date, service_id } = req.query;
  if (!isValidDateStr(start_date)) {
    return res.status(400).json({ error: 'Érvénytelen dátum' });
  }

  const todayStr = localDateStr();
  const result = [];
  const startDate = new Date(start_date + 'T12:00:00');
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const dateStr = localDateStr(d);
    const dayIndex = getDayOfWeek(dateStr);
    const wh = db.prepare('SELECT * FROM working_hours WHERE day_of_week = ?').get(dayIndex);
    // Past days are effectively closed for booking — report them as not working
    // so the calendar shows "Zárva" rather than a misleading "no free slots".
    const isWorkingDay = dateStr < todayStr ? false : (wh ? !!wh.is_working_day : false);
    const slots = getAvailableSlots(dateStr, service_id ? parseInt(service_id, 10) : null);
    result.push({ date: dateStr, isWorkingDay, slots });
  }

  res.json(result);
});

app.post('/api/bookings', bookingLimiter, (req, res) => {
  const body = req.body || {};
  const guest_name = typeof body.guest_name === 'string' ? body.guest_name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const service_id = parseInt(body.service_id, 10);
  const booking_date = body.booking_date;
  const booking_time = body.booking_time;

  if (!guest_name || !email || !service_id || !booking_date || !booking_time) {
    return res.status(400).json({ error: 'Hiányzó mezők' });
  }
  if (guest_name.length < 2 || guest_name.length > 80) {
    return res.status(400).json({ error: 'A név 2 és 80 karakter között legyen.' });
  }
  if (email.length > 120 || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Érvénytelen email cím.' });
  }
  if (phone && (phone.length > 30 || !/^[0-9 +()/\-]+$/.test(phone))) {
    return res.status(400).json({ error: 'Érvénytelen telefonszám.' });
  }
  if (!isValidDateStr(booking_date) || !TIME_RE.test(booking_time)) {
    return res.status(400).json({ error: 'Érvénytelen dátum vagy időpont.' });
  }

  // Reject anything in the past (server-side; the UI also hides past slots).
  const todayStr = localDateStr();
  if (booking_date < todayStr || (booking_date === todayStr && timeToMinutes(booking_time) <= nowMinutes())) {
    return res.status(400).json({ error: 'Nem foglalható múltbeli időpont.' });
  }

  // Reject bookings too far in the future (calendar-spam guard).
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + MAX_BOOKING_HORIZON_DAYS);
  if (booking_date > localDateStr(maxDate)) {
    return res.status(400).json({ error: `Legfeljebb ${MAX_BOOKING_HORIZON_DAYS} nappal előre lehet foglalni.` });
  }

  const service = db.prepare('SELECT * FROM services WHERE id = ? AND active = 1').get(service_id);
  if (!service) return res.status(400).json({ error: 'Érvénytelen szolgáltatás' });

  // Re-check availability just before insert. In the shipped single-process setup
  // better-sqlite3 is synchronous, so this check-then-insert won't interleave with
  // another request; the partial UNIQUE index on (booking_date, booking_time) is a
  // DB-level backstop that prevents a duplicate slot even under unexpected concurrency.
  const slots = getAvailableSlots(booking_date, service_id);
  const slot = slots.find(s => s.time === booking_time);
  if (!slot || !slot.available) {
    return res.status(409).json({ error: 'Ez az időpont már foglalt. Kérlek válassz másikat.' });
  }

  let result;
  try {
    result = db.prepare(`
      INSERT INTO bookings (guest_name, email, phone, service_id, booking_date, booking_time, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(guest_name, email, phone || '', service_id, booking_date, booking_time);
  } catch (e) {
    if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ez az időpont már foglalt. Kérlek válassz másikat.' });
    }
    throw e;
  }

  res.status(201).json({
    id: result.lastInsertRowid,
    message: 'Foglalásodat rögzítettük! Állapota: visszaigazolásra vár — hamarosan megerősítjük.'
  });
});

app.get('/api/settings/public', (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('shop_name','shop_address','shop_phone')").all();
  const result = {};
  rows.forEach(r => result[r.key] = r.value);
  res.json(result);
});

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
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
  const { status } = req.body || {};
  if (!['pending', 'confirmed', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Érvénytelen státusz' });
  }
  let result;
  try {
    result = db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, req.params.id);
  } catch (e) {
    if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Erre az időpontra már van aktív foglalás.' });
    }
    throw e;
  }
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

function parseServiceBody(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const price = parseInt(body.price, 10);
  const duration_minutes = parseInt(body.duration_minutes, 10);
  const valid =
    name && name.length <= 100 &&
    Number.isFinite(price) && price >= 0 && price <= 10000000 &&
    Number.isFinite(duration_minutes) && duration_minutes > 0 && duration_minutes <= 600;
  return {
    valid,
    name,
    description: (typeof body.description === 'string' ? body.description : '').slice(0, 500),
    price,
    duration_minutes,
    image_url: (typeof body.image_url === 'string' ? body.image_url : '').slice(0, 500)
  };
}

app.post('/api/admin/services', requireAuth, (req, res) => {
  const s = parseServiceBody(req.body || {});
  if (!s.valid) return res.status(400).json({ error: 'Hiányzó vagy érvénytelen mezők' });
  const r = db.prepare(
    'INSERT INTO services (name, description, price, duration_minutes, image_url) VALUES (?, ?, ?, ?, ?)'
  ).run(s.name, s.description, s.price, s.duration_minutes, s.image_url);
  res.status(201).json({ id: r.lastInsertRowid });
});

app.put('/api/admin/services/:id', requireAuth, (req, res) => {
  const body = req.body || {};
  const s = parseServiceBody(body);
  if (!s.valid) return res.status(400).json({ error: 'Hiányzó vagy érvénytelen mezők' });
  const active = body.active === 0 || body.active === false ? 0 : 1;
  db.prepare(`
    UPDATE services SET name=?, description=?, price=?, duration_minutes=?, image_url=?, active=?
    WHERE id=?
  `).run(s.name, s.description, s.price, s.duration_minutes, s.image_url, active, req.params.id);
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

  for (const h of hours) {
    if (!Number.isInteger(h.day_of_week) || h.day_of_week < 0 || h.day_of_week > 6) {
      return res.status(400).json({ error: 'Érvénytelen nap.' });
    }
    if (!TIME_RE.test(h.start_time) || !TIME_RE.test(h.end_time)) {
      return res.status(400).json({ error: 'Érvénytelen időformátum (ÓÓ:PP).' });
    }
    if (timeToMinutes(h.start_time) >= timeToMinutes(h.end_time)) {
      return res.status(400).json({ error: 'A nyitásnak korábban kell lennie, mint a zárásnak.' });
    }
  }

  const update = db.prepare(
    'UPDATE working_hours SET start_time=?, end_time=?, is_working_day=? WHERE day_of_week=?'
  );
  const tx = db.transaction(() => hours.forEach(h => update.run(h.start_time, h.end_time, h.is_working_day ? 1 : 0, h.day_of_week)));
  tx();
  res.json({ success: true });
});

// Admin: Settings
const ALLOWED_SETTING_KEYS = new Set(['shop_name', 'shop_address', 'shop_phone', 'slot_duration']);

app.get('/api/admin/settings', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  rows.forEach(r => result[r.key] = r.value);
  res.json(result);
});

app.put('/api/admin/settings', requireAuth, (req, res) => {
  const body = req.body || {};
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(body)) {
      if (!ALLOWED_SETTING_KEYS.has(k)) continue; // ignore unknown keys
      if (k === 'slot_duration') {
        const n = parseInt(v, 10);
        if (![15, 30, 60].includes(n)) continue;
        upsert.run(k, String(n));
      } else {
        upsert.run(k, String(v).slice(0, 200));
      }
    }
  });
  tx();
  res.json({ success: true });
});

app.put('/api/admin/password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || typeof new_password !== 'string' || new_password.length < 8) {
    return res.status(400).json({ error: 'Az új jelszó legalább 8 karakter legyen.' });
  }
  const user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Hibás jelenlegi jelszó' });
  }
  db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ success: true });
});

// Admin: Stats
app.get('/api/admin/stats', requireAuth, (req, res) => {
  const today = localDateStr();

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
    const ds = localDateStr(d);
    const rev = db.prepare(`
      SELECT COALESCE(SUM(s.price), 0) as total
      FROM bookings b JOIN services s ON s.id = b.service_id
      WHERE b.booking_date = ? AND b.status = 'confirmed'
    `).get(ds).total;
    weekRevenue.push({ date: ds, revenue: rev });
  }

  res.json({ todayRevenue, pending, todayConfirmed, weekRevenue });
});

// ─── Page routes ──────────────────────────────────────────────────────────────
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// ─── Error handler (body too large / malformed JSON / unexpected) ──────────────
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Túl nagy kérés.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Hibás JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Szerverhiba.' });
});

app.listen(PORT, () => {
  console.log(`Zsombor's Barber Shop szerver fut: http://localhost:${PORT}`);
});
