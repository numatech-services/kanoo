# API du comptoir pour EasyPay (v1)

EasyPay est la caisse, le système de cartes et l'appli des étudiants de The Spot (Numatech). Kanoo tient la comptabilité, le stock et la caisse du comptoir. Cette API relie les deux. Le connecteur côté EasyPay est décrit dans `docs/kanoo.md` du dépôt `easypay-caisse`.

## Qui fait foi

- **Kanoo fait foi pour les articles et les prix.** EasyPay les lit (`GET /catalogue`).
- **EasyPay fait foi pour ce qui s'est passé à la caisse.** Il envoie (`POST /events`) :
  - les ventes et leurs annulations ;
  - les recharges de carte encaissées en espèces au comptoir ;
  - les réceptions, pertes et inventaires ;
  - les états des pré-commandes.
- **Numatech détient l'argent des cartes.** Les deux mouvements suivants passent par le compte courant **467100 « EasyPay (Numatech) »** :
  - une vente payée par carte (solde ou QR) est une créance du comptoir sur Numatech ;
  - une recharge encaissée en espèces au comptoir est de l'argent dû à Numatech, pas une recette.

  Les reversements soldent ce compte ; on les enregistre dans l'onglet EasyPay du comptoir.
- **Aucune donnée personnelle :** EasyPay n'envoie que le profil tarifaire (étudiant, personnel, visiteur).

## Clé

On la crée depuis le comptoir, onglet **EasyPay** (réservé au chef du comptoir et à la finance) :
- format `kno_…`, montrée une seule fois ;
- seule son empreinte est gardée ;
- liée au comptoir, droits `spot:read` et `spot:write` ;
- valable 2 ans, révocable.

Les écritures sont faites au nom de la personne qui a créé la clé. Si son compte est désactivé, la clé n'écrit plus rien. Les appels sont limités à 600 par minute et par clé.

