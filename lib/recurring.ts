import { Types } from "mongoose";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { SupplierModel } from "@/models/Supplier";
import { pickImputation, checkImputations } from "@/lib/imputation";

export const FREQUENCIES = ["daily", "weekly", "monthly", "quarterly", "biannual", "annual"];

/**
 * Champs d'une charge récurrente, contrôlés : montant, fréquence, compte de
 * charge (6…), compte de trésorerie et fournisseur de l'organisation,
 * imputation. `partial` : modification (seuls les champs fournis).
 */
export async function recurringFields(tenantId: string, body: Record<string, unknown>, partial = false): Promise<{ data: Record<string, unknown>; error?: string }> {
  const data: Record<string, unknown> = {};
  const has = (k: string) => k in body;
  if (!partial || has("label")) { const l = String(body.label ?? "").trim(); if (!l) return { data, error: "Libellé obligatoire." }; data.label = l.slice(0, 160); }
  if (!partial || has("amount")) { const a = Math.round(Number(body.amount)); if (!(a > 0)) return { data, error: "Montant invalide." }; data.amount = a; }
  if (!partial || has("frequency")) { if (!FREQUENCIES.includes(String(body.frequency))) return { data, error: "Fréquence invalide." }; data.frequency = body.frequency; }
  if (has("category")) data.category = body.category;
  if (has("description")) data.description = String(body.description ?? "").slice(0, 500);
  if (has("accountCode")) { const c = String(body.accountCode ?? "").trim(); if (!/^6\d{2,7}$/.test(c)) return { data, error: "Compte de charge (6…) attendu." }; data.accountCode = c; }
  if (has("alertDaysBefore")) data.alertDaysBefore = Math.max(0, Math.min(60, Number(body.alertDaysBefore) || 0));
  if (has("isActive")) data.isActive = !!body.isActive;
  if (has("nextDueDate") && body.nextDueDate) { const d = new Date(String(body.nextDueDate)); if (isNaN(d.getTime())) return { data, error: "Échéance invalide." }; data.nextDueDate = d; }
  if (has("treasuryAccountId")) {
    const v = body.treasuryAccountId;
    if (v) {
      if (!Types.ObjectId.isValid(String(v)) || !(await TreasuryAccountModel.exists({ _id: v, tenantId }))) return { data, error: "Compte de trésorerie introuvable." };
      data.treasuryAccountId = v;
    } else data.treasuryAccountId = null;
  }
  if (has("supplierId")) {
    const v = body.supplierId;
    if (v) {
      if (!Types.ObjectId.isValid(String(v)) || !(await SupplierModel.exists({ _id: v, tenantId }))) return { data, error: "Fournisseur introuvable." };
      data.supplierId = v;
    } else data.supplierId = null;
  }
  if (["projectId", "activityId", "costCenter"].some(has)) {
    const imp = pickImputation(body);
    const e = await checkImputations(tenantId, [imp]);
    if (e) return { data, error: e };
    data.projectId = imp.projectId ?? null; data.activityId = imp.activityId ?? null; data.costCenter = imp.costCenter ?? null;
  }
  return { data };
}
