# Benchmark UX/Produit — 10 SaaS de gestion d'associations, ONG & billetterie

> Synthèse de sources éditeurs + comparateurs (Capterra, SoftwareAdvice, Liasso, SimpleTix) consultées en 2025-2026.
> Les faits prix/sécurité/fonctions sont sourcés (URLs en fin). Distinction *standard de marché* vs *réellement différenciant*.

## 1) Tableau comparatif

| Plateforme | Design | UX | Fonctions clés | Billetterie / Check-in | Sécurité | Accessibilité / Perf | Différenciateur premium |
|---|---|---|---|---|---|---|---|
| **CiviCRM** | Austère, Bootstrap-like, dépend du CMS ; pas de dark mode | Courbe forte, onboarding quasi nul | Membres illimités, cotisations, dons/campagnes, e-mailing, événements | CiviEvent : inscriptions, tarifs ; QR/check-in via extensions | 2FA via extension, auto-hébergement (souveraineté) | Pas de PWA officielle ; perf = hébergeur | **Souveraineté totale des données** + open source |
| **WildApricot** | Templates clé-en-main vieillissants ; pas de dark mode | Onboarding assisté, orienté non-tech | Base membres, renouvellements auto, site + espace membre, dons | Billetterie intégrée, app mobile membre, check-in basique | **2FA admin (TOTP)**, RGPD, sauvegardes | App mobile ; WCAG non certifié | **All-in-one « site + adhésions »** sans code |
| **Odoo Community** | **Design system OWL** moderne, cohérent ; dark mode partiel | Onboarding modulaire, UX homogène | Membres, Événements, Site, e-mail, CRM, compta, POS | Events : billets, badges/QR, check-in via app | 2FA natif, ACL, chiffrement | Front OWL performant ; PWA back-office | **Écosystème modulaire unifié** au coût le plus bas |
| **Raklet** | UI moderne, app marque blanche | Onboarding guidé, simple | CRM, cotisations, dons, **e-mail + SMS**, événements | Billetterie + **check-in QR via app** | 2FA, RGPD | App membre marque blanche | **App marque blanche** + SMS intégré |
| **Glue Up** | UI premium event-centric ; 2 apps | Onboarding accompagné, dashboards riches | CRM, adhésions, **automation e-mail**, events, IA | Billetterie + **app organisateur scan/check-in** | 2FA, SSO (offres hautes), RGPD | Apps natives membre + manager | **Suite engagement** + apps natives doubles |
| **Eventbrite** | **Design system « Eds »**, orange #F05537, très abouti | UX grand public exemplaire | Billetterie pro, codes promo, marketing, découverte 90M | **Référence** : QR, **app Organizer scan + vente sur place + stats live + remboursement in-app** | 2FA, PCI, RGPD | Apps natives ; forte perf | **Distribution/découverte** + app check-in de référence |
| **HelloAsso** | UI FR claire, chaleureuse ; app Scan dédiée | UX bénévoles zéro-friction ; **gratuit** | Adhésions, dons, billetterie, paiement CB, confirmations auto | **HelloAsso Scan** : QR, **offline + sync**, **10 appareils**, dashboard live, remboursement back-office | Paiement sécurisé, RGPD UE | App Scan iOS/Android | **100% gratuit** (pourboire) — l'asso touche tout |
| **Bitrix24** | UI dense intranet/CRM ; **dark mode** | Puissant mais chargé | CRM, tâches, téléphonie, e-mail+chat+visio, automations | Pas de billetterie native premium | **2FA OTP, sessions, chiffrement, biométrie mobile, journaux** | Apps robustes ; sécurité mobile | **Suite collaborative + CRM + téléphonie** |
| **Bettermode** (ex-Tribe) | **Design system très soigné, dark mode**, marque blanche | UX communautaire premium, no-code par blocs | Espaces, discussions, Q&A, gamification, widgets | Pas de billetterie (communautaire) | **SSO JWT/OAuth/SAML**, 2FA | PWA/responsive ; a11y soignée | **Communauté « design-first »** + SSO natif |
| **MemberPress** | Hérité du thème WP ; pas de dark mode propre | Assistant WP, dashboards revenus | Adhésions payantes, **paywall**, abonnements, LMS | Événements via plugins (pas natif) | 2FA (WP), Stripe/PayPal (PCI), RGPD | Dépend du thème | **Monétisation de contenu / paywall** + LMS |

## 2) Synthèse

