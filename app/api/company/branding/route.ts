import { isDocStyle } from "@/lib/pdf-business";
import { NextRequest } from "next/server";
import { logAudit } from "@/lib/audit";
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
  if (body.documentStyle !== undefined) set["branding.documentStyle"] = isDocStyle(body.documentStyle) ? body.documentStyle : "prestige";
  if (body.legalForm !== undefined) set["branding.legalForm"] = text(body.legalForm, 160);
  if (body.city !== undefined) set["branding.city"] = text(body.city, 80);
  if (body.website !== undefined) set["branding.website"] = text(body.website, 120);
  if (body.extraIds !== undefined) set["branding.extraIds"] = text(body.extraIds, 160);
  if (body.signatoryName !== undefined) set["branding.signatoryName"] = text(body.signatoryName, 100);
  if (body.signatoryTitle !== undefined) set["branding.signatoryTitle"] = text(body.signatoryTitle, 80);
  if (body.clientApproval !== undefined) set["branding.clientApproval"] = body.clientApproval === null ? undefined : Boolean(body.clientApproval);
  if (body.stamp !== undefined) {
    const stamp = String(body.stamp || "");
    if (stamp && !/^data:image\/(png|jpe?g);base64,/i.test(stamp)) return badRequest("Cachet : image PNG ou JPEG attendue.");
    if (stamp.length > MAX_LOGO) return badRequest("Cachet trop lourd (700 Ko maximum). Réduisez l'image.");
    set["branding.stamp"] = stamp || undefined;
  }
  if (body.headerLayout !== undefined) {
    set["branding.headerLayout"] = body.headerLayout === "centered" ? "centered" : "left";
  }

  if (Object.keys(set).length === 0) return badRequest("Aucune modification.");

  const t = await TenantModel.findByIdAndUpdate(auth.tenantId, { $set: set }, { new: true })
    .select("name logo branding nif rccm address phone email").lean();
  if (!t) return notFound();
  // Cachet et signataire engagent l'entreprise sur chaque document envoyé : tracés (sans l'image).
  await logAudit(auth, "UPDATE", "companies", {
    resourceId: auth.tenantId,
    metadata: { branding: Object.keys(set).map(k => k.replace("branding.", "")), ...("branding.stamp" in set ? { stamp: set["branding.stamp"] ? "remplacé" : "retiré" } : {}) },
  });
  return ok(t);
});
