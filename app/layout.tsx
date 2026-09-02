import type { Metadata } from "next";
import { cookies } from "next/headers";
import "@/styles/globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import { SearchCommand } from "@/components/shared/SearchCommand";
import { CookieConsent } from "@/components/shared/CookieConsent";
import { I18nProvider } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n";

// Direction « Harmattan » : Fraunces (titres) + Hanken Grotesk (texte), chargées
// via <link> (compatible avec un build hors-ligne ; les polices arrivent côté
// navigateur). En CI avec réseau, next/font/google est une alternative valable.
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,500&family=Hanken+Grotesk:wght@400;500;600;700&display=swap";

export const metadata: Metadata = {
  title: { default: "Kanoo — Gestion d'entreprise Niger", template: "%s | Kanoo" },
  description: "Plateforme SaaS de gestion pour PME, Associations et Administrations au Niger",
  keywords: ["gestion", "comptabilité", "Niger", "PME", "associations", "ERP", "SaaS"],
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Kanoo" },
};

export const viewport = {
  themeColor: "#C2620E",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Lire la locale depuis le cookie (défaut : fr)
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("NEXT_LOCALE")?.value;
  const locale: Locale = localeCookie === "en" ? "en" : "fr";

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONTS_HREF} />
      </head>
      <body className="bg-bg text-ink antialiased" suppressHydrationWarning>
        <I18nProvider initialLocale={locale}>
          <ToastProvider>
            <SearchCommand />
            {children}
            <CookieConsent />
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
