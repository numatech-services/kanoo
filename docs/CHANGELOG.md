# Kanoo — Changelog

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
