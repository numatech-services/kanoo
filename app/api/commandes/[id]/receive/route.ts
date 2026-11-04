import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { CommandeModel } from "@/models/Commande";
import { applyMovement, StockError, type LotInput } from "@/lib/stock";
import { BusinessRuleError } from "@/lib/errors";
import { assertMonthOpen } from "@/lib/comptoir-sale";
import { deskReserve } from "@/lib/restaurant-stock";
import { priceAlertsAfterCost } from "@/lib/restaurant-overview";
import { notifyRoles } from "@/lib/notify";
import { ActivityItemModel } from "@/models/ActivityItem";
import { SupplierModel } from "@/models/Supplier";
import { PurchasePriceLogModel } from "@/models/PurchasePriceLog";
import { receptionStatus } from "@/lib/commande";
import { logAudit } from "@/lib/audit";
import { GoodsReceiptModel } from "@/models/GoodsReceipt";
import { landedUnitCosts } from "@/lib/margins";

/**
 * POST /api/commandes/:id/receive — { lines: [{ index, quantity }] } ou { all: true }
 * Réception (partielle ou totale) : chaque article du catalogue entre en stock,
 * valorisé au prix d'achat de la ligne (CMUP). La quantité reçue est cumulée
 * par ligne : une même livraison ne peut pas être comptée deux fois, ni
 * dépasser la quantité commandée.
 */
