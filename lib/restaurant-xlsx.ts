import ExcelJS from "exceljs";
import { CHARGE_CATEGORIES, MENU_LABELS, type MenuClass } from "@/lib/restaurant";
import { LOSS_REASONS } from "@/lib/spot";
import type { MonthResult } from "@/lib/restaurant-result";

const MONEY = '#,##0 "FCFA";[Red]-#,##0 "FCFA"';
const PCTF = "0.0%";
const METHOD: Record<string, string> = { cash: "Espèces", easypay: "Carte / solde EasyPay", orange_money: "Mobile money", card: "Carte bancaire", bank_transfer: "Virement", check: "Chèque", credit: "Ardoise", other: "Autre" };

/**
 * Dossier du mois d'un comptoir pour la direction et le comptable : résultat
 * de gestion, rapprochement avec la comptabilité, TVA par taux,
 * encaissements, charges par compte, personnel (si droit paie), pertes par
 * article, inventaires, consommation théorique et réelle, stock de fin de
 * mois aux deux niveaux et analyse de la carte.
 */
export async function restaurantWorkbook(r: MonthResult, stock: Array<{ name: string; category?: string; unit: string; reserve: number; desk: number; unitCost: number; value: number }>,
  menu: Array<{ name: string; category?: string; quantity: number; unitMargin: number; mix: number; class: MenuClass }>, stockDate: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kanoo";
  const sheet = (name: string, cols: Array<[string, number, string?]>) => {
    const ws = wb.addWorksheet(name);
    ws.columns = cols.map(([header, width, fmt]) => ({ header, width, ...(fmt ? { style: { numFmt: fmt } } : {}) }));
    ws.getRow(1).font = { bold: true };
    return ws;
  };
  const p = r.pnl, q = p.ratios;
  const pc = (v: number | null) => (v === null ? null : v / 100);
  const res = sheet("Résultat", [["Rubrique", 58], ["Montant", 18, MONEY], ["Prévu", 18, MONEY]]);
  res.addRow([`${r.desk.name} — ${r.month}${r.closed ? ` (clos le ${new Date(r.closed.closedAt).toLocaleDateString("fr-FR")})` : ""}`]).font = { italic: true };
  const rows: Array<[string, number]> = [
    ["Chiffre d'affaires HT", p.revenueHT], ["dont ventes sans coût connu (hors marge)", p.unvaluedRevenueHT], ["Chiffre d'affaires HT au coût connu", p.valuedRevenueHT],
    ["Coût des marchandises vendues", -p.costOfSales], ["Achats payés en caisse hors réception", -p.cashPurchases], ["Marge brute", p.grossMargin],
    ["Pertes déclarées (casse, péremption, invendus, déchets)", -p.losses], ["Repas du personnel et offerts", -p.staffAndOffered], ["Écarts d'inventaire", p.inventoryGap], ["Marge matière", p.materialMargin],
  ];
  for (const [l, v] of rows) res.addRow([l, v]);
  for (const c of p.charges) res.addRow([`  ${c.label}`, -c.actual, c.planned ? -c.planned : null]);
  res.addRow(["Total des charges", -p.totalCharges, p.plannedCharges ? -p.plannedCharges : null]).font = { bold: true };
  res.addRow(["Résultat du comptoir", p.result]).font = { bold: true };
  if (r.closed) res.addRow(["Résultat figé à la clôture", r.closed.result]);
  if (r.closed?.drift) res.addRow(["Écart depuis la clôture", r.closed.drift]);
  res.addRow([]);
  for (const [l, v] of [["Coût matière (% du CA au coût connu)", q.foodCostPct], ["Coût du personnel (%)", q.staffCostPct], ["Matière + personnel (%)", q.primeCostPct], ["Résultat (%)", q.resultPct], ["Taux de marge matière", q.marginRate]] as const) {
    const row = res.addRow([l, pc(v)]); row.getCell(2).numFmt = PCTF;
  }
  for (const [l, v] of [["Ticket moyen HT", q.averageTicket], ["Coût de revient par ticket", q.costPerTicket], ["Point mort (CA HT du mois)", q.breakEvenRevenue], ["Point mort par jour d'ouverture", q.breakEvenPerDay]] as const) res.addRow([l, v]);
  const t = res.addRow(["Tickets", r.sales.tickets]); t.getCell(2).numFmt = "0";
  if (r.warnings.length) { res.addRow([]); res.addRow(["Points d'attention"]).font = { bold: true }; for (const w of r.warnings) res.addRow([w]); }

  const rec = sheet("Rapprochement", [["Élément", 58], ["Montant", 18, MONEY]]);
  rec.addRow(["Chiffre d'affaires comptable du secteur (classe 70)", r.reconciliation.accountingRevenue]);
  rec.addRow(["Chiffre d'affaires de gestion (tickets)", p.revenueHT]);
  rec.addRow(["Écart (ventes hors ticket, entrées de caisse, annulations datées autrement)", r.reconciliation.accountingRevenue - p.revenueHT]);
  rec.addRow(["Achats de marchandises et matières du secteur (601 à 603)", r.reconciliation.accountingPurchases]);
  rec.addRow(["Entrées en stock valorisées du mois (réserve et comptoir)", r.reconciliation.stockEntriesValued]);
  rec.addRow(["Achats payés en caisse hors réception (comptés consommés)", p.cashPurchases]);
  const n = rec.addRow(["Entrées en stock sans prix d'achat (nombre)", r.reconciliation.unvaluedReceptions]); n.getCell(2).numFmt = "0";
  rec.addRow(["Charges de classe 6 du mois sans secteur, dans toute l'organisation", r.reconciliation.untaggedCharges]);
  rec.addRow([`Quote-part de ces charges communes portée par le comptoir`, null]).getCell(2).value = r.desk.commonShare;
  rec.getCell(`B${rec.rowCount}`).numFmt = PCTF;

  const vat = sheet("TVA collectée", [["Taux", 10, PCTF], ["Base HT", 18, MONEY], ["TVA", 18, MONEY]]);
  for (const v of r.sales.vatByRate) vat.addRow([v.rate, v.ht, v.tva]);
  const pay = sheet("Encaissements", [["Moyen", 28], ["Montant", 18, MONEY]]);
  for (const m of r.sales.byMethod) pay.addRow([METHOD[m.method] ?? m.method, m.amount]);

  const ch = sheet("Charges par compte", [["Rubrique", 36], ["Compte", 12], ["Libellé", 50], ["Montant", 18, MONEY]]);
  for (const c of r.chargesDetail) ch.addRow([CHARGE_CATEGORIES[c.category], c.accountCode, c.accountLabel, c.amount]);
  if (r.staffDetail.length) {
    const st = sheet("Personnel", [["Employé", 32], ["Part du temps", 14, PCTF], ["Coût imputé au comptoir", 22, MONEY]]);
    for (const s of r.staffDetail) st.addRow([s.name, s.share, s.allocated]);
  } else if (r.staffTotal) {
    const st = sheet("Personnel", [["Personnel affecté", 32], ["Coût imputé au comptoir", 22, MONEY]]);
    st.addRow(["Total (détail réservé à la paie)", r.staffTotal]);
  }
  const lo = sheet("Pertes par article", [["Article", 34], ["Motif", 30], ["Quantité", 12], ["Valeur au coût", 18, MONEY]]);
  for (const l of r.lossesByItem) lo.addRow([l.name, LOSS_REASONS[l.reason] ?? l.reason, l.quantity, l.value]);
  const inv = sheet("Inventaires", [["Numéro", 26], ["Niveau", 12], ["Validé le", 14], ["Écart au coût", 18, MONEY]]);
  for (const i of r.inventories) inv.addRow([i.number, i.level === "reserve" ? "Réserve" : "Comptoir", new Date(i.validatedAt).toLocaleDateString("fr-FR"), i.gapValue]);
  const co = sheet("Consommation", [["Article", 34], ["Unité", 10], ["Théorique (ventes)", 16], ["Pertes déclarées", 16], ["Écart d'inventaire", 16], ["Réelle", 14], ["Écart réel − théorique", 22, MONEY], ["Écart (%)", 12, PCTF]]);
  for (const c of r.consumption) co.addRow([c.name, c.unit, c.sold, c.losses, c.inventoryGap, c.real, c.varianceValue, c.variancePct === null ? null : c.variancePct / 100]);
  const sk = sheet(`Stock au ${stockDate}`, [["Article", 34], ["Famille", 18], ["Unité", 10], ["Réserve", 12], ["Comptoir", 12], ["Coût unitaire (CMUP)", 18, MONEY], ["Valeur", 18, MONEY]]);
  for (const s of stock) sk.addRow([s.name, s.category ?? "", s.unit, s.reserve, s.desk, s.unitCost, s.value]);
  sk.addRow(["Total", "", "", "", "", null, stock.reduce((t2, s) => t2 + s.value, 0)]).font = { bold: true };
  const mn = sheet("Analyse de la carte", [["Famille", 18], ["Article", 34], ["Vendus", 10], ["Part des ventes de la famille", 16, PCTF], ["Marge unitaire HT", 18, MONEY], ["Classe", 16], ["Conseil", 60]]);
  for (const m of menu) mn.addRow([m.category ?? "", m.name, m.quantity, m.mix / 100, m.unitMargin, MENU_LABELS[m.class].label, MENU_LABELS[m.class].advice]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
