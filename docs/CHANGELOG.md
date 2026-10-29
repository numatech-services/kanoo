# Kanoo — Changelog

## Cohérence et robustesse — hors-ligne, fuseau, numérotation, mobile (octobre 2026)

**1. Mode hors ligne sûr** — `public/sw-policy.js` (règles testées), `public/sw.js`
- L'authentification (`/api/auth/*`) et les envois de fichiers ne passent plus par la file hors ligne : un mot de passe n'est plus stocké dans le téléphone, une déconnexion n'est plus rejouée plus tard.
- Plus aucune page ni donnée connectée n'est mise en cache, sauf les listes de référence (clients, articles, fournisseurs, comptes). Ces données sont effacées à l'ouverture de la page de connexion et à la déconnexion. L'ancien cache `kanoo-v1` est supprimé.
- Chaque écriture porte sa clé d'idempotence dès le premier envoi : une réponse perdue ne crée plus de doublon au rejeu. Un 409 « requête en cours » est réessayé.
- La file d'un utilisateur n'est jamais rejouée sous la session d'un autre. Une déconnexion avec des actions en attente demande confirmation.
- La caisse rapide gère seule ses tickets en attente : elle ne plante plus sur la réponse « mis en file ».
- Corrigé : une lecture faite avant le service worker créait la base hors ligne sans ses tables.

**2. Fuseau Africa/Niamey** — `lib/timezone.ts`, `instrumentation.ts`, `next.config.mjs`
- Le fuseau est fixé au démarrage du serveur, quel que soit celui de l'hébergement.
- Problèmes corrigés :
  - de minuit à 1 h, une vente était refusée comme « caisse arrêtée » ;
  - l'écart d'un arrêté du dernier jour du mois tombait le mois suivant ;
  - les promotions à heure fixe et les services de l'emploi du temps étaient décalés d'une heure.
- 54 dates d'écran (« aujourd'hui », fin du mois dernier…) étaient calculées en UTC : elles passent par `localDay` / `todayLocal` (`lib/format.ts`).

**3. Numéros sans doublon** — `lib/serial.ts`, `models/SerialCounter.ts`
- Concerne les reçus de dons et de cotisations, les notes de frais, les inventaires, les courriers et les marchés.
- Avant : « nombre de documents + 1 ». Ce calcul redonnait un numéro existant après une suppression ou lors de deux enregistrements simultanés, et ne repartait pas à 1 chaque année.
- Maintenant : un compteur atomique par série et par année, amorcé au plus grand numéro déjà émis. Un numéro saisi à la main est sauté.
- Une transaction en conflit est rejouée jusqu'à 5 fois, avec un délai aléatoire (2 fois auparavant).

**4. Déconnexion pour inactivité** — `lib/idle.ts`, `lib/use-draft.ts`
- Les délais passent à 15 minutes côté écran et 20 minutes côté serveur (contre 2 et 4).
- Revenir sur l'onglet compte comme une activité.
- Facture, devis et dépense gardent un brouillon sur l'appareil, rattaché à l'utilisateur et proposé à la réouverture. Les brouillons sont effacés à la déconnexion volontaire.

**5. Erreurs internes jamais renvoyées**
- 7 routes renvoyaient le message brut d'une exception ; elles passent désormais par `serverError`.
- Un nouveau test de contrat attrape toutes les formes de ce défaut.
- Un doublon refusé par un index unique répond 409 « existe déjà » au lieu de 500.

**6. Pages jamais blanches** — `components/ui/PageState.tsx`
- Chaque espace a son squelette de chargement et sa page d'erreur dans la coque (`loading.tsx`, `error.tsx`).
- 29 pages blanches au premier affichage montrent un squelette.
- Devis, fiche client et abonnements affichent l'erreur avec « Réessayer » au lieu de rester vides.

**7. Listes sur téléphone**
- `DataTable` (26 écrans) devient une liste de cartes sur téléphone : titre, puis « libellé : valeur », puis actions. Montant et statut sont visibles sans défiler de côté.
- Les filtres tiennent sur une ligne défilante.
- Le formulaire de devis se replie sur mobile et affiche ses erreurs.

