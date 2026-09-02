# Kanoo — Changelog

## V1.3.1 — Septembre 2026

### Propagation du système de design aux 126 écrans

Ce n'était pas un travail cosmétique. Les tokens historiques (`sand`, `clay`,
`moss`, `cedar`) étaient bien câblés sur des variables CSS et basculaient
correctement en thème sombre — mais **`bg-white` et les ~430 couleurs Tailwind
brutes semées dans l'application ne basculaient pas**. Une carte `bg-white` sur
un fond sombre restait blanche, un `bg-red-50` restait rose pâle. Le mode sombre
était donc troué sur la quasi-totalité des écrans.

- **430 couleurs brutes converties en tokens sémantiques** dans 154 fichiers :
  vert → `pos`, rouge → `neg`, ambre → `warn`, bleu → `info`, gris → neutres du
  thème. 287 `bg-white` deviennent `bg-surface`.
- Les `bg-white/20` posés **sur des fonds colorés** ont été rétablis : ce sont
  des voiles, pas des surfaces — les convertir les rendait invisibles.
- Les survols devenus sans effet (`bg-pos` suivi de `hover:bg-pos`) passent en
  `hover:brightness-95`.
- **`DataTable` densifié une fois pour les 31 écrans** qui l'utilisent, plus
  11 tableaux écrits à la main : la ligne passe de 52 à 40 pixels.
- **Deux tests structurels** refusent désormais toute couleur brute et tout
  fond blanc opaque qui reviendrait — la vitrine publique, volontairement en
  thème clair, est exclue.

**Vérification**

264 tests au vert, 0 erreur de type, 0 erreur de lint, build de production
réussi (198 pages).

## V1.3.0 — Septembre 2026

### Factures d'avoir, densité, palette de commandes

**Factures d'avoir**

Une facture émise ne se supprime pas — a fortiori une facture certifiée SECeF,
dont le code engage l'assujetti. L'avoir est la seule correction admise.

- Avoir **total** ou **partiel** (sélection de lignes et de quantités), porté
  par le modèle Invoice avec un discriminant `documentType` : mêmes chemins de
  code pour la numérotation, le PDF, la certification et l'écriture comptable.
  Deux implémentations parallèles finissent toujours par diverger sur un
  arrondi.
- Série de numérotation dédiée (`AV-2026-00001`) : mêler avoirs et factures
  rendrait illisible une séquence que la DGI attend continue.
- **Écriture d'extourne** exactement inverse de l'écriture de vente, dont
  l'équilibre est vérifié avant enregistrement. La déclaration de TVA lit les
  écritures en crédit moins débit : la TVA collectée est donc réduite
  automatiquement, sans traitement particulier.
- Motif **obligatoire** : un avoir sans motif est inopposable.
- Contrôles : pas d'avoir sur un avoir, pas d'avoir sur un brouillon (qui se
  modifie directement), jamais plus que le montant encore créditable, jamais
  deux fois la même ligne, et le droit de timbre — forfait par document — n'est
  jamais fractionné sur un avoir partiel.
- Verrou de concurrence : deux avoirs émis simultanément sur la même facture ne
  peuvent pas dépasser ensemble le montant créditable.
- **Toutes les sommes de chiffre d'affaires ont été reprises** pour retrancher
  les avoirs au lieu de les ajouter, et les décomptes d'impayés pour les
  exclure. Deux tests structurels refusent désormais toute nouvelle agrégation
  qui l'oublierait.
- Sur la fiche facture, « Annuler » cède la place à « Émettre un avoir » dès
  que la facture est émise. Les deux actions ne coexistent jamais.
- 22 tests.

**Design — densité et grille**

- Table dense unique (`.table-dense`) : la ligne passe de 52 à 40 pixels. Sur
  un écran de 900 px, cela fait sept lignes de plus sans rien retirer.
- Grille imposée (`--r-sm/md/lg`, `--gutter`, `.surface-card`, `.page-head`) :
  126 écrans construits à des moments différents ressemblent à six produits ;
  une grille unique est ce qui en refait un.
