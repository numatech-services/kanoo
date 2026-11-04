import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, forbidden, notFound } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan, hasFinanceAccess } from "@/lib/role-resources";
import { allDesks, isId } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { sitesOverview, archiveForRestart, openSite, openingStock, siteTemplates, copyRecipes, type OpeningInput } from "@/lib/restaurant-opening";
import { allocateFunds, addOpeningLine, cancelFunding, qualifyFunding, repayFunding, depositCash, openingPosition, FUNDING_NATURES, OPENING_KINDS } from "@/lib/restaurant-funding";
import { accountBalance } from "@/lib/treasury";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { DeskFundingModel } from "@/models/DeskFunding";
import { DeskInventoryModel } from "@/models/DeskInventory";
import { EmployeeModel } from "@/models/Employee";
import { ProductModel } from "@/models/Product";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { UserModel } from "@/models/User";

export const dynamic = "force-dynamic";
const allowed = (auth: TokenPayload) => allDesks(auth) && hasFinanceAccess(auth);
const NO = "Ouverture et archivage des sites : direction et comptabilité.";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const dayOf = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : undefined);
const text = (v: unknown) => (typeof v === "string" ? v : undefined);

/** La ligne visée appartient à l'organisation : ses opérations ne s'exécutent pas sur un identifiant étranger. */
const ownLine = (auth: TokenPayload, id: unknown) => isId(id) ? DeskFundingModel.exists({ _id: id, tenantId: auth.tenantId }) : Promise.resolve(null);

