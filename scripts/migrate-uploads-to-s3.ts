/**
 * Recopie les pièces jointes stockées sur disque (UPLOAD_DIR, par défaut
 * var/uploads) vers le stockage S3 des pièces jointes (STORAGE_S3_*).
 *
 * Usage (variables STORAGE_S3_* et éventuellement UPLOAD_DIR exportées) :
 *   npx tsx scripts/migrate-uploads-to-s3.ts           # recopie ce qui manque
 *   npx tsx scripts/migrate-uploads-to-s3.ts --dry-run # compte sans écrire
 *
 * Idempotent : un fichier déjà présent dans le compartiment est sauté. Rien
 * n'est supprimé du disque : vérifiez l'application, puis videz le dossier.
 */
import path from "path";
import { readdir, readFile } from "fs/promises";
import { s3ConfigFrom, s3Request } from "../lib/s3";
import { STORAGE_ROOT } from "../lib/storage";

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const c = s3ConfigFrom("STORAGE_S3", "uploads/");
  if (!c) { console.error("STORAGE_S3_* incomplètes : rien à faire."); process.exit(2); }
  let copied = 0, skipped = 0, failed = 0;
  for await (const file of walk(STORAGE_ROOT)) {
    const key = c.prefix + path.relative(STORAGE_ROOT, file).split(path.sep).join("/");
    if ((await s3Request(c, "HEAD", key)).ok) { skipped++; continue; }
    if (dry) { copied++; continue; }
    const res = await s3Request(c, "PUT", key, await readFile(file));
    if (res.ok) copied++; else { failed++; console.error(`  échec ${key} : ${res.status}`); }
  }
  console.log(`${dry ? "À recopier" : "Recopiés"} : ${copied} · déjà présents : ${skipped} · échecs : ${failed} (depuis ${STORAGE_ROOT})`);
  if (failed) process.exit(1);
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
