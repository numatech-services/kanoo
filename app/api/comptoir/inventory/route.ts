import { NextRequest } from "next/server";
import { hasFinanceAccess } from "@/lib/role-resources";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { isId, ownDesk, canSeeDeskCosts } from "@/lib/comptoir";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";
import { DeskInventoryModel } from "@/models/DeskInventory";
import { openInventory, saveCounts, validateInventory, cancelInventory, inventoryReview } from "@/lib/restaurant-inventory";
import { ComptoirSaleModel } from "@/models/ComptoirSale";
import { ActivityDeskModel } from "@/models/ActivityDesk";

export const dynamic = "force-dynamic";

type Line = { unitCost?: number; gapValue?: number };
/** Coûts et écarts chiffrés : chef du comptoir et finance seulement. */
const mask = (inv: { lines?: Line[]; gapValue?: number }, costs: boolean) =>
  costs ? inv : { ...inv, gapValue: undefined, lines: (inv.lines ?? []).map(l => ({ ...l, unitCost: undefined, gapValue: undefined })) };

/** GET ?deskId= : inventaires récents ; ?id= : un inventaire et ses lignes. */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const costs = canSeeDeskCosts(auth);
  const id = url.searchParams.get("id");
  if (isId(id)) {
    const inv = await DeskInventoryModel.findOne({ _id: id, tenantId: auth.tenantId }).lean<{ deskId: unknown; status: string; lines: Array<Line & { expectedAtCount?: number }> } | null>();
    if (!inv || !(await ownDesk(auth, String(inv.deskId)))) return notFound("Inventaire introuvable");
    if (url.searchParams.get("review") === "1") return costs ? ok(await inventoryReview(auth.tenantId, id)) : forbidden("Les écarts sont réservés au chef du comptoir et à la finance.");
    // Comptage à l'aveugle : le stock théorique ne s'affiche pas tant que l'inventaire est ouvert.
    const blind = inv.status === "open" ? { ...inv, lines: inv.lines.map(({ expectedAtCount: _e, ...l }) => l) } : inv;
    return ok(mask(blind, costs));
  }
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId) || !(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const list = await DeskInventoryModel.find({ tenantId: auth.tenantId, deskId }).sort({ createdAt: -1 }).limit(30).select("-lines").lean();
  return ok(list.map(i => mask(i as { gapValue?: number }, costs)));
});

/** POST { deskId, level, category? } : ouvrir ; { id, action: validate | cancel }. */
export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  try {
    if (isId(body.id)) {
      const inv = await DeskInventoryModel.findOne({ _id: body.id, tenantId: auth.tenantId }).select("deskId status number").lean<{ deskId: unknown; status: string; number: string } | null>();
      if (!inv || !(await ownDesk(auth, String(inv.deskId)))) return notFound("Inventaire introuvable");
      if (body.action === "validate") {
        // Les écarts touchent la valeur du stock et la marge : validation par le chef du comptoir ou la finance.
        if (!canSeeDeskCosts(auth)) return forbidden("La validation d'un inventaire revient au chef du comptoir ou à la comptabilité.");
        const r = await validateInventory(auth, body.id, hasFinanceAccess(auth), body.reasons && typeof body.reasons === "object" ? body.reasons : undefined);
        await logAudit(auth, "APPROVE", "comptoir", { resourceId: String(body.id), metadata: { inventory: inv.number, gapValue: r.gapValue } });
        return ok(r);
      }
      if (body.action === "cancel") {
        await cancelInventory(auth, body.id, canSeeDeskCosts(auth));
        await logAudit(auth, "UPDATE", "comptoir", { resourceId: String(body.id), metadata: { inventoryCancelled: inv.number } });
        return ok({ cancelled: true });
      }
      return badRequest("Action inconnue (validate, cancel).");
    }
    if (!isId(body.deskId) || !(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
    const level = body.level === "reserve" ? "reserve" : "desk";
    // Stock initial : ses écarts constituent le stock et sortent du résultat. Réservé à la finance, ou au chef sur un site qui n'a encore rien vendu.
    const opening = body.opening === true && canSeeDeskCosts(auth) && (hasFinanceAccess(auth) || !(await ComptoirSaleModel.exists({ tenantId: auth.tenantId, deskId: body.deskId })));
    const category = typeof body.category === "string" && body.category.trim() ? body.category.trim().slice(0, 60) : undefined;
    // Site ouvert par l'assistant : un inventaire complet est l'inventaire de fin de semaine, celui qui permet de clôturer.
    const weekly = !opening && !category && (body.weekly === true || !!(await ActivityDeskModel.exists({ _id: body.deskId, tenantId: auth.tenantId, strictStock: true })));
    const inv = await openInventory(auth, body.deskId, level, category, opening, weekly);
    return created(inv.toObject());
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});

/**
 * PATCH { id, device, counts: [{ itemId, counted }] } : sous-totaux comptés par
 * CET appareil (y compris hors ligne) ; les appareils s'additionnent.
 */
export const PATCH = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!isId(body.id)) return badRequest("Inventaire invalide");
  const inv = await DeskInventoryModel.findOne({ _id: body.id, tenantId: auth.tenantId }).select("deskId").lean<{ deskId: unknown } | null>();
  if (!inv || !(await ownDesk(auth, String(inv.deskId)))) return notFound("Inventaire introuvable");
  const counts = (Array.isArray(body.counts) ? body.counts : []).filter((c: { itemId?: unknown }) => isId(c?.itemId)).slice(0, 2000);
  try { return ok(await saveCounts(auth, body.id, typeof body.device === "string" ? body.device : "web", counts)); } catch (e) { if (e instanceof BusinessRuleError) return badRequest(e.message); throw e; }
});
