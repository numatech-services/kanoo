import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound, tenantFilter } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { authCan } from "@/lib/role-resources";
import { AppelCandidatureModel } from "@/models/AppelCandidature";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { accountBalance } from "@/lib/treasury";
import { CRITERIA, goScore, recommend, suggestions, type Scores } from "@/lib/go-no-go";
import { daysUntil } from "@/lib/appels";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

type Appel = { _id: Types.ObjectId; organism?: string; submissionDeadline?: Date; estimatedAmount: number; requiredDocuments: Array<{ provided: boolean }>; goNoGo?: unknown };

/** GET — grille, pré-évaluations tirées des données, décision enregistrée. */
export const GET = withAuth("appels", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  if (!Types.ObjectId.isValid(params.id)) return notFound();
  const a = await AppelCandidatureModel.findOne({ _id: params.id, ...tenantFilter(auth) }).select("organism submissionDeadline estimatedAmount requiredDocuments goNoGo").lean<Appel | null>();
  if (!a) return notFound("Appel introuvable");
  // Trésorerie : seulement pour qui peut la voir ; sinon le critère reste à noter à la main.
  let cash = 0, canSeeCash = false;
  if (authCan(auth, "treasuryAccounts", "read")) {
    canSeeCash = true;
    const accounts = await TreasuryAccountModel.find({ ...tenantFilter(auth), isActive: { $ne: false } }).select("_id").lean<Array<{ _id: Types.ObjectId }>>();
    for (const acc of accounts) cash += (await accountBalance(auth.tenantId, String(acc._id)))?.balance ?? 0;
  }
  const history = a.organism
    ? await AppelCandidatureModel.aggregate<{ _id: string; n: number }>([
        { $match: { tenantId: new Types.ObjectId(auth.tenantId), _id: { $ne: a._id }, status: { $in: ["won", "lost"] }, organism: { $regex: `^${a.organism.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } } },
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ])
    : [];
  const sugg = suggestions({
    daysLeft: a.submissionDeadline ? daysUntil(a.submissionDeadline) : null,
    requiredDocs: a.requiredDocuments ?? [],
    cash: canSeeCash ? cash : 0,
    estimatedAmount: canSeeCash ? a.estimatedAmount : 0,
    history: { won: history.find(h => h._id === "won")?.n ?? 0, lost: history.find(h => h._id === "lost")?.n ?? 0 },
  });
  return ok({ criteria: CRITERIA, suggestions: sugg, saved: a.goNoGo ?? null });
});

/** PUT { scores: { fit: 0-5, … }, decision?: "go" | "review" | "no_go", note? } — enregistre l'évaluation et la décision. */
export const PUT = withAuth("appels", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const scores: Scores = {};
  for (const c of CRITERIA) {
    const v = Number(body.scores?.[c.key]);
    if (!Number.isInteger(v) || v < 0 || v > 5) return badRequest(`Notez « ${c.label} » de 0 à 5.`);
    scores[c.key] = v;
  }
  const decision = ["go", "review", "no_go"].includes(body.decision) ? body.decision : recommend(scores);
  const goNoGo = { scores, score: goScore(scores), decision, note: String(body.note ?? "").slice(0, 2000) || undefined, decidedAt: new Date(), decidedBy: auth.userId };
  const r = await AppelCandidatureModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { $set: { goNoGo } }, { new: true }).select("goNoGo").lean();
  if (!r) return notFound("Appel introuvable");
  await logAudit(auth, "UPDATE", "appels", { resourceId: params.id, metadata: { goNoGo: decision, score: goNoGo.score } });
  return ok(goNoGo);
});
