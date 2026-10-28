import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound } from "@/lib/api-helpers";
import { isId, ownDesk } from "@/lib/comptoir";
import { MobileMoneyLineModel } from "@/models/MobileMoneyLine";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { localDay } from "@/lib/comptoir-sale";
import { matchMobileMoney, parseMomoCsv } from "@/lib/spot";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Rapprochement d'une période : relevé de l'opérateur ⇄ encaissements mobile money du comptoir. */
async function reconcile(tenantId: string, deskId: string, from: string, to: string, persist = false) {
  const range = { $gte: new Date(`${from}T00:00:00.000`), $lte: new Date(`${to}T23:59:59.999`) };
  const tid = new Types.ObjectId(tenantId), did = new Types.ObjectId(deskId);
  const [lines, entries] = await Promise.all([
    MobileMoneyLineModel.find({ tenantId: tid, deskId: did, date: range }).sort({ date: 1 }).lean<Array<{ _id: Types.ObjectId; date: Date; amount: number; reference?: string; phone?: string; operator?: string }>>(),
    ActivityCashEntryModel.find({ tenantId: tid, deskId: did, direction: "in", method: "orange_money", date: range }).sort({ date: 1 }).lean<Array<{ _id: Types.ObjectId; date: Date; amount: number; label: string }>>(),
  ]);
  const r = matchMobileMoney(lines.map(l => ({ id: String(l._id), date: new Date(l.date), amount: l.amount, reference: l.reference, phone: l.phone })), entries.map(e => ({ id: String(e._id), date: new Date(e.date), amount: e.amount, label: e.label })));
  if (persist) for (const p of r.pairs) await MobileMoneyLineModel.updateOne({ _id: p.lineId }, { $set: { cashEntryId: p.entryId } });
  const lineBy = new Map(lines.map(l => [String(l._id), l])), entryBy = new Map(entries.map(e => [String(e._id), e]));
  const sum = (a: Array<{ amount: number }>) => a.reduce((t, x) => t + x.amount, 0);
  return {
    from, to,
    totals: { statement: sum(lines), kanoo: sum(entries), gap: sum(lines) - sum(entries) },
    matched: r.pairs.map(p => ({ line: lineBy.get(p.lineId), entry: entryBy.get(p.entryId) })),
    // Reçus chez l'opérateur, absents de la caisse : ticket oublié ?
    statementOnly: r.unmatchedLines.map(l => lineBy.get(l.id)),
    // Encaissés en caisse, absents du relevé : paiement non arrivé ou mauvais moyen saisi.
    kanooOnly: r.unmatchedEntries.map(e => entryBy.get(e.id)),
  };
}

/** GET ?deskId=&from=&to= — état du rapprochement mobile money. */
export const GET = withAuth("comptoir", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const deskId = url.searchParams.get("deskId");
  if (!isId(deskId)) return badRequest("Comptoir invalide");
  if (!(await ownDesk(auth, deskId))) return notFound("Comptoir introuvable");
  const now = new Date();
  return ok(await reconcile(auth.tenantId, deskId, url.searchParams.get("from") ?? localDay(new Date(now.getTime() - 6 * 86_400_000)), url.searchParams.get("to") ?? localDay(now)));
});

/**
 * POST { deskId, operator?, csv } — importe un relevé (date ; montant ;
 * référence ; téléphone). Une référence déjà importée est ignorée.
 */
export const POST = withAuth("comptoir", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (!(await ownDesk(auth, body.deskId))) return notFound("Comptoir introuvable");
  const csv = String(body.csv ?? "");
  if (!csv.trim() || csv.length > 500_000) return badRequest("Relevé vide ou trop volumineux.");
  const { rows, errors } = parseMomoCsv(csv);
  if (!rows.length) return badRequest(`Aucune ligne lisible.${errors.length ? ` ${errors[0]}` : ""}`);
  let added = 0, skipped = 0;
  // Références déjà importées : écartées avant l'écriture (l'index unique
  // reste le garde-fou en cas d'imports simultanés).
  const refs = rows.map(r => r.reference).filter(Boolean) as string[];
  const known = new Set((await MobileMoneyLineModel.find({ tenantId: auth.tenantId, deskId: body.deskId, reference: { $in: refs } }).select("reference").lean<Array<{ reference: string }>>()).map(x => x.reference));
  for (const r of rows) {
    if (r.reference && known.has(r.reference)) { skipped++; continue; }
    if (r.reference) known.add(r.reference);
    try {
      await MobileMoneyLineModel.create({ tenantId: auth.tenantId, deskId: body.deskId, operator: body.operator ? String(body.operator).slice(0, 30) : undefined, ...r, importedBy: auth.userId });
      added++;
    } catch (e) { if ((e as { code?: number }).code === 11000) skipped++; else throw e; }
  }
  const days = rows.map(r => r.date.getTime());
  const state = await reconcile(auth.tenantId, String(body.deskId), localDay(new Date(Math.min(...days) - 86_400_000)), localDay(new Date(Math.max(...days) + 86_400_000)), true);
  await logAudit(auth, "CREATE", "comptoir", { metadata: { momoImport: added, skipped } });
  return created({ added, skipped, errors, ...state });
});
