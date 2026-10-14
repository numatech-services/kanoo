import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { isInternFor, INTERN_EXPORT_MESSAGE } from "@/lib/role-resources";
import { TenantModel } from "@/models/Tenant";
import { BankGuaranteeModel } from "@/models/BankGuarantee";
import { financialStatements } from "@/lib/financial-statements-server";
import { annexNotes, buildFinancialStatementsXlsx } from "@/lib/financial-statements-xlsx";

export const dynamic = "force-dynamic";

/**
 * GET ?annee=2026[&format=xlsx] — états financiers SYSCOHADA de l'exercice :
 * bilan, compte de résultat (N et N-1), tableau des flux de trésorerie, notes
 * annexes principales ; en Excel, la liasse prête pour la DSF.
 */
export const GET = withAuth("accountingEntries", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("annee") ?? new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > new Date().getFullYear()) return badRequest("Exercice invalide.");
  const asXlsx = url.searchParams.get("format") === "xlsx";
  if (asXlsx && isInternFor(auth, "accountingEntries")) return forbidden(INTERN_EXPORT_MESSAGE);

  // Exercice entier, écritures datées de fin de période comprises (inventaire, variation de stock).
  const fs = await financialStatements(auth.tenantId, year);
  // Cautions en cours à la clôture : émises avant, ni levées ni appelées avant.
  const guarantees = await BankGuaranteeModel.find({
    tenantId: auth.tenantId, issueDate: { $lte: fs.asOf },
    $or: [{ status: "active" }, { releasedAt: { $gt: fs.asOf } }, { calledAt: { $gt: fs.asOf } }],
  }).select("type amount beneficiary expiryDate").lean<Array<{ type: string; amount: number; beneficiary: string; expiryDate?: Date }>>();
  const notes = annexNotes(fs, fs.balancesPrev, guarantees);

  if (asXlsx) {
    const tenant = await TenantModel.findById(auth.tenantId).select("name nif rccm address").lean<{ name?: string; nif?: string; rccm?: string; address?: string } | null>();
    const buf = await buildFinancialStatementsXlsx(fs, notes, tenant ?? {});
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="etats-financiers-${year}.xlsx"`,
      },
    });
  }
  // Contrôles de vraisemblance : un compte qui ne peut pas avoir ce sens de solde.
  const warnings: string[] = [];
  const stock = fs.balances.filter(r => /^3[0-8]/.test(r.code)).reduce((t, r) => t + r.debit - r.credit, 0);
  if (stock < 0) warnings.push(`Stocks créditeurs (${stock.toLocaleString("fr-FR")} FCFA) : passez la variation de stock de fin de période (Comptabilité › Écritures, bouton « Variation de stock »).`);
  const cashNegative = fs.balances.filter(r => /^57/.test(r.code) && r.debit - r.credit < 0);
  if (cashNegative.length) warnings.push(`Caisse créditrice (${cashNegative.map(r => r.code).join(", ")}) : une caisse ne peut pas être négative, vérifiez les saisies.`);
  // Soldes et mouvements bruts : utiles aux notes, trop lourds pour l'écran.
  const statements: Partial<typeof fs> = { ...fs };
  delete statements.balances; delete statements.balancesPrev; delete statements.movements;
  return ok({ ...statements, notes, warnings });
});
