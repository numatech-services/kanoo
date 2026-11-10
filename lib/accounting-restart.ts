import { createHash } from "crypto";
import mongoose, { Types, type ClientSession } from "mongoose";
import JSZip from "jszip";
import { BusinessRuleError } from "@/lib/errors";
import { TenantModel } from "@/models/Tenant";
import { AccountingRestartModel } from "@/models/AccountingRestart";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { TreasuryMovementModel } from "@/models/TreasuryMovement";
import { TreasuryAccountModel } from "@/models/TreasuryAccount";
import { BankStatementLineModel } from "@/models/BankStatementLine";
import { CashSessionModel } from "@/models/CashSession";
import { CashClosingModel } from "@/models/CashClosing";
import { ActivityCashEntryModel } from "@/models/ActivityCashEntry";
import { MobileMoneyLineModel } from "@/models/MobileMoneyLine";
import { DeskFundingModel } from "@/models/DeskFunding";
import { AnalyticEntryModel } from "@/models/AnalyticEntry";
import type { TokenPayload } from "@/lib/auth";

/**
 * Reprise de la comptabilité : la comptable repart d'une date de reprise avec
 * ses soldes d'ouverture. Ce qui est effacé : écritures, mouvements et relevés
 * de trésorerie, caisses (sessions, arrêtés, entrées, relevés mobile money),
 * situations de départ des sites, analytique manuelle. Ce qui reste : factures,
 * achats, règlements, clients, fournisseurs, stock, paie, comptes de trésorerie
 * (remis à zéro) et plan comptable. Rien ne s'efface sans un export complet
 * remis moins de 24 heures avant.
 */
export const RESTART_SCOPE = [
  { key: "entries", label: "Écritures comptables", model: AccountingEntryModel },
  { key: "movements", label: "Mouvements de trésorerie", model: TreasuryMovementModel },
  { key: "statements", label: "Lignes de relevés bancaires", model: BankStatementLineModel },
  { key: "cashSessions", label: "Sessions de caisse", model: CashSessionModel },
  { key: "cashClosings", label: "Arrêtés de caisse", model: CashClosingModel },
  { key: "cashEntries", label: "Entrées et sorties de caisse", model: ActivityCashEntryModel },
  { key: "mobileMoney", label: "Relevés mobile money", model: MobileMoneyLineModel },
  { key: "siteFunding", label: "Situations de départ des sites", model: DeskFundingModel },
  { key: "analytic", label: "Écritures analytiques", model: AnalyticEntryModel },
] as const;

export const RESTART_CONFIRM = "REPRENDRE";
const EXPORT_VALIDITY_MS = 24 * 3600 * 1000;
export const RESTART_REFUSAL = "Pièce antérieure à la reprise de la comptabilité : son écriture n'existe plus. Corrigez par une écriture de régularisation datée après la reprise.";

/** Une pièce dont l'écriture a disparu avec la reprise ne s'annule pas en silence. */
export async function refuseIfRestarted(tenantId: string, session?: ClientSession, createdBefore?: Date) {
  const t = await TenantModel.findById(tenantId).select("accountingRestartAt").session(session ?? null).lean<{ accountingRestartAt?: Date } | null>();
  if (!t?.accountingRestartAt) return;
  if (createdBefore && createdBefore > t.accountingRestartAt) return;
  throw new BusinessRuleError(RESTART_REFUSAL);
}

/** Champs jamais exportés : mots de passe, empreintes, jetons, secrets. */
const SECRET = /pass(word)?|hash|secret|token|otp|apikey|privatekey/i;
function scrub(doc: unknown): unknown {
  if (Array.isArray(doc)) return doc.map(scrub);
  if (doc && typeof doc === "object" && !(doc instanceof Date) && !(doc instanceof Types.ObjectId) && !Buffer.isBuffer(doc)) {
    return Object.fromEntries(Object.entries(doc as Record<string, unknown>).filter(([k]) => !SECRET.test(k)).map(([k, v]) => [k, scrub(v)]));
  }
  return doc;
}

/**
 * Export complet d'une organisation : chaque collection qui porte ses données,
 * un fichier JSON par collection, plus un inventaire. Les secrets sont retirés.
 */
export async function exportTenantData(auth: TokenPayload) {
  const db = mongoose.connection.db;
  if (!db) throw new BusinessRuleError("Base indisponible.");
  const tid = new Types.ObjectId(auth.tenantId);
  const zip = new JSZip();
  const counts: Record<string, number> = {};
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(n => !n.startsWith("system.")).sort();
  for (const name of collections) {
    const filter = name === "tenants" ? { _id: tid } : { tenantId: tid };
    const docs = await db.collection(name).find(filter).toArray();
    if (!docs.length) continue;
    counts[name] = docs.length;
    zip.file(`${name}.json`, JSON.stringify(docs.map(scrub), null, 1));
  }
  const exportedAt = new Date();
  zip.file("LISEZMOI.txt", [
    "Export complet Kanoo",
    `Organisation : ${auth.tenantId}`,
    `Date : ${exportedAt.toISOString()}`,
    "Un fichier JSON par collection ; mots de passe, empreintes et jetons retirés.",
    "À conserver : les pièces et écritures comptables se gardent dix ans.",
    "",
    ...Object.entries(counts).map(([k, v]) => `${k} : ${v}`),
  ].join("\n"));
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const exportHash = createHash("sha256").update(buffer).digest("hex");
  const record = await AccountingRestartModel.create({ tenantId: tid, exportedAt, exportedBy: auth.userId, exportCounts: counts, exportHash });
  return { buffer, exportId: String(record._id), exportHash, counts };
}

