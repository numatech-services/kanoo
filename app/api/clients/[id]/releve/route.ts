import { NextRequest } from "next/server";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { ClientModel } from "@/models/Client";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { TenantModel } from "@/models/Tenant";
import {
  buildStatement, withOpenItems, summarySentence,
  type StatementSource, type OpenItem,
} from "@/lib/statement";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface InvoiceRow {
  _id: unknown;
  number: string;
  documentType?: string;
  status: string;
  issueDate: Date;
  dueDate?: Date;
  totalTTC: number;
  paidAmount?: number;
  creditedAmount?: number;
}

interface PaymentRow {
  _id: unknown;
  date: Date;
  amount: number;
  reference?: string;
  method?: string;
  invoiceId?: unknown;
}

/**
 * GET /api/clients/:id/releve?from=…&to=…
 *
 * Le relevé de compte d'un client sur une période.
 *
 * Deux points sur lesquels ce genre de document se trompe habituellement :
 *
 * 1. **Le solde d'ouverture se calcule sur tout l'antérieur**, pas sur la
 *    période affichée. Un relevé d'octobre qui commence à zéro nie ce que le
 *    client devait déjà en septembre, et se fait renvoyer.
 * 2. **Les avoirs se retranchent.** Ils vivent dans la même collection que les
 *    factures, avec des montants positifs : sans le signe, un avoir gonfle la
 *    créance qu'il devait réduire.
 */
export const GET = withAuth("clients", "read", async (req: NextRequest, auth: TokenPayload, params) => {
  const client = await ClientModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .select("name code email phone address nif paymentTermDays")
    .lean<{ name: string; code?: string; email?: string; phone?: string;
            address?: string; nif?: string; paymentTermDays?: number } | null>();
  if (!client) return notFound("Client introuvable");

  const url = new URL(req.url);
  const now = new Date();
  const from = url.searchParams.get("from")
    ? new Date(url.searchParams.get("from")!)
    : new Date(now.getFullYear(), 0, 1);
  const to = url.searchParams.get("to")
    ? new Date(url.searchParams.get("to")!)
    : now;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return badRequest("Période invalide.");
  }
  if (from > to) return badRequest("La date de début est postérieure à la date de fin.");

  const scope = { ...tenantFilter(auth), clientId: params.id };

  const [invoices, payments, tenant] = await Promise.all([
    InvoiceModel.find({ ...scope, status: { $ne: "draft" } })
      .select("number documentType status issueDate dueDate totalTTC paidAmount creditedAmount")
      .sort({ issueDate: 1 }).limit(3_000).lean<InvoiceRow[]>(),
    PaymentModel.find(scope)
      .select("date amount reference method invoiceId")
      .sort({ date: 1 }).limit(3_000).lean<PaymentRow[]>(),
    TenantModel.findById(auth.tenantId).select("name address phone email nif rccm").lean(),
  ]);

  // Le signe est posé une seule fois, ici : positif quand le client doit
  // davantage, négatif quand la dette diminue.
  const sources: StatementSource[] = [
    ...invoices
      .filter(i => i.status !== "cancelled")
      .map<StatementSource>(i => ({
        _id: i._id,
        kind: i.documentType === "credit_note" ? "credit_note" : "invoice",
        date: i.issueDate,
        reference: i.number,
        amount: i.documentType === "credit_note" ? -i.totalTTC : i.totalTTC,
        dueDate: i.dueDate,
      })),
    ...payments.map<StatementSource>(p => ({
      _id: p._id,
      kind: "payment",
      date: p.date,
      reference: p.reference || "Règlement",
      label: p.method,
      amount: -Math.abs(p.amount),
    })),
  ];

  // Solde d'ouverture : tous les mouvements strictement antérieurs à `from`.
  const openingBalance = sources
    .filter(s => new Date(s.date) < new Date(from.getFullYear(), from.getMonth(), from.getDate()))
    .reduce((sum, s) => sum + s.amount, 0);

  // Pièces encore ouvertes à la date d'arrêté — l'ancienneté se lit
  // pièce par pièce, jamais sur le solde global.
  const openItems: OpenItem[] = invoices
    .filter(i => i.documentType !== "credit_note"
      && i.status !== "cancelled" && i.dueDate
      && new Date(i.issueDate) <= to)
    .map(i => ({
      reference: i.number,
      dueDate: i.dueDate!,
      outstanding: Math.max(0, i.totalTTC - (i.paidAmount || 0) - (i.creditedAmount || 0)),
    }))
    .filter(i => i.outstanding > 0);

  const statement = withOpenItems(
    buildStatement(sources, openingBalance, from, to),
    openItems,
    to
  );

  return ok({
    client,
    tenant,
    statement,
    summary: summarySentence(statement.totals),
  });
});
