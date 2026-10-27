import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import type { StatementSource, OpenItem } from "@/lib/statement";

interface InvoiceRow {
  _id: unknown; number: string; documentType?: string; status: string;
  issueDate: Date; dueDate?: Date; totalTTC: number;
  paidAmount?: number; creditedAmount?: number;
  refunds?: Array<{ date: Date; amount: number; reference?: string }>;
  writtenOffAt?: Date; writtenOffAmount?: number;
}
interface PaymentRow {
  _id: unknown; date: Date; amount: number; reference?: string; method?: string;
  withholdingAmount?: number; exchangeDifference?: number;
}

/**
 * Mouvements du compte d'un client, pour le relevé (écran et PDF envoyé au
 * client — une seule source pour les deux).
 *
 * Ce que l'ancienne version oubliait :
 *  - la facture annulée par un avoir total était écartée alors que l'avoir
 *    restait : le relevé annonçait au client « un avoir en votre faveur » ;
 *  - le règlement soldait la facture de `montant + retenue subie + écart de
 *    change`, mais seul le montant encaissé apparaissait : le relevé réclamait
 *    la retenue d'un marché public pourtant soldé ;
 *  - les remboursements d'avoir et les passages en perte.
 */
export async function clientStatementData(tenantId: unknown, clientId: string, to: Date) {
  const scope = { tenantId, clientId };
  const invoices = await InvoiceModel.find({ ...scope, status: { $ne: "draft" } })
    .select("number documentType status issueDate dueDate totalTTC paidAmount creditedAmount refunds writtenOffAt writtenOffAmount")
    .sort({ issueDate: 1 }).limit(3_000).lean<InvoiceRow[]>();
  // Un règlement ne porte pas le client, seulement sa facture : filtré sur un
  // `clientId` absent du modèle, il ne ressortait JAMAIS — le relevé montrait
  // chaque client débiteur de tout ce qui lui avait été facturé.
  const payments = await PaymentModel.find({ tenantId, invoiceId: { $in: invoices.map(i => i._id) }, status: { $nin: ["pending", "cancelled"] } })
    .select("date amount reference method withholdingAmount exchangeDifference")
    .sort({ date: 1 }).limit(3_000).lean<PaymentRow[]>();

  // Brouillon supprimé (annulé sans avoir) : n'a jamais existé pour le client.
  // Facture annulée PAR AVOIR : elle reste, son avoir la compense.
  const visible = invoices.filter(i => i.status !== "cancelled" || (i.creditedAmount ?? 0) > 0 || i.documentType === "credit_note");

  const sources: StatementSource[] = [
    ...visible.map<StatementSource>(i => ({
      _id: i._id,
      kind: i.documentType === "credit_note" ? "credit_note" : "invoice",
      date: i.issueDate,
      reference: i.number,
      amount: i.documentType === "credit_note" ? -i.totalTTC : i.totalTTC,
      dueDate: i.dueDate,
    })),
    ...payments.map<StatementSource>(p => {
      const withheld = Math.round(p.withholdingAmount || 0), fx = Math.round(p.exchangeDifference || 0);
      const extras = [withheld ? `retenue à la source ${withheld.toLocaleString("fr-FR")}` : "", fx ? `écart de change ${fx.toLocaleString("fr-FR")}` : ""].filter(Boolean);
      return {
        _id: p._id, kind: "payment", date: p.date,
        reference: p.reference || "Règlement",
        label: [p.method, ...extras].filter(Boolean).join(" · "),
        amount: -Math.abs(p.amount + withheld + fx),
      };
    }),
    // Avoir remboursé : l'argent rendu fait remonter le solde du client.
    ...visible.filter(i => i.documentType === "credit_note").flatMap(i => (i.refunds ?? []).map<StatementSource>((r, k) => ({
      _id: `${String(i._id)}-r${k}`, kind: "refund", date: r.date,
      reference: r.reference || `Remboursement ${i.number}`, amount: Math.abs(r.amount),
    }))),
    ...visible.filter(i => i.writtenOffAt && (i.writtenOffAmount ?? 0) > 0).map<StatementSource>(i => ({
      _id: `${String(i._id)}-wo`, kind: "write_off", date: i.writtenOffAt!,
      reference: i.number, amount: -Math.abs(i.writtenOffAmount!),
    })),
  ];

  // Pièces encore ouvertes : ni avoir, ni annulée, ni passée en perte.
  const openItems: OpenItem[] = visible
    .filter(i => i.documentType !== "credit_note" && !["cancelled", "written_off"].includes(i.status)
      && i.dueDate && new Date(i.issueDate) <= to)
    .map(i => ({
      reference: i.number,
      dueDate: i.dueDate!,
      outstanding: Math.max(0, i.totalTTC - (i.paidAmount || 0) - (i.creditedAmount || 0)),
    }))
    .filter(i => i.outstanding > 0);

  return { sources, openItems };
}
