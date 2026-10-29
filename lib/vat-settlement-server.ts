import type { Types } from "mongoose";
import { withTransaction } from "@/lib/db";
import { authCan } from "@/lib/role-resources";
import { logAudit } from "@/lib/audit";
import { postVatSettlement } from "@/lib/vat-settlement";
import type { TokenPayload } from "@/lib/auth";

export interface SettlementResult { due: number; creditUsed: number; creditCarried: number; entryId: unknown }

/**
 * Liquidation de la TVA d'un mois au nom de l'utilisateur : il doit avoir le
 * droit de passer des écritures (la déclaration seule ne suffit pas). Le refus
 * revient en avertissement lisible, jamais en erreur qui annulerait la déclaration.
 */
export async function settleVatMonth(auth: TokenPayload, annee: number, mois: number, declarationId?: Types.ObjectId | unknown): Promise<{ settlement: SettlementResult | null; warning?: string }> {
  if (!authCan(auth, "accountingEntries", "create")) return { settlement: null, warning: "votre profil ne permet pas de passer des écritures comptables (demandez au comptable)." };
  try {
    // Première écriture d'une base neuve (collection du plan créée dans la transaction) :
    // erreur transitoire de MongoDB, une seconde tentative suffit.
    const run = () => withTransaction(session => postVatSettlement({ tenantId: auth.tenantId, userId: auth.userId }, annee, mois, { declarationId }, session));
    const r = await run().catch((err: { errorLabels?: string[]; message?: string }) => {
      if (err?.errorLabels?.includes("TransientTransactionError") || /already in use|catalog changes/i.test(err?.message ?? "")) return run();
      throw err;
    });
    await logAudit(auth, "CREATE", "accountingEntries", { resourceId: r.entryId ? String(r.entryId) : undefined, metadata: { document: "liquidation-tva", annee, mois, due: r.due, creditUsed: r.creditUsed, creditCarried: r.creditCarried } });
    return { settlement: { due: r.due, creditUsed: r.creditUsed, creditCarried: r.creditCarried, entryId: r.entryId } };
  } catch (err) {
    return { settlement: null, warning: err instanceof Error ? err.message : String(err) };
  }
}
