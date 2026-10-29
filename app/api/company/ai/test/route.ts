import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { API_KEY_RE, clientForKey, tenantAi, isKnownModel, aiErrorMessage } from "@/lib/ai-client";
import { hasTenantAdminRole } from "@/lib/roles-ui";
import { consumeRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * POST { apiKey?, model? } — vérifie une clé (celle saisie, sinon celle
 * enregistrée) et l'accès au modèle, sans générer de texte : rien n'est
 * facturé ni décompté du plafond.
 */
export const POST = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!hasTenantAdminRole(auth)) return forbidden("Réglage réservé à l'administrateur de l'organisation.");
  // Pas un banc d'essai de clés : 10 tests par heure et par organisation, tous tracés.
  const rl = await consumeRateLimit("ai-key-test", auth.tenantId, 10, 3_600_000);
  if (!rl.allowed) return badRequest(`Trop de tests de clé : réessayez dans ${Math.ceil(rl.retryAfter / 60)} minutes.`);
  const body = await req.json().catch(() => ({}));
  const typed = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : null;
  if (typed && !API_KEY_RE.test(typed)) return badRequest("Clé d'API invalide : elle commence par « sk-ant- ».");
  const current = typed ? null : await tenantAi(auth.tenantId);
  if (!typed && !current) return badRequest("Aucune clé à tester : saisissez-en une.");
  const client = typed ? clientForKey(typed) : current!.client;
  const model = isKnownModel(body.model) ? body.model : current?.model ?? "claude-opus-5-5";
  try {
    const info = await client.models.retrieve(model);
    await logAudit(auth, "READ", "companies", { resourceId: auth.tenantId, metadata: { ai: "key_test", ok: true, model } });
    return ok({ ok: true, model: info.id, label: info.display_name, source: typed ? "saisie" : current!.source });
  } catch (err) {
    await logAudit(auth, "READ", "companies", { resourceId: auth.tenantId, metadata: { ai: "key_test", ok: false, model } });
    return badRequest(aiErrorMessage(err) ?? "Anthropic ne répond pas : vérifiez la connexion du serveur, puis réessayez.");
  }
});
