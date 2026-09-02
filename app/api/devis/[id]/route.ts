import { NextRequest } from "next/server";
import { withAuth, ok, badRequest, notFound, conflict, tenantFilter } from "@/lib/api-helpers";
import { DevisModel } from "@/models/Devis";
import { InvoiceModel } from "@/models/Invoice";
import { calculerTVA, calculerDTS, genererNumeroFacture } from "@/lib/niger-fiscal";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("devis", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const d = await DevisModel.findOne({ _id: params.id, ...tenantFilter(auth) }).populate("clientId", "name code nif").lean();
  if (!d) return notFound(); return ok(d);
});
export const PATCH = withAuth("devis", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  const d = await DevisModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, body, { new: true });
  if (!d) return notFound(); return ok(d);
});

// POST /api/devis/:id/convert — transformer en facture
export const POST = withAuth("devis", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  const devis = await DevisModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!devis) return notFound("Devis introuvable");
  if (devis.status !== "accepted") return badRequest("Seuls les devis acceptés peuvent être convertis");
  if (devis.convertedToInvoiceId) return conflict("Ce devis a déjà été converti en facture");
  const year = new Date().getFullYear();
  const count = await InvoiceModel.countDocuments({ tenantId: auth.tenantId });
  const number = genererNumeroFacture(year, count + 1);
  const totalDTS = calculerDTS(devis.totalTTC);
  const invoice = await InvoiceModel.create({
    tenantId: auth.tenantId, number, clientId: devis.clientId, quoteId: devis._id,
    lines: devis.lines, totalHT: devis.totalHT, totalTVA: devis.totalTVA,
    totalDTS, totalTTC: devis.totalTTC + totalDTS, paidAmount: 0,
    status: "draft", issueDate: new Date(),
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    createdBy: auth.userId,
  });
  devis.convertedToInvoiceId = invoice._id;
  devis.status = "accepted";
  await devis.save();
  await logAudit(auth, "UPDATE", "devis", { resourceId: params.id, after: { convertedTo: invoice._id } });
  return ok({ invoice, message: "Devis converti en facture avec succès" });
});
