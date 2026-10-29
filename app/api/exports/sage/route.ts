import { neutralizeFormula, encodeWindows1252 } from "@/lib/csv";
import { NextRequest, NextResponse } from "next/server";
import { isInternFor, INTERN_EXPORT_MESSAGE } from "@/lib/role-resources";
import { connectDB } from "@/lib/db";
import { authorize, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";

// GET /api/exports/sage?annee=2025&mois=12
// Génère un CSV d'export au format SAGE 100 Comptabilité
export async function GET(req: NextRequest) {
  const gate = await authorize(req, "accountingEntries", "read");
  if (!gate.ok) return gate.response;
  const auth = gate.auth;
  // Stagiaire : ni export ni envoi de fichier (règle commune).
  if (isInternFor(auth, "accountingEntries")) return NextResponse.json({ success: false, error: INTERN_EXPORT_MESSAGE }, { status: 403 });

  await connectDB();
  const url = new URL(req.url);
  const annee = Number(url.searchParams.get("annee") || new Date().getFullYear());
  const mois = url.searchParams.get("mois") ? Number(url.searchParams.get("mois")) : null;
  if (!Number.isInteger(annee) || annee < 2000 || annee > new Date().getFullYear() + 1 || (mois !== null && (!Number.isInteger(mois) || mois < 1 || mois > 12))) {
    return NextResponse.json({ success: false, error: "Période invalide (annee : 2000 à l'an prochain ; mois : 1 à 12)." }, { status: 400 });
  }

  const start = mois ? new Date(annee, mois - 1, 1) : new Date(annee, 0, 1);
  const end   = mois ? new Date(annee, mois, 0, 23, 59, 59) : new Date(annee, 11, 31, 23, 59, 59);

  const entries = await AccountingEntryModel.find({
    ...tenantFilter(auth),
    entryDate: { $gte: start, $lte: end },
  }).sort({ entryDate: 1 }).lean();

  // Format SAGE 100 : Journal;Date;N°Compte;Libellé;Débit;Crédit;Référence;Lettrage
  const rows: string[] = [
    "Journal;Date;N°Compte;Libellé;Réf. pièce;Débit;Crédit;Lettrage",
  ];

  for (const entry of entries) {
    const dateStr = new Date(entry.entryDate).toLocaleDateString("fr-FR");
    for (const line of entry.lines) {
      rows.push([
        entry.journalCode,
        dateStr,
        line.accountCode,
        `"${neutralizeFormula(line.accountLabel || entry.label).replace(/"/g, "'")}"`,
        // Référence entre guillemets : un « ; » décalait les colonnes, un « = » s'exécutait dans Excel.
        `"${neutralizeFormula(entry.reference || "").replace(/"/g, "'")}"`,
        line.debit > 0 ? line.debit.toString().replace(".", ",") : "0",
        line.credit > 0 ? line.credit.toString().replace(".", ",") : "0",
        line.letterRef || "",
      ].join(";"));
    }
  }

  const csv = rows.join("\r\n");
  const filename = `export-sage-${annee}${mois ? `-${String(mois).padStart(2,"0")}` : ""}.csv`;

  return new NextResponse(encodeWindows1252(csv), {
    headers: {
      "Content-Type": "text/csv; charset=windows-1252",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
