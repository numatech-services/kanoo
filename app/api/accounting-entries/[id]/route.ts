import { NextRequest } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TenantModel } from "@/models/Tenant";
import { logAuditInTx } from "@/lib/audit";
import { BusinessRuleError } from "@/lib/errors";
import { ProjectModel } from "@/models/Project";
import { ActivityModel } from "@/models/Activity";
import type { ClientSession } from "mongoose";
import { checkImputations, pickImputation, reimputeEntry, type Imputation } from "@/lib/imputation";
import { TokenPayload } from "@/lib/auth";

export const GET = withAuth("accountingEntries", "read", async (_req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const e = await AccountingEntryModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .populate("lines.projectId", "code name").populate("lines.activityId", "name")
    .populate("createdBy", "firstName lastName").populate("reversedBy", "reference entryDate").populate("reverses", "reference entryDate")
    .lean();
  if (!e) return notFound();
  return ok(e);
});

/**
 * PATCH — libellé et référence seulement : les montants se corrigent par
 * extourne. `imputations` (une par ligne) corrige le rattachement analytique
 * d'une écriture MANUELLE ; celle d'un document se corrige sur le document.
 * `reason` (motif) est obligatoire. La modification et sa trace au journal
 * d'audit (auteur, motif, avant / après, pièce) sont écrites dans la même
 * transaction : pas de modification sans trace.
 */
const REASON_MIN = 5;
export const PATCH = withAuth("accountingEntries", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < REASON_MIN) return badRequest(`Indiquez le motif de la modification (${REASON_MIN} caractères au moins) : il reste au journal d'audit.`);
  if (reason.length > 500) return badRequest("Motif trop long (500 caractères au plus).");
  const wantsImp = Array.isArray(body.imputations);
  const wantsText = typeof body.label === "string" || typeof body.reference === "string";
  if (wantsImp && wantsText) return badRequest("Modifiez l'imputation et le libellé en deux fois : chaque modification a son motif.");

  const cur = await AccountingEntryModel.findOne({ _id: params.id, ...tenantFilter(auth) })
    .select("linkedDocType entryDate journalCode reference label lines reversedBy reverses")
    .lean<CurEntry | null>();
  if (!cur) return notFound();
  if (cur.reversedBy || cur.reverses) return badRequest("Écriture extournée ou écriture d'extourne : elle ne se modifie plus.");
  // Pièce visée, gardée au journal : l'entrée se lit sans ouvrir l'écriture.
  const entry = {
    reference: cur.reference, entryDate: cur.entryDate, journalCode: cur.journalCode,
    amount: cur.lines.reduce((t, l) => t + (Number(l.debit) || 0), 0),
  };

  if (wantsImp) {
    if (cur.linkedDocType && cur.linkedDocType !== "manual") return badRequest("Écriture produite par un document : corrigez l'imputation sur le document (facture, achat…).");
    if (body.imputations.length !== cur.lines.length) return badRequest("Une imputation par ligne de l'écriture.");
    // Contrôle sur la saisie brute : un identifiant invalide est refusé, pas effacé en silence.
    const err = await checkImputations(auth.tenantId, body.imputations.map((x: unknown) => (x && typeof x === "object" ? x : {})));
    if (err) return badRequest(err);
    const imps: Imputation[] = body.imputations.map(pickImputation);
    const before = cur.lines.map(pickImputation);
    if (sameImputations(before, imps)) return badRequest("Rien à modifier : l'imputation est identique.");
    const names = await imputationNames(auth.tenantId, [...before, ...imps]);
    const e = await withTransaction(async session => {
      const r = await reimputeEntry(auth.tenantId, params.id, new Map(imps.map((imp, i) => [i, imp])), session);
      if (!r) throw new BusinessRuleError("Écriture introuvable.");
      await logAuditInTx(auth, "UPDATE", "accountingEntries", {
        resourceId: params.id, before: { imputations: before }, after: { imputations: imps },
        metadata: { action: "reimpute", reason, entry, names },
      }, session);
      return r;
    });
    return ok(e);
  }

  const set: Record<string, string> = {};
  if (typeof body.label === "string" && body.label.trim()) set.label = body.label.trim().slice(0, 300);
  if (typeof body.reference === "string" && body.reference.trim()) set.reference = body.reference.trim().slice(0, 80);
  if (!Object.keys(set).length) return badRequest("Rien à modifier (libellé ou référence).");
  // Écriture produite par un document : sa référence le relie au document et
  // sert de garde (reprise d'ouverture, variation de stock, dotation). La
  // renommer permettait de refaire une seconde reprise et de doubler le bilan.
  if (cur.linkedDocType && cur.linkedDocType !== "manual" && set.reference && set.reference !== cur.reference) {
    return badRequest("Écriture produite par un document : sa référence ne se modifie pas.");
  }
  // Seuls les champs qui changent vraiment : pas d'entrée vide au journal.
  for (const k of Object.keys(set)) if (set[k] === (cur as unknown as Record<string, unknown>)[k]) delete set[k];
  if (!Object.keys(set).length) return badRequest("Rien à modifier : libellé et pièce identiques.");
  // Période verrouillée : plus rien ne se modifie, pas même le libellé.
  await refuseIfLocked(auth.tenantId, cur.entryDate);
  const e = await withTransaction(async session => {
    // Verrou relu dans la transaction : un verrouillage posé entre-temps l'emporte.
    await refuseIfLocked(auth.tenantId, cur.entryDate, session);
    // Mise à jour conditionnée aux valeurs lues : l'« avant » journalisé est
    // exactement celui que la modification remplace (le scellement s'y fie).
    const r = await AccountingEntryModel.findOneAndUpdate(
      { _id: params.id, ...tenantFilter(auth), label: cur.label, reference: cur.reference },
      { $set: set }, { new: true, session },
    );
    if (!r) throw new BusinessRuleError("L'écriture a été modifiée entre-temps : rechargez la page et recommencez.");
    // Ancienne valeur gardée : l'écriture scellée n'en conserve que l'empreinte.
    await logAuditInTx(auth, "UPDATE", "accountingEntries", {
      resourceId: params.id,
      before: Object.fromEntries(Object.keys(set).map(k => [k, (cur as unknown as Record<string, unknown>)[k]])),
      after: set, metadata: { reason, entry },
    }, session);
    return r;
  });
  return ok(e);
});

