import { TokenPayload } from "./auth";
import { rolesCanPerform, effectiveRoles } from "./role-resources";
import { UserRole } from "@/types";

/** L'utilisateur a-t-il accès au volet FINANCIER du module ISIC ? */
export function hasIsicFinance(auth: TokenPayload): boolean {
  const roles = effectiveRoles(auth.role as UserRole, auth.roles as UserRole[] | undefined);
  return rolesCanPerform(roles, "isicFinance", "read", auth.allowedResources);
}

/** Champs financiers d'un lot — masqués aux rôles non financiers (ex. opérateur d'impression). */
export const ISIC_FINANCE_FIELDS = ["unitLicenseFee", "unitSalePrice", "payments", "licensePayments"] as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function stripIsicFinance<T extends Record<string, any>>(batch: T): T {
  const b: any = { ...batch };
  for (const f of ISIC_FINANCE_FIELDS) delete b[f];
  return b;
}
