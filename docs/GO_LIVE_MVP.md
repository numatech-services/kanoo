# Plan de lancement MVP — Kanoo
## Objectif : live en 4 semaines

> Horizon : **moins d'1 mois** · Infrastructure : **Hostinger VPS** · Mode : **MVP minimal, on corrige après**

---

## Semaine 1 — Infrastructure & déploiement (J1→J7)

### J1 — VPS Hostinger
- [ ] Acheter un VPS Hostinger KVM2 ou KVM4 (4GB RAM minimum recommandé)
- [ ] Se connecter en SSH : `ssh root@votre-ip`
- [ ] Cloner le dépôt : `git clone <repo> /var/www/kanoo`
- [ ] Lancer le setup : `bash /var/www/kanoo/deploy/setup-vps.sh`
- [ ] Vérifier Nginx : `nginx -t && systemctl status nginx`

### J2 — Variables d'environnement
Créer `/var/www/kanoo/.env.local` :
```env
# Obligatoires
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/kanoo
JWT_SECRET=une-chaine-aleatoire-minimum-64-caracteres-generez-avec-openssl-rand-hex-32

# Application
APP_BASE_URL=https://votre-domaine.ne
NODE_ENV=production

# Email (Mailgun ou SMTP gratuit)
EMAIL_PROVIDER=console          # console = pas d'envoi réel (MVP)
EMAIL_FROM=noreply@votre-domaine.ne

# SMS (désactivé MVP)
SMS_PROVIDER=console

# Optionnel — activer si MongoDB Atlas M10+
# MONGO_NO_TRANSACTIONS=false
```

- [ ] Vérifier : `npm run check:env`

### J3-J4 — MongoDB Atlas
- [ ] Créer un cluster Atlas M0 (gratuit) ou M10 (PITR)
- [ ] Whitelist l'IP du VPS dans Atlas Network Access
- [ ] Créer un utilisateur DB avec rôle `readWrite`
- [ ] Tester la connexion : `mongosh "$MONGODB_URI" --eval "db.stats()"`

### J5 — Premier déploiement
```bash
cd /var/www/kanoo
bash deploy/deploy.sh --skip-backup   # Premier déploiement, pas encore de données
```
- [ ] Vérifier : `curl https://votre-domaine.ne/api/health`
- [ ] Tester la connexion : ouvrir `https://votre-domaine.ne/login`

### J6 — Seed de démonstration
```bash
cd /var/www/kanoo
npm run seed:demo
```
Comptes créés :
- `admin@demo.ne` / `demo1234` (PME admin)
- `president@asso.ne` / `demo1234` (Association)
- `superadmin@demo.ne` / `demo1234` (Superadmin)

### J7 — Tests smoke
- [ ] Se connecter avec chaque compte
- [ ] Créer un client test
- [ ] Créer une facture test
- [ ] Vérifier le PDF
- [ ] Vérifier les emails (logs console si `EMAIL_PROVIDER=console`)

---

## Semaine 2 — Données réelles & paramétrages (J8→J14)

### J8-J9 — Paramétrage du premier tenant réel
1. Inscription via `https://votre-domaine.ne/souscrire`
2. Activer le compte via superadmin : `https://votre-domaine.ne/saas/tenants`
3. Configurer le branding (logo, couleurs) : `/companies`
4. Configurer la numérotation des documents : `/settings/numbering`

### J10-J11 — Import des données existantes
Si le client a des données à migrer :
```bash
# Export depuis l'ancien système (CSV)
# Import via API ou script personnalisé

# Exemple import clients CSV → API :
node scripts/import-clients.js clients.csv  # à créer si besoin
```

Paramètre migration numérotation :
- Aller dans `/settings/numbering`
- Saisir le "Prochain numéro de facture" = dernier numéro existant + 1

### J12-J13 — Formation utilisateurs
- [ ] Présentation tableau de bord (2h)
- [ ] Facturation : clients → devis → factures (1h)
- [ ] RH : créer des employés, générer un bulletin de paie (1h)
- [ ] Comptabilité : lettrage, fiscalité TVA (1h)

### J14 — Buffer corrections
- [ ] Corriger les retours utilisateurs semaine 1-2
- [ ] Ajuster les préfixes, le plan comptable si nécessaire

---

## Semaine 3 — Stabilisation (J15→J21)

### Vérifications journalières
```bash
# Logs applicatifs
pm2 logs kanoo --lines 100

# Santé de la base
mongosh "$MONGODB_URI" --eval "db.adminCommand('ping')"

# Espace disque
df -h

# Mémoire
free -h && pm2 status
```

