import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { connectDB } from "@/lib/db";
import { withAuth, ok, badRequest, paymentRequired, serverError } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { readSupplierInvoice, INVOICE_MAX_BYTES, type InvoiceMediaType } from "@/lib/ai-invoice";
import { reserveAiCredit, refundAiCredit, readAiQuota } from "@/lib/ai-quota";
import { SupplierModel } from "@/models/Supplier";
import { logAudit } from "@/lib/audit";
import { tenantAi, aiErrorMessage } from "@/lib/ai-client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Type réel du fichier, d'après ses premiers octets (le type déclaré par le navigateur n'engage personne). */
function sniff(b: Buffer): InvoiceMediaType | null {
  if (b.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "image/png";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  return null;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

/** GET — la lecture automatique est-elle disponible, et combien de crédits restent ce mois-ci ? */
export const GET = withAuth("purchases", "create", async (_req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  return ok({ configured: Boolean(await tenantAi(auth.tenantId)), quota: await readAiQuota(auth.tenantId) });
});

/**
 * POST (multipart, champ « file ») — lit une facture fournisseur (photo JPEG /
 * PNG / WebP ou PDF) et renvoie de quoi pré-remplir le formulaire d'achat.
 * Rien n'est enregistré. Un crédit du quota IA mensuel est réservé avant
 * l'appel et rendu si la lecture échoue.
 */
export const POST = withAuth("purchases", "create", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const ai = await tenantAi(auth.tenantId);
  if (!ai) return paymentRequired("Lecture automatique non activée : l'administrateur branche une clé d'API dans Réglages → Assistant Claude.");

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return badRequest("Joignez la photo ou le PDF de la facture.");
  if (file.size > INVOICE_MAX_BYTES) return badRequest(`Fichier trop lourd (${Math.round(INVOICE_MAX_BYTES / 1024 / 1024)} Mo au plus).`);
  const data = Buffer.from(await file.arrayBuffer());
  const mediaType = sniff(data);
  if (!mediaType) return badRequest("Format non pris en charge : photo JPEG, PNG ou WebP, ou PDF.");

  const reservation = await reserveAiCredit(auth.tenantId);
  if (!reservation.ok) return paymentRequired(`Quota IA mensuel atteint (${reservation.state.quota}). Il repart au 1er du mois prochain.`);

  try {
    const { invoice, warnings, model } = await readSupplierInvoice({ data, mediaType }, ai);

    // Fournisseur connu ? Par NIF d'abord, sinon par nom normalisé.
    const suppliers = await SupplierModel.find({ tenantId: auth.tenantId }).select("_id name nif paymentTermDays")
      .lean<Array<{ _id: unknown; name: string; nif?: string; paymentTermDays?: number }>>();
    const nif = norm(invoice.supplierNif);
    const name = norm(invoice.supplierName);
    const match = (nif && suppliers.find(s => s.nif && norm(s.nif) === nif))
      || (name.length >= 3 && suppliers.find(s => norm(s.name) === name || norm(s.name).includes(name) || name.includes(norm(s.name))))
      || null;

    await logAudit(auth, "CREATE", "purchases", { metadata: { ai: "invoice_reading", model, lines: invoice.lines.length, matchedSupplier: Boolean(match) } });
    return ok({
      invoice, warnings,
      supplier: match ? { _id: String(match._id), name: match.name, paymentTermDays: match.paymentTermDays } : null,
      quota: reservation.state,
    });
  } catch (err) {
    await refundAiCredit(auth.tenantId, reservation.state.month);
    // Erreur de l'API (réseau, surcharge…) : 500 ; refus métier de la lecture
    // (document illisible, pas une facture) : 400 avec son message.
    const msg = aiErrorMessage(err);
    if (msg) return badRequest(msg);
    if (err instanceof Anthropic.APIError || !(err instanceof Error)) return serverError(err);
    return badRequest(err.message);
  }
});
