import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { isId, ownDesk, canSeeDeskCosts, deskScope } from "@/lib/comptoir";
import { hasFinanceAccess, authCan, isInternFor, INTERN_EXPORT_MESSAGE } from "@/lib/role-resources";
import { logAudit } from "@/lib/audit";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { DeskMonthCloseModel } from "@/models/DeskMonthClose";
import { deskMonthResult, deskTrend, deskStockAt, maskPayroll, payrollHidden, type MonthResult } from "@/lib/restaurant-result";
import { productSales } from "@/lib/comptoir-session";
import { isMonth, monthBounds, menuEngineering } from "@/lib/restaurant";
import { DeskInventoryModel } from "@/models/DeskInventory";
import { restaurantWorkbook } from "@/lib/restaurant-xlsx";

export const dynamic = "force-dynamic";

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

async function menuOf(tenantId: string, deskId: string, month: string) {
  const b = monthBounds(month);
  const sold = await productSales(tenantId, deskId, b.fromDay, b.toDay);
  return menuEngineering(sold.filter(s => s.valuedQty > 0).map(s => ({ id: s.itemId, name: s.label, category: s.category, quantity: s.valuedQty, marginHT: s.valuedHT - s.valuedCost })));
}

/** Paie : une seule règle de masquage pour toutes les sorties (lib/restaurant-result maskPayroll). */
const forViewer = (r: MonthResult, auth: TokenPayload) => maskPayroll(r, authCan(auth, "payslips", "read"));

/**
 * GET /api/comptoir/result?deskId=&month=AAAA-MM[&trend=1][&format=xlsx]
 *   résultat de gestion du comptoir (ventes, coût des ventes, pertes, écarts
 *   d'inventaire, charges comptables du secteur, personnel affecté, budget),
 *   ratios, analyse de la carte ; dossier Excel du mois.
 * GET /api/comptoir/result?all=1&month= : tous les comptoirs visibles, consolidés.
 * Chef du comptoir, gérance et comptabilité seulement (coûts).
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!canSeeDeskCosts(auth)) return forbidden("Résultat réservé au chef du comptoir, à la gérance et à la comptabilité.");
  const url = new URL(req.url);
  const month = url.searchParams.get("month") || thisMonth();
  if (!isMonth(month)) return badRequest("Mois invalide (AAAA-MM).");

  if (url.searchParams.get("all") === "1") {
    const scope = deskScope(auth);
    const desks = await ActivityDeskModel.find({ tenantId: auth.tenantId, archived: { $ne: true }, ...(scope ? { _id: { $in: scope } } : {}) }).select("_id name").sort({ name: 1 }).lean<Array<{ _id: unknown; name: string }>>();
    type Row = { deskId: string; name: string; hasSector: boolean; closed: boolean; revenueHT: number; unvaluedRevenueHT: number; warnings: number; materialMargin: number; charges: number; result: number; foodCostPct: number | null; staffCostPct: number | null; tickets: number };
    const rows: Row[] = [];
    for (const d of desks) {
      const r = forViewer(await deskMonthResult(auth.tenantId, String(d._id), month), auth);
      rows.push({ deskId: String(d._id), name: d.name, hasSector: r.desk.hasSector, closed: !!r.closed, revenueHT: r.pnl.revenueHT, unvaluedRevenueHT: r.pnl.unvaluedRevenueHT, warnings: r.warnings.length, materialMargin: r.pnl.materialMargin, charges: r.pnl.totalCharges, result: r.pnl.result, foodCostPct: r.pnl.ratios.foodCostPct, staffCostPct: r.pnl.ratios.staffCostPct, tickets: r.sales.tickets });
    }
    const sum = (k: "revenueHT" | "materialMargin" | "charges" | "result" | "tickets") => rows.reduce((t, r) => t + r[k], 0);
    return ok({ month, rows, totals: { revenueHT: sum("revenueHT"), materialMargin: sum("materialMargin"), charges: sum("charges"), result: sum("result"), tickets: sum("tickets") } });
  }

  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId) || !(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const [raw, menu] = await Promise.all([deskMonthResult(auth.tenantId, deskId, month), menuOf(auth.tenantId, deskId, month)]);
  const result = forViewer(raw, auth);
  if (url.searchParams.get("format") === "xlsx") {
    if (isInternFor(auth, "comptoir")) return forbidden(INTERN_EXPORT_MESSAGE);
    // Stock de FIN DE MOIS (ou d'aujourd'hui pour le mois en cours), pas celui du jour de l'export.
    const b = monthBounds(month), end = b.to < new Date() ? b.to : new Date();
    const stock = await deskStockAt(auth.tenantId, deskId, end);
    const buf = await restaurantWorkbook(result, stock, menu, end.toLocaleDateString("fr-FR").replace(/\//g, "-"));
    await logAudit(auth, "EXPORT", "comptoir", { resourceId: deskId, metadata: { result: month } });
    const name = `resultat-${result.desk.name.normalize("NFD").replace(/[^\w-]+/g, "-").toLowerCase()}-${month}.xlsx`;
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}"` } });
  }
  const trend = url.searchParams.get("trend") === "1" ? await deskTrend(auth.tenantId, deskId, month, 12, payrollHidden(raw.staffDetail.length, authCan(auth, "payslips", "read"))) : undefined;
  return ok({ ...result, menu, ...(trend ? { trend } : {}) });
});

/**
 * POST { deskId, month, action: "close" | "reopen", note?, reason?, force? }
 *  - close : clôture de gestion du mois (résultat figé, mois verrouillé), par
 *    la finance, une fois les préalables remplis (aucun inventaire ouvert,
 *    ventes toutes au coût connu, personnel payé) — `force` + motif pour passer
 *    outre, sauf inventaire ouvert ;
 *  - reopen : motif obligatoire, clôture précédente gardée dans l'historique.
 * Pas de stagiaire.
 */
