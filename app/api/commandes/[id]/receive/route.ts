import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { CommandeModel } from "@/models/Commande";
import { applyMovement, StockError } from "@/lib/stock";
import { receptionStatus } from "@/lib/commande";
import { logAudit } from "@/lib/audit";

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
  const wanted: Array<{ index: number; quantity: number }> = body.all
    ? lines.map((l, index) => ({ index, quantity: l.quantity - (l.receivedQty ?? 0) })).filter(x => x.quantity > 0)
    : (Array.isArray(body.lines) ? body.lines : []).map((x: { index: unknown; quantity: unknown }) => ({ index: Number(x.index), quantity: Number(x.quantity) }))
        .filter((x: { quantity: number }) => x.quantity > 0);
  if (wanted.length === 0) return badRequest("Aucune quantité à réceptionner.");
  for (const w of wanted) {
    const l = lines[w.index];
    if (!l) return badRequest("Ligne inconnue.");
    const rest = l.quantity - (l.receivedQty ?? 0);
    if (w.quantity > rest) return badRequest(`« ${l.description} » : ${rest} restant(s) à recevoir, ${w.quantity} saisi(s).`);
  }
  const date = body.date ? new Date(body.date) : new Date();

  try {
    await withTransaction(async session => {
      for (const w of wanted) {
        const l = lines[w.index];
        if (l.productId) {
          await applyMovement({
            tenantId: auth.tenantId, userId: auth.userId, productId: l.productId, type: "entry",
            quantity: w.quantity, unitCost: l.unitPrice, reason: `Réception BC ${cmd.number}`,
            linkedDocType: "commande", linkedDocId: cmd._id, linkedDocNumber: cmd.number,
          }, session);
        }
        l.receivedQty = (l.receivedQty ?? 0) + w.quantity;
      }
      cmd.markModified("lines");
      cmd.status = receptionStatus(lines);
      await cmd.save({ session });
    });
  } catch (e) {
    if (e instanceof StockError) return badRequest(e.message);
    throw e;
  }
  await logAudit(auth, "UPDATE", "commandes", { resourceId: params.id, metadata: { received: wanted, date }, after: { status: cmd.status } });
  return ok(cmd);
});
