/**
 * Service d'envoi WhatsApp — Kanoo.
 * Fournisseurs : meta (WhatsApp Cloud API) | twilio | console.
 * Envoi réel uniquement si les identifiants sont configurés ; sinon journalise
 * (mode console), exactement comme le service email.
 *
 * Variables d'environnement :
 *   WHATSAPP_PROVIDER=meta|twilio|console
 *   Meta   : WHATSAPP_TOKEN, WHATSAPP_PHONE_ID
 *   Twilio : TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
 *
 * Modèles de message (« templates ») : WhatsApp n'accepte un texte libre que
 * dans les 24 h qui suivent le dernier message reçu du destinataire. Tout ce
 * que Kanoo envoie de lui-même (brief, relances, billets) doit donc passer par
 * un modèle approuvé par Meta. WHATSAPP_TEMPLATE_<NATURE> porte son nom
 * (Meta) ou son Content SID « HX… » (Twilio) ; WHATSAPP_TEMPLATE_LANG la
 * langue (défaut fr). Sans modèle, le texte libre est tenté — il n'aboutit
 * que si une conversation est ouverte.
 */

export type WhatsAppTemplateKind = "brief" | "cotisation" | "relance" | "billet";

/** Modèles attendus : variable, paramètres dans l'ordre, texte à faire approuver. */
export const WHATSAPP_TEMPLATES: Record<WhatsAppTemplateKind, { env: string; label: string; params: string[]; suggested: string }> = {
  brief: {
    env: "WHATSAPP_TEMPLATE_BRIEF", label: "Brief du matin",
    params: ["prénom", "organisation", "trésorerie", "priorités"],
    suggested: "Bonjour {{1}}, voici le point du jour pour {{2}}. Trésorerie disponible : {{3}}. Priorités : {{4}}. Ouvrez Kanoo pour le détail.",
  },
  cotisation: {
    env: "WHATSAPP_TEMPLATE_COTISATION", label: "Relance de cotisation",
    params: ["prénom", "année", "association", "montant"],
    suggested: "Bonjour {{1}}, votre cotisation {{2}} à {{3}} ({{4}}) reste à régler. Si c'est déjà fait, merci de ne pas tenir compte de ce message.",
  },
  relance: {
    env: "WHATSAPP_TEMPLATE_RELANCE", label: "Relance de facture client",
    params: ["client", "n° de facture", "montant dû", "échéance", "entreprise"],
    suggested: "Bonjour {{1}}, sauf erreur de notre part, la facture {{2}} d'un montant de {{3}}, échue le {{4}}, reste à régler. Merci de votre règlement. {{5}}",
  },
  billet: {
    env: "WHATSAPP_TEMPLATE_BILLET", label: "Billet d'événement",
    params: ["participant", "événement", "date", "lieu", "code d'entrée"],
    suggested: "Bonjour {{1}}, voici votre billet pour {{2}}, le {{3}} ({{4}}). Code d'entrée : {{5}}. Présentez-le à l'accueil.",
  },
};

export interface WhatsAppMessage {
  to: string;
  /** Texte libre (dans une conversation ouverte, ou faute de modèle). */
  text: string;
  /** Modèle à utiliser s'il est configuré, avec ses paramètres dans l'ordre. */
  template?: { kind: WhatsAppTemplateKind; params: string[] };
}

/** Modèle configuré pour une nature d'envoi, ou null. */
export function templateFor(kind: WhatsAppTemplateKind): { name: string; lang: string } | null {
  const name = process.env[WHATSAPP_TEMPLATES[kind].env]?.trim();
  return name ? { name, lang: process.env.WHATSAPP_TEMPLATE_LANG || "fr" } : null;
}

/** Natures d'envoi pour lesquelles un modèle est configuré. */
export function whatsappTemplateStatus(): Record<WhatsAppTemplateKind, boolean> {
  return Object.fromEntries((Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplateKind[]).map(k => [k, Boolean(templateFor(k))])) as Record<WhatsAppTemplateKind, boolean>;
}

/**
 * Paramètre de modèle conforme aux règles de Meta : ni saut de ligne, ni
 * tabulation, pas plus de 4 espaces de suite, jamais vide, longueur bornée.
 */
export function templateParam(v: string): string {
  const t = String(v ?? "").replace(/[\r\n\t]+/g, " · ").replace(/ {4,}/g, "   ").trim().slice(0, 900);
  return t || "—";
}

const PROVIDER = process.env.WHATSAPP_PROVIDER || "console";

/** Normalise un numéro en E.164 sans « + » (indicatif Niger 227 par défaut). */
export function normalizePhone(phone: string): string {
  const p = (phone || "").replace(/[^\d+]/g, "");
  if (p.startsWith("+")) return p.slice(1);
  if (p.startsWith("00")) return p.slice(2);
  if (p.length === 8) return "227" + p; // numéro local nigérien
  return p;
}

async function viaMeta(m: WhatsAppMessage): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) throw new Error("WHATSAPP_TOKEN / WHATSAPP_PHONE_ID manquants");
  const tpl = m.template && templateFor(m.template.kind);
  const payload = tpl
    ? {
        messaging_product: "whatsapp", to: normalizePhone(m.to), type: "template",
        template: {
          name: tpl.name, language: { code: tpl.lang },
          components: [{ type: "body", parameters: m.template!.params.map(p => ({ type: "text", text: templateParam(p) })) }],
        },
      }
    : { messaging_product: "whatsapp", to: normalizePhone(m.to), type: "text", text: { body: m.text } };
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Meta WhatsApp ${res.status}: ${await res.text()}`);
}

async function viaTwilio(m: WhatsAppMessage): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !auth || !from) throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM manquants");
  const tpl = m.template && templateFor(m.template.kind);
  const body = new URLSearchParams({
    From: `whatsapp:${from}`,
    To: `whatsapp:+${normalizePhone(m.to)}`,
    // Twilio : le modèle approuvé est désigné par son Content SID, ses
    // variables numérotées à partir de 1.
    ...(tpl
      ? { ContentSid: tpl.name, ContentVariables: JSON.stringify(Object.fromEntries(m.template!.params.map((p, i) => [String(i + 1), templateParam(p)]))) }
      : { Body: m.text }),
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${auth}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Twilio WhatsApp ${res.status}: ${await res.text()}`);
}

export async function sendWhatsApp(m: WhatsAppMessage): Promise<{ sent: boolean; error?: string }> {
  if (PROVIDER === "console" || !m.to) {
    const tpl = m.template && templateFor(m.template.kind);
    console.log(`\n[WhatsApp CONSOLE] → ${m.to || "(vide)"}${tpl ? ` [modèle ${tpl.name} : ${m.template!.params.map(templateParam).join(" | ")}]` : ""}\n${m.text}\n`);
    return { sent: true };
  }
  try {
    if (PROVIDER === "meta") await viaMeta(m);
    else if (PROVIDER === "twilio") await viaTwilio(m);
    else throw new Error(`WHATSAPP_PROVIDER inconnu : ${PROVIDER}`);
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[WhatsApp ERROR] ${message}`);
    return { sent: false, error: message };
  }
}