### J15 — Activer les backups automatiques
```bash
# Ajouter dans crontab
crontab -e
# Ajouter :
0 1 * * * cd /var/www/kanoo && npm run backup >> /var/log/kanoo-backup.log 2>&1
```

### J17 — Activer l'envoi d'emails réels (optionnel)
Remplacer `EMAIL_PROVIDER=console` par votre fournisseur SMTP.
Options gratuites pour MVP : Brevo (300 emails/jour), Mailgun, Gmail SMTP.

### J19 — Test hors-ligne
- [ ] Couper le réseau du téléphone / simuler panne
- [ ] Créer une facture hors-ligne
- [ ] Rétablir la connexion → vérifier la synchronisation
- [ ] Vérifier la bannière OfflineBanner

---

## Semaine 4 — Go-live (J22→J30)

### J22 — Checklist sécurité finale
- [ ] `JWT_SECRET` est bien une chaîne aléatoire de 64+ caractères
- [ ] MongoDB n'écoute pas sur 0.0.0.0 (Atlas = OK par défaut)
- [ ] Firewall : seuls ports 22, 80, 443 ouverts (`ufw status`)
- [ ] Fail2ban actif (`fail2ban-client status`)
- [ ] HTTPS avec A+ sur ssllabs.com

### J23 — Performance
```bash
# Test de charge léger (Hostinger KVM2 = 2 vCPU, 2GB RAM)
ab -n 100 -c 10 https://votre-domaine.ne/api/health
# Objectif : < 200ms par requête en moyenne
```

### J25 — Communication aux clients
- [ ] Email d'invitation avec identifiants
- [ ] Guide de démarrage rapide (PDF 1 page)
- [ ] Numéro WhatsApp support

### J28 — Première facturation Kanoo
- [ ] Passer les premiers tenants de `trial` à `active` via superadmin
- [ ] Vérifier les abonnements : `/saas/billing`

### J30 — Bilan semaine 1 en production
- [ ] Nb de tenants actifs
- [ ] Nb de factures créées
- [ ] Erreurs dans les logs (`pm2 logs kanoo --err --lines 500`)
- [ ] Créer le backlog des corrections V1.1

---

## Ce qu'on reporte à V1.1 (post-lancement)

| Feature | Raison du report |
|---|---|
| Envoi SMS réel | Intégration Orange Money complexe, utiliser email pour MVP |
| Portail citoyen (administration) | Moins prioritaire, portail fournisseur suffit |
| Synchronisation bancaire | Dépendance externe, post-lancement |
| Export SAGE automatisé | Disponible mais non testé, documenter le CSV manuel |
| IR progressif sur bulletins | SMIG + CNSS suffisent pour MVP |
| Signature certifiée UEMOA | Signature simple (canvas) suffit MVP |
| API publique pour partenaires | Disponible, pas encore documentée ni testée |
| Multi-langue EN complet | FR-only suffisant pour lancement Niger |
| Portail adhérent avancé (cotisations en ligne) | La vue est là, sans paiement en ligne |

---

## Contacts d'urgence

| Qui | Quand |
|---|---|
| Support Hostinger : hpanel.hostinger.com | Problème VPS / réseau |
| Support Atlas : cloud.mongodb.com | Problème base de données |
| Certbot : `certbot renew --dry-run` | Certificat SSL expiré |

---

## Commandes de dépannage rapide

```bash
# Application plantée
pm2 restart kanoo

# Voir les erreurs
pm2 logs kanoo --err --lines 50

# Redéployer sans backup
bash deploy/deploy.sh --skip-backup

# Restaurer une sauvegarde d'urgence
ls -lt backups/ | head -5
mongorestore --uri="$MONGODB_URI" --drop --gzip backups/kanoo-XXXX.gz

# Nginx ne démarre pas
nginx -t         # Voir l'erreur
systemctl restart nginx

# Certificat SSL
certbot renew
systemctl restart nginx
```

---

## Devise

**V1 : XOF uniquement.** Toutes les factures, bulletins de paie, cotisations et rapports sont en XOF (Franc CFA BCEAO).

Pour les ONG qui reçoivent des fonds en EUR ou USD (AFD, USAID, UE) : saisir le montant converti en XOF à la date de réception. Le taux de conversion peut être noté dans le champ "Notes" de la facture ou du don.

Multi-devises prévu en V2 (après retours terrain).
