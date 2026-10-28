import { isId } from "@/lib/comptoir";

const HHMM = /^\d{2}:\d{2}$/;

/** Promotion saisie à l'écran → champs validés, ou message d'erreur. */
export function promoFields(b: Record<string, unknown>): Record<string, unknown> | string {
  const name = String(b.name ?? "").trim().slice(0, 80);
  if (!name) return "Nom de la promotion obligatoire.";
  if (!["percent", "price"].includes(String(b.kind))) return "Type de promotion inconnu (remise en % ou prix imposé).";
  const value = Number(b.value);
  if (!(value >= 0) || (b.kind === "percent" && value > 100)) return "Valeur invalide.";
  const itemIds = Array.isArray(b.itemIds) ? (b.itemIds as unknown[]).map(String).filter(isId) : [];
  const category = b.category ? String(b.category).trim().slice(0, 60) : undefined;
  if (!itemIds.length && !category) return "Choisissez des articles ou une famille.";
  const days = Array.isArray(b.days) ? (b.days as unknown[]).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  if ((b.from || b.to) && !(HHMM.test(String(b.from)) && HHMM.test(String(b.to)))) return "Plage horaire invalide (HH:MM).";
  return {
    name, kind: b.kind, value, itemIds, ...(category ? { category } : { category: undefined }), days,
    from: b.from || undefined, to: b.to || undefined, minQty: Number(b.minQty) > 0 ? Number(b.minQty) : undefined,
    startDate: b.startDate ? new Date(String(b.startDate)) : undefined, endDate: b.endDate ? new Date(String(b.endDate)) : undefined,
    active: b.active !== false,
  };
}

