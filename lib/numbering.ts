/**
 * Moteur de numérotation des documents — Kanoo
 * Gère les préfixes personnalisés par tenant avec réinitialisation annuelle
 */

import type { ClientSession } from "mongoose";
import { connectDB } from "./db";
import { TenantModel } from "@/models/Tenant";
import type { NumberingConfig as TenantNumberingConfig } from "@/types";

type DocType = "invoice" | "quote" | "order" | "delivery" | "contract";

interface NumberingConfig {
  invoicePrefix:   string;
  quotePrefix:     string;
  orderPrefix:     string;
  deliveryPrefix:  string;
  contractPrefix:  string;
  separator:       string;
  digitCount:      number;
  yearInNumber:    boolean;
  resetYearly:     boolean;
  invoiceSequence:  number;
  quoteSequence:    number;
  orderSequence:    number;
  deliverySequence: number;
  contractSequence: number;
  invoiceStartAt:   number;
}

const SEQUENCE_FIELD: Record<DocType, string> = {
  invoice:  "invoiceSequence",
  quote:    "quoteSequence",
  order:    "orderSequence",
  delivery: "deliverySequence",
  contract: "contractSequence",
};

const PREFIX_FIELD: Record<DocType, string> = {
  invoice:  "invoicePrefix",
  quote:    "quotePrefix",
  order:    "orderPrefix",
  delivery: "deliveryPrefix",
  contract: "contractPrefix",
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

  const seqField = `numberingConfig.${SEQUENCE_FIELD[docType]}`;
  const issued = options.issueDate ? new Date(options.issueDate) : new Date();
  const year = Number.isNaN(issued.getTime()) ? new Date().getFullYear() : issued.getFullYear();

  // Incrément atomique MongoDB, dans la transaction de l'appelant s'il y en a une.
  const query = TenantModel.findByIdAndUpdate(
    tenantId,
    { $inc: { [seqField]: 1 } },
    { new: true, upsert: false }
  ).select("numberingConfig");

  if (options.session) query.session(options.session);

  const tenant = await query.lean<{ numberingConfig?: TenantNumberingConfig } | null>();

  if (!tenant) throw new Error(`Tenant introuvable: ${tenantId}`);

  const cfg = (tenant.numberingConfig as NumberingConfig) || {};
  const prefix    = (cfg[PREFIX_FIELD[docType] as keyof NumberingConfig] as string) || defaultPrefix(docType);
  const sep       = cfg.separator ?? "-";
  const digits    = cfg.digitCount ?? 5;
  const useYear   = cfg.yearInNumber ?? true;
  const startAt   = docType === "invoice" ? (cfg.invoiceStartAt ?? 1) : 1;

  const seq = (cfg[SEQUENCE_FIELD[docType] as keyof NumberingConfig] as number) - 1 + startAt;
  const seqStr = String(seq).padStart(digits, "0");

  if (useYear) return `${prefix}${sep}${year}${sep}${seqStr}`;
  return `${prefix}${sep}${seqStr}`;
}

function defaultPrefix(docType: DocType): string {
  const defaults: Record<DocType, string> = {
    invoice: "FAC", quote: "DEV", order: "BC", delivery: "BL", contract: "CTR",
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
  const result = await TenantModel.updateMany(
    { "numberingConfig.resetYearly": true },
    {
      $set: {
        "numberingConfig.invoiceSequence":  0,
        "numberingConfig.quoteSequence":    0,
        "numberingConfig.orderSequence":    0,
        "numberingConfig.deliverySequence": 0,
        "numberingConfig.contractSequence": 0,
        "numberingConfig.sequenceYear":     new Date().getFullYear(),
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

  const cfg = (tenant.numberingConfig as NumberingConfig) || {};
  const prefix    = (cfg[PREFIX_FIELD[docType] as keyof NumberingConfig] as string) || defaultPrefix(docType);
  const sep       = cfg.separator ?? "-";
  const digits    = cfg.digitCount ?? 5;
  const useYear   = cfg.yearInNumber ?? true;
  const startAt   = docType === "invoice" ? (cfg.invoiceStartAt ?? 1) : 1;
  const issued    = issueDate ? new Date(issueDate) : new Date();
  const year      = Number.isNaN(issued.getTime()) ? new Date().getFullYear() : issued.getFullYear();

  const seq = (cfg[SEQUENCE_FIELD[docType] as keyof NumberingConfig] as number ?? 0) + startAt;
  const seqStr = String(seq).padStart(digits, "0");

  if (useYear) return `${prefix}${sep}${year}${sep}${seqStr}`;
  return `${prefix}${sep}${seqStr}`;
}

function defaultPreview(docType: DocType): string {
  const year = new Date().getFullYear();
  return `${defaultPrefix(docType)}-${year}-00001`;
}
