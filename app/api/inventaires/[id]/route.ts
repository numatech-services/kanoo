import { NextRequest } from "next/server";
import { withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, conflict, tenantFilter } from "@/lib/api-helpers";
import { InventoryCountModel } from "@/models/InventoryCount";
import { ProductModel } from "@/models/Product";
import { StockMovementModel } from "@/models/StockMovement";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import {
  evaluateLine, summarizeCount, validationBlockers, adjustmentEntry, isBalanced,
  rankVariances, BLOCK_MESSAGES, type CountLine, type CountPolicy,
} from "@/lib/inventory";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface Session {
  _id: unknown;
  reference: string;
  label: string;
  status: string;
  blind: boolean;
  recountThresholdQty: number;
  recountThresholdPercent: number;
  reasonThresholdValue: number;
  lines: Array<CountLine & { _id: unknown }>;
}

const policyOf = (session: Session): CountPolicy => ({
  recountThresholdQty: session.recountThresholdQty,
  recountThresholdPercent: session.recountThresholdPercent,
  reasonThresholdValue: session.reasonThresholdValue,
  blind: session.blind,
});

export const GET = withAuth("products", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const session = await InventoryCountModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .lean<Session | null>();
  if (!session) return notFound("Inventaire introuvable");

  const policy = policyOf(session);
  const open = session.status === "counting";

  // En comptage aveugle, le théorique **ne sort pas du serveur** : le masquer
  // à l'écran ne servirait à rien, il suffirait d'ouvrir l'inspecteur. Il
  // réapparaît en revue, une fois le relevé fait.
  const lines = session.lines.map(line => {
    const result = evaluateLine(line, policy);
    const hidden = session.blind && open;
    return {
      ...line,
      theoreticalQty: hidden ? null : line.theoreticalQty,
      unitCost: hidden ? null : line.unitCost,
      variance: hidden ? null : result.variance,
      varianceValue: hidden ? null : result.varianceValue,
      needsRecount: hidden ? false : result.needsRecount,
      needsReason: hidden ? false : result.needsReason,
      counted: result.counted,
    };
  });

  return ok({
    session: { ...session, lines: undefined },
    lines,
    policy,
    // La synthèse reste chiffrée même en aveugle : elle ne révèle aucune
    // quantité ligne à ligne, et le responsable a besoin de savoir où il en est.
    summary: summarizeCount(session.lines, policy),
    blockers: validationBlockers(session.lines, policy).map(b => ({ code: b, message: BLOCK_MESSAGES[b] })),
    topVariances: open && session.blind ? [] : rankVariances(session.lines, policy),
  });
});

/**
 * PATCH — relever une ligne, passer en revue, ou valider.
 *
 *   { lineId, countedQty }              premier relevé
 *   { lineId, recountQty }              second comptage
 *   { lineId, reason }                  motif d'un écart
 *   { status: "review" }                fin du comptage, on regarde les écarts
 *   { status: "validated" }             écriture du stock et de la comptabilité
 *   { status: "cancelled" }             abandon
 */
