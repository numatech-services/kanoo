#!/bin/bash
# ============================================================
# Kanoo — Setup initial VPS Hostinger (Ubuntu 22.04)
# À exécuter UNE SEULE FOIS en root après achat du VPS
# Usage : bash setup-vps.sh
# ============================================================

set -euo pipefail

DOMAIN="${DOMAIN:-votre-domaine.ne}"
APP_USER="kanoo"
APP_DIR="/var/www/kanoo"
NODE_VERSION="20"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Kanoo — Setup VPS Hostinger        ║"
echo "║   Domaine : $DOMAIN"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Mise à jour système ───────────────────────────────────────────────────
echo "📦 [1/10] Mise à jour du système…"
apt-get update -qq && apt-get upgrade -y -qq

# ── 2. Paquets essentiels ────────────────────────────────────────────────────
echo "📦 [2/10] Installation des paquets…"
apt-get install -y -qq \
  curl wget git unzip \
  nginx certbot python3-certbot-nginx \
  fail2ban ufw \
  mongodb-org-tools \
  logrotate

# ── 3. Node.js via NVM ──────────────────────────────────────────────────────
echo "📦 [3/10] Installation de Node.js $NODE_VERSION…"
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt-get install -y -qq nodejs
node -v && npm -v

# ── 4. PM2 global ───────────────────────────────────────────────────────────
echo "📦 [4/10] Installation de PM2…"
npm install -g pm2 tsx typescript
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

# ── 5. Utilisateur applicatif ────────────────────────────────────────────────
echo "👤 [5/10] Création utilisateur $APP_USER…"
useradd -m -s /bin/bash "$APP_USER" 2>/dev/null || echo "  Utilisateur existant"
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
mkdir -p /var/log/pm2
chown -R "$APP_USER:$APP_USER" /var/log/pm2

# ── 6. Firewall UFW ─────────────────────────────────────────────────────────
echo "🔒 [6/10] Configuration firewall…"
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "  Firewall actif : SSH + HTTP + HTTPS"

# ── 7. Fail2ban ─────────────────────────────────────────────────────────────
echo "🔒 [7/10] Configuration Fail2ban…"
cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
systemctl enable fail2ban --quiet
systemctl start fail2ban

# ── 8. Nginx ────────────────────────────────────────────────────────────────
echo "🌐 [8/10] Configuration Nginx…"
cp /var/www/kanoo/deploy/nginx.conf /etc/nginx/sites-available/kanoo
sed -i "s/votre-domaine.ne/$DOMAIN/g" /etc/nginx/sites-available/kanoo
ln -sf /etc/nginx/sites-available/kanoo /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── 9. Let's Encrypt HTTPS ──────────────────────────────────────────────────
echo "🔐 [9/10] Certificat SSL Let's Encrypt…"
certbot --nginx \
  -d "$DOMAIN" \
  -d "www.$DOMAIN" \
  --non-interactive \
  --agree-tos \
  --email "admin@$DOMAIN" \
  --redirect
systemctl enable certbot.timer

# ── 10. Logrotate ────────────────────────────────────────────────────────────
echo "📋 [10/10] Configuration logrotate…"
cat > /etc/logrotate.d/kanoo << 'LOGEOF'
/var/log/pm2/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 kanoo kanoo
    sharedscripts
    postrotate
        pm2 reloadLogs
    endscript
}
LOGEOF

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   ✅ Setup VPS terminé !                 ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Prochaines étapes :"
echo "  1. Déposer votre code dans $APP_DIR"
echo "  2. Créer $APP_DIR/.env.local avec vos variables"
echo "  3. Exécuter : bash deploy/deploy.sh"
echo ""
