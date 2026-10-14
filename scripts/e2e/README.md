# Scénarios de bout en bout (API)

Chaque script joue un parcours complet contre une instance compilée et affiche
`N vérifications réussies, M en échec` (code de sortie 1 en cas d'échec).

- `e2e-complet.mjs` : trésorerie, achats, paie, congés, comptabilité, CRUD.
- `e2e-org.mjs` : cloisonnement par services et niveaux, droits, fuites de données.
- `e2e-stock.mjs` : entrepôts, transferts, lots / péremption, inventaire, comptoir.
- `e2e-flux.mjs` : filtre commun recettes / dépenses / période, contrats.
- `e2e-marche.mjs` : devis → marché → acomptes → dépenses par catégorie → marge, avoir.

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
