import QRCode from "qrcode";
import { createPDFBuffer } from "./pdf";

/**
 * Génération de documents PDF **à la marque de chaque organisation**.
 *
 * Jusqu'ici le PDF de facture était dessiné en dur (fond noir, « généré par
 * Kanoo »), sans jamais lire le logo, les couleurs ni l'adresse du tenant.
 * Ce module fait l'inverse : l'en-tête, le pied de page et les couleurs
 * viennent de `tenant.branding`, et un QR de vérification est apposé.
 *
 * Les primitives (en-tête, pied, QR) sont partagées : brancher le devis, le
 * bon de livraison ou la réponse à un appel d'offres revient à réutiliser
 * `drawBrandedHeader` / `drawBrandedFooter` / `drawDocumentQr`.
 */

type Doc = InstanceType<typeof import("pdfkit")>;

export interface TenantBranding {
  primaryColor?: string;
  secondaryColor?: string;
  showLogo?: boolean;
  tagline?: string;
  legalFooter?: string;
  paymentInstructions?: string;
  defaultTerms?: string;
  documentQr?: boolean;
  headerLayout?: "left" | "centered";
}

export interface TenantIdentity {
  _id?: unknown;
  name?: string;
  logo?: string;
  nif?: string;
  rccm?: string;
  address?: string;
  phone?: string;
  email?: string;
  branding?: TenantBranding;
}

const FALLBACK = { primary: "#2F3E46", secondary: "#8A8F98", ink: "#111111", muted: "#6B7280", line: "#E5E7EB" };

function colors(tenant: TenantIdentity) {
  const b = tenant.branding ?? {};
  return {
    primary: /^#[0-9a-fA-F]{6}$/.test(b.primaryColor || "") ? b.primaryColor! : FALLBACK.primary,
    secondary: /^#[0-9a-fA-F]{6}$/.test(b.secondaryColor || "") ? b.secondaryColor! : FALLBACK.secondary,
    ink: FALLBACK.ink, muted: FALLBACK.muted, line: FALLBACK.line,
  };
}

/** Décode un logo data-URI en Buffer pour PDFKit. Ignore ce qui n'est pas exploitable. */
function logoBuffer(logo?: string): Buffer | null {
  if (!logo) return null;
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(logo.trim());
  if (!m) return null; // une URL distante n'est pas récupérée ici (build sans réseau)
  try { return Buffer.from(m[2], "base64"); } catch { return null; }
}

/**
 * En-tête de marque : logo (si fourni), identité de l'organisation, titre du
 * document et sa référence. Renvoie la position Y où le corps peut commencer.
 */
export function drawBrandedHeader(
  doc: Doc, tenant: TenantIdentity,
  meta: { title: string; number: string; lines?: Array<[string, string]> }
): number {
  const c = colors(tenant);
  const b = tenant.branding ?? {};
  const M = 50;

  // Bandeau coloré discret en haut.
  doc.rect(0, 0, 595, 6).fill(c.primary);

  const logo = b.showLogo === false ? null : logoBuffer(tenant.logo);
  let leftY = 40;

  if (logo) {
    try { doc.image(logo, M, 34, { fit: [120, 54] }); leftY = 96; } catch { /* image illisible : on continue */ }
  }

  // Identité de l'organisation (sous le logo, ou à sa place).
  doc.fillColor(c.primary).font("Helvetica-Bold").fontSize(logo ? 12 : 16)
    .text(tenant.name || "Votre organisation", M, leftY, { width: 300 });
  let y = leftY + (logo ? 16 : 22);
  doc.font("Helvetica").fontSize(8).fillColor(c.muted);
  if (b.tagline) { doc.text(b.tagline, M, y, { width: 300 }); y += 11; }
  const idBits = [
    tenant.nif ? `NIF : ${tenant.nif}` : "",
    tenant.rccm ? `RCCM : ${tenant.rccm}` : "",
  ].filter(Boolean).join("   ");
  if (idBits) { doc.text(idBits, M, y, { width: 300 }); y += 11; }
  if (tenant.address) { doc.text(tenant.address, M, y, { width: 260 }); y += 11; }
  const contact = [tenant.phone, tenant.email].filter(Boolean).join("  ·  ");
  if (contact) { doc.text(contact, M, y, { width: 300 }); y += 11; }

  // Bloc titre + référence, à droite.
  doc.fillColor(c.primary).font("Helvetica-Bold").fontSize(20)
    .text(meta.title.toUpperCase(), 320, 40, { width: 225, align: "right" });
  doc.fillColor(c.ink).font("Helvetica").fontSize(11)
    .text(meta.number, 320, 66, { width: 225, align: "right" });
  let metaY = 84;
  doc.fontSize(8.5).fillColor(c.muted);
  for (const [label, value] of meta.lines ?? []) {
    doc.text(`${label} : ${value}`, 320, metaY, { width: 225, align: "right" });
    metaY += 12;
  }

  const bodyTop = Math.max(y, metaY, 130) + 10;
  doc.moveTo(M, bodyTop).lineTo(545, bodyTop).strokeColor(c.line).stroke();
  return bodyTop + 14;
}

