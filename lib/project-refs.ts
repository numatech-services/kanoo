import { checkTenantRefs, pluck } from "@/lib/tenant-refs";
import { ClientModel } from "@/models/Client";
import { UserModel } from "@/models/User";
import { InvoiceModel } from "@/models/Invoice";
import { ContractModel } from "@/models/Contract";
import { EmployeeModel } from "@/models/Employee";
import { MemberModel } from "@/models/Member";
import { BureauMemberModel } from "@/models/BureauMember";

/**
 * Références d'un projet (client, responsable, équipe, membres, tâches,
 * factures, contrats) : toutes doivent appartenir à l'organisation. Seuls les
 * champs présents dans le corps sont contrôlés (PATCH partiel).
 */
export function checkProjectRefs(tenantId: string, body: Record<string, unknown>) {
  const tasks = body.tasks, members = body.projectMembers, milestones = body.milestones;
  return checkTenantRefs(tenantId, [
    { model: ClientModel, ids: body.clientId, label: "Client" },
    { model: UserModel, ids: [body.managerId, ...(Array.isArray(body.teamIds) ? body.teamIds : []), ...pluck(tasks, "assigneeId"), ...pluck(members, "userId")], label: "Utilisateur" },
    { model: EmployeeModel, ids: pluck(members, "employeeId"), label: "Salarié" },
    { model: MemberModel, ids: [...pluck(members, "memberId"), ...pluck(tasks, "memberId")], label: "Adhérent" },
    { model: BureauMemberModel, ids: [...pluck(members, "bureauMemberId"), ...pluck(tasks, "bureauMemberId")], label: "Membre du bureau" },
    { model: InvoiceModel, ids: [...(Array.isArray(body.invoiceIds) ? body.invoiceIds : []), ...pluck(milestones, "invoiceId")], label: "Facture" },
    { model: ContractModel, ids: Array.isArray(body.contractIds) ? body.contractIds : [], label: "Contrat" },
  ]);
}
