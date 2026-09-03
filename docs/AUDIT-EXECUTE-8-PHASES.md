# Audit exécuté en 8 phases — Kanoo / NumaPilot

> Audit **exécuté**, pas relu : base MongoDB réelle (replica set en mémoire),
> serveur Next en mode production, données amorcées, et plus de 130 tests HTTP
> lancés contre l'application vivante. Chaque bug ci-dessous a été **reproduit**,
> corrigé, puis **revérifié** en réexécutant le même test.

## 8.1 Décompte

| | Nombre |
|---|---|
| Tests exécutés (5 batteries HTTP + statique) | ~120 |
| Tests unitaires du dépôt | 543 (tous verts) |
| **Bugs réels corrigés** | **15** |
| dont bloquants en production | 12 |
| Faux positifs (hypothèses de test erronées) | 8, écartés après vérification |

Aucun des 15 bugs n'était visible au `build` ni aux 543 tests unitaires : tous
n'apparaissent qu'à l'exécution, avec des données réelles. C'est l'argument
central de cet audit.

## 8.2 Les 15 corrections, par priorité

### Priorité 1 — bloquants (le produit ne fonctionne pas sans eux)

1. **Index Employee `sparse` sur clé composée** — le 2ᵉ salarié d'une
   organisation était refusé (E11000). Index rendu partiel.
   `models/Employee.ts`.
2. **Inscription publique impossible** — `/souscrire` appelait une route
   superadmin → 401 pour tout visiteur. Route publique dédiée créée, compte en
   `pending_activation`, jeton par courriel. `app/api/public/inscription`.
3. **Mot de passe oublié inexistant** — lien mort vers un 404. Chaîne complète
   créée (demande, jeton haché, réinitialisation, révocation des sessions).
   `app/api/auth/forgot-password`, `reset-password`, pages associées.
4. **Tableau de bord PME en crash** — un composant serveur passait une fonction
   à un composant client (interdit). `KpiCard` accepte une clé de format.
5. **Toutes les statistiques à zéro** — `tenantFilter` renvoyait une chaîne ;
   les pipelines `aggregate` exigent un ObjectId → tout `$match` renvoyait vide.
   CA, encaissé, rapports, graphiques : zéro partout, en silence, tous espaces
   confondus. `lib/api-helpers.ts` + 3 agrégations directes.
6. **Tableau de bord associatif à zéro** — appelait `/api/stats/dashboard`, une
   route qui n'existait pas (404 avalé). Route créée.
7. **`withTransaction` faisait perdre des écritures** — annulait une transaction
   déjà commise (« Cannot call abortTransaction… »). Enveloppe paiements,
   factures, avoirs, trésorerie, paie. Délégué au mécanisme officiel de Mongoose,
   avec réessai. C'est ce qui bloquait la création de devis. `lib/db.ts`.
8. **Conversion devis→facture déséquilibrée** — l'écriture comptable omettait la
   ligne du droit de timbre → déséquilibre de 500 XOF → rejet systématique.
   `app/api/devis/[id]/to-invoice`.
9. **Budget inaccessible à l'ordonnateur** — `/api/budget` gardé sur la mauvaise
   ressource RBAC (`accountingEntries` au lieu de `budgetChapters`). Son propre
   tableau de bord recevait 403. `app/api/budget` + `lib/role-resources.ts`.
10. **Formulaire de démo cassé** — la page `/contact` postait vers une route que
    le middleware bloquait en 401 ; aucune demande de démo n'aboutissait. Route
    ouverte **et durcie** (débit, liste blanche, tailles). `app/api/demo-requests`.

### Priorité 2 — correctness / sécurité

11. **Jeton invalide sur une API → 307 vers /login** au lieu de 401 JSON ; un
    client `fetch` recevait du HTML. `middleware.ts`.
12. **JSON malformé → 500** (avec pile en journal) au lieu de 400. Corrigé en un
    point pour les 174 routes. `lib/api-helpers.ts`.
13. **CSP inerte** — servie en `Report-Only` sans `report-uri`. Passée en
    application, après avoir autorisé Google Fonts pour ne pas casser la
    typographie. `next.config.mjs`.
