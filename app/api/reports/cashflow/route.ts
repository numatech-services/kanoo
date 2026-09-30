import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TokenPayload } from "@/lib/auth";

const MONTHS_FR = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];

export const GET = withAuth("accountingEntries", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const monthsBack = parseInt(url.searchParams.get("months") || "6");

  const now = new Date();
  const months: { mois: string; encaissements: number; decaissements: number; solde: number }[] = [];

  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);

    // Flux de trésorerie = mouvements des comptes de banque (52) et de caisse
    // (57), tous journaux confondus. Un virement interne (contrepartie 585)
    // n'est ni une entrée ni une sortie. L'ancienne version comptait les
    // comptes de tiers (classe 4) des deux côtés et gonflait les deux flux.
    const entries = await AccountingEntryModel.find({
      ...tenantFilter(auth),
      entryDate: { $gte: start, $lte: end },
      "lines.accountCode": { $regex: "^5[27]" },
    }).select("lines").lean<Array<{ lines: Array<{ accountCode: string; debit: number; credit: number }> }>>();

    let encaissements = 0;
    let decaissements = 0;
    for (const entry of entries) {
      if (entry.lines.some(l => l.accountCode.startsWith("585"))) continue;
      for (const line of entry.lines) {
        if (!/^5[27]/.test(line.accountCode)) continue;
        encaissements += line.debit;
        decaissements += line.credit;
      }
    }

    months.push({
      mois: MONTHS_FR[d.getMonth()],
      encaissements: Math.round(encaissements),
      decaissements: Math.round(decaissements),
      solde: Math.round(encaissements - decaissements),
    });
  }

  return ok({ months });
});
