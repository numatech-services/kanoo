import { NextRequest } from "next/server";
import { withAuth, ok, badRequest, notFound } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const GET = withAuth("companies", "read", async (_req: NextRequest, auth: TokenPayload) => {
  const t = await TenantModel.findById(auth.tenantId)
    .select("name logo branding nif rccm address phone email").lean();
  if (!t) return notFound();
  return ok(t);
});

const HEX = /^#[0-9a-fA-F]{6}$/;
/** Un logo raisonnable en data-URI reste sous ~700 Ko encodés. */
const MAX_LOGO = 700_000;

/**
 * PATCH /api/company/branding — personnalisation des documents.
 *
 * L'ancienne version ne sauvegardait que logo + deux couleurs. Elle est
 * élargie à tout ce qui habille une facture, un devis ou un courrier : slogan,
 * mentions légales de pied de page, instructions de paiement, conditions par
 * défaut, disposition de l'en-tête, et l'apposition d'un QR. Chaque champ est
 * validé et borné : ce contenu finit imprimé sur des documents envoyés à des
 * tiers.
 */
export const PATCH = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json().catch(() => ({}));
  const set: Record<string, unknown> = {};

  if (body.logo !== undefined) {
    const logo = String(body.logo || "");
    if (logo.length > MAX_LOGO) return badRequest("Logo trop lourd (700 Ko maximum). Réduisez l'image.");
    set.logo = logo || undefined;
  }

  for (const [key, field] of [["primaryColor", "branding.primaryColor"], ["secondaryColor", "branding.secondaryColor"]] as const) {
    if (body[key] !== undefined) {
      const v = String(body[key]);
      if (!HEX.test(v)) return badRequest(`Couleur invalide (${key}) : format attendu #RRGGBB.`);
      set[field] = v;
    }
  }

  const text = (v: unknown, max: number) => String(v ?? "").slice(0, max);
  if (body.tagline !== undefined) set["branding.tagline"] = text(body.tagline, 120);
  if (body.legalFooter !== undefined) set["branding.legalFooter"] = text(body.legalFooter, 500);
  if (body.paymentInstructions !== undefined) set["branding.paymentInstructions"] = text(body.paymentInstructions, 500);
  if (body.defaultTerms !== undefined) set["branding.defaultTerms"] = text(body.defaultTerms, 1000);
  if (body.showLogo !== undefined) set["branding.showLogo"] = Boolean(body.showLogo);
  if (body.documentQr !== undefined) set["branding.documentQr"] = Boolean(body.documentQr);
  if (body.headerLayout !== undefined) {
    set["branding.headerLayout"] = body.headerLayout === "centered" ? "centered" : "left";
  }

  if (Object.keys(set).length === 0) return badRequest("Aucune modification.");

  const t = await TenantModel.findByIdAndUpdate(auth.tenantId, { $set: set }, { new: true })
    .select("name logo branding nif rccm address phone email").lean();
  if (!t) return notFound();
  return ok(t);
});
