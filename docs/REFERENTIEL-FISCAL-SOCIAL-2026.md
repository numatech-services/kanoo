# Référentiel fiscal et social Niger 2026 : écarts avec Kanoo

**Sources analysées**
- *Guide de l'employeur* CNSS, projet de juillet 2025. Les taux sont en vigueur depuis le 1er janvier 2024.
- *Guide de l'assuré* CNSS, projet de juillet 2025.
- *Code général des impôts 2026* :
  - adopté par l'Ordonnance n° 2025-22 du 14 juillet 2025, en vigueur au 1er janvier 2026 ;
  - intègre la loi de finances 2026 (Ordonnance n° 2025-44 du 31 décembre 2025).

Ce document sert de cahier des charges pour mettre Kanoo à jour. Chaque valeur renvoie à un article, et chaque écart au fichier de Kanoo concerné.
- **Légende** : 🔴 valeur fausse ou obligation absente qui produit des montants erronés ; 🟠 fonction manquante ; 🟢 conforme.
- **Points à vérifier** : ils sont regroupés au §12. Il s'agit d'une lecture technique des textes, qui ne remplace pas la validation d'un fiscaliste.

---

## 1. Synthèse des écarts majeurs

| # | Domaine | Kanoo aujourd'hui | Règle 2026 | Fichiers |
|---|---|---|---|---|
| 1 | 🔴 CNSS, taux | 3,6 % salarié + 16,4 % employeur = 20 % | **5,25 % salarié + 17,40 % employeur = 22,65 %** | lib/niger-fiscal.ts:36-38, ainsi qu'environ 8 textes d'interface (§2.5) |
| 2 | 🔴 CNSS, plafond | Aucun | **500 000 FCFA par mois** (1 500 000 par trimestre) | lib/payslip-calc.ts:122-123 ; app/api/fiscal/cnss/route.ts:24 |
| 3 | 🔴 CNSS, stagiaires et apprentis | Aucune cotisation | **16,75 %** (salarié 5,25 % ; employeur 9,75 % pensions + 1,75 % risques professionnels) | lib/payslip-calc.ts:78-100 |
| 4 | 🔴 Impôt sur salaire | Ancien barème IUTS (0 à 30 %, seuil de 35 000) sur brut − CNSS | **ITS** : barème à 9 tranches de 1 % à 35 %, déduction de 13 % pour frais professionnels, abattement familial de 0 à 30 %, base arrondie au millier | lib/niger-fiscal.ts:198-223 ; lib/payslip-calc.ts:126 |
| 5 | 🔴 Retenues à la source | Table « art. 110-124 » obsolète : 5 % et 10 % sur le montant brut | **Précompte d'IS** : 2 à 8 % du TTC selon la nature de l'opération et la présence d'un NIF ; non-résidents 20 % ; **retenue de conformité** 10 % ; **impôt sur les revenus locatifs (IRL)** 12 % ; IRCM | lib/niger-fiscal.ts:55-61, 290-311 |
| 6 | 🔴 Minimum d'impôt | 1 000 000 FCFA fixe | **IMF** : 1,75 % du CA HT (0,75 % pour l'industrie) ; impôt dû = le plus élevé entre l'IS et l'IMF | lib/niger-fiscal.ts:147, 166-167 |
| 7 | 🔴 Acomptes d'IS | 2 × 1/3, au 31/03 et au 31/07 | **3 × 20 % de l'impôt N-1**, avant le 1/07, le 1/09 et le 1/11 | lib/niger-fiscal.ts:178-194 |
| 8 | 🔴 Timbre sur facture | Barème de 0 à 2 000 FCFA selon le TTC, ajouté à toutes les factures | **Timbre-quittance de 200 FCFA par facture ou reçu** (art. 560). Exonérés : paiement scriptural, montant inférieur à 5 000 TTC, collectivités publiques | lib/niger-fiscal.ts:67-76 ; lib/invoice-entry.ts:27-28 |
| 9 | 🔴 Échéances | TVA le 20 ; CNSS 10 jours après le trimestre | **TVA, ITS, précomptes et IRL : le 15** du mois suivant. **CNSS : 30 jours** après la période | lib/cron-jobs.ts:441-455 ; lib/daily-brief-server.ts:115-126 ; app/(dashboard)/fiscalite/* |
| 10 | 🔴 Retenue de TVA | Absente | **Retenue de 100 % de la TVA** par l'État et par les entreprises désignées ; **exigibilité à l'encaissement** pour les livraisons à l'État | — |
| 11 | 🟠 Taux réduits de TVA | 10 % décrit comme « alimentaire » ; 5 % proposé sans être défini | **10 %** : transport terrestre, hôtellerie et restauration. **5 %** : sucre, huile, lait transformé, farines, aliments pour bétail | lib/niger-fiscal.ts:10-24 ; lib/secef/types.ts:49 |
| 12 | 🟠 Amortissements | 2 tables divergentes ; informatique à 33 % | Informatique et logiciels **50 %** ; matériel industriel 10 % ; autres matériels 25 % ; agencements 20 % ; bâtiments 5 % ou 2 % ; biens de moins de 100 000 FCFA passés en charge | lib/niger-fiscal.ts:403-412 ; lib/depreciation.ts:162-171 |
| 13 | 🟠 SECeF | Code SECeF, date et heure de certification et identifiant MCF absents du PDF en clair | Mentions de la facture certifiée. **Le logiciel doit obtenir une attestation de conformité DGI pour être commercialisé** (art. 804, 828-6) | lib/pdf-document.ts |
| 14 | 🟠 Déclarations annuelles | Aucune | État annuel des salaires (31/01), déclaration des honoraires versés (DAS, avant le 1/02), DSF (30/04), liste des clients, état des sous-traitants, dossier ONG (30/04) | — |
| 15 | 🟠 Taxes sur salaires | Absentes | **Taxe d'apprentissage : 3 %** de la masse salariale (régime réel) | — |

---

## 2. Sécurité sociale (CNSS)

### 2.1 Taux en vigueur depuis le 1er janvier 2024

| Branche | Employeur | Salarié | Total |
|---|---|---|---|
| Prestations familiales | 4,90 % | — | 4,90 % |
| Accidents du travail et maladies professionnelles | 1,75 % | — | 1,75 % |
| Pensions (vieillesse, invalidité, décès) | 9,75 % | 5,25 % | 15,00 % |
| ANPE (taxe pour l'emploi) | 1,00 % | — | 1,00 % |
| **Total** | **17,40 %** | **5,25 %** | **22,65 %** |

**Régimes particuliers**

| Catégorie | Employeur | Salarié | Total | Base de calcul |
|---|---|---|---|---|
| Fonctionnaires détachés | 6,65 % (PF 4,90 + AT 1,75) | — | 6,65 % | Pensions gérées par l'État |
| Apprentis et stagiaires | 11,50 % (AT 1,75 + pensions 9,75) | 5,25 % | 16,75 % | Ni PF ni ANPE |
| Assurés volontaires | — | 15 % pensions + 1,40 % AT | 16,40 % | L'assuré paie seul |

### 2.2 Assiette, plafond et plancher
- **Assiette** : toute la rémunération, primes et avantages en nature compris. Sont exclus les **frais professionnels** et les **remboursements de frais**. La liste détaillée des éléments non soumis (annexe 3 du guide) est absente du texte extrait : voir §12.
- **Plafond** :
  - **500 000 FCFA par mois**, 1 500 000 par trimestre, 6 000 000 par an ;
  - cotisation mensuelle maximale de **113 250 FCFA**, soit 87 000 pour l'employeur et 26 250 pour le salarié.
- **Plancher** : le SMIG.
  - Le guide de juillet 2025 indique « actuellement **30 047 FCFA** », un montant susceptible d'évoluer.
  - Kanoo utilise **41 000 FCFA** (« arrêté 2023 »). Voir §12.

### 2.3 Déclaration et paiement
| Effectif | Périodicité | Échéance |
|---|---|---|
| Moins de 20 salariés | Trimestrielle | Dans les **30 jours** qui suivent le trimestre |
| 20 salariés ou plus | **Mensuelle** | Dans les **30 jours** qui suivent le mois |
| Cession ou cessation d'activité | — | Exigible immédiatement |

- La **déclaration nominative** des salaires précède le paiement.
- **Pénalités** :
  - **200 FCFA par salarié** pour une déclaration tardive ou absente, à nouveau pour chaque mois de retard ;
  - 200 FCFA par inexactitude ;
  - majorations de retard sur le paiement.

### 2.4 Autres obligations à suivre dans Kanoo
- **Immatriculation** du salarié dans les **8 jours** qui suivent l'embauche : alerte à la création de la fiche salarié.
- **Accident du travail** déclaré sous **48 heures** à la CNSS et à l'inspection du travail.
- **Contrôle** :
  - il peut porter sur 1 à 5 ans ;
  - l'employeur a 15 jours pour contester.
- **Maternité** :
  - 14 semaines (6 avant et 8 après l'accouchement), plus 3 semaines en cas de complications ;
  - indemnité égale à la moitié du salaire journalier, versée par la CNSS ;
  - l'autre moitié est due par l'employeur selon le guide, à confirmer en droit du travail.
- **Allocations familiales** : 1 500 FCFA par enfant et par mois, versées par la CNSS chaque trimestre. Elles ne passent pas par la paie.
- **Retraite** : à 60 ans pour les hommes et 55 ans pour les femmes, avec 180 mois de cotisation.

### 2.5 Adaptations dans Kanoo
1. Dans `lib/niger-fiscal.ts`, remplacer `CNSS_SALARIE` et `CNSS_PATRONAL` par une table **ventilée par branche** et **par catégorie de salarié** : `standard`, `stagiaire_apprenti`, `detache`.
2. Dans `lib/payslip-calc.ts`, appliquer le **plafond de 500 000** à la base CNSS :
   - mensuel, ou proratisé pour une paie partielle ;
   - pour les stagiaires, appliquer 16,75 % au lieu de 0 ;
   - respecter `includeCnss` pour tous les profils.
3. Ajouter à la fiche salarié (`models/Employee.ts`) :
   - le **numéro d'immatriculation CNSS** ;
   - la **catégorie CNSS** ;
   - la **date de déclaration d'embauche**.
4. Bordereau (`app/api/fiscal/cnss/route.ts`, `app/api/reports/dgi-cnss/route.ts`) :
   - périodicité **déduite de l'effectif**, mensuelle à partir de 20 salariés ;
   - ventilation par branche ;
   - plafond appliqué.
5. Écritures comptables :
   - ventiler la part patronale entre 431100, pour la CNSS, et l'ANPE si l'on veut la suivre à part (compte 447 ou 431 selon le plan retenu) ;
   - garder 431000 pour la part salariale.
6. Remplacer les textes figés « 3,6 % / 16,4 % » par des valeurs lues depuis la constante. Fichiers concernés :
   - `components/pme/EmployeeForm.tsx:53-54,126`
   - `app/(dashboard)/payslips/[id]/page.tsx:62`
   - `app/(dashboard)/fiscalite/cnss/page.tsx:17`
   - `app/(dashboard)/fiscalite/page.tsx:8`
   - `messages/fr.json:82-83` et `messages/en.json:82-83`
   - `app/(public)/fonctionnalites/page.tsx:17`

---

## 3. Impôt sur les traitements et salaires (ITS, CGI art. 136 à 160)

### 3.1 Calcul de la base mensuelle, dans l'ordre
1. **Rémunération brute imposable**, avantages en nature compris (§3.3).
2. **Moins la cotisation de retraite** du salarié (CNSS 5,25 %), dans la limite de **6 %** de cette rémunération brute.
3. **Moins un abattement de 17 %** pour les expatriés, si l'indemnité de dépaysement atteint au moins 40 % de la rémunération brute.
4. **Moins les primes d'assurance** versées, dans la limite de **20 000 FCFA par mois**.
5. **Moins 13 %** au titre des frais professionnels.
6. **Moins l'abattement pour charges de famille**, appliqué à la base :

| Charges de famille | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 (maximum) |
|---|---|---|---|---|---|---|---|---|
| Abattement | 0 % | 7 % | 12 % | 17 % | 22 % | 25 % | 27 % | 30 % |

   - Au plus 7 personnes, dont 6 enfants.
   - Le conjoint compte s'il n'a pas de revenu.
   - Les enfants comptent jusqu'à 21 ans, jusqu'à 25 ans s'ils sont étudiants, et sans limite d'âge s'ils sont handicapés.
7. **Arrondi de la base au millier de FCFA inférieur**.

### 3.2 Barème mensuel progressif par tranche

| Tranche de base mensuelle (FCFA) | Taux |
|---|---|
| 0 – 25 000 | 1 % |
| 25 001 – 50 000 | 2 % |
| 50 001 – 100 000 | 6 % |
| 100 001 – 150 000 | 13 % |
| 150 001 – 300 000 | 25 % |
| 300 001 – 400 000 | 30 % |
| 400 001 – 700 000 | 32 % |
| 700 001 – 1 000 000 | 34 % |
| Plus de 1 000 000 | 35 % |

**Exemple de contrôle, à mettre en test unitaire.** Salaire brut de 300 000 FCFA, 2 charges de famille :

| Étape | Calcul | Résultat |
|---|---|---|
| CNSS salariale | 300 000 × 5,25 % (sous la limite de 6 %, soit 18 000) | 15 750 |
| Après CNSS | 300 000 − 15 750 | 284 250 |
| Après 13 % de frais professionnels | 284 250 × 0,87 | 247 297 |
| Après abattement familial de 12 % | 247 297 × 0,88 | 217 621 |
| Base arrondie au millier | — | **217 000** |

ITS = 250 + 500 + 3 000 + 6 500 + 16 750 = **27 000 FCFA**.

### 3.3 Avantages en nature : forfaits mensuels à intégrer à la base
| Avantage | Forfait mensuel |
|---|---|
| Logement | 20 000 FCFA par pièce, au plus 1/3 de la rémunération brute |
| Ameublement | 1/3 du forfait logement |
| Électricité | 50 000 FCFA |
| Eau | 15 000 FCFA |
| Téléphone | 20 000 FCFA |
| Véhicule | 20 000 FCFA |
| Domestique | 20 000 FCFA, par domestique |
| Nourriture | 25 000 FCFA |

**Éléments exonérés**
- Frais d'emploi, dans la limite de **20 %** de la rémunération brute.
- Majorations pour charges de famille, dans la limite d'**1/5** de la rémunération brute.
- Cadeaux familiaux, dans la limite de **5 %**.
- Indemnités de licenciement et de départ à la retraite.
- Frais de mission.
- Remboursements de frais médicaux.

### 3.4 Obligations de l'employeur
- **Déclaration et paiement mensuels avant le 15** du mois suivant, **y compris sans salaire versé** (déclaration « néant »), avec le bordereau-avis.
- **Registre des salaires** de l'employeur, conservé 10 ans.
- Jusqu'à **3 bulletins complémentaires par an** pour les primes exceptionnelles.
- Le personnel des ONG qui ne bénéficie d'aucune immunité est soumis à l'ITS retenu à la source.
- Sommes versées à des tiers non identifiés : taxées à **35 %** au nom de l'employeur, et non déductibles.

### 3.5 Adaptations dans Kanoo
1. Réécrire `calculerIR` (`lib/niger-fiscal.ts:198-223`) en `calculerITS(brut, { cnssSalarie, assurance, chargesFamille, expatrie })` selon les étapes du §3.1, avec le barème par tranche du §3.2.
2. Ajouter à `models/Employee.ts` :
   - le **nombre de charges de famille**, de 0 à 7 ;
   - la situation matrimoniale ;
   - le statut d'expatrié ;
   - les **avantages en nature**, sous forme de lignes au forfait.
3. Ajouter au bulletin une ligne par avantage en nature : il est ajouté à la base imposable sans être versé au salarié.
4. Renommer « IR » en « ITS » sur les bulletins, les écrans et le compte 447100. Le compte peut rester 447100 avec le libellé « ITS retenu ».
5. Corriger l'aperçu de paie de la fiche salarié (`components/pme/EmployeeForm.tsx:53-57`) : il doit appeler le même calcul que le bulletin.
6. Ajouter un rappel « ITS du mois M−1 avant le 15 ».

---

## 4. TVA (CGI art. 319 à 367)

### 4.1 Taux
| Taux | Champ d'application |
|---|---|
| **19 %** | Taux normal |
| **10 %** | Transport terrestre ; hôtellerie et restauration |
| **5 %** | Sucre, huile, lait transformé, farines, aliments pour bétail |
| **0 %** (exportation) | Exonérée avec droit à déduction |
| Exonéré | Locations nues, associations sans but lucratif, enseignement, professions médicales, opérations non commerciales de l'État, assurances (soumises à la TUA), opérations bancaires (soumises à la TAF) |

### 4.2 Fait générateur et exigibilité
- La TVA est due sur les **avances et acomptes** reçus.
- Pour les **livraisons à l'État**, l'exigibilité est **reportée au paiement par le Trésor** : la TVA devient exigible à l'encaissement.
- **Toute TVA mentionnée sur une facture est due**, même si elle a été facturée à tort.
- Une facture qui ne fait apparaître aucune TVA est réputée établie TTC.

### 4.3 Droit à déduction
- **TVA non déductible** :
  - logement, réceptions, restaurants ;
  - véhicules de transport de personnes et leurs pièces ;
  - cadeaux de plus de 20 000 FCFA HT ;
  - mobilier autre que de bureau ;
  - carburants (régime pétrolier) ;
  - **achats de 2 000 000 FCFA ou plus non payés par voie bancaire** (nouveauté de la LF 2026).
- La déduction exige une **facture certifiée** (art. 802-803). Une facture fournisseur non émise par le système certifié n'ouvre **ni droit à déduction de la TVA ni déductibilité de la charge**.
- **Prorata de déduction** :
  - arrondi à l'unité supérieure ;
  - définitif au 15 avril.
- Une déduction omise peut être réparée jusqu'au 31 mars de N+1.
- **Remboursement d'un crédit de TVA** :
  - seulement à partir de 5 000 000 FCFA par trimestre ;
  - pour les exportateurs, ou en cas de crédit structurel d'au moins 100 000 000 FCFA ;
  - une attestation de régularité fiscale (ARF) est exigée.

### 4.4 Retenue de TVA à la source
- **Qui retient** : l'État et les entreprises désignées (grandes entreprises, sociétés cotées). Ils retiennent **100 % de la TVA** facturée et la reversent **avant le 15** du mois suivant.
- **Aucune retenue** entre deux entités qui sont toutes deux tenues de retenir.
- **Dispense de retenue** : attestation soumise à un timbre de 100 000 FCFA et à la présentation de l'ARF.

### 4.5 Déclaration
| Régime | Périodicité | Échéance |
|---|---|---|
| Réel normal | Mensuelle | Avant le **15** du mois suivant |
| Réel simplifié (RSI) | Trimestrielle | 15 avril, 15 juillet, 15 octobre, 15 janvier |

Une déclaration « néant » est obligatoire en l'absence d'opération.

### 4.6 Adaptations dans Kanoo
1. Dans `lib/niger-fiscal.ts` :
   - remplacer `TVA_CODES` par une table `{ code, taux, libellé, motif d'exonération }` avec 19, 10, 5, 0 (exportation) et exonéré ;
   - prévoir un champ « motif ou attestation d'exonération » sur la ligne de facture.
2. Ajouter 5 % aux types SECeF (`lib/secef/types.ts:49`) et aux listes qui ne proposent que 19, 10 et 0 :
   - `InvoiceForm`
   - `DevisForm`
   - `reventes`
   - `comptoir`
   - `recurring-expenses`
   - `marches-cadres`
3. Corriger le défaut de **18 %** de `app/(administration)/administration/services/page.tsx:28,150`.
4. Remplacer les libellés figés « TVA (19 %) » par le détail par taux. Fichiers concernés :
   - `app/(dashboard)/devis/[id]/page.tsx:172,216`
   - `components/pme/CommandeForm.tsx:208`
   - `app/api/reports/dgi-pdf/route.ts:67,128`
   
   La déclaration doit présenter **une ligne par taux**.
5. Ajouter un réglage « **client retenant la TVA** » (État ou entreprise désignée) sur la fiche client. Effets :
   - la facture indique « TVA retenue à la source » ;
   - à l'encaissement, la TVA retenue est soldée par un compte de TVA retenue par le client (443x ou 4449) au lieu d'un règlement du client ;
   - pour un client État, la TVA n'est **exigible qu'à l'encaissement** et passe par un compte d'attente 4438 ou 4458 jusqu'au paiement ;
   - la déclaration de TVA (`lib/vat.ts`) en tient compte.
6. Ajouter un réglage « régime fiscal » de l'organisation : réel normal (mensuel) ou RSI (trimestriel). Il pilote la périodicité de la déclaration et des rappels.
7. Corriger les échéances :
   - **15** au lieu de 20 : `lib/cron-jobs.ts:451-452`, `lib/daily-brief-server.ts:115-118`, `app/(dashboard)/fiscalite/tva/page.tsx:37`, `app/(dashboard)/fiscalite/page.tsx:7` ;
   - la tâche planifiée doit annoncer la période **M−1** ;
   - corriger aussi le mois 13 de décembre.
8. **Achats** : alerter lorsqu'un achat de 2 000 000 FCFA ou plus est réglé en espèces, ce qui le rend non déductible. Marquer la TVA non déductible selon la catégorie d'achat : véhicules de tourisme, réceptions, etc.

---

## 5. Précomptes et retenues à la source (remplacent la table actuelle)

### 5.1 Précompte d'IS ou d'IBA sur les opérations (art. 87 à 101)
| Opération | Fournisseur avec NIF | Fournisseur sans NIF |
|---|---|---|
| Importations et exportations | 3 % | 5 % |
| Transit | 2 % | 2 % |
| **Prestations de services** | **5 %** | **8 %** |
| **Livraisons de biens** | **2 %** | **5 %** |

- **Base** : montant **TTC**. Le précompte ne peut pas être répercuté sur le client.
- **Mention** sur la facture certifiée.
- **Reversement** avant le **15** du mois suivant.
- **Qui retient** :
  - l'État, les projets, les ONG et les associations ;
  - les entités privées au régime réel ;
  - les ONG et projets, y compris sur les consultants qu'ils paient.

### 5.2 Autres retenues
| Retenue | Taux | Base | Qui retient |
|---|---|---|---|
| Prestataire **non résident** | **20 %** | HT | Toute personne qui paie |
| **Retenue de conformité** (fournisseur sans attestation de régularité fiscale) | **10 %** | TTC | Les mêmes payeurs que le précompte |
| **IRL** (revenus locatifs) | **12 %** (6 % pour un loyer en nature) | Loyer | Locataires au régime réel, État, ONG, projets. Exclus : bailleurs soumis à l'IS, loyers de 20 000 FCFA par mois ou moins. Reversement avant le 15 |
| IRCM : dividendes | 10 % (7 % si la société est cotée) | Brut | Société distributrice |
| IRCM : intérêts | 20 % (comptes bancaires 10 %, obligations 6 %) | Brut | Débiteur |
| ITS des salariés | Barème du §3 | — | Employeur |

**Sanctions (art. 815)**
- Retenue **non faite** : amende égale à la retenue, en plus de la retenue elle-même, et charge **non déductible**.
- Retenue **faite mais non reversée** : amende de **2 fois** la retenue, plus 0,25 % par mois.
- Ces sommes ne se prescrivent pas et n'ouvrent pas droit à remise gracieuse.

### 5.3 Adaptations dans Kanoo
1. Supprimer `RETENUES_A_LA_SOURCE` (inutilisée) et remplacer `RETENUES_DETAILLEES` (`lib/niger-fiscal.ts:290-311`) par les tables du §5.1 et du §5.2. Chaque entrée porte :
   - une **base effectivement appliquée** (HT ou TTC), et non un simple libellé ;
   - un taux qui dépend de la présence d'un NIF.
2. **Fiche fournisseur** :
   - NIF ;
   - statut de résidence ;
   - **ARF avec sa date de validité (90 jours)**, qui déclenche ou non la retenue de conformité ;
   - catégorie par défaut : biens ou services.
3. **Paiement fournisseur** :
   - proposer automatiquement le précompte ;
   - écritures : débit 401, crédit 447200 pour le précompte, crédit 521 pour le net payé ;
   - produire le certificat de retenue.
4. **Freelances payés par la paie** (`lib/payroll-run.ts:109`) : appliquer le précompte sur prestation de services (5 % ou 8 %) au lieu de ne rien retenir. Dans l'écran `lib/subscriptions.ts:365-368`, appliquer **20 % pour un fournisseur non résident** au lieu de 5 %.
5. **Retenue subie** (449200, côté client) : proposer le taux selon la catégorie de l'opération. Ce précompte est imputable sur l'IS ou l'IMF.
6. Ajouter une déclaration mensuelle des précomptes, avec un rappel avant le 15.

---

## 6. Impôt sur les bénéfices

| Élément | Règle 2026 | Kanoo |
|---|---|---|
| **IS** | **30 %**. **26 %** pour l'industrie manufacturière, la presse agréée, et l'enseignement ou la santé exclusifs. Base arrondie au millier inférieur | 🟢 30 %. 🔴 Le taux agricole de 15 % n'existe plus : à remplacer par 26 % et ses secteurs |
| Impôt sur les bénéfices des personnes physiques (IBA) | 28 % | Absent |
| **IMF** | **1,75 % du CA HT**. 0,75 % pour l'industrie. 3 % ou 8 % de la marge brute pour certaines activités. **Impôt dû = le plus élevé entre l'IS et l'IMF.** Les entreprises nouvelles sont exonérées pendant 2 ans | 🔴 1 000 000 FCFA fixe |
| **Acomptes** | **3 × 20 %** de l'impôt de N-1, avant le **1/07**, le **1/09** et le **1/11** | 🔴 2 × 1/3, au 31/03 et au 31/07, avec une mauvaise année |
| **DSF** | **30 avril**, avec la liste des principaux clients et fournisseurs (NIF, adresse, téléphone, montant) et le relevé des amortissements et provisions | Absente |
| Déficits | Reportables 3 ans | Absent |
| Adhésion à un centre de gestion agréé | −25 % d'impôt pendant 5 ans ; délai de reprise ramené à 2 ans | Absent |

**Charges non déductibles ou plafonnées.** À utiliser pour les réintégrations du résultat fiscal, qui est aujourd'hui « comptes 7 − comptes 6 » sans aucun retraitement.

| Charge | Règle |
|---|---|
| Charge de 2 000 000 FCFA ou plus réglée hors banque | Non déductible |
| Contrat de prestation de services non enregistré | Non déductible |
| Facture non certifiée (art. 803) | Non déductible |
| Réceptions | 0,5 % du CA |
| Cadeaux | 20 000 FCFA par objet et 0,5 % du CA |
| Parrainage | 1 % |
| Dons à l'État | 2 % |
| Dépenses sociétales | 0,5 % |
| Redevances | 3,5 % du CA HT |
| Commissions sur achats | 5 % |
| Intérêts de comptes courants | Taux BCEAO + 3 points |
| Intérêts intragroupe | 25 % de l'EBE |
| Provisions pour congés payés et pour retraite | Non déductibles |

**Adaptations dans Kanoo**
1. `lib/niger-fiscal.ts:147-194` :
   - IMF proportionnel au CA HT, avec un taux réglable selon le secteur ;
   - impôt dû = le plus élevé entre l'IS et l'IMF ;
   - option « entreprise nouvelle » (date de création) ;
   - acomptes 3 × 20 % de l'impôt N-1, datés **sur l'exercice suivant**.
2. Corriger les textes figés de `isbic/page.tsx:38,77` et `fiscalite/page.tsx:9`.
3. Calculer le résultat fiscal (`app/api/fiscal/isbic/route.ts`) :
   - tableau de passage avec les réintégrations du tableau ci-dessus, dont certaines sont calculables à partir des comptes 62x, 63x et 658 ;
   - report des déficits sur 3 ans ;
   - imputation des précomptes subis (449200).

---

## 7. Droits de timbre et d'enregistrement (Livre 3)

| Droit | Règle | Kanoo |
|---|---|---|
| **Timbre-quittance** (art. 560) | **200 FCFA par facture ou reçu**, pour les actes sous seing privé. Payé par timbre ou **sur état mensuel**. En cas de paiement sur état, la mention « **Timbre fiscal acquitté** » est imprimée. Exonérés : paiements scripturaux (virement, chèque, mobile money), factures de moins de 5 000 FCFA TTC, factures payées par les collectivités publiques | 🔴 Barème de 0 à 2 000 FCFA appliqué à toutes les factures et ajouté au TTC |
| Timbre de dimension | 1 500 FCFA par page. Original d'un marché public et procès-verbal de réception : 25 000 FCFA | Absent |
| Enregistrement des **marchés publics** | **5 % HT**, dans le mois qui suit l'approbation | Absent |
| Enregistrement des contrats entre personnes privées, ONG comprises | **2 % HT** (LF 2026). Sous-traitance : 50 000 FCFA. Minimum : 6 000 FCFA | Absent |
| Baux | 3 % du cumul des loyers | Absent |
| Bons de commande de moins de 1 000 000 FCFA | Exonérés | — |

**Adaptations dans Kanoo**
1. Remplacer `calculerTimbre` par un timbre-quittance fixe de **200 FCFA** :
   - dû **seulement pour un paiement en espèces** et un TTC d'au moins 5 000 FCFA ;
   - jamais pour un client « collectivité publique ».
2. Le timbre-quittance n'est plus ajouté au total de la facture, puisque le mode de paiement n'est pas connu à l'émission. Il est enregistré sur le **reçu d'encaissement** en espèces (compte 447000).
3. Ajouter une option « paiement sur état mensuel », qui imprime la mention « Timbre fiscal acquitté ».
4. **Avoirs** (`lib/credit-notes.ts:107-110`) : la reprise du timbre est à revoir en conséquence.
5. Pour les contrats et marchés (`models/Contract.ts`, marchés publics) : calculer les **droits d'enregistrement** dus (5 % ou 2 % HT) et l'échéance d'un mois, sous forme d'alerte et de charge 646000.

---

## 8. Autres impôts et taxes à connaître

| Taxe | Règle | Utilité dans Kanoo |
|---|---|---|
| **Taxe d'apprentissage** | **3 %** de la masse salariale (régime réel seulement). Déductions plafonnées à 50 %. Déclarée avec la DSF | Calcul annuel à partir des bulletins (compte 641/447) |
| Taxe sur certaines charges (TCFG) | **20 %** des cadeaux, réceptions, véhicules et billets de congé de N-1 | Calcul à partir des comptes concernés |
| **Taxe professionnelle** (remplace la patente) | **Droit fixe** : 1 ‰ du CA N-1, minimum 75 000 FCFA, plafonds de 3 M, 7 M, 15 M ou 30 M. **Droit proportionnel** : 10 % de la valeur locative. Déclaration au **28/02**, paiement de 50 % puis du solde au **30/06**. Produit entièrement reversé aux communes | Remplacer le suivi « patente » (`lib/admin-documents.ts:72-73`) par un calcul et 2 échéances |
| Taxe immobilière | 1 %. Base : 75 % de la valeur des bâtiments, 50 % des équipements fixes, hors informatique. 50 % au **31/01**, solde au **30/06** | Échéances |
| Vignette | De 5 000 à 80 000 FCFA selon la puissance fiscale, avant le **1/04** | Échéance pour le parc de véhicules |
| **Taxe sur les paiements en espèces** (LF 2026) | **1 %** des paiements en espèces de plus de 100 000 FCFA HT, collectée par les entreprises au réel avant le 15 | Alerte à l'encaissement et au décaissement en espèces. Le sens du prélèvement est à confirmer (§12) |
| Taxe sur les transferts et le mobile money | 0,5 % (5 % au-delà de 2 000 000) | Information |
| TAF, taxe télécom, TUA | 18 % sur les frais bancaires ; 3 % ; 12 % | Comptabilisation des frais |
| Régimes d'imposition | **Réel normal (RNI)** : sociétés et professions libérales, ou CA HT de 100 M ou plus. **Réel simplifié (RSI)** : CA HT de 50 à 100 M. **Forfait** : CA TTC de moins de 50 M, impôt de 3 % (négoce, minimum 30 000) ou 5 % (autres, minimum 40 000). Les marchés publics de plus de 10 M TTC sont réservés au RNI et au RSI | Réglage « régime fiscal » de l'organisation, qui pilote les périodicités et les registres |

---

## 9. Calendrier fiscal et social consolidé

**Règles générales (art. 624)**
- Les délais en jours sont **calendaires**, et une échéance qui tombe un jour non ouvrable est **reportée au premier jour ouvrable suivant**. Il faut donc un calendrier des jours fériés du Niger.
- **Fenêtre de régularisation** : 15 jours pour les déclarations mensuelles et trimestrielles, 2 mois pour les déclarations annuelles (art. 784).

| Échéance | Obligation |
|---|---|
| **Le 15 de chaque mois** | TVA (réel normal), ITS (même « néant »), précomptes d'IS ou d'IBA, IRL, retenue de TVA, taxe sur les paiements en espèces |
| **30 jours après le mois** (20 salariés ou plus) ou **après le trimestre** (moins de 20) | Déclaration nominative et cotisations CNSS |
| 15/01, 15/04, 15/07, 15/10 | TVA au RSI |
| **31/01** | État annuel des salaires de N-1 ; 1er versement de 50 % de la taxe immobilière |
| **Avant le 1/02** | DAS des honoraires, commissions et droits d'auteur de N-1 (plus de 50 000 FCFA TTC par an et par bénéficiaire) |
| **28/02** | Déclaration de la taxe professionnelle et versement de 50 % |
| 31/03 | Dernier délai pour une déduction de TVA omise sur N-1 |
| **Avant le 1/04** | Vignette |
| 15/04 | Prorata de TVA définitif |
| **30/04** | **DSF** avec ses annexes : liste des clients et fournisseurs, amortissements, état de répartition des bénéfices, liste des clients des grossistes, état des sous-traitants du BTP, taxe d'apprentissage. **Dossier annuel des ONG** |
| **30/06** | Solde de la taxe professionnelle et de la taxe immobilière |
| **Avant le 1/07, le 1/09 et le 1/11** | Acomptes d'IS ou d'IMF : 3 × 20 % de l'impôt N-1 |
| 8 jours après l'embauche | Immatriculation CNSS |
| 48 heures après un accident du travail | Déclaration à la CNSS et à l'inspection du travail |
| 30 jours après le début d'activité | Déclaration d'existence, avec les bénéficiaires effectifs |
| Tous les 90 jours | Renouvellement de l'ARF |

**Adaptation dans Kanoo.** Créer une table `ECHEANCES` unique, avec le régime, la périodicité, le jour et l'effectif minimal. Elle alimente à la fois `lib/cron-jobs.ts` (rappels), `lib/daily-brief-server.ts` (brief quotidien) et les écrans `fiscalite/*`, à la place des textes en dur.

---

## 10. Pénalités : barème pour la simulation et les alertes

**Défaut ou retard de déclaration (art. 809)**
- **Déclaration sans droits** : amende de 50 000 FCFA (mensuelle ou trimestrielle) ou de 200 000 FCFA (annuelle).
  - Astreinte en plus : 5 000 FCFA par jour, puis 10 000 FCFA par jour au-delà d'un mois.
  - L'astreinte est plafonnée à 2 fois l'amende.
- **Déclaration avec droits** : pénalité de 20 %, au moins égale à l'amende ci-dessus.

**Insuffisances et intérêts (art. 810)**
- **Pénalité sur insuffisance** :
  - 20 % dans le cas de base ;
  - 40 % si la bonne foi n'est pas établie ;
  - 70 % en cas de manœuvres frauduleuses, de **facturation illégale de TVA** ou de taxation d'office.
- **Intérêt de retard** : **0,25 % par mois** ou fraction de mois, sur les droits simples, à partir du 1er jour du mois qui suit l'exigibilité.

**Recouvrement (art. 812-815)**
- Paiement tardif : majoration de **10 %**.
- Chèque sans provision : **25 %**.
- Acompte payé en retard : **10 %**.
- Retenue non faite : 1 fois la retenue. Retenue non reversée : 2 fois la retenue.

**Facturation et identification (art. 818, 828)**
- NIF absent d'une facture : 100 000 FCFA, puis 200 000 FCFA.
- Vente sans facture certifiée : 2 000 000 FCFA.
- Facture minorée : amende égale à la TVA, au moins 100 000 FCFA par facture.
- Modification du système de facturation : 1 000 000 FCFA par facture.
- Éditeur de logiciel non homologué : 1 000 000 FCFA, puis 10 000 000 FCFA en récidive.

**Comptabilité (art. 824-827)**
- Comptabilité irrégulière : 1 000 000 FCFA par exercice.
- Livres non paraphés : 50 000 FCFA par document.
- Destruction d'un document avant 10 ans : 1 000 000 FCFA.

**CNSS** : 200 FCFA par salarié et par mois de retard de déclaration.

**Adaptation dans Kanoo.** Afficher sur chaque échéance dépassée une estimation « pénalités si vous déposez aujourd'hui ». Le module `lib/dunning.ts` n'est pas concerné : il traite des relances commerciales.

---

## 11. Facturation, SECeF, comptabilité et archivage (Livre 4)

### 11.1 Facture certifiée (art. 802 à 804, 828)
- **Champ de l'obligation** : toute opération d'une personne soumise à l'IS, à l'IBA ou à l'impôt forfaitaire, ou assujettie à la TVA, donne lieu à une **facture certifiée**, émise par un **SECeF relié à un MCF**.
- **Homologation de Kanoo.** Un logiciel de facturation ne peut être **commercialisé** au Niger qu'avec une **attestation de conformité DGI** propre à ce logiciel, conforme aux spécifications techniques d'inaltérabilité, de sécurisation, de conservation et d'archivage. Sans elle, l'éditeur encourt 1 000 000 FCFA puis 10 000 000 FCFA, et la vente d'un système non homologué ou « permissif » coûte 5 000 000 FCFA avec retrait du droit de commercialiser. **C'est un préalable commercial à engager auprès de la DGI.**
- **Mentions obligatoires sur la facture** :
  - date ;
  - **numéro unique, chronologique et continu** ;
  - nature de l'opération ;
  - montant HT ;
  - taux et montant de la TVA ;
  - vendeur : raison sociale, **NIF**, **RCCM**, **références bancaires** ;
  - acheteur : **NIF**.
  - Les mentions minimales du document qui tient lieu de facture sont fixées par note circulaire du DGI.
- **Le NIF figure aussi sur les reçus, quittances et lettres** (art. 775-3).

**Adaptations dans Kanoo**
1. `lib/pdf-document.ts` : imprimer **en clair** le code SECeF, la date et l'heure de certification, l'identifiant MCF et le compteur, en plus du QR. Ajouter les **références bancaires** du vendeur.
2. Ajouter le NIF de l'organisation aux **reçus** d'encaissement et aux courriers (relances).
3. **Inaltérabilité** :
   - aucune modification d'une facture émise, quel que soit le chemin ;
   - toute correction passe par un avoir ;
   - supprimer le chemin de numérotation hérité `app/api/devis/[id]/route.ts:62-64`, qui peut créer des doublons ou des trous, au profit de `nextDocumentNumber`.
4. **Achats** :
   - case « facture fournisseur certifiée » et code SECeF du fournisseur ;
   - sans ces éléments, avertir que la TVA et la charge ne sont pas déductibles ;
   - pour les produits stockés, conserver les justificatifs : factures certifiées et documents de douane (art. 639).

### 11.2 Comptabilité et conservation (art. 654, 799 à 801)
- Comptabilité **SYSCOHADA**, tenue au Niger, en français.
- En comptabilité informatisée, les écritures sont **identifiées, numérotées et datées dès leur saisie**, avec une garantie de **chronologie, d'irréversibilité et de durabilité**.
- **Conservation 10 ans « en République du Niger »**, y compris après la cessation d'activité. Sont visés notamment les copies de factures et les bons de commande et de livraison.
- **Fichier des écritures comptables** à remettre sous forme dématérialisée, au format fixé par arrêté.
- **Sources du logiciel** à fournir à l'administration sur demande.

**Adaptations dans Kanoo**
1. Clôture de période : interdire toute modification ou suppression d'écriture validée et tenir une piste d'audit, si ce n'est pas déjà complet.
2. Ajouter un **export du fichier des écritures comptables**, au format CSV en attendant l'arrêté.
3. **Stockage S3** : la conservation « en République du Niger » pose une question si le compartiment est à l'étranger. Prévoir une copie locale exportable, ou une région ou un hébergeur au Niger, ou bien faire valider le point.
4. **Séquestre des sources** du logiciel en prévision d'une demande (art. 801-2).
5. **Régime du forfait** : produire un registre chronologique des achats et un registre des ventes.

### 11.3 Exports annuels à générer
| Export | Échéance | Contenu |
|---|---|---|
| **État annuel des salaires** | 31/01 | Par salarié : brut, avantages, CNSS, ITS |
| **DAS des honoraires** | Avant le 1/02 | Bénéficiaires ayant reçu plus de 50 000 FCFA TTC sur l'année : état récapitulatif et bulletin individuel |
| Annexe de la DSF : clients et fournisseurs | 30/04 | NIF, adresse, téléphone, montant |
| Liste des clients des grossistes (art. 796) | Avec la DSF | NIF, RCCM, achats de l'année, retenue mensuelle. Amende : 10 % du montant, au moins 500 000 FCFA |
| État des sous-traitants du BTP (art. 797) | Avec la DSF | Identité, montant, nature |
| État de répartition des bénéfices | Avec la DSF | Associés et administrateurs |
| **ONG et associations** (art. 795) | 30/04 | États financiers avec tableau des flux, **registre des donateurs** (sources et montants), **état des exonérations obtenues et des retenues opérées**. À défaut, l'ONG **perd ses exonérations** |

### 11.4 ONG et exonérations (art. 847-852)
- **ONG ayant signé le protocole d'accord type** : l'exonération de TVA et de douane vaut **seulement pour les activités financées sur fonds extérieurs**. Les financements nationaux relèvent du droit commun.
- **Marchés sur fonds extérieurs** :
  - TVA « **prise en charge par le budget de l'État** » ou exonérée selon le cas ;
  - jamais l'IS du titulaire ni son matériel.

**Adaptation dans Kanoo.** Ajouter une **source de financement** (extérieure ou nationale) aux projets et marchés. Elle pilote le motif d'exonération sur la facture et alimente l'état des exonérations.

---

## 12. Points à vérifier avant de coder
1. **ITS, ordre des opérations.** Il reste à confirmer que l'abattement familial s'applique bien à la base et non à l'impôt, et que l'arrondi au millier intervient en dernier. Le texte extrait (art. 150-151, modifiés par la LF 2026) est mélangé par les colonnes du PDF. L'exemple du §3.2 suit la lecture retenue.
2. **SMIG.** Le guide CNSS de juillet 2025 indique 30 047 FCFA. Kanoo utilise 41 000 FCFA (« arrêté 2023 »). Il faut vérifier si un décret de revalorisation est en vigueur, puis rendre la valeur réglable.
3. **Annexe 3 du guide CNSS** (éléments non soumis à cotisation) : absente du texte extrait. Il faut la récupérer pour exclure correctement les primes et indemnités de l'assiette.
4. **Taxe de 1 % sur les paiements en espèces de plus de 100 000 FCFA** : le texte ne dit pas clairement qui la supporte, du payeur ou de l'encaisseur.
5. **Entreprises tenues de retenir la TVA** : la liste est fixée par arrêté et ne figure pas dans le CGI.
6. **Maternité** : il faut confirmer en droit du travail que l'employeur verse la moitié du salaire.
7. **Spécifications techniques SECeF** et note circulaire sur les mentions minimales : elles sont hors CGI et à obtenir auprès de la DGI, en même temps que la procédure d'attestation de conformité.
8. **Art. 28 (régimes d'imposition)** : les seuils du RSI et du forfait sont à relire sur le PDF original, car l'extraction est ambiguë.

---

## 13. Plan d'adaptation proposé

**Lot G1 : paie conforme**, la priorité absolue, car chaque bulletin est faux aujourd'hui.
- CNSS 2024 :
  - taux par branche ;
  - plafond de 500 000 ;
  - catégories stagiaire et détaché ;
  - périodicité mensuelle à partir de 20 salariés ;
  - échéance de 30 jours.
- ITS 2026 :
  - barème à 9 tranches ;
  - 13 % de frais professionnels ;
  - abattement familial ;
  - avantages en nature ;
  - arrondi ;
  - échéance du 15.
- Champs de la fiche salarié (charges de famille, immatriculation CNSS, catégorie).
- Aperçu de la fiche salarié corrigé, affichage du taux d'ancienneté, textes d'interface.
- Tests unitaires de référence, dont l'exemple du §3.2.
- Date d'effet sur les paramètres, pour qu'un bulletin de 2025 régénéré garde les taux de 2025.

**Lot G2 : facturation et TVA**
- Taux 19, 10, 5 et 0, avec motif d'exonération.
- Retenue de TVA par l'État ou un client désigné, et exigibilité à l'encaissement.
- Timbre-quittance de 200 FCFA sur les encaissements en espèces.
- Déclaration de TVA par taux.
- Régime réel normal ou RSI.
- Échéances au 15.
- Mentions SECeF en clair et références bancaires.
- Suppression du chemin de numérotation hérité.

**Lot G3 : retenues et impôts sur les bénéfices**
- Précomptes de 2 à 8 %, non-résidents 20 %, retenue de conformité 10 % avec suivi de l'ARF, IRL 12 %.
- Écritures et certificats de retenue.
- Freelances soumis au précompte.
- IMF à 1,75 %, impôt dû = le plus élevé entre l'IS et l'IMF.
- Taux de 26 %.
- Acomptes 3 × 20 %.
- Tableau de passage du résultat fiscal et report des déficits.

**Lot G4 : calendrier, déclarations annuelles et pénalités**
- Table unique des échéances, avec jours fériés et report au jour ouvrable.
- État annuel des salaires, DAS des honoraires, annexes de la DSF, dossier ONG.
- Taxe d'apprentissage, taxe professionnelle, taxe immobilière.
- Simulateur de pénalités.

**Lot G5 : conformité de la plateforme**
- Amortissements alignés sur le CGI :
  - une seule table ;
  - informatique à 50 % ;
  - biens de moins de 100 000 FCFA en charge ;
  - dégressif réservé au matériel neuf d'au moins 3 ans ;
  - corriger l'écran des immobilisations, qui impose 5 ans et ignore la méthode choisie.
- Export du fichier des écritures comptables.
- Inaltérabilité.
- Lieu de conservation des archives.
- Comptabilité ONG par source de financement.
- Dossier d'homologation DGI du logiciel.

**Principe d'architecture commun.** Regrouper tous les paramètres dans `lib/niger-fiscal.ts`, sous forme de tables **datées** (`{ depuis: "2026-01-01", ... }`), avec une fonction `parametres(date)`. Les écrans et les traductions lisent ces tables au lieu de recopier les chiffres. Enfin, chaque bulletin et chaque facture **enregistre les taux appliqués**, pour que l'historique ne change jamais.
