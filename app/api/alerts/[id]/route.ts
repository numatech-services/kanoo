import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { withAuth, ok, badRequest, notFound, forbidden } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import { AlertModel, type AlertDoc } from "@/models/Alert";
import { ContractModel } from "@/models/Contract";
import { logAudit } from "@/lib/audit";
import {
  ALERT_CATEGORIES, ALERT_REPEATS, checkAlertInput, isOwnKey, nextOccurrence, parseAlertDate, parseRemindDays,
} from "@/lib/alerts";
import { alertScope, canManageAlerts, canSuperviseAlerts, checkAssignees } from "@/lib/alerts-server";

export const dynamic = "force-dynamic";

const EDITABLE = ["title", "description", "consequence", "category", "dueDate", "remindDays", "repeat", "anchorDay", "assigneeIds", "contractId"] as const;

/**
 * PATCH — { action: "done", note? } : marquer traitée (qui la voit : direction,
 * comptabilité ou destinataire) ; une alerte récurrente crée alors
 * l'occurrence suivante, une seule fois. { action: "reopen" | "cancel" } et
 * modification des champs : l'auteur, ou un superviseur (direction, chef).
 */
export const PATCH = withAuth("alerts", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  if (!Types.ObjectId.isValid(params.id)) return notFound();
  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return badRequest("Corps de requête invalide.");
  const body = raw as Record<string, unknown>;
  const cur = await AlertModel.findOne({ _id: params.id, ...alertScope(auth) }).lean<AlertDoc | null>();
  if (!cur) return notFound();
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "done") {
    if (cur.status !== "open") return badRequest("Cette alerte n'est plus ouverte.");
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 1000) : undefined;
    const nextDue = nextOccurrence(cur.dueDate, cur.repeat, cur.anchorDay);
    // Traitement et occurrence suivante ensemble ; l'index unique sur
    // previousId empêche une seconde occurrence (traitée, rouverte, retraitée).
    const result = await withTransaction(async session => {
      const updated = await AlertModel.findOneAndUpdate(
        { _id: cur._id, tenantId: cur.tenantId, status: "open" },
        { $set: { status: "done", doneAt: new Date(), doneBy: auth.userId, ...(note ? { doneNote: note } : {}) } },
        { new: true, session },
      );
      if (!updated) return null;
      let next = null;
      if (nextDue && !(await AlertModel.exists({ previousId: cur._id }).session(session ?? null))) {
        [next] = await AlertModel.create([{
          tenantId: cur.tenantId, title: cur.title, description: cur.description, consequence: cur.consequence,
          category: cur.category, dueDate: nextDue, remindDays: cur.remindDays, repeat: cur.repeat, anchorDay: cur.anchorDay ?? new Date(cur.dueDate).getDate(),
          assigneeIds: cur.assigneeIds, contractId: cur.contractId, previousId: cur._id, createdBy: auth.userId,
        }], { session });
      }
      return { updated, next };
    });
    // Deux clics simultanés : un seul passe.
    if (!result) return badRequest("Cette alerte vient d'être traitée.");
    await logAudit(auth, "UPDATE", "alerts", { resourceId: params.id, before: { status: "open" }, after: { status: "done", ...(note ? { note } : {}) }, metadata: { action: "done", ...(result.next ? { nextId: String(result.next._id), nextDue } : {}) } });
    return ok({ alert: result.updated, next: result.next });
  }

  if (!canManageAlerts(auth)) return forbidden("Seules la direction, la comptabilité et les chefs de service gèrent les alertes ; vous pouvez la marquer comme traitée.");
  if (!canSuperviseAlerts(auth) && String(cur.createdBy) !== auth.userId) return forbidden("Seuls son auteur, la direction ou un chef de service modifient cette alerte.");

  if (action === "reopen" || action === "cancel") {
    const status = action === "reopen" ? "open" : "cancelled";
    if (cur.status === status) return badRequest(status === "open" ? "L'alerte est déjà ouverte." : "L'alerte est déjà annulée.");
    const updated = await AlertModel.findOneAndUpdate(
      { _id: cur._id, tenantId: cur.tenantId, status: cur.status },
      status === "open" ? { $set: { status }, $unset: { doneAt: 1, doneBy: 1, doneNote: 1 } } : { $set: { status } },
      { new: true },
    );
    if (!updated) return badRequest("L'alerte vient d'être modifiée : rechargez la page.");
    await logAudit(auth, "UPDATE", "alerts", { resourceId: params.id, before: { status: cur.status }, after: { status }, metadata: { action } });
    return ok({ alert: updated });
  }
  if (action) return badRequest("Action inconnue.");

  // Modification des champs : alerte ouverte seulement.
  if (cur.status !== "open") return badRequest("Rouvrez l'alerte avant de la modifier.");
  if (body.title !== undefined && typeof body.title !== "string") return badRequest("Donnez un intitulé à l'alerte.");
  const err = checkAlertInput({
    title: body.title ?? cur.title, dueDate: body.dueDate ?? new Date(cur.dueDate),
    category: body.category, repeat: body.repeat,
  });
  if (err) return badRequest(err);
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  if (typeof body.title === "string") set.title = body.title.trim().slice(0, 200);
  for (const [k, max] of [["description", 2000], ["consequence", 500]] as const) {
    if (body[k] === undefined) continue;
    const v = typeof body[k] === "string" ? (body[k] as string).trim().slice(0, max) : "";
    if (v) set[k] = v; else unset[k] = 1;
  }
  if (body.category !== undefined) set.category = isOwnKey(ALERT_CATEGORIES, body.category) ? body.category : "autre";
  if (body.repeat !== undefined) set.repeat = isOwnKey(ALERT_REPEATS, body.repeat) ? body.repeat : "none";
  let due = new Date(cur.dueDate);
  if (body.dueDate !== undefined) {
    const d = parseAlertDate(body.dueDate);
    if (!d) return badRequest("Indiquez la date d'échéance.");
    set.dueDate = d; due = d;
  }
  // Quantième d'origine recalé quand la date ou la périodicité change.
  if (set.dueDate || set.repeat) {
    if ((set.repeat ?? cur.repeat) !== "none") set.anchorDay = due.getDate(); else if (cur.anchorDay) unset.anchorDay = 1;
  }
  if (body.remindDays !== undefined) {
    const r = parseRemindDays(body.remindDays);
    if ("error" in r) return badRequest(r.error);
    set.remindDays = r.days;
  }
  let dropped = 0;
  if (body.assigneeIds !== undefined) {
    const a = await checkAssignees(auth.tenantId, body.assigneeIds, cur.assigneeIds ?? []);
    if ("error" in a) return badRequest(a.error);
    set.assigneeIds = a.ids; dropped = a.dropped;
  }
  if (body.contractId !== undefined) {
    if (!body.contractId) unset.contractId = 1;
    else {
      if (typeof body.contractId !== "string" || !Types.ObjectId.isValid(body.contractId)) return badRequest("Contrat invalide.");
      if (!(await ContractModel.exists({ _id: body.contractId, tenantId: auth.tenantId }))) return badRequest("Contrat introuvable.");
      set.contractId = new Types.ObjectId(body.contractId);
    }
  }
  if (!Object.keys(set).length && !Object.keys(unset).length) return badRequest("Rien à modifier.");
  const updated = await AlertModel.findOneAndUpdate(
    { _id: cur._id, tenantId: cur.tenantId, status: "open" },
    { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
    { new: true, runValidators: true },
  );
  if (!updated) return badRequest("L'alerte vient d'être traitée ou annulée.");
  const changed = [...Object.keys(set), ...Object.keys(unset)].filter(k => (EDITABLE as readonly string[]).includes(k));
  const pick = (o: Record<string, unknown> | null | undefined) => Object.fromEntries(changed.map(k => [k, o?.[k] ?? null]));
  await logAudit(auth, "UPDATE", "alerts", { resourceId: params.id, before: pick(cur as unknown as Record<string, unknown>), after: pick(updated.toObject() as Record<string, unknown>), ...(dropped ? { metadata: { droppedInactiveAssignees: dropped } } : {}) });
  return ok({ alert: updated, droppedInactiveAssignees: dropped });
});
