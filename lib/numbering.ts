/**
 * Moteur de numérotation des documents — Kanoo
 * Gère les préfixes personnalisés par tenant avec réinitialisation annuelle
 */

import crypto from "crypto";
import type { ClientSession, Model } from "mongoose";
import { connectDB } from "./db";
import { TenantModel } from "@/models/Tenant";
import type { NumberingConfig as TenantNumberingConfig } from "@/types";

type DocType = "invoice" | "quote" | "order" | "delivery" | "contract" | "credit_note" | "purchase" | "sale";

interface NumberingConfig {
  invoicePrefix:   string;
  quotePrefix:     string;
  orderPrefix:     string;
  deliveryPrefix:  string;
  contractPrefix:  string;
  creditNotePrefix: string;
  purchasePrefix: string;
  salePrefix: string;
  separator:       string;
  digitCount:      number;
  yearInNumber:    boolean;
  resetYearly:     boolean;
  invoiceSequence:  number;
  quoteSequence:    number;
  orderSequence:    number;
  deliverySequence: number;
  contractSequence: number;
  creditNoteSequence: number;
  purchaseSequence: number;
  saleSequence: number;
  invoiceStartAt:   number;
}

const SEQUENCE_FIELD: Record<DocType, string> = {
  invoice:  "invoiceSequence",
  quote:    "quoteSequence",
  order:    "orderSequence",
  delivery: "deliverySequence",
  contract: "contractSequence",
  // Série distincte : mêler avoirs et factures dans la même suite rendrait
  // illisible une séquence que la DGI attend continue.
  credit_note: "creditNoteSequence",
  // Achats (factures fournisseurs, dépenses) : numérotation interne de saisie.
  purchase: "purchaseSequence",
  // Tickets de caisse des comptoirs : série propre, continue.
  sale: "saleSequence",
};

const PREFIX_FIELD: Record<DocType, string> = {
  invoice:  "invoicePrefix",
  quote:    "quotePrefix",
  order:    "orderPrefix",
  delivery: "deliveryPrefix",
  contract: "contractPrefix",
  credit_note: "creditNotePrefix",
  purchase: "purchasePrefix",
  sale: "salePrefix",
};

/**
 * Génère le prochain numéro de document pour un tenant donné.
 *
 * Deux points importants pour la conformité DGI :
 *
 *  1. **La séquence doit être consommée dans la même transaction que le
 *     document.** Sinon un échec après l'incrément laisse un trou, et une
 *     séquence de facturation à trous est un motif de redressement. D'où le
 *     paramètre `session`, que l'appelant doit transmettre.
 *  2. **L'année vient de la date d'émission, pas de l'horloge.** Une facture de
 *     décembre saisie en janvier portait le millésime suivant — et, combinée à
 *     la remise à zéro annuelle, se retrouvait en collision avec la nouvelle
 *     série.
 *
 * @param tenantId   ID du tenant
 * @param docType    Type de document
 * @param options    `issueDate` (défaut : maintenant) et `session` de transaction
 */
