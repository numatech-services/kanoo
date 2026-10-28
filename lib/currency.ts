/**
 * Devises des comptes de trésorerie.
 *
 * La comptabilité de Kanoo est tenue en FCFA : un compte en devise (euro,
 * dollar, naira…) y est suivi à sa CONTRE-VALEUR en FCFA. La devise et le
 * cours servent à afficher le solde dans la devise du compte — la devise
 * était enregistrée puis ignorée, sans que rien ne le dise.
 */
export const CURRENCIES: Record<string, { label: string; fixedRate?: number }> = {
  XOF: { label: "Franc CFA (BCEAO)" },
  XAF: { label: "Franc CFA (BEAC)", fixedRate: 1 },
  EUR: { label: "Euro", fixedRate: 655.957 },
  USD: { label: "Dollar américain" },
  NGN: { label: "Naira" },
  GHS: { label: "Cedi" },
  CNY: { label: "Yuan" },
  GBP: { label: "Livre sterling" },
};

export const isCurrency = (v: unknown): v is string => typeof v === "string" && v in CURRENCIES;

/** Cours (FCFA pour 1 unité) : parité fixe, sinon le cours saisi. */
export function rateOf(currency: string | undefined, rate?: number | null): number | null {
  if (!currency || currency === "XOF") return 1;
  const fixed = CURRENCIES[currency]?.fixedRate;
  if (fixed) return fixed;
  return rate && rate > 0 ? rate : null;
}

/** Solde dans la devise du compte, d'après sa contre-valeur en FCFA. */
export function foreignAmount(xof: number, currency: string | undefined, rate?: number | null): number | null {
  const r = rateOf(currency, rate);
  if (!r || !currency || currency === "XOF") return null;
  return Math.round((xof / r) * 100) / 100;
}
