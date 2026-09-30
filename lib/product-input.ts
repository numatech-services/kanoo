import { Types } from "mongoose";

/**
 * Champs d'un article modifiables par formulaire. Jamais la quantité en stock
 * (elle ne bouge que par des mouvements) ni le coût moyen (calculé aux
 * entrées) — sauf le stock initial à la création, passé en mouvement.
 */
export function productFields(body: Record<string, unknown>): { data: Record<string, unknown>; error?: string } {
  const data: Record<string, unknown> = {};
  const str = (k: string, max: number) => { if (k in body) data[k] = String(body[k] ?? "").trim().slice(0, max); };
  const num = (k: string, opt: { min?: number; max?: number } = {}) => {
    if (!(k in body) || body[k] === "" || body[k] === null) return;
    const n = Number(body[k]);
    if (!Number.isFinite(n) || (opt.min !== undefined && n < opt.min) || (opt.max !== undefined && n > opt.max)) throw new Error(`Valeur invalide : ${k}`);
    data[k] = n;
  };
  try {
    str("label", 200); str("description", 2000); str("unit", 30); str("category", 80); str("barcode", 60); str("location", 80); str("accountCode", 20);
    num("unitPrice", { min: 0 }); num("tvaRate", { min: 0, max: 0.99 }); num("stockMinAlert", { min: 0 }); num("stockMaxAlert", { min: 0 });
    if ("isService" in body) data.isService = !!body.isService;
    if ("isActive" in body) data.isActive = !!body.isActive;
    if ("preferredSupplierId" in body) {
      const v = body.preferredSupplierId;
      if (v && !Types.ObjectId.isValid(String(v))) throw new Error("Fournisseur invalide.");
      data.preferredSupplierId = v || null;
    }
  } catch (e) {
    return { data, error: e instanceof Error ? e.message : "Données invalides." };
  }
  if ("label" in data && !data.label) return { data, error: "Désignation obligatoire." };
  return { data };
}
