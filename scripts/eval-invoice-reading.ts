/**
 * Évaluation de la lecture automatique des factures (lib/ai-invoice.ts) avec
 * le VRAI modèle — chaque document consomme un appel facturé par Anthropic
 * (quelques centimes). À lancer à la main, avec votre clé :
 *
 *   ANTHROPIC_API_KEY=… npx tsx scripts/eval-invoice-reading.ts
 *       → 4 factures de test générées (montants connus), lecture comparée champ par champ
 *   ANTHROPIC_API_KEY=… npx tsx scripts/eval-invoice-reading.ts ~/Factures
 *       → en plus, lit chaque PDF / photo du dossier et affiche ce qui est extrait
 *
 * Les documents du dossier sont envoyés à l'API d'Anthropic : n'y mettez que
 * des factures que vous acceptez de transmettre.
 */
import PDFDocument from "pdfkit";
import path from "path";
import { readdir, readFile } from "fs/promises";
import { readSupplierInvoice, INVOICE_MEDIA_TYPES, type InvoiceMediaType, type ExtractedInvoice } from "../lib/ai-invoice";

interface Case {
  name: string; supplier: string; nif: string; number: string; date: string; dueDate: string;
  lines: Array<{ label: string; qty: number; unit: number; tva: number }>;
  /** Mise en page « ticket de caisse » (TTC seul, sans TVA détaillée). */
  ticket?: boolean;
}

const CASES: Case[] = [
  { name: "facture simple", supplier: "Quincaillerie du Fleuve", nif: "1234567/R", number: "FA-2026-0118", date: "2026-10-12", dueDate: "2026-11-11",
    lines: [{ label: "Ciment CPJ 45 (sac 50 kg)", qty: 20, unit: 5_250, tva: 0.19 }, { label: "Fer à béton 10 mm (barre)", qty: 30, unit: 3_100, tva: 0.19 }] },
  { name: "prestation sans TVA", supplier: "Cabinet Conseil Sahel", nif: "7654321/P", number: "2026/045", date: "2026-09-30", dueDate: "2026-10-30",
    lines: [{ label: "Accompagnement fiscal — septembre 2026", qty: 1, unit: 350_000, tva: 0 }] },
  { name: "fournitures, plusieurs lignes", supplier: "Librairie Papeterie Niamey", nif: "2468013/R", number: "LPN-88412", date: "2026-10-03", dueDate: "",
    lines: [{ label: "Ramette papier A4 80 g", qty: 10, unit: 3_500, tva: 0.19 }, { label: "Cartouche encre noire", qty: 2, unit: 27_000, tva: 0.19 }, { label: "Classeurs à levier", qty: 12, unit: 1_500, tva: 0.19 }] },
  { name: "ticket de caisse", supplier: "Station Oasis Plateau", nif: "", number: "T-55102", date: "2026-10-18", dueDate: "", ticket: true,
    lines: [{ label: "Gasoil", qty: 40, unit: 668, tva: 0 }] },
];

const fcfa = (n: number) => Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ");
const ht = (c: Case) => c.lines.reduce((s, l) => s + l.qty * l.unit, 0);
const tva = (c: Case) => c.lines.reduce((s, l) => s + Math.round(l.qty * l.unit * l.tva), 0);
const frDate = (iso: string) => iso.split("-").reverse().join("/");

