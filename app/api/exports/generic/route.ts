import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getAuthContext, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { InvoiceModel } from "@/models/Invoice";
import { PaymentModel } from "@/models/Payment";
import { EmployeeModel } from "@/models/Employee";
import { PayslipModel } from "@/models/Payslip";

/**
 * GET /api/exports/generic?format=cegid|ebp|divalto|fec&annee=YYYY&mois=MM
 *
 * Formats supportés :
 *  - cegid     : Cegid Expert Comptable (CSV séparateur ;)
 *  - ebp       : EBP Compta Open Line (CSV séparateur |)
 *  - divalto   : Divalto Infinity (CSV séparateur ,)
 *  - fec       : Fichier d'Écritures Comptables (norme DGFiP, adapté Niger DGI)
 */
export async function GET(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  await connectDB();
  const url = new URL(req.url);
  const format = url.searchParams.get("format") || "fec";
  const annee = parseInt(url.searchParams.get("annee") || String(new Date().getFullYear()));
  const mois = url.searchParams.get("mois") ? parseInt(url.searchParams.get("mois")!) : null;

  const start = mois ? new Date(annee, mois - 1, 1) : new Date(annee, 0, 1);
  const end   = mois ? new Date(annee, mois, 0, 23, 59, 59) : new Date(annee, 11, 31, 23, 59, 59);

  const entries = await AccountingEntryModel.find({
    ...tenantFilter(auth),
    entryDate: { $gte: start, $lte: end },
  }).sort({ entryDate: 1, journalCode: 1 }).lean();

  let csv = "";
  let filename = "";
  let sep = ";";

  // ── FEC (Fichier d'Écritures Comptables — norme française adaptée Niger) ──
  if (format === "fec") {
    sep = "|";
    filename = `FEC-${annee}${mois ? `-${String(mois).padStart(2,"0")}` : ""}.txt`;
    const header = "JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Debit|Credit|EcritureLet|DateLet|ValidDate|MontantDevise|Idevise";
    const rows: string[] = [header];
    let lineNum = 1;
    for (const e of entries) {
      const dateStr = new Date(e.entryDate).toISOString().slice(0, 10).replace(/-/g, "");
      for (const line of e.lines) {
        rows.push([
          e.journalCode,
          e.journalCode === "VT" ? "Ventes" : e.journalCode === "AC" ? "Achats" : e.journalCode === "BQ" ? "Banque" : "Opérations Diverses",
          String(lineNum++).padStart(8, "0"),
          dateStr,
          line.accountCode,
          (line.accountLabel || "").replace(/\|/g, " "),
          "",
          "",
          e.reference || "",
          dateStr,
          (e.label || "").slice(0, 100).replace(/\|/g, " "),
          line.debit > 0 ? line.debit.toFixed(2) : "0.00",
          line.credit > 0 ? line.credit.toFixed(2) : "0.00",
          line.letterRef || "",
          "",
          dateStr,
          "",
          "XOF",
        ].join(sep));
      }
    }
    csv = rows.join("\r\n");
  }

  // ── CEGID ──
  else if (format === "cegid") {
    sep = ";";
    filename = `CEGID-${annee}${mois ? `-${String(mois).padStart(2,"0")}` : ""}.csv`;
    const header = "Journal;Date;Compte;Libellé compte;Libellé écriture;Débit;Crédit;Référence;Lettrage";
    const rows: string[] = [header];
    for (const e of entries) {
      const dateStr = new Date(e.entryDate).toLocaleDateString("fr-FR");
      for (const line of e.lines) {
        rows.push([
          e.journalCode,
          dateStr,
          line.accountCode,
          `"${(line.accountLabel || "").replace(/"/g, "'")}"`,
          `"${(e.label || "").slice(0, 80).replace(/"/g, "'")}"`,
          line.debit > 0 ? line.debit.toFixed(2).replace(".", ",") : "0,00",
          line.credit > 0 ? line.credit.toFixed(2).replace(".", ",") : "0,00",
          e.reference || "",
          line.letterRef || "",
        ].join(sep));
      }
    }
    csv = rows.join("\r\n");
  }

  // ── EBP ──
  else if (format === "ebp") {
    sep = "|";
    filename = `EBP-${annee}${mois ? `-${String(mois).padStart(2,"0")}` : ""}.txt`;
    const header = "Type|Journal|Date|NumPiece|Compte|Libelle|Montant|Sens|Lettrage";
    const rows: string[] = [header];
    for (const e of entries) {
      const dateStr = new Date(e.entryDate).toLocaleDateString("fr-FR");
      for (const line of e.lines) {
        if (line.debit > 0) {
          rows.push(["G", e.journalCode, dateStr, e.reference || "", line.accountCode,
            (e.label || "").slice(0, 60).replace(/\|/g, " "), line.debit.toFixed(2), "D", line.letterRef || ""].join(sep));
        }
        if (line.credit > 0) {
          rows.push(["G", e.journalCode, dateStr, e.reference || "", line.accountCode,
            (e.label || "").slice(0, 60).replace(/\|/g, " "), line.credit.toFixed(2), "C", line.letterRef || ""].join(sep));
        }
      }
    }
    csv = rows.join("\r\n");
  }

  // ── DIVALTO ──
  else if (format === "divalto") {
    sep = ",";
    filename = `DIVALTO-${annee}${mois ? `-${String(mois).padStart(2,"0")}` : ""}.csv`;
    const header = "CODEJRN,DATEPIECE,NUMPIECE,CODECPT,LIBCPT,LIBPIECE,MONTANT,SENS,DEVISE";
    const rows: string[] = [header];
    for (const e of entries) {
      const dateStr = new Date(e.entryDate).toLocaleDateString("fr-FR").replace(/\//g, "-");
      for (const line of e.lines) {
        if (line.debit > 0) {
          rows.push([e.journalCode, dateStr, e.reference || "0",
            line.accountCode, `"${(line.accountLabel||"").replace(/"/g,"'")}"`,
            `"${(e.label||"").slice(0,60).replace(/"/g,"'")}"`,
            line.debit.toFixed(2), "D", "XOF"].join(sep));
        }
        if (line.credit > 0) {
          rows.push([e.journalCode, dateStr, e.reference || "0",
            line.accountCode, `"${(line.accountLabel||"").replace(/"/g,"'")}"`,
            `"${(e.label||"").slice(0,60).replace(/"/g,"'")}"`,
            line.credit.toFixed(2), "C", "XOF"].join(sep));
        }
      }
    }
    csv = rows.join("\r\n");
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=UTF-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
