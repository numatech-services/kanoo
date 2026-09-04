# Déployer une nouvelle version — pas à pas

Guide pensé pour un non-développeur. Hébergement : **Hostinger managé (Next.js)**
connecté à GitHub — un `push` sur la branche `main` déclenche le redéploiement
automatique. Base : **MongoDB Atlas**.

> ⚠️ **Aucun secret n'est écrit dans ce fichier** : le dépôt est public. Les
> valeurs (`CRON_SECRET`, clés API…) se saisissent uniquement dans hPanel.

> **Règle d'or** : déployez d'abord sur **numapilotx** (préproduction), testez,
> **puis** basculez la production. Jamais l'inverse.

---

## Étape 1 — Sauvegarder la base (filet de sécurité)

MongoDB Atlas → votre cluster → onglet **Backup** → **Take Snapshot Now**.
En cas de problème, vous pourrez revenir à cet instant.

---

## Étape 2 — Envoyer le code sur GitHub (déclenche le déploiement)

Les nouveautés sont sur votre ordinateur ; il faut les pousser sur `main`.

Dans le Terminal, à la racine du projet :

```bash
git push origin HEAD:main
```

- Identifiant/mot de passe demandés → compte GitHub ; le « mot de passe » est un
  **jeton d'accès personnel** (Personal Access Token), pas le mot de passe habituel.
- Avec **GitHub Desktop** : cliquez sur **Push origin**.

Dès le push, Hostinger lance le build automatiquement (à suivre dans hPanel).

---

## Étape 3 — Variables d'environnement (hPanel)

hPanel → votre site → **Avancé → Variables d'environnement**.

> ⚠️ **Ne modifiez pas** les variables existantes (`MONGODB_URI`, `JWT_SECRET`,
> `FIELD_ENCRYPTION_KEY`, `PORTAL_JWT_SECRET`…). Y toucher déconnecterait tout le
> monde ou rendrait des données illisibles. On ne fait qu'**ajouter** ce qui manque.

| Variable | Valeur | Rôle |
|---|---|---|
| `ANTHROPIC_API_KEY` | votre clé Claude (console.anthropic.com) | Active l'assistant IA |
| `CRON_SECRET` | un secret aléatoire (voir ci-dessous) | Sécurise les tâches planifiées |
| `AI_MODEL` | `claude-sonnet-5` *(ou vide = opus-5)* | Modèle IA (sonnet = moins cher) |
| `AI_MONTHLY_QUOTA` | `50` | Générations IA / mois / organisation |

Facultatif (les défauts conviennent) :

| Variable | Défaut | Rôle |
|---|---|---|
| `NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES` | `3` | Déconnexion inactivité (côté navigateur) |
| `SESSION_IDLE_MINUTES` | `5` | Session glissante (filet côté serveur) |
| `EMAIL_PROVIDER` + clés | — | Envoi d'e-mails (relances, invitations) |

**Générer un `CRON_SECRET`** (Terminal) :

```bash
openssl rand -hex 32
```

Après avoir enregistré les variables, **redéployez** (bouton hPanel) pour qu'elles
soient prises en compte.

---

## Étape 4 — Tâches planifiées (cron)

hPanel → **Cron Jobs**. Créer **3 tâches**. Remplacez `VOTRE_SECRET` par la valeur
de `CRON_SECRET`, et le domaine par le domaine cible (numapilotx pour tester,
numapilot en production).

| Cadence | Planification | Commande |
|---|---|---|
| Quotidien 6h30 | `30 6 * * *` | `curl -fsS -H "x-cron-key: VOTRE_SECRET" "https://numapilot.numatechservices.net/api/cron?group=daily"` |
| Mensuel (1er, 1h) | `0 1 1 * *` | `curl -fsS -H "x-cron-key: VOTRE_SECRET" "https://numapilot.numatechservices.net/api/cron?group=monthly"` |
| Annuel (1er janv.) | `1 0 1 1 *` | `curl -fsS -H "x-cron-key: VOTRE_SECRET" "https://numapilot.numatechservices.net/api/cron?group=yearly"` |

Si le champ Hostinger n'accepte qu'une URL (sans en-tête), utilisez plutôt :
`…/api/cron?group=daily&key=VOTRE_SECRET`.

---

## Étape 5 — Index de base de données (optionnel)

La plupart des index se créent automatiquement au démarrage : **rien à faire** en
général. Si un jour une lenteur ou un doublon apparaît sur les factures certifiées,
lancez une seule fois la synchronisation depuis une machine ayant le code et
l'accès à la base :

```bash
npm run indexes
```

---

## Étape 6 — Tester puis basculer

1. Ouvrir **numapilotx**.numatechservices.net et vérifier en 5 min :
   - Logo + nom de l'organisation dans la barre latérale ; *Réglages → Mon organisation*.
   - Fiche d'un **client** et d'un **fournisseur** : onglets (contrats, marchés…), logo.
   - **Assistant IA** : « Rédiger avec l'IA » sur un courrier (si la clé est posée).
   - **Inactivité** : ne rien toucher 3 min → avertissement à 2 min, puis déconnexion.
2. Si tout est bon → basculer le **domaine de production** (numapilot) sur cette version.

---

## En cas de souci

- **Le build échoue dans hPanel** → ouvrir les logs de build ; le plus souvent une
  variable d'environnement manque.
- **« Session invalide » en boucle** → ne pas avoir modifié `JWT_SECRET` ; le
  remettre à sa valeur d'origine.
- **L'assistant IA n'apparaît pas** → `ANTHROPIC_API_KEY` absente : normal, la
  fonction se masque proprement. L'ajouter puis redéployer.
- **Une tâche cron renvoie 401** → le `CRON_SECRET` de la commande ne correspond
  pas à celui des variables d'environnement.

Voir aussi `docs/DEPLOIEMENT-HOSTINGER.md` (procédure d'origine) et `.env.example`
(liste complète des variables).
