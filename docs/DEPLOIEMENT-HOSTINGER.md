# Déploiement — Hostinger (hébergement Next.js managé)

Le projet est hébergé sur l'**hébergement Next.js managé de Hostinger**
(connecté à GitHub, déploiement automatique, build natif Next.js), **pas** sur
un VPS. Le script `deploy/deploy.sh` (SSH + `git reset` + PM2) ne s'applique
donc pas ici — il reste pour un éventuel VPS.

Base de données : **MongoDB Atlas** (externe), déjà connectée.

---

## 0. Version de Node.js : 20.9 au minimum

Depuis le lot C, l'application tourne sur **Next.js 16 / React 19**, qui exigent
**Node.js ≥ 20.9** (`engines` dans `package.json`). Dans hPanel → paramètres du
site Node.js, choisir **Node 20 ou 22** avant le premier build : avec Node 18,
le build échoue dès le départ.

Commandes de l'hébergement (inchangées) : installation `npm install`, build
`npm run build`, démarrage `npm start`.

Le build de production passe par **webpack** (`next build --webpack`) et non
par Turbopack, le compilateur par défaut de Next 16 : Turbopack confie PostCSS
(Tailwind) à un processus Node séparé, que l'environnement de build d'Hostinger
arrête avant qu'il se connecte (« TurbopackInternalError » sur
`styles/globals.css`). Webpack exécute PostCSS dans le même processus. Ne pas
retirer `--webpack` sans avoir vérifié un build Turbopack sur Hostinger.

Points de la migration à connaître :
- le filtre d'authentification s'appelle désormais `proxy.ts` (ex-`middleware.ts`) ;
- la CSP est posée à chaque requête avec un nonce (`lib/csp.ts`) et recopiée en
  balise `<meta>`, car le CDN d'Hostinger remplace l'en-tête ;
- après la mise en ligne, un **rechargement forcé** (Cmd+Maj+R) évite qu'un
  ancien service worker serve des fichiers de la version précédente.

---

## 1. Mettre à jour le site : pousser sur `main`

Le déploiement automatique est activé : un `push` sur `main` déclenche seul le
`npm install` + `next build` + mise en ligne (~4 min). Depuis votre Mac :

```bash
cd "/Users/alimahamandankanomansour/Desktop/Bureau - Mac/NUMATECH SERVICES/Devops projets/kanoo" && git push origin HEAD:main
```

À l'invite : identifiant GitHub + Personal Access Token (le dépôt est public en
lecture, mais l'écriture exige le token). Le fast-forward est propre.

Suivi dans hPanel → **Sites web → Déploiements**. En cas de besoin, le bouton
**Redéployer** relance le build sur le dernier commit.

---

## 2. Variables d'environnement (hPanel → Variables d'environnement)

À définir **dans hPanel**, pas dans un `.env.local` (l'hébergement managé les
injecte au build et au runtime) :

| Variable | Rôle |
|---|---|
| `MONGODB_URI` | URL Atlas `mongodb+srv://…` (déjà en place) |
| `JWT_SECRET` | Secret des sessions — 32+ caractères, **stable** (le changer déconnecte tout le monde) |
| `APP_BASE_URL` | `https://numapilot.numatechservices.net` — sert aux liens des e-mails (activation, mot de passe oublié) |
| `EMAIL_PROVIDER` + clés | `brevo` (+ `BREVO_API_KEY`) ou `smtp` (+ `SMTP_*`). **Sans fournisseur, les e-mails d'inscription, de réinitialisation et les relances ne partent pas** — ils sont seulement écrits dans les journaux. |
| `CRON_SECRET` | Secret du déclencheur de tâches (voir §4). Générer : `openssl rand -hex 32` |
| `SMS_PROVIDER` + clés | Optionnel (relances par SMS) |

---

## 3. Index de base de données — une fois, depuis votre Mac

Atlas étant externe, pas besoin du serveur : lancez la construction des index
d'unicité (anti-doublon relances, empreintes de relevé) depuis votre poste,
pointé sur la base de production :

```bash
cd "…/kanoo" && MONGODB_URI="<votre URL Atlas de prod>" npm run indexes
```

Tant que ce n'est pas passé au vert, **n'activez pas les relances automatiques** :
la garantie anti-doublon repose sur ces index.

---

## 4. Les tâches planifiées : une tâche cron Hostinger

