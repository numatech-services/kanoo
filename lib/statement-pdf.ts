import { ClientModel } from "@/models/Client";
import { TenantModel } from "@/models/Tenant";
import { clientStatementData } from "@/lib/statement-server";
import { createPDFBuffer, addTable } from "@/lib/pdf";
import { drawBrandedHeader, drawBrandedFooter, type TenantIdentity } from "@/lib/pdf-document";
import { buildStatement, withOpenItems, summarySentence, KIND_LABEL } from "@/lib/statement";
import { Types } from "mongoose";

const xof = (n: number) => `${Math.round(n).toLocaleString("fr-FR")}`;
const fr = (d: Date | string) => new Date(d).toLocaleDateString("fr-FR");

export interface StatementClient { name: string; code?: string; address?: string; nif?: string; phone?: string; email?: string }

/**
 * Relevé de compte d'un client en PDF — un seul calcul pour le
 * téléchargement et l'envoi : même moteur, mêmes signes, même solde
 * d'ouverture que l'écran.
 */
export async function statementPdf(tenantId: string, clientId: string, from: Date, to: Date) {
  const client = await ClientModel.findOne({ _id: clientId, tenantId })
    .select("name code address nif phone email").lean<StatementClient | null>();
  if (!client) return null;
  const [{ sources, openItems }, tenant] = await Promise.all([
    clientStatementData(new Types.ObjectId(tenantId), clientId, to),
    TenantModel.findById(tenantId).select("name logo branding address phone email nif rccm").lean<TenantIdentity | null>(),
  ]);

  // Solde d'ouverture : tous les mouvements strictement antérieurs à `from`.
  const openingBalance = sources
    .filter(s => new Date(s.date) < new Date(from.getFullYear(), from.getMonth(), from.getDate()))
    .reduce((sum, s) => sum + s.amount, 0);

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

  const name = `Releve_${(client.code || client.name).replace(/[^A-Za-z0-9_-]/g, "_")}_${to.toISOString().slice(0, 10)}.pdf`;
  return { pdf, client, totals: t, summary: summarySentence(t), filename: name, tenantName: brand.name };
}
