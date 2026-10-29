import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, noContent, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { LOSS_REASONS, AppelCandidatureModel } from "@/models/AppelCandidature";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const STATUS = ["identified", "preparing", "submitted", "evaluation", "won", "lost", "cancelled"];
const SCALARS = ["title", "organism", "reference", "estimatedAmount", "notes", "requiredDocuments", "documents"];

export const GET = withAuth("appels", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const item = await AppelCandidatureModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("contractId", "reference title").populate("projectId", "name").lean();
  if (!item) return notFound("Appel introuvable");
  return ok(item);
});

export const PATCH = withAuth("appels", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const existing = await AppelCandidatureModel.findOne({ _id: params.id, ...tenantFilter(auth) }).lean<{ _id: unknown } | null>();
  if (!existing) return notFound("Appel introuvable");

  const set: Record<string, unknown> = {};
  for (const f of SCALARS) if (f in body) set[f] = body[f];
  if (body.status !== undefined) {
    if (!STATUS.includes(body.status)) return badRequest("Statut invalide.");
    set.status = body.status;
  }
  if ("submissionDeadline" in body) set.submissionDeadline = body.submissionDeadline ? new Date(body.submissionDeadline) : null;
  if ("openDate" in body) set.openDate = body.openDate ? new Date(body.openDate) : null;
  // Pièces jointes : bornées côté serveur (un appel ne doit pas dépasser la taille d'un document MongoDB).
  if ("documents" in body) {
    const docs = Array.isArray(body.documents) ? body.documents : [];
    const size = (d: { dataUri?: unknown }) => String(d?.dataUri ?? "").length;
    if (docs.some((d: { dataUri?: unknown }) => size(d) > 3_500_000)) return badRequest("Pièce trop lourde (2,5 Mo au plus).");
    if (docs.reduce((t: number, d: { dataUri?: unknown }) => t + size(d), 0) > 9_000_000) return badRequest("Pièces trop lourdes au total (environ 6 Mo) : joignez les plus volumineuses dans Documents.");
  }
  // Résultat de l'offre : à la décision (gagné / perdu), pour le suivi et les statistiques.
  if (body.result && typeof body.result === "object") {
    const r = body.result as Record<string, unknown>;
    const num = (v: unknown) => (v === "" || v == null ? undefined : Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : undefined);
    const day = (v: unknown) => { const d = v ? new Date(String(v)) : undefined; return d && !isNaN(d.getTime()) ? d : undefined; };
    if (r.lossReason !== undefined && r.lossReason !== "" && !(LOSS_REASONS as readonly string[]).includes(String(r.lossReason))) return badRequest("Motif de rejet inconnu.");
    set.result = {
      submittedAt: day(r.submittedAt), offerAmount: num(r.offerAmount), openingDate: day(r.openingDate),
      winnerName: r.winnerName ? String(r.winnerName).trim().slice(0, 200) : undefined, winnerAmount: num(r.winnerAmount),
      rank: num(r.rank) || undefined, lossReason: r.lossReason ? String(r.lossReason) : undefined, notes: r.notes ? String(r.notes).slice(0, 1000) : undefined,
    };
  }
  if (set.status === "lost" && !(set.result as { lossReason?: string } | undefined)?.lossReason) {
    return badRequest("Indiquez le motif du rejet (prix, technique, administratif…) : il alimente le suivi des résultats.");
  }
  for (const f of ["contractId", "projectId"]) {
    if (!(f in body)) continue;
    set[f] = body[f] && Types.ObjectId.isValid(String(body[f])) ? body[f] : undefined;
  }

  const item = await AppelCandidatureModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { $set: set }, { new: true, runValidators: true }).lean();
  await logAudit(auth, "UPDATE", "appels", { resourceId: String(params.id) });
  return ok(item);
});

export const DELETE = withAuth("appels", "delete", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const cur = await AppelCandidatureModel.findOne({ _id: params.id, ...tenantFilter(auth) }).select("contractId status").lean<{ contractId?: unknown; status: string } | null>();
  if (!cur) return notFound("Appel introuvable");
  // Un appel gagné devenu marché est l'origine du marché : il se garde (sinon le marché pointe vers rien).
  if (cur.contractId || cur.status === "won") return badRequest("Appel gagné ou devenu marché : il ne se supprime pas. Passez-le en « annulé » si besoin.");
  await AppelCandidatureModel.deleteOne({ _id: params.id, ...tenantFilter(auth) });
  await logAudit(auth, "DELETE", "appels", { resourceId: String(params.id) });
  return noContent();
});
