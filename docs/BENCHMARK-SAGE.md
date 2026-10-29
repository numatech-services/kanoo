# Comptabilité de Kanoo : export financier, erreurs corrigées, benchmark avec Sage 100

Numatech Services — 29 octobre 2026 — destinataires : gérant, expert-comptable — version 1

## Synthèse

1. **L'export financier complet existe désormais dans Kanoo.** Il sera disponible en production après la mise en ligne de cette version. Ces travaux ont été menés sans accès à la base de production. C'est donc l'organisation qui lance elle-même l'export : ses données ne sortent que par elle. Le classeur Excel contient toute la comptabilité de l'exercice et une feuille « Contrôles » qui désigne chaque écart entre les pièces et les comptes.
2. **Treize erreurs comptables et fiscales ont été corrigées dans le code** (§ 2). Elles comprennent l'alignement de l'IS/BIC et des échéances sur le CGI 2026. Plusieurs ont pu laisser des traces dans les données ou les déclarations déjà faites. Le § 2 indique pour chacune ce qu'il faut vérifier.
3. **Comparé à Sage 100 Comptabilité**, Kanoo est en avance sur l'intégration : chaque facture, achat, note de frais, bulletin et ticket passe son écriture tout seul. Il est en retard sur la tenue des comptes de tiers, la numérotation et la validation des écritures, la liquidation de la TVA et les régularisations de fin d'exercice. Le § 5 classe les améliorations par priorité.

## 1. Ce que vous devez faire

| Étape | Qui | Quand | Action |
|---|---|---|---|
| 1 | Équipe technique de Numatech (éditeur de Kanoo) | À la livraison | Fusionner la version sur la branche principale, déployer, puis lancer `npm run indexes` pour créer l'index unique des déclarations IS/BIC |
| 2 | Gérant ou comptable (droit de saisie comptable ; droit de lecture des bulletins pour la feuille Paie) | Dès la mise en ligne | Comptabilité → États comptables → « Export de l'exercice » : lancer **2026**, puis **2025**, puis chaque exercice antérieur qui a des écritures |
| 3 | Gérant | Tout de suite | Dire à l'équipe technique **quelles erreurs vous avez constatées vous-même** : chacune doit retrouver son contrôle ou sa correction |
| 4 | Gérant | Dans la foulée | Ouvrir la feuille « Contrôles ». Transmettre à l'équipe technique les constats dont la colonne « Où corriger » le demande (régénération ou extourne d'une écriture liée à une pièce, procédure en annexe 1). Ne rien saisir à la main pour compenser |
| 5 | Comptable | Sous une semaine | Traiter les autres constats (lettrage, rapprochement bancaire, rattachement des tiers), puis relancer l'export : les constats traités disparaissent |
| 6 | Cabinet comptable | Avant la clôture 2026 | Valider les reclassements (OD) que demandent les contrôles, et les écarts « À vérifier » |

**Exercice clôturé ou période verrouillée.** Ne rien annuler : passer une régularisation sur l'exercice en cours, validée par le cabinet.

**Confidentialité.** Le classeur contient des données nominatives : clients, fournisseurs, et la paie par matricule. Il est à transmettre au seul cabinet, par un canal sûr, et les copies inutiles sont à supprimer.

## 2. Erreurs corrigées, et conséquences sur les données existantes

