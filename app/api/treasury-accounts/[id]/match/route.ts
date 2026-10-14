import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, conflict, tenantFilter } from "@/lib/api-helpers";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { BankStatementLineModel } from "@/models/BankStatementLine";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/treasury-accounts/:id/match
 *
 * Apparie ou dissocie un mouvement et une ligne de relevé.
 *
 *   { action: "match",   movementId, lineId }
 *   { action: "unmatch", movementId }
 *   { action: "ignore",  lineId, reason }
 *
 * L'appariement est bilatéral et se fait dans une transaction : un mouvement
 * qui pointe une ligne alors que la ligne ne le sait pas produirait un écart
 * fantôme, impossible à diagnostiquer depuis l'écran.
 */
export const POST = withAuth("treasuryAccounts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();

  const body = await req.json().catch(() => ({}));
  const accountId = String(params.id);
  const scope = { ...tenantFilter(auth), accountId };

  // ── Dissocier ──────────────────────────────────────────────────────────
  if (body.action === "unmatch") {
    const movement = await TreasuryMovementModel.findOne({ _id: body.movementId, ...scope });
    if (!movement) return notFound("Mouvement introuvable");
    if (!movement.statementLineId) return badRequest("Ce mouvement n'est pas rapproché.");

    const lineId = movement.statementLineId;
    await withTransaction(async (session) => {
      await TreasuryMovementModel.updateOne(
        { _id: movement._id, ...scope },
        { $unset: { statementLineId: "", reconciledAt: "", reconciledBy: "" } },
        { session }
      );
      await BankStatementLineModel.updateOne(
        { _id: lineId, ...scope },
        { $unset: { movementId: "", reconciledAt: "" } },
        { session }
      );
    });

    await logAudit(auth, "UPDATE", "treasuryAccounts", {
      resourceId: accountId,
      metadata: { action: "unmatch", movementId: String(movement._id) },
    });
    return ok({ unmatched: true });
  }

  // ── Écarter une ligne ──────────────────────────────────────────────────
  if (body.action === "ignore") {
    const reason = String(body.reason || "").trim();
    if (!reason) {
      return badRequest("Indiquez pourquoi cette ligne est écartée : sans motif, l'écart reste inexpliqué.");
    }
    const line = await BankStatementLineModel.findOne({ _id: body.lineId, ...scope });
    if (!line) return notFound("Ligne de relevé introuvable");
    if (line.movementId) return conflict("Cette ligne est rapprochée : dissociez-la d'abord.");

    line.ignoredAt = new Date();
    line.ignoreReason = reason;
    await line.save();

    await logAudit(auth, "UPDATE", "treasuryAccounts", {
      resourceId: accountId,
      metadata: { action: "ignore_line", lineId: String(line._id), reason },
    });
    return ok({ ignored: true });
  }

  // ── Apparier ───────────────────────────────────────────────────────────
  const [movement, line] = await Promise.all([
    TreasuryMovementModel.findOne({ _id: body.movementId, ...scope }),
    BankStatementLineModel.findOne({ _id: body.lineId, ...scope }),
  ]);
  if (!movement) return notFound("Mouvement introuvable");
  if (!line) return notFound("Ligne de relevé introuvable");

  if (movement.statementLineId) return conflict("Ce mouvement est déjà rapproché.");
  if (line.movementId) return conflict("Cette ligne est déjà rapprochée.");
  if (line.ignoredAt) return conflict("Cette ligne a été écartée du rapprochement.");

  // Le montant est éliminatoire, y compris sur un appariement manuel : deux
  // opérations de montants différents ne sont pas la même, et laisser passer
  // ferait disparaître un écart réel de l'écran.
  if (movement.amount !== line.amount) {
    return badRequest(
      `Montants différents : ${movement.amount.toLocaleString("fr-FR")} FCFA au mouvement, `
      + `${line.amount.toLocaleString("fr-FR")} FCFA au relevé. Corrigez le mouvement ou écartez la ligne.`
    );
  }

  const now = new Date();
  await withTransaction(async (session) => {
    // Les filtres exigent que les deux soient encore libres : deux
    // rapprochements simultanés sur la même ligne ne peuvent pas aboutir.
    const m = await TreasuryMovementModel.updateOne(
      { _id: movement._id, ...scope, statementLineId: { $exists: false } },
      { $set: { statementLineId: line._id, reconciledAt: now, reconciledBy: auth.userId } },
      { session }
    );
    const l = await BankStatementLineModel.updateOne(
      { _id: line._id, ...scope, movementId: { $exists: false } },
      { $set: { movementId: movement._id, reconciledAt: now } },
      { session }
    );
    if (m.modifiedCount === 0 || l.modifiedCount === 0) {
      throw new Error("Un autre rapprochement est intervenu entre-temps. Rechargez l'écran.");
    }
  });

  await logAudit(auth, "UPDATE", "treasuryAccounts", {
    resourceId: accountId,
    metadata: {
      action: "match",
      movementId: String(movement._id),
      lineId: String(line._id),
      amount: movement.amount,
    },
  });

  return ok({ matched: true, amount: movement.amount });
});