/**
 * Pied de page de marque : mentions légales et instructions de paiement de
 * l'organisation. Ancré en bas de page.
 */
export function drawBrandedFooter(doc: Doc, tenant: TenantIdentity) {
  const c = colors(tenant);
  const b = tenant.branding ?? {};
  const M = 50;

  const y = 762;
  if (b.paymentInstructions) {
    doc.fillColor(c.primary).font("Helvetica-Bold").fontSize(8).text("Règlement", M, y);
    doc.fillColor(c.muted).font("Helvetica").fontSize(8)
      .text(b.paymentInstructions, M, y + 11, { width: 380 });
  }

  doc.rect(0, 812, 595, 30).fill(c.primary);
  const footer = b.legalFooter || `${tenant.name || ""} — document généré le ${new Date().toLocaleDateString("fr-FR")}`;
  doc.fillColor("#ffffff").font("Helvetica").fontSize(7.5)
    .text(footer, M, 822, { width: 495, align: "center" });
}

/**
 * Appose un QR. Pour une facture certifiée SECeF, on privilégie la charge utile
 * officielle ; sinon un résumé vérifiable (type, référence, organisation,
 * montant, date) — utile dès qu'on le scanne, sans dépendre d'une page en ligne.
 */
export async function drawDocumentQr(
  doc: Doc, payload: string, opts: { x: number; y: number; size?: number; caption?: string }
) {
  const size = opts.size ?? 78;
  const png = await QRCode.toBuffer(payload, { type: "png", margin: 0, width: size * 3, errorCorrectionLevel: "M" });
  doc.image(png, opts.x, opts.y, { width: size });
  if (opts.caption) {
    doc.fillColor(FALLBACK.muted).font("Helvetica").fontSize(6.5)
      .text(opts.caption, opts.x - 10, opts.y + size + 3, { width: size + 20, align: "center" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Générateur de facture
// ─────────────────────────────────────────────────────────────────────────────

// PDFKit (Helvetica standard) ne possède pas l'espace fine insécable qu'utilise
// toLocaleString("fr-FR") comme séparateur de milliers, et la rend « / ». On la
// remplace par une espace ordinaire.
const num = (n: number) => (n || 0).toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " ");
const XOF = (n: number) => `${num(n)} XOF`;

export interface InvoiceForPdf {
  _id?: unknown;
  number?: string;
  documentType?: string;
  issueDate?: Date | string;
  dueDate?: Date | string;
  status?: string;
  lines?: Array<{ description?: string; quantity?: number; unitPrice?: number; tvaRate?: number; totalTTC?: number }>;
  totalHT?: number; totalTVA?: number; totalDTS?: number; totalTTC?: number;
  paidAmount?: number; notes?: string;
  clientId?: { name?: string; nif?: string; address?: string; phone?: string } | null;
  secef?: { code?: string; qrPayload?: string };
}

const STATUS_FR: Record<string, string> = {
  draft: "Brouillon", sent: "Émise", partial: "Part. payée",
  paid: "Soldée", overdue: "En retard", cancelled: "Annulée",
};

/** Charge utile du QR : SECeF si certifiée, sinon un résumé vérifiable. */
function invoiceQrPayload(inv: InvoiceForPdf, tenant: TenantIdentity): string {
  if (inv.secef?.qrPayload) return inv.secef.qrPayload;
  const date = inv.issueDate ? new Date(inv.issueDate).toLocaleDateString("fr-FR") : "";
  const kind = inv.documentType === "credit_note" ? "Avoir" : "Facture";
  return `Kanoo | ${kind} ${inv.number ?? ""} | ${tenant.name ?? ""} | ${XOF(inv.totalTTC ?? 0)} | ${date}`;
}

/**
 * Facture PDF à la marque de l'organisation, QR apposé.
 * Le même patron sert un avoir (documentType = credit_note).
 */
export async function generateInvoicePdf(inv: InvoiceForPdf, tenant: TenantIdentity): Promise<Buffer> {
  const c = colors(tenant);
  const isCredit = inv.documentType === "credit_note";
  const withQr = tenant.branding?.documentQr !== false;
  const qrPayload = withQr ? invoiceQrPayload(inv, tenant) : null;

  return createPDFBuffer(async (doc) => {
    let y = drawBrandedHeader(doc, tenant, {
      title: isCredit ? "Avoir" : "Facture",
      number: inv.number || "—",
      lines: [
        ["Émission", inv.issueDate ? new Date(inv.issueDate).toLocaleDateString("fr-FR") : "—"],
        ...(!isCredit && inv.dueDate ? [["Échéance", new Date(inv.dueDate).toLocaleDateString("fr-FR")] as [string, string]] : []),
        ["Statut", STATUS_FR[inv.status || ""] || inv.status || "—"],
      ],
    });

    // Bloc client.
    doc.fillColor(c.primary).font("Helvetica-Bold").fontSize(9).text(isCredit ? "AVOIR À" : "FACTURÉ À", 320, y);
    doc.font("Helvetica").fillColor(c.ink).fontSize(11).text(inv.clientId?.name || "Client", 320, y + 13, { width: 225 });
    let cy = y + 28;
    doc.fontSize(8.5).fillColor(c.muted);
    for (const bit of [inv.clientId?.nif ? `NIF : ${inv.clientId.nif}` : "", inv.clientId?.address, inv.clientId?.phone]) {
      if (bit) { doc.text(bit, 320, cy, { width: 225 }); cy += 11; }
    }
    y += 56;

    // Tableau des lignes.
    doc.rect(50, y, 495, 22).fill(c.primary);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8.5);
    doc.text("Description", 58, y + 7);
    doc.text("Qté", 300, y + 7, { width: 34, align: "center" });
    doc.text("P.U. HT", 340, y + 7, { width: 62, align: "right" });
    doc.text("TVA", 408, y + 7, { width: 38, align: "center" });
    doc.text("Total TTC", 452, y + 7, { width: 88, align: "right" });
    y += 22;

    doc.font("Helvetica").fontSize(8.5);
    for (let i = 0; i < (inv.lines?.length ?? 0); i++) {
      const line = inv.lines![i];
      if (y > 700) { doc.addPage(); y = 60; }
      if (i % 2 === 0) { doc.rect(50, y, 495, 20).fill("#F7F7F5"); }
      doc.fillColor(c.ink);
      doc.text(String(line.description || "").slice(0, 58), 58, y + 5, { width: 236 });
      doc.text(String(line.quantity ?? 0), 300, y + 5, { width: 34, align: "center" });
      doc.text(num(line.unitPrice || 0), 340, y + 5, { width: 62, align: "right" });
      doc.text(`${Math.round((line.tvaRate || 0) * 100)} %`, 408, y + 5, { width: 38, align: "center" });
      doc.text(XOF(line.totalTTC || 0), 452, y + 5, { width: 88, align: "right" });
      y += 20;
    }

    // Totaux.
    y += 14;
    if (y > 660) { doc.addPage(); y = 60; }
    const totalRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(bold ? c.ink : c.muted);
      doc.text(label, 330, y); doc.text(value, 430, y, { width: 115, align: "right" });
      y += 15;
    };
    doc.moveTo(330, y - 4).lineTo(545, y - 4).strokeColor(c.line).stroke();
    if ((inv.totalHT ?? 0) > 0) totalRow("Sous-total HT", XOF(inv.totalHT!));
    if ((inv.totalTVA ?? 0) > 0) totalRow("TVA", XOF(inv.totalTVA!));
    if ((inv.totalDTS ?? 0) > 0) totalRow("Droit de timbre", XOF(inv.totalDTS!));

    doc.rect(330, y, 215, 24).fill(c.primary);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10);
    doc.text(isCredit ? "TOTAL AVOIR" : "TOTAL TTC", 340, y + 7);
    doc.text(XOF(inv.totalTTC ?? 0), 430, y + 7, { width: 105, align: "right" });
    y += 32;

    if (!isCredit && (inv.paidAmount ?? 0) > 0) {
      doc.fillColor("#1C5D4C").font("Helvetica").fontSize(9);
      doc.text("Encaissé", 330, y); doc.text(XOF(inv.paidAmount!), 430, y, { width: 115, align: "right" });
      const remaining = (inv.totalTTC ?? 0) - (inv.paidAmount ?? 0);
      if (remaining > 0) {
        y += 14;
        doc.fillColor("#B23B2E").font("Helvetica-Bold");
        doc.text("Reste dû", 330, y); doc.text(XOF(remaining), 430, y, { width: 115, align: "right" });
      }
    }

    // Conditions / notes.
    const terms = inv.notes || tenant.branding?.defaultTerms;
    if (terms) {
      const ty = Math.min(y + 30, 690);
      doc.fillColor(c.primary).font("Helvetica-Bold").fontSize(8).text("Conditions", 50, ty);
      doc.fillColor(c.muted).font("Helvetica").fontSize(8).text(terms, 50, ty + 11, { width: 250 });
    }

    // QR — en bas à droite, au-dessus du pied.
    if (qrPayload) {
      await drawDocumentQr(doc, qrPayload, {
        x: 470, y: 700, size: 74,
        caption: inv.secef?.code ? "Vérification SECeF" : "Vérification",
      });
    }

    drawBrandedFooter(doc, tenant);
  });
}
