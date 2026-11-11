# Liaison EasyPay → Kanoo — contrat d'interface, version 1.1

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
| 1 (complément) | 6 novembre 2026 | `cashout.recorded`, `cashout.cancelled` ajoutés sans changer de version (§10) |
| 1.1 | 11 novembre 2026 | Liaison **réseau** `_easypay` : recharges et versements des agents, commissions sur les commandes des partenaires, reversements aux partenaires, bilan du jour du réseau (§13). Ajouts seulement : `spec_version` reste `1` (§10) |

Sommaire : 1. Principes · 2. Adresses · 3. Authentification et signature ·
4. Poignée de main · 5. Événements · 6. Bilan du jour · 7. Livraison,
reprises, idempotence, ordre · 8. Réponses attendues de Kanoo ·
9. Données personnelles · 10. Évolutions du contrat · 11. Recette ·
12. Côté EasyPay (exploitation) · 13. Version 1.1 : la liaison réseau
(agents, partenaires) · 14. Points non vérifiés.

## 1. Principes

- **Sens unique** : EasyPay appelle Kanoo ; Kanoo n'appelle jamais EasyPay.
- **Une liaison par restaurant** (un « site » d'EasyPay, ex. `the-spot`) :
  Kanoo donne pour chaque restaurant une **adresse de base** et un **jeton
  API**. EasyPay tire un **secret de signature** propre à la liaison et le
  remet à Kanoo dans la poignée de main.
- **Plus une liaison réseau** (version 1.1, §13) : ce qui n'appartient à
  aucun restaurant (agents, partenaires) passe par une liaison de plus,
  d'identifiant réservé `_easypay`, avec les mêmes règles.
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
| `cashout.recorded` | un retrait de recettes en espèces au comptoir (ajouté sans changer de version, §10) |
| `cashout.cancelled` | un retrait annulé le jour même par un superviseur : ses espèces reviennent au tiroir (ajouté sans changer de version, §10) |
| `order.placed` | une commande ou réservation passée (appli étudiant, caisse) |
| `order.updated` | une commande qui change : statut, payé, remboursé, remboursement en espèces dû ou rendu, jour de retrait |
| `day.closed` | le bilan du jour clos (§6) |
| `agent_topup.recorded`, `agent_remittance.recorded`, `agent_remittance.reconciled`, `partner_earning.recorded`, `partner_earning.settled`, `partner_payout.recorded`, `network_day.closed` | version 1.1, **liaison réseau seulement** (§13) : jamais sur la liaison d'un restaurant |

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

### `cashout.recorded`

Un étudiant retire en espèces, à une caisse du restaurant, des recettes
gagnées par EasyPay (billets d'un événement qu'il organise, cagnotte,
article vendu entre étudiants). Ajouté sans changer `spec_version` (§10) :
Kanoo l'ignore s'il ne le connaît pas.

```json
"data": {
  "cashout_id": "5f0c9a1e-2b7d-4c1a-9e3f-0a1b2c3d4e5f",
  "till_id": "spot-k1",
  "service_id": "2026-11-14-dejeuner-spot-k1",
  "cashier_id": "spot-u2",
  "earning_service": "events",
  "gross_amount": 10000,
  "commission_amount": 500,
  "net_amount": 9500,
  "customer_ref": "c_5d41402abc4b2a76b9719d91"
}
```

`net_amount` : les espèces **sorties du tiroir** du restaurant pour le
compte d'EasyPay (à déduire des espèces attendues du service, et dues au
restaurant par EasyPay au règlement) ; `earning_service` : `events`,
`pots` ou `listings`. Ni la carte, ni la pièce d'identité, ni le solde ne
sont envoyés.

### `cashout.cancelled`

Un superviseur annule un retrait le jour même, le service de caisse encore
ouvert et avant le Z (motif obligatoire, gardé au serveur). Ajouté sans
changer `spec_version` (§10) : Kanoo l'ignore s'il ne le connaît pas.

