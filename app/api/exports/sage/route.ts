import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getAuthContext, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";

// GET /api/exports/sage?annee=2025&mois=12
// Génère un CSV d'export au format SAGE 100 Comptabilité
export async function GET(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  await connectDB();
  const url = new URL(req.url);
  const annee = parseInt(url.searchParams.get("annee") || String(new Date().getFullYear()));
  const mois = url.searchParams.get("mois") ? parseInt(url.searchParams.get("mois")!) : null;

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
        `"${(line.accountLabel || entry.label).replace(/"/g, "'")}"`,
        entry.reference || "",
        line.debit > 0 ? line.debit.toString().replace(".", ",") : "0",
        line.credit > 0 ? line.credit.toString().replace(".", ",") : "0",
        line.letterRef || "",
      ].join(";"));
    }
  }

  const csv = rows.join("\r\n");
  const filename = `export-sage-${annee}${mois ? `-${String(mois).padStart(2,"0")}` : ""}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=windows-1252",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
