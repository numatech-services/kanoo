# Facture certifiée — SECeF (Niger)

Comment Kanoo se raccorde au Système Électronique Certifié de Facturation de la
Direction Générale des Impôts, et ce qu'il reste à faire pour la certification
automatique.

---

## Ce qu'exige la réglementation

Depuis le **1ᵉʳ septembre 2021**, tout assujetti à la TVA au Niger — régimes du
réel normal et du réel simplifié — émet des **factures certifiées**. Chaque
facture porte un **code SECeF/DGI**, un **QR code** et une signature
électronique qui en garantissent la validité et la traçabilité. Les factures
électroniques se conservent **dix ans**.

## L'architecture, en trois pièces

| Pièce | Rôle | Qui le tient |
|---|---|---|
| **SFE** — Système de Facturation d'Entreprise | Le logiciel qui émet la facture | **Kanoo** |
| **MCF** — Module de Contrôle de Facturation | Certifie et appose le code | Boîtier DGI, ou **e-MCF** en ligne |
| **UF** — Unité de Facturation | SFE et MCF réunis dans une même machine | — |

Un SFE ne peut émettre de factures normalisées qu'après avoir été soumis à la
DGI, qui délivre un **certificat de conformité** et un identifiant **ISF**.

## Les deux voies possibles

### 1. Portail e-SECeF — disponible aujourd'hui, sans agrément

La DGI met à disposition un portail gratuit, [sygmef.impots.gouv.ne][portail],
qui produit des factures certifiées sans matériel. C'est ce que retient Kanoo
par défaut :

1. la facture est établie dans Kanoo ;
2. elle est émise sur le portail, qui rend un code SECeF/DGI et un QR code ;
3. ces éléments sont reportés dans Kanoo (bouton **Certifier**, mode portail) ;
4. Kanoo les archive, les imprime sur la facture, et mesure la couverture.

Ce n'est pas de l'automatisation — c'est la double saisie déjà pratiquée, rendue
traçable et vérifiable. Elle reste le filet quand le MCF est indisponible.

### 2. e-MCF — certification automatique, après agrément

L'intégration directe suppose de modifier le SFE pour dialoguer avec la
plateforme e-MCF **via l'API approuvée par la DGI**.

**Les spécifications de cette API ne sont pas publiques.** Elles sont remises à
l'éditeur pendant la procédure d'agrément. C'est pourquoi
`lib/secef/emcf.ts` est **délibérément incomplet** : y écrire une URL et un
schéma de charge utile inventés aurait produit un module qui compile, qui se
teste contre l'invention, et qui ne fonctionne pas le jour venu — en laissant
croire entre-temps que l'intégration est faite.

Tout ce qui ne dépend pas de la DGI est en place : la position du pilote dans
l'application, sa configuration, la distinction entre échec réessayable et refus
définitif, le stockage, l'audit. Il ne reste qu'une fonction à écrire.

## Marche à suivre pour l'agrément

1. **Constituer le dossier éditeur** auprès de la DGI (Guide destiné aux
   éditeurs de SFE, publié sur [impots.gouv.ne][dgi]) et soumettre Kanoo à la
   procédure d'homologation.
2. **Obtenir** le certificat de conformité et l'identifiant **ISF**.
3. **Récupérer** la spécification de l'API e-MCF et le jeton d'accès.
4. **Implémenter** l'appel dans `EmcfSecefDriver.certify()` — un seul endroit.
5. **Valider** en environnement de test avant bascule.
6. **Renseigner** les variables ci-dessous ; le pilote automatique prend le
   relais sans modifier une ligne d'appelant.

```
SECEF_EMCF_BASE_URL=   # adresse de la plateforme, fournie par la DGI
SECEF_EMCF_TOKEN=      # jeton d'accès délivré à l'agrément
SECEF_DRIVER=          # facultatif : « portal » ou « emcf » pour forcer un mode
```

## Ce que Kanoo garantit déjà

- **Une facture certifiée ne se recertifie pas.** Un second code sur une même
  facture serait un faux : la route refuse, et renvoie vers l'avoir.
- **Une facture certifiée ne se supprime pas.** L'annulation passe par une
  facture d'avoir (type **FA**) référençant le code d'origine.
- **Un brouillon ne se certifie pas** : il n'est pas opposable.
- **Unicité du code** par organisation, garantie par un index unique.
- **Couverture mesurée** sur les factures réellement émises, pas déclarée.
- **Journal d'audit** sur chaque certification, réussie ou refusée.

## Ce que Kanoo ne peut pas garantir

Kanoo **ne vérifie pas** l'authenticité d'un code auprès de la DGI : seul le
service des impôts peut le faire. Les contrôles portent sur la forme et la
cohérence, jamais sur la validité fiscale. L'écran de paramètres dit ce qui est
renseigné — il n'affirme jamais que l'organisation est en règle.

---

Sources : [Réforme de la facture certifiée, Ministère des Finances][mf] ·
[Guide destiné aux éditeurs de SFE, DGI][guide] · [Portail e-SECeF][portail] ·
[Synthèse EDICOM sur la facturation électronique au Niger][edicom]

[portail]: https://sygmef.impots.gouv.ne
[dgi]: https://www.impots.gouv.ne
[guide]: https://www.impots.gouv.ne/media/telech/Guide%20destin%C3%A9%20aux%20%C3%A9diteurs%20DES%20SFE.pdf
[mf]: https://www.finances.gouv.ne/index.php/une/798-reforme-de-la-facture-certifiee-le-directeur-general-des-impots-eclaire-les-contribuables-sur-les-tenants-et-les-aboutissants-la-reforme-de-la-facture-certifiee-est-un-outil-de-bonne-gouvernance-pour-les-entreprises-et-un-levier-important-pour-la-croissance-du-niger-et-non-un-nouvel-impot
[edicom]: https://edicomgroup.com/electronic-invoicing/niger
