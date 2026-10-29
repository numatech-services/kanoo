import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { TenantModel } from "@/models/Tenant";
import { encryptField } from "@/lib/crypto-field";
import { AI_MODELS, API_KEY_RE, PLATFORM_MODEL, isKnownModel, keyHint } from "@/lib/ai-client";
import { readAiQuota } from "@/lib/ai-quota";
import { hasTenantAdminRole } from "@/lib/roles-ui";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Réglages de l'assistant Claude de l'organisation (lib/ai-client) : clé
 * d'API Anthropic propre, modèle, plafond mensuel. Réservés à
 * l'administrateur : la clé engage le compte de l'organisation chez Anthropic.
 * La clé n'est jamais renvoyée — seulement « sk-ant-…abcd ».
 */
async function state(tenantId: string) {
  const t = await TenantModel.findById(tenantId).select("ai.keyHint ai.keySetAt ai.model ai.monthlyQuota")
    .lean<{ ai?: { keyHint?: string; keySetAt?: Date; model?: string; monthlyQuota?: number } } | null>();
  const own = Boolean(t?.ai?.keyHint);
  return {
    source: own ? "tenant" : process.env.ANTHROPIC_API_KEY ? "platform" : null,
    keyHint: t?.ai?.keyHint ?? null,
    keySetAt: t?.ai?.keySetAt ?? null,
    model: isKnownModel(t?.ai?.model) ? t!.ai!.model : PLATFORM_MODEL,
    monthlyQuota: t?.ai?.monthlyQuota ?? null,
    platformAvailable: Boolean(process.env.ANTHROPIC_API_KEY),
    models: AI_MODELS,
    quota: await readAiQuota(tenantId),
  };
}

export const GET = withAuth("companies", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!hasTenantAdminRole(auth)) return forbidden("Réglage réservé à l'administrateur de l'organisation.");
  return ok(await state(auth.tenantId));
});

/** PATCH { apiKey?, removeKey?, model?, monthlyQuota? } */
export const PATCH = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!hasTenantAdminRole(auth)) return forbidden("Réglage réservé à l'administrateur de l'organisation.");
  const body = await req.json().catch(() => ({}));
  const set: Record<string, unknown> = {}, unset: Record<string, 1> = {};
  const changes: string[] = [];
  if (body.removeKey === true) {
    Object.assign(unset, { "ai.apiKeyEnc": 1, "ai.keyHint": 1, "ai.keySetAt": 1, "ai.keySetBy": 1 });
    changes.push("clé retirée");
  } else if (body.apiKey !== undefined) {
    const key = String(body.apiKey ?? "").trim();
    if (!API_KEY_RE.test(key)) return badRequest("Clé d'API invalide : elle commence par « sk-ant- » (console.anthropic.com → API Keys).");
    Object.assign(set, { "ai.apiKeyEnc": encryptField(key), "ai.keyHint": keyHint(key), "ai.keySetAt": new Date(), "ai.keySetBy": auth.userId });
    changes.push("clé enregistrée");
  }
  if (body.model !== undefined) {
    if (!isKnownModel(body.model)) return badRequest("Modèle inconnu.");
    set["ai.model"] = body.model;
    changes.push(`modèle ${body.model}`);
  }
  if (body.monthlyQuota !== undefined) {
    if (body.monthlyQuota === null || body.monthlyQuota === "") unset["ai.monthlyQuota"] = 1;
    else {
      const q = Number(body.monthlyQuota);
      if (!Number.isInteger(q) || q < 0 || q > 100000) return badRequest("Plafond mensuel : un nombre entier de 0 à 100 000 générations.");
      set["ai.monthlyQuota"] = q;
    }
    changes.push("plafond");
  }
  if (!changes.length) return badRequest("Rien à modifier.");
  await TenantModel.updateOne({ _id: auth.tenantId }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  // Jamais la clé au journal : seulement ce qui a changé.
  await logAudit(auth, "UPDATE", "companies", { resourceId: auth.tenantId, metadata: { ai: changes } });
  return ok(await state(auth.tenantId));
});
