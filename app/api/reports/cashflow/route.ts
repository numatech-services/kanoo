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

    const entries = await AccountingEntryModel.find({
      ...tenantFilter(auth),
      journalCode: { $in: ["BQ", "CA"] },
      entryDate: { $gte: start, $lte: end },
    }).lean();

    let encaissements = 0;
    let decaissements = 0;

    for (const entry of entries) {
      for (const line of entry.lines) {
        const code = line.accountCode;
        if (code.startsWith("4") || code.startsWith("7")) {
          encaissements += line.credit;
        }
        if (code.startsWith("6") || code.startsWith("4")) {
          decaissements += line.debit;
        }
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