La route `POST /api/v1/auth` (clés générales de l'organisation) est désormais :
- réservée à qui administre l'entreprise ;
- protégée contre le CSRF ;
- limitée aux droits `invoices:read` et `clients:read`.

## Appels (`/api/v1/spot`, `Authorization: Bearer kno_…`)

| Appel | Rôle |
|---|---|
| `GET /status` | Comptoir de la clé, nombre d'événements en échec, dernier reçu. |
| `GET /catalogue` | Articles : `id`, `easypay_id`, `name`, `category`, `unit`, `price`, `archived`, `stock`, `low_stock_threshold`, `prepared`. ETag : avec `If-None-Match`, répond 304 tant que rien n'a changé. |
| `POST /catalogue/link` | `{ items: [{ id, name, category?, price?, kanoo_id? }], create_missing }`. Relie les articles par id Kanoo, puis par id EasyPay, puis par nom ; crée les absents si demandé. |
| `POST /events` | `{ events: [...] }`, 100 au plus, 2 Mo au plus. Un résultat par événement. |
| `GET /production?day=AAAA-MM-JJ` | Quantités à préparer (demain par défaut) : `forecast` (emploi du temps du campus), `preordered`, `planned`. |

### Événements

Chaque événement a la forme `{ id, type, occurred_at, data }`. L'`id` fait de 8 à 64 caractères `[A-Za-z0-9_-]` et n'est écrit qu'une fois, même renvoyé. Les montants sont en francs entiers.

| type | data |
|---|---|
| `sale` | `sale_id`, `number?`, `profile?`, `lines: [{ item, quantity, unit_price, components? }]`, `payments: [{ method: cash \| card \| balance \| mobile_money, amount }]` |
| `sale_void` | `sale_id`, `reason?` |
| `topup` | `topup_id`, `amount`, `method: cash` |
| `stock_movement` | `movement_id`, `kind: receipt \| loss \| count`, `item`, `quantity` ou `counted_quantity`, `reason?` |
| `preorder` | `order_id`, `status: booked \| ready \| picked_up \| cancelled \| no_show`, `pickup_day`, `lines: [{ item, quantity }]`, `amount?` |

`item` a la forme `{ id (EasyPay), name, kanoo_id?, category? }`. Une formule est une ligne avec ses `components` : ils sortent du stock, et le coût de la ligne est leur somme.

### Résultats

| Statut | Sens |
|---|---|
| `applied` | Écrit dans Kanoo. |
| `duplicate` | Déjà reçu, rien de plus n'est écrit. |
| `failed` | Refusé par une règle de Kanoo, par exemple une annulation dont la vente n'est pas encore arrivée. Gardé et rejouable depuis l'onglet EasyPay : à ne pas renvoyer. |
| `rejected` | Illisible : à corriger à la source. Le responsable peut l'écarter. |

### Ce que Kanoo en fait

- **`sale`**
  - Crée un ticket au prix de la caisse.
  - Un stock insuffisant ne bloque pas : le stock est ramené à 0 et l'écart est signalé.
  - Un article inconnu est créé (stock 0, sans coût, à compléter).
  - Écriture :
    - espèces : débit de la caisse ;
    - carte : débit du 467100 ;
    - mobile money : débit du compte mobile money ;
    - au crédit : les ventes.
  - Si la journée est déjà arrêtée, le ticket passe au premier jour ouvert ; l'heure réelle est gardée dans `occurredAt`.
- **`sale_void`** : annule le ticket (stock rendu, écriture extournée).
- **`topup`** : entrée d'espèces dans le tiroir (catégorie `easypay_topup`), avec l'écriture caisse au débit et 467100 au crédit. Le bilan de la semaine l'affiche à part, hors recettes.
- **`stock_movement`** :
  - réception au coût courant de l'article ;
  - perte avec motif (cassé, périmé, offert, personnel, sinon manquant) ;
  - inventaire : le stock compté fait foi.
- **`preorder`** : tant qu'une pré-commande est réservée ou prête, le plan de production prépare au moins la quantité commandée. Un état plus ancien, arrivé en retard, n'écrase pas un état plus récent.

## Mise en production

- Lancer `npm run indexes` : il crée les index uniques de `ApiKey`, `IntegrationEvent`, `DeskPreorder` et `ActivityItem.easypayId`.
- Créer la clé dans Kanoo, puis lancer `easypay:kanoo-link` sur le serveur EasyPay.

## Liaison réseau (contrat 1.1, `_easypay`)

Contrat : `docs/EASYPAY-KANOO-CONTRAT-V1.1.md` (§13, copie de `docs/kanoo-contrat-v1.1.md` d'easypay-serveur, PR #69).
Recharges et versements des agents, commissions sur les commandes des partenaires, reversements aux assureurs et à
l'opérateur télécom, bilan du jour du réseau. Ce qui n'appartient à aucun restaurant.

- Adresse de base : `https://<kanoo>/api/v1/easypay` (`/handshake`, `/events`), en-tête `X-EasyPay-Site: _easypay`.
- Clé : Paramètres → API, droit **`easypay:network`** seul (il ne se combine avec aucun autre droit ; aucun comptoir).
  La poignée de main d'un restaurant refuse `_easypay`, et l'adresse d'un restaurant refuse (422) les types du réseau. La transmettre à Mansour par un canal sûr ; il
  relie sur le VPS : `deploy/bin/kanoo-link.sh _easypay <adresse>`. **Déployer Kanoo avant de faire la liaison** : un
  Kanoo qui ne connaît pas ces types les ignore et EasyPay les compte comme reçus.
- Suivi : Pilotage → EasyPay réseau (gérant, comptabilité). Pas d'écriture comptable automatique : comptes de la
  monnaie électronique (soldes étudiants), des agents et des partenaires à fixer avec la comptable (non vérifié).
- Encours d'un agent affiché = recharges − versements ; les retraits payés par les agents ne sont pas transmis en 1.1.
- Chaque événement est enregistré en une transaction (trace, objet, rang) ; contrôles : frais ≤ recharge, reste dû ≤
  part du partenaire, jour réel, état cohérent avec le type.
- Rapprochement par Kanoo : pour chaque bilan du jour, les faits reçus (nombre et francs) sont comparés aux blocs du
  bilan d'EasyPay ; les rangs de la file jamais acceptés (refusés ou perdus) sont comptés à l'écran.
