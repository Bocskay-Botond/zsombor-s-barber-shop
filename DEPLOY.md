# Telepítés — Oracle Cloud „Always Free" VM

Ez az útmutató végigvezet, hogyan tedd publikussá a Zsombor's Barber Shop appot
**ingyen, perzisztens adatbázissal**, egy Oracle Cloud örökre-ingyenes virtuális gépen,
valódi HTTPS-sel.

Eredmény: `https://sajatdomain.duckdns.org` — a foglalások a VM lemezén maradnak, a gép 0 Ft.

A folyamat 4 szakasz: **(1) VM létrehozása → (2) hálózat/tűzfal → (3) ingyenes domain → (4) telepítés egy paranccsal.**

---

## 1. Oracle Cloud fiók + VM létrehozása  (a böngésződben)

1. Regisztrálj: https://www.oracle.com/cloud/free/ → „Start for free".
   - Bankkártya kell az azonosításhoz, de az **Always Free** erőforrások nem terhelnek.
   - Tipp: a régiót jól válaszd meg (közeli, pl. Frankfurt) — később nem módosítható.
2. A konzolban: **Compute → Instances → Create Instance**.
   - **Image:** Canonical **Ubuntu 22.04** (vagy 24.04) LTS.
   - **Shape:** válassz **Always Free eligible**-t:
     - **VM.Standard.A1.Flex** (ARM Ampere) — akár 4 OCPU / 24 GB ingyen, bőven elég. *(Ha „out of capacity" hibát ad, próbáld később, vagy másik availability domaint.)*
     - vagy **VM.Standard.E2.1.Micro** (AMD, 1 GB) — kisebb, de mindig elérhető.
   - **SSH kulcs:** töltsd fel a publikus kulcsodat (a gépeden:
     `~/.ssh/id_ed25519.pub` tartalma), vagy generáltass a konzolban és töltsd le a privátot.
   - Create. Pár perc múlva lesz egy **Public IP** (jegyezd fel).

> A meglévő SSH kulcsod: a CLAUDE.md szerint `C:\Users\36307\.ssh\id_ed25519` — ennek a
> `.pub` párját töltsd fel.

---

## 2. Hálózat / tűzfal — a 80 és 443 port megnyitása

Két helyen kell engedélyezni (mindkettő szükséges!):

**a) Oracle webkonzol — VCN Security List (ingress):**
- Networking → Virtual Cloud Networks → a VCN-ed → Security Lists → Default Security List
- **Add Ingress Rules**, kétszer:
  - Source `0.0.0.0/0`, IP Protocol TCP, Destination Port `80`
  - Source `0.0.0.0/0`, IP Protocol TCP, Destination Port `443`

**b) A VM-en belüli iptables** — ezt a `setup.sh` automatikusan megnyitja (lásd 4. lépés).

---

## 3. Ingyenes domain (a valódi HTTPS-hez)

A Let's Encrypt tanúsítványhoz domain kell (nyers IP-re nem ad certet). Ingyenes megoldás:

1. Menj a https://www.duckdns.org -ra, lépj be (Google/GitHub).
2. Hozz létre egy aldomaint, pl. `zsomborbarber` → `zsomborbarber.duckdns.org`.
3. Az **current ip** mezőbe írd be a VM publikus IP-jét, és mentsd (Update).

*(Ha van saját domained, azt is használhatod: egy A rekord mutasson a VM IP-jére.)*

---

## 4. Telepítés a VM-en — egyetlen parancs

SSH-zz be (a saját kulcsoddal és a VM IP-jével):

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@<VM_PUBLIC_IP>
```

Majd:

```bash
sudo apt-get update
git clone https://github.com/Bocskay-Botond/zsombor-s-barber-shop.git
cd zsombor-s-barber-shop
git checkout claude/project-exploration-icYM5    # vagy main, ha már odamergelted
bash deploy/setup.sh zsomborbarber.duckdns.org   # a SAJÁT domaineddel!
```

A `setup.sh` elvégzi: Node 20 + Caddy telepítése, `npm install`, erős `JWT_SECRET`
generálása `.env`-be, az app systemd service-ként való indítása (boot után auto-indul),
Caddy beállítása automatikus HTTPS-sel, és a tűzfal 80/443 megnyitása.

### Az admin jelszó kiolvasása (első indítás)
```bash
sudo journalctl -u zsombor-barber -n 40 --no-pager
```
Keresd az „ELSŐ INDÍTÁS — admin fiók létrehozva" blokkot. Jelentkezz be a
`https://sajatdomain.duckdns.org/login` oldalon, és **azonnal változtasd meg a jelszót**
a Beállításoknál.

---

## Üzemeltetés

| Művelet | Parancs |
|---|---|
| Állapot | `systemctl status zsombor-barber` |
| Logok | `journalctl -u zsombor-barber -f` |
| Újraindítás | `sudo systemctl restart zsombor-barber` |
| Frissítés (új kód) | `cd ~/zsombor-s-barber-shop && git pull && npm install --omit=dev && sudo systemctl restart zsombor-barber` |
| Adatmentés | másold le a `barber.db`, `barber.db-wal`, `barber.db-shm` fájlokat |

## Hibakeresés

- **Nem jön be a site / nincs HTTPS:** ellenőrizd, hogy a DuckDNS IP a VM-re mutat-e,
  és hogy **mindkét** tűzfal (Oracle Security List ÉS iptables) nyitva van-e a 80/443-on.
  Caddy log: `journalctl -u caddy -f`.
- **„out of capacity" az ARM shape-nél:** válts E2.1.Micro-ra, vagy próbáld később/más
  availability domainben.
- **Az app fut, de 502:** `systemctl status zsombor-barber` — valószínűleg a Node nem
  indult; nézd a logot.

## Biztonsági emlékeztető

A `setup.sh` `TRUST_PROXY=true`-t állít (helyes, mert Caddy a reverse proxy → a rate-limit
a valódi kliens-IP-ket látja). A `.env` `chmod 600`. Éles üzemben tartsd frissen a rendszert
(`sudo apt-get update && sudo apt-get upgrade`).
