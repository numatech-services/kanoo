import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest } from "@/lib/api-helpers";
import { generateApiKey } from "@/lib/api-key";
import { ApiKeyModel } from "@/models/ApiKey";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/**
 * Clés de l'API v1 de l'organisation. Réservé à qui administre l'entreprise
 * (une clé lit des données de toute l'organisation), protégé contre le CSRF
 * par withAuth. Les clés d'un comptoir (EasyPay) se créent depuis le comptoir.
 */
const GENERAL_SCOPES = ["invoices:read", "clients:read", "invoices:write", "purchases:read", "purchases:write", "easypay:network"];
// Par défaut, une clé ne fait que lire : l'écriture se demande explicitement.
const DEFAULT_SCOPES = ["invoices:read", "clients:read"];

// POST /api/v1/auth — Générer une clé API
export const POST = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json().catch(() => ({}));
  const scopes: string[] = Array.isArray(body.scopes) && body.scopes.length ? body.scopes.map(String) : DEFAULT_SCOPES;
  const unknown = scopes.filter(s => !GENERAL_SCOPES.includes(s));
  // Le jeton de la liaison réseau est remis à l'exploitant d'EasyPay : il ne sert qu'à elle.
  if (scopes.includes("easypay:network") && scopes.length > 1) return badRequest("Le droit easypay:network ne se combine avec aucun autre.");
  if (unknown.length) return badRequest(`Scope non autorisé : ${unknown.join(", ")}. Possibles : ${GENERAL_SCOPES.join(", ")}.`);
  const days = Math.min(365, Math.max(1, Number(body.days) || 365));

  const { key, hash, prefix } = generateApiKey();
  const doc = await ApiKeyModel.create({
    tenantId: auth.tenantId, userId: auth.userId,
    name: String(body.name || "Clé API").slice(0, 80),
    keyHash: hash, keyPrefix: prefix, scopes,
    expiresAt: new Date(Date.now() + days * 86_400_000),
  });
  await logAudit(auth, "CREATE", "api_key", { metadata: { keyId: String(doc._id), scopes } });

  return created({
    key, // Affiché UNE SEULE FOIS
    prefix, scopes, expiresAt: doc.expiresAt,
    warning: "⚠ Cette clé ne sera plus affichée. Conservez-la dans un endroit sécurisé.",
  });
});

// GET /api/v1/auth — Lister les clés (sans les valeurs)
export const GET = withAuth("companies", "read", async (_req: NextRequest, auth: TokenPayload) => {
  const keys = await ApiKeyModel.find({ tenantId: auth.tenantId }).select("-keyHash").sort({ createdAt: -1 }).lean();
  return ok(keys);
});
