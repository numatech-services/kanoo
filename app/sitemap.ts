import type { MetadataRoute } from "next";

/**
 * sitemap.xml — les pages publiques indexables. Les écrans applicatifs
 * (authentifiés) n'y figurent pas : ils n'ont ni valeur SEO ni vocation à être
 * explorés.
 */
const BASE = process.env.APP_BASE_URL || "https://numapilot.numatechservices.net";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ["", "/fonctionnalites", "/tarifs", "/a-propos", "/contact", "/demo"].map(path => ({
    url: `${BASE}${path}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: path === "" ? 1 : 0.7,
  }));
}
