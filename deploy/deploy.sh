#!/bin/bash
# ============================================================
# Kanoo — Script de déploiement
# À exécuter depuis le répertoire du projet sur le VPS
# Usage : bash deploy/deploy.sh [--skip-backup]
# ============================================================

set -euo pipefail

APP_DIR="/var/www/kanoo"
LOG_FILE="/var/log/kanoo-deploy.log"
SKIP_BACKUP="${1:-}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log() { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] ⚠️  $1${NC}" | tee -a "$LOG_FILE"; }
error() { echo -e "${RED}[$(date '+%H:%M:%S')] ❌ $1${NC}" | tee -a "$LOG_FILE"; exit 1; }

cd "$APP_DIR"

echo "" | tee -a "$LOG_FILE"
log "════════════════════════════════════════"
log "   Kanoo — Déploiement $(date '+%Y-%m-%d %H:%M')"
log "════════════════════════════════════════"

# ── 0. Vérifier .env.local ────────────────────────────────────────────────────
[ -f ".env.local" ] || error ".env.local manquant — créez-le depuis .env.example"
grep -q "MONGODB_URI=" .env.local || error "MONGODB_URI absent de .env.local"
grep -q "JWT_SECRET=" .env.local || error "JWT_SECRET absent de .env.local"

# ── 1. Backup pré-déploiement ─────────────────────────────────────────────────
if [ "$SKIP_BACKUP" != "--skip-backup" ]; then
  log "[1/7] Backup pré-déploiement…"
  npm run backup:predeploy 2>&1 | tee -a "$LOG_FILE" || warn "Backup échoué — déploiement continué"
else
  warn "[1/7] Backup ignoré (--skip-backup)"
fi

# ── 2. Pull du code ───────────────────────────────────────────────────────────
log "[2/7] Pull Git…"
git fetch --all 2>&1 | tee -a "$LOG_FILE"
git reset --hard origin/main 2>&1 | tee -a "$LOG_FILE"
log "  Commit : $(git log --oneline -1)"

# ── 3. Vérification env ───────────────────────────────────────────────────────
log "[3/7] Vérification des variables d'environnement…"
npm run check:env 2>&1 | tee -a "$LOG_FILE" || error "Variables d'environnement manquantes"

# ── 4. Installation des dépendances ──────────────────────────────────────────
log "[4/7] npm ci (production)…"
npm ci --only=production 2>&1 | tee -a "$LOG_FILE"

# ── 5. Build Next.js ──────────────────────────────────────────────────────────
log "[5/7] Build Next.js…"
NODE_ENV=production npm run build 2>&1 | tee -a "$LOG_FILE" || error "Build échoué"

# ── 6. Vérification du dossier standalone ─────────────────────────────────────
[ -d ".next/standalone" ] || error ".next/standalone absent — vérifiez output: 'standalone' dans next.config.mjs"
cp -r public .next/standalone/public 2>/dev/null || true
cp -r .next/static .next/standalone/.next/static 2>/dev/null || true

# ── 7. Redémarrage PM2 ───────────────────────────────────────────────────────
log "[6/7] Redémarrage de l'application…"
if pm2 describe kanoo > /dev/null 2>&1; then
  pm2 reload kanoo --update-env 2>&1 | tee -a "$LOG_FILE"
else
  pm2 start deploy/ecosystem.config.js --env production 2>&1 | tee -a "$LOG_FILE"
fi

# Redémarrer le scheduler
if pm2 describe kanoo-scheduler > /dev/null 2>&1; then
  pm2 reload kanoo-scheduler 2>&1 | tee -a "$LOG_FILE"
fi

pm2 save 2>&1 | tee -a "$LOG_FILE"

# ── 8. Sanity check ───────────────────────────────────────────────────────────
log "[7/7] Vérification post-déploiement…"
sleep 5

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/health" 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" = "200" ]; then
  log "✅ Application opérationnelle (HTTP 200)"
elif [ "$HTTP_STATUS" = "401" ]; then
  log "✅ Application opérationnelle (API protégée, HTTP 401 normal)"
else
  warn "Application peut-être instable (HTTP $HTTP_STATUS) — vérifiez pm2 logs"
fi

echo "" | tee -a "$LOG_FILE"
log "════════════════════════════════════════"
log "   ✅ Déploiement terminé"
log "   Durée : $((SECONDS))s"
log "════════════════════════════════════════"
echo ""
echo "Commandes utiles :"
echo "  pm2 logs kanoo     → logs en temps réel"
echo "  pm2 status             → état des processus"
echo "  pm2 restart kanoo  → redémarrage manuel"
