import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { AutomationSettingsModel } from "@/models/AutomationSettings";
import { AutomationLogModel } from "@/models/AutomationLog";
import { UserModel } from "@/models/User";
import { loadAutomationSettings } from "@/lib/automation-store";
import { normalizeAutomationSettings } from "@/lib/automations";
import { isAiInvoiceConfigured } from "@/lib/ai-invoice";
import { whatsappTemplateStatus } from "@/lib/whatsapp";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Canaux réellement branchés sur l'instance : un envoi « console » n'arrive à personne. */
function channels() {
  const configured = (v?: string) => Boolean(v && v !== "console");
  return {
    email: configured(process.env.EMAIL_PROVIDER),
    whatsapp: configured(process.env.WHATSAPP_PROVIDER),
    sms: configured(process.env.SMS_PROVIDER),
    ai: isAiInvoiceConfigured(),
    /** Modèles WhatsApp approuvés configurés (envois hors conversation ouverte). */
    whatsappTemplates: whatsappTemplateStatus(),
  };
}

/**
 * GET /api/automations — réglages de l'organisation (défauts compris), canaux
 * branchés, utilisateurs pouvant recevoir le brief, dernières actions.
 */
export const GET = withAuth("companies", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const [settings, users, log] = await Promise.all([
    loadAutomationSettings(auth.tenantId),
    UserModel.find({ tenantId: auth.tenantId, isActive: true }).select("_id firstName lastName role email phone").sort({ firstName: 1 })
      .lean<Array<{ _id: unknown; firstName?: string; lastName?: string; role: string; email?: string; phone?: string }>>(),
    AutomationLogModel.find({ tenantId: auth.tenantId }).sort({ at: -1 }).limit(15).select("key at").lean<Array<{ key: string; at: Date }>>(),
  ]);
  return ok({
    settings, channels: channels(),
    users: users.map(u => ({ _id: String(u._id), name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email, role: u.role, hasPhone: Boolean(u.phone) })),
    recent: log.map(l => ({ kind: l.key.split(":")[0], at: l.at })),
  });
});

/**
 * PUT /api/automations — enregistre les réglages. Tout est validé et borné
 * côté serveur (lib/automations.ts) ; un dossier comptable activé sans
 * destinataire est refusé plutôt qu'enregistré inerte.
 */
export const PUT = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return badRequest("Réglages manquants.");
  const settings = normalizeAutomationSettings(body);
  if (settings.accountantPacket.enabled && settings.accountantPacket.emails.length === 0) {
    return badRequest("Indiquez au moins une adresse e-mail valide pour le dossier du comptable.");
  }
  if (settings.morningBrief.enabled && settings.morningBrief.channels.length === 0) return badRequest("Choisissez au moins un canal pour le brief du matin.");
  if (settings.cotisationReminders.enabled && settings.cotisationReminders.channels.length === 0) return badRequest("Choisissez au moins un canal pour les relances de cotisation.");
  // Destinataires du brief : uniquement des utilisateurs de l'organisation.
  if (settings.morningBrief.recipientIds.length) {
    const mine = await UserModel.find({ tenantId: auth.tenantId, _id: { $in: settings.morningBrief.recipientIds } }).select("_id").lean<Array<{ _id: unknown }>>();
    settings.morningBrief.recipientIds = mine.map(u => String(u._id));
  }
  const before = await loadAutomationSettings(auth.tenantId);
  await AutomationSettingsModel.updateOne(
    { tenantId: auth.tenantId },
    { $set: { ...settings, updatedBy: auth.userId } },
    { upsert: true },
  );
  await logAudit(auth, "UPDATE", "companies", { metadata: { automations: true }, before: before as unknown as Record<string, unknown>, after: settings as unknown as Record<string, unknown> });
  return ok({ settings });
});
