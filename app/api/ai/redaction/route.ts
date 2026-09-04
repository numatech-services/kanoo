import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, paymentRequired, serverError } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { TenantModel } from "@/models/Tenant";
import { generateDraft, isAiConfigured, DraftKind } from "@/lib/ai";
import { gatherReportContext } from "@/lib/ai-context";
import { reserveAiCredit, refundAiCredit, readAiQuota } from "@/lib/ai-quota";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const KINDS: DraftKind[] = ["courrier", "rapport", "attestation", "note", "reponse_ao", "autre"];

/**
 * GET /api/ai/redaction — état de l'assistant pour l'organisation :
 * disponibilité (clé configurée) et quota mensuel restant.
 */
export const GET = withAuth("documents", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const quota = await readAiQuota(auth.tenantId);
  return ok({ configured: isAiConfigured(), quota });
});

/**
 * POST /api/ai/redaction — génère un premier jet de courrier ou de rapport.
 *
 * Le crédit du quota mensuel est **réservé avant** l'appel à l'IA et **remboursé**
 * si la génération échoue : deux requêtes simultanées ne peuvent pas dépasser le
 * plafond, et un échec ne consomme pas de crédit.
 */
export const POST = withAuth("documents", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();

  if (!isAiConfigured()) {
    return paymentRequired("Assistant IA non activé sur cette instance. Contactez le support.");
  }

  const body = await req.json().catch(() => ({}));
  const subject = String(body.subject || "").trim();
  if (!subject) return badRequest("L'objet est requis pour rédiger un document.");

  const kind: DraftKind = KINDS.includes(body.kind) ? body.kind : "courrier";
  const instructions = String(body.instructions || "").slice(0, 4000);

  // ── Réservation du quota ────────────────────────────────────────────────
  const reservation = await reserveAiCredit(auth.tenantId);
  if (!reservation.ok) {
    return paymentRequired(
      `Quota IA mensuel atteint (${reservation.state.quota} générations). Il repart au 1er du mois prochain.`
    );
  }

  try {
    const tenant = await TenantModel.findById(auth.tenantId).select("name").lean<{ name?: string } | null>();

    // Chiffres agrégés : uniquement pour un rapport d'activité.
    const report = kind === "rapport" ? await gatherReportContext(auth) : null;

    const result = await generateDraft({
      kind,
      subject: subject.slice(0, 300),
      recipient: String(body.recipient || "").slice(0, 600),
      place: String(body.place || "").slice(0, 120),
      signatory: String(body.signatory || "").slice(0, 200),
      instructions,
      org: {
        name: tenant?.name || "l'organisation",
        type: auth.tenantType,
        stats: report?.stats,
        period: report?.period,
      },
    });

    await logAudit(auth, "CREATE", "documents", {
      metadata: { ai: true, kind, model: result.model, usedReport: Boolean(report) },
    });

    return ok({
      body: result.body,
      usedReport: Boolean(report),
      quota: { ...reservation.state },
    });
  } catch (err) {
    // L'appel IA a échoué : on rend le crédit réservé.
    await refundAiCredit(auth.tenantId, reservation.state.month);
    return serverError(err);
  }
});
