# Liaison EasyPay → Kanoo — contrat d'interface, version 1

Écrit le 30 octobre 2026 pour le développeur de Kanoo (CRM de Numatech,
hébergé chez Hostinger). EasyPay campus (le serveur de paiement des
restaurants universitaires du Niger) envoie à Kanoo l'activité financière de
chaque restaurant relié, au fil de l'eau, et chaque nuit le bilan du jour
clos, pour Mansour et le comptable.

Le code de Kanoo n'est pas connu d'EasyPay : **ce document est le contrat**.
Kanoo implémente deux adresses (§4 et §5) ; EasyPay fait tout le reste
(file d'envoi durable, ordre, reprises, renvois).

| Version | Date | Changements |
|---|---|---|
| 1 | 30 octobre 2026 | Première version |

Sommaire : 1. Principes · 2. Adresses · 3. Authentification et signature ·
4. Poignée de main · 5. Événements · 6. Bilan du jour · 7. Livraison,
reprises, idempotence, ordre · 8. Réponses attendues de Kanoo ·
9. Données personnelles · 10. Évolutions du contrat · 11. Recette ·
12. Côté EasyPay (exploitation).

## 1. Principes

- **Sens unique** : EasyPay appelle Kanoo ; Kanoo n'appelle jamais EasyPay.
- **Une liaison par restaurant** (un « site » d'EasyPay, ex. `the-spot`) :
  Kanoo donne pour chaque restaurant une **adresse de base** et un **jeton
  API**. EasyPay tire un **secret de signature** propre à la liaison et le
  remet à Kanoo dans la poignée de main.
- **Rien ne se perd** : chaque fait est écrit dans la file d'EasyPay dans la
  même transaction que la vente elle-même ; il part quand Kanoo répond,
  quel que soit le temps que Kanoo reste injoignable.
- **Chaque événement une fois** : il porte un identifiant (`event_id`, UUID)
  qui ne change jamais ; un renvoi porte le même identifiant et les mêmes
  octets. Kanoo garde **un** événement par `event_id`.
- **Dans l'ordre, par restaurant** : `sequence` part de 1 et augmente de 1
  à chaque événement du restaurant ; EasyPay n'envoie un événement qu'une
  fois le précédent reçu par Kanoo (ou mis de côté, §7).
- **Montants en francs CFA entiers** (`*_amount`, entiers, jamais de
  décimales). **Heures** en ISO 8601 avec le décalage de Niamey
  (`2026-10-29T12:03:11+01:00`) ; **jours** `AAAA-MM-JJ` du calendrier de
  Niamey (UTC+1 toute l'année).
- **JSON UTF-8**, objets dont l'ordre des clés n'a pas de sens ; Kanoo
  **ignore les champs qu'il ne connaît pas** (§10).

## 2. Adresses

L'adresse de base est celle que Kanoo donne pour le restaurant, en
`https://`, sans paramètre. Pour The Spot :

```
https://numapilot.numatechservices.net/api/v1/spot
```

EasyPay appelle, sous cette base :

| Méthode | Chemin | Rôle |
|---|---|---|
| `POST` | `{base}/handshake` | poignée de main, à la liaison (§4) |
| `POST` | `{base}/events` | un événement par requête (§5, §6) |

Aucune redirection n'est suivie (une réponse 3xx compte comme un refus).
Délai : EasyPay attend la réponse **10 secondes** au plus (connexion :
5 s). Kanoo répond vite et traite ensuite si besoin.

## 3. Authentification et signature

Chaque requête porte :

| En-tête | Valeur |
|---|---|
| `Authorization` | `Bearer <jeton API donné par Kanoo pour ce restaurant>` |
| `Content-Type` | `application/json; charset=utf-8` |
| `Accept` | `application/json` |
| `User-Agent` | `EasyPay-Kanoo/1` |
| `X-EasyPay-Spec-Version` | `1` |
| `X-EasyPay-Site` | identifiant du restaurant chez EasyPay (`the-spot`) |
| `X-EasyPay-Signature` | `t=<secondes Unix>,v1=<signature>` |

En plus, pour `POST {base}/events` :

| En-tête | Valeur |
|---|---|
| `Idempotency-Key` | l'`event_id` de l'événement |
| `X-EasyPay-Event-Id` | l'`event_id` |
| `X-EasyPay-Event-Type` | le `type` (`sale.recorded`…) |
| `X-EasyPay-Sequence` | la `sequence` |
| `X-EasyPay-Attempt` | numéro de l'essai (1, 2…) |
| `X-EasyPay-Replay` | `1` si l'événement est renvoyé à la demande d'EasyPay (§7), sinon `0` |

**Signature** : HMAC-SHA256, en hexadécimal minuscule (64 caractères), de
la chaîne `<t>.<corps brut de la requête>` (le nombre `t` de l'en-tête, un
point, puis les octets du corps tels que reçus), avec pour clé le **secret
de signature** de la liaison, pris tel quel comme chaîne de 64 caractères
(ne pas le décoder de l'hexadécimal).

Kanoo doit, à chaque requête :

1. vérifier le jeton (il désigne le restaurant ; il doit correspondre à
   `X-EasyPay-Site`) ;
2. recalculer la signature sur le corps **brut** (avant tout décodage JSON)
   et la comparer en temps constant ;
3. refuser un `t` écarté de plus de **300 secondes** de son horloge (rejeu) ;
4. sinon répondre `401`.

Exemple (PHP) :

```php
[$t, $sig] = sscanf($_SERVER['HTTP_X_EASYPAY_SIGNATURE'], 't=%d,v1=%s');
$raw = file_get_contents('php://input');
$ok = abs(time() - $t) <= 300
    && hash_equals(hash_hmac('sha256', $t.'.'.$raw, $secretDuRestaurant), $sig);
```

Kanoo garde le jeton et le secret **chiffrés**, ne les écrit dans aucun
journal, et remplace le secret à chaque poignée de main réussie du
restaurant.

## 4. Poignée de main — `POST {base}/handshake`

Faite à chaque liaison (ou nouvelle liaison) d'un restaurant. Tant que
Kanoo n'y répond pas comme ci-dessous, **rien n'est enregistré chez
EasyPay** et rien n'est envoyé.

Requête (signée avec le **nouveau** secret, qu'elle contient) :

```json
{
  "spec_version": "1",
  "type": "handshake",
  "site": { "id": "the-spot", "name": "The Spot" },
  "signing_secret": "9f2c4e…64 caractères hexadécimaux…a1",
  "challenge": "3b7f0c2d9a8e4f6b1c5d7e9f0a2b4c6d",
  "sent_at": "2026-10-30T10:15:02+01:00"
}
```

Kanoo vérifie le jeton, enregistre `signing_secret` pour ce restaurant
(il remplace l'ancien), vérifie la signature avec lui, puis répond
**`200`** :

```json
{
  "ok": true,
  "spec_version": "1",
  "challenge_response": "<HMAC-SHA256 hexadécimal de challenge, clé signing_secret>"
}
```

soit `hash_hmac('sha256', $challenge, $signing_secret)`. Toute autre
réponse (autre code, `ok` absent, preuve fausse, autre `spec_version`) fait
échouer la liaison côté EasyPay, sans rien changer. `401`/`403` : jeton
refusé ; `404` : adresse inconnue.

## 5. Événements — `POST {base}/events`

Un événement par requête. Enveloppe commune :

```json
{
  "spec_version": "1",
  "event_id": "0f8e2c1a-5b3d-4e7f-9a1b-2c3d4e5f6a7b",
  "type": "sale.recorded",
  "sequence": 42,
  "site": { "id": "the-spot", "name": "The Spot" },
  "occurred_at": "2026-10-29T12:03:11+01:00",
  "business_date": "2026-10-29",
  "recorded_at": "2026-10-29T12:03:12+01:00",
  "data": { … }
}
```

| Champ | Sens |
|---|---|
| `event_id` | identifiant unique et définitif (clé d'idempotence) |
| `type` | voir le tableau ci-dessous |
| `sequence` | rang dans la file du restaurant, 1, 2, 3… sans trou (sauf §7) |
| `occurred_at` | quand le fait a eu lieu (heure de la caisse pour une vente, du changement pour une commande) |
| `business_date` | le jour sous lequel les rapports d'EasyPay le comptent (une annulation : le jour de sa vente ; une commande : le jour où elle a été passée) |
| `recorded_at` | quand EasyPay l'a mis dans sa file |

Types de la version 1 :

| `type` | Quand |
|---|---|
| `sale.recorded` | une vente enregistrée par une caisse du restaurant (carte, QR, espèces, mobile money ; en ligne ou servie hors ligne) |
| `sale.voided` | une vente annulée (le solde de l'étudiant recrédité s'il avait payé ainsi) |
| `topup.recorded` | une recharge de solde en espèces au comptoir du restaurant |
| `drawer.opened` | le tiroir-caisse ouvert sans vente |
| `order.placed` | une commande ou réservation passée (appli étudiant, caisse) |
| `order.updated` | une commande qui change : statut, payé, remboursé, remboursement en espèces dû ou rendu, jour de retrait |
| `day.closed` | le bilan du jour clos (§6) |

**Modes de paiement** (`payments[].method`) : `card` = payé sur le **solde
EasyPay** de l'étudiant (par sa carte ou son QR) ; `cash` = espèces ;
`mobile_money` = mobile money (pas encore ouvert). Une commande de l'appli
dit `payment` : `balance` (solde, à la commande), `cash_on_pickup`
(espèces au retrait), `cash` ou `card` (réservation payée à la caisse).

### `sale.recorded`

```json
"data": {
  "sale_id": "01a18a27-f8c0-7b21-9d55-1c2e3f4a5b6c",
  "ticket_number": 118,
  "till_id": "spot-k1",
  "service_id": "2026-10-29-dejeuner-spot-k1",
  "cashier_id": "spot-u2",
  "channel": "till",
  "order_id": null,
  "price_category": "student",
  "mode": "online",
  "catalogue_version": 14,
  "total_amount": 1400,
  "card_amount": 800,
  "debited_amount": 800,
  "cash_amount": 600,
  "mobile_money_amount": 0,
  "payments": [
    { "method": "card", "amount": 800 },
    { "method": "cash", "amount": 600 }
  ],
  "offline": { "accepted_offline": false, "issue": null, "loss_amount": 0 },
  "voided_before_arrival": false,
  "lines": [
    { "kind": "formula", "ref_id": "f-ameliore", "label": "Formule améliorée", "quantity": 1,
      "unit_price_amount": 800, "amount": 800,
      "component_labels": ["Riz au gras et poulet", "Salade de fruits", "Jus de bissap"] },
    { "kind": "item", "ref_id": "kilichi", "label": "Kilichi", "quantity": 1,
      "unit_price_amount": 500, "amount": 500, "component_labels": [] },
    { "kind": "item", "ref_id": "eau-50", "label": "Eau minérale 50 cl", "quantity": 1,
      "unit_price_amount": 100, "amount": 100, "component_labels": [] }
  ],
  "customer_ref": "c_5d41402abc4b2a76b9719d91"
}
```

| Champ | Sens |
|---|---|
| `service_id` | la session de caisse (le service d'un caissier sur une caisse) |
| `cashier_id`, `till_id` | identifiants EasyPay du caissier et de la caisse (pas de nom) |
| `price_category` | profil tarifaire : `student`, `staff`, `visitor` |
| `mode` | `online` (vérifiée par le serveur) ou `degraded` (servie sans réseau, débitée à l'arrivée) |
| `card_amount` | ce qui était dû sur le solde ; `debited_amount` : ce qui a été réellement pris |
| `offline.issue` | vente servie hors ligne que le serveur n'a pas pu débiter normalement : `overdraft` (débitée, solde négatif), `card_blocked`, `card_unknown`, `offline_not_allowed`, `offline_cap_exceeded`, `offline_too_old`, `offline_in_future`, `other_university` ; `loss_amount` = perte pour le restaurant (`card_amount − debited_amount`) |
| `voided_before_arrival` | la caisse a annulé la vente avant que le serveur la reçoive (client refusé) : rien n'a été débité |
| `lines[].kind` | `item` (article) ou `formula` (formule, ses choix dans `component_labels`) |
| `customer_ref` | pseudonyme du client (§9), `null` sans carte (espèces) |

### `sale.voided`

```json
"data": {
  "void_id": "01a18a28-0c11-7e3a-8a4b-5c6d7e8f9a0b",
  "sale_id": "01a18a27-f8c0-7b21-9d55-1c2e3f4a5b6c",
  "reason": "supervisor_cancellation",
  "supervisor_id": "spot-u1",
  "sale_known": true,
  "credited_amount": 800,
  "sale": { "occurred_at": "2026-10-29T12:03:11+01:00", "total_amount": 1400, "debited_amount": 800,
            "till_id": "spot-k1", "service_id": "2026-10-29-dejeuner-spot-k1" }
}
```

`reason` : `supervisor_cancellation` (annulée par un responsable) ou
`unconfirmed_refused` (réponse perdue, client refusé : la caisse annule ce
que le serveur aurait pu enregistrer). `credited_amount` : rendu au solde
de l'étudiant. `sale` est `null` si la vente n'était pas encore arrivée
(`sale_known: false`). La note libre du caissier n'est pas envoyée.

### `topup.recorded`

```json
"data": {
  "topup_id": "01a18a29-1d22-7f4b-9b5c-6d7e8f9a0b1c",
  "till_id": "spot-k1",
  "service_id": "2026-10-29-dejeuner-spot-k1",
  "cashier_id": "spot-u2",
  "amount": 2000,
  "tendered_amount": 5000,
  "change_amount": 3000,
  "charge_amount": 0,
  "commission_amount": 0,
  "customer_ref": "c_5d41402abc4b2a76b9719d91"
}
```

`amount` : crédité au solde de l'étudiant ; cet argent liquide est dans le
tiroir du restaurant **pour EasyPay** (§6, `settlement`). Le solde de
l'étudiant après la recharge n'est pas envoyé.

### `drawer.opened`

```json
"data": { "opening_id": "…", "till_id": "spot-k1", "service_id": "…",
          "cashier_id": "spot-u2", "approved_by": "spot-u1", "reason": "Monnaie" }
```

`approved_by` : le responsable qui a donné son PIN, `null` sinon.

### `order.placed` et `order.updated`

Même `data`, l'état de la commande **au moment de l'événement** :

```json
"data": {
  "order_id": "01a18a2a-2e33-7a5c-8c6d-7e8f9a0b1c2d",
  "number": "A-205",
  "channel": "app",
  "status": "handed_over",
  "payment": "balance",
  "price_category": "student",
  "placed_at": "2026-10-28T16:40:00+01:00",
  "pickup_date": "2026-10-29",
  "pickup_at": "2026-10-29T12:15:00+01:00",
  "handed_over_at": "2026-10-29T12:21:40+01:00",
  "no_show_at": null,
  "total_amount": 1000,
  "paid_amount": 1000,
  "refunded_amount": 0,
  "cash_refund_due_amount": 0,
  "cash_refunded_at": null,
  "till_id": null,
  "service_id": null,
  "cashier_id": null,
  "lines": [
    { "kind": "item", "ref_id": "premium-poulet", "label": "Poulet braisé (premium)", "quantity": 1,
      "unit_price_amount": 1000, "amount": 1000, "component_labels": [] }
  ],
  "customer_ref": "c_5d41402abc4b2a76b9719d91"
}
```

`status` : `received`, `preparing`, `ready`, `handed_over` (retirée),
`refused` (refusée par le restaurant), `cancelled` (annulée par
l'étudiant), `no_show` (réservation non retirée à la fin du service de son
jour). Kanoo **remplace** l'état de la commande par celui de l'événement de
plus grande `sequence` pour ce `order_id` (un renvoi plus ancien ne la fait
pas reculer). Une commande refusée puis remboursée dans la même opération
donne deux `order.updated` (refusée, puis remboursée). Les commandes
d'avant les lignes chiffrées (WhatsApp) ont `unit_price_amount` et `amount`
à `null`.

## 6. Bilan du jour — `type: "day.closed"`

Chaque nuit, **après minuit à Niamey** (dans l'heure), EasyPay envoie le
bilan du jour clos de chaque restaurant relié, **dans la même file**, après
tous les événements de ce jour. Ses chiffres sont **ceux des rapports du
back-office d'EasyPay** (Finances → Rapports), sur le restaurant et le jour :
Kanoo et EasyPay ne divergent jamais.

**Révisions** : une vente servie hors ligne arrive parfois le lendemain,
une commande est remboursée plus tard. Le bilan d'un jour déjà envoyé est
alors renvoyé avec `revision` 2, 3… (un nouvel `event_id`). Kanoo garde,
par restaurant et `business_date`, le bilan de plus grande `revision`.

```json
"data": {
  "business_date": "2026-10-29",
  "timezone": "Africa/Niamey",
  "revision": 1,
  "generated_at": "2026-10-30T00:05:03+01:00",
  "period": { "from": "2026-10-29T00:00:00+01:00", "to": "2026-10-30T00:00:00+01:00" },
  "sales": {
    "sales_count": 312, "total_amount": 241500, "card_amount": 168200, "cash_amount": 73300,
    "mobile_money_amount": 0, "voids_count": 3, "voided_amount": 2100, "net_amount": 239400
  },
  "sales_by_till": [
    { "till_id": "spot-k1", "label": "The Spot · Caisse 1", "sales_count": 312, "total_amount": 241500, "card_amount": 168200,
      "cash_amount": 73300, "mobile_money_amount": 0, "voids_count": 3, "voided_amount": 2100, "net_amount": 239400 }
  ],
  "sales_by_service": [
    { "service_id": "2026-10-29-dejeuner-spot-k1", "sales_count": 251, "total_amount": 198000, "…": "mêmes champs" }
  ],
  "offline": {
    "sales_count": 6, "card_amount": 4200, "debited_amount": 3600, "loss_amount": 600,
    "by_issue": [
      { "issue": null, "sales_count": 4, "card_amount": 2800, "debited_amount": 2800, "loss_amount": 0 },
      { "issue": "offline_cap_exceeded", "sales_count": 2, "card_amount": 1400, "debited_amount": 800, "loss_amount": 600 }
    ]
  },
  "items": [
    { "kind": "formula", "ref_id": "f-eco", "label": "Formule éco étudiant", "quantity": 140, "amount": 84000 },
    { "kind": "item", "ref_id": "kilichi", "label": "Kilichi", "quantity": 31, "amount": 15500 }
  ],
  "orders": {
    "orders_count": 22, "total_amount": 18400, "paid_amount": 18400, "refunded_amount": 1000,
    "by_status": [
      { "status": "handed_over", "orders_count": 20, "total_amount": 16400, "paid_amount": 16400, "refunded_amount": 0 },
      { "status": "no_show", "orders_count": 1, "total_amount": 1000, "paid_amount": 1000, "refunded_amount": 1000 },
      { "status": "refused", "orders_count": 1, "total_amount": 1000, "paid_amount": 1000, "refunded_amount": 0 }
    ]
  },
  "reservations": {
    "pickup_date": "2026-10-29", "orders_count": 25, "collected_count": 23, "collected_amount": 21000,
    "no_show_count": 1, "no_show_amount": 1000, "cancelled_count": 1, "refused_count": 0, "open_count": 0
  },
  "topups": { "topups_count": 18, "amount": 54000, "charge_amount": 0, "commission_amount": 0 },
  "cash_drawer": {
    "openings_without_sale": 2, "with_pin_count": 1,
    "by_service": [
      { "service_id": "2026-10-29-dejeuner-spot-k1", "openings_count": 2, "with_pin_count": 1,
        "cash_amount": 61000, "reasons": "Monnaie ; Erreur de rendu" }
    ],
    "till_sessions": null
  },
  "settlement": {
    "balance_sales_amount": 167600,
    "balance_orders_amount": 19400,
    "balance_voids_amount": 1500,
    "balance_refunds_amount": 1000,
    "balance_collected_amount": 184500,
    "counter_topups_amount": 54000,
    "net_due_to_site_amount": 130500,
    "commission_amount": null,
    "payouts_amount": null
  },
  "reconciliation": {
    "sales":  { "events_count": 312, "events_amount": 241500, "report_count": 312, "report_amount": 241500, "matches": true },
    "topups": { "events_count": 18, "events_amount": 54000, "report_count": 18, "report_amount": 54000, "matches": true },
    "drawer": { "events_count": 2, "events_amount": 0, "report_count": 2, "report_amount": 0, "matches": true },
    "matches": true
  }
}
```

| Bloc | D'où, chez EasyPay | Sens |
|---|---|---|
| `sales`, `sales_by_till`, `sales_by_service` | rapport « Ventes » (par site, caisse, service) | ventes **datées** du jour (heure de la caisse) ; `card_amount` = débité des soldes ; `voided_amount` = montant des ventes du jour annulées ; `net_amount` = montant − annulé |
| `offline` | rapport « Ventes hors ligne et pertes » | ventes servies sans réseau ; `issue: null` = débitées normalement |
| `items` | ventes du jour non annulées | meilleures ventes d'abord (quantité, puis montant) |
| `orders` | rapport « Commandes » | commandes **passées** ce jour, par statut actuel |
| `reservations` | commandes **à retirer** ce jour (`pickup_date`) | retirées (`collected`), non retirées (`no_show`), annulées, refusées, encore ouvertes |
| `topups` | rapport « Recharges », ligne du restaurant | recharges en espèces aux caisses du restaurant |
| `cash_drawer` | rapport « Tiroir ouvert sans vente » | ouvertures sans vente, par service, avec les espèces des ventes du service |
| `settlement` | journal des soldes, écritures du restaurant **écrites** ce jour | voir ci-dessous |
| `reconciliation` | événements de la file du jour contre les rapports | même nombre et mêmes francs, sinon `matches: false` |

**`settlement`** (entre EasyPay et le restaurant) :
`balance_collected_amount` = ventes payées sur le solde + commandes payées
sur le solde − annulations recréditées − remboursements de commandes : ce
qu'EasyPay a pris aux étudiants pour le restaurant. `counter_topups_amount`
= espèces reçues par le restaurant pour EasyPay (recharges). 
`net_due_to_site_amount` = la différence, **due par EasyPay au restaurant**
(négative : due par le restaurant à EasyPay). Ce bloc suit l'heure
d'écriture au journal (une vente hors ligne arrivée le lendemain y compte le
lendemain), les blocs `sales` l'heure de la caisse : ils peuvent différer
d'un jour à l'autre, jamais sur la durée.

**`null` veut dire « inconnu d'EasyPay », jamais zéro** :
`commission_amount` (aucune commission sur les ventes du restaurant n'est
fixée dans EasyPay), `payouts_amount` (les versements faits au restaurant ne
sont pas encore enregistrés dans EasyPay), `till_sessions` (le fond de
caisse, les espèces comptées à la clôture et l'écart restent sur la caisse,
dans son ticket Z, et ne sont pas envoyés au serveur). Ces champs seront
remplis par une version ultérieure, sans changement de forme.

`reconciliation.matches: false` pour un jour d'avant la liaison qui n'a
pas été renvoyé (§12, `easypay:kanoo-resend`) : ses événements manquent
chez Kanoo.

## 7. Livraison, reprises, idempotence, ordre

- **File durable** : l'événement est écrit par la base d'EasyPay dans la
  transaction même de la vente (ou de l'annulation, de la recharge, de la
  commande) : la vente et son événement existent ensemble ou pas du tout.
  Rien n'est jamais effacé de la file.
- **Envoi** : dans les secondes qui suivent (un passage toutes les
  5 secondes).
- **Ordre** : par restaurant, dans l'ordre de `sequence` ; l'événement
  suivant attend que le précédent soit reçu.
- **Kanoo injoignable** (délai dépassé, connexion refusée, `5xx`, `401`,
  `403`, `404`, `405`, `408`, `425`, `429`) : la liaison est « en panne »,
  l'événement en tête est réessayé après 30 s, 1 min, 2 min, 4 min… puis
  toutes les heures, **sans fin** ; les suivants attendent derrière lui ;
  **rien n'est perdu**. `Retry-After` (en secondes) est respecté, jusqu'à
  une heure. Au-delà de 30 minutes de panne, les superadmins d'EasyPay sont
  prévenus.
- **Événement refusé par Kanoo** (`400`, `422` et tout autre `4xx` non
  cité ci-dessus) : réessayé selon le même rythme jusqu'à **10 essais**,
  puis **mis de côté** (lettre morte) : la file du restaurant continue avec
  le suivant. Il reste visible au back-office d'EasyPay (Finances → Kanoo)
  et y est renvoyé à la demande, avec son `event_id`, sa `sequence` et ses
  octets d'origine, `X-EasyPay-Replay: 1`. Kanoo voit donc un trou dans
  `sequence` tant qu'un événement est mis de côté, puis le reçoit en
  retard : il doit l'accepter.
- **Idempotence** : un même `event_id` peut arriver plusieurs fois (réponse
  perdue, renvoi d'une période). Kanoo le garde **une fois** (index unique
  sur `event_id`) et répond `200` au doublon comme au premier envoi
  (`409` est aussi compris comme « déjà reçu »).
- **Renvoi d'une période** (`easypay:kanoo-resend`, §12) : les événements
  déjà envoyés repartent sous leur `event_id` et leur `sequence`
  d'origine (Kanoo les ignore s'il les a) ; ceux que Kanoo n'a jamais eus
  (antérieurs à la liaison) arrivent avec une nouvelle `sequence`, après
  les autres ; les bilans des jours sont refaits ou révisés.

## 8. Réponses attendues de Kanoo

| Situation | Code | Corps (facultatif) |
|---|---|---|
| Événement reçu (première fois) | `200`, `201` ou `202` | `{"status": "accepted"}` |
| Événement déjà reçu (même `event_id`) | `200` (ou `409`) | `{"status": "duplicate"}` |
| Type d'événement inconnu (version future) | `200` | `{"status": "ignored"}` — jamais `4xx` |
| Corps invalide pour ce contrat | `422` | `{"error": "invalid_payload", "message": "…"}` |
| Jeton ou signature invalides, horloge écartée | `401` | `{"error": "unauthorized"}` |
| Restaurant non reconnu | `403` | `{"error": "unknown_site"}` |
| Surcharge, maintenance | `429` ou `503` avec `Retry-After` | |
| Erreur interne | `5xx` | |

Kanoo répond en moins de 10 secondes. Le corps des refus (300 premiers
caractères) est montré au back-office d'EasyPay : n'y mettez ni jeton, ni
secret, ni donnée personnelle.

## 9. Données personnelles

Kanoo reçoit **ce dont le restaurant et son comptable ont besoin, rien de
plus** :

- **Jamais** : nom, prénom, téléphone, courriel, matricule, numéro ISIC,
  UID de carte, solde d'un étudiant, adresse IP, message libre d'une
  commande, note libre d'une annulation.
- **Le client** est un pseudonyme, `customer_ref` : `c_` suivi de 24
  caractères hexadécimaux, calculé par EasyPay (HMAC-SHA256 du restaurant et
  de l'étudiant sous une clé que seul le serveur d'EasyPay détient). Le même
  étudiant a le même pseudonyme dans un restaurant, un autre ailleurs ; on
  ne peut pas remonter à l'étudiant sans le serveur d'EasyPay. Il sert à
  compter des clients distincts et des habitudes d'achat ; Kanoo ne cherche
  pas à le relier à une personne. `null` pour un paiement en espèces sans
  carte.
- **Le personnel** du restaurant (caissiers, responsables) est désigné par
  son identifiant EasyPay (`spot-u2`), sans nom.
- Kanoo protège ces données comme des données comptables : accès réservé
  au restaurant concerné, à Numatech et au comptable ; conservation selon
  les obligations comptables ; hébergement chiffré au repos.

## 10. Évolutions du contrat

- **Sans changer de version** (`spec_version` reste `1`) : nouveaux champs
  dans `data`, nouveaux blocs du bilan, nouveaux `type` d'événements,
  champs aujourd'hui `null` remplis. Kanoo **ignore** ce qu'il ne connaît
  pas et répond `200` à un type inconnu.
- **Changement de forme ou de sens** : `spec_version` `2`, une nouvelle
  poignée de main, et ce document mis à jour avec sa table des versions.
  EasyPay n'envoie jamais une version que Kanoo n'a pas acceptée à la
  poignée de main.

## 11. Recette (pour le développeur de Kanoo)

1. Implémenter `/handshake` et `/events` avec la vérification de §3, la
   table unique sur `event_id`, l'insertion puis la réponse `200`.
2. Donner à Mansour l'adresse de base et le jeton du restaurant (par un
   canal sûr, jamais en clair dans un groupe de discussion).
3. Mansour relie le restaurant (§12) : la commande affiche « Kanoo a
   répondu à la poignée de main ».
4. Une vente de test à la caisse arrive dans Kanoo en quelques secondes
   (`sale.recorded`, `sequence` 1 si rien d'autre ce jour-là).
5. Couper Kanoo une heure, faire deux ventes, le rallumer : les deux
   arrivent dans l'ordre, une seule fois chacune.
6. Le lendemain matin, le `day.closed` de la veille a
   `reconciliation.matches: true` et ses `sales` égalent le rapport
   « Ventes » du back-office pour le restaurant et ce jour.

## 12. Côté EasyPay (exploitation)

Relier un restaurant (le jeton est demandé au clavier, rien ne s'affiche ;
il ne s'écrit jamais sur la ligne de commande) :

```
ssh -t easypay /opt/easypay/deploy/bin/kanoo-link.sh the-spot https://numapilot.numatechservices.net/api/v1/spot
```

(équivalent : `deploy/bin/dc exec app php artisan easypay:kanoo-link the-spot
--url=https://numapilot.numatechservices.net/api/v1/spot`). La commande
fait la poignée de main, enregistre la liaison (jeton et secret chiffrés,
écrite au journal d'audit, sans eux), puis met en file les événements du
jour déjà passés (depuis minuit). Relancée sur un restaurant déjà relié
(nouveau jeton) : nouveau secret, la `sequence` continue.

- Désactiver : `deploy/bin/kanoo-link.sh the-spot --disable` (plus rien
  n'est écrit ni envoyé ; ce qui attendait reste en file).
- Renvoyer une période (jours d'avant la liaison, ou à la demande de
  Kanoo) : `deploy/bin/dc exec app php artisan easypay:kanoo-resend the-spot
  --from=2026-10-01 --to=2026-10-29`.
- Suivi : back-office, **Finances → Kanoo** (superadmin et comptable) :
  état de chaque liaison, dernier envoi réussi, panne en cours, événements
  en attente et en échec, dernier bilan ; le superadmin y renvoie les
  événements en échec (écrit au journal d'audit).
- Envoi : `easypay:kanoo-send` (planifié chaque minute, un passage toutes
  les 5 s) ; bilans : automatisation `kanoo` (chaque heure, à h 05 ;
  `easypay:automate kanoo`).
- Gardes techniques (facultatives, `/etc/easypay/easypay.env`) :
  `KANOO_TIMEOUT_SECONDS` (10), `KANOO_MAX_ATTEMPTS` (10).
- Tables : `kanoo_links` (une ligne par restaurant, jamais effacée),
  `kanoo_events` (la file ; contenu immuable, jamais effacé). Code :
  `server/app/Campus/Kanoo/`, migration `2026_11_06_100000_kanoo`.
