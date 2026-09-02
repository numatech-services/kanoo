import crypto from "crypto";

/**
 * Chiffrement de champ au repos — AES-256-GCM (confidentialité + intégrité).
 * Format stocké : "v1:<iv b64>:<tag b64>:<ciphertext b64>".
 *
 * Clé : FIELD_ENCRYPTION_KEY (hex 64 car. ou base64 de 32 octets) si présente ;
 * sinon dérivée de JWT_SECRET par scrypt (toujours disponible en pratique).
 * `decryptField` tolère une valeur en clair (données antérieures au chiffrement),
 * ce qui permet un déploiement progressif sans migration bloquante.
 */

const PREFIX = "v1";

function getKey(): Buffer {
  const explicit = process.env.FIELD_ENCRYPTION_KEY;
  if (explicit) {
    const buf = /^[0-9a-fA-F]{64}$/.test(explicit)
      ? Buffer.from(explicit, "hex")
      : Buffer.from(explicit, "base64");
    if (buf.length === 32) return buf;
  }
  const base = process.env.JWT_SECRET || "dev-only-insecure-secret-0000000000000000000000000000";
  return crypto.scryptSync(base, "kanoo-field-enc-v1", 32);
}

export function isEncrypted(v?: string | null): boolean {
  return !!v && v.startsWith(PREFIX + ":");
}

export function encryptField(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptField(stored: string): string {
  if (!isEncrypted(stored)) return stored; // valeur en clair tolérée (avant chiffrement)
  const parts = stored.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(parts[1], "base64"));
  decipher.setAuthTag(Buffer.from(parts[2], "base64"));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]).toString("utf8");
}
