# Kanoo Mobile — React Native (Expo)

Application mobile pour iOS et Android, connectée à l'API Kanoo.

## Prérequis

```bash
npm install -g @expo/cli eas-cli
```

## Démarrage

```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=https://kanoo.ne npx expo start
```

## Écrans implémentés (V1)

- `LoginScreen` — connexion avec email/mot de passe, token JWT stocké via SecureStore
- `DashboardScreen` — KPIs temps réel, actions rapides
- `AppNavigator` — navigation par onglets (5 sections)

## Écrans à développer (V2)

- `InvoicesScreen` — liste + création de factures
- `ClientsScreen` — annuaire clients avec recherche
- `PayslipScreen` — bulletins de paie
- `CRMScreen` — pipeline commercial
- `OfflineScreen` — mode hors-ligne avec sync

## Build production

```bash
# Android (APK)
eas build --platform android --profile preview

# iOS (TestFlight)
eas build --platform ios --profile preview
```

## Configuration API

Variable d'environnement `EXPO_PUBLIC_API_URL` dans `.env.local` :
```
EXPO_PUBLIC_API_URL=https://votre-domaine.ne
```
