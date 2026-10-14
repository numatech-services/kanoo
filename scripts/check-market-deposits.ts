/**
 * Repère les factures d'échéance de marché sous-facturées par l'ancien calcul.
 *
 * Jusqu'au correctif d'octobre 2026, facturer une échéance de travaux (ex.
 * « Solde 70 % ») prenait son montant comme travaux PUIS en retranchait les
 * acomptes : avec « Acompte 30 % » + « Solde 70 % », le client ne payait que
 * 70 % du marché. Ce script ne modifie rien : il liste les factures touchées
 * et le montant HT manquant. Correction : avoir sur la facture puis nouvelle
 * facturation de l'échéance depuis la fiche du marché, ou facture
 * complémentaire du montant manquant.
 *
 *   npx tsx scripts/check-market-deposits.ts
 */
import mongoose from "mongoose";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI manquant.");
  await mongoose.connect(uri);
  const { InvoiceModel } = await import("../models/Invoice");
  const { ContractModel } = await import("../models/Contract");

  const invoices = await InvoiceModel.find({
    documentType: "invoice", kind: { $ne: "deposit" }, status: { $ne: "cancelled" },
    milestoneId: { $exists: true }, "lines.kind": "deposit_deduction",
  }).select("tenantId number contractId milestoneId lines totalHT creditedAmount").lean<Array<{
    tenantId: unknown; number: string; contractId: unknown; milestoneId: unknown; totalHT: number; creditedAmount?: number;
    lines: Array<{ kind?: string; totalHT: number }>;
  }>>();

  let found = 0, missing = 0;
  for (const inv of invoices) {
    if ((inv.creditedAmount ?? 0) > 0) continue;   // déjà corrigée par un avoir
    const contract = await ContractModel.findOne({ _id: inv.contractId, tenantId: inv.tenantId })
      .select("reference milestones").lean<{ reference: string; milestones: Array<{ _id: unknown; amount: number; label: string }> } | null>();
    const ms = contract?.milestones.find(m => String(m._id) === String(inv.milestoneId));
    if (!contract || !ms) continue;
    const deducted = -inv.lines.filter(l => l.kind === "deposit_deduction").reduce((t, l) => t + l.totalHT, 0);
    // Net facturé inférieur à l'échéance : l'acompte a été retranché de l'échéance elle-même.
    const gap = Math.round(ms.amount - inv.totalHT);
    if (deducted > 0 && gap > 0) {
      found++; missing += gap;
      console.log(`· ${inv.number} — marché ${contract.reference}, échéance « ${ms.label} » ${ms.amount.toLocaleString("fr-FR")} FCFA HT : `
        + `net facturé ${inv.totalHT.toLocaleString("fr-FR")}, manque ${gap.toLocaleString("fr-FR")} FCFA HT`);
    }
  }
  console.log(`\n${invoices.length} factures d'échéance avec déduction d'acompte examinées · ${found} sous-facturées · ${missing.toLocaleString("fr-FR")} FCFA HT manquants au total`);
  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
