/**
 * Attribue un compte comptable dédié (5211xx, 5218xx, 5711xx) aux comptes de
 * trésorerie créés avant octobre 2026, qui écrivaient tous sur 521000 / 571000.
 * Pour chacun, le solde porté par le compte général (somme de ses mouvements)
 * est reclassé sur le compte dédié par une OD datée du jour.
 *
 * Même opération que le bouton « Attribuer un compte dédié » de Trésorerie.
 *
 *   npx tsx scripts/assign-treasury-ledger-codes.ts            (simulation)
 *   npx tsx scripts/assign-treasury-ledger-codes.ts --apply    (écriture)
 */
import mongoose from "mongoose";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

async function run() {
  const apply = process.argv.includes("--apply");
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI manquant.");
  await mongoose.connect(uri);
  const { TreasuryAccountModel } = await import("../models/TreasuryAccount");
  const { TenantModel } = await import("../models/Tenant");
  const { UserModel } = await import("../models/User");
  const { assignLedgerCode } = await import("../lib/treasury");
  const { withTransaction } = await import("../lib/db");

  const accounts = await TreasuryAccountModel.find({ ledgerCode: { $exists: false } }).sort({ tenantId: 1, createdAt: 1 })
    .lean<Array<{ _id: unknown; tenantId: unknown; label: string; type: string }>>();
  for (const a of accounts) {
    const tenant = await TenantModel.findById(a.tenantId).select("name").lean<{ name: string } | null>();
    const admin = await UserModel.findOne({ tenantId: a.tenantId, isActive: true }).sort({ createdAt: 1 }).select("_id").lean<{ _id: unknown } | null>();
    if (!apply || !admin) { console.log(`· ${tenant?.name ?? a.tenantId} — ${a.label} (${a.type})${admin ? "" : " : aucun utilisateur, ignoré"}`); continue; }
    const r = await withTransaction(session => assignLedgerCode({ tenantId: String(a.tenantId), userId: String(admin._id) }, a._id, session));
    console.log(`→ ${tenant?.name ?? a.tenantId} — ${a.label} : ${r.code}${r.reclassed ? `, ${r.reclassed.toLocaleString("fr-FR")} FCFA reclassés` : ""}`);
  }
  console.log(`\n${accounts.length} comptes sans compte dédié${apply ? " · traités" : " (simulation : relancez avec --apply pour écrire)"}`);
  await mongoose.disconnect();
}

run().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
