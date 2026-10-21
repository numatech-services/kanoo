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
  evaluateLine, summarize, headline, SEASONAL_PROFILES, actualsByPrefix, type BudgetEntryRow,
  type BudgetLine, type LineResult,
} from "@/lib/budget";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin",
              "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

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
  }).select("entryDate lines").limit(50_000).lean<BudgetEntryRow[]>();

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

  const parsed = parseBudgetLines(body.lines);
  if ("error" in parsed) return badRequest(parsed.error);
  const lines = parsed.lines;

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

/** Lignes budgétaires reçues : compte, poste, nature, montant, répartition. */
function parseBudgetLines(raw: unknown): { lines: BudgetLine[] } | { error: string } {
  const rawLines = Array.isArray(raw) ? raw : [];
  const lines = rawLines.map((r: Record<string, unknown>) => {
    const nature = r.nature === "revenue" ? "revenue" : "expense";
    const weights = Array.isArray(r.monthlyWeights) && r.monthlyWeights.length === 12
      ? r.monthlyWeights.map(Number) : undefined;
    return {
      accountPrefix: String(r.accountPrefix || "").trim().replace(/\D/g, ""),
      label: String(r.label || "").trim().slice(0, 160),
      nature,
      annualAmount: Math.max(0, Math.round(Number(r.annualAmount) || 0)),
      monthlyWeights: weights,
      spread: weights ? "manual" : "even",
      notes: r.notes ? String(r.notes).slice(0, 500) : undefined,
    } as BudgetLine;
  }).filter((l: BudgetLine) => l.accountPrefix && l.label);
  if (lines.length === 0) return { error: "Un budget sans ligne ne compare rien : ajoutez au moins un poste." };
  // Deux lignes sur le même préfixe compteraient le même réalisé deux fois.
  const prefixes = lines.map(l => l.accountPrefix);
  if (new Set(prefixes).size !== prefixes.length) return { error: "Deux lignes portent le même compte : le même réalisé serait compté deux fois." };
  return { lines };
}

/** PUT — { year, lines, label?, notes? } : révision du budget (lignes remplacées). */
export const PUT = withAuth("accountingEntries", "update", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json().catch(() => ({}));
  const year = Number(body.year);
  const budget = await BudgetModel.findOne({ ...tenantFilter(auth), year });
  if (!budget) return badRequest(`Aucun budget pour ${year}.`);
  const parsed = parseBudgetLines(body.lines);
  if ("error" in parsed) return badRequest(parsed.error);
  budget.set({ lines: parsed.lines });
  if (body.label) budget.set({ label: String(body.label).trim().slice(0, 160) });
  if ("notes" in body) budget.set({ notes: String(body.notes ?? "").slice(0, 2000) });
  await budget.save();
  await logAudit(auth, "UPDATE", "accountingEntries", { resourceId: String(budget._id), metadata: { module: "budget", year, lines: parsed.lines.length } });
  return ok(budget);
});

/** DELETE ?year= — supprime le budget d'une année (pour le rétablir autrement). */
export const DELETE = withAuth("accountingEntries", "delete", async (req: NextRequest, auth: TokenPayload) => {
  const year = Number(new URL(req.url).searchParams.get("year"));
  const r = await BudgetModel.deleteOne({ ...tenantFilter(auth), year });
  if (!r.deletedCount) return badRequest(`Aucun budget pour ${year}.`);
  await logAudit(auth, "DELETE", "accountingEntries", { metadata: { module: "budget", year } });
  return ok({ deleted: year });
});