```json
"data": {
  "cancellation_id": "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c6d",
  "cashout_id": "5f0c9a1e-2b7d-4c1a-9e3f-0a1b2c3d4e5f",
  "till_id": "spot-k1",
  "service_id": "2026-11-14-dejeuner-spot-k1",
  "supervisor_id": "spot-u1",
  "earning_service": "events",
  "gross_amount": 10000,
  "commission_amount": 500,
  "net_amount": 9500,
  "customer_ref": "c_5d41402abc4b2a76b9719d91"
}
```

`net_amount` : les espèces **revenues au tiroir** (le `cashout.recorded`
du même `cashout_id` ne compte plus). Le motif n'est pas envoyé.

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
remplis par une version ultérieure, sans changement de forme. **Toujours
`null` en version 1.1** : EasyPay ne fixe toujours aucune commission sur
les ventes d'un restaurant et n'enregistre toujours aucun versement fait à
un restaurant (§13.10).

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
- Liaison réseau (§13) : mêmes commandes avec `_easypay` à la place du
  restaurant (`deploy/bin/kanoo-link.sh _easypay <adresse donnée par
  Kanoo>`, `easypay:kanoo-resend _easypay --from=… --to=…`). Elle apparaît
  au back-office sous « EasyPay (réseau) ».
- Tables : `kanoo_links` (une ligne par restaurant, plus celle du réseau,
  jamais effacée), `kanoo_events` (la file ; contenu immuable, jamais
  effacé). Code : `server/app/Campus/Kanoo/`, migrations
  `2026_11_06_100000_kanoo` et `2026_11_21_100000_kanoo_network` (1.1).

## 13. Version 1.1 — la liaison réseau (agents, partenaires)

La version 1 ne couvre que les restaurants. Ces faits d'argent
n'appartiennent à **aucun restaurant** dans EasyPay et ne pouvaient donc
pas partir :

| Fait | Où il vit chez EasyPay | Pourquoi aucun restaurant |
|---|---|---|
| Recharge faite par un **agent** | `topups`, `source = 'agent'` | l'agent est rattaché à un campus ; `topups.site_id` est vide |
| **Versement** d'un agent à EasyPay (les espèces collectées), puis son rapprochement | `remittances` | idem |
| **Commission** d'EasyPay sur une commande d'un partenaire (Easy Market, Easy Print, Easy Shop) et part du partenaire, puis son règlement au guichet | `partner_earnings` | le partenaire vend sur tout le réseau |
| **Reversement** d'EasyPay à un assureur ou à l'opérateur télécom | `partner_payouts` | idem |

### 13.1 Une liaison de plus

- **Identifiant réservé** `_easypay`, nom `EasyPay (réseau)`, dans
  `site.id`, `site.name` et `X-EasyPay-Site`. La base d'EasyPay interdit à
  tout site de prendre cet identifiant.
- Kanoo donne pour elle **une adresse de base et un jeton**, comme pour un
  restaurant (par exemple `…/api/v1/easypay` : l'adresse est choisie par
  Kanoo, non fixée ici). Kanoo doit accepter `X-EasyPay-Site: _easypay`.
- **Tout le reste est inchangé** : poignée de main (§4), signature (§3),
  file durable écrite dans la transaction du fait, `sequence` propre au
  réseau (1, 2, 3…), reprises, mise de côté, renvoi (§7), réponses (§8).
- `spec_version` reste **`1`** (et `X-EasyPay-Spec-Version: 1`) : ce ne sont
  que des types nouveaux (§10). **Attention** : un Kanoo qui ne les connaît
  pas répond `200 ignored` et EasyPay les compte comme reçus. Kanoo
  implémente donc ces types **avant** que la liaison réseau soit faite ;
  sinon, renvoyer la période (§12).
- Chaque nuit, un **bilan du jour du réseau** (`network_day.closed`, §13.7)
  suit les événements du jour, avec son rapprochement.
- Les liaisons des restaurants ne reçoivent **aucun** de ces types ; leurs
  événements et leur bilan ne changent pas.
- Tant que la liaison réseau n'est pas active, rien n'est écrit pour elle.
  À la liaison, les faits du jour (depuis minuit) sont mis en file ; les
  jours d'avant se renvoient par `easypay:kanoo-resend _easypay` (§12).

### 13.2 Types et jour comptable

