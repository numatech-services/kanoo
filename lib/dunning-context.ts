import { DunningSettingsModel } from "@/models/DunningSettings";
import { DunningLogModel } from "@/models/DunningLog";
import { InvoiceModel } from "@/models/Invoice";
import { ClientModel } from "@/models/Client";
import { TenantModel } from "@/models/Tenant";
import {
  DEFAULT_DUNNING_SETTINGS, planRun,
  type DunningSettings, type InvoiceLike, type ClientLike,
  type DunningHistoryEntry, type DunningPlan,
} from "@/lib/dunning";

/**
 * Réglages d'une organisation, complétés par les valeurs par défaut.
 *
 * Une organisation qui n'a jamais ouvert l'écran n'a pas de document : elle
 * reçoit le barème standard **désactivé**. Aucune relance ne peut donc partir
 * d'une organisation qui ne s'est pas prononcée.
 */
export async function loadSettings(tenantId: string): Promise<DunningSettings & { bccEmail?: string }> {
  const doc = await DunningSettingsModel.findOne({ tenantId })
    .lean<(DunningSettings & { bccEmail?: string }) | null>();
  if (!doc) return { ...DEFAULT_DUNNING_SETTINGS };

  return {
    enabled: doc.enabled ?? false,
    steps: doc.steps?.length ? doc.steps : DEFAULT_DUNNING_SETTINGS.steps,
    minAmount: doc.minAmount ?? DEFAULT_DUNNING_SETTINGS.minAmount,
    sendDays: doc.sendDays ?? DEFAULT_DUNNING_SETTINGS.sendDays,
    minIntervalDays: doc.minIntervalDays ?? DEFAULT_DUNNING_SETTINGS.minIntervalDays,
    respectDisputes: doc.respectDisputes ?? true,
    bccEmail: doc.bccEmail,
  };
}

export interface PortfolioContext {
  invoices: InvoiceLike[];
  clients: Map<string, ClientLike>;
  history: DunningHistoryEntry[];
  tenantName: string;
}

/**
 * Charge le portefeuille relançable d'une organisation.
 *
 * Le filtre est volontairement large — toute facture non soldée, y compris
 * celles qui ne seront pas relancées. Restreindre ici ferait disparaître de
 * l'écran d'aperçu les factures écartées, et c'est justement ce que
 * l'utilisateur a besoin de voir : pourquoi tel impayé n'est pas relancé.
 */
export async function loadPortfolio(tenantId: string): Promise<PortfolioContext> {
  const [invoices, tenant] = await Promise.all([
    InvoiceModel.find({
      tenantId,
      documentType: { $ne: "credit_note" },
      status: { $in: ["sent", "partial", "overdue"] },
    })
      .select("number totalTTC paidAmount creditedAmount retentionAmount dueDate status documentType clientId disputedAt")
      .sort({ dueDate: 1 })
      .limit(2_000)
      .lean<InvoiceLike[]>(),
    TenantModel.findById(tenantId).select("name").lean<{ name?: string } | null>(),
  ]);

  const clientIds = [...new Set(invoices.map(i => String(i.clientId)))];
  const [clientDocs, logs] = await Promise.all([
    ClientModel.find({ tenantId, _id: { $in: clientIds } })
      .select("name email phone").lean<ClientLike[]>(),
    DunningLogModel.find({ tenantId, invoiceId: { $in: invoices.map(i => i._id) } })
      .select("invoiceId stepIndex sentAt outcome")
      .lean<Array<{ invoiceId: unknown; stepIndex: number; sentAt: Date; outcome: string }>>(),
  ]);

  return {
    invoices,
    clients: new Map(clientDocs.map(c => [String(c._id), c])),
    tenantName: tenant?.name || "Votre fournisseur",
    // Une étape en échec compte comme envoyée : elle ne doit pas repartir
    // toute seule contre une adresse qui a déjà refusé le message.
    history: logs.map(l => ({
      invoiceId: String(l.invoiceId),
      stepIndex: l.stepIndex,
      sentAt: l.sentAt,
      outcome: l.outcome,
    })),
  };
}

/** Plan du jour, tel que l'écran l'affiche et tel que le job l'exécutera. */
export async function planForTenant(
  tenantId: string,
  asOf: Date = new Date()
): Promise<{ plan: DunningPlan; context: PortfolioContext; settings: DunningSettings & { bccEmail?: string } }> {
  const [settings, context] = await Promise.all([
    loadSettings(tenantId),
    loadPortfolio(tenantId),
  ]);
  return {
    settings,
    context,
    plan: planRun(context.invoices, context.clients, settings, context.history, asOf),
  };
}
