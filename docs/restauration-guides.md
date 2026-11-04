# Restauration : guides et règles de calcul

Ce document regroupe les livrables du plan d'amélioration qui ne sont pas du code : guides d'utilisation, matrice des droits, dictionnaire des indicateurs, procédure de reprise. Version du 4 novembre 2026.

## 1. Guide du gestionnaire

Tout part de **Restauration → Magasin**, pensé pour le téléphone. Un compte The Spot y arrive directement à la connexion.

| Geste | Ce qu'il fait |
|---|---|
| **Recevoir** | Entrée en réserve, en cartons et en unités. Choisissez « À crédit » (la dette est créée, avec son échéance) ou « Payé maintenant, depuis la caisse ». Sans prix, la réception reste à valoriser : la dette naît à la valorisation. |
| **Monter au comptoir** | Déplace le stock de la réserve vers le comptoir. **Seul le stock du comptoir se vend.** |
| **Compter** | Inventaire à l'aveugle, au scanner, à plusieurs téléphones. |
| **Vendre** | Ouvre le comptoir du site. La caisse s'ouvre dans l'onglet Semaine ; le fonds proposé est le solde de la caisse. |
| **Transférer** | Envoie à un autre site. La marchandise est en transit jusqu'à sa réception, ligne par ligne. Les portions d'un lot partent du comptoir de la cuisine et arrivent au comptoir du site. |
| **Perte** | Casse, péremption, invendus, avec un motif. Distincte d'une vente et d'un écart d'inventaire. |
| **Dépense** | Sortie de caisse par nature (gaz, eau, transport…). Une marchandise ne se saisit pas ici : utilisez Recevoir. |
| **Remise d'espèces** | Vers la banque ou le mobile money : ni recette ni dépense. |
| **Ma semaine** | Besoins de tous les sites par fournisseur, arrondis au carton, transferts à envisager avant d'acheter. |

**Le soir du dernier jour de la semaine** : fermez la caisse, recevez les transferts, comptez, justifiez les écarts, puis clôturez dans le bloc « Fin de semaine ». La clôture arrête toute la journée : plus de vente à cette date. Seules la direction et la comptabilité peuvent rouvrir. Le stock restant repart tel quel la semaine suivante.

**Production.** Un plat est soit « à la commande » (la vente sort les ingrédients), soit « par lot » (Production → Produire un lot sort les ingrédients, la vente sort les portions). Le réglage est dans sa fiche technique. Un lot vaut pour le jour même, sauf date choisie : sans froid maîtrisé, rien ne se garde. Déclarez les invendus en perte en fin de service.

**Avant de lancer un site qui accepte le mobile money ou la carte** : créez ces comptes dans la trésorerie. Sans eux, le paiement arrive sur la caisse et l'arrêté montre un faux excédent.

**Ouvrir la caisse** : comptez le tiroir et gardez le montant proposé s'il est juste. Un fonds saisi à tort se verra en écart à la fermeture.

**Corriger un stock de départ.** Ne ressaisissez pas : comptez l'article par un inventaire, l'écart se corrige et reste tracé.

**Dépôt-vente.** Ce mode n'existe pas encore. Ne saisissez pas une marchandise en dépôt comme une réception : elle gonflerait le stock et la dette.

## 2. Guide de la comptable

Tout part de **Restauration → Espace comptable**.

| Onglet | Usage |
|---|---|
| Journal d'activité | Ventes du jour, entrées et sorties d'argent, factures et règlements. Vendu, encaissé et décaissé sont trois colonnes. Filtres par site, période, catégorie, moyen de paiement, tiers ou statut. Export CSV. Ce n'est pas le livre-journal comptable. |
| Évolution | Une période comparée à la période précédente de même durée, par site : chiffre d'affaires (CA), tickets, sorties de caisse. |
| À contrôler | Écarts de transfert, réceptions sans prix, achats à crédit ou payés en caisse sans facture, factures en retard, financements à qualifier, écarts de caisse, arrêtés manquants, sites à valider, semaines rouvertes, quotes-parts différentes de 100 %. |
| Équilibre | Par site : résultat de gestion cumulé, CA d'équilibre, caisse, échéances à 7 jours, avance restante. Un cumul incomplet est signalé comme tel. |
| Marges | Par article et par mois. Marge attendue pour tous, constatée pour les articles revendus, estimée pour les plats. |
| Stocks | Stock de l'entreprise par article et par site, transit compris une seule fois. |

**Trois vues à ne pas confondre.**

