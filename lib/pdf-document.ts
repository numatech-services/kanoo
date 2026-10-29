import QRCode from "qrcode";
import { createPDFBuffer } from "./pdf";
import { renderBusinessPdf, type DocStyle, type DocTenant } from "./pdf-business";
import { invoiceDoc, quoteDoc, type InvoiceLike, type QuoteLike } from "./business-doc";

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
  /** Documents commerciaux (lib/pdf-business). */
  documentStyle?: "prestige" | "moderne" | "signature"; legalForm?: string;
  city?: string; website?: string; extraIds?: string;
  signatoryName?: string; signatoryTitle?: string; stamp?: string; clientApproval?: boolean;
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
export interface DocParty { name?: string; address?: string; nif?: string; rccm?: string; code?: string; phone?: string }

export function drawBrandedHeader(
  doc: Doc, tenant: TenantIdentity,
  meta: { title: string; number: string; lines?: Array<[string, string]>; partyLabel?: string },
  party?: DocParty | null
): number {
  const c = colors(tenant);
  const b = tenant.branding ?? {};
  const M = 50;

  // Bande d'en-tête pleine largeur (couleur principale) + filet d'accent
  // (couleur secondaire) — reprend la mise en forme institutionnelle.
  const BAND = 100;
  doc.rect(0, 0, 595, BAND).fill(c.primary);
  doc.rect(0, BAND, 595, 4).fill(c.secondary);

  // Ligne de tête : nom de l'organisation + slogan, petites capitales espacées.
  const topLine = [tenant.name, b.tagline].filter(Boolean).join("  ·  ").toUpperCase();
  doc.fillColor("#ffffff").fillOpacity(0.65).font("Helvetica-Bold").fontSize(7.5)
    .text(topLine, M, 22, { width: 380, characterSpacing: 1.4 });
  doc.fillOpacity(1);

  // Type de document, en grand.
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(26)
    .text(meta.title, M, 44, { width: 360, characterSpacing: 0.3 });

  // Logo à droite dans la bande.
  const logo = b.showLogo === false ? null : logoBuffer(tenant.logo);
  if (logo) { try { doc.image(logo, 435, 26, { fit: [110, 48] }); } catch { /* illisible */ } }

  // Deux colonnes sous la bande : destinataire (gauche) et références (droite).
  const leftY = BAND + 26;
  const label = (t: string, x: number, w: number, align: "left" | "right" = "left") =>
    doc.fillColor(c.secondary).font("Helvetica-Bold").fontSize(8).text(t.toUpperCase(), x, leftY, { width: w, align, characterSpacing: 1 });

  if (party) {
    label(meta.partyLabel || "Destinataire", M, 250);
    doc.fillColor(c.ink).font("Helvetica-Bold").fontSize(12).text(party.name || "—", M, leftY + 13, { width: 250 });
    let py = leftY + 30;
    doc.font("Helvetica").fontSize(8.5).fillColor(c.muted);
    for (const bit of [party.address, party.code ? `N° client : ${party.code}` : "", party.nif ? `NIF : ${party.nif}` : "", party.rccm ? `RCCM : ${party.rccm}` : ""]) {
      if (bit) { doc.text(bit, M, py, { width: 250 }); py += 11; }
    }
  }

  // Références à droite (numéro + lignes de méta).
  doc.fillColor(c.secondary).font("Helvetica-Bold").fontSize(8).text("RÉFÉRENCES", 345, leftY, { width: 200, align: "right", characterSpacing: 1 });
  doc.fillColor(c.ink).font("Helvetica-Bold").fontSize(11).text(meta.number, 345, leftY + 13, { width: 200, align: "right" });
  let metaY = leftY + 30;
  doc.font("Helvetica").fontSize(8.5).fillColor(c.muted);
  for (const [lab, value] of meta.lines ?? []) {
    doc.text(`${lab}`, 300, metaY, { width: 140, align: "left" });
    doc.font("Helvetica-Bold").fillColor(c.ink).text(value, 345, metaY, { width: 200, align: "right" });
    doc.font("Helvetica").fillColor(c.muted);
    metaY += 13;
  }

  return Math.max(leftY + 70, metaY + 12);
}