/**
 * GET — sites actifs et leur état, sites archivés (à reprendre), comptes de
 * trésorerie, collaborateurs et utilisateurs ;
 * ?position=<site> — situation de départ d'un site ;
 * ?templates=<site> — articles d'un site à reprendre ;
 * ?q= — recherche dans le catalogue commun.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!allowed(auth)) return forbidden(NO);
  const url = new URL(req.url), position = url.searchParams.get("position"), templates = url.searchParams.get("templates"), q = url.searchParams.get("q");
  if (position) {
    if (!isId(position) || !(await ActivityDeskModel.exists({ _id: position, tenantId: auth.tenantId }))) return notFound("Site introuvable");
    const inv = await DeskInventoryModel.find({ tenantId: auth.tenantId, deskId: position, opening: true, status: "validated" }).select("gapValue").lean<Array<{ gapValue?: number }>>();
    return ok(await openingPosition(auth.tenantId, position, inv.reduce((t, i) => t + (i.gapValue ?? 0), 0)));
  }
  if (templates) return isId(templates) && (await ActivityDeskModel.exists({ _id: templates, tenantId: auth.tenantId })) ? ok(await siteTemplates(auth.tenantId, templates)) : notFound("Site introuvable");
  if (q !== null) return ok(await ProductModel.find({ tenantId: auth.tenantId, label: new RegExp(esc(q.trim().slice(0, 60)), "i") }).select("label unit category purchaseCost").sort({ label: 1 }).limit(20).lean());
  const [sites, archived, accounts, employees, users] = await Promise.all([
    sitesOverview(auth.tenantId),
    ActivityDeskModel.find({ tenantId: auth.tenantId, archived: true }).select("name").sort({ updatedAt: -1 }).limit(50).lean<Array<{ _id: unknown; name: string }>>(),
    TreasuryAccountModel.find({ tenantId: auth.tenantId, isActive: { $ne: false } }).select("label type").sort({ label: 1 }).limit(100).lean<Array<{ _id: unknown; label: string; type: string }>>(),
    EmployeeModel.find({ tenantId: auth.tenantId, isActive: true }).select("firstName lastName position").sort({ lastName: 1 }).limit(300).lean(),
    authCan(auth, "users", "update") ? UserModel.find({ tenantId: auth.tenantId, isActive: true }).select("firstName lastName email role").sort({ lastName: 1 }).limit(300).lean() : Promise.resolve(null),
  ]);
  const balances = await Promise.all(accounts.map(a => accountBalance(auth.tenantId, String(a._id))));
  return ok({ sites, archived, accounts: accounts.map((a, i) => ({ ...a, balance: balances[i]?.balance ?? 0 })), employees, users, natures: Object.entries(FUNDING_NATURES).map(([key, v]) => ({ key, label: v.label })), kinds: Object.entries(OPENING_KINDS).map(([key, label]) => ({ key, label })) });
});

/**
 * POST { action, … } :
 *  - archive { deskIds, solderStock, cashTo?, confirm: "ARCHIVER" } : nouveau départ (rien n'est supprimé) ;
 *  - open { site } : ouverture d'un site ;
 *  - stock { deskId, items } : stock de départ ajouté à un site ouvert ;
 *  - copy { deskId, fromDeskId } : fiches techniques reprises d'un autre site ;
 *  - fund { deskId, amount, nature, fromAccountId?, label? } : argent alloué à un site ;
 *  - line { deskId, kind, amount, label?, repayable? } : ligne de la situation de départ ;
 *  - cancel { id, reason } · qualify { id, accountCode, accountLabel? } · repay { id, amount, fromAccountId } ;
 *  - deposit { deskId, amount, toAccountId } : remise de caisse vers la banque.
 */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  if (!allowed(auth)) return forbidden(NO);
  const body = await req.json().catch(() => ({}));
  const site = () => isId(body.deskId) ? ActivityDeskModel.exists({ _id: body.deskId, tenantId: auth.tenantId }) : Promise.resolve(null);
  try {
    switch (body.action) {
      case "archive": {
        if (body.confirm !== "ARCHIVER") return badRequest("Confirmation manquante : tapez ARCHIVER.");
        const ids = Array.isArray(body.deskIds) ? body.deskIds.filter(isId) : [];
        if (!ids.length) return badRequest("Aucun site choisi.");
        if (body.cashTo && !(isId(body.cashTo) && (await TreasuryAccountModel.exists({ _id: body.cashTo, tenantId: auth.tenantId })))) return badRequest("Compte de destination introuvable.");
        const r = await archiveForRestart(auth, ids, body.solderStock === true, body.cashTo || undefined);
        await logAudit(auth, "UPDATE", "comptoir", { metadata: { restartArchive: ids, solderStock: body.solderStock === true, cashTo: body.cashTo } });
        return ok(r);
      }
      case "open": {
        const r = await openSite(auth, body.site as OpeningInput, authCan(auth, "users", "update"));
        await logAudit(auth, "CREATE", "comptoir", { resourceId: r.deskId, metadata: { openSite: r.name, stockValue: r.stockValue, funded: r.funded } });
        return created(r);
      }
      case "stock": {
        if (!(await site())) return notFound("Site introuvable");
        const r = await openingStock(auth, body.deskId, Array.isArray(body.items) ? body.items : []);
        await logAudit(auth, "CREATE", "comptoir", { resourceId: body.deskId, metadata: { openingStock: r.items, value: r.stockValue } });
        return created(r);
      }
      case "copy": {
        if (!(await site()) || !isId(body.fromDeskId) || !(await ActivityDeskModel.exists({ _id: body.fromDeskId, tenantId: auth.tenantId }))) return notFound("Site introuvable");
        const r = await copyRecipes(auth, body.fromDeskId, body.deskId);
        await logAudit(auth, "CREATE", "comptoir", { resourceId: body.deskId, metadata: { copyRecipes: r.recipes } });
        return created(r);
      }
      case "fund": {
        if (!(await site())) return notFound("Site introuvable");
        const f = await allocateFunds(auth, body.deskId, { amount: Number(body.amount), nature: body.nature, fromAccountId: isId(body.fromAccountId) ? body.fromAccountId : undefined, label: text(body.label), date: dayOf(body.date) });
        await logAudit(auth, "CREATE", "comptoir", { resourceId: body.deskId, metadata: { siteFunding: f.amount, nature: f.nature } });
        return created({ _id: String(f._id) });
      }
      case "line": {
        if (!(await site())) return notFound("Site introuvable");
        const f = await addOpeningLine(auth, body.deskId, { kind: body.kind, amount: Number(body.amount), label: text(body.label), repayable: body.repayable !== false, date: dayOf(body.date) });
        await logAudit(auth, "CREATE", "comptoir", { resourceId: body.deskId, metadata: { openingLine: f.kind, amount: f.amount } });
        return created({ _id: String(f._id) });
      }
      case "cancel": {
        if (!(await ownLine(auth, body.id))) return notFound("Ligne introuvable");
        await cancelFunding(auth, body.id, body.reason);
        await logAudit(auth, "DELETE", "comptoir", { resourceId: body.id, metadata: { siteFundingCancelled: body.reason } });
        return ok({ cancelled: true });
      }
      case "qualify": {
        if (!(await ownLine(auth, body.id))) return notFound("Ligne introuvable");
        await qualifyFunding(auth, body.id, String(body.accountCode ?? ""), text(body.accountLabel));
        await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.id, metadata: { siteFundingQualified: body.accountCode } });
        return ok({ qualified: true });
      }
      case "repay": {
        if (!(await ownLine(auth, body.id))) return notFound("Ligne introuvable");
        await repayFunding(auth, body.id, { amount: Number(body.amount), fromAccountId: String(body.fromAccountId ?? ""), date: dayOf(body.date) });
        await logAudit(auth, "UPDATE", "comptoir", { resourceId: body.id, metadata: { siteFundingRepaid: body.amount } });
        return ok({ repaid: true });
      }
      case "deposit": {
        if (!(await site())) return notFound("Site introuvable");
        await depositCash(auth, body.deskId, { amount: Number(body.amount), toAccountId: String(body.toAccountId ?? ""), date: dayOf(body.date) });
        await logAudit(auth, "CREATE", "comptoir", { resourceId: body.deskId, metadata: { cashDeposit: body.amount } });
        return created({ deposited: true });
      }
      default: return badRequest("Action inconnue.");
    }
  } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});
