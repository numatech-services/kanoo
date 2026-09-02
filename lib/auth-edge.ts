import { jwtVerify } from "jose";

/**
 * Clé de vérification Edge, résolue à l'usage. Le secret faible/par défaut est
 * refusé en production ; en cas d'absence, verifyTokenEdge échoue « fermé »
 * (retourne null → non authentifié).
 */
// Le runtime Edge ne peut pas importer lib/auth (jsonwebtoken, bcrypt, crypto) :
// la règle est donc redite ici, à l'identique.
const PLACEHOLDER_SECRET_PREFIX = "CHANGE_ME";

function getEdgeKey(): Uint8Array {
  const s = process.env.JWT_SECRET;
  const usable = !!s && s.length >= 32 && !s.startsWith(PLACEHOLDER_SECRET_PREFIX);
  const secret = usable
    ? s
    : process.env.NODE_ENV !== "production"
    ? "dev-only-insecure-secret-0000000000000000000000000000"
    : null;
  if (!secret) {
    throw new Error(
      "JWT_SECRET manquant, trop court ou laissé à sa valeur d'exemple (>= 32 caractères requis)."
    );
  }
  return new TextEncoder().encode(secret);
}

export async function verifyTokenEdge(token: string) {
  try {
    const { payload } = await jwtVerify(token, getEdgeKey(), { algorithms: ["HS256"] });
    return payload as any; // Retourne les données du user (role, tenantId, etc.)
  } catch (error) {
    console.error("Erreur de vérification Edge (auth-edge)", error);
    return null;
  }
}