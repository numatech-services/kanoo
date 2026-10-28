import { NextRequest, NextResponse } from "next/server";
import { isInternFor, INTERN_EXPORT_MESSAGE } from "@/lib/role-resources";
import { withAuth, forbidden, notFound, badRequest } from "@/lib/api-helpers";
import { statementPdf } from "@/lib/statement-pdf";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";

export const dynamic = "force-dynamic";

/**
 * GET /api/clients/:id/releve/pdf — le relevé, prêt à envoyer.
 *
 * Le document reprend **exactement** le calcul de l'écran : même moteur, mêmes
 * signes, même solde d'ouverture. Un PDF qui recalculerait de son côté finirait
 * par afficher un autre solde que l'écran, et c'est le client qui le
 * découvrirait.
 */
export const GET = withAuth("clients", "read", async (req: NextRequest, auth: TokenPayload, params) => {
  // Stagiaire : ni export ni envoi de fichier (règle commune).
  if (isInternFor(auth, "clients")) return forbidden(INTERN_EXPORT_MESSAGE);
  // Relevé de compte = factures et règlements : réservé à qui lit les factures.
  if (!authCan(auth, "invoices", "read")) return forbidden("Relevé réservé à la comptabilité et au gérant.");
  const url = new URL(req.url);
  const now = new Date();
  const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : new Date(now.getFullYear(), 0, 1);
  const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return badRequest("Période invalide.");
  const r = await statementPdf(auth.tenantId, String(params.id), from, to);
  if (!r) return notFound("Client introuvable");

  await logAudit(auth, "EXPORT", "clients", {
    resourceId: String(params.id),
    metadata: { document: "releve", from: from.toISOString(), to: to.toISOString() },
  });

  return new NextResponse(new Uint8Array(r.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${r.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
