import crypto from "crypto";

/**
 * Billetterie — génération et vérification cryptographique des billets.
 * Le QR encode `KANOO1.<attendeeId>.<code>.<sig>` où sig = HMAC-SHA256 tronqué.
 * La signature permet une validation LOCALE (hors-ligne) côté scanner, sans
 * appel réseau, et empêche la contrefaçon d'un billet.
 */
function ticketSecret(): string {
  return (
    process.env.TICKET_SECRET ||
    process.env.JWT_SECRET ||
    "dev-only-ticket-secret-0000000000000000000000000000"
  );
}

/** Code alphanumérique de secours, lisible (sans caractères ambigus). */
export function generateTicketCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sans I, O, 0, 1, L
  const bytes = crypto.randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** Signature d'un billet (32 hex). */
export function signTicket(attendeeId: string, ticketCode: string): string {
  return crypto
    .createHmac("sha256", ticketSecret())
    .update(`${attendeeId}.${ticketCode}`)
    .digest("hex")
    .slice(0, 32);
}

/** Contenu à encoder dans le QR code. */
export function buildQrPayload(attendeeId: string, ticketCode: string): string {
  return `KANOO1.${attendeeId}.${ticketCode}.${signTicket(attendeeId, ticketCode)}`;
}

export interface ParsedQr {
  attendeeId: string;
  ticketCode: string;
  sig: string;
}

export function parseQrPayload(payload: string): ParsedQr | null {
  const parts = payload.trim().split(".");
  if (parts.length !== 4 || parts[0] !== "KANOO1") return null;
  return { attendeeId: parts[1], ticketCode: parts[2], sig: parts[3] };
}

/** Vérification à temps constant de la signature d'un billet. */
export function verifyTicket(attendeeId: string, ticketCode: string, sig: string): boolean {
  const expected = signTicket(attendeeId, ticketCode);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig || "");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