| # | Erreur | Conséquence sur les données existantes | Action |
|---|---|---|---|
| 1 | **Aucune déclaration IS/BIC ne pouvait être enregistrée** : le type de déclaration était refusé à l'enregistrement | Aucune déclaration IS/BIC n'est enregistrée dans Kanoo | Enregistrer celle de 2025 après validation par le fiscaliste (point 5 du § 5) |
| 2 | Le résultat fiscal IS/BIC ignorait la classe 8 : plus-values de cession et autres produits HAO non imposés, charges HAO non déduites | Si l'IS/BIC 2025 a été déposé avec le chiffre affiché par Kanoo, il peut être faux | Recalculer 2025 (Fiscalité → IS/BIC) et comparer au montant déposé ; déposer une rectificative si l'écart est significatif |
| 2 bis | Règles IS/BIC antérieures au CGI 2026 : minimum fixe de 1 000 000 FCFA au lieu de l'IMF (1,75 % du chiffre d'affaires HT, 0,75 % pour l'industrie) ; acomptes 2 × 1/3 en mars et juillet au lieu de 3 × 20 % avant le 1er juillet, le 1er septembre et le 1er novembre ; un taux agricole de 15 % qui n'existe plus était proposé (le taux réduit est de 26 %, pour les secteurs prévus) | IS 2025 et acomptes 2026 calculés à l'ancien barème | Faire vérifier par le fiscaliste l'IS 2025 déposé et les acomptes 2026 versés |
| 2 ter | Échéance de la TVA affichée et rappelée au 20 du mois, au lieu d'**avant le 15** | Dépôts possiblement tardifs | Vérifier les dates de dépôt de 2026 et les éventuelles pénalités |
| 3 | La déclaration IS/BIC reprenait le montant envoyé par le navigateur, et pouvait être réécrite sans trace | — | Montant recalculé par le serveur ; une seule déclaration par exercice ; rectification avec motif, version précédente conservée au journal d'audit |
| 4 | TVA : le bouton « Soumettre la déclaration » ne faisait rien ; la route enregistrait les montants du navigateur et une nouvelle déclaration à chaque envoi | Les déclarations de TVA enregistrées dans Kanoo, s'il y en a, ne sont pas fiables | Enregistrer chaque mois déclaré (Fiscalité → TVA) ; la feuille « TVA » de l'export compare mois par mois |
| 5 | Annulation d'un encaissement en espèces : une seule des deux écritures (règlement, timbre-quittance) était extournée, au hasard | Des règlements annulés peuvent encore figurer en trésorerie et en créance client | Contrôle « Encaissement annulé encore comptabilisé » de l'export ; désormais, Kanoo demande si le reçu a été remis (le timbre reste alors dû) |
| 6 | Export Sage : accents déformés (fichier en UTF-8 annoncé comme Windows-1252), référence de pièce non protégée, période non contrôlée | Les fichiers déjà envoyés au cabinet ont des libellés illisibles | Prévenir le cabinet de les écarter ; refaire l'export Sage par exercice |
| 7 | **Aucune note de frais ne pouvait être soumise** : les lignes arrivaient vides au contrôle | Notes restées en brouillon | Les soumettre à nouveau, après avoir vérifié qu'aucune n'a déjà été remboursée hors de Kanoo. L'écriture est datée du jour de l'approbation : une dépense d'un mois ou d'un exercice passé tombe dans la période en cours, à faire valider par le cabinet |
| 8 | Les notes de frais étaient passées sur des numéros du plan comptable français : 6251 à 6253 (« voyages », « missions »), qui sont des **primes d'assurance** en SYSCOHADA ; 6241, qui est l'entretien ; 6288 et 6289, de la rubrique 628 (télécommunications) ; les fournitures allaient au 6051, qui est l'eau | Charges mal classées dans les notes approuvées avant la correction | Contrôle « Notes de frais sur un compte non conforme au SYSCOHADA » : OD de reclassement validée par le cabinet, référencée RECL-NDF. Désormais : 618000 transport, 638200 missions et réceptions, 633000 formation, 605500 fournitures, 638000 autres (sous-comptes à confirmer par le cabinet) |
| 8 bis | TVA récupérée par défaut sur l'hébergement, alors que la TVA sur le logement n'est pas déductible (CGI 2026, référentiel du projet) | TVA déduite à tort sur les notes d'hébergement approuvées | Repérer ces notes (feuille « Notes de frais ») et régulariser la TVA déductible avec le cabinet |
| 9 | Des comptes que Kanoo utilise lui-même manquaient au plan par défaut (485000, 627100, 638000) | Faux constat « compte absent du plan » | Comptabilité → Plan comptable : créer le compte signalé |
| 10 | Les brouillons de facture créés avant octobre 2026 étaient comptabilisés dès leur création | Chiffre d'affaires et TVA collectée surévalués ; TVA déjà déposée et IS 2025 peut-être trop élevés | Contrôle « Brouillon comptabilisé » : émettre ou supprimer chaque brouillon ; rapprocher, mois par mois, la TVA déposée de la TVA comptable avec le fiscaliste |