function pdfFor(c: Case): Promise<Buffer> {
  return new Promise(resolve => {
    const doc = new PDFDocument({ size: c.ticket ? [226, 420] : "A4", margin: c.ticket ? 14 : 50 });
    const chunks: Buffer[] = [];
    doc.on("data", b => chunks.push(b)); doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(c.ticket ? 11 : 16).text(c.supplier, { align: c.ticket ? "center" : "left" });
    doc.fontSize(c.ticket ? 7 : 9).text("Niamey — Niger" + (c.nif ? `   NIF : ${c.nif}` : ""), { align: c.ticket ? "center" : "left" }).moveDown();
    doc.fontSize(c.ticket ? 8 : 12).text(`${c.ticket ? "Ticket" : "FACTURE"} N° ${c.number}`);
    doc.fontSize(c.ticket ? 7 : 10).text(`Date : ${frDate(c.date)}` + (c.dueDate ? `     Échéance : ${frDate(c.dueDate)}` : "")).moveDown();
    for (const l of c.lines) doc.text(`${l.label}   ${l.qty} × ${fcfa(l.unit)} = ${fcfa(l.qty * l.unit)} FCFA${c.ticket ? "" : `   TVA ${Math.round(l.tva * 100)} %`}`);
    doc.moveDown();
    if (c.ticket) doc.fontSize(9).text(`TOTAL : ${fcfa(ht(c))} FCFA`);
    else { doc.text(`Total HT : ${fcfa(ht(c))} FCFA`); doc.text(`TVA : ${fcfa(tva(c))} FCFA`); doc.fontSize(12).text(`Total TTC : ${fcfa(ht(c) + tva(c))} FCFA`); }
    doc.end();
  });
}

function compare(c: Case, x: ExtractedInvoice): string[] {
  const issues: string[] = [];
  const eq = (label: string, got: unknown, want: unknown) => { if (got !== want) issues.push(`${label} : lu « ${got} », attendu « ${want} »`); };
  if (!x.supplierName.toLowerCase().includes(c.supplier.toLowerCase().split(" ")[0])) issues.push(`fournisseur : lu « ${x.supplierName} »`);
  eq("numéro", x.invoiceNumber, c.number);
  eq("date", x.invoiceDate, c.date);
  if (c.dueDate) eq("échéance", x.dueDate, c.dueDate);
  if (c.nif) eq("NIF", x.supplierNif, c.nif);
  eq("lignes", x.lines.length, c.lines.length);
  eq("total HT", Math.round(x.totalHT), ht(c));
  eq("total TTC", Math.round(x.totalTTC), ht(c) + tva(c));
  return issues;
}

const typeOf = (f: string): InvoiceMediaType | null => {
  const ext = path.extname(f).toLowerCase();
  const map: Record<string, InvoiceMediaType> = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
  return map[ext] && INVOICE_MEDIA_TYPES.includes(map[ext]) ? map[ext] : null;
};

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY manquante."); process.exit(2); }
  let ok = 0;
  console.log("Factures de test générées :");
  for (const c of CASES) {
    const t0 = Date.now();
    try {
      const r = await readSupplierInvoice({ data: await pdfFor(c), mediaType: "application/pdf" });
      const issues = compare(c, r.invoice);
      if (!issues.length) ok++;
      console.log(`  ${issues.length ? "✗" : "✓"} ${c.name} (${((Date.now() - t0) / 1000).toFixed(1)} s)${issues.length ? "\n      " + issues.join("\n      ") : ""}`);
      if (r.warnings.length) console.log(`      avertissements : ${r.warnings.join(" | ")}`);
    } catch (err) {
      console.log(`  ✗ ${c.name} : ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`${ok}/${CASES.length} lues sans écart.`);

  const dir = process.argv[2];
  if (!dir) return;
  console.log(`\nDossier ${dir} :`);
  for (const f of (await readdir(dir)).sort()) {
    const mediaType = typeOf(f);
    if (!mediaType) continue;
    try {
      const r = await readSupplierInvoice({ data: await readFile(path.join(dir, f)), mediaType });
      const x = r.invoice;
      console.log(`  • ${f} → ${x.supplierName || "?"} · n° ${x.invoiceNumber || "?"} · ${x.invoiceDate || "date ?"} · ${x.lines.length} ligne(s) · HT ${fcfa(x.totalHT)} · TTC ${fcfa(x.totalTTC)}${r.warnings.length ? `\n      ⚠ ${r.warnings.join(" | ")}` : ""}`);
    } catch (err) {
      console.log(`  • ${f} → ${err instanceof Error ? err.message : err}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
