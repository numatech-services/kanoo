import { NextRequest } from "next/server";
import { isCurrency } from "@/lib/currency";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, notFound, noContent, badRequest, tenantFilter } from "@/lib/api-helpers";
import { nextLedgerCode, registerLedgerAccount, assignLedgerCode } from "@/lib/treasury";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { accountBalance } from "@/lib/treasury";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("treasuryAccounts", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const item = await TreasuryAccountModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean<Record<string, unknown> | null>();
  if (!item) return notFound();
  const bal = await accountBalance(auth.tenantId, params.id);
  return ok({ ...item, balance: bal?.balance ?? 0 });
});

/**
 * PATCH — libellé, banque, numéro, activation. Type et solde d'ouverture ne
 * changent plus une fois des mouvements enregistrés (le solde en dépend).
 */
export const PATCH = withAuth("treasuryAccounts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const acc = await TreasuryAccountModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!acc) return notFound();
  const hasMoves = !!(await TreasuryMovementModel.exists({ tenantId: auth.tenantId, accountId: acc._id }));
  if ("label" in body) { const l = String(body.label ?? "").trim(); if (!l) return badRequest("Libellé obligatoire."); acc.label = l.slice(0, 120); }
  for (const k of ["bankName", "accountNumber"]) if (k in body) acc.set(k, String(body[k] ?? "").slice(0, 80));
  // Ligne de cautions accordée par la banque (plafond des cautions en cours).
  if ("guaranteeLimit" in body) {
    const v = body.guaranteeLimit === null || body.guaranteeLimit === "" ? undefined : Number(body.guaranteeLimit);
    if (v !== undefined && !(v >= 0 && v <= 1e13)) return badRequest("Plafond de cautions invalide.");
    acc.set("guaranteeLimit", v);
  }
  if ("isActive" in body) acc.isActive = !!body.isActive;
  if ("currency" in body) { if (!isCurrency(body.currency)) return badRequest("Devise inconnue."); acc.set("currency", body.currency); }
  if ("exchangeRate" in body) acc.set("exchangeRate", Number(body.exchangeRate) > 0 ? Number(body.exchangeRate) : undefined);
  if ("type" in body || "openingBalance" in body || "openingDate" in body) {
    if (hasMoves) return badRequest("Des mouvements existent : le type et le solde d'ouverture ne se modifient plus (passez une écriture d'ajustement).");
    if (body.type && ["bank", "cash", "mobile_money"].includes(body.type) && body.type !== acc.type) {
      acc.type = body.type;
      // Sans mouvement, le compte comptable suit le nouveau type (5211 → 5711…).
      if (acc.ledgerCode) {
        acc.ledgerCode = await nextLedgerCode(auth.tenantId, body.type);
        await registerLedgerAccount(auth.tenantId, acc.ledgerCode, acc.label);
      }
    }
    if ("openingBalance" in body) acc.openingBalance = Number(body.openingBalance) || 0;
    if (body.openingDate) acc.openingDate = new Date(body.openingDate);
  }
  await acc.save();
  // Compte ancien sur le compte général : attribution d'un compte dédié, avec
  // reclassement de son solde comptable (lib/treasury, assignLedgerCode).
  if (body.assignLedgerCode && !acc.ledgerCode) {
    const r = await withTransaction(session => assignLedgerCode({ tenantId: auth.tenantId, userId: auth.userId }, acc._id, session));
    await logAudit(auth, "UPDATE", "treasuryAccounts", { resourceId: params.id, after: { ledgerCode: r.code, reclassed: r.reclassed } });
    return ok({ ...(await TreasuryAccountModel.findById(acc._id).lean()), reclassed: r.reclassed });
  }
  await logAudit(auth, "UPDATE", "treasuryAccounts", { resourceId: params.id });
  return ok(acc);
});

/** DELETE — un compte sans mouvement ; sinon, le désactiver (l'historique reste). */
export const DELETE = withAuth("treasuryAccounts", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const acc = await TreasuryAccountModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!acc) return notFound();
  if (await TreasuryMovementModel.exists({ tenantId: auth.tenantId, accountId: acc._id })) {
    return badRequest("Ce compte a des mouvements : désactivez-le plutôt que de le supprimer.");
  }
  await TreasuryAccountModel.deleteOne({ _id: acc._id });
  await logAudit(auth, "DELETE", "treasuryAccounts", { resourceId: params.id, before: { label: acc.label } });
  return noContent();
});
