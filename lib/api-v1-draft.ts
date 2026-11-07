/**
 * Brouillon de facture reçu par l'API v1. Liste blanche stricte : un système tiers propose des quantités et des prix,
 * rien d'autre. La TVA, le numéro, l'émission et la certification restent à Kanoo et à son comptable.
 */
export interface DraftLine { description: string; quantity: number; unitPrice: number }

export interface DraftInput {
  externalRef: string;
  clientCode: string;
  issueDate: Date;
  dueDate: Date;
  object?: string;
  reference?: string;
  period?: string;
  lines: DraftLine[];
}

const MAX_LINES = 50;
const MAX_MONTANT = 1_000_000_000;

function texte(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? undefined : t.slice(0, max);
}

function date(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d;
}

/** Renvoie le brouillon, ou le motif du refus. */
export function parseDraft(body: unknown): { draft: DraftInput } | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "Corps JSON attendu." };
  const b = body as Record<string, unknown>;
  const externalRef = typeof b.externalRef === "string" && /^[A-Za-z0-9._:-]{3,120}$/.test(b.externalRef) ? b.externalRef : null;
  if (!externalRef) return { error: "externalRef invalide." };
  const clientCode = texte(b.clientCode, 60);
  if (!clientCode) return { error: "clientCode obligatoire." };
  const issueDate = date(b.issueDate), dueDate = date(b.dueDate);
  if (!issueDate || !dueDate) return { error: "issueDate et dueDate au format AAAA-MM-JJ." };
  if (dueDate < issueDate) return { error: "L'échéance précède la date de la facture." };
  if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > MAX_LINES) return { error: `De 1 à ${MAX_LINES} lignes.` };
  const lines: DraftLine[] = [];
  for (const l of b.lines) {
    const o = (typeof l === "object" && l !== null ? l : {}) as Record<string, unknown>;
    const description = texte(o.description, 300);
    const { quantity, unitPrice } = o;
    if (!description || typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_MONTANT
      || typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > MAX_MONTANT) {
      return { error: "Ligne invalide : description, quantité entière positive, prix unitaire positif ou nul." };
    }
    if (quantity * unitPrice > MAX_MONTANT) return { error: "Montant de ligne hors limites." };
    lines.push({ description, quantity, unitPrice });
  }
  return { draft: { externalRef, clientCode, issueDate, dueDate, object: texte(b.object, 600), reference: texte(b.reference, 120), period: texte(b.period, 120), lines } };
}
