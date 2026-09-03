import { NextRequest } from "next/server";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/invoices/:id/litige
 *
 * Ouvre ou clôt un litige. Un litige ouvert suspend les relances automatiques :
 * continuer à réclamer une facture que le client conteste transforme un
 * désaccord sur une ligne en conflit sur la relation entière.
 *
 *   { open: true, reason: "…" }  ouvre
 *   { open: false }              clôt et rend la facture au barème
 */
export const POST = withAuth("invoices", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json().catch(() => ({}));
  const open = body.open !== false;

  const invoice = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!invoice) return notFound("Facture introuvable");

  if (open) {
    const reason = String(body.reason || "").trim();
    // Sans motif, le litige devient un moyen commode de faire taire une
    // relance — et personne ne sait plus, trois mois après, ce qui était
    // contesté.
    if (!reason) return badRequest("Indiquez ce que le client conteste.");
    invoice.disputedAt = new Date();
    invoice.disputeReason = reason;
  } else {
    invoice.disputedAt = undefined;
    invoice.disputeReason = undefined;
  }
  await invoice.save();

  await logAudit(auth, "UPDATE", "invoices", {
    resourceId: String(params.id),
    metadata: { module: "litige", open, reason: body.reason },
  });

  return ok({
    disputedAt: invoice.disputedAt,
    disputeReason: invoice.disputeReason,
    message: open
      ? "Litige ouvert : les relances automatiques sont suspendues sur cette facture."
      : "Litige clos : la facture reprend sa place dans le barème de relance.",
  });
});
