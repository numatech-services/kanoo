import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import {
  withAuth, created, badRequest, notFound, conflict, tenantFilter, requireFields,
} from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { ClientModel } from "@/models/Client";
import { releaseMarketInvoice } from "@/lib/market-invoice";
import { nextDocumentNumber } from "@/lib/numbering";
import { buildCreditNote, reversalEntryLines, creditableAmount, type InvoiceLike } from "@/lib/credit-notes";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/**
 * POST /api/invoices/:id/credit-note
 *
 * Émet une facture d'avoir sur une facture existante — le seul moyen
 * réglementaire de corriger une facture émise, a fortiori certifiée.
 *
 * Corps attendu :
 *  { reason: string, mode: "full" }                      → avoir total
 *  { reason: string, lines: [{ lineIndex, quantity }] }  → avoir partiel
 */
export const POST = withAuth("invoices", "create", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();

  const body = await req.json().catch(() => ({}));
  const missing = requireFields(body, ["reason"]);
  if (missing) {
    return badRequest("Le motif de l'avoir est obligatoire : un avoir sans motif est inopposable.");
  }

  const invoice = await InvoiceModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!invoice) return notFound("Facture introuvable");

  const draftResult = buildCreditNote(
    invoice as unknown as InvoiceLike,
    body.mode === "full" ? "full" : body.lines
  );
  if (!draftResult.ok) return badRequest(draftResult.error);
  const draft = draftResult.draft;

  const client = await ClientModel.findOne({ _id: invoice.clientId, ...tenantFilter(auth) })
    .select("name").lean<{ name: string } | null>();
  if (!client) return notFound("Client de la facture introuvable");

  const issueDate = body.issueDate ? new Date(body.issueDate) : new Date();
  if (Number.isNaN(issueDate.getTime())) return badRequest("Date d'émission invalide");

  // L'avoir porte l'imputation de la facture : il réduit les recettes du projet.
  const tags = { ...(invoice.projectId ? { projectId: invoice.projectId } : {}), ...(invoice.activityId ? { activityId: invoice.activityId } : {}) };
  const entryLines = reversalEntryLines(draft, invoice.clientId, { kind: invoice.kind, tags });
  const totalDebit = entryLines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = entryLines.reduce((sum, l) => sum + l.credit, 0);
  if (totalDebit !== totalCredit) {
    // Ne jamais enregistrer une écriture déséquilibrée : elle fausserait la
    // balance sans jamais se signaler.
    return conflict(
      `Écriture d'extourne déséquilibrée (débit ${totalDebit} ≠ crédit ${totalCredit}). Avoir non émis.`
    );
  }

  const result = await withTransaction(async (session) => {
    // Verrou par le montant : deux avoirs émis en même temps sur la même
    // facture ne peuvent pas dépasser ensemble le montant créditable. Le filtre
    // porte sur `creditedAmount` tel qu'il a été lu — si un autre avoir est
    // passé entre-temps, la mise à jour ne trouve rien et la transaction échoue.
    const guard = await InvoiceModel.updateOne(
      {
        _id: invoice._id,
        ...tenantFilter(auth),
        creditedAmount: invoice.creditedAmount || 0,
      },
      { $inc: { creditedAmount: draft.totalTTC } },
      { session }
    );
    if (guard.matchedCount === 0) {
      throw new Error("Un autre avoir a été émis sur cette facture entre-temps. Recommencez.");
    }

    const number = await nextDocumentNumber(auth.tenantId, "credit_note", { issueDate, session });

    const [creditNote] = await InvoiceModel.create([{
      tenantId: auth.tenantId,
      documentType: "credit_note",
      originalInvoiceId: invoice._id,
      ...tags,
      ...(invoice.contractId ? { contractId: invoice.contractId } : {}),
      kind: invoice.kind ?? "standard",
      creditReason: String(body.reason).trim(),
      number,
      clientId: invoice.clientId,
      lines: draft.lines,
      totalHT: draft.totalHT,
      totalTVA: draft.totalTVA,
      totalDTS: draft.totalDTS,
      totalTTC: draft.totalTTC,
      paidAmount: 0,
      creditedAmount: 0,
      // Un avoir n'est pas « à payer » : il est émis, point.
      status: "sent",
      issueDate,
      createdBy: auth.userId,
    }], { session });

    await AccountingEntryModel.create([{
      tenantId: auth.tenantId,
      journalCode: "VT",
      entryDate: issueDate,
      reference: number,
      label: `Avoir ${number} sur facture ${invoice.number} — ${client.name}`,
      lines: entryLines,
      linkedDocType: "invoice",
      linkedDocId: creditNote._id,
      createdBy: auth.userId,
    }], { session });

    // La facture d'origine passe en « annulée » quand elle est intégralement
    // couverte : son solde est nul, elle ne doit plus apparaître en impayé.
    if ((invoice.creditedAmount || 0) + draft.totalTTC >= invoice.totalTTC) {
      await InvoiceModel.updateOne(
        { _id: invoice._id, ...tenantFilter(auth) },
        { $set: { status: "cancelled" } },
        { session }
      );
      // Acomptes déduits sur cette facture : redevenus disponibles. Échéance du
      // marché : de nouveau à facturer.
      await releaseMarketInvoice(auth.tenantId, invoice, session);
    }

    return creditNote;
  });

  await logAudit(auth, "CREATE", "invoices", {
    resourceId: String(result._id),
    metadata: {
      action: "credit_note_issued",
      originalInvoice: invoice.number,
      creditNote: result.number,
      amount: draft.totalTTC,
      full: draft.isFull,
      reason: String(body.reason).trim(),
    },
  });

  return created({
    creditNote: result,
    originalInvoice: {
      number: invoice.number,
      totalTTC: invoice.totalTTC,
      creditedAmount: (invoice.creditedAmount || 0) + draft.totalTTC,
      remainingCreditable: creditableAmount(invoice as unknown as InvoiceLike) - draft.totalTTC,
    },
  });
});
