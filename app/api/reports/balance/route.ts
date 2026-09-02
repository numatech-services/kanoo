import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("accountingEntries", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") || String(new Date().getFullYear()));

  const entries = await AccountingEntryModel.find({
    ...tenantFilter(auth),
    entryDate: { $gte: new Date(year, 0, 1), $lte: new Date(year, 11, 31, 23, 59, 59) },
  }).lean();

  // Agréger par compte
  const balanceMap = new Map<string, { code: string; label: string; debit: number; credit: number }>();

  for (const entry of entries) {
    for (const line of entry.lines) {
      const key = line.accountCode;
      if (!balanceMap.has(key)) {
        balanceMap.set(key, { code: key, label: line.accountLabel, debit: 0, credit: 0 });
      }
      const acc = balanceMap.get(key)!;
      acc.debit += line.debit;
      acc.credit += line.credit;
    }
  }

  const balance = Array.from(balanceMap.values())
    .map(a => ({ ...a, solde: a.debit - a.credit }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const totalDebit = balance.reduce((s, a) => s + a.debit, 0);
  const totalCredit = balance.reduce((s, a) => s + a.credit, 0);

  return ok({ year, accounts: balance, totaux: { debit: totalDebit, credit: totalCredit } });
});
