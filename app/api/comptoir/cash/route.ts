import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, tenantFilter, requireFields } from "@/lib/api-helpers";
import { isId, ownDesk, postDeskCash } from "@/lib/comptoir";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { Types } from "mongoose";
import { parseFlow, parsePeriod, periodMatch, flowTotals } from "@/lib/flow-filter";
import { assertDayOpen } from "@/lib/comptoir-sale";
import { EXPENSE_CATEGORIES } from "@/lib/comptoir-session";

export const dynamic = "force-dynamic";

const METHODS = ["cash", "bank_transfer", "orange_money", "card", "check", "other"];

/**
 * Écritures de caisse d'un comptoir (comptabilité argent).
 * Filtres communs : `flow=in|out` (recettes / dépenses), `from`, `to`.
 * Renvoie `{ items, totals }` ; les totaux couvrent la période, tous sens confondus.
 */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const flow = parseFlow(url.searchParams.get("flow"));
  const base = { ...tenantFilter(auth), deskId: new Types.ObjectId(deskId), ...periodMatch("date", parsePeriod(url)) };
  const [items, sums] = await Promise.all([
    ActivityCashEntryModel.find({ ...base, ...(flow ? { direction: flow } : {}) })
      .sort({ date: -1, createdAt: -1 }).limit(500).lean(),
    ActivityCashEntryModel.aggregate<{ _id: string; total: number }>([
      { $match: base }, { $group: { _id: "$direction", total: { $sum: "$amount" } } },
    ]),
  ]);
  const sum = (d: string) => sums.find(x => x._id === d)?.total ?? 0;
  return ok({ items, totals: flowTotals(sum("in"), sum("out")) });
});

export const POST = withAuth("comptoir", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const err = requireFields(body, ["deskId", "direction", "amount", "label"]);
  if (err) return badRequest(err);
  if (!["in", "out"].includes(body.direction)) return badRequest("Sens invalide");
  if (!(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  const amount = Number(body.amount);
  if (!(amount > 0)) return badRequest("Montant invalide");
  const date = body.date ? new Date(body.date) : new Date();
  if (isNaN(date.getTime())) return badRequest("Date invalide");
  // Écriture de caisse + comptabilisation (si le comptoir est relié à une caisse)
  // dans la même transaction : jamais l'une sans l'autre.
  const entry = await withTransaction(async session => {
    await assertDayOpen(auth.tenantId, body.deskId, date, session);
    const [e] = await ActivityCashEntryModel.create([{
      tenantId: auth.tenantId,
      deskId: body.deskId,
      direction: body.direction,
      amount,
      label: String(body.label).slice(0, 200).trim(),
      method: METHODS.includes(body.method) ? body.method : "cash",
      ...(body.direction === "out" ? { category: body.category && body.category in EXPENSE_CATEGORIES ? body.category : "other" } : {}),
      date,
      createdBy: auth.userId,
    }], { session });
    await postDeskCash(auth, body.deskId, e, session);
    return e;
  });
  await logAudit(auth, "CREATE", "comptoir", { resourceId: entry._id.toString(), metadata: { cash: body.direction } });
  return created(entry);
});
