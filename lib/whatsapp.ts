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
 */

export interface WhatsAppMessage {
  to: string;
  text: string;
}

const PROVIDER = process.env.WHATSAPP_PROVIDER || "console";

/** Normalise un numéro en E.164 sans « + » (indicatif Niger 227 par défaut). */
export function normalizePhone(phone: string): string {
  let p = (phone || "").replace(/[^\d+]/g, "");
  if (p.startsWith("+")) return p.slice(1);
  if (p.startsWith("00")) return p.slice(2);
  if (p.length === 8) return "227" + p; // numéro local nigérien
  return p;
}

async function viaMeta(m: WhatsAppMessage): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) throw new Error("WHATSAPP_TOKEN / WHATSAPP_PHONE_ID manquants");
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizePhone(m.to),
      type: "text",
      text: { body: m.text },
    }),
  });
  if (!res.ok) throw new Error(`Meta WhatsApp ${res.status}: ${await res.text()}`);
}

async function viaTwilio(m: WhatsAppMessage): Promise<void> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !auth || !from) throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM manquants");
  const body = new URLSearchParams({
    From: `whatsapp:${from}`,
    To: `whatsapp:+${normalizePhone(m.to)}`,
    Body: m.text,
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
    console.log(`\n[WhatsApp CONSOLE] → ${m.to || "(vide)"}\n${m.text}\n`);
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
