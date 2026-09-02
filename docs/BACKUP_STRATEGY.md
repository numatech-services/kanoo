# Stratégie de Backup & Continuité — Kanoo

## Architecture choisie

| Niveau | Méthode | Fréquence | Rétention |
|--------|---------|-----------|-----------|
| **Automatique** | `npm run backup` (cron) | Quotidien 02:00 Niamey | 30 jours |
| **Pré-déploiement** | `npm run backup:predeploy` | Avant chaque MEP | 90 jours |
| **Atlas PITR** | Point-in-Time Recovery natif | Continu (si Atlas M10+) | 7 jours |
| **Export manuel** | Superadmin → Exports | Ad hoc | Illimité (local) |

---

## 1. Backup automatique quotidien

### Via script local (VPS / serveur dédié)

```bash
# Installer la commande dans la crontab (UTC+1 = Niamey)
# 0 1 * * * = 02:00 heure Niamey
crontab -e
# Ajouter :
0 1 * * * cd /app && npm run backup >> /var/log/kanoo-backup.log 2>&1
```

### Variables d'environnement

```env
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/kanoo
BACKUP_PATH=/data/backups          # Chemin stockage backups
BACKUP_RETENTION_DAYS=30           # Durée de rétention en jours
```

### Vérifier que mongodump est installé

```bash
mongodump --version
# Si absent :
apt-get install -y mongodb-database-tools   # Ubuntu/Debian
```

---

## 2. Point-in-Time Recovery (PITR) — MongoDB Atlas

Requis : cluster **M10 ou supérieur** sur Atlas.

### Activer PITR

1. Aller dans Atlas → votre cluster → **Backup**
2. Activer **Continuous Cloud Backup**
3. Définir la fenêtre PITR : **7 jours** (recommandé)

### Restaurer à un instant T

```
Atlas → Backups → Restore → Point-in-Time
→ Choisir la date et l'heure exactes
→ Restaurer vers un cluster cible (JAMAIS directement en production)
→ Vérifier → basculer le DNS
```

### Coût indicatif (Atlas M10, région EU/Afrique)

- M10 : ~57 USD/mois
- Backup continu inclus à partir de M10
- Snapshots quotidiens automatiques

---

## 3. Backup pré-déploiement

```bash
# Exécuter avant chaque mise en production
npm run backup:predeploy

# Ou dans votre CI/CD (GitHub Actions exemple) :
# - name: Pre-deploy backup
#   run: npm run backup:predeploy
#   env:
#     MONGODB_URI: ${{ secrets.MONGODB_URI }}
```

Le script crée un snapshot horodaté et bloque le déploiement si le backup échoue.

---

## 4. Procédure de restauration

### Restauration rapide depuis un backup local

```bash
# 1. Lister les backups disponibles
ls -lh backups/

# 2. Extraire le backup
tar -xzf backups/kanoo-2025-12-01T01-00-00.gz -C /tmp/restore/

# 3. Restaurer (ATTENTION : écrase la base existante)
mongorestore --uri="$MONGODB_URI" \
  --drop \
  --gzip \
  /tmp/restore/kanoo-2025-12-01T01-00-00/

# 4. Vérifier
mongosh "$MONGODB_URI" --eval "db.stats()"
```

### Checklist post-restauration

- [ ] Vérifier le nombre de tenants (`db.tenants.countDocuments()`)
- [ ] Vérifier le nombre d'utilisateurs actifs
- [ ] Tester une connexion avec un compte admin
- [ ] Vérifier les dernières factures créées
- [ ] Confirmer l'intégrité des écritures comptables

---

## 5. Stockage externe des backups (recommandé)

En production, ne pas stocker les backups sur le même serveur.

### Option A — Rclone vers S3 / OVH Object Storage

```bash
# Installer rclone
# Configurer rclone.conf avec votre provider
rclone copy /data/backups/ remote:kanoo-backups/ --min-age 1m
```

### Option B — SFTP vers serveur secondaire

```bash
rsync -avz /data/backups/ backup-server:/backups/kanoo/
```

### Option C — Atlas natif (le plus simple)

Si vous utilisez MongoDB Atlas M10+, les snapshots sont automatiquement répliqués sur l'infrastructure Atlas. Aucune configuration supplémentaire requise.

---

## 6. Objectifs de récupération

| Indicateur | Objectif | Méthode |
|---|---|---|
| **RPO** (perte de données max) | 24h (backup quotidien) / 1h (Atlas PITR) | Cron + Atlas |
| **RTO** (temps de restauration) | < 2h | Procédure documentée ci-dessus |
| **Disponibilité cible** | 99,5% | Monitoring + alertes |

---

## 7. Test de restauration (à faire trimestriellement)

```bash
# Sur un environnement de test isolé :
MONGODB_URI_TEST="mongodb://localhost:27017/kanoo_restore_test" \
  mongorestore --uri="$MONGODB_URI_TEST" --drop /tmp/restore/...

# Lancer les tests d'intégrité
npm run test:ci
```

**Important** : Ne jamais tester une restauration directement en production.

---

## 8. Commandes npm disponibles

```json
"scripts": {
  "backup":           "ts-node scripts/backup.ts",
  "backup:predeploy": "ts-node scripts/backup.ts --pre-deploy"
}
```

Ajouter ces scripts dans `package.json` si ce n'est pas déjà fait.

---

## 9. Alertes en cas d'échec backup

Le script `backup.ts` sort avec un code d'erreur non-zéro en cas d'échec.

Dans votre crontab, ajouter une notification :

```bash
# Avec mail (si sendmail est configuré)
0 1 * * * cd /app && npm run backup || echo "BACKUP ECHOUE $(date)" | mail -s "Kanoo BACKUP FAILURE" admin@kanoo.ne
```

---

*Dernière mise à jour : automatique via scripts/backup.ts*
