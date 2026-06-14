# Zsombor's Barber Shop ✂

Online időpontfoglaló rendszer egy fodrászüzlethez, beépített admin felülettel.
Vendégek valós idejű naptárból foglalnak időpontot; a tulajdonos egy védett admin
panelen kezeli a foglalásokat, szolgáltatásokat, munkaidőt és beállításokat.

- **Backend:** Node.js + Express, SQLite (`better-sqlite3`), JWT bejelentkezés, bcrypt jelszó-hash
- **Frontend:** sima HTML/CSS/JS (nincs build lépés), Chart.js a statisztikához
- **UI nyelve:** magyar

---

## Követelmények

- **Node.js 20+** (a `better-sqlite3` natív modul ezt igényli; fejlesztve: Node 24)
- npm

## Telepítés és indítás

```bash
npm install
npm start            # http://localhost:3000
# fejlesztéshez automatikus újraindítással:
npm run dev
```

Első indításkor az adatbázis (`barber.db`) automatikusan létrejön, feltöltődik
alap-szolgáltatásokkal és munkaidővel, és **generálódik egy admin fiók**. A jelszó
**egyszer** kiíródik a konzolra:

```
================================================================
  ELSŐ INDÍTÁS — admin fiók létrehozva
  Felhasználónév: admin
  Jelszó:         3f9a2c7b1e4d8a06
  >> Jelentkezz be (/login) és változtasd meg a jelszót a Beállításoknál! <<
================================================================
```

> ⚠️ Jegyezd fel ezt a jelszót — később már nem jelenik meg. Ha elveszett, állítsd le a
> szervert és töröld mindhárom adatbázis-fájlt: `barber.db`, `barber.db-wal`, `barber.db-shm`
> (új adatbázis és új jelszó jön létre), vagy állíts be újat az `ADMIN_PASSWORD` változóval
> egy friss adatbázishoz.

## Oldalak

| Útvonal   | Mit csinál |
|-----------|------------|
| `/`       | Vendég főoldal — szolgáltatások, naptár, foglalás |
| `/login`  | Admin bejelentkezés |
| `/admin`  | Admin panel (foglalások, szolgáltatások, munkaidő, beállítások, statisztika) |

## Környezeti változók

Lásd [`.env.example`](.env.example). Beállíthatók `.env` fájlban vagy a hosting felületén.

| Változó | Leírás |
|---------|--------|
| `PORT` | A port, amin a szerver figyel (alap: 3000) |
| `JWT_SECRET` | **Éles üzemben kötelező.** A login tokenek aláírókulcsa. Ha nincs megadva, az app generál egyet a `.jwtsecret` fájlba. |
| `ADMIN_PASSWORD` | Opcionális kezdő admin jelszó az első indításhoz (min. 6 karakter). |
| `TRUST_PROXY` | `true`, ha reverse proxy mögött fut (helyes kliens-IP a rate-limithez). |

---

## ✅ Átadási / éles üzemi checklist

Mielőtt az ügyfél éles forgalomban használja:

1. **`JWT_SECRET` beállítása** egy hosszú, véletlen értékre (lásd `.env.example`).
   E nélkül minden újraindítás új secretet generál (és kijelentkeztet), illetve
   többpéldányos üzemben nem működik megfelelően.
2. **Admin jelszó megváltoztatása** az első bejelentkezés után (Beállítások → Jelszó
   módosítása). Ne maradjon a generált kezdő jelszó.
3. **HTTPS** — az alkalmazást reverse proxy (nginx, Caddy, Cloudflare, stb.) mögött,
   TLS-sel futtasd. A bejelentkezés tokent ad vissza, amit titkosított csatornán kell
   küldeni. Proxy mögött állítsd `TRUST_PROXY=true`-ra.
4. **Adatmentés** — az összes adat a `barber.db` fájlban van. Rendszeres mentés =
   a fájl másolása (a `barber.db-wal`/`-shm` fájlokkal együtt, vagy leállított szervernél).
5. **Üzlet adatai** — töltsd ki a valós nevet, címet, telefonszámot és szolgáltatásokat
   az admin Beállítások / Szolgáltatások / Munkaidő menükben.

### Publikálás a webre (ingyen)
Részletes, lépésről-lépésre útmutató egy ingyenes, perzisztens Oracle Cloud VM-re
(valódi HTTPS-sel): lásd [`DEPLOY.md`](DEPLOY.md). A `deploy/` mappa kész systemd
service-t, Caddy konfigot és egy `setup.sh` telepítőt tartalmaz.

## Beépített biztonsági védelmek

- **Bejelentkezés:** JWT (8 órás lejárat), bcrypt-elt jelszavak (min. 8 karakter), rate-limit (10 próbálkozás / 15 perc / IP).
- **XSS:** minden felhasználói adat escape-elve renderelődik; szigorú Content-Security-Policy.
- **Input-validáció:** szerveroldali ellenőrzés minden végponton (email-formátum, hossz-
  limitek, dátum/idő formátum, múltbeli időpont tiltása, max. 120 nappal előre foglalás), 64 kB kérés-limit.
- **Foglalás-spam ellen:** rate-limit a foglalásra (6/10 perc/IP) és a naptár-lekérdezésre (60/perc/IP);
  a dupla-foglalást adatbázis-szintű UNIQUE index is megakadályozza.
- **HTTP fejlécek:** `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, CSP.

## Adatbázis

SQLite, a `barber.db` fájlban (gitignore-olt, nem kerül verziókezelésbe). Táblák:
`services`, `working_hours`, `bookings`, `settings`, `admin_users`. A séma és az
alap-adatok az első indításkor jönnek létre (lásd `db.js`).

## E-mail visszaigazolás (jelenleg nincs)

A rendszer **nem küld** e-mailt; a foglalás „visszaigazolásra vár" állapotban kerül be,
és az admin a panelen erősíti meg vagy utasítja el. Ha később kell e-mailes értesítés
(vendégnek és/vagy adminnak), az a foglalást rögzítő ágba (`server.js`,
`POST /api/bookings`) illeszthető be egy SMTP-küldővel (pl. Nodemailer) — ehhez az
üzlet saját e-mail fiókja és app-jelszava szükséges.

## Projektstruktúra

```
server.js            Express szerver, API, biztonság (rate-limit, CSP, validáció)
db.js                SQLite séma + alap-adatok + admin létrehozás
public/
  index.html         Vendég főoldal
  script.js          Vendég logika (naptár, foglalás)
  admin.html         Admin panel
  admin.js           Admin logika
  login.html/.js     Admin bejelentkezés
  style.css          Stílusok (vendég + admin közös)
.env.example         Környezeti változók sablonja
```
