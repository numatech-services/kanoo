# Restauration : guides et règles de calcul

Ce document regroupe les livrables du plan d'amélioration qui ne sont pas du code : guides d'utilisation, matrice des droits, dictionnaire des indicateurs, procédure de reprise. Version du 4 novembre 2026.

## 1. Guide du gestionnaire

Tout part de **Restauration → Magasin**, pensé pour le téléphone.

| Geste | Ce qu'il fait |
|---|---|
| **Recevoir** | Entrée en réserve, en cartons ou en unités. Payé en caisse, ou à crédit : la dette fournisseur est créée aussitôt. |
| **Vendre** | Ouvre la caisse du site. |
| **Monter au comptoir** | Déplace le stock de la réserve vers le comptoir. |
| **Compter** | Inventaire à l'aveugle, au scanner, à plusieurs téléphones. |
| **Transférer** | Envoie à un autre site. La marchandise est en transit jusqu'à sa réception signée. |
| **Perte** | Casse, péremption, avec un motif. Distinct d'une vente et d'un écart d'inventaire. |
| **Dépense** | Sortie de caisse par nature (gaz, eau, transport…). Une marchandise ne se saisit pas ici : utilisez Recevoir. |
| **Ma semaine** | Besoins de tous les sites, par fournisseur, arrondis au carton. |

**Le samedi** : recevez les transferts en attente, comptez, puis clôturez la semaine depuis le bloc « Fin de semaine ». La clôture garde le stock restant : la semaine suivante repart de ce stock.

**Production.** Un plat est soit « à la commande » (la vente sort les ingrédients), soit « par lot » (Production → Produire un lot sort les ingrédients, la vente sort les portions). Le réglage est dans sa fiche technique. Un plat n'est jamais dans les deux modes à la fois.

## 2. Guide de la comptable

Tout part de **Restauration → Espace comptable**.

| Onglet | Usage |
|---|---|
| Journal | Ventes du jour, entrées et sorties de caisse, factures. Filtres par site, période, catégorie, moyen de paiement. Export CSV. |
| Évolution | Une période comparée à la période précédente de même durée, par site. |
| À contrôler | Écarts de transfert, réceptions sans prix ou sans facture, factures en retard, financements à qualifier, écarts de caisse, arrêtés manquants. |
| Équilibre | Par site : résultat cumulé, CA d'équilibre, trésorerie, échéances à 7 jours, avance restante. |
| Marges | Par article et par mois. Attendue pour tous, constatée pour les articles revendus, estimation pour les plats. |
| Stocks | Stock de l'entreprise par article et par site, transit compris une seule fois. |

**Trois vues à ne pas confondre.**

| Vue | Question | Où la lire |
|---|---|---|
| Activité | Qu'a-t-on vendu, et à quel coût ? | Journal, Marges |
| Trésorerie | Qu'a-t-on encaissé et décaissé ? | Comptes de trésorerie, Équilibre |
| Résultat | Que reste-t-il après les charges ? | Pilotage, Équilibre |

**Situation de départ** (Restauration → Ouverture des sites → Situation de départ) : qualifiez les apports en compte d'attente 471000 vers le compte retenu. Les lignes sans mouvement d'argent (dirigeant, dettes de départ, créances, équipements) ne sont pas écrites d'office : passez-les dans les écritures d'ouverture.

## 3. Écritures produites

| Opération | Débit | Crédit | Au résultat de gestion |
|---|---|---|---|
| Virement vers un site | Caisse du site | Compte source (via 585000) | Non |
| Avance reçue | Caisse du site | 462000 | Non |
| Apport, origine à préciser | Caisse du site | 471000, jusqu'à qualification | Non |
| Remboursement d'avance | 462000 | Compte qui paie | Non |
| Réception à crédit | 601100 | 401100 | À la vente seulement |
| Réception payée en caisse | 601100 | Caisse du site | À la vente seulement |
| Paiement fournisseur | 401100 | Caisse ou compte | Non |
| Retour fournisseur (avoir) | 401100 | 601100 | Non |
| Remise en banque | Banque (via 585000) | Caisse du site | Non |
| Frais de livraison du jour | 618000 | Caisse du site | Charge de transport |

