# API v1 : brouillons de facture

Un système de production (ISIC Niger) propose une facture ; le comptable la vérifie et l'émet dans Kanoo.

`POST /api/v1/invoices`, `Authorization: Bearer kno_…`, droit `invoices:write` (à demander explicitement à la création de la clé).

| Champ | Note |
|---|---|
| `externalRef` | identifiant de la pièce chez l'appelant, 3 à 120 caractères (`A-Z a-z 0-9 . _ : -`). Rejouer rend le brouillon existant (`200`, `existing: true`) |
| `clientCode` | code du client dans Kanoo. `404` s'il n'existe pas |
| `issueDate`, `dueDate` | `AAAA-MM-JJ` |
| `lines` | 1 à 50 : `description`, `quantity` (entier positif), `unitPrice` (HT) |
| `object`, `reference`, `period` | facultatifs |

Tout autre champ est ignoré : ni TVA, ni remise, ni statut, ni numéro. Le brouillon porte le taux par défaut de Kanoo ; le comptable l'ajuste s'il le faut.

`GET /api/v1/invoices?externalRef=a,b` relit jusqu'à 100 pièces : numéro, statut, montants, `paidAmount`, `creditedAmount`, `writtenOffAmount`, échéance, `clientCode`.

Une clé qui écrit doit avoir un auteur actif. Aucun écran ne crée encore ces clés : `npx tsx scripts/creer-cle-api.ts <courriel de l'auteur> <nom>` sur le serveur, avec `MONGODB_URI`. La clé ne s'affiche qu'une fois.

Un brouillon supprimé dans Kanoo passe à `cancelled` : l'appelant le refait sous une nouvelle `externalRef`.