export const POST = withAuth("commandes", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const cmd = await CommandeModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!cmd) return notFound();
  if (!["confirmed", "partially_received"].includes(cmd.status)) {
    return badRequest(cmd.status === "draft" ? "Confirmez d'abord la commande." : "Cette commande ne peut plus être réceptionnée.");
  }
  type L = { productId?: unknown; description: string; quantity: number; unitPrice: number; receivedQty?: number };
  const lines = cmd.lines as L[];
  const wanted: Array<{ index: number; quantity: number; lots?: LotInput[] }> = body.all
    ? lines.map((l, index) => ({ index, quantity: l.quantity - (l.receivedQty ?? 0) })).filter(x => x.quantity > 0)
    : (Array.isArray(body.lines) ? body.lines : []).map((x: { index: unknown; quantity: unknown; lots?: LotInput[] }) => ({ index: Number(x.index), quantity: Number(x.quantity), lots: x.lots }))
        .filter((x: { quantity: number }) => x.quantity > 0);
  if (wanted.length === 0) return badRequest("Aucune quantité à réceptionner.");
  for (const w of wanted) {
    const l = lines[w.index];
    if (!l) return badRequest("Ligne inconnue.");
    const rest = l.quantity - (l.receivedQty ?? 0);
    if (w.quantity > rest) return badRequest(`« ${l.description} » : ${rest} restant(s) à recevoir, ${w.quantity} saisi(s).`);
  }
  const date = body.date ? new Date(body.date) : new Date();
  // Frais d'approche (transport, douane, manutention) : répartis sur les
  // articles reçus au prorata de leur valeur, ils entrent dans le coût d'achat
  // (CMUP) — la marge les ignorait.
  const landed = Math.max(0, Math.round(Number(body.landedCosts) || 0));
  const costs = landedUnitCosts(wanted.map(w => ({ quantity: w.quantity, unitPrice: lines[w.index].unitPrice, stocked: !!lines[w.index].productId })), landed);

  // Commande passée depuis un comptoir (réassort) : elle entre dans la réserve du restaurant, sauf entrepôt choisi.
  const sourceDesk = (cmd as { sourceDeskId?: unknown }).sourceDeskId;
  const targetWarehouse = body.warehouseId || (sourceDesk ? await deskReserve(auth.tenantId, sourceDesk) : undefined);
  // Semaine ou mois clos du site : une réception n'y entre plus.
  if (sourceDesk) { try { await assertMonthOpen(auth.tenantId, sourceDesk, new Date()); } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; } }
  try {
    await withTransaction(async session => {
      for (const [k, w] of wanted.entries()) {
        const l = lines[w.index];
        if (l.productId) {
          await applyMovement({
            tenantId: auth.tenantId, userId: auth.userId, productId: l.productId, type: "entry",
            quantity: w.quantity, unitCost: costs[k], reason: `Réception BC ${cmd.number}${landed ? " (frais d'approche inclus)" : ""}`,
            warehouseId: targetWarehouse || undefined, lots: w.lots,
            linkedDocType: "commande", linkedDocId: cmd._id, linkedDocNumber: cmd.number,
          }, session);
        }
        l.receivedQty = (l.receivedQty ?? 0) + w.quantity;
      }
      cmd.markModified("lines");
      cmd.status = receptionStatus(lines);
      await cmd.save({ session });
      // Bon de réception : la trace de CE qui est arrivé, CE jour-là (fiche
      // fournisseur, litiges de quantité). Il n'était jamais créé.
      const n = await GoodsReceiptModel.countDocuments({ tenantId: auth.tenantId, commandeId: cmd._id }).session(session ?? null);
      await GoodsReceiptModel.create([{
        tenantId: auth.tenantId, number: `BR-${cmd.number}-${n + 1}`, commandeId: cmd._id, supplierId: cmd.supplierId,
        lines: wanted.map((w, k) => ({ commandeLineIndex: w.index, description: lines[w.index].description, orderedQty: lines[w.index].quantity, receivedQty: w.quantity, unitPrice: costs[k] })),
        receiptDate: date, notes: [landed ? `Frais d'approche : ${landed.toLocaleString("fr-FR")} FCFA` : "", body.notes ? String(body.notes).slice(0, 300) : ""].filter(Boolean).join(" — ") || undefined,
        receivedBy: auth.userId,
      }], { session });
    });
  } catch (e) {
    if (e instanceof StockError) return badRequest(e.message);
    throw e;
  }
  await logAudit(auth, "UPDATE", "commandes", { resourceId: params.id, metadata: { received: wanted, date }, after: { status: cmd.status } });
  // Commande d'un restaurant : prix d'achat au journal (historique, comparaison des fournisseurs) ; un nouveau
  // coût peut faire passer des plats sous leur prix minimum.
  if (sourceDesk) {
    const pids = wanted.map(w => lines[w.index].productId).filter(Boolean);
    const deskItems = await ActivityItemModel.find({ tenantId: auth.tenantId, deskId: sourceDesk, productId: { $in: pids } }).select("_id productId").lean<Array<{ _id: unknown; productId: unknown }>>();
    const itemIds = deskItems.map(i => String(i._id));
    const supplierName = (await SupplierModel.findOne({ _id: cmd.supplierId, tenantId: auth.tenantId }).select("name").lean<{ name?: string } | null>())?.name;
    await PurchasePriceLogModel.insertMany(wanted.flatMap((w, k) => {
      const it = deskItems.find(i => String(i.productId) === String(lines[w.index].productId));
      return it ? [{ tenantId: auth.tenantId, deskId: sourceDesk, itemId: it._id, supplierId: cmd.supplierId, ...(supplierName ? { supplierName } : {}), unitCost: costs[k] ?? 0, quantity: w.quantity, date, source: "commande", reference: cmd.number, commandeId: cmd._id, paidFromCash: false, createdBy: auth.userId }] : [];
    })).catch(() => undefined);
    const below = await priceAlertsAfterCost(auth.tenantId, String(sourceDesk), itemIds).catch(() => []);
    if (below.length) await notifyRoles(auth.tenantId, ["pme_admin", "pme_manager", "pme_accountant", "svc_compta", "svc_spot"], {
      type: "stock_alert", title: "Prix de vente sous le minimum après une hausse d'achat",
      message: below.slice(0, 6).map(b => `${b.name} : ${Math.round(b.priceTTC)} FCFA, conseillé ${b.minPriceTTC} FCFA`).join(" • ") + " (Restauration → Prix et marges)",
      linkedTo: "comptoir", linkedId: String(sourceDesk),
    }).catch(() => undefined);
  }
  return ok(cmd);
});
