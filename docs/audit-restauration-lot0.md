# Restauration (The Spot) — Lot 0 : audit de l'existant et règles à valider

Version du 1er novembre 2026, sur le code `main` (a38ef1c) et les ajouts « ouverture des sites ». La section 0 fait le suivi au 4 novembre 2026 ; les sections suivantes décrivent l'état du 1er novembre, avant les corrections.
Ce document répond au point 2 du plan d'amélioration : cartographie, anomalies, tableau « conserver / corriger / développer », règles à faire approuver avant les lots suivants.

> Ce lot 0 est un auto-diagnostic du 1er novembre. Le comité d'audit indépendant a examiné ensuite les corrections, le 4 novembre 2026.

---

## 0. Suivi au 4 novembre 2026

« Livré » veut dire présent dans le code et testé ; les règles R1 à R10 restent à valider.

| N° | État | Ce qui a été fait |
|---|---|---|
| A1 | Livré, avec réserve | Réception à crédit = facture validée (601 / 401), paiement, retour borné à la réception, solde par fournisseur. Réception sans prix : dette à la valorisation. Commande reçue sans facture : dette estimée affichée, non comptabilisée. Le choix 401 ou 408 est à confirmer. |
| A2 | Livré, avec réserve | Argent comptabilisé avec son origine, qualification, remboursement, validation de la situation. Soldes banque et mobile money non repris dans l'assistant. |
| A3 | Livré pour les nouveaux sites | Article relié au catalogue commun. Les anciens sites gardent les deux mécanismes. |
| A4 | Livré pour les nouveaux sites | Achat de marchandises en dépense refusé : la réception est obligatoire. |
| A5 | Livré, avec réserve | Transit, réception par ligne, écart tranché. L'état « préparé » n'existe pas : l'envoi vaut expédition. |
| A6 | Livré | Virements hors recettes et dépenses, reflétés sur la caisse du site. |
| A7 | Livré, avec réserve | Clôture de semaine, réouverture par la direction et la comptabilité, seuil, écarts justifiés. La clôture arrête toute la journée, sans heure de coupure. |
| A8 | Livré sur les écrans Restauration | Clé d'opération sur les saisies. La clé ne survit pas à la fermeture de la fenêtre. |
| A9 | Livré | Trois niveaux de résultat, estimé ou validé. |
| A10 | Ouvert | Avertissement React en mode développement seulement. |

**Rectification de cette version.** La cartographie disait « CMUP par article et par site » (règle R1) : le coût moyen unitaire pondéré (CMUP) est en réalité **commun à tous les sites**, car il est porté par la fiche du catalogue. La règle R3 (« CMUP du site expéditeur ») n'existe donc pas telle quelle. R1 est à valider sous cette forme, ou à changer : un coût par site est un chantier à part.

**Non livré** : dépôt-vente et contrat fournisseur, photo du justificatif, coût standard daté et emballage séparé, export Excel et PDF (le journal sort en CSV), date de saisie distincte de la date effective, annulation d'un lot de production, liste de marché, rôle « responsable achats », écritures d'ouverture automatiques, TVA déductible à la réception, précompte, certification des tickets.

**Limites connues après le comité d'audit** : un inventaire compté sur deux appareils, avec une vente entre les deux, peut montrer un faux écart ; un paiement mobile sans compte mobile money arrive sur la caisse ; l'annulation EasyPay d'une vente d'une journée arrêtée est refusée et reste à rejouer ; une commande groupée part par site, en cartons entiers par site, sans livraison centrale ; le stock d'un site compte encore ses lots périmés dans le réassort ; une ardoise d'un site archivé se règle, mais sa caisse doit rester reliée.

La procédure de reprise à jour est dans `docs/restauration-guides.md`, section 6.

## 1. Cartographie courte du fonctionnement actuel

