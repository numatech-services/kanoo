import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getAuthContext, tenantFilter } from "@/lib/api-helpers";
import { InvoiceModel } from "@/models/Invoice";

interface RouteParams {
  params: Promise<{ id: string }> | { id: string };
}

export async function GET(req: NextRequest, ctx: RouteParams) {
  try {
    // 1. Vérification de l'authentification
    const auth = getAuthContext(req);
    if (!auth) {
      return new NextResponse(JSON.stringify({ error: "Non authentifié" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2. Connexion à la base de données et extraction de l'ID (compatible async)
    await connectDB();
    const resolvedParams = ctx.params instanceof Promise ? await ctx.params : ctx.params;
    const { id } = resolvedParams;

    // 3. Récupération de la facture avec les données du client relié
    const invoice = await InvoiceModel.findOne({ _id: id, ...tenantFilter(auth) })
      .populate("clientId", "name nif address phone")
      .lean();

    if (!invoice) {
      return new NextResponse(JSON.stringify({ error: "Facture introuvable" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Import dynamique de PDFKit pour éviter les soucis au build Next.js
    const PDFDocument = (await import("pdfkit")).default;
    const inv = invoice as any;

    // 4. Génération du buffer PDF avec une Promesse robuste
    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      // Ajout de bufferPages: true pour résoudre le bug de chargement des polices standards
      const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });
      const buffers: Buffer[] = [];

      doc.on("data", (chunk: Buffer) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", (err) => reject(err));

      // ── En-tête du document ─────────────────────────────────
      doc.rect(0, 0, 595, 120).fill("#1a1a1a");
      doc.fillColor("white").fontSize(22).font("Helvetica-Bold").text("FACTURE", 50, 40);
      doc.fontSize(13).font("Helvetica").text(inv.number || "N/A", 50, 68);
      
      doc.fillColor("#cccccc").fontSize(9)
        .text(`Émission : ${inv.issueDate ? new Date(inv.issueDate).toLocaleDateString("fr-FR") : "—"}`, 50, 88)
        .text(`Échéance : ${inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("fr-FR") : "—"}`, 50, 100);

      // ── Statut de la facture ────────────────────────────────
      const statusLabels: Record<string, string> = {
        draft: "Brouillon", sent: "Émise", partial: "Part. payée",
        paid: "Soldée", overdue: "En retard", cancelled: "Annulée",
      };
      doc.fillColor("#aaaaaa").fontSize(9)
        .text(`Statut : ${statusLabels[inv.status] || inv.status || "Brouillon"}`, 400, 88, { align: "right", width: 145 });

      // ── Informations Client ─────────────────────────────────
      doc.fillColor("#333333").fontSize(10).font("Helvetica-Bold").text("FACTURÉ À", 350, 140);
      doc.font("Helvetica").fillColor("#111111");
      if (inv.clientId) {
        doc.fontSize(11).text(inv.clientId.name || "Client sans nom", 350, 158);
        let clientY = 174;
        if (inv.clientId.nif) {
          doc.fontSize(9).fillColor("#555555").text(`NIF : ${inv.clientId.nif}`, 350, clientY);
          clientY += 12;
        }
        if (inv.clientId.address) {
          doc.fontSize(9).fillColor("#555555").text(inv.clientId.address, 350, clientY);
          clientY += 12;
        }
        if (inv.clientId.phone) {
          doc.fontSize(9).fillColor("#555555").text(inv.clientId.phone, 350, clientY);
        }
      }

      // ── Tableau des lignes d'articles ───────────────────────
      let y = 240;
      doc.rect(50, y, 495, 22).fill("#f0f0f0");
      doc.fillColor("#333333").fontSize(9).font("Helvetica-Bold");
      doc.text("Description", 58, y + 7);
      doc.text("Volume", 310, y + 7, { width: 30, align: "center" });
      doc.text("P.U. HT", 345, y + 7, { width: 60, align: "right" });
      doc.text("TVA", 410, y + 7, { width: 40, align: "center" });
      doc.text("Total TTC", 455, y + 7, { width: 85, align: "right" });
      y += 22;

      doc.font("Helvetica").fontSize(9);
      if (inv.lines && Array.isArray(inv.lines)) {
        for (let i = 0; i < inv.lines.length; i++) {
          const line = inv.lines[i];
          if (y > 710) { 
            doc.addPage(); 
            y = 50; 
            doc.rect(50, y, 495, 22).fill("#f0f0f0");
            doc.fillColor("#333333").font("Helvetica-Bold");
            doc.text("Description", 58, y + 7);
            doc.text("Volume", 310, y + 7, { width: 30, align: "center" });
            doc.text("P.U. HT", 345, y + 7, { width: 60, align: "right" });
            doc.text("TVA", 410, y + 7, { width: 40, align: "center" });
            doc.text("Total TTC", 455, y + 7, { width: 85, align: "right" });
            y += 22;
            doc.font("Helvetica");
          }

          if (i % 2 === 0) doc.rect(50, y, 495, 20).fill("#fafafa");
          doc.fillColor("#111111");
          doc.text(String(line.description || "").slice(0, 52), 58, y + 5);
          doc.text(String(line.quantity || 0), 310, y + 5, { width: 30, align: "center" });
          doc.text((line.unitPrice || 0).toLocaleString("fr-FR"), 345, y + 5, { width: 60, align: "right" });
          doc.text(`${Math.round((line.tvaRate || 0) * 100)}%`, 410, y + 5, { width: 40, align: "center" });
          doc.text((line.totalTTC || 0).toLocaleString("fr-FR") + " XOF", 455, y + 5, { width: 85, align: "right" });
          y += 20;
        }
      }

      // ── Section des Totaux ──────────────────────────────────
      y += 15;
      if (y > 680) { doc.addPage(); y = 50; }

      doc.moveTo(350, y).lineTo(545, y).strokeColor("#dddddd").stroke();
      y += 10;
      doc.fillColor("#555555").fontSize(9).font("Helvetica");
      
      if (inv.totalHT > 0) {
        doc.text("Sous-total HT", 350, y);
        doc.text(`${inv.totalHT.toLocaleString("fr-FR")} XOF`, 440, y, { width: 105, align: "right" });
        y += 15;
      }
      if (inv.totalTVA > 0) {
        doc.text("TVA", 350, y);
        doc.text(`${inv.totalTVA.toLocaleString("fr-FR")} XOF`, 440, y, { width: 105, align: "right" });
        y += 15;
      }
      
      doc.moveTo(350, y).lineTo(545, y).strokeColor("#cccccc").stroke();
      y += 8;
      
      doc.rect(350, y, 195, 26).fill("#1a1a1a");
      doc.fillColor("white").fontSize(10).font("Helvetica-Bold");
      doc.text("TOTAL TTC", 360, y + 8);
      doc.text(`${(inv.totalTTC || 0).toLocaleString("fr-FR")} XOF`, 435, y + 8, { width: 105, align: "right" });

      // ── Gestion des Paiements Encaissés ─────────────────────
      if (inv.paidAmount > 0) {
        y += 34;
        doc.fillColor("#16a34a").fontSize(9).font("Helvetica");
        doc.text("Encaissé :", 350, y);
        doc.text(`${inv.paidAmount.toLocaleString("fr-FR")} XOF`, 440, y, { width: 105, align: "right" });
        
        const remaining = inv.totalTTC - inv.paidAmount;
        if (remaining > 0) {
          y += 15;
          doc.fillColor("#dc2626").font("Helvetica-Bold");
          doc.text("Reste dû :", 350, y);
          doc.text(`${remaining.toLocaleString("fr-FR")} XOF`, 440, y, { width: 105, align: "right" });
        }
      }

      // ── Notes de bas de page ────────────────────────────────
      if (inv.notes) {
        y += 35;
        doc.fillColor("#555555").fontSize(9).font("Helvetica-Bold").text("Notes :", 50, y);
        doc.font("Helvetica").fillColor("#333333").text(inv.notes, 50, y + 14, { width: 280 });
      }

      // ── Pied de page (Fixé sur l'A4) ────────────────────────
      doc.rect(0, 795, 595, 47).fill("#f5f5f5");
      doc.fillColor("#888888").fontSize(8).font("Helvetica")
         .text("Document généré par Kanoo — Niamey, Niger", 50, 810, { align: "center", width: 495 });

      doc.end();
    });

    // 5. Retour de la réponse HTTP avec le bon Content-Type de PDF
  return new NextResponse(new Uint8Array(pdfBuffer), {
  status: 200,
  headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${inv.number || "facture"}.pdf"`,
    "Cache-Control": "no-store, max-age=0",
  },
});
  } catch (error) {
    console.error("Erreur serveur PDF :", error);
    return new NextResponse(JSON.stringify({ error: "Échec critique de la génération" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}