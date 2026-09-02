import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

// POST /api/accounting-entries/lettrage
// Body: { entryIds: string[], letterRef: string }
export const POST = withAuth("accountingEntries", "update", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json();
  if (!body.entryIds || !Array.isArray(body.entryIds) || body.entryIds.length < 2) {
    return badRequest("Au moins 2 entrées requises pour le lettrage");
  }
  if (!body.letterRef) return badRequest("Référence de lettrage requise");

  await connectDB();

  const entries = await AccountingEntryModel.find({
    _id: { $in: body.entryIds },
    ...tenantFilter(auth),
  });

  if (entries.length !== body.entryIds.length) {
    return badRequest("Certaines écritures sont introuvables ou n'appartiennent pas à cette organisation");
  }

  // Vérification équilibre du lettrage (∑débits = ∑crédits sur les comptes lettrés)
  let totalDebit = 0;
  let totalCredit = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.accountCode.startsWith("4")) { // Comptes tiers (clients/fournisseurs)
        totalDebit += line.debit;
        totalCredit += line.credit;
      }
    }
  }
  if (Math.abs(totalDebit - totalCredit) > 1) {
    return badRequest(
      `Lettrage déséquilibré sur comptes tiers : débits=${totalDebit} ≠ crédits=${totalCredit}`
    );
  }

  // Appliquer le lettrage
  await AccountingEntryModel.updateMany(
    { _id: { $in: body.entryIds } },
    { $set: { isLettered: true, letterRef: body.letterRef } }
  );

  await logAudit(auth, "UPDATE", "accountingEntries", {
    metadata: { action: "lettrage", entryIds: body.entryIds, letterRef: body.letterRef },
  });

  return ok({ message: `${entries.length} écritures lettrées avec la référence '${body.letterRef}'` });
});

// DELETE /api/accounting-entries/lettrage  — Annuler un lettrage
export const DELETE = withAuth("accountingEntries", "update", async (req: NextRequest, auth: TokenPayload) => {
  const url = new URL(req.url);
  const letterRef = url.searchParams.get("ref");
  if (!letterRef) return badRequest("Référence de lettrage requise (?ref=…)");

  await connectDB();

  const result = await AccountingEntryModel.updateMany(
    { ...tenantFilter(auth), letterRef },
    { $set: { isLettered: false }, $unset: { letterRef: "" } }
  );

  await logAudit(auth, "UPDATE", "accountingEntries", {
    metadata: { action: "delettrage", letterRef, count: result.modifiedCount },
  });

  return ok({ message: `Lettrage '${letterRef}' annulé sur ${result.modifiedCount} écriture(s)` });
});
