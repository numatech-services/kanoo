import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getAuthContext, tenantFilter } from "@/lib/api-helpers";
import { PayslipModel } from "@/models/Payslip";

export async function GET(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  await connectDB();
  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") || String(new Date().getFullYear()));
  const trimestre = parseInt(url.searchParams.get("trimestre") || "1");
  const startMonth = (trimestre - 1) * 3 + 1;
  const endMonth = trimestre * 3;

  const payslips = await PayslipModel.find({ ...tenantFilter(auth), year, month: { $gte: startMonth, $lte: endMonth } }).populate("employeeId", "firstName lastName cnssNumber").lean();

  const PDFDocument = (await import("pdfkit")).default;
  const buffers: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 50 });
  doc.on("data", (b: Buffer) => buffers.push(b));

  return new Promise<NextResponse>((resolve) => {
    doc.on("end", () => {
      const pdf = Buffer.concat(buffers);
      resolve(new NextResponse(pdf, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="CNSS-T${trimestre}-${year}.pdf"` } }));
    });
    doc.fontSize(16).font("Helvetica-Bold").text(`BORDEREAU CNSS — T${trimestre}/${year}`, { align: "center" });
    doc.moveDown();
    let y = doc.y;
    doc.fontSize(9).font("Helvetica-Bold").text("Employé", 50, y).text("N° CNSS", 220, y).text("Salaire brut", 340, y).text("CNSS salarié", 430, y).text("CNSS patronal", 520, y).text("Total", 620, y);
    y += 20;
    doc.font("Helvetica");
    let totalGross = 0, totalEmp = 0, totalPat = 0;
    for (const p of payslips) {
      const emp = p.employeeId as {firstName?:string;lastName?:string;cnssNumber?:string} | null;
      const name = emp ? `${emp.firstName||""} ${emp.lastName||""}` : "—";
      doc.text(name.slice(0,28), 50, y).text(emp?.cnssNumber||"—", 220, y).text(p.grossSalary.toLocaleString("fr-FR"), 340, y).text(p.cnssEmployee.toLocaleString("fr-FR"), 430, y).text(p.cnssEmployer.toLocaleString("fr-FR"), 520, y).text((p.cnssEmployee+p.cnssEmployer).toLocaleString("fr-FR"), 620, y);
      y += 16; totalGross += p.grossSalary; totalEmp += p.cnssEmployee; totalPat += p.cnssEmployer;
    }
    y += 8;
    doc.font("Helvetica-Bold").text("TOTAL", 50, y).text(totalGross.toLocaleString("fr-FR"), 340, y).text(totalEmp.toLocaleString("fr-FR"), 430, y).text(totalPat.toLocaleString("fr-FR"), 520, y).text((totalEmp+totalPat).toLocaleString("fr-FR"), 620, y);
    doc.end();
  });
}
