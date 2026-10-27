import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { reverseEntry } from "@/lib/accounting-reversal";
import { OPENING_REFERENCE, resetTreasuryOpening } from "@/lib/opening-balances";
import { logAudit } from "@/lib/audit";
import { unpostDepreciation } from "@/lib/fixed-asset-posting";
import { TokenPayload } from "@/lib/auth";

/**
 * POST — { reason, date? } : extourne d'une écriture SAISIE À LA MAIN. Une
 * écriture produite par un document (facture, paie, achat…) s'annule depuis
 * ce document, pour que document et comptabilité restent d'accord.
 */
export const POST = withAuth("accountingEntries", "delete", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const reason = String(body.reason ?? "").trim();
  if (!reason) return badRequest("Indiquez le motif de l'extourne.");
  const e = await AccountingEntryModel.findOne({ _id: params.id, ...tenantFilter(auth) }).select("linkedDocType linkedDocId reference").lean<{ linkedDocType?: string; linkedDocId?: unknown; reference: string } | null>();
  if (!e) return notFound();
  // La reprise des soldes d'ouverture s'extourne ici pour pouvoir être refaite.
  const opening = e.reference === OPENING_REFERENCE && e.linkedDocType === "closing";
  // Écritures d'inventaire produites sans document à annuler : la variation
  // de stock et la dotation aux amortissements. Le message « extournez-la pour
  // la refaire » renvoyait à une action impossible.
  const stockVariation = e.linkedDocType === "inventory" && e.reference.startsWith("VAR-STOCK-");
  const dotation = e.linkedDocType === "fixed_asset" && e.reference.startsWith("AMT-");
  if (e.linkedDocType && e.linkedDocType !== "manual" && !opening && !stockVariation && !dotation) {
    return badRequest("Écriture produite par un document : annulez le document (facture, achat, bulletin…) pour l'extourner.");
  }
  const mirror = await withTransaction(async session => {
    const m = await reverseEntry({
      tenantId: auth.tenantId, userId: auth.userId, entryId: params.id, reason, date: body.date ? new Date(body.date) : undefined,
    }, session);
    if (opening) await resetTreasuryOpening(auth.tenantId, params.id, session);
    // Dotation annulée : l'annuité redevient « à passer », la valeur nette
    // revient à celle de l'année précédente.
    if (dotation && e.linkedDocId) await unpostDepreciation(auth.tenantId, e.linkedDocId, params.id, session);
    return m;
  });
  await logAudit(auth, "UPDATE", "accountingEntries", { resourceId: params.id, metadata: { reversed: true, reason } });
  return created(mirror);
});
