/**
 * Service SMS — Kanoo Niger
 * Providers supportés : console (dev) | orange | infobip | africastalking
 */

export interface SMSPayload {
  to: string;    // Format international : +22796XXXXXX
  message: string;
}

const SMS_PROVIDER = process.env.SMS_PROVIDER || "console";
const SMS_API_KEY = process.env.SMS_API_KEY || "";
const SMS_SENDER_ID = process.env.SMS_SENDER_ID || "Kanoo";

/**
 * Envoie un SMS.
 * Retourne true si envoyé avec succès, false sinon.
 */
export async function sendSMS(payload: SMSPayload): Promise<boolean> {
  const { to, message } = payload;

  if (SMS_PROVIDER === "console" || !SMS_API_KEY) {
    console.log(`[SMS] TO: ${to} | MSG: ${message}`);
    return true;
  }

  try {
    if (SMS_PROVIDER === "orange") {
      return await sendOrangeSMS(to, message);
    }
    if (SMS_PROVIDER === "infobip") {
      return await sendInfobipSMS(to, message);
    }
    if (SMS_PROVIDER === "africastalking") {
      return await sendAfricasTalkingSMS(to, message);
    }
    console.warn(`[SMS] Provider inconnu: ${SMS_PROVIDER}`);
    return false;
  } catch (err) {
    console.error("[SMS] Erreur envoi:", err);
    return false;
  }
}

async function sendOrangeSMS(to: string, message: string): Promise<boolean> {
  const res = await fetch("https://api.orange.com/smsmessaging/v1/outbound/tel%3A%2B227/requests", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SMS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      outboundSMSMessageRequest: {
        address: `tel:${to}`,
        senderAddress: `tel:${SMS_SENDER_ID}`,
        outboundSMSTextMessage: { message },
      },
    }),
  });
  return res.ok;
}

async function sendInfobipSMS(to: string, message: string): Promise<boolean> {
  const res = await fetch("https://api.infobip.com/sms/2/text/advanced", {
    method: "POST",
    headers: {
      "Authorization": `App ${SMS_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [{ from: SMS_SENDER_ID, destinations: [{ to }], text: message }],
    }),
  });
  return res.ok;
}

async function sendAfricasTalkingSMS(to: string, message: string): Promise<boolean> {
  const body = new URLSearchParams({
    username: process.env.AT_USERNAME || "sandbox",
    to,
    message,
    from: SMS_SENDER_ID,
  });
  const res = await fetch("https://api.africastalking.com/version1/messaging", {
    method: "POST",
    headers: {
      "apiKey": SMS_API_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: body.toString(),
  });
  return res.ok;
}

// ─── Templates SMS ────────────────────────────────────────────────────────────

export function smsFactureRelance(invoiceNumber: string, amount: number): string {
  return `Kanoo: Facture ${invoiceNumber} de ${amount.toLocaleString("fr-FR")} XOF en attente. Merci de régler.`;
}

export function smsActivationCode(token: string): string {
  return `Kanoo: Votre code d'activation est ${token.slice(0, 8)}. Connectez-vous sur app.kanoo.ne`;
}

export function smsCotisationRappel(year: number, amount: number): string {
  return `Kanoo Asso: Votre cotisation ${year} de ${amount.toLocaleString("fr-FR")} XOF est en attente. Merci.`;
}