**8. Comptoir sur téléphone**
- La caisse rapide passe en premier bouton.
- Les dix onglets tiennent sur une ligne défilante (barre d'onglets accessible).
- La caisse rapide ouverte sans comptoir propose le choix, ou ouvre le seul comptoir existant.

**14. Menus**
- Association : Notifications, Fiscalité, Notes de frais, Documents, Courriers, Support, Journal d'audit.
- Administration : Notifications, Fournisseurs, Trésorerie, Comptabilité, Fiscalité, Notes de frais, Documents, Courriers, Support, Journal d'audit.
- Super-administrateur : Facturation.
- Ces écrans étaient accordés aux rôles mais introuvables. Chaque entrée reste filtrée par droit.
- Un test d'intégrité vérifie que chaque lien mène à une page, que chaque droit existe et qu'aucun écran accordé ne manque au menu.

**Tests** : `sw-policy`, `timezone`, `idle-drafts`, `nav-integrity` (unitaires), contrat « aucune exception brute », scénario `e2e-coherence` (11 vérifications).

**Mise en production** :
- lancer `npm run indexes` (compteurs de séries, cotisations, dons) ;
- `TZ` est facultatif : `Africa/Niamey` est posé par défaut.

## The Spot — liaison avec EasyPay (octobre 2026)

Onglet « EasyPay » du comptoir, API `/api/v1/spot`, `lib/easypay.ts`, `lib/easypay-server.ts`. Contrat complet : `docs/API-EASYPAY.md`.

**Répartition**
- Kanoo fait foi pour les articles et les prix ; EasyPay les lit (`GET /catalogue`, avec ETag).
- EasyPay envoie ses ventes (formules comprises), annulations, recharges en espèces, réceptions, pertes, inventaires et pré-commandes (`POST /events`, par lots). Chaque événement n'est écrit qu'une fois.
- Numatech détient l'argent des cartes. Une vente par carte est une créance sur Numatech et une recharge encaissée au comptoir lui est due : les deux passent par le compte courant 467100, soldé par les reversements (onglet EasyPay).
- Aucune donnée personnelle reçue : le profil tarifaire seulement.

**Dans Kanoo**
- Une vente reçue ne se refuse pas :
  - elle garde le prix de la caisse ;
  - un stock insuffisant est toléré (ramené à 0) ;
  - un article inconnu est créé ;
  - une journée déjà arrêtée reporte l'écriture au premier jour ouvert.
- Les événements refusés par une règle (annulation avant sa vente…) sont gardés, rejouables ou à écarter depuis l'onglet.
- Les pré-commandes entrent dans le plan de production : on prépare au moins ce qui est commandé. `GET /production` les rend à EasyPay.
- Le bilan de la semaine montre à part les ventes payées par carte et les recharges, qui ne sont pas des recettes.

**Sécurité**
- `POST /api/v1/auth` : réservé à l'administration de l'entreprise, protégé contre le CSRF, droits limités à `invoices:read` et `clients:read`. Avant, tout utilisateur connecté pouvait créer une clé avec tous les droits.
- Clés du comptoir :
  - liées à un comptoir ;
  - valables 2 ans, révocables ;
  - limitées à 600 appels par minute ;
  - inactives si leur auteur perd l'accès.
- Le modèle `ApiKey`, défini deux fois et de façon différente, est unifié. La date du dernier appel n'était pas enregistrée.

**Mise en production** : lancer `npm run indexes` (index uniques des événements, des pré-commandes et des articles reliés), puis `easypay:kanoo-link` sur le serveur EasyPay.

## The Spot — quantités du restaurant selon l'emploi du temps du campus (octobre 2026)

Onglet « Planning » du comptoir, `lib/campus.ts`, `lib/campus-server.ts`, `models/DeskSchedule.ts`.

**Emploi du temps du comptoir**
- Services de repas (petit-déjeuner, déjeuner, pause, dîner) avec leurs horaires et un public de base toujours présent (résidents, personnel).
- Cours : jour, heures, classe, effectif, dates de validité. Une classe compte pour un service si elle a cours à moins d'une heure de la plage.
- Périodes : vacances (×0,1), examens, jours fériés (0), événements (×1,5). Bouton « + Vacances de fin d'année ».
- Marge de sécurité (10 % par défaut).

**Import des plannings PDF** (format des plannings de semestre Swiss UMEF) — `lib/timetable-pdf.ts`, route `POST /api/comptoir/schedule/import`
- Lecture par position du tableau Dates | Cours | Jour | Heures : intitulés sur deux lignes, « Lundi au vendredi », plusieurs plages horaires par jour.
- Classe, programme et année repérés dans l'en-tête ; badge « 1re année ».
- Les pauses du planning (10h30–11h00, 15h45–16h15) peuvent devenir des services de vente ; le déjeuner se cale entre la fin du matin et le début de l'après-midi.
- Révision et examens : supposés les matinées du lundi au vendredi (8h30–12h30). La révision réduit la fréquentation (×0,6).
- L'effectif de chaque classe est saisi à l'import (il ne figure pas dans le PDF). Import CSV toujours possible (jour ; début ; fin ; groupe ; effectif).

**Plan de production**
- Consommation apprise sur les 28 derniers jours (jusqu'à la veille) : unités vendues par personne présente, service par service. Pour un comptoir récent, l'apprentissage part de la première vente.
- Quantité prévue = présence attendue × consommation par personne + marge.
- Pour chaque jour, par service :
  - présents et classes ;
  - articles à préparer ;
  - ingrédients des recettes face au stock et manquants.
- Vue de la semaine avec le chiffre d'affaires attendu. Fiche de production imprimable.
- Le réassort conseillé suit l'emploi du temps quand il est rempli (« d'après l'emploi du temps »), sinon l'historique des ventes.

**Mise en production** : `npm run indexes` crée l'index de `DeskSchedule`. Nouvelle dépendance `unpdf` (lecture des PDF, sans binaire natif).

## The Spot — 10 améliorations (octobre 2026)

**1. Ardoises (crédit client)** — onglet « Ardoises », `models/DeskCustomer.ts`, `lib/desk-credit.ts`
- Chaque habitué a un plafond de crédit. Une vente se fait à l'ardoise avec le moyen de paiement « Ardoise », dans la limite du plafond (réservation atomique).
- Écritures :
  - vente : créance en 411800, rien en caisse ;
  - règlement (espèces, mobile money…) : caisse / 411800 ;
  - annulation d'un ticket : la dette s'efface.
- Historique des mouvements, rappel par WhatsApp.
- Alerte quotidienne pour les ardoises de plus de 14 jours ou au-delà du plafond.

**2. Fiches recettes** — préparations maison
- Ingrédients et quantités pour une unité vendue.
- La vente sort les ingrédients du stock, avec un coût figé (somme des ingrédients). L'annulation les rend.
- La rentabilité calcule le coût de la recette.

**3. Pertes et casse par motif**
- Motifs : périmé, cassé, offert, personnel, manquant, écart d'inventaire.
- Chaque perte est une sortie de stock valorisée au coût.
- Le bilan de la semaine et la rentabilité montrent les pertes par motif et la marge après pertes.

**4. Réassort conseillé**
- Calcul : ventes moyennes des 28 derniers jours (ingrédients compris), jours de stock restants, quantité à commander en paquets entiers pour couvrir le délai de livraison et la période réglée.
- Signalement des ruptures avant livraison.
- Un clic crée les bons de commande brouillon au fournisseur habituel et imprime la liste de courses des achats au marché.

**5. Objectifs de la semaine**
- Objectifs de chiffre d'affaires et de marge, fixés sur le comptoir ou à l'ouverture de la caisse.
- Jauges avec le rythme attendu et le montant à faire par jour.
- Alerte à partir du 3e jour en cas de retard.

**6. Promotions** — onglet « Promotions », `models/DeskPromo.ts`
- Types : remise en % ou prix imposé.
- Ciblage : sur des articles ou une famille, certains jours, à une plage horaire (happy hour), à partir d'une quantité (prix de gros), jusqu'à une date.
- Le meilleur prix s'applique seul au ticket, sauf prix saisi à la main. L'écran de saisie affiche le même prix que le serveur.
- Effet mesuré : quantités, chiffre d'affaires, remise accordée, marge.

**7. Contrôle des caissiers**
- Par caissier :
  - tickets, chiffre d'affaires, panier moyen ;
  - annulations (nombre, montant, taux) ;
  - remises accordées ;
  - écarts des arrêtés.
- Alerte dès 3 annulations dans la journée, ou plus de 10 %.

**8. Rapprochement mobile money**
- Import du relevé de l'opérateur (Airtel, Moov, Zamani) en CSV ou par copier-coller.
- Rapprochement par montant à un jour près, avec deux listes d'écarts : reçu chez l'opérateur sans ticket, et encaissé sans trace chez l'opérateur.
- Une référence n'est jamais importée deux fois.

**9. Caisse rapide** (`/comptoir/rapide`, téléphone)
- Grille d'articles en gros boutons par famille, prix promotionnel affiché.
- Ticket en deux touches (espèces ou mobile money), le montant étant fixé par le serveur.
- Reçu par WhatsApp.
- Hors connexion : le ticket est gardé sur le téléphone et renvoyé au retour du réseau. Sa référence garantit qu'il n'est enregistré qu'une fois.

**10. Inventaire tournant**
- Chaque jour, quelques articles à compter (3 à 50, réglable). La priorité va aux articles jamais comptés, de forte valeur ou forte rotation, ou touchés par des pertes.
- On compte sans voir la quantité théorique. L'écart est enregistré, valorisé, et le stock aligné.

**Déploiement**
- Lancer `npm run indexes` : nouveaux index uniques (tickets idempotents, caisse ouverte unique, relevés mobile money, passages des tâches planifiées).

**Tests**
- 14 tests unitaires des règles (`lib/spot.ts`).
- Scénario `e2e-spot2` : 37 vérifications.

## The Spot — rentabilité par article et caisse de la semaine (octobre 2026)

**Rentabilité par article** (onglet « Rentabilité » du comptoir, `lib/comptoir-economics.ts`)
- **Achat au conditionnement** : un paquet de 24 à 5 000 FCFA donne le coût de revient à l'unité (208,33). Il se renseigne à la création de l'article ou par le crayon.
- **Indicateurs par article** :
  - marge unitaire, taux de marque et taux de marge ;
  - marge d'un paquet vendu en entier ;
  - prix plancher (en dessous, chaque vente perd de l'argent) ;
  - prix conseillé pour le taux de marque visé du comptoir (30 % par défaut, réglable).
- **Signalements** : articles vendus à perte, à marge mince (moins de 15 %), ou sans coût ni prix.
- **Stock** : chiffre d'affaires et marge attendus si tout le stock est vendu au prix affiché.
- **Ventes réelles de la période** :
  - par article : quantités, chiffre d'affaires, marge et rang ;
  - par famille ;
  - meilleures ventes ;
  - export CSV.
- **Calculateur libre** : prix du paquet ou coût unitaire, et prix de vente → marge, résultat par paquet, prix conseillé.
- **Entrée de stock par paquets** : « 3 paquets à 5 100 » → 72 unités à 212,50, prix du paquet mis à jour. Une entrée à l'unité peut aussi porter son coût d'achat.

**Caisse de la semaine** (onglet « Semaine », `models/CashSession.ts`, `lib/comptoir-session.ts`)
- **Ouverture** avec un fonds de caisse. Le fonds proposé est le montant compté à la dernière fermeture.
- **Bilan en direct** :
  - chiffre d'affaires, nombre de tickets et panier moyen ;
  - recettes, dépenses par nature et solde ;
  - espèces attendues en caisse ;
  - marge et taux de marque ;
  - chiffre d'affaires par jour ;
  - meilleures ventes (chiffre d'affaires, quantité, marge) et articles vendus à perte ;
  - évolution par rapport à la semaine précédente.
- **Fermeture** par le comptage :
  - l'écart est passé en 658 / 758 ;
  - les jours de la période sont verrouillés ;
  - le bilan est figé et imprimable.
- **Historique** semaine par semaine.
- **Nature des dépenses de caisse** : achats de marchandises, ingrédients, personnel, transport, eau et électricité, entretien, loyer, autres.

**Accès**
- Coûts et marges : visibles par le chef du service The Spot, en plus de la direction et de la comptabilité.
- Caissiers et serveurs : ils ne voient que le chiffre d'affaires et la caisse.

**Tests**
- 7 tests unitaires.
- Scénario `e2e-spot` : 21 vérifications.

## Lot H4 — Fonctionnel (octobre 2026)

**Automatisations**
- **A4 — Contrats récurrents réellement facturés.** Pour chaque contrat en facturation automatique, la tâche du matin prépare une facture brouillon par période échue :
  - rattrapage de 12 périodes au plus ;
  - TVA au taux du contrat ;
  - action faite au nom d'un comptable habilité, qui est notifié.

  L'émission reste un geste humain. Le bouton du contrat utilise le même moteur.
- **R4 — Tâches planifiées reprises.** Chaque tâche inscrit son passage par période :
  - un appel répété ne rejoue que ce qui n'est pas fait ;
  - une tâche en échec est retentée trois fois au plus ;
  - la sauvegarde passe en premier ;
  - `&force=1` rejoue tout.

  Il faut appeler `?group=daily` toutes les 30 min de 06:00 à 09:30 (voir DEPLOIEMENT-HOSTINGER.md).
- **R5 — Paie d'office plus robuste.** Une erreur sur un salarié n'abandonne plus le mois. Une erreur technique libère la réservation, et l'appel suivant complète les bulletins manquants.
- **R6 — Notifications dédoublonnées.** Une même alerte n'est pas recréée tant qu'elle n'est pas lue, ni dans les 7 jours qui suivent sa lecture.
  - Les organisations suspendues ne reçoivent plus rien.
  - Purge mensuelle : notifications lues après 90 jours, toutes après un an.

**RH et services**
- **R1 — Départ d'un salarié.**
  - **Solde de tout compte** : salaire du mois au prorata et indemnité compensatrice de congés (jours restants × salaire / 26).
  - **Bulletin de sortie** généré au choix.
  - Un contrat échu n'est plus payé automatiquement et déclenche une alerte quotidienne.
  - Les indemnités de rupture prévues par la convention restent à ajouter en prime.
- **R2 — Jours fériés et report des congés.**
  - Les jours fériés du Niger sont exclus du décompte des congés : fêtes civiles, lundi de Pâques, Noël, et fêtes musulmanes à leur date prévisionnelle.
  - Chaque organisation peut ajouter ou retirer un jour.
  - Le plafond de report est réglable.
- **C11 — Services propres à chaque organisation.** La liste n'est plus celle de NUMATECH.
  - Les anciens codes déjà utilisés restent valables.
  - Nouveau rapport « Par service » dans la page Secteurs.
  - Réglages → RH et services.

**Comptabilité**
- **C9 — FEC conforme.**
  - Un numéro par écriture.
  - Tiers sur les lignes de classe 4.
  - Dates au jour de Niamey.
  - Lettrage avec sa date.
  - Montants à virgule.
- **C9 — Grand livre complet** : il n'est plus coupé à 5 000 lignes.
- **C10 — Synthèse corrigée.** La trésorerie additionne tous les comptes. Le chiffre d'affaires est HT, factures émises seulement, net des avoirs.
- **C12 — Compte de résultat sans compte oublié.** Les comptes hors rubrique (74, 76, 80…) vont dans « autres ».

**Achats, trésorerie, reventes**
- **A6 — Annulation d'un mouvement.** Une saisie manuelle ou un virement s'annule : écriture extournée et mouvement contraire.
- **A6 — Comptes en devise.** Ils sont suivis en contre-valeur FCFA et leur solde s'affiche aussi dans la devise : euro à 655,957, autres devises au cours saisi.
- **A6 — Règlement fournisseur.** Il ne peut plus être daté dans le futur.
- **A5 — Revente d'abonnement facturable.** Elle donne une facture brouillon liée, ce qui retire l'alerte « non facturée ».

**Projets (R3)**
- **Tâches sans écrasement.** Elles se modifient une par une. Une liste envoyée sur une version périmée est refusée.
- **Jalon facturable.** Un jalon donne une facture brouillon au client, une seule fois.
- **Suivi du temps.** Un onglet « Temps » regroupe :
  - les saisies, par tâche ;
  - le total par personne ;
  - le coût interne estimé.
- **Suppression douce.** Un projet supprimé disparaît des listes et reste restaurable.

**Encaissement**
- **Relances avec lien de paiement.** Chaque relance (e-mail, SMS, WhatsApp) contient le lien du portail du client, créé au besoin, pour payer par mobile money ou carte. On peut le désactiver dans les paramètres des relances.
- **Relevé envoyé par Kanoo.** Il part avec le PDF joint et le lien de paiement. Avant, le bouton ouvrait seulement la messagerie.
- **Échéancier de paiement** sur une facture :
  - versements datés dont le total fait le montant dû ;
  - règlements imputés dans l'ordre ;
  - relances et retards calés sur le versement en cours ;
  - échéancier imprimé sur le PDF.

**Recherche**
- **Recherche texte** dans les factures, devis, encaissements, commandes et livraisons : numéro, libellés, nom ou code du tiers.
- **Sélecteurs au-delà de 100** : les listes de clients et de fournisseurs des formulaires ne sont plus coupées.

**Tests**
- 20 tests unitaires.
- Scénario `e2e-h4` : 42 vérifications.

## Lot H3 — Comptoir et marges (octobre 2026)

**Ticket de caisse** (`models/ComptoirSale.ts`, `lib/comptoir-sale.ts`, onglet « Tickets »)
- **Ticket numéroté** (série TK, annuelle) :
  - plusieurs articles par ticket ;
  - remise par ligne ;
  - prix TTC proposé ou saisi ;
  - client facultatif ;
  - reçu imprimable de 80 mm.
- **Coût figé à la vente**. Chaque ligne garde :
  - le coût unitaire : le CMUP lu à la sortie, ou le coût de l'article propre ;
  - le HT, la TVA **de l'article** et la marge HT.
- **Paiement en plusieurs moyens** :
  - espèces sur la caisse du comptoir ;
  - Orange Money, Moov et Airtel sur le compte mobile money ;
  - carte, virement et chèque sur la banque.

  Une seule écriture regroupe :
  - les produits HT par compte ;
  - la TVA 443 ;
  - le timbre-quittance de 200 FCFA dès 5 000 FCFA en espèces.

  Le rendu de monnaie est calculé.
- **Avertissements** sur trois cas :
  - vente sous le coût, qui envoie aussi une alerte à la direction et à la comptabilité ;
  - article sans coût d'achat ;
  - stock bas.
- **Annulation motivée** du ticket :
  - stock rendu ;
  - encaissements retirés ;
  - écriture et trésorerie extournées.

  Un encaissement de ticket ne se supprime plus seul.

**Arrêté de caisse enregistré** (`models/CashClosing.ts`)
- **Un arrêté par jour et par comptoir** :
  - théorique par moyen de paiement ;
  - fonds de caisse ;
  - espèces comptées ;
  - écart.
- **Écart comptabilisé** : un manquant passe en 658100, un excédent en 758100, contre la caisse, avec un mouvement de trésorerie.
- **Journée verrouillée** : plus de ticket, d'écriture de caisse, de mouvement de stock, d'annulation ni de suppression à cette date ou avant.

**Marges** (`lib/margins.ts`, `/api/reports/margins`, page « Marges par produit »)
- **Indicateurs** : marge brute HT, taux de marque (sur le prix de vente) et taux de marge (sur le coût).
- **Regroupements** : par produit, catégorie, mois, comptoir, vendeur ou canal. La page montre aussi :
  - les meilleurs et les moins bons produits ;
  - l'évolution mensuelle ;
  - un export CSV.
- **Sources** :
  - tickets du comptoir, au coût figé ;
  - factures livrées, au coût réel des sorties de leurs bons de livraison ;
  - avoirs, déduits au coût de la facture qu'ils corrigent.
- **Articles sans coût** : ils sont signalés « sans coût » et exclus des taux, jamais comptés à 100 % de marge.
- **Accès** : réservé au gérant et à la comptabilité.

**Coût d'achat**
- **Frais d'approche** saisis à la réception (transport, douane) :
  - répartis au prorata de la valeur reçue ;
  - ils entrent dans le CMUP.
- **Bon de réception enregistré** à chaque réception. La fiche fournisseur le montre.

**Défauts corrigés** (audit K5 à K16)
- **K5** — Une dépense de caisse du comptoir ne déduit plus de TVA : il n'y a pas de facture.
- **K6** — La rentabilité par secteur ne compte plus deux fois un comptoir relié à une caisse. Les tickets y entrent pour leur HT.
- **K7** — La « marge brute » de l'analytique devient la marge sur achats HT : ventes 70 moins achats consommés 60.
- **K8** — L'inventaire applique l'écart et non la quantité comptée : les ventes faites pendant le comptage ne réapparaissent plus.
- **K9** — Les écarts d'inventaire passent en 6031, variation des stocks, et non plus en 659/759.
- **K12** — Un avoir total remet en stock ce qui avait été livré, dans ses lots, sauf `restock: false`.
- **K13** — Détacher un article du catalogue reprend sa réserve dans le stock du comptoir au CMUP : il n'est plus compté deux fois. Supprimer :
  - un article propre encore en stock est refusé ;
  - un article déjà mouvementé est archivé.
- **K14** — Les coûts, la valeur du stock et les marges sont masqués aux rôles non financiers, y compris dans les réponses d'API.

**Tests**
- 11 tests unitaires des marges et des frais d'approche.
- Scénario `e2e-h3` : 38 vérifications.

## Lot H2 — Enregistrement et timbres des marchés (octobre 2026)

**Droits d'enregistrement** (`lib/registration.ts`, `lib/registration-server.ts`)

| Acte | Droit | Article |
|---|---|---|
| Commande publique (État, collectivités, établissements publics, SEM, projets, bénéficiaires d'un concours de l'État) | 5 % HT + timbre de 25 000 FCFA sur l'original | art. 470-1/2, 584 e) |
| Contrat entre personnes privées, ONG comprises | 2 % HT | art. 470-5 (LF 2026) |
| Sous-traitance prévue au marché | 50 000 FCFA | art. 471 |
| Bon de commande public de moins de 1 000 000 FCFA | Timbre de dimension, 1 500 FCFA par page | art. 548-8°, 552 |
| PV de réception définitive (marché public) | Timbre de 25 000 FCFA | art. 584 e) |

- **Sur le marché** : nature de l'acheteur, nature de l'acte, date
  d'approbation, sous-traitance, pages, financement. Sur le client : nature
  (public ou privé), proposée par défaut.
- **Panneau « Enregistrement et timbres »** de la fiche du marché :
  - estimation expliquée ;
  - constat (646100 / 646200 imputés au projet d'exécution, 447300 au crédit) ;
  - paiement à la recette (447300 / banque, mouvement de trésorerie,
    n° de quittance) ;
  - timbre du PV de réception ;
  - annulation d'un constat non payé.
- **Marge du marché** : droits engagés dès l'estimation, réalisés au constat.
- **Échéance** : approbation + 1 mois (art. 481). Rappels à J-7, J-1 et J+1,
  et élément du brief quotidien.
- **Factures du marché** : référence du marché et numéro d'enregistrement
  imprimés.

**Timbre**
- **Plus de droit de timbre ajouté au TTC des factures.** L'ancien barème
  allait de 200 à 2 000 FCFA et s'appliquait même aux factures de l'État. Les
  factures déjà émises restent inchangées.
- **Timbre-quittance de 200 FCFA** (art. 560) sur chaque règlement en
  espèces d'au moins 5 000 FCFA, sauf pour un client public : charge 646200
  et dette 447000.

**Défauts des marchés corrigés** (audit M4 à M17)
- Montant du contrat libellé « HT ».
- Taux de TVA du devis repris par le marché (un devis exonéré n'est plus
  facturé à 19 %).
- Avance remboursée au prorata des situations hors échéancier.
- Brouillons :
  - comptés dans le reste à facturer ;
  - exclus du facturé, du dû et de la marge réelle.
- Avoirs partiels retranchés du plafond de facturation.
- Avoir ou annulation d'une facture de lot : le lot du marché-cadre est
  rouvert.
- Rattachement d'une facture au marché :
  - pas de doublon ;
  - `contractId` posé sur la facture ;
  - client contrôlé.
- Commission de caution imputée au marché.
- Numérotation :
  - références de contrat tirées de la série annuelle ;
  - références de marché public calculées sans collision.
- Attribution d'un marché public :
  - offre retenue reportée (fournisseur, montant) ;
  - statuts contrôlés.

**Sécurité** : le lien du portail client (empreinte, jeton) n'est plus
modifiable par le formulaire client.

Scénario `scripts/e2e/e2e-h2.mjs` (22 vérifications) ; tests unitaires
`__tests__/unit/registration.test.ts`.

## Lot H1 — Argent et comptabilité justes (octobre 2026)

Correctifs du lot H1 de `docs/AUDIT-2026-10.md`.

**Encaissements et factures**
- Facture relue dans la transaction de l'encaissement : deux encaissements
  simultanés ne perdent plus de règlement ; transitions de paiement gardées
  (confirmation, annulation) ; un paiement annulé ne se reconfirme plus.
- Un avoir ne s'encaisse plus (il se rembourse) ; bouton « Paiement » visible
  aussi en retard, jamais sur un avoir.
- Annulation de facture refusée si un avoir a été émis, si la créance est
  douteuse ou passée en perte.
- Annuler un encaissement ne remet plus « émise » une facture annulée ou
  passée en perte.
- Paiement en ligne : trop-perçu comptabilisé en avance client (419).

**Relevé client** (écran et PDF, une seule source : `lib/statement-server.ts`)
- **Les règlements n'y figuraient jamais** (filtre sur un champ client absent
  des paiements) : chaque client paraissait devoir tout ce qui lui avait été
  facturé.
- Factures annulées par avoir compensées, retenues subies et écarts de change
  comptés, remboursements d'avoir et passages en perte affichés.

**Numérotation continue (exigence DGI)**
- Numéro provisoire au brouillon (`BROUILLON-…`), numéro définitif tiré à
  l'émission : un brouillon supprimé ne laisse plus de trou.
- Compteur par série ET par année, initialisé sur les numéros déjà émis :
  une facture datée de décembre saisie en janvier ne percute plus la série
  de l'année. Remise à zéro annuelle idempotente.

**Avoirs**
- Extourne miroir de la vente, compte par compte (701, compte de l'article),
  et non plus toujours au 706.
- Quantités déjà créditées cumulées par ligne ; l'avoir qui complète les
  précédents reprend le timbre et solde la facture.
- Certification SECeF : type FA et code de la facture d'origine déduits du
  document. PDF : facture d'origine, motif, remise, unité ; les notes
  internes ne sont plus imprimées (nouveau champ « Conditions »).

**Banque et trésorerie**
- Import de relevé : « 150.000 » et « 150,000 » lus 150 000 FCFA.
- Rapprochement : soldes calculés sur tous les mouvements (plus de limite à
  500) ; un relevé réimporté qui chevauche le précédent ne crée plus de
  doublons.

**Doubles clics** : note de frais (approbation, remboursement), charge
récurrente (échéance future : paiement anticipé à confirmer), facture de
période d'un contrat récurrent.

**Comptoir** : suppression d'une écriture de caisse extournée (comptabilité,
trésorerie, stock de la vente) ; paiements mobile money / carte / virement
sur le bon compte de trésorerie ; prix du catalogue repris TTC.

**Marchés** : modification des marchés-cadres (liste blanche — elle
fonctionnait à l'envers) ; signature des contrats (signataire, qualité,
date) ; facture de période réservée aux contrats récurrents actifs, une par
échéance ; TVA nette négative comptabilisée ; brouillon de marché supprimé
libérant échéance et acompte ; intrant à 0 respecté ; bon de livraison
retourné remis en stock.

**Comptabilité**
- Clôture : possible malgré un verrou de janvier ; exercice en cours refusé ;
  contrôles préalables (brouillons, dotations, compte 47, variation de stock)
  à confirmer ; à-nouveaux des comptes de tiers ventilés par tiers.
- Affectation du résultat (réserves, report à nouveau, dividendes) ; au bilan,
  le résultat non affecté passe en report à nouveau (CJ = résultat de
  l'exercice seul).
- Lettrage par ligne, même tiers obligatoire, références uniques ; reprise
  automatique des lettrages existants.
- Référence d'une écriture produite par un document non modifiable ; rien de
  modifiable en période verrouillée ; variation de stock et dotation
  extournables.
- Immobilisations : dotation gardée (plus de double dotation), fiche et
  écriture d'acquisition dans la même transaction, dotation complémentaire à
  la cession.

Scénario `scripts/e2e/e2e-h1.mjs` (24 vérifications). Les scénarios existants
relisent le numéro définitif après émission.

Build local sans cache webpack : `KANOO_BUILD_NO_CACHE=1 npm run build`.

## Lot H0 — Sécurité (octobre 2026)

Correctifs des constats S1 à S11 et K4 de `docs/AUDIT-2026-10.md`.

| # | Faille | Correction |
|---|---|---|
| S1 | Plans et tarifs modifiables **sans authentification** (`/api/public/plans`) | Écriture déplacée sous `/api/superadmin/plans` (superadministrateur seul), champs filtrés et validés, journal d'audit ; la lecture reste publique |
| S2 | Exercice clôturé ou verrou comptable réouvrables par `PATCH /api/companies` | `accountingLockedUntil`, `closedFiscalYears`, `aiUsage`, `activatedAt` non modifiables |
| S3 | Compteurs des notes de frais calculés sur toutes les organisations | `await` manquant |
| S4 | Création de facture : champs internes acceptés (faux QR SECeF, facture soldée sans paiement, vente en 419…) | Liste blanche |
| S5 | Références d'une autre organisation acceptées et affichées | Contrôle d'appartenance : client du devis, client / équipe / responsable / factures / contrats d'un projet, chapitre d'une recette, salarié d'une note de frais. Lien devis → marché et preuve d'acceptation non modifiables. Ancienne route de conversion devis → facture supprimée |
| S6 | Code d'accès au portail fournisseur écrit par le formulaire ; RIB changé sans trace | Champs protégés ; changement de RIB journalisé avant / après |
| S7 | Dépassement du solde de congés décidé par le demandeur ; suppression de congés approuvés | Réservé à un valideur, dans son périmètre ; un congé commencé s'annule, il ne s'efface pas |
| S8 | Recherches : expression régulière non échappée (erreur 500, ReDoS) | `escapeRegex` |
| S9 | Exports CSV : injection de formule | `lib/csv.ts` : apostrophe devant `= + - @` (nombres préservés), retirée à la réimportation |
| S10 | Secret cron dans l'URL | Refusé sauf `CRON_ALLOW_URL_KEY=true` ; en-tête `x-cron-key` |
| S11 | Déconnexion mobile sans révocation | Identifiant `jti` sur chaque jeton, révocation à la déconnexion (`RevokedToken`, TTL) |
| K4 | Arrêté de caisse : libellé injecté dans la fenêtre d'impression | Échappement HTML |

Les recettes de l'administration ne journalisent plus les données des
contribuables en console. Scénario `scripts/e2e/e2e-securite.mjs`
(21 vérifications).

**À vérifier au déploiement** : si la tâche planifiée Hostinger appelle
`/api/cron?…&key=…`, passer à l'en-tête `x-cron-key` ou définir
`CRON_ALLOW_URL_KEY=true`.

## Lot G1 — Paie conforme CNSS 2024 et CGI 2026 (octobre 2026)

Référentiel et sources : `docs/REFERENTIEL-FISCAL-SOCIAL-2026.md`.

| Avant | Maintenant |
|---|---|
| CNSS 3,6 % + 16,4 %, sans plafond | **5,25 % + 17,40 %** (PF 4,90 · AT 1,75 · pensions 9,75 · ANPE 1,00), assiette plafonnée à **500 000 FCFA/mois**, relevée au SMIG |
| Stagiaires : aucune cotisation | **16,75 %** (apprentis et stagiaires) ; fonctionnaires détachés **6,65 %** |
| « IR » : barème 0 à 30 % sur brut − CNSS | **ITS** (art. 143-150) : retraite ≤ 6 %, 17 % expatriés, assurance ≤ 20 000, **13 % frais professionnels**, **abattement familial 0 à 30 %**, base arrondie au millier, barème 1 % à 35 % |
| Pas d'avantages en nature | Forfaits de l'art. 144 (logement, véhicule…), soumis à la CNSS et à l'ITS, hors net |
| Primes toutes soumises | Option « frais non soumis » (mission, remboursement) |
| SMIG 41 000 | **30 047** (guide de l'employeur CNSS, juillet 2025) |
| Déclaration CNSS trimestrielle, échéance 10 jours, écran factice | Trimestrielle ou **mensuelle dès 20 salariés**, échéance **30 jours**, ventilation par branche, bordereau PDF, enregistrement |
| Aperçu de la fiche salarié ≠ bulletin ; ancienneté affichée « 0,04 % » | Même moteur que le bulletin ; taux en pourcentage |

**Paramètres datés** (`lib/paie-parametres.ts`) : un bulletin est calculé avec
les taux de SA période — avant 2024 (anciens taux Kanoo), 2024-2025 (CNSS 2024),
2026 (CNSS 2024 + ITS). Chaque bulletin fige les taux, l'assiette, la
ventilation et le détail de l'ITS appliqués : il se réimprime et se déclare à
l'identique. Les bulletins déjà émis ne changent pas.

Nouveaux champs de la fiche salarié (réservés à la paie) : charges de famille,
catégorie CNSS, avantages en nature, indemnité de dépaysement, primes
d'assurance. Alerte à la génération si le numéro CNSS manque (immatriculation
due sous 8 jours).

Tests : `__tests__/unit/fiscal.test.ts` (exemple de référence : 300 000 FCFA,
2 charges → ITS 27 000), scénario `scripts/e2e/e2e-paie.mjs` (31 vérifications).

## V1.8.0 — Septembre 2026

### Audit de la gestion des collaborateurs — sept trous

L'ossature était bonne : vingt-trois rôles, une matrice de droits sur quarante
ressources, et une revalidation en base à chaque requête — un changement de rôle
prend effet immédiatement, pas à l'expiration du jeton. Ce qui manquait relevait
de l'exploitation quotidienne.

| # | Constat | Conséquence |
|---|---|---|
| 1 | Le bouton « Inviter un utilisateur » n'avait pas d'`onClick` | **Aucun collaborateur ne pouvait être créé depuis l'interface** |
| 2 | Aucune route de changement de mot de passe | Un mot de passe attribué à la création était définitif |
| 3 | Aucune politique de robustesse | Un compte pouvait être créé avec le mot de passe « a » |
| 4 | Aucune garde anti-verrouillage | Le dernier administrateur pouvait se désactiver ; reprise en base seulement |
| 5 | `chef_projet_transversal` absent de l'enum Mongoose | Toute création avec ce rôle échouait en validation |
| 6 | Aucun rôle technique | L'intégrateur recevait un rôle d'administrateur, donc l'accès à la paie |
| 7 | Rattachement compte ↔ fiche salarié sans interface, et sans contrôle de tenant | Notes de frais remboursées sur une fiche étrangère |

**La politique retenue privilégie la longueur sur la composition.** Exiger une
majuscule, un chiffre et un symbole produit `Passw0rd!` : plus faible, long à
taper sur un clavier de téléphone, et systématiquement noté sur un papier collé
à l'écran. Douze caractères minimum, blocage de l'évident et de ce qui dérive de
l'identité — les trois sources de la quasi-totalité des mots de passe cassés.

Le mot de passe temporaire est engendré (jamais choisi par l'administrateur, qui
en met un qu'il connaît et le réutilise), dictable au téléphone — ni `0` ni `1`,
donc aucune confusion avec `o` et `i` —, et remplacé à la première connexion.

L'écran décrit chaque rôle par ce qu'il permet **et ce qu'il interdit**. Choisir
entre « pme approver » et « pme manager » sur la seule foi du nom revient à
tirer au sort, et une erreur ouvre ou ferme l'accès à la paie.

### Documents administratifs — la date de lancement, pas l'échéance

Alerter à l'expiration ne sert à rien. Une attestation de régularité fiscale qui
expire le 30 ne se renouvelle pas le 29 : il faut déposer, l'administration
instruit, et le délai se compte en semaines. **La colonne principale affiche la
date à laquelle il faut commencer.**

Quinze natures de documents avec leur délai d'instruction — RCCM, NIF,
attestations fiscale et CNSS, patente, agrément, assurance, bail, CDD,
autorisation de travail, carte grise, visite technique, caution bancaire. Ces
délais sont des points de départ à ajuster : l'expérience réelle d'une
organisation avec une administration donnée vaut mieux qu'un défaut générique.

Le message dit quoi faire et quand : « à lancer maintenant, 21 jours
d'instruction pour une échéance dans 25 jours » plutôt que « expire dans
25 jours ». Une démarche engagée fait taire l'alerte — c'est l'administration
qu'on attend — mais elle reparle à moins d'une semaine, un dossier pouvant
dormir sur un bureau.

### Inventaire physique — aveugle, figé, valorisé au coût

**Le comptage est aveugle par défaut.** Devant « théorique 48 », on compte 48 :
l'écart réel disparaît, et avec lui la seule raison de compter. Le théorique ne
quitte même pas le serveur pendant le comptage — le masquer à l'écran ne
servirait à rien, il suffirait d'ouvrir l'inspecteur.

**Le théorique est photographié à l'ouverture**, sans quoi une vente saisie
pendant le comptage transforme un stock juste en écart.

**L'écart se valorise au coût**, reconstitué en moyenne pondérée sur les entrées
(le CUMP du SYSCOHADA). Le modèle Produit ne porte qu'un prix de vente :
valoriser un manquant au prix de vente compterait comme perdue une marge jamais
gagnée. Sans historique, la ligne reste hors de l'écriture — écrire un montant
deviné serait pire que ne rien écrire.

Excédents et manquants ne se compensent pas : compenser masquerait un vol de
trente unités derrière une erreur de saisie de trente autres.

### Budget prévisionnel — comparé au prorata

Comparer trois mois de réalisé à un budget annuel donne toujours l'impression
d'être sous contrôle. La comparaison se fait contre la part du budget
correspondant au temps écoulé, et le mois en cours ne compte pas : confronter
trois semaines de réalisé à un mois entier de budget ferait paraître chaque
poste en avance sur ses dépenses.

Quatre profils de saisonnalité, dont un « saison sèche » où l'hivernage arrête
les chantiers. Un budget en douzièmes égaux produit une alerte tous les mois
creux et un faux calme tous les mois pleins.

Le réalisé vient des écritures comptables, rapproché par préfixe de compte. Un
budget adossé à un autre total que celui du grand livre finit par diverger.
Dépasser une ligne de charges est une mauvaise nouvelle, dépasser une ligne de
produits en est une bonne : un tableau qui peint les deux en rouge apprend à ne
plus regarder les couleurs.

## V1.7.0 — Septembre 2026

### Trois espaces, trois identités

Kanoo sert trois métiers qui n'ont ni le même tempo, ni le même rapport à
l'autorité, ni les mêmes gestes.

| | Couleur | Formes | Mouvement | Densité |
|---|---|---|---|---|
| **Entreprise · Harmattan** | Ambre sur papier chaud | Angles francs | Ressort court | Compacte |
| **Communauté · Baobab** | Acacia sur papier crème | Très arrondies | Décélération douce, aucun rebond | Aérée |
| **Public · Ténéré** | Indigo sur papier froid | Angles nets, aucune ombre | Réduit au nécessaire | Tabulaire |

L'identité tient dans quatre familles de variables redéfinies par `data-space`
sur la coque. **Aucun des cent trente écrans n'a une ligne à changer.** Les
accents de section se déclinent dans la famille de leur espace : un onglet
« Finance » n'a pas la même teinte chez une association que dans une
administration.

Le site vitrine s'en sert : les cartes de profil portent `data-space` et se
rendent donc dans l'identité réelle de leur espace, à partir des mêmes tokens
que l'application. Le visiteur ne lit pas que le produit s'adapte à son métier,
il le voit.

### Pièces jointes — la porte était grande ouverte

Le téléversement écrivait dans `public/uploads/`, que Next sert en statique
**sans passer par la moindre autorisation**. Un bulletin de paie, un contrat, un
justificatif devenaient lisibles par quiconque connaissait l'URL, y compris hors
de l'organisation. Le nom en UUID rendait la devinette difficile ; il ne
remplaçait pas un contrôle d'accès, et une URL fuit par un courriel transféré ou
un en-tête `Referer`.

Deux documents clients réels étaient de surcroît **versionnés** sous
`public/uploads/` depuis le commit `b151dfa`, donc déjà sur `origin/main`. Ils
sortent du suivi ; leur purge de l'historique reste à décider.

Le nouveau socle : stockage hors de `public/`, adressé par empreinte SHA-256 —
le même justificatif joint deux fois ne pèse qu'une. Validation en trois temps :
extension interdite (un SVG est un document exécutable), type inconnu, puis
concordance des octets de tête — un `.pdf` qui commence par `<script` n'est pas
un PDF. Le droit d'accès est celui du **document porteur** : lire la pièce d'un
contrat exige le droit de lire les contrats. Sortie unique par
`/api/attachments/:id`, en téléchargement forcé.

Un panneau réutilisable est branché sur les contrats, les contrats d'abonnement
fournisseur, les factures et les projets.

### Notes de frais et capture des justificatifs

Le geste réel : on photographie le reçu au comptoir. `capture="environment"`
ouvre l'appareil photo arrière directement — réclamer un fichier trois jours plus
tard, c'est réclamer un reçu déjà perdu.

**Bloquant** : une dépense sans justificatif quand sa nature l'exige, une TVA
récupérée sans facture, un objet manquant, une devise sans taux.
**Signalé seulement** : un dépassement de plafond, une dépense ancienne. Bloquer
un dépassement pousserait le salarié à reclasser sa dépense dans une autre
nature — on perdrait la dépense réelle *et* le contrôle.

La TVA non récupérable **reste dans la charge**. La sortir sans la déduire ferait
disparaître du résultat une dépense réellement supportée : c'est l'erreur
classique sur les frais de restauration.

Aucun barème kilométrique par défaut. Le Niger n'en publie pas ; en inventer un
ferait passer un chiffre arbitraire pour une référence opposable.

Personne n'approuve sa propre note, y compris un administrateur. Une note
approuvée ne redevient pas brouillon : elle a produit une écriture, l'annuler
suppose une contre-passation.

### Relevé de compte client

`Client.currentBalance` reproduisait le défaut du solde de trésorerie : mis à
zéro à la création, protégé en écriture, incrémenté par aucune route. La colonne
« Solde actuel » affichait donc **zéro pour tout le monde**, y compris pour un
client devant plusieurs millions.

Le relevé donne la suite des mouvements qui mènent au solde, avec un solde
courant après chacun — un solde sans son chemin ne se conteste pas, il se subit.
Trois pièges évités : le solde d'ouverture porte sur tout l'antérieur ; les
avoirs se retranchent ; à date égale, la facture précède le règlement qui
l'éteint, faute de quoi un paiement comptant affiche un solde négatif
transitoire. L'ancienneté se lit pièce par pièce. Le PDF passe par le même
moteur que l'écran.

### Vitrine

Trois témoignages nominatifs — noms, fonctions, organisations, chiffres —
étaient inventés. Ils cèdent la place à ce qui se vérifie. L'emplacement reste
ouvert pour de vrais clients, cités avec leur accord.

## V1.6.0 — Septembre 2026

### Relances clients : la chaîne qui manquait

`templateInvoiceReminder` et `smsFactureRelance` existaient depuis l'origine.
**Rien ne les appelait.** Le traitement de 06 h 30 notifiait les administrateurs
qu'une facture était échue ; le client, lui, n'était jamais relancé. Kanoo
constatait l'impayé sans rien faire pour le réduire.

**Un barème, pas un envoi en masse**

Cinq étapes par défaut, dont la première part **avant** l'échéance : c'est la
seule qui évite le retard au lieu de le constater, et la seule dont l'effet se
mesure sur le délai d'encaissement. Le ton monte ensuite sans jamais accuser —
un retard est le plus souvent administratif, et le message qui suppose la
mauvaise foi se retourne contre l'émetteur quand la facture dormait dans une
bannette.

**Ce qui ne part jamais tout seul**

- **La mise en demeure.** Elle engage juridiquement. Le barème peut la rendre
  due ; elle reste sur l'écran jusqu'à ce qu'un humain coche la ligne. Le job de
  nuit la saute, l'API refuse de la désactiver, un test le verrouille.
- **Rien, tant que l'organisation ne s'est pas prononcée.** `enabled` vaut
  `false` par défaut : la mise à jour n'écrit à personne.
- **Une facture en litige.** Réclamer ce que le client conteste transforme un
  désaccord sur une ligne en conflit sur la relation. Le litige s'ouvre depuis
  la facture, avec motif obligatoire.

**Le piège du premier jour, et sa correction**

Activer les relances sur un portefeuille déjà ancien est le moment où ce genre
de module fait le plus de dégâts : avec une logique de « première étape non
envoyée », un client qui traîne depuis six mois reçoit le rappel de courtoisie,
puis la relance à J+3, puis celle de J+10 — un message tous les cinq jours pour
une facture unique. Le moteur retient **l'étape la plus avancée parmi celles
échues** et clôt les précédentes comme dépassées. Une facture, un message.

**Pas de doublon, même en cas de rejeu**

La trace est écrite **avant** l'envoi, sous un index d'unicité
(organisation, facture, étape). Un cron dupliqué sur deux machines, un serveur
relancé, une exécution manuelle lancée pendant l'automatique : la seconde
écriture est rejetée par la base. Le prix est assumé et symétrique — un envoi
en échec laisse une trace `failed` et ne repart pas seul, parce qu'une adresse
qui rejette doit être vue, pas retentée en boucle.

**L'écran dit aussi ce qui ne part pas**

L'aperçu appelle le même moteur que le job de nuit — pas de promesse à l'écran
démentie au réveil. Il montre les relances prêtes, celles en attente de
validation, et **la liste des factures écartées avec leur motif** : sous le
seuil, sans coordonnées, déjà relancée, en litige. Une campagne silencieusement
partielle qu'on croit complète est pire qu'une campagne annulée.

**Mesures ajoutées** : balance âgée par tranche d'ancienneté, et délai moyen de
règlement pondéré par les montants — dix petites factures payées comptant ne
compensent pas une grosse à quatre-vingt-dix jours, ce que dit pourtant une
moyenne simple. Sans donnée exploitable, l'indicateur affiche « — » plutôt que
« 0 jour », qui se lirait comme un paiement comptant généralisé.

**Au passage** : `EmailPayload` accepte enfin une copie invisible, câblée aux
deux fournisseurs (Brevo et SMTP), pour que l'équipe garde la trace des
courriers partis sans exposer une adresse interne au client.

## V1.5.0 — Septembre 2026

### Rapprochement bancaire, et un solde de trésorerie qui existe vraiment

**Le défaut d'origine.** `TreasuryAccount.balance` était un nombre saisi à la
création du compte. Deux routes le décrémentaient — le versement d'un bulletin
de paie et l'exécution d'une charge récurrente. **Aucune ne l'augmentait**, pas
même l'encaissement d'une facture. Le solde affiché baissait donc à chaque
salaire versé et ne remontait jamais. Les deux écritures se faisaient en outre
par `findByIdAndUpdate` sans filtre de tenant : un identifiant de compte
appartenant à une autre institution était accepté sans broncher.

**Le solde n'est plus stocké, il est calculé.** Solde d'ouverture déclaré à une
date connue, plus la somme des mouvements. Un test structurel refuse désormais
toute réintroduction d'une écriture sur `balance` — c'est le réflexe qu'on a en
voulant « corriger un solde », et c'est ce qui a créé le problème.

**Ce qui alimente le solde**

- `TreasuryMovement` : tout encaissement ou décaissement, signé, rattaché au
  document qui l'a produit. Créé **dans la transaction** du règlement, de la
  paie ou de la dépense : un document écrit sans son mouvement produirait un
  écart permanent que plus rien ne saurait expliquer.
- Le formulaire de règlement demande le compte encaissé. Un seul compte
  configuré : il est pré-rempli. Plusieurs : rien n'est choisi à votre place —
  un encaissement imputé au mauvais compte se paie au rapprochement du mois
  suivant. Ne rien désigner reste possible, avec l'avertissement explicite que
  le règlement n'apparaîtra sur aucun solde.

**Le rapprochement**

- Import d'un relevé CSV, **colonnes désignées par vous**, jamais devinées :
  deux banques n'exportent pas le même fichier, et une détection qui se trompe
  de colonne importe des montants faux sans le dire. Les lignes inexploitables
  vous sont rendues avec leur numéro et le motif — une ligne perdue en silence
  devient un écart inexpliqué trois semaines plus tard.
- Réimporter un relevé déjà chargé ne duplique rien : chaque ligne porte une
  empreinte sous index d'unicité. Un fichier qui recouvre partiellement le
  précédent n'ajoute que ce qui manque.
- Propositions d'appariement sur montant identique et date proche (±5 jours),
  avec les indices qui les motivent. **Le montant est éliminatoire**, y compris
  sur un appariement manuel : deux opérations de montants différents ne sont pas
  la même, et laisser passer ferait disparaître un écart réel de l'écran.
  Chaque proposition reste à valider ; rien ne se rapproche tout seul.
- Écarter une ligne exige un motif. Sans motif, l'écart reste inexpliqué.
- L'écran montre les deux colonnes qui comptent : ce qui est enregistré chez
  vous et que la banque n'a pas encore passé, et ce que la banque a passé et que
  rien n'explique chez vous. L'écart entre les deux soldes est l'information
  utile — il est affiché, pas masqué.

**Un compte sans relevé importé le dit.** Le solde affiché est alors le solde
d'ouverture et ne prouve rien ; l'écran l'annonce plutôt que de laisser croire
à une concordance.

## V1.4.0 — Septembre 2026

### Unification des modules transverses

Kanoo servait trois profils par trois arborescences séparées. Le choix se
défend pour les écrans propres à chaque métier — un chapitre budgétaire n'a de
sens que dans le public. Il ne se défendait plus pour les modules identiques.

**Projets : neuf écrans deviennent un**

Les trois implémentations appelaient **la même route API**, écrivaient dans
**le même modèle**, et ne différaient que par un littéral (`projectType:
"ong"` ou `"public"`). Coût : 1 239 lignes à maintenir en triple, et trois
endroits où corriger le même défaut — ce qui veut dire deux endroits oubliés.

- Le vocabulaire vit désormais dans `lib/vocabulary.ts` : « bailleur » pour une
  ONG, « maître d'ouvrage » pour une administration, « client » pour une PME.
  Le profil est lu **côté serveur** depuis le jeton : pas d'appel réseau
  supplémentaire, pas de clignotement du vocabulaire au chargement.
- La seule vraie différence de comportement — la source des personnes
  assignables — est paramétrée : une association affecte des membres du bureau,
  une entreprise des collaborateurs.
- **Les PME y gagnent des fonctions.** Leur fiche projet faisait 105 lignes
  sans tâches, sans documents, sans messagerie ; celle des associations en
  faisait 454 avec tout cela, pour exactement les mêmes données. L'unification
  se fait vers le haut.

**Documents et personnel**

`/administration/personnel` et `/associations/documents` tapaient déjà les
routes `/api/employees` et `/api/documents`. Ils redirigent vers les écrans
uniques ; les libellés propres à chaque profil sont conservés dans la
navigation.

**Redirections plutôt que suppressions**

Les anciennes routes sont maintenues en redirection, identifiant compris : des
notifications déjà envoyées et des favoris pointent encore dessus.

**Garde-fou**

Deux tests structurels refusent une nouvelle duplication et vérifient que les
anciennes routes redirigent toujours. Les portails externes — adhérent,
fournisseur — sont hors périmètre : autre authentification, autre public, autre
sous-ensemble de données.

**Bilan**

−1 349 lignes, +172. 266 tests au vert, 0 erreur de type, 0 erreur de lint,
build de production réussi.

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