/**
 * Pied de page de marque : mentions légales et instructions de paiement de
 * l'organisation. Ancré en bas de page.
 */
export function drawBrandedFooter(doc: Doc, tenant: TenantIdentity) {
  const c = colors(tenant);
  const b = tenant.branding ?? {};
  const M = 50;

  // Le pied est écrit SOUS la marge basse (50 pt) : PDFKit y voyait un
  // débordement et ouvrait une page par ligne — un courrier d'une page sortait
  // en trois, dont deux blanches portant la mention légale et le téléphone.
  // On lève la marge le temps du pied, puis on la rétablit.
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  const y = 748;
  if (b.paymentInstructions) {
    doc.fillColor(c.secondary).font("Helvetica-Bold").fontSize(8).text("RÈGLEMENT", M, y, { characterSpacing: 1 });
    doc.fillColor(c.muted).font("Helvetica").fontSize(8)
      .text(b.paymentInstructions, M, y + 11, { width: 400 });
  }

  // Filet fin + ligne légale sobre (nom, adresse, RCCM, NIF), à la manière du modèle.
  doc.moveTo(M, 806).lineTo(545, 806).strokeColor(c.line).stroke();
  const legal = b.legalFooter || [
    tenant.name, tenant.address,
    tenant.rccm ? `RCCM ${tenant.rccm}` : "", tenant.nif ? `NIF ${tenant.nif}` : "",
  ].filter(Boolean).join("  ·  ");
  doc.fillColor(c.muted).font("Helvetica").fontSize(7).text(legal, M, 814, { width: 495 });
  const contact = [tenant.phone, tenant.email].filter(Boolean).join("  ·  ");
  if (contact) doc.fillColor(c.muted).font("Helvetica").fontSize(7).text(contact, M, 826, { width: 495 });

  doc.page.margins.bottom = savedBottom;
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

/**
 * Facture, avoir, devis et proforma : dessinés par le moteur de documents
 * commerciaux (lib/pdf-business, styles « prestige », « moderne » et « signature »), à partir
 * de leurs données (lib/business-doc). Les routes gardent ces deux points
 * d'entrée.
 */
export type InvoiceForPdf = InvoiceLike & { _id?: unknown };
export type QuoteForPdf = QuoteLike;

export async function generateInvoicePdf(inv: InvoiceForPdf, tenant: TenantIdentity, opts: { portalUrl?: string | null; style?: DocStyle } = {}): Promise<Buffer> {
  return renderBusinessPdf(invoiceDoc(inv, tenant as DocTenant, opts), tenant as DocTenant, { style: opts.style });
}

export async function generateQuotePdf(q: QuoteForPdf, tenant: TenantIdentity, opts: { proforma?: boolean; style?: DocStyle } = {}): Promise<Buffer> {
  return renderBusinessPdf(quoteDoc(q, tenant as DocTenant, opts), tenant as DocTenant, { style: opts.style });
}

// ─────────────────────────────────────────────────────────────────────────────
// Courrier / correspondance administrative — en-tête de marque, corps libre.
// ─────────────────────────────────────────────────────────────────────────────

export interface LetterForPdf {
  reference?: string;
  date?: Date | string;
  place?: string;          // lieu d'émission (ex. « Niamey »)
  recipient?: string;      // bloc destinataire (multi-lignes)
  subject?: string;        // objet
  body?: string;           // corps, paragraphes séparés par des sauts de ligne
  signatory?: string;      // nom + fonction du signataire
}

/**
 * Courrier PDF à la marque de l'organisation. Le corps est libre — c'est ce que
 * l'assistant IA (rédaction de correspondances) alimentera, mais il se saisit
 * aussi à la main.
 */
export async function generateLetterPdf(letter: LetterForPdf, tenant: TenantIdentity): Promise<Buffer> {
  const c = colors(tenant);
  const M = 50;
  const date = letter.date ? new Date(letter.date).toLocaleDateString("fr-FR") : new Date().toLocaleDateString("fr-FR");

  return createPDFBuffer(async (doc) => {
    let y = drawBrandedHeader(doc, tenant, {
      title: "Courrier",
      number: letter.reference || "",
      lines: [[letter.place ? "Fait à" : "Date", letter.place ? `${letter.place}, le ${date}` : date]],
    });

    // Bloc destinataire, aligné à droite.
    if (letter.recipient) {
      doc.fillColor(c.ink).font("Helvetica").fontSize(10)
        .text(letter.recipient, 320, y, { width: 225, align: "left" });
      y += 14 * (letter.recipient.split("\n").length + 1);
    }
    y += 10;

    if (letter.subject) {
      doc.fillColor(c.primary).font("Helvetica-Bold").fontSize(10.5)
        .text(`Objet : ${letter.subject}`, M, y, { width: 495 });
      y += 26;
    }

    doc.fillColor(c.ink).font("Helvetica").fontSize(10.5);
    for (const para of String(letter.body || "").split(/\n{2,}/)) {
      if (y > 720) { doc.addPage(); y = 60; }
      doc.text(para.trim(), M, y, { width: 495, align: "left", lineGap: 3 });
      y = doc.y + 12;
    }

    if (letter.signatory) {
      y = Math.max(y + 20, 660);
      doc.font("Helvetica").fontSize(10).fillColor(c.ink)
        .text(letter.signatory, 330, y, { width: 215, align: "left" });
    }

    drawBrandedFooter(doc, tenant);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Comptoir d'activité (The Spot) — rapport de caisse et d'état du stock.
// ─────────────────────────────────────────────────────────────────────────────

export interface DeskReportForPdf {
  deskName: string;
  periodLabel: string;
  cash: Array<{ date: Date | string; label: string; method: string; direction: "in" | "out"; amount: number }>;
  items: Array<{ name: string; unit: string; quantity: number; unitCost: number; threshold?: number }>;
  /** Journal limité aux recettes ou aux dépenses (les cartes gardent les deux sens). */
  journalFlow?: "in" | "out";
}

const METHOD_FR: Record<string, string> = {
  cash: "Espèces", bank_transfer: "Virement", orange_money: "OM / Moov", card: "Carte", check: "Chèque", other: "Autre",
};

/**
 * Rapport PDF d'un comptoir, à la marque de l'organisation : synthèse
 * (recettes, dépenses, solde, valeur du stock), journal de caisse de la période
 * et état du stock matière. Pensé pour être remis au comptable principal.
 */
export async function generateDeskReportPdf(r: DeskReportForPdf, tenant: TenantIdentity): Promise<Buffer> {
  const c = colors(tenant);
  const M = 50;
  const W = 495;
  const fmt = (n: number) => `${Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ")} FCFA`;

  const recettes = r.cash.filter(e => e.direction === "in").reduce((s, e) => s + e.amount, 0);
  const depenses = r.cash.filter(e => e.direction === "out").reduce((s, e) => s + e.amount, 0);
  const stockValue = r.items.reduce((s, it) => s + (it.quantity || 0) * (it.unitCost || 0), 0);

  return createPDFBuffer(async (doc) => {
    let y = drawBrandedHeader(doc, tenant, {
      title: "Rapport de comptoir",
      number: r.deskName,
      lines: [["Période", r.periodLabel], ["Édité le", new Date().toLocaleDateString("fr-FR")]],
    });

    // Saut de page en gardant le pied de page de marque sur chaque page.
    const ensure = (space: number) => {
      if (y + space > 730) { drawBrandedFooter(doc, tenant); doc.addPage(); y = 60; }
    };

    // ── Synthèse : quatre cartes ────────────────────────────────────────────
    const cards: Array<[string, string]> = [
      ["Recettes", fmt(recettes)], ["Dépenses", fmt(depenses)],
      ["Solde de la période", fmt(recettes - depenses)], ["Valeur du stock", fmt(stockValue)],
    ];
    const cw = (W - 3 * 8) / 4;
    cards.forEach(([label, value], i) => {
      const x = M + i * (cw + 8);
      doc.rect(x, y, cw, 46).fillAndStroke("#F7F8FB", c.line);
      doc.fillColor(c.secondary).font("Helvetica-Bold").fontSize(7).text(label.toUpperCase(), x + 8, y + 8, { width: cw - 16, characterSpacing: 0.8 });
      doc.fillColor(i === 2 ? c.primary : c.ink).font("Helvetica-Bold").fontSize(10.5).text(value, x + 8, y + 24, { width: cw - 16 });
    });
    y += 64;

    // ── Tableau générique ───────────────────────────────────────────────────
    const table = (title: string, cols: Array<{ h: string; w: number; align?: "left" | "right" }>, rows: string[][]) => {
      ensure(60);
      doc.fillColor(c.primary).font("Helvetica-Bold").fontSize(11).text(title, M, y);
      y += 18;
      const header = () => {
        doc.rect(M, y, W, 18).fill(c.primary);
        let x = M;
        for (const col of cols) {
          doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8).text(col.h, x + 5, y + 5, { width: col.w - 10, align: col.align ?? "left" });
          x += col.w;
        }
        y += 18;
      };
      header();
      if (rows.length === 0) {
        doc.fillColor(c.muted).font("Helvetica-Oblique").fontSize(8.5).text("Aucune ligne sur la période.", M + 5, y + 5);
        y += 22;
        return;
      }
      rows.forEach((row, ri) => {
        if (y + 16 > 730) { drawBrandedFooter(doc, tenant); doc.addPage(); y = 60; header(); }
        if (ri % 2 === 1) doc.rect(M, y, W, 16).fill("#F7F8FB");
        let x = M;
        row.forEach((cell, ci) => {
          doc.fillColor(c.ink).font("Helvetica").fontSize(8.5).text(cell, x + 5, y + 4, { width: cols[ci].w - 10, align: cols[ci].align ?? "left", lineBreak: false, ellipsis: true });
          x += cols[ci].w;
        });
        y += 16;
      });
      y += 14;
    };

    const journal = r.journalFlow ? r.cash.filter(e => e.direction === r.journalFlow) : r.cash;
    table(r.journalFlow === "in" ? "Journal de caisse — recettes" : r.journalFlow === "out" ? "Journal de caisse — dépenses" : "Journal de caisse", [
      { h: "Date", w: 70 }, { h: "Libellé", w: 215 }, { h: "Moyen", w: 80 },
      { h: "Montant", w: 130, align: "right" },
    ], journal.map(e => [
      new Date(e.date).toLocaleDateString("fr-FR"), e.label, METHOD_FR[e.method] || e.method,
      `${e.direction === "in" ? "+" : "-"} ${fmt(e.amount)}`,
    ]));

    table("État du stock matière", [
      { h: "Article", w: 185 }, { h: "Stock", w: 80, align: "right" },
      { h: "Coût unitaire", w: 105, align: "right" }, { h: "Valeur", w: 125, align: "right" },
    ], r.items.map(it => [
      it.threshold != null && it.quantity <= it.threshold ? `${it.name}  (sous le seuil)` : it.name,
      `${it.quantity} ${it.unit}`, fmt(it.unitCost), fmt(it.quantity * it.unitCost),
    ]));

    // Visas : la gestion est confiée au gestionnaire, contrôlée par le comptable.
    ensure(60);
    y += 10;
    doc.fillColor(c.muted).font("Helvetica").fontSize(9)
      .text("Visa du gestionnaire du comptoir", M, y, { width: 220 })
      .text("Visa du comptable", 330, y, { width: 215 });
    doc.moveTo(M, y + 40).lineTo(M + 200, y + 40).strokeColor(c.line).stroke();
    doc.moveTo(330, y + 40).lineTo(545, y + 40).strokeColor(c.line).stroke();

    drawBrandedFooter(doc, tenant);
  });
}