| Vue | Question | Où la lire |
|---|---|---|
| Activité | Qu'a-t-on vendu, et à quel coût ? | Journal, Marges |
| Trésorerie | Qu'a-t-on encaissé et décaissé ? | Comptes de trésorerie, Équilibre |
| Résultat | Que reste-t-il après les charges ? | Pilotage, Équilibre |

**Situation de départ** (Restauration → Ouverture des sites → Situation de départ).
- Qualifiez les apports en compte d'attente en les portant au compte choisi. Un compte de dette (16x, 40x, 46x) rend la ligne remboursable. La comptable traduit un acte (décision, convention) : elle ne le remplace pas.
- Une ligne « payé par le dirigeant » ou « dette de départ » n'a pas d'écriture tant qu'elle n'est pas qualifiée, et ne se rembourse pas avant.
- Le stock de départ, les créances et les équipements ne sont pas comptabilisés d'office : passez-les dans vos écritures. Encaissez une créance de départ en « entrée hors vente », jamais en vente.
- Une ligne qualifiée ne s'annule plus depuis cet écran : corrigez-la par écriture.
- La qualification d'une ligne sans argent laisse le compte d'attente 471 au débit, jusqu'à votre écriture d'entrée du stock ou de l'équipement. Soldez-le.
- Validez la situation quand ressources et emplois sont égaux : c'est aussi la confirmation du taux de TVA du site.

**Résultat.** Le résultat affiché est un résultat de gestion, ni comptable ni fiscal : les achats de marchandises y comptent à la vente, alors qu'ils sont en charge (601) en comptabilité. Un mois « validé » est un mois clos en gestion, pas un résultat arrêté.

**Limites à connaître, à trancher avec un fiscaliste si besoin.**
- **TVA.** Le taux est choisi à l'ouverture du site. Le référentiel fiscal du projet (`docs/REFERENTIEL-FISCAL-SOCIAL-2026.md`) donne 10 % pour la restauration au régime réel : le régime de l'entreprise reste à confirmer. Les réceptions n'enregistrent pas de TVA déductible.
- **Factures.** Selon le référentiel, un achat sans facture conforme peut perdre sa déductibilité : l'onglet À contrôler compte ces achats, il ne vérifie pas leur conformité.
- **Certification des tickets (SECeF) et précompte à la source.** Non traités sur les tickets du comptoir ni sur les règlements faits ici. Non vérifiés dans les textes.
- **Conservation.** Ne purgez ni pièces ni écritures : la durée légale citée par l'audit est de dix ans (à confirmer). Les signatures de transfert sont des visas de réception, pas des signatures électroniques ; elles contiennent des données personnelles à traiter comme telles.

## 3. Écritures produites

| Opération | Débit | Crédit | Au résultat de gestion |
|---|---|---|---|
| Virement vers un site | Caisse du site | Compte source (via 585000) | Non |
| Avance reçue | Caisse du site | 462000 | Non |
| Apport, origine à préciser | Caisse du site | 471000, jusqu'à qualification | Non |
| Qualification d'un apport | 471000 | Compte choisi | Non |
| Qualification d'une ligne sans argent | 471000 | 462000 ou 401100 | Non |
| Remboursement | Compte de la dette | Compte qui paie | Non |
| Réception à crédit | 601100 | 401100 | À la vente seulement |
| Réception payée en caisse | 601100 | Caisse du site | À la vente seulement |
| Paiement fournisseur | 401100 | Caisse ou compte | Non |
| Retour fournisseur (avoir) | 401100 | 601100 | Non |
| Remise en banque | Banque (via 585000) | Caisse du site | Non |
| Frais de livraison du jour | 618000 | Caisse du site | Charge de transport |

Les ventes et leur TVA suivent les écritures de caisse déjà en place. Les comptes 462000, 471000 et le choix de 401 plutôt que 408 pour une marchandise reçue sans facture sont à confirmer par la comptable. Le stock de départ n'est pas comptabilisé.

## 4. Matrice des droits

Le tableau décrit ce que fait le code. Les cinq profils du plan (caissier, gestionnaire, responsable achats, comptable, direction) n'existent pas tels quels : le caissier et le gestionnaire sans droit aux coûts sont « employé », le gestionnaire est « chef de site », et le responsable achats n'a pas de rôle propre.

