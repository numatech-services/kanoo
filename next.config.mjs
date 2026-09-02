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

  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
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
      // CSP en Report-Only d'abord : n'impacte pas le rendu, permet d'observer
      // les violations avant de passer en application stricte.
      {
        key: "Content-Security-Policy-Report-Only",
        value:
          "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; " +
          "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
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
