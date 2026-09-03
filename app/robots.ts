import type { MetadataRoute } from "next";

/**
 * robots.txt — servi à /robots.txt.
 *
 * N'était pas fourni : les robots recevaient une redirection 307 vers /login,
 * ce qui empêche l'indexation. On autorise l'exploration des pages publiques et
 * on ferme l'espace applicatif (aucune valeur SEO, et données privées).
 */
const BASE = process.env.APP_BASE_URL || "https://numapilot.numatechservices.net";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/dashboard", "/associations", "/administration", "/saas", "/portail", "/settings"],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
