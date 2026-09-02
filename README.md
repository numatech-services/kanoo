# Kanoo / NumaPilot

Plateforme SaaS de gestion pour le Niger — **PME**, **associations / ONG** et **administrations**. Facturation et devis conformes au CGI Niger (TVA 19 %, CNSS, IR, IS, retenues à la source, DTS), marchés publics (CMP 2017), paie, immobilisations et amortissements OHADA, trésorerie, CRM, billetterie d'événements avec QR et check-in, et bien plus.

> Éditée par **Numatech Services** · Production : https://numapilot.numatechservices.net

---

## Sommaire

- [Pile technique](#pile-technique)
- [Prérequis](#prérequis)
- [Installation rapide](#installation-rapide)
- [Variables d'environnement](#variables-denvironnement)
- [Scripts npm](#scripts-npm)
- [Structure du projet](#structure-du-projet)
- [Base de données & jeux de démo](#base-de-données--jeux-de-démo)
- [Tests](#tests)
- [Déploiement](#déploiement)
- [Application mobile](#application-mobile)
- [Sécurité & conformité](#sécurité--conformité)

---

## Pile technique

- **Next.js 14** (App Router) + **TypeScript** + **React 18**
- **MongoDB** via **Mongoose**
- Authentification maison par **JWT** (`jsonwebtoken` + `jose` pour l'Edge), mots de passe **bcrypt**, **2FA TOTP** (RFC 6238) et codes de secours
- **Tailwind CSS** — design system « Harmattan » piloté par variables CSS, mode sombre
- **PDFKit** (documents), **qrcode** / **html5-qrcode** (billetterie), **nodemailer** / Brevo (email), **node-cron** (tâches planifiées)
- Paiement mobile money **PayDunya**, notifications **WhatsApp** (Meta Cloud API / Twilio)
- Tests **Jest** + **ts-jest** (unitaires), Playwright (e2e) et k6 (charge)

---

## Prérequis

- **Node.js 18+** (l'image Docker utilise `node:18-alpine`)
- **npm** (le dépôt fournit un `package-lock.json`)
- Une instance **MongoDB** accessible (locale ou managée). Pour les transactions multi-documents, un *replica set* est requis ; en développement simple, poser `MONGO_NO_TRANSACTIONS=true`.

---

## Installation rapide

```bash
# 1. Dépendances
npm install

# 2. Configuration
cp .env.example .env
#   puis éditer .env (voir la section ci-dessous)

# 3. Vérifier que l'environnement est complet
npm run check:env

# 4. (optionnel) Peupler la base de démonstration
npm run seed:demo

# 5. Développement
npm run dev            # http://localhost:3000

# — ou — Production
npm run build
npm start
```

---

## Variables d'environnement

Le fichier `.env.example` fait référence. Les variables **essentielles** :

| Variable | Rôle | Obligatoire |
|---|---|---|
| `MONGODB_URI` | Chaîne de connexion MongoDB | ✅ |
| `JWT_SECRET` | Secret de signature des sessions (**≥ 32 caractères** en production) | ✅ |
| `APP_BASE_URL` | URL publique de l'application (liens, billets, e-mails) | ✅ |
| `FIELD_ENCRYPTION_KEY` | Clé AES-256-GCM (32 octets) pour le chiffrement des champs sensibles au repos. `openssl rand -hex 32`. À défaut, dérivée de `JWT_SECRET` | Recommandé |
| `TICKET_SECRET` | Secret de signature des QR de billets (≥ 32 caractères) | Billetterie |

Fonctionnalités **optionnelles** (restent en mode `console`/simulation tant qu'elles ne sont pas configurées) :

- **Email** : `EMAIL_PROVIDER` (`brevo` \| `smtp` \| `console`), `BREVO_API_KEY`, `EMAIL_FROM`
- **Paiement PayDunya** : `PAYDUNYA_MODE` (`test` \| `live`), `PAYDUNYA_MASTER_KEY`, `PAYDUNYA_PRIVATE_KEY`, `PAYDUNYA_TOKEN`
- **WhatsApp** : `WHATSAPP_PROVIDER` (`meta` \| `twilio` \| `console`) + jetons Meta (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`) ou Twilio (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`)
- **Divers** : `READ_ONLY` / `NEXT_PUBLIC_READ_ONLY` (mode démo lecture seule), `MONGO_NO_TRANSACTIONS`, `LOG_LEVEL`

> ⚠️ Ne jamais committer un vrai `.env`. Générer des secrets aléatoires forts en production :
> `openssl rand -hex 32`.

---

## Scripts npm

| Script | Description |
|---|---|
| `npm run dev` | Serveur de développement (hot reload) |
| `npm run build` | Build de production |
| `npm start` | Démarre le build de production |
| `npm run lint` | ESLint (Next.js) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Jest (toute la suite) |
| `npm run test:unit` | Tests unitaires + couverture |
| `npm run test:integration` | Tests d'intégration (nécessitent MongoDB) |
| `npm run test:e2e` | Tests Playwright |
| `npm run verify` | typecheck + lint + test + build (contrôle complet) |
| `npm run check:env` | Vérifie la présence des variables d'environnement requises |
| `npm run seed:demo` / `seed:test` | Jeux de données de démonstration / de test |
| `npm run db:setup` | Démo + test en une commande |
| `npm run scheduler` | Lance les tâches planifiées (rappels, échéances…) |
| `npm run backup` / `backup:predeploy` | Sauvegarde de la base |

---

## Structure du projet

```
app/
  (public)/        Vitrine multi-pages (accueil, fonctionnalités, tarifs, contact…)
  (dashboard)/     Espace connecté — un dossier par module métier :
                   invoices, devis, clients, crm, employees, payslips,
                   fiscalite, marches, fixed-assets, treasury, activites
                   (billetterie), stock, projects, analytics, settings…
  api/             Routes API (auth, 2fa, events, me/rgpd, métier…)
lib/               Logique métier pure : niger-fiscal, depreciation, totp,
                   crypto-field, ticketing, auth, email, whatsapp, role-resources…
models/            Schémas Mongoose (User, Tenant, Event, Attendee, Invoice…)
components/        Composants UI partagés et de layout
middleware.ts      Contrôle d'accès Edge + routes publiques
__tests__/unit/    Tests unitaires Jest
mobile/            Application mobile React Native (sous-projet autonome)
deploy/            Scripts VPS, Nginx, PM2 (ecosystem.config.js)
docs/              Go-live, stratégie de sauvegarde, changelog, benchmark…
Dockerfile, docker-compose.yml
```

---

## Base de données & jeux de démo

```bash
npm run seed:demo    # données de démonstration réalistes
npm run seed:test    # données pour la suite de tests
```

Sans *replica set* MongoDB, désactiver les transactions en développement :

```env
MONGO_NO_TRANSACTIONS=true
```

Voir `docs/TEST_DATABASE.md` et `docs/BACKUP_STRATEGY.md` pour le détail.

---

## Tests

```bash
npm run test:unit          # unitaires (rapides, sans base) + couverture
npm run test:integration   # nécessitent une MongoDB accessible
npm run verify             # contrôle complet avant livraison
```

La suite unitaire couvre notamment la fiscalité Niger (TVA, CNSS, IR, IS, SMIG, ancienneté, retenues, DTS), les marchés publics, la numérotation des documents, les amortissements OHADA (linéaire et dégressif), le TOTP, le chiffrement des champs, la billetterie et le RBAC.

---

## Déploiement

Le dossier `deploy/` fournit tout le nécessaire pour un VPS :

- `setup-vps.sh` — préparation du serveur
- `deploy.sh` — déploiement
- `nginx.conf` — reverse proxy
- `ecosystem.config.js` — process manager **PM2**

Alternative conteneurisée :

```bash
docker compose up -d --build
```

Checklist de mise en production : `docs/GO_LIVE_CHECKLIST.md` (et `docs/GO_LIVE_MVP.md`).

---

## Application mobile

L'app **React Native** vit sous `mobile/` et constitue un **sous-projet indépendant**, avec son propre `package.json` :

```bash
cd mobile
npm install
# suivre mobile/README.md
```

---

## Sécurité & conformité

- Sessions JWT signées, expiration et déconnexion après inactivité, **2FA TOTP** + codes de secours
- **Chiffrement au repos** (AES-256-GCM) des champs sensibles
- **RBAC** par ressource et par rôle (`lib/role-resources.ts`)
- En-têtes de sécurité (HSTS, X-Frame-Options, CSP en Report-Only par défaut — voir `next.config.mjs`), pas d'hôte d'image distant autorisé (anti-SSRF)
- **RGPD** : consentements, export des données, droit à l'effacement, bannière cookies
- Conformité **fiscale Niger** (CGI) et **marchés publics** (CMP 2017), comptabilité **OHADA**

---

© Numatech Services — Kanoo / NumaPilot. Tous droits réservés.