export const POST = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!hasFinanceAccess(auth) || isInternFor(auth, "comptoir")) return forbidden("La clôture du mois revient à la comptabilité ou à la gérance.");
  const body = await req.json().catch(() => ({}));
  if (!isId(body.deskId) || !(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  if (!isMonth(body.month)) return badRequest("Mois invalide (AAAA-MM).");
  if (body.month >= thisMonth()) return badRequest("Seul un mois écoulé se clôture.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 400) : "";
  if (body.action === "close") {
    const cur = await DeskMonthCloseModel.findOne({ tenantId: auth.tenantId, deskId: body.deskId, month: body.month }).select("status").lean<{ status: string } | null>();
    if (cur?.status === "closed") return badRequest("Mois déjà clos.");
    if (await DeskInventoryModel.exists({ tenantId: auth.tenantId, deskId: body.deskId, status: "open" })) return badRequest("Un inventaire est encore ouvert : validez-le ou annulez-le avant de clôturer.");
    const r = await deskMonthResult(auth.tenantId, body.deskId, body.month);
    const blockers = [
      r.sales.unvaluedLines ? `${r.sales.unvaluedLines} ligne(s) vendue(s) sans coût connu` : "",
      r.reconciliation.unvaluedReceptions ? `${r.reconciliation.unvaluedReceptions} entrée(s) en stock sans prix` : "",
      r.warnings.some(w => w.startsWith("Bulletins du mois absents")) ? "bulletins de paie du mois manquants pour le personnel affecté" : "",
    ].filter(Boolean);
    if (blockers.length && !(body.force === true && note.length >= 10)) return badRequest(`Préalables non remplis : ${blockers.join(" ; ")}. Corrigez-les, ou clôturez quand même avec un motif d'au moins 10 caractères.`);
    const snapshot = { ...r.pnl, sales: r.sales, staffTotal: r.staffTotal, reconciliation: r.reconciliation, warnings: r.warnings };
    await DeskMonthCloseModel.updateOne({ tenantId: auth.tenantId, deskId: body.deskId, month: body.month },
      { $set: { status: "closed", snapshot, closedBy: auth.userId, closedAt: new Date(), ...(note ? { note } : {}) }, $setOnInsert: { history: [] } }, { upsert: true });
    await logAudit(auth, "APPROVE", "comptoir", { resourceId: body.deskId, metadata: { monthClose: body.month, result: r.pnl.result, forced: blockers.length > 0, note } });
    return ok({ closed: true, result: r.pnl.result });
  }
  if (body.action === "reopen") {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 400) : "";
    if (reason.length < 10) return badRequest("Motif de réouverture obligatoire (10 caractères au moins).");
    const doc = await DeskMonthCloseModel.findOne({ tenantId: auth.tenantId, deskId: body.deskId, month: body.month, status: "closed" }).lean<{ _id: unknown; snapshot: { result?: number }; closedBy: unknown; closedAt: Date } | null>();
    if (!doc) return badRequest("Mois non clos.");
    await DeskMonthCloseModel.updateOne({ _id: doc._id, status: "closed" }, {
      $set: { status: "reopened" },
      $push: { history: { snapshot: doc.snapshot, closedBy: doc.closedBy, closedAt: doc.closedAt, reopenedBy: auth.userId, reopenedAt: new Date(), reason } },
    });
    await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.deskId, metadata: { monthReopen: body.month, previousResult: doc.snapshot.result, reason } });
    return ok({ reopened: true });
  }
  return badRequest("Action inconnue (close, reopen).");
});
