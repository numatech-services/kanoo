import { NextRequest } from "next/server";
import { BusinessRuleError } from "@/lib/errors";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, paymentRequired, serverError } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { TenantModel } from "@/models/Tenant";
import { ProductModel } from "@/models/Product";
import { tenantAi, aiErrorMessage } from "@/lib/ai-client";
import { draftQuote, BRIEF_MAX, CATALOGUE_MAX, type CatalogueItem } from "@/lib/ai-devis";
import { reserveAiCredit, refundAiCredit, readAiQuota } from "@/lib/ai-quota";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET — Claude est-il branché pour l'organisation, et combien de crédits restent ce mois-ci ? */
export const GET = withAuth("devis", "create", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const ai = await tenantAi(auth.tenantId);
  return ok({ configured: Boolean(ai), source: ai?.source ?? null, quota: await readAiQuota(auth.tenantId) });
});

/**
 * POST { brief, docKind } — propose objet, lignes et conditions d'un devis ou
 * d'une proforma (lib/ai-devis). Rien n'est enregistré. Un crédit du plafond
 * mensuel est réservé avant l'appel et rendu en cas d'échec.
 */
export const POST = withAuth("devis", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const ai = await tenantAi(auth.tenantId);
  if (!ai) return paymentRequired("Assistant Claude non activé : l'administrateur doit enregistrer une clé d'API dans Réglages → Assistant Claude.");
  const body = await req.json().catch(() => ({}));
  const brief = String(body.brief ?? "").trim();
  if (brief.length < 10) return badRequest("Décrivez le besoin en une ou deux phrases au moins.");
  if (brief.length > BRIEF_MAX) return badRequest(`Demande trop longue (${BRIEF_MAX} caractères au plus).`);
  const docKind = body.docKind === "proforma" ? "proforma" : "devis";

  const reservation = await reserveAiCredit(auth.tenantId);
  if (!reservation.ok) return paymentRequired(`Plafond mensuel de l'assistant atteint (${reservation.state.quota}). Il est remis à zéro le 1er du mois prochain.`);
  try {
    const [tenant, products] = await Promise.all([
      TenantModel.findById(auth.tenantId).select("name branding.defaultTerms").lean<{ name?: string; branding?: { defaultTerms?: string } } | null>(),
      ProductModel.find({ tenantId: auth.tenantId, isActive: { $ne: false } }).select("code label unit unitPrice tvaRate")
        .sort({ updatedAt: -1 }).limit(CATALOGUE_MAX).lean<Array<{ _id: unknown; code: string; label: string; unit?: string; unitPrice: number; tvaRate?: number }>>(),
    ]);
    const catalogue: CatalogueItem[] = products.map(p => ({ ...p, _id: String(p._id) }));
    const draft = await draftQuote(ai, { brief, docKind, orgName: tenant?.name || "l'entreprise", catalogue, defaultTerms: tenant?.branding?.defaultTerms });
    await logAudit(auth, "CREATE", "devis", { metadata: { ai: "quote_draft", model: draft.model, source: ai.source, lines: draft.lines.length } });
    return ok({ ...draft, quota: reservation.state });
  } catch (err) {
    await refundAiCredit(auth.tenantId, reservation.state.month);
    const msg = aiErrorMessage(err);
    if (msg) return badRequest(msg);
    // Refus métier (lib/ai-devis) : son message ; tout le reste reste interne.
    if (err instanceof BusinessRuleError) return badRequest(err.message);
    return serverError(err);
  }
});
