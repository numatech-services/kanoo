import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TenantModel } from "@/models/Tenant";
import { logAudit } from "@/lib/audit";
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
 */
export const PATCH = withAuth("accountingEntries", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
  if (Array.isArray(body.imputations)) {
    const cur = await AccountingEntryModel.findOne({ _id: params.id, ...tenantFilter(auth) }).select("linkedDocType lines")
      .lean<{ linkedDocType?: string; lines: Imputation[] } | null>();
    if (!cur) return notFound();
    if (cur.linkedDocType && cur.linkedDocType !== "manual") return badRequest("Écriture produite par un document : corrigez l'imputation sur le document (facture, achat…).");
    if (body.imputations.length !== cur.lines.length) return badRequest("Une imputation par ligne de l'écriture.");
    // Contrôle sur la saisie brute : un identifiant invalide est refusé, pas effacé en silence.
    const err = await checkImputations(auth.tenantId, body.imputations.map((x: unknown) => (x && typeof x === "object" ? x : {})));
    if (err) return badRequest(err);
    const imps: Imputation[] = body.imputations.map(pickImputation);
    const e = await reimputeEntry(auth.tenantId, params.id, new Map(imps.map((imp, i) => [i, imp])));
    await logAudit(auth, "UPDATE", "accountingEntries", { resourceId: params.id, before: { imputations: cur.lines.map(pickImputation) }, after: { imputations: imps }, metadata: { action: "reimpute" } });
    return ok(e);
  }
  const set: Record<string, string> = {};
  if (typeof body.label === "string" && body.label.trim()) set.label = body.label.trim().slice(0, 300);
  if (typeof body.reference === "string" && body.reference.trim()) set.reference = body.reference.trim().slice(0, 80);
  if (!Object.keys(set).length) return badRequest("Rien à modifier (libellé ou référence).");
  const cur = await AccountingEntryModel.findOne({ _id: params.id, ...tenantFilter(auth) }).select("linkedDocType entryDate tenantId reference")
    .lean<{ linkedDocType?: string; entryDate: Date; reference: string } | null>();
  if (!cur) return notFound();
  // Période verrouillée : plus rien ne se modifie, pas même le libellé.
  const t = await TenantModel.findById(auth.tenantId).select("accountingLockedUntil").lean<{ accountingLockedUntil?: Date } | null>();
  if (t?.accountingLockedUntil && new Date(cur.entryDate) <= new Date(t.accountingLockedUntil)) return badRequest("Période verrouillée : l'écriture ne se modifie plus.");
  // Écriture produite par un document : sa référence le relie au document et
  // sert de garde (reprise d'ouverture, variation de stock, dotation). La
  // renommer permettait de refaire une seconde reprise et de doubler le bilan.
  if (cur.linkedDocType && cur.linkedDocType !== "manual" && set.reference && set.reference !== cur.reference) {
    return badRequest("Écriture produite par un document : sa référence ne se modifie pas.");
  }
  const e = await AccountingEntryModel.findOneAndUpdate({ _id: params.id, ...tenantFilter(auth) }, { $set: set }, { new: true });
  if (!e) return notFound();
  await logAudit(auth, "UPDATE", "accountingEntries", { resourceId: params.id, after: set });
  return ok(e);
});
