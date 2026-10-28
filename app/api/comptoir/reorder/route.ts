import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, forbidden, tenantFilter } from "@/lib/api-helpers";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { authCan } from "@/lib/role-resources";
import { reorderPlan } from "@/lib/spot-server";
import { buildCommandeLines } from "@/lib/commande";
import { nextDocumentNumber } from "@/lib/numbering";
import { CommandeModel } from "@/models/Commande";
import { ActivityItemModel } from "@/models/ActivityItem";
import { ProductModel } from "@/models/Product";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET ?deskId= — réassort conseillé : ventes moyennes, jours de stock restants, quantité à commander (en paquets). */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const deskId = new URL(req.url).searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const plan = await reorderPlan(auth.tenantId, deskId);
  if (canSeeDeskCosts(auth)) return ok(plan);
  return ok({ ...plan, totalCost: undefined, lines: plan.lines.map(l => ({ ...l, estimatedCost: undefined })), toOrder: plan.toOrder.map(l => ({ ...l, estimatedCost: undefined })) });
});

/**
 * POST { deskId, lines: [{ itemId, quantity }] } — transforme le réassort en
 * bons de commande brouillon, un par fournisseur habituel (articles du
 * catalogue). Les articles propres au comptoir forment la liste de courses.
 */
export const POST = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload) => {
  if (!authCan(auth, "commandes", "create")) return forbidden("Bons de commande réservés aux achats et au gérant.");
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  const wanted = (Array.isArray(body.lines) ? body.lines : []).filter((l: { itemId?: string; quantity?: number }) => isId(l.itemId) && Number(l.quantity) > 0);
  if (!wanted.length) return badRequest("Rien à commander.");
  const items = await ActivityItemModel.find({ ...tenantFilter(auth), deskId: body.deskId, _id: { $in: wanted.map((l: { itemId: string }) => l.itemId) } })
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
    if (!p) { shopping.push({ itemId: l.itemId, name: it.name, quantity: Number(l.quantity) }); continue; }
    if (!p.preferredSupplierId) { noSupplier.push(it.name); continue; }
    const k = String(p.preferredSupplierId);
    bySupplier.set(k, [...(bySupplier.get(k) ?? []), { productId: String(p._id), description: p.label, quantity: Number(l.quantity), unitPrice: Math.round(p.purchaseCost ?? 0), tvaRate: p.tvaRate ?? 0 }]);
  }
  const orders = [];
  for (const [supplierId, lines] of bySupplier) {
    const built = await buildCommandeLines(auth.tenantId, lines);
    if ("error" in built) return badRequest(String(built.error));
    const today = new Date();
    const doc = await withTransaction(async session => {
      const number = await nextDocumentNumber(auth.tenantId, "order", { issueDate: today, session });
      const [c] = await CommandeModel.create([{ supplierId, orderDate: today, notes: "Réassort du comptoir", lines: built.lines.map(x => ({ ...x, receivedQty: 0 })), number,
        totalHT: built.totalHT, totalTVA: built.totalTVA, totalTTC: built.totalTTC, tenantId: auth.tenantId, status: "draft", createdBy: auth.userId }], { session });
      return c;
    });
    orders.push({ _id: String(doc._id), number: doc.number, supplierId, lines: lines.length });
    await logAudit(auth, "CREATE", "commandes", { resourceId: String(doc._id), metadata: { fromDeskReorder: body.deskId } });
  }
  return created({ orders, shopping, noSupplier });
});
