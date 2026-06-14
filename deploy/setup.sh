#!/usr/bin/env bash
# Egylépéses telepítő egy friss Oracle Cloud "Always Free" Ubuntu VM-re.
# Futtatás a repo gyökeréből:   bash deploy/setup.sh <domain>
# Példa:                        bash deploy/setup.sh zsomborbarber.duckdns.org
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="$(whoami)"

if [ -z "$DOMAIN" ]; then
  echo "Használat: bash deploy/setup.sh <domain>   (pl. zsomborbarber.duckdns.org)"
  exit 1
fi

echo "==> Node.js 20 + build eszközök + git"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential git

echo "==> Caddy (automatikus HTTPS reverse proxy)"
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt-get update
sudo apt-get install -y caddy

echo "==> npm függőségek"
cd "$APP_DIR"
npm install --omit=dev

echo "==> .env (erős JWT_SECRET, csak ha még nincs)"
if [ ! -f "$APP_DIR/.env" ]; then
  JWT="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
  cat > "$APP_DIR/.env" <<EOF
PORT=3000
JWT_SECRET=$JWT
TRUST_PROXY=true
EOF
  chmod 600 "$APP_DIR/.env"
  echo "    .env létrehozva."
else
  echo "    .env már létezik — nem írom felül."
fi

echo "==> systemd service (auto-indul boot után, összeomlás után újraindul)"
sudo cp "$APP_DIR/deploy/zsombor-barber.service" /etc/systemd/system/zsombor-barber.service
sudo sed -i "s#/home/ubuntu/zsombor-s-barber-shop#$APP_DIR#g; s/^User=ubuntu/User=$USER_NAME/" /etc/systemd/system/zsombor-barber.service
sudo systemctl daemon-reload
sudo systemctl enable --now zsombor-barber

echo "==> Caddy konfiguráció: $DOMAIN -> localhost:3000"
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOMAIN {
    reverse_proxy localhost:3000
}
EOF
sudo systemctl reload caddy

echo "==> Tűzfal: 80 és 443 megnyitása (Oracle Ubuntu iptables)"
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT || true
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT || true
sudo netfilter-persistent save 2>/dev/null || echo "    (figyelem: netfilter-persistent nincs — ellenőrizd a tűzfalat kézzel)"

echo
echo "============================================================"
echo " KÉSZ. Ellenőrzés:"
echo "   sudo journalctl -u zsombor-barber -n 40 --no-pager"
echo "     ^ itt látod az ELSŐ INDÍTÁS admin jelszavát"
echo "   Böngészőben: https://$DOMAIN   (a TLS-cert 1-2 percen belül kiépül)"
echo
echo " NE FELEDD: az Oracle webkonzolban is engedélyezd a 80 és 443"
echo " ingress portot a VCN Security List-ben (0.0.0.0/0)!"
echo "============================================================"
