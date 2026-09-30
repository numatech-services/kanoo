import { NextRequest } from "next/server";
import { withAuth, ok, notFound, noContent, badRequest, conflict, tenantFilter, sanitizeBody } from "@/lib/api-helpers";
import { EmployeeModel } from "@/models/Employee";
import { maskPayroll, stripPayrollWrites } from "@/lib/payroll-mask";
import { UserModel } from "@/models/User";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("employees", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  const e = await EmployeeModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean();
  if (!e) return notFound(); return ok(maskPayroll(e as Record<string, unknown>, auth));
});
export const PATCH = withAuth("employees", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  const body = await req.json();
  // Hors paie, les champs de rémunération sont ignorés (ni lus ni écrits).
  const update = stripPayrollWrites(sanitizeBody(body, ["code"]), auth);

  // ── Rattachement à un compte de connexion ────────────────────────────────
  //
  // `sanitizeBody` retire ce qui n'est jamais inscriptible, mais laisse passer
  // `userId` : sans le contrôle ci-dessous, un identifiant appartenant à une
  // autre organisation serait accepté, et les notes de frais de cette personne
  // se rembourseraient sur une fiche qui n'est pas la sienne.
  if ("userId" in update) {
    const value = update.userId;

    if (value === null || value === "") {
      update.userId = undefined;
    } else {
      const target = await UserModel.findOne({ _id: String(value), ...tenantFilter(auth) })
        .select("_id").lean<{ _id: unknown } | null>();
      if (!target) return badRequest("Ce compte n'appartient pas à votre organisation.");

      // Un compte ne peut désigner qu'une seule fiche : deux rattachements
      // rendraient « mes notes de frais » ambigu, et le remboursement avec.
      const already = await EmployeeModel.findOne({
        ...tenantFilter(auth), userId: String(value), _id: { $ne: params.id },
      }).select("firstName lastName").lean<{ firstName: string; lastName: string } | null>();
      if (already) {
        return conflict(
          `Ce compte est déjà rattaché à la fiche de ${already.firstName} ${already.lastName}. `
          + `Détachez-la d'abord.`
        );
      }
    }
  }

  const e = await EmployeeModel.findOneAndUpdate(
    { _id: params.id, ...tenantFilter(auth) }, update, { new: true }
  );
  if (!e) return notFound();
  await logAudit(auth, "UPDATE", "employees", {
    resourceId: params.id,
    metadata: "userId" in update ? { linkedUser: update.userId ?? null } : undefined,
  });
  return ok(maskPayroll(e.toObject(), auth));
});
export const DELETE = withAuth("employees", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  const e = await EmployeeModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { isActive: false }, { new: true });
  if (!e) return notFound();
  await logAudit(auth, "DELETE", "employees", { resourceId: params.id });
  return noContent();
});
