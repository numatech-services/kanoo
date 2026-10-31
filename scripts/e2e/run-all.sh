#!/usr/bin/env bash
# Joue les scénarios de bout en bout contre une instance déjà démarrée sur le
# port 3099 (npm run build && npx next start -p 3099), base de TEST vidée et
# réensemencée avant chaque scénario. Jamais contre la production : la base
# est supprimée.
#
# Usage : bash scripts/e2e/run-all.sh [scénario…]   (défaut : tous)
# Variables : MONGODB_URI (base jetable), CRON_SECRET, BACKUP_DIR, BACKUP_ENCRYPTION_KEY.
set -uo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
case "${MONGODB_URI:-}" in
  *e2e*|*test*) ;;
  *) echo "MONGODB_URI doit désigner une base de test (nom contenant « e2e » ou « test »)."; exit 2 ;;
esac
SCENARIOS=("$@")
if [ ${#SCENARIOS[@]} -eq 0 ]; then
  SCENARIOS=(e2e-design e2e-compta e2e-flux e2e-org e2e-complet e2e-stock e2e-marche e2e-portail e2e-lot1 e2e-lot2 e2e-lot3 e2e-lot4 e2e-automations e2e-lotE e2e-mobile e2e-paie e2e-securite e2e-h1 e2e-h2 e2e-h3 e2e-h4 e2e-spot e2e-spot2 e2e-campus e2e-easypay e2e-coherence e2e-docs e2e-exportfin e2e-pilotage e2e-easypay-v1 e2e-restaurant)
fi
failed=0
for sc in "${SCENARIOS[@]}"; do
  node -e 'const m=require("mongoose");m.connect(process.env.MONGODB_URI).then(()=>m.connection.db.dropDatabase()).then(()=>m.disconnect())'
  [ -n "${BACKUP_DIR:-}" ] && rm -rf "$BACKUP_DIR"
  if ! npx tsx scripts/seed-test.ts > "/tmp/seed-$sc.log" 2>&1; then echo "✗ $sc : ensemencement en échec"; tail -5 "/tmp/seed-$sc.log"; failed=1; continue; fi
  if node "scripts/e2e/$sc.mjs" "$ROOT" > "/tmp/$sc.log" 2>&1; then
    echo "✓ $sc : $(tail -1 "/tmp/$sc.log")"
  else
    echo "✗ $sc : $(tail -1 "/tmp/$sc.log")"; grep "✗" "/tmp/$sc.log" | head -20; failed=1
  fi
done
exit $failed
