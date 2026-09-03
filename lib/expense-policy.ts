import { TenantModel } from "@/models/Tenant";
import { DEFAULT_POLICY, type ExpensePolicy, type ExpenseCategory } from "@/lib/expenses";

interface StoredPolicy {
  expensePolicy?: {
    caps?: Partial<Record<ExpenseCategory, number>>;
    mileageRate?: number;
    receiptThreshold?: number;
    maxAgeDays?: number;
    vatRate?: number;
  };
}

/**
 * Règles de frais d'une organisation, complétées par les valeurs par défaut.
 *
 * `mileageRate` n'a **volontairement pas** de valeur par défaut : le Niger ne
 * publie pas de barème kilométrique officiel, et en inventer un ferait passer
 * un chiffre arbitraire pour une référence fiscale opposable. Tant qu'une
 * organisation ne l'a pas fixé, la saisie au kilomètre est refusée — avec le
 * message qui dit où le renseigner.
 */
export async function loadPolicy(tenantId: string): Promise<ExpensePolicy> {
  const tenant = await TenantModel.findById(tenantId)
    .select("expensePolicy").lean<StoredPolicy | null>();
  const stored = tenant?.expensePolicy;
  if (!stored) return { ...DEFAULT_POLICY };

  return {
    caps: stored.caps ?? DEFAULT_POLICY.caps,
    mileageRate: stored.mileageRate,
    receiptThreshold: stored.receiptThreshold ?? DEFAULT_POLICY.receiptThreshold,
    maxAgeDays: stored.maxAgeDays ?? DEFAULT_POLICY.maxAgeDays,
    vatRate: stored.vatRate ?? DEFAULT_POLICY.vatRate,
  };
}