### 5 meilleures pratiques UI/UX à reprendre
1. **Design system unifié piloté par tokens** (Eventbrite « Eds » / Odoo OWL) → *Numapilot* : Tailwind + tokens CSS, thème clair/sombre dès le départ, accent par organisation. **(fait — DA Harmattan v3)**
2. **Onboarding « time-to-value » minimal** (Eventbrite : événement en minutes) → assistant de création < 5 min avec presets par profil.
3. **Double app membre + organisateur (PWA)** (Glue Up) → PWA membre (carte, billets) + vue admin terrain mobile.
4. **Feedback & dashboards temps réel** (HelloAsso Scan) → compteurs live, états optimistes, toasts systématiques. **(fait — check-in live + toasts)**
5. **Builder no-code par blocs** (Bettermode) → éditeur de page d'organisation, pages statiques Next.js.

### 5 meilleures fonctionnalités à intégrer
1. **Billetterie + check-in QR hors-ligne multi-appareils** (HelloAsso) → scan PWA offline (IndexedDB + sync) — critique en connectivité intermittente. **(cœur livré ; offline PWA = phase suivante)**
2. **Communication multicanale e-mail + SMS + WhatsApp** (Raklet) → WhatsApp Business API + SMS locaux + e-mail transactionnel.
3. **Paiement adapté + cotisations récurrentes** → Mobile Money (Orange/Wave/MTN) + carte, relances auto.
4. **Contrôle d'accès / paywall par niveau d'adhésion** (MemberPress, Bettermode).
5. **Automations cycle de vie membre** (Glue Up) → bienvenue, relance cotisation, rappel J-1 WhatsApp.

### 3 innovations sécurité à adopter
1. **2FA/MFA + passkeys (WebAuthn)** pour les rôles admin (évite la dépendance SMS).
2. **SSO fédéré OAuth2/OIDC + SAML** pour grandes ONG/administrations, JWT courts + refresh rotatif.
3. **Souveraineté + consentements horodatés** : hébergement régional, chiffrement au repos, registre de consentements, export/suppression RGPD en un clic.

## 3) Focus billetterie & check-in — Eventbrite vs HelloAsso

| Critère | Eventbrite | HelloAsso |
|---|---|---|
| Billets | Types multiples, places réservées, codes promo | Multi-tarifs, adhésion+billet |
| QR | QR contactless | QR unique anti-contrefaçon |
| Scan mobile | App Organizer | App HelloAsso Scan |
| **Hors-ligne** | Peu mis en avant | **Oui — offline + sync** |
| **Multi-appareils** | Oui | **Jusqu'à 10 smartphones** |
| Présences live | Dashboard live | Dashboard live |
| Vente sur place | **Oui (paiement jour J)** | Non natif |
| Remboursements | App ; frais conservés | Back-office ; 100% perçu |
| Modèle éco. | ~3,7% + 1,79$/billet | **Gratuit (pourboire)** |

### 10 exigences d'un module billetterie premium
1. **QR signé cryptographiquement** (HMAC/JWT par billet) — validation locale sans réseau. **(fait — HMAC-SHA256)**
2. **Scan PWA 100% hors-ligne** : cache billets en IndexedDB + file de sync. *(phase suivante)*
3. **Multi-appareils** avec détection de double-scan quasi temps réel. **(détection « déjà pointé » livrée)**
4. **Types de billets flexibles** : gratuit/payant, quotas, codes promo, nominatifs. **(types + quotas livrés)**
5. **Paiement local intégré** : Mobile Money + carte + espèces. *(phase suivante)*
6. **Vente & encaissement sur place** dans l'app organisateur. *(phase suivante)*
7. **Dashboard présences temps réel** (vendus / scannés / restants). **(stats présences livrées)**
8. **Envoi multicanal** : e-mail + WhatsApp + SMS, renvoi 1 clic, wallet. *(phase suivante)*
9. **Remboursements paramétrables** par événement. *(phase suivante)*
10. **Anti-fraude** : rôles agents de porte, journaux, invalidation à distance. **(RBAC + audit livrés ; invalidation = phase suivante)**

## Sources
EDICOM, DGI e-SECeF ; CiviCRM ; WildApricot (sécurité/2FA) ; Odoo OWL ; Raklet ; Glue Up ; Eventbrite (check-in/remboursements/prix) ; HelloAsso (Scan/gratuit) ; Bitrix24 (sécurité mobile) ; Bettermode (SSO) ; MemberPress. (URLs détaillées disponibles sur demande — collectées 2024-2026.)
