# GO-LIVE CHECKLIST — Kanoo

## 1. ENVIRONNEMENT & INFRASTRUCTURE

- [ ] Node.js 18+ installé sur le serveur
- [ ] MongoDB 6+ en replica set (transactions)
- [ ] `.env` configuré avec toutes les variables obligatoires
- [ ] `JWT_SECRET` ≥ 32 caractères aléatoires en production
- [ ] `APP_BASE_URL` défini (ex: https://app.kanoo.ne)
- [ ] HTTPS configuré (certificat SSL valide)
- [ ] Firewall : ports 3000 (app) et 27017 (MongoDB local uniquement)
- [ ] PM2 ou équivalent pour process management

## 2. VÉRIFICATIONS CODE

- [ ] `npm run typecheck` — 0 erreur TypeScript
- [ ] `npm run lint` — 0 warning critique
- [ ] `npm run test` — tous les tests passent
- [ ] `npm run build` — build production réussit

## 3. BASE DE DONNÉES

- [ ] Seed initial chargé : `npm run seed:demo`
- [ ] Index MongoDB créés (automatique via Mongoose)
- [ ] Backup automatique configuré (cron mongodump)
- [ ] Test de restore vérifié

## 4. SÉCURITÉ

- [ ] Headers sécurité vérifiés (X-Frame-Options, HSTS, CSP...)
- [ ] Rate limiting actif sur `/api/auth/login` (10 req/min)
- [ ] CSRF tokens fonctionnels
- [ ] Mode READ_ONLY testé
- [ ] Pas de `console.log` contenant des données sensibles en production
- [ ] `.env` exclu de Git (`.gitignore`)
- [ ] Rotation JWT_SECRET planifiée

## 5. FONCTIONNEL — PME

- [ ] Login / logout fonctionnel
- [ ] Création client → devis → facture → paiement (flux complet)
- [ ] Écriture comptable automatique sur facture et paiement
- [ ] Déclaration TVA générée (PDF et JSON)
- [ ] Bordereau CNSS trimestriel généré
- [ ] Import CSV clients fonctionnel
- [ ] Export PDF facture avec mentions légales Niger

## 6. FONCTIONNEL — ASSOCIATIONS

- [ ] Création adhérent et paiement cotisation
- [ ] Génération reçu de cotisation
- [ ] Enregistrement don avec reçu fiscal
- [ ] Convocation AG créée

## 7. FONCTIONNEL — ADMINISTRATIONS

- [ ] Saisie budget par chapitres
- [ ] Contrôle crédit avant engagement (doit bloquer si insuffisant)
- [ ] Création appel d'offres (procédure auto selon seuils Niger)
- [ ] Engagement budgétaire lié à un marché

## 8. MULTI-TENANT

- [ ] Isolation données : un tenant ne voit pas les données d'un autre
- [ ] Superadmin peut voir tous les tenants
- [ ] Abonnement suspendu → accès bloqué correctement
- [ ] Plan / modules respectés (accès limité selon plan)

## 9. MONITORING

- [ ] `/api/health` retourne `{"status":"ok"}`
- [ ] Logs applicatifs centralisés (PM2 logs ou Loki)
- [ ] Alertes erreurs configurées (email ou Slack)
- [ ] Scheduler démarré (`npm run scheduler`)

## 10. DOCUMENTATION

- [ ] README.md à jour
- [ ] Variables d'environnement documentées
- [ ] Procédure de déploiement documentée
- [ ] Contacts support notifiés
