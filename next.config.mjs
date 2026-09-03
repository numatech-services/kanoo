/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Next.js 14 : la clé s'appelle "serverComponentsExternalPackages" (dans experimental)
  experimental: {
    serverComponentsExternalPackages: ["pdfkit"],
    optimizePackageImports: ["lucide-react", "@radix-ui/react-icons"],
    workerThreads: false,
    cpus: 1,
  },

  // Les deux garde-fous sont rétablis : ils masquaient 116 erreurs de type et
  // l'absence totale de configuration ESLint. Une régression de type doit
  // casser le build, pas atteindre la production.
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
    dirs: ["app", "components", "lib", "models", "scripts"],
  },

  images: {
    formats: ["image/webp", "image/avif"],
    minimumCacheTTL: 86400,
    deviceSizes: [360, 480, 640, 750, 828, 1080],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    dangerouslyAllowSVG: false,
    contentDispositionType: "attachment",
    // Aucune image distante utilisée : aucun hôte externe autorisé (évite le
    // SSRF via l'optimiseur d'images). Ajouter les hôtes réels ici si besoin.
    remotePatterns: [],
  },

  async headers() {
    const securityHeaders = [
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      // CSP désormais APPLIQUÉE (et non plus Report-Only). Elle restait inerte :
      // Report-Only sans report-uri n'observe rien et ne protège rien. Deux
      // ajustements l'ont rendue applicable sans casser le rendu :
      //   • style-src et font-src autorisent Google Fonts (fonts.googleapis.com
      //     et fonts.gstatic.com) — la police Fraunces en dépend ; sans ça,
      //     l'application stricte serait retombée sur les polices système.
      //   • frame-ancestors 'none' double le X-Frame-Options: DENY contre le
      //     clickjacking, et form-action 'self' empêche l'exfiltration d'un
      //     formulaire vers un domaine tiers.
      // 'unsafe-inline'/'unsafe-eval' restent tolérés (Next.js hydrate par
      // scripts inline) : la CSP protège ici surtout du chargement de
      // ressources et du cadrage tiers, l'échappement JSX couvrant le XSS.
      {
        key: "Content-Security-Policy",
        value:
          "default-src 'self'; img-src 'self' data: blob:; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' https://fonts.gstatic.com data:; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; " +
          "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" +
          (process.env.CSP_REPORT_URI ? `; report-uri ${process.env.CSP_REPORT_URI}` : ""),
      },
    ];
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.json",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      },
    ];
  },

  compress: false,

  env: {
    APP_VERSION: "1.0.0",
  },
};

export default nextConfig;
