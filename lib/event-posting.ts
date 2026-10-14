import type { ClientSession } from "mongoose";
import { postCashFlow, reverseCashFlow } from "@/lib/cash-posting";

/**
 * Billetterie : un billet réglé est une recette (706500), encaissée dans la
 * caisse de l'événement (vente sur place) ou sur le compte des paiements en
 * ligne. Sans compte paramétré sur l'événement, rien n'est comptabilisé.
 */

type Actor = { tenantId: string; userId: string };
type Ev = { _id: unknown; title: string; treasuryAccountId?: unknown; onlineTreasuryAccountId?: unknown };
type At = { _id: unknown; amount?: number; status: string; ticketCode: string; firstName?: string; lastName?: string; entryId?: unknown; movementId?: unknown; save: (o?: { session?: ClientSession }) => Promise<unknown> };

export async function postAttendee(actor: Actor, ev: Ev, at: At, channel: "onsite" | "online", session?: ClientSession) {
  if (at.entryId || !(Number(at.amount) > 0) || !["paid", "present"].includes(at.status)) return;
  const account = channel === "online" ? ev.onlineTreasuryAccountId ?? ev.treasuryAccountId : ev.treasuryAccountId;
  if (!account) return;
  const r = await postCashFlow({
    tenantId: actor.tenantId, userId: actor.userId, treasuryAccountId: account, direction: "in",
    amount: Number(at.amount), date: new Date(), label: `Billet ${at.ticketCode} — ${ev.title}`, reference: at.ticketCode,
    account: { accountCode: "706500", accountLabel: "Billetterie et inscriptions" },
    linkedDocType: "attendee", linkedDocId: at._id,
  }, session);
  at.entryId = r.entryId; at.movementId = r.movementId;
  await at.save({ session });
}

export async function unpostAttendee(actor: Actor, at: At, reason: string, session?: ClientSession) {
  if (!at.entryId && !at.movementId) return;
  await reverseCashFlow({ tenantId: actor.tenantId, userId: actor.userId, entryId: at.entryId, movementId: at.movementId, reason }, session);
  at.entryId = undefined; at.movementId = undefined;
}
