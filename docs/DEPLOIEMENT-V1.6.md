# Déployer la V1.6

Cette version rassemble onze commits qui n'ont jamais atteint `origin/main` :
le durcissement de sécurité, les abonnements, le socle SECeF, les avoirs, la
refonte du design, l'unification des modules, le rapprochement bancaire, les
relances clients, et la présente passe de design.

**La production tourne toujours sur `b151dfa`** — donc sans la protection CSRF
effective et sans la révocation de session. C'est le premier motif de déployer.

---

## 1. Faire arriver le code sur le dépôt

Le poste de travail n'a aucune identification GitHub enregistrée : ni jeton dans
le trousseau, ni clé SSH, ni `gh`. La commande est donc à lancer depuis un
terminal capable d'afficher une invite.

```bash
cd "<le dossier du projet>"
git push -u origin hardening/audit-b151dfa
```

Nom d'utilisateur GitHub, puis un **Personal Access Token** en guise de mot de
passe (les mots de passe de compte ne sont plus acceptés depuis 2021). Le
trousseau macOS le retiendra ensuite.

Fusionnez ensuite dans `main` — `deploy/deploy.sh` fait un
`git reset --hard origin/main` et ne verra rien tant que la branche n'y est pas.

### À défaut : depuis l'archive

Si le dépôt reste inaccessible, `kanoo-complet.bundle` contient l'historique
entier et se comporte comme un dépôt distant :

```bash
git clone kanoo-complet.bundle kanoo && cd kanoo
git remote set-url origin git@github.com:numatech-services/kanoo.git
```

`kanoo-source.tar.gz` contient le code seul, sans historique — à téléverser
directement sur le serveur si le VPS n'a pas accès à GitHub.

---

## 2. Déployer

```bash
bash deploy/deploy.sh
```

Le script a été corrigé. Trois défauts l'auraient arrêté :

- **`npm ci --only=production`** omettait `typescript`, `tailwindcss` et
  `postcss` — sans lesquels `next build` ne peut pas s'exécuter. L'installation
  est désormais complète ; la sortie `standalone` de Next n'embarque que ce
  qu'elle utilise, le poids en production ne change donc pas.
- **Six scripts appelaient `ts-node`**, absent des dépendances. `npm run
  check:env`, appelé à l'étape 3 avec `|| error`, arrêtait le déploiement — et
  `npm run scheduler` ne pouvait pas démarrer, donc aucune tâche planifiée. Ils
  utilisent maintenant `tsx`, qui est installé.
- **Les index n'étaient jamais construits explicitement.** Une nouvelle étape
  s'en charge, voir ci-dessous.

---

## 3. Les index, avant d'activer les relances

Mongoose construit ses index au premier usage d'un modèle : en tâche de fond,
et **sans lever d'erreur** si la construction échoue. Or deux contraintes
d'unicité portent des garanties de fond :

| Index | Ce qu'il garantit |
|---|---|
| `DunningLog (tenant, facture, étape)` | Un client ne reçoit jamais deux fois la même relance, même si le cron est dupliqué ou rejoué |
| `BankStatementLine (tenant, compte, empreinte)` | Réimporter un relevé ne duplique aucune ligne |

```bash
npm run indexes
```

Le script nomme les documents fautifs si des doublons empêchent la
construction. **Tant qu'il ne passe pas au vert, n'activez pas les relances
automatiques** : la garantie anti-doublon ne tiendrait pas.

---

## 4. Aucune variable d'environnement nouvelle

Les relances réutilisent `EMAIL_PROVIDER` / `BREVO_API_KEY` (ou `SMTP_*`) et
`SMS_PROVIDER`. Sans fournisseur configuré, les deux retombent sur `console` :
les messages sont écrits dans les journaux et **rien ne part**. C'est le
comportement voulu pour une première mise en service — vérifiez le contenu, puis
configurez le fournisseur.

---

## 5. Le scheduler

```bash
pm2 start deploy/ecosystem.config.js --env production
pm2 logs kanoo-scheduler
```

Onze tâches, heures locales de Niamey. La nouvelle est à **10 h — Relances
clients**. Elle n'envoie rien tant qu'une organisation n'a pas activé ses
relances, et ne part **jamais** sur une mise en demeure : celle-ci attend une
validation humaine sur l'écran `/relances`.

---

## 6. Après la mise en service

Dans cet ordre, parce que chaque étape révèle des données à corriger :

1. **`/treasury`** — déclarez le solde d'ouverture de chaque compte à une date
   connue. Les comptes existants reprennent leur ancien champ `balance` comme
   ouverture ; ce nombre n'ayant jamais été fiable, vérifiez-le contre un relevé
   réel avant de vous y fier.
2. **`/treasury/<compte>/rapprochement`** — importez un relevé. Tant qu'aucun
   ne l'est, l'écran l'annonce plutôt que de laisser un solde d'ouverture
   passer pour une concordance.
3. **`/relances`** — ouvrez l'aperçu **sans activer**. Il montre exactement ce
   que le traitement de 10 h enverrait, et pourquoi les autres factures en sont
   écartées. Lisez cette liste avant d'activer : c'est le seul moment où
   l'erreur ne coûte rien.
4. **`/settings/facture-certifiee`** — la certification SECeF reste en mode
   portail tant que l'agrément DGI n'est pas obtenu. Les spécifications de
   l'e-MCF ne sont pas publiques ; elles sont remises pendant la procédure.
