# Kanoo Mobile — React Native (Expo SDK 58)

Application iOS / Android connectée à l'API Kanoo : tableau de bord, factures,
clients, profil. La saisie complète reste sur le site.

## Démarrer

```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=https://numapilot.numatechservices.net npx expo start
```

Puis ouvrir avec **Expo Go** (version compatible SDK 58) ou un simulateur
(`i` pour iOS, `a` pour Android). Pour une instance locale :
`EXPO_PUBLIC_API_URL=http://<ip-du-poste>:3000`.

## Écrans

- **Connexion** — e-mail et mot de passe, puis code de double authentification
  si le compte l'a activée (application d'authentification ou code de secours).
- **Accueil** — trésorerie et prévision, chiffre d'affaires, à encaisser, retards,
  priorités du jour (`GET /api/dashboard/home`, même calcul que le web).
- **Factures** — recherche, filtres (à encaisser, en retard, payées), reste dû.
- **Clients** — recherche, appel et e-mail en un geste.
- **Profil** — identité, organisation, lien vers le site, déconnexion.

## Sécurité

- Le serveur rend un jeton à la connexion quand l'appel porte
  `x-kanoo-client: mobile` ; il est rangé dans le trousseau du téléphone
  (`expo-secure-store`) et présenté en `Authorization: Bearer`.
- Même jeton que la session web (8 h, droits et révocation identiques) : un
  administrateur qui révoque les sessions d'un utilisateur le déconnecte aussi
  du téléphone. Un 401 ramène à l'écran de connexion.

## Publier

```bash
eas build --platform android --profile preview   # APK de test
eas build --platform ios --profile preview       # TestFlight
```

Identifiant d'application : `ne.numatech.kanoo` (app.json) — à ajuster avant la
première publication sur les stores.
