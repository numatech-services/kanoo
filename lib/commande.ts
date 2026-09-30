import { Types } from "mongoose";
import { ProductModel } from "@/models/Product";
import { calculerTVA, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";

export interface CmdLineIn { productId?: unknown; description?: unknown; quantity?: unknown; unitPrice?: unknown; tvaRate?: unknown; receivedQty?: unknown }

/**
 * Lignes de bon de commande recalculées côté serveur (jamais les totaux du
 * client). Un article du catalogue doit appartenir à l'organisation ; une
 * ligne sans article (prestation, frais) reste possible.
 */
export async function buildCommandeLines(tenantId: string, raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "Au moins une ligne de commande." } as const;
  const ids = raw.map((l: CmdLineIn) => l?.productId).filter(Boolean).map(String);
  if (ids.some(id => !Types.ObjectId.isValid(id))) return { error: "Article invalide." } as const;
  const products = ids.length
    ? await ProductModel.find({ tenantId, _id: { $in: ids } }).select("label isService").lean<Array<{ _id: unknown; label: string; isService?: boolean }>>()
    : [];
  const byId = new Map(products.map(p => [String(p._id), p]));
  let totalHT = 0, totalTVA = 0;
  const lines = [];
  for (const [i, l] of (raw as CmdLineIn[]).entries()) {
    const quantity = Number(l.quantity), unitPrice = Number(l.unitPrice);
    const tvaRate = l.tvaRate === undefined || l.tvaRate === null || l.tvaRate === "" ? TVA_TAUX_STANDARD : Number(l.tvaRate);
    if (!(quantity > 0)) return { error: `Ligne ${i + 1} : quantité invalide.` } as const;
    if (!(unitPrice >= 0)) return { error: `Ligne ${i + 1} : prix invalide.` } as const;
    if (!(tvaRate >= 0 && tvaRate < 1)) return { error: `Ligne ${i + 1} : taux de TVA invalide.` } as const;
    const product = l.productId ? byId.get(String(l.productId)) : undefined;
    if (l.productId && !product) return { error: `Ligne ${i + 1} : article introuvable.` } as const;
    const description = String(l.description ?? "").trim() || product?.label || "";
    if (!description) return { error: `Ligne ${i + 1} : désignation obligatoire.` } as const;
    const lineHT = Math.round(quantity * unitPrice);
    const lineTVA = calculerTVA(lineHT, tvaRate);
    totalHT += lineHT; totalTVA += lineTVA;
    lines.push({
      ...(product ? { productId: product._id } : {}),
      description: description.slice(0, 300), quantity, unitPrice, tvaRate,
      totalHT: lineHT, totalTVA: lineTVA, totalTTC: lineHT + lineTVA,
      receivedQty: Math.max(0, Number(l.receivedQty) || 0),
    });
  }
  return { lines, totalHT, totalTVA, totalTTC: totalHT + totalTVA } as const;
}

/** Statut d'après les quantités reçues. */
export function receptionStatus(lines: Array<{ quantity: number; receivedQty?: number }>): "confirmed" | "partially_received" | "received" {
  const any = lines.some(l => (l.receivedQty ?? 0) > 0);
  const all = lines.every(l => (l.receivedQty ?? 0) >= l.quantity);
  return all ? "received" : any ? "partially_received" : "confirmed";
}
