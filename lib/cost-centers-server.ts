import { TenantModel } from "@/models/Tenant";
import { EmployeeModel } from "@/models/Employee";
import { PurchaseModel } from "@/models/Purchase";
import { COST_CENTERS } from "@/lib/cost-centers";

export interface CostCenterRow { value: string; label: string; active: boolean }

/** Libellés de l'ancienne liste unique (organigramme de NUMATECH), pour les pièces déjà imputées. */
const LEGACY: Record<string, string> = {
  direction: "Direction (gérant)", admin: "Administration", comm: "Communication", prosp: "Prospection",
  dev: "Développement", prod: "Production & Cartes", spot: "The Spot", secu: "Sécurité", compta: "Comptabilité",
};

/**
 * Services de l'organisation : sa liste (Réglages → Services), sinon la liste
 * par défaut, complétée des anciens codes qu'elle utilise déjà (rien ne
 * devient « service inconnu » du jour au lendemain). Les services retirés
 * restent lisibles mais ne se proposent plus à la saisie.
 */
export async function tenantCostCenters(tenantId: unknown, opts: { all?: boolean } = {}): Promise<CostCenterRow[]> {
  const t = await TenantModel.findById(tenantId).select("costCenters").lean<{ costCenters?: Array<{ code: string; label: string; active?: boolean }> } | null>();
  if (t?.costCenters?.length) {
    const rows = t.costCenters.map(c => ({ value: c.code, label: c.label, active: c.active !== false }));
    return opts.all ? rows : rows.filter(r => r.active);
  }
  const rows: CostCenterRow[] = Object.entries(COST_CENTERS).map(([value, label]) => ({ value, label, active: true }));
  const [a, b] = await Promise.all([
    EmployeeModel.distinct("costCenter", { tenantId, costCenter: { $nin: [null, ""] } }),
    PurchaseModel.distinct("costCenter", { tenantId, costCenter: { $nin: [null, ""] } }),
  ]);
  for (const code of new Set([...a, ...b].map(String))) {
    if (!rows.some(r => r.value === code) && LEGACY[code]) rows.push({ value: code, label: LEGACY[code], active: true });
  }
  return rows;
}

/** Libellés de tous les services connus (actuels, retirés, anciens). */
export async function costCenterLabels(tenantId: unknown): Promise<Record<string, string>> {
  const out: Record<string, string> = { ...LEGACY, ...COST_CENTERS };
  for (const r of await tenantCostCenters(tenantId, { all: true })) out[r.value] = r.label;
  return out;
}
