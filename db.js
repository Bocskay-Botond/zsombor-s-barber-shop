const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

const db = new Database(path.join(__dirname, 'barber.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price INTEGER NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    image_url TEXT DEFAULT '',
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS working_hours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day_of_week INTEGER NOT NULL UNIQUE,
    start_time TEXT NOT NULL DEFAULT '09:00',
    end_time TEXT NOT NULL DEFAULT '18:00',
    is_working_day INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT DEFAULT '',
    service_id INTEGER NOT NULL,
    booking_date TEXT NOT NULL,
    booking_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (service_id) REFERENCES services(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
  );

  -- Backstop: two active (non-rejected) bookings can never claim the same slot.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_active_slot
    ON bookings(booking_date, booking_time)
    WHERE status != 'rejected';
`);

// Seed data only if tables are empty
const serviceCount = db.prepare('SELECT COUNT(*) as c FROM services').get().c;
if (serviceCount === 0) {
  const insertService = db.prepare(
    'INSERT INTO services (name, description, price, duration_minutes) VALUES (?, ?, ?, ?)'
  );
  insertService.run('Férfi hajvágás', 'Professzionális hajvágás modern stílusban', 8000, 45);
  insertService.run('Szakálligazítás', 'Szakálligazítás formázással', 4500, 30);
  insertService.run('Hajfestés', 'Teljes hajfestés prémium termékekkel', 12000, 90);
  insertService.run('Hajvágás + Szakáll', 'Kombó: hajvágás és szakálligazítás', 11000, 60);
}

const whCount = db.prepare('SELECT COUNT(*) as c FROM working_hours').get().c;
if (whCount === 0) {
  const insertWH = db.prepare(
    'INSERT INTO working_hours (day_of_week, start_time, end_time, is_working_day) VALUES (?, ?, ?, ?)'
  );
  // 0=Mon, 1=Tue, ..., 5=Sat, 6=Sun
  insertWH.run(0, '09:00', '18:00', 1);
  insertWH.run(1, '09:00', '18:00', 1);
  insertWH.run(2, '09:00', '18:00', 1);
  insertWH.run(3, '09:00', '18:00', 1);
  insertWH.run(4, '09:00', '18:00', 1);
  insertWH.run(5, '09:00', '14:00', 1);
  insertWH.run(6, '09:00', '18:00', 0);
}

const settingCount = db.prepare('SELECT COUNT(*) as c FROM settings').get().c;
if (settingCount === 0) {
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('shop_name', "Zsombor's Barber Shop");
  insertSetting.run('shop_address', '1234 Budapest, Minta utca 5.');
  insertSetting.run('shop_phone', '+36 20 123 4567');
  insertSetting.run('slot_duration', '30');
}

const adminCount = db.prepare('SELECT COUNT(*) as c FROM admin_users').get().c;
if (adminCount === 0) {
  // Use ADMIN_PASSWORD env if provided (min 6 chars), otherwise generate a random one.
  const envPass = (process.env.ADMIN_PASSWORD || '').trim();
  const initialPassword = envPass.length >= 8 ? envPass : crypto.randomBytes(8).toString('hex'); // 16 hex chars
  const hash = bcrypt.hashSync(initialPassword, 10);
  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run('admin', hash);

  const line = '='.repeat(64);
  console.log('\n' + line);
  console.log('  ELSŐ INDÍTÁS — admin fiók létrehozva');
  console.log('  Felhasználónév: admin');
  console.log('  Jelszó:         ' + initialPassword);
  console.log('  >> Jelentkezz be (/login) és változtasd meg a jelszót a Beállításoknál! <<');
  console.log(line + '\n');
}

module.exports = db;
