import ExcelJS from "exceljs";
import type { AccountAmounts, StatementLine } from "@/lib/financial-statements";
import type { FinancialStatements } from "@/lib/financial-statements-server";
import { GUARANTEE_TYPES } from "@/lib/guarantees";

const balanceOf = (rows: AccountAmounts[], prefixes: string[], exclude: string[] = []) =>
  rows.filter(r => prefixes.some(p => r.code.startsWith(p)) && !exclude.some(p => r.code.startsWith(p))).reduce((t, r) => t + r.debit - r.credit, 0);
const debitsOf = (rows: AccountAmounts[], prefixes: string[]) => rows.filter(r => prefixes.some(p => r.code.startsWith(p))).reduce((t, r) => t + r.debit, 0);
const creditsOf = (rows: AccountAmounts[], prefixes: string[]) => rows.filter(r => prefixes.some(p => r.code.startsWith(p))).reduce((t, r) => t + r.credit, 0);

/** Notes annexes principales, calculées sur les soldes et mouvements. */
export function annexNotes(fs: FinancialStatements, prevBalances: AccountAmounts[], guarantees: Array<{ type: string; amount: number; beneficiary: string; expiryDate?: Date }>) {
  const cats: Array<[string, string[], string[]]> = [
    ["Immobilisations incorporelles", ["20", "21"], ["281", "291"]],
    ["Immobilisations corporelles", ["22", "23", "24", "25"], ["282", "283", "284", "285", "286", "287", "288", "289", "292", "293", "294", "295", "28"]],
    ["Immobilisations financières", ["26", "27"], ["296", "297"]],
  ];
  const fixedAssets = cats.map(([label, gross]) => ({
    label,
    opening: balanceOf(prevBalances, gross),
    acquisitions: debitsOf(fs.movements, gross),
    disposals: creditsOf(fs.movements, gross),
    closing: balanceOf(fs.balances, gross),
  }));
  const depreciation = [{
    label: "Amortissements et dépréciations des immobilisations",
    opening: -balanceOf(prevBalances, ["28", "29"]),
    charges: creditsOf(fs.movements, ["28", "29"]),
    reversals: debitsOf(fs.movements, ["28", "29"]),
    closing: -balanceOf(fs.balances, ["28", "29"]),
  }];
  const clients = [
    ["Clients (411, hors retenues de garantie)", balanceOf(fs.balances, ["411"], ["4117"])],
    ["Clients, retenues de garantie (4117)", balanceOf(fs.balances, ["4117"])],
    ["Créances douteuses ou litigieuses (416)", balanceOf(fs.balances, ["416"])],
    ["Autres comptes clients (412-418)", balanceOf(fs.balances, ["412", "413", "414", "415", "417", "418"])],
    ["Dépréciations des comptes clients (491)", balanceOf(fs.balances, ["491"])],
    ["Clients, avances reçues (419)", balanceOf(fs.balances, ["419"])],
  ] as Array<[string, number]>;
  const suppliers = [
    ["Fournisseurs (401)", -balanceOf(fs.balances, ["401"])],
    ["Fournisseurs, factures non parvenues (408)", -balanceOf(fs.balances, ["408"])],
    ["Fournisseurs, avances versées (409)", balanceOf(fs.balances, ["409"])],
  ] as Array<[string, number]>;
  const commitments = guarantees.map(g => ({ label: GUARANTEE_TYPES[g.type as keyof typeof GUARANTEE_TYPES] ?? g.type, beneficiary: g.beneficiary, amount: g.amount, expiry: g.expiryDate }));
  return { fixedAssets, depreciation, clients, suppliers, commitments };
}
export type AnnexNotes = ReturnType<typeof annexNotes>;

