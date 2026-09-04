# Benchmark & feuille d'améliorations — Kanoo / NumaPilot

> Analyse comparative des logiciels de gestion pour petites structures
> (PME, associations, administrations), confrontée à ce que Kanoo fait déjà, et
> liste priorisée des fonctionnalités et améliorations UX à apporter. Inclut vos
> trois demandes (multi-rôle, IA rédactionnelle, livraison par lots).

---

## 1. Périmètre et méthode

Comparé à Kanoo sur son terrain réel : facturation conforme OHADA/CGI Niger,
paie CNSS/IR, marchés publics (CMP), trésorerie, associations, administrations,
mobile money, hors-ligne. On distingue quatre familles de concurrents, chacune
forte sur un axe et faible ailleurs — l'intérêt de Kanoo étant précisément de
couvrir les trois profils dans un seul outil.

---

## 2. Panorama concurrentiel

### a) ERP / gestion PME généralistes
**Odoo, Dolibarr, Sage 100/Business Cloud, EBP, Zoho One, Axonaut, Sellsy, Pennylane**

| Ce qu'ils font très bien | Ce qui manque pour le Niger |
|---|---|
| Modules riches et interconnectés (CRM→devis→facture→compta→stock) | Pas de conformité CGI Niger / SECeF / DTS |
| Automatisations (relances, workflows, règles) | Paie non CNSS/IR ; pas de retenue à la source art. 118 |
| Rapprochement bancaire par connexion directe (open banking) | Mobile money Orange/Moov/Airtel absent |
| Portails client, e-signature, OCR de factures | Cher, en ligne permanent requis, pensé pour l'Europe |

**À retenir pour Kanoo** : la richesse d'automatisation (Odoo/Axonaut), l'OCR de
justificatifs (Pennylane, Dext), le portail client, l'e-signature.

### b) Compta / facturation légère
**Henrri, Tiime, Indy, Wave, QuickBooks, Zoho Books, Abby**

| Points forts | Limites |
|---|---|
| Prise en main immédiate, gratuité partielle (Henrri, Wave) | Pas de marchés publics, pas d'associatif |
| Tableaux de bord de trésorerie prévisionnelle soignés | Pas multi-profil |
| Catégorisation automatique des dépenses par IA | Fiscalité étrangère |

**À retenir** : la trésorerie prévisionnelle (déjà amorcée chez Kanoo), la
catégorisation IA des dépenses, la simplicité d'onboarding.

### c) Gestion associative
**AssoConnect, HelloAsso, Yapla, Springly, Dolibarr-asso**

| Points forts | Limites |
|---|---|
| Adhésions, cotisations, dons, reçus fiscaux, AG, votes en ligne | Pas de PME ni d'administration |
| Billetterie d'événements, paiement en ligne intégré | Fiscalité France |
| Communication de masse (emailing membres) | — |

**À retenir** : votes/délibérations d'AG en ligne, emailing de masse aux membres,
reçus fiscaux automatisés.

### d) Secteur public / marchés
**AWS-Achat, Marco (Agysoft), Procy, e-Attestations, plateformes DGMP**

| Points forts | Limites |
|---|---|
| Cycle complet engagement→mandatement→paiement, nomenclature | Lourds, chers, pensés pour de grandes administrations |
| Publication d'AO, dépôt dématérialisé, analyse des offres | Pas d'intégration PME/asso |
| Contrôle des seuils, journal des marchés | — |

**À retenir** : analyse comparative des offres (grille de notation), publication
et suivi d'AO, contrôle automatique des seuils CMP.

---

## 3. Ce que Kanoo a déjà — et où il est en avance

Kanoo n'est pas en retard sur le cœur ; sa singularité est la **couverture des
trois profils** et l'**ancrage Niger** qu'aucun généraliste n'a :

