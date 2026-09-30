import { NextRequest } from "next/server";
import { withTransaction } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, forbidden, conflict, tenantFilter } from "@/lib/api-helpers";
import { ExpenseReportModel } from "@/models/ExpenseReport";
import { EmployeeModel } from "@/models/Employee";
import { AttachmentModel } from "@/models/Attachment";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { loadPolicy } from "@/lib/expense-policy";
import {
  totals, checkLines, canSubmit, canTransition, transitionError,
  commitmentEntry, reimbursementEntry, isBalanced,
  type ExpenseLine, type ExpenseStatus,
} from "@/lib/expenses";
import { expenseAuthority, teamMembers, canReimburse } from "@/lib/expense-scope";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface Report {
  _id: unknown;
  reference: string;
  title: string;
  status: ExpenseStatus;
  employeeId: unknown;
  createdBy: unknown;
  lines: Array<ExpenseLine & { _id: unknown }>;
  totalTTC: number;
}

/**
 * Peut-on valider (approuver / refuser) cette note ? Gérant et comptabilité :
 * toutes ; chef de service : celles de son équipe. Tous les rôles cumulés
 * comptent, pas seulement le rôle principal.
 */
/** Identifiant d'un champ, qu'il soit brut ou peuplé ({ _id, … }). */
const idOf = (v: unknown): string =>
  v && typeof v === "object" && "_id" in (v as Record<string, unknown>) ? String((v as { _id: unknown })._id) : String(v);

async function canDecide(auth: TokenPayload, report: Report): Promise<boolean> {
  const authority = expenseAuthority(auth);
  if (authority.kind === "all") return true;
  if (authority.kind === "own") return false;
  const team = await teamMembers(auth, authority.services);
  return team.userIds.includes(idOf(report.createdBy)) || team.employeeIds.includes(idOf(report.employeeId));
}

/**
 * Peut-on voir cette note ?
 *
 * Une note de frais dit où quelqu'un a dormi et avec qui il a déjeuné. Seuls
 * ceux qui valident voient celles des autres.
 */
async function visible(auth: TokenPayload, report: Report): Promise<boolean> {
  if (idOf(report.createdBy) === auth.userId) return true;
  if (await canDecide(auth, report)) return true;
  const mine = await EmployeeModel
    .findOne({ tenantId: auth.tenantId, userId: auth.userId }).select("_id")
    .lean<{ _id: unknown } | null>();
  return Boolean(mine && String(mine._id) === idOf(report.employeeId));
}

/**
 * Recompte les justificatifs réellement présents.
 *
 * Le compteur porté par la ligne est une dénormalisation ; à la validation, on
 * revient à la source. Un compteur qui aurait dérivé — pièce supprimée après
 * la saisie — laisserait passer un remboursement sans facture.
 */
async function withRealAttachmentCounts(
  auth: TokenPayload, report: Report
): Promise<ExpenseLine[]> {
  const rows = await AttachmentModel.find({
    ...tenantFilter(auth), host: "expenses", hostId: report._id,
  }).select("lineId").lean<Array<{ lineId?: unknown }>>();

  const perLine = new Map<string, number>();
  let loose = 0;
  for (const row of rows) {
    if (row.lineId) {
      const key = String(row.lineId);
      perLine.set(key, (perLine.get(key) || 0) + 1);
    } else {
      loose++;
    }
  }

  // Une pièce déposée sans désigner sa ligne couvre la première ligne qui en
  // réclame une : refuser la note pour un rattachement manquant serait
  // punir une maladresse d'interface, pas une absence de justificatif.
  return report.lines.map(line => {
    const attached = perLine.get(String(line._id)) || 0;
    if (attached > 0) return { ...line, attachmentCount: attached };
    if (loose > 0) { loose--; return { ...line, attachmentCount: 1 }; }
    return { ...line, attachmentCount: 0 };
  });
}

