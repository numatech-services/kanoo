import { NextRequest, NextResponse } from "next/server";
import { withAuth, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { ClientModel } from "@/models/Client";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { TenantModel } from "@/models/Tenant";
import { createPDFBuffer, addTable } from "@/lib/pdf";
import { drawBrandedHeader, drawBrandedFooter, type TenantIdentity } from "@/lib/pdf-document";
import {
  buildStatement, withOpenItems, summarySentence, KIND_LABEL,
  type StatementSource, type OpenItem,
} from "@/lib/statement";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

const xof = (n: number) => `${Math.round(n).toLocaleString("fr-FR")}`;
const fr = (d: Date | string) => new Date(d).toLocaleDateString("fr-FR");

/**
 * GET /api/clients/:id/releve/pdf — le relevé, prêt à envoyer.
 *
 * Le document reprend **exactement** le calcul de l'écran : même moteur, mêmes
 * signes, même solde d'ouverture. Un PDF qui recalculerait de son côté finirait
 * par afficher un autre solde que l'écran, et c'est le client qui le
 * découvrirait.
 */
export const GET = withAuth("clients", "read", async (req: NextRequest, auth: TokenPayload, params) => {
  const client = await ClientModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .select("name code address nif phone email")
    .lean<{ name: string; code?: string; address?: string; nif?: string;
            phone?: string; email?: string } | null>();
  if (!client) return notFound("Client introuvable");

  const url = new URL(req.url);
  const now = new Date();
  const from = url.searchParams.get("from") ? new Date(url.searchParams.get("from")!) : new Date(now.getFullYear(), 0, 1);
  const to = url.searchParams.get("to") ? new Date(url.searchParams.get("to")!) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return badRequest("Période invalide.");

  const scope = { ...tenantFilter(auth), clientId: params.id };
  const [invoices, payments, tenant] = await Promise.all([
    InvoiceModel.find({ ...scope, status: { $ne: "draft" } })
      .select("number documentType status issueDate dueDate totalTTC paidAmount creditedAmount")
      .sort({ issueDate: 1 }).limit(3_000)
      .lean<Array<{ _id: unknown; number: string; documentType?: string; status: string;
                    issueDate: Date; dueDate?: Date; totalTTC: number;
                    paidAmount?: number; creditedAmount?: number }>>(),
    PaymentModel.find(scope).select("date amount reference method").sort({ date: 1 }).limit(3_000)
      .lean<Array<{ _id: unknown; date: Date; amount: number; reference?: string; method?: string }>>(),
    TenantModel.findById(auth.tenantId).select("name logo branding address phone email nif rccm")
      .lean<TenantIdentity | null>(),
  ]);

  const sources: StatementSource[] = [
    ...invoices.filter(i => i.status !== "cancelled").map<StatementSource>(i => ({
      _id: i._id,
      kind: i.documentType === "credit_note" ? "credit_note" : "invoice",
      date: i.issueDate, reference: i.number,
      amount: i.documentType === "credit_note" ? -i.totalTTC : i.totalTTC,
      dueDate: i.dueDate,
    })),
    ...payments.map<StatementSource>(p => ({
      _id: p._id, kind: "payment", date: p.date,
      reference: p.reference || "Règlement", label: p.method,
      amount: -Math.abs(p.amount),
    })),
  ];

  const openingBalance = sources
    .filter(s => new Date(s.date) < new Date(from.getFullYear(), from.getMonth(), from.getDate()))
    .reduce((sum, s) => sum + s.amount, 0);

  const openItems: OpenItem[] = invoices
    .filter(i => i.documentType !== "credit_note" && i.status !== "cancelled"
      && i.dueDate && new Date(i.issueDate) <= to)
    .map(i => ({
      reference: i.number, dueDate: i.dueDate!,
      outstanding: Math.max(0, i.totalTTC - (i.paidAmount || 0) - (i.creditedAmount || 0)),
    }))
    .filter(i => i.outstanding > 0);

  const statement = withOpenItems(buildStatement(sources, openingBalance, from, to), openItems, to);
  const t = statement.totals;

  const brand = tenant ?? { name: "Relevé de compte" };
  const pdf = await createPDFBuffer((doc) => {
    // En-tête à la marque de l'organisation (logo, couleurs, identité).
    let y = drawBrandedHeader(doc, brand, {
      title: "Relevé de compte",
      number: client.name,
      lines: [
        ["Période", `${fr(from)} – ${fr(to)}`],
        ...(client.code ? [["Code client", client.code] as [string, string]] : []),
        ...(client.nif ? [["NIF", client.nif] as [string, string]] : []),
      ],
    });

    // ── Synthèse ──
    // La phrase avant les colonnes : un relevé qu'on n'a pas le temps de lire
    // ne se paie pas.
    doc.rect(50, y, 495, 34).fillColor("#F3EFE7").fill();
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#0B1020")
      .text(summarySentence(t), 60, y + 11, { width: 475 });
    y += 48;

    // ── Mouvements ──
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#0B1020").text("Mouvements de la période", 50, y);
    y += 6;

    const rows = [
      { cells: [fr(from), "", "Solde à l'ouverture", "", "", xof(t.openingBalance)], bold: true },
      ...statement.rows.map(r => ({
        cells: [
          fr(r.date),
          KIND_LABEL[r.kind],
          r.reference,
          r.amount > 0 ? xof(r.amount) : "",
          r.amount < 0 ? xof(-r.amount) : "",
          xof(r.balance),
        ],
      })),
      { cells: [fr(to), "", "Solde à la clôture", xof(t.invoiced), xof(t.paid + t.credited), xof(t.closingBalance)], bold: true },
    ];

    y = addTable(doc, {
      headers: ["Date", "Nature", "Référence", "Débit", "Crédit", "Solde"],
      rows,
      columnWidths: [62, 62, 150, 74, 74, 73],
      startY: y + 10,
      fontSize: 8,
    });

    // ── Ancienneté ──
    if (t.closingBalance > 0) {
      if (y > 620) { doc.addPage(); y = 50; }
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#0B1020")
        .text("Ancienneté du solde", 50, y + 16);
      y = addTable(doc, {
        headers: statement.aging.map(a => a.label),
        rows: [{ cells: statement.aging.map(a => xof(a.amount)), bold: true }],
        columnWidths: [99, 99, 99, 99, 99],
        startY: y + 34,
        fontSize: 8,
      });

      doc.fontSize(8).font("Helvetica").fillColor("#6B705C")
        .text(
          "Le montant dû se lit pièce par pièce : une créance ancienne et une créance récente "
          + "de même montant n'appellent pas la même réponse.",
          50, y + 8, { width: 495 }
        );
    }

    drawBrandedFooter(doc, brand);
  });

  await logAudit(auth, "EXPORT", "clients", {
    resourceId: String(params.id),
    metadata: { document: "releve", from: from.toISOString(), to: to.toISOString() },
  });

  const name = `Releve_${(client.code || client.name).replace(/[^A-Za-z0-9_-]/g, "_")}_${to.toISOString().slice(0, 10)}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