- **Palette de commandes (⌘K / Ctrl+K)** : 45 destinations, recherche
  insensible aux accents, classement par pertinence, navigation aux flèches.
  Le bouton de recherche de la barre supérieure existait déjà mais ne
  déclenchait rien — aucun composant n'écoutait le raccourci.

**Vérification**

262 tests au vert, 0 erreur de type, 0 erreur de lint, build de production réussi.

## V1.2.0 — Septembre 2026

### Design par section, gestion des abonnements revendus, socle de facture certifiée

**Design — une teinte par domaine**

- Chaque grande section porte sa couleur : ventes en indigo, achats en sarcelle,
  abonnements en violet, finance en vert acacia, RH en terre cuite… La barre
  latérale, les pastilles d'icônes, les courbes et l'item actif suivent la même
  variable. Dans un ERP où les écrans se ressemblent, la couleur dit où l'on est
  avant même de lire le titre.
- Trois variables CSS par section (`--s-accent`, `--s-soft`, `--s-on`), posées
  par un attribut `data-section` calculé depuis la route. Ajouter une section
  revient à ajouter un bloc de couleurs — aucun écran n'a rien à déclarer.
  Thème clair et thème sombre traités ensemble.
- Nouvelles primitives de graphiques, en SVG et sans bibliothèque : courbes
  lissées avec aire (`AreaChart`), barres juxtaposées ou empilées (`BarChart`),
  micro-courbes (`Sparkline`), anneau de répartition (`DonutChart`). Le lissage
  passe exactement par chaque point mesuré — une interpolation qui invente des
  sommets donnerait à lire un mouvement qui n'existe pas.
- Cartes d'indicateurs (`KpiCard`) avec pastille colorée, variation et
  micro-courbe. La variation n'apparaît que si elle est calculable : un « 0 % »
  par défaut se lirait comme une stabilité mesurée.
- Sélecteurs segmentés (`SegmentedControl`) rendus en groupe de boutons radio,
  navigables au clavier.
- Tableau de bord et flux de trésorerie repris sur ces composants. Les émojis
  des cartes cèdent la place à des icônes, et le graphique de trésorerie offre
  deux lectures : flux bruts ou solde net.

**Abonnements souscrits et revendus**

Nouveau domaine pour les organisations qui achètent des contrats d'abonnement à
des éditeurs et les revendent à des clients finaux.

- **Contrats souscrits** : fournisseur, produit, période, quantité de licences,
  devise d'origine avec taux de change et contre-valeur figée, retenue à la
  source, TVA supportée, frais bancaires, reconduction tacite et préavis.
- **Reventes** : rattachées au contrat amont qu'elles consomment. Le serveur
  **refuse** une revente qui dépasse les licences restantes ou qui court
  au-delà de la couverture — vendre ce qu'on n'a pas est un engagement qu'on ne
  peut pas tenir, et une alerte après coup arrive trop tard.
- **Rapprochement** : licences acquises contre licences placées, coût de revient
  contre revenu, marge et taux, coût unitaire contre prix de revente moyen.
- **Alertes** : échéance de contrat, échéance de **préavis** — distincte, car
  sur une reconduction tacite c'est elle qui engage —, sur-vente, revente
  débordant la couverture, revente non facturée, capacité dormante.
- **Charges fiscales** : TVA collectée et déductible, solde à reverser ou crédit
  reportable, retenues opérées et subies, IS estimé sur la marge. L'estimation
  est signalée comme telle : l'impôt réel porte sur le résultat de l'entreprise
  entière, avec minimum forfaitaire.
- **Étalement mensuel** au prorata des jours : un abonnement annuel n'est pas une
  charge de janvier.
- Job planifié quotidien, segmenté par organisation.
- 36 tests sur le moteur de rapprochement.

**Facture certifiée — SECeF**

Socle d'intégration au Système Électronique Certifié de Facturation de la DGI.

