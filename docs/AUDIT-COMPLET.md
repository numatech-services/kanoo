# Audit complet Kanoo — rapport

Audit en 8 phases, avant redéploiement. **Méthode : rien n'est estimé.** Un
serveur MongoDB réel (replica set en mémoire) et le serveur Next en mode
production ont été démarrés, la base amorcée, et chaque test exécuté par un
appel HTTP réel avec pot à cookies — pas une relecture de code.

## Décompte global

| Preuve | Chiffre |
|---|---|
| Tests unitaires (`npm test`) | **543 / 543** verts |
| Tests structurels (conventions de routes, RBAC, cohérence) | inclus ci-dessus |
| Tests HTTP réels d'audit (auth, isolation, CSRF, CRUD, vitrine) | **100 PASS**, 1 WARN, 0 défaut produit |
| `npm run typecheck` | 0 erreur |
| `npm run lint` | 0 erreur |
| `npm run build` (avec env) | compile, 130+ routes |
| Vulnérabilités de dépendances runtime | **22 → 5** (restantes = sauts majeurs, risque documenté) |

## Ce qui a été trouvé et corrigé

### Priorité 1 — critique (bloquant)

**1. Inscription publique impossible depuis la mise en ligne.**
La page `/souscrire` appelait `/api/superadmin/tenants`, route réservée au
superadmin : **100 % des visiteurs recevaient un 401.** Aucun client n'a jamais
pu créer de compte en autonomie.
→ Route publique `/api/public/inscription` : validation, politique de mot de
passe, limite de débit par IP, statut `pending_activation`, lien d'activation
par courriel, jeton jamais renvoyé dans la réponse. Page `/souscrire` recâblée.
*Vérifié : 2.1.2 → 201, jeton absent de la réponse (2.1.2b).*

**2. Mot de passe oublié inexistant.**
Le lien de la page de connexion menait à `/mot-de-passe-oublie` — un 404. Aucune
route, aucune page. Un mot de passe oublié = compte perdu.
→ `/api/auth/forgot-password` et `/api/auth/reset-password` (jeton haché en
base, usage unique, sessions révoquées), pages `/mot-de-passe-oublie` et
`/reinitialiser`.
*Vérifié : jeton haché SHA-256 en base (2.4.1c), usage unique (2.4.2e), ancien
mot de passe mort après reset (2.4.2f).*

**3. SSRF critique dans Next.js 14.1.0.**
→ Mise à jour vers 14.2.35 (non cassant). Corrige aussi le contournement de
middleware.

**4. Le deuxième salarié d'une organisation ne pouvait pas être créé.**
Index `Employee {tenantId, userId}` déclaré `sparse` sur un index composé : tous
les employés (userId null) étaient indexés, collision d'unicité au deuxième.
Le seed lui-même échouait.
→ Index partiel `partialFilterExpression: { userId: { $exists: true } }`.

### Priorité 2 — haute

**5. Renvoi de lien d'activation en panne.** La route régénérait le jeton sans
jamais envoyer le courriel (un `TODO`) : cliquer « Renvoyer » invalidait
l'ancien lien sans en fournir de nouveau. → Envoi câblé.

**6. Changement de mot de passe déconnectait l'utilisateur.** Le cookie réémis
portait le nom `token` au lieu de `auth_token`. → Réémission via
`setSessionCookies`. *Vérifié : la session survit au changement (2.4.3b).*

**7. Compte non activé pouvait se connecter.** Garde `pending_activation`
ajoutée au login **et** à la revalidation par requête. *Vérifié : 403 avant
activation, 200 après (2.1.4).*

### Priorité 3 — moyenne

**8. ValidationError / CastError Mongoose renvoyaient 500.** Une entrée
malformée (id invalide dans l'URL, type qui ne cadre pas) rendait une « erreur
interne » avec référence d'incident. → CastError → 404, ValidationError → 400
avec la liste des champs fautifs.

**9. `templatePasswordReset` sans version texte** — le fournisseur console et
les clients texte seul ne recevaient jamais le lien. → Ajoutée.

### Priorité 4 — nettoyage

**10.** 8 composants jamais importés supprimés. **11.** 3 dépendances runtime
inutilisées retirées (`cookie`, `critters`, `iconv-lite`). **12.** Correctifs de
vulnérabilités non cassants (mongoose, nanoid, transitifs).

## Ce qui était déjà solide (vérifié, non modifié)

- **Isolation multi-tenant étanche.** Lecture, modification **et** suppression
  d'une donnée d'un autre tenant → 403, la donnée reste intacte en base
  (5.3.1a-f). La liste ne fuit aucun tenant voisin.
- **RBAC effectif et immédiat.** Un commercial n'accède pas aux bulletins de
  paie (5.3.2b). Une rétrogradation prend effet **à la requête suivante**, sans
  attendre l'expiration du jeton — la revalidation lit la base à chaque appel.
- **CSRF réel.** Une mutation sans jeton → 403 (5.1.3a) ; avec jeton → 201.
- **Force brute bornée.** Verrou après 5 tentatives, `Retry-After` annoncé, le
  verrou tient même avec le bon mot de passe (2.2.3).
- **Cookies de session** HttpOnly + Secure + SameSite=lax + durée bornée.
- **Anti-verrouillage** : le dernier administrateur ne peut ni se rétrograder
  ni se désactiver (2.3.4d-e).
- **Anti-énumération** : login et mot de passe oublié répondent à l'identique,
  que l'adresse existe ou non.
- **Performances** : réponses API 8-13 ms sur la base amorcée.
- **Qualité** : TypeScript strict, 0 erreur lint, aucune image sans `alt`,
  filtre tenant centralisé sur 129 routes, aucun N+1.

## Réserves à traiter (non bloquantes)

| Réserve | Nature | Recommandation |
|---|---|---|
| **CSP en `Report-Only`** | Choix assumé (déploiement par étapes) | Basculer sur `Content-Security-Policy` une fois le rapport vide |
| **5 vulnérabilités à saut majeur** (next 16, nodemailer 9, node-cron 4) | Non exploitables via des entrées contrôlées par l'attaquant | Planifier une montée de version encadrée par les tests |
| **Budget non visible par `admin_ordonnateur`** | Choix RBAC (le budget lit `accountingEntries`) | Décider : soit l'ordonnateur passe par un rôle financier, soit lui accorder `accountingEntries:read` |
| **API v1 sans documentation** | Manque | Publier une référence OpenAPI pour les intégrateurs |
| **i18n non branché** (`messages/{fr,en}.json`) | Échafaudage inerte | Brancher ou retirer |
| **`npm run verify` échoue au build** | Env absent au build | Le build a besoin des variables d'environnement (comportement attendu au déploiement) ; documenté |

## Verdict

Le socle métier, la sécurité et l'isolation multi-tenant sont **prêts pour la
production**. Le blocage réel n'était pas dans le cœur applicatif mais dans le
**tunnel d'entrée** : personne ne pouvait s'inscrire ni récupérer un compte.
Ces portes sont désormais ouvertes et éprouvées.
