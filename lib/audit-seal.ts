import { createHash, createHmac, timingSafeEqual } from "crypto";
import { Types } from "mongoose";
import { AuditSealModel, AuditCheckModel } from "@/models/AuditSeal";
import { AccountingEntryModel } from "@/models/AccountingEntry";
import { AuditLogModel } from "@/models/AuditLog";

/**
 * Scellement des écritures et du journal d'audit.
 *
 * Chaque passage scelle les pièces créées depuis le sceau précédent (au moins
 * 15 minutes avant, pour laisser les transactions se terminer). Les plages
 * d'identifiants se suivent sans trou ; chaque sceau porte l'empreinte de
 * chaque pièce, est chaîné au précédent et signé par une clé du serveur
 * (AUDIT_SEAL_KEY) dont l'identifiant (`kid`) est gardé dans le sceau.
 *
 * Ce que la base seule ne permet pas : réécrire ou fabriquer un sceau.
 * Ce qu'elle permet et que la vérification signale : supprimer, modifier ou
 * glisser une pièce dans une plage scellée ; retirer un sceau du milieu ;
 * refaire des sceaux sur des pièces anciennes (plus de 26 h) ; changer la
 * tête déjà constatée par un contrôle précédent ou publiée par un rapport.
 * Ce qu'elle permet SANS signal certain : supprimer les derniers sceaux et
 * refaire la fin de chaîne sur des pièces récentes ou réinsérées sous de
 * nouveaux identifiants. Seule la comparaison avec l'empreinte reçue par
 * courriel (rapport mensuel, envoyé aussi à l'expert-comptable) le prouve.
 *
 * Empreinte d'une écriture :
 * - noyau intangible : journal, date, comptes et libellés de comptes, montants,
 *   tiers, document d'origine, extourne, auteur ;
 * - partie modifiable par l'application tant que la période est ouverte :
 *   libellé et référence (modification tracée au journal d'audit).
 * Le lettrage, l'imputation analytique et le lien d'extourne posé après coup
 * n'y entrent pas.
 */

export type SealKind = "entries" | "audit";
const BATCH = 2000;
const MAX_SEALS_PER_RUN = 25;
export const SETTLE_MS = 15 * 60 * 1000;
/** Au-delà, des pièces scellées longtemps après leur création signalent un scellement interrompu ou une chaîne refaite. */
export const LATE_MS = 26 * 3600 * 1000;
const CACHE_MS = 6 * 3600 * 1000;
export const GENESIS = "0".repeat(64);
const ZERO_ID = new Types.ObjectId("000000000000000000000000");

// ─── Clés ────────────────────────────────────────────────────────────────

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const kidOf = (key: string) => sha(`kanoo-seal:${key}`).slice(0, 12);

/** Clé courante. En production, AUDIT_SEAL_KEY (32 caractères au moins) est obligatoire. */
export function currentSealKey(): { kid: string; key: string } {
  const key = process.env.AUDIT_SEAL_KEY;
  if (key) {
    if (key.length < 32) throw new Error("AUDIT_SEAL_KEY trop courte (32 caractères au moins).");
    if (key === process.env.JWT_SECRET) throw new Error("AUDIT_SEAL_KEY doit différer de JWT_SECRET.");
    return { kid: kidOf(key), key };
  }
  if (process.env.NODE_ENV === "production") throw new Error("AUDIT_SEAL_KEY absente : scellement impossible (à définir sur l'hébergeur).");
  const dev = process.env.JWT_SECRET;
  if (!dev) throw new Error("Clé de scellement absente : définissez AUDIT_SEAL_KEY.");
  return { kid: kidOf(dev), key: dev };
}
/** Trousseau : clé courante et anciennes clés (AUDIT_SEAL_KEYS_OLD, séparées par des virgules) pour vérifier les sceaux passés. */
function keyring(): Map<string, string> {
  const ring = new Map<string, string>();
  try { const c = currentSealKey(); ring.set(c.kid, c.key); } catch { /* vérification seule : les anciennes clés suffisent */ }
  for (const k of (process.env.AUDIT_SEAL_KEYS_OLD ?? "").split(",").map(s => s.trim()).filter(Boolean)) ring.set(kidOf(k), k);
  return ring;
}

