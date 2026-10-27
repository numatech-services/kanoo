import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import {
  withAuth, ok, badRequest, conflict, notFound, tenantFilter,
} from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { TenantModel } from "@/models/Tenant";
import { ClientModel } from "@/models/Client";
import { activeSecefDriver, portalDriver, type SecefInvoicePayload } from "@/lib/secef";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/invoices/:id/certify
 *
 * Certifie une facture auprès du SECeF, ou enregistre une certification
 * obtenue sur le portail e-SECeF.
 *
 * Deux chemins, un seul enregistrement :
 *  • pilote automatique (e-MCF) — la route appelle le MCF ;
 *  • pilote portail — le corps de la requête porte les codes relevés par
 *    l'opérateur sur le portail, et la route les valide puis les archive.
 */
export const POST = withAuth("invoices", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();

  const invoice = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!invoice) return notFound("Facture introuvable");

  // Une facture déjà certifiée ne se recertifie pas : le code engage
  // l'assujetti, et un second code sur la même facture est un faux.
  if (invoice.secef?.code) {
    return conflict(
      `Facture déjà certifiée sous le code ${invoice.secef.code}. `
      + "Pour l'annuler, émettez une facture d'avoir référençant ce code."
    );
  }
  if (invoice.status === "cancelled") {
    return badRequest("Une facture annulée ne peut pas être certifiée.");
  }
  if (invoice.status === "draft") {
    return badRequest("Émettez la facture avant de la certifier : un brouillon n'est pas opposable.");
  }

  const body = await req.json().catch(() => ({}));
  const driver = activeSecefDriver();

  // Type déduit du document, jamais du formulaire : un avoir certifié comme
  // une vente (FV) faussait la déclaration DGI. Un avoir porte le code SECeF
  // de la facture qu'il annule, qui doit donc être certifiée d'abord.
  const isCreditNote = invoice.documentType === "credit_note";
  const invoiceType: "FV" | "FA" = isCreditNote ? "FA" : "FV";
  let referencedCode: string | undefined;
  if (isCreditNote) {
    const original = invoice.originalInvoiceId
      ? await InvoiceModel.findOne({ _id: invoice.originalInvoiceId, ...tenantFilter(auth) }).select("secef.code number").lean<{ number: string; secef?: { code?: string } } | null>()
      : null;
    referencedCode = original?.secef?.code;
    if (!referencedCode) return badRequest(`Certifiez d'abord la facture d'origine${original ? ` ${original.number}` : ""} : l'avoir doit porter son code SECeF.`);
  }

  // ── Mode portail : l'opérateur reporte ce que la DGI a délivré ──────────
  if (!driver.automatic || body.mode === "portal") {
    const result = portalDriver.record({
      code: String(body.code || ""),
      qrPayload: String(body.qrPayload || ""),
      certifiedAt: body.certifiedAt ? new Date(body.certifiedAt) : undefined,
      mcfId: body.mcfId ? String(body.mcfId) : undefined,
      counters: body.counters ? String(body.counters) : undefined,
    });
    if (!result.ok) return badRequest(result.error);

    invoice.secef = { ...result.certification, invoiceType, ...(referencedCode ? { referencedCode } : {}) };
    await invoice.save();

    await logAudit(auth, "UPDATE", "invoices", {
      resourceId: String(invoice._id),
      metadata: { action: "secef_certified", driver: "portal", code: result.certification.code },
    });

    return ok({ certification: invoice.secef, mode: "portal" });
  }

  // ── Mode automatique : appel du MCF ────────────────────────────────────
  const [tenant, client] = await Promise.all([
    TenantModel.findById(auth.tenantId).select("nif secef").lean<{
      nif?: string; secef?: { isf?: string; mcfId?: string };
    } | null>(),
    ClientModel.findOne({ _id: invoice.clientId, ...tenantFilter(auth) })
      .select("name nif address").lean<{ name: string; nif?: string; address?: string } | null>(),
  ]);

  if (!tenant?.nif) {
    return badRequest("NIF de l'organisation absent : renseignez-le dans les paramètres avant de certifier.");
  }
  if (!client) return notFound("Client de la facture introuvable");

  const payload: SecefInvoicePayload = {
    type: invoiceType,
    ...(referencedCode ? { referencedInvoiceCode: referencedCode } : {}),
    number: invoice.number,
    issueDate: invoice.issueDate,
    client: { name: client.name, nif: client.nif, address: client.address },
    lines: invoice.lines.map((line: {
      description: string; quantity: number; unitPrice: number;
      tvaRate?: number; totalHT: number; totalTVA: number;
    }) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      tvaRate: line.tvaRate ?? 0.19,
      totalHT: line.totalHT,
      totalTVA: line.totalTVA,
    })),
    totalHT: invoice.totalHT,
    totalTVA: invoice.totalTVA,
    totalDTS: invoice.totalDTS || 0,
    totalTTC: invoice.totalTTC,
  };

  const result = await driver.certify(payload, {
    nif: tenant.nif,
    isf: tenant.secef?.isf,
    mcfId: tenant.secef?.mcfId,
  });

  if (!result.ok) {
    await logAudit(auth, "UPDATE", "invoices", {
      resourceId: String(invoice._id),
      metadata: { action: "secef_failed", driver: driver.name, error: result.error },
    });
    // 409 quand un nouvel essai est vain, 503 quand il a un sens : la file
    // hors ligne réessaie les 5xx et abandonne les 4xx.
    return result.retryable
      ? NextResponse.json(
          { success: false, error: result.error },
          { status: 503, headers: { "Retry-After": "30" } }
        )
      : conflict(result.error);
  }

  invoice.secef = { ...result.certification, invoiceType, ...(referencedCode ? { referencedCode } : {}) };
  await invoice.save();

  await logAudit(auth, "UPDATE", "invoices", {
    resourceId: String(invoice._id),
    metadata: { action: "secef_certified", driver: driver.name, code: result.certification.code },
  });

  return ok({ certification: invoice.secef, mode: driver.name });
});
