# Choix de configuration ESLint

## `react/no-unescaped-entities` — désactivée

La règle signale l'apostrophe droite dans le texte JSX. Sur une application
dont toute la copie est en français, cela produit 108 erreurs sur du texte
parfaitement valide (« l'organisation », « aujourd'hui », « n'est pas »).

React échappe déjà le contenu textuel : la règle vise des coquilles de balisage,
pas la langue du produit. La désactiver ne retire aucune protection réelle et
rend le lint exploitable comme barrière de CI.

## `no-var` — exception dans `lib/db.ts`

`declare global { var x }` est la seule forme qui attache une déclaration à
`globalThis` ; `let` et `const` ne le font pas. L'exception est locale et
commentée sur place.

## `mobile/` et `public/sw.js` — ignorés

`mobile/` est une application React Native autonome, avec ses propres
dépendances et son propre tsconfig. `public/sw.js` est un service worker en
JavaScript brut, exécuté dans un contexte qui n'est ni le navigateur ni Node.

## Passage à ESLint 9 et `eslint-config-next` 16 (lot E)

Configuration au format « flat » dans `eslint.config.mjs` (`.eslintrc.json`
et `.eslintignore` supprimés). `eslint-config-next` 16 apporte les règles
`react-hooks` du compilateur React ; elles ont révélé de vrais défauts,
corrigés : composants déclarés pendant le rendu (`static-components`, ils
étaient recréés à chaque rendu et perdaient leur état), appels à `Date.now`
pendant le rendu (`purity`), variables réassignées après le rendu
(`immutability`), liens internes en `<a>` au lieu de `<Link>`.

## `react-hooks/set-state-in-effect` — réactivée (erreur)

Elle signalait 111 chargements écrits à la main (`setLoading(true)` puis appel
d'API dans un `useEffect`). Ils passent désormais par le chargement commun
`useApi` (lib/use-api.ts) : `loading` s'y déduit de « l'adresse demandée a-t-elle
sa réponse », une requête obsolète est annulée, et un rechargement raté garde
les dernières données valables. Les autres cas (indicateur « monté »,
préférences lues dans le navigateur, réinitialisation d'un formulaire à
l'ouverture) utilisent `useSyncExternalStore` ou l'ajustement d'état pendant le
rendu. Un nouveau chargement écrit à la main est refusé par le lint.

## `@next/next/no-img-element` — désactivée

Les images affichées par l'application sont des logos en data-URI enregistrés
en base (organisation, clients, fournisseurs). `next/image` ne les optimise
pas et n'apporte que de la complexité ; la règle ne protège de rien ici.

## Liens de téléchargement

Un `<a href="/api/…/export">` télécharge un fichier : `<Link>` (navigation
côté client) y serait faux. Ces liens portent une exemption locale commentée.
