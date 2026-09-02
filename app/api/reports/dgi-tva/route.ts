import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getAuthContext, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";

export async function GET(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  await connectDB();
  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") || String(new Date().getFullYear()));
  const month = parseInt(url.searchParams.get("month") || String(new Date().getMonth() + 1));

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);

  const entries = await AccountingEntryModel.find({
    ...tenantFilter(auth), entryDate: { $gte: start, $lte: end },
    "lines.accountCode": { $in: ["443000", "445000"] },
  }).lean();

  let tvaCollectee = 0, tvaDeductible = 0;
  for (const e of entries) {
    for (const l of e.lines) {
      if (l.accountCode === "443000") tvaCollectee += l.credit - l.debit;
      if (l.accountCode === "445000") tvaDeductible += l.debit - l.credit;
    }
  }
  const tvaNette = tvaCollectee - tvaDeductible;

  const PDFDocument = (await import("pdfkit")).default;
  const buffers: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.on("data", (b: Buffer) => buffers.push(b));

  return new Promise<NextResponse>((resolve) => {
    doc.on("end", () => {
      const pdf = Buffer.concat(buffers);
      resolve(new NextResponse(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="TVA-${year}-${month}.pdf"` } }));
    });
    doc.fontSize(18).font("Helvetica-Bold").text("DÉCLARATION DE TVA", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).font("Helvetica").text(`Période : ${month.toString().padStart(2,"0")}/${year}`, { align: "center" });
    doc.moveDown(2);
    const rows = [["TVA collectée (ventes)",tvaCollectee],["TVA déductible (achats)",tvaDeductible],["TVA nette",tvaNette],["Montant à verser DGI",Math.max(0,tvaNette)]];
    for (const [l, v] of rows) {
      doc.fontSize(11).font(l === "Montant à verser DGI" ? "Helvetica-Bold" : "Helvetica");
      doc.text(String(l), 80).text(`${Math.round(Number(v)).toLocaleString("fr-FR")} XOF`, 400, doc.y - 15);
      doc.moveDown(0.5);
    }
    doc.moveDown(2).fontSize(9).font("Helvetica").text("Généré par Kanoo — Niamey, Niger", { align: "center" });
    doc.end();
  });
}
