import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, created, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { ContractModel } from "@/models/Contract";
import { contractScope, parseMilestone } from "@/lib/contract-input";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** POST — ajoute une échéance (acompte ou situation) à l'échéancier du marché. */
export const POST = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const contract = await ContractModel.findOne({ _id: params.id, ...contractScope(auth) });
  if (!contract) return notFound("Marché introuvable");
  const r = parseMilestone(await req.json().catch(() => ({})), contract.amount);
  if (r.error) return badRequest(r.error);
  const planned = (contract.milestones as Array<{ amount: number }>).reduce((t, m) => t + m.amount, 0);
  if (planned + r.data!.amount > contract.amount) return badRequest(`L'échéancier dépasserait le montant du marché (reste ${(contract.amount - planned).toLocaleString("fr-FR")} FCFA HT).`);
  contract.milestones.push(r.data);
  await contract.save();
  await logAudit(auth, "UPDATE", "contracts", { resourceId: String(contract._id), after: { milestone: r.data!.label } });
  return created(contract.milestones[contract.milestones.length - 1]);
});
