import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { scheduleBase, validateSchedule, scheduleState, type Installment } from "@/lib/installments";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * PUT { installments: [{ dueDate, amount, label? }] } — pose (ou retire, liste
 * vide) l'échéancier de paiement d'une facture : convenu avec le client, il
 * étale le montant dû en versements datés. Une facture déjà en partie réglée
 * garde ses règlements, imputés sur les premiers versements.
 */
export const PUT = withAuth("invoices", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound();
  const inv = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!inv) return notFound("Facture introuvable");
  if (inv.documentType === "credit_note") return badRequest("Un avoir n'a pas d'échéancier.");
  if (["cancelled", "paid", "written_off"].includes(inv.status)) return badRequest("Facture soldée, annulée ou passée en perte : pas d'échéancier.");
  const body = await req.json().catch(() => ({}));
  const raw = Array.isArray(body.installments) ? body.installments as Installment[] : [];
  const list = raw.map(x => ({ dueDate: new Date(x.dueDate), amount: Math.round(Number(x.amount)), ...(x.label ? { label: String(x.label).slice(0, 80) } : {}) }));
  const base = scheduleBase(inv);
  const err = validateSchedule(base, list);
  if (err) return badRequest(err);
  inv.set("installments", list);
  // L'échéance de la facture devient celle du dernier versement : la facture
  // n'est « en retard » qu'au-delà ; chaque versement l'est, lui, à sa date.
  if (list.length) inv.dueDate = list[list.length - 1].dueDate;
  await inv.save();
  await logAudit(auth, "UPDATE", "invoices", { resourceId: params.id, metadata: { installments: list.length, base } });
  return ok({ installments: inv.installments, state: scheduleState(inv) });
});
