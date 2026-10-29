/**
 * Lecture d'une facture fournisseur (photo ou PDF) par l'API Claude.
 *
 * Le document est envoyé tel quel au modèle, qui renvoie un JSON contraint par
 * un schéma (sorties structurées) : fournisseur, numéro, dates, lignes avec
 * compte de charge SYSCOHADA et taux de TVA, totaux. Rien n'est enregistré :
 * le résultat pré-remplit le formulaire d'achat, que l'utilisateur vérifie
 * avant de valider. Les montants sont recontrôlés ici (cohérence HT + TVA =
 * TTC) et les écarts signalés plutôt que corrigés en silence.
 */
import Anthropic from "@anthropic-ai/sdk";
import { EXPENSE_ACCOUNTS } from "@/lib/syscohada";
import type { TenantAi } from "@/lib/ai-client";

const AI_MODEL = process.env.AI_MODEL || "claude-opus-5-5";

export const INVOICE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"] as const;
export type InvoiceMediaType = typeof INVOICE_MEDIA_TYPES[number];
/** Taille maximale du fichier (avant encodage base64). */
export const INVOICE_MAX_BYTES = 8 * 1024 * 1024;

export const TVA_RATES = [0, 0.05, 0.1, 0.19] as const;

export interface ExtractedLine { description: string; quantity: number; unitPriceHT: number; tvaRate: number; accountCode: string }
export interface ExtractedInvoice {
  isInvoice: boolean;
  supplierName: string; supplierNif: string; invoiceNumber: string;
  invoiceDate: string; dueDate: string; currency: string;
  lines: ExtractedLine[];
  totalHT: number; totalTVA: number; totalTTC: number;
  notes: string;
}

const ACCOUNT_CODES = EXPENSE_ACCOUNTS.map(a => a.code);

/** Schéma imposé à la réponse (sorties structurées). Chaîne vide = information absente. */
export const INVOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isInvoice", "supplierName", "supplierNif", "invoiceNumber", "invoiceDate", "dueDate", "currency", "lines", "totalHT", "totalTVA", "totalTTC", "notes"],
  properties: {
    isInvoice: { type: "boolean", description: "true si le document est bien une facture, un reçu ou un ticket d'achat" },
    supplierName: { type: "string" },
    supplierNif: { type: "string", description: "NIF du fournisseur s'il figure, sinon chaîne vide" },
    invoiceNumber: { type: "string" },
    invoiceDate: { type: "string", description: "AAAA-MM-JJ, ou chaîne vide" },
    dueDate: { type: "string", description: "AAAA-MM-JJ, ou chaîne vide" },
    currency: { type: "string", description: "Code ISO (XOF pour le franc CFA)" },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unitPriceHT", "tvaRate", "accountCode"],
        properties: {
          description: { type: "string" },
          quantity: { type: "number" },
          unitPriceHT: { type: "number", description: "Prix unitaire hors taxes" },
          tvaRate: { type: "number", enum: [...TVA_RATES] },
          accountCode: { type: "string", enum: ACCOUNT_CODES },
        },
      },
    },
    totalHT: { type: "number" },
    totalTVA: { type: "number" },
    totalTTC: { type: "number" },
    notes: { type: "string", description: "Ce qui est illisible, ambigu ou estimé ; chaîne vide sinon" },
  },
} as const;

function systemPrompt(): string {
  return [
    "Tu lis des factures fournisseurs, reçus et tickets de caisse d'entreprises au Niger (zone UEMOA, plan comptable SYSCOHADA révisé).",
    "Tu restitues fidèlement ce qui est écrit sur le document : n'invente ni montant, ni numéro, ni date. Une information absente ou illisible vaut une chaîne vide (ou 0 pour un montant), et tu le signales dans « notes ».",
    "Montants en unités de la devise, sans séparateur de milliers (le franc CFA n'a pas de centimes). Si le document n'indique qu'un TTC sans TVA distincte, la TVA vaut 0 et le prix HT est le prix affiché.",
    "TVA : 19 % est le taux normal au Niger ; n'applique un taux que s'il figure sur le document ou s'en déduit sans ambiguïté.",
    "Pour chaque ligne, choisis le compte de charge le plus juste parmi cette liste (code — libellé) :",
    ...EXPENSE_ACCOUNTS.map(a => `${a.code} — ${a.label}`),
  ].join("\n");
}

export function isAiInvoiceConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!cached) cached = new Anthropic();
  return cached;
}

