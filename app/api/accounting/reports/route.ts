import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { TenantModel } from "@/models/Tenant";
import { trialBalance, generalLedger, incomeStatement, balanceSheet } from "@/lib/accounting-reports";
import { isInternFor, INTERN_EXPORT_MESSAGE } from "@/lib/role-resources";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csv = (name: string, rows: unknown[][]) => new NextResponse("﻿" + rows.map(r => r.map(cell).join(";")).join("\r\n"), {
  headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` },
});

/**
 * GET /api/accounting/reports?type=balance|ledger|pl|bs&from=&to=&account=&format=csv
 * États comptables : balance générale, grand livre, compte de résultat, bilan.
 */
export const GET = withAuth("accountingEntries", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "balance";
  const parse = (k: string, end = false) => { const v = url.searchParams.get(k); return v ? new Date(end ? `${v}T23:59:59` : v) : undefined; };
  const from = parse("from"), to = parse("to", true);
  if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) return badRequest("Dates invalides.");
  const asCsv = url.searchParams.get("format") === "csv";
  if (asCsv && isInternFor(auth, "accountingEntries")) return forbidden(INTERN_EXPORT_MESSAGE);
  const stamp = `${url.searchParams.get("from") ?? "origine"}_${url.searchParams.get("to") ?? "ce-jour"}`;

  if (type === "balance") {
    const rows = await trialBalance(auth.tenantId, from, to, url.searchParams.get("account")?.replace(/\D/g, "") || undefined);
    if (asCsv) return csv(`balance_${stamp}`, [["Compte", "Intitulé", "Débit", "Crédit", "Solde débiteur", "Solde créditeur"], ...rows.map(r => [r.code, r.label, r.debit, r.credit, r.soldeDebit, r.soldeCredit])]);
    return ok({ rows, totals: rows.reduce((t, r) => ({ debit: t.debit + r.debit, credit: t.credit + r.credit, soldeDebit: t.soldeDebit + r.soldeDebit, soldeCredit: t.soldeCredit + r.soldeCredit }), { debit: 0, credit: 0, soldeDebit: 0, soldeCredit: 0 }) });
  }
  if (type === "ledger") {
    const account = (url.searchParams.get("account") || "").replace(/\D/g, "");
    if (!account) return badRequest("Indiquez un compte (ou une racine, ex. 411).");
    const gl = await generalLedger(auth.tenantId, account, from, to);
    if (asCsv) return csv(`grand-livre_${account}_${stamp}`, [["Date", "Journal", "Pièce", "Libellé", "Compte", "Débit", "Crédit", "Solde"], ["", "", "", "Solde d'ouverture", "", "", "", gl.openingBalance],
      ...gl.lines.map(l => [new Date(l.date).toLocaleDateString("fr-FR"), l.journal, l.reference, l.label, l.account, l.debit, l.credit, l.balance])]);
    return ok(gl);
  }
  if (type === "pl") {
    const pl = await incomeStatement(auth.tenantId, from, to);
    if (asCsv) return csv(`compte-de-resultat_${stamp}`, [["Rubrique", "Compte", "Intitulé", "Montant"], ...pl.groups.flatMap(g => [[g.label, "", "", g.amount], ...g.accounts.map(a => ["", a.code, a.label, a.amount])]), ["Total produits", "", "", pl.produits], ["Total charges", "", "", pl.charges], ["Résultat", "", "", pl.resultat]]);
    return ok(pl);
  }
  if (type === "bs") {
    const tenant = await TenantModel.findById(auth.tenantId).select("closedFiscalYears").lean<{ closedFiscalYears?: number[] } | null>();
    const bs = await balanceSheet(auth.tenantId, to ?? new Date(), tenant?.closedFiscalYears ?? []);
    if (asCsv) return csv(`bilan_${url.searchParams.get("to") ?? "ce-jour"}`, [["Côté", "Rubrique", "Compte", "Intitulé", "Montant"], ...bs.actif.map(a => ["Actif", a.rubric, a.code, a.label, a.amount]), ...bs.passif.map(a => ["Passif", a.rubric, a.code, a.label, a.amount]), ["Total actif", "", "", "", bs.totalActif], ["Total passif", "", "", "", bs.totalPassif]]);
    return ok(bs);
  }
  return badRequest("Type d'état inconnu.");
});
