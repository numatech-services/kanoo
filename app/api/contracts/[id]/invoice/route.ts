import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, ok, badRequest, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { ContractModel } from "@/models/Contract";
import { invoiceMarket, type MarketContract } from "@/lib/market-invoice";
import { logAudit } from "@/lib/audit";
import { InvoiceModel } from "@/models/Invoice";
import { dayNumber, dueFrom, paymentDaysOf } from "@/lib/market-terms";

export const dynamic = "force-dynamic";

/**
 * POST — { mode: "deposit" | "standard", amountHT? | rate?, milestoneId?, deductDeposits?, description?, tvaRate? }
 * Facture d'acompte, facture d'une échéance, ou facture du marché déduisant les acomptes.
 */
export const POST = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  if (!authCan(auth, "invoices", "create")) return forbidden("Facturation réservée à la comptabilité et au gérant.");
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const exists = await ContractModel.exists({ _id: params.id, ...tenantFilter(auth) });
  if (!exists) return notFound("Marché introuvable");
  const invoice = await withTransaction(async session => {
    const contract = await ContractModel.findOne({ _id: params.id, ...tenantFilter(auth) }).session(session ?? null);
    return invoiceMarket(auth, contract as unknown as MarketContract, body, session);
  });
  await logAudit(auth, "CREATE", "invoices", { resourceId: String(invoice._id), metadata: { contract: params.id, kind: invoice.kind, totalTTC: invoice.totalTTC } });
  return created({ invoice, message: `${invoice.kind === "deposit" ? "Facture d'acompte" : "Facture"} ${invoice.number} créée (brouillon).` });
});

/**
 * PATCH — { invoiceId, claimReceivedAt } : date de réception de la déclaration
 * de créance. L'échéance devient cette date + le délai de paiement du marché ;
 * `null` retire la date et reprend l'échéance depuis l'émission.
 */
export const PATCH = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  if (!authCan(auth, "invoices", "update")) return forbidden("Réservé à la comptabilité et au gérant.");
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const contract = await ContractModel.findOne({ _id: params.id, ...tenantFilter(auth) }).select("paymentDays invoiceIds").lean<{ _id: unknown; paymentDays?: number; invoiceIds?: unknown[] } | null>();
  if (!contract) return notFound("Marché introuvable");
  if (!Types.ObjectId.isValid(String(body.invoiceId))) return badRequest("Facture invalide.");
  const inv = await InvoiceModel.findOne({ ...tenantFilter(auth), documentType: "invoice", $and: [{ _id: body.invoiceId }, { $or: [{ contractId: contract._id }, { _id: { $in: contract.invoiceIds ?? [] } }] }] })
    .select("status issueDate dueDate claimReceivedAt").lean<{ _id: unknown; status: string; issueDate: Date; dueDate?: Date; claimReceivedAt?: Date } | null>();
  if (!inv) return notFound("Facture introuvable sur ce marché");
  if (["draft", "cancelled", "written_off"].includes(inv.status)) return badRequest("Émettez d'abord la facture : une déclaration de créance porte sur une facture émise.");
  const clear = body.claimReceivedAt === null || body.claimReceivedAt === "";
  const claim = clear ? null : new Date(String(body.claimReceivedAt));
  if (claim && isNaN(claim.getTime())) return badRequest("Date de réception invalide.");
  if (claim && dayNumber(claim) < dayNumber(inv.issueDate)) return badRequest("La déclaration ne peut pas être reçue avant l'émission de la facture.");
  if (claim && dayNumber(claim) > dayNumber(new Date())) return badRequest("La date de réception ne peut pas être dans le futur.");
  const dueDate = dueFrom(claim ?? inv.issueDate, paymentDaysOf(contract));
  // La facture cesse d'être en retard si la nouvelle échéance n'est pas passée.
  const status = inv.status === "overdue" && dueDate >= new Date() ? "sent" : inv.status;
  await InvoiceModel.updateOne({ _id: inv._id, ...tenantFilter(auth) }, { $set: { dueDate, status, ...(claim ? { claimReceivedAt: claim } : {}) }, ...(claim ? {} : { $unset: { claimReceivedAt: 1 } }) });
  await logAudit(auth, "UPDATE", "invoices", { resourceId: String(inv._id), before: { dueDate: inv.dueDate, claimReceivedAt: inv.claimReceivedAt }, after: { dueDate, claimReceivedAt: claim } });
  return ok({ dueDate, claimReceivedAt: claim });
});
