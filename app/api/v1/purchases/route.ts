import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { connectDB, withTransaction } from "@/lib/db";
import { validateApiKey, ApiV1Context } from "@/lib/api-v1-middleware";
import { PurchaseModel } from "@/models/Purchase";
import { SupplierModel } from "@/models/Supplier";
import { TenantModel } from "@/models/Tenant";
import { nextDocumentNumber } from "@/lib/numbering";
import { parsePurchaseDraft, purchaseLinesFromDraft, draftHash } from "@/lib/api-v1-purchase";
import { findSupplierInvoice, isSupplierKeyConflict } from "@/lib/purchase-dup";
import { easypayActor } from "@/lib/easypay-server";
import { authCan } from "@/lib/role-resources";
import { logAudit } from "@/lib/audit";

const CHAMPS = "externalRef externalHash number status supplierId supplierRef date dueDate totalHT totalTVA totalTTC paidAmount credits";
const peut = (ctx: ApiV1Context, scope: string) => ctx.scopes.includes(scope) || ctx.scopes.includes("*");
const err = (error: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

type P = { externalRef?: string; externalHash?: string; number?: string; status: string; supplierId?: { code?: string } | null; supplierRef?: string; date: Date; dueDate?: Date;
  totalHT: number; totalTVA: number; totalTTC: number; paidAmount?: number; credits?: Array<{ amount?: number }> };
/** Ce que l'API rend d'un achat : le code fournisseur, des montants en F CFA, le numéro Kanoo. */
function vue(p: P) {
  const creditedAmount = (p.credits ?? []).reduce((t, c) => t + (c.amount ?? 0), 0);
  // Numéro Kanoo rendu seulement une fois l'achat validé : un brouillon n'a pas encore de pièce comptable.
  return { externalRef: p.externalRef ?? null, number: p.status === "draft" || p.status === "cancelled" ? null : p.number ?? null, status: p.status, supplierCode: p.supplierId?.code ?? null, supplierInvoiceRef: p.supplierRef ?? null,
    issueDate: p.date ? new Date(p.date).toISOString().slice(0, 10) : null, dueDate: p.dueDate ? new Date(p.dueDate).toISOString().slice(0, 10) : null,
    totalHT: p.totalHT, totalTVA: p.totalTVA, totalTTC: p.totalTTC, paidAmount: Math.max(0, (p.paidAmount ?? 0) - creditedAmount), creditedAmount };
}

/** GET /api/v1/purchases?externalRef=a,b&status=&limit= — relecture des achats (droit purchases:read). */
export async function GET(req: NextRequest) {
  const auth = await validateApiKey(req);
  if ("error" in auth) return auth.error;
  if (!peut(auth.context, "purchases:read")) return err("Scope insuffisant. Requis: purchases:read", 403);
  await connectDB();
  const url = new URL(req.url);
  const refs = (url.searchParams.get("externalRef") || "").split(",").map(r => r.trim()).filter(Boolean).slice(0, 100);
  const limit = refs.length ? refs.length : Math.min(Math.max(1, parseInt(url.searchParams.get("limit") || "20") || 20), 100);
  const filter: Record<string, unknown> = { tenantId: auth.context.tenantId };
  if (refs.length) filter.externalRef = { $in: refs }; else filter.externalRef = { $type: "string" };
  const status = url.searchParams.get("status");
  if (status) filter.status = status;
  const items = await PurchaseModel.find(filter).select(CHAMPS).populate("supplierId", "code").sort({ createdAt: -1 }).limit(limit).lean<P[]>();
  return NextResponse.json({ success: true, data: { items: items.map(vue) }, api_version: "v1" });
}

/**
 * POST /api/v1/purchases — crée un BROUILLON d'achat fournisseur (droit purchases:write).
 * Idempotent sur externalRef ; une même facture de fournisseur (code + numéro) n'est jamais enregistrée deux fois.
 * Compte de charge, validation, écriture et règlements restent dans Kanoo (docs/API-ACHATS.md).
 */
export async function POST(req: NextRequest) {
  const auth = await validateApiKey(req);
  if ("error" in auth) return auth.error;
  if (!peut(auth.context, "purchases:write")) return err("Scope insuffisant. Requis: purchases:write", 403);
  const parsed = parsePurchaseDraft(await req.json().catch(() => null));
  if ("error" in parsed) return err(parsed.error, 422);
  const { draft } = parsed;
  const { tenantId, userId } = auth.context;
  await connectDB();
  const built = purchaseLinesFromDraft(draft);
  const hash = draftHash(draft);
  const existante = () => PurchaseModel.findOne({ tenantId, externalRef: draft.externalRef }).select(CHAMPS).populate("supplierId", "code").lean<P | null>();
  // Rejeu : même contenu reçu (empreinte) → pièce rendue ; contenu différent → 409. Les ajustements du comptable ne comptent pas.
  const replay = (p: P) => p.externalHash === hash
    ? NextResponse.json({ success: true, data: vue(p), existing: true })
    : err(`externalRef ${draft.externalRef} déjà utilisée pour un achat au contenu différent.`, 409, { data: vue(p) });
  const deja = await existante();
  if (deja) return replay(deja);
  const t = await TenantModel.findById(tenantId).select("accountingLockedUntil").lean<{ accountingLockedUntil?: Date } | null>();
  if (t?.accountingLockedUntil && draft.issueDate <= new Date(t.accountingLockedUntil)) {
    return err(`issueDate dans une période comptable close (jusqu'au ${new Date(t.accountingLockedUntil).toISOString().slice(0, 10)}).`, 422);
  }
  const supplier = await SupplierModel.findOne({ tenantId, code: draft.supplierCode }).select("_id name").lean<{ _id: Types.ObjectId; name: string } | null>();
  if (!supplier) return err(`Fournisseur inconnu : ${draft.supplierCode}`, 404);
  // Une facture de fournisseur n'est jamais comptée deux fois, quelle que soit son origine (saisie manuelle comprise).
  const dupOf = async () => {
    const d = await findSupplierInvoice(tenantId, supplier._id, draft.supplierInvoiceRef);
    if (!d) return null;
    if (d.externalRef === draft.externalRef) { const same = await existante(); if (same) return replay(same); }
    const full = await PurchaseModel.findById(d._id).select(CHAMPS).populate("supplierId", "code").lean<P | null>();
    return err(`Facture ${draft.supplierInvoiceRef} de ${draft.supplierCode} déjà enregistrée.`, 409, full ? { data: vue(full) } : {});
  };
  const dup = await dupOf();
  if (dup) return dup;
  if (!userId) return err("Cette clé n'a pas d'auteur : recréez-la depuis un compte.", 403);
  const actor = await easypayActor({ tenantId, userId }).catch(() => null);
  if (!actor) return err("L'auteur de cette clé n'est plus actif.", 403);
  if (!authCan(actor, "purchases", "create")) return err("L'auteur de cette clé n'a plus le droit de saisir des achats.", 403);
  try {
    const p = await withTransaction(async session => {
      const number = await nextDocumentNumber(tenantId, "purchase", { issueDate: draft.issueDate, session });
      const [doc] = await PurchaseModel.create([{
        tenantId, number, kind: "invoice", supplierId: supplier._id, payee: supplier.name, supplierRef: draft.supplierInvoiceRef,
        date: draft.issueDate, dueDate: draft.dueDate, externalRef: draft.externalRef, externalHash: hash, sourceVat: draft.vatAmount, needsImputation: true, ...built, status: "draft",
        notes: [draft.object, draft.reference && `Réf. ${draft.reference}`, draft.period && `Période ${draft.period}`, "Reçu par l'API : choisir le compte de charge avant validation."].filter(Boolean).join(" — ").slice(0, 2000),
        createdBy: userId,
      }], { session });
      return doc;
    });
    await logAudit(actor, "CREATE", "purchases", { resourceId: String(p._id), after: { number: p.number, totalTTC: p.totalTTC, externalRef: draft.externalRef }, metadata: { apiKey: auth.context.keyId } });
    const cree = await existante();
    return NextResponse.json({ success: true, data: cree ? vue(cree) : null }, { status: 201 });
  } catch (e) {
    // Envois simultanés : un index unique a tranché (même externalRef, ou même facture fournisseur).
    const code = (e as { code?: number }).code;
    if (code === 11000 || code === 112 || isSupplierKeyConflict(e)) {
      const gagnant = await existante();
      if (gagnant) return replay(gagnant);
      const d = await dupOf();
      if (d) return d;
      return err("Envoi simultané d'une même facture : réessayez.", 409);
    }
    throw e;
  }
}