L'hébergement managé ne fait tourner que l'app web — **pas de scheduler
permanent**. Les automatisations (relances clients, alertes stock, rappels TVA,
fins de contrat, échéances d'abonnement…) passent par l'endpoint **`/api/cron`**,
appelé par une **tâche cron Hostinger** (hPanel → **Avancé → Tâches cron**).

Trois tâches à créer (adaptez l'heure au fuseau du serveur ; remplacez
`$SECRET` par la valeur de `CRON_SECRET`) :

```bash
# Chaque jour à 06:30 — tâches quotidiennes (relances, alertes, échéances)
30 6 * * *   curl -fsS -H "x-cron-key: $SECRET" "https://numapilot.numatechservices.net/api/cron?group=daily"

# Le 1er de chaque mois à 01:00 — rappels TVA + purge des jetons expirés
0 1 1 * *    curl -fsS -H "x-cron-key: $SECRET" "https://numapilot.numatechservices.net/api/cron?group=monthly"

# Le 1er janvier à 00:01 — remise à zéro de la numérotation annuelle
1 0 1 1 *    curl -fsS -H "x-cron-key: $SECRET" "https://numapilot.numatechservices.net/api/cron?group=yearly"
```

L'endpoint refuse tout appel sans le bon secret (401), et se désactive de
lui-même (503) si `CRON_SECRET` n'est pas configuré. Il répond en JSON avec le
résumé de chaque tâche ; un `curl -f` échoue si l'appel n'aboutit pas, ce qui
rend un problème visible dans les journaux cron.

**Test manuel** (après avoir posé `CRON_SECRET` en prod) :

```bash
curl -H "x-cron-key: <votre secret>" "https://numapilot.numatechservices.net/api/cron?group=daily"
```

### Automatisations (lot D)

Les trois tâches cron ci-dessus suffisent : les automatisations s'ajoutent au
groupe quotidien (brief du matin, découvert prévu, paie, dossier du comptable,
validations en attente, budget, cotisations, sauvegarde) et au groupe mensuel
(amortissements de l'exercice écoulé). Chaque organisation les règle dans
**Réglages → Automatisations**. Par défaut, seules les alertes internes sont
actives ; ce qui écrit hors de Kanoo ou passe des écritures attend d'être activé.

Pour que les envois partent réellement, l'instance doit avoir un fournisseur
d'e-mail (`EMAIL_PROVIDER`), et pour WhatsApp / SMS leurs variables
(`WHATSAPP_PROVIDER`, `SMS_PROVIDER`) ; l'écran des réglages signale un canal
non branché. La lecture des factures fournisseurs utilise `ANTHROPIC_API_KEY`
et le quota `AI_MONTHLY_QUOTA` (partagé avec l'assistant de rédaction).

### Sauvegarde chiffrée de la base

L'hébergement managé n'a pas `mongodump` : la tâche `backup` exporte la base
elle-même, la chiffre (AES-256-GCM) et la dépose dans un stockage compatible S3.

1. Créer un compartiment **privé** (Backblaze B2 ou Cloudflare R2 : quelques
   centimes par mois) et une clé d'accès limitée à ce compartiment.
2. Ajouter une **règle de cycle de vie** qui supprime les objets de plus de
   30 jours (la rétention se règle côté stockage).
3. Dans hPanel, renseigner `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`,
   `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY` et
   `BACKUP_ENCRYPTION_KEY` (générer : `openssl rand -base64 32`).
4. **Conserver `BACKUP_ENCRYPTION_KEY` hors de l'hébergement** (gestionnaire
   de mots de passe) : sans elle, aucune sauvegarde n'est récupérable.
5. Tester : `curl -H "x-cron-key: <secret>" "https://…/api/cron?job=backup"`,
   puis vérifier l'archive depuis votre Mac (même variables BACKUP_* exportées) :

```bash
cd "/Users/alimahamandankanomansour/Desktop/Bureau - Mac/NUMATECH SERVICES/Devops projets/kanoo" && npm run restore -- --verify --s3 kanoo/kanoo-<base>-<AAAA-MM-JJ>.knb
```

Une vérification par mois est recommandée. La restauration réelle se fait dans
une base **vide** (`RESTORE_MONGODB_URI`), jamais par-dessus la production :
voir l'en-tête de `scripts/restore-backup.ts`. Les fichiers joints (pièces
justificatives) ne sont pas dans cette sauvegarde : seule la base l'est.

---

## 5. Après la première mise en ligne — dans cet ordre

1. **Vérifier le tunnel d'entrée** : `/souscrire` répond (plus de 401),
   « Mot de passe oublié ? » ouvre une vraie page. C'était cassé sur `b151dfa`.
2. **`/treasury`** : déclarer le solde d'ouverture de chaque compte à une date
   connue, puis importer un relevé pour le rapprochement.
3. **`/relances`** : ouvrir l'aperçu **sans activer**, vérifier ce que le cron
   enverrait, puis activer en connaissance de cause.
4. **`/settings/facture-certifiee`** : la certification SECeF reste en mode
   portail tant que l'agrément DGI n'est pas obtenu.
