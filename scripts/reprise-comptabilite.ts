/**
 * Reprise de la comptabilité d'UNE organisation, depuis un poste de travail :
 * export complet (zip enregistré sur ce poste), puis, sur confirmation tapée,
 * effacement de la comptabilité, de la trésorerie et des caisses.
 *
 * Même logique que l'écran (lib/accounting-restart) : coupure, paquets,
 * vérification des comptes, verrou de période, pièces antérieures protégées.
 *
 * Usage :
 *   npm run reprise-compta                               (demande l'adresse de la base, liste les organisations)
 *   MONGODB_URI=… npx tsx scripts/reprise-comptabilite.ts --org <identifiant>            (export seul, rien n'est effacé)
 *   MONGODB_URI=… npx tsx scripts/reprise-comptabilite.ts --org <identifiant> --effacer  (export puis effacement)
 * L'identifiant est le « slug » de l'organisation (sans argument, la liste s'affiche).
 */
import { createHash } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { createInterface } from "readline";
import mongoose from "mongoose";
import JSZip from "jszip";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

/** Saisie masquée (étoiles) : l'adresse de la base contient un mot de passe. */
function askHidden(question: string): Promise<string> {
  return new Promise(resolve => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (!stdin.isTTY) { let buf = ""; stdin.on("data", d => { buf += d; }); stdin.on("end", () => resolve(buf.trim())); return; }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    let value = "";
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") { stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData); process.stdout.write("\n"); resolve(value.trim()); return; }
        if (c === "\u0003") { process.stdout.write("\n"); process.exit(1); }
        if (c === "\u007f") { if (value) { value = value.slice(0, -1); process.stdout.write("\b \b"); } continue; }
        value += c; process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

/** Réseau instable (coupure, DNS) : la même lecture est retentée, sans rien perdre ni doubler. */
async function retry<T>(fn: () => Promise<T>, tries = 8): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (i >= tries || !/ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|timed out|Server selection|network|closed|pool/i.test(msg)) throw e;
      process.stdout.write(`\n  Réseau interrompu (${msg.slice(0, 60)}) : nouvel essai ${i}/${tries - 1} dans ${i * 5} s…`);
      await new Promise(r => setTimeout(r, i * 5000));
    }
  }
}

