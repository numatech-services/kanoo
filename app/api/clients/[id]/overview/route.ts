import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { Types } from "mongoose";
import { ClientModel } from "@/models/Client";
import { InvoiceModel } from "@/models/Invoice";
import { DevisModel } from "@/models/Devis";
import { ContractModel } from "@/models/Contract";
import { FrameworkOrderModel } from "@/models/FrameworkOrder";
import { DeliveryNoteModel } from "@/models/DeliveryNote";
import { ProjectModel } from "@/models/Project";
import { DunningLogModel } from "@/models/DunningLog";

export const dynamic = "force-dynamic";

const RECENT = 5;

/**
 * GET /api/clients/[id]/overview — fiche 360° d'un client.
 *
 * Un seul aller-retour rassemble tout ce qui est rattaché au client : synthèse
 * financière + comptage et derniers éléments de chaque rubrique (factures,
 * devis, contrats, marchés-cadres, livraisons, projets, relances). Chaque bloc
 * est isolé : une rubrique en erreur n'empêche pas les autres de remonter.
 */
async function safe<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await op();
  } catch {
    return fallback;
  }
}

/** Comptage + N derniers d'une collection filtrée sur le client. */
async function section(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  filter: Record<string, unknown>,
  sort: Record<string, 1 | -1>,
  select: string
): Promise<{ count: number; items: unknown[] }> {
  const [count, items] = await Promise.all([
    model.countDocuments(filter),
    model.find(filter).sort(sort).limit(RECENT).select(select).lean(),
  ]);
  return { count, items };
}

export const GET = withAuth("clients", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const tf = tenantFilter(auth);
  const clientId = new Types.ObjectId(params.id);

  const client = await ClientModel.findOne({ _id: clientId, ...tf }).lean<Record<string, unknown> | null>();
  if (!client) return notFound("Client introuvable");

  const byClient = { ...tf, clientId };
  // Cloisonnement : chaque section n'est remplie que si le compte a le droit de
  // lire la ressource d'origine. Les montants facturés / encaissés relèvent de
  // la comptabilité — un commercial voit la fiche, pas les soldes.
  const EMPTY = { count: 0, items: [] as unknown[] };
  const can = (res: string) => authCan(auth, res, "read");
  const seeInvoices = can("invoices");
  const gated = <T,>(res: boolean, fn: () => Promise<T>, fallback: T) => (res ? safe(fn, fallback) : Promise.resolve(fallback));

  const [financialsAgg, invoices, devis, contracts, marches, deliveries, projects, dunning] = await Promise.all([
    // Synthèse : facturé (ventes), encaissé, restant dû (ventes non soldées).
    gated(seeInvoices,
      () =>
        InvoiceModel.aggregate<{ _id: null; invoiced: number; paid: number; outstanding: number }>([
          { $match: { ...tf, clientId, documentType: { $ne: "credit_note" } } },
          {
            $group: {
              _id: null,
              invoiced: { $sum: "$totalTTC" },
              paid: { $sum: { $ifNull: ["$paidAmount", 0] } },
              outstanding: {
                $sum: {
                  $cond: [
                    { $in: ["$status", ["sent", "partial", "overdue"]] },
                    { $subtract: ["$totalTTC", { $add: [{ $ifNull: ["$paidAmount", 0] }, { $ifNull: ["$creditedAmount", 0] }] }] },
                    0,
                  ],
                },
              },
            },
          },
        ]),
      [] as Array<{ invoiced: number; paid: number; outstanding: number }>
    ),
    gated(seeInvoices, () => section(InvoiceModel, { ...byClient, documentType: { $ne: "credit_note" } }, { issueDate: -1 }, "number totalTTC paidAmount status issueDate"), EMPTY),
    gated(can("devis"), () => section(DevisModel, byClient, { issueDate: -1 }, "number totalTTC status issueDate"), EMPTY),
    gated(can("contracts"), () => section(ContractModel, byClient, { createdAt: -1 }, "reference title status amount endDate"), EMPTY),
    gated(can("commandes"), () => section(FrameworkOrderModel, byClient, { createdAt: -1 }, "reference title status totalQuantity deliveredQuantity invoicedQuantity unitPrice"), EMPTY),
    gated(can("livraisons"), () => section(DeliveryNoteModel, byClient, { deliveryDate: -1 }, "number status deliveryDate"), EMPTY),
    gated(can("projects"), () => section(ProjectModel, byClient, { createdAt: -1 }, "label status dueDate amount"), EMPTY),
    gated(seeInvoices, () => section(DunningLogModel, byClient, { sentAt: -1 }, "sentAt channels invoiceNumber"), EMPTY),
  ]);

  const f = financialsAgg[0] ?? { invoiced: 0, paid: 0, outstanding: 0 };

  if (!seeInvoices) delete client.currentBalance;
  return ok({
    client: seeInvoices ? { ...client, currentBalance: Math.max(0, f.outstanding) } : client,
    financials: seeInvoices ? { invoiced: f.invoiced, paid: f.paid, outstanding: Math.max(0, f.outstanding) } : null,
    sections: { invoices, devis, contracts, marches, deliveries, projects, dunning },
    // L'écran n'affiche que les onglets et actions autorisés.
    access: {
      invoices: seeInvoices, dunning: seeInvoices, devis: can("devis"), contracts: can("contracts"),
      marches: can("commandes"), deliveries: can("livraisons"), projects: can("projects"),
      createInvoice: authCan(auth, "invoices", "create"),
    },
  });
});
