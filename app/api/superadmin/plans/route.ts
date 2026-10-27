import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, created, badRequest, notFound, forbidden, conflict } from "@/lib/api-helpers";
import { Plan } from "@/models/Plan";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

/**
 * Plans tarifaires : création et modification réservées au superadministrateur.
 * La lecture reste publique (GET /api/public/plans) pour la page /tarifs.
 * Elles étaient exposées sous /api/public, sans authentification : n'importe
 * qui pouvait réécrire les prix affichés.
 */

const TARGETS = ["pme", "association", "administration"];

/** Champs modifiables, validés un à un (jamais le corps brut). */
function readPlan(body: Record<string, unknown>, partial: boolean): Record<string, unknown> | string {
  const out: Record<string, unknown> = {};
  if (!partial || body.code !== undefined) {
    const code = String(body.code ?? "").trim();
    if (!/^[a-z0-9_-]{2,40}$/.test(code)) return "Code invalide (minuscules, chiffres, - et _).";
    out.code = code;
  }
  if (!partial || body.label !== undefined) {
    const label = String(body.label ?? "").trim();
    if (!label || label.length > 80) return "Libellé requis (80 caractères au plus).";
    out.label = label;
  }
  if (body.targetType !== undefined) {
    if (!TARGETS.includes(String(body.targetType))) return "Type d'organisation invalide.";
    out.targetType = body.targetType;
  }
  for (const [k, max] of [["priceMonthly", 100_000_000], ["maxUsers", 100_000]] as const) {
    if (body[k] === undefined) continue;
    const n = Number(body[k]);
    if (!Number.isFinite(n) || n < 0 || n > max) return `${k === "priceMonthly" ? "Prix" : "Nombre d'utilisateurs"} invalide.`;
    out[k] = Math.round(n);
  }
  if (body.highlighted !== undefined) out.highlighted = body.highlighted === true;
  if (body.features !== undefined) {
    if (!Array.isArray(body.features)) return "Fonctionnalités : liste attendue.";
    out.features = body.features.map(f => String(f).trim().slice(0, 120)).filter(Boolean).slice(0, 40);
  }
  return out;
}

export const POST = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  if (auth.role !== "superadmin") return forbidden();
  await connectDB();
  const data = readPlan(await req.json().catch(() => ({})), false);
  if (typeof data === "string") return badRequest(data);
  if (await Plan.exists({ code: data.code })) return conflict(`Le code « ${data.code} » existe déjà.`);
  const plan = await Plan.create(data);
  await logAudit(auth, "CREATE", "plans", { resourceId: String(plan._id), after: data });
  return created(plan);
});

export const PATCH = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  if (auth.role !== "superadmin") return forbidden();
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const id = String(body._id ?? "");
  if (!/^[a-f0-9]{24}$/.test(id)) return badRequest("Plan invalide.");
  const data = readPlan(body, true);
  if (typeof data === "string") return badRequest(data);
  if (data.code && await Plan.exists({ code: data.code, _id: { $ne: id } })) return conflict(`Le code « ${data.code} » existe déjà.`);
  const before = await Plan.findById(id).lean<Record<string, unknown> | null>();
  if (!before) return notFound("Plan introuvable");
  const plan = await Plan.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
  await logAudit(auth, "UPDATE", "plans", {
    resourceId: id,
    before: { priceMonthly: before.priceMonthly, maxUsers: before.maxUsers, label: before.label, code: before.code },
    after: data,
  });
  return ok(plan);
});
