import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withAuth, ok, created, badRequest } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { AlertModel } from "@/models/Alert";
import { ContractModel } from "@/models/Contract";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/cron-helpers";
import {
  ALERT_CATEGORIES, ALERT_REPEATS, ALERT_STATUSES, alertTone, checkAlertInput, daysLeft, isOwnKey, parseAlertDate, parseRemindDays, sentence,
} from "@/lib/alerts";
import { alertScope, canManageAlerts, canSuperviseAlerts, checkAssignees, pendingRegistrations } from "@/lib/alerts-server";
import { authCan } from "@/lib/role-resources";

export const dynamic = "force-dynamic";

/**
 * GET /api/alerts?status=open|done|cancelled|all&contractId=…
 * Alertes visibles par le compte (toutes pour la direction et la comptabilité,
 * les siennes pour les autres) + échéances d'enregistrement calculées.
 */
export const GET = withAuth("alerts", "read", async (req: NextRequest, auth: TokenPayload) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "open";
  const contractId = url.searchParams.get("contractId");
  const filter: Record<string, unknown> = alertScope(auth);
  if (status !== "all") {
    if (!(ALERT_STATUSES as readonly string[]).includes(status)) return badRequest("Statut inconnu.");
    filter.status = status;
  }
  if (contractId) {
    if (!Types.ObjectId.isValid(contractId)) return badRequest("Contrat invalide.");
    filter.contractId = new Types.ObjectId(contractId);
  }
  const now = new Date();
  const rows = await AlertModel.find(filter)
    .sort(status === "open" ? { dueDate: 1 } : { updatedAt: -1 })
    .limit(500)
    .populate("assigneeIds", "firstName lastName isActive")
    .populate("contractId", "reference title")
    .populate("createdBy", "firstName lastName")
    .populate("doneBy", "firstName lastName")
    .lean<Array<Record<string, unknown> & { dueDate: Date; createdBy?: { _id?: unknown } | null }>>();
  const supervise = canSuperviseAlerts(auth);
  const items = rows.map(a => {
    const left = daysLeft(a.dueDate, now);
    // Modifier / annuler : l'auteur, ou un superviseur (direction, chef).
    const canEdit = canManageAlerts(auth) && (supervise || String(a.createdBy?._id ?? a.createdBy ?? "") === auth.userId);
    return { ...a, left, tone: alertTone(left), canEdit };
  });
  const automatic = status === "open" && !contractId && authCan(auth, "contracts") && authCan(auth, "invoices")
    ? await pendingRegistrations(auth.tenantId, now, 365)
    : [];
  return ok({ items, automatic, canManage: canManageAlerts(auth), categories: ALERT_CATEGORIES, repeats: ALERT_REPEATS });
});

/** POST — nouvelle alerte (direction, comptabilité, administration). */
export const POST = withAuth("alerts", "create", async (req: NextRequest, auth: TokenPayload) => {
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return badRequest("Corps de requête invalide.");
  const body = raw as Record<string, unknown>;
  const err = checkAlertInput(body);
  if (err) return badRequest(err);
  const dueDate = parseAlertDate(body.dueDate);
  if (!dueDate) return badRequest("Indiquez la date d'échéance.");
  const remind = parseRemindDays(body.remindDays);
  if ("error" in remind) return badRequest(remind.error);
  const assignees = await checkAssignees(auth.tenantId, body.assigneeIds);
  if ("error" in assignees) return badRequest(assignees.error);
  let contractId: Types.ObjectId | undefined;
  if (body.contractId) {
    if (typeof body.contractId !== "string" || !Types.ObjectId.isValid(body.contractId)) return badRequest("Contrat invalide.");
    if (!(await ContractModel.exists({ _id: body.contractId, tenantId: auth.tenantId }))) return badRequest("Contrat introuvable.");
    contractId = new Types.ObjectId(body.contractId);
  }
  const repeat = isOwnKey(ALERT_REPEATS, body.repeat) ? body.repeat : "none";
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const alert = await AlertModel.create({
    tenantId: auth.tenantId,
    title: String(body.title).trim().slice(0, 200),
    description: text(body.description, 2000),
    consequence: text(body.consequence, 500),
    category: isOwnKey(ALERT_CATEGORIES, body.category) ? body.category : "autre",
    dueDate,
    remindDays: remind.days,
    repeat,
    ...(repeat !== "none" ? { anchorDay: dueDate.getDate() } : {}),
    assigneeIds: assignees.ids,
    contractId,
    createdBy: auth.userId,
  });
  await logAudit(auth, "CREATE", "alerts", { resourceId: String(alert._id), after: { title: alert.title, dueDate: alert.dueDate, contractId: contractId ? String(contractId) : undefined, assigneeIds: assignees.ids.map(String) } });
  // Le destinataire nommé l'apprend tout de suite, pas seulement au premier rappel.
  for (const uid of assignees.ids) {
    if (String(uid) === auth.userId) continue;
    await notify(new Types.ObjectId(auth.tenantId), uid, "alert_assigned", `Alerte qui vous est confiée : ${alert.title}`,
      `Échéance le ${dueDate.toLocaleDateString("fr-FR")}.${alert.consequence ? ` ${sentence(alert.consequence)}` : ""}`, `/alertes?alerte=${String(alert._id)}`);
  }
  return created(alert);
});