Le comité d'audit a vérifié la comptabilisation des factures, des avoirs, des acomptes, de la retenue de garantie, des créances douteuses et des règlements : elle suit la règle « 411 + 4117 = TTC ». Il n'y a pas trouvé d'autre erreur. La vérification ne couvre pas tout le code.

## 3. L'export financier complet

**Où le trouver.** Comptabilité → États comptables → « Export de l'exercice ».
- **Accès :** comptabilité et direction. Les stagiaires et les profils en lecture seule n'y ont pas accès.
- **Traçabilité :** chaque export est inscrit au journal d'audit, avec la date et l'adresse IP.
- **Mode d'emploi :** il figure en première feuille du classeur.

**Contenu.**
- **Synthèse et contrôles :** mode d'emploi, synthèse, contrôles de cohérence avec colonnes de suivi (traité le, par, commentaire, validé par le cabinet).
- **États comptables :** journal avec les colonnes du FEC, la même numérotation que le FEC et l'imputation ; balance ; bilan actif et passif et compte de résultat au format SYSCOHADA, avec l'exercice précédent en regard ; tableau des flux de trésorerie de l'exercice.
- **Fiscalité :** TVA mois par mois et déclarations enregistrées.
- **Pièces :** factures et avoirs, encaissements, achats, règlements fournisseurs, notes de frais, paie (par matricule), ventes des comptoirs.
- **Trésorerie et tiers :** soldes et mouvements de trésorerie, clients (avec retenue de garantie et avances), fournisseurs.
- **Autres :** immobilisations (dotation, amortissements cumulés, valeur nette), résultat par activité, plan comptable.

**Contrôles.**

*Écritures*
- Écriture déséquilibrée.
- Bilan déséquilibré.
- Compte absent du plan ou désactivé.
- Écriture datée dans le futur.

*Ventes*
- Brouillon de facture comptabilisé.
- Facture ou avoir sans écriture de vente, ou comptabilisé plusieurs fois.
- TTC, HT ou TVA de l'écriture différents de ceux de la pièce.
- Écriture hors de l'exercice de la pièce.
- Facture annulée encore comptabilisée.
- Numéros manquants dans la série.

*Pièces et règlements*
- Encaissement sans écriture, ou annulé encore comptabilisé.
- Achat sans écriture, annulé encore comptabilisé ou d'un autre montant.
- Règlement fournisseur sans écriture.
- Note de frais ou remboursement sans écriture, ou note passée sur un compte non conforme.
- Bulletin de paie ou salaire payé sans écriture.
- Tickets de comptoir hors comptabilité.

*Trésorerie et TVA*
- Trésorerie différente de la comptabilité.
- Virement interne non soldé.
- Compte de trésorerie comptable sans compte de trésorerie.
- Comptes de trésorerie sur un même compte comptable.
- TVA déclarée différente de la TVA comptable.
- Plusieurs déclarations pour une même période.

*Tiers*
- Compte client différent des factures non réglées.
- Compte fournisseur différent des achats non payés.
- Dette fournisseur sans fournisseur.

*Clôture et analytique*
- Contrôles avant clôture.
- Exercice précédent non clôturé.
- Charges et produits sans secteur d'activité.

**Non couvert par l'export** (écrans dédiés) :
- valorisation du stock ;
- cautions bancaires ;
- devis, commandes et bons de livraison non facturés ;
- balance âgée.

## 4. Comparaison avec Sage 100 Comptabilité

**Sources.**
- **Côté Sage :** la fiche produit Sage France « Sage 100 Comptabilité » (éd. 10/2024) [A], et la fiche « Sage 100 Immobilisations » (éd. 04/2021) [N]. Elles décrivent la version française, « selon édition et options ».
- **Pages sage.com :** elles n'ont pas pu être lues : l'accès automatisé est refusé.
- **Afrique :** aucune page officielle Sage ne décrit une édition OHADA de Sage 100. Ce qui touche l'Afrique est donc marqué « non vérifié ».
- **Côté Kanoo :** le code, à la version livrée.

Légende : **Égal** = équivalent ou meilleur ; **Partiel** = fonction présente en partie ; **Absent** = fonction absente ; **Non vérifié** = fonction de Sage non établie par les sources.