/** Ce que la reprise effacerait, et ce qui l'empêche. */
export async function restartPreview(tenantId: string) {
  const tid = new Types.ObjectId(tenantId);
  const counts = await Promise.all(RESTART_SCOPE.map(async s => ({ key: s.key, label: s.label, count: await (s.model as mongoose.Model<unknown>).countDocuments({ tenantId: tid }) })));
  const [openSessions, lastExport, tenant, accounts] = await Promise.all([
    CashSessionModel.countDocuments({ tenantId: tid, status: "open" }),
    AccountingRestartModel.findOne({ tenantId: tid, restartedAt: { $exists: false } }).sort({ exportedAt: -1 }).select("exportedAt exportHash").lean<{ _id: unknown; exportedAt: Date; exportHash?: string } | null>(),
    TenantModel.findById(tid).select("accountingRestartAt accountingRestartDate").lean<{ accountingRestartAt?: Date; accountingRestartDate?: Date } | null>(),
    TreasuryAccountModel.countDocuments({ tenantId: tid }),
  ]);
  const validExport = lastExport && Date.now() - new Date(lastExport.exportedAt).getTime() < EXPORT_VALIDITY_MS ? lastExport : null;
  return {
    counts, treasuryAccounts: accounts, openSessions,
    export: validExport ? { exportId: String(validExport._id), exportedAt: validExport.exportedAt, exportHash: validExport.exportHash } : null,
    lastRestart: tenant?.accountingRestartAt ? { at: tenant.accountingRestartAt, date: tenant.accountingRestartDate } : null,
  };
}

/**
 * Effacement. Contrôles : export de moins de 24 heures, confirmation tapée,
 * aucune caisse ouverte, date de reprise passée ou du jour. La période qui
 * précède la date de reprise est ensuite verrouillée : rien ne s'y écrit plus.
 */
export async function restartAccounting(auth: TokenPayload, input: { exportId?: unknown; confirm?: unknown; restartDate?: unknown }) {
  if (input.confirm !== RESTART_CONFIRM) throw new BusinessRuleError(`Confirmation manquante : tapez ${RESTART_CONFIRM}.`);
  const tid = new Types.ObjectId(auth.tenantId);
  if (!Types.ObjectId.isValid(String(input.exportId))) throw new BusinessRuleError("Téléchargez d'abord l'export complet.");
  const record = await AccountingRestartModel.findOne({ _id: input.exportId, tenantId: tid, restartedAt: { $exists: false } });
  if (!record) throw new BusinessRuleError("Export introuvable ou déjà utilisé : téléchargez un nouvel export.");
  if (Date.now() - new Date(record.exportedAt).getTime() > EXPORT_VALIDITY_MS) throw new BusinessRuleError("Export de plus de 24 heures : téléchargez-en un nouveau.");
  if (typeof input.restartDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.restartDate)) throw new BusinessRuleError("Date de reprise invalide.");
  const restartDate = new Date(`${input.restartDate}T00:00:00.000Z`);
  if (isNaN(restartDate.getTime()) || restartDate.getTime() > Date.now()) throw new BusinessRuleError("La date de reprise ne peut pas être dans le futur : les opérations du jour seraient refusées.");
  if (await CashSessionModel.exists({ tenantId: tid, status: "open" })) throw new BusinessRuleError("Une caisse est ouverte : fermez toutes les caisses des sites avant la reprise.");

  // Marque d'abord la reprise : une annulation lancée pendant l'effacement est déjà refusée.
  const at = new Date();
  await TenantModel.updateOne({ _id: tid }, { $set: { accountingRestartAt: at, accountingRestartDate: restartDate, accountingLockedUntil: new Date(restartDate.getTime() - 1) } });
  const deleted: Record<string, number> = {};
  for (const s of RESTART_SCOPE) deleted[s.key] = (await (s.model as mongoose.Model<unknown>).deleteMany({ tenantId: tid })).deletedCount ?? 0;
  const reset = await TreasuryAccountModel.updateMany({ tenantId: tid }, { $set: { openingBalance: 0, openingDate: restartDate, balance: 0 } });
  deleted.treasuryAccountsReset = reset.modifiedCount;
  record.restartedAt = at; record.restartedBy = auth.userId; record.restartDate = restartDate; record.deleted = deleted;
  await record.save();
  return { restartDate, deleted, exportHash: record.exportHash };
}
