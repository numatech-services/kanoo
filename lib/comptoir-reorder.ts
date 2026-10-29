import { Types } from "mongoose";
import { withTransaction } from "@/lib/db";
import { tenantFilter } from "@/lib/api-helpers";
import { buildCommandeLines } from "@/lib/commande";
import { nextDocumentNumber } from "@/lib/numbering";
import { CommandeModel } from "@/models/Commande";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ProductModel } from "@/models/Product";
import { logAudit } from "@/lib/audit";
import type { TokenPayload } from "@/lib/auth";

/**
 * Transforme un réassort en bons de commande brouillon, un par fournisseur
 * habituel (articles du catalogue). Les articles propres au comptoir forment
 * la liste de courses ; ceux sans fournisseur habituel sont signalés. Commun
 * au bouton du comptoir et au réassort automatique.
 */
export async function createReorderOrders(auth: TokenPayload, deskId: string, wanted: Array<{ itemId: string; quantity: number }>, opts: { note?: string } = {}) {
  const items = await ActivityItemModel.find({ ...tenantFilter(auth), deskId: deskId, _id: { $in: wanted.map(l => l.itemId) } })
    .select("name productId").lean<Array<{ _id: Types.ObjectId; name: string; productId?: Types.ObjectId }>>();
  const products = await ProductModel.find({ ...tenantFilter(auth), _id: { $in: items.map(i => i.productId).filter(Boolean) } })
    .select("label purchaseCost tvaRate preferredSupplierId").lean<Array<{ _id: Types.ObjectId; label: string; purchaseCost?: number; tvaRate?: number; preferredSupplierId?: Types.ObjectId }>>();
  const prod = new Map(products.map(p => [String(p._id), p]));
  const bySupplier = new Map<string, Array<{ productId: string; description: string; quantity: number; unitPrice: number; tvaRate: number }>>();
  const shopping: Array<{ itemId: string; name: string; quantity: number }> = [];
  const noSupplier: string[] = [];
  for (const l of wanted) {
    const it = items.find(i => String(i._id) === l.itemId);
    if (!it) continue;
    const p = it.productId ? prod.get(String(it.productId)) : undefined;
    if (!p) { shopping.push({ itemId: l.itemId, name: it.name, quantity: l.quantity }); continue; }
    if (!p.preferredSupplierId) { noSupplier.push(it.name); continue; }
    const k = String(p.preferredSupplierId);
    bySupplier.set(k, [...(bySupplier.get(k) ?? []), { productId: String(p._id), description: p.label, quantity: l.quantity, unitPrice: Math.round(p.purchaseCost ?? 0), tvaRate: p.tvaRate ?? 0 }]);
  }
  const orders = [];
  for (const [supplierId, lines] of bySupplier) {
    const built = await buildCommandeLines(auth.tenantId, lines);
    if ("error" in built) return { error: String(built.error) };
    const today = new Date();
    const doc = await withTransaction(async session => {
      const number = await nextDocumentNumber(auth.tenantId, "order", { issueDate: today, session });
      const [c] = await CommandeModel.create([{ supplierId, orderDate: today, notes: opts.note ?? "Réassort du comptoir", sourceDeskId: new Types.ObjectId(deskId), lines: built.lines.map(x => ({ ...x, receivedQty: 0 })), number,
        totalHT: built.totalHT, totalTVA: built.totalTVA, totalTTC: built.totalTTC, tenantId: auth.tenantId, status: "draft", createdBy: auth.userId }], { session });
      return c;
    });
    orders.push({ _id: String(doc._id), number: doc.number, supplierId, lines: lines.length });
    await logAudit(auth, "CREATE", "commandes", { resourceId: String(doc._id), metadata: { fromDeskReorder: deskId } });
  }
  return { orders, shopping, noSupplier };
}
