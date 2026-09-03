import { NextRequest } from "next/server";
import { withAuth, ok, badRequest } from "@/lib/api-helpers";
import { planForTenant } from "@/lib/dunning-context";
import { executeAction, type SendResult } from "@/lib/dunning-send";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Une exécution manuelle reste bornée : au-delà, c'est le job de nuit. */
const MAX_PER_RUN = 200;

/**
 * POST /api/relances/executer
 *
 * Exécute le plan du jour. Deux réserves délibérées :
 *
 * - Les étapes marquées `requiresApproval` — la mise en demeure — ne partent
 *   que si l'appelant les a explicitement nommées dans `approvedInvoiceIds`.
 *   Un « tout envoyer » ne doit jamais expédier un courrier juridique.
 * - `invoiceIds` restreint l'exécution à une sélection, pour permettre de
 *   relancer trois clients sans déclencher la campagne entière.
 */
export const POST = withAuth("invoices", "update", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json().catch(() => ({}));
  const { plan, context, settings } = await planForTenant(auth.tenantId);

  if (!settings.enabled) {
    return badRequest("Les relances sont désactivées. Activez-les dans les paramètres avant d'exécuter.");
  }

  const only = Array.isArray(body.invoiceIds) ? new Set(body.invoiceIds.map(String)) : null;
  const approved = new Set((Array.isArray(body.approvedInvoiceIds) ? body.approvedInvoiceIds : []).map(String));

  const selected = plan.actions.filter(a => {
    if (only && !only.has(a.invoiceId)) return false;
    if (a.needsApproval && !approved.has(a.invoiceId)) return false;
    return true;
  });

  const held = plan.actions.filter(a => a.needsApproval && !approved.has(a.invoiceId));

  if (selected.length > MAX_PER_RUN) {
    return badRequest(
      `${selected.length} relances à envoyer, au-delà de la limite de ${MAX_PER_RUN} par exécution. `
      + `Restreignez la sélection, ou laissez le traitement de nuit étaler les envois.`
    );
  }

  const invoiceById = new Map(context.invoices.map(i => [String(i._id), i]));
  const results: SendResult[] = [];

  for (const action of selected) {
    const client = context.clients.get(action.clientId);
    const invoice = invoiceById.get(action.invoiceId);
    if (!client || !invoice?.dueDate) continue;

    results.push(await executeAction(
      action,
      { email: client.email, phone: client.phone },
      {
        tenantId: auth.tenantId,
        tenantName: context.tenantName,
        settings,
        triggeredBy: auth.userId,
        automatic: false,
        bccEmail: settings.bccEmail,
      },
      new Date(invoice.dueDate)
    ));
  }

  const sent = results.filter(r => r.outcome === "sent").length;
  const partial = results.filter(r => r.outcome === "partial").length;
  const failed = results.filter(r => r.outcome === "failed");
  const duplicates = results.filter(r => r.outcome === "duplicate").length;

  await logAudit(auth, "UPDATE", "invoices", {
    metadata: { module: "relances", sent, partial, failed: failed.length, duplicates },
  });

  return ok({
    sent, partial, duplicates,
    failed: failed.map(f => ({ invoiceNumber: f.invoiceNumber, errors: f.errors })),
    // Les mises en demeure retenues sont nommées : une action bloquée qu'on ne
    // voit pas est une action qu'on croit faite.
    heldForApproval: held.map(a => ({
      invoiceId: a.invoiceId, invoiceNumber: a.invoiceNumber,
      clientName: a.clientName, outstanding: a.outstanding, step: a.step.label,
    })),
    message: sent + partial === 0
      ? duplicates > 0
        ? "Rien envoyé : ces relances étaient déjà parties."
        : "Aucune relance à envoyer."
      : `${sent + partial} relance(s) envoyée(s)${failed.length > 0 ? `, ${failed.length} en échec` : ""}.`,
  });
});
