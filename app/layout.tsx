import type { Metadata } from "next";
import { cookies } from "next/headers";
import "@/styles/globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import { DialogHost } from "@/components/ui/Dialogs";
import { CookieConsent } from "@/components/shared/CookieConsent";
import { I18nProvider } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";

// Charte « Numatech » (maquettes v5) : Plus Jakarta Sans pour tout le texte,
// JetBrains Mono pour les numéros de pièces, Caveat pour la touche manuscrite
// du bandeau d'accueil. Chargées via <link> (compatible avec un build hors
// ligne ; les polices arrivent côté navigateur).
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&family=Caveat:wght@500;600&display=swap";

const THEME_BOOT = "try{var t=localStorage.getItem('kanoo.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}";

export const metadata: Metadata = {
  title: { default: "Kanoo — Gestion d'entreprise Niger", template: "%s | Kanoo" },
  description: "Plateforme SaaS de gestion pour PME, Associations et Administrations au Niger",
  keywords: ["gestion", "comptabilité", "Niger", "PME", "associations", "ERP", "SaaS"],
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Kanoo" },
};

export const viewport = {
  themeColor: "#2F59DF",
  width: "device-width",
  initialScale: 1,
  // Pas de maximumScale : bloquer le zoom empêche de grossir le texte (WCAG 1.4.4).
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Lire la locale depuis le cookie (défaut : fr)
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("NEXT_LOCALE")?.value;
  const locale: Locale = localeCookie === "en" ? "en" : "fr";
  // La page reste déclarée en français (lang="fr") : l'interface n'est rédigée
  // qu'en français ; annoncer « en » trompait les lecteurs d'écran.

  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        {/*
          CSP posée en balise <meta>, et non seulement par en-tête HTTP.

          Le CDN d'Hostinger (server: hcdn) remplace l'en-tête
          Content-Security-Policy de l'application par sa propre
          « upgrade-insecure-requests », annulant notre politique. Le CDN ne
          réécrit en revanche pas le corps HTML : une CSP en <meta> est donc
          appliquée par le navigateur quoi que fasse l'edge.

          `frame-ancestors` et `report-uri` ne sont pas gérés en <meta> — le
          premier reste couvert par l'en-tête X-Frame-Options: DENY, qui, lui,
          traverse le CDN. Les autres directives (sources de scripts, styles,
          polices, connexions, formulaires) sont bien restaurées ici.
        */}
        <meta
          httpEquiv="Content-Security-Policy"
          content={
            "default-src 'self'; img-src 'self' data: blob:; " +
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
            "font-src 'self' https://fonts.gstatic.com data:; " +
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; " +
            "base-uri 'self'; form-action 'self'"
          }
        />
        {/* Thème choisi à la main (clair / sombre), appliqué avant le premier
            rendu pour éviter un éclair du mauvais thème. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS_HREF} />
      </head>
      <body className="bg-bg text-ink antialiased" suppressHydrationWarning>
        <I18nProvider initialLocale={locale}>
          <ToastProvider>
            {children}
            <DialogHost />
            <CookieConsent />
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
