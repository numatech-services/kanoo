import { Types } from "mongoose";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { InvoiceModel } from "@/models/Invoice";
import { DeliveryNoteModel } from "@/models/DeliveryNote";
import { ProductModel } from "@/models/Product";
import { StockMovementModel } from "@/models/StockMovement";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { UserModel } from "@/models/User";
import { aggregateMargins, marginTotals, type MarginFact } from "@/lib/margins";

export type MarginSource = "all" | "comptoir" | "invoices";
export type MarginGroup = "product" | "category" | "month" | "desk" | "cashier" | "source";

interface Fact extends MarginFact { productKey: string; productLabel: string; month: string; desk: string; cashier: string; source: string }

const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Lignes vendues de la période, avec leur coût :
 *  - tickets du comptoir : coût FIGÉ au moment de la vente (CMUP de la sortie) ;
 *  - factures émises : coût réel des sorties de stock de leurs bons de
 *    livraison (CMUP de la sortie) ; à défaut, le coût d'achat actuel du
 *    produit (marge « estimée »). Les avoirs viennent en déduction.
 * Une prestation ou un article sans coût est « non valorisé ».
 */
async function marginFacts(tenantId: string, from: Date, to: Date, source: MarginSource): Promise<{ facts: Fact[]; estimated: number }> {
  const tid = new Types.ObjectId(tenantId);
  const facts: Fact[] = [];
  let estimated = 0;
  const [desks, users] = await Promise.all([
    ActivityDeskModel.find({ tenantId: tid }).select("name").lean<Array<{ _id: Types.ObjectId; name: string }>>(),
    UserModel.find({ tenantId: tid }).select("firstName lastName").lean<Array<{ _id: Types.ObjectId; firstName?: string; lastName?: string }>>(),
  ]);
  const deskName = new Map(desks.map(d => [String(d._id), d.name]));
  const userName = new Map(users.map(u => [String(u._id), `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()]));

  if (source !== "invoices") {
    const sales = await ComptoirSaleModel.find({ tenantId: tid, status: "paid", date: { $gte: from, $lte: to } })
      .select("deskId cashierId date lines").lean<Array<{ deskId: Types.ObjectId; cashierId: Types.ObjectId; date: Date; lines: Array<{ itemId: Types.ObjectId; productId?: Types.ObjectId; label: string; category?: string; quantity: number; totalHT: number; costTotal: number; unitCost: number }> }>>();
    for (const s of sales) for (const l of s.lines) {
      const key = l.productId ? `p:${l.productId}` : `i:${l.itemId}`;
      facts.push({
        key: "", label: "", productKey: key, productLabel: l.label, category: l.category || "Sans catégorie",
        quantity: l.quantity, revenueHT: l.totalHT, costTotal: l.costTotal, valued: l.unitCost > 0,
        month: monthOf(new Date(s.date)), desk: deskName.get(String(s.deskId)) ?? "Comptoir", cashier: userName.get(String(s.cashierId)) ?? "—", source: "Comptoir",
      });
    }
  }

  if (source !== "comptoir") {
    const invoices = await InvoiceModel.find({
      // Une facture « annulée » par un avoir total reste une vente : son avoir
      // la compense. Sans elle, l'avoir seul donnait une marge négative.
      tenantId: tid, kind: { $ne: "deposit" },
      $or: [{ status: { $nin: ["draft", "cancelled"] } }, { status: "cancelled", creditedAmount: { $gt: 0 } }],
      issueDate: { $gte: from, $lte: to }, "lines.productId": { $exists: true },
    }).select("number issueDate documentType originalInvoiceId lines createdBy").lean<Array<{ _id: Types.ObjectId; issueDate: Date; documentType?: string; originalInvoiceId?: Types.ObjectId; createdBy?: Types.ObjectId; lines: Array<{ productId?: Types.ObjectId; description: string; quantity: number; totalHT: number; kind?: string }> }>>();
    const productIds = [...new Set(invoices.flatMap(i => i.lines.filter(l => l.productId).map(l => String(l.productId))))];
    const products = await ProductModel.find({ tenantId: tid, _id: { $in: productIds } }).select("label category purchaseCost isService")
      .lean<Array<{ _id: Types.ObjectId; label: string; category?: string; purchaseCost?: number; isService?: boolean }>>();
    const prod = new Map(products.map(p => [String(p._id), p]));

    // Coût réel : sorties de stock des bons de livraison, par facture et produit.
    const notes = await DeliveryNoteModel.find({ tenantId: tid, invoiceId: { $in: invoices.map(i => i.originalInvoiceId ?? i._id) }, status: { $ne: "returned" } })
      .select("invoiceId").lean<Array<{ _id: Types.ObjectId; invoiceId: Types.ObjectId }>>();
    const noteInvoice = new Map(notes.map(n => [String(n._id), String(n.invoiceId)]));
    const exits = notes.length ? await StockMovementModel.find({ tenantId: tid, linkedDocType: "delivery", linkedDocId: { $in: notes.map(n => n._id) }, type: "exit" })
      .select("productId quantity unitCost linkedDocId").lean<Array<{ productId: Types.ObjectId; quantity: number; unitCost?: number; linkedDocId: Types.ObjectId }>>() : [];
    const delivered = new Map<string, { qty: number; cost: number }>();
    for (const m of exits) {
      const k = `${noteInvoice.get(String(m.linkedDocId))}:${m.productId}`;
      const q = Math.abs(m.quantity), c = delivered.get(k) ?? { qty: 0, cost: 0 };
      delivered.set(k, { qty: c.qty + q, cost: c.cost + q * (m.unitCost ?? 0) });
    }

    for (const inv of invoices) {
      const sign = inv.documentType === "credit_note" ? -1 : 1;
      for (const l of inv.lines) {
        if (!l.productId || l.kind === "deposit_deduction") continue;
        const p = prod.get(String(l.productId));
        // Un avoir reprend le coût de sortie de la facture qu'il corrige.
        const d = delivered.get(`${inv.originalInvoiceId ?? inv._id}:${l.productId}`);
        let unitCost = d && d.qty > 0 ? d.cost / d.qty : 0;
        if (!unitCost && p?.purchaseCost && !p.isService) { unitCost = p.purchaseCost; estimated++; }
        const qty = Math.abs(l.quantity);
        facts.push({
          key: "", label: "", productKey: `p:${l.productId}`, productLabel: p?.label ?? l.description, category: p?.category || "Sans catégorie",
          quantity: sign * qty, revenueHT: sign * Math.abs(l.totalHT), costTotal: sign * Math.round(unitCost * qty), valued: unitCost > 0,
          month: monthOf(new Date(inv.issueDate)), desk: "Ventes facturées", cashier: userName.get(String(inv.createdBy)) ?? "—", source: "Factures",
        });
      }
    }
  }
  return { facts, estimated };
}

export async function marginReport(tenantId: string, opts: { from: Date; to: Date; source: MarginSource; groupBy: MarginGroup }) {
  const { facts, estimated } = await marginFacts(tenantId, opts.from, opts.to, opts.source);
  const keyed = (g: MarginGroup) => facts.map(f => {
    switch (g) {
      case "category": return { ...f, key: f.category ?? "", label: f.category ?? "" };
      case "month": return { ...f, key: f.month, label: f.month };
      case "desk": return { ...f, key: f.desk, label: f.desk };
      case "cashier": return { ...f, key: f.cashier, label: f.cashier };
      case "source": return { ...f, key: f.source, label: f.source };
      default: return { ...f, key: f.productKey, label: f.productLabel };
    }
  });
  const rows = aggregateMargins(keyed(opts.groupBy));
  const byProduct = opts.groupBy === "product" ? rows : aggregateMargins(keyed("product"));
  const valued = byProduct.filter(r => r.revenueHT > 0);
  const trend = aggregateMargins(keyed("month")).sort((a, b) => a.key.localeCompare(b.key));
  return {
    rows,
    totals: marginTotals(rows),
    trend,
    top: [...valued].sort((a, b) => b.marginHT - a.marginHT).slice(0, 5),
    flop: [...valued].sort((a, b) => (a.markupRate ?? 0) - (b.markupRate ?? 0)).slice(0, 5),
    belowCost: byProduct.filter(r => r.belowCost),
    unvalued: byProduct.filter(r => r.unvaluedRevenueHT > 0).map(r => ({ key: r.key, label: r.label, revenueHT: r.unvaluedRevenueHT })),
    estimatedLines: estimated,
  };
}