| Élément | Fonctionnement actuel |
|---|---|
| Site | « Comptoir » (`ActivityDesk`) : caisse de trésorerie, secteur analytique, comptoir (stock de vente) et réserve (stock en gros), équipe, charges prévues, marge visée. |
| Catalogue | Articles par site (`ActivityItem`) reliés à une fiche du catalogue commun (`Product`, code `RST-…` créé automatiquement). Stock tenu à l'unité ; le carton est un conditionnement (`pack.size`), jamais un second stock. |
| Mouvements de stock | Tous passent par la gestion de stock commune (`applyMovement` / `transferStock`) : réception, vente, perte, transfert réserve ↔ comptoir, transfert entre sites, ajustement d'inventaire, stock d'ouverture. Chaque mouvement garde date, auteur, motif, pièce, lot et coût. |
| Valorisation | Coût moyen unitaire pondéré (CMUP) par article, commun à tous les sites ; le prix minimum retient le plus élevé du CMUP et du dernier prix d'achat. |
| Ventes | Ticket de caisse : sortie de l'article vendu, ou des ingrédients de sa recette (au prorata des portions et du rendement). |
| Inventaire | Comptage au scanner sur plusieurs appareils, à l'aveugle (stock théorique révélé à la validation, figé au premier comptage) ; écart passé en mouvement tracé. Inventaire du samedi ouvert d'office ; les articles mensuels ou bimensuels seulement quand c'est leur tour. |
| Résultat | Par site et par mois : CA HT, coût des ventes, pertes, repas du personnel, écarts d'inventaire, charges par rubrique (comptabilité + caisse), personnel par les bulletins, dotations des équipements, quote-part des charges communes ; mois clos figé. |
| Comptabilité | Ventes et dépenses de caisse passées en écritures (classe 7, classe 6, caisse) ; achats de marchandises (601) hors charges du résultat de gestion. |

## 2. Réponses aux huit points de contrôle

| Point | Constat | Statut |
|---|---|---|
| Quelle opération fait entrer ou sortir un produit ? | Réception (réserve ou commande), vente, perte, transfert, inventaire, stock d'ouverture, livraison permanente. **Exception** : un article non relié au catalogue garde une quantité propre (ancien mécanisme). Toute réception le relie d'office. | À corriger (A3) |
| Achats distingués des consommations ? | Oui : l'achat entre en stock, la consommation sort à la vente au coût. Exception : une dépense de caisse « marchandises » sans réception est comptée comme consommée, avec un avertissement. | Conforme, à durcir (A4) |
| Ingrédients déstockés une seule fois ? | Oui, avec un seul mode : la vente d'un plat consomme ses ingrédients. Le bon de sortie réserve → cuisine est un transfert, pas une consommation. La **production par lot** (créer des portions, puis vendre les portions) n'existe pas. | À développer (lot 4) |
| Pertes déduites une seule fois ? | Oui : pertes déclarées et écarts d'inventaire sont séparés ; le motif « inventaire » ne se déclare pas à la main. | Conforme |
| Paiements fournisseurs reliés aux factures ? | Pour les commandes, oui (module Achats). **Une réception en réserve à crédit ne crée aucune dette fournisseur** : seul le numéro de facture se rapproche. | **Anomalie majeure (A1)** |
| Transferts internes exclus du CA ? | Oui pour les transferts de stock entre sites (aucune vente créée). Les virements caisse → banque n'ont pas été vérifiés. | Conforme / non vérifié (A6) |
| Consolidation = somme des sites sans double compte ? | Les transferts sont instantanés : pas de stock « en transit » compté deux fois, mais pas de suivi du transit. Les sites archivés gardent leur stock tant qu'il n'est pas soldé. | À corriger (A5, lot 2) |
| Montants HT conformes au régime fiscal ? | Le HT se calcule avec le taux de TVA du site, 0 % par défaut (HT = TTC). Le régime réel de l'entreprise n'est pas vérifié. | **À valider par la comptable (R7)** |

## 3. Anomalies et corrections prioritaires

