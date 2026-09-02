# Base de données de test — Kanoo

## Présentation

La base de test est une base MongoDB isolée, suffixée `_test`, distincte de la base de développement. Elle est conçue pour :

- Les tests automatisés (`npm run test`)
- Les tests d'intégration CI/CD
- La validation UAT sans risquer les données de dev

## Utilisation

### Créer la base de test

```bash
npm run seed:test
```

Avec une URI explicite :

```bash
MONGODB_URI_TEST="mongodb://localhost:27017/kanoo_test" npm run seed:test
```

### Variables d'environnement

| Variable | Description |
|---|---|
| `MONGODB_URI_TEST` | URI de la base de test (optionnel) |

Si `MONGODB_URI_TEST` n'est pas défini, le script dérive automatiquement l'URI en ajoutant `_test` au nom de la base.

Exemple : `mongodb://localhost:27017/kanoo` → `mongodb://localhost:27017/kanoo_test`

## Comptes de test créés

| Profil | Email | Mot de passe | Rôle |
|---|---|---|---|
| PME | admin@test.ne | test1234 | pme_admin |
| PME | comptable@test.ne | test1234 | pme_accountant |
| Association | president@test.ne | test1234 | asso_president |
| Administration | ordonnateur@test.ne | test1234 | admin_ordonnateur |
| Superadmin | super@test.ne | test1234 | superadmin |

## Données créées

### PME (Test PME SARL)
- 2 utilisateurs (admin, comptable)
- 1 client (Client Test)
- 2 employés
- 1 facture émise (FAC-2025-00001 / 119 000 XOF)

### Association (Asso Test)
- 1 président
- 2 adhérents

### Administration (Admin Test)
- 1 ordonnateur
- 2 chapitres budgétaires (Fonctionnement + Investissement)

## Exécuter les tests

```bash
npm run test
# ou
npm run test:ci
```

## Réinitialiser

La base est entièrement vidée et recréée à chaque appel de `npm run seed:test`. C'est un comportement intentionnel.

## Notes CI/CD

Pour les pipelines CI, définissez `MONGODB_URI_TEST` dans les secrets d'environnement :

```yaml
# GitHub Actions exemple
env:
  MONGODB_URI_TEST: mongodb://localhost:27017/kanoo_test
  JWT_SECRET: test_secret_minimum_32_characters_long
```
