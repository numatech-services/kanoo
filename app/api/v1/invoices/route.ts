import { NextRequest, NextResponse } from "next/server";
import { connectDB, withTransaction } from "@/lib/db";
import { validateApiKey, ApiV1Context } from "@/lib/api-v1-middleware";
import { InvoiceModel } from "@/models/Invoice";
import { ClientModel } from "@/models/Client";
import { computeInvoiceLines } from "@/lib/invoice-entry";
import { provisionalNumber } from "@/lib/numbering";
import { parseDraft } from "@/lib/api-v1-draft";
import { easypayActor } from "@/lib/easypay-server";
import { logAudit } from "@/lib/audit";

const CHAMPS = "number status totalHT totalTVA totalTTC paidAmount creditedAmount writtenOffAmount issueDate dueDate clientId reference externalRef";

const peut = (ctx: ApiV1Context, scope: string) => ctx.scopes.includes(scope) || ctx.scopes.includes("*");

/** Ce que l'API rend d'une facture : le code client plutôt que son identifiant interne. */
function vue(i: Record<string, unknown>) {
  const client = i.clientId as { code?: string } | null | undefined;
  return { ...i, clientId: undefined, clientCode: client?.code ?? null };
}

/**
 * GET /api/v1/invoices
 * API publique — authentification par clé API (Bearer kno_xxx)
 * Scope requis: invoices:read. Filtres : status, externalRef (une ou plusieurs, séparées par des virgules).
 */
export async function GET(req: NextRequest) {
  const auth = await validateApiKey(req);
  if ("error" in auth) return auth.error;
  if (!peut(auth.context, "invoices:read")) {
    return NextResponse.json({ error: "Scope insuffisant. Requis: invoices:read" }, { status: 403 });
  }

  await connectDB();
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1") || 1);
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get("limit") || "20") || 20), 100);
  const status = url.searchParams.get("status");
  const refs = (url.searchParams.get("externalRef") || "").split(",").map(r => r.trim()).filter(Boolean).slice(0, 100);

  const filter: Record<string, unknown> = { tenantId: auth.context.tenantId };
  if (status) filter.status = status;
  if (refs.length) filter.externalRef = { $in: refs };

  const [items, total] = await Promise.all([
    InvoiceModel.find(filter).select(CHAMPS).populate("clientId", "code").sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).lean<Record<string, unknown>[]>(),
    InvoiceModel.countDocuments(filter),
  ]);

  return NextResponse.json({
    success: true,
    data: { items: items.map(vue), pagination: { page, limit, total, totalPages: Math.ceil(total/limit) } },
    api_version: "v1",
    docs: "https://docs.kanoo.ne/api/v1/invoices",
  });
}

/**
 * POST /api/v1/invoices — crée un BROUILLON, jamais une facture émise.
 * Scope requis: invoices:write. Idempotent sur externalRef : rejouer rend le brouillon existant (200).
 * Numéro définitif, TVA, émission et SECeF restent dans Kanoo : voir docs/API-BROUILLONS.md.
 */
export async function POST(req: NextRequest) {
  const auth = await validateApiKey(req);
  if ("error" in auth) return auth.error;
  if (!peut(auth.context, "invoices:write")) {
    return NextResponse.json({ error: "Scope insuffisant. Requis: invoices:write" }, { status: 403 });
  }
  const parsed = parseDraft(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { draft } = parsed;
  const { tenantId, userId } = auth.context;

  await connectDB();
  const existante = () => InvoiceModel.findOne({ tenantId, externalRef: draft.externalRef }).select(CHAMPS).populate("clientId", "code").lean<Record<string, unknown>>();
  const deja = await existante();
  if (deja) return NextResponse.json({ success: true, data: vue(deja), existing: true });

  const client = await ClientModel.findOne({ tenantId, code: draft.clientCode }).select("_id").lean<{ _id: unknown }>();
  if (!client) return NextResponse.json({ error: `Client inconnu : ${draft.clientCode}` }, { status: 404 });
  if (!userId) return NextResponse.json({ error: "Cette clé n'a pas d'auteur : recréez-la depuis un compte." }, { status: 403 });
  // Avant toute écriture : une clé dont l'auteur a quitté l'organisation ne crée plus rien.
  const actor = await easypayActor({ tenantId, userId }).catch(() => null);
  if (!actor) return NextResponse.json({ error: "L'auteur de cette clé n'est plus actif." }, { status: 403 });

  const { lines, totalHT, totalTVA, totalDTS, totalTTC } = computeInvoiceLines(draft.lines);
  try {
    const invoice = await withTransaction(async (session) => {
      const [i] = await InvoiceModel.create([{
        clientId: client._id, issueDate: draft.issueDate, dueDate: draft.dueDate, object: draft.object, reference: draft.reference, period: draft.period,
        externalRef: draft.externalRef, lines, number: provisionalNumber(), totalHT, totalTVA, totalDTS, totalTTC,
        paidAmount: 0, tenantId, createdBy: userId, status: "draft",
      }], { session });
      return i;
    });
    await logAudit(actor, "CREATE", "invoices", { resourceId: String(invoice._id), after: { number: invoice.number, totalTTC, externalRef: draft.externalRef }, metadata: { apiKey: auth.context.keyId } });
    const cree = await existante();
    return NextResponse.json({ success: true, data: cree ? vue(cree) : null }, { status: 201 });
  } catch (e) {
    // Deux envois simultanés : l'index unique a tranché, l'autre a créé le brouillon.
    const code = (e as { code?: number }).code;
    if (code === 11000 || code === 112) {
      const gagnant = await existante();
      if (gagnant) return NextResponse.json({ success: true, data: vue(gagnant), existing: true });
    }
    throw e;
  }
}
