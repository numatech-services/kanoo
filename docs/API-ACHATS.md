# API v1 — brouillons d'achat fournisseur

Pour un système tiers (ISIC Niger) qui reçoit des factures de fournisseurs rattachées à son activité (impression,
licences, envoi). Il propose un **brouillon** ; le comptable choisit le compte de charge, contrôle la TVA déductible,
valide (écriture) et règle dans Kanoo. Besoin d'origine : `docs/kanoo-achats-v1.md` du dépôt `isic-niger`.

## Clé

Clé `kno_…` créée depuis un compte qui peut saisir des achats, avec le droit **`purchases:write`** (et
`purchases:read` pour relire) : Paramètres → API, ou `npx tsx scripts/creer-cle-api.ts <courriel> <nom> purchases:read,purchases:write`.

## `POST /api/v1/purchases`

| Champ | Obligatoire | Règle |
|---|---|---|
| `externalRef` | oui | 3 à 120 caractères `A-Z a-z 0-9 . _ : -`, unique par organisation |
| `supplierCode` | oui | code d'un fournisseur existant (404 sinon, aucune création implicite) |
| `supplierInvoiceRef` | oui | numéro de la facture du fournisseur (1 à 60) |
| `issueDate`, `dueDate` | oui | `AAAA-MM-JJ`, échéance ≥ date |
| `lines` | oui | 1 à 50 : `description` (1 à 200), `quantity` entier > 0, `unitPrice` hors taxes, F CFA entiers > 0 |
| `vatAmount` | oui | TVA portée par la pièce, F CFA entiers, 0 si aucune ; reprise telle quelle, répartie sur les lignes |
| `object`, `reference`, `period` | non | recopiés dans la note du brouillon |

Les lignes sont créées sur le compte provisoire **608000 « Achats divers (à imputer) »** : la validation est refusée
tant que le comptable n'a pas modifié les lignes (choix du compte de charge). La TVA reçue est conservée et répartie
sur les nouvelles lignes ; une validation dont la TVA s'écarte de celle de la facture demande un choix explicite.

Réponses : `201` créé ; `200` + `existing: true` rejeu identique (même empreinte du contenu reçu : fournisseur,
numéro, dates, lignes, TVA ; les ajustements du comptable n'y changent rien) ; `409` même `externalRef` au contenu
différent, ou même facture fournisseur déjà enregistrée et non annulée, quelle que soit son origine (saisie manuelle
comprise, numéro comparé sans casse, espaces ni séparateurs ; la saisie manuelle refuse de même une facture reçue par
l'API) ; `supplierInvoiceRef` de plus de 60 caractères ou TVA supérieure à 99 % du HT : `422` ; `404`
fournisseur inconnu ; `422` champ invalide ou période close ; `401`/`403` clé absente, révoquée, sans droit, auteur
inactif ou sans droit de saisir des achats.

Pièce rendue (`number` vaut `null` tant que l'achat n'est pas validé) : `externalRef, number, status, supplierCode, supplierInvoiceRef, issueDate, dueDate, totalHT, totalTVA,
totalTTC, paidAmount, creditedAmount` (F CFA).

## `GET /api/v1/purchases?externalRef=a,b&status=&limit=100`

Droit `purchases:read`. Rend les achats reçus par l'API sous `data.items`. Statuts : `draft`, `validated`, `partial`,
`paid`, `cancelled`. Un brouillon reçu par l'API et supprimé dans Kanoo reste visible au statut `cancelled`.

## Non couvert (v1)

Devises autres que le F CFA, retenues à la source sur fournisseur non résident, affectation automatique du compte
par nature, rattachement analytique à la vague ou à l'université, avoirs de fournisseur (saisis dans Kanoo) — à
trancher avec la comptable (non vérifié).
