import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, ok, notFound, badRequest, tenantFilter } from "@/lib/api-helpers";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TenantModel } from "@/models/Tenant";
import { logAudit } from "@/lib/audit";
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

/** PATCH — libellé et référence seulement : les montants se corrigent par extourne. */
export const PATCH = withAuth("accountingEntries", "update", async (req: NextRequest, auth: TokenPayload, params) => {
  await connectDB();
  const body = await req.json().catch(() => ({}));
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
