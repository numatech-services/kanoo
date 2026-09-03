import { NextRequest } from "next/server";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { ClientModel } from "@/models/Client";
import { TenantModel } from "@/models/Tenant";
import { DunningLogModel } from "@/models/DunningLog";
import { loadSettings } from "@/lib/dunning-context";
import { executeAction } from "@/lib/dunning-send";
import {
  outstandingAmount, daysPastDue,
  type DunningAction, type DunningTone, type InvoiceLike, type ClientLike,
} from "@/lib/dunning";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TONES: DunningTone[] = ["courtesy", "reminder", "firm", "formal_notice"];

/** GET — historique des relances d'une facture. */
export const GET = withAuth("invoices", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const logs = await DunningLogModel.find({ ...tenantFilter(auth), invoiceId: params.id })
    .sort({ sentAt: -1 }).lean();
  return ok({ items: logs });
});

/**
 * POST — relancer cette facture maintenant.
 *
 * Le geste manuel ne contourne aucun garde-fou de fond : ni un avoir, ni une
 * facture soldée, ni un brouillon ne se relancent. Il contourne en revanche le
 * calendrier — c'est précisément à cela qu'il sert, et c'est le comptable qui
 * décide, pas le barème.
 *
 * L'étape est journalisée sous un index négatif décroissant : les envois
 * manuels ne consomment donc jamais une case du barème automatique, et ne
 * l'empêchent pas de se dérouler.
 */
export const POST = withAuth("invoices", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json().catch(() => ({}));
  const tone: DunningTone = TONES.includes(body.tone) ? body.tone : "reminder";

  const invoice = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .select("number totalTTC paidAmount creditedAmount dueDate status documentType clientId")
    .lean<InvoiceLike | null>();
  if (!invoice) return notFound("Facture introuvable");

  if (invoice.documentType === "credit_note") return badRequest("Un avoir ne se relance pas.");
  if (invoice.status === "draft") return badRequest("Cette facture est encore au brouillon.");
  if (invoice.status === "cancelled") return badRequest("Cette facture est annulée.");
  if (!invoice.dueDate) return badRequest("Cette facture n'a pas d'échéance.");

  const outstanding = outstandingAmount(invoice);
  if (outstanding <= 0) return badRequest("Cette facture est soldée : il n'y a rien à réclamer.");

  const client = await ClientModel.findOne({ _id: invoice.clientId, ...tenantFilter(auth) })
    .select("name email phone").lean<ClientLike | null>();
  if (!client) return notFound("Client introuvable");

  const requested: string[] = Array.isArray(body.channels) && body.channels.length > 0
    ? body.channels : ["email"];
  const channels = requested.filter(c =>
    c === "email" ? Boolean(client.email) : Boolean(client.phone)
  ) as DunningAction["channels"];

  if (channels.length === 0) {
    return badRequest(
      `Aucune coordonnée pour ${client.name} sur ${requested.join(", ")}. `
      + `Complétez la fiche client avant de relancer.`
    );
  }

  const settings = await loadSettings(auth.tenantId);
  const tenant = await TenantModel.findById(auth.tenantId).select("name").lean<{ name?: string } | null>();

  // Index négatif : -1, -2, -3… Les envois manuels s'empilent sans jamais
  // entrer en collision avec les étapes du barème, qui sont positives.
  const manualCount = await DunningLogModel.countDocuments({
    ...tenantFilter(auth), invoiceId: params.id, stepIndex: { $lt: 0 },
  });

  const action: DunningAction = {
    invoiceId: String(invoice._id),
    invoiceNumber: invoice.number,
    clientId: String(client._id),
    clientName: client.name,
    stepIndex: -(manualCount + 1),
    step: { label: "Relance manuelle", offsetDays: 0, channels, tone },
    channels,
    outstanding,
    daysPastDue: daysPastDue(invoice, new Date()),
    needsApproval: false,
  };

  const result = await executeAction(
    action,
    { email: client.email, phone: client.phone },
    {
      tenantId: auth.tenantId,
      tenantName: tenant?.name || "Votre fournisseur",
      settings,
      triggeredBy: auth.userId,
      automatic: false,
      bccEmail: settings.bccEmail,
    },
    new Date(invoice.dueDate)
  );

  await logAudit(auth, "UPDATE", "invoices", {
    resourceId: String(params.id),
    metadata: { module: "relances", manual: true, tone, outcome: result.outcome },
  });

  if (result.outcome === "failed") {
    return badRequest(`Envoi impossible — ${result.errors.join(" ; ")}`);
  }

  return ok({
    outcome: result.outcome,
    channels: result.channels,
    message: result.outcome === "partial"
      ? `Relance partie sur ${result.channels.join(", ")} ; ${result.errors.join(" ; ")}`
      : `Relance envoyée à ${client.name} sur ${result.channels.join(", ")}.`,
  });
});