| `type` | Quand | `business_date` (jour comptable) | `occurred_at` |
|---|---|---|---|
| `agent_topup.recorded` | un agent recharge le solde d'un étudiant, en espèces | jour de la recharge, à l'heure de l'appareil de l'agent (refusée si elle est en avance sur le serveur) ; comme le rapport « Recharges » | l'heure de la recharge |
| `agent_remittance.recorded` | un agent verse à EasyPay des espèces collectées | jour où le **serveur** a reçu le versement (`received_at`) | l'heure déclarée par l'agent |
| `agent_remittance.reconciled` | le back-office rapproche ce versement (reçu et compté) | **le même jour** que le versement | l'heure du rapprochement |
| `partner_earning.recorded` | une commande d'un partenaire est remise : sa part et la commission d'EasyPay sont arrêtées, une fois par commande | jour de la remise (`earned_at`), comme le portail partenaire | l'heure de la remise |
| `partner_earning.settled` | la part d'un partenaire payée **hors** EasyPay est notée réglée au guichet | **le même jour** que la commission | l'heure du règlement |
| `partner_payout.recorded` | un reversement à un assureur ou à l'opérateur télécom est enregistré au back-office | jour du **virement** (`paid_on`), comme EasyPay compte les reversements | l'heure de l'enregistrement |
| `network_day.closed` | le bilan du jour clos du réseau (§13.7) | le jour résumé | la fin du jour |

**Seuls les `.recorded` portent des montants à additionner.**
`.reconciled` et `.settled` sont des **changements d'état** de l'objet
déjà compté : Kanoo met l'objet à jour et n'ajoute rien aux totaux. C'est
pourquoi ils gardent le jour comptable de leur objet : une commande remise
le 31 octobre et réglée le 3 novembre reste une commission d'octobre.

Règles communes : montants `*_amount` en **francs CFA entiers** ; taux
`*_rate_bp` en **dix-millièmes** (`1250` = 12,5 %) ; heures en ISO 8601
avec le décalage de Niamey ; jours `AAAA-MM-JJ`. **Chaque événement porte
l'état complet** de son objet au moment du fait.

