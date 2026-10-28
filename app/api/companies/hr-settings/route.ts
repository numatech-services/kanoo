import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, notFound } from "@/lib/api-helpers";
import { TenantModel } from "@/models/Tenant";
import { tenantCostCenters } from "@/lib/cost-centers-server";
import { holidaysOf } from "@/lib/holidays";
import { hrPolicy } from "@/lib/leaves";
import { logAudit } from "@/lib/audit";
import { TokenPayload } from "@/lib/auth";

export const dynamic = "force-dynamic";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** GET ?year= — services de l'organisation, règles de congés et jours fériés de l'année. */
export const GET = withAuth("companies", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const year = Number(new URL(req.url).searchParams.get("year")) || new Date().getFullYear();
  const policy = await hrPolicy(auth.tenantId);
  const t = await TenantModel.findById(auth.tenantId).select("costCenters").lean<{ costCenters?: unknown[] } | null>();
  return ok({
    year,
    costCenters: await tenantCostCenters(auth.tenantId, { all: true }),
    customCostCenters: !!t?.costCenters?.length,
    leaveMaxBalanceDays: policy.maxBalanceDays ?? null,
    holidays: holidaysOf(year, policy.holidays),
    defaultHolidays: holidaysOf(year),
    extraHolidays: policy.holidays.extra,
    removedHolidays: policy.holidays.removed,
  });
});

/** PATCH { costCenters?, leaveMaxBalanceDays?, extraHolidays?, removedHolidays? } */
export const PATCH = withAuth("companies", "update", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const $set: Record<string, unknown> = {};
  if ("costCenters" in body) {
    if (!Array.isArray(body.costCenters) || body.costCenters.length > 50) return badRequest("Liste de services invalide (50 au plus).");
    const seen = new Set<string>();
    const list = [];
    for (const c of body.costCenters as Array<{ value?: string; code?: string; label?: string; active?: boolean }>) {
      const code = String(c.value ?? c.code ?? "").trim().toLowerCase();
      const label = String(c.label ?? "").trim().slice(0, 80);
      if (!/^[a-z0-9_-]{1,20}$/.test(code)) return badRequest(`Code de service invalide : « ${code} » (lettres, chiffres, - et _, 20 au plus).`);
      if (!label) return badRequest(`Libellé manquant pour le service « ${code} ».`);
      if (seen.has(code)) return badRequest(`Code de service en double : ${code}.`);
      seen.add(code);
      list.push({ code, label, active: c.active !== false });
    }
    $set.costCenters = list;
  }
  if ("leaveMaxBalanceDays" in body) {
    const n = body.leaveMaxBalanceDays === null || body.leaveMaxBalanceDays === "" ? null : Number(body.leaveMaxBalanceDays);
    if (n !== null && !(Number.isInteger(n) && n >= 0 && n <= 365)) return badRequest("Plafond de report invalide (0 à 365 jours).");
    $set["hrPolicy.leaveMaxBalanceDays"] = n || undefined;
  }
  if ("extraHolidays" in body) {
    if (!Array.isArray(body.extraHolidays) || body.extraHolidays.length > 60) return badRequest("Jours fériés ajoutés invalides.");
    const list = (body.extraHolidays as Array<{ date?: string; label?: string }>).map(h => ({ date: String(h.date ?? ""), label: String(h.label ?? "Jour férié").slice(0, 80) }));
    if (list.some(h => !DAY.test(h.date))) return badRequest("Date de jour férié invalide (AAAA-MM-JJ).");
    $set["hrPolicy.extraHolidays"] = list;
  }
  if ("removedHolidays" in body) {
    if (!Array.isArray(body.removedHolidays) || body.removedHolidays.some((d: unknown) => !DAY.test(String(d)))) return badRequest("Jours retirés invalides.");
    $set["hrPolicy.removedHolidays"] = body.removedHolidays.map(String).slice(0, 60);
  }
  const t = await TenantModel.findByIdAndUpdate(auth.tenantId, { $set }, { new: true }).select("_id");
  if (!t) return notFound();
  await logAudit(auth, "UPDATE", "companies", { resourceId: auth.tenantId, metadata: { hrSettings: Object.keys($set) } });
  return ok({ updated: Object.keys($set) });
});
