/**
 * Lecture du token JWT côté serveur (Server Components / layouts)
 * Ne jamais utiliser dans des Client Components
 */
import { cookies } from "next/headers";
import { verifyToken } from "./auth";
import type { TokenPayload } from "./auth";
import { effectiveRoles, rolesCanPerform } from "./role-resources";

export async function getServerAuth(): Promise<TokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value
    || cookieStore.get("session")?.value
    || cookieStore.get("token")?.value;

  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

/**
 * Droits du visiteur pour un Server Component.
 *
 * Les blocs du tableau de bord lisaient la base avec le seul `tenantId` : un
 * rôle restreint (gestionnaire The Spot, opérateur ISIC, responsable technique)
 * y voyait le chiffre d'affaires, les impayés et les dernières factures alors
 * que l'API correspondante lui répondait 403. Chaque bloc vérifie désormais la
 * même permission que l'API qu'il résume.
 */
export async function getServerAccess(): Promise<{
  auth: TokenPayload;
  can: (resource: string, action?: "read" | "create" | "update" | "delete") => boolean;
} | null> {
  const auth = await getServerAuth();
  if (!auth) return null;
  const roles = effectiveRoles(auth.role, auth.roles);
  return {
    auth,
    can: (resource, action = "read") => rolesCanPerform(roles, resource, action, auth.allowedResources),
  };
}

export async function getServerTenantType(): Promise<"pme" | "association" | "administration" | "superadmin"> {
  const auth = await getServerAuth();
  
  // Si l'utilisateur est superadmin, retourner "superadmin"
  if (auth?.role === "superadmin") {
    return "superadmin";
  }
  
  return (auth?.tenantType as "pme" | "association" | "administration") || "pme";
}
