/**
 * Préparer un devis (ou une proforma) avec Claude.
 *
 * L'utilisateur décrit le besoin en quelques lignes (« salle de réunion
 * équipée : écran 86 pouces, caméra, pose et formation ») ; Claude propose
 * l'objet, les postes, les lignes avec leur descriptif et les conditions.
 * Rien n'est enregistré : la proposition remplit le formulaire, relu avant
 * l'enregistrement.
 *
 * Kanoo reste maître des prix : une ligne rattachée au catalogue prend le
 * prix et la TVA du catalogue, quoi qu'ait écrit le modèle, et le
 * rapprochement est signalé ; une ligne hors catalogue ne garde un prix que
 * s'il figure dans la demande, sinon 0 (« à chiffrer »).
 * Sont transmis : la demande telle que saisie (l'écran demande de n'y mettre
 * aucune donnée personnelle), le catalogue et les conditions habituelles.
 */
import Anthropic from "@anthropic-ai/sdk";
import { BusinessRuleError } from "@/lib/errors";
import type { TenantAi } from "@/lib/ai-client";

export const TVA_RATES = [0, 0.05, 0.1, 0.19] as const;
export const BRIEF_MAX = 4000;
export const CATALOGUE_MAX = 300;

export interface CatalogueItem { _id: string; code: string; label: string; unit?: string; unitPrice: number; tvaRate?: number; description?: string }

export interface DraftLine {
  section: string; title: string; details: string; unit: string;
  quantity: number; catalogCode: string; unitPrice: number; tvaRate: number;
}
export interface QuoteDraftRaw {
  object: string; reference: string; period: string; attention: string;
  lines: DraftLine[]; terms: string; missing: string[];
}

/** Schéma imposé à la réponse (sorties structurées). Chaîne vide = sans objet. */
export const QUOTE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["object", "reference", "period", "attention", "lines", "terms", "missing"],
  properties: {
    object: { type: "string", description: "Objet du document, une phrase, sans « Objet : »" },
    reference: { type: "string", description: "Référence citée dans la demande (convention, appel d'offres, bon de commande), sinon chaîne vide" },
    period: { type: "string", description: "Période de la prestation si la demande en donne une, sinon chaîne vide" },
    attention: { type: "string", description: "Destinataire (« Madame la Directrice générale ») si la demande le précise, sinon chaîne vide" },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "title", "details", "unit", "quantity", "catalogCode", "unitPrice", "tvaRate"],
        properties: {
          section: { type: "string", description: "Poste qui regroupe les lignes (« Audiovisuel », « Prestations »), ou chaîne vide" },
          title: { type: "string", description: "Intitulé court, imprimé en gras" },
          details: { type: "string", description: "Descriptif technique et contenu de la prestation, 1 à 3 phrases" },
          unit: { type: "string", description: "u, ens., forfait, m², ml, kg, h/j, jour, mois…" },
          quantity: { type: "number" },
          catalogCode: { type: "string", description: "Code de l'article du catalogue s'il correspond, sinon chaîne vide" },
          unitPrice: { type: "number", description: "Prix unitaire HT : celui du catalogue, ou celui donné dans la demande, sinon 0" },
          tvaRate: { type: "number", enum: [...TVA_RATES] },
        },
      },
    },
    terms: { type: "string", description: "Conditions, une par ligne, au format « Titre — texte »" },
    missing: { type: "array", items: { type: "string" }, description: "Ce qu'il faut préciser ou chiffrer avant envoi" },
  },
} as const;

/** Une cellule du catalogue sur une seule ligne : un libellé ne peut pas glisser d'instructions sur des lignes à lui. */
const cell = (v: string) => String(v ?? "").replace(/[\r\n|]+/g, " ").slice(0, 160);

/** Nombres écrits dans la demande (« 79 800 », « 3.467.660 », « 140000 F »), pour reconnaître un prix donné. */
export function numbersIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/\d{1,3}(?:[ .\u00a0\u202f]\d{3})+|\d+/g)) out.add(Number(m[0].replace(/[ .\u00a0\u202f]/g, "")));
  return out;
}

function systemPrompt(opts: { orgName: string; docKind: "devis" | "proforma"; catalogue: CatalogueItem[]; defaultTerms?: string }): string {
  const doc = opts.docKind === "proforma" ? "une facture proforma" : "un devis";
  return [
    `Tu prépares ${doc} pour ${opts.orgName}, entreprise au Niger (zone UEMOA, francs CFA, TVA normale 19 %).`,
    "Tu rédiges en français commercial soigné : intitulés courts et précis, descriptifs techniques concrets (caractéristiques, contenu de la prestation, livrables), sans superlatifs.",
    "",
    "Règles impératives :",
    "- Prix : pour un article du catalogue ci-dessous, indique son code dans catalogCode et reprends son prix. Pour un élément hors catalogue, n'utilise que le prix donné dans la demande ; sinon mets 0 et ajoute-le dans « missing ». N'invente jamais un prix.",
    "- Quantités : celles de la demande ; à défaut 1, et signale-le dans « missing » si c'est douteux.",
    "- Regroupe les lignes par poste (section) quand il y en a plusieurs natures (fournitures, travaux, prestations) ; sinon laisse section vide.",
    "- N'invente ni référence, ni destinataire, ni période : chaîne vide si la demande ne les donne pas.",
    "- Conditions : validité de l'offre, modalités de règlement, délai de livraison ou d'exécution, garantie si pertinent — une par ligne, « Titre — texte ». Reprends les conditions habituelles de l'organisation si elles sont fournies.",
    "",
    opts.defaultTerms?.trim() ? `Conditions habituelles de l'organisation :\n${opts.defaultTerms.trim().slice(0, 2000)}\n` : "",
    opts.catalogue.length
      ? `Catalogue (code | désignation | unité | prix unitaire HT | TVA) :\n${opts.catalogue.map(c => `${cell(c.code)} | ${cell(c.label)} | ${cell(c.unit || "u")} | ${Math.round(c.unitPrice)} | ${Math.round((c.tvaRate ?? 0.19) * 100)} %`).join("\n")}`
      : "Le catalogue de l'organisation est vide : tous les prix viennent de la demande, ou valent 0.",
  ].join("\n");
}

