/**
 * Vérification de la logique du module Restauration contre la base de TEST,
 * sans serveur compilé : les fonctions serveur sont appelées directement
 * (réserve, approvisionnement, ventes, pertes, inventaires, résultat, prix,
 * vue d'ensemble, inventaire de fin de semaine, verrou du mois clos, fiches
 * techniques, production, achats et rapprochement, planning et pointage,
 * pilotage, hygiène, transferts entre restaurants).
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
import { priceHistory, toInvoice, markInvoiced } from "../../lib/restaurant-purchasing";
import { upsertShift, clock, deleteShift, weekPlanning, monthLabor } from "../../lib/restaurant-staff";
import { validateStaff } from "../../lib/restaurant-team";
import { SupplierModel } from "../../models/Supplier";
import { FixedAssetModel } from "../../models/FixedAsset";
import { pilotage, saveBudget, saveAllocation, linkAsset, weeklyReport } from "../../lib/restaurant-pilotage";
import { volumeSimulation } from "../../lib/restaurant";
import { sendTransfer, receiveTransfer, getTransfer } from "../../lib/restaurant-transfer";
import { saveStanding, standingDay, confirmStanding, payStanding, startGasBottle } from "../../lib/restaurant-standing";
import { saveHygieneSetup, recordTemperature, receiveControlled, recordSample, discardSample, recordCleaning, hygieneOverview, itemLots, traceLot } from "../../lib/restaurant-hygiene";
import { StaffShiftModel } from "../../models/StaffShift";
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

  console.log("\n▶ Achats : historique, comparaison, rapprochement, réassort");
  const fA = await SupplierModel.create({ tenantId, code: "FRS-LOG-A", name: "Grossiste Oignons" });
  await receiveInReserve(auth, deskId, [{ itemId: String(oignon._id), quantity: 5, unitCost: 380 }], { supplierId: String(fA._id), reference: "BL-A1" });
  await receiveInReserve(auth, deskId, [{ itemId: String(oignon._id), quantity: 5, unitCost: 450 }], { supplier: "Marché", reference: "BL-M1" });
  const ph = (await priceHistory(tenantId, deskId)).find(x => x.itemId === String(oignon._id));
  check("historique : dernier prix 450 (Marché), le moins cher est le fournisseur du référentiel", ph?.last.unitCost === 450 && ph.last.supplier === "Marché" && ph.best === "Grossiste Oignons" && ph.suppliers[0].avg === 380, ph);
  const ti = await toInvoice(tenantId, deskId);
  const mine = ti.receptions.filter(x => x.reference === "BL-A1" || x.reference === "BL-M1");
  check("à rapprocher : les deux réceptions non payées en caisse, pas celle payée en caisse", mine.length === 2 && !ti.receptions.some(x => x.reference === "BL-1"), ti.receptions.map(x => x.reference));
  const mk1 = await markInvoiced(auth, deskId, mine.filter(x => x.reference === "BL-A1").map(x => x._id), "FAC-A-001");
  check("rapprochement d'une facture : la réception sort de la liste", mk1.matched === 1 && !(await toInvoice(tenantId, deskId)).receptions.some(x => x.reference === "BL-A1"));
  check("rapprochement sans numéro de facture : refusé", await refuses(() => markInvoiced(auth, deskId, [mine[0]._id], " "), /facture/i));
  check("inventaire ordinaire : pas de réassort proposé", v1.proposal === null);
  const huile = await mk({ name: "Huile", unit: "L", category: "Épicerie", unitCost: 1200, threshold: 20 });
  await receiveInReserve(auth, deskId, [{ itemId: String(huile._id), quantity: 2, unitCost: 1200 }], {});
  await DeskInventoryModel.updateMany({ tenantId, deskId, status: "open" }, { $set: { status: "cancelled" } });
  const wInv = await openInventory(auth, deskId, "reserve", undefined, false, true);
  await saveCounts(auth, String(wInv._id), "A", [{ itemId: String(huile._id), counted: 2 }]);
  const wv = await validateInventory(auth, String(wInv._id));
  check("inventaire du samedi : réassort proposé aussitôt (huile sous le seuil)", !!wv.proposal && wv.proposal.orders + wv.proposal.shopping + wv.proposal.noSupplier >= 1, wv.proposal);

  console.log("\n▶ Personnel : affectation datée, planning, pointage, repas");
  const y = now.getFullYear(), mo = now.getMonth() + 1, mm = String(mo).padStart(2, "0"), dim = new Date(y, mo, 0).getDate();
  await ActivityDeskModel.updateOne({ _id: desk._id }, { $set: { staff: [{ employeeId: emp.insertedId, share: 1, from: `${y}-${mm}-16` }] } });
  const rDated = await deskMonthResult(tenantId, deskId, month);
  const expected = Math.round(120_000 * (dim - 15) / dim);
  check(`affectation à partir du 16 : ${dim - 15} jours sur ${dim} du coût employeur (${expected})`, near(rDated.pnl.charges.find(x => x.category === "personnel")?.actual ?? 0, expected), rDated.pnl.charges.find(x => x.category === "personnel"));
  check("même personne sur deux périodes qui se chevauchent : refusé", await refuses(() => validateStaff(tenantId, deskId, [{ employeeId: String(emp.insertedId), share: 1, from: `${y}-${mm}-01`, to: `${y}-${mm}-20` }, { employeeId: String(emp.insertedId), share: 1, from: `${y}-${mm}-10` }]), /chevauchent/));
  const okTwo = await validateStaff(tenantId, deskId, [{ employeeId: String(emp.insertedId), share: 1, from: `${y}-${mm}-01`, to: `${y}-${mm}-09` }, { employeeId: String(emp.insertedId), share: 1, from: `${y}-${mm}-16` }]);
  check("même personne sur deux périodes successives : accepté", okTwo.length === 2);
  check("fin d'affectation avant son début : refusé", await refuses(() => validateStaff(tenantId, deskId, [{ employeeId: String(emp.insertedId), share: 1, from: `${y}-${mm}-10`, to: `${y}-${mm}-01` }]), /avant/));
  await upsertShift(auth, deskId, { employeeId: String(emp.insertedId), day, service: "midi", start: "10:00", end: "15:00" });
  await upsertShift(auth, deskId, { employeeId: String(emp.insertedId), day, service: "soir", start: "18:00", end: "23:00" });
  const wp = await weekPlanning(tenantId, deskId, day);
  const sMidi = wp.shifts.find(x => x.service === "midi")!, sSoir = wp.shifts.find(x => x.service === "soir")!;
  check("planning : deux postes de 5 h, la cuisinière dans l'équipe de la semaine", sMidi?.plannedHours === 5 && !!sSoir && wp.team.some(t => t.employeeId === String(emp.insertedId)), wp);
  const tIn = new Date(`${day}T10:15:00`);
  await clock(auth, deskId, sMidi._id, "in", tIn);
  await clock(auth, deskId, sMidi._id, "out", new Date(tIn.getTime() + 4.5 * 3_600_000));
  check("pointage : départ avant arrivée, double arrivée, absence après arrivée — refusés",
    await refuses(() => clock(auth, deskId, sSoir._id, "out"), /arrivée/) && await refuses(() => clock(auth, deskId, sMidi._id, "in"), /déjà/) && await refuses(() => clock(auth, deskId, sMidi._id, "absent"), /pointé/));
  check("poste pointé : ne se supprime plus", await refuses(() => deleteShift(auth, deskId, sMidi._id), /pointé/));
  await clock(auth, deskId, sSoir._id, "absent");
  check("conflit : même collaborateur au même service dans un autre restaurant — refusé", await (async () => {
    const other = await ActivityDeskModel.create({ tenantId, name: "Autre restaurant", activityId: sector._id, treasuryAccountId: caisse._id, revenueAccount: "706300", vatRate: 0, createdBy: admin._id });
    return refuses(() => upsertShift(auth, String(other._id), { employeeId: String(emp.insertedId), day, service: "midi", start: "10:00", end: "15:00" }), /autre restaurant/);
  })());
  await withTransaction(s => recordLoss(auth, { deskId, itemId: String(coca._id), quantity: 1, reason: "staff", employeeId: String(emp.insertedId) }, s));
  check("repas du personnel rattaché à un collaborateur inconnu : refusé", await refuses(() => withTransaction(s => recordLoss(auth, { deskId, itemId: String(coca._id), quantity: 1, reason: "staff", employeeId: String(new Types.ObjectId()) }, s)), /introuvable/));
  const lab = await monthLabor(tenantId, deskId, month, true);
  const pe = lab.people.find(x => x.employeeId === String(emp.insertedId))!;
  const rate = 120_000 / 173.33;
  check("heures du mois : 10 h prévues, 4,5 h réelles (absence au soir), 1 absence", pe?.plannedHours === 10 && pe.realHours === 4.5 && pe.absences === 1, pe);
  check(`coût horaire ${Math.round(rate)} et coût du midi ${Math.round(rate * 4.5)}`, pe.hourlyCost === Math.round(rate) && near(pe.cost ?? 0, Math.round(rate * 4.5)) && near(lab.services.find(x => x.service === "midi")?.cost ?? 0, Math.round(rate * 4.5)), { pe, s: lab.services });
  check("repas du personnel : 1 repas valorisé au coût, rattaché à la cuisinière", pe.staffMeals?.count === 1 && (pe.staffMeals?.value ?? 0) > 0, pe.staffMeals);
  const labNo = await monthLabor(tenantId, deskId, month, false);
  check("sans droit paie : heures visibles, coûts et repas masqués", labNo.people[0]?.realHours === 4.5 && !("cost" in labNo.people[0]) && !("staffMeals" in labNo.people[0]) && !("cost" in (labNo.services[0] ?? {})));
  await StaffShiftModel.deleteMany({ tenantId, deskId });

  console.log("\n▶ Pilotage : répartition, amortissements, budget, simulation, rapport du lundi");
  const other = await ActivityDeskModel.findOne({ tenantId, name: "Autre restaurant" }).select("_id").lean<{ _id: Types.ObjectId }>();
  check("clé de répartition partielle (un seul comptoir sur deux) : refusée", await refuses(() => saveAllocation(auth, deskId, { shares: [{ deskId, share: 0.7 }] }), /chaque comptoir/));
  check("clé de répartition au-delà de 100 % : refusée", await refuses(() => saveAllocation(auth, deskId, { shares: [{ deskId, share: 0.8 }, { deskId: String(other!._id), share: 0.3 }] }), /dépassent/));
  await saveAllocation(auth, deskId, { shares: [{ deskId, share: 0.7 }, { deskId: String(other!._id), share: 0.3 }] });
  const rAlloc = await deskMonthResult(tenantId, deskId, month);
  check("électricité du secteur partagé : 70 % de 30 000 = 21 000", rAlloc.pnl.charges.find(x => x.category === "electricite")?.actual === 21_000, rAlloc.pnl.charges.find(x => x.category === "electricite"));
  const four = await FixedAssetModel.create({ tenantId, code: "IMMO-LOG-1", name: "Four mixte", category: "equipment", acquisitionDate: new Date("2025-01-01"), acquisitionCost: 1_200_000, usefulLifeYears: 5, depreciationMethod: "linear", status: "active" });
  await linkAsset(auth, deskId, String(four._id), true);
  check("équipement déjà rattaché : second rattachement refusé", await refuses(() => linkAsset(auth, String(other!._id), String(four._id), true), /déjà rattaché/));
  const expDep = Math.round(1_200_000 * dim / ((Date.UTC(2030, 0, 1) - Date.UTC(2025, 0, 1)) / 86_400_000));
  const rDep = await deskMonthResult(tenantId, deskId, month);
  check(`dotation du mois du four : 1 200 000 × ${dim} j ÷ 1 826 j = ${expDep}`, rDep.pnl.charges.find(x => x.category === "amortissements")?.actual === expDep, rDep.pnl.charges.find(x => x.category === "amortissements"));
  check("budget : onze mois au lieu de douze — refusé", await refuses(() => saveBudget(auth, deskId, y, { revenue: Array(11).fill(100_000), materialPct: 0.35, charges: [] }), /douze/));
  await saveBudget(auth, deskId, y, { revenue: Array(12).fill(120_000), materialPct: 0.35, charges: [{ category: "electricite", annual: 240_000 }, { category: "personnel", annual: 600_000 }] });
  const pil = await pilotage(tenantId, deskId, month, true, true);
  const bm = pil.months[mo - 1];
  check("budget du mois : 120 000 de CA, 78 000 de marge matière, 70 000 de charges, résultat 8 000", bm.budget?.revenueHT === 120_000 && bm.budget.materialMargin === 78_000 && bm.budget.charges === 70_000 && bm.budget.result === 8_000, bm.budget);
  check("réel du mois face au budget, cumul de l'année", bm.actual?.result === rDep.pnl.result && pil.ytd?.budgetRevenue === 120_000 * mo, { a: bm.actual, ytd: pil.ytd });
  check("pilotage : équipement listé avec sa dotation", pil.assets.some(a => a.name === "Four mixte" && a.monthly === expDep));
  const sim = volumeSimulation(rDep.pnl);
  const cvr = (rDep.pnl.revenueHT - sim.variable) / rDep.pnl.revenueHT;
  check("simulation : fixes + variables = coûts totaux, point mort = fixes ÷ taux de marge sur coûts variables",
    near(sim.variable + sim.fixed, rDep.pnl.revenueHT - rDep.pnl.result) && (sim.breakEvenRevenue === null ? cvr <= 0 : near(sim.breakEvenRevenue, Math.round(sim.fixed / cvr))), sim);
  check("simulation : à volume −10 %, résultat = CA × 0,9 × taux − fixes", near(sim.scenarios[0].result, Math.round(rDep.pnl.revenueHT * 0.9 * cvr - sim.fixed)), sim.scenarios[0]);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((8 - now.getDay()) % 7 || 7));
  const wr = await weeklyReport(tenantId, deskId, monday, true);
  check("rapport du lundi : la semaine écoulée compte les ventes du test", wr.week.tickets >= 1 && wr.week.revenueHT > 0 && wr.week.losses > 0, wr.week);
  const runRep = await (AUTOMATION_RUNNERS as Record<string, (n?: Date) => Promise<string>>).runRestaurantReport(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 8));
  check("rapport du lundi envoyé, une fois par semaine", /envoyé/.test(runRep) && !/envoyé/.test(await (AUTOMATION_RUNNERS as Record<string, (n?: Date) => Promise<string>>).runRestaurantReport(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 9))), runRep);
  check("pas lundi : aucun rapport", /pas lundi/.test(await (AUTOMATION_RUNNERS as Record<string, (n?: Date) => Promise<string>>).runRestaurantReport(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 1, 8))));

  console.log("\n▶ Hygiène : températures, réception, plats témoins, nettoyage, traçabilité");
  await saveHygieneSetup(auth, deskId, { coldUnits: [{ name: "Frigo cuisine", kind: "fridge" }, { name: "Congélateur", kind: "freezer", max: -20 }], cleaningTasks: [{ zone: "Cuisine", task: "Plans de travail", frequency: "daily" }] });
  let hy = await hygieneOverview(tenantId, deskId, day);
  const frigo = hy.units.find(u => u.name === "Frigo cuisine")!, congel = hy.units.find(u => u.name === "Congélateur")!;
  check("enceintes : repères par défaut (0 à +4 °C) et limite propre (−20 °C)", frigo.min === 0 && frigo.max === 4 && congel.max === -20, hy.units);
  const t1 = await recordTemperature(auth, deskId, frigo._id, 3), t2 = await recordTemperature(auth, deskId, frigo._id, 7, "Porte mal fermée, denrées déplacées"), t3 = await recordTemperature(auth, deskId, congel._id, -18);
  check("relevés : 3 °C conforme, 7 °C et −18 °C (limite −20) hors limites", t1.ok && !t2.ok && !t3.ok);
  check("enceinte inconnue : refusée", await refuses(() => recordTemperature(auth, deskId, String(new Types.ObjectId()), 3), /introuvable/));
  const poulet = await mk({ name: "Poulet", unit: "kg", category: "Viandes", unitCost: 2500 });
  const crev = await mk({ name: "Crevettes", unit: "kg", category: "Poissons", unitCost: 6000 });
  await withTransaction(s => ensureLinked(auth, deskId, crev._id, s));
  check("produit réfrigéré sans température relevée : réception refusée", await refuses(() => receiveControlled(auth, deskId, [{ itemId: String(poulet._id), quantity: 5, unitCost: 2500 }], {}, { chain: "chilled", temperature: null }), /température/));
  check("ligne refusée sans motif : réception refusée", await refuses(() => receiveControlled(auth, deskId, [{ itemId: String(crev._id), quantity: 2, refused: true }], {}, { chain: "chilled", temperature: 3 }), /motif/));
  const rc = await receiveControlled(auth, deskId, [{ itemId: String(poulet._id), quantity: 5, unitCost: 2500, lotNumber: "LOT-P1" }, { itemId: String(crev._id), quantity: 2, unitCost: 6000, refused: true, reason: "odeur, 9 °C" }], { supplier: "Ferme X", reference: "BL-P1" }, { chain: "chilled", temperature: 3 });
  check("réception contrôlée : poulet en réserve, crevettes refusées hors stock, contrôle non conforme noté", (await row(poulet._id)).reserve === 5 && (await row(crev._id)).reserve === 0 && rc.control?.ok === false && rc.control.tempOk === true, { p: (await row(poulet._id)).reserve, c: (await row(crev._id)).reserve, rc: rc.control });
  const allRefused = await receiveControlled(auth, deskId, [{ itemId: String(crev._id), quantity: 1, refused: true, reason: "date dépassée" }], {}, null);
  check("tout refusé : rien n'entre en stock, le refus est noté", allRefused.received === null && allRefused.control?.ok === false && (await row(crev._id)).reserve === 0);
  await recordCleaning(auth, deskId, hy.tasks[0]._id);
  await recordSample(auth, deskId, String(sauce._id), "midi", day);
  hy = await hygieneOverview(tenantId, deskId, day);
  check("registre du jour : 3 relevés, tâche faite, plat témoin à garder 5 jours, 2 réceptions non conformes", hy.units.reduce((t, u) => t + u.readings.length, 0) === 3 && hy.tasks[0].done === 1 && hy.samples.length === 1 && !hy.samples[0].toDiscard && hy.receptions.filter(r => !r.ok).length === 2, hy);
  const late = await hygieneOverview(tenantId, deskId, day, new Date(Date.now() + 6 * 86_400_000));
  check("plat témoin au-delà de 5 jours : à jeter", late.samples[0]?.toDiscard === true);
  await discardSample(auth, deskId, hy.samples[0]._id);
  check("plat témoin jeté : sort de la garde, second « jeté » refusé", (await hygieneOverview(tenantId, deskId, day)).samples.length === 0 && await refuses(() => discardSample(auth, deskId, hy.samples[0]._id), /déjà/));
  await moveBetweenLevels(auth, deskId, [{ itemId: String(poulet._id), quantity: 2 }], "supply");
  const braise = await mk({ name: "Poulet braisé", unit: "assiette", category: "Plats", salePrice: 2500, recipe: [{ itemId: poulet._id, quantity: 0.25 }] });
  await withTransaction(s => createSale(auth, { deskId, payments: [], payMethod: "cash", lines: [{ itemId: String(braise._id), quantity: 4 }] }, s));
  const pl = await itemLots(tenantId, deskId, String(poulet._id));
  check("lots du poulet : LOT-P1 connu, 4 kg encore en stock (3 réserve + 1 comptoir)", pl.some(l => l.lotNumber === "LOT-P1" && near(l.inStock * 1000, 4000)), pl);
  const tr = await traceLot(tenantId, deskId, String(poulet._id), "LOT-P1");
  const dish = tr.dishes.find(x => x.label === "Poulet braisé");
  check("traçabilité : LOT-P1 reçu (BL-P1), monté au comptoir, vendu dans 4 « Poulet braisé »", tr.movements.some(m => m.type === "entry") && tr.movements.some(m => m.type === "transfer") && dish?.quantity === 4 && tr.tickets.length === 1, tr);

  console.log("\n▶ Transferts entre restaurants");
  const sigPng = `data:image/png;base64,${"iVBORw0KGgo".padEnd(400, "A")}=`;
  const otherId = String(other!._id);
  check("transfert sans signature : refusé", await refuses(() => sendTransfer(auth, deskId, otherId, [{ itemId: String(poulet._id), quantity: 1 }], { name: "Awa", signature: "" }), /signature/i));
  check("transfert vers le même restaurant : refusé", await refuses(() => sendTransfer(auth, deskId, deskId, [{ itemId: String(poulet._id), quantity: 1 }], { name: "Awa", signature: sigPng }), /autre restaurant/));
  check("transfert d'une préparation : refusé", await refuses(() => sendTransfer(auth, deskId, otherId, [{ itemId: String(braise._id), quantity: 1 }], { name: "Awa", signature: sigPng }), /préparation/));
  check("transfert au-delà de la réserve : refusé", await refuses(() => sendTransfer(auth, deskId, otherId, [{ itemId: String(poulet._id), quantity: 50 }], { name: "Awa", signature: sigPng }), /insuffisant|disponible/i));
  const tr1 = await sendTransfer(auth, deskId, otherId, [{ itemId: String(poulet._id), quantity: 1 }], { name: "Awa Cuisine", signature: sigPng }, "Dépannage");
  const otherRows = (await restaurantStock(tenantId, otherId, true)).rows;
  const op = otherRows.find(r => r.name === "Poulet");
  const tdoc = await getTransfer(tenantId, tr1._id, true) as unknown as { value: number; status: string; lines: Array<{ lots: Array<{ lotNumber: string }> }> };
  check("transfert : 1 kg sorti de la réserve d'origine, entré dans celle du destinataire (article créé, même produit)", (await row(poulet._id)).reserve === 2 && op?.reserve === 1, { from: (await row(poulet._id)).reserve, op });
  check("bon : lot LOT-P1 conservé, valeur au coût 2 500, à réceptionner", tdoc.lines[0].lots[0]?.lotNumber === "LOT-P1" && tdoc.value === 2500 && tdoc.status === "sent", tdoc);
  check("réception signée par un autre restaurant que le destinataire : refusée", await refuses(() => receiveTransfer(auth, tr1._id, async id => id !== otherId, { name: "Moussa", signature: sigPng }), /destinataire/));
  await receiveTransfer(auth, tr1._id, async id => id === otherId, { name: "Moussa", signature: sigPng }, "RAS");
  check("réception signée ; seconde signature refusée", (await getTransfer(tenantId, tr1._id, true) as unknown as { status: string }).status === "received" && await refuses(() => receiveTransfer(auth, tr1._id, async () => true, { name: "Moussa", signature: sigPng }), /déjà/));
  await sendTransfer(auth, deskId, otherId, [{ itemId: String(poulet._id), quantity: 0.5 }], { name: "Awa Cuisine", signature: sigPng });
  check("second transfert : même article destinataire réutilisé (pas de doublon)", (await restaurantStock(tenantId, otherId, true)).rows.filter(r => r.name === "Poulet").length === 1 && near(((await restaurantStock(tenantId, otherId, true)).rows.find(r => r.name === "Poulet")?.reserve ?? 0) * 1000, 1500));

  console.log("\n▶ Pain du jour payé le soir, rythme des articles, gaz");
  const pain = await mk({ name: "Pain", unit: "baguette", category: "Boulangerie", unitCost: 100 });
  const qs = [0, 80, 80, 80, 80, 80, 40];
  await saveStanding(auth, deskId, [{ itemId: String(pain._id), supplierName: "Boulangerie du campus", unitCost: 100, quantities: qs, dailyFee: 500, toDesk: true }]);
  const sd0 = await standingDay(tenantId, deskId, day, true);
  const bread = sd0[0];
  check("livraison du jour attendue selon le jour de la semaine, ni reçue ni payée", bread?.expected === qs[now.getDay()] && bread.received === null && !bread.paid, sd0);
  check("paiement avant réception : refusé", await refuses(() => payStanding(auth, deskId, bread._id, day), /Confirmez/));
  const cashBefore = await ActivityCashEntryModel.countDocuments({ tenantId, deskId, direction: "out" });
  const resBefore = await deskMonthResult(tenantId, deskId, month);
  await confirmStanding(auth, deskId, bread._id, day, 75);
  check("réception du matin (75 corrigées) : montées au comptoir, aucune sortie de caisse", (await row(pain._id)).desk === 75 && (await ActivityCashEntryModel.countDocuments({ tenantId, deskId, direction: "out" })) === cashBefore);
  check("seconde réception du même jour : refusée", await refuses(() => confirmStanding(auth, deskId, bread._id, day), /déjà reçue/));
  const paid = await payStanding(auth, deskId, bread._id, day);
  const outs = await ActivityCashEntryModel.find({ tenantId, deskId, direction: "out", label: new RegExp(paid.reference) }).lean<Array<{ amount: number; category: string; entryId?: unknown }>>();
  check("paiement du soir : 7 500 de pain (achat) + 500 de livraison (transport), passés en comptabilité", paid.total === 8_000 && outs.length === 2 && outs.some(o => o.category === "purchase" && o.amount === 7_500) && outs.some(o => o.category === "transport" && o.amount === 500) && outs.every(o => o.entryId), outs);
  check("second paiement du même jour : refusé", await refuses(() => payStanding(auth, deskId, bread._id, day), /déjà payée/));
  const resAfter = await deskMonthResult(tenantId, deskId, month);
  // Le secteur de ce restaurant est partagé (clé 70 % fixée plus haut) : il porte 70 % des frais de livraison.
  const dTransport = (resAfter.pnl.charges.find(c => c.category === "transport")?.actual ?? 0) - (resBefore.pnl.charges.find(c => c.category === "transport")?.actual ?? 0);
  check("résultat : le pain n'est pas compté comme consommé (seulement à la vente) ; la livraison entre en transport (70 % de 500)", resAfter.pnl.cashPurchases === resBefore.pnl.cashPurchases && near(dTransport, 350), { a: resAfter.pnl.cashPurchases, b: resBefore.pnl.cashPurchases, dTransport });
  check("pain payé en caisse : hors du rapprochement des factures", !(await toInvoice(tenantId, deskId)).receptions.some(r => r.reference === paid.reference));
  await ActivityItemModel.updateOne({ _id: riz._id }, { $set: { rhythm: "month" } });
  await ActivityItemModel.updateOne({ _id: coca._id }, { $set: { rhythm: "week" } });
  await DeskInventoryModel.updateMany({ tenantId, deskId, status: "open" }, { $set: { status: "cancelled" } });
  const wk2 = await openInventory(auth, deskId, "desk", undefined, false, true);
  const hasRiz = wk2.lines.some((l: { itemId: unknown }) => String(l.itemId) === String(riz._id)), hasCoca = wk2.lines.some((l: { itemId: unknown }) => String(l.itemId) === String(coca._id));
  check(`inventaire du samedi : le riz (mensuel) ${now.getDate() <= 7 ? "compté (première semaine)" : "pas compté"}, le coca (hebdomadaire) compté`, hasCoca && hasRiz === (now.getDate() <= 7), { hasRiz, hasCoca });
  await DeskInventoryModel.updateMany({ tenantId, deskId, status: "open" }, { $set: { status: "cancelled" } });
  await startGasBottle(auth, deskId);
  check("bouteille de gaz : seconde mise en service dans l'heure refusée", await refuses(() => startGasBottle(auth, deskId), /deux heures/));
  const pg = await pilotage(tenantId, deskId, month, true, true);
  check("pilotage : gaz du mois et bouteille comptée", pg.gas.bottlesInMonth === 1 && typeof pg.gas.spend === "number", pg.gas);

  console.log(`\n${pass} réussis, ${fail} en échec`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async e => { console.error(e); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
