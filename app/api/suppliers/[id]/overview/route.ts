import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { Types } from "mongoose";
import { SupplierModel } from "@/models/Supplier";
import { CommandeModel } from "@/models/Commande";
import { ContractModel } from "@/models/Contract";
import { GoodsReceiptModel } from "@/models/GoodsReceipt";
import { CommitmentOrderModel } from "@/models/CommitmentOrder";
import { RecurringExpenseModel } from "@/models/RecurringExpense";

export const dynamic = "force-dynamic";

const RECENT = 5;

/**
 * GET /api/suppliers/[id]/overview — fiche 360° d'un fournisseur.
 *
 * Rassemble en un appel tout ce qui est rattaché au fournisseur : synthèse
 * (commandé, engagé) + comptage et derniers éléments par rubrique (commandes,
 * contrats, réceptions, engagements, dépenses récurrentes). Chaque bloc est
 * isolé — une rubrique en erreur n'empêche pas les autres.
 */
async function safe<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await op();
  } catch {
    return fallback;
  }
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sum(model: any, match: Record<string, unknown>, field: string): Promise<number> {
  const rows = await model.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: field } } }]);
  return rows[0]?.total || 0;
}

export const GET = withAuth("suppliers", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const tf = tenantFilter(auth);
  const supplierId = new Types.ObjectId(params.id);

  const supplier = await SupplierModel.findOne({ _id: supplierId, ...tf }).lean<Record<string, unknown> | null>();
  if (!supplier) return notFound("Fournisseur introuvable");

  const bySupplier = { ...tf, supplierId };

  const [ordered, engaged, commandes, contracts, receipts, commitments, recurring] = await Promise.all([
    safe(() => sum(CommandeModel, { ...tf, supplierId, status: { $ne: "cancelled" } }, "$totalTTC"), 0),
    safe(() => sum(CommitmentOrderModel, { ...tf, supplierId }, "$amount"), 0),
    safe(() => section(CommandeModel, bySupplier, { orderDate: -1 }, "number totalTTC status orderDate"), { count: 0, items: [] }),
    safe(() => section(ContractModel, bySupplier, { createdAt: -1 }, "reference title status amount endDate"), { count: 0, items: [] }),
    safe(() => section(GoodsReceiptModel, bySupplier, { receiptDate: -1 }, "number receiptDate commandeId"), { count: 0, items: [] }),
    safe(() => section(CommitmentOrderModel, bySupplier, { date: -1 }, "number label amount date status"), { count: 0, items: [] }),
    safe(() => section(RecurringExpenseModel, bySupplier, { nextDueDate: 1 }, "reference label amount frequency nextDueDate isActive"), { count: 0, items: [] }),
  ]);

  return ok({
    supplier,
    financials: { ordered, engaged },
    sections: { commandes, contracts, receipts, commitments, recurring },
  });
});
