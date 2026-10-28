import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, notFound, conflict, forbidden, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { DevisModel } from "@/models/Devis";
import { ContractModel } from "@/models/Contract";
import { InvoiceModel } from "@/models/Invoice";
import { createExecutionProject } from "@/lib/market-project";
import { parseMilestone } from "@/lib/contract-input";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST — { title?, createProject? (oui par défaut), startDate?, endDate?, milestones? }
 * Le devis accepté devient un marché : contrat client au montant HT du devis,
 * projet d'exécution qui recevra les dépenses, échéancier (acomptes, situations).
 */
export const POST = withAuth("contracts", "create", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const devis = await DevisModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!devis) return notFound("Devis introuvable");
  if (devis.contractId) return conflict("Ce devis est déjà un marché.");
  if (["rejected", "expired"].includes(devis.status)) return badRequest("Un devis refusé ou expiré ne devient pas un marché.");
  const withProject = body.createProject !== false;
  if (withProject && !authCan(auth, "projects", "create")) return forbidden("Créer le projet d'exécution demande le droit de créer des projets.");
  const amount = Math.round(devis.totalHT || 0);
  if (!(amount > 0)) return badRequest("Le devis n'a pas de montant.");
  const milestones: Array<NonNullable<ReturnType<typeof parseMilestone>["data"]>> = [];
  for (const m of Array.isArray(body.milestones) ? body.milestones : []) {
    const r = parseMilestone(m, amount);
    if (r.error) return badRequest(r.error);
    milestones.push(r.data!);
  }
  if (milestones.reduce((t, m) => t + m.amount, 0) > amount) return badRequest("L'échéancier dépasse le montant du marché.");
  const date = (v: unknown) => { const d = v ? new Date(String(v)) : undefined; return d && !isNaN(d.getTime()) ? d : undefined; };

  const result = await withTransaction(async session => {
    const [contract] = await ContractModel.create([{
      tenantId: auth.tenantId, title: String(body.title || `Marché — devis ${devis.number}`).slice(0, 200), type: "client", status: "active",
      clientId: devis.clientId, amount, devisId: devis._id, milestones, startDate: date(body.startDate) ?? new Date(), endDate: date(body.endDate),
      signedDate: new Date(), createdBy: auth.userId,
      // Taux de TVA du devis repris par le marché : un devis exonéré (bailleur
      // extérieur) était ensuite facturé à 19 %. Taux mixtes : taux effectif.
      tvaRate: devisRate(devis),
      approvalDate: date(body.approvalDate),
      ...(body.buyerType ? { buyerType: String(body.buyerType) } : {}),
      // Facture déjà émise depuis ce devis : rattachée au marché.
      invoiceIds: devis.convertedToInvoiceId ? [devis.convertedToInvoiceId] : [],
    }], { session });
    const project = withProject ? await createExecutionProject(auth.tenantId, contract, auth.userId, session) : null;
    if (project) { contract.projectId = project._id; await contract.save({ session }); }
    if (devis.convertedToInvoiceId) await InvoiceModel.updateOne({ _id: devis.convertedToInvoiceId, ...tenantFilter(auth) }, { $set: { contractId: contract._id } }, { session });
    devis.status = "accepted";
    devis.contractId = contract._id;
    if (project) devis.projectId = project._id;
    await devis.save({ session });
    return { contract, project };
  });
  await logAudit(auth, "CREATE", "contracts", { resourceId: String(result.contract._id), after: { fromDevis: devis.number, amount } });
  return created({ contractId: result.contract._id, reference: result.contract.reference, projectId: result.project?._id ?? null });
});

/** Taux de TVA du marché d'après le devis : commun à toutes les lignes, sinon le taux effectif. */
function devisRate(devis: { lines?: Array<{ tvaRate?: number }>; totalHT?: number; totalTVA?: number }): number | undefined {
  const rates = [...new Set((devis.lines ?? []).map(l => l.tvaRate ?? 0.19))];
  if (rates.length === 1) return rates[0];
  return devis.totalHT ? Math.round(((devis.totalTVA ?? 0) / devis.totalHT) * 1000) / 1000 : undefined;
}
