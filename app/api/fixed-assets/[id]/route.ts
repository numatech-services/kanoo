import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { treasuryLedger, recordMovement } from "@/lib/treasury";
import { FixedAssetModel } from "@/models/FixedAsset";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { logAudit } from "@/lib/audit";
import { postDepreciation, DepreciationError } from "@/lib/fixed-asset-posting";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("fixedAssets", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const asset = await FixedAssetModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!asset) return notFound();
  return ok(asset);
});

export const PATCH = withAuth("fixedAssets", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json();

  // Dotation d'une annuité : même chemin que l'écran et l'automatisation
  // (lib/fixed-asset-posting) — annuité réservée avant l'écriture, donc une
  // seule dotation même sur double appel, et extourne possible. L'ancienne
  // version écrivait sans garde ni lien vers l'immobilisation.
  if (body.action === "post_depreciation") {
    const year = Number(body.year) || new Date().getFullYear();
    try {
      const r = await withTransaction(session => postDepreciation({ tenantId: auth.tenantId, userId: auth.userId }, params.id, year, session));
      await logAudit(auth, "UPDATE", "fixedAssets", { resourceId: params.id, after: { action: "depreciation_posted", year, amount: r.annuity } });
      return ok({ message: `Dotation ${r.annuity.toLocaleString("fr-FR")} FCFA passée en comptabilité`, entry: r.accountingEntry });
    } catch (e) {
      if (e instanceof DepreciationError) return e.notFound ? notFound(e.message) : badRequest(e.message);
      throw e;
    }
  }

  // Cession / mise au rebut : sortie de l'actif en comptabilité.
  if (body.action === "dispose") {
    const asset = await FixedAssetModel.findOne({ _id: params.id, ...tenantFilter(auth) });
    if (!asset) return notFound();
    if (asset.status === "disposed") return badRequest("Immobilisation déjà sortie de l'actif.");
    const date = body.date ? new Date(body.date) : new Date();
    if (isNaN(date.getTime())) return badRequest("Date invalide.");
    const reason = ["sale", "scrap", "transfer", "other"].includes(body.reason) ? body.reason : "other";
    const price = Math.max(0, Math.round(Number(body.price) || 0));
    const postedCum = (asset.depreciationSchedule ?? []).filter((e: { posted?: boolean }) => e.posted)
      .reduce((m: number, e: { cumulative: number }) => Math.max(m, e.cumulative), 0);
    // Dotation complémentaire de l'année de sortie, au prorata jusqu'à la date
    // de cession (mois commencé compté) : sans elle, la VNC sortie de l'actif
    // était surévaluée de l'amortissement de l'année.
    const yearRow = (asset.depreciationSchedule ?? []).find((e: { year: number; posted?: boolean; annuity: number }) => e.year === date.getFullYear() && !e.posted && e.annuity > 0) as { year: number; annuity: number } | undefined;
    const acq = new Date(asset.acquisitionDate);
    const sameYear = acq.getFullYear() === date.getFullYear();
    const covered = sameYear ? 12 - acq.getMonth() : 12;
    const held = sameYear ? date.getMonth() - acq.getMonth() + 1 : date.getMonth() + 1;
    const complement = yearRow ? Math.min(Math.round(yearRow.annuity * Math.max(0, held) / covered), Math.max(0, asset.acquisitionCost - postedCum)) : 0;
    const cumulated = postedCum + complement;
    const vnc = Math.max(0, asset.acquisitionCost - cumulated);
    let ledger: { accountCode: string; accountLabel: string } = { accountCode: "485000", accountLabel: "Créances sur cessions d'immobilisations" };
    if (price > 0 && body.treasuryAccountId) {
      const tl = await treasuryLedger(auth.tenantId, body.treasuryAccountId);
      if (!tl) return badRequest("Compte de trésorerie introuvable.");
      ledger = tl;
    }
    await withTransaction(async session => {
      if (complement > 0) {
        await AccountingEntryModel.create([{
          tenantId: auth.tenantId, journalCode: "OD", entryDate: date, reference: `CESS-AMT-${asset.code}-${date.getFullYear()}`,
          label: `Dotation complémentaire (prorata jusqu'à la sortie) — ${asset.name}`,
          lines: [
            { accountCode: asset.dotationAccount || "681", accountLabel: "Dotations aux amortissements", debit: complement, credit: 0 },
            { accountCode: asset.depreciationAccount || "28", accountLabel: `Amort. ${asset.name}`, debit: 0, credit: complement },
          ],
          linkedDocType: "fixed_asset", linkedDocId: asset._id, createdBy: auth.userId,
        }], { session });
        await FixedAssetModel.updateOne({ _id: asset._id, "depreciationSchedule.year": date.getFullYear() },
          { $set: { "depreciationSchedule.$.posted": true, "depreciationSchedule.$.postedAt": new Date(), "depreciationSchedule.$.annuity": complement } }, { session });
      }
      const lines = [
        ...(cumulated > 0 ? [{ accountCode: asset.depreciationAccount || "28", accountLabel: `Amortissements ${asset.name}`, debit: cumulated, credit: 0 }] : []),
        ...(vnc > 0 ? [{ accountCode: "812000", accountLabel: "Valeur comptable des cessions d'immobilisations", debit: vnc, credit: 0 }] : []),
        { accountCode: asset.accountCode || "24", accountLabel: asset.name, debit: 0, credit: asset.acquisitionCost },
        ...(price > 0 ? [
          { accountCode: ledger.accountCode, accountLabel: ledger.accountLabel, debit: price, credit: 0 },
          { accountCode: "822000", accountLabel: "Produits des cessions d'immobilisations", debit: 0, credit: price },
        ] : []),
      ];
      await AccountingEntryModel.create([{
        tenantId: auth.tenantId, journalCode: "OD", entryDate: date, reference: `CESS-${asset.code}`,
        label: `${reason === "sale" ? "Cession" : "Sortie"} de l'immobilisation ${asset.name}`, lines,
        linkedDocType: "fixed_asset", linkedDocId: asset._id, createdBy: auth.userId,
      }], { session });
      if (price > 0 && body.treasuryAccountId) {
        await recordMovement({ tenantId: auth.tenantId, accountId: String(body.treasuryAccountId), date, amount: price, label: `Cession ${asset.name}`, source: "manual", linkedDocType: "manual", createdBy: auth.userId }, session);
      }
      asset.set({ status: "disposed", disposalDate: date, disposalValue: price, disposalReason: reason, currentNetValue: 0 });
      await asset.save({ session });
    });
    await logAudit(auth, "UPDATE", "fixedAssets", { resourceId: params.id, after: { action: "disposed", price, vnc } });
    return ok({ message: `Immobilisation sortie de l'actif (VNC ${vnc.toLocaleString("fr-FR")} FCFA, prix ${price.toLocaleString("fr-FR")} FCFA)` });
  }

  // Fiche : descriptif seulement — valeur, durée et plan d'amortissement ne se
  // réécrivent pas (ils ont déjà produit des écritures).
  const EDITABLE = ["name", "description", "location", "serialNumber", "supplier", "invoiceRef", "notes"];
  const set = Object.fromEntries(Object.entries(sanitizeBody(body)).filter(([k]) => EDITABLE.includes(k)));
  const updated = await FixedAssetModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { $set: set }, { new: true });
  if (!updated) return notFound();
  await logAudit(auth, "UPDATE", "fixedAssets", { resourceId: params.id, after: set });
  return ok(updated);
});
