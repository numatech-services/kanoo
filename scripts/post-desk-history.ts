/**
 * Reprise comptable de l'historique d'un comptoir.
 *
 * Depuis octobre 2026, un comptoir relié à une caisse de trésorerie comptabilise
 * chaque vente et chaque dépense. Les écritures de caisse antérieures à la
 * liaison restent hors comptabilité ; ce script les comptabilise, à la date de
 * chacune, dans la caisse et sur les comptes paramétrés du comptoir.
 *
 * Attention : le solde d'ouverture de la caisse ne doit PAS déjà inclure ces
 * montants (sinon ils seraient comptés deux fois). Choisissez --since après la
 * date du solde d'ouverture.
 *
 *   npx tsx scripts/post-desk-history.ts --desk=<id> --since=2026-01-01            (simulation)
 *   npx tsx scripts/post-desk-history.ts --desk=<id> --since=2026-01-01 --apply    (écriture)
 */
import mongoose from "mongoose";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split("=")[1];

async function run() {
  const apply = process.argv.includes("--apply");
  const deskId = arg("desk"), since = arg("since");
  if (!deskId || !since || isNaN(Date.parse(since))) throw new Error("Usage : --desk=<id> --since=AAAA-MM-JJ [--apply]");
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI manquant.");
  await mongoose.connect(uri);

  const { ActivityDeskModel } = await import("../models/ActivityDesk");
  const { ActivityCashEntryModel } = await import("../models/ActivityCashEntry");
  const { postCashFlow } = await import("../lib/cash-posting");
  const { withTransaction } = await import("../lib/db");

  const desk = await ActivityDeskModel.findById(deskId).lean<{
    _id: unknown; tenantId: unknown; name: string; createdBy: unknown; activityId?: unknown;
    treasuryAccountId?: unknown; revenueAccount?: string; expenseAccount?: string; vatRate?: number;
  } | null>();
  if (!desk) throw new Error("Comptoir introuvable.");
  if (!desk.treasuryAccountId) throw new Error("Reliez d'abord le comptoir à une caisse (Paramètres du comptoir).");

  const entries = await ActivityCashEntryModel.find({ deskId: desk._id, date: { $gte: new Date(since) }, entryId: { $exists: false } }).sort({ date: 1 });
  let total = 0;
  for (const e of entries) {
    total += e.direction === "in" ? e.amount : -e.amount;
    console.log(`${apply ? "→" : "·"} ${new Date(e.date).toLocaleDateString("fr-FR")} ${e.direction === "in" ? "+" : "−"}${e.amount.toLocaleString("fr-FR")} ${e.label}`);
    if (!apply) continue;
    await withTransaction(async session => {
      const r = await postCashFlow({
        tenantId: String(desk.tenantId), userId: String(desk.createdBy), treasuryAccountId: desk.treasuryAccountId,
        direction: e.direction, amount: e.amount, date: e.date,
        label: `${desk.name} — ${e.label} (reprise)`, reference: `CPT-${String(e._id).slice(-6).toUpperCase()}`,
        account: e.direction === "in"
          ? { accountCode: desk.revenueAccount || "701100", accountLabel: "Ventes du comptoir" }
          : { accountCode: desk.expenseAccount || "601100", accountLabel: "Dépenses du comptoir" },
        vatRate: desk.vatRate ?? 0, activityId: desk.activityId, linkedDocType: "desk_cash", linkedDocId: e._id,
      }, session);
      e.entryId = r.entryId; e.movementId = r.movementId;
      await e.save({ session });
    });
  }
  console.log(`\n${entries.length} écritures de caisse hors comptabilité depuis le ${since} · effet net sur la caisse : ${total.toLocaleString("fr-FR")} FCFA`
    + (apply ? " · comptabilisées" : " (simulation : relancez avec --apply pour écrire)"));
  await mongoose.disconnect();
}

run().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
