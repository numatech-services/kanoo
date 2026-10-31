import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, conflict, forbidden, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { ActivityModel } from "@/models/Activity";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { isId, allDesks } from "@/lib/comptoir";
import { authCan } from "@/lib/role-resources";
import { CHARGE_CATEGORIES } from "@/lib/restaurant";
import { EmployeeModel } from "@/models/Employee";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Paramètres d'un comptoir : nom, description, secteur analytique lié, archivage,
// liaison comptable (caisse, comptes, TVA).
export const PATCH = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!isId(params.id)) return notFound("Comptoir introuvable");
  if (!allDesks(auth)) return forbidden("Seuls le chef The Spot, la comptabilité et le gérant paramètrent un comptoir.");
  const clean = sanitizeBody(await req.json().catch(() => ({})));
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};

  if ("name" in clean) {
    const name = String(clean.name || "").slice(0, 120).trim();
    if (!name) return badRequest("Le nom est requis.");
    if (await ActivityDeskModel.exists({ ...tenantFilter(auth), name, _id: { $ne: params.id } })) {
      return conflict("Un comptoir porte déjà ce nom.");
    }
    $set.name = name;
  }
  if ("description" in clean) $set.description = String(clean.description || "").slice(0, 400);
  if ("archived" in clean) $set.archived = Boolean(clean.archived);
  if ("activityId" in clean) {
    // Chaîne vide / null = détacher du secteur (la caisse retourne aux frais généraux).
    if (!clean.activityId) $unset.activityId = 1;
    else if (!isId(clean.activityId) || !(await ActivityModel.exists({ _id: clean.activityId, ...tenantFilter(auth) }))) {
      return badRequest("Secteur analytique introuvable.");
    } else if (await ActivityDeskModel.exists({ ...tenantFilter(auth), activityId: clean.activityId, archived: { $ne: true }, _id: { $ne: params.id } })) {
      // Un secteur par comptoir : sinon ses charges seraient portées par chaque comptoir.
      return badRequest("Ce secteur analytique est déjà celui d'un autre comptoir : créez un secteur propre à chaque comptoir (les charges communes se répartissent par la quote-part).");
    } else $set.activityId = clean.activityId;
  }

  // Liaison comptable : caisse de trésorerie, comptes de produit et de charge, TVA.
  if ("treasuryAccountId" in clean) {
    if (!clean.treasuryAccountId) $unset.treasuryAccountId = 1;
    else if (!isId(clean.treasuryAccountId) || !(await TreasuryAccountModel.exists({ _id: clean.treasuryAccountId, ...tenantFilter(auth) }))) {
      return badRequest("Compte de trésorerie introuvable.");
    } else $set.treasuryAccountId = clean.treasuryAccountId;
  }
  if ("revenueAccount" in clean) {
    const c = String(clean.revenueAccount || "").trim();
    if (!/^7\d{2,7}$/.test(c)) return badRequest("Compte de produit (7…) attendu.");
    $set.revenueAccount = c;
  }
  if ("expenseAccount" in clean) {
    const c = String(clean.expenseAccount || "").trim();
    if (!/^6\d{2,7}$/.test(c)) return badRequest("Compte de charge (6…) attendu.");
    $set.expenseAccount = c;
  }
  // Réassort, objectifs de la semaine, inventaire tournant.
  for (const [k, lo, hi] of [["leadDays", 0, 60], ["coverDays", 1, 90], ["cycleCountSize", 1, 50], ["weeklyRevenueTarget", 0, 1e12], ["weeklyMarginTarget", 0, 1e12]] as const) {
    if (!(k in clean)) continue;
    if (clean[k] === null || clean[k] === "") { $set[k] = undefined; continue; }
    const n = Number(clean[k]);
    if (!(n >= lo && n <= hi)) return badRequest(`Valeur invalide : ${k}.`);
    $set[k] = Math.round(n);
  }
  if ("commonCostShare" in clean) {
    const n = Number(clean.commonCostShare);
    if (!(n >= 0 && n <= 1)) return badRequest("Quote-part des charges communes : entre 0 et 100 %.");
    const total = (await ActivityDeskModel.find({ ...tenantFilter(auth), _id: { $ne: params.id }, archived: { $ne: true } }).select("commonCostShare").lean<Array<{ commonCostShare?: number }>>()).reduce((t, d) => t + (d.commonCostShare ?? 0), 0);
    if (total + n > 1.0001) return badRequest(`Les quotes-parts des comptoirs dépasseraient 100 % des charges communes (${Math.round((total + n) * 100)} %).`);
    $set.commonCostShare = Math.round(n * 1000) / 1000;
  }
  if ("lenientStock" in clean) $set.lenientStock = Boolean(clean.lenientStock);
  if ("openDaysPerMonth" in clean) {
    const n = Math.round(Number(clean.openDaysPerMonth));
    if (!(n >= 1 && n <= 31)) return badRequest("Jours d'ouverture par mois : entre 1 et 31.");
    $set.openDaysPerMonth = n;
  }
  // Personnel affecté (part de temps au comptoir) : son coût employeur entre dans le résultat du comptoir.
  if ("staff" in clean) {
    // Affecter du personnel donne accès à son coût employeur : réservé à qui gère la paie.
    if (!authCan(auth, "payslips", "read")) return forbidden("L'affectation du personnel au comptoir revient à qui gère la paie (gérant, chef comptable).");
    const raw = Array.isArray(clean.staff) ? clean.staff as Array<{ employeeId?: unknown; share?: unknown }> : [];
    const staff = raw.filter(x => isId(x.employeeId) && Number(x.share) > 0).map(x => ({ employeeId: String(x.employeeId), share: Math.min(1, Math.round(Number(x.share) * 100) / 100) }));
    if (new Set(staff.map(x => x.employeeId)).size !== staff.length) return badRequest("Un employé figure deux fois.");
    if (staff.length && (await EmployeeModel.countDocuments({ _id: { $in: staff.map(x => x.employeeId) }, ...tenantFilter(auth) })) !== staff.length) return badRequest("Employé introuvable.");
    // Une personne ne peut pas être affectée à plus de 100 % de son temps, tous comptoirs confondus.
    const others = await ActivityDeskModel.find({ ...tenantFilter(auth), _id: { $ne: params.id }, archived: { $ne: true }, "staff.employeeId": { $in: staff.map(x => x.employeeId) } }).select("name staff").lean<Array<{ name: string; staff?: Array<{ employeeId: unknown; share: number }> }>>();
    for (const x of staff) {
      const elsewhere = others.reduce((t, d) => t + (d.staff ?? []).filter(y => String(y.employeeId) === x.employeeId).reduce((u, y) => u + y.share, 0), 0);
      if (elsewhere + x.share > 1.0001) return badRequest(`Un employé serait affecté à ${Math.round((elsewhere + x.share) * 100)} % de son temps (déjà ${Math.round(elsewhere * 100)} % sur d'autres comptoirs).`);
    }
    $set.staff = staff;
  }
  // Charges prévues par mois (budget) : comparées au réel, base du point mort.
  if ("plannedCosts" in clean) {
    const raw = Array.isArray(clean.plannedCosts) ? clean.plannedCosts as Array<{ category?: unknown; label?: unknown; amount?: unknown }> : [];
    const rows = raw.filter(x => typeof x.category === "string" && x.category in CHARGE_CATEGORIES && Number(x.amount) > 0)
      .map(x => ({ category: String(x.category), ...(typeof x.label === "string" && x.label.trim() ? { label: x.label.trim().slice(0, 80) } : {}), amount: Math.round(Number(x.amount)) }));
    $set.plannedCosts = rows.slice(0, 40);
  }
  if ("targetMarkup" in clean) {
    const r = Number(clean.targetMarkup);
    if (!(r >= 0 && r < 0.95)) return badRequest("Taux de marque visé invalide (fraction : 0,30 pour 30 %).");
    $set.targetMarkup = r;
  }
  if ("vatRate" in clean) {
    const r = Number(clean.vatRate) || 0;
    if (!(r >= 0 && r < 0.5)) return badRequest("Taux de TVA invalide.");
    $set.vatRate = r;
  }

  const update: Record<string, unknown> = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;
  const desk = await ActivityDeskModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, update, { new: true });
  if (!desk) return notFound("Comptoir introuvable");
  await logAudit(auth, "UPDATE", "comptoir", { resourceId: String(params.id) });
  return ok(desk);
});