/** Liasse des états financiers (DSF) au format Excel, exercices N et N-1. */
export async function buildFinancialStatementsXlsx(
  fs: FinancialStatements, notes: AnnexNotes,
  tenant: { name?: string; nif?: string; rccm?: string; address?: string },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kanoo";
  const money = "#,##0;[Red]-#,##0";
  const head = (ws: ExcelJS.Worksheet, title: string, columns: string[]) => {
    ws.addRow([tenant.name ?? ""]).font = { bold: true, size: 13 };
    ws.addRow([`NIF : ${tenant.nif ?? "—"}    RCCM : ${tenant.rccm ?? "—"}    ${tenant.address ?? ""}`]);
    ws.addRow([`${title} — exercice ${fs.year}${fs.closed ? "" : " (provisoire : exercice non clôturé)"}`]).font = { bold: true, size: 12 };
    ws.addRow([]);
    const h = ws.addRow(columns);
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1C3D5A" } }; });
  };
  const style = (row: ExcelJS.Row, l: StatementLine, from: number) => {
    if (l.total) { row.font = { bold: true }; row.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEDE8" } }; }); }
    for (let i = from; i <= row.cellCount; i++) row.getCell(i).numFmt = money;
  };
  const prevOf = (lines: StatementLine[], ref: string) => lines.find(x => x.ref === ref)?.amount ?? 0;

  const actif = wb.addWorksheet("Bilan actif");
  head(actif, "BILAN — ACTIF", ["Réf.", "Actif", "Brut", "Amort. / Dépréc.", `Net ${fs.year}`, `Net ${fs.year - 1}`]);
  for (const l of fs.balanceSheet.actif) style(actif.addRow([l.ref, l.label, l.gross ?? "", l.depreciation ?? "", l.amount, prevOf(fs.balanceSheetPrev.actif, l.ref)]), l, 3);
  actif.columns = [{ width: 6 }, { width: 52 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];

  const passif = wb.addWorksheet("Bilan passif");
  head(passif, "BILAN — PASSIF", ["Réf.", "Passif", `${fs.year}`, `${fs.year - 1}`]);
  for (const l of fs.balanceSheet.passif) style(passif.addRow([l.ref, l.label, l.amount, prevOf(fs.balanceSheetPrev.passif, l.ref)]), l, 3);
  passif.columns = [{ width: 6 }, { width: 60 }, { width: 16 }, { width: 16 }];

  const cr = wb.addWorksheet("Compte de résultat");
  head(cr, "COMPTE DE RÉSULTAT", ["Réf.", "Libellé", `${fs.year}`, `${fs.year - 1}`]);
  for (const l of fs.incomeStatement.lines) style(cr.addRow([l.ref, l.label, l.amount, prevOf(fs.incomeStatementPrev.lines, l.ref)]), l, 3);
  cr.columns = [{ width: 6 }, { width: 60 }, { width: 16 }, { width: 16 }];

  const tft = wb.addWorksheet("TFT");
  head(tft, "TABLEAU DES FLUX DE TRÉSORERIE", ["Réf.", "Libellé", `${fs.year}`]);
  for (const l of fs.cashFlow.lines) style(tft.addRow([l.ref, l.label, l.amount]), l, 3);
  tft.columns = [{ width: 6 }, { width: 72 }, { width: 16 }];

  const n = wb.addWorksheet("Notes annexes");
  head(n, "NOTES ANNEXES (extraits)", ["", "", "", "", "", ""]);
  const section = (t: string) => { n.addRow([]); n.addRow([t]).font = { bold: true }; };
  section("Note 3A — Immobilisations brutes");
  n.addRow(["Rubrique", "Ouverture", "Acquisitions", "Cessions / sorties", "Clôture"]).font = { bold: true };
  for (const f of notes.fixedAssets) n.addRow([f.label, f.opening, f.acquisitions, f.disposals, f.closing]).eachCell((c, i) => { if (i > 1) c.numFmt = money; });
  section("Note 3C — Amortissements et dépréciations");
  n.addRow(["Rubrique", "Ouverture", "Dotations", "Reprises / sorties", "Clôture"]).font = { bold: true };
  for (const f of notes.depreciation) n.addRow([f.label, f.opening, f.charges, f.reversals, f.closing]).eachCell((c, i) => { if (i > 1) c.numFmt = money; });
  section("Note 7 — Clients");
  for (const [label, v] of notes.clients) n.addRow([label, v]).getCell(2).numFmt = money;
  section("Note 17 — Fournisseurs d'exploitation");
  for (const [label, v] of notes.suppliers) n.addRow([label, v]).getCell(2).numFmt = money;
  section("Engagements hors bilan — cautions données (en cours à la clôture)");
  if (!notes.commitments.length) n.addRow(["Aucune caution en cours."]);
  for (const c of notes.commitments) n.addRow([c.label, c.amount, c.beneficiary, c.expiry ? new Date(c.expiry).toLocaleDateString("fr-FR") : ""]).getCell(2).numFmt = money;
  n.addRow(["Total", notes.commitments.reduce((t, c) => t + c.amount, 0)]).font = { bold: true };
  n.columns = [{ width: 52 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 16 }, { width: 10 }];

  const bal = wb.addWorksheet("Balance");
  head(bal, "BALANCE GÉNÉRALE", ["Compte", "Intitulé", "Débit", "Crédit", "Solde débiteur", "Solde créditeur"]);
  for (const r of fs.balances) {
    const s = r.debit - r.credit;
    bal.addRow([r.code, r.label ?? "", r.debit, r.credit, Math.max(0, s), Math.max(0, -s)]).eachCell((c, i) => { if (i > 2) c.numFmt = money; });
  }
  bal.columns = [{ width: 10 }, { width: 48 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}
