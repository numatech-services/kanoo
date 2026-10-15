/**
 * Assistant IA rédactionnel — Kanoo
 *
 * Deux compétences, adossées à l'API Claude (Anthropic) :
 *  1. Rédaction de courriers et correspondances administratives (lettres,
 *     attestations, notes, réponses aux appels d'offres).
 *  2. Rédaction de rapports d'activité, à partir de chiffres agrégés de
 *     l'organisation (CA, factures, adhérents, cotisations, dons, projets…).
 *
 * Le fournisseur d'IA reçoit, à chaque génération, le contexte transmis
 * (objet, destinataire, consignes, et — pour un rapport — les agrégats). Aucune
 * donnée nominative de client ou d'adhérent n'est envoyée : seuls des totaux.
 *
 * Le modèle est réglable par variable d'environnement `AI_MODEL` ; à défaut,
 * `claude-opus-5`. La clé est lue dans `ANTHROPIC_API_KEY` — sans elle, la
 * fonctionnalité se signale indisponible plutôt que de planter.
 */
import Anthropic from "@anthropic-ai/sdk";

const AI_MODEL = process.env.AI_MODEL || "claude-opus-5-5";
const AI_MAX_TOKENS = Number(process.env.AI_MAX_TOKENS || "6000");

/** L'assistant est-il configuré (clé présente) ? */
export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let cached: Anthropic | null = null;
function client(): Anthropic {
  if (!cached) cached = new Anthropic(); // lit ANTHROPIC_API_KEY dans l'environnement
  return cached;
}

export type DraftKind = "courrier" | "rapport" | "attestation" | "note" | "reponse_ao" | "autre";

export interface OrgContext {
  name: string;
  type: "pme" | "association" | "administration";
  /** Chiffres agrégés, uniquement pour un rapport d'activité. */
  stats?: Record<string, string | number>;
  /** Période du rapport, en clair (ex. « année 2026 », « 3e trimestre 2026 »). */
  period?: string;
}

export interface DraftRequest {
  kind: DraftKind;
  subject: string;
  recipient?: string;
  place?: string;
  signatory?: string;
  /** Consignes libres de l'utilisateur : ton, points à couvrir, longueur. */
  instructions?: string;
  org: OrgContext;
}

const TYPE_LABEL: Record<OrgContext["type"], string> = {
  pme: "une entreprise (PME)",
  association: "une association / ONG",
  administration: "une administration publique",
};

const KIND_GUIDANCE: Record<DraftKind, string> = {
  courrier:
    "une lettre administrative formelle : formule d'appel adaptée, corps clair et courtois, formule de politesse de clôture.",
  attestation:
    "une attestation officielle : phrase liminaire « Je soussigné(e)… atteste que… », faits énoncés sans ambiguïté, mention du but « en foi de quoi la présente attestation est délivrée pour servir et valoir ce que de droit ».",
  note:
    "une note de service ou note interne : ton direct, objet en tête, instructions ou informations numérotées si utile.",
  reponse_ao:
    "une lettre de soumission en réponse à un appel d'offres : engagement du soumissionnaire, référence à l'objet du marché, conformité aux exigences, disponibilité et délai.",
  rapport:
    "un rapport d'activité structuré : introduction de cadrage, sections thématiques avec sous-titres, chiffres commentés (jamais inventés — n'utiliser que ceux fournis), et conclusion avec perspectives.",
  autre:
    "un document administratif clair, structuré et professionnel.",
};

/**
 * Construit le prompt système. Il fixe la langue (français administratif du
 * Niger / zone UEMOA), interdit d'inventer des chiffres, et cadre le format de
 * sortie : le corps seul, sans en-tête ni signature (le PDF les ajoute).
 */
function systemPrompt(req: DraftRequest): string {
  return [
    `Tu es un assistant rédactionnel pour ${TYPE_LABEL[req.org.type]} au Niger (zone UEMOA/OHADA).`,
    `Tu rédiges en français administratif soigné, à la fois formel et lisible.`,
    `Tu produis ${KIND_GUIDANCE[req.kind]}`,
    "",
    "Règles impératives :",
    "- N'invente aucun chiffre, montant, date ou fait. N'emploie que les éléments fournis. Si une donnée manque, laisse un repère entre crochets (ex. [montant à compléter]).",
    "- Rends UNIQUEMENT le corps du document : pas d'en-tête, pas de logo, pas de date en tête, pas de bloc signature final (ils sont ajoutés automatiquement à la mise en page).",
    "- Sépare les paragraphes par une ligne vide. N'utilise pas de Markdown (#, *, -) ni de balises ; du texte simple, éventuellement avec des sous-titres en clair pour un rapport.",
    "- Montants en francs CFA (FCFA). Ton respectueux, sans flagornerie.",
  ].join("\n");
}

/** Assemble le message utilisateur : contexte + consignes. */
function userPrompt(req: DraftRequest): string {
  const lines: string[] = [];
  lines.push(`Organisation émettrice : ${req.org.name}.`);
  lines.push(`Type de document : ${req.kind}.`);
  lines.push(`Objet : ${req.subject}.`);
  if (req.recipient) lines.push(`Destinataire :\n${req.recipient}`);
  if (req.place) lines.push(`Lieu : ${req.place}.`);
  if (req.signatory) lines.push(`Signataire : ${req.signatory}.`);

  if (req.kind === "rapport" && req.org.stats && Object.keys(req.org.stats).length > 0) {
    if (req.org.period) lines.push(`Période couverte : ${req.org.period}.`);
    lines.push("Chiffres agrégés de l'organisation (à commenter, sans en inventer d'autres) :");
    for (const [k, v] of Object.entries(req.org.stats)) lines.push(`- ${k} : ${v}`);
  }

  if (req.instructions?.trim()) {
    lines.push("", `Consignes de l'auteur : ${req.instructions.trim()}`);
  }

  lines.push("", "Rédige maintenant le corps du document.");
  return lines.join("\n");
}

export interface DraftResult {
  body: string;
  model: string;
}

/**
 * Génère un premier jet. Lève si la clé n'est pas configurée (à filtrer en
 * amont avec `isAiConfigured`) ou si l'API échoue.
 */
export async function generateDraft(req: DraftRequest): Promise<DraftResult> {
  if (!isAiConfigured()) {
    throw new Error("Assistant IA non configuré (clé absente).");
  }

  // Pensée adaptative : Claude décide de réfléchir davantage pour un rapport
  // chiffré, moins pour une lettre simple. Effort « medium » : bon compromis
  // coût/qualité pour de la rédaction.
  // Repli côté serveur : si le modèle décline la demande, l'API la rejoue
  // sur un modèle de secours choisi selon le motif, dans le même appel.
  const response = await client().beta.messages.create({
    model: AI_MODEL,
    max_tokens: AI_MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: systemPrompt(req),
    messages: [{ role: "user", content: userPrompt(req) }],
  });

  // Toute la chaîne a décliné : le dire, plutôt que « aucun texte ».
  if (response.stop_reason === "refusal") {
    throw new Error("L'assistant a décliné cette demande. Reformulez l'objet ou les consignes.");
  }

  const body = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  if (!body) throw new Error("L'assistant n'a produit aucun texte.");
  return { body, model: response.model };
}