// ─── Empreintes ──────────────────────────────────────────────────────────

const r2 = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100;
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

/** JSON stable : clés triées, identifiants et dates en texte. */
function stable(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Types.ObjectId) return String(v);
  if (Array.isArray(v)) return v.map(stable);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof (o as { toHexString?: unknown }).toHexString === "function") return String(v);
    return Object.fromEntries(Object.keys(o).sort().map(k => [k, stable(o[k])]));
  }
  return v;
}

type Doc = Record<string, unknown> & { _id: Types.ObjectId };
type Item = { id: Types.ObjectId; h: string; m?: string };

export function entryCore(e: Doc): string {
  const lines = (e.lines as Array<Record<string, unknown>> | undefined) ?? [];
  return JSON.stringify([str(e._id), str(e.tenantId), e.journalCode ?? null, iso(e.entryDate),
    lines.map(l => [l.accountCode ?? null, l.accountLabel ?? null, r2(l.debit), r2(l.credit), str(l.thirdPartyId)]),
    e.linkedDocType ?? null, str(e.linkedDocId), str(e.reverses), str(e.createdBy)]);
}
export const entryMutable = (e: Doc) => JSON.stringify([e.label ?? null, e.reference ?? null]);
export function auditCore(a: Doc): string {
  return JSON.stringify([str(a._id), str(a.tenantId), str(a.userId), a.userEmail ?? null, a.userRole ?? null, a.action ?? null, a.resource ?? null, str(a.resourceId),
    stable(a.before), stable(a.after), stable(a.metadata), a.ip ?? null, a.userAgent ?? null, iso(a.createdAt)]);
}
const ENTRY_FIELDS = "_id tenantId journalCode entryDate reference label lines.accountCode lines.accountLabel lines.debit lines.credit lines.thirdPartyId linkedDocType linkedDocId reverses createdBy";
const AUDIT_FIELDS = "_id tenantId userId userEmail userRole action resource resourceId before after metadata ip userAgent createdAt";

