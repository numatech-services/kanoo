import ExcelJS from "exceljs";
import { Types } from "mongoose";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TenantModel } from "@/models/Tenant";
import { BankGuaranteeModel } from "@/models/BankGuarantee";
import { trialBalance, type BalanceRow } from "@/lib/accounting-reports";
import { financialStatements } from "@/lib/financial-statements-server";
import { annexNotes, buildFinancialStatementsXlsx } from "@/lib/financial-statements-xlsx";
import { MONTHS_FR } from "@/lib/automations";

/**
 * Dossier mensuel pour le comptable : un classeur « dossier-comptable »
 * (balance du mois, balance cumulée de l'exercice, journal du mois) et les
 * états financiers provisoires arrêtés à la fin du mois.
 *
 * Mêmes calculs que les écrans (trialBalance, financialStatements) : le
 * comptable reçoit les chiffres que l'organisation voit, pas une autre version.
 */
export async function buildAccountantPacket(tenantId: string, year: number, month: number) {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59);
  const tenant = await TenantModel.findById(tenantId).select("name nif rccm address")
    .lean<{ name?: string; nif?: string; rccm?: string; address?: string } | null>();
  const [monthBalance, ytdBalance, entries] = await Promise.all([
    trialBalance(tenantId, from, to),
    trialBalance(tenantId, new Date(year, 0, 1), to),
    AccountingEntryModel.find({ tenantId: new Types.ObjectId(tenantId), entryDate: { $gte: from, $lte: to } })
      .sort({ entryDate: 1, journalCode: 1, _id: 1 }).limit(20_000)
      .select("entryDate journalCode reference label lines").lean<Array<{ entryDate: Date; journalCode: string; reference: string; label: string; lines: Array<{ accountCode: string; accountLabel: string; debit: number; credit: number }> }>>(),
  ]);

  const period = `${MONTHS_FR[month - 1]} ${year}`;
  const money = "#,##0;[Red]-#,##0";
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kanoo";
  const head = (ws: ExcelJS.Worksheet, title: string, columns: string[]) => {
    ws.addRow([tenant?.name ?? ""]).font = { bold: true, size: 13 };
    ws.addRow([`NIF : ${tenant?.nif ?? "—"}    RCCM : ${tenant?.rccm ?? "—"}`]);
    ws.addRow([title]).font = { bold: true, size: 12 };
    ws.addRow([]);
    const h = ws.addRow(columns);
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1C3D5A" } }; });
  };
  const balanceSheet = (name: string, title: string, rows: BalanceRow[]) => {
    const ws = wb.addWorksheet(name);
    head(ws, title, ["Compte", "Intitulé", "Débit", "Crédit", "Solde débiteur", "Solde créditeur"]);
    for (const r of rows) ws.addRow([r.code, r.label, r.debit, r.credit, r.soldeDebit, r.soldeCredit]).eachCell((c, i) => { if (i > 2) c.numFmt = money; });
    const t = ws.addRow(["", "Total", ...(["debit", "credit", "soldeDebit", "soldeCredit"] as const).map(k => rows.reduce((s, r) => s + r[k], 0))]);
    t.font = { bold: true }; t.eachCell((c, i) => { if (i > 2) c.numFmt = money; });
    ws.columns = [{ width: 10 }, { width: 46 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];
  };
  balanceSheet("Balance du mois", `BALANCE — ${period}`, monthBalance);
  balanceSheet("Balance cumulée", `BALANCE CUMULÉE — 1er janvier au ${to.getDate()} ${period}`, ytdBalance);

  const j = wb.addWorksheet("Journal du mois");
  head(j, `JOURNAL DES ÉCRITURES — ${period}`, ["Date", "Journal", "Pièce", "Libellé", "Compte", "Intitulé", "Débit", "Crédit"]);
  for (const e of entries) {
    for (const l of e.lines) {
      j.addRow([new Date(e.entryDate).toLocaleDateString("fr-FR"), e.journalCode, e.reference, e.label, l.accountCode, l.accountLabel, l.debit || "", l.credit || ""])
        .eachCell((c, i) => { if (i > 6) c.numFmt = money; });
    }
  }
  j.columns = [{ width: 12 }, { width: 8 }, { width: 18 }, { width: 40 }, { width: 10 }, { width: 32 }, { width: 14 }, { width: 14 }];

  const dossier = Buffer.from(await wb.xlsx.writeBuffer());

  // États financiers provisoires arrêtés à la fin du mois.
  const fs = await financialStatements(tenantId, year, to);
  const guarantees = await BankGuaranteeModel.find({
    tenantId, issueDate: { $lte: fs.asOf },
    $or: [{ status: "active" }, { releasedAt: { $gt: fs.asOf } }, { calledAt: { $gt: fs.asOf } }],
  }).select("type amount beneficiary expiryDate").lean<Array<{ type: string; amount: number; beneficiary: string; expiryDate?: Date }>>();
  const statements = await buildFinancialStatementsXlsx(fs, annexNotes(fs, fs.balancesPrev, guarantees), tenant ?? {});

  const tag = `${year}-${String(month).padStart(2, "0")}`;
  return {
    period, tenantName: tenant?.name ?? "",
    entryCount: entries.length,
    attachments: [
      { filename: `dossier-comptable-${tag}.xlsx`, content: dossier, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { filename: `etats-financiers-provisoires-${tag}.xlsx`, content: statements, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    ],
  };
}
