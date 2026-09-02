/**
 * Moteur de numérotation des documents — Kanoo
 * Gère les préfixes personnalisés par tenant avec réinitialisation annuelle
 */

import { connectDB } from "./db";
import { TenantModel } from "@/models/Tenant";

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
 * Génère le prochain numéro de document pour un tenant donné (atomic increment)
 * @param tenantId   ID du tenant
 * @param docType    Type de document
 * @returns          Numéro formaté, ex: "NML-2025-00042"
 */
export async function nextDocumentNumber(tenantId: string, docType: DocType): Promise<string> {
  await connectDB();

  const seqField = `numberingConfig.${SEQUENCE_FIELD[docType]}`;
  const year = new Date().getFullYear();

  // Incrément atomique MongoDB
  const tenant = await TenantModel.findByIdAndUpdate(
    tenantId,
    { $inc: { [seqField]: 1 } },
    { new: true, upsert: false }
  ).select("numberingConfig").lean();

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
 * Réinitialise les séquences au 1er janvier (si resetYearly=true)
 * Appelé par le scheduler le 1er janvier à 00:01
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
      },
    }
  );
  return result.modifiedCount;
}

/**
 * Prévisualise le prochain numéro sans l'incrémenter (pour affichage)
 */
export async function previewNextNumber(tenantId: string, docType: DocType): Promise<string> {
  await connectDB();
  const tenant = await TenantModel.findById(tenantId).select("numberingConfig").lean();
  if (!tenant) return defaultPreview(docType);

  const cfg = (tenant.numberingConfig as NumberingConfig) || {};
  const prefix    = (cfg[PREFIX_FIELD[docType] as keyof NumberingConfig] as string) || defaultPrefix(docType);
  const sep       = cfg.separator ?? "-";
  const digits    = cfg.digitCount ?? 5;
  const useYear   = cfg.yearInNumber ?? true;
  const startAt   = docType === "invoice" ? (cfg.invoiceStartAt ?? 1) : 1;
  const year      = new Date().getFullYear();

  const seq = (cfg[SEQUENCE_FIELD[docType] as keyof NumberingConfig] as number ?? 0) + startAt;
  const seqStr = String(seq).padStart(digits, "0");

  if (useYear) return `${prefix}${sep}${year}${sep}${seqStr}`;
  return `${prefix}${sep}${seqStr}`;
}

function defaultPreview(docType: DocType): string {
  const year = new Date().getFullYear();
  return `${defaultPrefix(docType)}-${year}-00001`;
}