function source(kind: SealKind) {
  return kind === "entries"
    ? { model: AccountingEntryModel, fields: ENTRY_FIELDS, item: (d: Doc): Item => ({ id: d._id, h: sha(entryCore(d)).slice(0, 32), m: sha(entryMutable(d)).slice(0, 16) }) }
    : { model: AuditLogModel, fields: AUDIT_FIELDS, item: (d: Doc): Item => ({ id: d._id, h: sha(auditCore(d)).slice(0, 32) }) };
}
const contentOf = (items: Item[]) => sha(items.map(i => `${String(i.id)}:${i.h}:${i.m ?? ""}`).join("\n"));
type Archive = { fromSeq: number; toSeq: number; restartId?: unknown; exportHash?: string };
type SealBody = { tenantId: unknown; kind: string; seq: number; fromId: unknown; toId: unknown; count: number; contentHash: string; prevHash: string; sealedAt: Date; archive?: Archive | null };
function payload(s: SealBody) {
  const a = s.archive ? JSON.stringify([s.archive.fromSeq, s.archive.toSeq, str(s.archive.restartId), s.archive.exportHash ?? null]) : "";
  return [String(s.tenantId), s.kind, s.seq, String(s.fromId), String(s.toId), s.count, s.contentHash, s.prevHash, new Date(s.sealedAt).toISOString(), a].join("|");
}
const sign = (key: string, s: SealBody) => createHmac("sha256", key).update(payload(s)).digest("hex");
/** Signature d'un texte quelconque (rapport figé) avec la clé de scellement. */
export function signText(text: string) { const { kid, key } = currentSealKey(); return { kid, sig: createHmac("sha256", key).update(`text|${text}`).digest("hex") }; }
export function verifyText(text: string, kid: string, sig: string) {
  const key = keyring().get(kid);
  return !!key && sameHex(sig, createHmac("sha256", key).update(`text|${text}`).digest("hex"));
}
function sameHex(a: string, b: string) {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

async function lastSeal(tid: Types.ObjectId, kind: SealKind) {
  return AuditSealModel.findOne({ tenantId: tid, kind }).sort({ seq: -1 }).select("seq toId hash archive").lean<{ seq: number; toId: Types.ObjectId; hash: string; archive?: Archive } | null>();
}
/** Fin de la dernière plage scellée (les sceaux d'archive reprennent la borne du sceau précédent). */
async function lastRangeEnd(tid: Types.ObjectId, kind: SealKind) {
  const s = await AuditSealModel.findOne({ tenantId: tid, kind }).sort({ seq: -1 }).select("toId").lean<{ toId: Types.ObjectId } | null>();
  return s?.toId ?? ZERO_ID;
}

// ─── Scellement ──────────────────────────────────────────────────────────

/** Scelle les pièces de l'organisation créées depuis le dernier sceau. Renvoie le nombre de pièces scellées. */
export async function sealTenant(tenantId: unknown, kind: SealKind, now = new Date()): Promise<number> {
  const tid = new Types.ObjectId(String(tenantId));
  const { kid, key } = currentSealKey();
  const { model, fields, item } = source(kind);
  // Reprise en cours : on ne scelle pas pendant l'effacement (l'archive suivra).
  const { TenantModel } = await import("@/models/Tenant");
  if (kind === "entries" && await TenantModel.exists({ _id: tid, restartInProgressAt: { $exists: true } })) return 0;
  // Jamais de borne dans le futur (horloge décalée, lancement manuel) ; seule la base de test peut décaler l'heure.
  const clock = process.env.AUDIT_SEAL_TEST_CLOCK === "1" ? now.getTime() : Math.min(now.getTime(), Date.now());
  const upper = Types.ObjectId.createFromTime(Math.floor((clock - SETTLE_MS) / 1000));
  let sealed = 0;
  for (let n = 0; n < MAX_SEALS_PER_RUN; n++) {
    const last = await lastSeal(tid, kind);
    const prevTo = await lastRangeEnd(tid, kind);
    if (String(upper) <= String(prevTo)) break;
    const docs = await model.find({ tenantId: tid, _id: { $gt: prevTo, $lte: upper } }).sort({ _id: 1 }).limit(BATCH).select(fields).lean<Doc[]>();
    if (!docs.length) break;
    const items = docs.map(item);
    const toId = docs.length === BATCH ? docs[docs.length - 1]._id : upper;
    const body: SealBody = { tenantId: tid, kind, seq: (last?.seq ?? 0) + 1, fromId: prevTo, toId, count: docs.length, contentHash: contentOf(items), prevHash: last?.hash ?? GENESIS, sealedAt: now };
    try {
      await AuditSealModel.create({ ...body, items, kid, hash: sign(key, body) });
    } catch (err) {
      // Passage concurrent : l'autre a scellé ce lot (index unique sur seq).
      if ((err as { code?: number }).code === 11000) break;
      throw err;
    }
    sealed += docs.length;
    if (docs.length < BATCH) break;
  }
  return sealed;
}

/**
 * Reprise de la comptabilité : sceau d'archive ajouté à la chaîne (jamais de
 * modification d'un sceau existant). Les écritures des sceaux couverts qui
 * manquent sont excusées ; celles qui restent sont toujours vérifiées.
 */
export async function archiveEntrySeals(tenantId: unknown, ref: { restartId: unknown; exportHash?: string }, now = new Date()) {
  const tid = new Types.ObjectId(String(tenantId));
  const last = await lastSeal(tid, "entries");
  if (!last) return;
  const prevArchive = await AuditSealModel.findOne({ tenantId: tid, kind: "entries", archive: { $exists: true } }).sort({ seq: -1 }).select("archive seq").lean<{ seq: number; archive: Archive } | null>();
  const fromSeq = prevArchive ? prevArchive.seq + 1 : 1;
  if (fromSeq > last.seq) return;
  const { kid, key } = currentSealKey();
  const prevTo = await lastRangeEnd(tid, "entries");
  const archive: Archive = { fromSeq, toSeq: last.seq, restartId: new Types.ObjectId(String(ref.restartId)), exportHash: ref.exportHash };
  for (let attempt = 0; attempt < 3; attempt++) {
    const head = attempt ? await lastSeal(tid, "entries") : last;
    const body: SealBody = { tenantId: tid, kind: "entries", seq: head!.seq + 1, fromId: prevTo, toId: prevTo, count: 0, contentHash: contentOf([]), prevHash: head!.hash, sealedAt: now, archive: { ...archive, toSeq: head!.seq } };
    try { await AuditSealModel.create({ ...body, items: [], kid, hash: sign(key, body) }); return; }
    catch (err) { if ((err as { code?: number }).code !== 11000) throw err; }
  }
  throw new Error("Archive des sceaux impossible : scellement concurrent.");
}

// ─── Vérification ────────────────────────────────────────────────────────

export type SealProblem = {
  type: "chain" | "signature" | "modified" | "deleted" | "inserted" | "late" | "backdated";
  seq: number; id?: string; traced?: boolean; detail: string;
};
export type SealCheck = {
  kind: SealKind; seals: number; items: number; archived: number; firstSealAt: Date | null;
  lastSeq: number | null; lastHash: string | null; lastSealAt: Date | null; unsealed: number; oldestUnsealedAt: Date | null;
  problems: SealProblem[]; checkedAt: Date;
};
type SealDoc = SealBody & { items: Item[]; kid: string; hash: string };

/** Problème grave : tout sauf une modification tracée du libellé ou de la référence. */
export function isSerious(p: SealProblem) {
  return !(p.type === "modified" && p.traced) && !(p.type === "late" && p.seq === 1);
}

/** Vérifie la chaîne et le contenu de tous les sceaux de l'organisation. */
export async function verifyTenant(tenantId: unknown, kind: SealKind, now = new Date()): Promise<SealCheck> {
  const tid = new Types.ObjectId(String(tenantId));
  const { model, fields, item } = source(kind);
  const ring = keyring();
  const problems: SealProblem[] = [];
  // Archives d'abord (peu nombreuses) : quels sceaux couvrent des écritures effacées par une reprise.
  const archives = await AuditSealModel.find({ tenantId: tid, kind, archive: { $exists: true } }).select("seq archive").lean<Array<{ seq: number; archive: Archive }>>();
  const archivedSeq = (seq: number) => archives.some(a => a.archive.fromSeq <= seq && seq <= a.archive.toSeq && a.archive.toSeq < a.seq);
  const mutableChanged: Array<{ id: string; seq: number; sealedAt: Date; m: string; label?: unknown; reference?: unknown }> = [];
  let prevHash = GENESIS, prevTo: Types.ObjectId = ZERO_ID, expected = 1, items = 0, seals = 0;
  let prevSeal: { sealedAt: Date; count: number } | null = null;
  let first: Date | null = null, last: SealDoc | null = null;
  const cursor = AuditSealModel.find({ tenantId: tid, kind }).sort({ seq: 1 }).lean<SealDoc[]>().cursor();
  for await (const raw of cursor) {
    const s = raw as unknown as SealDoc;
    seals++;
    first = first ?? new Date(s.sealedAt);
    if (s.seq !== expected) problems.push({ type: "chain", seq: s.seq, detail: `Sceau(x) n° ${expected} à ${s.seq - 1} manquant(s) : chaîne rompue.` });
    else if (s.prevHash !== prevHash) problems.push({ type: "chain", seq: s.seq, detail: `Le sceau n° ${s.seq} ne suit pas le précédent (chaîne rompue).` });
    expected = s.seq + 1;
    const key = ring.get(s.kid);
    if (!key) problems.push({ type: "signature", seq: s.seq, detail: `Sceau n° ${s.seq} signé par une clé inconnue du serveur (clé changée sans AUDIT_SEAL_KEYS_OLD ?).` });
    else if (!sameHex(s.hash, sign(key, s)) || s.contentHash !== contentOf(s.items) || s.count !== s.items.length) {
      problems.push({ type: "signature", seq: s.seq, detail: `Signature du sceau n° ${s.seq} invalide : sceau réécrit en base.` });
    }
    prevHash = s.hash;
    last = s;
    if (s.archive) {
      if (!(s.archive.fromSeq >= 1 && s.archive.toSeq < s.seq && s.archive.fromSeq <= s.archive.toSeq)) problems.push({ type: "chain", seq: s.seq, detail: `Sceau d'archive n° ${s.seq} incohérent.` });
      continue;
    }
    if (String(s.fromId) !== String(prevTo)) problems.push({ type: "chain", seq: s.seq, detail: `Le sceau n° ${s.seq} ne reprend pas la plage là où s'arrêtait le précédent.` });
    // Rescellement tardif : pièces scellées plus de 26 h après leur création, hors suite d'un même passage.
    if (s.items.length) {
      const oldest = new Types.ObjectId(String(s.items[0].id)).getTimestamp().getTime();
      const sameRun = prevSeal && prevSeal.count === BATCH && Math.abs(new Date(s.sealedAt).getTime() - new Date(prevSeal.sealedAt).getTime()) < 600_000;
      if (new Date(s.sealedAt).getTime() - oldest > LATE_MS && !sameRun) {
        problems.push({ type: "late", seq: s.seq, detail: s.seq === 1
          ? "Premier sceau posé plus de 26 h après les pièces : rattrapage initial, ou chaîne supprimée puis refaite (comparez à l'empreinte notée)."
          : `Sceau n° ${s.seq} posé plus de 26 h après ses pièces : scellement interrompu, ou sceaux supprimés puis refaits après modification.` });
      }
    }
    prevSeal = { sealedAt: new Date(s.sealedAt), count: s.count };
    prevTo = new Types.ObjectId(String(s.toId));
    items += s.count;
    const docs = await model.find({ tenantId: tid, _id: { $gt: s.fromId, $lte: s.toId } }).select(fields).lean<Doc[]>();
    const byId = new Map(docs.map(d => [String(d._id), d]));
    const excused = archivedSeq(s.seq);
    for (const it of s.items) {
      const d = byId.get(String(it.id));
      byId.delete(String(it.id));
      if (!d) { if (!excused) problems.push({ type: "deleted", seq: s.seq, id: String(it.id), detail: "Pièce scellée supprimée." }); continue; }
      const now_ = item(d);
      // Ligne du journal antidatée : sa date ne correspond pas à son identifiant (ajout fabriqué).
      if (kind === "audit" && d.createdAt && Math.abs(new Date(d.createdAt as string).getTime() - d._id.getTimestamp().getTime()) > 600_000) {
        problems.push({ type: "backdated", seq: s.seq, id: String(it.id), detail: "Ligne du journal d'audit dont la date ne correspond pas à sa création (ajout antidaté)." });
      }
      if (now_.h !== it.h) problems.push({ type: "modified", seq: s.seq, id: String(it.id), traced: false, detail: kind === "entries" ? "Écriture scellée modifiée dans son noyau (date, comptes, montants, tiers, auteur)." : "Ligne du journal d'audit modifiée." });
      // Borne : la fin de la plage scellée (une modification antérieure serait déjà dans l'empreinte).
      else if (it.m && now_.m !== it.m) mutableChanged.push({ id: String(it.id), seq: s.seq, sealedAt: new Types.ObjectId(String(s.toId)).getTimestamp(), m: it.m, label: d.label, reference: d.reference });
    }
    for (const id of byId.keys()) problems.push({ type: "inserted", seq: s.seq, id, detail: "Pièce glissée après coup dans une plage déjà scellée." });
  }
  // Libellé ou référence modifiés : tracés si une ligne d'audit postérieure au sceau porte exactement les valeurs actuelles.
  if (mutableChanged.length) {
    const logs = await AuditLogModel.find({ tenantId: tid, resource: "accountingEntries", action: "UPDATE", resourceId: { $in: mutableChanged.map(p => new Types.ObjectId(p.id)) } })
      .select("resourceId before after createdAt").lean<Array<{ _id: Types.ObjectId; resourceId: Types.ObjectId; before?: Record<string, unknown>; after?: Record<string, unknown>; createdAt: Date }>>();
    for (const c of mutableChanged) {
      const mine = logs.filter(l => String(l.resourceId) === c.id && new Date(l.createdAt) > c.sealedAt && l.after && (l.after.label !== undefined || l.after.reference !== undefined))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || String(a._id).localeCompare(String(b._id)));
      // La dernière modification porte les valeurs actuelles…
      const lastLog = mine[mine.length - 1];
      const lastOk = !!lastLog && (lastLog.after!.label === undefined || lastLog.after!.label === c.label) && (lastLog.after!.reference === undefined || lastLog.after!.reference === c.reference);
      // … et, en remontant les « avant », on retrouve exactement l'état scellé.
      const state = { label: c.label, reference: c.reference };
      for (const l of [...mine].reverse()) { if (l.before?.label !== undefined) state.label = l.before.label; if (l.before?.reference !== undefined) state.reference = l.before.reference; }
      const firstOk = sha(JSON.stringify([state.label ?? null, state.reference ?? null])).slice(0, 16) === c.m;
      const ok = lastOk && firstOk;
      problems.push({ type: "modified", seq: c.seq, id: c.id, traced: ok, detail: ok ? "Libellé ou référence modifiés par l'application après scellement (tracé au journal)." : "Libellé ou référence modifiés sans trace correspondante au journal d'audit." });
    }
  }
  const upper = Types.ObjectId.createFromTime(Math.floor((now.getTime() - SETTLE_MS) / 1000));
  const pending = { tenantId: tid, _id: { $gt: prevTo, $lt: upper } };
  const [unsealed, oldest] = await Promise.all([
    model.countDocuments(pending),
    model.findOne(pending).sort({ _id: 1 }).select("_id").lean<{ _id: Types.ObjectId } | null>(),
  ]);
  return {
    kind, seals, items, archived: archives.length, firstSealAt: first,
    lastSeq: last?.seq ?? null, lastHash: last?.hash ?? null, lastSealAt: last ? new Date(last.sealedAt) : null,
    unsealed, oldestUnsealedAt: oldest ? oldest._id.getTimestamp() : null, problems, checkedAt: now,
  };
}

