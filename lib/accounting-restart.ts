import mongoose, { Types, type ClientSession } from "mongoose";
import { BSON } from "mongodb";
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
  const t = await TenantModel.findById(tenantId).select("accountingRestartAt accountingRestartCutoff restartInProgressAt").session(session ?? null)
    .lean<{ accountingRestartAt?: Date; accountingRestartCutoff?: Date; restartInProgressAt?: Date } | null>();
  if (!t?.accountingRestartAt && !t?.restartInProgressAt) return;
  // Seules les pièces couvertes par l'export ont perdu leur écriture.
  const cutoff = t.accountingRestartCutoff ?? t.accountingRestartAt;
  if (createdBefore && cutoff && createdBefore > cutoff) return;
  throw new BusinessRuleError(RESTART_REFUSAL);
}

/** Champs jamais exportés : mots de passe, empreintes, jetons, secrets. */
const SECRET = /pass(word)?|hash|secret|token|otp|apikey|privatekey|accesscode|keyhint|Enc$/i;
function scrub(doc: unknown): unknown {
  if (Array.isArray(doc)) return doc.map(scrub);
  if (doc && typeof doc === "object" && !(doc instanceof Date) && !(doc instanceof Types.ObjectId) && !Buffer.isBuffer(doc)) {
    return Object.fromEntries(Object.entries(doc as Record<string, unknown>).filter(([k]) => !SECRET.test(k)).map(([k, v]) => [k, scrub(v)]));
  }
  return doc;
}

const CHUNK = 1000;
/** Lignes d'une collection couvertes par l'export : celles de l'organisation, existantes à la coupure. */
const exportFilter = (name: string, tid: Types.ObjectId, cutoff: Date) => name === "tenants"
  ? { _id: tid }
  // Organisation stockée en identifiant ou en texte selon les modèles.
  : { tenantId: { $in: [tid, String(tid)] }, $or: [{ createdAt: { $lte: cutoff } }, { createdAt: { $exists: false } }] };

/**
 * Export complet, en morceaux : l'export démarre (heure de coupure et
 * inventaire des collections), le navigateur lit chaque collection par paquets
 * de mille, assemble l'archive, puis déclare ce qu'il a reçu. Aucune requête
 * ne porte toute l'organisation : l'hébergement ne coupe plus l'export.
 */
export async function startExport(auth: TokenPayload) {
  const db = mongoose.connection.db;
  if (!db) throw new BusinessRuleError("Base indisponible.");
  const tid = new Types.ObjectId(auth.tenantId);
  // Heure de coupure prise AVANT toute lecture : ce qui est créé ensuite est hors de l'archive, et donc gardé.
  const exportedAt = new Date();
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name).filter(n => !n.startsWith("system.")).sort();
  const counts: Record<string, number> = {};
  for (const name of names) {
    const idx = name === "tenants" ? undefined : (await db.collection(name).indexes()).find(i => Object.keys(i.key)[0] === "tenantId");
    const n = await db.collection(name).countDocuments(exportFilter(name, tid, exportedAt), idx ? { hint: idx.key } : {});
    if (n) counts[name] = n;
  }
  const record = await AccountingRestartModel.create({ tenantId: tid, exportedAt, exportedBy: auth.userId, exportCounts: counts });
  return { exportId: String(record._id), exportedAt, collections: Object.entries(counts).map(([name, count]) => ({ name, count })) };
}

async function openExport(auth: TokenPayload, exportId: unknown) {
  if (!Types.ObjectId.isValid(String(exportId))) throw new BusinessRuleError("Export introuvable.");
  const record = await AccountingRestartModel.findOne({ _id: exportId, tenantId: auth.tenantId, restartedAt: { $exists: false } });
  if (!record) throw new BusinessRuleError("Export introuvable ou déjà utilisé : recommencez l'export.");
  if (Date.now() - new Date(record.exportedAt).getTime() > EXPORT_VALIDITY_MS) throw new BusinessRuleError("Export de plus de deux heures : recommencez-le.");
  return record;
}

