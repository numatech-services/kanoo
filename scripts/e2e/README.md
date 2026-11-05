# Scénarios de bout en bout (API)

Chaque script joue un parcours complet contre une instance compilée et affiche
`N vérifications réussies, M en échec` (code de sortie 1 en cas d'échec).

- `e2e-complet.mjs` : trésorerie, achats, paie, congés, comptabilité, CRUD.
- `e2e-org.mjs` : cloisonnement par services et niveaux, droits, fuites de données.
- `e2e-stock.mjs` : entrepôts, transferts, lots / péremption, inventaire, comptoir.
- `e2e-flux.mjs` : filtre commun recettes / dépenses / période, contrats.
- `e2e-marche.mjs` : devis → marché → acomptes → dépenses par catégorie → marge, avoir.
- `e2e-marche-frais.mjs` : conditions d'un marché public (redevance, pénalités, délai, déclaration de créance, intérêts) et types de dépenses.
- `e2e-portail.mjs` : portail client (lien, documents, devis acceptés, paiement en ligne, révocation).
- `e2e-compta.mjs` : moteur comptable — banque protégée, TVA et fournisseur des charges
  récurrentes, origine des immobilisations, retenues sur le compte fournisseur commun.
- `e2e-paie.mjs` : paie 2026 — CNSS (plafond, branches, stagiaires, détachés), ITS (charges de famille,
  arrondi), avantages en nature, déclaration CNSS mensuelle ou trimestrielle.
- `e2e-automations.mjs` : automatisations (amortissements, brief, découvert prévu, paie,
  dossier du comptable, validations, budget, cotisations, sauvegarde chiffrée relue). Exige
  `CRON_SECRET`, `BACKUP_DIR` et `BACKUP_ENCRYPTION_KEY` dans l'environnement du serveur et du script.

Lancement (base de test jetable, jamais la production). La base peut venir de
Docker comme ci-dessous ou de tout MongoDB 7 en jeu de réplicas (transactions)
sur le port 27099 ; les scénarios y accèdent par `MONGODB_URI` (voir `db.mjs`) :

```bash
docker run -d --rm --name kanoo-e2e -p 127.0.0.1:27099:27017 mongo:7 --replSet rs0 --bind_ip_all
docker exec kanoo-e2e mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
export MONGODB_URI="mongodb://127.0.0.1:27099/kanoo_e2e?directConnection=true"
export JWT_SECRET="test-only-secret-0123456789abcdef0123456789" JWT_REFRESH_SECRET="test-only-refresh-0123456789abcdef012345678" NEXT_PUBLIC_APP_URL="http://localhost:3099"
npx tsx scripts/seed-test.ts && npm run build && npx next start -p 3099 &
node scripts/e2e/e2e-flux.mjs "$PWD"
```

Réinitialiser la base (`db.dropDatabase()` puis le seed) entre deux scénarios.

## Logique du module Restauration, sans compilation

`restaurant-logic.ts` appelle directement les fonctions serveur du module
(réserve, approvisionnement, ventes, pertes, inventaires à plusieurs appareils,
résultat du mois, masquage de la paie, prix minimum, vue d'ensemble,
inventaire de fin de semaine, verrou du mois clos, fiches techniques,
production, achats et rapprochement, planning et pointage, pilotage et
rapport du lundi, hygiène et traçabilité, transferts entre restaurants,
pain du jour payé le soir, rythme des articles, gaz, nouveau départ et
ouverture d'un site, argent de départ, dette fournisseur, transit, production
par lot, clôture de semaine, espace comptable, constats du comité d'audit — 203 contrôles) contre la base de test ensemencée, à réinitialiser avant. Utile quand la compilation n'est pas possible ; il ne remplace
pas `e2e-restaurant.mjs` (routes HTTP, droits, export Excel).

```bash
MONGODB_URI="mongodb://127.0.0.1:27099/kanoo_e2e?directConnection=true" npx tsx scripts/e2e/restaurant-logic.ts
```