| N° | Gravité | Anomalie | Correction proposée |
|---|---|---|---|
| A1 | Majeure | Réception à crédit sans dette fournisseur en comptabilité (401) : le solde dû au fournisseur n'est pas suivi. | Lot 3 : chaque réception non payée crée une facture fournisseur à recevoir. Paiement, avoir et retour la soldent. Rapprochement commande – livraison – facture – paiement. |
| A2 | Majeure | Le montant de départ d'un site est le solde d'ouverture de sa caisse ; sa nature (apport, avance remboursable) n'est pas enregistrée. | Lot 1 : assistant d'ouverture complet. Financements, dettes et créances de départ, paiements personnels du dirigeant ; écritures d'ouverture validées par la comptable. |
| A3 | Moyenne | Deux mécanismes de stock (article relié ou non au catalogue). | Lot 2 : migration qui relie tous les articles des nouveaux sites (déjà le cas à l'ouverture) et interdit les articles non reliés. |
| A4 | Moyenne | Dépense de caisse « marchandises » sans réception = consommation supposée. | Lot 2 : bloquer cette catégorie quand le site tient un stock, et proposer la réception à la place. |
| A5 | Moyenne | Transfert entre sites instantané, sans état « en transit » ni réception contradictoire des quantités. | Lot 2 : circuit préparé → expédié → en transit → reçu, avec écart qui ouvre une anomalie. |
| A6 | À vérifier | Virements caisse → banque et entre caisses : traitement dans les totaux consolidés non vérifié. | Lot 5 : test « remise de caisse en banque : aucun chiffre d'affaires ». |
| A7 | Moyenne | Pas de clôture hebdomadaire (seul le mois se clôt), pas de seuil de validation renforcée des écarts. | Lot 2 : clôture de semaine, réouverture réservée, seuil configurable. |
| A8 | Moyenne | Saisies répétées : les ventes sont protégées (identifiant client) ; les réceptions, pertes et dépenses ne le sont pas après un problème réseau. | Lot 2 : clé d'opération sur toutes les saisies (une saisie répétée n'est prise en compte qu'une fois). |
| A9 | Faible | Résultat présenté en un seul niveau (charges directes et quote-part mélangées). | Lot 5 : trois niveaux — marge, résultat après charges directes, résultat après quote-part. |
| A10 | Faible | Avertissement React en mode développement sur toutes les pages (aucun effet en production). | À traiter avec le lot 6. |

## 4. Tableau des fonctionnalités : conserver, corriger, développer

| Domaine (plan) | Existant | Décision |
|---|---|---|
| Catalogue commun, unité de stock, carton (Jus IRA) | Article par site relié au catalogue ; carton = conditionnement ; « 2 cartons + 5 » = 53 à l'inventaire ; réception de 3 cartons = 72. Le changement de conditionnement ne recalcule pas l'historique : les mouvements sont en unités. | **Conserver** ; compléter : références fournisseurs, coûts datés, prix par site (lot 1) |
| Trois catégories (revendu, matière, préparation) | Revendu / matière non distingués explicitement ; préparation = article avec recette. | **Corriger** (lot 1) : catégorie explicite |
| Doublons, archivage plutôt que suppression, historique | Archivage existant ; codes-barres uniques ; journal d'audit. Pas de détection de doublons de noms. | **Corriger** (lot 1) |
| Mouvements et pièces obligatoires | Date, auteur, motif, pièce, lot. Date de saisie distincte de la date effective : partielle. | **Corriger** (lot 2) |
| Transferts entre sites | Bon signé à l'envoi et à la réception, lots et coût conservés. | **Corriger** (lot 2) : transit et écart |
| Inventaire et clôture hebdomadaire | Comptage à l'aveugle, plusieurs appareils, ventes pendant le comptage, pertes séparées des écarts. | **Conserver** ; ajouter clôture de semaine et seuil (lot 2) |
| Recettes et fiches techniques | Portions, rendement, allergènes, procédé, coût et prix minimum. | **Conserver** ; ajouter emballage séparé, coût standard daté (lot 4) |
| Production par lot | Absente. | **Développer** (lot 4), exclusive du mode « à la commande » par produit |
| Marges attendue / constatée | Marge par article (théorique) ; écarts par article au coût ; résultat par site. | **Corriger** (lot 4) : marge estimée par plat, constatée par famille |
| Prix suggérés sans changement automatique | Prix minimum = coût ÷ (1 − cible − frais) ; application manuelle, bloquée si taux provisoire. | **Conserver** ; ajouter historique des prix (lot 4) |
| Prévisions | Emploi du temps du campus (vacances, examens), moyenne des mêmes jours, pré-commandes. | **Corriger** (lot 6) : événements, promotions, ruptures, ajustement commenté |
| Commandes groupées multisites | Bons brouillon par fournisseur et par site ; réassort par rythme d'article. | **Développer** (lot 3) : consolidation, transfert avant achat |
| Fournisseurs : contrat, dépôt-vente, solde | Fiche fournisseur simple ; pas de modèle contractuel. | **Développer** (lot 3) |
| Espace comptable (journal, évolution, à contrôler) | Comptabilité générale, rapprochements, arrêté de caisse, exports dans Kanoo ; pas de vue Restauration dédiée. | **Développer** (lot 5) |
| Charges par site, clé de répartition | Rubriques, clé du secteur partagé, quote-part commune, dotations, personnel par bulletins. | **Conserver** ; ajouter trois niveaux de résultat (lot 5) |
| Situation de départ et équilibre | **Nouveau** : ouverture de site (caisse et montant, agents, charges prévues, stock d'ouverture) ; point mort au Pilotage. | **Corriger** (lot 1) : financements et dettes de départ, avance restant due |
| Droits par rôle et par site | Coûts, paie, sites autorisés, caissier sans coûts. | **Corriger** (lot 1) : matrice des cinq profils, accueil gestionnaire |

## 5. Règles à faire approuver (comptable et direction)

| N° | Règle proposée | À décider |
|---|---|---|
| R1 | Valorisation au coût moyen unitaire pondéré (CMUP) par article, commun à tous les sites. | Validation |
| R2 | Frais d'approvisionnement (livraison) en charge « transport » du site, pas dans le coût du produit. | Ou incorporés au coût ? |
| R3 | Transferts entre sites au CMUP du site expéditeur, sans marge interne. | Validation |
| R4 | Retours fournisseur : sortie au coût d'entrée du lot, avoir attendu. | Validation |
| R5 | Corrections rétroactives interdites sur une semaine ou un mois clos ; correction par mouvement daté du jour, avec renvoi. | Validation |
| R6 | Stock négatif : interdit, sauf option « vente tolérée » par site (écart régularisé à l'inventaire). | Garder l'option ? |
| R7 | Régime fiscal : taux de TVA des ventes par site (0 % aujourd'hui) — **non vérifié** ; taxe applicable à préciser. | La comptable fixe le taux |
| R8 | Montant de départ : fonds de caisse ; la comptable qualifie l'origine (apport, avance remboursable, compte courant). | Écritures d'ouverture |
| R9 | Stock restant des anciens sites soldé par ajustement « Clôture avant nouveau départ », puis ressaisi en stock d'ouverture. | Écriture de clôture à valider |
| R10 | Avantage en nature des repas du personnel, base horaire de 173,33 h, repères d'hygiène. | Confirmation (déjà signalés) |

## 6. Plan de réalisation proposé (après approbation)

| Lot | Contenu | Dépend de | Taille estimée |
|---|---|---|---|
| 1 | Catégories d'articles, références fournisseurs, coûts datés, prix par site, doublons, matrice des droits, accueil gestionnaire, assistant d'ouverture complet (financements, dettes de départ) | R1, R7, R8 | Moyenne |
| 2 | Article toujours relié au catalogue, transit des transferts, clôture hebdomadaire, clé d'opération, date de saisie / date effective | Lot 1, R5, R6 | Moyenne |
| 3 | Dette fournisseur à la réception, contrat fournisseur (comptant, différé, dépôt-vente), commandes groupées multisites, rapprochement complet | Lot 2, R2, R4 | Grande |
| 4 | Production par lot exclusive, coût standard daté, emballage, marge estimée et constatée | Lot 2 | Moyenne |
| 5 | Espace comptable Restauration (journal, évolution, à contrôler), trois niveaux de résultat, trésorerie distincte de l'activité | Lot 3 | Grande |
| 6 | Prévisions (événements, ruptures, ajustement commenté), tableaux de bord | Lots 2 à 5 | Moyenne |

Chaque lot comprendra ses tests : les 14 tests obligatoires du plan seront ajoutés au fur et à mesure au scénario `scripts/e2e/restaurant-logic.ts`, qui en contient déjà 113. Le test Jus IRA (3 cartons = 72, 10 cartons = 240) et le test du stock d'ouverture sans effet sur le résultat sont déjà en place.
