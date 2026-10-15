import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, created, badRequest, notFound, conflict, forbidden, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { AppelCandidatureModel } from "@/models/AppelCandidature";
import { ClientModel } from "@/models/Client";
import { ContractModel } from "@/models/Contract";
import { createExecutionProject } from "@/lib/market-project";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * POST — { clientId?, amount?, title?, startDate?, endDate?, createProject? (oui par défaut) }
 * L'appel d'offres gagné devient un marché en un clic : contrat client au
 * montant attribué, projet d'exécution qui recevra les dépenses. Sans client
 * désigné, l'organisme émetteur est retrouvé par son nom ou créé comme client.
 */
export const POST = withAuth("contracts", "create", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const appel = await AppelCandidatureModel.findOne({ _id: params.id, ...tenantFilter(auth) });
  if (!appel) return notFound("Appel introuvable");
  if (appel.contractId) return conflict("Cet appel est déjà devenu un marché.");
  if (!["submitted", "evaluation", "won"].includes(appel.status)) return badRequest("Seul un appel déposé, en évaluation ou gagné devient un marché.");
  const amount = Math.round(Number(body.amount ?? appel.estimatedAmount) || 0);
  if (!(amount > 0)) return badRequest("Indiquez le montant attribué du marché (HT).");
  const withProject = body.createProject !== false;
  if (withProject && !authCan(auth, "projects", "create")) return forbidden("Créer le projet d'exécution demande le droit de créer des projets.");

  let clientId: Types.ObjectId | undefined;
  let existingClient = false;
  if (body.clientId) {
    if (!Types.ObjectId.isValid(String(body.clientId))) return badRequest("Client invalide.");
    const c = await ClientModel.findOne({ _id: body.clientId, ...tenantFilter(auth) }).select("_id").lean<{ _id: Types.ObjectId } | null>();
    if (!c) return badRequest("Client introuvable.");
    clientId = c._id; existingClient = true;
  } else {
    const organism = (appel.organism || "").trim();
    if (!organism) return badRequest("Choisissez le client du marché : l'appel n'indique pas d'organisme.");
    const c = await ClientModel.findOne({ ...tenantFilter(auth), name: { $regex: `^${escapeRx(organism)}$`, $options: "i" } }).select("_id").lean<{ _id: Types.ObjectId } | null>();
    if (c) { clientId = c._id; existingClient = true; }
    else if (!authCan(auth, "clients", "create")) return forbidden(`« ${organism} » n'est pas encore client : créez-le ou demandez le droit de créer des clients.`);
  }
  const date = (v: unknown) => { const d = v ? new Date(String(v)) : undefined; return d && !isNaN(d.getTime()) ? d : undefined; };

  const result = await withTransaction(async session => {
    if (!clientId) {
      const base = `AO-${(appel.organism || "CLIENT").normalize("NFD").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10) || "CLIENT"}`;
      let code = base;
      for (let i = 2; await ClientModel.exists({ tenantId: auth.tenantId, code }).session(session ?? null); i++) code = `${base}-${i}`;
      const [c] = await ClientModel.create([{ tenantId: auth.tenantId, code, name: appel.organism!.trim(), type: "company" }], { session });
      clientId = c._id as Types.ObjectId;
    }
    const [contract] = await ContractModel.create([{
      tenantId: auth.tenantId, title: String(body.title || appel.title).slice(0, 200), type: "client", status: "active",
      clientId, amount, appelId: appel._id, startDate: date(body.startDate) ?? new Date(), endDate: date(body.endDate),
      signedDate: new Date(), createdBy: auth.userId,
      notes: appel.reference ? `Appel d'offres ${appel.reference}${appel.organism ? ` — ${appel.organism}` : ""}` : undefined,
    }], { session });
    const project = withProject ? await createExecutionProject(auth.tenantId, contract, auth.userId, session) : null;
    if (project) { contract.projectId = project._id; await contract.save({ session }); }
    appel.status = "won";
    appel.contractId = contract._id;
    if (project) appel.projectId = project._id;
    await appel.save({ session });
    return { contract, project };
  });
  await logAudit(auth, "CREATE", "contracts", { resourceId: String(result.contract._id), after: { fromAppel: appel.title, amount, newClient: !existingClient } });
  return created({ contractId: result.contract._id, reference: result.contract.reference, projectId: result.project?._id ?? null, clientId, newClient: !existingClient });
});
