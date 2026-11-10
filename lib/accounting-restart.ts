import { createHash } from "crypto";
import mongoose, { Types, type ClientSession } from "mongoose";
import { BSON } from "mongodb";
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
/** Un export trop ancien ne couvre plus ce qui a été saisi depuis. */
const EXPORT_VALIDITY_MS = 2 * 3600 * 1000;
/** Jour en cours à Niamey (UTC+1), à minuit : c'est la date de reprise. */
export function restartDay(now = new Date()) {
  const d = new Date(now.getTime() + 3600_000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
export const RESTART_REFUSAL = "Pièce antérieure à la reprise de la comptabilité : son écriture n'existe plus. Corrigez par une écriture de régularisation datée après la reprise.";

/** Une pièce dont l'écriture a disparu avec la reprise ne s'annule pas en silence. */
export async function refuseIfRestarted(tenantId: string, session?: ClientSession, createdBefore?: Date) {
  const t = await TenantModel.findById(tenantId).select("accountingRestartAt").session(session ?? null).lean<{ accountingRestartAt?: Date } | null>();
  if (!t?.accountingRestartAt) return;
  if (createdBefore && createdBefore > t.accountingRestartAt) return;
  throw new BusinessRuleError(RESTART_REFUSAL);
}

/** Champs jamais exportés : mots de passe, empreintes, jetons, secrets. */
const SECRET = /pass(word)?|hash|secret|token|otp|apikey|privatekey|accesscode|Enc$/i;
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
    // Organisation stockée en identifiant ou en texte selon les modèles.
    const filter = name === "tenants" ? { _id: tid } : { tenantId: { $in: [tid, String(tid)] } };
    // Lecture par curseur et EJSON canonique : types (identifiants, dates) préservés.
    const parts: string[] = [];
    for await (const doc of db.collection(name).find(filter)) parts.push(BSON.EJSON.stringify(scrub(doc) as BSON.Document, { relaxed: false }));
    if (!parts.length) continue;
    counts[name] = parts.length;
    zip.file(`${name}.json`, `[\n${parts.join(",\n")}\n]`);
  }
  const exportedAt = new Date();
  zip.file("LISEZMOI.txt", [
    "Export complet Kanoo",
    `Organisation : ${auth.tenantId}`,
    `Date : ${exportedAt.toISOString()}`,
    "Un fichier JSON par collection, au format EJSON canonique ; mots de passe, empreintes et jetons retirés.",
    "Les justificatifs (fichiers) ne sont pas dans l'archive : leur inventaire est dans attachments.json, ils restent sur le stockage.",
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
  // Saisies depuis l'export : il ne les contient pas, il faut le refaire.
  const changedSince = validExport ? await changedAfter(tid, new Date(validExport.exportedAt)) : 0;
  return {
    counts, treasuryAccounts: accounts, openSessions, changedSince, restartDate: restartDay(),
    export: validExport ? { exportId: String(validExport._id), exportedAt: validExport.exportedAt, exportHash: validExport.exportHash } : null,
    lastRestart: tenant?.accountingRestartAt ? { at: tenant.accountingRestartAt, date: tenant.accountingRestartDate } : null,
  };
}

/** Documents du périmètre créés ou modifiés après l'export. */
async function changedAfter(tid: Types.ObjectId, at: Date) {
  const n = await Promise.all([...RESTART_SCOPE.map(s => s.model as mongoose.Model<unknown>), TreasuryAccountModel as mongoose.Model<unknown>]
    .map(m => m.countDocuments({ tenantId: tid, $or: [{ createdAt: { $gt: at } }, { updatedAt: { $gt: at } }] })));
  return n.reduce((t, x) => t + x, 0);
}

/**
 * Effacement. Contrôles : export de moins de 24 heures, confirmation tapée,
 * aucune caisse ouverte, date de reprise passée ou du jour. La période qui
 * précède la date de reprise est ensuite verrouillée : rien ne s'y écrit plus.
 */
export async function restartAccounting(auth: TokenPayload, input: { exportId?: unknown; confirm?: unknown; exportHash?: unknown }) {
  if (input.confirm !== RESTART_CONFIRM) throw new BusinessRuleError(`Confirmation manquante : tapez ${RESTART_CONFIRM}.`);
  const tid = new Types.ObjectId(auth.tenantId);
  if (!Types.ObjectId.isValid(String(input.exportId))) throw new BusinessRuleError("Téléchargez d'abord l'export complet.");
  const record = await AccountingRestartModel.findOne({ _id: input.exportId, tenantId: tid, restartedAt: { $exists: false } });
  if (!record) throw new BusinessRuleError("Export introuvable ou déjà utilisé : téléchargez un nouvel export.");
  const exportedAt = new Date(record.exportedAt);
  if (Date.now() - exportedAt.getTime() > EXPORT_VALIDITY_MS) throw new BusinessRuleError("Export de plus de deux heures : téléchargez-en un nouveau.");
  // Le navigateur prouve qu'il a bien reçu l'archive : empreinte du fichier enregistré.
  if (!record.exportHash || input.exportHash !== record.exportHash) throw new BusinessRuleError("L'archive reçue ne correspond pas à l'export : téléchargez-la de nouveau.");
  if (await CashSessionModel.exists({ tenantId: tid, status: "open" })) throw new BusinessRuleError("Une caisse est ouverte : fermez toutes les caisses des sites avant la reprise.");
  if ((await changedAfter(tid, exportedAt)) > 0) throw new BusinessRuleError("Des opérations ont été saisies depuis l'export : téléchargez un nouvel export.");

  // Un seul effacement à la fois ; une opération interrompue depuis plus de dix minutes peut être reprise.
  const started = await AccountingRestartModel.findOneAndUpdate(
    { _id: record._id, restartedAt: { $exists: false }, $or: [{ startedAt: { $exists: false } }, { startedAt: { $lt: new Date(Date.now() - 600_000) } }] },
    { $set: { startedAt: new Date(), startedBy: auth.userId } }, { new: true },
  );
  if (!started) throw new BusinessRuleError("Une reprise est déjà en cours.");

  // Date de reprise : aujourd'hui. Avec une date passée, les règlements faits
  // depuis resteraient sans écriture alors que la trésorerie repart de zéro.
  const restartDate = restartDay();
  const at = new Date();
  const tenant = await TenantModel.findById(tid).select("accountingLockedUntil").lean<{ accountingLockedUntil?: Date } | null>();
  const lock = new Date(restartDate.getTime() - 1);
  const keepLock = tenant?.accountingLockedUntil && new Date(tenant.accountingLockedUntil) > lock;
  // Marque d'abord la reprise : une annulation lancée pendant l'effacement est déjà refusée.
  await TenantModel.updateOne({ _id: tid }, { $set: { accountingRestartAt: at, accountingRestartDate: restartDate, ...(keepLock ? {} : { accountingLockedUntil: lock }) } });
  // Seulement ce que l'export contient : rien de créé après lui.
  const exported = { tenantId: tid, $or: [{ createdAt: { $lte: exportedAt } }, { createdAt: { $exists: false } }] };
  const deleted: Record<string, number> = {};
  for (const s of RESTART_SCOPE) deleted[s.key] = (await (s.model as mongoose.Model<unknown>).deleteMany(exported)).deletedCount ?? 0;
  const reset = await TreasuryAccountModel.updateMany({ tenantId: tid }, { $set: { openingBalance: 0, openingDate: restartDate, balance: 0 } });
  deleted.treasuryAccountsReset = reset.modifiedCount;
  await AccountingRestartModel.updateOne({ _id: record._id }, { $set: { restartedAt: at, restartedBy: auth.userId, restartDate, deleted } });
  return { restartDate, deleted, exportHash: record.exportHash };
}
