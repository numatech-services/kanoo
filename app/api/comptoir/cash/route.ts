import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, tenantFilter, requireFields } from "@/lib/api-helpers";
import { isId, ownDesk, postDeskCash } from "@/lib/comptoir";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { ActivityDeskModel } from "@/models/ActivityDesk";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { Types } from "mongoose";
import { parseFlow, parsePeriod, periodMatch, flowTotals } from "@/lib/flow-filter";
import { assertDayOpen, assertDeskActive } from "@/lib/comptoir-sale";
import { CashSessionModel } from "@/models/CashSession";
import { BusinessRuleError } from "@/lib/errors";
import { localDay } from "@/lib/format";
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
  if (!(amount > 0) || amount > 1e11) return badRequest("Montant invalide");
  const date = body.date ? new Date(body.date) : new Date();
  if (isNaN(date.getTime()) || date.getTime() > Date.now() + 3_600_000) return badRequest("Date invalide : une écriture de caisse ne se date pas dans le futur.");
  // Site ouvert par l'assistant : une marchandise passe par une réception, sinon le stock et le coût des ventes sont faux.
  const goods = body.direction === "out" && (!body.category || !Object.hasOwn(EXPENSE_CATEGORIES, body.category) || body.category === "supply" || body.category === "ingredients");
  if (goods && await ActivityDeskModel.exists({ _id: body.deskId, ...tenantFilter(auth), strictStock: true })) return badRequest("Un achat de marchandises se saisit par une réception (payée en caisse), pas en dépense. Pour une autre dépense, choisissez sa nature.");
  // Écriture de caisse + comptabilisation (si le comptoir est relié à une caisse)
  // dans la même transaction : jamais l'une sans l'autre.
  const entry = await withTransaction(async session => {
    await assertDeskActive(auth.tenantId, body.deskId, session);
    await assertDayOpen(auth.tenantId, body.deskId, date, session);
    // Une ligne antérieure à l'ouverture de la caisse fausserait les espèces attendues.
    const open = await CashSessionModel.findOne({ tenantId: auth.tenantId, deskId: body.deskId, status: "open" }).select("openDay").session(session ?? null).lean<{ openDay: string } | null>();
    if (open && localDay(date) < open.openDay) throw new BusinessRuleError(`La caisse est ouverte depuis le ${open.openDay} : une écriture ne se date pas d'avant.`);
    const [e] = await ActivityCashEntryModel.create([{
      tenantId: auth.tenantId,
      deskId: body.deskId,
      direction: body.direction,
      amount,
      label: String(body.label).slice(0, 200).trim(),
      method: METHODS.includes(body.method) ? body.method : "cash",
      // Sortie sans nature : un achat (compte d'achats du comptoir). Entrée : une vente, sauf « hors vente »
      // (remboursement, apport, correction), passée en compte d'attente sans TVA pour le comptable.
      ...(body.direction === "out" ? { category: body.category && Object.hasOwn(EXPENSE_CATEGORIES, body.category) ? body.category : "supply" } : body.category === "non_sale" ? { category: "non_sale" } : {}),
      date,
      createdBy: auth.userId,
    }], { session });
    await postDeskCash(auth, body.deskId, e, session);
    return e;
  });
  await logAudit(auth, "CREATE", "comptoir", { resourceId: entry._id.toString(), metadata: { cash: body.direction } });
  return created(entry);
});
