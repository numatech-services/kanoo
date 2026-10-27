/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Next.js 16 : paquets serveur laissés hors du bundle (pdfkit lit ses polices sur disque).
  serverExternalPackages: ["pdfkit"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
    workerThreads: false,
    cpus: 1,
  },

  // Les deux garde-fous sont rétablis : ils masquaient 116 erreurs de type et
  // l'absence totale de configuration ESLint. Une régression de type doit
  // casser le build, pas atteindre la production.
  typescript: {
    ignoreBuildErrors: false,
  },
  // Next.js 16 ne lance plus ESLint au build : « npm run lint » le fait à part
  // (et « npm run verify » enchaîne types, lint, tests et build).

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
      // La Content-Security-Policy est posée par le proxy (proxy.ts), avec un
      // nonce neuf à chaque requête : une valeur statique ici ne pourrait pas
      // en porter (lib/csp.ts).
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

// Build sans cache webpack persistant (KANOO_BUILD_NO_CACHE=1) : le cache
// (.next/cache, environ 1 Go) remplissait le disque des postes à court
// d'espace. Sans effet sur Hostinger, qui ne définit pas la variable.
if (process.env.KANOO_BUILD_NO_CACHE === "1") {
  nextConfig.webpack = (config) => {
    config.cache = false;
    return config;
  };
}

export default nextConfig;
