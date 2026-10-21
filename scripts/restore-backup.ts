/**
 * Restauration d'une sauvegarde Kanoo (.knb, produite par lib/backup.ts).
 *
 * Usage :
 *   # 1. Vérifier une archive sans rien écrire (à faire régulièrement : une
 *   #    sauvegarde jamais relue n'est pas une sauvegarde) :
 *   BACKUP_ENCRYPTION_KEY=… npx tsx scripts/restore-backup.ts --verify kanoo-kanoo-2026-10-21.knb
 *   # … ou directement depuis le stockage S3 (variables BACKUP_S3_*) :
 *   BACKUP_ENCRYPTION_KEY=… npx tsx scripts/restore-backup.ts --verify --s3 kanoo/kanoo-kanoo-2026-10-21.knb
 *
 *   # 2. Restaurer dans une base VIDE (jamais par-dessus la production) :
 *   BACKUP_ENCRYPTION_KEY=… RESTORE_MONGODB_URI="mongodb+srv://…/kanoo_restore" \
 *     npx tsx scripts/restore-backup.ts kanoo-kanoo-2026-10-21.knb
 *
 * Garde-fous : la base cible doit être donnée explicitement (RESTORE_MONGODB_URI,
 * jamais MONGODB_URI par défaut) et ses collections doivent être vides —
 * sinon refus, sauf `--drop` qui les vide d'abord (à n'utiliser qu'en
 * connaissance de cause).
 */
import { readFile } from "fs/promises";
import mongoose from "mongoose";
import { decryptBackup, downloadFromS3, parseBackup } from "../lib/backup";

async function main() {
  const args = process.argv.slice(2);
  const verify = args.includes("--verify");
  const drop = args.includes("--drop");
  const fromS3 = args.includes("--s3");
  const source = args.filter(a => !a.startsWith("--")).pop();
  if (!source) { console.error("Indiquez le fichier .knb (ou la clé S3 avec --s3)."); process.exit(2); }

  const passphrase = process.env.BACKUP_ENCRYPTION_KEY;
  if (!passphrase) { console.error("BACKUP_ENCRYPTION_KEY manquante."); process.exit(2); }

  const blob = fromS3 ? await downloadFromS3(source) : await readFile(source);
  const { header, collections } = parseBackup(decryptBackup(blob, passphrase));
  const total = [...collections.values()].reduce((s, l) => s + l.length, 0);
  console.log(`Sauvegarde du ${header.createdAt} — base « ${header.database} », ${collections.size} collection(s), ${total} document(s).`);

  // Intégrité : chaque collection annoncée dans l'en-tête doit avoir son compte exact.
  const mismatched = Object.entries(header.collections).filter(([c, n]) => (collections.get(c)?.length ?? 0) !== n);
  if (mismatched.length) {
    console.error(`Archive incomplète : ${mismatched.map(([c, n]) => `${c} (${collections.get(c)?.length ?? 0}/${n})`).join(", ")}`);
    process.exit(1);
  }
  if (verify) { console.log("Vérification réussie : archive lisible et complète."); return; }

  const uri = process.env.RESTORE_MONGODB_URI;
  if (!uri) { console.error("RESTORE_MONGODB_URI manquante : indiquez explicitement la base cible."); process.exit(2); }
  if (process.env.MONGODB_URI && uri === process.env.MONGODB_URI && !drop) {
    console.error("La cible est la base de production (MONGODB_URI). Refus : restaurez dans une base vide.");
    process.exit(2);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  for (const name of collections.keys()) {
    const n = await db.collection(name).estimatedDocumentCount();
    if (n > 0 && !drop) { console.error(`La collection « ${name} » de la cible n'est pas vide (${n}). Refus (option --drop pour la vider).`); process.exit(1); }
  }
  for (const [name, docs] of collections) {
    if (drop) await db.collection(name).deleteMany({});
    for (let i = 0; i < docs.length; i += 1000) {
      await db.collection(name).insertMany(docs.slice(i, i + 1000) as never[], { ordered: true });
    }
    console.log(`  ${name} : ${docs.length}`);
  }
  await mongoose.disconnect();
  console.log("Restauration terminée. Recréez les index avec : MONGODB_URI=<cible> npm run indexes");
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
