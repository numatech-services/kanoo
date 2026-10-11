/**
 * Répare les factures émises sans écriture de vente (journal VT).
 *
 * Cas connu : les factures de lots de marchés-cadres, créées sans écriture
 * jusqu'au correctif d'octobre 2026 — leur règlement creusait le compte 411.
 * Le script crée, pour chaque facture non annulée sans écriture VT active,
 * l'écriture de vente à la date de la facture (411 / 70x / 443 / 447).
 *
 * Par défaut, il SIMULE et affiche la liste. Pour écrire : ajouter --apply.
 *   npx tsx scripts/repair-sale-entries.ts            (simulation)
 *   npx tsx scripts/repair-sale-entries.ts --apply    (écriture)
 *
 * Une facture dont la date tombe dans une période verrouillée est signalée et
 * laissée de côté : il faut alors une écriture de régularisation datée du jour.
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

  const { InvoiceModel } = await import("../models/Invoice");
  const { AccountingEntryModel } = await import("../models/AccountingEntry");
  const { saleEntryLines } = await import("../lib/invoice-entry");

  const invoices = await InvoiceModel.find({ documentType: { $ne: "credit_note" }, status: { $ne: "cancelled" } })
    .select("tenantId number clientId lines totalTVA totalDTS totalTTC projectId activityId kind issueDate createdBy").lean<Array<{
      _id: mongoose.Types.ObjectId; tenantId: mongoose.Types.ObjectId; number: string; clientId: unknown;
      lines: Array<{ productId?: unknown; totalHT: number; kind?: string }>; totalTVA: number; totalDTS?: number; totalTTC: number;
      projectId?: unknown; activityId?: unknown; kind?: string; issueDate: Date; createdBy: unknown;
    }>>();

  let missing = 0, created = 0, skipped = 0;
  for (const inv of invoices) {
    const has = await AccountingEntryModel.exists({ tenantId: inv.tenantId, linkedDocType: "invoice", linkedDocId: inv._id, journalCode: "VT" });
    if (has) continue;
    missing++;
    console.log(`${apply ? "→" : "·"} ${inv.number} — ${inv.totalTTC.toLocaleString("fr-FR")} FCFA TTC — ${new Date(inv.issueDate).toLocaleDateString("fr-FR")}`);
    if (!apply) continue;
    try {
      await AccountingEntryModel.create({
        tenantId: inv.tenantId, journalCode: "VT", entryDate: inv.issueDate, reference: inv.number,
        label: `Facture ${inv.number} (écriture de vente rétablie)`,
        lines: await saleEntryLines(String(inv.tenantId), {
          clientId: inv.clientId, lines: inv.lines, totalTVA: inv.totalTVA, totalDTS: inv.totalDTS ?? 0, totalTTC: inv.totalTTC,
          kind: inv.kind, ...(inv.projectId ? { projectId: inv.projectId } : {}), ...(inv.activityId ? { activityId: inv.activityId } : {}),
        }),
        linkedDocType: "invoice", linkedDocId: inv._id, createdBy: inv.createdBy,
      });
      created++;
    } catch (e) {
      skipped++;
      console.log(`   ! ${inv.number} non réparée : ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`\n${invoices.length} factures examinées · ${missing} sans écriture de vente${apply ? ` · ${created} réparées · ${skipped} laissées de côté` : " (simulation : relancez avec --apply pour écrire)"}`);
  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