export const GET = withAuth("expenses", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const report = await ExpenseReportModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("employeeId", "firstName lastName code bankAccount bankName")
    .populate("createdBy", "firstName lastName")
    .lean<Report | null>();
  if (!report) return notFound("Note de frais introuvable");
  if (!(await visible(auth, report))) return forbidden("Cette note ne vous est pas accessible.");

  const policy = await loadPolicy(auth.tenantId);
  const lines = await withRealAttachmentCounts(auth, report);

  return ok({
    report,
    policy,
    // Les anomalies sont recalculées à chaque lecture, jamais stockées : une
    // règle qui change doit se voir sur les notes encore modifiables.
    issues: checkLines(lines, policy),
    totals: totals(lines, policy),
    canApprove: idOf(report.createdBy) !== auth.userId && await canDecide(auth, report),
    canReimburse: canReimburse(auth),
  });
});

export const PATCH = withAuth("expenses", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json().catch(() => ({}));
  const report = await ExpenseReportModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!report) return notFound("Note de frais introuvable");
  if (!(await visible(auth, report as unknown as Report))) {
    return forbidden("Cette note ne vous est pas accessible.");
  }

  // ── Changement d'état ────────────────────────────────────────────────────
  if (body.status) {
    const to = String(body.status) as ExpenseStatus;
    const from = report.status as ExpenseStatus;

    if (!canTransition(from, to)) return conflict(transitionError(from, to));

    if ((to === "approved" || to === "rejected") && !(await canDecide(auth, report as unknown as Report))) {
      return forbidden("Vous n'avez pas le droit de valider cette note de frais.");
    }
    // Le remboursement engage la trésorerie : comptabilité et gérant uniquement.
    if (to === "reimbursed" && !canReimburse(auth)) {
      return forbidden("Le remboursement est effectué par la comptabilité.");
    }
    // Personne ne valide sa propre note. La règle vaut aussi pour un
    // administrateur : c'est justement là qu'elle protège.
    if (to === "approved" && idOf(report.createdBy) === auth.userId) {
      return forbidden("Une note ne peut pas être approuvée par la personne qui l'a saisie.");
    }

    const policy = await loadPolicy(auth.tenantId);
    const lines = await withRealAttachmentCounts(auth, report as unknown as Report);
    const issues = checkLines(lines, policy);

    if ((to === "submitted" || to === "approved") && !canSubmit(issues)) {
      const first = issues.find(i => i.level === "block")!;
      return badRequest(`Ligne ${first.index + 1} — ${first.message}`);
    }
    if (to === "rejected" && !String(body.reason || "").trim()) {
      return badRequest("Indiquez le motif du refus : « refusée » sans explication est une impasse.");
    }

    const t = totals(lines, policy);
    const now = new Date();

    if (to === "submitted") {
      report.status = "submitted";
      report.submittedAt = now;
    } else if (to === "draft") {
      report.status = "draft";
      report.submittedAt = undefined;
    } else if (to === "rejected") {
      report.status = "rejected";
      report.rejectedAt = now;
      report.rejectedBy = auth.userId;
      report.rejectionReason = String(body.reason).slice(0, 500);
    } else if (to === "approved") {
      // L'approbation engage la dette : écriture et statut dans la même
      // transaction. Une note approuvée sans écriture serait une dette
      // invisible au bilan.
      const entry = commitmentEntry(lines, policy);
      if (!isBalanced(entry)) {
        return badRequest("Écriture déséquilibrée : vérifiez les montants et les taux de conversion.");
      }
      await withTransaction(async (session) => {
        await AccountingEntryModel.create([{
          tenantId: auth.tenantId,
          journalCode: "OD",
          entryDate: now,
          reference: report.reference,
          label: `Note de frais ${report.reference} — ${report.title}`,
          lines: entry,
          linkedDocType: "expense",
          linkedDocId: report._id,
          createdBy: auth.userId,
        }], { session });

        await ExpenseReportModel.updateOne(
          { _id: report._id, ...tenantFilter(auth), status: "submitted" },
          { $set: {
            status: "approved", approvedAt: now, approvedBy: auth.userId,
            totalTTC: t.totalTTC, totalVatDeducted: t.totalVatDeducted, totalCharge: t.totalCharge,
          } },
          { session }
        );
      });

      await logAudit(auth, "UPDATE", "expenses", {
        resourceId: String(params.id),
        metadata: { action: "approve", reference: report.reference, totalTTC: t.totalTTC },
      });
      return ok({ status: "approved", message: `Note approuvée. ${t.totalTTC.toLocaleString("fr-FR")} XOF à rembourser.` });
    } else if (to === "reimbursed") {
      const accountId = body.treasuryAccountId ? String(body.treasuryAccountId) : null;
      if (!accountId) {
        return badRequest(
          "Désignez le compte qui règle : sans lui, le remboursement n'apparaîtrait "
          + "sur aucun solde et resterait introuvable au rapprochement."
        );
      }
      const amount = report.totalTTC;
      const entry = reimbursementEntry(amount);

      await withTransaction(async (session) => {
        await AccountingEntryModel.create([{
          tenantId: auth.tenantId,
          journalCode: "BQ",
          entryDate: now,
          reference: `${report.reference}-RGL`,
          label: `Remboursement note de frais ${report.reference}`,
          lines: entry,
          linkedDocType: "expense",
          linkedDocId: report._id,
          createdBy: auth.userId,
        }], { session });

        // Le mouvement de trésorerie fait le solde — même règle que pour un
        // encaissement de facture.
        await TreasuryMovementModel.create([{
          tenantId: auth.tenantId,
          accountId,
          date: now,
          amount: -amount,
          label: `Remboursement frais ${report.reference}`,
          source: "expense",
          linkedDocType: "expense",
          linkedDocId: report._id,
          createdBy: auth.userId,
        }], { session });

        await ExpenseReportModel.updateOne(
          { _id: report._id, ...tenantFilter(auth), status: "approved" },
          { $set: { status: "reimbursed", reimbursedAt: now, treasuryAccountId: accountId } },
          { session }
        );
      });

      await logAudit(auth, "UPDATE", "expenses", {
        resourceId: String(params.id),
        metadata: { action: "reimburse", reference: report.reference, amount, accountId },
      });
      return ok({ status: "reimbursed", message: `${amount.toLocaleString("fr-FR")} XOF remboursés.` });
    }

    await report.save();
    await logAudit(auth, "UPDATE", "expenses", {
      resourceId: String(params.id),
      metadata: { action: `status:${to}`, reference: report.reference },
    });
    return ok({ status: report.status });
  }

  // ── Modification du contenu ──────────────────────────────────────────────
  if (report.status !== "draft" && report.status !== "rejected") {
    return conflict(
      "Cette note est en validation ou déjà approuvée : elle ne se modifie plus. "
      + "Demandez son renvoi en brouillon."
    );
  }

  if (body.title !== undefined) report.title = String(body.title).trim().slice(0, 200);
  if (body.notes !== undefined) report.notes = String(body.notes).slice(0, 2000);
  if (Array.isArray(body.lines)) report.lines = body.lines;

  const policy = await loadPolicy(auth.tenantId);
  const t = totals(report.lines as ExpenseLine[], policy);
  report.totalTTC = t.totalTTC;
  report.totalVatDeducted = t.totalVatDeducted;
  report.totalCharge = t.totalCharge;
  await report.save();

  await logAudit(auth, "UPDATE", "expenses", { resourceId: String(params.id) });
  return ok(report);
});

export const DELETE = withAuth("expenses", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  const report = await ExpenseReportModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .lean<Report | null>();
  if (!report) return notFound("Note de frais introuvable");

  // Une note approuvée a produit une écriture : la supprimer laisserait la
  // dette au bilan sans pièce qui l'explique.
  if (report.status === "approved" || report.status === "reimbursed") {
    return conflict(
      "Cette note a produit une écriture comptable. Elle ne se supprime pas : "
      + "émettez une note corrective."
    );
  }

  await ExpenseReportModel.deleteOne({ _id: params.id, ...tenantFilter(auth) });
  await logAudit(auth, "DELETE", "expenses", {
    resourceId: String(params.id), metadata: { reference: report.reference },
  });
  return ok({ deleted: true });
});
