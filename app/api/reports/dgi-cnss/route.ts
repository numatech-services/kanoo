import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { authorize, tenantFilter } from "@/lib/api-helpers";
import { PayslipModel } from "@/models/Payslip";
import { assietteBulletin, echeanceCnss, libellePeriodeCnss, moisDeLaPeriode, totauxCnss, type PeriodeCnss, type PayslipCnss } from "@/lib/cnss-declaration";

export async function GET(req: NextRequest) {
  const gate = await authorize(req, "payslips", "read");
  if (!gate.ok) return gate.response;
  const auth = gate.auth;
  await connectDB();
  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") || String(new Date().getFullYear()));
  const trimestre = parseInt(url.searchParams.get("trimestre") || "1");
  const mois = parseInt(url.searchParams.get("mois") || "");
  // Mensuelle (20 salariés et plus) ou trimestrielle.
  const period: PeriodeCnss = mois >= 1 && mois <= 12 ? { annee: year, mois } : { annee: year, trimestre: Math.min(4, Math.max(1, trimestre)) };
  const { debut: startMonth, fin: endMonth } = moisDeLaPeriode(period);
  const label = libellePeriodeCnss(period);

  const payslips = await PayslipModel.find({ ...tenantFilter(auth), year, month: { $gte: startMonth, $lte: endMonth } }).populate("employeeId", "firstName lastName cnssNumber").lean<Array<PayslipCnss & Record<string, unknown>>>();

  const PDFDocument = (await import("pdfkit")).default;
  const buffers: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 50 });
  doc.on("data", (b: Buffer) => buffers.push(b));

  return new Promise<NextResponse>((resolve) => {
    doc.on("end", () => {
      const pdf = Buffer.concat(buffers);
      resolve(new NextResponse(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="CNSS-${label.replace("/", "-")}.pdf"` } }));
    });
    doc.fontSize(16).font("Helvetica-Bold").text(`BORDEREAU CNSS — ${label}`, { align: "center" });
    doc.fontSize(9).font("Helvetica").text(`Assiette plafonnée à 500 000 FCFA par salarié et par mois. À payer au plus tard le ${echeanceCnss(period).toLocaleDateString("fr-FR")}.`, { align: "center" });
    doc.moveDown();
    let y = doc.y;
    doc.fontSize(9).font("Helvetica-Bold").text("Employé", 50, y).text("N° CNSS", 220, y).text("Assiette", 340, y).text("CNSS salarié", 430, y).text("CNSS patronal", 520, y).text("Total", 620, y);
    y += 20;
    doc.font("Helvetica");
    let totalGross = 0, totalEmp = 0, totalPat = 0;
    for (const p of payslips) {
      const emp = p.employeeId as {firstName?:string;lastName?:string;cnssNumber?:string} | null;
      const name = emp ? `${emp.firstName||""} ${emp.lastName||""}` : "—";
      doc.text(name.slice(0,28), 50, y).text(emp?.cnssNumber||"—", 220, y).text(assietteBulletin(p).toLocaleString("fr-FR"), 340, y).text(p.cnssEmployee.toLocaleString("fr-FR"), 430, y).text(p.cnssEmployer.toLocaleString("fr-FR"), 520, y).text((p.cnssEmployee+p.cnssEmployer).toLocaleString("fr-FR"), 620, y);
      y += 16; totalGross += assietteBulletin(p); totalEmp += p.cnssEmployee; totalPat += p.cnssEmployer;
    }
    y += 8;
    doc.font("Helvetica-Bold").text("TOTAL", 50, y).text(totalGross.toLocaleString("fr-FR"), 340, y).text(totalEmp.toLocaleString("fr-FR"), 430, y).text(totalPat.toLocaleString("fr-FR"), 520, y).text((totalEmp+totalPat).toLocaleString("fr-FR"), 620, y);
    // Ventilation de la part patronale par branche.
    const b = totauxCnss(payslips).branches;
    y += 24;
    doc.font("Helvetica").fontSize(9).text(
      `Part patronale : prestations familiales ${b.pf.toLocaleString("fr-FR")} · accidents du travail ${b.atmp.toLocaleString("fr-FR")} · pensions ${b.pensions.toLocaleString("fr-FR")} · ANPE ${b.anpe.toLocaleString("fr-FR")}`,
      50, y);
    doc.end();
  });
}
