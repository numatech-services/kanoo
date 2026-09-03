import { NextRequest } from "next/server";
import { withAuth, ok, badRequest } from "@/lib/api-helpers";
import { DunningSettingsModel } from "@/models/DunningSettings";
import { loadSettings } from "@/lib/dunning-context";
import { DEFAULT_DUNNING_STEPS, type DunningStep } from "@/lib/dunning";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const GET = withAuth("invoices", "read", async (_req: NextRequest, auth: TokenPayload) => {
  return ok(await loadSettings(auth.tenantId));
});

const TONES = ["courtesy", "reminder", "firm", "formal_notice"];
const CHANNELS = ["email", "sms", "whatsapp"];

/**
 * PUT /api/relances/parametres
 *
 * Le barème part écrire à des clients réels. Il est validé ici, pas seulement
 * dans le formulaire : un appel direct à l'API ne doit pas pouvoir installer
 * une mise en demeure à J+1.
 */
export const PUT = withAuth("invoices", "update", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json().catch(() => ({}));

  const rawSteps: unknown = body.steps;
  let steps: DunningStep[] = DEFAULT_DUNNING_STEPS;

  if (Array.isArray(rawSteps)) {
    if (rawSteps.length === 0) return badRequest("Un barème sans étape ne relance rien.");
    if (rawSteps.length > 8) return badRequest("Huit étapes au maximum : au-delà, c'est du harcèlement.");

    // Les erreurs de saisie sont collectées et renvoyées en 400. Les lever
    // ici les ferait remonter en 500 avec un identifiant de référence :
    // l'utilisateur verrait « erreur interne » pour une virgule mal placée.
    const validated: DunningStep[] = [];
    for (const [i, raw] of rawSteps.entries()) {
      const step = raw as Partial<DunningStep>;
      const offsetDays = Number(step.offsetDays);
      if (!Number.isFinite(offsetDays)) return badRequest(`Étape ${i + 1} : décalage invalide.`);
      if (offsetDays < -30 || offsetDays > 365) {
        return badRequest(`Étape ${i + 1} : le décalage doit rester entre −30 et 365 jours.`);
      }

      const tone = String(step.tone);
      if (!TONES.includes(tone)) return badRequest(`Étape ${i + 1} : ton inconnu.`);

      const channels = (Array.isArray(step.channels) ? step.channels : [])
        .filter(c => CHANNELS.includes(String(c)));
      if (channels.length === 0) return badRequest(`Étape ${i + 1} : aucun canal retenu.`);

      validated.push({
        label: String(step.label || `Étape ${i + 1}`).slice(0, 80),
        offsetDays,
        channels: channels as DunningStep["channels"],
        tone: tone as DunningStep["tone"],
        notifyInternal: Boolean(step.notifyInternal),
        // Une mise en demeure passe toujours par une validation humaine, quoi
        // qu'en dise l'appelant : la désactiver depuis l'API en ferait un
        // courrier juridique expédié par un cron.
        requiresApproval: tone === "formal_notice" ? true : Boolean(step.requiresApproval),
      });
    }
    steps = validated;

    const offsets = steps.map(s => s.offsetDays);
    if (new Set(offsets).size !== offsets.length) {
      return badRequest("Deux étapes au même jour : le client recevrait deux messages.");
    }
  }

  const minAmount = Number(body.minAmount);
  if (body.minAmount !== undefined && (!Number.isFinite(minAmount) || minAmount < 0)) {
    return badRequest("Seuil de relance invalide.");
  }

  const sendDays = Array.isArray(body.sendDays)
    ? [...new Set(body.sendDays.map(Number).filter((d: number) => d >= 0 && d <= 6))]
    : undefined;

  const settings = await DunningSettingsModel.findOneAndUpdate(
    { tenantId: auth.tenantId },
    {
      $set: {
        tenantId: auth.tenantId,
        ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
        ...(Array.isArray(rawSteps) ? { steps } : {}),
        ...(body.minAmount !== undefined ? { minAmount } : {}),
        ...(sendDays ? { sendDays } : {}),
        ...(body.minIntervalDays !== undefined
          ? { minIntervalDays: Math.max(0, Number(body.minIntervalDays) || 0) } : {}),
        ...(body.respectDisputes !== undefined ? { respectDisputes: Boolean(body.respectDisputes) } : {}),
        ...(body.bccEmail !== undefined ? { bccEmail: String(body.bccEmail).trim() || undefined } : {}),
        updatedBy: auth.userId,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  await logAudit(auth, "UPDATE", "invoices", {
    metadata: { module: "relances", enabled: body.enabled },
  });

  return ok(settings);
});
