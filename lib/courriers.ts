/**
 * Relance des courriers entrants en attente de réponse.
 *
 * Règles (fonction pure, testée) :
 * - un courrier est relancé s'il est entrant, non traité, non archivé et que
 *   son échéance tombe dans les 2 prochains jours (pré-relance) ou est passée ;
 * - on ne relance pas le même courrier plus d'une fois tous les 3 jours — sans
 *   cet espacement, le rappel quotidien devenait du bruit qu'on finit par ignorer.
 */
export const DUE_SOON_DAYS = 2;
export const REMIND_EVERY_DAYS = 3;
const DAY = 86_400_000;

export interface ReminderCandidate {
  _id: unknown;
  reference?: string;
  subject: string;
  dueDate?: Date | string | null;
  direction?: string;
  handled?: boolean;
  archived?: boolean;
  lastReminderAt?: Date | string | null;
}

export interface ReminderPlan<T> { overdue: T[]; dueSoon: T[] }

export function courrierReminderPlan<T extends ReminderCandidate>(letters: T[], now: Date = new Date()): ReminderPlan<T> {
  const plan: ReminderPlan<T> = { overdue: [], dueSoon: [] };
  for (const l of letters) {
    if (l.direction !== "incoming" || l.handled || l.archived || !l.dueDate) continue;
    const due = new Date(l.dueDate).getTime();
    if (Number.isNaN(due) || due > now.getTime() + DUE_SOON_DAYS * DAY) continue;
    if (l.lastReminderAt && now.getTime() - new Date(l.lastReminderAt).getTime() < REMIND_EVERY_DAYS * DAY) continue;
    (due < now.getTime() ? plan.overdue : plan.dueSoon).push(l);
  }
  return plan;
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** E-mail récapitulatif (un par destinataire) des courriers à traiter. */
export function courrierReminderEmail(
  firstName: string | undefined,
  plan: ReminderPlan<ReminderCandidate>,
  baseUrl: string
): { subject: string; html: string; text: string } {
  const line = (l: ReminderCandidate) =>
    `${l.reference ? `${l.reference} — ` : ""}${l.subject} (échéance ${new Date(l.dueDate!).toLocaleDateString("fr-FR")})`;
  const n = plan.overdue.length + plan.dueSoon.length;
  const subject = plan.overdue.length
    ? `${plan.overdue.length} courrier(s) en retard de réponse`
    : `${n} courrier(s) à répondre sous ${DUE_SOON_DAYS} jours`;
  const block = (title: string, list: ReminderCandidate[], color: string) => list.length
    ? `<h3 style="color:${color};font-size:14px;margin:18px 0 6px">${title}</h3><ul style="margin:0;padding-left:18px">${list.map(l => `<li style="margin:4px 0">${esc(line(l))}</li>`).join("")}</ul>`
    : "";
  const url = `${baseUrl.replace(/\/$/, "")}/courriers`;
  const html = `<div style="font-family:Arial,sans-serif;color:#1c2230;max-width:560px">
<p>Bonjour${firstName ? ` ${esc(firstName)}` : ""},</p>
<p>Des courriers reçus attendent une réponse :</p>
${block("En retard", plan.overdue, "#b42318")}
${block(`À répondre sous ${DUE_SOON_DAYS} jours`, plan.dueSoon, "#b54708")}
<p style="margin-top:20px"><a href="${url}" style="background:#3b5bdb;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Ouvrir les courriers</a></p>
<p style="color:#6b7280;font-size:12px;margin-top:18px">Marquez un courrier « traité » pour arrêter ses relances.</p></div>`;
  const text = [
    `Bonjour${firstName ? ` ${firstName}` : ""},`, "",
    ...(plan.overdue.length ? ["En retard :", ...plan.overdue.map(l => `- ${line(l)}`), ""] : []),
    ...(plan.dueSoon.length ? [`À répondre sous ${DUE_SOON_DAYS} jours :`, ...plan.dueSoon.map(l => `- ${line(l)}`), ""] : []),
    `Ouvrir : ${url}`,
  ].join("\n");
  return { subject, html, text };
}