async function main() {
  // Adresse de la base : variable MONGODB_URI, sinon demandée (collez-la, elle s'affiche en étoiles).
  const uri = process.env.MONGODB_URI || await askHidden("Adresse de la base de production (mongodb+srv://…) : ");
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) { console.error("Adresse invalide : elle commence par mongodb+srv:// ou mongodb://"); process.exit(1); }
  const args = process.argv.slice(2);
  const slug = args[args.indexOf("--org") + 1];
  const erase = args.includes("--effacer");
  try { await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 120000, retryReads: true, retryWrites: true }); }
  catch (e) {
    console.error(`Connexion à la base impossible : ${e instanceof Error ? e.message : e}`);
    console.error("Vérifiez l'adresse (mot de passe compris) et, dans MongoDB Atlas → Network Access, autorisez l'adresse IP de ce Mac.");
    process.exit(1);
  }
  const host = mongoose.connection.host, dbName = mongoose.connection.name;
  const { startExport, exportChunk, completeExport, restartAccounting, restartPreview } = await import("../lib/accounting-restart");
  const { TenantModel } = await import("../models/Tenant");
  const { UserModel } = await import("../models/User");

  if (!args.includes("--org") || !slug) {
    const list = await TenantModel.find({}).select("slug name createdAt").lean<Array<{ _id: unknown; slug: string; name: string; createdAt?: Date }>>();
    const db = mongoose.connection.db!;
    console.log(`Base ${dbName} sur ${host}. Organisations (écritures, caisses et banques, factures, utilisateurs, dernière écriture) :`);
    for (const t of list) {
      const f = { tenantId: t._id };
      const [entries, accounts, invoices, users, last] = await Promise.all([
        db.collection("accountingentries").countDocuments(f), db.collection("treasuryaccounts").countDocuments(f),
        db.collection("invoices").countDocuments(f), db.collection("users").countDocuments(f),
        db.collection("accountingentries").find(f).sort({ entryDate: -1 }).limit(1).project({ entryDate: 1 }).next(),
      ]);
      console.log(`  --org ${t.slug.padEnd(40)} ${String(entries).padStart(6)} écr. ${String(accounts).padStart(3)} cpt ${String(invoices).padStart(5)} fact. ${String(users).padStart(3)} util.  ${last?.entryDate ? new Date(last.entryDate).toISOString().slice(0, 10) : "—"}   (${t.name})`);
    }
    return;
  }
  const tenant = await TenantModel.findOne({ slug }).select("_id name").lean<{ _id: unknown; name: string } | null>();
  if (!tenant) { console.error(`Organisation « ${slug} » introuvable.`); process.exit(1); }
  const admin = await UserModel.findOne({ tenantId: tenant._id, role: { $in: ["pme_admin", "superadmin"] }, isActive: true }).select("_id").lean<{ _id: unknown } | null>();
  if (!admin) { console.error("Aucun gérant actif dans cette organisation."); process.exit(1); }
  const auth = { tenantId: String(tenant._id), userId: String(admin._id), role: "pme_admin" } as unknown as Parameters<typeof startExport>[0];

  console.log(`\nBase ${dbName} sur ${host}\nOrganisation : ${tenant.name} (${slug})\n`);
  const p = await restartPreview(auth.tenantId);
  for (const c of p.counts) console.log(`  ${c.label.padEnd(36)} ${c.count}`);
  console.log(`  ${"Comptes de trésorerie remis à zéro".padEnd(36)} ${p.treasuryAccounts}\n  ${"Caisses ouvertes".padEnd(36)} ${p.openSessions}\n`);

  // 1. Export complet, par paquets, enregistré sur ce poste.
  const start = await retry(() => startExport(auth));
  const zip = new JSZip(), counts: Record<string, number> = {};
  for (const c of start.collections) {
    const parts: string[] = [];
    let after: string | null = null;
    do {
      const ch = await retry(() => exportChunk(auth, { exportId: start.exportId, collection: c.name, after }));
      parts.push(...ch.docs); after = ch.after;
    } while (after);
    counts[c.name] = parts.length;
    zip.file(`${c.name}.json`, `[\n${parts.join(",\n")}\n]`);
    process.stdout.write(`\r  Export : ${c.name.padEnd(30)} ${parts.length}        `);
  }
  zip.file("LISEZMOI.txt", [`Export complet Kanoo — ${tenant.name}`, `Coupure : ${start.exportedAt.toISOString()}`, "EJSON canonique, secrets retirés ; justificatifs inventoriés dans attachments.json.", "À conserver dix ans.", "", ...Object.entries(counts).map(([k, v]) => `${k} : ${v}`)].join("\n"));
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const hash = createHash("sha256").update(buf).digest("hex");
  mkdirSync("exports-reprise", { recursive: true });
  const file = `exports-reprise/kanoo-${slug}-${start.exportedAt.toISOString().slice(0, 19).replace(/:/g, "-")}.zip`;
  writeFileSync(file, buf);
  await retry(() => completeExport(auth, { exportId: start.exportId, counts, hash }));
  console.log(`\n\n  Archive enregistrée : ${file} (${(buf.length / 1048576).toFixed(1)} Mo, ${Object.values(counts).reduce((t, v) => t + v, 0)} documents)\n  Empreinte SHA-256 : ${hash}\n  Copiez-la à un second endroit et gardez-la dix ans.\n`);
  if (!erase) { console.log("Export seul : rien n'a été effacé. Relancez avec --effacer pour la reprise."); return; }

  // 2. Effacement, sur double confirmation.
  if (p.openSessions > 0) { console.error("Des caisses sont ouvertes : fermez-les, puis relancez."); process.exit(1); }
  // Lecture ligne à ligne : fonctionne au clavier comme avec une entrée redirigée.
  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (q: string) => { process.stdout.write(q); const r = await lines.next(); return r.done ? "" : String(r.value); };
  const a = await ask(`Pour effacer la comptabilité, la trésorerie et les caisses de « ${tenant.name} », tapez l'identifiant ${slug} : `);
  const b = await ask("Puis tapez REPRENDRE : ");
  rl.close();
  if (a.trim() !== slug || b.trim() !== "REPRENDRE") { console.log("Confirmation incorrecte : rien n'a été effacé."); return; }
  const r = await restartAccounting(auth, { exportId: start.exportId, exportHash: hash, confirm: "REPRENDRE" });
  console.log(`\nReprise faite au ${r.restartDate.toISOString().slice(0, 10)}. Effacé :`);
  for (const [k, v] of Object.entries(r.deleted)) console.log(`  ${k.padEnd(24)} ${v}`);
  if (r.kept) console.log(`  ${r.kept} document(s) gardé(s) : créés ou modifiés après l'export.`);
  console.log("\nLa comptable saisit maintenant les soldes d'ouverture : Comptabilité → Reprise des soldes.");
}

// Fin explicite : des minuteries de l'application (cache, limites) garderaient le processus ouvert.
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => { await mongoose.disconnect(); process.exit(); });
