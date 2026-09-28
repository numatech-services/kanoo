import ExcelJS from "exceljs";
import { normalizeText, ISIC_SUBMISSION_HEADERS } from "@/lib/isic-registry";

/**
 * Lecture / écriture des fichiers Excel ISIC (côté serveur).
 * Les dates Excel deviennent « AAAA-MM-JJ » et les nombres des chaînes sans
 * « .0 » (un Personal ID numérique comme 25161 doit rester « 25161 »).
 */

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    // Les dates Excel sont en UTC minuit : on lit les composantes UTC.
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map(r => r.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text; // lien hypertexte
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue); // formule
    if ("error" in v) return "";
  }
  return String(v);
}

/**
 * Première feuille d'un classeur → { headers normalisés, rows }. La ligne
 * d'en-tête est la première qui contient au moins 3 cellules texte (certains
 * fichiers ont un titre au-dessus du tableau).
 */
export async function readXlsx(buffer: Buffer): Promise<{ headers: string[]; rows: string[][] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };

  const all: string[][] = [];
  const width = ws.columnCount;
  ws.eachRow({ includeEmpty: false }, row => {
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value).replace(/\s+/g, " ").trim());
    if (cells.some(x => x !== "")) all.push(cells);
  });
  const h = all.findIndex(r => r.filter(c => c && isNaN(Number(c))).length >= 3);
  if (h < 0) return { headers: [], rows: [] };
  return { headers: all[h].map(normalizeText), rows: all.slice(h + 1) };
}

export interface SubmissionRow {
  requestType: string;
  personalId: string;
  firstName: string;
  lastName: string;
  city?: string;
  email?: string;
  phone?: string;
  dateOfBirth?: Date | null;
  className?: string;
  institution: string;
  cardNumber?: string;
}

/**
 * Fichier d'envoi à ISIC, identique à vos fichiers : 24 colonnes, Card Type
 * « ISIC », dates de validité et nom de photo laissés vides (ISIC associe les
 * photos par leur nom de fichier = Personal ID), State/Province vide.
 */
export async function buildSubmissionXlsx(rows: SubmissionRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kanoo";
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow([...ISIC_SUBMISSION_HEADERS]);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    const byHeader: Record<string, unknown> = {
      "Card Type": "ISIC",
      "Request Type": r.requestType,
      "Personal ID": r.personalId,
      "Cardholder's First Name": r.firstName,
      "Cardholder's Last Name": r.lastName,
      "City": r.city || "",
      "E-mail": r.email || "",
      "Phone Number": r.phone || "",
      // Date « pure » à midi UTC : aucun décalage de fuseau ne peut la faire changer de jour.
      "Date of Birth": r.dateOfBirth ? new Date(Date.UTC(r.dateOfBirth.getFullYear(), r.dateOfBirth.getMonth(), r.dateOfBirth.getDate(), 12)) : "",
      "Class Name": r.className || "",
      "Academic Institution Name": r.institution,
      "Card number": r.cardNumber || "",
    };
    ws.addRow(ISIC_SUBMISSION_HEADERS.map(h => byHeader[h] ?? ""));
  }
  const dobCol = ISIC_SUBMISSION_HEADERS.indexOf("Date of Birth") + 1;
  ws.getColumn(dobCol).numFmt = "dd/mm/yyyy";
  ws.columns.forEach(c => { c.width = 18; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