- Facturation + devis + avoirs conformes (TVA 19 %, DTS, retenue source), **SECeF**.
- Paie CNSS/IR, immobilisations/amortissements OHADA.
- **Trésorerie réelle + rapprochement bancaire par import de relevé** (fait pendant l'audit).
- **Relances clients** multi-canal avec barème et garde-fous (fait).
- Abonnements (revente incluse), CRM, projets unifiés, billetterie QR.
- Marchés publics : engagement → mandatement → chapitres budgétaires.
- Notes de frais + capture de justificatifs, documents administratifs avec veille d'expiration.
- **Mobile money**, **mode hors-ligne**, design par espace (3 identités).

Peu de concurrents cochent *à la fois* PME, asso et public. C'est l'atout à
protéger.

---

## 4. Écarts fonctionnels — à ajouter, par priorité

Chaque item indique l'effort (S/M/L) et s'il figure dans vos demandes.

### Priorité 1 — forte valeur, socle

| # | Fonctionnalité | Pourquoi | Effort |
|---|---|---|---|
| 1 | **Rôles multiples par collaborateur** *(votre #1)* | Dans une petite structure, une personne est comptable + RH + achats. Aujourd'hui un seul rôle. | **M** |
| 2 | **Livraison par lots / marché-cadre** *(votre #3)* | Vendre une quantité annuelle livrée par tranches (ex. cartes ISIC aux universités), avec suivi input→produit→livré. | **L** |
| 3 | **Assistant IA rédactionnel** *(votre #2)* | Courriers administratifs, rapports d'activité, relances rédigées. | **M** |
| 4 | **Relevé & portail client** | Le client voit ses factures/soldes/règlements, paie en ligne. Le relevé existe déjà côté interne. | **M** |
| 5 | **OCR des justificatifs** | Lire montant/date/fournisseur d'une photo de reçu (note de frais, facture d'achat). | **M** |

### Priorité 2 — automatisation & pilotage

| # | Fonctionnalité | Pourquoi | Effort |
|---|---|---|---|
| 6 | **Devis→commande→BL→facture chaînés** avec reliquats | Suivi des quantités commandées vs livrées vs facturées. Base du #2. | M |
| 7 | **Trésorerie prévisionnelle** (encaissements/décaissements projetés) | Anticiper les tensions, pas seulement constater. | M |
| 8 | **Rapprochement bancaire par connexion** (au-delà de l'import CSV) | Réduire la saisie ; API bancaires locales quand disponibles. | L |
| 9 | **Workflows d'approbation configurables** (dépenses, devis, engagements) | Seuils et circuits de validation par montant. | M |
| 10 | **Analyse des offres de marché** (grille de notation) | Comparer les soumissionnaires, tracer l'attribution. | M |

### Priorité 3 — croissance & conformité

| # | Fonctionnalité | Pourquoi | Effort |
|---|---|---|---|
| 11 | **e-Signature** (devis, contrats, PV) | Cycle de vente et gouvernance sans impression. | M |
| 12 | **Emailing de masse** (clients, membres) + modèles | Communication, convocations d'AG, campagnes. | M |
| 13 | **Votes / délibérations d'AG en ligne** | Gouvernance associative à distance. | M |
| 14 | **Multi-établissement / multi-devise** | Plusieurs points de vente, achats en EUR/USD. | L |
| 15 | **API publique documentée + webhooks** | Intégrations tierces, écosystème. | M |
| 16 | **Application mobile** (le dossier `mobile/` existe) | Terrain, encaissement, check-in événements. | L |

---

## 5. Design, UX, ergonomie

Le socle visuel est solide (3 identités, tokens, composants). Pistes d'amélioration :

- **Onboarding guidé** : à la première connexion, un assistant qui configure
  l'essentiel (organisation, TVA, premier client, logo) plutôt qu'un tableau de
  bord vide. C'est le principal levier d'adoption chez Henrri/Zoho.
- **États vides actifs partout** : chaque écran sans données propose la première
  action (déjà fait sur certains ; à généraliser).
- **Recherche globale (⌘K)** enrichie : sauter à un client, une facture, une
  action — la palette existe, l'étendre aux données.
- **Accessibilité** : contrastes AA, navigation clavier complète, `aria-*` sur
  les tableaux et graphiques (audit a11y à mener).
- **Densité réglable** : un mode « confort » et un mode « dense » selon l'écran
  et le métier (le comptable veut dense, le dirigeant veut lisible).
- **Notifications hiérarchisées** : distinguer ce qui appelle une action de
  l'informatif ; centre de notifications avec regroupement.
- **Exports soignés** : PDF/Excel de chaque liste et rapport, en-tête à l'entête
  de l'organisation.
- **Cohérence mobile** : la vitrine et l'app sont responsives ; vérifier chaque
  écran dense (tableaux) sur petit écran.

---

## 6. Vos trois demandes — faisabilité et approche

### #1 — Rôles multiples *(effort M)*
`User.role` est unique aujourd'hui. Deux voies :
- **Recommandée** : passer à `roles: UserRole[]` et évaluer les permissions en
  **union** (autorisé si *au moins un* rôle le permet). Migration des comptes
  existants (un rôle → tableau à un élément), et adaptation des points qui lisent
  `auth.role`. Rétrocompatible.
- Alternative légère : garder un rôle « principal » et ajouter des **rôles
  secondaires** cumulatifs — même logique d'union, moindre surface de changement.

### #2 — Assistant IA rédactionnel *(effort M)*
Un module qui rédige courriers administratifs, rapports d'activité, relances, à
partir des données de l'organisation. **Décisions nécessaires** : fournisseur
(l'API Claude d'Anthropic est le choix naturel), budget/quota par organisation,
et où l'exposer (un espace « Assistant » + des boutons « rédiger » contextuels
sur les écrans concernés). Garde-fous : l'IA propose, l'humain valide et envoie.

### #3 — Livraison par lots / marché-cadre *(effort L)*
Votre cas ISIC est un **marché-cadre** : une commande client d'une quantité
annuelle, livrée par tranches, adossée à un stock d'intrants (numéros ISIC)
transformés en produits finis (cartes). Il faut modéliser : la commande-cadre
(quantité, prix, période), les **lots de livraison** successifs avec reliquat, le
**suivi des intrants** (achetés → consommés → disponibles), et la facturation au
fil des livraisons. C'est le chantier le plus structurant — et le plus
différenciant.

---

## 7. Séquence proposée

Pour ne pas tout ouvrir en même temps, un ordre qui livre de la valeur à chaque
étape et où chaque brique sert la suivante :

1. **Multi-rôle (#1)** — socle transverse, débloque l'usage réel en petite structure.
2. **Chaînage devis→commande→BL→facture avec reliquats (#6)** — prérequis du #3.
3. **Livraison par lots / marché-cadre (#3)** — s'appuie sur le #6.
4. **Assistant IA (#2)** — indépendant, forte valeur perçue, effort maîtrisé.
5. Puis, selon priorité commerciale : portail client, OCR, trésorerie prévisionnelle.

À vous de dire par où commencer — je peux enchaîner sur le multi-rôle
immédiatement (c'est le plus réutilisable et le moins risqué), ou attaquer celui
qui vous presse le plus commercialement.
