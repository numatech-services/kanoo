/**
 * Utilitaires PDF — Kanoo
 * Encapsule PDFKit pour la génération de documents PDF conformes Niger
 */

export interface PDFTableRow {
  cells: string[];
  bold?: boolean;
  background?: string;
}

export interface PDFTableOptions {
  headers: string[];
  rows: PDFTableRow[];
  columnWidths: number[]; // en points
  startX?: number;
  startY?: number;
  fontSize?: number;
}

/**
 * Crée un document PDF et retourne son buffer
 */
export async function createPDFBuffer(
  render: (doc: InstanceType<typeof import("pdfkit")>) => void,
  options?: { landscape?: boolean }
): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const buffers: Buffer[] = [];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: options?.landscape ? "landscape" : "portrait",
      margin: 50,
    });

    doc.on("data", (chunk: Buffer) => buffers.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    render(doc);
    doc.end();
  });
}

/**
 * En-tête standard Kanoo pour les documents officiels
 */
export function addNUMAPHeader(
  doc: InstanceType<typeof import("pdfkit")>,
  title: string,
  subtitle?: string
): void {
  doc
    .fontSize(18)
    .font("Helvetica-Bold")
    .fillColor("#2F3E46")
    .text("Kanoo", 50, 50)
    .fontSize(10)
    .font("Helvetica")
    .fillColor("#6B705C")
    .text("Plateforme de gestion — Niamey, Niger", 50, 72);

  doc
    .moveTo(50, 90)
    .lineTo(545, 90)
    .strokeColor("#C9B79C")
    .lineWidth(1)
    .stroke();

  doc
    .fontSize(16)
    .font("Helvetica-Bold")
    .fillColor("#0B1020")
    .text(title, 50, 105, { align: "center", width: 495 });

  if (subtitle) {
    doc
      .fontSize(11)
      .font("Helvetica")
      .fillColor("#6B705C")
      .text(subtitle, 50, 128, { align: "center", width: 495 });
  }
}

/**
 * Table simple pour les rapports
 */
export function addTable(
  doc: InstanceType<typeof import("pdfkit")>,
  options: PDFTableOptions
): number {
  const { headers, rows, columnWidths, startX = 50, fontSize = 9 } = options;
  let y = options.startY || doc.y + 10;
  const rowHeight = 18;

  // En-têtes
  doc.fontSize(fontSize).font("Helvetica-Bold").fillColor("#6B705C");
  let x = startX;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], x, y, { width: columnWidths[i], ellipsis: true });
    x += columnWidths[i];
  }
  y += rowHeight;

  // Ligne séparatrice
  const totalWidth = columnWidths.reduce((a, b) => a + b, 0);
  doc.moveTo(startX, y - 4).lineTo(startX + totalWidth, y - 4).strokeColor("#C9B79C").lineWidth(0.5).stroke();

  // Lignes de données
  for (const row of rows) {
    doc.fontSize(fontSize).font(row.bold ? "Helvetica-Bold" : "Helvetica").fillColor("#0B1020");
    x = startX;
    for (let i = 0; i < row.cells.length; i++) {
      doc.text(row.cells[i] || "—", x, y, { width: columnWidths[i], ellipsis: true });
      x += columnWidths[i];
    }
    y += rowHeight;

    // Saut de page si nécessaire
    if (y > 740) {
      doc.addPage();
      y = 50;
    }
  }

  return y;
}

/**
 * Footer standard
 */
export function addFooter(
  doc: InstanceType<typeof import("pdfkit")>,
  pageNumber = 1
): void {
  doc
    .fontSize(8)
    .font("Helvetica")
    .fillColor("#9CA3AF")
    .text(
      `Document généré par Kanoo — ${new Date().toLocaleDateString("fr-FR")} — Page ${pageNumber}`,
      50, 790, { align: "center", width: 495 }
    );
}
