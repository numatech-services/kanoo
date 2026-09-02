import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { getAuthContext, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";

// GET /api/exports/ohada?annee=2025&format=grandlivre|bilan|resultat
export async function GET(req: NextRequest) {
  const auth = getAuthContext(req);
  if (!auth) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  await connectDB();
  const url = new URL(req.url);
  const annee = parseInt(url.searchParams.get("annee") || String(new Date().getFullYear()));
  const format = url.searchParams.get("format") || "grandlivre";

  const start = new Date(annee, 0, 1);
  const end = new Date(annee, 11, 31, 23, 59, 59);

  const entries = await AccountingEntryModel.find({
    ...tenantFilter(auth),
    entryDate: { $gte: start, $lte: end },
  }).sort({ accountCode: 1, entryDate: 1 }).lean();

  // Agréger par compte
  const balanceMap = new Map<string, { code: string; label: string; debit: number; credit: number }>();
  for (const e of entries) {
    for (const line of e.lines) {
      const key = line.accountCode;
      if (!balanceMap.has(key)) balanceMap.set(key, { code: key, label: line.accountLabel || key, debit: 0, credit: 0 });
      const acc = balanceMap.get(key)!;
      acc.debit += line.debit || 0;
      acc.credit += line.credit || 0;
    }
  }

  const balance = Array.from(balanceMap.values()).map(a => ({
    ...a,
    solde: a.debit - a.credit,
    soldeDebiteur: Math.max(0, a.debit - a.credit),
    soldeCrediteur: Math.max(0, a.credit - a.debit),
  })).sort((a, b) => a.code.localeCompare(b.code));

  if (format === "grandlivre") {
    const rows = ["N°Compte;Libellé;Total Débit;Total Crédit;Solde Débiteur;Solde Créditeur"];
    for (const a of balance) {
      rows.push([a.code, `"${a.label}"`, a.debit, a.credit, a.soldeDebiteur, a.soldeCrediteur].join(";"));
    }
    return new NextResponse(rows.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=UTF-8",
        "Content-Disposition": `attachment; filename="grand-livre-ohada-${annee}.csv"`,
      },
    });
  }

  // Retourner JSON pour bilan/résultat (traitement côté client)
  return NextResponse.json({ annee, format, balance, entries: entries.length });
}