/** Contrôles arithmétiques : retourne les écarts à signaler à l'utilisateur. */
export function checkInvoice(x: ExtractedInvoice): string[] {
  const warnings: string[] = [];
  const ht = x.lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPriceHT), 0);
  const tva = x.lines.reduce((s, l) => s + Math.round(Math.round(l.quantity * l.unitPriceHT) * l.tvaRate), 0);
  const tol = (v: number) => Math.max(2, Math.abs(v) * 0.005);
  if (x.totalHT > 0 && Math.abs(ht - x.totalHT) > tol(x.totalHT)) warnings.push(`La somme des lignes (${ht.toLocaleString("fr-FR")} HT) diffère du total HT lu (${x.totalHT.toLocaleString("fr-FR")}).`);
  if (x.totalTTC > 0 && Math.abs(ht + tva - x.totalTTC) > tol(x.totalTTC)) warnings.push(`HT + TVA (${(ht + tva).toLocaleString("fr-FR")}) ne retombe pas sur le TTC lu (${x.totalTTC.toLocaleString("fr-FR")}) : vérifiez la TVA et les remises.`);
  if (x.currency && x.currency.toUpperCase() !== "XOF") warnings.push(`Facture en ${x.currency} : convertissez les montants en FCFA avant de valider.`);
  if (x.invoiceDate && !/^\d{4}-\d{2}-\d{2}$/.test(x.invoiceDate)) warnings.push("Date de facture illisible.");
  return warnings;
}

/** Normalise la réponse : bornes, dates valides, lignes vides retirées. */
export function normalizeExtraction(raw: ExtractedInvoice): ExtractedInvoice {
  const date = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) ? s : "");
  const num = (n: number) => (Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0);
  return {
    ...raw,
    supplierName: raw.supplierName.trim().slice(0, 160),
    supplierNif: raw.supplierNif.trim().slice(0, 40),
    invoiceNumber: raw.invoiceNumber.trim().slice(0, 80),
    invoiceDate: date(raw.invoiceDate), dueDate: date(raw.dueDate),
    currency: (raw.currency || "XOF").trim().toUpperCase().slice(0, 3),
    lines: raw.lines
      .map(l => ({
        description: l.description.trim().slice(0, 300),
        quantity: num(l.quantity) || 1,
        unitPriceHT: num(l.unitPriceHT),
        tvaRate: (TVA_RATES as readonly number[]).includes(l.tvaRate) ? l.tvaRate : 0,
        accountCode: ACCOUNT_CODES.includes(l.accountCode) ? l.accountCode : "605500",
      }))
      .filter(l => l.description && l.unitPriceHT > 0)
      .slice(0, 50),
    totalHT: num(raw.totalHT), totalTVA: num(raw.totalTVA), totalTTC: num(raw.totalTTC),
    notes: raw.notes.trim().slice(0, 1000),
  };
}

/**
 * Envoie le document au modèle et retourne l'extraction normalisée et les
 * écarts constatés. Lève une Error au message affichable en cas d'échec.
 */
export async function readSupplierInvoice(file: { data: Buffer; mediaType: InvoiceMediaType }, ai?: TenantAi): Promise<{ invoice: ExtractedInvoice; warnings: string[]; model: string }> {
  if (!ai && !isAiInvoiceConfigured()) throw new Error("Lecture automatique non configurée (clé d'API absente).");
  const data = file.data.toString("base64");
  const source: Anthropic.Beta.BetaContentBlockParam = file.mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: file.mediaType, data } };

  // Repli côté serveur sur décision du modèle (fallbacks), sortie contrainte
  // par le schéma. Effort « medium » : une facture photographiée de travers
  // demande de la lecture attentive, pas un raisonnement long.
  const response = await (ai?.client ?? client()).beta.messages.create({
    model: ai?.model ?? AI_MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: INVOICE_SCHEMA as unknown as Record<string, unknown> } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [source, { type: "text", text: "Extrais les informations de ce document d'achat." }] }],
  });

  if (response.stop_reason === "refusal") throw new Error("Le document n'a pas pu être lu. Saisissez la facture à la main.");
  if (response.stop_reason === "max_tokens") throw new Error("Document trop long pour une lecture automatique : saisissez-le à la main.");
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map(b => b.text).join("");
  let parsed: ExtractedInvoice;
  try {
    parsed = JSON.parse(text) as ExtractedInvoice;
  } catch {
    throw new Error("Réponse illisible de l'assistant : réessayez ou saisissez la facture à la main.");
  }
  if (!parsed.isInvoice) throw new Error("Ce document ne ressemble pas à une facture ou à un reçu.");
  const invoice = normalizeExtraction(parsed);
  return { invoice, warnings: [...checkInvoice(invoice), ...(invoice.notes ? [invoice.notes] : [])], model: response.model };
}
