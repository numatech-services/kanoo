import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { InvoiceModel } from "@/models/Invoice";
import { provisionsOverview, markDoubtful, adjustProvision, writeOff, adjustAllProvisions } from "@/lib/doubtful-server";
import { BusinessRuleError } from "@/lib/errors";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** GET — créances en retard de 90 jours et plus, créances douteuses et leur dépréciation. */
export const GET = withAuth("accountingEntries", "read", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  return ok(await provisionsOverview(auth.tenantId));
});

/**
 * POST
 *  - { action: "doubtful", invoiceId, rate?, date? } : 411 → 416 et dépréciation
 *  - { action: "provision", invoiceId, rate, date? } : nouveau taux, dotation ou reprise
 *  - { action: "writeoff", invoiceId, date?, recoverVat? } : perte définitive (651), TVA régularisée
 *  - { action: "adjust_all", date? } : toutes les dépréciations recalées sur le reste dû
 */
export const POST = withAuth("accountingEntries", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const actor = { tenantId: auth.tenantId, userId: auth.userId };
  const date = body.date ? new Date(String(body.date)) : new Date();
  if (isNaN(date.getTime())) return badRequest("Date invalide.");
  try {
    const result = await withTransaction(async session => {
      switch (body.action) {
        case "doubtful": return markDoubtful(actor, String(body.invoiceId ?? ""), body, session);
        case "writeoff": return writeOff(actor, String(body.invoiceId ?? ""), body, session);
        case "adjust_all": return adjustAllProvisions(actor, date, session);
        case "provision": {
          const inv = Types.ObjectId.isValid(String(body.invoiceId)) ? await InvoiceModel.findOne({ _id: body.invoiceId, tenantId: auth.tenantId }).session(session ?? null) : null;
          if (!inv) throw new BusinessRuleError("Facture introuvable.");
          return adjustProvision(actor, inv, Number(body.rate), date, session);
        }
        default: throw new BusinessRuleError("Action inconnue.");
      }
    });
    await logAudit(auth, "UPDATE", "accountingEntries", { resourceId: body.invoiceId ? String(body.invoiceId) : undefined, metadata: { provisions: body.action, result } });
    return ok(result);
  } catch (e) {
    if (e instanceof BusinessRuleError) return badRequest(e.message);
    throw e;
  }
});
