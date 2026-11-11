import { Types, type ClientSession } from "mongoose";
import { PurchaseModel, normSupplierRef, supplierKey } from "@/models/Purchase";

/**
 * Une facture de fournisseur n'est jamais enregistrée deux fois, quelle que
 * soit son origine (saisie, API) : même fournisseur, même numéro normalisé
 * (casse, espaces et séparateurs ignorés), pièce non annulée. L'index unique
 * sur `activeSupplierKey` tranche les envois simultanés.
 */
export async function findSupplierInvoice(tenantId: unknown, supplierId: unknown, ref: unknown, excludeId?: unknown, session?: ClientSession) {
  const key = supplierKey(supplierId, ref);
  if (!key) return null;
  const esc = normSupplierRef(ref).split("").map(c => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\-_/.]*");
  return PurchaseModel.findOne({
    tenantId: new Types.ObjectId(String(tenantId)), status: { $ne: "cancelled" },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    $or: [{ activeSupplierKey: key }, { supplierId, supplierRef: { $regex: `^[\\s\\-_/.]*${esc}[\\s\\-_/.]*$`, $options: "i" } }],
  }).select("number externalRef status").session(session ?? null).lean<{ _id: Types.ObjectId; number?: string; externalRef?: string; status: string } | null>();
}

export const isSupplierKeyConflict = (e: unknown) => (e as { code?: number; keyPattern?: Record<string, unknown> }).code === 11000
  && !!(e as { keyPattern?: Record<string, unknown> }).keyPattern?.activeSupplierKey;
