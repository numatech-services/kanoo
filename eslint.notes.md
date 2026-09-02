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