/** Vérification mise en cache six heures (la vérification complète relit tout l'historique). */
export async function verifyTenantCached(tenantId: unknown, kind: SealKind, opts: { force?: boolean; now?: Date; minAgeMs?: number } = {}): Promise<SealCheck> {
  const tid = new Types.ObjectId(String(tenantId));
  const now = opts.now ?? new Date();
  const c = await AuditCheckModel.findOne({ tenantId: tid, kind }).lean<{ at: Date; result: SealCheck } | null>();
  const age = c ? now.getTime() - new Date(c.at).getTime() : Infinity;
  // Cache : six heures ; une vérification forcée depuis l'écran au plus toutes les dix minutes (minAgeMs) ; une date de contrôle dans le futur est ignorée.
  if (c && age >= 0 && age < (opts.force ? (opts.minAgeMs ?? 0) : CACHE_MS)) return c.result;
  const result = await verifyTenant(tid, kind, now);
  // Tête constatée au contrôle précédent : elle ne doit plus changer.
  const seen = c?.result;
  if (seen?.lastSeq && seen.lastHash) {
    const s = await AuditSealModel.findOne({ tenantId: tid, kind, seq: seen.lastSeq }).select("hash").lean<{ hash: string } | null>();
    if (!s || s.hash !== seen.lastHash) result.problems.push({ type: "chain", seq: seen.lastSeq, detail: `Le sceau n° ${seen.lastSeq} constaté au contrôle du ${new Date(c!.at).toISOString().slice(0, 16).replace("T", " ")} a disparu ou changé : fin de chaîne refaite.` });
  }
  await AuditCheckModel.updateOne({ tenantId: tid, kind }, { $set: { at: now, result } }, { upsert: true });
  return result;
}

/** Le sceau n° `seq` porte-t-il bien l'empreinte notée ? (comparaison avec une empreinte conservée hors de l'application) */
export async function matchAnchor(tenantId: unknown, kind: SealKind, seq: number, hash: string) {
  const s = await AuditSealModel.findOne({ tenantId: new Types.ObjectId(String(tenantId)), kind, seq }).select("hash sealedAt").lean<{ hash: string; sealedAt: Date } | null>();
  return { found: !!s, match: !!s && s.hash === hash.trim().toLowerCase(), sealedAt: s?.sealedAt ?? null };
}