- **Mode portail, opérationnel immédiatement** : la facture est émise sur
  e-SECeF, et les codes obtenus sont reportés puis archivés dans Kanoo, qui
  mesure la couverture réelle des factures émises.
- **Mode e-MCF, délibérément incomplet** : les spécifications de l'API ne sont
  pas publiées — elles sont remises pendant la procédure d'agrément. Tout ce qui
  ne dépend pas de la DGI est en place ; il reste une fonction à écrire, isolée.
  Un test verrouille cette honnêteté : tant qu'il passe, personne ne peut croire
  la certification automatique disponible.
- Garde-fous réglementaires : une facture certifiée ne se recertifie pas, ne se
  supprime pas (avoir de type FA), un brouillon ne se certifie pas, unicité du
  code par organisation, journal d'audit sur chaque tentative.
- Écran de paramètres avec prérequis, couverture mesurée et identité de
  facturation. Marche à suivre vers l'agrément dans `docs/SECEF.md`.
- 18 tests.

**Vérification**

238 tests au vert, 0 erreur de type, 0 erreur de lint, build de production réussi.

## V1.1.1 — Septembre 2026

### Résorption de la dette de lint — et les pannes qu'elle cachait

Les 220 avertissements laissés par la V1.1.0 ont été traités : il en reste 47,
tous du même type (`any` sur sept fiches détail qui affichent des documents
d'entité). Le tri a mis au jour des fonctionnalités mortes qu'aucun test ne
couvrait.

**Pannes découvertes derrière les avertissements**

- **`/api/contracts/[id]` répondait 404 sur ses trois méthodes.** Le
  gestionnaire lisait `context.params.id` alors que `withAuth` passe les
  paramètres déjà résolus en troisième argument. Le typage `context: any`
  masquait l'erreur.
- **La messagerie n'a jamais fonctionné.** La route utilisait `auth.id` et
  `auth.name`, qui n'existent pas sur le jeton ; `senderId` étant obligatoire,
  chaque envoi levait une erreur de validation. Au passage : la lecture ne
  vérifiait pas que l'appelant participe à la conversation, et l'aperçu du
  dernier message n'était jamais mis à jour.
- **Le détail d'un projet restait bloqué sur son squelette.** `loading`
  n'était jamais remis à `false`.
- **Le bouton « Modifier » des fiches fournisseur et collaborateur était
  inerte** : il ouvrait une modale qui n'était rendue nulle part.
- **Les boutons « Activer » et « Suspendre » de l'écran Facturation n'avaient
  aucun gestionnaire.** Ils sont branchés sur la route superadmin ; la liste
  n'est plus filtrée sur les seules périodes d'essai, ce qui faisait afficher
  zéro aux compteurs « Actifs » et « Suspendus ».
- **Le bandeau hors-ligne annonçait « N actions synchronisées »** à partir du
  compteur d'actions **en attente**. Il distingue désormais quatre états, dont
  la session expirée et les échecs définitifs — le pendant visuel du rejeu
  corrigé en V1.1.0.
- **Le cache hors-ligne n'expirait jamais** : la péremption était calculée puis
  jetée.
- **`DataTable` utilisait `Math.random()` comme clé de repli**, ce qui
  démontait et remontait la table à chaque rendu.
- **Le filtre « alertes seules » du stock ne pouvait pas être activé** : aucun
  contrôle ne le pilotait.
- **Les totaux budget / dépensé / exécution des projets ONG étaient calculés
  puis jetés.**
- Références de quittance et d'engagement tirées de `Math.random` : remplacées
  par `crypto`.
- Index MongoDB dupliqué sur `Tenant.slug`.

**Qualité**

- 23 `catch (…: any)` remplacés par un `unknown` correct et un utilitaire
  `errorMessage` / `errorName` — l'ancien code plantait le gestionnaire
  d'erreur lui-même quand la valeur lancée n'était pas une `Error`.
- 90 imports inutilisés retirés, quatre hooks `useEffect` stabilisés par
  `useCallback`, traces de débogage retirées des routes.
- Nouveau fichier de tests structurels sur les routes : signature des
  gestionnaires, typage de `auth`, recopie du corps de requête, fuite de
  message d'erreur, références aléatoires. Ce sont ces règles qui auraient
  attrapé les deux routes mortes ci-dessus.
- 184 tests au vert (contre 171), 0 erreur de type, 0 erreur de lint.

**Reste**

47 avertissements `any`, concentrés sur sept fiches détail qui rendent des
documents d'entité de forme variable. Les typer suppose de déclarer la forme
réelle de chaque entité — un travail utile, mais distinct de celui-ci. Ils
restent visibles via `npm run lint:strict`.

## V1.1.0 — Septembre 2026

### Durcissement — suite à l'audit du commit b151dfa

Trois protections annoncées dans la V1.0.0 n'existaient pas dans le code, et
une quatrième détruisait des données. Cette version les rend effectives.

**Corrections critiques**

- **CSRF réellement vérifié.** Une soixantaine d'écrans envoyaient déjà
  `x-csrf-token` ; aucune route serveur ne le lisait. La vérification par
  double soumission de cookie est désormais appliquée par `withAuth`, donc sur
  les 112 routes qui en dépendent.
- **Rejeu hors-ligne : plus aucune perte silencieuse.** Le service worker
  supprimait toute écriture dont la réponse était inférieure à 500 — un 401 dû
  à une session expirée effaçait la facture *et* la comptait comme
  synchronisée. Seul un 2xx efface désormais ; les 401 attendent une session
  neuve, les refus définitifs partent dans une file d'échecs consultable.
- **Idempotence des mutations.** Chaque écriture mise en file porte un
  `Idempotency-Key` rejoué à l'identique. Un rejeu après une réponse perdue ne
  crée plus de document en double.
- **Révocation de session effective.** `sessionVersion` est écrit à la
  connexion et vérifié à chaque requête. Il n'était présent nulle part dans le
  jeton : révoquer une session n'avait aucun effet.
- **Portails externes.** Secret de signature dédié (le repli était une chaîne
  en dur dans le dépôt), code d'accès de huit chiffres tiré cryptographiquement
  et stocké haché, limitation de débit par adresse et par compte. Les codes
  existants sont migrés à la première connexion réussie.

**Autorisation**

- Le rôle décide à partir de la **base**, plus du contenu du jeton : rétrograder
  un utilisateur ou suspendre un abonnement prend effet immédiatement, là où le
  rafraîchissement automatique reconduisait les anciens droits indéfiniment.
- `chef_projet_transversal` est enregistré dans la table de permissions
  réellement consultée. Il renvoyait 403 sur toutes les routes.
- Renommage `marches` → `publicTenders` terminé pour les six rôles PME restants,
  exclus du module Marchés publics alors que l'interface leur en affichait
  l'entrée.
- `allowedResources` restreint et n'accorde plus : le champ pouvait servir à
  s'octroyer une ressource absente du rôle.
- **22 rôles** (et non 23, comme l'annonçait la V1.0.0).

**Comptabilité et paie**

- La numérotation des documents est consommée **dans** la transaction et
  l'année vient de la date d'émission. Une facture de décembre saisie en
  janvier portait le millésime suivant, et tout échec laissait un trou dans la
  séquence.
- Les conversions devis → facture et contrat → facture passent par le compteur
  du tenant. Elles calculaient « dernière facture + 1 » hors transaction, en
  ignorant le préfixe personnalisé.
- Les totaux de facture sont la somme des lignes arrondies : le pied de page
  correspond désormais à l'addition des lignes imprimées.
- **L'impôt sur le revenu est retenu.** La route de génération des bulletins
  ignorait le moteur de paie et recalculait un net sans IR ni prime
  d'ancienneté. Les deux moteurs sont réunis ; le bulletin porte l'IR,
  l'ancienneté et le coût employeur.
- L'écriture comptable de paie était déséquilibrée du montant des retenues
  diverses, sans contrepartie. Elle est vérifiée avant enregistrement.
- L'ancienneté s'apprécie à la fin de la période de paie et non au jour de
  génération : rééditer un ancien bulletin ne change plus son montant.
- Amortissements **prorata temporis** (OHADA) : une mise en service en octobre
  ne dote que trois douzièmes. Une seule implémentation, là où deux
  coexistaient et divergeaient.

**Barrières de qualité**

- `ignoreBuildErrors` et `ignoreDuringBuilds` retirés de la configuration Next :
  ils masquaient 116 erreurs de type. Il en reste zéro.
- Configuration ESLint ajoutée. `npm run lint` n'avait aucune configuration et
  ouvrait un questionnaire interactif — il n'aurait jamais terminé en CI.
- `setupFilesAfterEach` corrigé en `setupFilesAfterEnv` : l'option n'existe pas,
  le fichier de préparation n'était jamais chargé.
- 48 tests de non-régression couvrant chaque correction ci-dessus.

**Divers**

- Le tableau de bord de sécurité mesure l'état réel de l'instance. Il affichait
  quatre voyants verts écrits en dur, dont un faux.
- Les réponses 500 ne renvoient plus le message d'erreur interne, mais une
  référence à communiquer au support.
- Champs jamais modifiables par un client (`tenantId` en tête) retirés du corps
  des 17 routes de mise à jour qui le passaient tel quel à Mongo.
- MongoDB n'est plus publié sans authentification dans `docker-compose.yml`, et
  la pile décrit enfin son service applicatif.
- `/api/sync` supprimé : sans appelant, il répondait « Synchronisation
  acceptée » sans rien synchroniser.
- Le scheduler ne lève plus `UserModel is not defined` sur les relances CRM.
  Les heures annoncées correspondent maintenant aux expressions cron.

## V1.0.0 — Mars 2026

### Première version publique

**3 profils métier**
- PME : facturation OHADA, comptabilité, paie CNSS, fiscalité DGI Niger, marchés, contrats, stock, projets, CRM
- Associations / ONG : adhérents, cotisations, dons, bureau, projets bailleurs, portail adhérent
- Administrations : budget public, marchés publics (Code Niger 2017), personnel, projets publics, portail fournisseur

**Fiscalité Niger complète**
- TVA 19%, CNSS 3,6%+16,4%, IS/BIC 30%, IR progressif 5 tranches, retenues à la source 8 types
- SMIG 41 000 XOF, prime d'ancienneté (Code Travail art. 167)
- Export PDF certifié DGI, exports SAGE / OHADA / FEC / Cegid / EBP / Divalto

**Infrastructure**
- Next.js 14 App Router · MongoDB/Mongoose · JWT · Tailwind CSS
- PWA hors-ligne avec sync IndexedDB (Service Worker + Background Sync)
- Déploiement VPS Hostinger · Nginx · PM2 · Let's Encrypt
- Paiement Orange Money / Airtel via PayDunya
- Email transactionnel via Brevo

**Sécurité**
- Multi-tenant avec isolation tenantId systématique
- 22 rôles métier dont chef_projet_transversal (voir V1.1.0 : le rôle n'était pas enregistré)
- Expiration session 30 min d'inactivité + révocation admin
- Rate limiting, CSRF, CSP, HSTS

  ⚠ Corrigé en V1.1.0 : la révocation et la vérification CSRF n'étaient pas
  effectives dans cette version, et la limitation de débit ne couvrait que la
  route de connexion.

**Application mobile**
- React Native / Expo (iOS + Android)
- Connexion JWT, dashboard KPIs, 5 onglets de navigation

**Tests**
- 64 tests unitaires fiscaux (TVA, CNSS, IR, ancienneté, IS/BIC)
- Tests d'intégration API + tests E2E Playwright
- Test de charge k6 : 50 utilisateurs simultanés, P95 < 2s

---

*Kanoo — Niamey, Niger · kanoo.ne*
