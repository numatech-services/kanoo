/**
 * Codes-barres d'un article : le code de l'unité, celui du carton (une
 * lecture = un carton) et d'autres codes de l'unité (autre fournisseur,
 * autre conditionnement de même contenu). Un code désigne un seul article du
 * comptoir.
 */
export interface Coded { name: string; barcode?: string | null; packBarcode?: string | null; altBarcodes?: string[] | null }

export const normCode = (c: unknown) => String(c ?? "").replace(/\s+/g, "").slice(0, 60);

/** Tous les codes d'un article (vides écartés). */
export function codesOf(i: Omit<Coded, "name">): string[] {
  return [i.barcode, i.packBarcode, ...(i.altBarcodes ?? [])].map(normCode).filter(Boolean);
}

/**
 * Article désigné par une lecture : code exact (unité, carton ou autre), à
 * défaut un seul article dont le nom contient le texte tapé. `pack` : le code
 * lu est celui du carton.
 */
export function matchCode<T extends Coded>(rows: T[], code: string): { row: T; pack: boolean } | null {
  const c = normCode(code).toLowerCase();
  if (!c) return null;
  for (const r of rows) {
    if (normCode(r.packBarcode).toLowerCase() === c && r.packBarcode) return { row: r, pack: true };
    if ([r.barcode, ...(r.altBarcodes ?? [])].some(x => x && normCode(x).toLowerCase() === c)) return { row: r, pack: false };
  }
  const t = String(code).trim().toLowerCase();
  const byName = rows.filter(r => r.name.toLowerCase().includes(t));
  return byName.length === 1 ? { row: byName[0], pack: false } : null;
}