**Personnes** (§9) : un agent est désigné par un **pseudonyme**,
`agent_ref` (`a_` suivi de 24 caractères hexadécimaux, HMAC de son
identifiant sous une clé que seul le serveur d'EasyPay détient), le même
sur tous les événements. L'identifiant interne d'un agent peut contenir
son nom : il n'est pas envoyé. L'étudiant est `customer_ref` (§9), propre
à la liaison réseau : différent de celui du même étudiant dans un
restaurant.

### 13.3 `agent_topup.recorded`

```json
"data": {
  "topup_id": "019a7b3c-…",
  "agent_ref": "a_3f9c0e1b2d4a5c6e7f8091a2",
  "agent_session_id": "019a7b3b-…",
  "campus_id": "c-s1",
  "university_id": "udemo",
  "method": "cash",
  "amount": 2000,
  "tendered_amount": 5000,
  "change_amount": 3000,
  "charge_amount": 20,
  "credited_amount": 1980,
  "commission_amount": 50,
  "received_at": "2026-11-12T10:00:02+01:00",
  "customer_ref": "c_5d41402abc4b2a76b9719d91"
}
```

(Chiffres d'exemple, ceux des tests automatiques.)

| Champ | Sens |
|---|---|
| `agent_ref`, `agent_session_id` | pseudonyme de l'agent (§13.2) et sa session de travail |
| `campus_id`, `university_id` | le campus de l'agent **au moment de la mise en file** et son université ; un agent n'a pas de restaurant. `null` si l'agent n'a pas de campus |
| `method` | toujours `cash` : un agent collecte des espèces (aucune recharge d'agent par mobile money n'existe dans EasyPay) |
| `amount` | espèces reçues par l'agent pour la recharge, qu'il doit à EasyPay |
| `tendered_amount`, `change_amount` | espèces tendues par l'étudiant, monnaie rendue |
| `charge_amount` | frais payés par l'étudiant selon le barème (retirés de son solde, gardés par EasyPay) ; 0 si le barème n'en fixe pas |
| `credited_amount` | crédité au solde de l'étudiant : `amount − charge_amount` |
| `commission_amount` | commission de l'agent selon le barème, **créditée à son compte chez EasyPay** au moment de la recharge (et débitée du compte de la plateforme) ; 0 si le barème n'en fixe pas |
| `received_at` | quand le serveur l'a reçue (une recharge faite hors ligne arrive plus tard) |

### 13.4 `agent_remittance.recorded` et `agent_remittance.reconciled`

Même `data`, l'état du versement au moment de l'événement :

```json
"data": {
  "remittance_id": "019a7b3d-…",
  "direction": "agent_to_easypay",
  "agent_ref": "a_3f9c0e1b2d4a5c6e7f8091a2",
  "agent_session_id": "019a7b3b-…",
  "campus_id": "c-s1",
  "university_id": "udemo",
  "amount": 2000,
  "reference": "BORD-0042",
  "handed_over_at": "2026-11-12T09:58:00+01:00",
  "received_at": "2026-11-12T09:58:01+01:00",
  "state": "reconciled",
  "reconciled": true,
  "reconciled_at": "2026-11-12T16:20:00+01:00"
}
```

| Champ | Sens |
|---|---|
| `direction` | toujours `agent_to_easypay` : l'agent remet à EasyPay les espèces collectées |
| `amount` | espèces versées |
| `reference` | la référence saisie par l'agent (bordereau, reçu…), `null` sans référence. **Texte libre de l'agent** (200 caractères au plus) : c'est le seul texte libre envoyé, parce qu'il identifie le versement ; Kanoo ne l'affiche qu'au restaurant concerné, à Numatech et au comptable (§9) |
| `handed_over_at` | l'heure du versement déclarée par l'agent (non contrôlée par le serveur) ; `received_at` : quand le serveur l'a reçu, qui fixe le jour comptable |
| `state` | `handed_over` (versé) puis `reconciled` (rapproché) |
| `reconciled`, `reconciled_at` | `false` / `null` tant que le versement n'est pas rapproché |

**Encours d'un agent** chez EasyPay (fiche de l'agent, appli agent :
`AgentCash::outstanding`) = recharges − versements − retraits payés par
l'agent. Les retraits payés par un agent (`cashouts`, canal agent) **ne sont
pas envoyés en 1.1** (§13.10) : Kanoo ne peut recalculer l'encours exact que
pour un agent qui n'en a payé aucun. Le rapport « Écarts de caisse
(agents) » du back-office calcule, lui, recharges − versements sans les
retraits : les deux chiffres peuvent différer (§14).

### 13.5 `partner_earning.recorded` et `partner_earning.settled`

Même `data`, l'état au moment de l'événement :

```json
"data": {
  "earning_id": "318",
  "object_type": "market_order",
  "object_id": "7c0e…",
  "partner": { "id": "9b1d…", "name": "Boutique Kaocen", "type": "vendor", "university_id": "udemo" },
  "base_amount": 10000,
  "commission_rate_bp": 1250,
  "commission_amount": 1250,
  "partner_amount": 8750,
  "settlement": "outside",
  "state": "earned",
  "earned_at": "2026-11-12T10:00:00+01:00",
  "settled_at": null,
  "to_settle_amount": 8750
}
```

| Champ | Sens |
|---|---|
| `object_type`, `object_id` | la commande : `market_order` (Easy Market), `print_order` (Easy Print), `shop_order` (Easy Shop) |
| `partner` | le partenaire : identifiant, **raison sociale** saisie au back-office (lue au moment de la mise en file : un changement de nom ultérieur n'est pas renvoyé), type (`vendor`, `printer`…), université (`null` : toutes) |
| `base_amount` | la base de la commission : prix des articles **sans la livraison** |
| `commission_rate_bp` | taux d'EasyPay **copié sur la commande** au moment où elle a été payée (un changement de taux ne la change pas) |
| `commission_amount` | commission gardée par EasyPay, arrondie au franc inférieur par EasyPay ; Kanoo ne la recalcule pas |
| `partner_amount` | part du partenaire ; `commission_amount + partner_amount = base_amount` (contrôlé par la base d'EasyPay) |
| `settlement` | `balance` : part versée aussitôt sur le solde EasyPay du membre étudiant désigné ; `outside` : part **due** au partenaire, à régler au guichet hors EasyPay |
| `state` | `earned` (arrêtée) puis `settled` (réglée au guichet) |
| `settled_at` | l'heure du règlement au guichet, `null` avant |
| `to_settle_amount` | ce qui reste dû au partenaire : `partner_amount` si `outside` et pas encore réglé, sinon 0 |

Un `.settled` n'existe que pour `settlement: "outside"`. La **période**
d'une commission est son `business_date` (jour de la remise) : Kanoo
totalise par partenaire, par jour ou par mois, sur les `.recorded`.

### 13.6 `partner_payout.recorded`

```json
"data": {
  "payout_id": "12",
  "direction": "easypay_to_partner",
  "partner": { "id": "4f2a…", "name": "Caren Assurances", "type": "insurer", "university_id": null },
  "amount": 45000,
  "paid_on": "2026-11-11",
  "reference": "VIR-2026-118",
  "period": { "from": "2026-10-01", "to": "2026-10-31" }
}
```

| Champ | Sens |
|---|---|
| `direction` | toujours `easypay_to_partner` |
| `partner.type` | `insurer` (assureur) ou `telecom` (opérateur télécom) : les seuls partenaires payés ainsi |
| `amount` | montant reversé, jamais plus que ce qui reste dû (contrôlé par EasyPay) |
| `paid_on` | le jour du virement, saisi au back-office (jamais dans le futur) ; c'est le `business_date` |
| `reference` | la référence du virement ; **unique par partenaire** chez EasyPay |
| `period` | les ventes que le reversement règle, bornes comprises |

### 13.7 Bilan du jour du réseau — `network_day.closed`

Chaque nuit, après minuit à Niamey (dans l'heure), après les événements du
jour, sur la liaison réseau. Mêmes règles que `day.closed` (§6) :
`revision` 2, 3… (nouvel `event_id`) quand un chiffre du jour change
(versement reçu en retard, rapprochement, règlement au guichet) ; Kanoo
garde, par `business_date`, la plus grande `revision`. Les jours d'avant la
liaison se font par renvoi (§12).

```json
"data": {
  "business_date": "2026-11-12",
  "timezone": "Africa/Niamey",
  "revision": 1,
  "generated_at": "2026-11-13T00:05:02+01:00",
  "period": { "from": "2026-11-12T00:00:00+01:00", "to": "2026-11-13T00:00:00+01:00" },
  "agent_topups": { "topups_count": 1, "amount": 2000, "charge_amount": 20, "credited_amount": 1980, "commission_amount": 50 },
  "agent_remittances": { "remittances_count": 1, "amount": 2000, "reconciled_count": 1, "reconciled_amount": 2000 },
  "partner_earnings": {
    "earnings_count": 1, "base_amount": 10000, "commission_amount": 1250, "partner_amount": 8750,
    "settled_count": 1, "to_settle_amount": 0,
    "by_object_type": [
      { "object_type": "market_order", "earnings_count": 1, "base_amount": 10000, "commission_amount": 1250,
        "partner_amount": 8750, "settled_count": 1, "to_settle_amount": 0 }
    ]
  },
  "partner_payouts": { "payouts_count": 0, "amount": 0 },
  "partner_balances": [
    { "partner": { "id": "4f2a…", "name": "Caren Assurances", "type": "insurer" },
      "due_to_date_amount": 120000, "paid_to_date_amount": 45000, "left_to_pay_amount": 75000 }
  ],
  "reconciliation": {
    "agent_topups": { "events_count": 1, "events_amount": 2000, "report_count": 1, "report_amount": 2000, "matches": true },
    "agent_remittances": { "…": "mêmes champs" },
    "agent_remittances_reconciled": { "…": "mêmes champs" },
    "partner_earnings": { "…": "mêmes champs, montants = base_amount" },
    "partner_payouts": { "…": "mêmes champs" },
    "matches": true
  }
}
```

| Bloc | Sens (chaque bloc sur le jour comptable de §13.2) |
|---|---|
| `agent_topups` | recharges d'agents du jour |
| `agent_remittances` | versements reçus par le serveur ce jour ; parmi eux, ceux rapprochés **à l'heure du bilan** |
| `partner_earnings` | commissions arrêtées ce jour, par type de commande ; `settled_count` et `to_settle_amount` à l'heure du bilan |
| `partner_payouts` | virements datés de ce jour (`paid_on`) |
| `partner_balances` | pour chaque assureur et l'opérateur télécom : **dû** jusqu'à la fin du jour (part de l'assureur sur les polices émises, prix des achats télécom réussis moins la remise d'EasyPay), **versé** (virements jusqu'à ce jour), **reste à verser** (négatif : versé plus que dû à cette date). Les partenaires à 0 et 0 sont omis. Le dû est calculé par EasyPay ; son détail (police par police, achat par achat) n'est pas envoyé (§13.10) |
| `reconciliation` | événements de la file du jour contre ces chiffres : même nombre et mêmes francs, sinon `matches: false` (jour d'avant la liaison non renvoyé, événement mis de côté ou ignoré par Kanoo) |

### 13.8 Idempotence, ordre, états

- `event_id` : clé d'idempotence, comme en version 1 (index unique chez
  Kanoo, `200` au doublon).
- **Clés métier** (une ligne par objet chez Kanoo) : `topup_id` ;
  `remittance_id` ; `earning_id` ; `payout_id`. EasyPay écrit **au plus un**
  événement de chaque type par objet (`.recorded` une fois, `.reconciled`
  ou `.settled` une fois) ; un objet écrit déjà rapproché ou réglé donne
  ses deux événements, dans l'ordre.
- **L'état ne recule jamais, quelle que soit la `sequence`** : `reconciled`
  l'emporte sur `handed_over`, `settled` sur `earned`. Kanoo ne remplace
  jamais un objet `reconciled` ou `settled` par un `.recorded`, même de
  `sequence` plus grande. Ce cas arrive au renvoi d'une période : un fait
  d'avant la liaison reçoit une `sequence` plus grande que son
  rapprochement fait après la liaison (§7). Les montants (`amount`,
  `base_amount`, `commission_amount`, `partner_amount`) sont les mêmes dans
  les deux.
- Un `.reconciled` ou un `.settled` peut arriver **sans** son `.recorded`
  (période d'avant la liaison pas encore renvoyée) : Kanoo crée l'objet à
  partir de son `data`, qui est complet, et le compte dans les totaux de
  son `business_date`.
- Recharges d'agents, versements et reversements ne sont jamais effacés ni
  modifiés chez EasyPay (la base l'interdit ; un versement n'est rapproché
  qu'une fois). Une commission ne peut pas être effacée ; son règlement
  n'est fait qu'une fois par le back-office (l'application l'impose, pas la
  base). Aucune annulation n'existe pour ces quatre objets.

### 13.9 Ce qui n'est pas envoyé (données personnelles)

- **Jamais** (§9) : le nom de l'agent et son identifiant interne
  (`agent_ref` à la place), le nom tapé pour « reçu par » d'un versement,
  les notes libres (versement, règlement au guichet, reversement),
  l'appareil de l'agent, la carte, le solde, qui a rapproché, réglé ou
  enregistré (administrateurs), le compte interne.
- **Envoyés** : la raison sociale du partenaire (nécessaire à la facture ;
  voir §14 pour un vendeur personne physique) et la référence d'un
  versement (§13.4).

### 13.10 Ce qui n'existe pas dans EasyPay, et ce qui n'est pas envoyé

N'existent pas (rien n'est inventé) :

- **commission sur les ventes d'un restaurant** : aucune n'est fixée
  (`day.closed.settlement.commission_amount` reste `null`) ;
- **versements entre EasyPay et un restaurant** (comptoir) : aucun n'est
  enregistré (`day.closed.settlement.payouts_amount` reste `null`) ;
- **versements entre EasyPay et Numatech** : aucune table ne les enregistre ;
- **recharge d'agent par mobile money** : n'existe pas ;
- **restaurant d'une recharge d'agent** : n'existe pas (campus et université
  de l'agent à la place) ;
- **manière dont l'agent touche sa commission** (hors de son compte
  EasyPay) : non enregistrée.

Existent mais **ne sont pas envoyés en 1.1** (évolution possible, mêmes
règles) :

- les retraits payés par un agent (`cashouts`, canal agent) ;
- les gains et commissions d'Easy Delivery (`delivery_earnings`), de la
  mobilité (`mobility_earnings`), des événements d'étudiants
  (`event_payouts`) ;
- le détail, police par police et achat par achat, de ce qui est dû aux
  assureurs et à l'opérateur télécom (seul le cumul jour par jour part,
  dans `partner_balances`), donc la commission d'EasyPay sur les polices et
  sa remise sur les achats télécom.

### 13.11 Recette (pour le développeur de Kanoo)

1. Implémenter les types du §13.2 **avant** la liaison réseau ; ouvrir
   l'adresse réseau (`/handshake`, `/events`) avec la même vérification
   (§3) ; accepter `X-EasyPay-Site: _easypay`.
2. Donner à Mansour l'adresse et le jeton par un canal sûr ; il relie
   (`deploy/bin/kanoo-link.sh _easypay <adresse>`).
3. Une recharge d'agent de test arrive en `agent_topup.recorded`
   (`sequence` 1 si rien d'autre ce jour-là) ; son versement puis son
   rapprochement en `agent_remittance.recorded` puis `.reconciled`.
4. Une commande Easy Market remise arrive en `partner_earning.recorded` :
   `commission_amount + partner_amount = base_amount`.
5. Le lendemain matin, `network_day.closed` de la veille a
   `reconciliation.matches: true`.
6. Renvoyer une période (`easypay:kanoo-resend _easypay --from=… --to=…`) :
   rien n'est compté deux fois ; un rapprochement n'est pas défait.

## 14. Points non vérifiés (version 1.1)

- **L'adresse et le jeton de la liaison réseau** ne sont pas donnés : Kanoo
  doit les créer. La réception côté Kanoo n'est ni écrite ni essayée ;
  aucun envoi réel n'a eu lieu.
- **Vendeur personne physique** : la raison sociale d'un partenaire de type
  `vendor` peut être le nom d'une personne ; non vérifié sur les
  partenaires enregistrés en production. À trancher par Mansour : l'envoyer
  (besoin comptable) ou ne garder que l'identifiant.
- **Référence d'un versement** : texte libre de l'agent, qui pourrait
  contenir un nom ; non vérifié sur les versements de production.
- **Pseudonyme de l'agent** : Kanoo ne sait pas qui est l'agent ; pour un
  suivi nominatif, il faut le back-office d'EasyPay. À confirmer par
  Mansour.
- **`campus_id` d'un agent** : son campus au moment de la mise en file
  (pour un renvoi, au moment du renvoi), pas un historique.
- **Heure d'un versement** : l'heure déclarée par l'agent n'est pas
  contrôlée par le serveur ; le jour comptable suit donc l'heure du serveur
  (`received_at`).
- **Deux encours d'agent** chez EasyPay (fiche de l'agent avec les
  retraits, rapport « Écarts de caisse (agents) » sans) : écart à corriger
  côté EasyPay, hors de cette version.
- **Dû aux assureurs et à l'opérateur télécom** (`partner_balances`) :
  calculé par les fonctions des portails partenaires d'EasyPay, non
  recalculé à la main sur des données réelles.
- **Volumes de production** (agents, partenaires, versements) : non
  mesurés ; aucune limite propre au réseau n'est fixée.
- **Montants d'exemple** de ce document : ceux des tests automatiques, ou
  illustratifs (`partner_balances`), pas des chiffres réels.
- **Identifiants du personnel des restaurants** (v1, `cashier_id`…) :
  saisis librement au back-office, ils pourraient contenir un nom ; non
  vérifié, hors de cette version.
- La conformité de l'envoi de ces données à un tiers (Kanoo) avec la
  réglementation nigérienne sur les données personnelles n'est pas vérifiée
  ici ; seules des données pseudonymisées ou d'entreprise sont envoyées.
