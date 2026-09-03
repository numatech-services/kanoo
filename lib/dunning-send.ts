import mongoose from "mongoose";
import { DunningLogModel } from "@/models/DunningLog";
import { NotificationModel } from "@/models/Notification";
import { UserModel } from "@/models/User";
import { sendEmail } from "@/lib/email";
import { sendSMS } from "@/lib/sms";
import { sendWhatsApp } from "@/lib/whatsapp";
import { errorMessage } from "@/lib/errors";
import {
  composeSubject, composeBody, composeSms, supersededSteps,
  type DunningAction, type DunningSettings, type MessageContext,
} from "@/lib/dunning";

export interface SendContext {
  tenantId: string;
  tenantName: string;
  settings: DunningSettings;
  /** Renseigné quand un humain déclenche l'envoi ; sinon le job de nuit. */
  triggeredBy?: string;
  automatic: boolean;
  /** Adresse en copie, pour que l'équipe garde la trace des courriers partis. */
  bccEmail?: string;
}

export interface SendResult {
  invoiceId: string;
  invoiceNumber: string;
  stepIndex: number;
  outcome: "sent" | "partial" | "failed" | "duplicate";
  channels: string[];
  errors: string[];
}

interface Contact { email?: string; phone?: string }

/** Corps HTML minimal : le texte reste la source, la mise en forme l'habille. */
function toHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;`
    + `font-size:14px;line-height:1.6;color:#2F3E46;white-space:pre-wrap;">`
    + `${escaped}</div>`;
}

/**
 * Exécute une action de relance.
 *
 * **La trace est écrite avant l'envoi**, pas après. Un `create` sur l'index
 * (organisation, facture, étape) échoue si la relance est déjà partie : c'est
 * ce qui garantit qu'un job rejoué, ou lancé en double, n'écrit pas deux fois
 * au même client. L'ordre inverse — envoyer puis journaliser — laisse une
 * fenêtre où un plantage produit un courrier sans trace, donc un second
 * courrier au prochain passage.
 *
 * Le prix de ce choix est symétrique et assumé : si l'envoi échoue, la trace
 * existe et porte `failed`. L'étape ne repartira pas d'elle-même — un échec
 * technique doit être vu et relancé à la main, pas retenté en boucle contre
 * une adresse qui n'existe pas.
 */
export async function executeAction(
  action: DunningAction,
  contact: Contact,
  ctx: SendContext,
  dueDate: Date
): Promise<SendResult> {
  const base: SendResult = {
    invoiceId: action.invoiceId,
    invoiceNumber: action.invoiceNumber,
    stepIndex: action.stepIndex,
    outcome: "failed",
    channels: [],
    errors: [],
  };

  let logId: mongoose.Types.ObjectId;
  try {
    const [log] = await DunningLogModel.create([{
      tenantId: ctx.tenantId,
      invoiceId: action.invoiceId,
      clientId: action.clientId,
      stepIndex: action.stepIndex,
      stepLabel: action.step.label,
      tone: action.step.tone,
      outcome: "failed", // corrigé à l'issue des envois
      outstanding: action.outstanding,
      daysPastDue: action.daysPastDue,
      triggeredBy: ctx.triggeredBy,
      automatic: ctx.automatic,
    }]);
    logId = log._id;
  } catch (err) {
    // Code 11000 : l'étape est déjà journalisée. Ce n'est pas une erreur, c'est
    // exactement le garde-fou qui joue son rôle.
    if ((err as { code?: number }).code === 11000) {
      return { ...base, outcome: "duplicate" };
    }
    throw err;
  }

  const message: MessageContext = {
    clientName: action.clientName,
    invoiceNumber: action.invoiceNumber,
    outstanding: action.outstanding,
    dueDate,
    daysPastDue: action.daysPastDue,
    tenantName: ctx.tenantName,
  };

  const body = composeBody(action.step.tone, message);
  const attempts: Array<{ channel: string; ok: boolean; error?: string }> = [];

  for (const channel of action.channels) {
    try {
      if (channel === "email" && contact.email) {
        const res = await sendEmail({
          to: contact.email,
          ...(ctx.bccEmail ? { bcc: ctx.bccEmail } : {}),
          subject: composeSubject(action.step.tone, message),
          html: toHtml(body),
          text: body,
        });
        attempts.push({ channel, ok: res.sent, error: res.error });
      } else if (channel === "sms" && contact.phone) {
        const ok = await sendSMS({
          to: contact.phone,
          message: composeSms(action.step.tone, message),
        });
        attempts.push({ channel, ok, error: ok ? undefined : "Envoi SMS refusé par le fournisseur" });
      } else if (channel === "whatsapp" && contact.phone) {
        const res = await sendWhatsApp({ to: contact.phone, text: body });
        attempts.push({ channel, ok: res.sent, error: res.error });
      } else {
        attempts.push({ channel, ok: false, error: "Coordonnée absente pour ce canal" });
      }
    } catch (err) {
      attempts.push({ channel, ok: false, error: errorMessage(err) });
    }
  }

  const delivered = attempts.filter(a => a.ok).map(a => a.channel);
  const outcome: SendResult["outcome"] =
    delivered.length === 0 ? "failed"
      : delivered.length === attempts.length ? "sent"
        : "partial";

  await DunningLogModel.updateOne(
    { _id: logId },
    { $set: { outcome, channels: delivered, attempts } }
  );

  // Les étapes antérieures non envoyées sont closes : sans cela, une facture
  // reprise tardivement recevrait le barème à rebours dans les jours suivants.
  if (outcome !== "failed") {
    const stale = supersededSteps(ctx.settings, action.stepIndex, new Set());
    if (stale.length > 0) {
      await DunningLogModel.insertMany(
        stale.map(stepIndex => ({
          tenantId: ctx.tenantId,
          invoiceId: action.invoiceId,
          clientId: action.clientId,
          stepIndex,
          stepLabel: ctx.settings.steps[stepIndex]?.label,
          outcome: "superseded",
          automatic: ctx.automatic,
        })),
        { ordered: false }
      ).catch(() => { /* déjà journalisées : rien à faire */ });
    }
  }

  if (action.step.notifyInternal && outcome !== "failed") {
    await notifyTeam(ctx.tenantId, action).catch(err =>
      console.error("[Relances] notification interne non créée:", err));
  }

  return {
    ...base,
    outcome,
    channels: delivered,
    errors: attempts.filter(a => !a.ok).map(a => `${a.channel} : ${a.error}`),
  };
}

async function notifyTeam(tenantId: string, action: DunningAction) {
  const recipients = await UserModel.find({
    tenantId,
    role: { $in: ["pme_admin", "pme_accountant", "pme_manager"] },
    isActive: true,
  }).select("_id").lean<Array<{ _id: mongoose.Types.ObjectId }>>();

  await NotificationModel.insertMany(recipients.map(user => ({
    tenantId,
    userId: user._id,
    type: "invoice_dunning",
    title: action.step.tone === "formal_notice" ? "Mise en demeure envoyée" : "Relance ferme envoyée",
    message: `${action.clientName} — facture ${action.invoiceNumber}, `
      + `${action.outstanding.toLocaleString("fr-FR")} XOF impayés depuis ${action.daysPastDue} jours.`,
    linkedTo: "invoices",
    linkedId: action.invoiceId,
  })));
}