type CurEntry = {
  linkedDocType?: string; entryDate: Date; journalCode?: string; reference: string; label: string;
  lines: Array<Imputation & { debit?: number }>; reversedBy?: unknown; reverses?: unknown;
};

async function refuseIfLocked(tenantId: string, entryDate: Date, session?: ClientSession) {
  const t = await TenantModel.findById(tenantId).select("accountingLockedUntil").session(session ?? null)
    .lean<{ accountingLockedUntil?: Date } | null>();
  if (t?.accountingLockedUntil && new Date(entryDate) <= new Date(t.accountingLockedUntil)) {
    throw new BusinessRuleError(`Période verrouillée jusqu'au ${new Date(t.accountingLockedUntil).toLocaleDateString("fr-FR", { timeZone: "UTC" })} : l'écriture ne se modifie plus.`);
  }
}

const impKey = (i: Imputation) => `${i.projectId ?? ""}|${i.activityId ?? ""}|${i.costCenter ?? ""}`;
const sameImputations = (a: Imputation[], b: Imputation[]) => a.length === b.length && a.every((x, i) => impKey(x) === impKey(b[i]));

/** Noms des projets et secteurs cités, pour un journal lisible sans identifiants. */
async function imputationNames(tenantId: string, imps: Imputation[]): Promise<Record<string, string>> {
  const pids = [...new Set(imps.map(i => i.projectId && String(i.projectId)).filter(Boolean))] as string[];
  const aids = [...new Set(imps.map(i => i.activityId && String(i.activityId)).filter(Boolean))] as string[];
  const [projects, activities] = await Promise.all([
    pids.length ? ProjectModel.find({ _id: { $in: pids }, tenantId }).select("code name").lean<Array<{ _id: unknown; code?: string; name?: string }>>() : [],
    aids.length ? ActivityModel.find({ _id: { $in: aids }, tenantId }).select("name").lean<Array<{ _id: unknown; name?: string }>>() : [],
  ]);
  const out: Record<string, string> = {};
  for (const p of projects) out[String(p._id)] = [p.code, p.name].filter(Boolean).join(" — ");
  for (const a of activities) out[String(a._id)] = a.name ?? "";
  return out;
}