| Domaine | Sage 100 Comptabilité | Kanoo | Niveau de Kanoo |
|---|---|---|---|
| Plan comptable | Dossiers modèles [A] ; plan SYSCOHADA fourni par l'intégrateur (non vérifié) | Plan SYSCOHADA par organisation, enrichi par les écritures. Les notes de frais utilisaient jusqu'ici des numéros du plan français (corrigé) | Partiel |
| Comptes de tiers | Multi-collectif, multi-échéance, multi-RIB [A] | Tiers sur chaque ligne d'écriture ; pas de compte auxiliaire distinct ; **la saisie manuelle n'enregistre pas le tiers** | Partiel |
| Grand livre et balance auxiliaires | Oui [A] | Non | Absent |
| Saisie | Par pièce et par lot, modèles d'écritures, abonnements [A] | Écritures automatiques depuis toutes les pièces ; saisie manuelle équilibrée et contrôlée ; pas de modèles d'écritures | Partiel |
| Numérotation et validation des écritures | Non vérifié dans [A] | Aucun numéro stocké (le FEC numérote à l'export) ; aucune étape de validation ; libellé et imputation modifiables jusqu'au verrou | Absent |
| Correction | Extournes [A] | Extourne miroir (journal EX) ; période verrouillée | Égal |
| Régularisations de fin d'exercice | « Génération et extourne de fin d'exercice » [A] | Non | Absent |
| Lettrage | Manuel, automatique, avec écart [A] | Manuel et automatique ; pas d'écriture d'écart | Partiel |
| Rapprochement bancaire | Manuel et automatique ; écritures générées depuis les extraits bancaires [A] | Import de relevé CSV, appariement automatique ; pas d'OFX, de MT940 ni de CAMT | Partiel |
| Relances | Relances [A] | E-mail, SMS, WhatsApp, relevé client, paiement en ligne | Égal |
| Balance âgée | Oui [A] | Clients seulement | Partiel |
| TVA : exigibilité | Sur débits et sur encaissements [A] | Sur débits seulement | Partiel |
| TVA : déclaration et liquidation | Télédéclaration EDI propre à la France [A] ; liquidation non vérifiée | Déclaration recalculée par le serveur (corrigé) ; **aucune écriture de liquidation** (443/445 vers 4441 ou 4449) ; pas de report de crédit | Partiel |
| Fiscalité nigérienne | Non vérifié | IS/BIC et échéances alignés sur le CGI 2026 (référentiel du projet), sans retraitements fiscaux ; CNSS, retenues, timbre-quittance, retenue de garantie, SECeF | Partiel |
| États de synthèse | Brouillard, journaux, balances, grands livres, bilan, résultat, SIG, états personnalisés [A] | Balance, grand livre, bilan, résultat, SIG et flux de trésorerie SYSCOHADA (N et N-1), principales notes annexes | Égal |
| DSF | Liasse « conforme OHADA » selon des intégrateurs (non vérifié) | Liasse Excel, pas au format officiel de la DGI | Partiel |
| Clôture | Assistant d'à-nouveaux [A] | Contrôles de clôture, à-nouveaux par tiers, affectation du résultat, verrou de période ; exercice civil seulement, pas de réouverture | Partiel |
| Analytique | 2 à 11 plans, états analytiques [A] | Projet, secteur, service sur chaque ligne ; paie et dotations non réparties | Partiel |
| Budgets | Option, prévu / réalisé [A] | Par racine de compte ; pas par projet ni par service | Partiel |
| Immobilisations | Plans économique, fiscal et dérogatoire, cessions, fractionnement, crédit-bail [N] | Linéaire, dégressif, prorata, dotations, cessions | Partiel |
| Multi-devises | Oui, écarts de change [A] | Trésorerie et règlements en devise, écarts 676/776 ; pas de devise sur les factures | Partiel |
| Import | Formats paramétrables [A] | Pas d'import d'écritures ni de plan comptable | Absent |
| Export | Formats paramétrables [A] | Sage 100, FEC, Cegid, EBP, Divalto, OHADA, export complet avec contrôles | Égal |
| Piste d'audit | Suivi et conservation des modifications et suppressions, sauvegarde fiscale [A] | Journal d'audit avant/après ; adresse IP sur peu d'actions ; pas d'archivage scellé | Partiel |
| Droits | Par utilisateur [A] | Par rôle et ressource, niveaux, stagiaires sans export | Égal |

**Ce que Kanoo apporte.** Une même base porte les ventes, les achats, la paie, le stock, la trésorerie et les marchés publics. Chaque pièce passe son écriture dans la même opération. Dans Sage, l'intégration dépend des modules et des connecteurs retenus. Kanoo intègre aussi des règles propres au Niger : SECeF, timbre-quittance, retenues des marchés publics, CNSS.

## 5. Améliorations proposées

Chaque proposition est reliée au risque qu'elle couvre. L'effort est un ordre de grandeur, pas un chiffrage : S = quelques jours, M = une à deux semaines, L = plus.

### Priorité 1 — justesse des comptes et conformité

1. **Validation de l'import Sage avec le cabinet (S).**
   - *Risque :* comptabilité inexploitable par le cabinet.
   - *Action :* importer un mois test dans le Sage du cabinet, puis ajuster le format (colonne tiers, libellé de l'écriture, format de date) au modèle d'import du cabinet.
2. **Numérotation et validation des écritures (M).**
   - *Risque :* rejet de la comptabilité lors d'un contrôle.
   - *Action :* numéro séquentiel par journal et par exercice, attribué une fois pour toutes. Validation qui rend l'écriture définitive. État avant/après et adresse IP pour toute modification. Archivage scellé.
   - *Fondement :* exigences de l'Acte uniforme OHADA relatif au droit comptable et à l'information financière (AUDCIF), articles non vérifiés dans ce document.
3. **Liquidation mensuelle de la TVA (M).**
   - *Risque :* TVA due ou crédit de TVA invisibles au bilan.
   - *Action :* à la déclaration du mois, écriture qui solde 443/445 vers 4441 (TVA due) ou 4449 (crédit à reporter), et reprise du crédit le mois suivant.
4. **Exigibilité de la TVA sur les prestations de services (S, après avis).**
   - *Risque :* TVA déclarée au mauvais mois.
   - *Action :* faire vérifier si, pour une société de services, la TVA est exigible à l'encaissement (non vérifié). Si oui, gérer la TVA sur encaissements.
5. **IS/BIC : compléter et faire valider (M).**
   - *Risque :* impôt mal calculé.
   - *Déjà fait :* les règles du CGI 2026 sont appliquées, telles que les décrit le référentiel du projet (`docs/REFERENTIEL-FISCAL-SOCIAL-2026.md`, § 6) : IMF, taux normal de 30 % et taux réduit de 26 % pour les secteurs prévus, acomptes.
   - *Reste à faire :*
     - retraitements fiscaux (charges plafonnées, comme les réceptions à 0,5 % du chiffre d'affaires) ;
     - IMF sur marge brute ;
     - exonération des entreprises nouvelles ;
     - déficits reportables ;
     - imputation des retenues subies (4492) et des acomptes versés ;
     - saisie du montant réellement déposé, s'il diffère du calcul de Kanoo.
   - Faire valider l'ensemble par un fiscaliste.
6. **Tiers obligatoire sur les comptes 40 à 42, y compris en saisie manuelle (S) ; grand livre et balance auxiliaires (M) ; balance âgée fournisseurs (S).**
   - *Risque :* créances et dettes non justifiables.
   - *Constat à l'appui :* une écriture manuelle sur 411 ou 401 échappe aujourd'hui au lettrage, aux relances et aux relevés.
7. **Régularisations de fin d'exercice (M).**
   - *Risque :* résultat faux (non-respect de l'indépendance des exercices).
   - *Action :* charges et produits constatés d'avance, factures non parvenues, factures à établir, avec extourne automatique au 1er janvier.
8. **Recomptabilisation contrôlée d'une pièce (S).**
   - *Risque :* corrections improvisées.
   - *Action :* une action, réservée au comptable et tracée, qui régénère ou extourne l'écriture liée à une pièce. C'est ce que demandent aujourd'hui plusieurs consignes de l'export, qui passent par l'éditeur.

### Priorité 2 — tenue des comptes et productivité

9. **Plan comptable de Numatech (S).**
   - Sous-comptes 521x par banque et 571x par caisse.
   - Sous-comptes 447x par impôt.
   - Correspondance avec le plan du cabinet.
   - Revue des comptes génériques.
   - Validation par le cabinet.
10. **DSF importable par le cabinet (M), puis au format officiel de la DGI (L, format à obtenir).**
11. **Modèles d'écritures et abonnements (S).**
12. **Import d'écritures et du plan comptable depuis Sage ou un FEC (M)**, pour reprendre l'historique.
13. **Relevés OFX, MT940 et CAMT (M) ; lettrage avec écriture d'écart (S).**
14. **Analytique complète (M).**
    - Répartition par clés de la paie, des dotations et du stock.
    - Fusion de la saisie analytique manuelle avec les écritures.
    - Budget par projet et par service.
    - *Objectif :* la rentabilité par activité doit se rapprocher du compte de résultat au franc près.

### Priorité 3 — couverture fonctionnelle

15. **Exercice décalé et réouverture contrôlée (M).**
16. **Devise sur les factures (M).**
17. **Immobilisations : plan fiscal, dérogatoire, fractionnement (M).**
18. **Archivage et conservation des pièces et des écritures sur dix ans (M).** La durée est à confirmer sur le texte en vigueur.

## 6. Points non vérifiés

- L'édition Afrique ou OHADA de Sage 100 : plan livré, flux de trésorerie, notes annexes, DSF, TVA locale, liquidation de la TVA. À demander à un partenaire Sage agréé.
- Les prix de Sage en Afrique : aucun tarif officiel trouvé.
- Les règles fiscales nigériennes : appliquées d'après le référentiel du projet, qui est une lecture technique du CGI 2026 et ne remplace pas la validation d'un fiscaliste. Points concernés :
  - IS/BIC : IMF, taux, acomptes ;
  - timbre-quittance : restitution après annulation ;
  - exigibilité de la TVA sur les services ;
  - déductibilité du compte 87.
- La correspondance exacte des comptes SYSCOHADA retenus pour les notes de frais (618000, 638200, 633000, 605500, 638000), à confirmer par le cabinet. Par exemple, réceptions et missions pourraient relever de sous-comptes distincts de la rubrique 638, et la représentation (627100) d'un autre compte (non vérifié).
- Les articles de l'Acte uniforme OHADA relatif au droit comptable et à l'information financière (AUDCIF) sur la numérotation, la validation et la conservation.
- L'état réel des comptes de Numatech Services : il sera connu à la lecture du classeur d'export.

## Annexe 1 — Procédure de l'équipe technique

Elle s'applique aux constats dont la colonne « Où corriger » renvoie à l'équipe technique. Elle sert en attendant la recomptabilisation contrôlée (amélioration n° 8).

1. **Accord écrit.** Le gérant ou le comptable transmet le constat (pièce, montant, capture de la feuille « Contrôles ») et donne son accord écrit.
2. **Facture ou avoir sans écriture de vente.** L'équipe lance `npx tsx scripts/repair-sale-entries.ts` en simulation, puis avec `--apply`. Le script crée l'écriture à la date de la pièce et laisse de côté les périodes verrouillées, qui demandent une régularisation datée du jour.
3. **Écriture en double ou orpheline.** L'équipe l'extourne par un script qui appelle la fonction d'extourne de Kanoo (`lib/accounting-reversal.ts`) : celle-ci crée une écriture miroir au journal EX. Rien n'est jamais supprimé.
4. **Écriture déséquilibrée.** L'équipe la corrige en base, après sauvegarde, et l'inscrit au journal d'audit.
5. **Contrôle.** L'organisation relance l'export pour contrôler que le constat a disparu.
6. **Délai.** Cinq jours ouvrés, proposés.

## Annexe 2 — Références techniques

- **Export :** `lib/financial-export.ts`, route `GET /api/exports/complet?annee=AAAA`. Le classeur est écrit en flux, et un seul export tourne à la fois par organisation.
- **Déclarations :** `lib/fiscal-declaration.ts`, utilisé par `app/api/fiscal/tva` et `app/api/fiscal/isbic`.
- **Tests :** `scripts/e2e/e2e-exportfin.mjs` (70 vérifications) et `__tests__/unit/financial-export.test.ts`.
- **Sources Sage :**
  - [A] https://caplaser.fr/wp-content/uploads/2024/10/fp-sage-100-comptabilite.pdf
  - [N] https://caplaser.fr/wp-content/uploads/2024/10/FP_Sage-100-Immobilisations_042021.pdf
