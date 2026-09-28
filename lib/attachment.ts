/**
 * Pièce jointe stockée en data-URI (hébergement sans disque persistant).
 * 2,5 Mo de fichier ≈ 3,4 Mo une fois encodé en base64.
 */
export const MAX_DATA_URI_LENGTH = 3_500_000;

export type AttachmentCheck =
  | { ok: true; value: { name: string; dataUri: string } | null }
  | { ok: false; error: string };

/** Valide une pièce jointe reçue du client. `null` = retirer la pièce jointe. */
export function parseAttachment(raw: unknown): AttachmentCheck {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "object") return { ok: false, error: "Pièce jointe invalide." };
  const { name, dataUri } = raw as { name?: unknown; dataUri?: unknown };
  if (typeof dataUri !== "string" || !dataUri.startsWith("data:")) return { ok: false, error: "Pièce jointe invalide." };
  if (dataUri.length > MAX_DATA_URI_LENGTH) return { ok: false, error: "Pièce jointe trop lourde (2,5 Mo maximum)." };
  return { ok: true, value: { name: String(name || "piece-jointe").slice(0, 200), dataUri } };
}
