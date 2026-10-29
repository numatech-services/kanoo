import crypto from "crypto";
import zlib from "zlib";
import path from "path";
import { mkdir, writeFile, readdir, stat, unlink } from "fs/promises";
import mongoose from "mongoose";
import { s3ConfigFrom, s3Request, type S3Config } from "@/lib/s3";
import { localDay } from "@/lib/format";

export { signS3Request } from "@/lib/s3";

/**
 * Sauvegarde de la base, faite par l'application elle-même.
 *
 * L'hébergement Next.js managé de Hostinger n'a pas `mongodump` (que suppose
 * scripts/backup.ts, prévu pour un VPS) : l'application lit donc chaque
 * collection par le pilote, l'écrit en EJSON canonique (types préservés :
 * ObjectId, dates, décimaux), compresse, CHIFFRE, puis dépose l'archive :
 *   • dans un stockage objet compatible S3 (Backblaze B2, Cloudflare R2,
 *     AWS S3, Wasabi…) — BACKUP_S3_ENDPOINT, _BUCKET, _REGION, _ACCESS_KEY,
 *     _SECRET_KEY ;
 *   • ou dans un dossier (BACKUP_DIR), pour un VPS avec disque persistant.
 *
 * Le chiffrement est obligatoire (BACKUP_ENCRYPTION_KEY) : une sauvegarde
 * contient les bulletins de paie, les adhérents, les comptes de tous les
 * clients. Sans clé, la tâche refuse de tourner plutôt que de déposer ces
 * données en clair chez un tiers. La clé doit être conservée HORS de
 * l'hébergement (gestionnaire de mots de passe) : sans elle, l'archive est
 * irrécupérable.
 *
 * Format (.knb) : « KNB1 » | sel (16) | IV (12) | tag GCM (16) | données.
 * Données = gzip de lignes JSON : un en-tête, puis { c: collection, d: doc }.
 */

const MAGIC = Buffer.from("KNB1");

// ─── Chiffrement ─────────────────────────────────────────────────────────────

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function encryptBackup(plain: Buffer, passphrase: string): Buffer {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function decryptBackup(blob: Buffer, passphrase: string): Buffer {
  if (blob.length < 48 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error("Fichier de sauvegarde Kanoo invalide.");
  const salt = blob.subarray(4, 20), iv = blob.subarray(20, 32), tag = blob.subarray(32, 48);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(blob.subarray(48)), decipher.final()]);
  } catch {
    throw new Error("Déchiffrement impossible : clé incorrecte ou fichier altéré.");
  }
}

// ─── Stockage S3 (lib/s3.ts) ─────────────────────────────────────────────────

/** Configuration S3 de la sauvegarde (variables BACKUP_S3_*). */
function s3Config(): S3Config | null {
  return s3ConfigFrom("BACKUP_S3", "kanoo/");
}

/** Télécharge une archive déposée (restauration). */
export async function downloadFromS3(key: string): Promise<Buffer> {
  const c = s3Config();
  if (!c) throw new Error("Stockage S3 non configuré (BACKUP_S3_*).");
  const res = await s3Request(c, "GET", key);
  if (!res.ok) throw new Error(`S3 ${res.status} : ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

// ─── Export / import ─────────────────────────────────────────────────────────

export interface BackupHeader { kanooBackup: 1; createdAt: string; database: string; collections: Record<string, number> }

/** Export complet de la base courante, compressé (non chiffré). */
export async function dumpDatabase(): Promise<{ data: Buffer; header: BackupHeader }> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Base non connectée.");
  const EJSON = mongoose.mongo.BSON.EJSON;
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map(c => c.name).filter(n => !n.startsWith("system.")).sort();
  const counts: Record<string, number> = {};
  const lines: string[] = [];
  for (const name of names) {
    let n = 0;
    for await (const doc of db.collection(name).find({}, { batchSize: 1000 })) {
      lines.push(JSON.stringify({ c: name, d: EJSON.serialize(doc, { relaxed: false }) }));
      n++;
    }
    counts[name] = n;
  }
  const header: BackupHeader = { kanooBackup: 1, createdAt: new Date().toISOString(), database: db.databaseName, collections: counts };
  const data = zlib.gzipSync(Buffer.from([JSON.stringify(header), ...lines].join("\n") + "\n"), { level: 9 });
  return { data, header };
}

/** Relit une archive déchiffrée : en-tête et documents par collection (types restaurés). */
export function parseBackup(gz: Buffer): { header: BackupHeader; collections: Map<string, unknown[]> } {
  const EJSON = mongoose.mongo.BSON.EJSON;
  const text = zlib.gunzipSync(gz).toString("utf8");
  const [first, ...rest] = text.split("\n").filter(Boolean);
  const header = JSON.parse(first) as BackupHeader;
  if (header.kanooBackup !== 1) throw new Error("En-tête de sauvegarde inconnu.");
  const collections = new Map<string, unknown[]>();
  for (const line of rest) {
    const { c, d } = JSON.parse(line) as { c: string; d: unknown };
    const list = collections.get(c) ?? [];
    list.push(EJSON.deserialize(d as never, { relaxed: false }));
    collections.set(c, list);
  }
  return { header, collections };
}

// ─── Tâche ───────────────────────────────────────────────────────────────────

export function backupTarget(): "s3" | "dir" | null {
  if (s3Config()) return "s3";
  if (process.env.BACKUP_DIR) return "dir";
  return null;
}

/**
 * Sauvegarde du jour : export, chiffrement, dépôt. Retourne un résumé lisible.
 * Sans destination configurée, ne fait rien (ce n'est pas une erreur : une
 * instance de test n'a pas à sauvegarder) ; sans clé, refuse.
 */
export async function runBackup(now = new Date()): Promise<string> {
  const target = backupTarget();
  if (!target) return "non configurée (BACKUP_S3_* ou BACKUP_DIR absents)";
  const passphrase = process.env.BACKUP_ENCRYPTION_KEY;
  if (!passphrase || passphrase.length < 24) throw new Error("BACKUP_ENCRYPTION_KEY absente ou trop courte (24 caractères minimum) : sauvegarde refusée.");

  const { data, header } = await dumpDatabase();
  const blob = encryptBackup(data, passphrase);
  const stamp = localDay(now);
  const file = `kanoo-${header.database}-${stamp}.knb`;
  const docs = Object.values(header.collections).reduce((s, n) => s + n, 0);
  const size = `${(blob.length / 1024 / 1024).toFixed(1)} Mo`;

  if (target === "s3") {
    const c = s3Config()!;
    const key = `${c.prefix}${file}`;
    const res = await s3Request(c, "PUT", key, blob);
    if (!res.ok) throw new Error(`Dépôt S3 refusé (${res.status}) : ${(await res.text()).slice(0, 300)}`);
    return `${docs} document(s), ${Object.keys(header.collections).length} collection(s), ${size} → s3://${c.bucket}/${key}`;
  }

  const dir = process.env.BACKUP_DIR!;
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, file), blob, { mode: 0o600 });
  // Rétention locale (sur S3 : règle de cycle de vie du compartiment).
  const keepDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS || "30"));
  let purged = 0;
  for (const name of await readdir(dir)) {
    if (!/^kanoo-.*\.knb$/.test(name)) continue;
    const st = await stat(path.join(dir, name));
    if (now.getTime() - st.mtimeMs > keepDays * 86_400_000) { await unlink(path.join(dir, name)); purged++; }
  }
  return `${docs} document(s), ${size} → ${path.join(dir, file)}${purged ? `, ${purged} ancienne(s) purgée(s)` : ""}`;
}
