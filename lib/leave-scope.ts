import { Types } from "mongoose";
import type { TokenPayload } from "@/lib/auth";
import { EmployeeModel } from "@/models/Employee";
import { expenseAuthority, teamMembers } from "@/lib/expense-scope";

export async function ownEmployee(auth: TokenPayload) {
  return EmployeeModel.findOne({ tenantId: auth.tenantId, userId: auth.userId }).select("_id startDate leaveOpeningBalance firstName lastName")
    .lean<{ _id: Types.ObjectId; startDate: Date; leaveOpeningBalance?: number; firstName: string; lastName: string } | null>();
}

/** Employés dont le compte peut voir / valider les congés. null = tous. */
export async function scopeEmployees(auth: TokenPayload): Promise<string[] | null> {
  const a = expenseAuthority(auth, "leaves");
  if (a.kind === "all") return null;
  const own = await ownEmployee(auth);
  const ids = own ? [String(own._id)] : [];
  if (a.kind === "team") ids.push(...(await teamMembers(auth, a.services)).employeeIds);
  return [...new Set(ids)];
}