export async function nextDocumentNumber(
  tenantId: string,
  docType: DocType,
  options: { issueDate?: Date | string; session?: ClientSession } = {}
): Promise<string> {
  await connectDB();

  const field = SEQUENCE_FIELD[docType];
  const issued = options.issueDate ? new Date(options.issueDate) : new Date();
  const year = Number.isNaN(issued.getTime()) ? new Date().getFullYear() : issued.getFullYear();
  const session = options.session;

  const current = await TenantModel.findById(tenantId).select("numberingConfig").session(session ?? null)
    .lean<{ numberingConfig?: TenantNumberingConfig } | null>();
  if (!current) throw new Error(`Tenant introuvable: ${tenantId}`);
  const cfg = (current.numberingConfig as unknown as NumberingConfig) || ({} as NumberingConfig);
  const fmt = formatOf(cfg, docType);

  let counter: number;
  if (fmt.perYear) {
    // Une série par année : le compteur de l'année de la PIÈCE, jamais celui
    // de l'horloge. Créé à la première pièce de l'année, à partir du plus
    // grand numéro déjà émis pour cette année (reprise sans collision).
    const path = `numberingConfig.yearCounters.${field}_${year}`;
    let t = await TenantModel.findOneAndUpdate(
      { _id: tenantId, [path]: { $exists: true } }, { $inc: { [path]: 1 } },
      { new: true, session },
    ).select("numberingConfig.yearCounters").lean<{ numberingConfig?: { yearCounters?: Record<string, number> } } | null>();
    if (!t) {
      const seed = await highestIssued(tenantId, docType, fmt, year, session);
      t = await TenantModel.findOneAndUpdate(
        { _id: tenantId, [path]: { $exists: false } }, { $set: { [path]: seed + 1 } },
        { new: true, session },
      ).select("numberingConfig.yearCounters").lean<{ numberingConfig?: { yearCounters?: Record<string, number> } } | null>();
      // Créé entre-temps par une requête concurrente : on incrémente le sien.
      if (!t) t = await TenantModel.findOneAndUpdate({ _id: tenantId }, { $inc: { [path]: 1 } }, { new: true, session })
        .select("numberingConfig.yearCounters").lean<{ numberingConfig?: { yearCounters?: Record<string, number> } } | null>();
    }
    counter = Number((t?.numberingConfig?.yearCounters as Record<string, number> | undefined)?.[`${field}_${year}`] ?? 1);
  } else {
    // Série continue sans remise à zéro (ou sans année dans le numéro).
    const t = await TenantModel.findByIdAndUpdate(tenantId, { $inc: { [`numberingConfig.${field}`]: 1 } }, { new: true, session })
      .select("numberingConfig").lean<{ numberingConfig?: TenantNumberingConfig } | null>();
    counter = Number((t?.numberingConfig as unknown as NumberingConfig | undefined)?.[field as keyof NumberingConfig] ?? 1);
  }
  return render(fmt, year, counter);
}

interface NumberFormat { prefix: string; sep: string; digits: number; useYear: boolean; startAt: number; perYear: boolean }

function formatOf(cfg: NumberingConfig, docType: DocType): NumberFormat {
  const useYear = cfg.yearInNumber ?? true;
  return {
    prefix: (cfg[PREFIX_FIELD[docType] as keyof NumberingConfig] as string) || defaultPrefix(docType),
    sep: cfg.separator ?? "-",
    digits: cfg.digitCount ?? 5,
    useYear,
    startAt: docType === "invoice" ? (cfg.invoiceStartAt ?? 1) : 1,
    perYear: useYear && (cfg.resetYearly ?? true),
  };
}

/** Le compteur c (1 pour la première pièce) donne le numéro c − 1 + startAt. */
function render(f: NumberFormat, year: number, counter: number): string {
  const seqStr = String(counter - 1 + f.startAt).padStart(f.digits, "0");
  return f.useYear ? `${f.prefix}${f.sep}${year}${f.sep}${seqStr}` : `${f.prefix}${f.sep}${seqStr}`;
}

/** Collections et champs qui portent les numéros d'une série. */
async function numberedCollections(docType: DocType): Promise<Array<{ model: Model<unknown>; field: string }>> {
  const m = (x: unknown) => x as Model<unknown>;
  switch (docType) {
    case "invoice": case "credit_note": return [{ model: m((await import("@/models/Invoice")).InvoiceModel), field: "number" }];
    case "quote": return [{ model: m((await import("@/models/Devis")).DevisModel), field: "number" }];
    case "order": return [
      { model: m((await import("@/models/Commande")).CommandeModel), field: "number" },
      { model: m((await import("@/models/FrameworkOrder")).FrameworkOrderModel), field: "reference" },
    ];
    case "delivery": return [
      { model: m((await import("@/models/DeliveryNote")).DeliveryNoteModel), field: "number" },
      { model: m((await import("@/models/DeliveryLot")).DeliveryLotModel), field: "reference" },
    ];
    case "contract": return [{ model: m((await import("@/models/Contract")).ContractModel), field: "reference" }];
    case "purchase": return [{ model: m((await import("@/models/Purchase")).PurchaseModel), field: "number" }];
    case "sale": return [{ model: m((await import("@/models/ComptoirSale")).ComptoirSaleModel), field: "number" }];
  }
}

const escapeRx = (x: string) => x.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Plus haut compteur déjà utilisé pour une année (0 si aucun) : reprise des
 * séries émises avant les compteurs annuels, et garantie qu'un numéro déjà
 * attribué ne ressort jamais.
 */
