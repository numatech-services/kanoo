import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, noContent, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { ContractModel } from "@/models/Contract";
import { parseMilestone } from "@/lib/contract-input";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

type M = { _id: unknown; label: string; amount: number; kind?: string; dueDate?: Date; status: string };

async function load(auth: TokenPayload, params: Record<string, string>) {
  const contract = await ContractModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  const m = contract ? (contract.milestones as M[]).find(x => String(x._id) === params.mid) : undefined;
  return { contract, m };
}

/** PATCH — modifie une échéance encore à facturer. */
export const PATCH = withAuth("contracts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const { contract, m } = await load(auth, params);
  if (!contract || !m) return notFound("Échéance introuvable");
  if (m.status !== "pending") return badRequest("Échéance déjà facturée : faites un avoir pour la reprendre.");
  const body = await req.json().catch(() => ({}));
  const r = parseMilestone({ label: m.label, amount: m.amount, kind: m.kind, dueDate: m.dueDate, ...body }, contract.amount);
  if (r.error) return badRequest(r.error);
  const others = (contract.milestones as M[]).filter(x => x !== m).reduce((t, x) => t + x.amount, 0);
  if (others + r.data!.amount > contract.amount) return badRequest("L'échéancier dépasserait le montant du marché.");
  Object.assign(m, r.data);
  contract.markModified("milestones");
  await contract.save();
  await logAudit(auth, "UPDATE", "contracts", { resourceId: String(contract._id), after: { milestone: m.label } });
  return ok(m);
});

/** DELETE — retire une échéance encore à facturer. */
export const DELETE = withAuth("contracts", "update", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const { contract, m } = await load(auth, params);
  if (!contract || !m) return notFound("Échéance introuvable");
  if (m.status !== "pending") return badRequest("Échéance déjà facturée : elle reste à l'échéancier.");
  contract.milestones = (contract.milestones as M[]).filter(x => x !== m);
  await contract.save();
  await logAudit(auth, "UPDATE", "contracts", { resourceId: String(contract._id), after: { milestoneRemoved: m.label } });
  return noContent();
});
