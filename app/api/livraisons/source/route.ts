import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { TokenPayload } from "@/lib/auth";

import { deliveredByLine, remainingLines } from "@/lib/deliveries";
export const dynamic = "force-dynamic";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * GET /api/livraisons/source?number=FAC-2026-0012
 *
 * Ce dont un bon de livraison a besoin, et rien de plus : client, adresse et
 * articles (désignation, quantité, unité) d'une facture émise. Aucun montant,
 * aucun état de paiement — le service Administration prépare les livraisons
 * sans accéder aux factures, réservées à la comptabilité.
 */
export const GET = withAuth("livraisons", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const number = (new URL(req.url).searchParams.get("number") || "").trim().slice(0, 60);
  if (!number) return badRequest("Numéro de facture requis.");
  const inv = await InvoiceModel.findOne({
    ...tenantFilter(auth),
    number: { $regex: `^${escapeRegex(number)}$`, $options: "i" },
    documentType: { $ne: "credit_note" },
  })
    .populate("clientId", "name address")
    .select("number status clientId lines.description lines.quantity lines.unit lines.productId")
    .lean<{
      _id: unknown; number: string; status: string;
      clientId?: { _id: unknown; name?: string; address?: string } | null;
      lines?: Array<{ description?: string; quantity?: number; unit?: string; productId?: unknown }>;
    } | null>();
  if (!inv) return notFound("Facture introuvable. Vérifiez le numéro.");
  if (!["sent", "partial", "paid"].includes(inv.status)) {
    return badRequest("Cette facture n'est pas encore émise : un bon de livraison ne peut pas être créé.");
  }
  return ok({
    invoiceId: inv._id,
    number: inv.number,
    client: inv.clientId ? { _id: inv.clientId._id, name: inv.clientId.name, address: inv.clientId.address } : null,
    // Reste à livrer par ligne : la quantité proposée est ce qui n'a pas encore été livré.
    lines: remainingLines(inv.lines ?? [], await deliveredByLine(auth.tenantId, inv._id))
      .filter(l => l.remaining > 0)
      .map(l => ({ ...l, ordered: l.quantity, quantity: l.remaining })),
    fullyDelivered: remainingLines(inv.lines ?? [], await deliveredByLine(auth.tenantId, inv._id)).every(l => l.remaining <= 0),
  });
});