| Action | Employé The Spot (`svc_spot` employé) | Chef de site (`svc_spot` chef) | Comptabilité (`pme_accountant`, `svc_compta`) | Direction (`pme_admin`, `pme_manager`) |
|---|---|---|---|---|
| Vendre, encaisser, saisir une dépense de caisse | Oui | Oui | Oui | Oui |
| Recevoir sans prix, monter, transférer, déclarer une perte, compter | Oui | Oui | Oui | Oui |
| Voir les coûts, saisir les prix, saisir une réception payée | Non | Oui | Oui | Oui |
| Valider un inventaire | Non | Oui, sous le seuil | Oui | Oui |
| Clôturer une semaine | Non | Oui | Oui | Oui |
| Rouvrir une semaine, régler le seuil | Non | Non | Oui | Oui |
| Trancher un écart de transfert | Non | Oui | Oui | Oui |
| Payer un fournisseur | Non | Depuis la caisse du site | Tout compte | Tout compte |
| Retour fournisseur, commande groupée, remise d'espèces | Non | Oui | Oui | Oui |
| Ouvrir, archiver un site ; allouer de l'argent | Non | Non | Oui | Oui |
| Espace comptable (hors marges) | Non | Non | Oui | Oui |

**Périmètre.** Un employé ou un chef avec des sites attribués reste sur ces sites. Un chef sans site attribué voit tous les sites : attribuez-lui les siens à l'ouverture. La comptabilité et la direction voient tous les sites.

**Pas encore livré.** Il n'y a pas de rôle « responsable achats » dédié, ni de séparation entre caissier et magasinier : tous deux sont « employé ».

## 5. Dictionnaire des indicateurs

| Indicateur | Formule |
|---|---|
| Coût moyen pondéré | Recalculé à chaque entrée valorisée, **par article, tous sites confondus** : la fiche du catalogue est commune. Le prix payé par un site influe donc sur le coût des autres : règle à valider (R1 de `docs/audit-restauration-lot0.md`). |
| Stock d'un site | Comptoir + réserve, en unités. Le carton n'est qu'un conditionnement. |
| Marge attendue | Ventes nettes − quantité × coût standard de la fiche. |
| Marge constatée (article revendu) | Marge des tickets − pertes + écarts d'inventaire de l'article. |
| Marge matière (site) | Ventes − coût des ventes − pertes − repas du personnel + écarts. |
| Résultat après charges du site | Marge matière − charges directes. |
| Résultat après charges centrales | Résultat après charges du site − quote-part des charges communes. |
| CA d'équilibre | Charges du mois ÷ taux de marge matière. |
| Espèces attendues | Fonds compté à l'ouverture + entrées − sorties en espèces après l'ouverture, dotations et remises comprises. |
| Prix conseillé | Coût retenu ÷ (1 − taux cible − frais), jamais appliqué tout seul. |
| Besoin à commander | Demande sur la période de l'article (ajustée des événements, sur la moyenne des ventes) − stock − commandes en cours, arrondi au carton. Les lots périmés comptent encore dans le stock. |
| Seuil de validation d'écart | 50 000 FCFA par défaut sur un nouveau site : hypothèse à valider, modifiable par la comptable. |

Un résultat est **estimé** tant que le mois n'est pas clos, **validé** ensuite, ce qui veut dire clos en gestion.

## 6. Procédure de reprise et de nouveau départ

La société continue : c'est une reprise de gestion, pas un nouvel exercice. Sa comptabilité se poursuit sans rupture.

1. **Administrateur** : sauvegardez la base de production et vérifiez sur une base de test qu'elle se relit.
2. **Comptable** : validez la procédure, le sort du stock restant et les écritures à passer. Rien ne se fait avant.
3. Faites un inventaire physique des sites à archiver et validez-le : le solde du stock se fait sur la quantité connue du logiciel.
4. Fermez les caisses, recevez et tranchez les transferts, révoquez les clés EasyPay. L'archivage est refusé sinon.
5. Restauration → Ouverture des sites → « Repartir de zéro » : choisissez les sites, soldez le stock, indiquez où virer le solde des caisses, tapez ARCHIVER. L'état chiffré de chaque site est gardé au journal d'audit.
6. Ouvrez chaque site avec l'assistant : site, argent, stock compté, équipe, charges. Pour un stock repris, répondez « l'entreprise » à la question « Qui a payé ce stock ? ».
7. Reliez EasyPay au nouveau site depuis le comptoir, si le site vend par carte.
8. Faites qualifier les financements par la comptable, puis faites-lui valider la situation de départ.
9. Faites tourner un site pilote une semaine complète avant de généraliser.

**Ce que l'archivage change** : le nom du site et de son secteur (suffixe « archivé »), le statut des articles, les inventaires ouverts (annulés), le stock (soldé par ajustement tracé, si vous le choisissez), le solde de caisse (viré, si vous le choisissez). Les ventes, écritures et mouvements passés ne sont pas modifiés. Les dettes et avances d'un site archivé restent dues : la comptable les retrouve dans l'espace comptable, et elles se règlent depuis un compte de l'entreprise.