/** Un paquet d'une collection, en EJSON canonique (types préservés), secrets retirés. */
export async function exportChunk(auth: TokenPayload, input: { exportId?: unknown; collection?: unknown; after?: unknown }) {
  const record = await openExport(auth, input.exportId);
  const name = String(input.collection ?? "");
  if (!record.exportCounts || !(name in record.exportCounts)) throw new BusinessRuleError("Collection hors de l'export.");
  const db = mongoose.connection.db!;
  const tid = new Types.ObjectId(auth.tenantId);
  const filter: Record<string, unknown> = exportFilter(name, tid, new Date(record.exportedAt));
  if (input.after) filter._id = { $gt: BSON.EJSON.parse(String(input.after)) };
  // Index de l'organisation imposé : sans lui, le tri par identifiant parcourait
  // toute la collection (toutes organisations confondues), d'où un export très lent.
  const coll = db.collection(name);
  const indexed = name !== "tenants" && (await coll.indexes()).some(i => Object.keys(i.key)[0] === "tenantId");
  const query = coll.find(filter).sort({ _id: 1 }).limit(CHUNK);
  if (indexed) query.hint((await coll.indexes()).find(i => Object.keys(i.key)[0] === "tenantId")!.key);
  const docs = await query.toArray();
  return {
    docs: docs.map(d => BSON.EJSON.stringify(scrub(d) as BSON.Document, { relaxed: false })),
    after: docs.length === CHUNK ? BSON.EJSON.stringify({ v: docs[docs.length - 1]._id }, { relaxed: false }).replace(/^\{"v":(.*)\}$/, "$1") : null,
  };
}

/** Fin de l'export : le navigateur déclare ce qu'il a reçu et l'empreinte de l'archive qu'il a enregistrée. */
export async function completeExport(auth: TokenPayload, input: { exportId?: unknown; counts?: unknown; hash?: unknown }) {
  const record = await openExport(auth, input.exportId);
  const got = (input.counts && typeof input.counts === "object" ? input.counts : {}) as Record<string, unknown>;
  const expected = (record.exportCounts ?? {}) as Record<string, number>;
  const missing = Object.entries(expected).filter(([k, v]) => Number(got[k]) !== v).map(([k]) => k);
  if (missing.length) throw new BusinessRuleError(`Archive incomplète (${missing.slice(0, 5).join(", ")}) : recommencez l'export.`);
  if (typeof input.hash !== "string" || !/^[0-9a-f]{64}$/.test(input.hash)) throw new BusinessRuleError("Empreinte de l'archive invalide.");
  record.exportHash = input.hash; record.completedAt = new Date();
  await record.save();
  return { exportId: String(record._id), collections: Object.keys(expected).length, documents: Object.values(expected).reduce((t, v) => t + v, 0) };
}

