import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { ProjectModel } from "@/models/Project";
import { InvoiceModel } from "@/models/Invoice";
import { calculerTVA, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";
import { provisionalNumber } from "@/lib/numbering";
import { authCan, hasFinanceAccess } from "@/lib/role-resources";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/**
 * POST { tvaRate? } — facture (brouillon) d'un jalon « à facturer » du projet,
 * pour son client. Le jalon garde le lien vers sa facture : il ne se facture
 * qu'une fois. Les montants affichés « à facturer » n'aboutissaient à rien.
 */
export const POST = withAuth("projects", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  if (!authCan(auth, "invoices", "create") || !hasFinanceAccess(auth)) return forbidden("Facturation réservée à la comptabilité et au gérant.");
  await connectDB();
  if (!Types.ObjectId.isValid(params.id) || !Types.ObjectId.isValid(params.milestoneId)) return notFound();
  const body = await req.json().catch(() => ({}));
  const rate = body.tvaRate === undefined ? TVA_TAUX_STANDARD : Number(body.tvaRate);
  if (!(rate >= 0 && rate < 1)) return badRequest("Taux de TVA invalide (fraction : 0,19).");
  const project = await ProjectModel.findOne({ _id: params.id, ...tenantFilter(auth), deletedAt: { $exists: false } })
    .lean<{ _id: Types.ObjectId; code: string; name: string; clientId?: Types.ObjectId; activityId?: Types.ObjectId; milestones?: Array<{ _id: Types.ObjectId; label: string; amount?: number; invoiceId?: unknown; description?: string }> } | null>();
  if (!project) return notFound("Projet introuvable");
  if (!project.clientId) return badRequest("Rattachez d'abord le projet à un client.");
  const ms = project.milestones?.find(m => String(m._id) === params.milestoneId);
  if (!ms) return notFound("Jalon introuvable");
  if (ms.invoiceId) return badRequest("Jalon déjà facturé.");
  const totalHT = Math.round(ms.amount ?? 0);
  if (!(totalHT > 0)) return badRequest("Jalon sans montant à facturer.");
  const totalTVA = calculerTVA(totalHT, rate);
  const now = new Date(), due = new Date(); due.setDate(due.getDate() + 30);

  const invoice = await withTransaction(async session => {
    const [inv] = await InvoiceModel.create([{
      tenantId: auth.tenantId, number: provisionalNumber(), clientId: project.clientId, projectId: project._id,
      ...(project.activityId ? { activityId: project.activityId } : {}),
      lines: [{ description: `${project.name} (${project.code}) — ${ms.label}${ms.description ? ` : ${ms.description}` : ""}`.slice(0, 500), quantity: 1, unitPrice: totalHT, tvaRate: rate, discount: 0, totalHT, totalTVA, totalTTC: totalHT + totalTVA }],
      totalHT, totalTVA, totalDTS: 0, totalTTC: totalHT + totalTVA, paidAmount: 0, status: "draft",
      issueDate: now, dueDate: due, notes: `Jalon « ${ms.label} » du projet ${project.code}`, createdBy: auth.userId,
    }], { session });
    const claim = await ProjectModel.updateOne(
      { _id: project._id, milestones: { $elemMatch: { _id: ms._id, invoiceId: { $exists: false } } } },
      { $set: { "milestones.$.invoiceId": inv._id }, $addToSet: { invoiceIds: inv._id } }, { session });
    if (claim.modifiedCount !== 1) throw new BusinessRuleError("Jalon déjà facturé.");
    return inv;
  });
  await logAudit(auth, "CREATE", "invoices", { resourceId: String(invoice._id), metadata: { fromMilestone: ms.label, project: project.code } });
  return created({ invoice });
});