export const PATCH = withAuth("products", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json().catch(() => ({}));
  const session = await InventoryCountModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!session) return notFound("Inventaire introuvable");

  if (session.status === "validated") {
    return conflict(
      "Cet inventaire est validé : il a produit des mouvements de stock et une "
      + "écriture comptable. Ouvrez-en un nouveau plutôt que de le rejouer."
    );
  }
  if (session.status === "cancelled") return conflict("Cet inventaire a été annulé.");

  // ── Relevé d'une ligne ───────────────────────────────────────────────────
  if (body.lineId) {
    const line = session.lines.id(body.lineId);
    if (!line) return notFound("Ligne introuvable");

    if (body.countedQty !== undefined) {
      const value = body.countedQty === null ? null : Number(body.countedQty);
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        return badRequest("Quantité comptée invalide.");
      }
      line.countedQty = value;
      line.countedBy = auth.userId;
      line.countedAt = new Date();
    }
    if (body.recountQty !== undefined) {
      const value = body.recountQty === null ? null : Number(body.recountQty);
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        return badRequest("Quantité recomptée invalide.");
      }
      line.recountQty = value;
      line.recountedBy = auth.userId;
    }
    if (body.reason !== undefined) line.reason = String(body.reason).slice(0, 300);

    await session.save();
    const policy = policyOf(session as unknown as Session);
    const result = evaluateLine(line as unknown as CountLine, policy);

    return ok({
      // En aveugle, on ne renvoie pas l'écart : ce serait montrer le théorique
      // par la bande.
      ...(session.blind && session.status === "counting"
        ? { counted: result.counted }
        : result),
      summary: summarizeCount(session.lines as unknown as CountLine[], policy),
    });
  }

  // ── Changement d'état ────────────────────────────────────────────────────
  const to = String(body.status || "");
  const policy = policyOf(session as unknown as Session);
  const lines = session.lines as unknown as CountLine[];

  if (to === "review") {
    session.status = "review";
    await session.save();
    return ok({ status: "review", summary: summarizeCount(lines, policy) });
  }

  if (to === "counting") {
    session.status = "counting";
    await session.save();
    return ok({ status: "counting" });
  }

  if (to === "cancelled") {
    session.status = "cancelled";
    session.cancelledAt = new Date();
    await session.save();
    await logAudit(auth, "UPDATE", "products", {
      resourceId: String(params.id),
      metadata: { module: "inventaire", action: "cancelled", reference: session.reference },
    });
    return ok({ status: "cancelled", message: "Inventaire annulé. Aucun stock n'a été modifié." });
  }

  if (to === "validated") {
    const blockers = validationBlockers(lines, policy);
    if (blockers.length > 0) return badRequest(BLOCK_MESSAGES[blockers[0]]);

    const summary = summarizeCount(lines, policy);
    const entry = adjustmentEntry(lines, policy);
    if (entry.length > 0 && !isBalanced(entry)) {
      return badRequest("Écriture de régularisation déséquilibrée : vérifiez les coûts unitaires.");
    }

    const now = new Date();

    // Stock, mouvements et écriture dans la même transaction. Un stock corrigé
    // sans mouvement laisserait un écart inexpliqué au prochain inventaire, et
    // sans écriture, un résultat comptable qui ignore une perte réelle.
    await withTransaction(async (session_) => {
      for (const line of session.lines) {
        const result = evaluateLine(line as unknown as CountLine, policy);
        if (!result.counted || result.variance === 0 || result.finalQty === null) continue;

        await ProductModel.updateOne(
          { _id: line.productId, ...tenantFilter(auth) },
          { $set: { stockQty: result.finalQty } },
          { session: session_ }
        );

        await StockMovementModel.create([{
          tenantId: auth.tenantId,
          productId: line.productId,
          type: "adjustment",
          quantity: result.variance,
          quantityBefore: line.theoreticalQty,
          quantityAfter: result.finalQty,
          reason: line.reason?.trim() || `Inventaire ${session.reference}`,
          linkedDocType: "manual",
          linkedDocId: session._id,
          linkedDocNumber: session.reference,
          unitCost: line.unitCost ?? 0,
          createdBy: auth.userId,
        }], { session: session_ });
      }

      if (entry.length > 0) {
        await AccountingEntryModel.create([{
          tenantId: auth.tenantId,
          journalCode: "OD",
          entryDate: now,
          reference: session.reference,
          label: `Régularisation d'inventaire ${session.reference} — ${session.label}`,
          lines: entry,
          linkedDocType: "supplier_invoice",
          linkedDocId: session._id,
          createdBy: auth.userId,
        }], { session: session_ });
      }

      await InventoryCountModel.updateOne(
        { _id: session._id, ...tenantFilter(auth), status: { $ne: "validated" } },
        { $set: {
          status: "validated", validatedAt: now, validatedBy: auth.userId,
          shortageValue: summary.shortageValue,
          surplusValue: summary.surplusValue,
          accuracy: summary.accuracy,
        } },
        { session: session_ }
      );
    });

    await logAudit(auth, "UPDATE", "products", {
      resourceId: String(params.id),
      metadata: {
        module: "inventaire", action: "validated", reference: session.reference,
        shortage: summary.shortageValue, surplus: summary.surplusValue,
        accuracy: summary.accuracy,
      },
    });

    return ok({
      status: "validated",
      summary,
      message: summary.withVariance === 0
        ? "Inventaire validé : aucun écart, le stock était juste."
        : `Inventaire validé. ${summary.withVariance} écart(s) régularisé(s), `
          + `${summary.shortageValue.toLocaleString("fr-FR")} XOF de manquants et `
          + `${summary.surplusValue.toLocaleString("fr-FR")} XOF d'excédents.`,
    });
  }

  return badRequest("Action inconnue.");
});
