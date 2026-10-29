import { Types } from "mongoose";
import { NextRequest } from "next/server";
import { withAuth, created, badRequest, getPagination, paginatedResponse, tenantFilter } from "@/lib/api-helpers";
import { ExpenseReportModel } from "@/models/ExpenseReport";
import { EmployeeModel } from "@/models/Employee";
import { CATEGORIES, totals, DEFAULT_POLICY, sanitizeExpenseLine, type ExpenseLine } from "@/lib/expenses";
import { checkImputations } from "@/lib/imputation";
import { loadPolicy } from "@/lib/expense-policy";
import { expenseAuthority, teamMembers } from "@/lib/expense-scope";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";
import { nextSerial } from "@/lib/serial";

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
  // ObjectId explicites : ce filtre sert aussi à un `aggregate` (compteurs par
  // statut), qui ne convertit pas les chaînes — les compteurs restaient à zéro.
  const oid = (x: unknown) => new Types.ObjectId(String(x));
  const me = oid(auth.userId);
  const own = ownEmployeeId ? [{ employeeId: oid(ownEmployeeId) }, { createdBy: me }] : [{ createdBy: me }];
  if (authority.kind === "team") {
    // Chef de service : ses notes et celles des membres de son ou ses services.
    const team = await teamMembers(auth, authority.services);
    return { ...base, $or: [...own, { createdBy: { $in: team.userIds.map(oid) } }, { employeeId: { $in: team.employeeIds.map(oid) } }] };
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
    { $match: await scope(auth, await ownEmployee(auth)) },
    { $group: { _id: "$status", n: { $sum: 1 } } },
  ]);

  return paginatedResponse(items, total, pagination, {
    counts: Object.fromEntries(counts.map(c => [c._id, c.n])),
    policy: await loadPolicy(auth.tenantId),
    categories: CATEGORIES,
  });
});

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
  // Un valideur « toute l'organisation » peut désigner un autre salarié, mais
  // seulement de SON organisation.
  if (!(await EmployeeModel.exists({ _id: employeeId, ...tenantFilter(auth) }))) return badRequest("Salarié introuvable.");

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines = rawLines.map(sanitizeExpenseLine).filter(Boolean) as ExpenseLine[];
  if (rawLines.length > 0 && lines.length !== rawLines.length) {
    return badRequest("Une ligne au moins porte une nature ou une date invalide.");
  }
  const impErr = await checkImputations(auth.tenantId, lines);
  if (impErr) return badRequest(impErr);

  const policy = await loadPolicy(auth.tenantId);
  const t = totals(lines, policy ?? DEFAULT_POLICY);

  // Référence : une note de frais n'est pas un document fiscal, une
  // discontinuité y est sans conséquence. L'index d'unicité rattrape une
  // collision de course ; on ne consomme pas la séquence DGI pour autant.
  const now = new Date();
  const year = now.getFullYear();
  const reference = await nextSerial(auth.tenantId, { prefix: "NDF", year, digits: 4, model: ExpenseReportModel as never, field: "reference" });

  const report = await ExpenseReportModel.create({
    tenantId: auth.tenantId,
    reference,
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
