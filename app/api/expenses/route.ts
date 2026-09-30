import { NextRequest } from "next/server";
import { withAuth, ok, created, badRequest, getPagination, paginatedResponse, tenantFilter } from "@/lib/api-helpers";
import { ExpenseReportModel } from "@/models/ExpenseReport";
import { EmployeeModel } from "@/models/Employee";
import { CATEGORIES, totals, DEFAULT_POLICY, type ExpenseCategory, type ExpenseLine } from "@/lib/expenses";
import { loadPolicy } from "@/lib/expense-policy";
import { expenseAuthority, teamMembers } from "@/lib/expense-scope";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Portée de lecture.
 *
 * Une note de frais dit où quelqu'un a dormi, avec qui il a déjeuné, quand il
 * s'est déplacé. Seuls ceux qui valident ou remboursent voient celles des
 * autres ; les autres ne voient que les leurs. Le filtre est posé **côté
 * serveur** : le masquer dans l'écran laisserait l'API ouverte.
 */
async function scope(auth: TokenPayload, ownEmployeeId?: string) {
  const base = tenantFilter(auth);
  const authority = expenseAuthority(auth);
  if (authority.kind === "all") return base;
  const own = ownEmployeeId ? [{ employeeId: ownEmployeeId }, { createdBy: auth.userId }] : [{ createdBy: auth.userId }];
  if (authority.kind === "team") {
    // Chef de service : ses notes et celles des membres de son ou ses services.
    const team = await teamMembers(auth, authority.services);
    return { ...base, $or: [...own, { createdBy: { $in: team.userIds } }, { employeeId: { $in: team.employeeIds } }] };
  }
  return { ...base, $or: own };
}

async function ownEmployee(auth: TokenPayload): Promise<string | undefined> {
  const employee = await EmployeeModel
    .findOne({ tenantId: auth.tenantId, userId: auth.userId })
    .select("_id").lean<{ _id: unknown } | null>();
  return employee ? String(employee._id) : undefined;
}

export const GET = withAuth("expenses", "read", async (req: NextRequest, auth: TokenPayload) => {
  const pagination = getPagination(req);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  const filter: Record<string, unknown> = { ...(await scope(auth, await ownEmployee(auth))) };
  if (status) filter.status = status;

  const [items, total] = await Promise.all([
    ExpenseReportModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(pagination.skip).limit(pagination.limit)
      .populate("employeeId", "firstName lastName code")
      .lean(),
    ExpenseReportModel.countDocuments(filter),
  ]);

  // Les compteurs par état alimentent les chips de filtre : sans eux,
  // « En validation » ne dit pas s'il y en a une ou quarante.
  const counts = await ExpenseReportModel.aggregate<{ _id: string; n: number }>([
    { $match: scope(auth, await ownEmployee(auth)) },
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]);

  return paginatedResponse(items, total, pagination, {
    counts: Object.fromEntries(counts.map(c => [c._id, c.n])),
    policy: await loadPolicy(auth.tenantId),
    categories: CATEGORIES,
  });
});

const VALID_CATEGORIES = new Set(Object.keys(CATEGORIES));

/** Normalise une ligne reçue du client. Le serveur ne fait confiance à rien. */
function sanitizeLine(raw: unknown): ExpenseLine | null {
  const l = raw as Record<string, unknown>;
  const category = String(l.category || "");
  if (!VALID_CATEGORIES.has(category)) return null;

  const date = new Date(String(l.date || ""));
  if (Number.isNaN(date.getTime())) return null;

  const spec = CATEGORIES[category as ExpenseCategory];
  return {
    date,
    category: category as ExpenseCategory,
    description: String(l.description || "").slice(0, 300),
    amountTTC: Math.max(0, Number(l.amountTTC) || 0),
    vatAmount: Math.max(0, Number(l.vatAmount) || 0),
    // Le défaut de la nature s'applique si l'appelant ne tranche pas ; le
    // choix est ensuite figé sur la ligne.
    vatRecoverable: typeof l.vatRecoverable === "boolean"
      ? l.vatRecoverable : spec.vatRecoverableByDefault,
    distanceKm: l.distanceKm ? Number(l.distanceKm) : undefined,
    currency: String(l.currency || "XOF"),
    exchangeRate: l.exchangeRate ? Number(l.exchangeRate) : undefined,
    projectId: l.projectId ? String(l.projectId) : undefined,
    clientId: l.clientId ? String(l.clientId) : undefined,
    attachmentCount: 0,
  };
}

export const POST = withAuth("expenses", "create", async (req: NextRequest, auth: TokenPayload) => {
  const body = await req.json().catch(() => ({}));

  const title = String(body.title || "").trim();
  if (!title) return badRequest("Donnez un objet à cette note : « Mission Maradi, septembre » se retrouve, « Note 47 » non.");

  // Bénéficiaire : soi-même par défaut. Désigner quelqu'un d'autre suppose de
  // pouvoir valider — sinon n'importe qui se ferait rembourser au nom d'un tiers.
  const mine = await ownEmployee(auth);
  let employeeId = body.employeeId ? String(body.employeeId) : mine;

  if (body.employeeId && body.employeeId !== mine
      && expenseAuthority(auth).kind !== "all") {
    return badRequest("Vous ne pouvez saisir une note qu'à votre nom.");
  }
  if (!employeeId) {
    return badRequest(
      "Aucune fiche salarié n'est rattachée à votre compte. "
      + "Le remboursement doit désigner un bénéficiaire : demandez à votre administrateur de faire le lien."
    );
  }
  employeeId = String(employeeId);

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines = rawLines.map(sanitizeLine).filter(Boolean) as ExpenseLine[];
  if (rawLines.length > 0 && lines.length !== rawLines.length) {
    return badRequest("Une ligne au moins porte une nature ou une date invalide.");
  }

  const policy = await loadPolicy(auth.tenantId);
  const t = totals(lines, policy ?? DEFAULT_POLICY);

  // Référence : une note de frais n'est pas un document fiscal, une
  // discontinuité y est sans conséquence. L'index d'unicité rattrape une
  // collision de course ; on ne consomme pas la séquence DGI pour autant.
  const now = new Date();
  const year = now.getFullYear();
  const count = await ExpenseReportModel.countDocuments({
    tenantId: auth.tenantId, reference: new RegExp(`^NDF-${year}-`),
  });

  const report = await ExpenseReportModel.create({
    tenantId: auth.tenantId,
    reference: `NDF-${year}-${String(count + 1).padStart(4, "0")}`,
    title,
    employeeId,
    createdBy: auth.userId,
    periodMonth: body.periodMonth || now.getMonth() + 1,
    periodYear: body.periodYear || year,
    lines,
    notes: body.notes ? String(body.notes).slice(0, 2000) : undefined,
    totalTTC: t.totalTTC,
    totalVatDeducted: t.totalVatDeducted,
    totalCharge: t.totalCharge,
  });

  await logAudit(auth, "CREATE", "expenses", {
    resourceId: String(report._id),
    metadata: { reference: report.reference, lines: lines.length, totalTTC: t.totalTTC },
  });

  return created(report);
});
