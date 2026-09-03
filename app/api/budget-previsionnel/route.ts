// Budget PRÉVISIONNEL (espace PME) — distinct de l'exécution budgétaire
// publique servie par /api/budget (chapitres). Le prévisionnel avait détourné
// /api/budget, cassant les 10 écrans d'administration qui y lisent des
// BudgetChapter ; il a désormais son propre chemin. Gardé sur accountingEntries,
// la ressource dont dispose le profil PME.
import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest, conflict, tenantFilter } from "@/lib/api-helpers";
import { BudgetModel } from "@/models/Budget";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import {
  evaluateLine, summarize, headline, SEASONAL_PROFILES,
  type BudgetLine, type LineResult,
} from "@/lib/budget";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin",
              "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

interface EntryRow {
  entryDate: Date;
  lines: Array<{ accountCode: string; debit: number; credit: number }>;
}

/**
 * Réalisé par ligne budgétaire, tiré des écritures comptables.
 *
 * La source est la comptabilité, pas un comptage parallèle : un budget
 * rapproché d'un autre total que celui du grand livre finit toujours par
 * diverger, et personne ne sait plus lequel croire.
 *
 * Le sens des comptes suit le SYSCOHADA : les charges (classe 6) se lisent au
 * débit, les produits (classe 7) au crédit. Prendre le solde brut inverserait
 * les produits et afficherait un chiffre d'affaires négatif.
 */
function actualsByPrefix(entries: EntryRow[], lines: BudgetLine[]): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const line of lines) {
    result.set(line.accountPrefix, Array.from({ length: 12 }, () => 0));
  }

  // Les préfixes les plus longs d'abord : « 6061 » doit gagner sur « 60 »,
  // sinon une ligne détaillée serait absorbée par la ligne générale et le
  // même montant compterait deux fois.
  const ordered = [...lines].sort((a, b) => b.accountPrefix.length - a.accountPrefix.length);

  for (const entry of entries) {
    const month = new Date(entry.entryDate).getMonth();
    for (const entryLine of entry.lines) {
      const code = String(entryLine.accountCode || "");
      const budgetLine = ordered.find(l => code.startsWith(l.accountPrefix));
      if (!budgetLine) continue;

      const bucket = result.get(budgetLine.accountPrefix)!;
      bucket[month] += budgetLine.nature === "revenue"
        ? (entryLine.credit || 0) - (entryLine.debit || 0)
        : (entryLine.debit || 0) - (entryLine.credit || 0);
    }
  }

  return result;
}

export const GET = withAuth("accountingEntries", "read", async (req: NextRequest, auth: TokenPayload) => {
  const url = new URL(req.url);
  const now = new Date();
  const year = Number(url.searchParams.get("year")) || now.getFullYear();

  const budget = await BudgetModel.findOne({ ...tenantFilter(auth), year })
    .lean<{ _id: unknown; year: number; label: string; status: string; lines: Array<BudgetLine & { _id: unknown }> } | null>();

  if (!budget) {
    return ok({ budget: null, year, profiles: SEASONAL_PROFILES, months: MOIS });
  }

  const entries = await AccountingEntryModel.find({
    ...tenantFilter(auth),
    entryDate: { $gte: new Date(year, 0, 1), $lt: new Date(year + 1, 0, 1) },
  }).select("entryDate lines").limit(50_000).lean<EntryRow[]>();

  const actuals = actualsByPrefix(entries, budget.lines);

  // Le mois de référence est le dernier **clos**. Compter le mois en cours
  // comparerait trois semaines de réalisé à un mois entier de budget, et
  // ferait paraître chaque ligne en avance sur ses dépenses.
  const throughMonth = year < now.getFullYear()
    ? 11
    : year > now.getFullYear()
      ? -1
      : now.getMonth() - 1;

  const results: LineResult[] = budget.lines.map(line =>
    evaluateLine(line, actuals.get(line.accountPrefix), throughMonth)
  );
  const summary = summarize(results, throughMonth);

  return ok({
    budget: { ...budget, lines: undefined },
    year,
    throughMonth,
    results: results.map((r, i) => ({ ...r, _id: budget.lines[i]._id })),
    summary,
    headline: headline(summary, MOIS),
    profiles: SEASONAL_PROFILES,
    months: MOIS,
  });
});

export const POST = withAuth("accountingEntries", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json().catch(() => ({}));
  const year = Number(body.year) || new Date().getFullYear();

  const existing = await BudgetModel.findOne({ ...tenantFilter(auth), year }).select("_id").lean();
  if (existing) {
    return conflict(
      `Un budget existe déjà pour ${year}. Deux prévisions concurrentes pour la même `
      + `année donnent deux vérités, et l'on cite celle qui arrange.`
    );
  }

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines = rawLines.map((raw: Record<string, unknown>) => {
    const nature = raw.nature === "revenue" ? "revenue" : "expense";
    const weights = Array.isArray(raw.monthlyWeights) && raw.monthlyWeights.length === 12
      ? raw.monthlyWeights.map(Number) : undefined;
    return {
      accountPrefix: String(raw.accountPrefix || "").trim(),
      label: String(raw.label || "").trim().slice(0, 160),
      nature,
      annualAmount: Math.round(Number(raw.annualAmount) || 0),
      monthlyWeights: weights,
      spread: weights ? "manual" : "even",
      notes: raw.notes ? String(raw.notes).slice(0, 500) : undefined,
    };
  }).filter((l: BudgetLine) => l.accountPrefix && l.label);

  if (lines.length === 0) {
    return badRequest("Un budget sans ligne ne compare rien : ajoutez au moins un poste.");
  }

  // Deux lignes sur le même préfixe compteraient le même réalisé deux fois.
  const prefixes = lines.map((l: BudgetLine) => l.accountPrefix);
  if (new Set(prefixes).size !== prefixes.length) {
    return badRequest("Deux lignes portent le même compte : le même réalisé serait compté deux fois.");
  }

  const budget = await BudgetModel.create({
    tenantId: auth.tenantId,
    year,
    label: String(body.label || `Budget ${year}`).trim().slice(0, 160),
    lines,
    notes: body.notes ? String(body.notes).slice(0, 2000) : undefined,
    createdBy: auth.userId,
  });

  await logAudit(auth, "CREATE", "accountingEntries", {
    resourceId: String(budget._id),
    metadata: { module: "budget", year, lines: lines.length },
  });

  return created(budget);
});