async function highestIssued(tenantId: string, docType: DocType, f: NumberFormat, year: number, session?: ClientSession): Promise<number> {
  const rx = new RegExp(`^${escapeRx(f.prefix)}${escapeRx(f.sep)}${year}${escapeRx(f.sep)}(\\d+)$`);
  let max = 0;
  for (const { model, field } of await numberedCollections(docType)) {
    const docs = await model.find({ tenantId, [field]: rx }).select(field).session(session ?? null).lean<Array<Record<string, string>>>();
    for (const d of docs) {
      const n = Number(rx.exec(String(d[field]))?.[1] ?? 0);
      if (n > max) max = n;
    }
  }
  // Numéro affiché N ↔ compteur N − startAt + 1.
  return max > 0 ? max - f.startAt + 1 : 0;
}

/**
 * Numéro provisoire d'un brouillon de facture. Le numéro définitif n'est
 * attribué qu'à l'ÉMISSION (lib/invoice-posting) : pris dès le brouillon,
 * chaque brouillon supprimé laissait un trou dans une série que la DGI veut
 * continue.
 */
export const PROVISIONAL_PREFIX = "BROUILLON-";
export function provisionalNumber(): string {
  return `${PROVISIONAL_PREFIX}${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}
export function isProvisionalNumber(n?: string | null): boolean {
  return !!n && n.startsWith(PROVISIONAL_PREFIX);
}

function defaultPrefix(docType: DocType): string {
  const defaults: Record<DocType, string> = {
    invoice: "FAC", quote: "DEV", order: "BC", delivery: "BL", contract: "CTR",
    credit_note: "AV", purchase: "ACH", sale: "TK",
  };
  return defaults[docType];
}

/**
 * Réinitialise les séquences au 1er janvier (si resetYearly=true).
 * Appelé par le scheduler le 1er janvier à 00:01.
 *
 * `sequenceYear` est écrit en même temps : sans l'année dans le numéro
 * (`yearInNumber: false`), remettre le compteur à zéro produirait des doublons
 * d'une année sur l'autre. Ce champ permet au moins de les diagnostiquer.
 */
export async function resetYearlySequences(): Promise<number> {
  await connectDB();
  const year = new Date().getFullYear();
  // Idempotent : seulement les organisations pas encore remises à zéro cette
  // année. Rejouée (nouvelle tentative de l'hébergeur, deux planificateurs),
  // la tâche remettait les compteurs à zéro en cours d'année. Les séries avec
  // l'année dans le numéro ont leur compteur annuel et n'en dépendent plus.
  const result = await TenantModel.updateMany(
    { "numberingConfig.resetYearly": true, $or: [{ "numberingConfig.sequenceYear": { $exists: false } }, { "numberingConfig.sequenceYear": { $lt: year } }] },
    {
      $set: {
        "numberingConfig.invoiceSequence":  0,
        "numberingConfig.quoteSequence":    0,
        "numberingConfig.orderSequence":    0,
        "numberingConfig.deliverySequence": 0,
        "numberingConfig.contractSequence": 0,
        "numberingConfig.creditNoteSequence": 0,
        "numberingConfig.purchaseSequence": 0,
        "numberingConfig.saleSequence": 0,
        "numberingConfig.sequenceYear":     year,
      },
    }
  );
  return result.modifiedCount;
}

/**
 * Prévisualise le prochain numéro sans l'incrémenter (pour affichage)
 */
export async function previewNextNumber(
  tenantId: string,
  docType: DocType,
  issueDate?: Date | string
): Promise<string> {
  await connectDB();
  const tenant = await TenantModel.findById(tenantId).select("numberingConfig")
    .lean<{ numberingConfig?: TenantNumberingConfig } | null>();
  if (!tenant) return defaultPreview(docType);

  const cfg = (tenant.numberingConfig as unknown as NumberingConfig) || ({} as NumberingConfig);
  const f = formatOf(cfg, docType);
  const issued = issueDate ? new Date(issueDate) : new Date();
  const year = Number.isNaN(issued.getTime()) ? new Date().getFullYear() : issued.getFullYear();
  const field = SEQUENCE_FIELD[docType];
  let used: number;
  if (f.perYear) {
    const counters = (tenant.numberingConfig as { yearCounters?: Record<string, number> } | undefined)?.yearCounters ?? {};
    const k = `${field}_${year}`;
    used = k in counters ? Number(counters[k]) : await highestIssued(tenantId, docType, f, year);
  } else {
    used = Number(cfg[field as keyof NumberingConfig] ?? 0);
  }
  return render(f, year, used + 1);
}

function defaultPreview(docType: DocType): string {
  const year = new Date().getFullYear();
  return `${defaultPrefix(docType)}-${year}-00001`;
}
