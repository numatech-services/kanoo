import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden, tenantFilter } from "@/lib/api-helpers";
import { FiscalDeclarationModel } from "@/models/FiscalDeclaration";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { authCan, isInternFor } from "@/lib/role-resources";
import { treasuryLedger } from "@/lib/treasury";
import { vatDueOf, settlementReference, VAT_DUE } from "@/lib/vat-settlement";
import { BusinessRuleError } from "@/lib/errors";
import { vatFromEntries, VAT_LINES_MATCH } from "@/lib/vat";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/**
 * POST { annee, mois, treasuryAccountId, date, reference } — paiement de la
 * TVA due d'un mois liquidé : 4441 débité, compte de trésorerie crédité,
 * mouvement de trésorerie, déclaration « payée ». Le paiement passait
 * jusqu'ici au débit du 443, ce qui compterait la dette deux fois une fois la
 * liquidation en place.
 */
export const POST = withAuth("fiscalDeclarations", "update", async (req: NextRequest, auth: TokenPayload) => {
  if (isInternFor(auth, "fiscalDeclarations")) return forbidden("Réservé au comptable et à la direction.");
  if (!authCan(auth, "accountingEntries", "create")) return forbidden("Votre profil ne permet pas de passer des écritures comptables.");
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const annee = Number(body.annee), mois = Number(body.mois);
  if (!Number.isInteger(annee) || !Number.isInteger(mois) || mois < 1 || mois > 12) return badRequest("Période invalide.");
  const date = body.date ? new Date(String(body.date)) : new Date();
  if (isNaN(date.getTime()) || date > new Date(Date.now() + 86_400_000)) return badRequest("Date de paiement invalide.");
  if (!Types.ObjectId.isValid(String(body.treasuryAccountId ?? ""))) return badRequest("Choisissez le compte de trésorerie débité.");
  const reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 60) : "";

  const result = await withTransaction(async session => {
    const decl = await FiscalDeclarationModel.findOne({ ...tenantFilter(auth), type: "tva", "period.annee": annee, "period.mois": mois, status: { $in: ["submitted", "paid"] } }).sort({ updatedAt: -1 }).session(session ?? null);
    if (!decl) throw new BusinessRuleError("Enregistrez d'abord la déclaration du mois.");
    const d = await vatDueOf(auth.tenantId, annee, mois, session);
    if (!d.settled) throw new BusinessRuleError("Passez d'abord la liquidation du mois : la TVA due est au 4441.");
    // Liquidation périmée (comptabilité du mois modifiée depuis) : on paierait un montant faux.
    const entries = await AccountingEntryModel.find({ tenantId: auth.tenantId, entryDate: { $gte: new Date(annee, mois - 1, 1), $lte: new Date(annee, mois, 0, 23, 59, 59, 999) }, ...VAT_LINES_MATCH })
      .session(session ?? null).lean<Array<{ journalCode?: string; lines: Array<{ accountCode: string; debit?: number; credit?: number }> }>>();
    if (Math.abs(vatFromEntries(entries).net - d.settledNet) >= 1) throw new BusinessRuleError("La comptabilité du mois a changé depuis la liquidation : repassez la liquidation avant d'enregistrer le paiement.");
    if (date < new Date(annee, mois, 1)) throw new BusinessRuleError("La date du paiement précède la fin du mois déclaré.");
    if (d.remaining <= 0) throw new BusinessRuleError(d.due > 0 ? "TVA du mois déjà payée (y compris par une saisie au 4441)." : "Rien à verser ce mois-ci (crédit de TVA).");
    const ledger = await treasuryLedger(auth.tenantId, body.treasuryAccountId, session);
    if (!ledger) throw new BusinessRuleError("Compte de trésorerie introuvable.");
    const ref = `PAY-${settlementReference(annee, mois)}`;
    const label = `Paiement de la TVA de ${String(mois).padStart(2, "0")}/${annee}${reference ? ` — ${reference}` : ""}`;
    const [entry] = await AccountingEntryModel.create([{
      tenantId: auth.tenantId, journalCode: ledger.journalCode, entryDate: date, reference: ref, label,
      lines: [{ ...VAT_DUE, debit: d.remaining, credit: 0 }, { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: 0, credit: d.remaining }],
      linkedDocType: "vat_payment", linkedDocId: decl._id, createdBy: auth.userId,
    }], { session });
    await TreasuryMovementModel.create([{
      tenantId: auth.tenantId, accountId: body.treasuryAccountId, date, amount: -d.remaining, label, reference: reference || ref,
      source: "manual", linkedDocType: "vat_payment", linkedDocId: decl._id, entryId: entry._id, createdBy: auth.userId,
    }], { session });
    decl.status = "paid"; decl.paidAt = date; if (reference) decl.reference = reference;
    await decl.save({ session });
    return { amount: d.remaining, entryId: entry._id, declarationId: decl._id };
  });
  await logAudit(auth, "UPDATE", "fiscalDeclarations", { resourceId: String(result.declarationId), after: { type: "tva", annee, mois, status: "paid", amount: result.amount, reference } });
  return ok(result);
});
