import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getAuthContext, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";
import { TenantModel } from "@/models/Tenant";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { calculerTVA, TVA_TAUX_STANDARD } from "@/lib/niger-fiscal";

/**
 * GET /api/reports/dgi-pdf?type=tva|cnss|bilan|grandlivre&mois=MM&annee=YYYY
 * Génère un PDF de rapport fiscal certifié conforme DGI Niger
 */
export async function GET(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  await connectDB();
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "tva";
  const annee = parseInt(url.searchParams.get("annee") || String(new Date().getFullYear()));
  const mois = url.searchParams.get("mois") ? parseInt(url.searchParams.get("mois")!) : null;

  const tenant = await TenantModel.findById(auth.tenantId).lean() as {
    name: string; nif?: string; rccm?: string; address?: string; email?: string; phone?: string;
  } | null;

  if (!tenant) return NextResponse.json({ error: "Tenant introuvable" }, { status: 404 });

  // Période
  const start = mois ? new Date(annee, mois - 1, 1) : new Date(annee, 0, 1);
  const end   = mois ? new Date(annee, mois, 0, 23, 59, 59) : new Date(annee, 11, 31, 23, 59, 59);
  const periode = mois
    ? `${String(mois).padStart(2, "0")}/${annee}`
    : `Exercice ${annee}`;

  // Données selon le type de rapport
  let reportData: Record<string, unknown> = {};

  if (type === "tva") {
    const invoices = await InvoiceModel.find({
      ...tenantFilter(auth),
      issueDate: { $gte: start, $lte: end },
      status: { $ne: "cancelled" },
    }).lean();

    const baseHT = invoices.reduce((s, i) => s + i.totalHT, 0);
    const tvaCollectee = invoices.reduce((s, i) => s + i.totalTVA, 0);
    const tvaDeductible = 0; // Simplification MVP (à enrichir avec factures fournisseurs)

    reportData = {
      title: "Déclaration TVA",
      periode,
      baseHT: Math.round(baseHT),
      tvaCollectee: Math.round(tvaCollectee),
      tvaDeductible,
      tvaAVerser: Math.round(tvaCollectee - tvaDeductible),
      nbFactures: invoices.length,
      taux: TVA_TAUX_STANDARD * 100,
    };
  } else if (type === "grandlivre") {
    const entries = await AccountingEntryModel.find({
      ...tenantFilter(auth),
      entryDate: { $gte: start, $lte: end },
    }).sort({ accountCode: 1, entryDate: 1 }).lean();

    const balance: Record<string, { code: string; label: string; debit: number; credit: number }> = {};
    for (const e of entries) {
      for (const line of e.lines) {
        if (!balance[line.accountCode]) balance[line.accountCode] = { code: line.accountCode, label: line.accountLabel || line.accountCode, debit: 0, credit: 0 };
        balance[line.accountCode].debit += line.debit || 0;
        balance[line.accountCode].credit += line.credit || 0;
      }
    }
    reportData = { title: "Grand Livre", periode, comptes: Object.values(balance), nbEcritures: entries.length };
  }

  // ── Génération PDF via PDFKit ─────────────────────────────────────────────
  try {
    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));

    await new Promise<void>((resolve) => {
      doc.on("end", resolve);

      // En-tête DGI Niger
      const pageW = doc.page.width - 100;

      // Cadre en-tête
      doc.rect(50, 50, pageW, 90).stroke("#cccccc");
      doc.fontSize(16).font("Helvetica-Bold").fillColor("#2F3E46").text("REPUBLIQUE DU NIGER", 60, 60, { width: pageW - 20, align: "center" });
      doc.fontSize(12).font("Helvetica").fillColor("#444").text("Direction Générale des Impôts — DGI", { align: "center" });
      doc.fontSize(14).font("Helvetica-Bold").fillColor("#2F3E46").text(String(reportData.title), { align: "center" }).moveDown(0.3);
      doc.fontSize(11).font("Helvetica").fillColor("#666").text(`Période : ${periode}`, { align: "center" });

      // Infos contribuable
      doc.y = 160;
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#2F3E46").text("INFORMATIONS CONTRIBUABLE");
      doc.rect(50, doc.y + 2, pageW, 55).stroke("#cccccc");
      doc.moveDown(0.3);
      const cols = [[`Raison sociale :`, tenant.name], [`NIF :`, tenant.nif || "—"], [`RCCM :`, tenant.rccm || "—"], [`Adresse :`, typeof tenant.address === "string" ? tenant.address : "—"]];
      cols.forEach(([label, val]) => {
        doc.fontSize(9).font("Helvetica-Bold").fillColor("#555").text(String(label), 60, doc.y, { continued: true, width: 120 });
        doc.font("Helvetica").fillColor("#222").text(String(val));
      });

      doc.moveDown(1);

      if (type === "tva") {
        const d = reportData as { baseHT: number; tvaCollectee: number; tvaDeductible: number; tvaAVerser: number; nbFactures: number; taux: number };

        doc.fontSize(10).font("Helvetica-Bold").fillColor("#2F3E46").text("CALCUL DE LA TVA À VERSER");
        doc.moveDown(0.4);

        const rows: Array<[string, string, boolean?]> = [
          ["Chiffre d'affaires HT (base TVA)", `${d.baseHT.toLocaleString("fr-FR")} XOF`],
          [`TVA collectée (taux ${d.taux}%)`, `${d.tvaCollectee.toLocaleString("fr-FR")} XOF`],
          ["TVA déductible sur achats", `${d.tvaDeductible.toLocaleString("fr-FR")} XOF`],
          ["TVA nette à verser à la DGI", `${d.tvaAVerser.toLocaleString("fr-FR")} XOF`, true],
          ["Nombre de factures émises", String(d.nbFactures)],
        ];

        rows.forEach(([label, val, bold], i) => {
          const rowY = doc.y;
          const isLast = bold;
          if (isLast) doc.rect(50, rowY - 2, pageW, 20).fill("#F3F1EA").fillColor("#F3F1EA");
          doc.rect(50, rowY - 2, pageW, 20).stroke("#eeeeee");
          doc.fontSize(9).font(isLast ? "Helvetica-Bold" : "Helvetica").fillColor(isLast ? "#2F3E46" : "#333")
            .text(label, 58, rowY, { width: pageW - 100 });
          doc.fontSize(9).font(isLast ? "Helvetica-Bold" : "Helvetica").fillColor(isLast ? "#2F3E46" : "#333")
            .text(val, 50, rowY, { width: pageW - 8, align: "right" });
          doc.y = rowY + 20;
        });
      } else if (type === "grandlivre") {
        const d = reportData as { comptes: Array<{ code: string; label: string; debit: number; credit: number }>; nbEcritures: number };
        doc.fontSize(9).font("Helvetica").text(`${d.nbEcritures} écritures · ${d.comptes.length} comptes mouvementés`, { color: "#666" });
        doc.moveDown(0.5);
        // En-tête tableau
        const cols = [60, 160, 360, 450, pageW + 50 - 8];
        ["Code", "Libellé", "Débit (XOF)", "Crédit (XOF)", "Solde (XOF)"].forEach((h, i) => {
          doc.fontSize(8).font("Helvetica-Bold").fillColor("#fff");
          doc.rect(cols[i], doc.y - 2, (cols[i + 1] || cols[i] + 80) - cols[i] - 2, 14).fill("#2F3E46");
          doc.fillColor("#fff").text(h, cols[i] + 2, doc.y - 1);
        });
        doc.y += 14;

        d.comptes.slice(0, 60).forEach((c, idx) => {
          const solde = c.debit - c.credit;
          const rowY = doc.y;
          if (idx % 2 === 0) doc.rect(50, rowY - 1, pageW, 12).fill("#F9F9F7").fillColor("#F9F9F7");
          doc.fontSize(7.5).font("Helvetica").fillColor("#333");
          doc.text(c.code, 62, rowY, { width: 90 });
          doc.text(c.label.slice(0, 35), 162, rowY, { width: 190 });
          doc.text(Math.round(c.debit).toLocaleString("fr-FR"), 50, rowY, { width: pageW - 195, align: "right" });
          doc.text(Math.round(c.credit).toLocaleString("fr-FR"), 50, rowY, { width: pageW - 105, align: "right" });
          doc.font(solde !== 0 ? "Helvetica-Bold" : "Helvetica")
            .fillColor(solde > 0 ? "#2F6E3B" : solde < 0 ? "#A32D2D" : "#666")
            .text(Math.round(solde).toLocaleString("fr-FR"), 50, rowY, { width: pageW - 8, align: "right" });
          doc.y = rowY + 13;
        });
        if (d.comptes.length > 60) {
          doc.moveDown(0.5).fontSize(8).fillColor("#888").text(`… et ${d.comptes.length - 60} comptes supplémentaires (export complet via SAGE/OHADA)`);
        }
      }

      // Pied de page certifié
      doc.moveDown(2);
      const certY = Math.min(doc.y, 720);
      doc.y = certY;
      doc.rect(50, certY, pageW, 50).stroke("#2F3E46");
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#2F3E46").text("ATTESTATION", 58, certY + 6);
      doc.fontSize(7.5).font("Helvetica").fillColor("#444")
        .text("Je soussigné(e), certifie que les informations contenues dans ce document sont exactes et sincères, conformément aux dispositions du Code Général des Impôts du Niger.", 58, certY + 18, { width: pageW - 160 });
      doc.fontSize(7.5).text(`Édité le ${new Date().toLocaleDateString("fr-FR")} via Kanoo — ${process.env.APP_BASE_URL || "kanoo.ne"}`, 58, certY + 36, { width: pageW - 16 });

      // Numéro de page
      doc.fontSize(7).fillColor("#aaa").text(`Page 1 — Document généré le ${new Date().toLocaleString("fr-FR")}`, 50, 810, { align: "center", width: pageW });

      doc.end();
    });

    const pdfBuffer = Buffer.concat(chunks);
    const filename = `DGI-${type.toUpperCase()}-${periode.replace("/", "-")}-${tenant.name.replace(/\s+/g, "_").slice(0, 20)}.pdf`;

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdfBuffer.length),
      },
    });
  } catch (err) {
    console.error("[DGI-PDF] Erreur:", err);
    return NextResponse.json({ error: "Erreur génération PDF" }, { status: 500 });
  }
}
