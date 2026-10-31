/**
 * Vérification de la logique du module Restauration contre la base de TEST,
 * sans serveur compilé : les fonctions serveur sont appelées directement
 * (réserve, approvisionnement, ventes, pertes, inventaires, résultat, prix,
 * vue d'ensemble, inventaire de fin de semaine, verrou du mois clos).
 * Complète le scénario HTTP e2e-restaurant.mjs, qui exige une compilation.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27099/kanoo_e2e?directConnection=true npx tsx scripts/e2e/restaurant-logic.ts
 */
import mongoose, { Types } from "mongoose";
import { withTransaction } from "../../lib/db";
import { actAs } from "../../lib/cron-helpers";
import { nextLedgerCode, registerLedgerAccount } from "../../lib/treasury";
import { createSale } from "../../lib/comptoir-sale";
import { postDeskCash } from "../../lib/comptoir";
import { recordLoss } from "../../lib/spot-server";
import { receiveInReserve, moveBetweenLevels, reserveLoss, restaurantStock, ensureLinked } from "../../lib/restaurant-stock";
import { openInventory, saveCounts, validateInventory } from "../../lib/restaurant-inventory";
import { deskMonthResult, maskPayroll } from "../../lib/restaurant-result";
import { deskPricing, restaurantOverview } from "../../lib/restaurant-overview";
import { AUTOMATION_RUNNERS } from "../../lib/automation-jobs";
import { dayPlan, saveMenu, issueForDay, closeService } from "../../lib/restaurant-production";
import { UserModel } from "../../models/User";
import { ActivityModel } from "../../models/Activity";
import { ActivityDeskModel } from "../../models/ActivityDesk";
import { ActivityItemModel } from "../../models/ActivityItem";
import { ActivityCashEntryModel } from "../../models/ActivityCashEntry";
import { TreasuryAccountModel } from "../../models/TreasuryAccount";
import { ProductModel } from "../../models/Product";
import { AccountingEntryModel } from "../../models/AccountingEntry";
import { EmployeeModel } from "../../models/Employee";
import { PayslipModel } from "../../models/Payslip";
import { DeskMonthCloseModel } from "../../models/DeskMonthClose";
import { DeskInventoryModel } from "../../models/DeskInventory";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, extra: unknown = "") => { if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${typeof extra === "string" ? extra : JSON.stringify(extra)}`); } };
const near = (a: number, b: number) => Math.abs(a - b) <= 1;
const refuses = async (fn: () => Promise<unknown>, re: RegExp) => { try { await fn(); return false; } catch (e) { return re.test(e instanceof Error ? e.message : String(e)); } };

async function main() {
  const uri = process.env.MONGODB_URI ?? "";
  if (!/e2e|test/.test(uri)) throw new Error("MONGODB_URI doit désigner une base de test.");
  await mongoose.connect(uri);
  const admin = await UserModel.findOne({ email: "admin@test.ne" }).select("_id tenantId").lean<{ _id: Types.ObjectId; tenantId: Types.ObjectId }>();
  if (!admin) throw new Error("Base non ensemencée (admin@test.ne absent).");
  const auth = (await actAs(admin._id))!.auth;
  const tenantId = String(admin.tenantId);
  const now = new Date(), month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Comptoir relié à un secteur et à une caisse.
  const sector = await ActivityModel.create({ tenantId, name: "Restaurant logique", createdBy: admin._id });
  const caisse = await withTransaction(async s => {
    const ledgerCode = await nextLedgerCode(tenantId, "cash", s);
    const [a] = await TreasuryAccountModel.create([{ tenantId, label: "Caisse restaurant logique", type: "cash", currency: "XOF", openingBalance: 0, openingDate: new Date("2025-01-01"), ledgerCode }], { session: s });
    await registerLedgerAccount(tenantId, ledgerCode, "Caisse restaurant logique", s);
    return a;
  });
  const desk = await ActivityDeskModel.create({ tenantId, name: "Restaurant logique", activityId: sector._id, treasuryAccountId: caisse._id, revenueAccount: "706300", vatRate: 0, createdBy: admin._id });
  const deskId = String(desk._id);
  const mk = (b: Record<string, unknown>) => ActivityItemModel.create({ tenantId, deskId, createdBy: admin._id, quantity: 0, ...b });
  const coca = await mk({ name: "Coca 33 cl", unit: "canette", category: "Boissons", salePrice: 500, threshold: 10, pack: { label: "carton", size: 24, cost: 7200 } });
  const riz = await mk({ name: "Riz", unit: "kg", category: "Épicerie", unitCost: 600 });
  const plat = await mk({ name: "Riz au gras", unit: "assiette", category: "Plats", salePrice: 1000, recipe: [{ itemId: riz._id, quantity: 0.2 }] });
  const lv = async () => (await restaurantStock(tenantId, deskId, true)).rows;
  const row = async (id: unknown) => (await lv()).find(r => r.itemId === String(id))!;

  console.log("\n▶ Réserve et comptoir");
  const rec = await receiveInReserve(auth, deskId, [{ itemId: String(coca._id), packs: 3, packCost: 7200 }, { itemId: String(riz._id), quantity: 25, unitCost: 600 }], { supplier: "Grossiste", reference: "BL-1", paidFromCash: true });
  check("réception : 3 cartons = 72 canettes et 25 kg en réserve, 36 600 payés en caisse", (await row(coca._id)).reserve === 72 && (await row(riz._id)).reserve === 25 && rec.total === 36_600);
  const p = await ProductModel.findOne({ _id: (await ActivityItemModel.findById(coca._id).lean<{ productId: Types.ObjectId }>())!.productId }).lean<{ tvaRate?: number; trackingMode?: string; code: string }>();
  check("fiche catalogue RST- au taux du comptoir, suivie par lot", p?.tvaRate === 0 && p.trackingMode === "lot" && p.code.startsWith("RST-"), p);
  await moveBetweenLevels(auth, deskId, [{ itemId: String(coca._id), packs: 1 }, { itemId: String(riz._id), quantity: 5 }], "supply");
  check("approvisionnement : 24 canettes et 5 kg montés au comptoir", (await row(coca._id)).desk === 24 && (await row(coca._id)).reserve === 48 && (await row(riz._id)).desk === 5);
  const rise = await receiveInReserve(auth, deskId, [{ itemId: String(coca._id), packs: 1, packCost: 8400 }], {});
  check("hausse du coût d'achat signalée (+16,7 %)", rise.alerts[0]?.pct >= 16, rise.alerts);
  check("monter plus que la réserve : refusé", await refuses(() => moveBetweenLevels(auth, deskId, [{ itemId: String(coca._id), quantity: 999 }], "supply"), /insuffisant|disponible/i));
  const dlc = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await receiveInReserve(auth, deskId, [{ itemId: String(riz._id), quantity: 1, unitCost: 600, lotNumber: "SAC-DLC", expiryDate: dlc }], {});
  check("date de péremption gardée et signalée sous 7 jours", (await row(riz._id)).nextExpiry === dlc && (await row(riz._id)).expiringQty >= 1, await row(riz._id));

  console.log("\n▶ Ventes, pertes, inventaires");
  await withTransaction(s => createSale(auth, { deskId, payments: [], payMethod: "cash", lines: [{ itemId: String(coca._id), quantity: 20 }, { itemId: String(plat._id), quantity: 10 }] }, s));
  check("vente : 20 canettes et 2 kg de riz (recette) sortis du comptoir", (await row(coca._id)).desk === 4 && near((await row(riz._id)).desk * 1000, 3000));
  await withTransaction(s => recordLoss(auth, { deskId, itemId: String(plat._id), quantity: 1, reason: "unsold" }, s));
  check("invendu d'un plat : 0,2 kg de riz sorti", near((await row(riz._id)).desk * 1000, 2800));
  check("écart d'inventaire déclaré à la main : refusé", await refuses(() => withTransaction(s => recordLoss(auth, { deskId, itemId: String(coca._id), quantity: 1, reason: "inventory" }, s)), /inventaire/i));
  const inv = await openInventory(auth, deskId, "desk");
  check("second inventaire du comptoir ouvert en même temps : refusé", await refuses(() => openInventory(auth, deskId, "desk"), /déjà ouvert/));
  await saveCounts(auth, String(inv._id), "A", [{ itemId: String(coca._id), counted: 2 }, { itemId: String(riz._id), counted: 2.8 }]);
  await saveCounts(auth, String(inv._id), "B", [{ itemId: String(coca._id), counted: 1 }]);
  const mid = await DeskInventoryModel.findById(inv._id).lean<{ lines: Array<{ itemId: Types.ObjectId; counted?: number }> }>();
  check("deux appareils : comptages additionnés (2 + 1)", mid!.lines.find(l => String(l.itemId) === String(coca._id))?.counted === 3);
  await withTransaction(s => createSale(auth, { deskId, payments: [], payMethod: "cash", lines: [{ itemId: String(coca._id), quantity: 1 }] }, s));
  const v1 = await validateInventory(auth, String(inv._id));
  const cl = v1.lines.find(l => String(l.itemId) === String(coca._id));
  check("validation : manquant d'une canette, la vente faite pendant le comptage ne compte pas", cl?.gap === -1 && (cl.gapValue ?? 0) < 0 && (await row(coca._id)).desk === 2, { cl, desk: (await row(coca._id)).desk });
  check("double validation : refusée", await refuses(() => validateInventory(auth, String(inv._id)), /déjà/));
  const invR = await openInventory(auth, deskId, "reserve");
  await saveCounts(auth, String(invR._id), "A", [{ itemId: String(coca._id), counted: 70 }]);
  const v2 = await validateInventory(auth, String(invR._id));
  check("inventaire de la réserve : 72 attendus, 70 comptés", v2.lines.find(l => String(l.itemId) === String(coca._id))?.gap === -2 && (await row(coca._id)).reserve === 70);
  await reserveLoss(auth, deskId, [{ itemId: String(coca._id), quantity: 2 }], "broken");
  check("perte en réserve : 2 canettes sorties", (await row(coca._id)).reserve === 68);

  console.log("\n▶ Charges, personnel, résultat");
  const [elec] = await withTransaction(async s => {
    const [c] = await ActivityCashEntryModel.create([{ tenantId, deskId, direction: "out", amount: 30_000, label: "Facture NIGELEC", method: "cash", category: "electricity", date: new Date(), createdBy: admin._id }], { session: s });
    await postDeskCash(auth, deskId, c, s);
    return [c];
  });
  const e = await AccountingEntryModel.findOne({ tenantId, "lines.accountCode": "605200", label: /NIGELEC/ }).lean<{ lines: Array<{ accountCode: string; debit: number; activityId?: Types.ObjectId }> }>();
  check("dépense d'électricité : 605200, imputée au secteur", !!elec && !!e?.lines.some(l => l.accountCode === "605200" && l.debit === 30_000 && String(l.activityId) === String(sector._id)), e?.lines);
  const emp = await EmployeeModel.collection.insertOne({ tenantId: admin.tenantId, firstName: "Awa", lastName: "Cuisine", position: "Cuisinière", isActive: true, createdAt: new Date(), updatedAt: new Date() });
  await PayslipModel.collection.insertOne({ tenantId: admin.tenantId, employeeId: emp.insertedId, month: now.getMonth() + 1, year: now.getFullYear(), grossSalary: 100_000, grossTotal: 100_000, cnssEmployee: 5_250, cnssEmployer: 16_400, netSalary: 90_000, employerCost: 120_000, createdAt: new Date(), updatedAt: new Date() });
  await ActivityDeskModel.updateOne({ _id: desk._id }, { $set: { staff: [{ employeeId: emp.insertedId, share: 0.5 }], plannedCosts: [{ category: "electricite", amount: 25_000 }], openDaysPerMonth: 25 } });
  const r = await deskMonthResult(tenantId, deskId, month);
  const ch = (c: string) => r.pnl.charges.find(x => x.category === c);
  check("CA HT : 21 canettes à 500 + 10 plats à 1 000 = 20 500", r.pnl.revenueHT === 20_500 && r.sales.tickets === 2, { ca: r.pnl.revenueHT, t: r.sales.tickets });
  check("coût des ventes au CMUP : 7 763", near(r.pnl.costOfSales, 7_763), r.pnl.costOfSales);
  check("pertes déclarées 745 et écart d'inventaire −938, comptés une fois", near(r.pnl.losses, 745) && near(r.pnl.inventoryGap, -938), { l: r.pnl.losses, g: r.pnl.inventoryGap });
  check("charges : électricité 30 000 (prévu 25 000), personnel 60 000", ch("electricite")?.actual === 30_000 && ch("electricite")?.planned === 25_000 && ch("personnel")?.actual === 60_000, r.pnl.charges);
  check("achats payés en caisse : 601 au rapprochement (36 600), hors charges", r.reconciliation.accountingPurchases === 36_600 && !r.chargesDetail.some(c => /^60[123]/.test(c.accountCode)), r.reconciliation);
  check("résultat = marge matière − charges", r.pnl.result === r.pnl.materialMargin - r.pnl.totalCharges);
  const masked = maskPayroll(r, false);
  check("paie masquée (1 personne, sans droit paie) : résultat avant personnel, sans ratio", !masked.pnl.charges.some(c => c.category === "personnel") && masked.pnl.result === r.pnl.result + 60_000 && masked.pnl.ratios.staffCostPct === null && masked.staffDetail.length === 0);
  check("consommation : le riz du plat invendu en pertes", r.consumption.some(c => c.name === "Riz" && c.losses >= 0.2), r.consumption);

  console.log("\n▶ Prix et marges, vue d'ensemble");
  const pr = await deskPricing(tenantId, deskId);
  const pc = pr.rows.find(x => x.itemId === String(coca._id))!;
  check("prix : coût retenu = dernier prix d'achat (350) ≥ CMUP", pc.cost === 350, pc);
  // Données du test : 90 200 de charges pour 20 500 de CA (frais 440 %) — aucun prix ne peut tenir 20 %.
  check("frais supérieurs à ce que les prix peuvent couvrir : « frais trop lourds », pas de prix minimum inventé", pr.overhead.rate > 80 && pc.status === "impossible" && pc.minPriceHT === null && pr.counts.impossible, { pc, oh: pr.overhead });
  const pTarte = pr.rows.find(x => x.itemId === String(plat._id))!;
  check("recette : coût de revient = 0,2 kg de riz au coût retenu", pTarte.cost === 120, pTarte);
  check("taux provisoire (mois en cours) : application bloquée côté écran", pr.overhead.provisional === true);
  const ov = await restaurantOverview(tenantId, null, month);
  const od = ov.desks.find(x => x.deskId === deskId)!;
  check("vue d'ensemble : résultat et cible du restaurant", od.result === r.pnl.result && od.target === 20 && od.gap.targetResult === Math.round(20_500 * 0.2), od);

  console.log("\n▶ Inventaire de fin de semaine, mois clos");
  await DeskInventoryModel.updateMany({ tenantId, status: "open" }, { $set: { status: "cancelled" } });
  const sat = new Date(); sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7)); sat.setHours(15, 5, 0, 0);
  const wk = await (AUTOMATION_RUNNERS as Record<string, (n?: Date) => Promise<string>>).runWeeklyInventory(sat);
  check("samedi : inventaires du comptoir et de la réserve ouverts d'office", /ouvert/.test(wk) && (await DeskInventoryModel.countDocuments({ tenantId, deskId, status: "open" })) === 2, wk);
  await DeskInventoryModel.updateMany({ tenantId, deskId, status: "open" }, { $set: { status: "cancelled" } });
  const pm = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12), prev = `${pm.getFullYear()}-${String(pm.getMonth() + 1).padStart(2, "0")}`;
  await DeskMonthCloseModel.create({ tenantId, deskId, month: prev, status: "closed", snapshot: { result: 0 }, closedBy: admin._id, closedAt: new Date(), history: [] });
  check("mois clos : une vente datée de ce mois est refusée", await refuses(() => withTransaction(s => createSale(auth, { deskId, payments: [], payMethod: "cash", date: pm.toISOString(), lines: [{ itemId: String(coca._id), quantity: 1 }] }, s)), /clos/));
  // Liaison déjà faite : un second appel ne reprend pas le stock.
  const before = (await row(coca._id)).desk;
  await withTransaction(s => ensureLinked(auth, deskId, coca._id, s));
  check("liaison au catalogue idempotente", (await row(coca._id)).desk === before);

  console.log("\n▶ Fiches techniques, production et cuisine");
  // Sauce : recette pour 10 portions, 1 kg d'oignons nets à 80 % de rendement → 0,125 kg brut par portion.
  const oignon = await mk({ name: "Oignon", unit: "kg", category: "Légumes", unitCost: 400 });
  await receiveInReserve(auth, deskId, [{ itemId: String(oignon._id), quantity: 10, unitCost: 400 }], {});
  const sauce = await mk({ name: "Sauce oignon", unit: "portion", category: "Plats", salePrice: 300, portions: 10, recipe: [{ itemId: oignon._id, quantity: 1, yield: 0.8 }] });
  const prs = await deskPricing(tenantId, deskId);
  check("fiche technique : coût par portion = 1 kg ÷ 80 % ÷ 10 portions × 400 = 50", prs.rows.find(x => x.itemId === String(sauce._id))?.cost === 50, prs.rows.find(x => x.itemId === String(sauce._id)));
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  await saveMenu(auth, deskId, day, "midi", [{ itemId: String(sauce._id), quantity: 8 }]);
  const plan = await dayPlan(tenantId, deskId, day, true);
  const on = plan.needs.find(n => n.itemId === String(oignon._id));
  check("plan du jour : 8 portions → 1 kg d'oignons brut à monter de la réserve", near((on?.needed ?? 0) * 1000, 1000) && near((on?.toSupply ?? 0) * 1000, 1000) && plan.menuCost === 400, { on, cost: plan.menuCost });
  const iss = await issueForDay(auth, deskId, day);
  check("bon de sortie : oignons montés au comptoir", !!iss.reference && near((await row(oignon._id)).desk * 1000, 1000), { iss, desk: (await row(oignon._id)).desk });
  await withTransaction(s => createSale(auth, { deskId, payments: [], payMethod: "cash", lines: [{ itemId: String(sauce._id), quantity: 6 }] }, s));
  check("vente de 6 portions : 0,75 kg d'oignons sortis (0,125 par portion)", near((await row(oignon._id)).desk * 1000, 250), (await row(oignon._id)).desk);
  const cs = await closeService(auth, deskId, day, "midi", [{ itemId: String(sauce._id), produced: 8, leftover: 2 }]);
  check("fin de service : 2 portions restantes en perte (0,25 kg, 100 FCFA)", near((await row(oignon._id)).desk * 1000, 0) && near(cs.leftoverValue, 100), { cs, desk: (await row(oignon._id)).desk });
  check("service clos : menu non modifiable, seconde clôture refusée", await refuses(() => saveMenu(auth, deskId, day, "midi", [{ itemId: String(sauce._id), quantity: 9 }]), /clos/) && await refuses(() => closeService(auth, deskId, day, "midi", []), /clos/));

  console.log(`\n${pass} réussis, ${fail} en échec`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async e => { console.error(e); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