Le stock de départ n'est pas écrit en comptabilité : il est tracé en stock et figure dans la situation de départ. Son écriture d'ouverture revient à la comptable. Les comptes 462000 et 471000 sont à confirmer par elle.

## 4. Matrice des droits

Les droits s'appuient sur les rôles existants. La correspondance avec les profils du plan est à confirmer à la création des comptes.

| Action | Caissier | Gestionnaire (chef du site) | Responsable achats | Comptable | Direction |
|---|---|---|---|---|---|
| Vendre, encaisser | Oui | Oui | Non | Oui | Oui |
| Recevoir, transférer, perte, compter | Non | Oui | Non | Oui | Oui |
| Voir les coûts et les marges | Non | Oui | Oui | Oui | Oui |
| Valider un inventaire | Non | Oui, sous le seuil | Non | Oui | Oui |
| Clôturer ou rouvrir une semaine | Non | Oui | Non | Oui | Oui |
| Trancher un écart de transfert | Non | Oui | Non | Oui | Oui |
| Payer un fournisseur, retour | Non | Oui | Oui | Oui | Oui |
| Commande groupée | Non | Oui | Oui | Oui | Oui |
| Ouvrir, archiver un site ; allouer de l'argent | Non | Non | Non | Oui | Oui |
| Espace comptable (hors marges) | Non | Non | Non | Oui | Oui |

Un utilisateur ne voit que ses sites autorisés, sauf s'il a accès à tous.

## 5. Dictionnaire des indicateurs

| Indicateur | Formule |
|---|---|
| Coût moyen pondéré | Recalculé à chaque entrée valorisée, **par article, tous sites confondus** : la fiche du catalogue est commune. |
| Stock d'un site | Comptoir + réserve, en unités. Le carton n'est qu'un conditionnement. |
| Marge attendue | Ventes nettes − quantité × coût standard de la fiche. |
| Marge constatée (article revendu) | Marge des tickets − pertes + écarts d'inventaire de l'article. |
| Marge matière (site) | Ventes − coût des ventes − pertes − repas du personnel + écarts. |
| Résultat après charges du site | Marge matière − charges directes. |
| Résultat après charges centrales | Résultat après charges du site − quote-part des charges communes. |
| CA d'équilibre | Charges du mois ÷ taux de marge matière. |
| Espèces attendues | Fonds de caisse + recettes en espèces − sorties en espèces. Dotations et remises comprises. |
| Prix conseillé | Coût retenu ÷ (1 − taux cible − frais), jamais appliqué tout seul. |
| Besoin à commander | Demande sur la période, ajustée des événements, + sécurité − stock − commandes en cours, arrondi au carton. |

Un résultat est **estimé** tant que le mois n'est pas clos, **validé** ensuite.

## 6. Procédure de reprise et de nouveau départ

1. Sauvegardez la base de production, puis vérifiez que la sauvegarde se relit sur une base de test.
2. Fermez les caisses des sites à archiver et recevez les transferts en attente. L'archivage est refusé sinon.
3. Restauration → Ouverture des sites → « Repartir de zéro » : choisissez les sites, soldez le stock, indiquez où virer le solde des caisses, tapez ARCHIVER.
4. Ouvrez chaque site avec l'assistant : site, argent, stock compté, équipe, charges.
5. Reliez EasyPay au nouveau site depuis le comptoir, si le site vend par carte.
6. Sur la Situation de départ, vérifiez que les ressources égalent les emplois.
7. La comptable passe les écritures d'ouverture et de clôture, et qualifie les financements.
8. Faites tourner un site pilote une semaine complète avant de généraliser.

Les anciennes données ne sont jamais modifiées, sauf le solde de stock, tracé par un ajustement.
