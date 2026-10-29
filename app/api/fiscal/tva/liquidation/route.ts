import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden, tenantFilter } from "@/lib/api-helpers";
import { FiscalDeclarationModel } from "@/models/FiscalDeclaration";
import { isInternFor } from "@/lib/role-resources";
import { settleVatMonth } from "@/lib/vat-settlement-server";
import { TokenPayload } from "@/lib/auth";

/**
 * POST { annee, mois } — passe (ou repasse) la liquidation de la TVA d'un mois
 * déjà déclaré, sans toucher à la déclaration (pas de motif de rectification
 * à inventer pour réessayer après un refus).
 */
export const POST = withAuth("fiscalDeclarations", "update", async (req: NextRequest, auth: TokenPayload) => {
  if (isInternFor(auth, "fiscalDeclarations")) return forbidden("Réservé au comptable et à la direction.");
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const annee = Number(body.annee), mois = Number(body.mois);
  if (!Number.isInteger(annee) || !Number.isInteger(mois) || mois < 1 || mois > 12) return badRequest("Période invalide.");
  const decl = await FiscalDeclarationModel.findOne({ ...tenantFilter(auth), type: "tva", "period.annee": annee, "period.mois": mois, status: { $in: ["submitted", "paid"] } })
    .sort({ updatedAt: -1 }).select("_id").lean<{ _id: unknown } | null>();
  if (!decl) return badRequest("Enregistrez d'abord la déclaration du mois.");
  const r = await settleVatMonth(auth, annee, mois, decl._id);
  if (r.warning) return badRequest(r.warning);
  return ok(r.settlement);
});
