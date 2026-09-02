/**
 * Lecture du token JWT côté serveur (Server Components / layouts)
 * Ne jamais utiliser dans des Client Components
 */
import { cookies } from "next/headers";
import { verifyToken } from "./auth";
import type { TokenPayload } from "./auth";

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

export async function getServerTenantType(): Promise<"pme" | "association" | "administration" | "superadmin"> {
  const auth = await getServerAuth();
  
  // Si l'utilisateur est superadmin, retourner "superadmin"
  if (auth?.role === "superadmin") {
    return "superadmin";
  }
  
  return (auth?.tenantType as "pme" | "association" | "administration") || "pme";
}