14. **Module budgétaire public entièrement cassé** — trouvé en résorbant la
    dette. Le commit du budget prévisionnel PME avait détourné `GET/POST
    /api/budget` (pour servir le modèle `Budget`), alors que **dix écrans
    d'administration** y lisent des `BudgetChapter` (arbre, `?flat=true`,
    création). Tout le suivi alloué → engagé → mandaté était donc à zéro — les
    zéros du tableau de bord admin (Phase 3) venaient de là, pas du seed.
    Séparé : `/api/budget` sert les chapitres (RBAC `budgetChapters`),
    `/api/budget-previsionnel` sert le prévisionnel (RBAC `accountingEntries`,
    la ressource du profil PME). `app/api/budget`, `app/api/budget-previsionnel`.
15. **Compteur d'impayés incohérent** — le badge de navigation comptait 5
    (échéance dépassée) et la liste `?overdue=true` n'en montrait que 2 (statut
    littéral). Définitions alignées. `app/api/invoices`.

### Priorité 3 — qualité / hygiène (traité)

- Journaux du middleware à chaque requête — retirés.
- 208 lignes de code mort supprimées (3 fichiers sans aucun import).
- robots.txt + sitemap.xml ajoutés (SEO).

## 8.3 Ce qui est déjà solide (vérifié, rien à corriger)

- **Isolation multi-tenant étanche** : une organisation ne peut ni lire, ni
  modifier, ni supprimer les données d'une autre par ID direct (clients,
  factures) ; les listes sont cloisonnées. *C'est le point le plus critique d'un
  multi-tenant, et il est irréprochable.*
- **Mots de passe** bcrypt, jamais renvoyés par l'API.
- **CSRF** effectif (double soumission de cookie), **rate limiting** anti-force
  brute, **en-têtes de sécurité** complets (HSTS, nosniff, X-Frame-Options,
  Referrer-Policy, CSP désormais appliquée).
- **Exactitude comptable** : HT/TVA/droit de timbre exacts, avoirs déduits du CA,
  flux paiement→facture cohérent, écritures équilibrées.
- **Performance** : routes de liste sous 15 ms sur le jeu de test, pas de N+1
  visible.

## 8.4 Dette connue (non bloquante, à planifier)

- 36 `any` en production (avertissements ESLint, dette de typage assumée :
  dispersés dans des pages de formulaire, sans gain à les brasser en masse).
- `Budget` et `BudgetChapter` : NON un doublon — deux domaines distincts
  (prévisionnel privé vs exécution budgétaire publique), désormais servis par
  des endpoints séparés. Rien à unifier.
- 22 vulnérabilités `npm audit` : 1 critique (next 14.1.0, corrigée par
  14.2.x — mineur non cassant), le reste dans l'outillage de développement
  (chaîne eslint), correctif majeur reporté.

## 8.5 Checklist de déploiement

- [x] Les 543 tests unitaires passent
- [x] `tsc --noEmit` propre
- [x] `next build` réussit (130+ routes)
- [x] Isolation multi-tenant vérifiée en réel
- [x] Sécurité renforcée (CSP appliquée, en-têtes complets)
- [x] Inscription et récupération de compte fonctionnelles bout en bout
- [x] Site vitrine complet (9 pages, robots, sitemap)
- [ ] **Pousser la branche puis fusionner dans `main`** (35 commits en avance)
- [ ] `npm run indexes` sur la base de production (construit les contraintes
      d'unicité — relances, empreintes de relevé)
- [ ] Vérifier `.env.local` sur le VPS (MONGODB_URI, JWT_SECRET, fournisseur
      e-mail — sinon inscriptions et relances partent dans le vide)
- [ ] `next` 14.1.0 → 14.2.x (`npm audit fix`) avant ou juste après la bascule

## 8.6 Méthode (reproductible)

Les batteries de test sont dans `audit/` (non versionné, gitignoré) :
`phase2.mjs` … `phase6.mjs`, harnais commun `harness.mjs`. Elles se relancent
contre un serveur local amorcé. La base est un replica set MongoDB en mémoire
(`mongodb-memory-server`) — donc reproductible sans infrastructure.