/** Ce que la reprise effacerait, et ce qui l'empêche. */
export async function restartPreview(tenantId: string) {
  const tid = new Types.ObjectId(tenantId);
  const counts = await Promise.all(RESTART_SCOPE.map(async s => ({ key: s.key, label: s.label, count: await (s.model as mongoose.Model<unknown>).countDocuments({ tenantId: tid }) })));
  const [openSessions, lastExport, tenant, accounts] = await Promise.all([
    CashSessionModel.countDocuments({ tenantId: tid, status: "open" }),
    AccountingRestartModel.findOne({ tenantId: tid, restartedAt: { $exists: false }, completedAt: { $exists: true } }).sort({ exportedAt: -1 }).select("exportedAt exportHash").lean<{ _id: unknown; exportedAt: Date; exportHash?: string } | null>(),
    TenantModel.findById(tid).select("accountingRestartAt accountingRestartDate restartInProgressAt").lean<{ accountingRestartAt?: Date; accountingRestartDate?: Date; restartInProgressAt?: Date } | null>(),
    TreasuryAccountModel.countDocuments({ tenantId: tid }),
  ]);
  const validExport = lastExport && Date.now() - new Date(lastExport.exportedAt).getTime() < EXPORT_VALIDITY_MS ? lastExport : null;
  // Saisies depuis l'export : il ne les contient pas, il faut le refaire.
  const changedSince = validExport ? await changedAfter(tid, new Date(validExport.exportedAt)) : 0;
  return {
    counts, treasuryAccounts: accounts, openSessions, changedSince, restartDate: restartDay(),
    // L'empreinte n'est jamais renvoyée : seul le fichier reçu permet de la calculer.
    export: validExport ? { exportId: String(validExport._id), exportedAt: validExport.exportedAt } : null,
    interrupted: !!tenant?.restartInProgressAt,
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
  if (!record.completedAt) throw new BusinessRuleError("Export inachevé : recommencez-le.");
  if (!record.exportHash || input.exportHash !== record.exportHash) throw new BusinessRuleError("L'archive reçue ne correspond pas à l'export : téléchargez-la de nouveau.");
  if (await CashSessionModel.exists({ tenantId: tid, status: "open" })) throw new BusinessRuleError("Une caisse est ouverte : fermez toutes les caisses des sites avant la reprise.");
  if ((await changedAfter(tid, exportedAt)) > 0) throw new BusinessRuleError("Des opérations ont été saisies depuis l'export : téléchargez un nouvel export.");

  // L'export ne sert qu'une fois : il est réservé avant tout effacement.
  const claimed = await AccountingRestartModel.findOneAndUpdate(
    { _id: record._id, restartedAt: { $exists: false }, $or: [{ startedAt: { $exists: false } }, { startedAt: { $lt: new Date(Date.now() - 600_000) } }] },
    { $set: { startedAt: new Date(), startedBy: auth.userId } }, { new: true },
  );
  if (!claimed) throw new BusinessRuleError("Cet export est déjà utilisé par une reprise.");
  // Une seule reprise à la fois pour l'organisation ; une reprise interrompue depuis dix minutes se relance.
  const restartDate = restartDay();
  const at = new Date();
  const lock = new Date(restartDate.getTime() - 1);
  const tenant = await TenantModel.findOneAndUpdate(
    { _id: tid, $or: [{ restartInProgressAt: { $exists: false } }, { restartInProgressAt: { $lt: new Date(Date.now() - 600_000) } }] },
    { $set: { restartInProgressAt: at, accountingRestartCutoff: exportedAt } }, { new: false },
  ).select("accountingLockedUntil").lean<{ accountingLockedUntil?: Date } | null>();
  if (!tenant) throw new BusinessRuleError("Une reprise est déjà en cours.");
  // Verrou de période posé d'abord : plus rien ne s'écrit avant la date de reprise. Le verrou le plus tardif est gardé.
  if (!(tenant.accountingLockedUntil && new Date(tenant.accountingLockedUntil) > lock)) await TenantModel.updateOne({ _id: tid }, { $set: { accountingLockedUntil: lock } });
  // Seulement ce que l'archive contient : ni créé ni modifié après la coupure.
  const exported = { tenantId: tid, $and: [
    { $or: [{ createdAt: { $lte: exportedAt } }, { createdAt: { $exists: false } }] },
    { $or: [{ updatedAt: { $lte: exportedAt } }, { updatedAt: { $exists: false } }] },
  ] };
  const deleted: Record<string, number> = {};
  let kept = 0;
  for (const s of RESTART_SCOPE) {
    const m = s.model as mongoose.Model<unknown>;
    deleted[s.key] = (await m.deleteMany(exported)).deletedCount ?? 0;
    kept += await m.countDocuments({ tenantId: tid });
  }
  // Date de reprise : aujourd'hui. Avec une date passée, les règlements faits
  // depuis resteraient sans écriture alors que la trésorerie repart de zéro.
  const reset = await TreasuryAccountModel.updateMany({ tenantId: tid }, { $set: { openingBalance: 0, openingDate: restartDate, balance: 0 } });
  deleted.treasuryAccountsReset = reset.modifiedCount;
  // Fin : la reprise est acquise, le verrou d'opération levé.
  await TenantModel.updateOne({ _id: tid }, { $set: { accountingRestartAt: at, accountingRestartDate: restartDate }, $unset: { restartInProgressAt: 1 } });
  await AccountingRestartModel.updateOne({ _id: record._id }, { $set: { restartedAt: new Date(), restartedBy: auth.userId, restartDate, deleted, kept } });
  return { restartDate, deleted, kept, exportHash: record.exportHash };
}