export interface QuoteDraft {
  mentions: { object: string; reference: string; period: string; attention: string };
  lines: Array<{ productId?: string; section: string; description: string; details: string; unit: string; quantity: number; unitPrice: number; tvaRate: number; discount: number }>;
  terms: string;
  warnings: string[];
}

/**
 * Proposition du modèle → lignes du formulaire. Le catalogue fait foi pour les
 * prix ; bornes de longueur ; lignes vides retirées.
 */
export function reconcileQuote(raw: QuoteDraftRaw, catalogue: CatalogueItem[], brief = ""): QuoteDraft {
  const byCode = new Map(catalogue.filter(c => c.code?.trim()).map(c => [c.code.trim().toLowerCase(), c]));
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const warnings = (Array.isArray(raw.missing) ? raw.missing : []).map(m => str(m).trim()).filter(Boolean).slice(0, 12);
  const num = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const given = numbersIn(brief);
  const lines = (Array.isArray(raw.lines) ? raw.lines : []).map(l => ({ ...l, title: str(l.title), details: str(l.details), section: str(l.section), unit: str(l.unit), catalogCode: str(l.catalogCode) }))
    .filter(l => l.title.trim()).slice(0, 60).map(l => {
    const item = l.catalogCode.trim() ? byCode.get(l.catalogCode.trim().toLowerCase()) : undefined;
    const quantity = Math.max(0.01, Math.round((num(l.quantity) || 1) * 100) / 100);
    if (item) {
      // Rapprochement visible : l'utilisateur vérifie que c'est bien l'article voulu.
      if (item.label.trim().toLowerCase() !== l.title.trim().toLowerCase()) warnings.push(`« ${l.title.trim().slice(0, 60)} » : article du catalogue retenu ${item.code} — ${item.label.slice(0, 60)}, à son prix.`);
      return {
        productId: item._id, section: l.section.trim().slice(0, 80), description: l.title.trim().slice(0, 300),
        details: l.details.trim().slice(0, 2000), unit: (l.unit || item.unit || "u").trim().slice(0, 20),
        quantity, unitPrice: item.unitPrice, tvaRate: item.tvaRate ?? 0.19, discount: 0,
      };
    }
    // Hors catalogue : un prix n'est gardé que s'il figure dans la demande.
    const proposed = Math.round(num(l.unitPrice));
    const unitPrice = given.has(proposed) ? proposed : 0;
    if (!unitPrice) warnings.push(`« ${l.title.trim().slice(0, 80)} » : prix à chiffrer.`);
    return {
      section: l.section.trim().slice(0, 80), description: l.title.trim().slice(0, 300), details: l.details.trim().slice(0, 2000),
      unit: (l.unit || "u").trim().slice(0, 20), quantity, unitPrice,
      tvaRate: (TVA_RATES as readonly number[]).includes(l.tvaRate) ? l.tvaRate : 0.19, discount: 0,
    };
  });
  return {
    mentions: {
      object: str(raw.object).trim().slice(0, 600), reference: str(raw.reference).trim().slice(0, 120),
      period: str(raw.period).trim().slice(0, 120), attention: str(raw.attention).trim().slice(0, 160),
    },
    lines, terms: str(raw.terms).trim().slice(0, 4000), warnings: [...new Set(warnings)].slice(0, 20),
  };
}

export async function draftQuote(
  ai: TenantAi,
  req: { brief: string; docKind: "devis" | "proforma"; orgName: string; catalogue: CatalogueItem[]; defaultTerms?: string },
): Promise<QuoteDraft & { model: string }> {
  // Repli côté serveur sur décision du modèle (fallbacks), sortie contrainte
  // par le schéma. Le catalogue est en tête et en cache : il change peu d'une
  // demande à l'autre.
  const response = await ai.client.beta.messages.create({
    model: ai.model,
    max_tokens: 12000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: QUOTE_SCHEMA as unknown as Record<string, unknown> } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: systemPrompt(req), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Demande :\n${req.brief.slice(0, BRIEF_MAX)}\n\nPrépare le document.` }],
  });
  if (response.stop_reason === "refusal") throw new BusinessRuleError("Claude a décliné cette demande : reformulez-la.");
  if (response.stop_reason === "max_tokens") throw new BusinessRuleError("Demande trop longue pour un seul document : découpez-la.");
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map(b => b.text).join("");
  let raw: QuoteDraftRaw;
  try { raw = JSON.parse(text) as QuoteDraftRaw; }
  catch { throw new BusinessRuleError("Réponse illisible de Claude : réessayez."); }
  return { ...reconcileQuote(raw, req.catalogue, req.brief), model: response.model };
}
